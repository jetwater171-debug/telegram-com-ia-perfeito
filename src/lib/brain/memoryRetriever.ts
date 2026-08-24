import type { RetrievedMemory } from '@/lib/brain/types';

type MemoryRow = {
    id?: unknown;
    kind?: unknown;
    status?: unknown;
    memory_key?: unknown;
    content?: unknown;
    confidence?: unknown;
    importance?: unknown;
    updated_at?: unknown;
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

const overlapScore = (query: Set<string>, candidate: Set<string>) => {
    if (query.size === 0 || candidate.size === 0) return 0;
    let overlap = 0;
    query.forEach((token) => {
        if (candidate.has(token)) overlap += 1;
    });
    return overlap / Math.sqrt(query.size * candidate.size);
};

const recencyScore = (updatedAt: unknown, nowMs: number) => {
    const timestamp = Date.parse(String(updatedAt || ''));
    if (!Number.isFinite(timestamp)) return 0.1;
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
    const nowMs = now.getTime();

    return (rows || [])
        .filter((row) => String(row.status || 'active') === 'active')
        .map((row) => {
            const content = String(row.content || '').replace(/\s+/g, ' ').trim().slice(0, 500);
            const key = String(row.memory_key || '').trim().slice(0, 160);
            const candidateTokens = tokenSet(`${key} ${content}`);
            const relevance = overlapScore(queryTokens, candidateTokens);
            const topic = overlapScore(topicTokens, candidateTokens);
            const openLoop = overlapScore(openLoopTokens, candidateTokens);
            const importance = clamp01(row.importance, 0.5);
            const recency = recencyScore(row.updated_at, nowMs);
            const entityMatch = [...queryTokens].some((token) => key.toLowerCase().includes(token)) ? 1 : 0;
            const score = (0.30 * relevance)
                + (0.20 * topic)
                + (0.15 * recency)
                + (0.15 * importance)
                + (0.10 * entityMatch)
                + (0.10 * openLoop);
            return {
                id: String(row.id || ''),
                kind: (['fact', 'hypothesis', 'preference', 'episode', 'outcome'].includes(String(row.kind))
                    ? String(row.kind)
                    : 'fact') as RetrievedMemory['kind'],
                status: 'active' as const,
                key,
                content,
                confidence: clamp01(row.confidence, 0.5),
                importance,
                updatedAt: String(row.updated_at || ''),
                score,
            };
        })
        .filter((item) => item.content)
        .sort((left, right) => right.score - left.score
            || right.importance - left.importance
            || Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || ''))
        .slice(0, Math.max(3, Math.min(15, limit)));
};

export const formatRetrievedMemories = (memories: RetrievedMemory[]) => {
    if (!memories.length) return '- nenhuma memória relevante recuperada';
    return memories.map((memory) => {
        const epistemic = memory.kind === 'hypothesis'
            ? `HIPÓTESE ${memory.confidence.toFixed(2)}`
            : `${memory.kind.toUpperCase()} ${memory.confidence.toFixed(2)}`;
        return `- [${epistemic}] ${memory.content}`;
    }).join('\n');
};
