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

export type AiGatewayTelemetryWriteResult = {
    persisted: boolean;
    migrationMissing: boolean;
    error?: string;
};

export type AiGatewayTelemetryReadResult<T> = {
    ready: boolean;
    migrationMissing: boolean;
    error: string | null;
    rows: T[];
};

const schemaMissing = (error: unknown, relation?: string) => {
    const message = String((error as any)?.message || error || "");
    const escapedRelation = relation?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return /schema cache|does not exist|relation .* does not exist|could not find the table/i.test(message)
        && (!escapedRelation || new RegExp(escapedRelation, "i").test(message) || /schema cache|could not find the table/i.test(message));
};

const nonNegative = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

const FALLBACK_EVENT_PREFIX = "ai_gateway_usage:";

const persistUsageFallback = async (row: Record<string, unknown>) => {
    const occurredAt = new Date().toISOString();
    const key = `${FALLBACK_EVENT_PREFIX}${occurredAt}:${crypto.randomUUID()}`;
    const { error } = await supabase.from("bot_settings").upsert({
        key,
        value: JSON.stringify({ occurred_at: occurredAt, ...row }),
    });
    if (error) throw error;

    // Limpeza probabilística mantém o fallback limitado sem adicionar latência
    // em toda chamada. A tabela dedicada continua sendo o caminho principal.
    if (Math.random() < 0.01) {
        const cutoff = `${FALLBACK_EVENT_PREFIX}${new Date(Date.now() - 30 * 86_400_000).toISOString()}`;
        void supabase.from("bot_settings").delete().like("key", `${FALLBACK_EVENT_PREFIX}%`).lt("key", cutoff);
    }
};

const pacificDayStart = (now = new Date()) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    // Meio-dia UTC evita trocar de data; corrigimos a hora local até meia-noite.
    let candidate = new Date(`${values.year}-${values.month}-${values.day}T08:00:00Z`);
    for (let index = 0; index < 3; index += 1) {
        const hour = Number(new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Los_Angeles", hour: "2-digit", hour12: false,
        }).format(candidate)) % 24;
        candidate = new Date(candidate.getTime() - hour * 3_600_000);
    }
    return candidate.getTime();
};

const loadUsageFallback = async (): Promise<any[]> => {
    const sinceIso = new Date(Date.now() - 24 * 86_400_000).toISOString();
    const { data, error } = await supabase
        .from("bot_settings")
        .select("key,value")
        .like("key", `${FALLBACK_EVENT_PREFIX}%`)
        .gte("key", `${FALLBACK_EVENT_PREFIX}${sinceIso}`)
        .order("key", { ascending: false })
        .limit(5_000);
    if (error) throw error;
    const now = Date.now();
    const minuteStart = now - 60_000;
    const geminiDayStart = pacificDayStart(new Date(now));
    const groups = new Map<string, any>();
    for (const item of data || []) {
        let event: any;
        try { event = JSON.parse(String(item.value || "{}")); } catch { continue; }
        const occurred = Date.parse(String(event.occurred_at || ""));
        if (!Number.isFinite(occurred)) continue;
        const identity = [event.provider, event.model, event.credential_id || "", event.quota_group_id, event.project_id || ""].join("|");
        const row = groups.get(identity) || {
            provider: event.provider,
            model: event.model,
            credential_id: event.credential_id || null,
            quota_group_id: event.quota_group_id,
            project_id: event.project_id || null,
            minute_requests: 0,
            minute_tokens: 0,
            day_requests: 0,
            day_input_tokens: 0,
            day_output_tokens: 0,
            day_reasoning_tokens: 0,
            day_context_tokens: 0,
            day_total_tokens: 0,
            day_estimated_cost_usd: 0,
            successes: 0,
            errors: 0,
            errors_429: 0,
            errors_5xx: 0,
            last_event_at: null,
            cooldown_until: null,
        };
        const requestCount = nonNegative(event.request_count);
        const totalTokens = nonNegative(event.total_tokens);
        if (occurred >= minuteStart) {
            row.minute_requests += event.status === "skipped" ? 0 : requestCount;
            row.minute_tokens += totalTokens;
        }
        const dayStart = event.provider === "gemini" ? geminiDayStart : now - 86_400_000;
        if (occurred >= dayStart) {
            row.day_requests += event.status === "skipped" ? 0 : requestCount;
            row.day_input_tokens += nonNegative(event.input_tokens);
            row.day_output_tokens += nonNegative(event.output_tokens);
            row.day_reasoning_tokens += nonNegative(event.reasoning_tokens);
            row.day_context_tokens += nonNegative(event.context_tokens);
            row.day_total_tokens += totalTokens;
            row.day_estimated_cost_usd += Number(event.estimated_cost_usd || 0);
            if (event.status === "success") row.successes += 1;
            if (event.status === "error") row.errors += 1;
            if (Number(event.http_status) === 429) row.errors_429 += 1;
            if (Number(event.http_status) >= 500 && Number(event.http_status) <= 599) row.errors_5xx += 1;
        }
        if (!row.last_event_at || occurred > Date.parse(row.last_event_at)) row.last_event_at = event.occurred_at;
        if (event.cooldown_until && (!row.cooldown_until || Date.parse(event.cooldown_until) > Date.parse(row.cooldown_until))) {
            row.cooldown_until = event.cooldown_until;
        }
        groups.set(identity, row);
    }
    return [...groups.values()];
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

export const persistAiGatewayUsage = async (event: AiGatewayUsageEvent): Promise<AiGatewayTelemetryWriteResult> => {
    const inputTokens = nonNegative(event.inputTokens);
    const outputTokens = nonNegative(event.outputTokens);
    const reasoningTokens = nonNegative(event.reasoningTokens);
    const totalTokens = nonNegative(event.totalTokens) || inputTokens + outputTokens;
    const row = {
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
    };
    const { error } = await supabase.from("ai_gateway_usage_events").insert(row);
    if (!error) return { persisted: true, migrationMissing: false };

    if (schemaMissing(error, "ai_gateway_usage_events")) {
        // Telemetria não pode derrubar uma resposta ao lead. Porém, não escondemos
        // mais esse problema: o endpoint administrativo expõe o diagnóstico e o
        // log permite encontrá-lo no runtime.
        const message = String(error.message || "ai_gateway_usage_events indisponível");
        console.warn("AI_GATEWAY_TELEMETRY_MIGRATION_REQUIRED", { message });
        try {
            await persistUsageFallback(row);
            return { persisted: true, migrationMissing: true, error: message };
        } catch (fallbackError: any) {
            return { persisted: false, migrationMissing: true, error: `${message}; fallback: ${fallbackError?.message || fallbackError}` };
        }
    }
    throw error;
};

export const loadAiGatewayUsageRolling = async (): Promise<AiGatewayTelemetryReadResult<any>> => {
    const { data, error } = await supabase
        .from("ai_gateway_usage_rolling")
        .select("*")
        .order("errors", { ascending: false })
        .order("day_requests", { ascending: false });
    if (error) {
        const migrationMissing = schemaMissing(error, "ai_gateway_usage_rolling");
        if (migrationMissing) {
            try {
                const rows = await loadUsageFallback();
                return {
                    ready: true,
                    migrationMissing: true,
                    error: "Usando telemetria compatível em bot_settings; instale ai_gateway_v2_migration.sql para maior escala.",
                    rows,
                };
            } catch (fallbackError: any) {
                return { ready: false, migrationMissing: true, error: String(fallbackError?.message || fallbackError), rows: [] };
            }
        }
        return { ready: false, migrationMissing, error: String(error.message || "erro ao ler telemetria"), rows: [] };
    }
    return { ready: true, migrationMissing: false, error: null, rows: data || [] };
};

export const loadAiGatewayCapacityBuckets = async (): Promise<AiGatewayTelemetryReadResult<any>> => {
    const { data, error } = await supabase
        .from("ai_gateway_capacity")
        .select("bucket_key,minute_started_at,minute_requests,minute_tokens,day_started_at,day_requests,day_tokens,updated_at");
    if (error) {
        const migrationMissing = schemaMissing(error, "ai_gateway_capacity");
        return { ready: false, migrationMissing, error: String(error.message || "erro ao ler capacidade"), rows: [] };
    }
    return { ready: true, migrationMissing: false, error: null, rows: data || [] };
};
