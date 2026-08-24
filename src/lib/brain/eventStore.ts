import { supabaseServer as supabase } from '@/lib/supabaseServer';
import type { BrainRuntimeState, StructuredMemoryUpdate } from '@/lib/brain/types';

const missingArchitectureRelation = (error: any) => {
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    return code === '42P01' || code === '42703'
        || message.includes('lead_events')
        || message.includes('lead_memory_items')
        || message.includes('ai_decisions');
};

export const appendLeadEventSafe = async ({
    sessionId,
    eventType,
    source = 'backend',
    sourceId,
    payload = {},
    occurredAt,
}: {
    sessionId: string;
    eventType: string;
    source?: string;
    sourceId?: string | null;
    payload?: Record<string, unknown>;
    occurredAt?: string | null;
}) => {
    const row = {
        session_id: sessionId,
        event_type: String(eventType).trim().slice(0, 120),
        source: String(source).trim().slice(0, 80) || 'backend',
        source_id: sourceId ? String(sourceId).slice(0, 240) : null,
        payload,
        occurred_at: occurredAt || new Date().toISOString(),
    };
    try {
        const query = supabase.from('lead_events').upsert(row, {
            onConflict: 'session_id,event_type,source_id',
            ignoreDuplicates: true,
        }).select('id').maybeSingle();
        const { data, error } = await query;
        if (error) {
            if (!missingArchitectureRelation(error)) console.warn('[EVENT STORE] append falhou:', error.message);
            return null;
        }
        return data?.id ? String(data.id) : null;
    } catch (error: any) {
        if (!missingArchitectureRelation(error)) console.warn('[EVENT STORE] indisponível:', error?.message || error);
        return null;
    }
};

export const persistMemoryUpdatesSafe = async ({
    sessionId,
    updates,
    sourceEventId,
}: {
    sessionId: string;
    updates?: StructuredMemoryUpdate[] | null;
    sourceEventId?: string | null;
}) => {
    const sanitized = (updates || []).slice(0, 12).map((update) => ({
        session_id: sessionId,
        kind: update.kind,
        status: update.status || (update.kind === 'hypothesis' ? 'uncertain' : 'active'),
        memory_key: String(update.key || '').trim().slice(0, 160),
        content: String(update.content || '').replace(/\s+/g, ' ').trim().slice(0, 500),
        confidence: Math.max(0, Math.min(1, Number(update.confidence) || 0)),
        importance: Math.max(0, Math.min(1, Number(update.importance) || 0.5)),
        source_event_id: sourceEventId || null,
        updated_at: new Date().toISOString(),
    })).filter((row) => row.memory_key && row.content);
    if (!sanitized.length) return 0;

    try {
        for (const row of sanitized) {
            if (row.status === 'active' && row.kind !== 'hypothesis') {
                await supabase.from('lead_memory_items')
                    .update({ status: 'superseded', updated_at: new Date().toISOString() })
                    .eq('session_id', sessionId)
                    .eq('memory_key', row.memory_key)
                    .eq('status', 'active')
                    .neq('content', row.content);
            }
        }
        const { error } = await supabase.from('lead_memory_items').insert(sanitized);
        if (error) {
            if (!missingArchitectureRelation(error)) console.warn('[MEMÓRIA V2] persistência falhou:', error.message);
            return 0;
        }
        return sanitized.length;
    } catch (error: any) {
        if (!missingArchitectureRelation(error)) console.warn('[MEMÓRIA V2] indisponível:', error?.message || error);
        return 0;
    }
};

export const recordAiDecisionSafe = async (row: {
    sessionId: string;
    sourceEventId?: string | null;
    model?: string | null;
    provider?: string | null;
    nextBestAction: string;
    legacyAction: string;
    confidence?: number;
    previewId?: string | null;
    offerId?: string | null;
    stateSnapshot?: Record<string, unknown>;
    validatorResult?: Record<string, unknown>;
}) => {
    try {
        const { data, error } = await supabase.from('ai_decisions').insert({
            session_id: row.sessionId,
            source_event_id: row.sourceEventId || null,
            model: row.model || null,
            provider: row.provider || null,
            next_best_action: row.nextBestAction,
            legacy_action: row.legacyAction || 'none',
            confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0.5)),
            preview_id: row.previewId || null,
            offer_id: row.offerId || null,
            state_snapshot: row.stateSnapshot || {},
            validator_result: row.validatorResult || {},
        }).select('id').single();
        if (error) {
            if (!missingArchitectureRelation(error)) console.warn('[DECISÃO V2] persistência falhou:', error.message);
            return null;
        }
        return data?.id ? String(data.id) : null;
    } catch (error: any) {
        if (!missingArchitectureRelation(error)) console.warn('[DECISÃO V2] indisponível:', error?.message || error);
        return null;
    }
};

export const markAdultDeclarationSafe = async (sessionId: string, declaredAt = new Date().toISOString()) => {
    try {
        const { error } = await supabase.from('lead_reality_states').upsert({
            session_id: sessionId,
            adult_verified: true,
            updated_at: declaredAt,
        }, { onConflict: 'session_id' });
        if (error && !missingArchitectureRelation(error)) console.warn('[REALITY STATE] declaração adulta não persistida:', error.message);
        return !error;
    } catch (error: any) {
        if (!missingArchitectureRelation(error)) console.warn('[REALITY STATE] indisponível:', error?.message || error);
        return false;
    }
};

export const persistBrainProjectionsSafe = async ({
    sessionId,
    state,
    relationshipStage,
    userText,
    updates = [],
}: {
    sessionId: string;
    state: BrainRuntimeState;
    relationshipStage?: string | null;
    userText: string;
    updates?: StructuredMemoryUpdate[] | null;
}) => {
    const now = new Date().toISOString();
    const stage = String(relationshipStage || state.twin.relationship.stage || 'new');
    const familiarityByStage: Record<string, number> = { new: 0.1, familiar: 0.35, engaged: 0.65, buyer: 0.78, returning: 0.82 };
    const interests = { ...state.twin.interests };
    const mediaPreferences = { ...state.twin.mediaPreferences };
    const openLoops = new Set([...state.twin.openLoops, ...state.episode.openLoops]);
    for (const update of updates || []) {
        if (update.status !== 'active' && update.status !== 'uncertain') continue;
        if (update.kind === 'preference') {
            const target = /foto|video|midia|preview|cama|natural|lingerie|selfie/i.test(`${update.key} ${update.content}`)
                ? mediaPreferences
                : interests;
            target[update.key] = Math.max(Number(target[update.key] || 0), Math.max(0, Math.min(1, Number(update.confidence) || 0.5)));
        }
        if (update.kind === 'episode' && update.content) openLoops.add(update.content.slice(0, 180));
    }
    const trimmedUserText = String(userText || '').replace(/\s+/g, ' ').trim();
    const messageLength = trimmedUserText.length <= 45 ? 'short' : trimmedUserText.length >= 180 ? 'long' : 'medium';
    const humorSignal = /\b(k{2,}|rs+|haha|kkk)\b/i.test(trimmedUserText) ? 0.75 : state.twin.conversationStyle.humor;
    const directSignal = /\b(quero|manda|faz|quanto|pix|agora|sim|nao|não)\b/i.test(trimmedUserText) ? 0.8 : state.twin.conversationStyle.directness;

    try {
        const [twinResult, episodeResult] = await Promise.all([
            supabase.from('lead_twins').upsert({
                session_id: sessionId,
                relationship: { stage, familiarity: familiarityByStage[stage] ?? state.twin.relationship.familiarity },
                conversation_style: { messageLength, humor: humorSignal, directness: directSignal },
                interests,
                media_preferences: mediaPreferences,
                commercial: state.twin.commercial,
                open_loops: [...openLoops].slice(0, 12),
                updated_at: now,
            }, { onConflict: 'session_id' }),
            supabase.from('lead_episode_states').upsert({
                session_id: sessionId,
                episode_key: state.episode.episodeKey,
                status: 'active',
                topic: state.episode.topic || null,
                summary: state.episode.summary || null,
                open_loops: [...openLoops].slice(0, 12),
                momentum: state.episode.momentum,
                updated_at: now,
            }, { onConflict: 'session_id,episode_key' }),
        ]);
        const error = twinResult.error || episodeResult.error;
        if (error && !missingArchitectureRelation(error)) console.warn('[PROJEÇÕES V2] persistência falhou:', error.message);
        return !error;
    } catch (error: any) {
        if (!missingArchitectureRelation(error)) console.warn('[PROJEÇÕES V2] indisponíveis:', error?.message || error);
        return false;
    }
};

export const patchRealityStateSafe = async (sessionId: string, patch: {
    payment?: Record<string, unknown>;
    media?: Record<string, unknown>;
    commercial?: Record<string, unknown>;
}) => {
    try {
        const { data } = await supabase.from('lead_reality_states').select('payment,media,commercial').eq('session_id', sessionId).maybeSingle();
        const current = (data || {}) as {
            payment?: Record<string, unknown>;
            media?: Record<string, unknown>;
            commercial?: Record<string, unknown>;
        };
        const { error } = await supabase.from('lead_reality_states').upsert({
            session_id: sessionId,
            payment: { ...(current.payment || {}), ...(patch.payment || {}) },
            media: { ...(current.media || {}), ...(patch.media || {}) },
            commercial: { ...(current.commercial || {}), ...(patch.commercial || {}) },
            updated_at: new Date().toISOString(),
        }, { onConflict: 'session_id' });
        if (error && !missingArchitectureRelation(error)) console.warn('[REALITY STATE] patch falhou:', error.message);
        return !error;
    } catch (error: any) {
        if (!missingArchitectureRelation(error)) console.warn('[REALITY STATE] indisponível:', error?.message || error);
        return false;
    }
};
