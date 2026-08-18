export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const DEFAULT_GEMINI_LITE_MODEL = "gemini-2.5-flash-lite";

export const OPENROUTER_MODEL_FALLBACK_ORDER = [
    "deepseek/deepseek-chat",
    "qwen/qwen-2.5-72b-instruct",
    "qwen/qwen-2.5-32b-instruct",
    "qwen/qwen-2.5-coder-32b-instruct",
] as const;

export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-chat";

export const normalizeOpenRouterPrimaryModel = (value?: string | null) => {
    const model = String(value || "").trim();
    if (!model || model.includes("deepseek-v4") || model.includes("qwen3.7") || model.includes("qwen3.8") || model.includes("nemotron-3")) {
        return DEFAULT_OPENROUTER_MODEL;
    }
    return model;
};

export const GEMINI_MODEL_OPTIONS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
] as const;

const GEMINI_MODEL_MIGRATIONS: Record<string, string> = {
    "gemini-3.6-flash": "gemini-2.5-flash",
    "gemini-3.5-flash-lite": "gemini-2.5-flash-lite",
    "gemini-3.5-flash": "gemini-2.5-flash",
    "gemini-3.1-flash-lite": "gemini-2.5-flash-lite",
};

export const normalizeGeminiModelName = (
    value?: string | null,
    fallback = DEFAULT_GEMINI_MODEL,
) => {
    const model = String(value || "").trim();
    if (!model) return fallback;
    return GEMINI_MODEL_MIGRATIONS[model] || model;
};
