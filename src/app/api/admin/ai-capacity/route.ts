import { NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabaseServer";
import { aiGatewayRouter, resolveGatewayRatePolicy } from "@/lib/aiGatewayRouter";
import { loadAiCredentials } from "@/lib/aiCredentials";
import { loadAiGatewayUsageRolling } from "@/lib/aiGatewayTelemetry";

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

export async function GET() {
    try {
        const [{ data: settingRows }, usage] = await Promise.all([
            supabase.from("bot_settings").select("key,value").in("key", LEGACY_KEYS),
            loadAiGatewayUsageRolling(),
        ]);
        const settings = Object.fromEntries((settingRows || []).map((row: any) => [row.key, row.value || ""]));
        const credentials = await loadAiCredentials(settings);
        const rawRows = usage.rows as any[];

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

        const rows = rawRows.map((row) => {
            const credential = credentials.find((item) => item.id === row.credential_id);
            const policy = resolveGatewayRatePolicy(row.provider, row.model);
            const rpm = configuredLimit(row.provider, "RPM", credential?.limits.rpm);
            const tpm = configuredLimit(row.provider, "TPM", credential?.limits.tpm);
            const rpd = configuredLimit(row.provider, "RPD", credential?.limits.rpd);
            const tpd = configuredLimit(row.provider, "TPD", credential?.limits.tpd);
            const totals = groupTotals.get(`${row.quota_group_id}|${row.model}`)!;
            return {
                provider: row.provider,
                model: row.model,
                credentialId: row.credential_id,
                credentialLabel: credential?.label || row.credential_id || "sem identificação",
                projectId: row.project_id,
                quotaGroupId: row.quota_group_id,
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
                nextMinuteResetEstimate: new Date(Date.now() + 60_000).toISOString(),
                nextDayReset: row.provider === "gemini" ? nextPacificMidnight() : new Date(Date.now() + 86_400_000).toISOString(),
                estimatedCostUsd: Number(row.day_estimated_cost_usd || 0),
                lastEventAt: row.last_event_at,
            };
        });

        return NextResponse.json({
            ready: usage.ready,
            migrationMissing: usage.migrationMissing,
            error: usage.ready ? null : usage.error,
            generatedAt: new Date().toISOString(),
            credentials: credentials.map((credential) => ({
                id: credential.id,
                provider: credential.provider,
                label: credential.label,
                source: credential.source,
                projectId: credential.projectId || null,
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
