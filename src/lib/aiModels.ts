export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_GEMINI_LITE_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";

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
