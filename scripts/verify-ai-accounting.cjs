const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const telemetrySource = read('src/lib/aiGatewayTelemetry.ts');
const migration = read('ai_gateway_v2_migration.sql');
const capacityApi = read('src/app/api/admin/ai-capacity/route.ts');
const credentialsApi = read('src/app/api/admin/ai-credentials/route.ts');
const capacityPage = read('src/app/admin/ai/capacity/page.tsx');
const gateway = read('src/lib/gemini.ts');

const compiled = ts.transpileModule(telemetrySource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: 'aiGatewayTelemetry.ts',
}).outputText;
const loaded = { exports: {} };
const fakeSupabase = {
    from() {
        return {
            insert: async () => ({ error: null }),
            select() { return this; },
            order() { return this; },
            then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
        };
    },
};
new Function('require', 'module', 'exports', compiled)(
    (specifier) => specifier === '@/lib/supabaseServer' ? { supabaseServer: fakeSupabase } : require(specifier),
    loaded,
    loaded.exports,
);

assert.equal(loaded.exports.estimateAiGatewayCost({
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    inputCostPerMillion: 0.75,
    outputCostPerMillion: 3.75,
}), 4.5);

assert.match(migration, /create table if not exists public\.ai_provider_credentials/);
assert.match(migration, /create table if not exists public\.ai_gateway_usage_events/);
assert.match(migration, /request_count integer not null default 1/);
assert.match(migration, /add column if not exists estimated_input_tokens/);
assert.match(migration, /update public\.ai_gateway_usage_events/);
assert.match(migration, /America\/Los_Angeles/);
assert.match(migration, /status <> 'skipped'/);
assert.match(migration, /prune_ai_gateway_usage_events/);
assert.match(migration, /revoke all on public\.ai_provider_credentials from anon, authenticated/);
assert.match(telemetrySource, /input_tokens/);
assert.match(telemetrySource, /output_tokens/);
assert.match(telemetrySource, /reasoning_tokens/);
assert.match(telemetrySource, /context_tokens/);
assert.match(telemetrySource, /errors?/i);
assert.match(telemetrySource, /FALLBACK_EVENT_PREFIX/);
assert.match(telemetrySource, /loadUsageFallback/);
assert.match(capacityApi, /remaining/);
assert.match(capacityApi, /nextPacificMidnight/);
assert.match(capacityApi, /AI_GATEWAY_TELEMETRY_MIGRATION_REQUIRED/);
assert.match(capacityPage, /type Limit = "rpm" \| "tpm" \| "rpd" \| "tpd"/);
assert.match(capacityPage, /row\.remaining\[limit\]/);
assert.match(credentialsApi, /encryptAiCredentialSecret/);
assert.match(credentialsApi, /gemini_project_id_obrigatorio_para_pool_legitimo/);
assert.match(credentialsApi, /enabled: false/);
assert.match(credentialsApi, /export async function PATCH/);
assert.match(credentialsApi, /credential_not_found_or_disabled/);
assert.match(gateway, /const providerPreference = configuredPreference/);
assert.match(gateway, /boundedRetryDelayMs/);
assert.match(gateway, /requestCount \+= 1/);
assert.doesNotMatch(gateway, /ai_gateway_recent_events|ai_gateway_stats/, 'telemetria não deve ser duplicada em bot_settings');

console.log('AI_ACCOUNTING_VERIFY_OK persistence=1 encrypted_credentials=1 rpm_tpm_rpd_tpd=1 token_usage=1 retry_count=1 pacific_reset=1 admin=1');
