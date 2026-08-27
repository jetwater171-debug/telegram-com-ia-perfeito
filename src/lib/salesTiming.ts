export type SalesProduct = 'video_call' | 'social_meetup' | 'vip' | 'custom_photo' | 'custom_video' | 'private_number' | 'private_chat' | 'erotic_audio' | 'evaluation' | 'gift' | 'custom_request';

export const VIP_PRICE = 19.90;

export type AdaptiveOfferPlan = {
    product: SalesProduct;
    tier: 'entry' | 'core' | 'premium' | 'voluntary';
    value: number;
    description: string;
    format: string;
    explicitBudget: number | null;
    valueSource: 'explicit_budget' | 'accepted_offer' | 'purchase_history' | 'standard';
    requestBrief: string | null;
};

export type SalesOrderStatus = 'offered' | 'accepted' | 'payment_pending' | 'paid' | 'superseded' | 'expired';

export type ActiveSalesOrder = {
    orderId: string;
    product: SalesProduct;
    amount: number;
    description: string;
    requestBrief: string | null;
    status: SalesOrderStatus;
    offeredAt: string;
    acceptedAt: string | null;
    expiresAt: string;
    paymentId: string | null;
    gateway: string | null;
};

type SalesMessage = {
    sender?: string | null;
    content?: string | null;
    created_at?: string | null;
};

type LeadMemoryLike = {
    metadata?: Record<string, unknown> | null;
};

const normalize = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const SALES_PRODUCTS = new Set<SalesProduct>([
    'video_call', 'social_meetup', 'vip', 'custom_photo', 'custom_video',
    'private_number', 'private_chat', 'erotic_audio', 'evaluation', 'gift', 'custom_request',
]);
const OPEN_ORDER_STATUSES = new Set<SalesOrderStatus>(['offered', 'accepted', 'payment_pending']);

const money = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
};

export const readActiveSalesOrder = (value: unknown, now = new Date()): ActiveSalesOrder | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const product = String(row.product || '') as SalesProduct;
    const status = String(row.status || '') as SalesOrderStatus;
    const amount = money(row.amount);
    const expiresAt = String(row.expiresAt || row.expires_at || '');
    const expiryMs = Date.parse(expiresAt);
    if (!String(row.orderId || row.order_id || '').trim() || !SALES_PRODUCTS.has(product) || !amount) return null;
    if (!OPEN_ORDER_STATUSES.has(status)) return null;
    if (!Number.isFinite(expiryMs) || expiryMs <= now.getTime()) return null;
    return {
        orderId: String(row.orderId || row.order_id).trim().slice(0, 240),
        product,
        amount,
        description: String(row.description || '').trim().slice(0, 200) || product,
        requestBrief: String(row.requestBrief || row.request_brief || '').trim().slice(0, 2_000) || null,
        status,
        offeredAt: String(row.offeredAt || row.offered_at || now.toISOString()),
        acceptedAt: String(row.acceptedAt || row.accepted_at || '').trim() || null,
        expiresAt,
        paymentId: String(row.paymentId || row.payment_id || '').trim() || null,
        gateway: String(row.gateway || '').trim() || null,
    };
};

export const buildSalesOrderSnapshot = ({
    orderId,
    plan,
    status,
    now = new Date(),
    previous,
}: {
    orderId: string;
    plan: AdaptiveOfferPlan;
    status: Extract<SalesOrderStatus, 'offered' | 'accepted' | 'payment_pending'>;
    now?: Date;
    previous?: ActiveSalesOrder | null;
}): ActiveSalesOrder => {
    const canReuse = previous
        && previous.product === plan.product
        && Math.round(previous.amount * 100) === Math.round(plan.value * 100)
        && normalize(previous.requestBrief || '') === normalize(plan.requestBrief || '')
        && previous.status !== 'paid';
    const base = canReuse ? previous : null;
    const accepted = status === 'accepted' || status === 'payment_pending';
    // A oferta dura um dia. Depois que existe PIX, preservamos o pedido por sete
    // dias para que uma compra tardia ainda seja conciliada com o pedido certo.
    const ttlMs = status === 'payment_pending' ? 7 * 24 * 60 * 60_000 : 24 * 60 * 60_000;
    return {
        orderId: base?.orderId || String(orderId).trim().slice(0, 240),
        product: plan.product,
        amount: Math.round(Number(plan.value) * 100) / 100,
        description: String(plan.description || plan.product).trim().slice(0, 200),
        requestBrief: plan.requestBrief ? String(plan.requestBrief).trim().slice(0, 2_000) : null,
        status,
        offeredAt: base?.offeredAt || now.toISOString(),
        acceptedAt: accepted ? (base?.acceptedAt || now.toISOString()) : null,
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        paymentId: base?.paymentId || null,
        gateway: base?.gateway || null,
    };
};

const formatBrl = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`;

export const canonicalizeSalesOfferMessages = (messages: string[], amount: number) => {
    const canonical = formatBrl(amount);
    return (messages || []).map((message) => String(message || '').replace(
        /R\$\s*\d{1,4}(?:[.,]\d{1,2})?/gi,
        canonical,
    ));
};

export const detectPaidProduct = (text: string): SalesProduct | null => {
    const value = normalize(text);
    if (/\b(ifood|lanche|janta|almoco|mimo|presente|agrado|ajudar vc|ajudar voce)\b/i.test(value)
        || /\b(?:te|pra vc|para voce)\s+(?:mando|mandar|dar)\b.{0,24}\b(?:pix|reais|conto)\b/i.test(value)) return 'gift';
    if (/\b(?:encontro presencial|marcar (?:um )?encontro|marcar (?:de )?sair|vamos sair|sair comigo|sair com (?:vc|voce)|te encontrar|me encontra|a gente se encontr(?:ar|ando)|quando a gente se encontrar|vc vem|voce vem|vem aqui|vem me ver|eu te busco|vou te buscar|me busca|passar um tempo (?:com|juntos))\b/i.test(value)) return 'social_meetup';
    if (/\b(chamada|video chamada|videochamada|call|facetime)\b/i.test(value)) return 'video_call';
    if (/\b(vip|vitalicio|mensal|pack|acesso)\b/i.test(value)) return 'vip';
    if (/\b(foto personalizada|foto exclusiva|foto pelada|nude sem censura)\b/i.test(value)) return 'custom_photo';
    if (/\b(video personalizado|video completo|video exclusivo)\b/i.test(value)) return 'custom_video';
    if (/\bvideo\b/i.test(value)
        && (/\b(de quatro|mostrando|fazendo|gemendo|tirando a roupa|do jeito que eu pedir|do jeito que eu quero|pra mim|para mim)\b/i.test(value)
            || /\b(?:grava|grave|faz|faca|manda|envia)\b.{0,24}\bvideo\b|\bvideo\b.{0,40}\b(?:de quatro|mostrando|fazendo|gemendo)\b/i.test(value))) return 'custom_video';
    if (/\b(?:pagar|pago|comprar|faz por|fecha por)\b.{0,30}\b(?:foto|nude)\b|\b(?:foto|nude)\b.{0,30}\b(?:pagar|reais|conto)\b/i.test(value)) return 'custom_photo';
    if (/\b(?:pagar|pago|comprar|faz por|fecha por)\b.{0,30}\bvideo\b|\bvideo\b.{0,30}\b(?:pagar|reais|conto)\b/i.test(value)) return 'custom_video';
    if (/\b(whatsapp|numero pessoal|seu numero|contato pessoal)\b/i.test(value)) return 'private_number';
    if (/\b(chat privado|atencao exclusiva|companhia exclusiva|conversar no privado|namoradinha virtual)\b/i.test(value)) return 'private_chat';
    if (/\b(?:audio|voz)\b.{0,50}\b(?:erotico|safado|gemendo|gemido|gozando|personalizado)\b/i.test(value)
        || /\b(?:erotico|safado|gemendo|gemido|gozando)\b.{0,50}\b(?:audio|voz)\b/i.test(value)
        || /\b(?:geme|gemendo|gemido)\b.{0,35}\b(?:meu nome|o meu nome|me chama pelo nome)\b/i.test(value)
        || /\b(?:fala|diz|chama)\b.{0,30}\b(?:meu nome|o meu nome)\b.{0,30}\b(?:gemendo|com gemido)\b/i.test(value)) return 'erotic_audio';
    if (/\b(avaliacao|avaliar meu pau|avalia meu pau)\b/i.test(value)) return 'evaluation';
    const mentionsCustomItem = /\b(calcinha|sutia|lingerie usada|roupa usada|presente personalizado|objeto pessoal)\b/i.test(value);
    const explicitCustomCommerce = /\b(?:vendo|vende|vender|compro|comprar|te pago|pago pra|pagaria|quanto cobra|quanto vc quer|faz por|fecha por)\b/i.test(value);
    const requestedPaidAction = /(?:se eu (?:te )?pagar|por dinheiro|em troca de|te mando um pix)/i.test(value)
        && /\b(?:faz|faca|manda|envia|grava|usa|veste|interpreta|finge|realiza)\b/i.test(value);
    const specificFantasy = /\b(?:corno|cuckold|humilhacao|dominacao|fetiche|roleplay|fantasia personalizada)\b/i.test(value)
        && /\b(?:quero|queria|gostaria|faz|faca|topa|pagaria|pago)\b/i.test(value);
    if ((mentionsCustomItem && (explicitCustomCommerce || /\bquero\b/i.test(value))) || explicitCustomCommerce || requestedPaidAction || specificFantasy) return 'custom_request';
    return null;
};

const productFromMemory = (memory: LeadMemoryLike): SalesProduct | null => {
    const value = String(memory?.metadata?.sales_nurture_product || '');
    return ['video_call', 'social_meetup', 'vip', 'custom_photo', 'custom_video', 'private_number', 'private_chat', 'erotic_audio', 'evaluation', 'gift', 'custom_request'].includes(value)
        ? value as SalesProduct
        : null;
};

const isRecent = (value: unknown, maxAgeMs: number, now: Date) => {
    const timestamp = new Date(String(value || '')).getTime();
    return Number.isFinite(timestamp) && now.getTime() - timestamp <= maxAgeMs;
};

const isDirectCheckoutRequest = (text: string) => {
    const value = normalize(text);
    return /^(pix|chave pix|codigo pix)$/i.test(value)
        || /\b(?:qual|cad[eê]|kd|onde esta|onde ta|me da|me passa)\b.{0,20}\b(?:o )?(?:pix|chave pix|codigo pix|copia e cola)\b/i.test(value)
        || /\b(?:manda|mande|gera|gere|passa|envia|manda ai|manda aí|mande ai)\b.{0,24}\b(?:pix|chave|codigo|link)\b/i.test(value)
        || /\b(?:pix|chave pix|codigo pix|copia e cola)\b.{0,20}\b(?:manda|passa|envia|agora)\b/i.test(value)
        || /\b(?:quero|vou|posso|ja quero|já quero)\s+pagar\b/i.test(value)
        || /\bcomo\s+(?:eu\s+)?pago\b/i.test(value)
        || /\b(?:pode|ja pode|pode ja)\s+(?:gerar|cobrar|mandar o pix|passar o pix)\b/i.test(value)
        || /\bfecha\s+(?:pra|para)\s+mim\b/i.test(value)
        || /\b(?:quero te mandar|vou te mandar|te mando|posso te mandar|quero te dar|te dou)\s+(?:r\$\s*)?\d{1,4}(?:[.,]\d{1,2})?\b/i.test(value)
        || /\b(?:pagar|bancar|mandar)\b.{0,24}\b(?:ifood|lanche|janta|mimo)\b.{0,24}\b\d{1,4}(?:[.,]\d{1,2})?\b/i.test(value);
};

const isPriceQuestion = (text: string) => /\b(quanto custa|qual (?:e |é )?o?\s*valor|qual (?:e |é )?o?\s*preco|quanto (?:e|é)|fica quanto|quanto sai|(?:vc|voce) cobra|cobra quanto|quanto (?:vc|voce) cobra)\b/i.test(normalize(text));

const isOfferAcceptance = (text: string) => {
    const value = normalize(text).replace(/[.!?]+$/g, '').trim();
    return /^(sim|quero|eu quero|pode ser|fechado|bora|vamos|aceito|combinado|ta bom|tá bom|beleza|manda|manda aí|manda ai|manda o link|manda o pix|passa o pix|gera|faz|pode mandar|quero sim|claro|com certeza|vitalicio|vitalício|mensal|quero o vip|quero o mensal|quero o vitalicio|topo|partiu|fechou)$/i.test(value)
        || /\b(fecha|fechado|fechou|aceito|pode ser esse|quero esse|quero essa|vamos fazer|manda o link|manda o pix|manda a chave|passa o pix|passa a chave|gera o pix|vou pagar|quero pagar|pode gerar|pode mandar o pix|passa a chave pix)\b/i.test(value)
        || /\b(?:nao quero|sem)\s+(?:o )?(?:extra|avaliacao)\b/i.test(value)
        || /\bso\s+(?:o|a)\s+(?:vip|chamada|encontro|foto|video|numero|audio|avaliacao|chat)\b/i.test(value);
};

const parseMoney = (value: string) => {
    const cleaned = value.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
};

const extractOfferValue = (text: string) => {
    const value = String(text || '');
    const patterns = [
        /r\$\s*(\d{1,4}(?:[.,]\d{1,2})?)/gi,
        /\b(?:fica|custa|valor|preco|por)\s+(\d{1,4}(?:[.,]\d{1,2})?)\b/gi,
    ];
    const found: number[] = [];
    for (const pattern of patterns) {
        for (const match of value.matchAll(pattern)) {
            const parsed = parseMoney(match[1]);
            if (parsed) found.push(parsed);
        }
    }
    return found.at(-1) ?? null;
};

const findRecentOffer = (messages: SalesMessage[], now: Date, preferredProduct: SalesProduct | null) => messages
    .filter((message) => String(message.sender || '') === 'bot' && isRecent(message.created_at, 90 * 60_000, now))
    .map((message) => ({
        value: extractOfferValue(String(message.content || '')),
        product: detectPaidProduct(String(message.content || '')),
        createdAt: new Date(String(message.created_at || '')).getTime(),
    }))
    .filter((offer) => offer.value !== null)
    .sort((a, b) => {
        const productScore = (offer: typeof a) => offer.product === preferredProduct ? 2 : offer.product === null ? 1 : 0;
        return productScore(b) - productScore(a) || b.createdAt - a.createdAt;
    })[0] || null;

export const extractExplicitBudget = (text: string) => {
    const value = normalize(text);
    // So considera dinheiro que o lead vinculou a pagamento, limite ou presente.
    // Uma frase casual como "tenho 10k na conta" nao vira autorizacao para cobrar 10 mil.
    const patterns = [
        /\b(?:so tenho|tenho so|meu limite e|meu orcamento e|consigo pagar|posso pagar|pago|faz por|fecha por|da pra fazer por)\s+(?:r\$\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\b/i,
        /\b(?:te mando|quero te mandar|posso te mandar|vou te mandar|te dou|quero te dar)\s+(?:r\$\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\b/i,
        /\b(?:tenho|sobrou)\s+(?:r\$\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:reais|real|conto|contos)\s+(?:pra|para)\s+(?:isso|vc|voce|pagar|comprar)\b/i,
        /\b(?:ifood|lanche|janta|mimo)\b.{0,24}\b(?:de|no valor de|mandando)\s+(?:r\$\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\b/i,
    ];
    for (const pattern of patterns) {
        const match = value.match(pattern);
        if (match) return parseMoney(match[1]);
    }
    return null;
};

const PRODUCT_OFFERS: Record<Exclude<SalesProduct, 'gift'>, {
    entry: [number, string, string];
    core: [number, string, string];
    premium: [number, string, string];
}> = {
    video_call: {
        entry: [19.90, 'Chamada de Video Curta', 'uma chamada curta e exclusiva'],
        core: [29.90, 'Chamada de Video Exclusiva', 'uma chamada exclusiva no sigilo'],
        premium: [49.90, 'Chamada de Video Premium', 'uma chamada mais longa e personalizada'],
    },
    social_meetup: {
        entry: [350, 'Encontro Curto com a Lari', 'um encontro curto de ate uma hora, sujeito a confirmacao de disponibilidade'],
        core: [500, 'Encontro com Larissa Morais', 'um encontro de ate duas horas, com transporte combinado separadamente'],
        premium: [750, 'Encontro Estendido com a Lari', 'um encontro estendido de ate quatro horas, sujeito a confirmacao de disponibilidade'],
    },
    vip: {
        entry: [VIP_PRICE, 'VIP Lari', 'acesso ao VIP da Lari'],
        core: [VIP_PRICE, 'VIP Lari', 'acesso ao VIP da Lari'],
        premium: [VIP_PRICE, 'VIP Lari', 'acesso ao VIP da Lari'],
    },
    custom_photo: {
        entry: [9.90, 'Foto Personalizada Simples', 'uma foto personalizada simples'],
        core: [14.90, 'Foto Personalizada Lari', 'uma foto personalizada do jeito combinado'],
        premium: [29.90, 'Ensaio Personalizado Lari', 'uma sequencia de fotos personalizadas'],
    },
    custom_video: {
        entry: [14.90, 'Video Personalizado Curto', 'um video personalizado curtinho'],
        core: [19.90, 'Video Personalizado Lari', 'um video personalizado do jeito combinado'],
        premium: [49.90, 'Video Personalizado Premium', 'um video mais longo e detalhado'],
    },
    private_number: {
        entry: [14.90, 'Contato Privado Promocional', 'acesso inicial ao contato privado'],
        core: [19.90, 'Numero Pessoal Lari', 'o numero pessoal para conversar no privado'],
        premium: [29.90, 'Numero + Atencao Exclusiva', 'numero pessoal com atencao exclusiva'],
    },
    private_chat: {
        entry: [9.90, 'Conversa Privada Curta', 'um momento curto de conversa so com ela'],
        core: [14.90, 'Atencao Exclusiva Lari', 'atencao exclusiva no chat privado'],
        premium: [29.90, 'Companhia Privada Premium', 'uma experiencia mais longa de companhia e atencao'],
    },
    erotic_audio: {
        entry: [9.90, 'Audio Personalizado Curto', 'um audio personalizado curtinho'],
        core: [14.90, 'Audio Erotico Personalizado', 'um audio erotico personalizado'],
        premium: [24.90, 'Audios Personalizados Premium', 'uma sequencia de audios personalizados'],
    },
    evaluation: {
        entry: [9.90, 'Avaliacao Personalizada', 'uma avaliacao personalizada'],
        core: [14.90, 'Avaliacao com Audio', 'avaliacao detalhada com audio'],
        premium: [24.90, 'Avaliacao Premium', 'avaliacao completa e bem detalhada'],
    },
    custom_request: {
        entry: [29.90, 'Pedido Personalizado', 'um pedido personalizado conforme combinado'],
        core: [59.90, 'Pedido Personalizado Exclusivo', 'um pedido exclusivo feito conforme o briefing'],
        premium: [99.90, 'Pedido Personalizado Premium', 'um pedido premium com escopo mais completo'],
    },
};

export const buildCustomRequestBrief = (text: string) => String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*\[.*?\]\s*/g, '')
    .trim()
    .slice(0, 500);

export type LeadScoreInput = {
    tarado?: number;
    financeiro?: number;
    carente?: number;
    sentimental?: number;
};

const createOfferPlan = ({
    product,
    explicitBudget,
    acceptedOfferValue,
    totalPaid,
    nurtureTurns,
    userText,
    leadScore,
    deviceType,
    customRequestBrief,
}: {
    product: SalesProduct | null;
    explicitBudget: number | null;
    acceptedOfferValue: number | null;
    totalPaid: number;
    nurtureTurns: number;
    userText: string;
    leadScore?: LeadScoreInput | null;
    deviceType?: string | null;
    customRequestBrief?: string | null;
}): AdaptiveOfferPlan | null => {
    if (!product) return null;
    if (product === 'gift') {
        const voluntaryValue = explicitBudget ?? acceptedOfferValue;
        if (!voluntaryValue) return null;
        return {
            product,
            tier: 'voluntary',
            value: Math.min(1000, voluntaryValue),
            description: 'Mimo para Lari',
            format: 'um mimo espontaneo para a Lari',
            explicitBudget,
            valueSource: explicitBudget ? 'explicit_budget' : 'accepted_offer',
            requestBrief: 'mimo espontaneo',
        };
    }
    if (product === 'social_meetup') {
        return {
            product,
            tier: 'core',
            value: 500,
            description: 'Encontro com Larissa Morais',
            format: 'um encontro de ate duas horas, com transporte combinado separadamente',
            explicitBudget: null,
            valueSource: 'standard',
            requestBrief: null,
        };
    }
    if (product === 'vip') {
        return {
            product,
            tier: 'core',
            value: VIP_PRICE,
            description: 'VIP Lari',
            format: 'acesso ao VIP da Lari',
            explicitBudget,
            valueSource: 'standard',
            requestBrief: null,
        };
    }

    if (product === 'custom_request' && (explicitBudget || acceptedOfferValue)) {
        const acceptedValue = Math.min(5_000, Math.max(5, Number(explicitBudget || acceptedOfferValue)));
        return {
            product,
            tier: acceptedValue >= 99.90 ? 'premium' : acceptedValue >= 59.90 ? 'core' : 'entry',
            value: Math.round(acceptedValue * 100) / 100,
            description: 'Pedido Personalizado Lari',
            format: customRequestBrief || 'um pedido personalizado conforme combinado',
            explicitBudget,
            valueSource: explicitBudget ? 'explicit_budget' : 'accepted_offer',
            requestBrief: customRequestBrief || null,
        };
    }

    const catalog = PRODUCT_OFFERS[product];
    let tier: 'entry' | 'core' | 'premium' = 'core';
    let valueSource: AdaptiveOfferPlan['valueSource'] = 'standard';
    let customValue: number | null = null;

    const normalizedRequest = normalize(userText);
    const wantsPremiumScope = /\b(premium|completo|completa|mais longo|mais longa|bem detalhado|bem detalhada|varias fotos|sequencia|quero tudo|caprichado|caprichada)\b/i.test(normalizedRequest);
    const wantsEntryScope = /\b(curto|curta|curtinho|curtinha|simples|basico|basica|baratinho|baratinha|so um|so uma)\b/i.test(normalizedRequest);
    const priceSensitive = /\b(ta caro|muito caro|sem dinheiro|to liso|estou liso|desempregado|nao tenho dinheiro|desconto|mais barato|faz menos)\b/i.test(normalizedRequest);

    const finScore = Number(leadScore?.financeiro ?? 25);
    if (acceptedOfferValue) {
        customValue = acceptedOfferValue;
        valueSource = 'accepted_offer';
    } else if (explicitBudget) {
        customValue = Math.min(explicitBudget, catalog.premium[0]);
        tier = customValue < catalog.core[0] ? 'entry' : customValue >= catalog.premium[0] ? 'premium' : 'core';
        valueSource = 'explicit_budget';
    } else if (wantsPremiumScope || finScore >= 70 || totalPaid >= 50) {
        tier = 'premium';
        if (finScore >= 60 || totalPaid >= 50) valueSource = 'purchase_history';
    } else if (wantsEntryScope || priceSensitive || finScore < 20) {
        tier = 'entry';
    } else if (nurtureTurns >= 3 && totalPaid >= 20) {
        tier = 'core';
    }

    const selected = catalog[tier];
    return {
        product,
        tier,
        value: Math.max(5, Math.round((customValue ?? selected[0]) * 100) / 100),
        description: selected[1],
        format: selected[2],
        explicitBudget,
        valueSource,
        requestBrief: product === 'custom_request' || product === 'erotic_audio' ? customRequestBrief || null : null,
    };
};

const isEngagedContinuation = (text: string) => /\b(imagina|queria|gostaria|tesao|gozar|comer|chupar|meter|safad|gostos|delicia|mostra|fazer comigo|como seria|eu ia|eu quero)\b/i.test(normalize(text));

export const evaluateSalesTiming = ({
    userText,
    recentMessages = [],
    leadMemory = {},
    totalPaid = 0,
    now = new Date(),
    leadScore,
    deviceType,
}: {
    userText: string;
    recentMessages?: SalesMessage[];
    leadMemory?: LeadMemoryLike;
    totalPaid?: number;
    now?: Date;
    leadScore?: LeadScoreInput | null;
    deviceType?: string | null;
}) => {
    const detectedProduct = detectPaidProduct(userText);
    const storedActiveOrder = readActiveSalesOrder(leadMemory?.metadata?.sales_active_order, now);
    const compatibleActiveOrder = storedActiveOrder && (!detectedProduct || storedActiveOrder.product === detectedProduct)
        ? storedActiveOrder
        : null;
    const rememberedProduct = isRecent(leadMemory?.metadata?.sales_nurture_updated_at, 12 * 60 * 60_000, now)
        ? productFromMemory(leadMemory)
        : null;
    const activeProduct = detectedProduct || compatibleActiveOrder?.product || rememberedProduct;
    const rememberedCustomBrief = String(leadMemory?.metadata?.sales_custom_request_brief || '').trim();
    const isBriefedProduct = activeProduct === 'custom_request' || activeProduct === 'erotic_audio';
    const customRequestBrief = isBriefedProduct
        ? (detectedProduct === activeProduct ? buildCustomRequestBrief(userText) : rememberedCustomBrief)
        : null;
    const sameProduct = Boolean(activeProduct && activeProduct === rememberedProduct);
    const previousTurns = sameProduct ? Math.max(0, Number(leadMemory?.metadata?.sales_nurture_turns || 0)) : 0;
    const engagedContinuation = Boolean(activeProduct && isEngagedContinuation(userText));
    const shouldAdvanceNurture = Boolean(detectedProduct || engagedContinuation);
    const nurtureTurns = activeProduct
        ? Math.min(20, previousTurns + (shouldAdvanceNurture ? 1 : 0))
        : 0;
    const directCheckout = isDirectCheckoutRequest(userText);
    const askedPrice = isPriceQuestion(userText);
    const storedOfferDetails = compatibleActiveOrder ? {
        value: compatibleActiveOrder.amount,
        product: compatibleActiveOrder.product,
        createdAt: Date.parse(compatibleActiveOrder.offeredAt),
    } : null;
    const recentOfferDetails = storedOfferDetails || findRecentOffer(recentMessages, now, activeProduct);
    const recentOffer = Boolean(recentOfferDetails);
    const acceptedOffer = isOfferAcceptance(userText);
    const latestBotMessage = recentMessages
        .filter((message) => String(message.sender || '') === 'bot' && message.created_at)
        .sort((left, right) => Date.parse(String(right.created_at)) - Date.parse(String(left.created_at)))[0];
    const latestBotText = String(latestBotMessage?.content || '');
    const acceptanceAnswersCurrentOffer = acceptedOffer
        && (Boolean(compatibleActiveOrder)
            || (Boolean(latestBotText) && (isCheckoutMessage(latestBotText)
            || isPricePitchMessage(latestBotText)
            || (detectPaidProduct(latestBotText) === activeProduct && extractOfferValue(latestBotText) !== null))));
    const salesContextActive = Boolean(detectedProduct || engagedContinuation || directCheckout || askedPrice || acceptedOffer || recentOffer);
    const canPitchPrice = true;
    const explicitBudget = extractExplicitBudget(userText);
    const fixedVipBudgetGap = activeProduct === 'vip'
        && explicitBudget !== null
        && explicitBudget < VIP_PRICE;
    // Cobrança exige o produto dito neste turno ou um pedido ativo persistido.
    // Memória de produto e texto antigo ajudam a conversar, mas nunca reabrem
    // sozinhos uma compra já paga.
    const hasAuthoritativeOrderContext = Boolean(detectedProduct || compatibleActiveOrder);
    const canGeneratePayment = (directCheckout || acceptanceAnswersCurrentOffer)
        && hasAuthoritativeOrderContext
        && !fixedVipBudgetGap;
    const offerPlan = createOfferPlan({
        product: activeProduct,
        explicitBudget,
        acceptedOfferValue: canGeneratePayment ? recentOfferDetails?.value ?? null : null,
        totalPaid: Math.max(0, Number(totalPaid || 0)),
        nurtureTurns,
        userText,
        leadScore,
        deviceType,
        customRequestBrief,
    });

    return {
        activeProduct,
        activeOrder: compatibleActiveOrder,
        salesContextActive,
        nurtureTurns,
        directCheckout,
        askedPrice,
        recentOffer,
        acceptedOffer,
        canPitchPrice,
        canGeneratePayment,
        fixedVipBudgetGap,
        explicitBudget,
        recentOfferValue: recentOfferDetails?.value ?? null,
        offerPlan,
        customRequestBrief,
        metadataPatch: activeProduct && salesContextActive ? {
            sales_nurture_product: activeProduct,
            sales_nurture_turns: nurtureTurns,
            sales_nurture_updated_at: now.toISOString(),
            sales_checkout_ready: canGeneratePayment,
            sales_offer_seen: recentOffer,
            sales_offer_value: offerPlan?.value ?? leadMemory?.metadata?.sales_offer_value ?? null,
            sales_offer_tier: offerPlan?.tier ?? leadMemory?.metadata?.sales_offer_tier ?? null,
            ...(customRequestBrief ? { sales_custom_request_brief: customRequestBrief } : {}),
        } : {},
    };
};

const isCheckoutMessage = (message: string) => /\b(pix|chave pix|codigo pix|copia e cola|vou gerar|gerar seu|mandar o pix|pagar|pagamento)\b/i.test(normalize(message));
const isPricePitchMessage = (message: string) => /r\$\s*\d|\b(?:fica|custa|valor|preco|por)\s+(?:r\$\s*)?\d{1,3}(?:[,.]\d{2})?\b|\bchama no privado\b/i.test(normalize(message));

const deterministicPick = (items: string[], seed: string) => {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return items[(hash >>> 0) % items.length];
};

const productWarmup = (product: SalesProduct | null, seed: string) => {
    if (product === 'social_meetup') {
        return [
            deterministicPick([
                'entendi, vc quer passar um tempo comigo de verdade e conversar',
                'agora entendi, vc quer minha companhia pessoalmente',
                'gostei de saber que vc quer me conhecer e conversar comigo',
            ], `${seed}:meetup:1`),
            deterministicPick([
                'qual dia seria melhor pra vc?',
                'em qual bairro vc pensou da gente se encontrar?',
                'vc prefere cafe, shopping ou outro lugar publico?',
            ], `${seed}:meetup:2`),
            'depois eu confirmo minha disponibilidade e a gente combina certinho',
        ];
    }

    if (product === 'video_call') {
        return [
            deterministicPick([
                'quero imaginar sua cara quando eu aparecesse na tela',
                'eu ia começar te olhando bem quietinha pela câmera',
                'só de imaginar vc me vendo ao vivo eu já fico arrepiada',
            ], `${seed}:call:1`),
            deterministicPick([
                'vc ia querer que eu começasse doce ou já bem safada?',
                'qual seria a primeira coisa que vc ia pedir quando me visse?',
                'me fala como vc imagina os primeiros minutos comigo',
            ], `${seed}:call:3`),
            deterministicPick([
                'depois eu ia chegando mais perto bem devagar pra te provocar',
                'ia deixar vc perceber cada reação minha sem nenhuma pressa',
                'quero fazer vc esquecer que existe qualquer coisa fora da nossa tela',
            ], `${seed}:call:2`),
        ];
    }

    return [
        deterministicPick([
            'quero entender exatamente a cena que vc ta imaginando comigo',
            'vc despertou uma vontade em mim e eu quero alimentar isso devagar',
            'antes de qualquer coisa quero entrar nessa fantasia com vc',
        ], `${seed}:generic:1`),
        deterministicPick([
            'vc prefere que eu comece mais doce ou bem provocante?',
            'qual parte dessa fantasia vc mais quer viver comigo?',
            'o que vc ia querer ver primeiro?',
        ], `${seed}:generic:3`),
        deterministicPick([
            'me conta o detalhe que mais ia te deixar sem controle',
            'quero montar isso na sua cabeça do jeitinho que vc gosta',
            'fecha os olhos e imagina como eu começaria com vc',
        ], `${seed}:generic:2`),
    ];
};

export const guardPrematureSaleMessages = ({
    messages,
    product,
    canPitchPrice,
    canGeneratePayment,
    userText,
}: {
    messages: string[];
    product: SalesProduct | null;
    canPitchPrice: boolean;
    canGeneratePayment: boolean;
    userText: string;
}) => {
    let safe = (messages || [])
        .map((message) => String(message || '').trim())
        .filter(Boolean)
        .filter((message) => canGeneratePayment || !isCheckoutMessage(message));

    if (safe.length === 0) safe = productWarmup(product, normalize(userText)).slice(0, 2);
    return safe.slice(0, 3);
};
