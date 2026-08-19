export type SalesProduct = 'video_call' | 'vip' | 'custom_photo' | 'custom_video' | 'private_number' | 'private_chat' | 'erotic_audio' | 'evaluation' | 'gift';

export type AdaptiveOfferPlan = {
    product: SalesProduct;
    tier: 'entry' | 'core' | 'premium' | 'voluntary';
    value: number;
    description: string;
    format: string;
    explicitBudget: number | null;
    valueSource: 'explicit_budget' | 'accepted_offer' | 'purchase_history' | 'standard';
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

export const detectPaidProduct = (text: string): SalesProduct | null => {
    const value = normalize(text);
    if (/\b(ifood|lanche|janta|almoco|mimo|presente|agrado|ajudar vc|ajudar voce)\b/i.test(value)
        || /\b(?:te|pra vc|para voce)\s+(?:mando|mandar|dar)\b.{0,24}\b(?:pix|reais|conto)\b/i.test(value)) return 'gift';
    if (/\b(chamada|video chamada|videochamada|call|facetime)\b/i.test(value)) return 'video_call';
    if (/\b(vip|vitalicio|mensal|pack|acesso)\b/i.test(value)) return 'vip';
    if (/\b(foto personalizada|foto exclusiva|foto pelada|nude sem censura)\b/i.test(value)) return 'custom_photo';
    if (/\b(video personalizado|video completo|video exclusivo)\b/i.test(value)) return 'custom_video';
    if (/\b(?:pagar|pago|comprar|faz por|fecha por)\b.{0,30}\b(?:foto|nude)\b|\b(?:foto|nude)\b.{0,30}\b(?:pagar|reais|conto)\b/i.test(value)) return 'custom_photo';
    if (/\b(?:pagar|pago|comprar|faz por|fecha por)\b.{0,30}\bvideo\b|\bvideo\b.{0,30}\b(?:pagar|reais|conto)\b/i.test(value)) return 'custom_video';
    if (/\b(whatsapp|numero pessoal|seu numero|contato pessoal)\b/i.test(value)) return 'private_number';
    if (/\b(chat privado|atencao exclusiva|companhia exclusiva|conversar no privado|namoradinha virtual)\b/i.test(value)) return 'private_chat';
    if (/\b(audio erotico|audio gemendo|gemido em audio)\b/i.test(value)) return 'erotic_audio';
    if (/\b(avaliacao|avaliar meu pau|avalia meu pau)\b/i.test(value)) return 'evaluation';
    return null;
};

const productFromMemory = (memory: LeadMemoryLike): SalesProduct | null => {
    const value = String(memory?.metadata?.sales_nurture_product || '');
    return ['video_call', 'vip', 'custom_photo', 'custom_video', 'private_number', 'private_chat', 'erotic_audio', 'evaluation', 'gift'].includes(value)
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
        || /\b(?:manda|mande|gera|gere|passa|envia)\b.{0,24}\b(?:pix|chave|codigo)\b/i.test(value)
        || /\b(?:quero|vou|posso)\s+pagar\b/i.test(value)
        || /\bcomo\s+(?:eu\s+)?pago\b/i.test(value)
        || /\b(?:pode|ja pode)\s+(?:gerar|cobrar|mandar o pix)\b/i.test(value)
        || /\bfecha\s+(?:pra|para)\s+mim\b/i.test(value)
        || /\b(?:quero te mandar|vou te mandar|te mando|posso te mandar|quero te dar|te dou)\s+(?:r\$\s*)?\d{1,4}(?:[.,]\d{1,2})?\b/i.test(value)
        || /\b(?:pagar|bancar|mandar)\b.{0,24}\b(?:ifood|lanche|janta|mimo)\b.{0,24}\b\d{1,4}(?:[.,]\d{1,2})?\b/i.test(value);
};

const isPriceQuestion = (text: string) => /\b(quanto custa|qual (?:e |é )?o?\s*valor|qual (?:e |é )?o?\s*preco|quanto (?:e|é)|fica quanto|quanto sai)\b/i.test(normalize(text));

const isOfferAcceptance = (text: string) => {
    const value = normalize(text).replace(/[.!?]+$/g, '').trim();
    return /^(sim|quero|eu quero|pode ser|fechado|bora|vamos|aceito|combinado|ta bom|beleza|manda|gera|faz)$/i.test(value)
        || /\b(fecha|fechado|aceito|pode ser esse|quero esse|quero essa|vamos fazer)\b/i.test(value)
        || /\b(?:nao quero|sem)\s+(?:o )?(?:extra|avaliacao)\b/i.test(value)
        || /\bso\s+(?:o|a)\s+(?:vip|chamada|foto|video|numero|audio|avaliacao|chat)\b/i.test(value);
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
    vip: {
        entry: [14.90, 'VIP Mensal Promocional', 'um mes de acesso ao VIP'],
        core: [24.90, 'VIP Vitalicio Lari', 'acesso vitalicio ao VIP completo'],
        premium: [34.80, 'VIP Vitalicio + Avaliacao', 'VIP vitalicio com avaliacao personalizada'],
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
};

const createOfferPlan = ({
    product,
    explicitBudget,
    acceptedOfferValue,
    totalPaid,
    nurtureTurns,
    userText,
}: {
    product: SalesProduct | null;
    explicitBudget: number | null;
    acceptedOfferValue: number | null;
    totalPaid: number;
    nurtureTurns: number;
    userText: string;
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
        };
    }

    const catalog = PRODUCT_OFFERS[product];
    let tier: 'entry' | 'core' | 'premium' = 'core';
    let valueSource: AdaptiveOfferPlan['valueSource'] = 'standard';
    let customValue: number | null = null;

    const normalizedRequest = normalize(userText);
    const wantsPremiumScope = /\b(premium|completo|completa|mais longo|mais longa|bem detalhado|bem detalhada|varias fotos|sequencia|quero tudo|caprichado|caprichada)\b/i.test(normalizedRequest);
    const wantsEntryScope = /\b(curto|curta|curtinho|curtinha|simples|basico|basica|baratinho|baratinha|so um|so uma)\b/i.test(normalizedRequest);

    if (acceptedOfferValue) {
        customValue = acceptedOfferValue;
        valueSource = 'accepted_offer';
    } else if (explicitBudget) {
        customValue = Math.min(explicitBudget, catalog.premium[0]);
        tier = customValue < catalog.core[0] ? 'entry' : customValue >= catalog.premium[0] ? 'premium' : 'core';
        valueSource = 'explicit_budget';
    } else if (wantsPremiumScope) {
        tier = 'premium';
    } else if (wantsEntryScope) {
        tier = 'entry';
    } else if (totalPaid >= 100 && nurtureTurns >= 3) {
        tier = 'premium';
        valueSource = 'purchase_history';
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
    };
};

const isEngagedContinuation = (text: string) => /\b(imagina|queria|gostaria|tesao|gozar|comer|chupar|meter|safad|gostos|delicia|mostra|fazer comigo|como seria|eu ia|eu quero)\b/i.test(normalize(text));

export const evaluateSalesTiming = ({
    userText,
    recentMessages = [],
    leadMemory = {},
    totalPaid = 0,
    now = new Date(),
}: {
    userText: string;
    recentMessages?: SalesMessage[];
    leadMemory?: LeadMemoryLike;
    totalPaid?: number;
    now?: Date;
}) => {
    const detectedProduct = detectPaidProduct(userText);
    const rememberedProduct = isRecent(leadMemory?.metadata?.sales_nurture_updated_at, 12 * 60 * 60_000, now)
        ? productFromMemory(leadMemory)
        : null;
    const activeProduct = detectedProduct || rememberedProduct;
    const sameProduct = Boolean(activeProduct && activeProduct === rememberedProduct);
    const previousTurns = sameProduct ? Math.max(0, Number(leadMemory?.metadata?.sales_nurture_turns || 0)) : 0;
    const engagedContinuation = Boolean(activeProduct && isEngagedContinuation(userText));
    const shouldAdvanceNurture = Boolean(detectedProduct || engagedContinuation);
    const nurtureTurns = activeProduct
        ? Math.min(20, previousTurns + (shouldAdvanceNurture ? 1 : 0))
        : 0;
    const directCheckout = isDirectCheckoutRequest(userText);
    const askedPrice = isPriceQuestion(userText);
    const recentOfferDetails = findRecentOffer(recentMessages, now, activeProduct);
    const recentOffer = Boolean(recentOfferDetails);
    const acceptedOffer = recentOffer && isOfferAcceptance(userText);
    const salesContextActive = Boolean(detectedProduct || engagedContinuation || directCheckout || askedPrice || acceptedOffer);
    const canPitchPrice = directCheckout || askedPrice || recentOffer || nurtureTurns >= 3;
    const canGeneratePayment = directCheckout || acceptedOffer;
    const explicitBudget = extractExplicitBudget(userText);
    const offerPlan = createOfferPlan({
        product: activeProduct,
        explicitBudget,
        acceptedOfferValue: canGeneratePayment ? recentOfferDetails?.value ?? null : null,
        totalPaid: Math.max(0, Number(totalPaid || 0)),
        nurtureTurns,
        userText,
    });

    return {
        activeProduct,
        salesContextActive,
        nurtureTurns,
        directCheckout,
        askedPrice,
        recentOffer,
        acceptedOffer,
        canPitchPrice,
        canGeneratePayment,
        explicitBudget,
        recentOfferValue: recentOfferDetails?.value ?? null,
        offerPlan,
        metadataPatch: activeProduct && salesContextActive ? {
            sales_nurture_product: activeProduct,
            sales_nurture_turns: nurtureTurns,
            sales_nurture_updated_at: now.toISOString(),
            sales_checkout_ready: canGeneratePayment,
            sales_offer_seen: recentOffer,
            sales_offer_value: offerPlan?.value ?? leadMemory?.metadata?.sales_offer_value ?? null,
            sales_offer_tier: offerPlan?.tier ?? leadMemory?.metadata?.sales_offer_tier ?? null,
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
        .filter((message) => canGeneratePayment || !isCheckoutMessage(message))
        .filter((message) => canPitchPrice || !isPricePitchMessage(message));

    if (!canPitchPrice) {
        const warmup = productWarmup(product, normalize(userText));
        for (const message of warmup) {
            if (safe.length >= 4) break;
            if (!safe.some((current) => normalize(current) === normalize(message))) safe.push(message);
        }
    }

    if (safe.length === 0) safe = productWarmup(product, normalize(userText)).slice(0, 3);
    return safe.slice(0, 4);
};
