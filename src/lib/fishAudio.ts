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
    /\b(?:manda|envia|grava|responde|fala|quero|solta)(?:\s+um|\s+uma|\s+em)?\s+(?:audio|áudio|voz|voice)|\b(?:audio|áudio)\s+(?:seu|sua|pra mim|para mim|falando)\b|\b(?:ouvir|escutar)\s+(?:sua\s+)?(?:voz|audio|áudio)\b|\bfala\s+(?:o\s+)?meu\s+nome\b|\bfalando\s+meu\s+nome\b/iu.test(text || "");

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
    if (!settings.enabled || !settings.apiKey || !settings.voiceId) return false;
    if (isUnsafeForVoice(messageText)) return false;
    if (userAskedForAudio(userText)) return true;
    if (hasRecentAudio) return false;
    if (!messageText.trim() || messageText.length > settings.maxChars || messageText.length < 15) return false;
    if (action !== "none" || /^(PAYMENT_CHECK|CLOSING)$/i.test(stage)) return false;
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

export const cleanTextForSpeech = (input: string, maxChars = 320) => {
    let text = String(input || "")
        .replace(/https?:\/\/\S+/giu, "")
        .replace(/[*_`>#~]/g, "")
        .replace(/\p{Extended_Pictographic}/gu, "")
        .replace(/\s+/g, " ")
        .trim();
    text = expandChatWriting(text);
    text = text
        .replace(/\bkk{2,}\b/giu, "ha ha ha")
        .replace(/\brsrs+\b/giu, "he he")
        .replace(/\bvdd\b/giu, "verdade")
        .replace(/\bbjs\b/giu, "beijos")
        .replace(/\btd\b/giu, "tudo")
        .replace(/\bobg\b/giu, "obrigada");

    text = text.slice(0, maxChars).trim();
    // Suaviza pontuação para criar pausas respiratórias e sensuais realistas
    text = text.replace(/([,;])\s*/g, "$1 ... ");
    text = text.replace(/([.!?])\s*/g, "$1 ... ");
    if (text && !/[.!?…]$/u.test(text)) text += "...";
    return text;
};

export const buildExpressiveSpeech = ({
    messageText,
    userText = "",
    emotionalContext = "",
    maxChars = 320,
}: {
    messageText: string;
    userText?: string;
    emotionalContext?: string;
    maxChars?: number;
}) => {
    const speech = cleanTextForSpeech(messageText, maxChars);
    const context = `${userText} ${emotionalContext} ${messageText}`.toLowerCase();

    // Tags acústicas expressivas, ofegantes e com textura humana
    let cues = "[whispering][sensual][breathing][soft tone]";
    let prefixVocal = "hummm... ";

    if (/(putaria|goz|tes[aã]o|fud|met|chup|safad|pelad|nude|molhad|calcinha|peit|bunda|delic|pau|gostos)/iu.test(context)) {
        cues = "[whispering][sensual][moaning softly][breathing]";
        prefixVocal = "ai... ";
    } else if (/(triste|sozinh|carente|carinho|abraç|chamego|dengo|saudade)/iu.test(context)) {
        cues = "[whispering][soft tone][warm and playful]";
        prefixVocal = "vem cá... ";
    } else if (/(segredo|ningu[eé]m|escondid|só nosso|noite|cama)/iu.test(context)) {
        cues = "[whispering][sensual][mysterious]";
        prefixVocal = "fala baixinho... ";
    } else if (/(kkk|haha|engraç|rir|brinc)/iu.test(context)) {
        cues = "[whispering][chuckling][warm and teasing]";
        prefixVocal = "olha... ";
    }

    // Evita duplicar introduções se a frase já começa naturalmente com interjeição
    if (/^(oi|oii|eai|olá|hum|ai|vem|amor|nossa|olha|sabe)/i.test(speech)) {
        return `${cues} ${speech}`.trim();
    }

    return `${cues} ${prefixVocal}${speech}`.trim();
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
            format: "mp3",
            latency: "normal",
            temperature: 0.80,
            top_p: 0.80,
            repetition_penalty: 1.12,
            chunk_length: 220,
            normalize: true,
            condition_on_previous_chunks: true,
            prosody: {
                speed: 0.94,
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
