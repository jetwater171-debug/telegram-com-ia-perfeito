export type GatewayFailureKind = 'auth' | 'quota' | 'timeout' | 'server' | 'format' | 'network' | 'other';

export type GatewayRatePolicy = {
    rpm: number;
    tpm: number;
    rpd: number;
    tpd: number;
    maxConcurrency: number;
    timeoutMs: number;
    maxQueueMs: number;
};

export type GatewayRouteCandidate<T = unknown> = {
    key: string;
    provider: string;
    model: string;
    priority?: number;
    weight: number;
    policy: GatewayRatePolicy;
    value: T;
};

type UsageEvent = {
    id: number;
    at: number;
    tokens: number;
};

type GatewayRuntimeState = {
    inFlight: number;
    minute: UsageEvent[];
    day: UsageEvent[];
    successes: number;
    failures: number;
    consecutiveFailures: number;
    cooldownUntil: number;
    ewmaLatencyMs: number;
    lastFailureKind?: GatewayFailureKind;
};

export type GatewayLease<T = unknown> = {
    candidate: GatewayRouteCandidate<T>;
    queueWaitMs: number;
    succeed: (durationMs: number, actualTokens?: number) => void;
    fail: (error: unknown, durationMs: number, retryAfterMs?: number) => GatewayFailureKind;
    cancelBeforeDispatch: () => void;
};

export class GatewayCapacityError extends Error {
    retryAfterMs: number;

    constructor(message: string, retryAfterMs: number) {
        super(message);
        this.name = 'GatewayCapacityError';
        this.retryAfterMs = retryAfterMs;
    }
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const clampPositive = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const readLimit = (env: Record<string, string | undefined>, provider: string, suffix: string, fallback: number) => {
    const key = `${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_GATEWAY_${suffix}`;
    return clampPositive(env[key], fallback);
};

const providerDefaults = (provider: string, model: string): GatewayRatePolicy => {
    const normalizedProvider = provider.toLowerCase();
    const normalizedModel = model.toLowerCase();

    if (normalizedProvider === 'bai') {
        return {
            rpm: 60,
            tpm: 1_000_000,
            rpd: 100_000,
            tpd: 1_000_000_000,
            maxConcurrency: 12,
            // O V4 continua sendo sempre o primeiro, mas um canal lento nao
            // pode segurar tres cerebros em sequencia. Depois deste limite o
            // roteador usa imediatamente o proximo fallback configurado.
            timeoutMs: 10_000,
            maxQueueMs: 1_000,
        };
    }

    if (normalizedProvider === 'groq') {
        const instant8b = normalizedModel.includes('llama-3.1-8b-instant') || normalizedModel.includes('8b');
        return {
            rpm: 30,
            tpm: instant8b ? 6_000 : 8_000,
            rpd: instant8b ? 14_400 : 1_000,
            tpd: instant8b ? 500_000 : 200_000,
            maxConcurrency: 4,
            timeoutMs: 14_000,
            maxQueueMs: 2_500,
        };
    }

    if (normalizedProvider === 'nvidia') {
        return { rpm: 20, tpm: 120_000, rpd: 2_000, tpd: 2_000_000, maxConcurrency: 4, timeoutMs: 16_000, maxQueueMs: 2_400 };
    }

    if (normalizedProvider === 'openrouter') {
        return { rpm: 18, tpm: 200_000, rpd: 50, tpd: 2_000_000, maxConcurrency: 3, timeoutMs: 18_000, maxQueueMs: 2_200 };
    }
    if (normalizedProvider === 'gemini') {
        const isFlashLite = normalizedModel.includes('flash-lite');
        return {
            rpm: isFlashLite ? 15 : 10,
            tpm: 1_000_000,
            rpd: isFlashLite ? 500 : 20,
            tpd: isFlashLite ? 500_000_000 : 20_000_000,
            maxConcurrency: isFlashLite ? 6 : 4,
            timeoutMs: 15_000,
            maxQueueMs: 1_500,
        };
    }
    if (normalizedProvider === 'cloudflare') {
        return { rpm: 30, tpm: 300_000, rpd: 5_000, tpd: 5_000_000, maxConcurrency: 6, timeoutMs: 16_000, maxQueueMs: 2_500 };
    }
    if (normalizedProvider === 'mistral') {
        return { rpm: 10, tpm: 100_000, rpd: 2_000, tpd: 2_000_000, maxConcurrency: 4, timeoutMs: 17_000, maxQueueMs: 2_500 };
    }
    if (normalizedProvider === 'cerebras') {
        return { rpm: 5, tpm: 30_000, rpd: 1_000, tpd: 1_000_000, maxConcurrency: 2, timeoutMs: 12_000, maxQueueMs: 2_000 };
    }
    return { rpm: 30, tpm: 250_000, rpd: 10_000, tpd: 10_000_000, maxConcurrency: 6, timeoutMs: 18_000, maxQueueMs: 2_500 };
};

export const resolveGatewayRatePolicy = (
    provider: string,
    model: string,
    env: Record<string, string | undefined> = process.env,
): GatewayRatePolicy => {
    const defaults = providerDefaults(provider, model);
    return {
        rpm: readLimit(env, provider, 'RPM', defaults.rpm),
        tpm: readLimit(env, provider, 'TPM', defaults.tpm),
        rpd: readLimit(env, provider, 'RPD', defaults.rpd),
        tpd: readLimit(env, provider, 'TPD', defaults.tpd),
        maxConcurrency: readLimit(env, provider, 'CONCURRENCY', defaults.maxConcurrency),
        timeoutMs: readLimit(env, provider, 'TIMEOUT_MS', defaults.timeoutMs),
        maxQueueMs: readLimit(env, provider, 'MAX_QUEUE_MS', defaults.maxQueueMs),
    };
};

export const estimateAiTokens = (...values: unknown[]) => {
    const chars = values.reduce<number>((sum, value) => {
        if (typeof value === 'string') return sum + value.length;
        try { return sum + JSON.stringify(value ?? '').length; } catch { return sum; }
    }, 0);
    return Math.max(1, Math.ceil(chars / 3.6));
};

export const classifyGatewayFailure = (error: unknown): GatewayFailureKind => {
    const message = String((error as any)?.message || error || '').toLowerCase();
    const status = Number((error as any)?.status || 0);
    if (status === 401 || status === 403 || /invalid.?key|unauthori|forbidden|permission denied/.test(message)) return 'auth';
    if (status === 402 || status === 429 || /rate.?limit|quota|resource_exhausted|insufficient.?credit/.test(message)) return 'quota';
    if (/timeout|timed out|excedeu \d+ms|aborterror/.test(message)) return 'timeout';
    if (status >= 500 || /overloaded|service unavailable|bad gateway|gateway timeout/.test(message)) return 'server';
    if (/json|schema|empty response|extrair/.test(message)) return 'format';
    if (/fetch failed|network|econn|socket|dns/.test(message)) return 'network';
    return 'other';
};

const stableUnit = (value: string) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return Math.max(0.000001, (hash >>> 0) / 0xffffffff);
};

const sumTokens = (events: UsageEvent[]) => events.reduce((sum, event) => sum + event.tokens, 0);
const sleep = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

export class AdaptiveGatewayRouter {
    private states = new Map<string, GatewayRuntimeState>();
    private sequence = 0;

    private stateFor(key: string): GatewayRuntimeState {
        const existing = this.states.get(key);
        if (existing) return existing;
        const created: GatewayRuntimeState = {
            inFlight: 0,
            minute: [],
            day: [],
            successes: 0,
            failures: 0,
            consecutiveFailures: 0,
            cooldownUntil: 0,
            ewmaLatencyMs: 0,
        };
        this.states.set(key, created);
        return created;
    }

    private prune(state: GatewayRuntimeState, now: number) {
        state.minute = state.minute.filter((event) => now - event.at < MINUTE_MS);
        state.day = state.day.filter((event) => now - event.at < DAY_MS);
    }

    private availability<T>(candidate: GatewayRouteCandidate<T>, estimatedTokens: number, now: number) {
        const state = this.stateFor(candidate.key);
        this.prune(state, now);
        const waits: number[] = [];
        if (state.cooldownUntil > now) waits.push(state.cooldownUntil - now);
        if (state.inFlight >= candidate.policy.maxConcurrency) waits.push(75);
        if (state.minute.length >= candidate.policy.rpm) waits.push(Math.max(1, MINUTE_MS - (now - state.minute[0].at)));
        if (sumTokens(state.minute) + estimatedTokens > candidate.policy.tpm && state.minute.length > 0) {
            waits.push(Math.max(1, MINUTE_MS - (now - state.minute[0].at)));
        }
        if (state.day.length >= candidate.policy.rpd) waits.push(Math.max(1, DAY_MS - (now - state.day[0].at)));
        if (sumTokens(state.day) + estimatedTokens > candidate.policy.tpd && state.day.length > 0) {
            waits.push(Math.max(1, DAY_MS - (now - state.day[0].at)));
        }
        return { state, waitMs: waits.length > 0 ? Math.max(...waits) : 0 };
    }

    private score<T>(candidate: GatewayRouteCandidate<T>, state: GatewayRuntimeState, routingKey: string) {
        const total = state.successes + state.failures;
        const successRatio = total > 0 ? (state.successes + 2) / (total + 3) : 0.92;
        const latencyFactor = state.ewmaLatencyMs > 0 ? Math.max(0.3, Math.min(1.3, 4_000 / state.ewmaLatencyMs)) : 1;
        const loadFactor = Math.max(0.2, 1 - state.inFlight / Math.max(1, candidate.policy.maxConcurrency));
        const effectiveWeight = Math.max(0.1, candidate.weight * successRatio * latencyFactor * loadFactor);
        return Math.pow(stableUnit(`${routingKey}:${candidate.key}`), 1 / effectiveWeight);
    }

    async acquire<T>(
        candidates: GatewayRouteCandidate<T>[],
        options: { routingKey: string; estimatedTokens: number; maxQueueMs?: number; exclude?: Set<string> },
    ): Promise<GatewayLease<T>> {
        const startedAt = Date.now();
        const maxQueueMs = Math.max(0, Number(options.maxQueueMs ?? Math.max(0, ...candidates.map((item) => item.policy.maxQueueMs))));
        const deadline = startedAt + maxQueueMs;

        while (true) {
            const now = Date.now();
            const eligible = candidates
                .filter((candidate) => !options.exclude?.has(candidate.key))
                .map((candidate) => ({ candidate, ...this.availability(candidate, options.estimatedTokens, now) }));
            const ready = eligible.filter((item) => item.waitMs === 0);
            const bestPriority = ready.length > 0
                ? Math.min(...ready.map((item) => Number(item.candidate.priority ?? 0)))
                : 0;
            const available = ready
                .filter((item) => Number(item.candidate.priority ?? 0) === bestPriority)
                .sort((left, right) => this.score(right.candidate, right.state, options.routingKey) - this.score(left.candidate, left.state, options.routingKey));

            if (available.length > 0) {
                const selected = available[0];
                const event: UsageEvent = { id: ++this.sequence, at: now, tokens: options.estimatedTokens };
                selected.state.inFlight += 1;
                selected.state.minute.push(event);
                selected.state.day.push(event);
                let settled = false;

                const release = () => {
                    if (settled) return false;
                    settled = true;
                    selected.state.inFlight = Math.max(0, selected.state.inFlight - 1);
                    return true;
                };
                const reconcile = (actualTokens?: number) => {
                    if (!actualTokens || actualTokens <= 0) return;
                    event.tokens = Math.max(1, Math.floor(actualTokens));
                };

                return {
                    candidate: selected.candidate,
                    queueWaitMs: now - startedAt,
                    succeed: (durationMs, actualTokens) => {
                        if (!release()) return;
                        reconcile(actualTokens);
                        selected.state.successes += 1;
                        selected.state.consecutiveFailures = 0;
                        selected.state.cooldownUntil = 0;
                        selected.state.ewmaLatencyMs = selected.state.ewmaLatencyMs > 0
                            ? selected.state.ewmaLatencyMs * 0.72 + Math.max(1, durationMs) * 0.28
                            : Math.max(1, durationMs);
                    },
                    fail: (error, durationMs, retryAfterMs) => {
                        const kind = classifyGatewayFailure(error);
                        if (!release()) return kind;
                        selected.state.failures += 1;
                        selected.state.consecutiveFailures = Math.min(10, selected.state.consecutiveFailures + 1);
                        selected.state.lastFailureKind = kind;
                        selected.state.ewmaLatencyMs = selected.state.ewmaLatencyMs > 0
                            ? selected.state.ewmaLatencyMs * 0.72 + Math.max(1, durationMs) * 0.28
                            : Math.max(1, durationMs);
                        const exponent = Math.max(0, selected.state.consecutiveFailures - 1);
                        const defaultDelay = kind === 'auth'
                            ? 30 * 60_000
                            : kind === 'quota'
                                ? Math.min(10 * 60_000, 15_000 * 2 ** exponent)
                                : kind === 'timeout' || kind === 'server' || kind === 'network'
                                    ? Math.min(60_000, 2_000 * 2 ** exponent)
                                    : kind === 'format'
                                        ? Math.min(20_000, 1_000 * 2 ** exponent)
                                        : Math.min(30_000, 1_500 * 2 ** exponent);
                        selected.state.cooldownUntil = Date.now() + Math.max(defaultDelay, Number(retryAfterMs || 0));
                        return kind;
                    },
                    cancelBeforeDispatch: () => {
                        if (!release()) return;
                        selected.state.minute = selected.state.minute.filter((item) => item.id !== event.id);
                        selected.state.day = selected.state.day.filter((item) => item.id !== event.id);
                    },
                };
            }

            const remaining = deadline - now;
            const waits = eligible.map((item) => item.waitMs).filter((waitMs) => waitMs > 0);
            const retryAfterMs = waits.length > 0 ? Math.min(...waits) : maxQueueMs;
            if (remaining <= 0 || retryAfterMs > remaining) {
                throw new GatewayCapacityError('Nenhum gateway possui capacidade local dentro do prazo da fila', Math.max(1, retryAfterMs));
            }
            await sleep(Math.min(remaining, Math.max(25, retryAfterMs)));
        }
    }

    defer(key: string, retryAfterMs: number, kind: GatewayFailureKind = 'quota') {
        const state = this.stateFor(key);
        state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + Math.max(1, retryAfterMs));
        state.lastFailureKind = kind;
    }

    snapshot(now = Date.now()) {
        return Array.from(this.states.entries()).map(([key, state]) => {
            this.prune(state, now);
            return {
                key,
                inFlight: state.inFlight,
                minuteRequests: state.minute.length,
                minuteTokens: sumTokens(state.minute),
                dayRequests: state.day.length,
                dayTokens: sumTokens(state.day),
                successes: state.successes,
                failures: state.failures,
                cooldownMs: Math.max(0, state.cooldownUntil - now),
                ewmaLatencyMs: Math.round(state.ewmaLatencyMs),
                lastFailureKind: state.lastFailureKind || null,
            };
        });
    }
}

export const aiGatewayRouter = new AdaptiveGatewayRouter();
