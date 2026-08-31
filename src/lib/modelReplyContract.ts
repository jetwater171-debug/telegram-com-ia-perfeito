import { normalizeAiMessageList } from '@/lib/aiMessageNormalization';
import { VIP_OFFERS } from '@/lib/commercialCatalog';
import { isExplicitSexualContext } from '@/lib/brain/hardValidator';

/** Validates operations/transport only. Never authors or replaces a reply. */
export type ModelReplyContract = {
    action: string;
    adultConfirmationRequired?: boolean;
    mustPresentVipMenu?: boolean;
    offer?: { value: number; description: string } | null;
    requireOfferPrice?: boolean;
    mediaUnavailable?: boolean;
    voiceUnavailable?: boolean;
    /** Backend confirmed the payment belonging to the current order/turn. */
    currentPaymentConfirmed?: boolean;
    /** Backend created or recovered a PIX code that is available to send now. */
    pixGenerated?: boolean;
    /** Backend released the current order's access or fulfillment. */
    fulfillmentReleased?: boolean;
    operationChanged?: boolean;
    corrections?: string[];
};

export const replyPrices = (messages: string[]) => Array.from(
    messages.join('\n').matchAll(/R\$\s*(\d+(?:[.,]\d{1,2})?)|\b(\d+[.,]\d{2})\b|\b(\d+)\s*reais\b/gi),
    (match) => Math.round(Number((match[1] || match[2] || match[3]).replace(',', '.')) * 100),
);

const paymentClaimSegments = (messages: string[]) => messages
    .flatMap((message) => String(message || '').split(/[\n.!]+/u))
    .map((segment) => segment.trim())
    .filter(Boolean);

const isQuestionFutureOrHistory = (segment: string) => {
    if (segment.includes('?')) return true;
    if (/\b(?:vou|vamos|posso|pode|quer(?: que)?|quando|caso|assim que)\b.{0,56}\b(?:pix|pagamento|transfer[êe]ncia|cobran[cç]a|acesso|vip|pedido|produto)\b/iu.test(segment)) return true;
    if (/\b(?:ainda\s+)?n[aã]o\b.{0,24}\b(?:caiu|recebi|confirmad|aprovad|compensad|pago|gerad|criad|liberad|entregue)\b/iu.test(segment)) return true;
    return /\b(?:compra|pagamento|pix|pedido)\s+(?:anterior|antig[oa]|passad[oa])\b|\b(?:na|da)\s+(?:outra|[uú]ltima)\s+vez\b|\b(?:ontem|antes)\b.{0,32}\b(?:pagamento|pix|compra|pedido)\b/iu.test(segment);
};

const hasCurrentPaymentConfirmationClaim = (messages: string[]) => paymentClaimSegments(messages).some((segment) => {
    if (isQuestionFutureOrHistory(segment)) return false;
    return /\b(?:pix|pagamento|transfer[êe]ncia|cobran[cç]a)\b.{0,48}\b(?:caiu|recebi|confirmad[oa]?|aprovad[oa]?|compensad[oa]?|pago)\b|\b(?:caiu|recebi|confirmad[oa]?|aprovad[oa]?|compensad[oa]?|pago)\b.{0,48}\b(?:pix|pagamento|transfer[êe]ncia|cobran[cç]a)\b/iu.test(segment);
});

const hasPixGenerationClaim = (messages: string[]) => paymentClaimSegments(messages).some((segment) => {
    if (isQuestionFutureOrHistory(segment)) return false;
    return /\b(?:pix|qr\s*code|c[oó]digo(?:\s+(?:pix|copia\s+e\s+cola))?)\b.{0,48}\b(?:gerad[oa]?|criad[oa]?|pronto|dispon[ií]vel)\b|\b(?:gerei|criei|enviei|mandei)\b.{0,48}\b(?:pix|qr\s*code|c[oó]digo(?:\s+(?:pix|copia\s+e\s+cola))?)\b/iu.test(segment);
});

const hasFulfillmentReleaseClaim = (messages: string[]) => paymentClaimSegments(messages).some((segment) => {
    if (isQuestionFutureOrHistory(segment)) return false;
    return /\b(?:seu|teu|pra\s+(?:vc|voc[eê])|para\s+(?:vc|voc[eê]))\b.{0,30}\b(?:acesso|vip|conte[uú]do|pedido|produto|material)\b.{0,48}\b(?:liberad[oa]?|entregue|desbloquead[oa]?|dispon[ií]vel)\b|\b(?:liberei|entreguei|desbloqueei)\b.{0,48}\b(?:acesso|vip|conte[uú]do|pedido|produto|material)\b/iu.test(segment);
});

export const inspectModelReply = (value: unknown, contract: ModelReplyContract): string[] => {
    const messages = normalizeAiMessageList(value);
    const text = messages.join('\n');
    const issues: string[] = [];
    if (!messages.length) issues.push('empty_model_reply');
    if (messages.length > 4 || messages.some((message) => message.length > 4096)) issues.push('telegram_message_limits');
    if (/^send_(?:custom_preview|video_preview|hot_video_preview|ass_photo_preview|shower_photo|lingerie_photo|wet_finger_photo)$/.test(contract.action)
        && (messages[0]?.length || 0) > 1024) issues.push('telegram_caption_limit');
    const prices = replyPrices(messages);
    if (contract.adultConfirmationRequired) {
        if (isExplicitSexualContext(text)) issues.push('explicit_content_before_adult_confirmation');
        if (!/\b(?:tem|confirma|confirmar|possui)\b.{0,70}\b18\s*anos\b/i.test(text)) issues.push('adult_confirmation_missing');
        if (prices.length) issues.push('offer_before_required_adult_confirmation');
    } else if (contract.mustPresentVipMenu) {
        const allowed = VIP_OFFERS.map((offer) => offer.amountCents as number);
        if (allowed.some((price) => !prices.includes(price)) || prices.some((price) => !allowed.includes(price))) issues.push('vip_catalog_prices');
        if (!/mensal/i.test(text) || !/vital[ií]ci[oa]/i.test(text) || !/chamada/i.test(text)) issues.push('vip_catalog_options');
    } else if (contract.offer && (prices.length || contract.requireOfferPrice)) {
        const expected = Math.round(contract.offer.value * 100);
        if (prices.some((price) => price !== expected) || (contract.requireOfferPrice && !prices.includes(expected))) issues.push('offer_price_mismatch');
    }
    if ((contract.mediaUnavailable || contract.voiceUnavailable)
        && /\b(?:te mandei|te enviei|acabei de (?:enviar|mandar)|vou (?:te )?(?:mandar|enviar|gravar)|aqui (?:esta|está|vai) (?:a|o|minha|meu))\b/i.test(text)) issues.push('unavailable_delivery_promise');
    if (!contract.currentPaymentConfirmed && hasCurrentPaymentConfirmationClaim(messages)) {
        issues.push('unverified_current_payment_confirmation');
    }
    if (!contract.pixGenerated && hasPixGenerationClaim(messages)) issues.push('unverified_pix_generation');
    if (!contract.fulfillmentReleased && hasFulfillmentReleaseClaim(messages)) {
        issues.push('unverified_fulfillment_release');
    }
    return issues;
};
