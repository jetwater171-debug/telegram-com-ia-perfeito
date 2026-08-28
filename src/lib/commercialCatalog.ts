export type CommercialProduct = 'vip' | 'video_call';

export type CommercialSku =
    | 'vip_monthly'
    | 'vip_lifetime'
    | 'vip_lifetime_call'
    | 'video_call_standalone';

export type CommercialOffer = {
    sku: CommercialSku;
    product: CommercialProduct;
    amountCents: 2990 | 4990 | 7990 | 5000;
    value: number;
    description: string;
    format: string;
    shortLabel: string;
};

export const VIP_MONTHLY_PRICE = 29.90;
export const VIP_LIFETIME_PRICE = 49.90;
export const VIP_LIFETIME_CALL_PRICE = 79.90;
export const VIDEO_CALL_STANDALONE_PRICE = 50;

export const COMMERCIAL_CATALOG: Record<CommercialSku, CommercialOffer> = {
    vip_monthly: {
        sku: 'vip_monthly',
        product: 'vip',
        amountCents: 2990,
        value: VIP_MONTHLY_PRICE,
        description: 'VIP Mensal Lari',
        format: 'um mes de acesso ao VIP da Lari',
        shortLabel: 'VIP mensal',
    },
    vip_lifetime: {
        sku: 'vip_lifetime',
        product: 'vip',
        amountCents: 4990,
        value: VIP_LIFETIME_PRICE,
        description: 'VIP Vitalicio Lari',
        format: 'acesso vitalicio ao VIP da Lari',
        shortLabel: 'VIP vitalicio',
    },
    vip_lifetime_call: {
        sku: 'vip_lifetime_call',
        product: 'vip',
        amountCents: 7990,
        value: VIP_LIFETIME_CALL_PRICE,
        description: 'VIP Vitalicio + Chamada Lari',
        format: 'acesso vitalicio ao VIP e uma chamada intima exclusiva com limites combinados',
        shortLabel: 'VIP vitalicio + chamada',
    },
    video_call_standalone: {
        sku: 'video_call_standalone',
        product: 'video_call',
        amountCents: 5000,
        value: VIDEO_CALL_STANDALONE_PRICE,
        description: 'Chamada Intima Avulsa Lari',
        format: 'uma chamada intima avulsa e exclusiva com limites combinados',
        shortLabel: 'chamada avulsa',
    },
};

export const VIP_OFFERS = [
    COMMERCIAL_CATALOG.vip_monthly,
    COMMERCIAL_CATALOG.vip_lifetime,
    COMMERCIAL_CATALOG.vip_lifetime_call,
] as const;

export const formatBrl = (value: number) => `R$ ${Number(value).toFixed(2).replace('.', ',')}`;

export const formatCommercialOffer = (offer: CommercialOffer) =>
    `${offer.shortLabel}: ${formatBrl(offer.value)} (${offer.format})`;

export const formatVipCatalog = () => VIP_OFFERS.map(formatCommercialOffer).join(' | ');

export const renderVipMenuMessages = () => [
    'tenho três opções pra vc escolher sem confusão',
    `mensal: ${formatBrl(VIP_MONTHLY_PRICE)} | vitalício: ${formatBrl(VIP_LIFETIME_PRICE)}`,
    `vitalício + uma chamada íntima: ${formatBrl(VIP_LIFETIME_CALL_PRICE)}. qual vc quer?`,
];

export const renderCommercialOfferMessage = (offer: CommercialOffer) => {
    if (offer.sku === 'vip_monthly') return `o VIP mensal fica ${formatBrl(offer.value)} e dá um mês de acesso`;
    if (offer.sku === 'vip_lifetime') return `o VIP vitalício fica ${formatBrl(offer.value)} e o acesso é pra sempre`;
    if (offer.sku === 'vip_lifetime_call') return `o vitalício + uma chamada íntima fica ${formatBrl(offer.value)}`;
    return `a chamada íntima avulsa fica ${formatBrl(offer.value)}`;
};

export const getCommercialFulfillmentBrief = (sku: CommercialSku) => {
    if (sku === 'vip_monthly') return 'Liberar um mês de acesso ao VIP da Lari';
    if (sku === 'vip_lifetime') return 'Liberar acesso vitalício ao VIP da Lari';
    if (sku === 'vip_lifetime_call') return 'Liberar VIP vitalício e agendar a chamada íntima incluída';
    return 'Agendar a chamada íntima avulsa com o lead';
};

export const getCommercialPaymentConfirmationMessage = (sku: CommercialSku | null | undefined) => {
    if (sku === 'vip_monthly' || sku === 'vip_lifetime') {
        return 'confirmado! seu acesso VIP entrou na fila de liberação e eu te aviso aqui';
    }
    if (sku === 'vip_lifetime_call') {
        return 'confirmado! vou liberar seu VIP e alinhar sua chamada com vc por aqui';
    }
    if (sku === 'video_call_standalone') {
        return 'confirmado! agora a gente alinha o horário e os limites da chamada por aqui';
    }
    return null;
};

const normalize = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const mentionsAmount = (text: string, amount: number) => {
    const integer = Math.trunc(amount);
    const cents = Math.round((amount - integer) * 100);
    if (cents > 0) {
        const decimal = `${integer}[,.]${String(cents).padStart(2, '0')}`;
        return new RegExp(`(?:r\\$\\s*)?${decimal}(?!\\d)`, 'i').test(text)
            || new RegExp(`r\\$\\s*${integer}(?!\\d)`, 'i').test(text);
    }
    // Valor inteiro sozinho pode ser idade, quantidade ou presente. Para SKU
    // fixo, só o tratamos como preço quando vier marcado como dinheiro.
    return new RegExp(`r\\$\\s*${integer}(?:[,.]0{1,2})?(?!\\d)`, 'i').test(text);
};

/**
 * Resolve somente uma escolha comercial inequívoca. "Quero o VIP" continua
 * ambíguo e deve receber as opções antes de qualquer cobrança.
 */
export const detectCommercialSku = (
    input: string,
    options: { allowBareVipCatalogAmount?: boolean } = {},
): CommercialSku | null => {
    const text = normalize(input);
    const mentionsSubscription = /\b(assinar|assinatura|plano|planos)\b/i.test(text);
    const mentionsVip = /\bvip\b|\b(?:acesso|pack|conteudo)\s+vip\b/i.test(text)
        || (mentionsSubscription && /\b(acesso|conteudo|lari)\b/i.test(text));
    const mentionsCall = /\b(chamada|video chamada|videochamada|call|facetime|ligacao)\b/i.test(text);
    const mentionsMonthly = /\b(mensal|um mes|1 mes|mes a mes)\b/i.test(text);
    const mentionsLifetime = /\b(vitalicio|vitalicia|pra sempre|para sempre)\b/i.test(text);
    const asksOnlyCall = /\b(so|somente|apenas)\b.{0,18}\b(chamada|videochamada|call)\b|\bsem\b.{0,18}\bvip\b/i.test(text);
    const catalogAmountContext = mentionsVip || options.allowBareVipCatalogAmount === true;

    if (asksOnlyCall) return 'video_call_standalone';
    // Nao convertemos silenciosamente "mensal + chamada" no combo vitalicio.
    // Esse pedido mistura dois produtos e precisa voltar para uma escolha clara.
    if (mentionsMonthly && mentionsCall && !mentionsLifetime) return null;
    if ((mentionsVip && mentionsCall)
        || /\b(vitalicio|vitalicia)\b.{0,24}\b(chamada|call)\b|\b(chamada|call)\b.{0,24}\b(vitalicio|vitalicia)\b/i.test(text)
        || (catalogAmountContext && mentionsAmount(text, VIP_LIFETIME_CALL_PRICE))
        || /\b(mais completo|completo com chamada|combo com chamada|pacote com chamada)\b/i.test(text)) {
        return 'vip_lifetime_call';
    }
    if (mentionsCall && !mentionsVip) {
        return 'video_call_standalone';
    }
    if (mentionsLifetime
        || (catalogAmountContext && mentionsAmount(text, VIP_LIFETIME_PRICE))) {
        return 'vip_lifetime';
    }
    if (mentionsMonthly || /\b(mais barato|de entrada)\b/i.test(text)
        || (catalogAmountContext && mentionsAmount(text, VIP_MONTHLY_PRICE))) {
        return 'vip_monthly';
    }
    return null;
};

export const getCommercialOffer = (sku: CommercialSku | null | undefined) =>
    sku ? COMMERCIAL_CATALOG[sku] || null : null;

export const isVipMenuRequest = (input: string) => {
    const text = normalize(input);
    const mentionsVip = /\b(vip|acesso|assinar|assinatura)\b/i.test(text);
    if (!mentionsVip || detectCommercialSku(text)) return false;
    return /\b(quanto|valor|preco|custa|planos?|opcoes?|opcao|tipos?|quais|como assino|como comprar|quero|manda o pix|gera o pix|assinar|comprar)\b/i.test(text);
};

export const FIXED_COMMERCIAL_AMOUNTS = new Set<number>(
    Object.values(COMMERCIAL_CATALOG).map((offer) => offer.amountCents),
);

export const isFixedCommercialAmount = (value: number) =>
    FIXED_COMMERCIAL_AMOUNTS.has(Math.round(Number(value) * 100));
