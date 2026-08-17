export type FishAudioSettings = {
    apiKey: string;
    enabled: boolean;
    voiceId: string;
    model: string;
    frequencyPercent: number;
    cooldownMinutes: number;
    maxChars: number;
};

const FISH_TTS_URL = "https://api.fish.audio/v1/tts";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const DEFAULT_FISH_AUDIO_SETTINGS: Omit<FishAudioSettings, "apiKey"> = {
    enabled: false,
    voiceId: "24522123b5804bf691a8450d9187f03e",
    model: "s2.1-pro-free",
    frequencyPercent: 18,
    cooldownMinutes: 30,
    maxChars: 280,
};

export const normalizeFishAudioSettings = (input: Partial<FishAudioSettings>): FishAudioSettings => ({
    apiKey: String(input.apiKey || "").trim(),
    enabled: input.enabled === true,
    voiceId: String(input.voiceId || DEFAULT_FISH_AUDIO_SETTINGS.voiceId).trim(),
    model: String(input.model || DEFAULT_FISH_AUDIO_SETTINGS.model).trim(),
    frequencyPercent: clamp(Number(input.frequencyPercent) || DEFAULT_FISH_AUDIO_SETTINGS.frequencyPercent, 1, 100),
    cooldownMinutes: clamp(Number(input.cooldownMinutes) || DEFAULT_FISH_AUDIO_SETTINGS.cooldownMinutes, 1, 1440),
    maxChars: clamp(Number(input.maxChars) || DEFAULT_FISH_AUDIO_SETTINGS.maxChars, 60, 500),
});

const deterministicPercent = (seed: string) => {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 100;
};

export const userAskedForAudio = (text: string) =>
    /\b(?:manda|envia|grava|responde|fala)(?:\s+um|\s+uma|\s+em)?\s+(?:audio|áudio|voz|voice)|\b(?:audio|áudio)\s+(?:seu|sua|pra mim|para mim)\b/iu.test(text || "");

export const isUnsafeForVoice = (text: string) =>
    /(?:https?:\/\/|www\.|pix|copia\s*e\s*cola|código|codigo|r\$|pagamento|comprovante)/iu.test(text || "");

export const shouldUseFishAudio = ({
    settings,
    seed,
    userText,
    messageText,
    stage,
    action,
    hasRecentAudio,
}: {
    settings: FishAudioSettings;
    seed: string;
    userText: string;
    messageText: string;
    stage: string;
    action: string;
    hasRecentAudio: boolean;
}) => {
    if (!settings.enabled || !settings.apiKey || !settings.voiceId || hasRecentAudio) return false;
    if (!messageText.trim() || messageText.length > settings.maxChars || messageText.length < 12) return false;
    if (isUnsafeForVoice(messageText)) return false;
    if (action !== "none" || /^(PAYMENT_CHECK|CLOSING)$/i.test(stage)) return false;
    if (userAskedForAudio(userText)) return true;
    return deterministicPercent(seed) < settings.frequencyPercent;
};

const expandChatWriting = (text: string) => {
    const replacements: Array<[RegExp, string]> = [
        [/\bvc\b/giu, "você"],
        [/\bvcs\b/giu, "vocês"],
        [/\btbm\b/giu, "também"],
        [/\bpq\b/giu, "porque"],
        [/\bq\b/giu, "que"],
        [/\bblz\b/giu, "beleza"],
        [/\bmsg\b/giu, "mensagem"],
        [/\bta\b/giu, "tá"],
        [/\bto\b/giu, "tô"],
        [/\bnao\b/giu, "não"],
        [/\bso\b/giu, "só"],
        [/\bvoce\b/giu, "você"],
    ];
    return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
};

export const cleanTextForSpeech = (input: string, maxChars = 280) => {
    let text = String(input || "")
        .replace(/https?:\/\/\S+/giu, "")
        .replace(/[*_`>#~]/g, "")
        .replace(/\p{Extended_Pictographic}/gu, "")
        .replace(/\s+/g, " ")
        .trim();
    text = expandChatWriting(text);
    text = text.replace(/\bkk{3,}\b/giu, "ha ha ha").replace(/\brsrs+\b/giu, "he he");
    text = text.slice(0, maxChars).trim();
    if (text && !/[.!?…]$/u.test(text)) text += ".";
    return text;
};

export const buildExpressiveSpeech = ({
    messageText,
    userText = "",
    emotionalContext = "",
    maxChars = 280,
}: {
    messageText: string;
    userText?: string;
    emotionalContext?: string;
    maxChars?: number;
}) => {
    const speech = cleanTextForSpeech(messageText, maxChars);
    const context = `${userText} ${emotionalContext} ${messageText}`.toLowerCase();

    let cues = "[relaxed][soft tone]";
    if (/(triste|chor|sozinh|mal|saudade|carente|desanim|machuc)/iu.test(context)) {
        cues = "[empathetic][soft tone]";
    } else if (/(kkkk|haha|rsrs|engraç|rir|rindo)/iu.test(context)) {
        cues = "[happy][chuckling]";
    } else if (/(amei|adorei|feliz|consegui|perfeito|maravilh|ansios)/iu.test(context)) {
        cues = "[happy][warm and playful]";
    } else if (/(segredo|baixinho|ningu[eé]m pode|só entre)/iu.test(context)) {
        cues = "[mysterious][whispering]";
    } else if (/(amor|carinho|saudade|gostoso|safad|tes[aã]o|beij)/iu.test(context)) {
        cues = "[warm and teasing][soft tone]";
    } else if (/[!?]{2,}|\b(?:agora|corre|rápido|rapido)\b/iu.test(context)) {
        cues = "[excited]";
    }

    return `${cues} ${speech}`.trim();
};

export const generateFishAudio = async ({
    settings,
    text,
}: {
    settings: FishAudioSettings;
    text: string;
}): Promise<Buffer> => {
    const normalized = normalizeFishAudioSettings(settings);
    if (!normalized.apiKey) throw new Error("Fish Audio sem API key");
    if (!normalized.voiceId) throw new Error("Fish Audio sem voz configurada");

    const response = await fetch(FISH_TTS_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${normalized.apiKey}`,
            "Content-Type": "application/json",
            model: normalized.model,
        },
        body: JSON.stringify({
            text,
            reference_id: normalized.voiceId,
            format: "opus",
            sample_rate: 48000,
            opus_bitrate: 32000,
            latency: "normal",
            temperature: 0.72,
            top_p: 0.72,
            repetition_penalty: 1.15,
            chunk_length: 200,
            normalize: true,
            condition_on_previous_chunks: true,
            prosody: {
                speed: 0.98,
                volume: 0,
                normalize_loudness: true,
            },
            features: ["quality-guard"],
        }),
        signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
        const requestId = response.headers.get("x-request-id") || response.headers.get("request-id") || "";
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`Fish Audio ${response.status}${requestId ? ` (${requestId})` : ""}: ${detail}`);
    }

    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length < 100) throw new Error("Fish Audio retornou áudio vazio");
    return audio;
};
