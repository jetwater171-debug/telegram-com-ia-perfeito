const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/lib/mem0LeadMemory.ts');
const source = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
}).outputText;
const loadedModule = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(require, loadedModule, loadedModule.exports, filename, path.dirname(filename));

const {
    addMem0LeadTurn,
    formatMem0LeadMemoryContext,
    mem0LeadUserId,
    normalizeMem0LeadMemorySettings,
    searchMem0LeadMemories,
    testMem0Connection,
} = loadedModule.exports;

assert.equal(mem0LeadUserId('12345'), 'telegram:12345');
assert.equal(normalizeMem0LeadMemorySettings({ enabled: true, topK: 99 }).topK, 12);
assert.equal(normalizeMem0LeadMemorySettings({ enabled: true, topK: 1 }).topK, 3);

const calls = [];
const fakeFetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (String(url).endsWith('/search/')) {
        return new Response(JSON.stringify({ results: [
            { id: '1', memory: 'O lead gosta de futebol.', score: 0.9 },
            { id: '2', memory: 'O lead gosta de futebol.', score: 0.8 },
            { id: '3', memory: 'Trabalha à noite.', score: 0.7 },
        ] }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: 'PENDING', event_id: 'evt-1' }), { status: 200 });
};

(async () => {
    const settings = { apiKey: 'mem0-test-key', enabled: true, topK: 8, timeoutMs: 2_000 };
    const memories = await searchMem0LeadMemories({ settings, userId: 'telegram:12345', query: 'o que ele gosta?', fetcher: fakeFetch });
    assert.deepEqual(memories.map((item) => item.memory), ['O lead gosta de futebol.', 'Trabalha à noite.']);
    assert.match(formatMem0LeadMemoryContext(memories), /MEMÓRIA HUMANA DE LONGO PRAZO/);
    assert.equal(calls[0].body.filters.user_id, 'telegram:12345');
    assert.equal(calls[0].body.rerank, true);

    const added = await addMem0LeadTurn({
        settings,
        userId: 'telegram:12345',
        sessionId: 'session-1',
        userText: 'trabalho à noite',
        assistantMessages: ['entendi, deve ser puxado'],
        fetcher: fakeFetch,
    });
    assert.equal(added.status, 'PENDING');
    assert.equal(calls[1].body.user_id, 'telegram:12345');
    assert.equal(calls[1].body.infer, true);
    assert.match(calls[1].body.custom_instructions, /fatos explícitos/);

    const connection = await testMem0Connection({ apiKey: 'mem0-test-key', fetcher: fakeFetch });
    assert.equal(connection.ok, true);
    assert.match(calls[2].init.headers.Authorization, /^Token /);

    const skipped = await searchMem0LeadMemories({ settings: { ...settings, enabled: false }, userId: 'telegram:12345', query: 'teste', fetcher: fakeFetch });
    assert.deepEqual(skipped, []);

    console.log('MEM0_MEMORY_OK search=2 dedupe=1 add=PENDING auth=Token disabled=noop');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
