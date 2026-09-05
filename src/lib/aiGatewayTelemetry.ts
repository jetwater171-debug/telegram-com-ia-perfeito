import { supabaseServer as supabase } from "@/lib/supabaseServer";

export type AiGatewayUsageEvent = {
    provider: string;
    model: string;
    credentialId?: string;
    quotaGroupId: string;
    projectId?: string;
    role?: string;
    tier?: string;
    // attempt/retry carregam request_count. success/error representam o
    // desfecho daquela tentativa e não duplicam RPM/RPD nas somas.
    status: "attempt" | "retry" | "success" | "error" | "skipped";
    durationMs?: number;
    requestCount?: number;
    estimatedInputTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    contextTokens?: number;
    totalTokens?: number;
    inputCostPerMillion?: number;
    outputCostPerMillion?: number;
    httpStatus?: number;
    errorKind?: string;
    errorMessage?: string;
    cooldownUntil?: string;
    providerRequestId?: string;
    metadata?: Record<string, unknown>;
};

const nonNegative = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

export const estimateAiGatewayCost = ({
    inputTokens,
    outputTokens,
    inputCostPerMillion,
    outputCostPerMillion,
}: Pick<AiGatewayUsageEvent, "inputTokens" | "outputTokens" | "inputCostPerMillion" | "outputCostPerMillion">) => {
    const inputCost = Number(inputCostPerMillion || 0) * nonNegative(inputTokens) / 1_000_000;
    const outputCost = Number(outputCostPerMillion || 0) * nonNegative(outputTokens) / 1_000_000;
    return Math.max(0, inputCost + outputCost);
};

export const persistAiGatewayUsage = async (event: AiGatewayUsageEvent) => {
    const inputTokens = nonNegative(event.inputTokens);
    const outputTokens = nonNegative(event.outputTokens);
    const reasoningTokens = nonNegative(event.reasoningTokens);
    const totalTokens = nonNegative(event.totalTokens) || inputTokens + outputTokens;
    const { error } = await supabase.from("ai_gateway_usage_events").insert({
        provider: String(event.provider || "unknown").slice(0, 80),
        model: String(event.model || "unknown").slice(0, 300),
        credential_id: event.credentialId ? String(event.credentialId).slice(0, 160) : null,
        quota_group_id: String(event.quotaGroupId || `${event.provider}:unassigned`).slice(0, 240),
        project_id: event.projectId ? String(event.projectId).slice(0, 180) : null,
        role: event.role ? String(event.role).slice(0, 40) : null,
        tier: event.tier ? String(event.tier).slice(0, 40) : null,
        status: event.status,
        request_count: event.status === "attempt" || event.status === "retry"
            ? Math.max(1, nonNegative(event.requestCount) || 1)
            : nonNegative(event.requestCount),
        duration_ms: nonNegative(event.durationMs),
        estimated_input_tokens: nonNegative(event.estimatedInputTokens),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        reasoning_tokens: reasoningTokens,
        context_tokens: nonNegative(event.contextTokens) || inputTokens,
        total_tokens: totalTokens,
        estimated_cost_usd: estimateAiGatewayCost({
            inputTokens,
            outputTokens,
            inputCostPerMillion: event.inputCostPerMillion,
            outputCostPerMillion: event.outputCostPerMillion,
        }),
        http_status: event.httpStatus || null,
        error_kind: event.errorKind ? String(event.errorKind).slice(0, 80) : null,
        error_message: event.errorMessage ? String(event.errorMessage).slice(0, 700) : null,
        cooldown_until: event.cooldownUntil || null,
        provider_request_id: event.providerRequestId ? String(event.providerRequestId).slice(0, 240) : null,
        metadata: event.metadata || {},
    });
    if (error && !/ai_gateway_usage_events|schema cache|does not exist/i.test(String(error.message || ""))) {
        throw error;
    }
};

export const loadAiGatewayUsageRolling = async () => {
    const { data, error } = await supabase
        .from("ai_gateway_usage_rolling")
        .select("*")
        .order("errors", { ascending: false })
        .order("day_requests", { ascending: false });
    if (error) {
        const migrationMissing = /ai_gateway_usage_rolling|schema cache|does not exist/i.test(String(error.message || ""));
        return { ready: false, migrationMissing, error: error.message, rows: [] as any[] };
    }
    return { ready: true, migrationMissing: false, rows: data || [] };
};

export const loadAiGatewayCapacityBuckets = async () => {
    const { data, error } = await supabase
        .from("ai_gateway_capacity")
        .select("bucket_key,minute_started_at,minute_requests,minute_tokens,day_started_at,day_requests,day_tokens,updated_at");
    if (error) {
        const migrationMissing = /ai_gateway_capacity|schema cache|does not exist/i.test(String(error.message || ""));
        return { ready: false, migrationMissing, error: error.message, rows: [] as any[] };
    }
    return { ready: true, migrationMissing: false, rows: data || [] };
};
