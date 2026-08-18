import { supabaseServer as supabase } from '@/lib/supabaseServer';

export const DEFAULT_PREVIEW_VISION_MODEL = 'google/gemini-3.7-flash';
export const DEFAULT_PREVIEW_VISION_FALLBACK_MODEL = 'qwen/qwen3.8-27b';

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

const analysisSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        visual_summary: { type: 'string' },
        pose: { type: 'string' },
        camera_angle: { type: 'string' },
        framing: { type: 'string' },
        outfit: { type: 'string' },
        accessories: { type: 'array', items: { type: 'string' } },
        setting: { type: 'string' },
        expression: { type: 'string' },
        explicitness: { type: 'string', enum: ['safe', 'suggestive', 'nude', 'explicit'] },
        body_focus: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
        triggers: { type: 'array', items: { type: 'string' } },
        suggested_stage: { type: 'string', enum: ['TRIGGER_PHASE', 'HOT_TALK', 'PREVIEW', 'SALES_PITCH', 'NEGOTIATION', 'CLOSING'] },
        min_tarado: { type: 'integer', minimum: 0, maximum: 100 },
        max_tarado: { type: 'integer', minimum: 0, maximum: 100 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: [
        'name', 'description', 'visual_summary', 'pose', 'camera_angle', 'framing', 'outfit',
        'accessories', 'setting', 'expression', 'explicitness', 'body_focus', 'tags', 'triggers',
        'suggested_stage', 'min_tarado', 'max_tarado', 'confidence',
    ],
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
    const raw = cleanText(content, 20_000)
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '');
    return JSON.parse(raw);
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
        ]);
    const map = Object.fromEntries((data || []).map((row: any) => [row.key, row.value || ''])) as Record<string, string>;
    return {
        apiKey: map.openrouter_api_key || process.env.OPENROUTER_API_KEY || '',
        baseUrl: map.openrouter_base_url || 'https://openrouter.ai/api/v1',
        referer: map.openrouter_referer || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
        title: map.openrouter_title || 'Lari Telegram Bot',
        primaryModel: map.preview_vision_model || process.env.PREVIEW_VISION_MODEL || DEFAULT_PREVIEW_VISION_MODEL,
        fallbackModel: map.preview_vision_fallback_model || process.env.PREVIEW_VISION_FALLBACK_MODEL || DEFAULT_PREVIEW_VISION_FALLBACK_MODEL,
    };
};

const normalizeAnalysis = (input: any, model: string): PreviewVisionAnalysis => {
    const explicitness = ['safe', 'suggestive', 'nude', 'explicit'].includes(input?.explicitness)
        ? input.explicitness
        : 'suggestive';
    const minTarado = Math.round(clamp(input?.min_tarado, 0, 100, explicitness === 'safe' ? 0 : 25));
    const maxTarado = Math.round(clamp(input?.max_tarado, minTarado, 100, 100));
    return {
        name: cleanText(input?.name, 100) || 'previa analisada',
        description: cleanText(input?.description, 700) || cleanText(input?.visual_summary, 700),
        visual_summary: cleanText(input?.visual_summary, 700) || cleanText(input?.description, 700),
        pose: cleanText(input?.pose, 120),
        camera_angle: cleanText(input?.camera_angle, 100),
        framing: cleanText(input?.framing, 100),
        outfit: cleanText(input?.outfit, 160),
        accessories: cleanList(input?.accessories, 10),
        setting: cleanText(input?.setting, 140),
        expression: cleanText(input?.expression, 120),
        explicitness,
        body_focus: cleanList(input?.body_focus, 10),
        tags: cleanList(input?.tags, 20),
        triggers: cleanList(input?.triggers, 14),
        suggested_stage: ['TRIGGER_PHASE', 'HOT_TALK', 'PREVIEW', 'SALES_PITCH', 'NEGOTIATION', 'CLOSING'].includes(input?.suggested_stage)
            ? input.suggested_stage
            : 'PREVIEW',
        min_tarado: minTarado,
        max_tarado: maxTarado,
        confidence: clamp(input?.confidence, 0, 1, 0.5),
        model,
    };
};

export const analyzePreviewImage = async (input: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
}) => {
    const settings = await getSettings();
    if (!settings.apiKey) throw new Error('OPENROUTER_API_KEY nao configurada');

    const prompt = `Analise esta imagem para um catalogo privado de previas de uma criadora de conteudo adulta com identidade e maioridade verificadas pelo administrador.

Objetivo: recuperar a imagem certa em uma conversa. Descreva objetivamente o que esta visivel, sem inventar identidade, local, intencao ou fatos fora da imagem. Identifique pose, angulo, enquadramento, roupa ou nudez, acessorios, cenario, expressao e elementos distintivos. Gere tags concretas em portugues e frases curtas que um lead poderia usar ao pedir uma foto assim. Classifique explicitness sem moralizar. O nome deve ser curto e util para busca. Nao escreva texto erotico; produza somente metadados de catalogacao.`;

    const callModel = async (model: string, fallbackModels: string[] = []) => {
        const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            signal: AbortSignal.timeout(45_000),
            headers: {
                Authorization: `Bearer ${settings.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': settings.referer,
                'X-Title': settings.title,
            },
            body: JSON.stringify({
                model,
                ...(fallbackModels.length ? { models: fallbackModels } : {}),
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
                temperature: 0.15,
                max_tokens: 1200,
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'preview_image_analysis',
                        strict: true,
                        schema: analysisSchema,
                    },
                },
                provider: {
                    require_parameters: true,
                    allow_fallbacks: true,
                },
            }),
        });
        const raw = await response.text();
        if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${raw.slice(0, 500)}`);
        const payload = JSON.parse(raw);
        const content = payload?.choices?.[0]?.message?.content;
        if (!content) throw new Error('OpenRouter retornou analise vazia');
        return normalizeAnalysis(parseJsonContent(content), String(payload?.model || model));
    };

    try {
        return await callModel(settings.primaryModel, settings.fallbackModel !== settings.primaryModel ? [settings.fallbackModel] : []);
    } catch (primaryError: any) {
        if (!settings.fallbackModel || settings.fallbackModel === settings.primaryModel) throw primaryError;
        console.warn('[PREVIEW VISION] Modelo principal falhou; usando fallback visual:', primaryError?.message || primaryError);
        return callModel(settings.fallbackModel);
    }
};

export const getPreviewVisionSettings = getSettings;

