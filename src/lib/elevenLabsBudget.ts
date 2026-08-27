export type ElevenLabsBudgetConfig = {
    enabled: boolean;
    reservePercent: number;
    acquisitionPercent: number;
    revenueSharePercent: number;
    creditsPerBrl: number;
    freeLeadCredits: number;
    unpaidMaxChars: number;
    buyerMaxChars: number;
};

export type ElevenLabsSubscriptionSnapshot = {
    tier: string;
    status: string;
    usedCredits: number;
    limitCredits: number;
    remainingCredits: number;
    resetAt: string | null;
    cycleKey: string;
    source?: 'live' | 'local_ledger';
};

export type ElevenLabsSubscriptionFallback = {
    remainingCredits: number;
    cycleKey: string;
};

export type VoiceBudgetReservation = {
    allowed: boolean;
    reason: string;
    reservationId: string;
    leadBudget?: number;
    leadRemainingAfter?: number;
    globalRemainingAfter?: number;
    reserve?: number;
};

export const DEFAULT_ELEVENLABS_BUDGET: ElevenLabsBudgetConfig = {
    enabled: true,
    reservePercent: 20,
    acquisitionPercent: 10,
    revenueSharePercent: 5,
    creditsPerBrl: 1800,
    freeLeadCredits: 180,
    unpaidMaxChars: 140,
    buyerMaxChars: 300,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const normalizeElevenLabsBudgetConfig = (input: Partial<ElevenLabsBudgetConfig>): ElevenLabsBudgetConfig => {
    const reservePercent = clamp(finite(input.reservePercent, DEFAULT_ELEVENLABS_BUDGET.reservePercent), 5, 50);
    const acquisitionPercent = clamp(
        finite(input.acquisitionPercent, DEFAULT_ELEVENLABS_BUDGET.acquisitionPercent),
        0,
        Math.max(0, 90 - reservePercent),
    );
    return {
        enabled: input.enabled !== false,
        reservePercent,
        acquisitionPercent,
        revenueSharePercent: clamp(finite(input.revenueSharePercent, DEFAULT_ELEVENLABS_BUDGET.revenueSharePercent), 0.5, 20),
        creditsPerBrl: clamp(finite(input.creditsPerBrl, DEFAULT_ELEVENLABS_BUDGET.creditsPerBrl), 1, 100_000),
        freeLeadCredits: Math.round(clamp(finite(input.freeLeadCredits, DEFAULT_ELEVENLABS_BUDGET.freeLeadCredits), 0, 2_000)),
        unpaidMaxChars: Math.round(clamp(finite(input.unpaidMaxChars, DEFAULT_ELEVENLABS_BUDGET.unpaidMaxChars), 60, 220)),
        buyerMaxChars: Math.round(clamp(finite(input.buyerMaxChars, DEFAULT_ELEVENLABS_BUDGET.buyerMaxChars), 100, 500)),
    };
};

export const calculateLeadVoiceBudget = ({
    totalPaid,
    alreadyUsedCredits = 0,
    config,
}: {
    totalPaid: number;
    alreadyUsedCredits?: number;
    config: ElevenLabsBudgetConfig;
}) => {
    const paid = Math.max(0, finite(totalPaid, 0));
    const budgetCredits = Math.max(0, Math.floor(
        config.freeLeadCredits + paid * (config.revenueSharePercent / 100) * config.creditsPerBrl,
    ));
    return {
        budgetCredits,
        remainingCredits: Math.max(0, budgetCredits - Math.max(0, Math.floor(alreadyUsedCredits))),
    };
};

export const buildLeadVoicePolicy = ({
    totalPaid,
    configuredFrequencyPercent,
    configuredCooldownMinutes,
    configuredMaxChars,
    config,
}: {
    totalPaid: number;
    configuredFrequencyPercent: number;
    configuredCooldownMinutes: number;
    configuredMaxChars: number;
    config: ElevenLabsBudgetConfig;
}) => {
    const paid = Math.max(0, finite(totalPaid, 0));
    if (paid <= 0) {
        return {
            tier: 'acquisition' as const,
            frequencyPercent: Math.min(8, configuredFrequencyPercent),
            cooldownMinutes: Math.max(1_440, configuredCooldownMinutes),
            maxChars: Math.min(config.unpaidMaxChars, configuredMaxChars),
        };
    }
    if (paid < 20) {
        return {
            tier: 'buyer' as const,
            frequencyPercent: Math.max(25, configuredFrequencyPercent),
            cooldownMinutes: Math.max(90, configuredCooldownMinutes),
            maxChars: Math.min(180, config.buyerMaxChars, configuredMaxChars),
        };
    }
    if (paid < 50) {
        return {
            tier: 'buyer' as const,
            frequencyPercent: Math.max(35, configuredFrequencyPercent),
            cooldownMinutes: Math.max(60, configuredCooldownMinutes),
            maxChars: Math.min(220, config.buyerMaxChars, configuredMaxChars),
        };
    }
    if (paid < 100) {
        return {
            tier: 'buyer' as const,
            frequencyPercent: Math.max(50, configuredFrequencyPercent),
            cooldownMinutes: Math.max(40, configuredCooldownMinutes),
            maxChars: Math.min(260, config.buyerMaxChars, configuredMaxChars),
        };
    }
    return {
        tier: 'buyer' as const,
        frequencyPercent: Math.max(65, configuredFrequencyPercent),
        cooldownMinutes: Math.max(30, configuredCooldownMinutes),
        maxChars: Math.min(config.buyerMaxChars, configuredMaxChars),
    };
};

export const estimateElevenLabsCredits = (performanceScript: string) =>
    Math.max(1, Math.ceil(String(performanceScript || '').length * 1.05));

export const getElevenLabsSubscription = async (
    apiKey: string,
    fetcher: typeof fetch = fetch,
): Promise<ElevenLabsSubscriptionSnapshot> => {
    const key = String(apiKey || '').trim();
    if (!key) throw new Error('ElevenLabs sem API key para consultar saldo');
    const response = await fetcher('https://api.elevenlabs.io/v1/user/subscription', {
        headers: { 'xi-api-key': key, Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`ElevenLabs saldo ${response.status}: ${text.slice(0, 240)}`);
    const payload = JSON.parse(text || '{}');
    const usedCredits = Math.max(0, Math.floor(finite(payload.character_count ?? payload.credit_count, 0)));
    const limitCredits = Math.max(0, Math.floor(finite(payload.character_limit ?? payload.credit_limit, 0)));
    const resetUnix = finite(payload.next_character_count_reset_unix ?? payload.next_credit_count_reset_unix, 0);
    const resetAt = resetUnix > 0 ? new Date(resetUnix * 1_000).toISOString() : null;
    return {
        tier: String(payload.tier || 'unknown'),
        status: String(payload.status || 'unknown'),
        usedCredits,
        limitCredits,
        remainingCredits: Math.max(0, limitCredits - usedCredits),
        resetAt,
        cycleKey: resetAt || `calendar:${new Date().toISOString().slice(0, 7)}:limit:${limitCredits}`,
        source: 'live',
    };
};

export const getElevenLabsSubscriptionForBudget = async ({
    apiKey,
    fallback,
    fetcher = fetch,
}: {
    apiKey: string;
    fallback: ElevenLabsSubscriptionFallback;
    fetcher?: typeof fetch;
}): Promise<ElevenLabsSubscriptionSnapshot> => {
    try {
        return await getElevenLabsSubscription(apiKey, fetcher);
    } catch (error: any) {
        const message = String(error?.message || error);
        const restrictedBalanceRead = /missing_permissions|user_read|saldo\s+401/i.test(message);
        if (!restrictedBalanceRead) throw error;

        const remainingCredits = Math.floor(finite(fallback.remainingCredits, 0));
        if (remainingCredits <= 0 || !String(fallback.cycleKey || '').trim()) throw error;
        return {
            tier: 'restricted_key',
            status: 'local_ledger',
            usedCredits: 0,
            limitCredits: remainingCredits,
            remainingCredits,
            resetAt: null,
            cycleKey: String(fallback.cycleKey).trim(),
            source: 'local_ledger',
        };
    }
};

const rpcObject = (data: any) => Array.isArray(data) ? (data[0] || {}) : (data || {});

export const reserveElevenLabsBudget = async ({
    supabase,
    sessionId,
    idempotencyKey,
    source,
    estimatedCredits,
    subscription,
    config,
}: {
    supabase: any;
    sessionId: string;
    idempotencyKey: string;
    source: 'requested' | 'ai_selected' | 'spontaneous' | 'admin_test';
    estimatedCredits: number;
    subscription: ElevenLabsSubscriptionSnapshot;
    config: ElevenLabsBudgetConfig;
}): Promise<VoiceBudgetReservation> => {
    if (!config.enabled) return { allowed: true, reason: 'budget_disabled', reservationId: '' };
    const { data, error } = await supabase.rpc('reserve_elevenlabs_audio_usage', {
        p_session_id: sessionId,
        p_idempotency_key: idempotencyKey,
        p_source: source,
        p_estimated_credits: Math.max(1, Math.ceil(estimatedCredits)),
        p_cycle_key: subscription.cycleKey,
        p_cycle_reset_at: subscription.resetAt,
        p_cycle_starting_credits: subscription.remainingCredits,
        p_live_remaining: subscription.remainingCredits,
        p_free_lead_credits: config.freeLeadCredits,
        p_revenue_share_percent: config.revenueSharePercent,
        p_credits_per_brl: config.creditsPerBrl,
        p_reserve_percent: config.reservePercent,
        p_acquisition_percent: config.acquisitionPercent,
    });
    if (error) {
        const missing = /reserve_elevenlabs_audio_usage|schema cache|function/i.test(String(error.message || error));
        return { allowed: false, reason: missing ? 'budget_migration_missing' : 'budget_reservation_failed', reservationId: '' };
    }
    const value = rpcObject(data);
    return {
        allowed: value.allowed === true,
        reason: String(value.reason || 'budget_denied'),
        reservationId: String(value.reservation_id || ''),
        leadBudget: finite(value.lead_budget, 0),
        leadRemainingAfter: finite(value.lead_remaining_after, 0),
        globalRemainingAfter: finite(value.global_remaining_after, 0),
        reserve: finite(value.reserve, 0),
    };
};

export const settleElevenLabsBudget = async ({
    supabase,
    reservationId,
    actualCredits,
    requestId,
    spokenChars,
    taggedChars,
}: {
    supabase: any;
    reservationId: string;
    actualCredits: number;
    requestId?: string;
    spokenChars: number;
    taggedChars: number;
}) => {
    if (!reservationId) return;
    const { error } = await supabase.rpc('settle_elevenlabs_audio_usage', {
        p_reservation_id: reservationId,
        p_actual_credits: Math.max(0, Math.ceil(actualCredits)),
        p_request_id: String(requestId || ''),
        p_spoken_chars: Math.max(0, Math.ceil(spokenChars)),
        p_tagged_chars: Math.max(0, Math.ceil(taggedChars)),
    });
    if (error) throw new Error(`Falha ao confirmar custo ElevenLabs: ${String(error.message || error)}`);
};

export const releaseElevenLabsBudget = async ({
    supabase,
    reservationId,
    reason,
}: {
    supabase: any;
    reservationId: string;
    reason: string;
}) => {
    if (!reservationId) return;
    const { error } = await supabase.rpc('release_elevenlabs_audio_usage', {
        p_reservation_id: reservationId,
        p_failure_reason: String(reason || 'generation_failed').slice(0, 500),
    });
    if (error) console.warn('[ELEVENLABS BUDGET] Falha ao liberar reserva:', error.message || error);
};

export const loadElevenLabsBudgetDashboard = async ({
    supabase,
    apiKey,
    config,
    fallback,
}: {
    supabase: any;
    apiKey: string;
    config: ElevenLabsBudgetConfig;
    fallback?: ElevenLabsSubscriptionFallback;
}) => {
    let subscription: ElevenLabsSubscriptionSnapshot | null = null;
    let subscriptionError = '';
    if (apiKey) {
        try {
            subscription = fallback
                ? await getElevenLabsSubscriptionForBudget({ apiKey, fallback })
                : await getElevenLabsSubscription(apiKey);
        }
        catch (error: any) { subscriptionError = String(error?.message || error); }
    }

    const { data, error } = await supabase
        .from('elevenlabs_audio_usage')
        .select('status,source,estimated_credits,actual_credits,total_paid_snapshot,session_id,created_at')
        .order('created_at', { ascending: false })
        .limit(5_000);
    if (error) {
        return {
            ready: false,
            error: /elevenlabs_audio_usage|schema cache|relation/i.test(String(error.message || error))
                ? 'Aplique elevenlabs_voice_budget_migration.sql'
                : String(error.message || error),
            subscription,
            subscriptionError,
            totals: { charged: 0, reserved: 0, released: 0, acquisition: 0, buyers: 0, leads: 0 },
        };
    }
    const rows = data || [];
    const chargedRows = rows.filter((row: any) => row.status === 'charged');
    const reservedRows = rows.filter((row: any) => row.status === 'reserved');
    const sum = (items: any[]) => items.reduce((total, row) => total + Number(row.actual_credits ?? row.estimated_credits ?? 0), 0);
    return {
        ready: true,
        error: '',
        subscription,
        subscriptionError,
        config,
        totals: {
            charged: sum(chargedRows),
            reserved: sum(reservedRows),
            released: rows.filter((row: any) => row.status === 'released').length,
            acquisition: sum(chargedRows.filter((row: any) => Number(row.total_paid_snapshot || 0) <= 0)),
            buyers: sum(chargedRows.filter((row: any) => Number(row.total_paid_snapshot || 0) > 0)),
            leads: new Set(chargedRows.map((row: any) => row.session_id)).size,
        },
    };
};
