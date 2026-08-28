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
    assert.deepEqual(router.resolveBaiTextModelOrder('deepseek-v4-flash-vision-exp'), [
        'deepseek-v4-flash',
        'deepseek-v4-flash-vision-exp',
        'glm-5.3-flash',
        'qwen3.8-flash',
        'mimo-v2.5',
        'hy3',
    ]);

    const calls = [];
    const result = await router.callBaiChatWithFallback({
        apiKey: 'test-key',
        baseUrl: 'https://api.b.ai/v1',
        buildBody: (model) => ({ model }),
        parseResponse: (text) => JSON.parse(text),
        fetcher: async (_url, init) => {
            const model = JSON.parse(init.body).model;
            calls.push(model);
            if (calls.length === 1) return new Response('{"error":"limit"}', { status: 429 });
            if (calls.length === 2) return new Response('not-json', { status: 200 });
            return new Response(JSON.stringify({ ok: true, model }), { status: 200 });
        },
    });
    assert.deepEqual(calls, ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'glm-5.3-flash']);
    assert.equal(result.model, 'glm-5.3-flash');
    assert.equal(result.attempts.length, 2);

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
    assert.equal(authCalls, 1);

    console.log('BAI_CHAT_ROUTER_OK order=6 rate_limit_fallback=1 invalid_response_fallback=1 auth_fast_fail=1');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
