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
    "ai_gateway_recent_events",
    "ai_gateway_stats",
];

const DEFAULTS = {
    openrouter_base_url: "https://openrouter.ai/api/v1",
    openrouter_referer: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    openrouter_title: "Lari Telegram Bot",
    ai_strategy_model_order: "openrouter:z-ai/glm-4.5-air:free,openrouter:openai/gpt-oss-120b:free,openrouter:google/gemma-4-31b-it:free,openrouter:openrouter/free",
    ai_draft_model_order: "openrouter:z-ai/glm-4.5-air:free,openrouter:openai/gpt-oss-120b:free,openrouter:google/gemma-4-31b-it:free,openrouter:openrouter/free",
    ai_review_model_order: "openrouter:openai/gpt-oss-120b:free,openrouter:z-ai/glm-4.5-air:free,openrouter:google/gemma-4-31b-it:free,openrouter:openrouter/free",
    ai_evaluator_model_order: "openrouter:openai/gpt-oss-120b:free,openrouter:z-ai/glm-4.5-air:free,openrouter:google/gemma-4-31b-it:free,openrouter:openrouter/free",
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
                openrouterBaseUrl: map.openrouter_base_url || DEFAULTS.openrouter_base_url,
                openrouterReferer: map.openrouter_referer || DEFAULTS.openrouter_referer,
                openrouterTitle: map.openrouter_title || DEFAULTS.openrouter_title,
                aiModelOrder: map.ai_model_order || "",
                aiStrategyModelOrder: map.ai_strategy_model_order || DEFAULTS.ai_strategy_model_order,
                aiDraftModelOrder: map.ai_draft_model_order || DEFAULTS.ai_draft_model_order,
                aiReviewModelOrder: map.ai_review_model_order || DEFAULTS.ai_review_model_order,
                aiEvaluatorModelOrder: map.ai_evaluator_model_order || DEFAULTS.ai_evaluator_model_order,
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
            { key: "ai_model_order", value: String(body.aiModelOrder || "").trim() },
            { key: "ai_strategy_model_order", value: String(body.aiStrategyModelOrder || DEFAULTS.ai_strategy_model_order).trim() },
            { key: "ai_draft_model_order", value: String(body.aiDraftModelOrder || DEFAULTS.ai_draft_model_order).trim() },
            { key: "ai_review_model_order", value: String(body.aiReviewModelOrder || DEFAULTS.ai_review_model_order).trim() },
            { key: "ai_evaluator_model_order", value: String(body.aiEvaluatorModelOrder || DEFAULTS.ai_evaluator_model_order).trim() },
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
