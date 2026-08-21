import { buildExpressiveSpeech, cleanTextForSpeech } from '@/lib/fishAudio';

export type FishAudioScriptAgentSettings = {
    apiKey: string;
    model: string;
    baseUrl: string;
    timeoutMs?: number;
};

export type PreparedFishAudioScript = {
    spokenText: string;
    fishText: string;
    delivery: string;
    reaction: string;
    source: 'deepseek' | 'deterministic';
};

type FetchLike = typeof fetch;

const DEFAULT_DELIVERY = 'warm, natural, conversational Brazilian Portuguese, unhurried';
const ALLOWED_REACTIONS = new Set(['', 'giggle', 'chuckling', 'sigh', 'pause', 'short pause', 'inhale']);

const cleanInlineValue = (value: unknown, max = 140) => String(value || '')
    .replace(/[\[\]{}<>`"']/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const normalizeWords = (value: string) => value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1);

const preservesOriginalSpeech = (original: string, candidate: string) => {
    const originalWords = new Set(normalizeWords(original));
    const candidateWords = normalizeWords(candidate);
    if (candidateWords.length === 0) return false;
    if (originalWords.size <= 3) return candidateWords.length <= originalWords.size + 2;
    const retained = candidateWords.filter((word) => originalWords.has(word)).length;
    return retained / candidateWords.length >= 0.58 && candidate.length <= Math.max(original.length * 1.35, original.length + 24);
};

const parseJsonObject = (raw: string) => {
    const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
        throw new Error('DeepSeek não retornou JSON para o roteiro de voz');
    }
};

const makeDeterministicScript = ({
    messageText,
    userText,
    emotionalContext,
    maxChars,
}: {
    messageText: string;
    userText: string;
    emotionalContext: string;
    maxChars: number;
}): PreparedFishAudioScript => {
    const spokenText = cleanTextForSpeech(messageText, maxChars);
    const fishText = buildExpressiveSpeech({ messageText, userText, emotionalContext, maxChars });
    return {
        spokenText,
        fishText,
        delivery: cleanInlineValue(fishText.match(/^\[([^\]]+)\]/)?.[1] || DEFAULT_DELIVERY),
        reaction: '',
        source: 'deterministic',
    };
};

export const prepareFishAudioScript = async ({
    settings,
    messageText,
    userText = '',
    emotionalContext = '',
    maxChars = 320,
    fetcher = fetch,
}: {
    settings: FishAudioScriptAgentSettings;
    messageText: string;
    userText?: string;
    emotionalContext?: string;
    maxChars?: number;
    fetcher?: FetchLike;
}): Promise<PreparedFishAudioScript> => {
    const fallback = makeDeterministicScript({ messageText, userText, emotionalContext, maxChars });
    const apiKey = String(settings.apiKey || '').trim();
    if (!apiKey || !fallback.spokenText) return fallback;

    const baseUrl = String(settings.baseUrl || 'https://api.b.ai/v1').replace(/\/$/, '');
    const model = String(settings.model || 'deepseek-v4-flash').trim() || 'deepseek-v4-flash';
    const systemPrompt = `Você é o DIRETOR DE VOZ DA LARI, especialista no Fish Audio S2.1 Pro.

Sua função não é conversar com o lead. Sua única função é transformar uma mensagem já aprovada em roteiro de TTS.

REGRAS OBRIGATÓRIAS:
1. spoken_text contém exatamente palavras que devem ser ouvidas. Remova kkk, kkkkk, rs, rsrs, emojis, links e marcas visuais de chat.
2. Expanda abreviações para fala natural: vc=você, tbm=também, pq=porque, tô/tá preservados quando naturais.
3. Preserve rigorosamente sentido, pessoa, intenção e informação da mensagem original. Não invente frase, promessa, apelido, pergunta ou fato.
4. Use português brasileiro oral, jovem e natural. Corrija somente pontuação e escrita necessárias para pronúncia.
5. delivery é uma única direção curta para atriz de voz, sem colchetes. Prefira naturalidade e ritmo, evitando dramatização excessiva.
6. reaction deve ser apenas uma destas opções: none, giggle, chuckling, sigh, pause, short pause, inhale. Use reação apenas quando o contexto realmente pedir.
7. Fish S2.1 usa instruções em [colchetes]. Não use tags de S1 em parênteses, SSML, markdown ou explicações.
8. Retorne somente JSON válido: {"spoken_text":"...","delivery":"...","reaction":"none"}.`;

    const response = await fetcher(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: `MENSAGEM APROVADA:\n${messageText}\n\nFALA BASE JÁ NORMALIZADA:\n${fallback.spokenText}\n\nCONTEXTO IMEDIATO DO LEAD:\n${String(userText || '').slice(0, 500)}\n\nCLIMA EMOCIONAL:\n${String(emotionalContext || '').slice(0, 300)}\n\nLIMITE: ${maxChars} caracteres falados.`,
                },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.25,
            max_tokens: 450,
        }),
        signal: AbortSignal.timeout(Math.min(15_000, Math.max(3_000, Number(settings.timeoutMs) || 8_000))),
    });

    const responseText = await response.text();
    if (!response.ok) throw new Error(`DeepSeek áudio ${response.status}: ${responseText.slice(0, 400)}`);
    const payload = JSON.parse(responseText || '{}');
    const rawContent = payload?.choices?.[0]?.message?.content;
    const parsed = typeof rawContent === 'string' ? parseJsonObject(rawContent) : rawContent;

    let spokenText = cleanTextForSpeech(parsed?.spoken_text, maxChars);
    if (!preservesOriginalSpeech(fallback.spokenText, spokenText)) spokenText = fallback.spokenText;
    const delivery = cleanInlineValue(parsed?.delivery) || DEFAULT_DELIVERY;
    const requestedReaction = cleanInlineValue(parsed?.reaction, 30).toLowerCase();
    const reaction = requestedReaction === 'none' || !ALLOWED_REACTIONS.has(requestedReaction) ? '' : requestedReaction;
    const cue = `[${delivery}]${reaction ? ` [${reaction}]` : ''}`;

    return {
        spokenText,
        fishText: `${cue} ${spokenText}`.trim(),
        delivery,
        reaction,
        source: 'deepseek',
    };
};
