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

export type LeadEventClaimResult = 'claimed' | 'duplicate' | 'reserved' | 'unavailable';
export type LeadEventReservationResult = 'reserved' | 'lost' | 'unavailable';

/**
 * Reserva uma consequencia externa exatamente uma vez usando o indice unico do
 * Event Store. Diferente de appendLeadEventSafe, distingue duplicidade de
 * indisponibilidade para o chamador decidir um fallback consciente.
 */
export const claimLeadEventSafe = async ({
    sessionId,
    eventType,
    sourceId,
    source = 'backend',
    payload = {},
    staleAfterMs = 0,
}: {
    sessionId: string;
    eventType: string;
    sourceId: string;
    source?: string;
    payload?: Record<string, unknown>;
    staleAfterMs?: number;
}): Promise<LeadEventClaimResult> => {
    const row = {
        session_id: sessionId,
        event_type: String(eventType).trim().slice(0, 120),
        source: String(source).trim().slice(0, 80) || 'backend',
        source_id: String(sourceId).slice(0, 240),
        payload,
        occurred_at: new Date().toISOString(),
    };
    try {
        const { error } = await supabase.from('lead_events').insert(row);
        if (!error) return 'claimed';
        if (String(error.code || '') === '23505' || /duplicate key|unique constraint/i.test(String(error.message || ''))) {
            if (staleAfterMs > 0) {
                const existing = await supabase.from('lead_events')
                    .select('id,occurred_at,payload')
                    .eq('session_id', sessionId)
                    .eq('event_type', row.event_type)
                    .eq('source_id', row.source_id)
                    .maybeSingle();
                if (String(existing.data?.payload?.phase || '') === 'notification_reserved') return 'reserved';
                const occurredAtMs = Date.parse(String(existing.data?.occurred_at || ''));
                if (!existing.error && existing.data?.id && Number.isFinite(occurredAtMs)
                    && Date.now() - occurredAtMs >= staleAfterMs) {
                    const reclaimed = await supabase.from('lead_events').update({
                        source: row.source,
                        payload: { ...payload, reclaimed: true },
                        occurred_at: row.occurred_at,
                    }).eq('id', existing.data.id)
                        .eq('occurred_at', existing.data.occurred_at)
                        .select('id')
                        .maybeSingle();
                    if (!reclaimed.error && reclaimed.data?.id) return 'claimed';
                }
            }
            return 'duplicate';
        }
        if (!missingArchitectureRelation(error)) console.warn('[EVENT STORE] claim falhou:', error.message);
        return 'unavailable';
    } catch (error: any) {
        if (!missingArchitectureRelation(error)) console.warn('[EVENT STORE] claim indisponivel:', error?.message || error);
        return 'unavailable';
    }
};

/**
 * Converte um lease de processamento na reserva irreversível da consequência
 * externa. O CAS por occurred_at + claim_token garante que um worker que perdeu
 * o lease nunca consiga enviar depois do novo dono.
 */
export const reserveLeadEventClaimSafe = async ({
    sessionId,
    eventType,
    sourceId,
    claimToken,
    payload = {},
}: {
    sessionId: string;
    eventType: string;
    sourceId: string;
    claimToken: string;
    payload?: Record<string, unknown>;
}): Promise<LeadEventReservationResult> => {
    try {
        const existing = await supabase.from('lead_events')
            .select('id,occurred_at,payload')
            .eq('session_id', sessionId)
            .eq('event_type', String(eventType).trim().slice(0, 120))
            .eq('source_id', String(sourceId).slice(0, 240))
            .maybeSingle();
        if (existing.error) {
            if (!missingArchitectureRelation(existing.error)) console.warn('[EVENT STORE] reserva indisponivel:', existing.error.message);
            return 'unavailable';
        }
        if (!existing.data?.id) return 'lost';
        const existingPayload = existing.data.payload && typeof existing.data.payload === 'object'
            ? existing.data.payload as Record<string, unknown>
            : {};
        if (String(existingPayload.claim_token || '') !== String(claimToken || '')) return 'lost';
        if (String(existingPayload.phase || '') === 'notification_reserved') return 'reserved';

        const reservedAt = new Date().toISOString();
        const reserved = await supabase.from('lead_events').update({
            payload: {
                ...existingPayload,
                ...payload,
                claim_token: claimToken,
                phase: 'notification_reserved',
                notification_reserved_at: reservedAt,
            },
            occurred_at: reservedAt,
        })
            .eq('id', existing.data.id)
            .eq('occurred_at', existing.data.occurred_at)
            .select('id')
            .maybeSingle();
        if (reserved.error) {
            if (!missingArchitectureRelation(reserved.error)) console.warn('[EVENT STORE] reserva falhou:', reserved.error.message);
            return 'unavailable';
        }
        return reserved.data?.id ? 'reserved' : 'lost';
    } catch (error: any) {
        if (!missingArchitectureRelation(error)) console.warn('[EVENT STORE] reserva indisponivel:', error?.message || error);
        return 'unavailable';
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
    const normalized = (updates || []).slice(0, 12).map((update) => ({
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
    // Um único turno pode repetir a mesma chave. A versão final do turno vence,
    // evitando duas memórias simultaneamente ativas para o mesmo conceito.
    const sanitized = [...new Map(normalized.map((row) => [row.memory_key, row] as const)).values()];
    if (!sanitized.length) return 0;

    try {
        const keys = Array.from(new Set(sanitized.map((row) => row.memory_key)));
        const { data: existingRows, error: existingError } = await supabase
            .from('lead_memory_items')
            .select('id,memory_key,content,status,confidence,importance')
            .eq('session_id', sessionId)
            .in('memory_key', keys)
            .in('status', ['active', 'uncertain']);
        if (existingError) throw existingError;

        let persisted = 0;
        for (const row of sanitized) {
            const matching = (existingRows || []).filter((item: any) => item.memory_key === row.memory_key);
            const normalizeContent = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const same = matching.find((item: any) => normalizeContent(item.content) === normalizeContent(row.content));

            if (row.status === 'superseded' || row.status === 'expired') {
                const ids = matching.map((item: any) => item.id).filter(Boolean);
                if (ids.length > 0) {
                    const result = await supabase.from('lead_memory_items')
                        .update({ status: row.status, updated_at: row.updated_at })
                        .in('id', ids);
                    if (result.error) throw result.error;
                    persisted += ids.length;
                }
                continue;
            }

            if (same?.id) {
                const result = await supabase.from('lead_memory_items').update({
                    status: row.status,
                    confidence: Math.max(Number(same.confidence || 0), row.confidence),
                    importance: Math.max(Number(same.importance || 0), row.importance),
                    source_event_id: row.source_event_id,
                    updated_at: row.updated_at,
                }).eq('id', same.id);
                if (result.error) throw result.error;
                persisted += 1;
                continue;
            }

            const priorIds = matching.map((item: any) => item.id).filter(Boolean);
            if (priorIds.length > 0) {
                const supersedeResult = await supabase.from('lead_memory_items')
                    .update({ status: 'superseded', updated_at: row.updated_at })
                    .in('id', priorIds);
                if (supersedeResult.error) throw supersedeResult.error;
            }
            const insertResult = await supabase.from('lead_memory_items').insert(row);
            if (insertResult.error) throw insertResult.error;
            persisted += 1;
        }
        return persisted;
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

export const markAdultVerificationSafe = async (sessionId: string, verifiedAt = new Date().toISOString()) => {
    try {
        const { error } = await supabase.from('lead_reality_states').upsert({
            session_id: sessionId,
            adult_verified: true,
            updated_at: verifiedAt,
        }, { onConflict: 'session_id' });
        if (error && !missingArchitectureRelation(error)) console.warn('[REALITY STATE] declaração adulta não persistida:', error.message);
        return !error;
    } catch (error: any) {
        if (!missingArchitectureRelation(error)) console.warn('[REALITY STATE] indisponível:', error?.message || error);
        return false;
    }
};

// Compatibilidade com eventos antigos de autodeclaração no Telegram.
export const markAdultDeclarationSafe = markAdultVerificationSafe;

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
    const importantOutcomes = new Set<string>();
    let episodeTopic = state.episode.topic;
    let episodeSummary = state.episode.summary;
    for (const update of updates || []) {
        if (update.status !== 'active' && update.status !== 'uncertain') continue;
        if (update.kind === 'preference') {
            const target = /foto|video|midia|preview|cama|natural|lingerie|selfie/i.test(`${update.key} ${update.content}`)
                ? mediaPreferences
                : interests;
            target[update.key] = Math.max(Number(target[update.key] || 0), Math.max(0, Math.min(1, Number(update.confidence) || 0.5)));
        }
        if (update.kind === 'episode' && update.content) {
            const key = String(update.key || '').toLowerCase();
            if (/topic|assunto/.test(key)) episodeTopic = update.content.slice(0, 180);
            else if (/summary|resumo/.test(key)) episodeSummary = update.content.slice(0, 500);
            else openLoops.add(update.content.slice(0, 180));
        }
        if (update.kind === 'outcome' && update.content) importantOutcomes.add(update.content.slice(0, 180));
    }
    const trimmedUserText = String(userText || '').replace(/\s+/g, ' ').trim();
    const messageLength = trimmedUserText.length <= 45 ? 'short' : trimmedUserText.length >= 180 ? 'long' : 'medium';
    const humorSignal = /\b(k{2,}|rs+|haha|kkk)\b/i.test(trimmedUserText) ? 0.75 : state.twin.conversationStyle.humor;
    const directSignal = /\b(quero|manda|faz|quanto|pix|agora|sim|nao|não)\b/i.test(trimmedUserText) ? 0.8 : state.twin.conversationStyle.directness;

    try {
        const [closeResult, twinResult, episodeResult] = await Promise.all([
            supabase.from('lead_episode_states').update({
                status: 'closed',
                ended_at: now,
                updated_at: now,
            }).eq('session_id', sessionId).eq('status', 'active').neq('episode_key', state.episode.episodeKey),
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
                topic: episodeTopic || null,
                summary: episodeSummary || null,
                open_loops: [...openLoops].slice(0, 12),
                momentum: state.episode.momentum,
                ...(importantOutcomes.size > 0 ? { important_outcomes: [...importantOutcomes].slice(0, 12) } : {}),
                updated_at: now,
            }, { onConflict: 'session_id,episode_key' }),
        ]);
        const error = closeResult.error || twinResult.error || episodeResult.error;
        if (error && !missingArchitectureRelation(error)) console.warn('[PROJEÇÕES V2] persistência falhou:', error.message);
        return !error;
    } catch (error: any) {
        if (!missingArchitectureRelation(error)) console.warn('[PROJEÇÕES V2] indisponíveis:', error?.message || error);
        return false;
    }
};

export const patchRealityStateSafe = async (sessionId: string, patch: {
    adultVerified?: boolean;
    payment?: Record<string, unknown>;
    media?: Record<string, unknown>;
    commercial?: Record<string, unknown>;
}) => {
    try {
        const { data } = await supabase.from('lead_reality_states').select('adult_verified,payment,media,commercial').eq('session_id', sessionId).maybeSingle();
        const current = (data || {}) as {
            payment?: Record<string, unknown>;
            media?: Record<string, unknown>;
            commercial?: Record<string, unknown>;
        };
        const { error } = await supabase.from('lead_reality_states').upsert({
            session_id: sessionId,
            adult_verified: patch.adultVerified ?? (data as any)?.adult_verified ?? false,
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
