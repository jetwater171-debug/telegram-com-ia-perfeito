export type ElevenLabsSettings = {
    apiKey: string;
    enabled: boolean;
    voiceId: string;
    model: string;
    frequencyPercent: number;
    cooldownMinutes: number;
    maxChars: number;
};

const ELEVENLABS_TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const DEFAULT_ELEVENLABS_SETTINGS: Omit<ElevenLabsSettings, 'apiKey'> = {
    enabled: false,
    voiceId: 'vcYWBf5QTtDLdbfB20xT',
    model: 'eleven_v3',
    frequencyPercent: 18,
    cooldownMinutes: 30,
    maxChars: 300,
};

export const normalizeElevenLabsModel = (_value?: string | null) => 'eleven_v3';

export const normalizeElevenLabsSettings = (input: Partial<ElevenLabsSettings>): ElevenLabsSettings => ({
    apiKey: String(input.apiKey || '').trim(),
    enabled: input.enabled === true,
    voiceId: String(input.voiceId || DEFAULT_ELEVENLABS_SETTINGS.voiceId).trim(),
    model: normalizeElevenLabsModel(input.model || DEFAULT_ELEVENLABS_SETTINGS.model),
    frequencyPercent: clamp(Number(input.frequencyPercent) || DEFAULT_ELEVENLABS_SETTINGS.frequencyPercent, 1, 100),
    cooldownMinutes: clamp(Number(input.cooldownMinutes) || DEFAULT_ELEVENLABS_SETTINGS.cooldownMinutes, 1, 1440),
    maxChars: clamp(Number(input.maxChars) || DEFAULT_ELEVENLABS_SETTINGS.maxChars, 60, 500),
});

const deterministicPercent = (seed: string) => {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 100;
};

export const userAskedForElevenLabsAudio = (text: string) =>
    /\b(?:manda|envia|grava|responde|fala|quero|solta)(?:\s+um|\s+uma|\s+em)?\s+(?:audio|áudio|voz|voice)|\b(?:audio|áudio)\s+(?:seu|sua|pra mim|para mim|falando)\b|\b(?:ouvir|escutar)\s+(?:sua\s+)?(?:voz|audio|áudio)\b|\bfala\s+(?:o\s+)?meu\s+nome\b|\bfalando\s+meu\s+nome\b/iu.test(text || '');

export const isUnsafeForElevenLabsVoice = (text: string) =>
    /(?:https?:\/\/|www\.|pix|copia\s*e\s*cola|código|codigo|r\$|pagamento|comprovante)/iu.test(text || '');

export const shouldUseElevenLabsAudio = ({
    settings,
    seed,
    userText,
    messageText,
    stage,
    action,
    hasRecentAudio,
}: {
    settings: ElevenLabsSettings;
    seed: string;
    userText: string;
    messageText: string;
    stage: string;
    action: string;
    hasRecentAudio: boolean;
}) => {
    if (!settings.enabled || !settings.apiKey || !settings.voiceId) return false;
    if (isUnsafeForElevenLabsVoice(messageText)) return false;
    if (userAskedForElevenLabsAudio(userText)) return true;
    if (hasRecentAudio) return false;
    if (!messageText.trim() || messageText.length > settings.maxChars || messageText.length < 15) return false;
    if (action !== 'none' || /^(PAYMENT_CHECK|CLOSING)$/i.test(stage)) return false;
    return deterministicPercent(seed) < settings.frequencyPercent;
};

const expandChatWriting = (text: string) => {
    const replacements: Array<[RegExp, string]> = [
        [/\bvc\b/giu, 'você'], [/\bvcs\b/giu, 'vocês'], [/\btbm\b/giu, 'também'],
        [/\bpq\b/giu, 'porque'], [/\bq\b/giu, 'que'], [/\bblz\b/giu, 'beleza'],
        [/\bmsg\b/giu, 'mensagem'], [/\bta\b/giu, 'tá'], [/\bto\b/giu, 'tô'],
        [/\bnao\b/giu, 'não'], [/\bso\b/giu, 'só'], [/\bvoce\b/giu, 'você'],
    ];
    return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
};

export const stripElevenV3Tags = (input: string) => String(input || '')
    .replace(/\[[^\]\r\n]{1,80}\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const cleanTextForElevenLabsSpeech = (input: string, maxChars = 500) => {
    let text = stripElevenV3Tags(String(input || ''))
        .replace(/https?:\/\/\S+/giu, '')
        .replace(/[*_`>#~]/g, '')
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
    text = expandChatWriting(text)
        .replace(/\bk{2,}\b/giu, '')
        .replace(/\b(?:rs){1,}\b/giu, '')
        .replace(/\bvdd\b/giu, 'verdade')
        .replace(/\bbjs\b/giu, 'beijos')
        .replace(/\btd\b/giu, 'tudo')
        .replace(/\bobg\b/giu, 'obrigada')
        .replace(/\s*([,;:])\s*/g, '$1 ')
        .replace(/\s*([.!?])\s*/g, '$1 ')
        .replace(/\.{3,}|…{2,}/gu, '…')
        .replace(/\s+/g, ' ')
        .trim();

    if (text.length > maxChars) {
        const candidate = text.slice(0, maxChars + 1);
        const sentenceBoundary = Math.max(candidate.lastIndexOf('. '), candidate.lastIndexOf('! '), candidate.lastIndexOf('? '));
        const minimumNaturalBoundary = Math.floor(maxChars * 0.55);
        const wordBoundary = candidate.lastIndexOf(' ');
        const cutAt = sentenceBoundary >= minimumNaturalBoundary
            ? sentenceBoundary + 1
            : wordBoundary >= minimumNaturalBoundary ? wordBoundary : maxChars;
        text = candidate.slice(0, cutAt).trim();
    }

    text = text.replace(/[,:;\-–—]+$/u, '').trim();
    text = text.replace(/(^|[.!?]\s+)(\p{L})/gu, (_match, prefix: string, letter: string) =>
        `${prefix}${letter.toLocaleUpperCase('pt-BR')}`,
    );
    if (text && !/[.!?…]$/u.test(text)) text += '.';
    return text;
};

export const buildElevenV3Performance = ({
    messageText,
    userText = '',
    emotionalContext = '',
    maxChars = 500,
}: {
    messageText: string;
    userText?: string;
    emotionalContext?: string;
    maxChars?: number;
}) => {
    const speech = cleanTextForElevenLabsSpeech(messageText, maxChars);
    const context = `${userText} ${emotionalContext} ${messageText}`.toLowerCase();
    if (!speech) return '';

    if (/(putaria|goz|tes[aã]o|fud|met|chup|safad|pelad|nude|molhad|calcinha|peit|bunda|pau|gostos|gemid)/iu.test(context)) {
        return `[seductively] ${speech} [breathes softly]`;
    }
    if (/(segredo|ningu[eé]m|escondid|só nosso|noite|cama|baixinho)/iu.test(context)) {
        return `[seductively] [whispers] ${speech}`;
    }
    if (/(kkk|haha|engraç|rir|brinc|provoc)/iu.test(context)) {
        return `[seductively] ${speech} [giggles]`;
    }
    if (/(triste|sozinh|carente|carinho|abraç|chamego|dengo|saudade)/iu.test(context)) {
        return `[softly] ${speech} [sighs]`;
    }
    return `[seductively] ${speech}`;
};

export const validateElevenLabsOpus = (audio: Buffer) => {
    if (audio.length < 1_500) throw new Error('ElevenLabs retornou áudio vazio ou incompleto');
    if (audio.subarray(0, 4).toString('ascii') !== 'OggS') throw new Error('ElevenLabs não retornou OGG/Opus');
    if (!audio.includes(Buffer.from('OpusHead'))) throw new Error('ElevenLabs retornou OGG sem OpusHead');
    return { bytes: audio.length };
};

export const generateElevenLabsAudio = async ({
    settings,
    text,
}: {
    settings: ElevenLabsSettings;
    text: string;
}): Promise<{
    audio: Buffer;
    usage: { actualCredits: number; requestId: string; spokenChars: number; taggedChars: number };
}> => {
    const normalized = normalizeElevenLabsSettings(settings);
    if (!normalized.apiKey) throw new Error('ElevenLabs sem API key');
    if (!normalized.voiceId) throw new Error('ElevenLabs sem Voice ID');
    const spokenText = cleanTextForElevenLabsSpeech(text, normalized.maxChars);
    if (!spokenText) throw new Error('Roteiro ElevenLabs sem fala válida');

    const response = await fetch(`${ELEVENLABS_TTS_URL}/${encodeURIComponent(normalized.voiceId)}?output_format=opus_48000_64`, {
        method: 'POST',
        headers: {
            'xi-api-key': normalized.apiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/ogg,application/json',
        },
        body: JSON.stringify({
            text,
            model_id: normalized.model,
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.9,
                style: 0.65,
                use_speaker_boost: true,
                speed: 0.92,
            },
        }),
        signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
        const requestId = response.headers.get('request-id') || response.headers.get('x-request-id') || '';
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`ElevenLabs ${response.status}${requestId ? ` (${requestId})` : ''}: ${detail}`);
    }

    const audio = Buffer.from(await response.arrayBuffer());
    const opus = validateElevenLabsOpus(audio);
    const headerCost = Number(response.headers.get('character-cost'));
    const actualCredits = Number.isFinite(headerCost) && headerCost >= 0
        ? Math.ceil(headerCost)
        : text.length;
    const requestId = response.headers.get('request-id') || response.headers.get('x-request-id') || '';
    console.log('[ELEVENLABS] Áudio gerado', {
        model: normalized.model,
        voiceId: normalized.voiceId,
        spokenChars: spokenText.length,
        taggedChars: text.length,
        actualCredits,
        bytes: opus.bytes,
        format: 'opus_48000_64',
    });
    return {
        audio,
        usage: { actualCredits, requestId, spokenChars: spokenText.length, taggedChars: text.length },
    };
};
