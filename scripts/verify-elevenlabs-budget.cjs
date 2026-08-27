const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/lib/elevenLabsBudget.ts');
const source = fs.readFileSync(filename, 'utf8');
const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
}).outputText;
const loadedModule = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', output)(require, loadedModule, loadedModule.exports, filename, path.dirname(filename));
const budget = loadedModule.exports;

const config = budget.normalizeElevenLabsBudgetConfig({});
assert.equal(config.reservePercent, 20);
assert.equal(config.acquisitionPercent, 10);
assert.equal(config.revenueSharePercent, 5);
assert.equal(config.creditsPerBrl, 1800);
assert.equal(config.freeLeadCredits, 180);

assert.deepEqual(
    budget.calculateLeadVoiceBudget({ totalPaid: 0, config }),
    { budgetCredits: 180, remainingCredits: 180 },
);
assert.deepEqual(
    budget.calculateLeadVoiceBudget({ totalPaid: 20, alreadyUsedCredits: 220, config }),
    { budgetCredits: 1980, remainingCredits: 1760 },
);
assert.equal(budget.buildLeadVoicePolicy({ totalPaid: 0, configuredFrequencyPercent: 18, configuredCooldownMinutes: 30, configuredMaxChars: 300, config }).maxChars, 140);
assert.equal(budget.buildLeadVoicePolicy({ totalPaid: 100, configuredFrequencyPercent: 18, configuredCooldownMinutes: 30, configuredMaxChars: 300, config }).frequencyPercent, 65);
assert.equal(budget.estimateElevenLabsCredits('x'.repeat(100)), 105);

(async () => {
    const subscription = await budget.getElevenLabsSubscription('test', async () => new Response(JSON.stringify({
        tier: 'starter', status: 'active', character_count: 20_000, character_limit: 60_000,
        next_character_count_reset_unix: 1_800_000_000,
    }), { status: 200 }));
    assert.equal(subscription.remainingCredits, 40_000);
    assert.match(subscription.cycleKey, /^2027-/);

    const restricted = await budget.getElevenLabsSubscriptionForBudget({
        apiKey: 'restricted',
        fallback: { remainingCredits: 40_000, cycleKey: 'manual:test:40000' },
        fetcher: async () => new Response(JSON.stringify({ detail: { code: 'unauthorized', status: 'missing_permissions', message: 'missing user_read' } }), { status: 401 }),
    });
    assert.equal(restricted.source, 'local_ledger');
    assert.equal(restricted.remainingCredits, 40_000);
    assert.equal(restricted.cycleKey, 'manual:test:40000');

    let rpcName = '';
    let rpcArgs = null;
    const reservation = await budget.reserveElevenLabsBudget({
        supabase: { rpc: async (name, args) => { rpcName = name; rpcArgs = args; return { data: { allowed: true, reason: 'reserved', reservation_id: 'reservation-1', reserve: 8000 }, error: null }; } },
        sessionId: '00000000-0000-0000-0000-000000000001',
        idempotencyKey: 'one-message-one-audio',
        source: 'requested',
        estimatedCredits: 160,
        subscription,
        config,
    });
    assert.equal(rpcName, 'reserve_elevenlabs_audio_usage');
    assert.equal(rpcArgs.p_cycle_starting_credits, 40_000);
    assert.equal(rpcArgs.p_reserve_percent, 20);
    assert.equal(reservation.allowed, true);
    assert.equal(reservation.reservationId, 'reservation-1');

    const migration = fs.readFileSync(path.resolve(__dirname, '../elevenlabs_voice_budget_migration.sql'), 'utf8');
    assert.match(migration, /idempotency_key TEXT UNIQUE/i);
    assert.match(migration, /pg_advisory_xact_lock/i);
    assert.match(migration, /lead_budget_exhausted/i);
    assert.match(migration, /account_reserve_reached/i);
    assert.match(migration, /settle_elevenlabs_audio_usage/i);
    assert.match(migration, /release_elevenlabs_audio_usage/i);
    assert.match(migration, /TO service_role/i);

    const processSource = fs.readFileSync(path.resolve(__dirname, '../src/app/api/process-message/route.ts'), 'utf8');
    assert.match(processSource, /getElevenLabsSubscription/);
    assert.match(processSource, /reserveElevenLabsBudget/);
    assert.match(processSource, /settleElevenLabsBudget/);
    assert.match(processSource, /releaseElevenLabsBudget/);
    assert.match(processSource, /lariIdentityContext/);

    console.log('ELEVENLABS_BUDGET_OK reserve=20 acquisition=10 revenue=5 atomic=1 idempotent=1 actual_cost=1 lari_voice_agent=1');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
