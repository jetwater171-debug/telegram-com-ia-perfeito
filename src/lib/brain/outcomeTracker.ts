import { supabaseServer as supabase } from '@/lib/supabaseServer';

export const OUTCOME_REWARDS: Record<string, number> = {
    positive_reaction: 1,
    conversation_continued: 0.5,
    explicit_interest: 1.5,
    payment_confirmed: 5,
    repeat_purchase: 8,
    returned_next_day: 2,
    returned_seven_day: 4,
    delivery_satisfied: 3,
    objection: -0.5,
    rejection: -1,
    repeated_rejection: -2,
    complaint: -3,
    abandoned_after_offer: -2,
    blocked: -8,
    promise_unfulfilled: -5,
};

export const recordOutcomeSafe = async ({
    sessionId,
    decisionId,
    eventId,
    outcomeType,
    horizon = 'immediate',
    metadata = {},
}: {
    sessionId: string;
    decisionId?: string | null;
    eventId?: string | null;
    outcomeType: string;
    horizon?: 'immediate' | 'next_turn' | 'next_day' | 'seven_day' | 'lifetime';
    metadata?: Record<string, unknown>;
}) => {
    try {
        if (eventId) {
            const existing = await supabase.from('ai_outcomes')
                .select('id')
                .eq('event_id', eventId)
                .eq('outcome_type', outcomeType)
                .limit(1)
                .maybeSingle();
            if (existing.data?.id) return;
        }
        const { error } = await supabase.from('ai_outcomes').insert({
            session_id: sessionId,
            decision_id: decisionId || null,
            event_id: eventId || null,
            outcome_type: outcomeType,
            reward: OUTCOME_REWARDS[outcomeType] ?? 0,
            horizon,
            metadata,
        });
        if (error && !/ai_outcomes|relation|schema cache/i.test(String(error.message || ''))) {
            console.warn('[OUTCOME] persistência falhou:', error.message);
        }
    } catch (error: any) {
        if (!/ai_outcomes|relation|schema cache/i.test(String(error?.message || error))) {
            console.warn('[OUTCOME] indisponível:', error?.message || error);
        }
    }
};

const positiveReaction = (text: string) => /\b(gostei|amei|linda|gostosa|delicia|delícia|perfeita|essa sim|curti|manda mais|quero essa|uau|wow)\b/i.test(text);
const explicitInterest = (text: string) => /\b(quero|vou comprar|fechou|manda o pix|gera o pix|pode gerar|quanto custa|qual o valor)\b/i.test(text);
const objection = (text: string) => /\b(caro|ta caro|tá caro|sem dinheiro|nao consigo|não consigo|desconto|mais barato)\b/i.test(text);
const rejection = (text: string) => /\b(nao quero|não quero|para de oferecer|chega|sem interesse)\b/i.test(text);

export const trackLeadResponseOutcomesSafe = async ({
    sessionId,
    eventId,
    userText,
    occurredAt,
}: {
    sessionId: string;
    eventId?: string | null;
    userText: string;
    occurredAt?: string | null;
}) => {
    try {
        let query = supabase.from('ai_decisions')
            .select('id,preview_id,next_best_action,created_at')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false })
            .limit(1);
        if (occurredAt) query = query.lt('created_at', occurredAt);
        const { data, error } = await query.maybeSingle();
        if (error || !data?.id) return { previewId: null, positive: false };

        const signals: string[] = ['conversation_continued'];
        if (positiveReaction(userText)) signals.push('positive_reaction');
        if (explicitInterest(userText)) signals.push('explicit_interest');
        if (objection(userText)) signals.push('objection');
        if (rejection(userText)) signals.push('rejection');
        await Promise.all(signals.map((outcomeType) => recordOutcomeSafe({
            sessionId,
            decisionId: String(data.id),
            eventId,
            outcomeType,
            horizon: 'next_turn',
            metadata: { next_best_action: data.next_best_action },
        })));
        return { previewId: data.preview_id ? String(data.preview_id) : null, positive: positiveReaction(userText) };
    } catch {
        return { previewId: null, positive: false };
    }
};

export const trackPaymentOutcomeSafe = async ({
    sessionId,
    eventId,
    amount,
    product,
}: {
    sessionId: string;
    eventId?: string | null;
    amount: number;
    product: string;
}) => {
    try {
        const [decisionResult, paymentsResult] = await Promise.all([
            supabase.from('ai_decisions')
                .select('id,preview_id,offer_id')
                .eq('session_id', sessionId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
            supabase.from('lead_events')
                .select('id', { count: 'exact', head: true })
                .eq('session_id', sessionId)
                .eq('event_type', 'payment_confirmed'),
        ]);
        const decisionId = decisionResult.data?.id ? String(decisionResult.data.id) : null;
        await recordOutcomeSafe({
            sessionId,
            decisionId,
            eventId,
            outcomeType: 'payment_confirmed',
            horizon: 'lifetime',
            metadata: { amount, product, offer_id: decisionResult.data?.offer_id || null },
        });
        if (Number(paymentsResult.count || 0) > 1) {
            await recordOutcomeSafe({
                sessionId,
                decisionId,
                eventId,
                outcomeType: 'repeat_purchase',
                horizon: 'lifetime',
                metadata: { amount, product },
            });
        }
        return { previewId: decisionResult.data?.preview_id ? String(decisionResult.data.preview_id) : null };
    } catch {
        return { previewId: null };
    }
};
