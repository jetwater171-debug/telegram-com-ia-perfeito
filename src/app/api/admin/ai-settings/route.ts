import { NextRequest, NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabaseServer";
import {
    DEFAULT_GEMINI_LITE_MODEL,
    DEFAULT_GEMINI_MODEL,
    DEFAULT_OPENROUTER_MODEL,
    normalizeGeminiModelName,
} from "@/lib/aiModels";
import { DEFAULT_FISH_AUDIO_SETTINGS } from "@/lib/fishAudio";

const CONFIG_KEYS = [
    "openrouter_api_key",
    "gemini_api_key",
    "openrouter_base_url",
    "openrouter_referer",
    "openrouter_title",
    "ai_model_order",
    "ai_strategy_model_order",
    "ai_draft_model_order",
    "ai_review_model_order",
    "ai_evaluator_model_order",
    "ai_strategy_enabled",
    "ai_review_enabled",
    "ai_evaluator_enabled",
    "openrouter_strategy_model",
    "openrouter_draft_model",
    "openrouter_review_model",
    "openrouter_evaluator_model",
    "gemini_strategy_model",
    "gemini_draft_model",
    "gemini_review_model",
    "gemini_evaluator_model",
    "ai_gateway_recent_events",
    "ai_gateway_stats",
    "fish_audio_api_key",
    "fish_audio_enabled",
    "fish_audio_voice_id",
    "fish_audio_model",
    "fish_audio_frequency_percent",
    "fish_audio_cooldown_minutes",
    "fish_audio_max_chars",
];

const DEFAULTS = {
    openrouter_base_url: "https://openrouter.ai/api/v1",
    openrouter_referer: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    openrouter_title: "Lari Telegram Bot",
    provider_order: "openrouter,gemini",
    openrouter_strategy_model: process.env.OPENROUTER_STRATEGY_MODEL || DEFAULT_OPENROUTER_MODEL,
    openrouter_draft_model: process.env.OPENROUTER_DRAFT_MODEL || DEFAULT_OPENROUTER_MODEL,
    openrouter_review_model: process.env.OPENROUTER_REVIEW_MODEL || DEFAULT_OPENROUTER_MODEL,
    openrouter_evaluator_model: process.env.OPENROUTER_EVALUATOR_MODEL || DEFAULT_OPENROUTER_MODEL,
    gemini_strategy_model: normalizeGeminiModelName(process.env.GEMINI_STRATEGY_MODEL || process.env.GEMINI_MODEL, DEFAULT_GEMINI_LITE_MODEL),
    gemini_draft_model: normalizeGeminiModelName(process.env.GEMINI_DRAFT_MODEL || process.env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL),
    gemini_review_model: normalizeGeminiModelName(process.env.GEMINI_REVIEW_MODEL || process.env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL),
    gemini_evaluator_model: normalizeGeminiModelName(process.env.GEMINI_EVALUATOR_MODEL || process.env.GEMINI_MODEL, DEFAULT_GEMINI_LITE_MODEL),
};

const maskSecret = (value?: string | null) => {
    const secret = String(value || "").trim();
    if (!secret) return "";
    if (secret.length <= 12) return "********";
    return `${secret.slice(0, 7)}...${secret.slice(-4)}`;
};

const readSecret = (value?: string | null) => {
    const secret = String(value || "").trim();
    if (!secret || secret.startsWith("YOUR_")) return "";
    return secret;
};

const parseJson = (value: string, fallback: any) => {
    try {
        return JSON.parse(value || "");
    } catch {
        return fallback;
    }
};

const normalizeProviderOrder = (value?: string) => {
    const parts = String(value || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .map((item) => item.split(":")[0])
        .filter((item) => item === "openrouter" || item === "gemini");

    const unique = Array.from(new Set(parts));
    return unique.length ? unique.join(",") : DEFAULTS.provider_order;
};

const loadMap = async () => {
    const { data, error } = await supabase
        .from("bot_settings")
        .select("key,value")
        .in("key", CONFIG_KEYS);

    if (error) throw error;
    return Object.fromEntries((data || []).map((item: any) => [item.key, item.value || ""])) as Record<string, string>;
};

export async function GET() {
    try {
        const map = await loadMap();
        const statsMap = parseJson(map.ai_gateway_stats || "{}", {});
        const stats = Object.values(statsMap).sort((a: any, b: any) => Number(b.error || 0) - Number(a.error || 0));

        return NextResponse.json({
            settings: {
                openrouterApiKeyMasked: maskSecret(readSecret(map.openrouter_api_key) || readSecret(process.env.OPENROUTER_API_KEY)),
                geminiApiKeyMasked: maskSecret(readSecret(map.gemini_api_key) || readSecret(process.env.GEMINI_API_KEY)),
                openrouterApiKeySaved: Boolean(readSecret(map.openrouter_api_key)),
                geminiApiKeySaved: Boolean(readSecret(map.gemini_api_key)),
                fishAudioApiKeyMasked: maskSecret(readSecret(map.fish_audio_api_key) || readSecret(process.env.FISH_AUDIO_API_KEY)),
                fishAudioApiKeySaved: Boolean(readSecret(map.fish_audio_api_key)),
                fishAudioEnabled: map.fish_audio_enabled === "true",
                fishAudioVoiceId: map.fish_audio_voice_id || DEFAULT_FISH_AUDIO_SETTINGS.voiceId,
                fishAudioModel: map.fish_audio_model || DEFAULT_FISH_AUDIO_SETTINGS.model,
                fishAudioFrequencyPercent: Number(map.fish_audio_frequency_percent || DEFAULT_FISH_AUDIO_SETTINGS.frequencyPercent),
                fishAudioCooldownMinutes: Number(map.fish_audio_cooldown_minutes || DEFAULT_FISH_AUDIO_SETTINGS.cooldownMinutes),
                fishAudioMaxChars: Number(map.fish_audio_max_chars || DEFAULT_FISH_AUDIO_SETTINGS.maxChars),
                openrouterBaseUrl: map.openrouter_base_url || DEFAULTS.openrouter_base_url,
                openrouterReferer: map.openrouter_referer || DEFAULTS.openrouter_referer,
                openrouterTitle: map.openrouter_title || DEFAULTS.openrouter_title,
                aiModelOrder: map.ai_model_order || "",
                aiStrategyModelOrder: normalizeProviderOrder(map.ai_strategy_model_order),
                aiDraftModelOrder: normalizeProviderOrder(map.ai_draft_model_order),
                aiReviewModelOrder: normalizeProviderOrder(map.ai_review_model_order),
                aiEvaluatorModelOrder: normalizeProviderOrder(map.ai_evaluator_model_order),
                aiStrategyEnabled: map.ai_strategy_enabled !== "false",
                aiReviewEnabled: map.ai_review_enabled !== "false",
                aiEvaluatorEnabled: map.ai_evaluator_enabled !== "false",
                openrouterStrategyModel: map.openrouter_strategy_model || DEFAULTS.openrouter_strategy_model,
                openrouterDraftModel: map.openrouter_draft_model || DEFAULTS.openrouter_draft_model,
                openrouterReviewModel: map.openrouter_review_model || DEFAULTS.openrouter_review_model,
                openrouterEvaluatorModel: map.openrouter_evaluator_model || DEFAULTS.openrouter_evaluator_model,
                geminiStrategyModel: normalizeGeminiModelName(map.gemini_strategy_model, DEFAULTS.gemini_strategy_model),
                geminiDraftModel: normalizeGeminiModelName(map.gemini_draft_model, DEFAULTS.gemini_draft_model),
                geminiReviewModel: normalizeGeminiModelName(map.gemini_review_model, DEFAULTS.gemini_review_model),
                geminiEvaluatorModel: normalizeGeminiModelName(map.gemini_evaluator_model, DEFAULTS.gemini_evaluator_model),
            },
            recentEvents: parseJson(map.ai_gateway_recent_events || "[]", []),
            stats,
        });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "erro" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const rows: { key: string; value: string }[] = [
            { key: "openrouter_base_url", value: String(body.openrouterBaseUrl || DEFAULTS.openrouter_base_url).trim() },
            { key: "openrouter_referer", value: String(body.openrouterReferer || DEFAULTS.openrouter_referer).trim() },
            { key: "openrouter_title", value: String(body.openrouterTitle || DEFAULTS.openrouter_title).trim() },
            { key: "ai_model_order", value: normalizeProviderOrder(body.aiModelOrder) },
            { key: "ai_strategy_model_order", value: normalizeProviderOrder(body.aiStrategyModelOrder) },
            { key: "ai_draft_model_order", value: normalizeProviderOrder(body.aiDraftModelOrder) },
            { key: "ai_review_model_order", value: normalizeProviderOrder(body.aiReviewModelOrder) },
            { key: "ai_evaluator_model_order", value: normalizeProviderOrder(body.aiEvaluatorModelOrder) },
            { key: "ai_strategy_enabled", value: body.aiStrategyEnabled === false ? "false" : "true" },
            { key: "ai_review_enabled", value: body.aiReviewEnabled === false ? "false" : "true" },
            { key: "ai_evaluator_enabled", value: body.aiEvaluatorEnabled === false ? "false" : "true" },
            { key: "openrouter_strategy_model", value: String(body.openrouterStrategyModel || DEFAULTS.openrouter_strategy_model).trim() },
            { key: "openrouter_draft_model", value: String(body.openrouterDraftModel || DEFAULTS.openrouter_draft_model).trim() },
            { key: "openrouter_review_model", value: String(body.openrouterReviewModel || DEFAULTS.openrouter_review_model).trim() },
            { key: "openrouter_evaluator_model", value: String(body.openrouterEvaluatorModel || DEFAULTS.openrouter_evaluator_model).trim() },
            { key: "gemini_strategy_model", value: normalizeGeminiModelName(body.geminiStrategyModel, DEFAULTS.gemini_strategy_model) },
            { key: "gemini_draft_model", value: normalizeGeminiModelName(body.geminiDraftModel, DEFAULTS.gemini_draft_model) },
            { key: "gemini_review_model", value: normalizeGeminiModelName(body.geminiReviewModel, DEFAULTS.gemini_review_model) },
            { key: "gemini_evaluator_model", value: normalizeGeminiModelName(body.geminiEvaluatorModel, DEFAULTS.gemini_evaluator_model) },
            { key: "fish_audio_enabled", value: body.fishAudioEnabled === true ? "true" : "false" },
            { key: "fish_audio_voice_id", value: String(body.fishAudioVoiceId || DEFAULT_FISH_AUDIO_SETTINGS.voiceId).trim() },
            { key: "fish_audio_model", value: String(body.fishAudioModel || DEFAULT_FISH_AUDIO_SETTINGS.model).trim() },
            { key: "fish_audio_frequency_percent", value: String(Math.min(100, Math.max(1, Number(body.fishAudioFrequencyPercent) || DEFAULT_FISH_AUDIO_SETTINGS.frequencyPercent))) },
            { key: "fish_audio_cooldown_minutes", value: String(Math.min(1440, Math.max(1, Number(body.fishAudioCooldownMinutes) || DEFAULT_FISH_AUDIO_SETTINGS.cooldownMinutes))) },
            { key: "fish_audio_max_chars", value: String(Math.min(500, Math.max(60, Number(body.fishAudioMaxChars) || DEFAULT_FISH_AUDIO_SETTINGS.maxChars))) },
        ];

        const openrouterApiKey = String(body.openrouterApiKey || "").trim();
        const geminiApiKey = String(body.geminiApiKey || "").trim();
        const fishAudioApiKey = String(body.fishAudioApiKey || "").trim();
        if (openrouterApiKey && !openrouterApiKey.includes("*")) rows.push({ key: "openrouter_api_key", value: openrouterApiKey });
        if (geminiApiKey && !geminiApiKey.includes("*")) rows.push({ key: "gemini_api_key", value: geminiApiKey });
        if (fishAudioApiKey && !fishAudioApiKey.includes("*")) rows.push({ key: "fish_audio_api_key", value: fishAudioApiKey });

        const { error } = await supabase.from("bot_settings").upsert(rows);
        if (error) throw error;
        return NextResponse.json({ ok: true });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "erro" }, { status: 500 });
    }
}

export async function DELETE() {
    try {
        const { error } = await supabase.from("bot_settings").upsert([
            { key: "ai_gateway_recent_events", value: "[]" },
            { key: "ai_gateway_stats", value: "{}" },
        ]);
        if (error) throw error;
        return NextResponse.json({ ok: true });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "erro" }, { status: 500 });
    }
}
