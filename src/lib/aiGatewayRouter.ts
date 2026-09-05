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
    // Identidade de capacidade: chaves da mesma conta/projeto usam este bucket.
    // A identidade de health continua sendo key, para uma chave ruim não derrubar
    // as demais da mesma conta.
    capacityKey?: string;
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
    recordRetry: (estimatedTokens?: number) => void;
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
// Provedores como Gemini publicam a cota efetiva por projeto/conta, não uma
// tabela universal por modelo. Quando o administrador ainda não informou a
// cota real, o router não inventa um teto baixo que derrube uma credencial
// saudável. Estes sentinelas cabem nos tipos do Postgres e deixam 429/cooldown
// governarem a capacidade até os limites reais serem cadastrados.
const UNKNOWN_RPM = 1_000_000_000;
const UNKNOWN_TPM = 9_000_000_000_000;
const UNKNOWN_RPD = 1_000_000_000;
const UNKNOWN_TPD = 9_000_000_000_000;
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
    void model;

    const unknownQuota = (operational: Pick<GatewayRatePolicy, 'maxConcurrency' | 'timeoutMs' | 'maxQueueMs'>): GatewayRatePolicy => ({
        rpm: UNKNOWN_RPM,
        tpm: UNKNOWN_TPM,
        rpd: UNKNOWN_RPD,
        tpd: UNKNOWN_TPD,
        ...operational,
    });

    if (normalizedProvider === 'bai') {
        return unknownQuota({
            maxConcurrency: 12,
            // O V4 continua sendo sempre o primeiro, mas um canal lento nao
            // pode segurar uma chamada critica e seu fallback. Depois deste limite o
            // roteador usa imediatamente o proximo fallback configurado.
            timeoutMs: 20_000,
            maxQueueMs: 1_000,
        });
    }

    if (normalizedProvider === 'groq') {
        return unknownQuota({
            maxConcurrency: 4,
            timeoutMs: 14_000,
            maxQueueMs: 2_500,
        });
    }

    if (normalizedProvider === 'nvidia') {
        return unknownQuota({ maxConcurrency: 4, timeoutMs: 16_000, maxQueueMs: 2_400 });
    }

    if (normalizedProvider === 'openrouter') {
        return unknownQuota({ maxConcurrency: 3, timeoutMs: 18_000, maxQueueMs: 2_200 });
    }
    if (normalizedProvider === 'gemini') {
        return unknownQuota({
            maxConcurrency: 4,
            timeoutMs: 15_000,
            maxQueueMs: 1_500,
        });
    }
    if (normalizedProvider === 'cloudflare') {
        return unknownQuota({ maxConcurrency: 6, timeoutMs: 16_000, maxQueueMs: 2_500 });
    }
    if (normalizedProvider === 'mistral') {
        return unknownQuota({ maxConcurrency: 4, timeoutMs: 17_000, maxQueueMs: 2_500 });
    }
    if (normalizedProvider === 'cerebras') {
        return unknownQuota({ maxConcurrency: 2, timeoutMs: 12_000, maxQueueMs: 2_000 });
    }
    return unknownQuota({ maxConcurrency: 6, timeoutMs: 18_000, maxQueueMs: 2_500 });
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
    private healthStates = new Map<string, GatewayRuntimeState>();
    private capacityStates = new Map<string, GatewayRuntimeState>();
    private sequence = 0;

    private stateFor(states: Map<string, GatewayRuntimeState>, key: string): GatewayRuntimeState {
        const existing = states.get(key);
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
        states.set(key, created);
        return created;
    }

    private isSamePacificDay(at: number, now: number) {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
        });
        return formatter.format(new Date(at)) === formatter.format(new Date(now));
    }

    private prune(state: GatewayRuntimeState, provider: string, now: number) {
        state.minute = state.minute.filter((event) => now - event.at < MINUTE_MS);
        state.day = provider === 'gemini'
            ? state.day.filter((event) => this.isSamePacificDay(event.at, now))
            : state.day.filter((event) => now - event.at < DAY_MS);
    }

    private availability<T>(candidate: GatewayRouteCandidate<T>, estimatedTokens: number, now: number) {
        const health = this.stateFor(this.healthStates, candidate.key);
        const capacityKey = candidate.capacityKey || candidate.key;
        const capacity = this.stateFor(this.capacityStates, capacityKey);
        this.prune(capacity, candidate.provider, now);
        const waits: number[] = [];
        if (health.cooldownUntil > now) waits.push(health.cooldownUntil - now);
        if (capacity.cooldownUntil > now) waits.push(capacity.cooldownUntil - now);
        if (capacity.inFlight >= candidate.policy.maxConcurrency) waits.push(75);
        if (capacity.minute.length >= candidate.policy.rpm) waits.push(Math.max(1, MINUTE_MS - (now - capacity.minute[0].at)));
        if (sumTokens(capacity.minute) + estimatedTokens > candidate.policy.tpm && capacity.minute.length > 0) {
            waits.push(Math.max(1, MINUTE_MS - (now - capacity.minute[0].at)));
        }
        if (capacity.day.length >= candidate.policy.rpd) waits.push(Math.max(1, DAY_MS - (now - capacity.day[0].at)));
        if (sumTokens(capacity.day) + estimatedTokens > candidate.policy.tpd && capacity.day.length > 0) {
            waits.push(Math.max(1, DAY_MS - (now - capacity.day[0].at)));
        }
        return { health, capacity, capacityKey, waitMs: waits.length > 0 ? Math.max(...waits) : 0 };
    }

    private score<T>(candidate: GatewayRouteCandidate<T>, health: GatewayRuntimeState, capacity: GatewayRuntimeState, routingKey: string) {
        const total = health.successes + health.failures;
        const successRatio = total > 0 ? (health.successes + 2) / (total + 3) : 0.92;
        const latencyFactor = health.ewmaLatencyMs > 0 ? Math.max(0.3, Math.min(1.3, 4_000 / health.ewmaLatencyMs)) : 1;
        const loadFactor = Math.max(0.2, 1 - capacity.inFlight / Math.max(1, candidate.policy.maxConcurrency));
        const remainingFactor = Math.max(0.05, Math.min(
            1,
            (candidate.policy.rpm - capacity.minute.length) / Math.max(1, candidate.policy.rpm),
            (candidate.policy.tpm - sumTokens(capacity.minute)) / Math.max(1, candidate.policy.tpm),
            (candidate.policy.rpd - capacity.day.length) / Math.max(1, candidate.policy.rpd),
            (candidate.policy.tpd - sumTokens(capacity.day)) / Math.max(1, candidate.policy.tpd),
        ));
        const effectiveWeight = Math.max(0.1, candidate.weight * successRatio * latencyFactor * loadFactor * remainingFactor);
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
                .sort((left, right) => this.score(right.candidate, right.health, right.capacity, options.routingKey) - this.score(left.candidate, left.health, left.capacity, options.routingKey));

            if (available.length > 0) {
                const selected = available[0];
                const event: UsageEvent = { id: ++this.sequence, at: now, tokens: options.estimatedTokens };
                selected.capacity.inFlight += 1;
                selected.capacity.minute.push(event);
                selected.capacity.day.push(event);
                let settled = false;

                const release = () => {
                    if (settled) return false;
                    settled = true;
                    selected.capacity.inFlight = Math.max(0, selected.capacity.inFlight - 1);
                    return true;
                };
                const reconcile = (actualTokens?: number) => {
                    if (!actualTokens || actualTokens <= 0) return;
                    event.tokens = Math.max(1, Math.floor(actualTokens));
                };

                return {
                    candidate: selected.candidate,
                    queueWaitMs: now - startedAt,
                    recordRetry: (retryTokens = options.estimatedTokens) => {
                        const retryEvent: UsageEvent = {
                            id: ++this.sequence,
                            at: Date.now(),
                            tokens: Math.max(1, Math.floor(retryTokens)),
                        };
                        selected.capacity.minute.push(retryEvent);
                        selected.capacity.day.push(retryEvent);
                    },
                    succeed: (durationMs, actualTokens) => {
                        if (!release()) return;
                        reconcile(actualTokens);
                        selected.health.successes += 1;
                        selected.health.consecutiveFailures = 0;
                        selected.health.cooldownUntil = 0;
                        selected.health.ewmaLatencyMs = selected.health.ewmaLatencyMs > 0
                            ? selected.health.ewmaLatencyMs * 0.72 + Math.max(1, durationMs) * 0.28
                            : Math.max(1, durationMs);
                    },
                    fail: (error, durationMs, retryAfterMs) => {
                        const kind = classifyGatewayFailure(error);
                        if (!release()) return kind;
                        if (kind !== 'quota') {
                            selected.health.failures += 1;
                            selected.health.consecutiveFailures = Math.min(10, selected.health.consecutiveFailures + 1);
                            selected.health.lastFailureKind = kind;
                            selected.health.ewmaLatencyMs = selected.health.ewmaLatencyMs > 0
                                ? selected.health.ewmaLatencyMs * 0.72 + Math.max(1, durationMs) * 0.28
                                : Math.max(1, durationMs);
                        }
                        const exponent = Math.max(0, (kind === 'quota' ? 0 : selected.health.consecutiveFailures - 1));
                        const defaultDelay = kind === 'auth'
                            ? 30 * 60_000
                            : kind === 'quota'
                                ? Math.min(10 * 60_000, 15_000 * 2 ** exponent)
                                : kind === 'timeout' || kind === 'server' || kind === 'network'
                                    ? Math.min(60_000, 2_000 * 2 ** exponent)
                                    : kind === 'format'
                                        ? Math.min(20_000, 1_000 * 2 ** exponent)
                                        : Math.min(30_000, 1_500 * 2 ** exponent);
                        const cooldownUntil = Date.now() + Math.max(defaultDelay, Number(retryAfterMs || 0));
                        if (kind === 'quota') {
                            selected.capacity.cooldownUntil = Math.max(selected.capacity.cooldownUntil, cooldownUntil);
                            selected.capacity.lastFailureKind = kind;
                        } else {
                            selected.health.cooldownUntil = cooldownUntil;
                        }
                        return kind;
                    },
                    cancelBeforeDispatch: () => {
                        if (!release()) return;
                        selected.capacity.minute = selected.capacity.minute.filter((item) => item.id !== event.id);
                        selected.capacity.day = selected.capacity.day.filter((item) => item.id !== event.id);
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

    defer(key: string, retryAfterMs: number, kind: GatewayFailureKind = 'quota', scope: 'health' | 'capacity' = 'health') {
        const state = this.stateFor(scope === 'capacity' ? this.capacityStates : this.healthStates, key);
        state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + Math.max(1, retryAfterMs));
        state.lastFailureKind = kind;
    }

    snapshot(now = Date.now()) {
        const snapshot = (states: Map<string, GatewayRuntimeState>, scope: 'credential' | 'quota_group', capacityForHealth = false) => Array.from(states.entries()).map(([key, state]) => {
            const capacity = capacityForHealth ? this.capacityStates.get(key) : state;
            this.prune(capacity || state, scope === 'quota_group' && key.startsWith('gemini:') ? 'gemini' : '', now);
            return {
                key,
                scope,
                inFlight: capacity?.inFlight || 0,
                minuteRequests: capacity?.minute.length || 0,
                minuteTokens: sumTokens(capacity?.minute || []),
                dayRequests: capacity?.day.length || 0,
                dayTokens: sumTokens(capacity?.day || []),
                successes: state.successes,
                failures: state.failures,
                cooldownMs: Math.max(0, state.cooldownUntil - now),
                ewmaLatencyMs: Math.round(state.ewmaLatencyMs),
                lastFailureKind: state.lastFailureKind || null,
            };
        });
        const health = snapshot(this.healthStates, 'credential', true);
        const healthKeys = new Set(health.map((item) => item.key));
        return [...health, ...snapshot(this.capacityStates, 'quota_group').filter((item) => !healthKeys.has(item.key))];
    }
}

export const aiGatewayRouter = new AdaptiveGatewayRouter();
