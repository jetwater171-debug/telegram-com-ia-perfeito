const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/lib/processMessageRetry.ts');
const source = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
}).outputText;
const loadedModule = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
    require, loadedModule, loadedModule.exports, filename, path.dirname(filename),
);

const { triggerProcessMessageWithRetry } = loadedModule.exports;
assert.equal(typeof triggerProcessMessageWithRetry, 'function');

const run = async (responses, expected) => {
    const calls = [];
    const sleeps = [];
    let index = 0;
    const result = await triggerProcessMessageWithRetry({
        workerUrl: 'https://example.test/api/process-message',
        sessionId: 'session-123',
        triggerMessageId: 'message-456',
        fetchImpl: async (url, init) => {
            calls.push({ url, init, body: JSON.parse(init.body) });
            const response = responses[index++];
            if (response instanceof Error) throw response;
            return response;
        },
        sleepImpl: async (ms) => sleeps.push(ms),
    });
    assert.equal(calls.length, expected.calls);
    assert.deepEqual(sleeps, expected.sleeps || []);
    for (const call of calls) {
        assert.deepEqual(call.body, { sessionId: 'session-123', triggerMessageId: 'message-456' });
    }
    return result;
};

const retryable503 = () => new Response(JSON.stringify({
    success: false,
    error: 'ai_response_unavailable',
    retryable: true,
}), { status: 503 });
const ok = (body = { success: true }) => new Response(JSON.stringify(body), { status: 200 });

(async () => {
    await run([retryable503(), ok()], { calls: 2, sleeps: [1_000] });
    await run([ok({ retryable: true }), ok()], { calls: 1 });
    await run([new Response(JSON.stringify({ retryable: false }), { status: 503 })], { calls: 1 });
    await run([new Response('not-json', { status: 503 })], { calls: 1 });
    const uncertain = await run([new Error('fetch timeout')], { calls: 1 });
    assert.equal(uncertain.uncertain, true);
    const capped = await run([retryable503(), retryable503()], { calls: 2, sleeps: [1_000] });
    assert.equal(capped.retried, true);

    console.log('TELEGRAM_WORKER_RETRY_OK', JSON.stringify({ cases: 6, maxAttempts: capped.attempts }));
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
