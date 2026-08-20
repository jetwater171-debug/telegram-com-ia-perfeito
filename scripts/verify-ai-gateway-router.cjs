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
new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
    require,
    loadedModule,
    loadedModule.exports,
    filename,
    path.dirname(filename),
);

const {
    AdaptiveGatewayRouter,
    GatewayCapacityError,
    classifyGatewayFailure,
    estimateAiTokens,
    resolveGatewayRatePolicy,
} = loadedModule.exports;

const policy = (overrides = {}) => ({
    rpm: 100,
    tpm: 1_000_000,
    rpd: 10_000,
    tpd: 10_000_000,
    maxConcurrency: 5,
    timeoutMs: 10_000,
    maxQueueMs: 0,
    ...overrides,
});
const candidate = (key, weight = 10, overrides = {}, priority) => ({
    key,
    provider: key.split(':')[0],
    model: key.split(':').slice(1).join(':'),
    priority,
    weight,
    policy: policy(overrides),
    value: key,
});

(async () => {
    assert.equal(classifyGatewayFailure(Object.assign(new Error('rate limit'), { status: 429 })), 'quota');
    assert.equal(classifyGatewayFailure(Object.assign(new Error('invalid key'), { status: 401 })), 'auth');
    assert.ok(estimateAiTokens('abcd'.repeat(100)) >= 100);

    const groqInstant = resolveGatewayRatePolicy('groq', 'llama-3.1-8b-instant', {});
    assert.equal(groqInstant.rpm, 30);
    assert.equal(groqInstant.rpd, 14_400);
    const groqQuality = resolveGatewayRatePolicy('groq', 'openai/gpt-oss-20b', {});
    assert.equal(groqQuality.rpd, 1_000);
    const groqOverride = resolveGatewayRatePolicy('groq', 'openai/gpt-oss-20b', { GROQ_GATEWAY_RPM: '17' });
    assert.equal(groqOverride.rpm, 17);
    const nvidia = resolveGatewayRatePolicy('nvidia', 'meta/llama-3.1-8b-instruct', {});
    assert.equal(nvidia.rpm, 20);
    assert.equal(nvidia.maxConcurrency, 4);
    const nvidiaOverride = resolveGatewayRatePolicy('nvidia', 'meta/llama-3.1-8b-instruct', { NVIDIA_GATEWAY_RPM: '11' });
    assert.equal(nvidiaOverride.rpm, 11);
    const geminiQuality = resolveGatewayRatePolicy('gemini', 'gemini-3.7-flash', {});
    assert.equal(geminiQuality.rpd, 20);
    assert.equal(geminiQuality.tpm, 1_000_000);
    const geminiCapacity = resolveGatewayRatePolicy('gemini', 'gemini-3.5-flash-lite', {});
    assert.equal(geminiCapacity.rpd, 500);

    for (let index = 0; index < 128; index += 1) {
        const strictRouter = new AdaptiveGatewayRouter();
        const strictPrimary = candidate('gemini:gemini-3.7-flash', 1, {}, 0);
        const strictSecond = candidate('gemini:gemini-3.6-flash', 100, {}, 1);
        const strictThird = candidate('groq:openai/gpt-oss-120b', 1000, {}, 2);
        const strictLease = await strictRouter.acquire(
            [strictPrimary, strictSecond, strictThird],
            { routingKey: `strict-${index}`, estimatedTokens: 10, maxQueueMs: 0 },
        );
        assert.equal(strictLease.candidate.key, strictPrimary.key, 'lowest numeric priority must always win while ready');
        strictLease.succeed(50);
    }

    const fallbackRouter = new AdaptiveGatewayRouter();
    const first = candidate('primary:model', 20, { maxConcurrency: 1 });
    const second = candidate('fallback:model', 10);
    const firstLease = await fallbackRouter.acquire([first, second], { routingKey: 'sticky-primary', estimatedTokens: 10, maxQueueMs: 0 });
    const occupiedKey = firstLease.candidate.key;
    const nextLease = await fallbackRouter.acquire([first, second], { routingKey: 'sticky-primary', estimatedTokens: 10, maxQueueMs: 0 });
    assert.notEqual(nextLease.candidate.key, occupiedKey, 'second request must use a provider with free concurrency');
    firstLease.succeed(100, 12);
    nextLease.succeed(120, 14);

    const quotaRouter = new AdaptiveGatewayRouter();
    const limited = candidate('limited:model', 100, { rpm: 1 });
    const reserve = candidate('reserve:model', 1);
    const limitedLease = await quotaRouter.acquire([limited, reserve], { routingKey: 'quota-test', estimatedTokens: 5, maxQueueMs: 0 });
    const limitedKey = limitedLease.candidate.key;
    limitedLease.succeed(50);
    const reserveLease = await quotaRouter.acquire([limited, reserve], { routingKey: 'quota-test', estimatedTokens: 5, maxQueueMs: 0 });
    assert.notEqual(reserveLease.candidate.key, limitedKey, 'RPM exhaustion must immediately route to reserve');
    reserveLease.succeed(50);

    const circuitRouter = new AdaptiveGatewayRouter();
    const broken = candidate('broken:model', 100);
    const healthy = candidate('healthy:model', 1);
    const brokenLease = await circuitRouter.acquire([broken, healthy], { routingKey: 'auth-test', estimatedTokens: 5, maxQueueMs: 0 });
    const brokenKey = brokenLease.candidate.key;
    brokenLease.fail(Object.assign(new Error('invalid key'), { status: 401 }), 20);
    const healthyLease = await circuitRouter.acquire([broken, healthy], { routingKey: 'auth-test', estimatedTokens: 5, maxQueueMs: 0 });
    assert.notEqual(healthyLease.candidate.key, brokenKey, 'auth circuit must remove the failing gateway');
    healthyLease.succeed(25);

    const emptyRouter = new AdaptiveGatewayRouter();
    await assert.rejects(
        () => emptyRouter.acquire([], { routingKey: 'empty', estimatedTokens: 1, maxQueueMs: 0 }),
        (error) => error instanceof GatewayCapacityError,
    );

    console.log('AI_GATEWAY_ROUTER_OK adaptive=1 strict_priority=1 concurrency=1 rpm=1 circuit=1 env_limits=1 gemini_quota=1 nvidia=1');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
