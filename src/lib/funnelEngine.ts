export const FUNNEL_STAGES = [
    'opening',
    'rapport',
    'context',
    'bed_preview',
    'warming',
    'desire',
    'strong_preview',
    'offer',
    'objection',
    'negotiation',
    'order_bump',
    'checkout',
    'payment_pending',
    'fulfillment',
    'post_purchase',
    'cooldown',
] as const;

export type FunnelStage = typeof FUNNEL_STAGES[number];
export type FunnelOrderBumpStatus = 'none' | 'offered' | 'accepted' | 'declined';

export type FunnelState = {
    stage: FunnelStage;
    intent: 'support' | 'checkout' | 'commercial' | 'objection' | 'desire' | 'casual';
    preview: {
        freeCount: number;
        nextRole: 'bed' | 'contextual' | 'strong' | 'exceptional' | null;
        canSend: boolean;
        exceptionalOnly: boolean;
    };
    orderBump: {
        eligible: boolean;
        status: FunnelOrderBumpStatus;
        shouldOffer: boolean;
    };
    supportPriority: boolean;
    metadataPatch: Record<string, unknown>;
};

const normalize = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const asStage = (value: unknown): FunnelStage | null => {
    const stage = String(value || '');
    return (FUNNEL_STAGES as readonly string[]).includes(stage) ? stage as FunnelStage : null;
};

const asBumpStatus = (value: unknown): FunnelOrderBumpStatus => {
    const status = String(value || '');
    return ['none', 'offered', 'accepted', 'declined'].includes(status)
        ? status as FunnelOrderBumpStatus
        : 'none';
};

const isSupportMessage = (text: string) => /\b(?:ja paguei|paguei|comprovante|pagamento duplicado|cobranca duplicada|pix errado|valor errado|nao recebi|cad[eê] meu acesso|acesso nao chegou|reembolso|suporte)\b/i.test(text);
const isCheckoutMessage = (text: string) => /\b(?:pix|chave pix|copia e cola|codigo pix|pagar|pagamento)\b/i.test(text);
const isObjectionMessage = (text: string) => /\b(?:caro|sem dinheiro|nao tenho|não tenho|desconto|mais barato|nao quero|não quero|depois|pensar)\b/i.test(text);
const isDesireMessage = (text: string) => /\b(?:foto|previa|prévia|video|vídeo|conteudo|conteúdo|quero ver|me mostra|me manda)\b/i.test(text);
const isPositive = (text: string) => /^(?:sim|quero|quero sim|pode|pode ser|fechado|bora|aceito|combinado|claro|topo|manda)$/i.test(text.replace(/[.!?]+$/g, '').trim());
const isNegative = (text: string) => /^(?:nao|não|sem|nao quero|não quero|so o vip|só o vip)$/i.test(text.replace(/[.!?]+$/g, '').trim());
const addonDeclined = (text: string) => isNegative(text)
    || /\b(?:nao quero|sem|dispenso)\b.{0,22}\b(?:extra|adicional|foto)\b|\b(?:so|somente|apenas) o vip\b/.test(text);
const addonAccepted = (text: string) => !/\b(?:nao|sem|talvez|depois)\b|\?/.test(text)
    && (isPositive(text)
        || /^(?:pode incluir|pode colocar|inclui|inclua|coloca|adiciona)(?: (?:essa|isso|a foto|o extra|o adicional))?[.!]*$/.test(text)
        || /^quero (?:a foto|o extra|o adicional|com meu nome)[.!]*$/.test(text));

export const resolvePendingAddonDecision = (input: string): 'accepted' | 'declined' | null => {
    const text = normalize(input);
    return addonDeclined(text) ? 'declined' : addonAccepted(text) ? 'accepted' : null;
};

/**
 * Determina a próxima etapa sem redigir a mensagem. Contadores de prévia só
 * são lidos aqui: o backend deve incrementá-los após envio confirmado.
 */
export const resolveFunnelState = (input: {
    userText: string;
    metadata?: Record<string, unknown> | null;
    userMessageCount?: number;
    totalPaid?: number;
    activeProduct?: string | null;
    selectedSku?: string | null;
    paymentPending?: boolean;
    acceptedVip?: boolean;
    directCheckout?: boolean;
    negotiableBudget?: boolean;
}): FunnelState => {
    const metadata = input.metadata || {};
    const text = normalize(input.userText);
    const freeCount = Math.max(0, Math.min(4, Math.trunc(Number(metadata.funnel_preview_count) || 0)));
    const priorBumpStatus = asBumpStatus(metadata.funnel_order_bump_status);
    const vipSelected = String(input.selectedSku || '').startsWith('vip_');
    const supportPriority = isSupportMessage(text);
    const bumpStatus = priorBumpStatus === 'offered'
        ? resolvePendingAddonDecision(text) || priorBumpStatus
        : priorBumpStatus;
    const bumpEligible = vipSelected && Number(input.totalPaid || 0) <= 0;
    const shouldOffer = bumpEligible
        && input.acceptedVip === true
        && !input.directCheckout
        && priorBumpStatus === 'none';
    const intent: FunnelState['intent'] = supportPriority ? 'support'
        : isCheckoutMessage(text) ? 'checkout'
            : isObjectionMessage(text) ? 'objection'
                : input.activeProduct ? 'commercial'
                    : isDesireMessage(text) ? 'desire'
                        : 'casual';
    const priorStage = asStage(metadata.funnel_stage);
    let stage: FunnelStage;
    if (supportPriority) stage = 'fulfillment';
    else if (input.paymentPending) stage = 'payment_pending';
    else if (bumpStatus === 'offered' || shouldOffer) stage = 'order_bump';
    else if (bumpStatus === 'accepted' || bumpStatus === 'declined' || input.directCheckout) stage = 'checkout';
    else if (Number(input.totalPaid || 0) > 0) stage = 'post_purchase';
    else if (input.negotiableBudget) stage = 'negotiation';
    else if (intent === 'objection') stage = 'objection';
    else if (input.activeProduct) stage = input.selectedSku ? 'offer' : 'desire';
    else if (intent === 'desire') stage = freeCount >= 2 ? 'strong_preview' : freeCount === 0 ? 'bed_preview' : 'warming';
    else if (priorStage === 'cooldown') stage = 'cooldown';
    else if (Number(input.userMessageCount || 0) <= 0 || /^\/?start\b/i.test(text)) stage = 'opening';
    else if (Number(input.userMessageCount || 0) <= 1) stage = 'rapport';
    else stage = 'context';

    const nextRole = freeCount === 0 ? 'bed'
        : freeCount === 1 ? 'contextual'
            : freeCount === 2 ? 'strong'
                : freeCount === 3 ? 'exceptional'
                    : null;
    return {
        stage,
        intent,
        preview: {
            freeCount,
            nextRole,
            canSend: !supportPriority && freeCount < 3,
            exceptionalOnly: freeCount === 3,
        },
        orderBump: { eligible: bumpEligible, status: bumpStatus, shouldOffer },
        supportPriority,
        metadataPatch: {
            funnel_stage: stage,
            funnel_intent: intent,
            funnel_order_bump_status: bumpStatus,
        },
    };
};
