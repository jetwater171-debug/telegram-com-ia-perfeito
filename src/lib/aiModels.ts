export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_GEMINI_LITE_MODEL = "gemini-3.5-flash-lite";

export const OPENROUTER_MODEL_FALLBACK_ORDER = [
    "deepseek/deepseek-v4-flash-0731",
    "deepseek/deepseek-v4-flash",
    "nvidia/nemotron-3-ultra-550b-a55b",
] as const;

export const DEFAULT_OPENROUTER_MODEL = OPENROUTER_MODEL_FALLBACK_ORDER[0];

export const normalizeOpenRouterPrimaryModel = (value?: string | null) => {
    const model = String(value || "").trim();
    if (!model || model === "deepseek/deepseek-v4-flash") {
        return DEFAULT_OPENROUTER_MODEL;
    }
    return model;
};

export const GEMINI_MODEL_OPTIONS = [
    DEFAULT_GEMINI_MODEL,
    DEFAULT_GEMINI_LITE_MODEL,
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
] as const;

const GEMINI_MODEL_MIGRATIONS: Record<string, string> = {
    "gemini-2.5-flash": DEFAULT_GEMINI_MODEL,
    "gemini-2.5-flash-lite": DEFAULT_GEMINI_LITE_MODEL,
    "gemini-2.0-flash": DEFAULT_GEMINI_MODEL,
    "gemini-2.0-flash-lite": DEFAULT_GEMINI_LITE_MODEL,
};

export const normalizeGeminiModelName = (
    value?: string | null,
    fallback = DEFAULT_GEMINI_MODEL,
) => {
    const model = String(value || "").trim();
    if (!model) return fallback;
    return GEMINI_MODEL_MIGRATIONS[model] || model;
};
