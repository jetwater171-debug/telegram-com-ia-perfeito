import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { DEFAULT_BAI_MODEL } from '@/lib/aiModels';

export const dynamic = 'force-dynamic';

const configured = (value: unknown) => Boolean(String(value || '').trim());

export async function GET() {
    const startedAt = Date.now();
    try {
        const [settingsResult, sessionsResult, eventResult, outcomeResult, decisionResult] = await Promise.all([
            supabase.from('bot_settings').select('key,value').in('key', [
                'bai_api_key', 'bai_model', 'telegram_bot_token', 'ai_model_order',
            ]),
            supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
            supabase.from('lead_events').select('id', { count: 'exact', head: true }),
            supabase.from('ai_outcomes').select('id', { count: 'exact', head: true }),
            supabase.from('ai_decisions')
                .select('provider,model,next_best_action,validator_result,created_at')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
        ]);

        const errors = [settingsResult.error, sessionsResult.error, eventResult.error, outcomeResult.error, decisionResult.error]
            .filter(Boolean)
            .map((error) => String(error?.message || 'database_error'));
        const map = Object.fromEntries((settingsResult.data || []).map((row) => [row.key, row.value]));
        const deepseekConfigured = configured(map.bai_api_key) || configured(process.env.BAI_API_KEY);
        const telegramConfigured = configured(map.telegram_bot_token) || configured(process.env.TELEGRAM_BOT_TOKEN);
        const databaseReady = errors.length === 0;
        const eventStoreReady = !eventResult.error && !decisionResult.error;
        const healthy = databaseReady && eventStoreReady && deepseekConfigured && telegramConfigured;
        const lastDecision = decisionResult.data || null;
        const corrections = Array.isArray(lastDecision?.validator_result?.corrections)
            ? lastDecision.validator_result.corrections.length
            : 0;

        return NextResponse.json({
            ok: healthy,
            status: healthy ? 'healthy' : databaseReady ? 'attention' : 'degraded',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - startedAt,
            checks: {
                database: databaseReady,
                eventStore: eventStoreReady,
                deepseek: deepseekConfigured,
                telegram: telegramConfigured,
            },
            brain: {
                model: String(lastDecision?.model || map.bai_model || process.env.BAI_MODEL || DEFAULT_BAI_MODEL),
                provider: String(lastDecision?.provider || (deepseekConfigured ? 'bai' : 'fallback')),
                lastAction: String(lastDecision?.next_best_action || 'sem decisão recente'),
                lastDecisionAt: lastDecision?.created_at || null,
                lastValidatorCorrections: corrections,
                providerOrder: String(map.ai_model_order || 'bai,gemini,fallbacks'),
            },
            counters: {
                activeSessions: sessionsResult.count || 0,
                events: eventResult.count || 0,
                outcomes: outcomeResult.count || 0,
            },
            warnings: errors.slice(0, 3),
        }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
    } catch (error: any) {
        return NextResponse.json({
            ok: false,
            status: 'degraded',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - startedAt,
            checks: { database: false, eventStore: false, deepseek: false, telegram: false },
            warnings: [String(error?.message || error || 'health_check_failed')],
        }, { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } });
    }
}
