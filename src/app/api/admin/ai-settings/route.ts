import { NextRequest, NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabaseServer";

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
];

const DEFAULTS = {
    openrouter_base_url: "https://openrouter.ai/api/v1",
    openrouter_referer: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    openrouter_title: "Lari Telegram Bot",
    provider_order: "openrouter,gemini",
    openrouter_strategy_model: process.env.OPENROUTER_STRATEGY_MODEL || "z-ai/glm-4.5-air:free",
    openrouter_draft_model: process.env.OPENROUTER_DRAFT_MODEL || "z-ai/glm-4.5-air:free",
    openrouter_review_model: process.env.OPENROUTER_REVIEW_MODEL || "openai/gpt-oss-120b:free",
    openrouter_evaluator_model: process.env.OPENROUTER_EVALUATOR_MODEL || "openai/gpt-oss-120b:free",
    gemini_strategy_model: process.env.GEMINI_STRATEGY_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash",
    gemini_draft_model: process.env.GEMINI_DRAFT_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash",
    gemini_review_model: process.env.GEMINI_REVIEW_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash",
    gemini_evaluator_model: process.env.GEMINI_EVALUATOR_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash",
};

const maskSecret = (value?: string | null) => {
    const secret = String(value || "").trim();
    if (!secret) return "";
    if (secret.length <= 12) return "********";
    return `${secret.slice(0, 7)}...${secret.slice(-4)}`;
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
                openrouterApiKeyMasked: maskSecret(map.openrouter_api_key || process.env.OPENROUTER_API_KEY),
                geminiApiKeyMasked: maskSecret(map.gemini_api_key || process.env.GEMINI_API_KEY),
                openrouterApiKeySaved: Boolean(map.openrouter_api_key),
                geminiApiKeySaved: Boolean(map.gemini_api_key),
                openrouterBaseUrl: map.openrouter_base_url || DEFAULTS.openrouter_base_url,
                openrouterReferer: map.openrouter_referer || DEFAULTS.openrouter_referer,
                openrouterTitle: map.openrouter_title || DEFAULTS.openrouter_title,
                aiModelOrder: map.ai_model_order || "",
                aiStrategyModelOrder: normalizeProviderOrder(map.ai_strategy_model_order),
                aiDraftModelOrder: normalizeProviderOrder(map.ai_draft_model_order),
                aiReviewModelOrder: normalizeProviderOrder(map.ai_review_model_order),
                aiEvaluatorModelOrder: normalizeProviderOrder(map.ai_evaluator_model_order),
                openrouterStrategyModel: map.openrouter_strategy_model || DEFAULTS.openrouter_strategy_model,
                openrouterDraftModel: map.openrouter_draft_model || DEFAULTS.openrouter_draft_model,
                openrouterReviewModel: map.openrouter_review_model || DEFAULTS.openrouter_review_model,
                openrouterEvaluatorModel: map.openrouter_evaluator_model || DEFAULTS.openrouter_evaluator_model,
                geminiStrategyModel: map.gemini_strategy_model || DEFAULTS.gemini_strategy_model,
                geminiDraftModel: map.gemini_draft_model || DEFAULTS.gemini_draft_model,
                geminiReviewModel: map.gemini_review_model || DEFAULTS.gemini_review_model,
                geminiEvaluatorModel: map.gemini_evaluator_model || DEFAULTS.gemini_evaluator_model,
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
            { key: "openrouter_strategy_model", value: String(body.openrouterStrategyModel || DEFAULTS.openrouter_strategy_model).trim() },
            { key: "openrouter_draft_model", value: String(body.openrouterDraftModel || DEFAULTS.openrouter_draft_model).trim() },
            { key: "openrouter_review_model", value: String(body.openrouterReviewModel || DEFAULTS.openrouter_review_model).trim() },
            { key: "openrouter_evaluator_model", value: String(body.openrouterEvaluatorModel || DEFAULTS.openrouter_evaluator_model).trim() },
            { key: "gemini_strategy_model", value: String(body.geminiStrategyModel || DEFAULTS.gemini_strategy_model).trim() },
            { key: "gemini_draft_model", value: String(body.geminiDraftModel || DEFAULTS.gemini_draft_model).trim() },
            { key: "gemini_review_model", value: String(body.geminiReviewModel || DEFAULTS.gemini_review_model).trim() },
            { key: "gemini_evaluator_model", value: String(body.geminiEvaluatorModel || DEFAULTS.gemini_evaluator_model).trim() },
        ];

        const openrouterApiKey = String(body.openrouterApiKey || "").trim();
        const geminiApiKey = String(body.geminiApiKey || "").trim();
        if (openrouterApiKey && !openrouterApiKey.includes("*")) rows.push({ key: "openrouter_api_key", value: openrouterApiKey });
        if (geminiApiKey && !geminiApiKey.includes("*")) rows.push({ key: "gemini_api_key", value: geminiApiKey });

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
