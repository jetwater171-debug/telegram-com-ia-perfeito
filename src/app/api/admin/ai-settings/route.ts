import { NextRequest, NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabaseServer";
import {
    DEFAULT_BAI_MODEL,
    DEFAULT_GEMINI_LITE_MODEL,
    DEFAULT_GEMINI_MODEL,
    DEFAULT_GROQ_QUALITY_MODEL,
    DEFAULT_GROQ_STARTER_MODEL,
    DEFAULT_OPENROUTER_MODEL,
    normalizeGeminiModelName,
    normalizeGroqModelName,
    normalizeBaiModelName,
    normalizeOpenRouterPrimaryModel,
} from "@/lib/aiModels";
import { DEFAULT_FISH_AUDIO_SETTINGS, normalizeFishAudioModel } from "@/lib/fishAudio";
import { aiGatewayRouter } from "@/lib/aiGatewayRouter";

const PROVIDERS = ["bai", "gemini", "groq", "nvidia", "cloudflare", "mistral", "openrouter", "cerebras", "custom"] as const;
type ProviderKey = typeof PROVIDERS[number];

const CONFIG_KEYS = [
    "bai_api_key", "bai_model",
    "openrouter_api_key", "gemini_api_key", "groq_api_key", "nvidia_api_key", "mistral_api_key", "cerebras_api_key",
    "cloudflare_ai_api_token", "cloudflare_account_id", "ai_custom_gateway_api_key", "ai_custom_gateway_base_url",
    "ai_custom_gateway_model", "ai_custom_gateway_tiers", "ai_custom_gateway_weight",
    "groq_model", "groq_starter_model", "nvidia_model", "mistral_model", "cerebras_model", "cloudflare_model",
    "openrouter_base_url", "openrouter_referer", "openrouter_title",
    "ai_model_order", "ai_strategy_model_order", "ai_draft_model_order", "ai_review_model_order", "ai_evaluator_model_order",
    "ai_strategy_enabled", "ai_review_enabled", "ai_evaluator_enabled", "ai_shared_rate_limit_enabled",
    "openrouter_strategy_model", "openrouter_draft_model", "openrouter_review_model", "openrouter_evaluator_model",
    "gemini_strategy_model", "gemini_draft_model", "gemini_review_model", "gemini_evaluator_model",
    "ai_gateway_recent_events", "ai_gateway_stats",
    "fish_audio_api_key", "fish_audio_enabled", "fish_audio_voice_id", "fish_audio_model",
    "fish_audio_frequency_percent", "fish_audio_cooldown_minutes", "fish_audio_max_chars",
    "mem0_api_key", "mem0_enabled", "mem0_top_k",
];

const DEFAULTS = {
    bai_model: process.env.BAI_MODEL || DEFAULT_BAI_MODEL,
    openrouter_base_url: "https://openrouter.ai/api/v1",
    openrouter_referer: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    openrouter_title: "Lari Telegram Bot",
    provider_order: PROVIDERS.join(","),
    openrouter_strategy_model: process.env.OPENROUTER_STRATEGY_MODEL || DEFAULT_OPENROUTER_MODEL,
    openrouter_draft_model: process.env.OPENROUTER_DRAFT_MODEL || DEFAULT_OPENROUTER_MODEL,
    openrouter_review_model: process.env.OPENROUTER_REVIEW_MODEL || DEFAULT_OPENROUTER_MODEL,
    openrouter_evaluator_model: process.env.OPENROUTER_EVALUATOR_MODEL || DEFAULT_OPENROUTER_MODEL,
    gemini_strategy_model: normalizeGeminiModelName(process.env.GEMINI_STRATEGY_MODEL || process.env.GEMINI_MODEL, DEFAULT_GEMINI_LITE_MODEL),
    gemini_draft_model: normalizeGeminiModelName(process.env.GEMINI_DRAFT_MODEL || process.env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL),
    gemini_review_model: normalizeGeminiModelName(process.env.GEMINI_REVIEW_MODEL || process.env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL),
    gemini_evaluator_model: normalizeGeminiModelName(process.env.GEMINI_EVALUATOR_MODEL || process.env.GEMINI_MODEL, DEFAULT_GEMINI_LITE_MODEL),
    groq_model: normalizeGroqModelName(process.env.GROQ_DRAFT_MODEL, DEFAULT_GROQ_QUALITY_MODEL),
    groq_starter_model: normalizeGroqModelName(process.env.GROQ_STARTER_MODEL, DEFAULT_GROQ_STARTER_MODEL),
    nvidia_model: process.env.NVIDIA_DRAFT_MODEL || "meta/llama-3.1-8b-instruct",
    mistral_model: process.env.MISTRAL_DRAFT_MODEL || "mistral-small-latest",
    cerebras_model: process.env.CEREBRAS_DRAFT_MODEL || "gpt-oss-120b",
    cloudflare_model: process.env.CLOUDFLARE_DRAFT_MODEL || "@cf/openai/gpt-oss-20b",
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
    try { return JSON.parse(value || ""); } catch { return fallback; }
};

const cleanText = (value: unknown, fallback = "", maxLength = 500) => String(value || fallback).trim().slice(0, maxLength);
const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
    const number = Number(value);
    return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback));
};

const normalizeProviderOrder = (value?: string) => {
    const parts = String(value || "")
        .split(",")
        .map((item) => item.trim().toLowerCase().split(":")[0] as ProviderKey)
        .filter((item): item is ProviderKey => PROVIDERS.includes(item));
    const legacyTwoProviderOrder = parts.length > 0 && parts.every((provider) => provider === "openrouter" || provider === "gemini");
    if (legacyTwoProviderOrder) return PROVIDERS.join(",");
    if (!parts.includes("bai")) return Array.from(new Set(["bai", ...parts, ...PROVIDERS])).join(",");
    return Array.from(new Set([...parts, ...PROVIDERS])).join(",");
};

const loadMap = async () => {
    const { data, error } = await supabase.from("bot_settings").select("key,value").in("key", CONFIG_KEYS);
    if (error) throw error;
    return Object.fromEntries((data || []).map((item: any) => [item.key, item.value || ""])) as Record<string, string>;
};

const secretState = (map: Record<string, string>, settingKey: string, envKey: string) => {
    const database = readSecret(map[settingKey]);
    const environment = readSecret(process.env[envKey]);
    return {
        masked: maskSecret(database || environment),
        saved: Boolean(database),
        source: database ? "database" : environment ? "vercel" : "missing",
    };
};

const buildSettings = (map: Record<string, string>) => {
    const bai = secretState(map, "bai_api_key", "BAI_API_KEY");
    const openrouter = secretState(map, "openrouter_api_key", "OPENROUTER_API_KEY");
    const gemini = secretState(map, "gemini_api_key", "GEMINI_API_KEY");
    const groq = secretState(map, "groq_api_key", "GROQ_API_KEY");
    const nvidia = secretState(map, "nvidia_api_key", "NVIDIA_API_KEY");
    const mistral = secretState(map, "mistral_api_key", "MISTRAL_API_KEY");
    const cerebras = secretState(map, "cerebras_api_key", "CEREBRAS_API_KEY");
    const cloudflare = secretState(map, "cloudflare_ai_api_token", "CLOUDFLARE_AI_API_TOKEN");
    const custom = secretState(map, "ai_custom_gateway_api_key", "AI_CUSTOM_GATEWAY_API_KEY");
    const fish = secretState(map, "fish_audio_api_key", "FISH_AUDIO_API_KEY");
    const mem0 = secretState(map, "mem0_api_key", "MEM0_API_KEY");

    return {
        baiApiKeyMasked: bai.masked, baiApiKeySaved: bai.saved, baiApiKeySource: bai.source,
        openrouterApiKeyMasked: openrouter.masked, openrouterApiKeySaved: openrouter.saved, openrouterApiKeySource: openrouter.source,
        geminiApiKeyMasked: gemini.masked, geminiApiKeySaved: gemini.saved, geminiApiKeySource: gemini.source,
        groqApiKeyMasked: groq.masked, groqApiKeySaved: groq.saved, groqApiKeySource: groq.source,
        nvidiaApiKeyMasked: nvidia.masked, nvidiaApiKeySaved: nvidia.saved, nvidiaApiKeySource: nvidia.source,
        mistralApiKeyMasked: mistral.masked, mistralApiKeySaved: mistral.saved, mistralApiKeySource: mistral.source,
        cerebrasApiKeyMasked: cerebras.masked, cerebrasApiKeySaved: cerebras.saved, cerebrasApiKeySource: cerebras.source,
        cloudflareApiTokenMasked: cloudflare.masked, cloudflareApiTokenSaved: cloudflare.saved, cloudflareApiTokenSource: cloudflare.source,
        customApiKeyMasked: custom.masked, customApiKeySaved: custom.saved, customApiKeySource: custom.source,
        fishAudioApiKeyMasked: fish.masked, fishAudioApiKeySaved: fish.saved, fishAudioApiKeySource: fish.source,
        mem0ApiKeyMasked: mem0.masked, mem0ApiKeySaved: mem0.saved, mem0ApiKeySource: mem0.source,
        openrouterBaseUrl: map.openrouter_base_url || DEFAULTS.openrouter_base_url,
        openrouterReferer: map.openrouter_referer || DEFAULTS.openrouter_referer,
        openrouterTitle: map.openrouter_title || DEFAULTS.openrouter_title,
        cloudflareAccountId: map.cloudflare_account_id || process.env.CLOUDFLARE_ACCOUNT_ID || "",
        customBaseUrl: map.ai_custom_gateway_base_url || process.env.AI_CUSTOM_GATEWAY_BASE_URL || "",
        customModel: map.ai_custom_gateway_model || process.env.AI_CUSTOM_DRAFT_MODEL || "auto",
        customTiers: map.ai_custom_gateway_tiers || process.env.AI_CUSTOM_GATEWAY_TIERS || "starter,buyer",
        customWeight: Number(map.ai_custom_gateway_weight || process.env.AI_CUSTOM_GATEWAY_WEIGHT || 5),
        baiModel: normalizeBaiModelName(map.bai_model || DEFAULTS.bai_model),
        groqModel: normalizeGroqModelName(map.groq_model, DEFAULTS.groq_model),
        groqStarterModel: normalizeGroqModelName(map.groq_starter_model, DEFAULTS.groq_starter_model),
        nvidiaModel: map.nvidia_model || DEFAULTS.nvidia_model,
        mistralModel: map.mistral_model || DEFAULTS.mistral_model,
        cerebrasModel: map.cerebras_model || DEFAULTS.cerebras_model,
        cloudflareModel: map.cloudflare_model || DEFAULTS.cloudflare_model,
        aiModelOrder: normalizeProviderOrder(map.ai_model_order || map.ai_draft_model_order || DEFAULTS.provider_order),
        aiStrategyModelOrder: normalizeProviderOrder(map.ai_strategy_model_order || DEFAULTS.provider_order),
        aiDraftModelOrder: normalizeProviderOrder(map.ai_draft_model_order || DEFAULTS.provider_order),
        aiReviewModelOrder: normalizeProviderOrder(map.ai_review_model_order || DEFAULTS.provider_order),
        aiEvaluatorModelOrder: normalizeProviderOrder(map.ai_evaluator_model_order || DEFAULTS.provider_order),
        aiStrategyEnabled: false,
        aiReviewEnabled: true,
        aiEvaluatorEnabled: false,
        aiSharedRateLimitEnabled: map.ai_shared_rate_limit_enabled !== "false",
        sharedRateLimitReady: Boolean(readSecret(process.env.SUPABASE_SERVICE_ROLE_KEY)),
        openrouterStrategyModel: normalizeOpenRouterPrimaryModel(map.openrouter_strategy_model || DEFAULTS.openrouter_strategy_model),
        openrouterDraftModel: normalizeOpenRouterPrimaryModel(map.openrouter_draft_model || DEFAULTS.openrouter_draft_model),
        openrouterReviewModel: normalizeOpenRouterPrimaryModel(map.openrouter_review_model || DEFAULTS.openrouter_review_model),
        openrouterEvaluatorModel: normalizeOpenRouterPrimaryModel(map.openrouter_evaluator_model || DEFAULTS.openrouter_evaluator_model),
        geminiStrategyModel: normalizeGeminiModelName(map.gemini_strategy_model, DEFAULTS.gemini_strategy_model),
        geminiDraftModel: normalizeGeminiModelName(map.gemini_draft_model, DEFAULTS.gemini_draft_model),
        geminiReviewModel: normalizeGeminiModelName(map.gemini_review_model, DEFAULTS.gemini_review_model),
        geminiEvaluatorModel: normalizeGeminiModelName(map.gemini_evaluator_model, DEFAULTS.gemini_evaluator_model),
        fishAudioEnabled: map.fish_audio_enabled === "true",
        fishAudioVoiceId: map.fish_audio_voice_id || DEFAULT_FISH_AUDIO_SETTINGS.voiceId,
        fishAudioModel: normalizeFishAudioModel(map.fish_audio_model || DEFAULT_FISH_AUDIO_SETTINGS.model),
        fishAudioFrequencyPercent: Number(map.fish_audio_frequency_percent || DEFAULT_FISH_AUDIO_SETTINGS.frequencyPercent),
        fishAudioCooldownMinutes: Number(map.fish_audio_cooldown_minutes || DEFAULT_FISH_AUDIO_SETTINGS.cooldownMinutes),
        fishAudioMaxChars: Math.min(320, Math.max(60, Number(map.fish_audio_max_chars) || DEFAULT_FISH_AUDIO_SETTINGS.maxChars)),
        mem0Enabled: map.mem0_enabled === "true",
        mem0TopK: Math.min(12, Math.max(3, Number(map.mem0_top_k) || 8)),
    };
};

export async function GET() {
    try {
        const map = await loadMap();
        const statsMap = parseJson(map.ai_gateway_stats || "{}", {});
        const stats = Object.values(statsMap).sort((a: any, b: any) => Number(b.error || 0) - Number(a.error || 0));
        return NextResponse.json({ settings: buildSettings(map), recentEvents: parseJson(map.ai_gateway_recent_events || "[]", []), stats, routerSnapshot: aiGatewayRouter.snapshot() });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "erro" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const providerOrder = normalizeProviderOrder(body.aiModelOrder || body.aiDraftModelOrder);
        const rows: { key: string; value: string }[] = [
            { key: "bai_model", value: normalizeBaiModelName(cleanText(body.baiModel, DEFAULTS.bai_model)) },
            { key: "openrouter_base_url", value: cleanText(body.openrouterBaseUrl, DEFAULTS.openrouter_base_url) },
            { key: "openrouter_referer", value: cleanText(body.openrouterReferer, DEFAULTS.openrouter_referer) },
            { key: "openrouter_title", value: cleanText(body.openrouterTitle, DEFAULTS.openrouter_title) },
            { key: "ai_model_order", value: providerOrder },
            { key: "ai_strategy_model_order", value: normalizeProviderOrder(body.aiStrategyModelOrder || providerOrder) },
            { key: "ai_draft_model_order", value: normalizeProviderOrder(body.aiDraftModelOrder || providerOrder) },
            { key: "ai_review_model_order", value: normalizeProviderOrder(body.aiReviewModelOrder || providerOrder) },
            { key: "ai_evaluator_model_order", value: normalizeProviderOrder(body.aiEvaluatorModelOrder || providerOrder) },
            { key: "ai_strategy_enabled", value: "false" },
            { key: "ai_review_enabled", value: "true" },
            { key: "ai_evaluator_enabled", value: "false" },
            { key: "ai_shared_rate_limit_enabled", value: body.aiSharedRateLimitEnabled === false ? "false" : "true" },
            { key: "openrouter_strategy_model", value: normalizeOpenRouterPrimaryModel(body.openrouterStrategyModel || DEFAULTS.openrouter_strategy_model) },
            { key: "openrouter_draft_model", value: normalizeOpenRouterPrimaryModel(body.openrouterDraftModel || DEFAULTS.openrouter_draft_model) },
            { key: "openrouter_review_model", value: normalizeOpenRouterPrimaryModel(body.openrouterReviewModel || DEFAULTS.openrouter_review_model) },
            { key: "openrouter_evaluator_model", value: normalizeOpenRouterPrimaryModel(body.openrouterEvaluatorModel || DEFAULTS.openrouter_evaluator_model) },
            { key: "gemini_strategy_model", value: normalizeGeminiModelName(body.geminiStrategyModel, DEFAULTS.gemini_strategy_model) },
            { key: "gemini_draft_model", value: normalizeGeminiModelName(body.geminiDraftModel, DEFAULTS.gemini_draft_model) },
            { key: "gemini_review_model", value: normalizeGeminiModelName(body.geminiReviewModel, DEFAULTS.gemini_review_model) },
            { key: "gemini_evaluator_model", value: normalizeGeminiModelName(body.geminiEvaluatorModel, DEFAULTS.gemini_evaluator_model) },
            { key: "groq_model", value: normalizeGroqModelName(cleanText(body.groqModel, DEFAULTS.groq_model), DEFAULTS.groq_model) },
            { key: "groq_starter_model", value: normalizeGroqModelName(cleanText(body.groqStarterModel, DEFAULTS.groq_starter_model), DEFAULTS.groq_starter_model) },
            { key: "nvidia_model", value: cleanText(body.nvidiaModel, DEFAULTS.nvidia_model) },
            { key: "mistral_model", value: cleanText(body.mistralModel, DEFAULTS.mistral_model) },
            { key: "cerebras_model", value: cleanText(body.cerebrasModel, DEFAULTS.cerebras_model) },
            { key: "cloudflare_model", value: cleanText(body.cloudflareModel, DEFAULTS.cloudflare_model) },
            { key: "cloudflare_account_id", value: cleanText(body.cloudflareAccountId) },
            { key: "ai_custom_gateway_base_url", value: cleanText(body.customBaseUrl, "", 1000) },
            { key: "ai_custom_gateway_model", value: cleanText(body.customModel, "auto") },
            { key: "ai_custom_gateway_tiers", value: cleanText(body.customTiers, "starter,buyer") },
            { key: "ai_custom_gateway_weight", value: String(clampNumber(body.customWeight, 1, 40, 5)) },
            { key: "fish_audio_enabled", value: body.fishAudioEnabled === true ? "true" : "false" },
            { key: "fish_audio_voice_id", value: cleanText(body.fishAudioVoiceId, DEFAULT_FISH_AUDIO_SETTINGS.voiceId) },
            { key: "fish_audio_model", value: normalizeFishAudioModel(body.fishAudioModel || DEFAULT_FISH_AUDIO_SETTINGS.model) },
            { key: "fish_audio_frequency_percent", value: String(clampNumber(body.fishAudioFrequencyPercent, 1, 100, DEFAULT_FISH_AUDIO_SETTINGS.frequencyPercent)) },
            { key: "fish_audio_cooldown_minutes", value: String(clampNumber(body.fishAudioCooldownMinutes, 1, 1440, DEFAULT_FISH_AUDIO_SETTINGS.cooldownMinutes)) },
            { key: "fish_audio_max_chars", value: String(clampNumber(body.fishAudioMaxChars, 60, 320, DEFAULT_FISH_AUDIO_SETTINGS.maxChars)) },
            { key: "mem0_enabled", value: body.mem0Enabled === true ? "true" : "false" },
            { key: "mem0_top_k", value: String(clampNumber(body.mem0TopK, 3, 12, 8)) },
        ];

        const secretInputs: Array<[string, unknown]> = [
            ["bai_api_key", body.baiApiKey],
            ["openrouter_api_key", body.openrouterApiKey], ["gemini_api_key", body.geminiApiKey],
            ["groq_api_key", body.groqApiKey], ["mistral_api_key", body.mistralApiKey],
            ["nvidia_api_key", body.nvidiaApiKey],
            ["cerebras_api_key", body.cerebrasApiKey], ["cloudflare_ai_api_token", body.cloudflareApiToken],
            ["ai_custom_gateway_api_key", body.customApiKey], ["fish_audio_api_key", body.fishAudioApiKey],
            ["mem0_api_key", body.mem0ApiKey],
        ];
        for (const [key, rawValue] of secretInputs) {
            const value = cleanText(rawValue, "", 4000);
            if (value && !value.includes("*")) rows.push({ key, value });
        }

        const { error } = await supabase.from("bot_settings").upsert(rows);
        if (error) throw error;
        return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "erro" }, { status: 500 });
    }
}

const fetchWithTimeout = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });

export async function PUT(req: NextRequest) {
    try {
        const body = await req.json();
        const provider = cleanText(body.provider).toLowerCase() as ProviderKey;
        if (!PROVIDERS.includes(provider)) return NextResponse.json({ error: "provedor inválido" }, { status: 400 });
        const map = await loadMap();
        const startedAt = Date.now();
        let response: Response;

        if (provider === "gemini") {
            const key = readSecret(body.apiKey) || readSecret(map.gemini_api_key) || readSecret(process.env.GEMINI_API_KEY);
            if (!key) throw new Error("cole ou salve a chave Gemini primeiro");
            response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
        } else if (provider === "openrouter") {
            const key = readSecret(body.apiKey) || readSecret(map.openrouter_api_key) || readSecret(process.env.OPENROUTER_API_KEY);
            if (!key) throw new Error("cole ou salve a chave OpenRouter primeiro");
            response = await fetchWithTimeout("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${key}` } });
        } else {
            const config = {
                bai: { key: readSecret(body.apiKey) || readSecret(map.bai_api_key) || readSecret(process.env.BAI_API_KEY), base: String(process.env.BAI_BASE_URL || "https://api.b.ai/v1").replace(/\/$/, "") },
                groq: { key: readSecret(body.apiKey) || readSecret(map.groq_api_key) || readSecret(process.env.GROQ_API_KEY), base: "https://api.groq.com/openai/v1" },
                nvidia: { key: readSecret(body.apiKey) || readSecret(map.nvidia_api_key) || readSecret(process.env.NVIDIA_API_KEY), base: "https://integrate.api.nvidia.com/v1" },
                mistral: { key: readSecret(body.apiKey) || readSecret(map.mistral_api_key) || readSecret(process.env.MISTRAL_API_KEY), base: "https://api.mistral.ai/v1" },
                cerebras: { key: readSecret(body.apiKey) || readSecret(map.cerebras_api_key) || readSecret(process.env.CEREBRAS_API_KEY), base: "https://api.cerebras.ai/v1" },
                cloudflare: { key: readSecret(body.apiKey) || readSecret(map.cloudflare_ai_api_token) || readSecret(process.env.CLOUDFLARE_AI_API_TOKEN), base: "" },
                custom: { key: readSecret(body.apiKey) || readSecret(map.ai_custom_gateway_api_key) || readSecret(process.env.AI_CUSTOM_GATEWAY_API_KEY), base: cleanText(body.baseUrl || map.ai_custom_gateway_base_url || process.env.AI_CUSTOM_GATEWAY_BASE_URL, "", 1000).replace(/\/$/, "") },
            }[provider];
            if (!config?.key) throw new Error(`cole ou salve a chave ${provider} primeiro`);
            if (provider === "cloudflare") {
                const accountId = cleanText(body.accountId || map.cloudflare_account_id || process.env.CLOUDFLARE_ACCOUNT_ID);
                if (!accountId) throw new Error("informe o Account ID da Cloudflare");
                response = await fetchWithTimeout(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`, { headers: { Authorization: `Bearer ${config.key}` } });
            } else if (provider === "nvidia" || provider === "bai") {
                const model = provider === "bai"
                    ? cleanText(body.model || map.bai_model || DEFAULTS.bai_model)
                    : cleanText(body.model || map.nvidia_model || DEFAULTS.nvidia_model);
                response = await fetchWithTimeout(`${config.base}/chat/completions`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
                    body: JSON.stringify(provider === "bai" ? {
                        model,
                        messages: [
                            { role: "system", content: "Retorne somente JSON válido no schema solicitado." },
                            { role: "user", content: "Teste de conexão do Master Brain. Confirme ok=true e repita o model id." },
                        ],
                        max_tokens: 96,
                        thinking: { type: "enabled" },
                        reasoning_effort: "low",
                        response_format: {
                            type: "json_schema",
                            json_schema: {
                                name: "master_brain_connection_test",
                                strict: true,
                                schema: {
                                    type: "object",
                                    properties: {
                                        ok: { type: "boolean" },
                                        model: { type: "string" },
                                    },
                                    required: ["ok", "model"],
                                    additionalProperties: false,
                                },
                            },
                        },
                    } : {
                        model,
                        messages: [{ role: "user", content: "Responda apenas OK" }],
                        max_tokens: 2,
                        temperature: 0,
                    }),
                });
            } else {
                if (!config.base) throw new Error("informe a URL base do gateway");
                response = await fetchWithTimeout(`${config.base}/models`, { headers: { Authorization: `Bearer ${config.key}` } });
            }
        }

        const text = await response.text();
        if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 240)}`);
        return NextResponse.json({ ok: true, latencyMs: Date.now() - startedAt, provider });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "teste falhou" }, { status: 400 });
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
