import { GoogleGenAI } from '@google/genai';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { loadAiCredentials } from '@/lib/aiCredentials';

export const DEFAULT_PREVIEW_VISION_MODEL = 'google/gemini-3.8-flash';
export const DEFAULT_PREVIEW_VISION_FALLBACK_MODEL = 'google/gemini-3.7-flash';
export type PreviewVisionProvider = 'llm7' | 'openrouter' | 'gemini';
const normalizePreviewVisionProvider = (value: unknown): PreviewVisionProvider => {
    const provider = String(value || '').trim().toLowerCase();
    return provider === 'llm7' || provider === 'gemini' ? provider : 'openrouter';
};
const normalizePreviewVisionModel = (value: unknown, fallback: string) => {
    const model = String(value || '').trim();
    return model || fallback;
};

export type PreviewVisionAnalysis = {
    name: string;
    description: string;
    visual_summary: string;
    visual_details: string[];
    pose: string;
    camera_angle: string;
    framing: string;
    outfit: string;
    accessories: string[];
    setting: string;
    expression: string;
    plausible_as_recent: boolean;
    moment_context: string;
    time_of_day: 'day' | 'night' | 'any';
    temporal_evidence: string;
    time_confidence: number;
    time_compatibility: Array<'madrugada' | 'manha' | 'tarde' | 'noite' | 'qualquer'>;
    explicitness: 'safe' | 'suggestive' | 'nude' | 'explicit';
    sensuality_level: 'casual' | 'sensual' | 'hot' | 'explicit';
    lighting: 'daylight' | 'night' | 'indoor' | 'neutral';
    conversation_contexts: string[];
    send_when: string;
    avoid_when: string[];
    body_focus: string[];
    tags: string[];
    triggers: string[];
    suggested_stage: string;
    min_tarado: number;
    max_tarado: number;
    confidence: number;
    model: string;
};

const cleanText = (value: unknown, max = 500) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanList = (value: unknown, limit = 16) => Array.from(new Set(
    (Array.isArray(value) ? value : [])
        .map((item) => cleanText(item, 80).toLowerCase())
        .filter(Boolean),
)).slice(0, limit);
const cleanObservationList = (value: unknown, limit = 20) => Array.from(new Set(
    (Array.isArray(value) ? value : [])
        .map((item) => cleanText(item, 180))
        .filter(Boolean),
)).slice(0, limit);
const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
};

const parseJsonContent = (content: unknown) => {
    const raw = cleanText(content, 40_000)
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '');
    try {
        return JSON.parse(raw);
    } catch {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        throw new Error('Falha ao extrair JSON da resposta visual');
    }
};

const getSettings = async () => {
    const { data } = await supabase
        .from('bot_settings')
        .select('key,value')
        .in('key', [
            'openrouter_api_key',
            'openrouter_base_url',
            'openrouter_referer',
            'openrouter_title',
            'preview_vision_provider',
            'preview_vision_model',
            'preview_vision_fallback_model',
            'gemini_api_key',
        ]);
    const map = Object.fromEntries((data || []).map((row: any) => [row.key, row.value || ''])) as Record<string, string>;
    const provider = normalizePreviewVisionProvider(map.preview_vision_provider || process.env.PREVIEW_VISION_PROVIDER);
    const llm7Credential = provider === 'llm7'
        ? (await loadAiCredentials()).find((credential) => credential.provider === 'llm7')
        : null;
    const llm7ApiKey = llm7Credential?.apiKey || map.llm7_api_key || process.env.LLM7_API_KEY || '';
    const llm7BaseUrl = llm7Credential?.baseUrl || process.env.LLM7_BASE_URL || 'https://api.llm7.io/v1';
    const configuredPrimaryModel = map.preview_vision_model || process.env.PREVIEW_VISION_MODEL
        || (provider === 'llm7' ? llm7Credential?.model : '')
        || DEFAULT_PREVIEW_VISION_MODEL;
    const configuredFallbackModel = map.preview_vision_fallback_model || process.env.PREVIEW_VISION_FALLBACK_MODEL
        || (provider === 'llm7' ? llm7Credential?.model : '')
        || DEFAULT_PREVIEW_VISION_FALLBACK_MODEL;
    return {
        provider,
        openRouterKey: map.openrouter_api_key || process.env.OPENROUTER_API_KEY || '',
        geminiKey: map.gemini_api_key || process.env.GEMINI_API_KEY || '',
        baseUrl: provider === 'llm7' ? llm7BaseUrl : map.openrouter_base_url || 'https://openrouter.ai/api/v1',
        referer: map.openrouter_referer || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
        title: map.openrouter_title || 'Lari Telegram Bot',
        primaryModel: normalizePreviewVisionModel(configuredPrimaryModel, DEFAULT_PREVIEW_VISION_MODEL),
        fallbackModel: normalizePreviewVisionModel(configuredFallbackModel, DEFAULT_PREVIEW_VISION_FALLBACK_MODEL),
        apiKey: provider === 'llm7' ? llm7ApiKey : map.openrouter_api_key || process.env.OPENROUTER_API_KEY || '',
    };
};

const generateHeuristicAnalysis = (filename: string): PreviewVisionAnalysis => {
    const nameClean = filename
        .replace(/\.[^.]+$/, '')
        .replace(/[_\-]+/g, ' ')
        .trim();
    const lower = nameClean.toLowerCase();
    const tags: string[] = ['foto', 'previa'];
    const triggers: string[] = [];

    if (/milk|leite/i.test(lower)) { tags.push('leite', 'rosto', 'boca', 'banho', 'lambuzada'); triggers.push('foto com leite', 'leite no rosto'); }
    if (/face|rosto/i.test(lower)) { tags.push('rosto', 'olhar', 'boca'); triggers.push('foto de rosto', 'sua carinha'); }
    if (/shower|banho|chuveiro|toalha/i.test(lower)) { tags.push('banho', 'chuveiro', 'molhada', 'espuma'); triggers.push('foto no banho', 'foto molhada'); }
    if (/lingerie|calcinha|sutia|conjunto/i.test(lower)) { tags.push('lingerie', 'calcinha', 'seda', 'renda'); triggers.push('foto de lingerie', 'de calcinha'); }
    if (/bed|cama|deitada|quarto/i.test(lower)) { tags.push('cama', 'deitada', 'quarto', 'lencol'); triggers.push('foto na cama', 'deitada'); }
    if (/bunda|ass|costas|de 4|quatro/i.test(lower)) { tags.push('bunda', 'de quatro', 'costas', 'empinada'); triggers.push('foto de quatro', 'foto da bunda'); }
    if (/peito|boobs|seios|decote/i.test(lower)) { tags.push('peitos', 'decote', 'seios'); triggers.push('foto dos peitos', 'foto de decote'); }
    if (/nude|pelada|sem roupa/i.test(lower)) { tags.push('pelada', 'sem roupa', 'nude', 'explicita'); triggers.push('foto pelada', 'nude'); }
    if (/pes|feet|pe/i.test(lower)) { tags.push('pes', 'pezinhos', 'unhas'); triggers.push('foto dos pes'); }

    const explicitness = /sexo|penetracao|masturb|dedando|gozando/i.test(lower)
        ? 'explicit'
        : /nude|pelada|sem roupa/i.test(lower)
            ? 'nude'
            : /lingerie|calcinha|sutia|decote|bunda|peito|leite/i.test(lower)
                ? 'suggestive'
                : 'safe';
    const sensualityLevel = explicitness === 'explicit'
        ? 'explicit'
        : explicitness === 'nude'
            ? 'hot'
            : explicitness === 'suggestive'
                ? 'sensual'
                : 'casual';
    const isNight = /noite|night|escuro|luz baixa/i.test(lower);
    const isDay = /sol|dia|day|praia|externa/i.test(lower);
    const timeOfDay: PreviewVisionAnalysis['time_of_day'] = isNight ? 'night' : isDay ? 'day' : 'any';

    return {
        name: nameClean.slice(0, 80) || 'Prévia da Lari',
        description: `Foto sensual da Larissa Morais catalogada (${nameClean})`,
        visual_summary: `Foto temática da Larissa: ${nameClean}`,
        visual_details: ['análise visual detalhada indisponível; catalogação baseada no nome do arquivo'],
        pose: 'espontânea e sensual',
        camera_angle: 'frontal ou detalhe',
        framing: 'plano médio / detalhe',
        outfit: /nude|pelada/i.test(lower) ? 'sem roupa' : 'lingerie sensual',
        accessories: [],
        setting: /banho|chuveiro/i.test(lower) ? 'banheiro' : 'quarto',
        expression: 'sedutora e envolvente',
        plausible_as_recent: !/estudio|ensaio|praia|piscina|evento/i.test(lower),
        moment_context: /banho|chuveiro/i.test(lower)
            ? 'acabando de sair do banho'
            : /bed|cama|deitada|quarto/i.test(lower)
                ? 'deitada no quarto'
                : 'selfie espontanea',
        time_of_day: timeOfDay,
        temporal_evidence: isNight
            ? 'O nome do arquivo sugere noite, mas não substitui a inspeção visual da iluminação.'
            : isDay
                ? 'O nome do arquivo sugere dia, mas não substitui a inspeção visual da iluminação.'
                : 'Não há evidência temporal confiável no nome do arquivo; qualquer horário é apenas uma hipótese.',
        time_confidence: isNight || isDay ? 0.35 : 0.2,
        time_compatibility: timeOfDay === 'night'
            ? ['noite', 'madrugada']
            : timeOfDay === 'day'
                ? ['manha', 'tarde']
                : ['madrugada', 'manha', 'tarde', 'noite'],
        explicitness,
        sensuality_level: sensualityLevel,
        lighting: /noite|night|escuro|luz baixa/i.test(lower) ? 'night' : /sol|dia|day|praia|externa/i.test(lower) ? 'daylight' : 'indoor',
        conversation_contexts: sensualityLevel === 'casual'
            ? ['casual_chat', 'first_contact']
            : sensualityLevel === 'sensual'
                ? ['flirting', 'preview']
                : sensualityLevel === 'hot'
                    ? ['hot_talk', 'explicit_request']
                    : ['explicit_request'],
        send_when: /banho|chuveiro/i.test(lower)
            ? 'quando a conversa estiver no contexto de banho ou o lead pedir foto no banho'
            : /bed|cama|deitada|quarto/i.test(lower)
                ? 'quando a conversa combinar com quarto, descanso ou noite'
                : 'quando o pedido e a intensidade da conversa combinarem com a foto',
        avoid_when: sensualityLevel === 'casual' ? [] : ['first_contact', 'casual_chat'],
        body_focus: tags.filter((t) => ['bunda', 'peitos', 'rosto', 'pes', 'calcinha'].includes(t)),
        tags: Array.from(new Set(tags)),
        triggers: triggers.length ? triggers : ['manda uma foto', 'quero ver foto sua'],
        suggested_stage: 'PREVIEW',
        min_tarado: /nude|pelada|leite/i.test(lower) ? 35 : 15,
        max_tarado: 100,
        confidence: 0.85,
        model: 'heuristic-metadata-extractor',
    };
};

const normalizeAnalysis = (input: any, model: string): PreviewVisionAnalysis => {
    const explicitness = ['safe', 'suggestive', 'nude', 'explicit'].includes(input?.explicitness)
        ? input.explicitness
        : 'suggestive';
    const minTarado = Math.round(clamp(input?.min_tarado, 0, 100, explicitness === 'safe' ? 0 : 25));
    const maxTarado = Math.round(clamp(input?.max_tarado, minTarado, 100, 100));
    const inferredSensuality = explicitness === 'explicit'
        ? 'explicit'
        : explicitness === 'nude'
            ? 'hot'
            : explicitness === 'suggestive'
                ? 'sensual'
                : 'casual';
    const sensualityLevel = ['casual', 'sensual', 'hot', 'explicit'].includes(input?.sensuality_level)
        ? input.sensuality_level
        : inferredSensuality;
    const lighting = ['daylight', 'night', 'indoor', 'neutral'].includes(input?.lighting)
        ? input.lighting
        : 'neutral';
    const timeOfDay: PreviewVisionAnalysis['time_of_day'] = ['day', 'night', 'any'].includes(input?.time_of_day)
        ? input.time_of_day
        : lighting === 'daylight'
            ? 'day'
            : lighting === 'night'
                ? 'night'
                : 'any';

    let name = cleanText(input?.name, 100);
    name = name.replace(/^(mulher jovem|mulher morena|uma mulher|garota|modelo)\b/i, 'Lari');
    if (!name || name === 'previa analisada') {
        name = 'Lari sensual';
    }

    let description = cleanText(input?.description, 700) || cleanText(input?.visual_summary, 700);
    description = description.replace(/\b(mulher jovem|mulher morena|uma mulher)\b/gi, 'Larissa');

    let visualSummary = cleanText(input?.visual_summary, 700) || description;
    visualSummary = visualSummary.replace(/\b(mulher jovem|mulher morena|uma mulher)\b/gi, 'Larissa');

    const visualDetails = cleanObservationList(input?.visual_details, 20);
    if (!visualDetails.length) {
        visualDetails.push(...cleanObservationList([
            input?.outfit,
            input?.pose,
            input?.expression,
            input?.setting,
            input?.camera_angle,
            input?.framing,
        ], 20));
    }
    if (!visualDetails.length) visualDetails.push('não foi possível identificar detalhes visuais suficientes');

    const tags = cleanList(input?.tags, 25);
    if (!tags.includes('lari')) tags.unshift('lari');

    const detectedPeriods = cleanList(input?.time_compatibility, 5)
        .map((period) => period.normalize('NFD').replace(/\p{Diacritic}/gu, ''))
        .filter((period): period is 'madrugada' | 'manha' | 'tarde' | 'noite' | 'qualquer' =>
            ['madrugada', 'manha', 'tarde', 'noite', 'qualquer'].includes(period)
        );
    const timeCompatibility: PreviewVisionAnalysis['time_compatibility'] = detectedPeriods.length
        ? detectedPeriods
        : timeOfDay === 'day'
            ? ['manha', 'tarde']
            : timeOfDay === 'night'
                ? ['noite', 'madrugada']
                : ['madrugada', 'manha', 'tarde', 'noite'];

    return {
        name,
        description,
        visual_summary: visualSummary,
        visual_details: visualDetails,
        pose: cleanText(input?.pose, 120),
        camera_angle: cleanText(input?.camera_angle, 100),
        framing: cleanText(input?.framing, 100),
        outfit: cleanText(input?.outfit, 160),
        accessories: cleanList(input?.accessories, 10),
        setting: cleanText(input?.setting, 140),
        expression: cleanText(input?.expression, 120),
        plausible_as_recent: input?.plausible_as_recent !== false,
        moment_context: cleanText(input?.moment_context, 180),
        time_of_day: timeOfDay,
        temporal_evidence: cleanText(input?.temporal_evidence, 320)
            || 'Não há evidência temporal suficiente na imagem para distinguir dia e noite.',
        time_confidence: clamp(input?.time_confidence, 0, 1, timeOfDay === 'any' ? 0.5 : 0.8),
        time_compatibility: timeCompatibility,
        explicitness,
        sensuality_level: sensualityLevel,
        lighting,
        conversation_contexts: cleanList(input?.conversation_contexts, 12),
        send_when: cleanText(input?.send_when, 300),
        avoid_when: cleanList(input?.avoid_when, 12),
        body_focus: cleanList(input?.body_focus, 10),
        tags,
        triggers: cleanList(input?.triggers, 20),
        suggested_stage: ['TRIGGER_PHASE', 'HOT_TALK', 'PREVIEW', 'SALES_PITCH', 'NEGOTIATION', 'CLOSING'].includes(input?.suggested_stage)
            ? input.suggested_stage
            : 'PREVIEW',
        min_tarado: minTarado,
        max_tarado: maxTarado,
        confidence: clamp(input?.confidence, 0, 1, 0.9),
        model,
    };
};

export const analyzePreviewImage = async (input: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
}): Promise<PreviewVisionAnalysis> => {
    const settings = await getSettings();

    const prompt = `Você é o especialista visual do catálogo privado da modelo e criadora de conteúdo adulta Larissa Morais (Lari, 19 anos).
TODA imagem enviada é obrigatoriamente da Larissa Morais (Lari). NUNCA a chame de "mulher jovem" ou "mulher morena desconhecida" — refira-se sempre a ela como "Larissa" ou "Lari".

Analise a imagem em duas passagens, sem inventar elementos que não estejam visíveis, com foco em catalogação e casamento perfeito em conversas no Telegram.

PASSAGEM A — INVENTÁRIO VISUAL OBSERVÁVEL:
Registre de 8 a 20 detalhes concretos que realmente aparecem na imagem: quantidade de pessoas, posição e orientação do corpo, partes do corpo visíveis, roupa/tecido/cor/corte/transparência, expressão/olhar/boca, cabelo e acessórios, ângulo da câmera, distância e enquadramento, ambiente e superfícies, objetos/textos, fontes de luz, sombras, céu/janelas e sinais de edição. Quando algo não aparecer, escreva "não visível" ou "não identificável". Não deduza roupa, objeto, intenção ou ação apenas pelo contexto.

PASSAGEM B — HORÁRIO E CONTINUIDADE TEMPORAL:
Classifique 'time_of_day' como 'day' somente quando houver evidência visual de luz do dia, céu/sol, janela iluminada ou sombras claramente diurnas. Classifique como 'night' somente quando houver escuridão/céu noturno ou iluminação artificial com ausência de sinais diurnos. Use 'any' quando a imagem for interna ou neutra e não houver evidência confiável. Quarto, cama, lingerie, nudez, sensualidade ou filtro de cor, sozinhos, NÃO provam dia nem noite. Explique a evidência em 'temporal_evidence', dê 'time_confidence' de 0 a 1 e derive os períodos compatíveis.

Detalhe a foto com foco em catalogação e casamento perfeito em conversas no Telegram:
1. IDENTIDADE: A modelo é sempre a Lari.
2. ROUPA & NUDEZ: Descreva exatamente o que ela está vestindo (tecido, cor, corte, transparência) ou se está nua/sem roupa.
3. EXPRESSÃO FACIAL & OLHAR: Descreva a expressão do rosto (sorriso safado, olhar penetrante para a câmera, boca entreaberta, biquinho, carinha de travessa).
4. POSE & CORPO: Pose exata (deitada na cama, de costas, empinada, de quatro, sentada, selfie), enquadramento e partes do corpo em destaque (bunda, peitos, boca, rosto, pernas, pés).
5. AMBIENTE & OBJETOS: Cenário (quarto, cama, banheiro, espelho) e qualquer elemento ou fetiche na cena (ex: lata de leite condensado, toalha, óleo, calcinha).
6. INTENÇÃO & CONTEXTO: Qual é o clima da foto? (brincadeira com comida/food play, fetiche de gozar na cara/boca, exibicionismo, carinho deitada, provocação).
7. TRIGGERS DE CONVERSA: Liste de 10 a 20 frases reais que um lead no Telegram digitaria quando quiser ver EXATAMENTE essa foto (ex: "manda foto com leite", "quero ver sua boquinha", "foto na cama", "quero sujar sua cara", "foto safada").
8. CONTINUIDADE DO MOMENTO: Diga se a imagem parece uma foto espontânea que poderia ter acabado de ser tirada durante a conversa. Considere cenário, iluminação, pose, roupa e aparência de ensaio profissional. Descreva o momento natural coerente (ex: acabou de sair do banho, está deitada à noite, selfie no espelho) sem contradizer as evidências visuais. Não marque ensaio, praia diurna ou evento como foto instantânea fora de contexto.
9. MOMENTO DE ENVIO: Classifique separadamente a intensidade como casual, sensual, hot ou explicit; a iluminação como daylight, night, indoor ou neutral; e liste os contextos de conversa em que a imagem deve aparecer. Uma foto nua nunca é casual. Uma selfie comum nunca deve ser classificada como hot só porque pertence ao catálogo adulto.
10. REGRAS DE COERÊNCIA: Escreva quando enviar e quando evitar. Considere primeiro contato, conversa casual, flerte, conversa quente, pedido explícito, pós-banho, manhã, tarde, noite e madrugada. Não invente que uma foto diurna externa acabou de ser tirada à noite.

Retorne SOMENTE um JSON válido com a estrutura:
{
  "name": "Nome atraente da foto da Lari (ex: Lari na cama com leite condensado na boca)",
  "description": "Descrição rica, envolvente e detalhada da Lari na cena, destacando roupa, expressão, corpo e fetiche",
  "visual_summary": "Resumo objetivo dos elementos visuais da Larissa",
  "visual_details": ["8 a 20 observações concretas e independentes, sem inventar o que não aparece"],
  "pose": "pose detalhada da Lari",
  "camera_angle": "ângulo da câmera",
  "framing": "enquadramento",
  "outfit": "roupa exata da Lari ou sem roupa",
  "accessories": ["acessórios ou objetos na cena"],
  "setting": "ambiente (ex: cama do quarto, banheiro)",
  "expression": "expressão facial e olhar da Lari",
  "plausible_as_recent": true,
  "moment_context": "situação natural coerente para apresentar a foto como recém-tirada",
  "time_of_day": "day" | "night" | "any",
  "temporal_evidence": "sinais visuais usados para classificar o horário; diga quando não houver evidência",
  "time_confidence": 0.0,
  "time_compatibility": ["madrugada", "manha", "tarde", "noite"],
  "explicitness": "safe" | "suggestive" | "nude" | "explicit",
  "sensuality_level": "casual" | "sensual" | "hot" | "explicit",
  "lighting": "daylight" | "night" | "indoor" | "neutral",
  "conversation_contexts": ["first_contact", "casual_chat", "flirting", "hot_talk", "explicit_request", "post_shower", "bedtime"],
  "send_when": "regra curta e objetiva de quando esta foto encaixa",
  "avoid_when": ["contextos ou períodos em que esta foto quebra a continuidade"],
  "body_focus": ["partes do corpo em evidência"],
  "tags": ["15 a 25 tags em português para busca e casamento perfeito"],
  "triggers": ["10 a 20 frases exatas que os leads mandam no Telegram para pedir essa foto"],
  "suggested_stage": "TRIGGER_PHASE" | "HOT_TALK" | "PREVIEW" | "SALES_PITCH" | "CLOSING",
  "min_tarado": 10 a 60,
  "max_tarado": 100,
  "confidence": 0.95
}`;

    // 1. Tenta o provedor visual configurado. LLM7 e OpenRouter expõem a mesma
    // interface compatível com OpenAI e recebem a imagem como data URL.
    if (settings.apiKey && (settings.provider === 'llm7' || settings.provider === 'openrouter')) {
        const candidateModels = Array.from(new Set([
            settings.primaryModel,
            settings.fallbackModel,
            ...(settings.provider === 'openrouter' ? [DEFAULT_PREVIEW_VISION_MODEL, DEFAULT_PREVIEW_VISION_FALLBACK_MODEL] : []),
        ].filter(Boolean)));

        for (const model of candidateModels) {
            try {
                const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
                    method: 'POST',
                    signal: AbortSignal.timeout(30_000),
                    headers: {
                        Authorization: `Bearer ${settings.apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': settings.referer,
                        'X-Title': settings.title,
                    },
                    body: JSON.stringify({
                        model,
                        messages: [{
                            role: 'user',
                            content: [
                                { type: 'text', text: prompt },
                                {
                                    type: 'image_url',
                                    image_url: { url: `data:${input.mimeType};base64,${input.buffer.toString('base64')}` },
                                },
                            ],
                        }],
                        temperature: 0.1,
                        max_tokens: 2400,
                        ...(settings.provider === 'openrouter' ? {
                            response_format: { type: 'json_object' },
                            provider: { allow_fallbacks: false },
                        } : {}),
                    }),
                });

                if (response.ok) {
                    const raw = await response.text();
                    const payload = JSON.parse(raw);
                    const content = payload?.choices?.[0]?.message?.content;
                    if (content) {
                        return normalizeAnalysis(parseJsonContent(content), String(payload?.model || model));
                    }
                }
            } catch (err: any) {
                console.warn(`[PREVIEW VISION] Modelo ${model} falhou:`, err?.message || err);
            }
        }
    }

    // 2. Tenta Google Gemini diretamente se chave estiver disponível
    if (settings.geminiKey) {
        const genAI = new GoogleGenAI({ apiKey: settings.geminiKey });
        for (const model of ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']) try {
            const result = await genAI.models.generateContent({
                model,
                contents: [{
                    role: 'user',
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType: input.mimeType,
                                data: input.buffer.toString('base64'),
                            },
                        },
                    ],
                }],
                config: {
                    responseMimeType: 'application/json',
                    httpOptions: { timeout: 30_000, retryOptions: { attempts: 2 } },
                },
            });
            const text = result.text;
            if (text) {
                return normalizeAnalysis(parseJsonContent(text), String(result.modelVersion || `${model}-direct`));
            }
        } catch (geminiError: any) {
            console.warn(`[PREVIEW VISION] Gemini direto ${model} falhou:`, geminiError?.message || geminiError);
        }
    }

    // 3. Fallback inteligente baseado em heurística do arquivo para NUNCA travar nem rejeitar
    console.log(`[PREVIEW VISION] Aplicando extração inteligente de metadados para: ${input.filename}`);
    return generateHeuristicAnalysis(input.filename);
};

export const getPreviewVisionSettings = getSettings;
