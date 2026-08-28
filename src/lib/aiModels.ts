export const BAI_MODEL_CATALOG = [
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", acceptsImage: false },
    { id: "deepseek-v4-flash-vision-exp", label: "DeepSeek V4 Flash Vision Exp", acceptsImage: true },
    { id: "glm-5.3-flash", label: "GLM-5.3 Flash", acceptsImage: true },
    { id: "qwen3.8-flash", label: "Qwen3.8 Flash", acceptsImage: true },
    { id: "mimo-v2.5", label: "MiMo-V2.5", acceptsImage: true },
    { id: "hy3", label: "Hy3", acceptsImage: false },
] as const;

// Ordem estrita dentro da B.AI: qualidade primeiro. Uma falha, limite ou
// resposta invalida libera o proximo modelo sem trocar de provedor.
export const BAI_TEXT_MODEL_ORDER = BAI_MODEL_CATALOG.map((model) => model.id);
export const BAI_IMAGE_MODEL_ORDER = BAI_MODEL_CATALOG
    .filter((model) => model.acceptsImage)
    .map((model) => model.id);

export const DEFAULT_BAI_MODEL = BAI_TEXT_MODEL_ORDER[0];
export const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";
export const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3.6-flash";
export const DEFAULT_GEMINI_LITE_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GROQ_STARTER_MODEL = "openai/gpt-oss-20b";
export const DEFAULT_GROQ_QUALITY_MODEL = "openai/gpt-oss-120b";

export const OPENROUTER_MODEL_FALLBACK_ORDER = [
    "deepseek/deepseek-chat",
] as const;

export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-chat";

const BAI_MODEL_MIGRATIONS: Record<string, string> = {
    "deepseek-v4-flash-0731": DEFAULT_BAI_MODEL,
};

const BAI_MODEL_BY_ID = new Map<string, (typeof BAI_MODEL_CATALOG)[number]>(
    BAI_MODEL_CATALOG.map((model) => [model.id, model] as const),
);

export const normalizeBaiModelName = (value?: string | null) => {
    const model = String(value || "").trim();
    if (!model) return DEFAULT_BAI_MODEL;
    const normalized = model.toLowerCase();
    return BAI_MODEL_MIGRATIONS[normalized] || BAI_MODEL_BY_ID.get(normalized)?.id || model;
};

export const isBaiVisionModel = (value?: string | null) =>
    Boolean(BAI_MODEL_BY_ID.get(normalizeBaiModelName(value).toLowerCase())?.acceptsImage);

const OPENROUTER_MODEL_MIGRATIONS: Record<string, string> = {
    "deepseek/deepseek-v4-flash-0731": DEFAULT_OPENROUTER_MODEL,
    "deepseek/deepseek-v4-flash": DEFAULT_OPENROUTER_MODEL,
    "qwen/qwen3.7-flash": "qwen/qwen-2.5-72b-instruct",
    "qwen/qwen-2.5-32b-instruct": "qwen/qwen-2.5-72b-instruct",
    "qwen/qwen-2.5-coder-32b-instruct": "qwen/qwen-2.5-72b-instruct",
    "google/gemini-2.0-flash-001": DEFAULT_OPENROUTER_MODEL,
};

export const normalizeOpenRouterPrimaryModel = (value?: string | null) => {
    const model = String(value || "").trim();
    if (!model) return DEFAULT_OPENROUTER_MODEL;
    return OPENROUTER_MODEL_MIGRATIONS[model] || model;
};

export const GEMINI_MODEL_OPTIONS = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
] as const;

const GEMINI_MODEL_MIGRATIONS: Record<string, string> = {
    "gemini-2.5-flash-lite": "gemini-3.5-flash-lite",
    "gemini-2.5-flash": "gemini-3.6-flash",
    "gemini-2.0-flash": "gemini-3.6-flash",
    "gemini-2.0-flash-lite": "gemini-3.5-flash-lite",
    "gemini-2.0-flash-exp": "gemini-3.6-flash",
    "gemini-1.5-flash": "gemini-3.6-flash",
    "gemini-1.5-flash-8b": "gemini-3.5-flash-lite",
    "gemini-1.5-pro": "gemini-3.6-flash",
    "gemini-1.5-pro-latest": "gemini-3.6-flash",
    "gemini-3.1-flash": DEFAULT_GEMINI_FALLBACK_MODEL,
    "gemini-flash": DEFAULT_GEMINI_MODEL,
    "gemini-flash-lite": "gemini-3.5-flash-lite",
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
