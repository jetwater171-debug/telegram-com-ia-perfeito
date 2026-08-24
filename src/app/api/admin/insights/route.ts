import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const FUNNEL_STEPS = ['WELCOME', 'CONNECTION', 'TRIGGER_PHASE', 'HOT_TALK', 'PREVIEW', 'SALES_PITCH', 'NEGOTIATION', 'CLOSING', 'PAYMENT_CHECK', 'PAYMENT_CONFIRMED'];

export async function GET() {
    const [eventsResult, sessionsResult, decisionsResult, outcomesResult] = await Promise.all([
        supabase.from('funnel_events').select('session_id,step,created_at').order('created_at', { ascending: false }).limit(5000),
        supabase.from('sessions').select('id,total_paid,status,last_message_at').limit(5000),
        supabase.from('ai_decisions').select('provider,model,next_best_action,validator_result,created_at').order('created_at', { ascending: false }).limit(2000),
        supabase.from('ai_outcomes').select('outcome_type,reward,horizon,occurred_at').order('occurred_at', { ascending: false }).limit(2000),
    ]);
    const error = eventsResult.error || sessionsResult.error || decisionsResult.error || outcomesResult.error;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const sessions = sessionsResult.data || [];
    const events = eventsResult.data || [];
    const decisions = decisionsResult.data || [];
    const outcomes = outcomesResult.data || [];
    const paidSessions = new Set(sessions.filter((row) => Number(row.total_paid || 0) > 0).map((row) => row.id));
    const byStep = new Map(FUNNEL_STEPS.map((step) => [step, new Set<string>()]));
    for (const event of events) {
        const step = String(event.step || '').toUpperCase();
        byStep.get(step)?.add(String(event.session_id));
    }
    const funnel = FUNNEL_STEPS.map((step, index) => {
        const reachedSet = byStep.get(step) || new Set<string>();
        const nextSet = byStep.get(FUNNEL_STEPS[index + 1]) || new Set<string>();
        const progressed = index === FUNNEL_STEPS.length - 1 ? 0 : [...reachedSet].filter((id) => nextSet.has(id)).length;
        const paidAfter = [...reachedSet].filter((id) => paidSessions.has(id)).length;
        return {
            step,
            reached: reachedSet.size,
            progressed,
            progressRate: reachedSet.size && index < FUNNEL_STEPS.length - 1 ? Math.round(progressed / reachedSet.size * 100) : 0,
            paidAfter,
            paidRate: reachedSet.size ? Math.round(paidAfter / reachedSet.size * 100) : 0,
        };
    });

    const providerUsage: Record<string, number> = {};
    const actions: Record<string, number> = {};
    let corrected = 0;
    for (const decision of decisions) {
        const provider = `${decision.provider || 'unknown'}:${decision.model || 'unknown'}`;
        providerUsage[provider] = (providerUsage[provider] || 0) + 1;
        const action = String(decision.next_best_action || 'TALK');
        actions[action] = (actions[action] || 0) + 1;
        if (Array.isArray(decision.validator_result?.corrections) && decision.validator_result.corrections.length) corrected += 1;
    }
    const outcomeCounts: Record<string, number> = {};
    for (const outcome of outcomes) outcomeCounts[String(outcome.outcome_type)] = (outcomeCounts[String(outcome.outcome_type)] || 0) + 1;

    return NextResponse.json({
        overview: {
            totalSessions: sessions.length,
            activeSessions: sessions.filter((row) => row.status === 'active').length,
            paidSessions: paidSessions.size,
            revenue: sessions.reduce((sum, row) => sum + Number(row.total_paid || 0), 0),
        },
        funnel,
        brain: {
            decisions: decisions.length,
            corrected,
            correctionRate: decisions.length ? Math.round(corrected / decisions.length * 100) : 0,
            providerUsage,
            actions,
            lastDecisionAt: decisions[0]?.created_at || null,
        },
        outcomes: {
            total: outcomes.length,
            reward: outcomes.reduce((sum, row) => sum + Number(row.reward || 0), 0),
            counts: outcomeCounts,
        },
        generatedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } });
}
