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
    maxChars: 240,
};

// A promocao gratuita do S2.1 Pro e o modelo escolhido para todos os audios da Lari.
// Normalizar tambem configuracoes antigas migra valores salvos sem exigir ajuste manual no painel.
export const normalizeFishAudioModel = (_value?: string | null) => 's2.1-pro-free';

export const normalizeFishAudioSettings = (input: Partial<FishAudioSettings>): FishAudioSettings => ({
    apiKey: String(input.apiKey || "").trim(),
    enabled: input.enabled === true,
    voiceId: String(input.voiceId || DEFAULT_FISH_AUDIO_SETTINGS.voiceId).trim(),
    model: normalizeFishAudioModel(input.model || DEFAULT_FISH_AUDIO_SETTINGS.model),
    frequencyPercent: clamp(Number(input.frequencyPercent) || DEFAULT_FISH_AUDIO_SETTINGS.frequencyPercent, 1, 100),
    cooldownMinutes: clamp(Number(input.cooldownMinutes) || DEFAULT_FISH_AUDIO_SETTINGS.cooldownMinutes, 1, 1440),
    maxChars: clamp(Number(input.maxChars) || DEFAULT_FISH_AUDIO_SETTINGS.maxChars, 60, 320),
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
        // Risada digitada é linguagem visual de chat, não uma fala. Quando a
        // risada for importante, o roteiro S2 usa [giggle] ou [laughing].
        .replace(/\bk{2,}\b/giu, "")
        .replace(/\b(?:rs){1,}\b/giu, "")
        .replace(/\bvdd\b/giu, "verdade")
        .replace(/\bbjs\b/giu, "beijos")
        .replace(/\btd\b/giu, "tudo")
        .replace(/\bobg\b/giu, "obrigada");

    // Pontuacao normal cria pausas melhores que reticencias artificiais em cada frase.
    text = text
        .replace(/\s*([,;:])\s*/g, '$1 ')
        .replace(/\s*([.!?])\s*/g, '$1 ')
        .replace(/\.{3,}|…{2,}/gu, '…')
        .replace(/\s+/g, ' ')
        .trim();

    if (text.length > maxChars) {
        const candidate = text.slice(0, maxChars + 1);
        const sentenceBoundary = Math.max(
            candidate.lastIndexOf('. '),
            candidate.lastIndexOf('! '),
            candidate.lastIndexOf('? '),
        );
        const minimumNaturalBoundary = Math.floor(maxChars * 0.55);
        const wordBoundary = candidate.lastIndexOf(' ');
        const cutAt = sentenceBoundary >= minimumNaturalBoundary
            ? sentenceBoundary + 1
            : wordBoundary >= minimumNaturalBoundary
                ? wordBoundary
                : maxChars;
        text = candidate.slice(0, cutAt).trim();
    }

    text = text.replace(/[,:;\-–—]+$/u, '').trim();
    // A transcrição também aparece no painel: cada sentença começa como uma
    // fala escrita de verdade, e não como uma continuação minúscula de chat.
    text = text.replace(/(^|[.!?]\s+)(\p{L})/gu, (_match, prefix: string, letter: string) =>
        `${prefix}${letter.toLocaleUpperCase('pt-BR')}`,
    );
    if (text && !/[.!?…]$/u.test(text)) text += '.';
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

    if (!speech) return '';

    // S2.1 usa instruções naturais em colchetes. Uma direção simples e bem
    // posicionada é mais estável que várias tags concorrentes no mesmo trecho.
    let cue = "[warm, natural, conversational Brazilian Portuguese, unhurried]";

    if (/(putaria|goz|tes[aã]o|fud|met|chup|safad|pelad|nude|molhad|calcinha|peit|bunda|delic|pau|gostos)/iu.test(context)) {
        cue = "[soft voice, playful, intimate, unhurried]";
    } else if (/(triste|sozinh|carente|carinho|abraç|chamego|dengo|saudade)/iu.test(context)) {
        cue = "[soft voice, tender, sincere, unhurried]";
    } else if (/(segredo|ningu[eé]m|escondid|só nosso|noite|cama)/iu.test(context)) {
        cue = "[whispering, playful, unhurried]";
    } else if (/(kkk|haha|engraç|rir|brinc)/iu.test(context)) {
        cue = "[giggle] [playful, natural, conversational]";
    }

    return `${cue} ${speech}`.trim();
};

export const stripFishS2Cues = (input: string) => String(input || '')
    .replace(/\[[^\]\r\n]{1,160}\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const validateFishOpus = (audio: Buffer) => {
    if (audio.length < 1_500) throw new Error("Fish Audio retornou áudio vazio ou incompleto");
    if (audio.subarray(0, 4).toString('ascii') !== 'OggS') {
        throw new Error("Fish Audio retornou um arquivo Opus inválido");
    }

    let offset = 0;
    let pages = 0;
    let hasOpusHead = false;
    while (offset < audio.length) {
        if (offset + 27 > audio.length || audio.subarray(offset, offset + 4).toString('ascii') !== 'OggS') {
            throw new Error("Fish Audio retornou um contêiner Ogg truncado");
        }
        const segmentCount = audio[offset + 26];
        const tableEnd = offset + 27 + segmentCount;
        if (tableEnd > audio.length) throw new Error("Fish Audio retornou uma página Ogg incompleta");
        let payloadLength = 0;
        for (let index = offset + 27; index < tableEnd; index += 1) payloadLength += audio[index];
        const pageEnd = tableEnd + payloadLength;
        if (pageEnd > audio.length) throw new Error("Fish Audio retornou dados Opus incompletos");
        if (audio.subarray(tableEnd, Math.min(pageEnd, tableEnd + 8)).toString('ascii').startsWith('OpusHead')) {
            hasOpusHead = true;
        }
        pages += 1;
        offset = pageEnd;
    }
    if (pages < 2 || !hasOpusHead) throw new Error("Fish Audio retornou um fluxo Opus incompleto");
    return { pages, bytes: audio.length };
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
    const spokenText = stripFishS2Cues(text);
    if (!spokenText || /\b(?:k{2,}|(?:rs){1,})\b/iu.test(spokenText)) {
        throw new Error("Roteiro Fish Audio sem fala válida");
    }

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
            opus_bitrate: 64000,
            latency: "normal",
            temperature: 0.62,
            top_p: 0.70,
            prosody: {
                speed: 0.98,
                volume: 0,
                normalize_loudness: true,
            },
            repetition_penalty: 1.20,
            chunk_length: 300,
            min_chunk_length: 50,
            max_new_tokens: 1024,
            early_stop_threshold: 1,
            normalize: true,
            condition_on_previous_chunks: true,
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
    const opus = validateFishOpus(audio);
    console.log('[FISH AUDIO] Gerado com sucesso', {
        model: normalized.model,
        inputChars: text.length,
        bytes: opus.bytes,
        oggPages: opus.pages,
        format: 'opus',
    });
    return audio;
};
