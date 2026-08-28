import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { DEFAULT_BAI_MODEL } from '@/lib/aiModels';

export const dynamic = 'force-dynamic';

const configured = (value: unknown) => Boolean(String(value || '').trim());

export async function GET() {
    const startedAt = Date.now();
    try {
        const [
            settingsResult,
            sessionsResult,
            eventResult,
            outcomeResult,
            decisionResult,
            realityResult,
            twinResult,
            episodeResult,
            memoryResult,
            customOrdersResult,
            previewCatalogResult,
            voiceBudgetResult,
            paymentConfirmationsResult,
        ] = await Promise.all([
            supabase.from('bot_settings').select('key,value').in('key', [
                'bai_api_key', 'bai_model', 'telegram_bot_token', 'ai_model_order',
                'elevenlabs_enabled', 'elevenlabs_api_key', 'elevenlabs_voice_id',
                'payment_wiinpay_enabled', 'payment_wiinpay_api_key',
                'payment_pushinpay_enabled', 'payment_pushinpay_api_key',
                'payment_webhook_token',
            ]),
            supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
            supabase.from('lead_events').select('id', { count: 'exact', head: true }),
            supabase.from('ai_outcomes').select('id', { count: 'exact', head: true }),
            supabase.from('ai_decisions')
                .select('provider,model,next_best_action,validator_result,created_at')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
            supabase.from('lead_reality_states').select('session_id', { count: 'exact', head: true }),
            supabase.from('lead_twins').select('session_id', { count: 'exact', head: true }),
            supabase.from('lead_episode_states').select('id', { count: 'exact', head: true }),
            supabase.from('lead_memory_items').select('id', { count: 'exact', head: true }),
            supabase.from('custom_orders').select('id', { count: 'exact', head: true }),
            supabase.from('preview_assets').select('id', { count: 'exact', head: true }),
            supabase.from('elevenlabs_audio_usage').select('id', { count: 'exact', head: true }),
            supabase.from('messages')
                .select('payment_data')
                .eq('sender', 'system')
                .ilike('content', '%PIX GENERATED%')
                .order('created_at', { ascending: false })
                .limit(1000),
        ]);

        const errors = [
            settingsResult.error,
            sessionsResult.error,
            eventResult.error,
            outcomeResult.error,
            decisionResult.error,
            realityResult.error,
            twinResult.error,
            episodeResult.error,
            memoryResult.error,
            customOrdersResult.error,
            previewCatalogResult.error,
            voiceBudgetResult.error,
            paymentConfirmationsResult.error,
        ]
            .filter(Boolean)
            .map((error) => String(error?.message || 'database_error'));
        const map = Object.fromEntries((settingsResult.data || []).map((row) => [row.key, row.value]));
        const deepseekConfigured = configured(map.bai_api_key) || configured(process.env.BAI_API_KEY);
        const telegramConfigured = configured(map.telegram_bot_token) || configured(process.env.TELEGRAM_BOT_TOKEN);
        const elevenEnabled = String(map.elevenlabs_enabled || process.env.ELEVENLABS_ENABLED || '').toLowerCase() === 'true';
        const elevenConfigured = !elevenEnabled || (
            (configured(map.elevenlabs_api_key) || configured(process.env.ELEVENLABS_API_KEY))
            && (configured(map.elevenlabs_voice_id) || configured(process.env.ELEVENLABS_VOICE_ID))
            && !voiceBudgetResult.error
        );
        const wiinKeyConfigured = configured(map.payment_wiinpay_api_key) || configured(process.env.WIINPAY_API_KEY);
        const pushinKeyConfigured = configured(map.payment_pushinpay_api_key) || configured(process.env.PUSHINPAY_API_KEY);
        const wiinEnabled = String(map.payment_wiinpay_enabled || process.env.WIINPAY_ENABLED || (wiinKeyConfigured ? 'true' : 'false')).toLowerCase() !== 'false';
        const pushinEnabled = String(map.payment_pushinpay_enabled || process.env.PUSHINPAY_ENABLED || (pushinKeyConfigured ? 'true' : 'false')).toLowerCase() !== 'false';
        const paymentGatewayConfigured = (wiinEnabled && wiinKeyConfigured) || (pushinEnabled && pushinKeyConfigured);
        const webhookSecure = configured(map.payment_webhook_token) || configured(process.env.PAYMENT_WEBHOOK_TOKEN);
        const databaseReady = errors.length === 0;
        const eventStoreReady = !eventResult.error && !decisionResult.error;
        const memoryReady = !realityResult.error && !twinResult.error && !episodeResult.error && !memoryResult.error;
        const commerceReady = !customOrdersResult.error && paymentGatewayConfigured && webhookSecure;
        const previewCatalogReady = !previewCatalogResult.error;
        const paymentConfirmationsNeedingReview = (paymentConfirmationsResult.data || []).filter((row: any) => {
            const data = row.payment_data || {};
            return data.paid === true
                && !data.confirmation_completed_at
                && String(data.confirmation_dispatch_state || '') === 'notification_reserved';
        }).length;
        const paymentConfirmationsReady = !paymentConfirmationsResult.error && paymentConfirmationsNeedingReview === 0;
        const healthy = databaseReady && eventStoreReady && memoryReady && deepseekConfigured
            && telegramConfigured && commerceReady && previewCatalogReady && elevenConfigured && paymentConfirmationsReady;
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
                memoryV2: memoryReady,
                deepseek: deepseekConfigured,
                telegram: telegramConfigured,
                commerce: commerceReady,
                paymentGateway: paymentGatewayConfigured,
                webhookSecurity: webhookSecure,
                previewCatalog: previewCatalogReady,
                elevenLabs: elevenConfigured,
                paymentConfirmations: paymentConfirmationsReady,
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
                realityStates: realityResult.count || 0,
                leadTwins: twinResult.count || 0,
                episodes: episodeResult.count || 0,
                memoryItems: memoryResult.count || 0,
                customOrders: customOrdersResult.count || 0,
                previewAssets: previewCatalogResult.count || 0,
                elevenLabsUsage: voiceBudgetResult.count || 0,
                paymentConfirmationsNeedingReview,
            },
            warnings: [
                ...errors,
                ...(!paymentGatewayConfigured ? ['payment_gateway_not_configured'] : []),
                ...(!webhookSecure ? ['payment_webhook_token_not_configured'] : []),
                ...(!elevenConfigured ? ['elevenlabs_not_ready'] : []),
                ...(paymentConfirmationsNeedingReview > 0 ? ['payment_confirmation_manual_review_required'] : []),
            ].slice(0, 6),
        }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
    } catch (error: any) {
        return NextResponse.json({
            ok: false,
            status: 'degraded',
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - startedAt,
            checks: {
                database: false, eventStore: false, memoryV2: false, deepseek: false, telegram: false,
                commerce: false, paymentGateway: false, webhookSecurity: false, previewCatalog: false, elevenLabs: false,
                paymentConfirmations: false,
            },
            warnings: [String(error?.message || error || 'health_check_failed')],
        }, { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } });
    }
}
