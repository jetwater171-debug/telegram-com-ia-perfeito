export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_GEMINI_LITE_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GROQ_STARTER_MODEL = "openai/gpt-oss-20b";
export const DEFAULT_GROQ_QUALITY_MODEL = "openai/gpt-oss-120b";

export const OPENROUTER_MODEL_FALLBACK_ORDER = [
    "deepseek/deepseek-v4-flash-0731",
    "deepseek/deepseek-v4-flash",
    "qwen/qwen3.7-flash",
    "nvidia/nemotron-3.5-lightning:free",
    "openrouter/free",
] as const;

export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash-0731";

const OPENROUTER_MODEL_MIGRATIONS: Record<string, string> = {
    "deepseek/deepseek-chat": DEFAULT_OPENROUTER_MODEL,
    "qwen/qwen-2.5-72b-instruct": "qwen/qwen3.7-flash",
    "qwen/qwen-2.5-32b-instruct": "qwen/qwen3.7-flash",
    "qwen/qwen-2.5-coder-32b-instruct": "qwen/qwen3.7-flash",
};

export const normalizeOpenRouterPrimaryModel = (value?: string | null) => {
    const model = String(value || "").trim();
    if (!model) return DEFAULT_OPENROUTER_MODEL;
    return OPENROUTER_MODEL_MIGRATIONS[model] || model;
};

export const GEMINI_MODEL_OPTIONS = [
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
] as const;

const GEMINI_MODEL_MIGRATIONS: Record<string, string> = {
    "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
    "gemini-2.5-flash": "gemini-3.6-flash",
    "gemini-2.0-flash": "gemini-3.6-flash",
    "gemini-1.5-flash": "gemini-3.6-flash",
    "gemini-3.5-flash": "gemini-3.6-flash",
    "gemini-3.1-flash-lite": "gemini-3.5-flash-lite",
};

export const normalizeGeminiModelName = (
    value?: string | null,
    fallback = DEFAULT_GEMINI_MODEL,
) => {
    const model = String(value || "").trim();
    if (!model) return fallback;
    return GEMINI_MODEL_MIGRATIONS[model] || model;
};

const GROQ_MODEL_MIGRATIONS: Record<string, string> = {
    "llama-3.1-8b-instant": DEFAULT_GROQ_STARTER_MODEL,
    "llama-3.3-70b-versatile": DEFAULT_GROQ_QUALITY_MODEL,
    "qwen/qwen3-32b": DEFAULT_GROQ_QUALITY_MODEL,
    "meta-llama/llama-4-scout-17b-16e-instruct": DEFAULT_GROQ_QUALITY_MODEL,
};

export const normalizeGroqModelName = (value?: string | null, fallback = DEFAULT_GROQ_STARTER_MODEL) => {
    const model = String(value || '').trim();
    if (!model) return fallback;
    return GROQ_MODEL_MIGRATIONS[model] || model;
};
