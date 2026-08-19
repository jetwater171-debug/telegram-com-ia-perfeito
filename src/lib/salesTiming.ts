export type SalesProduct = 'video_call' | 'vip' | 'custom_photo' | 'custom_video' | 'private_number' | 'erotic_audio' | 'evaluation';

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
    if (/\b(chamada|video chamada|videochamada|call|facetime)\b/i.test(value)) return 'video_call';
    if (/\b(vip|vitalicio|mensal|pack|acesso)\b/i.test(value)) return 'vip';
    if (/\b(foto personalizada|foto exclusiva|foto pelada|nude sem censura)\b/i.test(value)) return 'custom_photo';
    if (/\b(video personalizado|video completo|video exclusivo)\b/i.test(value)) return 'custom_video';
    if (/\b(whatsapp|numero pessoal|seu numero|contato pessoal)\b/i.test(value)) return 'private_number';
    if (/\b(audio erotico|audio gemendo|gemido em audio)\b/i.test(value)) return 'erotic_audio';
    if (/\b(avaliacao|avaliar meu pau|avalia meu pau)\b/i.test(value)) return 'evaluation';
    return null;
};

const productFromMemory = (memory: LeadMemoryLike): SalesProduct | null => {
    const value = String(memory?.metadata?.sales_nurture_product || '');
    return ['video_call', 'vip', 'custom_photo', 'custom_video', 'private_number', 'erotic_audio', 'evaluation'].includes(value)
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
        || /\bfecha\s+(?:pra|para)\s+mim\b/i.test(value);
};

const isPriceQuestion = (text: string) => /\b(quanto custa|qual (?:e |é )?o?\s*valor|qual (?:e |é )?o?\s*preco|quanto (?:e|é)|fica quanto|quanto sai)\b/i.test(normalize(text));

const isOfferAcceptance = (text: string) => {
    const value = normalize(text).replace(/[.!?]+$/g, '').trim();
    return /^(sim|quero|eu quero|pode ser|fechado|bora|vamos|aceito|combinado|ta bom|beleza|manda|gera|faz)$/i.test(value)
        || /\b(fecha|fechado|aceito|pode ser esse|quero esse|quero essa|vamos fazer)\b/i.test(value);
};

const hasRecentOffer = (messages: SalesMessage[], now: Date) => messages.some((message) => {
    if (String(message.sender || '') !== 'bot') return false;
    if (!isRecent(message.created_at, 90 * 60_000, now)) return false;
    const content = normalize(message.content);
    return /r\$\s*\d|\b(?:fica|custa|valor|preco|por)\s+(?:r\$\s*)?\d{1,3}(?:[,.]\d{2})?\b/i.test(content);
});

const isEngagedContinuation = (text: string) => /\b(imagina|queria|gostaria|tesao|gozar|comer|chupar|meter|safad|gostos|delicia|mostra|fazer comigo|como seria|eu ia|eu quero)\b/i.test(normalize(text));

export const evaluateSalesTiming = ({
    userText,
    recentMessages = [],
    leadMemory = {},
    now = new Date(),
}: {
    userText: string;
    recentMessages?: SalesMessage[];
    leadMemory?: LeadMemoryLike;
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
    const recentOffer = hasRecentOffer(recentMessages, now);
    const acceptedOffer = recentOffer && isOfferAcceptance(userText);
    const salesContextActive = Boolean(detectedProduct || engagedContinuation || directCheckout || askedPrice || acceptedOffer);
    const canPitchPrice = directCheckout || askedPrice || recentOffer || nurtureTurns >= 3;
    const canGeneratePayment = directCheckout || acceptedOffer;

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
        metadataPatch: activeProduct && salesContextActive ? {
            sales_nurture_product: activeProduct,
            sales_nurture_turns: nurtureTurns,
            sales_nurture_updated_at: now.toISOString(),
            sales_checkout_ready: canGeneratePayment,
            sales_offer_seen: recentOffer,
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
