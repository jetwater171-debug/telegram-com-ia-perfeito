export const BAI_MODEL_CATALOG = [
    { id: "glm-5.3-flash", label: "GLM-5.3 Flash", acceptsImage: true },
    { id: "qwen3.8-flash", label: "Qwen3.8 Flash", acceptsImage: true },
    { id: "hy3", label: "Hy3", acceptsImage: false },
] as const;

// Ordem estrita dentro da B.AI: qualidade primeiro. Uma falha, limite ou
// resposta invalida libera o proximo modelo sem trocar de provedor.
export const BAI_TEXT_MODEL_ORDER = BAI_MODEL_CATALOG.map((model) => model.id);
export const BAI_IMAGE_MODEL_ORDER = BAI_MODEL_CATALOG
    .filter((model) => model.acceptsImage)
    .map((model) => model.id);

export const DEFAULT_BAI_MODEL = BAI_TEXT_MODEL_ORDER[0];
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3.7-flash";
// Compatibilidade de nome com settings antigos: a rota "lite" agora aponta
// para o piso de qualidade 3.6, nunca para Flash-Lite ou Gemini 2.x.
export const DEFAULT_GEMINI_LITE_MODEL = "gemini-3.6-flash";
export const DEFAULT_GROQ_STARTER_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_GROQ_QUALITY_MODEL = "openai/gpt-oss-120b";

// Catálogo confirmado no NVIDIA Build. Os IDs abaixo são os IDs enviados ao
// endpoint hosted OpenAI-compatible; não são aliases inventados pelo painel.
export const NVIDIA_MODEL_CATALOG = [
    {
        id: "deepseek-ai/deepseek-v4-flash-0731",
        label: "DeepSeek V4 Flash 0731",
        acceptsImage: false,
        contextTokens: 1_000_000,
    },
    {
        id: "deepseek-ai/deepseek-v4-pro-0813",
        label: "DeepSeek V4 Pro 0813",
        acceptsImage: false,
        contextTokens: 1_000_000,
    },
    {
        id: "moonshotai/kimi-k3",
        label: "Kimi K3",
        acceptsImage: true,
        contextTokens: 1_000_000,
    },
    {
        id: "nvidia/nemotron-3.5-lightning-30b-a3b",
        label: "Nemotron 3.5 Lightning 30B A3B",
        acceptsImage: false,
        contextTokens: 1_000_000,
    },
] as const;

export const NVIDIA_TEXT_MODEL_ORDER = NVIDIA_MODEL_CATALOG.map((model) => model.id);
export const NVIDIA_IMAGE_MODEL_ORDER = NVIDIA_MODEL_CATALOG
    .filter((model) => model.acceptsImage)
    .map((model) => model.id);
export const DEFAULT_NVIDIA_MODEL = NVIDIA_TEXT_MODEL_ORDER[0];

const NVIDIA_MODEL_BY_ID = new Map<string, (typeof NVIDIA_MODEL_CATALOG)[number]>(
    NVIDIA_MODEL_CATALOG.map((model) => [model.id, model] as const),
);

export const normalizeNvidiaModelName = (value?: string | null) => {
    const model = String(value || "").trim().toLowerCase();
    return NVIDIA_MODEL_BY_ID.get(model)?.id || DEFAULT_NVIDIA_MODEL;
};

export const isNvidiaVisionModel = (value?: string | null) =>
    Boolean(NVIDIA_MODEL_BY_ID.get(normalizeNvidiaModelName(value).toLowerCase())?.acceptsImage);

export const OPENROUTER_MODEL_FALLBACK_ORDER = [
    "deepseek/deepseek-chat",
] as const;

export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-chat";

const BAI_MODEL_BY_ID = new Map<string, (typeof BAI_MODEL_CATALOG)[number]>(
    BAI_MODEL_CATALOG.map((model) => [model.id, model] as const),
);

export const normalizeBaiModelName = (value?: string | null) => {
    const model = String(value || "").trim();
    if (!model) return DEFAULT_BAI_MODEL;
    const normalized = model.toLowerCase();
    return BAI_MODEL_BY_ID.get(normalized)?.id || DEFAULT_BAI_MODEL;
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
    const normalized = OPENROUTER_MODEL_MIGRATIONS[model] || model;
    return (OPENROUTER_MODEL_FALLBACK_ORDER as readonly string[]).includes(normalized)
        ? normalized
        : DEFAULT_OPENROUTER_MODEL;
};

export const GEMINI_MODEL_OPTIONS = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
] as const;

const GEMINI_MODEL_MIGRATIONS: Record<string, string> = {
    "gemini-2.0-flash": "gemini-3.6-flash",
    "gemini-2.0-flash-lite": DEFAULT_GEMINI_LITE_MODEL,
    "gemini-2.0-flash-exp": "gemini-3.6-flash",
    "gemini-1.5-flash": "gemini-3.6-flash",
    "gemini-1.5-flash-8b": DEFAULT_GEMINI_LITE_MODEL,
    "gemini-1.5-pro": "gemini-3.6-flash",
    "gemini-1.5-pro-latest": "gemini-3.6-flash",
    "gemini-3.1-flash": DEFAULT_GEMINI_FALLBACK_MODEL,
    "gemini-flash": DEFAULT_GEMINI_MODEL,
    "gemini-flash-lite": DEFAULT_GEMINI_LITE_MODEL,
    "gemini-3.5-flash-lite": DEFAULT_GEMINI_LITE_MODEL,
};

export const normalizeGeminiModelName = (
    value?: string | null,
    fallback = DEFAULT_GEMINI_MODEL,
) => {
    const model = String(value || "").trim();
    if (!model) return fallback;
    const migrated = GEMINI_MODEL_MIGRATIONS[model] || model;
    const qualityFloor = GEMINI_MODEL_MIGRATIONS[migrated] || migrated;
    const approvedFallback = (GEMINI_MODEL_OPTIONS as readonly string[]).includes(fallback)
        ? fallback
        : DEFAULT_GEMINI_MODEL;
    if (/^gemini-(?:1|2)\./i.test(qualityFloor)) return DEFAULT_GEMINI_LITE_MODEL;
    return (GEMINI_MODEL_OPTIONS as readonly string[]).includes(qualityFloor)
        ? qualityFloor
        : approvedFallback;
};

const GROQ_MODEL_MIGRATIONS: Record<string, string> = {
    "openai/gpt-oss-20b": DEFAULT_GROQ_QUALITY_MODEL,
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
