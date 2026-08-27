import {
    buildElevenV3Performance,
    cleanTextForElevenLabsSpeech,
    stripElevenV3Tags,
} from '@/lib/elevenLabs';
import { DEFAULT_BAI_MODEL, normalizeBaiModelName } from '@/lib/aiModels';

export type ElevenLabsScriptAgentSettings = {
    apiKey: string;
    model: string;
    baseUrl: string;
    timeoutMs?: number;
};

export type PreparedElevenLabsScript = {
    spokenText: string;
    elevenText: string;
    delivery: string;
    reaction: string;
    source: 'deepseek' | 'deterministic';
};

export type ElevenLabsScriptMode = 'voice_render' | 'requested_audio';
type FetchLike = typeof fetch;

const ALLOWED_TAGS = new Set([
    'seductively', 'whispers', 'giggles', 'laughs softly', 'sighs', 'breathes softly',
    'breathes heavily', 'gasps', 'moans', 'moans softly', 'pause', 'short pause',
    'softly', 'playfully', 'excited', 'sad', 'surprised',
]);

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
    try { return JSON.parse(cleaned); }
    catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
        throw new Error('DeepSeek não retornou JSON para o roteiro ElevenLabs');
    }
};

const sanitizePerformanceScript = (value: unknown, spokenText: string) => {
    const raw = String(value || '').replace(/\[[^\]\r\n]{1,80}\]/g, (tag) => {
        const name = tag.slice(1, -1).trim().toLowerCase();
        return ALLOWED_TAGS.has(name) ? `[${name}]` : ' ';
    }).replace(/\s+/g, ' ').trim();
    const audible = cleanTextForElevenLabsSpeech(stripElevenV3Tags(raw), Math.max(500, spokenText.length + 40));
    return preservesOriginalSpeech(spokenText, audible) ? raw : '';
};

const makeDeterministicScript = ({
    messageText,
    userText,
    emotionalContext,
    maxChars,
    mode,
}: {
    messageText: string;
    userText: string;
    emotionalContext: string;
    maxChars: number;
    mode: ElevenLabsScriptMode;
}): PreparedElevenLabsScript => {
    const audioRequestFallback = 'Oii… te mando sim. Fiquei com vontade de falar baixinho com você agora.';
    const sourceText = mode === 'requested_audio' ? audioRequestFallback : messageText;
    const spokenText = cleanTextForElevenLabsSpeech(sourceText, maxChars);
    return {
        spokenText,
        elevenText: buildElevenV3Performance({ messageText: sourceText, userText, emotionalContext, maxChars }),
        delivery: 'seductively',
        reaction: '',
        source: 'deterministic',
    };
};

export const prepareElevenLabsScript = async ({
    settings,
    messageText,
    userText = '',
    emotionalContext = '',
    maxChars = 300,
    mode = 'voice_render',
    conversationContext = '',
    fetcher = fetch,
}: {
    settings: ElevenLabsScriptAgentSettings;
    messageText: string;
    userText?: string;
    emotionalContext?: string;
    maxChars?: number;
    mode?: ElevenLabsScriptMode;
    conversationContext?: string;
    fetcher?: FetchLike;
}): Promise<PreparedElevenLabsScript> => {
    const fallback = makeDeterministicScript({ messageText, userText, emotionalContext, maxChars, mode });
    const apiKey = String(settings.apiKey || '').trim();
    if (!apiKey || !fallback.spokenText) return fallback;

    const baseUrl = String(settings.baseUrl || 'https://api.b.ai/v1').replace(/\/$/, '');
    const model = normalizeBaiModelName(settings.model || DEFAULT_BAI_MODEL);
    const systemPrompt = `Você é a DIRETORA DE PERFORMANCE DE VOZ DA LARI para ElevenLabs Eleven v3.

Você não conversa com o lead. Você cria a fala e insere direções de atuação que o Eleven v3 executará.

PERSONAGEM E PERFORMANCE:
- Lari é uma mulher adulta, brasileira, jovem, íntima, safada, provocante e natural.
- A base da voz é sedutora e próxima, como um áudio privado real; nunca pareça locução, roteiro pornô mecânico ou assistente.
- Putaria adulta consensual é permitida quando a conversa estiver sexual. Nesses momentos ela pode falar explicitamente, sussurrar, respirar e gemer de forma contextual.
- Não coloque gemido em assunto neutro, pagamento, suporte ou quando não houver intimidade. Sensualidade pode ser leve; reação forte precisa combinar com o contexto.

REGRAS OBRIGATÓRIAS:
1. spoken_text contém somente palavras realmente ouvidas, em português brasileiro oral. Remova kkk, rs, emojis, links e marcas visuais.
2. performance_script contém as mesmas palavras de spoken_text, na mesma ordem, acrescentando somente tags entre colchetes.
3. Tags permitidas: [seductively], [whispers], [giggles], [laughs softly], [sighs], [breathes softly], [breathes heavily], [gasps], [moans], [moans softly], [pause], [short pause], [softly], [playfully], [excited], [sad], [surprised].
4. Use de 1 a 4 tags. Prefira [seductively] como base. Posicione a reação exatamente onde uma pessoa real faria.
5. Em VOICE_RENDER, preserve rigorosamente sentido, intenção, fatos e pessoa da mensagem aprovada. Não invente promessa, pergunta ou informação.
6. Em REQUESTED_AUDIO, responda diretamente à última mensagem como Lari falando agora. Não diga que entendeu, não explique geração de áudio e não leia uma bolha desalinhada.
7. Pontuação, reticências e frases curtas devem criar respiração natural. Nada de excesso teatral em todo áudio.
8. Retorne somente JSON válido: {"spoken_text":"...","performance_script":"[seductively] ...","delivery":"seductively","reaction":"none"}.`;

    const response = await fetcher(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: `MODO: ${mode === 'requested_audio' ? 'REQUESTED_AUDIO' : 'VOICE_RENDER'}\n\nÚLTIMA MENSAGEM DO LEAD:\n${String(userText || '').slice(0, 600)}\n\nMENSAGEM APROVADA/INTENÇÃO:\n${messageText}\n\nFALA BASE:\n${fallback.spokenText}\n\nCONTEXTO RECENTE:\n${String(conversationContext || '').slice(0, 1200)}\n\nCLIMA EMOCIONAL:\n${String(emotionalContext || '').slice(0, 400)}\n\nLIMITE: ${maxChars} caracteres falados.`,
                },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.35,
            max_tokens: 650,
        }),
        signal: AbortSignal.timeout(Math.min(15_000, Math.max(3_000, Number(settings.timeoutMs) || 8_000))),
    });

    const responseText = await response.text();
    if (!response.ok) throw new Error(`DeepSeek roteiro ElevenLabs ${response.status}: ${responseText.slice(0, 400)}`);
    const payload = JSON.parse(responseText || '{}');
    const rawContent = payload?.choices?.[0]?.message?.content;
    const parsed = typeof rawContent === 'string' ? parseJsonObject(rawContent) : rawContent;

    let spokenText = cleanTextForElevenLabsSpeech(parsed?.spoken_text, maxChars);
    if (mode === 'voice_render' && !preservesOriginalSpeech(fallback.spokenText, spokenText)) spokenText = fallback.spokenText;
    if (mode === 'requested_audio' && spokenText.length < 8) spokenText = fallback.spokenText;

    const performanceScript = sanitizePerformanceScript(parsed?.performance_script, spokenText)
        || buildElevenV3Performance({ messageText: spokenText, userText, emotionalContext, maxChars });
    return {
        spokenText,
        elevenText: performanceScript,
        delivery: cleanInlineValue(parsed?.delivery) || 'seductively',
        reaction: cleanInlineValue(parsed?.reaction, 40).toLowerCase() === 'none' ? '' : cleanInlineValue(parsed?.reaction, 40),
        source: 'deepseek',
    };
};
