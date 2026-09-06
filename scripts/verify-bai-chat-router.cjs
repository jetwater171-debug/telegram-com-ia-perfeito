const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const compile = (relativePath, customRequire = require) => {
    const filename = path.resolve(__dirname, relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        fileName: filename,
    }).outputText;
    const loadedModule = { exports: {} };
    new Function('require', 'module', 'exports', '__filename', '__dirname', output)(customRequire, loadedModule, loadedModule.exports, filename, path.dirname(filename));
    return loadedModule.exports;
};

const aiModels = compile('../src/lib/aiModels.ts');
const router = compile('../src/lib/baiChatRouter.ts', (id) => {
    if (id === '@/lib/aiModels') return aiModels;
    return require(id);
});

(async () => {
    assert.equal(aiModels.normalizeBaiModelName('deepseek-v4-flash-vision-exp'), 'glm-5.3-flash');
    assert.equal(aiModels.normalizeBaiModelName('unsupported-model'), 'glm-5.3-flash');
    assert.deepEqual(router.resolveBaiTextModelOrder('deepseek-v4-flash-vision-exp'), [
        'glm-5.3-flash',
        'qwen3.8-flash',
        'hy3',
    ]);

    const calls = [];
    const responders = new Map();
    const resultPromise = router.callBaiChatWithFallback({
        apiKey: 'test-key',
        baseUrl: 'https://api.b.ai/v1',
        buildBody: (model) => ({ model }),
        parseResponse: (text) => JSON.parse(text),
        fetcher: async (_url, init) => {
            const model = JSON.parse(init.body).model;
            calls.push(model);
            return new Promise((resolve) => responders.set(model, resolve));
        },
    });

    // Os três modelos gratuitos devem competir pela primeira resposta válida:
    // não pode haver espera de um modelo antes de disparar o próximo.
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(calls, ['glm-5.3-flash', 'qwen3.8-flash', 'hy3']);

    responders.get('glm-5.3-flash')(new Response('{"error":"limit"}', { status: 429 }));
    responders.get('hy3')(new Response('not-json', { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    responders.get('qwen3.8-flash')(new Response(JSON.stringify({ ok: true, model: 'qwen3.8-flash' }), { status: 200 }));

    const result = await resultPromise;
    assert.equal(result.model, 'qwen3.8-flash');
    assert.equal(result.attempts.length, 2);
    assert.match(result.attempts[0], /glm-5\.3-flash/);
    assert.match(result.attempts[1], /hy3/);

    let authCalls = 0;
    await assert.rejects(() => router.callBaiChatWithFallback({
        apiKey: 'bad-key',
        baseUrl: 'https://api.b.ai/v1',
        buildBody: (model) => ({ model }),
        parseResponse: JSON.parse,
        fetcher: async () => {
            authCalls += 1;
            return new Response('{"error":"invalid key"}', { status: 401 });
        },
    }), /401/);
    assert.equal(authCalls, 3);

    console.log('BAI_CHAT_ROUTER_OK order=3 free_only=1 parallel_race=1 per_model_accounting=1 auth_fast_fail=1');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
