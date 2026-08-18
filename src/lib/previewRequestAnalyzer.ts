import { getPreviewVisionSettings } from '@/lib/previewVision';

export type PhotoRequestAnalysis = {
    media_kind: 'photo' | 'video' | 'not_media';
    title: string;
    canonical_key: string;
    production_brief: string;
    pose: string;
    outfit: string;
    accessories: string[];
    setting: string;
    framing: string;
    expression: string;
    explicitness: 'safe' | 'suggestive' | 'nude' | 'explicit' | 'unspecified';
    body_focus: string[];
    props: string[];
    tags: string[];
    confidence: number;
    model: string;
};

const requestSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        media_kind: { type: 'string', enum: ['photo', 'video', 'not_media'] },
        title: { type: 'string' },
        canonical_key: { type: 'string' },
        production_brief: { type: 'string' },
        pose: { type: 'string' },
        outfit: { type: 'string' },
        accessories: { type: 'array', items: { type: 'string' } },
        setting: { type: 'string' },
        framing: { type: 'string' },
        expression: { type: 'string' },
        explicitness: { type: 'string', enum: ['safe', 'suggestive', 'nude', 'explicit', 'unspecified'] },
        body_focus: { type: 'array', items: { type: 'string' } },
        props: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: [
        'media_kind', 'title', 'canonical_key', 'production_brief', 'pose', 'outfit',
        'accessories', 'setting', 'framing', 'expression', 'explicitness', 'body_focus',
        'props', 'tags', 'confidence',
    ],
};

const normalize = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const cleanText = (value: unknown, max = 500) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanList = (value: unknown, limit = 16) => Array.from(new Set(
    (Array.isArray(value) ? value : [])
        .map((item) => normalize(item).slice(0, 80))
        .filter(Boolean),
)).slice(0, limit);
const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
};

const PHOTO_WORDS = /\b(foto|fotinha|selfie|imagem|retrato|nude|nudes|pelada|nua|sem roupa)\b/i;
const VIDEO_WORDS = /\b(video|vídeo|filmagem|gravacao|gravação|gravado|rebolando|dancando|dançando)\b/i;
const PHOTO_ACTIONS = new Set([
    'send_shower_photo', 'send_lingerie_photo', 'send_wet_finger_photo', 'send_ass_photo_preview',
]);

export const classifyRequestedMediaLocally = (text: string, action?: string) => {
    const hasPhoto = PHOTO_WORDS.test(text) || PHOTO_ACTIONS.has(String(action || ''));
    const hasVideo = VIDEO_WORDS.test(text) || /video/i.test(String(action || ''));
    if (hasVideo && !hasPhoto) return 'video' as const;
    if (hasPhoto) return 'photo' as const;
    return 'not_media' as const;
};

const localAnalysis = (input: { requestText: string; description?: string; tags?: string[]; action?: string; photoHint?: boolean }): PhotoRequestAnalysis => {
    const text = `${input.requestText} ${input.description || ''}`;
    const normalized = normalize(text);
    const tags = new Set(cleanList(input.tags, 20));
    const add = (...values: string[]) => values.forEach((value) => tags.add(value));
    if (/(coelh|orelha|bunny)/i.test(normalized)) add('coelhinha', 'orelhas de coelho', 'fantasia');
    if (/(deitad|cama|lencol)/i.test(normalized)) add('deitada', 'cama');
    if (/(de 4|quatro|costas|bunda|rabao|empinad|por tras)/i.test(normalized)) add('bunda', 'de quatro', 'costas');
    if (/(banho|chuveiro|molhad|toalha)/i.test(normalized)) add('banho', 'molhada', 'chuveiro');
    if (/(lingerie|calcinha|sutia|conjunto)/i.test(normalized)) add('lingerie');
    if (/(pelada|nua|nude|sem roupa)/i.test(normalized)) add('nua', 'nude');
    if (/(selfie|rosto|carinha)/i.test(normalized)) add('selfie', 'rosto');
    if (/(peito|seio|teta)/i.test(normalized)) add('peitos');
    if (/\b(pe|pes|pezinho|pezinhos)\b/i.test(normalized)) add('pes');
    const tagList = Array.from(tags).filter((tag) => tag !== 'foto' && tag !== 'video').slice(0, 20);
    const explicitness = /(pelada|nua|nude|sem roupa)/i.test(normalized) ? 'nude' : 'unspecified';
    const locallyClassified = classifyRequestedMediaLocally(input.requestText, input.action);
    const mediaKind = locallyClassified === 'not_media' && input.photoHint ? 'photo' : locallyClassified;
    const titleTokens = tagList.slice(0, 4);
    const title = titleTokens.length ? `Foto ${titleTokens.join(' · ')}` : 'Foto personalizada pedida pelo lead';
    const canonicalKey = ['photo', ...tagList.sort()].join('-').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 180);
    return {
        media_kind: mediaKind,
        title,
        canonical_key: canonicalKey || 'photo-personalizada',
        production_brief: cleanText(input.description, 700) || `Produzir uma foto que atenda ao pedido: “${cleanText(input.requestText, 300)}”. Não inventar detalhes que o lead não especificou.`,
        pose: tagList.includes('deitada') ? 'deitada' : (tagList.includes('de quatro') ? 'de quatro' : 'nao especificada'),
        outfit: tagList.includes('lingerie') ? 'lingerie' : (tagList.includes('nua') ? 'sem roupa' : 'nao especificado'),
        accessories: tagList.filter((tag) => ['orelhas de coelho', 'fantasia'].includes(tag)),
        setting: tagList.includes('banho') ? 'banheiro ou chuveiro' : (tagList.includes('cama') ? 'cama' : 'nao especificado'),
        framing: tagList.includes('selfie') ? 'selfie' : 'nao especificado',
        expression: 'nao especificada',
        explicitness,
        body_focus: tagList.filter((tag) => ['bunda', 'peitos', 'pes', 'rosto'].includes(tag)),
        props: [],
        tags: tagList,
        confidence: mediaKind === 'photo' ? 0.62 : 0.9,
        model: 'local-fallback',
    };
};

const parseJsonContent = (content: unknown) => JSON.parse(
    cleanText(content, 20_000).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''),
);

const normalizeAnalysis = (input: any, model: string, fallback: PhotoRequestAnalysis): PhotoRequestAnalysis => {
    const mediaKind = ['photo', 'video', 'not_media'].includes(input?.media_kind) ? input.media_kind : fallback.media_kind;
    const explicitness = ['safe', 'suggestive', 'nude', 'explicit', 'unspecified'].includes(input?.explicitness)
        ? input.explicitness
        : fallback.explicitness;
    const tags = cleanList(input?.tags, 20);
    const canonicalKey = normalize(input?.canonical_key || fallback.canonical_key)
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 180);
    return {
        media_kind: mediaKind,
        title: cleanText(input?.title, 120) || fallback.title,
        canonical_key: canonicalKey || fallback.canonical_key,
        production_brief: cleanText(input?.production_brief, 900) || fallback.production_brief,
        pose: cleanText(input?.pose, 120) || 'nao especificada',
        outfit: cleanText(input?.outfit, 160) || 'nao especificado',
        accessories: cleanList(input?.accessories, 10),
        setting: cleanText(input?.setting, 160) || 'nao especificado',
        framing: cleanText(input?.framing, 120) || 'nao especificado',
        expression: cleanText(input?.expression, 120) || 'nao especificada',
        explicitness,
        body_focus: cleanList(input?.body_focus, 10),
        props: cleanList(input?.props, 10),
        tags: tags.length ? tags : fallback.tags,
        confidence: clamp(input?.confidence, 0, 1, fallback.confidence),
        model,
    };
};

export const analyzeMissingPhotoRequest = async (input: {
    requestText: string;
    description?: string;
    tags?: string[];
    action?: string;
    photoHint?: boolean;
}) => {
    const fallback = localAnalysis(input);

    // Regra estrutural: pedido exclusivamente de vídeo nunca chega à fila de fotos.
    if (fallback.media_kind === 'video') return fallback;
    if (fallback.media_kind === 'not_media' && !input.description) return fallback;

    const settings = await getPreviewVisionSettings();
    if (!settings.apiKey) return fallback;

    const prompt = `Você organiza pedidos de FOTOS para o catálogo privado de uma criadora adulta com identidade, maioridade e autorização verificadas pelo administrador.

Analise o pedido real do lead e converta-o em uma ficha objetiva para produção. Classifique media_kind como photo apenas quando ele pediu uma imagem estática; video para vídeo/gravação; not_media quando não há pedido visual. A fila aceita SOMENTE photo.

Una sinônimos em uma identidade canônica estável: pedidos equivalentes devem produzir o mesmo canonical_key, em inglês técnico simples, começando com "photo-". Preserve apenas detalhes realmente pedidos. Quando pose, roupa, cenário, enquadramento ou expressão não forem informados, escreva "não especificado". O production_brief deve ser curto, claro e acionável para o administrador, sem inventar detalhes. Gere tags concretas em português.

Pedido original: ${cleanText(input.requestText, 500)}
Sugestão do cérebro: ${cleanText(input.description, 500) || 'nenhuma'}
Tags sugeridas: ${cleanList(input.tags, 20).join(', ') || 'nenhuma'}
Ação sugerida: ${cleanText(input.action, 80) || 'nenhuma'}`;

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
                model: settings.primaryModel,
                ...(settings.fallbackModel && settings.fallbackModel !== settings.primaryModel
                    ? { models: [settings.fallbackModel] }
                    : {}),
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.05,
                max_tokens: 900,
                response_format: {
                    type: 'json_schema',
                    json_schema: { name: 'missing_photo_request', strict: true, schema: requestSchema },
                },
                provider: { require_parameters: true, allow_fallbacks: true },
            }),
        });
        const raw = await response.text();
        if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${raw.slice(0, 500)}`);
        const payload = JSON.parse(raw);
        const content = payload?.choices?.[0]?.message?.content;
        if (!content) throw new Error('OpenRouter retornou ficha vazia');
        const analysis = normalizeAnalysis(parseJsonContent(content), String(payload?.model || settings.primaryModel), fallback);

        // O classificador textual tem precedência para bloquear vídeo-only mesmo se o modelo errar.
        if (classifyRequestedMediaLocally(input.requestText, input.action) === 'video') {
            return { ...analysis, media_kind: 'video' as const };
        }
        return analysis;
    } catch (error: any) {
        console.warn('[PREVIAS] Falha ao analisar pedido de foto; usando ficha local:', error?.message || error);
        return fallback;
    }
};
