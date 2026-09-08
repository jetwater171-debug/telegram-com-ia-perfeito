const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const loadPureTypeScriptModule = (relativePath) => {
  const filename = path.resolve(__dirname, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
    require, loaded, loaded.exports, filename, path.dirname(filename),
  );
  return loaded.exports;
};

const {
  MAX_CONVERSATION_SOURCE_MESSAGES,
  MAX_CONVERSATION_WINDOW_MESSAGES,
  MAX_CONVERSATION_WINDOW_CHARS,
  buildGeminiConversationHistory,
  buildProviderConversationHistory,
  formatConversationBubble,
  loadFullConversationHistory,
  selectRecentConversationHistory,
} = loadPureTypeScriptModule('../src/lib/fullConversationHistory.ts');

const baseTime = Date.parse('2026-01-01T00:00:00.000Z');
const rows = Array.from({ length: 130 }, (_, index) => ({
  id: String(index + 1), session_id: 'session-a', sender: index % 2 ? 'bot' : 'user',
  content: `fala ${index + 1}`, created_at: new Date(baseTime + index * 1000).toISOString(), media_type: null,
}));
rows.push(
  { id: 'media', session_id: 'session-a', sender: 'bot', content: 'olha https://api.telegram.org/file/botSECRET/a File_ID: ABC', created_at: '2026-01-01T00:20:00.000Z', media_type: 'photo' },
  { id: 'other', session_id: 'session-b', sender: 'user', content: 'outra', created_at: '2026-01-01T00:20:01.000Z', media_type: null },
);

const makeMockSupabase = (allRows) => ({
  from(table) {
    assert.equal(table, 'messages');
    const state = { sessionId: '', senders: [], through: '', limit: 0 };
    const query = {
      select(columns, options) { assert.equal(columns, 'id,sender,content,created_at,media_type'); assert.equal(options, undefined); return query; },
      eq(column, value) { assert.equal(column, 'session_id'); state.sessionId = String(value); return query; },
      in(column, values) { assert.equal(column, 'sender'); state.senders = values.map(String); return query; },
      lte(column, value) { assert.equal(column, 'created_at'); state.through = String(value); return query; },
      order(column, options) { assert.ok(column === 'created_at' || column === 'id'); assert.equal(options.ascending, false); return query; },
      limit(value) { state.limit = value; return query; },
      then(resolve, reject) {
        try {
          const filtered = allRows.filter((row) => String(row.session_id) === state.sessionId)
            .filter((row) => state.senders.includes(row.sender))
            .filter((row) => Date.parse(row.created_at) <= Date.parse(state.through))
            .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || String(b.id).localeCompare(String(a.id)))
            .slice(0, state.limit);
          return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    };
    return query;
  },
});

(async () => {
  const result = await loadFullConversationHistory({
    supabase: makeMockSupabase(rows), sessionId: 'session-a', throughCreatedAt: '2026-01-01T00:20:00.000Z',
    currentTurnMessageIds: ['130'],
  });
  assert.equal(MAX_CONVERSATION_SOURCE_MESSAGES, 80);
  assert.equal(result.diagnostics.pagesFetched, 1);
  assert.ok(result.diagnostics.rowsFetched <= 80);
  assert.equal(result.messages.some((message) => message.id === '130'), false);
  assert.equal(result.messages.some((message) => message.id === 'other'), false);
  const media = result.messages.find((message) => message.id === 'media');
  assert.ok(media.text.includes('[mídia: foto]'));
  assert.doesNotMatch(media.text, /api\.telegram|File_ID|ABC/i);

  const completeTurns = [
    ...Array.from({ length: 3 }, (_, index) => ({ id: `u${index}`, sender: 'user', role: 'user', text: 'u'.repeat(10), createdAt: '2026-01-01T00:00:00Z' })),
    ...Array.from({ length: 2 }, (_, index) => ({ id: `b${index}`, sender: 'bot', role: 'model', text: 'b'.repeat(10), createdAt: '2026-01-01T00:00:01Z' })),
    ...Array.from({ length: 3 }, (_, index) => ({ id: `x${index}`, sender: 'user', role: 'user', text: 'x'.repeat(10), createdAt: '2026-01-01T00:00:02Z' })),
  ];
  const window = selectRecentConversationHistory(completeTurns, { maxMessages: 5, maxChars: 80 });
  assert.deepEqual(window.map((message) => message.id), ['b0', 'b1', 'x0', 'x1', 'x2']);
  assert.ok(window.length <= MAX_CONVERSATION_WINDOW_MESSAGES);
  assert.ok(window.reduce((sum, message) => sum + message.text.length, 0) <= MAX_CONVERSATION_WINDOW_CHARS);

  const history = buildGeminiConversationHistory(window, 'America/Sao_Paulo');
  assert.match(history[0].parts[0].text, /^\[31\/12\/25 21:00\] LARI:/);
  assert.match(history[1].parts[0].text, /LEAD:/);
  assert.deepEqual(buildProviderConversationHistory(history).map((entry) => entry.role), ['assistant', 'user']);
  assert.equal(formatConversationBubble(window[0], 'invalid/timezone'), formatConversationBubble(window[0], 'America/Sao_Paulo'));
  const oversized = selectRecentConversationHistory([{ ...window[0], text: 'x'.repeat(9000) + 'final importante' }], { maxMessages: 60, maxChars: 8000 });
  assert.equal(oversized.length, 1);
  assert.equal(oversized[0].text.length, 8000);
  assert.match(oversized[0].text, /^\[trecho anterior omitido\]/);
  assert.match(oversized[0].text, /final importante$/);
  const tied = await loadFullConversationHistory({
    supabase: makeMockSupabase(['8', '9', '10'].map(id => ({ id, session_id: 'session-a', sender: 'user', content: id, created_at: '2026-01-01T00:00:00Z' }))),
    sessionId: 'session-a', throughCreatedAt: '2026-01-01T00:00:00Z', throughMessageId: '9',
  });
  assert.deepEqual(tied.messages.map(message => message.id), ['8', '9']);
  console.log(`FULL_CONVERSATION_HISTORY_OK source<=${MAX_CONVERSATION_SOURCE_MESSAGES} window<=${MAX_CONVERSATION_WINDOW_MESSAGES}/${MAX_CONVERSATION_WINDOW_CHARS} complete_turns=1 local_labels=1`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
