const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const loadPureTypeScriptModule = (relativePath) => {
    const filename = path.resolve(__dirname, relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        fileName: filename,
    }).outputText;
    const loadedModule = { exports: {} };
    new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
        require,
        loadedModule,
        loadedModule.exports,
        filename,
        path.dirname(filename),
    );
    return loadedModule.exports;
};

const {
    buildGeminiConversationHistory,
    buildProviderConversationHistory,
    loadFullConversationHistory,
} = loadPureTypeScriptModule('../src/lib/fullConversationHistory.ts');

const compareIds = (left, right) => {
    if (/^\d+$/.test(String(left)) && /^\d+$/.test(String(right))) return Number(left) - Number(right);
    return String(left).localeCompare(String(right));
};

const baseTime = Date.parse('2026-01-01T00:00:00.000Z');
const rows = Array.from({ length: 2_050 }, (_, index) => ({
    id: String(index + 1),
    session_id: 'session-a',
    sender: index % 3 === 0 ? 'bot' : 'user',
    content: index % 7 === 0 ? 'mensagem repetida legitimamente' : `fala ${index + 1}`,
    created_at: new Date(baseTime + index * 1_000).toISOString(),
    media_type: null,
}));
rows.push(
    { id: 'tie-b', session_id: 'session-a', sender: 'user', content: 'ordem b', created_at: '2026-01-01T00:10:00.123999Z', media_type: null },
    { id: 'tie-a', session_id: 'session-a', sender: 'bot', content: 'ordem a', created_at: '2026-01-01T00:10:00.123456Z', media_type: null },
    { id: 'long', session_id: 'session-a', sender: 'user', content: 'x'.repeat(2_300), created_at: '2026-01-01T00:20:00.000Z', media_type: null },
    { id: 'media', session_id: 'session-a', sender: 'bot', content: 'olha aqui https://api.telegram.org/file/botSECRET/photos/file.png File_ID: ABC123', created_at: '2026-01-01T00:21:00.000Z', media_type: 'photo' },
    { id: 'user-link', session_id: 'session-a', sender: 'user', content: 'veja https://example.com/assunto', created_at: '2026-01-01T00:21:01.000Z', media_type: null },
    { id: 'after-snapshot', session_id: 'session-a', sender: 'user', content: 'fora do snapshot', created_at: '2026-01-02T00:00:00.000Z', media_type: null },
    { id: 'other-session', session_id: 'session-b', sender: 'user', content: 'outra sessão', created_at: '2026-01-01T00:01:00.000Z', media_type: null },
    { id: 'system-row', session_id: 'session-a', sender: 'system', content: 'não enviar', created_at: '2026-01-01T00:22:00.000Z', media_type: null },
);

const makeMockSupabase = (allRows, serverPageCap = Number.POSITIVE_INFINITY) => ({
    from(table) {
        assert.equal(table, 'messages');
        const state = { sessionId: '', senders: [], through: '', from: 0, to: 0 };
        const query = {
            select(columns, options) {
                assert.equal(columns, 'id,sender,content,created_at,media_type');
                assert.deepEqual(options, { count: 'exact' });
                return query;
            },
            eq(column, value) {
                assert.equal(column, 'session_id');
                state.sessionId = String(value);
                return query;
            },
            in(column, values) {
                assert.equal(column, 'sender');
                state.senders = values.map(String);
                return query;
            },
            lte(column, value) {
                assert.equal(column, 'created_at');
                state.through = String(value);
                return query;
            },
            order(column, options) {
                assert.equal(options.ascending, true);
                assert.ok(column === 'created_at' || column === 'id');
                return query;
            },
            range(from, to) {
                state.from = from;
                state.to = to;
                return query;
            },
            then(resolve, reject) {
                try {
                    const throughMs = Date.parse(state.through);
                    const filtered = allRows
                        .filter((row) => String(row.session_id) === state.sessionId)
                        .filter((row) => state.senders.includes(String(row.sender)))
                        .filter((row) => Date.parse(String(row.created_at)) <= throughMs)
                        .sort((left, right) => {
                            const timeDelta = Date.parse(left.created_at) - Date.parse(right.created_at);
                            return timeDelta || compareIds(left.id, right.id);
                        });
                    const requested = filtered.slice(state.from, state.to + 1);
                    return Promise.resolve({ data: requested.slice(0, serverPageCap), count: filtered.length, error: null }).then(resolve, reject);
                } catch (error) {
                    return Promise.reject(error).then(resolve, reject);
                }
            },
        };
        return query;
    },
});

(async () => {
    const result = await loadFullConversationHistory({
        supabase: makeMockSupabase(rows, 31),
        sessionId: 'session-a',
        throughCreatedAt: '2026-01-01T00:34:09.500123Z',
        pageSize: 127,
        currentTurnMessageIds: ['42', 'not-present'],
    });

    assert.ok(result.diagnostics.pagesFetched > 15, 'deve paginar além de uma página');
    assert.ok(result.diagnostics.pagesFetched > 60, 'deve continuar quando o servidor limita cada página');
    assert.ok(result.diagnostics.rowsFetched > 2_000, 'deve buscar mais de 1.000 registros');
    assert.equal(result.diagnostics.sourceMessageCount, result.diagnostics.rowsFetched);
    assert.equal(result.diagnostics.snapshotThroughCreatedAt, '2026-01-01T00:34:09.500123Z');
    assert.equal(result.diagnostics.includedMessageCount, result.messages.length);
    assert.equal(result.diagnostics.excludedCurrentTurnCount, 1);
    assert.ok(result.diagnostics.chars > 2_300);
    assert.equal(result.diagnostics.rowsExcludedAsCurrentTurn, 1);
    assert.equal(result.messages.some((message) => message.id === '42'), false);
    assert.equal(result.messages.some((message) => message.id === 'after-snapshot'), false);
    assert.equal(result.messages.some((message) => message.id === 'other-session'), false);
    assert.equal(result.messages.some((message) => message.id === 'system-row'), false);
    assert.equal(result.diagnostics.firstCreatedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(result.diagnostics.lastCreatedAt, '2026-01-01T00:34:09.000Z');

    const tieMessages = result.messages.filter((message) => message.id === 'tie-a' || message.id === 'tie-b');
    assert.deepEqual(tieMessages.map((message) => message.id), ['tie-a', 'tie-b']);

    const repeated = result.messages.filter((message) => message.text === 'mensagem repetida legitimamente');
    assert.ok(repeated.length > 1, 'textos iguais legítimos não podem ser deduplicados');

    const long = result.messages.find((message) => message.id === 'long');
    assert.equal(long.text.length, 2_300, 'texto longo não pode ser truncado');

    const media = result.messages.find((message) => message.id === 'media');
    assert.ok(media.text.includes('olha aqui'));
    assert.ok(media.text.includes('[mídia: foto]'));
    assert.doesNotMatch(media.text, /https?:\/\/|File_ID|ABC123/i);
    assert.match(result.messages.find((message) => message.id === 'user-link').text, /https:\/\/example\.com\/assunto/);

    const history = buildGeminiConversationHistory([
        { id: 'u1', sender: 'user', role: 'user', text: 'primeira', createdAt: '2026-01-01T00:00:00Z' },
        { id: 'u2', sender: 'user', role: 'user', text: 'segunda', createdAt: '2026-01-01T00:00:01Z' },
        { id: 'b1', sender: 'bot', role: 'model', text: 'resposta', createdAt: '2026-01-02T00:00:02Z' },
        { id: 'b2', sender: 'bot', role: 'model', text: 'continuação', createdAt: '2026-01-02T00:00:03Z' },
    ]);
    assert.deepEqual(history, [
        { role: 'user', parts: [{ text: '[dia UTC: 2026-01-01]\nprimeira\nsegunda' }] },
        { role: 'model', parts: [{ text: '[dia UTC: 2026-01-02]\nresposta\ncontinuação' }] },
    ]);
    assert.equal(history.some((entry) => entry.role === 'system' || entry.role === 'thought'), false);
    assert.deepEqual(buildProviderConversationHistory(history), [
        { role: 'user', content: '[dia UTC: 2026-01-01]\nprimeira\nsegunda' },
        { role: 'assistant', content: '[dia UTC: 2026-01-02]\nresposta\ncontinuação' },
    ]);
    assert.deepEqual(buildProviderConversationHistory([
        { role: 'assistant', content: 'formato já compatível' },
    ]), [{ role: 'assistant', content: 'formato já compatível' }]);
    assert.ok(result.diagnostics.rowsIncluded > 2_000);

    let failedPage = 0;
    const failingSupabase = makeMockSupabase(rows);
    const originalFrom = failingSupabase.from;
    failingSupabase.from = (table) => {
        const query = originalFrom(table);
        const originalRange = query.range;
        query.range = (from, to) => {
            failedPage += 1;
            if (failedPage === 3) {
                return {
                    then: (resolve, reject) => Promise.reject(new Error('falha simulada na paginação')).then(resolve, reject),
                };
            }
            return originalRange.call(query, from, to);
        };
        return query;
    };
    await assert.rejects(
        () => loadFullConversationHistory({ supabase: failingSupabase, sessionId: 'session-a', pageSize: 127 }),
        /falha simulada na paginação/,
        'erro no meio da paginação deve abortar a operação sem parcial',
    );

    console.log(`FULL_CONVERSATION_HISTORY_OK pages=${result.diagnostics.pagesFetched} fetched=${result.diagnostics.rowsFetched} included=${result.diagnostics.rowsIncluded} grouped=${history.length}`);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
