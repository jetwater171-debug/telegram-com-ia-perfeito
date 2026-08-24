import { NEXT_BEST_ACTIONS, type HardValidatorResult, type MasterBrainResponse, type NextBestAction } from '@/lib/brain/types';

const MEDIA_ACTIONS = new Set([
    'send_video_preview', 'send_hot_video_preview', 'send_ass_photo_preview', 'send_custom_preview',
    'send_shower_photo', 'send_lingerie_photo', 'send_wet_finger_photo',
]);
const EXPLICIT_MEDIA_ACTIONS = new Set(['send_hot_video_preview', 'send_wet_finger_photo', 'send_ass_photo_preview']);
const VALID_ACTIONS = new Set([
    'none', ...MEDIA_ACTIONS, 'send_voice_reply', 'generate_pix_payment', 'check_payment_status',
]);

const normalize = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const clamp01 = (value: unknown, fallback = 0.5) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
};

export const detectAdultDeclaration = (userText: string) => {
    const text = normalize(userText);
    if (/\b(sou|ja sou|eu sou|tenho)\s+(maior de idade|\+18|18 anos ou mais)\b/i.test(text)) return true;
    const age = Number(text.match(/\b(?:tenho|fiz|idade[: ]+)\s*(\d{2})\s*(?:anos)?\b/i)?.[1]);
    return Number.isInteger(age) && age >= 18 && age <= 100;
};

const isExplicitMediaRequest = (userText: string) => /\b(nua|pelada|sem roupa|nude|nudes|explicita|expl[ií]cita|molhada|dedo|bunda|peito|seio|de quatro)\b/i.test(userText);
const isOnlyFreePreviewRequest = (userText: string) => {
    const asksPreview = /\b(previa|prévia|amostra|foto|fotinha|selfie|video|vídeo)\b/i.test(userText);
    const commercial = /\b(comprar|pagar|pix|pre[cç]o|valor|quanto|vip|pack|pacote|personalizad[oa])\b/i.test(userText);
    return asksPreview && !commercial;
};

const nextBestActionFor = (response: MasterBrainResponse): NextBestAction => {
    if (NEXT_BEST_ACTIONS.includes(response.next_best_action as NextBestAction)) return response.next_best_action as NextBestAction;
    if (response.action === 'generate_pix_payment') return 'GENERATE_PAYMENT';
    if (response.action === 'check_payment_status') return 'CHECK_PAYMENT';
    if (MEDIA_ACTIONS.has(String(response.action || ''))) return 'SEND_PREVIEW';
    if (response.current_state === 'NEGOTIATION') return 'NEGOTIATE';
    if (response.current_state === 'SALES_PITCH') return 'MAKE_OFFER';
    return 'TALK';
};

const sanitizeMemoryUpdates = (response: MasterBrainResponse, userText: string) => {
    const literal = normalize(userText);
    response.memory_updates = (response.memory_updates || []).slice(0, 12).map((item) => {
        const content = String(item?.content || '').replace(/\s+/g, ' ').trim().slice(0, 500);
        const key = String(item?.key || '').trim().slice(0, 160);
        let kind = item?.kind;
        let status = item?.status;
        let confidence = clamp01(item?.confidence, kind === 'fact' ? 1 : 0.5);
        if (!['fact', 'hypothesis', 'preference', 'episode', 'outcome'].includes(String(kind))) kind = 'hypothesis';
        if (!['active', 'superseded', 'uncertain', 'expired'].includes(String(status))) status = kind === 'hypothesis' ? 'uncertain' : 'active';

        // Um fato novo precisa ter ancoragem lexical na fala atual. Sem isso ele
        // continua útil como hipótese, mas nunca ganha autoridade de realidade.
        const anchors = normalize(content).split(' ').filter((token) => token.length >= 4);
        const anchored = anchors.length > 0 && anchors.some((token) => literal.includes(token));
        if (kind === 'fact' && (!anchored || confidence < 0.95)) {
            kind = 'hypothesis';
            status = 'uncertain';
            confidence = Math.min(confidence, 0.65);
        }
        return { kind, key, content, confidence, importance: clamp01(item?.importance, 0.5), status };
    }).filter((item) => item.key && item.content) as MasterBrainResponse['memory_updates'];
};

export const validateMasterBrainResponse = ({
    response: input,
    userText,
    canGeneratePayment,
    canPitchPrice,
    adultVerified,
    availablePreviewIds = [],
    offer,
    postPurchaseCooldownActive = false,
}: {
    response: MasterBrainResponse;
    userText: string;
    canGeneratePayment: boolean;
    canPitchPrice: boolean;
    adultVerified: boolean;
    availablePreviewIds?: string[];
    offer?: { id?: string | null; value: number; description: string } | null;
    postPurchaseCooldownActive?: boolean;
}): HardValidatorResult => {
    const response: MasterBrainResponse = { ...input };
    const corrections: string[] = [];
    response.messages = Array.isArray(response.messages)
        ? response.messages.map((message) => String(message || '').trim()).filter(Boolean).slice(0, 4)
        : [];
    response.action = VALID_ACTIONS.has(String(response.action || '')) ? response.action : 'none';
    response.next_best_action = nextBestActionFor(response);
    response.decision_confidence = clamp01(response.decision_confidence, 0.55);
    response.offer_id = response.offer_id || offer?.id || null;
    sanitizeMemoryUpdates(response, userText);

    if (response.preview_id && availablePreviewIds.length > 0 && !availablePreviewIds.includes(String(response.preview_id))) {
        response.preview_id = null;
        corrections.push('preview_id_not_in_candidate_set');
    }

    if (MEDIA_ACTIONS.has(String(response.action)) && isExplicitMediaRequest(userText) && !adultVerified) {
        response.action = 'none';
        response.preview_id = null;
        response.next_best_action = 'ASK';
        response.messages = ['antes de continuar, confirma pra mim que vc tem 18 anos ou mais?'];
        corrections.push('adult_verification_required');
    } else if (EXPLICIT_MEDIA_ACTIONS.has(String(response.action)) && !adultVerified) {
        response.action = 'none';
        response.preview_id = null;
        response.next_best_action = 'ASK';
        response.messages = ['antes de continuar, confirma pra mim que vc tem 18 anos ou mais?'];
        corrections.push('adult_verification_required');
    }

    if (response.action === 'generate_pix_payment' && (!canGeneratePayment || isOnlyFreePreviewRequest(userText))) {
        response.action = 'none';
        response.payment_details = null;
        response.next_best_action = canPitchPrice ? 'MAKE_OFFER' : 'BUILD_VALUE';
        corrections.push('payment_without_explicit_acceptance');
    }

    if (response.action === 'generate_pix_payment' && offer) {
        response.payment_details = { value: Number(offer.value), description: offer.description };
        response.offer_id = offer.id || response.offer_id || null;
    }

    if (postPurchaseCooldownActive && ['MAKE_OFFER', 'CLOSE', 'GENERATE_PAYMENT'].includes(String(response.next_best_action))) {
        response.action = 'none';
        response.payment_details = null;
        response.next_best_action = 'POST_PURCHASE';
        corrections.push('post_purchase_cooldown');
    }

    return { response, allowed: corrections.length === 0, corrections };
};
