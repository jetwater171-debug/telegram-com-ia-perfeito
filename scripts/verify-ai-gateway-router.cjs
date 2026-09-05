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

    const groqQuality = resolveGatewayRatePolicy('groq', 'openai/gpt-oss-120b', {});
    assert.ok(groqQuality.rpm >= 1_000_000, 'quota desconhecida não pode inventar um teto baixo');
    const groqOverride = resolveGatewayRatePolicy('groq', 'openai/gpt-oss-120b', { GROQ_GATEWAY_RPM: '17' });
    assert.equal(groqOverride.rpm, 17);
    const nvidia = resolveGatewayRatePolicy('nvidia', 'deepseek-ai/deepseek-v4-pro-0813', {});
    assert.ok(nvidia.rpm >= 1_000_000);
    assert.equal(nvidia.maxConcurrency, 4);
    const nvidiaOverride = resolveGatewayRatePolicy('nvidia', 'deepseek-ai/deepseek-v4-pro-0813', { NVIDIA_GATEWAY_RPM: '11' });
    assert.equal(nvidiaOverride.rpm, 11);
    const geminiQuality = resolveGatewayRatePolicy('gemini', 'gemini-3.8-flash', {});
    assert.ok(geminiQuality.rpd >= 1_000_000);
    assert.ok(geminiQuality.tpm >= 1_000_000_000);
    const bai = resolveGatewayRatePolicy('bai', 'deepseek-v4-flash', {});
    assert.ok(bai.rpm >= 1_000_000);
    assert.equal(bai.maxConcurrency, 12);
    assert.ok(bai.tpm >= 1_000_000_000);
    const baiOverride = resolveGatewayRatePolicy('bai', 'deepseek-v4-flash', { BAI_GATEWAY_CONCURRENCY: '7' });
    assert.equal(baiOverride.maxConcurrency, 7);

    for (let index = 0; index < 128; index += 1) {
        const strictRouter = new AdaptiveGatewayRouter();
        const strictPrimary = candidate('gemini:gemini-3.8-flash', 1, {}, 0);
        const strictSecond = candidate('gemini:gemini-3.7-flash', 100, {}, 1);
        const strictThird = candidate('groq:openai/gpt-oss-120b', 1000, {}, 2);
        const strictLease = await strictRouter.acquire(
            [strictPrimary, strictSecond, strictThird],
            { routingKey: `strict-${index}`, estimatedTokens: 10, maxQueueMs: 0 },
        );
        assert.equal(strictLease.candidate.key, strictPrimary.key, 'lowest numeric priority must always win while ready');
        strictLease.succeed(50);
    }

    const baiFallbackRouter = new AdaptiveGatewayRouter();
    const baiOrder = [
        'glm-5.3-flash',
        'qwen3.8-flash',
        'hy3',
    ].map((model, priority) => candidate(`bai:${model}`, 60 - priority * 6, {}, priority));
    const baiPrimaryLease = await baiFallbackRouter.acquire(baiOrder, { routingKey: 'bai-chain', estimatedTokens: 10, maxQueueMs: 0 });
    assert.equal(baiPrimaryLease.candidate.model, 'glm-5.3-flash');
    const baiPrimaryKey = baiPrimaryLease.candidate.key;
    baiPrimaryLease.fail(Object.assign(new Error('rate limit'), { status: 429 }), 30);
    const baiFallbackLease = await baiFallbackRouter.acquire(baiOrder, { routingKey: 'bai-chain', estimatedTokens: 10, maxQueueMs: 0, exclude: new Set([baiPrimaryKey]) });
    assert.equal(baiFallbackLease.candidate.model, 'qwen3.8-flash');
    baiFallbackLease.succeed(35);

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

    const retryRouter = new AdaptiveGatewayRouter();
    const retryLease = await retryRouter.acquire([candidate('gemini:retry')], { routingKey: 'retry', estimatedTokens: 25, maxQueueMs: 0 });
    retryLease.recordRetry(25);
    retryLease.succeed(30, 25);
    const retrySnapshot = retryRouter.snapshot().find((item) => item.key === 'gemini:retry');
    assert.equal(retrySnapshot.minuteRequests, 2, 'retry deve consumir outra unidade de RPM');
    assert.equal(retrySnapshot.minuteTokens, 50, 'retry deve reservar tokens novamente');

    const emptyRouter = new AdaptiveGatewayRouter();
    await assert.rejects(
        () => emptyRouter.acquire([], { routingKey: 'empty', estimatedTokens: 1, maxQueueMs: 0 }),
        (error) => error instanceof GatewayCapacityError,
    );

    console.log('AI_GATEWAY_ROUTER_OK adaptive=1 strict_priority=1 bai_chain=3 bai_free_only=1 bai_failover=1 concurrency=1 rpm=1 circuit=1 env_limits=1 unknown_quota_nonblocking=1 retry_accounting=1');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
