const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/lib/aiGatewayRouter.ts');
const source = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
}).outputText;
const loadedModule = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(require, loadedModule, loadedModule.exports, filename, path.dirname(filename));
const { AdaptiveGatewayRouter } = loadedModule.exports;

const policies = {
    gemini: { rpm: 10, tpm: 250_000, rpd: 1_000, tpd: 4_000_000, maxConcurrency: 6, timeoutMs: 12_000, maxQueueMs: 500 },
    groq: { rpm: 30, tpm: 6_000, rpd: 14_400, tpd: 500_000, maxConcurrency: 4, timeoutMs: 14_000, maxQueueMs: 500 },
    cloudflare: { rpm: 30, tpm: 300_000, rpd: 5_000, tpd: 5_000_000, maxConcurrency: 6, timeoutMs: 16_000, maxQueueMs: 500 },
    mistral: { rpm: 10, tpm: 100_000, rpd: 2_000, tpd: 2_000_000, maxConcurrency: 4, timeoutMs: 17_000, maxQueueMs: 500 },
    openrouter: { rpm: 18, tpm: 200_000, rpd: 50, tpd: 2_000_000, maxConcurrency: 3, timeoutMs: 18_000, maxQueueMs: 500 },
    cerebras: { rpm: 5, tpm: 30_000, rpd: 1_000, tpd: 1_000_000, maxConcurrency: 2, timeoutMs: 12_000, maxQueueMs: 500 },
};
const weights = { gemini: 57, groq: 18, cloudflare: 12, mistral: 8, openrouter: 5, cerebras: 4 };
const candidates = Object.keys(policies).map((provider) => ({
    key: `${provider}:load-model`,
    provider,
    model: 'load-model',
    weight: weights[provider],
    policy: policies[provider],
    value: provider,
}));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
    const router = new AdaptiveGatewayRouter();
    const distribution = {};
    const queueWaits = [];
    const failures = [];
    await Promise.all(Array.from({ length: 30 }, async (_, index) => {
        try {
            const lease = await router.acquire(candidates, {
                routingKey: `lead-${index + 1}`,
                estimatedTokens: 1_200,
                maxQueueMs: 500,
            });
            distribution[lease.candidate.provider] = Number(distribution[lease.candidate.provider] || 0) + 1;
            queueWaits.push(lease.queueWaitMs);
            await wait(30 + (index % 5) * 10);
            lease.succeed(30 + (index % 5) * 10, 1_050);
        } catch (error) {
            failures.push(String(error?.message || error));
        }
    }));

    assert.equal(failures.length, 0);
    assert.equal(Object.values(distribution).reduce((sum, value) => sum + value, 0), 30);
    assert.ok(Object.keys(distribution).length >= 3, 'traffic must be distributed across at least three providers');
    console.log(`AI_GATEWAY_LOAD_OK leads=30 failures=0 providers=${JSON.stringify(distribution)} max_queue_ms=${Math.max(...queueWaits)}`);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
