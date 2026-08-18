import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabaseServer as supabase } from '@/lib/supabaseServer';

export const DEFAULT_PREVIEW_VISION_MODEL = 'qwen/qwen-2.5-vl-72b-instruct';
export const DEFAULT_PREVIEW_VISION_FALLBACK_MODEL = 'qwen/qwen-2.5-vl-72b-instruct:free';

export type PreviewVisionAnalysis = {
    name: string;
    description: string;
    visual_summary: string;
    pose: string;
    camera_angle: string;
    framing: string;
    outfit: string;
    accessories: string[];
    setting: string;
    expression: string;
    explicitness: 'safe' | 'suggestive' | 'nude' | 'explicit';
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
            'preview_vision_model',
            'preview_vision_fallback_model',
            'gemini_api_key',
        ]);
    const map = Object.fromEntries((data || []).map((row: any) => [row.key, row.value || ''])) as Record<string, string>;
    return {
        openRouterKey: map.openrouter_api_key || process.env.OPENROUTER_API_KEY || '',
        geminiKey: map.gemini_api_key || process.env.GEMINI_API_KEY || '',
        baseUrl: map.openrouter_base_url || 'https://openrouter.ai/api/v1',
        referer: map.openrouter_referer || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
        title: map.openrouter_title || 'Lari Telegram Bot',
        primaryModel: map.preview_vision_model || process.env.PREVIEW_VISION_MODEL || DEFAULT_PREVIEW_VISION_MODEL,
        fallbackModel: map.preview_vision_fallback_model || process.env.PREVIEW_VISION_FALLBACK_MODEL || DEFAULT_PREVIEW_VISION_FALLBACK_MODEL,
        apiKey: map.openrouter_api_key || process.env.OPENROUTER_API_KEY || '',
    };
};

const generateHeuristicAnalysis = (filename: string): PreviewVisionAnalysis => {
    const nameClean = filename
        .replace(/\.[^.]+$/, '')
        .replace(/[_\-]+/g, ' ')
        .trim();
    const lower = nameClean.toLowerCase();
    const tags: string[] = ['foto', 'previa', 'sensual'];
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

    return {
        name: nameClean.slice(0, 80) || 'Prévia da Lari',
        description: `Foto sensual da Larissa Morais catalogada (${nameClean})`,
        visual_summary: `Foto temática da Larissa: ${nameClean}`,
        pose: 'espontânea e sensual',
        camera_angle: 'frontal ou detalhe',
        framing: 'plano médio / detalhe',
        outfit: /nude|pelada/i.test(lower) ? 'sem roupa' : 'lingerie sensual',
        accessories: [],
        setting: /banho|chuveiro/i.test(lower) ? 'banheiro' : 'quarto',
        expression: 'sedutora e envolvente',
        explicitness: /nude|pelada|leite/i.test(lower) ? 'explicit' : 'suggestive',
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

    let name = cleanText(input?.name, 100);
    name = name.replace(/^(mulher jovem|mulher morena|uma mulher|garota|modelo)\b/i, 'Lari');
    if (!name || name === 'previa analisada') {
        name = 'Lari sensual';
    }

    let description = cleanText(input?.description, 700) || cleanText(input?.visual_summary, 700);
    description = description.replace(/\b(mulher jovem|mulher morena|uma mulher)\b/gi, 'Larissa');

    let visualSummary = cleanText(input?.visual_summary, 700) || description;
    visualSummary = visualSummary.replace(/\b(mulher jovem|mulher morena|uma mulher)\b/gi, 'Larissa');

    const tags = cleanList(input?.tags, 25);
    if (!tags.includes('lari')) tags.unshift('lari');

    return {
        name,
        description,
        visual_summary: visualSummary,
        pose: cleanText(input?.pose, 120),
        camera_angle: cleanText(input?.camera_angle, 100),
        framing: cleanText(input?.framing, 100),
        outfit: cleanText(input?.outfit, 160),
        accessories: cleanList(input?.accessories, 10),
        setting: cleanText(input?.setting, 140),
        expression: cleanText(input?.expression, 120),
        explicitness,
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

    const prompt = `Você é o especialista visual do catálogo privado da modelo e criadora de conteúdo adulta Larissa Morais (Lari, 21 anos).
TODA imagem enviada é obrigatoriamente da Larissa Morais (Lari). NUNCA a chame de "mulher jovem" ou "mulher morena desconhecida" — refira-se sempre a ela como "Larissa" ou "Lari".

Analise minuciosamente a foto com foco em catalogação e casamento perfeito em conversas no Telegram:
1. IDENTIDADE: A modelo é sempre a Lari.
2. ROUPA & NUDEZ: Descreva exatamente o que ela está vestindo (tecido, cor, corte, transparência) ou se está nua/sem roupa.
3. EXPRESSÃO FACIAL & OLHAR: Descreva a expressão do rosto (sorriso safado, olhar penetrante para a câmera, boca entreaberta, biquinho, carinha de travessa).
4. POSE & CORPO: Pose exata (deitada na cama, de costas, empinada, de quatro, sentada, selfie), enquadramento e partes do corpo em destaque (bunda, peitos, boca, rosto, pernas, pés).
5. AMBIENTE & OBJETOS: Cenário (quarto, cama, banheiro, espelho) e qualquer elemento ou fetiche na cena (ex: lata de leite condensado, toalha, óleo, calcinha).
6. INTENÇÃO & CONTEXTO: Qual é o clima da foto? (brincadeira com comida/food play, fetiche de gozar na cara/boca, exibicionismo, carinho deitada, provocação).
7. TRIGGERS DE CONVERSA: Liste de 10 a 20 frases reais que um lead no Telegram digitaria quando quiser ver EXATAMENTE essa foto (ex: "manda foto com leite", "quero ver sua boquinha", "foto na cama", "quero sujar sua cara", "foto safada").

Retorne SOMENTE um JSON válido com a estrutura:
{
  "name": "Nome atraente da foto da Lari (ex: Lari na cama com leite condensado na boca)",
  "description": "Descrição rica, envolvente e detalhada da Lari na cena, destacando roupa, expressão, corpo e fetiche",
  "visual_summary": "Resumo objetivo dos elementos visuais da Larissa",
  "pose": "pose detalhada da Lari",
  "camera_angle": "ângulo da câmera",
  "framing": "enquadramento",
  "outfit": "roupa exata da Lari ou sem roupa",
  "accessories": ["acessórios ou objetos na cena"],
  "setting": "ambiente (ex: cama do quarto, banheiro)",
  "expression": "expressão facial e olhar da Lari",
  "explicitness": "safe" | "suggestive" | "nude" | "explicit",
  "body_focus": ["partes do corpo em evidência"],
  "tags": ["15 a 25 tags em português para busca e casamento perfeito"],
  "triggers": ["10 a 20 frases exatas que os leads mandam no Telegram para pedir essa foto"],
  "suggested_stage": "TRIGGER_PHASE" | "HOT_TALK" | "PREVIEW" | "SALES_PITCH" | "CLOSING",
  "min_tarado": 10 a 60,
  "max_tarado": 100,
  "confidence": 0.95
}`;

    // 1. Tenta OpenRouter exclusivamente com Qwen Vision se chave estiver configurada
    if (settings.openRouterKey) {
        const candidateModels = [
            settings.primaryModel,
            settings.fallbackModel,
            'qwen/qwen-2.5-vl-72b-instruct',
            'qwen/qwen-2.5-vl-72b-instruct:free',
            'qwen/qwen-vl-plus',
        ].filter((m) => m && m.toLowerCase().includes('qwen'));

        for (const model of candidateModels) {
            try {
                const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
                    method: 'POST',
                    signal: AbortSignal.timeout(30_000),
                    headers: {
                        Authorization: `Bearer ${settings.openRouterKey}`,
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
                        max_tokens: 1200,
                        response_format: { type: 'json_object' },
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
        try {
            const genAI = new GoogleGenerativeAI(settings.geminiKey);
            const geminiModel = genAI.getGenerativeModel({
                model: 'gemini-2.5-flash',
                generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
            });
            const result = await geminiModel.generateContent([
                prompt,
                {
                    inlineData: {
                        mimeType: input.mimeType,
                        data: input.buffer.toString('base64'),
                    },
                },
            ]);
            const text = result.response.text();
            if (text) {
                return normalizeAnalysis(parseJsonContent(text), 'gemini-2.5-flash-direct');
            }
        } catch (geminiError: any) {
            console.warn('[PREVIEW VISION] Gemini direto falhou:', geminiError?.message || geminiError);
        }
    }

    // 3. Fallback inteligente baseado em heurística do arquivo para NUNCA travar nem rejeitar
    console.log(`[PREVIEW VISION] Aplicando extração inteligente de metadados para: ${input.filename}`);
    return generateHeuristicAnalysis(input.filename);
};

export const getPreviewVisionSettings = getSettings;

