import { NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabaseServer";
import { aiGatewayRouter, resolveGatewayRatePolicy } from "@/lib/aiGatewayRouter";
import { loadAiCredentials } from "@/lib/aiCredentials";
import { loadAiGatewayCapacityBuckets, loadAiGatewayUsageRolling } from "@/lib/aiGatewayTelemetry";

export const dynamic = "force-dynamic";

const LEGACY_KEYS = [
    "bai_api_key", "gemini_api_key", "groq_api_key", "nvidia_api_key",
    "cloudflare_ai_api_token", "mistral_api_key", "openrouter_api_key",
    "cerebras_api_key", "ai_custom_gateway_api_key",
];

const nextPacificMidnight = () => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(now);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const noonUtc = new Date(`${value.year}-${value.month}-${value.day}T12:00:00Z`);
    noonUtc.setUTCDate(noonUtc.getUTCDate() + 1);
    // Resolve midnight despite DST by iteratively matching Los Angeles local time.
    let candidate = new Date(Date.UTC(noonUtc.getUTCFullYear(), noonUtc.getUTCMonth(), noonUtc.getUTCDate(), 8));
    for (let index = 0; index < 3; index += 1) {
        const localHour = Number(new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Los_Angeles",
            hour: "2-digit",
            hour12: false,
        }).format(candidate)) % 24;
        candidate = new Date(candidate.getTime() - localHour * 60 * 60_000);
    }
    return candidate.toISOString();
};

const configuredLimit = (provider: string, suffix: string, credentialValue: unknown) => {
    const direct = Number(credentialValue);
    if (Number.isFinite(direct) && direct > 0) return { known: true, value: direct, source: "credential" };
    const envKey = `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_GATEWAY_${suffix}`;
    const envValue = Number(process.env[envKey]);
    if (Number.isFinite(envValue) && envValue > 0) return { known: true, value: envValue, source: "environment" };
    return { known: false, value: null, source: "operational_default" };
};

const isSamePacificDay = (value: string | null | undefined, now = new Date()) => {
    if (!value) return false;
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
    });
    return formatter.format(new Date(value)) === formatter.format(now);
};

const bucketUsage = (bucket: any, provider: string) => {
    const now = Date.now();
    const minuteStarted = Date.parse(String(bucket?.minute_started_at || ""));
    const dayStarted = Date.parse(String(bucket?.day_started_at || ""));
    const minuteActive = Number.isFinite(minuteStarted) && now - minuteStarted < 60_000;
    const dayActive = provider === "gemini"
        ? isSamePacificDay(bucket?.day_started_at)
        : Number.isFinite(dayStarted) && now - dayStarted < 86_400_000;
    return {
        minuteRequests: minuteActive ? Number(bucket?.minute_requests || 0) : 0,
        minuteTokens: minuteActive ? Number(bucket?.minute_tokens || 0) : 0,
        dayRequests: dayActive ? Number(bucket?.day_requests || 0) : 0,
        dayTokens: dayActive ? Number(bucket?.day_tokens || 0) : 0,
        nextMinuteReset: minuteActive ? new Date(minuteStarted + 60_000).toISOString() : new Date().toISOString(),
        nextDayReset: provider === "gemini"
            ? nextPacificMidnight()
            : dayActive ? new Date(dayStarted + 86_400_000).toISOString() : new Date().toISOString(),
    };
};

export async function GET() {
    try {
        const [{ data: settingRows }, usage, capacity] = await Promise.all([
            supabase.from("bot_settings").select("key,value").in("key", LEGACY_KEYS),
            loadAiGatewayUsageRolling(),
            loadAiGatewayCapacityBuckets(),
        ]);
        const settings = Object.fromEntries((settingRows || []).map((row: any) => [row.key, row.value || ""]));
        const credentials = await loadAiCredentials(settings);
        const rawRows = usage.rows as any[];
        const displayRows = [...rawRows];
        const displayed = new Set(rawRows.map((row) => `${row.provider}|${row.model}|${row.credential_id || ""}|${row.quota_group_id}`));
        for (const credential of credentials) {
            const models = new Set(rawRows
                .filter((row) => row.credential_id === credential.id)
                .map((row) => String(row.model || "")));
            if (credential.model) models.add(credential.model);
            if (models.size === 0) models.add("(default)");
            for (const model of models) {
                const identity = `${credential.provider}|${model}|${credential.id}|${credential.quotaGroupId}`;
                if (displayed.has(identity)) continue;
                displayed.add(identity);
                displayRows.push({
                    provider: credential.provider,
                    model,
                    credential_id: credential.id,
                    quota_group_id: credential.quotaGroupId,
                    project_id: credential.projectId || null,
                });
            }
        }
        const capacityByBucket = new Map((capacity.rows as any[]).map((bucket) => [String(bucket.bucket_key), bucket]));

        const groupTotals = new Map<string, { minuteRequests: number; minuteTokens: number; dayRequests: number; dayTokens: number }>();
        for (const row of rawRows) {
            const key = `${row.quota_group_id}|${row.model}`;
            const current = groupTotals.get(key) || { minuteRequests: 0, minuteTokens: 0, dayRequests: 0, dayTokens: 0 };
            current.minuteRequests += Number(row.minute_requests || 0);
            current.minuteTokens += Number(row.minute_tokens || 0);
            current.dayRequests += Number(row.day_requests || 0);
            current.dayTokens += Number(row.day_total_tokens || 0);
            groupTotals.set(key, current);
        }

        const rows = displayRows.map((row) => {
            const credential = credentials.find((item) => item.id === row.credential_id);
            const policy = resolveGatewayRatePolicy(row.provider, row.model);
            const rpm = configuredLimit(row.provider, "RPM", credential?.limits.rpm);
            const tpm = configuredLimit(row.provider, "TPM", credential?.limits.tpm);
            const rpd = configuredLimit(row.provider, "RPD", credential?.limits.rpd);
            const tpd = configuredLimit(row.provider, "TPD", credential?.limits.tpd);
            const eventTotals = groupTotals.get(`${row.quota_group_id}|${row.model}`) || { minuteRequests: 0, minuteTokens: 0, dayRequests: 0, dayTokens: 0 };
            const bucket = capacityByBucket.get(`${row.quota_group_id}:${row.model}`);
            const authoritativeBucketUsage = capacity.ready && bucket ? bucketUsage(bucket, row.provider) : null;
            const totals = authoritativeBucketUsage || eventTotals;
            return {
                provider: row.provider,
                model: row.model,
                credentialId: row.credential_id,
                credentialLabel: credential?.label || row.credential_id || "sem identificação",
                projectId: row.project_id,
                quotaGroupId: row.quota_group_id,
                capacitySource: capacity.ready && bucket ? "shared_bucket" : "usage_events",
                used: {
                    rpm: totals.minuteRequests,
                    tpm: totals.minuteTokens,
                    rpd: totals.dayRequests,
                    tpd: totals.dayTokens,
                    inputTokens: Number(row.day_input_tokens || 0),
                    outputTokens: Number(row.day_output_tokens || 0),
                    reasoningTokens: Number(row.day_reasoning_tokens || 0),
                    contextTokens: Number(row.day_context_tokens || 0),
                },
                limits: {
                    rpm: rpm.known ? rpm.value : null,
                    tpm: tpm.known ? tpm.value : null,
                    rpd: rpd.known ? rpd.value : null,
                    tpd: tpd.known ? tpd.value : null,
                    operationalFallback: policy,
                    source: rpm.known || tpm.known || rpd.known || tpd.known ? "configured" : "not_published",
                },
                remaining: {
                    rpm: rpm.known ? Math.max(0, Number(rpm.value) - totals.minuteRequests) : null,
                    tpm: tpm.known ? Math.max(0, Number(tpm.value) - totals.minuteTokens) : null,
                    rpd: rpd.known ? Math.max(0, Number(rpd.value) - totals.dayRequests) : null,
                    tpd: tpd.known ? Math.max(0, Number(tpd.value) - totals.dayTokens) : null,
                },
                successes: Number(row.successes || 0),
                errors: Number(row.errors || 0),
                errors429: Number(row.errors_429 || 0),
                errors5xx: Number(row.errors_5xx || 0),
                cooldownUntil: row.cooldown_until,
                nextMinuteResetEstimate: authoritativeBucketUsage?.nextMinuteReset || new Date(Date.now() + 60_000).toISOString(),
                nextDayReset: authoritativeBucketUsage?.nextDayReset || (row.provider === "gemini" ? nextPacificMidnight() : new Date(Date.now() + 86_400_000).toISOString()),
                estimatedCostUsd: Number(row.day_estimated_cost_usd || 0),
                lastEventAt: row.last_event_at,
            };
        });

        return NextResponse.json({
            ready: usage.ready,
            migrationMissing: usage.migrationMissing,
            error: usage.ready ? null : usage.error,
            capacityReady: capacity.ready,
            capacityMigrationMissing: capacity.migrationMissing,
            generatedAt: new Date().toISOString(),
            credentials: credentials.map((credential) => ({
                id: credential.id,
                provider: credential.provider,
                label: credential.label,
                source: credential.source,
                projectId: credential.projectId || null,
                accountId: credential.accountId || null,
                quotaGroupId: credential.quotaGroupId,
                model: credential.model || null,
                limits: credential.limits,
            })),
            rows,
            runtimeSnapshot: aiGatewayRouter.snapshot(),
        });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "erro" }, { status: 500 });
    }
}
