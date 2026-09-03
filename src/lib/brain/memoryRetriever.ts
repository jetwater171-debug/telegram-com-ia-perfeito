import type { RetrievedMemory } from '@/lib/brain/types';

type MemoryRow = {
    id?: unknown;
    kind?: unknown;
    status?: unknown;
    memory_key?: unknown;
    content?: unknown;
    confidence?: unknown;
    importance?: unknown;
    source?: unknown;
    source_type?: unknown;
    source_actor?: unknown;
    source_event_id?: unknown;
    source_message_id?: unknown;
    valid_from?: unknown;
    valid_until?: unknown;
    superseded_at?: unknown;
    superseded_by?: unknown;
    is_superseded?: unknown;
    updated_at?: unknown;
    created_at?: unknown;
};

const normalize = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenSet = (value: unknown) => new Set(normalize(value).split(' ').filter((token) => token.length >= 3));
const clamp01 = (value: unknown, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
};

const parseTimestamp = (value: unknown) => {
    if (value instanceof Date) {
        const timestamp = value.getTime();
        return Number.isFinite(timestamp) ? timestamp : null;
    }
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : null;
};

const sourceReliabilityScore = (row: MemoryRow) => {
    const source = [row.source_type, row.source_actor, row.source]
        .map(normalize)
        .find(Boolean) || '';
    // Neste fluxo, source_event_id é o evento literal da mensagem do lead que
    // originou a memória. Mesmo sem join, é evidência melhor que legado solto.
    if (!source && row.source_event_id) return 0.9;
    if (!source) return 0.6;
    if (/(^|\b)(user|lead|customer|telegram|direct|message)(\b|$)/.test(source)) return 1;
    if (/(^|\b)(backend|transaction|payment|crm|admin|system)(\b|$)/.test(source)) return 0.95;
    if (/(^|\b)(assistant|bot)(\b|$)/.test(source)) return 0.72;
    if (/(^|\b)(llm|model|ai|inferred|derived|hypothesis)(\b|$)/.test(source)) return 0.45;
    return 0.6;
};

const isVisibleAt = (row: MemoryRow, nowMs: number) => {
    // Empty/null status historically meant active; keep that compatibility
    // while treating explicit terminal states as unavailable.
    const status = String(row.status || 'active').trim().toLowerCase();
    if (!['active', 'uncertain'].includes(status)) return false;
    const isSuperseded = row.is_superseded === true
        || ['true', '1', 'yes'].includes(normalize(row.is_superseded));
    if (isSuperseded || row.superseded_at || row.superseded_by) return false;

    const validFrom = parseTimestamp(row.valid_from);
    if (validFrom !== null && validFrom > nowMs) return false;
    const validUntil = parseTimestamp(row.valid_until);
    if (validUntil !== null && validUntil <= nowMs) return false;
    return true;
};

const overlapScore = (query: Set<string>, candidate: Set<string>) => {
    if (query.size === 0 || candidate.size === 0) return 0;
    let overlap = 0;
    query.forEach((token) => {
        if (candidate.has(token)) overlap += 1;
    });
    return overlap / Math.sqrt(query.size * candidate.size);
};

const recencyScore = (updatedAt: unknown, nowMs: number) => {
    const timestamp = parseTimestamp(updatedAt);
    if (timestamp === null) return 0.1;
    const days = Math.max(0, (nowMs - timestamp) / 86_400_000);
    return Math.exp(-days / 45);
};

/**
 * Ranking hibrido local. Mem0 continua fornecendo a perna vetorial quando
 * habilitado; esta camada garante filtros estruturados, relevancia lexical,
 * recencia, importancia, entidade e relacao com open loops sem outra chamada.
 */
export const rankMemoryRows = ({
    rows,
    query,
    currentTopic = '',
    openLoops = [],
    limit = 12,
    now = new Date(),
}: {
    rows: MemoryRow[];
    query: string;
    currentTopic?: string;
    openLoops?: string[];
    limit?: number;
    now?: Date;
}): RetrievedMemory[] => {
    const queryTokens = tokenSet(query);
    const topicTokens = tokenSet(currentTopic);
    const openLoopTokens = tokenSet(openLoops.join(' '));
    const nowMs = Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
    // Preserve the historical minimum of three results, but do not impose a
    // second arbitrary maximum here. Callers that can page/fetch more rows can
    // request them through `limit` without losing candidates at this layer.
    const requestedLimit = Number(limit);
    const resultLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.max(3, Math.floor(requestedLimit))
        : 3;

    return (rows || [])
        .filter((row) => isVisibleAt(row, nowMs))
        .map((row) => {
            const content = String(row.content || '').replace(/\s+/g, ' ').trim().slice(0, 500);
            const key = String(row.memory_key || '').trim().slice(0, 160);
            const candidateTokens = tokenSet(`${key} ${content}`);
            const relevance = overlapScore(queryTokens, candidateTokens);
            const topic = overlapScore(topicTokens, candidateTokens);
            const openLoop = overlapScore(openLoopTokens, candidateTokens);
            const importance = clamp01(row.importance, 0.5);
            const confidence = clamp01(row.confidence, 0.5);
            const source = sourceReliabilityScore(row);
            const updatedAt = String(row.updated_at || row.created_at || '');
            const recency = recencyScore(updatedAt, nowMs);
            const entityMatch = [...queryTokens].some((token) => key.toLowerCase().includes(token)) ? 1 : 0;
            const status = String(row.status || 'active').trim().toLowerCase();
            const score = (0.26 * relevance)
                + (0.10 * topic)
                + (0.12 * recency)
                + (0.14 * importance)
                + (0.14 * confidence)
                + (0.12 * source)
                + (0.06 * entityMatch)
                + (0.06 * openLoop);
            return {
                id: String(row.id || ''),
                kind: (['fact', 'hypothesis', 'preference', 'episode', 'outcome'].includes(String(row.kind))
                    ? String(row.kind)
                    : 'hypothesis') as RetrievedMemory['kind'],
                status: (status === 'uncertain' ? 'uncertain' : 'active') as RetrievedMemory['status'],
                key,
                content,
                confidence,
                importance,
                updatedAt,
                score,
            };
        })
        .filter((item) => item.content)
        .sort((left, right) => right.score - left.score
            || right.importance - left.importance
            || right.confidence - left.confidence
            || (parseTimestamp(right.updatedAt) || 0) - (parseTimestamp(left.updatedAt) || 0))
        .slice(0, resultLimit);
};

export const formatRetrievedMemories = (memories: RetrievedMemory[]) => {
    if (!memories.length) return '- nenhuma memória relevante recuperada';
    return memories.map((memory) => {
        const epistemic = memory.kind === 'hypothesis' || memory.status === 'uncertain'
            ? `HIPÓTESE ${memory.confidence.toFixed(2)}`
            : `${memory.kind.toUpperCase()} ${memory.confidence.toFixed(2)}`;
        return JSON.stringify({
            epistemic,
            key: memory.key,
            updatedAt: memory.updatedAt,
            content: memory.content,
        });
    }).join('\n');
};
