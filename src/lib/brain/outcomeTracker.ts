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
