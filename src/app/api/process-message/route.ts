import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { sendMessageToGemini } from '@/lib/gemini';
import { sendTelegramMessage, sendTelegramPhoto, sendTelegramVideo, sendTelegramAction, sendTelegramCopyableCode, sendTelegramVoice } from '@/lib/telegram';
import { createPaymentMultiGateway, getPaymentStatusMultiGateway } from '@/lib/paymentGatewayService';
import { calculateLeadScore, markLeadPaid, toStoredLeadScore } from '@/lib/leadScoring';
import { shapeConversationBubbles } from '@/lib/conversationBubbles';
import {
    mergeLeadMemoryPatch,
    mergeUniqueLeadMemoryValues as mergeUnique,
    normalizeLeadMemory,
} from '@/lib/leadMemory';
import {
    buildExpressiveSpeech,
    DEFAULT_FISH_AUDIO_SETTINGS,
    generateFishAudio,
    normalizeFishAudioSettings,
    shouldUseFishAudio,
} from '@/lib/fishAudio';
import { scorePreviewForContext, upsertMissingPreviewRequest } from '@/lib/previewCatalog';

export const maxDuration = 120;

// Esta rota atua como um worker em segundo plano.
// Ela aguarda, verifica mensagens mais recentes (debounce), e então processa a resposta.
// É chamada pelo Webhook principal mas NÃO DEVE atrasar a resposta do webhook.

const normalizeCityKey = (input: string) => {
    return (input || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim();
};

const PROCESSING_LEASE_TTL_MS = 90_000;
const PROCESSING_LEASE_WAIT_MS = 45_000;
const PROCESSING_LEASE_POLL_MS = 750;

const randomBetween = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));

const humanTextDelayMs = (text: string, bubbleIndex: number) => {
    const length = String(text || '').trim().length;
    const punctuationPause = /[?!]$/.test(text) ? 180 : 0;
    if (bubbleIndex === 0) {
        const firstBubbleDelay = 520 + (length * 20) + punctuationPause + randomBetween(180, 620);
        return Math.min(2_400, Math.max(850, firstBubbleDelay));
    }

    const betweenBubblesDelay = 1_650 + (length * 27) + punctuationPause + randomBetween(180, 650);
    return Math.min(5_000, Math.max(2_000, betweenBubblesDelay));
};

const humanAudioRecordingDelayMs = (text: string) => {
    const wordCount = String(text || '').trim().split(/\s+/).filter(Boolean).length;
    return Math.min(5_000, Math.max(2_000, 1_650 + (wordCount * 210) + randomBetween(180, 650)));
};

const detectCityFromText = (input: string): string | null => {
    const match = input.match(/\b(?:sou|moro)\s+(?:de|do|da|em)\s+([\p{L}\s]{2,40})/iu);
    if (!match) return null;
    let city = match[1].trim();
    city = city.replace(/[\n\r\.\!\?].*$/, '').trim();

    const parts = city.split(/\s+/).slice(0, 3);
    return parts.join(' ');
};

const detectLeadMemorySignals = (userText: string, botTexts: string[], aiResponse: any, currentMemory: any) => {
    const memory = normalizeLeadMemory(currentMemory);
    const t = (userText || '').toLowerCase();
    const bot = (botTexts || []).join(' ').toLowerCase();

    const wanted: string[] = [];
    const rejected: string[] = [];
    const desires: string[] = [];
    const objections: string[] = [];
    const notes: string[] = [];
    const explicitEvaluationRequest = /(?:avalia|avaliar|avaliacao|avaliação|nota|dar nota|da nota|dá uma nota).{0,40}(?:pau|pinto|rola|ele)|(?:pau|pinto|rola).{0,40}(?:avalia|avaliar|avaliacao|avaliação|nota|dar nota|da nota|dá uma nota)/i.test(t);

    if (/(chamada|call|vídeo chamada|video chamada|ligacao|ligação|facetime)/i.test(t)) wanted.push('chamada de video');
    if (/(foto|fotinha|nude|nudes|pack)/i.test(t)) wanted.push('foto personalizada');
    if (/(video|vídeo|gravado|film[a|e]|previa|prévia)/i.test(t)) wanted.push('video personalizado');
    if (/(zap|whats|whatsapp|numero|número|telefone)/i.test(t)) wanted.push('numero pessoal');
    if (explicitEvaluationRequest) wanted.push('avaliacao');
    if (/(vip|vital[ií]cio|mensal|acesso)/i.test(t)) wanted.push('vip');
    if (/(conversar|aten[cç][aã]o|carinho|companhia|ficar comigo)/i.test(t)) wanted.push('chat privado');

    if (/(nao quero vip|não quero vip|sem vip|so chamada|só chamada|so video|só video|so foto|só foto|so teu numero|só teu numero)/i.test(t)) rejected.push('vip');
    if (/(nao quero chamada|não quero chamada)/i.test(t)) rejected.push('chamada de video');
    if (/(nao quero foto|não quero foto)/i.test(t)) rejected.push('foto personalizada');

    if (/(bunda|de quatro|de 4)/i.test(t)) desires.push('bunda/de quatro');
    if (/(peito|teta|seios)/i.test(t)) desires.push('peitos');
    if (/(domina|manda em mim|obedece|faz o que eu mandar|mandona)/i.test(t)) desires.push('dominancia');
    if (/(carinho|fofa|namoradinha|namorada|amorosa)/i.test(t)) desires.push('namoradinha/carinho');
    if (/(safada|putaria|tesao|tesão|gozar|chupar|sentar)/i.test(t)) desires.push('putaria direta');

    if (/(caro|ta caro|tá caro|sem dinheiro|liso|so tenho|só tenho|desconto|faz por)/i.test(t)) objections.push('preco');
    if (/(prova|real|fake|golpe|confio|confiar)/i.test(t)) objections.push('confianca');
    if (/(gratis|grátis|de graça|manda primeiro)/i.test(t)) objections.push('quer gratis');

    const price_sensitivity = objections.includes('preco')
        ? 'alta'
        : (memory.price_sensitivity || '');

    const best_tone = (() => {
        if (/(carinho|sozinho|solidao|solidão|namorada|aten[cç][aã]o)/i.test(t)) return 'namoradinha carinhosa';
        if (/(manda|faz|agora|obedece|quero que)/i.test(t)) return 'safada provocando e conduzindo';
        if (/(prova|real|fake|como funciona)/i.test(t)) return 'leve segura e simples';
        if (/(safada|gostosa|tesao|chupar|sentar|gozar|pau)/i.test(t)) return 'direta e safada';
        return memory.best_tone || '';
    })();

    if (aiResponse?.lead_classification && aiResponse.lead_classification !== 'desconhecido') {
        notes.push(`classificacao atual: ${aiResponse.lead_classification}`);
    }

    const last_offer = (() => {
        const prices = extractPrices(bot);
        if (prices.length === 0) return memory.last_offer || '';
        const lastPrice = prices[prices.length - 1].toFixed(2);
        const product = wanted[0] || (bot.includes('vip') ? 'vip' : 'produto');
        return `${product} R$ ${lastPrice}`;
    })();
    const wantedThisTurn = new Set(wanted.map((item) => item.toLowerCase()));
    const rejectedThisTurn = new Set(rejected.map((item) => item.toLowerCase()));
    const wantedProducts = mergeUnique(memory.wanted_products, wanted)
        .filter((item) => !rejectedThisTurn.has(item));
    const rejectedProducts = mergeUnique(memory.rejected_products, rejected)
        .filter((item) => !wantedThisTurn.has(item) || rejectedThisTurn.has(item));

    return {
        ...memory,
        dominant_type: aiResponse?.lead_classification || memory.dominant_type || 'desconhecido',
        best_tone,
        wanted_products: wantedProducts,
        rejected_products: rejectedProducts,
        desires: mergeUnique(memory.desires, desires),
        objections: mergeUnique(memory.objections, objections),
        price_sensitivity,
        last_offer,
        notes: mergeUnique(memory.notes, notes, 10),
        metadata: {
            ...(memory.metadata || {}),
            ...(explicitEvaluationRequest ? { evaluation_requested: true } : {})
        },
        updated_at: new Date().toISOString()
    };
};

const hasExplicitSexualFantasyTrigger = (text: string) => {
    return /(quero te comer|te comeria|vou te comer|te pegava|quero transar|quero meter|meter em voce|meter em voc[eê]|quero te chupar|me chupa|quero gozar|gozar em voce|gozar em voc[eê]|pau|buceta|de 4|por tras|por trás)/i.test(text || '');
};

const GLUE_DICT = new Set([
    'amor', 'vida', 'casa', 'banho', 'foto', 'video', 'hoje', 'agora', 'aqui', 'sozinha', 'cansada', 'cansado',
    'deitada', 'molhada', 'pelada', 'safada', 'gostosa', 'quente', 'fria', 'carente', 'tesao', 'tesão',
    'buceta', 'pau', 'gozar', 'porra', 'queria', 'querendo', 'saudade'
]);

const fixGluedWords = (text: string) => {
    return (text || '').split(/(\s+)/).map((part) => {
        if (!part || /^\s+$/.test(part)) return part;
        if (!/^[\p{L}]+$/u.test(part)) return part;
        const lower = part.toLowerCase();
        if (lower.length < 8 || lower.length > 22) return part;
        for (let i = 3; i <= lower.length - 3; i++) {
            const left = lower.slice(0, i);
            const right = lower.slice(i);
            if (GLUE_DICT.has(left) && GLUE_DICT.has(right)) {
                return `${left} ${right}`;
            }
        }
        return part;
    }).join('');
};

const sanitizeOutgoingMessage = (text: string) => {
    let out = (text || '').trim();
    out = out.replace(/\beu\s+sou\s+a\s+lari\b/gi, 'eu sou lari');
    out = out.replace(/\beu\s+sou\s+a\s+larissa\b/gi, 'eu sou larissa');
    out = out.replace(/\bsou\s+a\s+lari\b/gi, 'sou lari');
    out = out.replace(/\bsou\s+a\s+larissa\b/gi, 'sou larissa');
    out = out.replace(/\bme\s+chamo\s+a\s+lari\b/gi, 'me chamo lari');
    out = out.replace(/\bme\s+chamo\s+a\s+larissa\b/gi, 'me chamo larissa');
    out = out.replace(/\bsou\s+eu\b/gi, 'sou lari');
    out = out.replace(/\beu\s+sou\s+eu\b/gi, 'eu sou lari');
    out = out.replace(/\bamoro\b/gi, 'amor o');
    out = out.replace(/([a-záéíóúâêôãõç])((?:kkk|rsrs)+)\b/gi, '$1 $2');
    out = out.replace(/\s+/g, ' ');
    out = out.replace(/\s*(?:\.{3,}|…)\s*$/u, '');
    out = fixGluedWords(out);
    return out;
};

const OPENING_VICES = new Set(['amor', 'anjo', 'vida', 'nossa', 'ai', 'eita', 'perfeito']);

const firstWordOf = (text: string) => {
    const match = normalizeLoopText(text).match(/^\S+/);
    return match ? match[0] : '';
};

const removeOpeningVice = (text: string) => {
    return (text || '').replace(/^(amor|anjo|vida|nossa|ai|eita|perfeito)[,\s]+/i, '').trim();
};

const reduceOpeningRepetition = (messages: string[], lastBotContent: string) => {
    let previousOpening = firstWordOf(lastBotContent);
    return messages.map((msg) => {
        const opening = firstWordOf(msg);
        if (opening && opening === previousOpening && OPENING_VICES.has(opening)) {
            const cleaned = removeOpeningVice(msg);
            previousOpening = firstWordOf(cleaned || msg);
            return cleaned || msg;
        }
        previousOpening = opening || previousOpening;
        return msg;
    });
};

const userProbablyProvidedName = (text: string, extractedName?: string | null) => {
    const t = (text || '').trim();
    if (extractedName && String(extractedName).trim().length >= 2) return true;
    if (/\b(meu nome [eé]|me chamo|sou o|sou a|pode me chamar de)\s+[\p{L}]{2,}/iu.test(t)) return true;
    const compact = t.replace(/[^\p{L}\s]/gu, '').trim();
    const words = compact.split(/\s+/).filter(Boolean);
    if (words.length === 1 && words[0].length >= 2 && words[0].length <= 18) {
        return !/^(oi|ola|ol[aá]|sim|nao|não|bom|boa|tudo|bem|vc|voce|você|amor|anjo|vida)$/iu.test(words[0]);
    }
    return false;
};

const removePrematureNameIntro = (messages: string[], userText: string, extractedName?: string | null) => {
    if (userProbablyProvidedName(userText, extractedName)) return messages;
    const filtered = messages.filter((msg) => {
        const norm = normalizeLoopText(msg);
        const isIntro = /\b(prazer|muito prazer)\b/i.test(norm) &&
            /\b(sou|chamo|lari|larissa)\b/i.test(norm);
        return !isIntro;
    });
    return filtered.length > 0 ? filtered : messages;
};

const userAskedName = (text: string) => /(nome|chamo|chama)/i.test(text || '');

const sessionHasUsefulName = (name: any) => {
    const n = String(name || '').trim().toLowerCase();
    return n.length >= 2 && !['desconhecido', 'anonimo', 'anônimo'].includes(n);
};

const removeAnsweredNameQuestions = (messages: string[], userText: string, sessionName: any) => {
    const userComplainedNameWasAsked = /(ja te falei|já te falei|ja falei|já falei|voce nao lembra|você não lembra)/i.test(userText || '');
    if (!sessionHasUsefulName(sessionName) && !userAskedName(userText) && !userComplainedNameWasAsked) return messages;
    const filtered = messages.filter((msg) => !/(qual|como).{0,24}(nome|chamo|chama)|nome de vdd/i.test(msg));
    return filtered.length > 0 ? filtered : messages;
};

const removeAnsweredCityQuestions = (messages: string[], hasCity: boolean, userAskedCity: boolean) => {
    if (!hasCity && !userAskedCity) return messages;
    const filtered = messages.filter((msg) => !/(de onde (vc|voce|você)|vc e de onde|você é de onde|qual (sua|a) cidade|onde (vc|voce|você) mora)/i.test(msg));
    return filtered.length > 0 ? filtered : messages;
};

const removeGenericBotPhrases = (messages: string[]) => {
    const blocked = [
        /como posso ajudar/i,
        /em que posso te ajudar/i,
        /sou uma ia/i,
        /nao posso/i,
        /não posso/i,
        /como assistente/i,
        /estou aqui para/i
    ];
    const filtered = messages.filter((msg) => !blocked.some((pattern) => pattern.test(msg)));
    return filtered.length > 0 ? filtered : messages;
};

const removeDuplicateNormalizedMessages = (messages: string[]) => {
    const seen = new Set<string>();
    return messages.filter((msg) => {
        const norm = normalizeLoopText(msg);
        if (!norm) return false;
        if (seen.has(norm)) return false;
        seen.add(norm);
        return true;
    });
};

const trustObjectionRequested = (text: string) => {
    return /(prova|provar|real|fake|golpe|confio|confiar|certeza|medo|apaga|apagar|foto inteira|foto completa|por completo|ao vivo|chamada)/i.test(text || '');
};

const collapseTrustLoop = (messages: string[], userText: string) => {
    if (!trustObjectionRequested(userText)) return messages;
    const filtered = messages.filter((msg) => {
        const norm = normalizeLoopText(msg);
        const repeatsVipProof = /(unica forma|única forma|so no vip|só no vip|la no vip|lá no vip|vip secreto|tirar todas as suas duvidas|tirar todas as suas dúvidas)/i.test(msg);
        return !repeatsVipProof && !norm.includes('juro de dedinho');
    });
    const base = filtered.length > 0 ? filtered : messages;
    const compact = base.slice(0, 2);
    if (compact.some((msg) => /entendo|sei|calma|medo|prova|real/i.test(msg))) return compact;
    return [
        'eu entendo vc ficar com receio',
        'posso te mostrar uma previa aqui e o resto eu libero certinho no acesso'
    ];
};

const removeDanglingFinalSuspense = (messages: string[]) => {
    if (messages.length === 0) return messages;
    const last = messages[messages.length - 1] || '';
    const cleaned = last.replace(/\s*(?:\.{3,}|…)\s*$/u, '').trim();
    if (!cleaned) return messages.slice(0, -1);
    const dangling = /\b(se eu tivesse ai|se eu estivesse ai|se eu tivesse perto|se eu estivesse perto|agora|pertinho de voce|pertinho de você)$/iu.test(cleaned);
    if (!dangling) {
        return cleaned === last ? messages : [...messages.slice(0, -1), cleaned];
    }
    return [
        ...messages.slice(0, -1),
        cleaned,
        'me fala uma coisa, vc e mais quietinho ou mais safado?'
    ];
};

const applyConversationQualityGuards = (messages: string[], opts: {
    userText: string;
    sessionName: any;
    hasCity: boolean;
    userAskedCity: boolean;
    extractedName?: string | null;
    lastBotContent: string;
}) => {
    let out = [...messages];
    out = removeGenericBotPhrases(out);
    out = removePrematureNameIntro(out, opts.userText, opts.extractedName);
    out = removeAnsweredNameQuestions(out, opts.userText, opts.sessionName);
    out = removeAnsweredCityQuestions(out, opts.hasCity, opts.userAskedCity);
    out = collapseTrustLoop(out, opts.userText);
    out = reduceOpeningRepetition(out, opts.lastBotContent);
    out = removeDuplicateNormalizedMessages(out);
    out = removeDanglingFinalSuspense(out);
    return out.length > 0 ? out : messages;
};

const extractPrices = (text: string) => {
    if (!text) return [];
    const matches = text.match(/\b\d{1,3}[.,]\d{2}\b/g) || [];
    return matches.map(m => Number(m.replace(',', '.'))).filter(n => !Number.isNaN(n));
};

const extractNegotiatedUserValue = (text: string) => {
    const t = text || '';
    const negotiationPattern = /(so tenho|s[oó] tenho|tenho|na conta|faz por|por|da pra fazer|d[aá] pra fazer|consigo pagar|pago)/i;
    if (!negotiationPattern.test(t)) return null;

    const decimalMatches = t.match(/\b\d{1,4}[.,]\d{1,2}\b/g) || [];
    if (decimalMatches.length > 0) {
        const values = decimalMatches
            .map(m => Number(m.replace(',', '.')))
            .filter(n => !Number.isNaN(n) && n > 0);
        return values.length > 0 ? values[values.length - 1] : null;
    }

    const reaisMatches = Array.from(t.matchAll(/\b(?:r\$\s*)?(\d{1,4})\s*(?:reais|real|conto|contos)?\b/gi))
        .map(match => Number(match[1]))
        .filter(n => !Number.isNaN(n) && n > 0);
    return reaisMatches.length > 0 ? reaisMatches[reaisMatches.length - 1] : null;
};

const inferPixValue = (texts: string[]) => {
    for (let i = texts.length - 1; i >= 0; i--) {
        const prices = extractPrices(texts[i]);
        if (prices.length > 0) return prices[prices.length - 1];
    }
    return null;
};

const PAID_STATUS_WORDS = new Set([
    'approved',
    'paid',
    'completed',
    'confirmed',
    'success',
    'aprovado',
    'pago',
    'concluido',
    'concluído',
    'liquidado'
]);

const normalizePaymentStatus = (value: any): string => {
    return String(value || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim();
};

const findPaymentStatus = (payload: any): string => {
    const direct = [
        payload?.status,
        payload?.payment_status,
        payload?.paymentStatus,
        payload?.data?.status,
        payload?.data?.payment_status,
        payload?.data?.paymentStatus,
        payload?.payment?.status,
        payload?.payment?.payment_status,
        payload?.data?.payment?.status,
        payload?.data?.payment?.payment_status,
        payload?.transaction?.status,
        payload?.data?.transaction?.status
    ];
    for (const value of direct) {
        const normalized = normalizePaymentStatus(value);
        if (normalized) return normalized;
    }
    if (payload?.paid === true || payload?.data?.paid === true || payload?.payment?.paid === true || payload?.data?.payment?.paid === true) {
        return 'paid';
    }
    return '';
};

const isPaymentPaidPayload = (payload: any): boolean => {
    if (!payload) return false;
    if (payload?.paid === true || payload?.data?.paid === true || payload?.payment?.paid === true || payload?.data?.payment?.paid === true) return true;
    if (payload?.paid_at || payload?.approved_at || payload?.data?.paid_at || payload?.data?.approved_at) return true;
    const status = findPaymentStatus(payload);
    return PAID_STATUS_WORDS.has(status);
};

const shouldThrottlePushinpayStatusCheck = (paymentData: any) => {
    if (String(paymentData?.gateway || '').toLowerCase() !== 'pushinpay') return false;
    const lastCheckedAt = paymentData?.last_checked_at;
    if (!lastCheckedAt) return false;
    const elapsedMs = Date.now() - new Date(lastCheckedAt).getTime();
    return Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < 60 * 1000;
};

const FUNNEL_STEPS = [
    "WELCOME",
    "CONNECTION",
    "TRIGGER_PHASE",
    "HOT_TALK",
    "PREVIEW",
    "SALES_PITCH",
    "NEGOTIATION",
    "CLOSING",
    "PAYMENT_CHECK",
    "PAYMENT_CONFIRMED"
];

const stageIndex = (stage?: string | null) => {
    if (!stage) return -1;
    return FUNNEL_STEPS.indexOf(stage.toUpperCase());
};

const ACTION_STAGE_MAP: Record<string, string> = {
    send_shower_photo: 'TRIGGER_PHASE',
    send_lingerie_photo: 'TRIGGER_PHASE',
    send_wet_finger_photo: 'TRIGGER_PHASE',
    send_ass_photo_preview: 'PREVIEW',
    send_video_preview: 'PREVIEW',
    send_hot_video_preview: 'PREVIEW',
    send_custom_preview: 'PREVIEW',
    generate_pix_payment: 'PAYMENT_CHECK',
    check_payment_status: 'PAYMENT_CHECK'
};

const inferStageFromText = (text: string) => {
    const t = (text || '').toLowerCase();
    if (/(pix|paguei|comprovante)/i.test(t)) return 'PAYMENT_CHECK';
    if (/(r\$|\b\d{1,3}[.,]\d{2}\b|pre[cç]o|valor|quanto custa|quanto e)/i.test(t)) return 'NEGOTIATION';
    if (/(vip|acesso|mensal|vital[ií]cio)/i.test(t)) return 'SALES_PITCH';
    if (/(prévia|previa|video|vídeo|foto|pelada|sem roupa)/i.test(t)) return 'PREVIEW';
    return null;
};

const MEDIA_ACTIONS = new Set([
    'send_shower_photo',
    'send_lingerie_photo',
    'send_wet_finger_photo',
    'send_ass_photo_preview',
    'send_video_preview',
    'send_hot_video_preview',
    'send_custom_preview'
]);

const resolveContextualMediaAction = (userText: string, currentAction?: string) => {
    const t = (userText || '').toLowerCase();
    const action = currentAction || 'none';
    const actionIsMedia = MEDIA_ACTIONS.has(action);
    const askedForMedia = /(manda|mostra|quero ver|deixa eu ver|tem foto|tem video|tem vídeo|foto|video|vídeo|previa|prévia)/i.test(t);
    if (!actionIsMedia && !askedForMedia) return null;
    if (action === 'send_custom_preview') return null;

    if (/(de 4|quatro|costas|bunda|rab[ao]|empinad|por tras|por trás)/i.test(t)) {
        return {
            action: 'send_ass_photo_preview',
            intro: 'entao olha essa que combina com o que vc falou'
        };
    }
    if (/(banho|molhad|chuveiro|toalha)/i.test(t)) {
        return {
            action: 'send_shower_photo',
            intro: 'tava pensando nisso e lembrei dessa do banho'
        };
    }
    if (/(lingerie|calcinha|conjunto|cama|deitada)/i.test(t)) {
        return {
            action: 'send_lingerie_photo',
            intro: 'acho que essa aqui combina mais com vc'
        };
    }
    if (/(video|vídeo|rebol|movimento|dan[cç]ando)/i.test(t)) {
        return {
            action: action === 'send_hot_video_preview' ? 'send_hot_video_preview' : 'send_video_preview',
            intro: 'vou te mandar um videozinho que faz mais sentido com isso'
        };
    }
    return null;
};

const inferRequestedPreviewSpec = (userText: string, action?: string) => {
    const text = String(userText || '').trim();
    const normalized = text.toLowerCase();
    const tags = new Set<string>();
    const add = (...values: string[]) => values.forEach((value) => tags.add(value));
    if (/(coelh|orelha|bunny)/i.test(normalized)) add('coelhinha', 'orelhas de coelho', 'fantasia');
    if (/(deitad|cama|len[cç]ol)/i.test(normalized)) add('deitada', 'cama');
    if (/(de 4|quatro|costas|bunda|rab[ao]|empinad|por tras|por trás)/i.test(normalized)) add('bunda', 'de quatro', 'costas');
    if (/(banho|chuveiro|molhad|toalha)/i.test(normalized)) add('banho', 'molhada', 'chuveiro');
    if (/(lingerie|calcinha|suti[aã]|conjunto)/i.test(normalized)) add('lingerie');
    if (/(pelada|nua|nude|sem roupa)/i.test(normalized)) add('nua', 'nude');
    if (/(selfie|rosto|carinha)/i.test(normalized)) add('selfie', 'rosto');
    if (/(peito|seio|teta)/i.test(normalized)) add('peitos');
    if (/(p[eé]|pezinho)/i.test(normalized)) add('pes');
    if (/(video|vídeo|rebol|dan[cç]|movimento)/i.test(normalized) || /video/i.test(String(action || ''))) add('video');
    if (tags.size === 0) add(/video/i.test(String(action || '')) ? 'video' : 'foto');
    return {
        description: text ? `Larissa atendendo ao pedido: "${text.slice(0, 260)}"` : `Larissa em previa ${Array.from(tags).join(', ')}`,
        tags: Array.from(tags),
        examplePhrase: text.slice(0, 300),
    };
};

const randNormal = (): number => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};

const sampleGamma = (alpha: number): number => {
    if (alpha < 1) {
        const u = Math.random();
        return sampleGamma(1 + alpha) * Math.pow(u, 1 / alpha);
    }
    const d = alpha - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
        let x = randNormal();
        let v = 1 + c * x;
        if (v <= 0) continue;
        v = v * v * v;
        const u = Math.random();
        if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
};

const sampleBeta = (alpha: number, beta: number): number => {
    const x = sampleGamma(alpha);
    const y = sampleGamma(beta);
    return x / (x + y);
};

const pickPromptVariant = async (stage: string) => {
    const { data, error } = await supabase
        .from('prompt_variants')
        .select('id, stage, label, content, successes, failures, weight, enabled')
        .eq('enabled', true)
        .eq('stage', stage)
        .limit(50);

    if (error || !data || data.length === 0) return null;

    let best = null as any;
    let bestScore = -1;
    for (const variant of data) {
        const successes = Number(variant.successes || 0);
        const failures = Number(variant.failures || 0);
        const weight = Number(variant.weight || 1);
        const score = sampleBeta(successes + 1, failures + 1) * weight;
        if (score > bestScore) {
            bestScore = score;
            best = variant;
        }
    }
    return best;
};
const normalizeLoopText = (text: string) => {
    return (text || '')
        .toLowerCase()
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .trim();
};

const detectRepetition = (messages: { content: string }[]) => {
    const last = messages[messages.length - 1]?.content || '';
    const normLast = normalizeLoopText(last);
    if (!normLast) return { repeats: 0, last: last };
    let repeats = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
        const norm = normalizeLoopText(messages[i].content);
        if (norm === normLast) repeats++;
        else break;
    }
    return { repeats, last };
};

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { sessionId, triggerMessageId, force } = body;

    console.log(`[PROCESSADOR] Iniciado para sessão ${sessionId}`);

    // Buscar sessão e token em paralelo para ativar o indicador o quanto antes.
    const [sessionResult, botConfigResult] = await Promise.all([
        supabase.from('sessions').select('*').eq('id', sessionId).single(),
        supabase
            .from('bot_settings')
            .select('key,value')
            .in('key', [
                'telegram_bot_token',
                'fish_audio_api_key',
                'fish_audio_enabled',
                'fish_audio_voice_id',
                'fish_audio_model',
                'fish_audio_frequency_percent',
                'fish_audio_cooldown_minutes',
                'fish_audio_max_chars',
            ]),
    ]);
    const session = sessionResult.data;
    if (!session) return NextResponse.json({ error: 'Sessão não encontrada' });

    if (!force && session.status && session.status !== 'active') {
        return NextResponse.json({ status: 'paused' });
    }

    const botConfig = Object.fromEntries((botConfigResult.data || []).map((item: any) => [item.key, item.value || ''])) as Record<string, string>;
    const botToken = botConfig.telegram_bot_token;
    if (!botToken) return NextResponse.json({ error: 'Sem token' });
    const chatId = session.telegram_chat_id;
    const fishAudioSettings = normalizeFishAudioSettings({
        apiKey: botConfig.fish_audio_api_key || process.env.FISH_AUDIO_API_KEY || '',
        enabled: botConfig.fish_audio_enabled === 'true',
        voiceId: botConfig.fish_audio_voice_id || DEFAULT_FISH_AUDIO_SETTINGS.voiceId,
        model: botConfig.fish_audio_model || DEFAULT_FISH_AUDIO_SETTINGS.model,
        frequencyPercent: Number(botConfig.fish_audio_frequency_percent || DEFAULT_FISH_AUDIO_SETTINGS.frequencyPercent),
        cooldownMinutes: Number(botConfig.fish_audio_cooldown_minutes || DEFAULT_FISH_AUDIO_SETTINGS.cooldownMinutes),
        maxChars: Number(botConfig.fish_audio_max_chars || DEFAULT_FISH_AUDIO_SETTINGS.maxChars),
    });

    const waitWithChatAction = async (
        action: Parameters<typeof sendTelegramAction>[2],
        durationMs: number,
    ) => {
        await sendTelegramAction(botToken, chatId, action);
        const heartbeat = durationMs > 4_000
            ? setInterval(() => {
                void sendTelegramAction(botToken, chatId, action);
            }, 4_000)
            : null;
        try {
            await new Promise((resolve) => setTimeout(resolve, durationMs));
        } finally {
            if (heartbeat) clearInterval(heartbeat);
        }
    };

    // Pequena pausa de leitura antes de começar a digitar; também agrupa mensagens seguidas.
    await new Promise((resolve) => setTimeout(resolve, randomBetween(450, 900)));
    await waitWithChatAction('typing', randomBetween(450, 800));

    // Verificar mensagens mais recentes (Lógica de Substituição)
    // Verificamos se há alguma mensagem MAIS NOVA que a que disparou este worker.
    // Se passamos `triggerMessageId`, usamos ele.

    const { data: latestMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('session_id', sessionId)
        .eq('sender', 'user')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (latestMsg && triggerMessageId) {
        const latestIdStr = String(latestMsg.id);
        const triggerIdStr = String(triggerMessageId);

        if (latestIdStr !== triggerIdStr) {
            console.log(`[PROCESSADOR] Abortando. Disparado por ${triggerIdStr} mas a última é ${latestIdStr}`);
            return NextResponse.json({ status: 'superseded' });
        }
    }

    // Uma conversa por vez. Leads diferentes continuam processando em paralelo,
    // mas dois workers da mesma sessão nunca geram resposta/pagamento duplicado.
    const workerToken = crypto.randomUUID();
    let leaseEnabled = true;
    let leaseClaimed = false;
    const releaseProcessingLease = async () => {
        if (!leaseEnabled || !leaseClaimed) return;
        await supabase
            .from('sessions')
            .update({ processing_token: null, processing_started_at: null })
            .eq('id', sessionId)
            .eq('processing_token', workerToken);
        leaseClaimed = false;
    };
    const tryClaimProcessingLease = async () => {
        const leaseCutoff = new Date(Date.now() - PROCESSING_LEASE_TTL_MS).toISOString();
        const { data, error } = await supabase
            .from('sessions')
            .update({ processing_token: workerToken, processing_started_at: new Date().toISOString() })
            .eq('id', sessionId)
            .or(`processing_token.is.null,processing_started_at.is.null,processing_started_at.lt.${leaseCutoff}`)
            .select('id');

        if (error) {
            const message = String(error.message || '').toLowerCase();
            if (String((error as any).code || '') === '42703' || message.includes('processing_started_at') || message.includes('processing_token')) {
                console.warn('[PROCESSADOR] Colunas de lease ainda não existem; seguindo com debounce antigo.');
                leaseEnabled = false;
                return true;
            }
            throw error;
        }
        leaseClaimed = Boolean(data?.length);
        return leaseClaimed;
    };

    const leaseDeadline = Date.now() + PROCESSING_LEASE_WAIT_MS;
    while (!(await tryClaimProcessingLease())) {
        if (Date.now() >= leaseDeadline) {
            console.warn(`[PROCESSADOR] Sessão ${sessionId} continua ocupada; o worker mais novo será reprocessado pelo próximo evento.`);
            return NextResponse.json({ status: 'session_busy' }, { status: 202 });
        }
        await new Promise((resolve) => setTimeout(resolve, PROCESSING_LEASE_POLL_MS));
    }

    try {
        // O worker pode ter esperado outro turno terminar. Confere novamente se
        // ainda representa a mensagem mais nova antes de gastar uma chamada de IA.
        if (leaseEnabled && triggerMessageId) {
            const { data: latestAfterLease } = await supabase
                .from('messages')
                .select('id')
                .eq('session_id', sessionId)
                .eq('sender', 'user')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            if (latestAfterLease && String(latestAfterLease.id) !== String(triggerMessageId)) {
                return NextResponse.json({ status: 'superseded_after_wait' });
            }
        }

    // Se chegamos aqui, DEVEMOS manter o status digitando ativo se o processamento demorar?
    // Digitando no Telegram dura ~5s. Pode ter expirado ou estar perto. 
    // Vamos enviar de novo só por segurança/frescor para o atraso real de geração.
    await sendTelegramAction(botToken, chatId, 'typing');

    // 5. Contexto e Lógica


    // Identificar contexto e a ultima oferta em paralelo.
    const [lastBotResult, lastOfferResult] = await Promise.all([
        supabase
            .from('messages')
            .select('created_at, content')
            .eq('session_id', sessionId)
            .eq('sender', 'bot')
            .order('created_at', { ascending: false })
            .limit(1)
            .single(),
        supabase
            .from('messages')
            .select('created_at')
            .eq('session_id', sessionId)
            .or("content.ilike.%[M?DIA:% ,content.ilike.%PIX GENERATED%")
            .order('created_at', { ascending: false })
            .limit(1)
            .single(),
    ]);
    const lastBotMsg = lastBotResult.data;
    const lastOfferMsg = lastOfferResult.data;

    const cutoffTime = lastBotMsg ? lastBotMsg.created_at : new Date(0).toISOString();

    // Buscar mensagens agrupadas
    const { data: groupMessages } = await supabase
        .from('messages')
        .select('id, content, sender, created_at')
        .eq('session_id', sessionId)
        .gt('created_at', cutoffTime)
        .order('created_at', { ascending: true });

    if (!groupMessages || groupMessages.length === 0) {
        console.log("[PROCESSADOR] Sem mensagens para processar?");
        return NextResponse.json({ status: 'done' });
    }

    const triggerPrefix = "[ADMIN_TRIGGER_SALE]";
    const filteredGroupMessages = (groupMessages || []).filter((m: any) => {
        if (m.sender === 'user') return true;
        if (m.sender === 'system' && typeof m.content === 'string' && m.content.startsWith(triggerPrefix)) return true;
        return false;
    });

    if (!filteredGroupMessages || filteredGroupMessages.length === 0) {
        console.log("[PROCESSADOR] Sem mensagens para processar?");
        return NextResponse.json({ status: 'done' });
    }

    const combinedText = filteredGroupMessages.map((m: any) => m.content).join("\n");
    const userOnlyText = filteredGroupMessages.filter((m: any) => m.sender === 'user').map((m: any) => m.content).join("\n");
    const lastGroupedUserAt = filteredGroupMessages
        .filter((m: any) => m.sender === 'user' && m.created_at)
        .map((m: any) => String(m.created_at))
        .sort()
        .at(-1) || new Date().toISOString();
    const repetition = detectRepetition(filteredGroupMessages);
    console.log(`[PROCESSADOR] Enviando para Gemini: ${combinedText}`);

    const lastOfferAt = lastOfferMsg?.created_at ? new Date(lastOfferMsg.created_at).getTime() : null;
    const minutesSinceOffer = lastOfferAt ? Math.floor((Date.now() - lastOfferAt) / 60000) : 999;

    // 4. Preparar Contexto e Mídia (Se hover)
    const currentStage = (session.funnel_step || "WELCOME").toUpperCase();
    let selectedVariant: any = null;
    let variantAssignment: { id: string, variant_id: string, stage: string } | null = null;

    selectedVariant = await pickPromptVariant(currentStage);
    let extraScript = "";
    if (selectedVariant?.content) {
        extraScript = `# VARIACAO AUTOMATICA (${currentStage})\n- use este bloco como prioridade nesta resposta.\n${selectedVariant.content}`;
        const { data: assignment } = await supabase.from('variant_assignments').insert({
            session_id: session.id,
            variant_id: selectedVariant.id,
            stage: currentStage
        }).select('id, variant_id, stage').single();
        if (assignment) variantAssignment = assignment;
    }

    const detectedCity = detectCityFromText(userOnlyText);
    const leadMemory = normalizeLeadMemory(session.lead_memory);
    const redirectCity = typeof leadMemory.metadata?.redirect_city === 'string' ? leadMemory.metadata.redirect_city.trim() : '';
    const storedCity = typeof session.user_city === 'string' ? session.user_city.trim() : '';
    let userCity = storedCity || redirectCity;
    if (!storedCity && redirectCity) {
        await supabase.from('sessions').update({ user_city: redirectCity }).eq('id', session.id);
    }
    if (detectedCity) {
        const detectedKey = normalizeCityKey(detectedCity);
        const storedKey = normalizeCityKey(storedCity);
        if (!storedKey || detectedKey !== storedKey) {
            userCity = detectedCity;
            await supabase.from('sessions').update({ user_city: detectedCity }).eq('id', session.id);
        }
    }
    const hasCity = Boolean(userCity);
    const cityQuestion = /(de onde (voce|vc|você) e|vc e de onde|você é de onde|qual (sua|a) cidade|onde (voce|vc|você) mora)/i.test(userOnlyText);

    const context = {
        userCity: hasCity ? userCity : undefined,
        isHighTicket: session.device_type === 'iPhone',
        totalPaid: session.total_paid || 0,
        currentStats: session.lead_score,
        minutesSinceOffer,
        extraScript,
        leadMemory
    };

    const extractFileAndCaption = (input: string) => {
        const lines = input.split(/\r?\n/);
        const firstLine = lines[0] || '';
        const captionMatch = input.match(/caption:\s*(.*)$/i);
        const caption = captionMatch ? captionMatch[1].trim() : '';
        const match = firstLine.match(/File_ID: ([^\s]+)/);
        const fileId = match ? match[1].trim() : '';
        return { fileId, caption };
    };

    let finalUserMessage = `[MENSAGENS DO LEAD NO MESMO TURNO]
${combinedText}

[REGRA DE CONVERSA]
Leia todas as mensagens acima como uma fala agrupada do lead, com visao geral da conversa.
Nao responda linha por linha.
Responda principalmente a ultima intencao do lead, usando o contexto das mensagens anteriores.
Em conversa normal, prefira 2-4 baloes curtos e naturais, como mensagens seguidas no Telegram.
Cada balao deve ter uma funcao e normalmente ate 90 caracteres. Use mais apenas se houver fantasia sexual explicita ja aberta pelo lead.`;
    let mediaData = undefined;

    // Detectar Audio
    const audioMatch = combinedText.match(/\[AUDIO_UUID: (.+)\]/);
    if (audioMatch && botToken) {
        const fileId = audioMatch[1];
        console.log(`[PROCESSADOR] Detectado Áudio ID: ${fileId}`);

        try {
            // Importar dinamicamente para evitar erro circular se houver, ou usar as funcoes diretas
            const { getTelegramFilePath, getTelegramFileDownloadUrl } = await import('@/lib/telegram');

            const filePath = await getTelegramFilePath(botToken, fileId);
            if (filePath) {
                const downloadUrl = getTelegramFileDownloadUrl(botToken, filePath);
                console.log(`[PROCESSADOR] Baixando áudio de: ${downloadUrl}`);

                const res = await fetch(downloadUrl);
                const arrayBuffer = await res.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const base64Audio = buffer.toString('base64');

                mediaData = {
                    mimeType: 'audio/ogg', // Telegram voice notes are usually OGG Opus
                    data: base64Audio
                };

                // Remove o tag interna para a IA não se confundir, ou passamos uma instrução
                finalUserMessage = "Enviou um áudio de voz.";
            }
        } catch (e) {
            console.error("Erro ao baixar áudio:", e);
        }
    }

    // Detectar V??deo
    const videoMatch = combinedText.match(/\[VIDEO_UPLOAD\] File_ID: (.+)/);
    if (videoMatch) {
        const { fileId, caption } = extractFileAndCaption(videoMatch[0]);
        // Sempre avise a IA que o video foi recebido.
        finalUserMessage = "Enviou um v??deo. O sistema confirmou o recebimento do v??deo." + (caption ? `\nLegenda do usu??rio: ${caption}` : '');
        if (fileId && botToken) {
            try {
                const { getTelegramFilePath, getTelegramFileDownloadUrl } = await import('@/lib/telegram');
                const filePath = await getTelegramFilePath(botToken, fileId);
                if (filePath) {
                    const downloadUrl = getTelegramFileDownloadUrl(botToken, filePath);
                    const { data: videoMsg } = await supabase
                        .from('messages')
                        .select('id')
                        .eq('session_id', session.id)
                        .eq('sender', 'user')
                        .ilike('content', `%${fileId}%`)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single();
                    if (videoMsg) {
                        await supabase.from('messages').update({
                            media_url: downloadUrl,
                            media_type: 'video'
                        }).eq('id', videoMsg.id);
                    }
                }
            } catch (e) {
                console.error("Erro ao processar v??deo:", e);
            }
        }
    }

    // Detectar Foto (Novo)
    const photoMatch = combinedText.match(/\[PHOTO_UPLOAD\] File_ID: (.+)/);
    if (photoMatch && botToken) {
        const { fileId, caption } = extractFileAndCaption(photoMatch[0]);
        if (!fileId) return NextResponse.json({ status: 'invalid_photo' });
        console.log(`[PROCESSADOR] Detectada FOTO ID: ${fileId}`);

        try {
            const { getTelegramFilePath, getTelegramFileDownloadUrl } = await import('@/lib/telegram');
            const filePath = await getTelegramFilePath(botToken, fileId);
            if (filePath) {
                const downloadUrl = getTelegramFileDownloadUrl(botToken, filePath);
                console.log(`[PROCESSADOR] URL da Foto: ${downloadUrl}`);

                // 1. Atualizar a mensagem original com o media_url para o Chat Monitor ver
                // Precisamos achar a mensagem do usuário com esse FileID
                const { data: photoMsg } = await supabase
                    .from('messages')
                    .select('id')
                    .eq('session_id', session.id)
                    .eq('sender', 'user')
                    .ilike('content', `%${fileId}%`)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single();

                if (photoMsg) {
                    await supabase.from('messages').update({
                        media_url: downloadUrl, // Url temporária do Telegram (1h)
                        media_type: 'image'
                    }).eq('id', photoMsg.id);
                }
                const res = await fetch(downloadUrl);
                const arrayBuffer = await res.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const base64Image = buffer.toString('base64');
                const mimeType = res.headers.get('content-type') || 'image/jpeg';

                mediaData = {
                    mimeType,
                    data: base64Image
                };

                finalUserMessage = [
                    "O lead enviou uma foto. Analise a imagem real antes de responder.",
                    "Prioridade maxima: se a imagem parecer comprovante de PIX, transferencia, recibo, tela de banco, QR pago ou comprovante de pagamento, trate como comprovante e use action check_payment_status.",
                    "Nao presuma que e nude/foto +18. So reaja como foto sensual se a imagem realmente mostrar isso.",
                    caption ? `Legenda do usuario: ${caption}` : ''
                ].filter(Boolean).join('\n');
            }
        } catch (e) {
            console.error("Erro ao processar foto:", e);
        }
    }

    if (combinedText.includes(triggerPrefix)) {
        finalUserMessage = `${finalUserMessage}\n\n[OBSERVACAO INTERNA: o admin pediu para iniciar a venda agora. Use o contexto da conversa e leve para proposta/preco de forma natural.]`;
    }
    if (repetition.repeats >= 2) {
        finalUserMessage = `${finalUserMessage}\n\n[OBSERVACAO INTERNA: o lead repetiu a mesma mensagem ${repetition.repeats}x ("${repetition.last}"). Responda diferente, quebre o loop e puxe o assunto com algo novo e humano. Nao repita a mesma frase.]`;
    }
    if (hasExplicitSexualFantasyTrigger(userOnlyText)) {
        finalUserMessage = `${finalUserMessage}\n\n[OBSERVACAO INTERNA: o lead abriu putaria explicita. Antes de vender ou perguntar outra coisa, continue a fantasia no mesmo tema que ele trouxe. Faca ele imaginar a cena em varios baloes curtos, explicitos e naturais. Se a conversa estiver muito quente, pode usar 4-6 baloes; se estiver menos quente, use menos. Depois puxe para uma previa/oferta coerente se couber.]`;
    }
    if (cityQuestion && hasCity) {
        finalUserMessage = `${finalUserMessage}\n\n[OBSERVACAO INTERNA: o lead perguntou onde voce mora. Voce mora na MESMA cidade do lead: "${userCity}". Responda no PRIMEIRO BALAO de forma humana, curta e natural: "sou de ${userCity} amor, e vc?". NAO diga "cidade vizinha", NAO diga "daqui" e NAO responda seco.]`;
    }
    if (cityQuestion && !hasCity) {
        finalUserMessage = `${finalUserMessage}\n\n[OBSERVACAO INTERNA: o lead perguntou sua cidade, mas voce AINDA NAO sabe a cidade dele. Pergunte primeiro "de onde vc e anjo?" e NAO diga sua cidade agora.]`;
    }

    console.log("[PROCESSADOR] Iniciando geração da resposta", {
        sessionId: session.id,
        groupedMessages: filteredGroupMessages.length,
        hasMedia: Boolean(mediaData),
    });
    const typingHeartbeat = setInterval(() => {
        void sendTelegramAction(botToken, chatId, 'typing').catch((error: any) => {
            console.warn('[PROCESSADOR] Falha ao renovar digitando:', error?.message || error);
        });
    }, 4000);
    let aiResponse: Awaited<ReturnType<typeof sendMessageToGemini>>;
    try {
        aiResponse = await sendMessageToGemini(session.id, finalUserMessage, context, mediaData);
    } finally {
        clearInterval(typingHeartbeat);
    }
    console.log("[PROCESSADOR] Resposta gerada", {
        sessionId: session.id,
        messages: Array.isArray(aiResponse.messages) ? aiResponse.messages.length : 0,
        action: aiResponse.action,
        state: aiResponse.current_state,
    });
    const contextualMedia = aiResponse.preview_request
        ? null
        : resolveContextualMediaAction(userOnlyText, aiResponse.action);
    if (contextualMedia) {
        aiResponse.action = contextualMedia.action;
        aiResponse.current_state = ACTION_STAGE_MAP[contextualMedia.action] || aiResponse.current_state;
    }
    if (aiResponse.preview_request?.description) {
        try {
            await upsertMissingPreviewRequest({
                description: aiResponse.preview_request.description,
                tags: aiResponse.preview_request.tags || [],
                examplePhrase: userOnlyText,
                sessionId: session.id,
            });
        } catch (error: any) {
            console.warn('[PREVIAS] Falha ao registrar ideia sugerida pelo lead:', error?.message || error);
        }
    } else if (aiResponse.action === 'none' && /(manda|mostra|quero ver|tem foto|tem video|tem vídeo|foto|video|vídeo|previa|prévia)/i.test(userOnlyText)) {
        try {
            const requestedSpec = inferRequestedPreviewSpec(userOnlyText, aiResponse.action);
            let query = supabase
                .from('preview_assets')
                .select('id,name,description,triggers,tags,priority,media_type')
                .eq('enabled', true)
                .limit(1000);
            if (/video|vídeo/i.test(userOnlyText)) query = query.eq('media_type', 'video');
            const { data: candidates } = await query;
            const bestScore = Math.max(0, ...(candidates || []).map((asset: any) =>
                scorePreviewForContext(asset, userOnlyText, requestedSpec.tags)
            ));
            if (bestScore < 4) {
                await upsertMissingPreviewRequest({
                    description: requestedSpec.description,
                    tags: requestedSpec.tags,
                    examplePhrase: requestedSpec.examplePhrase,
                    sessionId: session.id,
                });
            }
        } catch (error: any) {
            console.warn('[PREVIAS] Falha ao verificar lacuna do catalogo:', error?.message || error);
        }
    }

    console.log("🤖 Resposta Gemini Stats:", JSON.stringify(aiResponse.lead_stats, null, 2));

    // 5. Atualizar Stats & Salvar Pensamentos
    const deterministicScore = calculateLeadScore([{ content: userOnlyText }], {
        initial: session.lead_score,
        totalPaid: Number(session.total_paid || 0),
        includeContextBoosts: false,
    });
    aiResponse.lead_stats = toStoredLeadScore(deterministicScore);

    console.log("📊 [STATS UPDATE] ANTES:", JSON.stringify(session.lead_score));
    console.log("📊 [STATS UPDATE] DEPOIS (IA):", JSON.stringify(aiResponse.lead_stats));

    // LÓGICA DE CONFIANÇA NA IA: A IA recebe os stats atuais no contexto.
    // Confiamos na saída dela para aumentar OU diminuir os valores.

    const previousStep = session.funnel_step;
    const aiStep = aiResponse.current_state ? String(aiResponse.current_state).toUpperCase().trim() : "";
    let nextStep = FUNNEL_STEPS.includes(aiStep) ? aiStep : (previousStep || "WELCOME");
    const actionStep = ACTION_STAGE_MAP[aiResponse.action || ''] || null;
    const inferredStep = actionStep || inferStageFromText([
        ...(Array.isArray(aiResponse.messages) ? aiResponse.messages : []),
        combinedText
    ].join('\n'));

    if (inferredStep) {
        const nextIdx = stageIndex(nextStep);
        const infIdx = stageIndex(inferredStep);
        if (infIdx > nextIdx) {
            nextStep = inferredStep;
        }
    }
    if ((previousStep == null || String(previousStep).toUpperCase() === 'WELCOME') && nextStep === 'WELCOME' && userOnlyText.trim().length > 0) {
        nextStep = 'CONNECTION';
    }

    const detectedLeadMemory = detectLeadMemorySignals(
        userOnlyText,
        Array.isArray(aiResponse.messages) ? aiResponse.messages : [],
        aiResponse,
        session.lead_memory
    );
    const updatedLeadMemory = mergeLeadMemoryPatch(detectedLeadMemory, aiResponse.lead_memory_patch);

    const updatePayload: any = {
        lead_score: aiResponse.lead_stats,
        funnel_step: nextStep,
        lead_memory: updatedLeadMemory,
    };
    let updateResult = await supabase.from('sessions').update(updatePayload).eq('id', session.id).select();

    if (updateResult.error) {
        const msg = String(updateResult.error?.message || '');
        const code = String((updateResult.error as any)?.code || '');
        const missingOptionalColumn = code === '42703' || msg.toLowerCase().includes('funnel_step') || msg.toLowerCase().includes('lead_memory');
        if (missingOptionalColumn) {
            const fallbackPayload: any = { lead_score: aiResponse.lead_stats };
            if (!msg.toLowerCase().includes('funnel_step')) {
                fallbackPayload.funnel_step = nextStep;
            }
            const fallbackResult = await supabase.from('sessions').update(fallbackPayload).eq('id', session.id).select();
            if (fallbackResult.error) {
                console.error("❌ ERRO ao Atualizar Stats (fallback):", fallbackResult.error);
            } else {
                console.log("✅ Stats Atualizados (fallback sem funnel_step):", fallbackResult.data);
            }
            updateResult = fallbackResult;
        } else {
            console.error("❌ ERRO ao Atualizar Stats:", updateResult.error);
        }
    } else {
        console.log("✅ Stats Atualizados no DB com Sucesso:", updateResult.data);
    }

    if (nextStep && previousStep !== nextStep) {
        try {
            await supabase.from('funnel_events').insert({
                session_id: session.id,
                step: nextStep,
                source: 'ai'
            });
        } catch (e: any) {
            console.warn("Falha ao registrar funnel_events:", e?.message || e);
        }
    }

    if (variantAssignment) {
        try {
            const prevIdx = stageIndex(previousStep);
            const nextIdx = stageIndex(nextStep);
            let outcome: boolean | null = null;
            if (prevIdx >= 0 && nextIdx >= 0) {
                if (nextIdx > prevIdx) outcome = true;
                if (nextIdx < prevIdx) outcome = false;
            }
            if (outcome !== null) {
                await supabase.from('variant_assignments').update({ success: outcome }).eq('id', variantAssignment.id);
                const { data: variantRow } = await supabase
                    .from('prompt_variants')
                    .select('successes, failures')
                    .eq('id', variantAssignment.variant_id)
                    .single();
                const successes = Number(variantRow?.successes || 0) + (outcome ? 1 : 0);
                const failures = Number(variantRow?.failures || 0) + (outcome ? 0 : 1);
                await supabase.from('prompt_variants').update({
                    successes,
                    failures,
                    updated_at: new Date().toISOString()
                }).eq('id', variantAssignment.variant_id);
            }
        } catch (e: any) {
            console.warn("Falha ao registrar resultado da variacao:", e?.message || e);
        }
    }

    if (aiResponse.internal_thought) {
        await supabase.from('messages').insert({
            session_id: session.id,
            sender: 'thought',
            content: aiResponse.internal_thought
        });
    }

    // 5.5 Atualizar Transcrição de Áudio (Se houver)
    if (aiResponse.audio_transcription && audioMatch) {
        // audioMatch[0] é todo o texto "[AUDIO_UUID: ...]"
        // Vamos atualizar a mensagem do usuário que contém isso.
        // Precisamos achar o ID da mensagem.
        // Podemos tentar achar pelo conteúdo exato no banco para essa sessão.

        const { data: audioMsg } = await supabase
            .from('messages')
            .select('id')
            .eq('session_id', session.id)
            .eq('sender', 'user')
            .ilike('content', `%${audioMatch[1]}%`) // Match pelo UUID
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (audioMsg) {
            console.log(`[PROCESSADOR] Atualizando transcrição para MSG ${audioMsg.id}`);
            await supabase.from('messages').update({
                content: `[ÁUDIO (Transcrição): "${aiResponse.audio_transcription}"]`
            }).eq('id', audioMsg.id);
        }
    }

    // 6. Enviar Respostas

    const outgoingMessages = Array.isArray(aiResponse.messages)
        ? aiResponse.messages
        : [String(aiResponse.messages || '')].filter(Boolean);

    let safeMessages = (outgoingMessages.length > 0 ? outgoingMessages : ['amor?'])
        .map((m: string) => sanitizeOutgoingMessage(m))
        .filter(Boolean);

    const lastBotContent = lastBotMsg?.content || '';
    safeMessages = applyConversationQualityGuards(safeMessages, {
        userText: userOnlyText,
        sessionName: session.user_name,
        hasCity,
        userAskedCity: cityQuestion,
        extractedName: aiResponse.extracted_user_name,
        lastBotContent
    });
    if (cityQuestion && hasCity) {
        const forcedCityAnswer = `sou de ${userCity} amor, e vc?`;
        const withoutGenericCity = safeMessages.filter((msg: string) => {
            const norm = normalizeLoopText(msg);
            return !/(cidade vizinha|daqui|de onde vc|de onde voce|de onde você)/i.test(norm);
        });
        safeMessages = [forcedCityAnswer, ...withoutGenericCity.filter((msg: string) => normalizeLoopText(msg) !== normalizeLoopText(forcedCityAnswer))];
    }

    if (contextualMedia) {
        const introNorm = normalizeLoopText(contextualMedia.intro);
        const alreadyPrepared = safeMessages.some((msg: string) => {
            const norm = normalizeLoopText(msg);
            return norm.includes('essa') || norm.includes('foto') || norm.includes('video') || norm.includes('olha') || norm.includes(introNorm);
        });
        if (!alreadyPrepared) {
            safeMessages = [contextualMedia.intro, ...safeMessages];
        }
    }

    const stage = String(aiResponse.current_state || '').toUpperCase();
    const explicitFantasy = hasExplicitSexualFantasyTrigger(userOnlyText);
    const maxMessagesForTurn = (() => {
        if (explicitFantasy) return 6;
        if (stage === 'PAYMENT_CHECK' || aiResponse.action === 'generate_pix_payment') return 3;
        if (stage === 'NEGOTIATION' || stage === 'CLOSING' || stage === 'SALES_PITCH') return 4;
        if (trustObjectionRequested(userOnlyText)) return 3;
        return 4;
    })();

    safeMessages = shapeConversationBubbles(safeMessages, {
        preferredCount: aiResponse.recommended_message_count || 3,
        maxBubbles: maxMessagesForTurn,
        maxChars: aiResponse.max_chars_per_message || 90,
    });

    const normLastBot = normalizeLoopText(lastBotContent);
    const normFirstOut = normalizeLoopText(safeMessages[0] || '');
    if (normLastBot && normFirstOut && normLastBot === normFirstOut) {
        safeMessages[0] = `ei amor ${safeMessages[0]}`;
    }

    const isMediaDeliveryTurn = MEDIA_ACTIONS.has(String(aiResponse.action || 'none'));
    const mediaDeliveryClaim = /(ta aqui|t[aá] aqui|olha essa|acabei de (te )?mandar|te mandei|gostou|curtiu|o que achou|do que viu)/i;
    const firstGeneratedMessage = safeMessages[0] || '';
    const naturalMediaSetup = (firstGeneratedMessage && !mediaDeliveryClaim.test(firstGeneratedMessage) ? firstGeneratedMessage : '')
        || contextualMedia?.intro
        || 'pera ai, separei uma coisinha que combina com vc';
    const mediaReactionMessage = safeMessages.find((message: string) =>
        /(gostou|curtiu|o que achou|me fala o que achou|do que viu)/i.test(message)
    ) || 'agora me fala o que achou';

    // Em turnos com mídia, nunca alegamos que o arquivo chegou antes do Telegram confirmar.
    // Um único balão prepara o envio; a reação só sai depois da entrega bem-sucedida.
    const deferredMediaMessages = isMediaDeliveryTurn ? [mediaReactionMessage] : [];
    const outgoingToSend = isMediaDeliveryTurn ? [naturalMediaSetup] : safeMessages;
    let operationalLeadMemory = updatedLeadMemory;
    const persistMediaDeliveryStatus = async (
        status: 'delivered' | 'recovered' | 'failed',
        details: { mediaType?: string; mediaUrl?: string } = {},
    ) => {
        operationalLeadMemory = {
            ...operationalLeadMemory,
            metadata: {
                ...(operationalLeadMemory.metadata || {}),
                last_media_status: status,
                last_media_action: String(aiResponse.action || 'none'),
                last_media_type: details.mediaType || null,
                last_media_url: details.mediaUrl || null,
                last_media_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
        };
        const { error } = await supabase
            .from('sessions')
            .update({ lead_memory: operationalLeadMemory })
            .eq('id', session.id);
        if (error) console.warn('[MÍDIA] Falha ao salvar status operacional:', error.message);
    };

    const findNewerUserMessage = async () => {
        const { data } = await supabase
            .from('messages')
            .select('id, created_at')
            .eq('session_id', session.id)
            .eq('sender', 'user')
            .gt('created_at', lastGroupedUserAt)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        return data;
    };

    const sendDeferredMediaReaction = async () => {
        for (const message of deferredMediaMessages) {
            if (await findNewerUserMessage()) return;

            await waitWithChatAction('typing', humanTextDelayMs(message, 1));
            if (await findNewerUserMessage()) return;
            await sendTelegramMessage(botToken, chatId, message);
            await supabase.from('messages').insert({
                session_id: session.id,
                sender: 'bot',
                content: message,
            });
        }
    };
    const audioCooldownSince = new Date(Date.now() - fishAudioSettings.cooldownMinutes * 60_000).toISOString();
    const { data: recentAudio } = fishAudioSettings.enabled
        ? await supabase
            .from('messages')
            .select('id')
            .eq('session_id', session.id)
            .eq('sender', 'bot')
            .eq('media_type', 'audio')
            .gte('created_at', audioCooldownSince)
            .limit(1)
            .maybeSingle()
        : { data: null };
    const preferredAudioIndex = outgoingToSend.findIndex((message: string) =>
        shouldUseFishAudio({
            settings: fishAudioSettings,
            seed: `${session.id}:${triggerMessageId || lastGroupedUserAt}:${message}`,
            userText: userOnlyText,
            messageText: message,
            stage,
            action: String(aiResponse.action || 'none'),
            hasRecentAudio: Boolean(recentAudio),
        })
    );
    const preparedAudioPromise = preferredAudioIndex >= 0
        ? (() => {
            const messageText = outgoingToSend[preferredAudioIndex];
            const expressiveText = buildExpressiveSpeech({
                messageText,
                userText: userOnlyText,
                emotionalContext: String(session.lead_memory?.emotional_context || ''),
                maxChars: fishAudioSettings.maxChars,
            });
            return generateFishAudio({ settings: fishAudioSettings, text: expressiveText })
                .then((audio) => ({ audio, expressiveText, error: null as unknown }))
                .catch((error: unknown) => ({ audio: null, expressiveText, error }));
        })()
        : null;

    for (let i = 0; i < outgoingToSend.length; i++) {
        const msgText = outgoingToSend[i];

        const newerUserMsg = await findNewerUserMessage();

        if (newerUserMsg) {
            console.log(`[PROCESSADOR] Abortando envio. Lead mandou mensagem nova depois do pacote processado: ${newerUserMsg.id}`);
            return NextResponse.json({ status: 'superseded_during_send' });
        }

        if (i === preferredAudioIndex) {
            try {
                if (!preparedAudioPromise) throw new Error('audio nao preparado');
                const expressiveText = buildExpressiveSpeech({
                    messageText: msgText,
                    userText: userOnlyText,
                    emotionalContext: String(session.lead_memory?.emotional_context || ''),
                    maxChars: fishAudioSettings.maxChars,
                });
                const [preparedAudio] = await Promise.all([
                    preparedAudioPromise,
                    waitWithChatAction('record_voice', humanAudioRecordingDelayMs(expressiveText)),
                ]);
                if (preparedAudio.error || !preparedAudio.audio) throw preparedAudio.error || new Error('audio vazio');
                const interruptedDuringRecording = await findNewerUserMessage();
                if (interruptedDuringRecording) {
                    console.log(`[PROCESSADOR] Áudio cancelado porque o lead enviou uma mensagem nova: ${interruptedDuringRecording.id}`);
                    return NextResponse.json({ status: 'superseded_during_recording' });
                }
                await sendTelegramVoice(botToken, chatId, preparedAudio.audio);
                await supabase.from('messages').insert({
                    session_id: session.id,
                    sender: 'bot',
                    content: `🎤 Áudio da Lari: ${msgText}`,
                    media_type: 'audio',
                });
                continue;
            } catch (error: any) {
                console.error('[FISH AUDIO] Falha, usando texto como fallback:', error?.message || error);
                await supabase.from('messages').insert({
                    session_id: session.id,
                    sender: 'system',
                    content: `[FISH AUDIO ERROR] ${String(error?.message || error).slice(0, 500)}`,
                });
            }
        }

        await waitWithChatAction('typing', humanTextDelayMs(msgText, i));
        const interruptedDuringTyping = await findNewerUserMessage();
        if (interruptedDuringTyping) {
            console.log(`[PROCESSADOR] Texto cancelado porque o lead enviou uma mensagem nova: ${interruptedDuringTyping.id}`);
            return NextResponse.json({ status: 'superseded_during_typing' });
        }

        await supabase.from('messages').insert({
            session_id: session.id,
            sender: 'bot',
            content: msgText
        });

        await sendTelegramMessage(botToken, chatId, msgText);
    }

    if (combinedText.includes(triggerPrefix)) {
        try {
            await supabase
                .from('messages')
                .delete()
                .eq('session_id', session.id)
                .eq('sender', 'system')
                .ilike('content', '[ADMIN_TRIGGER_SALE]%');
        } catch (e: any) {
            console.warn("Falha ao limpar trigger de venda:", e?.message || e);
        }
    }




    // 6.5 Atualizar Last Bot Activity
    // Importante para o Cron de Reengajamento saber quando foi a última msg
    const nowIso = new Date().toISOString();
    await supabase.from('sessions').update({
        last_bot_activity_at: nowIso,
        last_message_at: nowIso
    }).eq('id', session.id);

    // 7. Lidar com Mídia
    if (aiResponse.action !== 'none') {
        const requestedPreviewSpec = inferRequestedPreviewSpec(userOnlyText, aiResponse.action);
        const actionTags: Record<string, string[]> = {
            send_shower_photo: ['banho', 'chuveiro', 'molhada'],
            send_lingerie_photo: ['lingerie'],
            send_wet_finger_photo: ['molhada', 'explicit'],
            send_ass_photo_preview: ['bunda', 'de quatro', 'costas'],
            send_video_preview: ['video'],
            send_hot_video_preview: ['video', 'explicit'],
        };
        const preferredPreviewTags = Array.from(new Set([
            ...(actionTags[String(aiResponse.action)] || []),
            ...requestedPreviewSpec.tags,
        ]));

        const getRegisteredPreview = async (
            mediaType?: 'image' | 'video',
            excludeUrls: string[] = [],
            preferredTags: string[] = preferredPreviewTags,
            requireRelevant = true,
        ) => {
            let query = supabase
                .from('preview_assets')
                .select('id,name,description,triggers,tags,media_url,media_type,priority,min_tarado,max_tarado')
                .eq('enabled', true)
                .order('priority', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(1000);
            if (mediaType) query = query.eq('media_type', mediaType);
            const { data, error } = await query;
            if (error) {
                console.warn('[MÍDIA] Falha ao procurar prévia cadastrada:', error.message);
                return null;
            }
            const excluded = new Set(excludeUrls.map((url) => String(url || '')));
            const tarado = Number(aiResponse.lead_stats?.tarado || 0);
            const ranked = (data || [])
                .filter((item: any) => item.media_url
                    && !excluded.has(String(item.media_url))
                    && tarado >= Number(item.min_tarado ?? 0)
                    && tarado <= Number(item.max_tarado ?? 100))
                .map((item: any) => ({
                    item,
                    score: scorePreviewForContext(item, userOnlyText, preferredTags),
                }))
                .sort((a: any, b: any) => b.score - a.score);
            if (ranked.length === 0) return null;
            if (requireRelevant && ranked[0].score < 4) return null;
            return ranked[0].item;
        };

        let mediaUrl = null;
        let mediaType = null;
        let caption = "";

        if (aiResponse.action === 'send_custom_preview') {
            const previewId = (aiResponse as any).preview_id;
            if (previewId) {
                const { data: previewRow } = await supabase
                    .from('preview_assets')
                    .select('media_url, media_type, name, enabled')
                    .eq('id', previewId)
                    .eq('enabled', true)
                    .single();
                if (previewRow?.media_url) {
                    mediaUrl = previewRow.media_url;
                    mediaType = previewRow.media_type;
                    caption = "";
                }
            }
            if (!mediaUrl) {
                const requestedType = /video|vídeo/i.test(userOnlyText) ? 'video' : undefined;
                const fallbackPreview = await getRegisteredPreview(requestedType, [], requestedPreviewSpec.tags, true);
                if (fallbackPreview) {
                    mediaUrl = fallbackPreview.media_url;
                    mediaType = fallbackPreview.media_type;
                }
            }
        } else {
            switch (aiResponse.action) {
                case 'send_shower_photo':
                case 'send_lingerie_photo':
                case 'send_wet_finger_photo':
                case 'send_ass_photo_preview': {
                    const registered = await getRegisteredPreview('image', [], preferredPreviewTags, true);
                    mediaUrl = registered?.media_url || null;
                    mediaType = registered?.media_type || null;
                    break;
                }
                case 'send_video_preview':
                case 'send_hot_video_preview': {
                    const registered = await getRegisteredPreview('video', [], preferredPreviewTags, true);
                    mediaUrl = registered?.media_url || null;
                    mediaType = registered?.media_type || null;
                    break;
                }
                case 'check_payment_status':
                // Verificar se o último pagamento foi pago
                try {
                    // Precisamos buscar o ID do último pagamento de algum lugar.
                    // Por enquanto, vamos procurar a ÚLTIMA mensagem de sistema com dados PIX?
                    // Ou mais limpo: O usuário diz "Paguei", verificamos o último pagamento criado para este usuário no WiinPay?
                    // O Serviço WiinPay precisa suportar listagem ou armazenamos paymentId na sessão?

                    // SIMPLIFICAÇÃO: Vamos assumir que armazenamos o último PaymentID em mensagens ou sessão.
                    // Vamos procurar a última mensagem de pagamento no DB
                    const { data: lastPayMsg } = await supabase
                        .from('messages')
                        .select('id, content, payment_data')
                        .eq('session_id', session.id)
                        .eq('sender', 'system')
                        .ilike('content', '%PIX GENERATED%')
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single();

                    if (lastPayMsg) {
                        // Extrair Valor e ID
                        // Formato esperado: "[SYSTEM: PIX GENERATED - 24.90 | ID: abc-123]"
                        const content = lastPayMsg.content || '';
                        const valueMatch = content.match(/PIX GENERATED - (\d+(\.\d+)?)/);
                        const idMatch = content.match(/ID: ([a-zA-Z0-9\-_]+)/);

                        const value = lastPayMsg.payment_data?.value ?? (valueMatch ? parseFloat(valueMatch[1]) : 0);
                        const paymentId = lastPayMsg.payment_data?.paymentId ?? (idMatch ? idMatch[1] : null);
                        const storedPaid = lastPayMsg.payment_data?.paid === true || isPaymentPaidPayload(lastPayMsg.payment_data);

                        if (!paymentId) {
                            await sendTelegramMessage(botToken, chatId, "amor nao achei o codigo da transação aqui... manda o comprovante?");
                            break;
                        }

                        console.log(`[PROCESSADOR] Verificando Pagamento ID: ${paymentId}`);
                        const statusData = storedPaid
                            ? { ok: true, status: lastPayMsg.payment_data?.status || 'paid', source: 'local_payment_data' }
                            : shouldThrottlePushinpayStatusCheck(lastPayMsg.payment_data)
                                ? {
                                    ok: true,
                                    status: lastPayMsg.payment_data?.status || 'pending',
                                    gateway: 'pushinpay',
                                    source: 'pushinpay_local_cooldown',
                                    message: 'consulta direta da PushinPay respeita intervalo minimo de 1 minuto'
                                }
                                : await getPaymentStatusMultiGateway(paymentId, lastPayMsg.payment_data?.gateway);

                        console.log(`[PROCESSADOR] Status pagamento:`, JSON.stringify(statusData));

                        const status = findPaymentStatus(statusData) || normalizePaymentStatus(lastPayMsg.payment_data?.status) || 'pending';
                        const isPaid = storedPaid || isPaymentPaidPayload(statusData);

                        if (isPaid) {
                            // Incrementar LTV
                            const currentTotal = Number(session.total_paid || 0);
                            const alreadyCounted = lastPayMsg.payment_data?.counted === true;
                            const newTotal = alreadyCounted ? currentTotal : currentTotal + Number(value || 0);

                            await supabase.from('sessions').update({
                                total_paid: newTotal,
                                lead_score: markLeadPaid(session.lead_score),
                            }).eq('id', session.id);

                            // Notificar IA sobre sucesso (via Mensagem de Sistema oculta)
                            await supabase.from('messages').insert({
                                session_id: session.id,
                                sender: 'system',
                                content: `[SISTEMA: PAGAMENTO CONFIRMADO - R$ ${value}. TOTAL PAGO: R$ ${newTotal}]`
                            });

                            await sendTelegramMessage(botToken, chatId, "confirmado amor! obrigada... vou te mandar agora");

                            // Forçar IA a saber que pagou na proxima iteração se necessário, 
                            // mas aqui ela já recebe o input de sistema acima.
                            if (lastPayMsg.id) {
                                await supabase.from('messages').update({
                                    payment_data: {
                                        ...(lastPayMsg.payment_data || {}),
                                        paid: true,
                                        counted: true,
                                        status: status || 'paid',
                                        paid_at: lastPayMsg.payment_data?.paid_at || new Date().toISOString(),
                                        last_checked_at: new Date().toISOString(),
                                        last_status_payload: statusData
                                    }
                                }).eq('id', lastPayMsg.id);
                            }
                            try {
                                await supabase.from('funnel_events').insert({
                                    session_id: session.id,
                                    step: 'PAYMENT_CONFIRMED',
                                    source: 'system'
                                });
                            } catch (e: any) {
                                console.warn("Falha ao registrar pagamento no funil:", e?.message || e);
                            }

                            try {
                                const { data: lastAssign } = await supabase
                                    .from('variant_assignments')
                                    .select('id, variant_id')
                                    .eq('session_id', session.id)
                                    .is('success', null)
                                    .order('created_at', { ascending: false })
                                    .limit(1)
                                    .single();
                                if (lastAssign) {
                                    await supabase.from('variant_assignments').update({ success: true }).eq('id', lastAssign.id);
                                    const { data: variantRow } = await supabase
                                        .from('prompt_variants')
                                        .select('successes')
                                        .eq('id', lastAssign.variant_id)
                                        .single();
                                    const successes = Number(variantRow?.successes || 0) + 1;
                                    await supabase.from('prompt_variants').update({
                                        successes,
                                        updated_at: new Date().toISOString()
                                    }).eq('id', lastAssign.variant_id);
                                }
                            } catch (e: any) {
                                console.warn("Falha ao registrar sucesso da variacao no pagamento:", e?.message || e);
                            }
                        } else {
                            if (statusData?.ok === false) {
                                await supabase.from('messages').update({
                                    payment_data: {
                                        ...(lastPayMsg.payment_data || {}),
                                        paid: false,
                                        status: status || lastPayMsg.payment_data?.status || 'pending',
                                        last_checked_at: new Date().toISOString(),
                                        last_check_error: statusData.error || 'erro ao consultar pagamento',
                                        last_status_payload: statusData
                                    }
                                }).eq('id', lastPayMsg.id);
                                await sendTelegramMessage(botToken, chatId, "amor nao consegui consultar o sistema agora, me manda o comprovante que eu confiro pra vc");
                                break;
                            }
                            await supabase.from('messages').update({
                                payment_data: {
                                    ...(lastPayMsg.payment_data || {}),
                                    paid: false,
                                    status: status || 'pending',
                                    last_checked_at: new Date().toISOString(),
                                    last_status_payload: statusData
                                }
                            }).eq('id', lastPayMsg.id);
                            await sendTelegramMessage(botToken, chatId, "amor ainda não caiu aqui... tem certeza? (Status: " + status + ")");
                        }

                    } else {
                        await sendTelegramMessage(botToken, chatId, "amor qual pix? nao achei aqui");


                    }
                } catch (e: any) {
                    console.error("Erro Verificação Pagamento", e);
                    await sendTelegramMessage(botToken, chatId, "deu erro ao verificar amor, manda o comprovante?");
                }
                break;

            case 'generate_pix_payment':
                try {
                    const inferredValue = inferPixValue([
                        ...(Array.isArray(aiResponse.messages) ? aiResponse.messages : []),
                        combinedText,
                        lastBotMsg?.content || ''
                    ]);
                    const negotiatedUserValue = extractNegotiatedUserValue(userOnlyText);
                    const value = Number(negotiatedUserValue ?? aiResponse.payment_details?.value ?? inferredValue ?? 19.90);
                    const description = aiResponse.payment_details?.description || "Pack Exclusivo";
                    // Se já existe PIX pendente com o mesmo valor, reenviar o mesmo
                    const { data: lastPixMsg } = await supabase
                        .from('messages')
                        .select('id, payment_data, created_at')
                        .eq('session_id', session.id)
                        .eq('sender', 'system')
                        .ilike('content', '%PIX GENERATED%')
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single();

                    const lastPaymentData: any = lastPixMsg?.payment_data || {};
                    const sameValue = Number(lastPaymentData.value || 0) === Number(value);
                    const notPaid = lastPaymentData.paid !== true;
                    const lastPixCode = lastPaymentData.pixCopiaCola;
                    const lastPaymentId = lastPaymentData.paymentId;

                    if (sameValue && notPaid && lastPixCode) {
                        await sendTelegramMessage(botToken, chatId, "ta aqui o pix de novo amor 👇");
                        await sendTelegramCopyableCode(botToken, chatId, lastPixCode);

                        await supabase.from('messages').insert({
                            session_id: session.id,
                            sender: 'system',
                            content: "[SYSTEM: PIX RESENT - " + value + " | ID: " + (lastPaymentId || "unknown") + "]",
                            payment_data: {
                                ...lastPaymentData,
                                resent_at: new Date().toISOString()
                            }
                        });
                        break;
                    }
                    // Gerar Pagamento
                    const payment = await createPaymentMultiGateway({
                        value: value,
                        name: session.user_name || "Anônimo",
                        email: (session.user_name && session.user_name.toLowerCase().includes('operação kaique'))
                            ? 'operaçaokaique@gmail.com'
                            : `user_${chatId}@telegram.com`,
                        description: description
                    });

                    // LOG DE DEBUG
                    await supabase.from('messages').insert({
                        session_id: session.id,
                        sender: 'system',
                        content: `[DEBUG] Resposta Gateway PIX: ${JSON.stringify(payment)}`
                    });

                    if (payment && payment.pixCopiaCola) {
                        await sendTelegramMessage(botToken, chatId, "ta aqui o pix amor 👇");
                        if (payment.gateway === 'pushinpay') {
                            await sendTelegramMessage(botToken, chatId, "aviso rapidinho: a PushinPay so processa o pagamento, a entrega e suporte continuam comigo.");
                        }
                        await sendTelegramCopyableCode(botToken, chatId, payment.pixCopiaCola);

                        await supabase.from('messages').insert({
                            session_id: session.id,
                            sender: 'system',
                            content: "[SYSTEM: PIX GENERATED - " + value + " | ID: " + payment.paymentId + "]",
                            payment_data: {
                                paymentId: payment.paymentId,
                                gateway: payment.gateway,
                                gatewayLabel: payment.gatewayLabel,
                                gatewayAttempts: payment.gatewayAttempts,
                                value,
                                description,
                                pixCopiaCola: payment.pixCopiaCola,
                                qrCodeBase64: payment.qrCodeBase64 || null,
                                paid: false,
                                status: payment.status || 'pending'
                            }
                        });
                    } else {
                        await sendTelegramMessage(botToken, chatId, "amor o sistema caiu aqui rapidinho... tenta daqui a pouco?");
                    }
                } catch (err: any) {
                    console.error("Erro Pagamento:", err);
                    // LOG DE ERRO DEBUG
                    await supabase.from('messages').insert({
                        session_id: session.id,
                        sender: 'system',
                        content: `[DEBUG] Erro Gateway PIX: ${err.message || JSON.stringify(err)}`
                    });

                    await sendTelegramMessage(botToken, chatId, "amor nao consegui gerar o pix agora... que raiva");
                }
                break;
            }
        }

        if (mediaUrl) {
            const sendResolvedMedia = async (type: string, url: string) => {
                if (type === 'image') {
                    await sendTelegramAction(botToken, chatId, 'upload_photo');
                    const heartbeat = setInterval(() => {
                        void sendTelegramAction(botToken, chatId, 'upload_photo');
                    }, 4_000);
                    try {
                        await sendTelegramPhoto(botToken, chatId, url, caption);
                    } finally {
                        clearInterval(heartbeat);
                    }
                    return;
                }
                if (type === 'video') {
                    await sendTelegramAction(botToken, chatId, 'upload_video');
                    const heartbeat = setInterval(() => {
                        void sendTelegramAction(botToken, chatId, 'upload_video');
                    }, 4_000);
                    try {
                        await sendTelegramVideo(botToken, chatId, url, caption);
                    } finally {
                        clearInterval(heartbeat);
                    }
                    return;
                }
                throw new Error(`tipo de midia invalido: ${type}`);
            };

            const userAskedRepeatMedia = /(de novo|manda de novo|reenviar|envia de novo|outra vez)/i.test(userOnlyText);
            const { data: recentMediaRows } = !userAskedRepeatMedia
                ? await supabase
                    .from('messages')
                    .select('media_url')
                    .eq('session_id', session.id)
                    .eq('sender', 'bot')
                    .not('media_url', 'is', null)
                    .order('created_at', { ascending: false })
                    .limit(8)
                : { data: [] };
            const recentUrls = new Set((recentMediaRows || []).map((row: any) => String(row.media_url || '')).filter(Boolean));

            if (recentUrls.has(String(mediaUrl))) {
                const alternative = await getRegisteredPreview(
                    mediaType === 'image' || mediaType === 'video' ? mediaType : undefined,
                    [...recentUrls, String(mediaUrl)],
                );
                if (alternative) {
                    mediaUrl = alternative.media_url;
                    mediaType = alternative.media_type;
                }
            }

            let deliveredUrl = String(mediaUrl);
            let deliveredType = String(mediaType || '');
            const deliveryErrors: string[] = [];
            let deliveryRecovered = false;

            try {
                await sendResolvedMedia(deliveredType, deliveredUrl);
            } catch (primaryError: any) {
                deliveryErrors.push(`principal ${deliveredType}:${deliveredUrl} -> ${primaryError?.message || primaryError}`);
                console.error('[MÍDIA] Ativo principal falhou, tentando fallback:', primaryError);

                const excludedUrls = [...recentUrls, deliveredUrl];
                const registeredSameType = await getRegisteredPreview(
                    deliveredType === 'image' || deliveredType === 'video' ? deliveredType : undefined,
                    excludedUrls,
                );
                const registeredAnyType = await getRegisteredPreview(undefined, [
                    ...excludedUrls,
                    String(registeredSameType?.media_url || ''),
                ]);
                const fallbackCandidates = [
                    registeredSameType && { url: String(registeredSameType.media_url), type: String(registeredSameType.media_type) },
                    registeredAnyType && { url: String(registeredAnyType.media_url), type: String(registeredAnyType.media_type) },
                ].filter((candidate): candidate is { url: string; type: string } => Boolean(candidate?.url));

                let recovered = false;
                for (const candidate of fallbackCandidates) {
                    try {
                        await sendResolvedMedia(candidate.type, candidate.url);
                        deliveredUrl = candidate.url;
                        deliveredType = candidate.type;
                        recovered = true;
                        deliveryRecovered = true;
                        break;
                    } catch (fallbackError: any) {
                        deliveryErrors.push(`fallback ${candidate.type}:${candidate.url} -> ${fallbackError?.message || fallbackError}`);
                    }
                }

                if (!recovered) {
                    await supabase.from('messages').insert({
                        session_id: session.id,
                        sender: 'system',
                        content: `[DEBUG: ERRO MÍDIA] ${deliveryErrors.join(' | ').slice(0, 1800)}`
                    });
                    await persistMediaDeliveryStatus('failed');
                    const recoveryMessages = [
                        'essa travou bem na hora de subir kkk',
                        'quer que eu tente uma foto ou um video curtinho?',
                    ];
                    for (let recoveryIndex = 0; recoveryIndex < recoveryMessages.length; recoveryIndex++) {
                        const recoveryMessage = recoveryMessages[recoveryIndex];
                        await waitWithChatAction('typing', humanTextDelayMs(recoveryMessage, recoveryIndex));
                        if (await findNewerUserMessage()) {
                            return NextResponse.json({ status: 'superseded_during_media_recovery' });
                        }
                        await sendTelegramMessage(botToken, chatId, recoveryMessage);
                        await supabase.from('messages').insert({
                            session_id: session.id,
                            sender: 'bot',
                            content: recoveryMessage,
                        });
                    }
                    return NextResponse.json({ success: false, mediaError: true });
                }

                await supabase.from('messages').insert({
                    session_id: session.id,
                    sender: 'system',
                    content: `[MÍDIA RECUPERADA] ${deliveryErrors[0].slice(0, 900)} | fallback: ${deliveredType}:${deliveredUrl}`
                });
            }

            await supabase.from('messages').insert({
                session_id: session.id,
                sender: 'bot',
                content: `[MÍDIA: ${aiResponse.action}]`,
                media_url: deliveredUrl,
                media_type: deliveredType
            });
            await persistMediaDeliveryStatus(deliveryRecovered ? 'recovered' : 'delivered', {
                mediaType: deliveredType,
                mediaUrl: deliveredUrl,
            });
            await sendDeferredMediaReaction();
        } else if (isMediaDeliveryTurn) {
            await persistMediaDeliveryStatus('failed');
            await upsertMissingPreviewRequest({
                description: requestedPreviewSpec.description,
                tags: requestedPreviewSpec.tags,
                examplePhrase: requestedPreviewSpec.examplePhrase,
                sessionId: session.id,
            });
            const noAssetMessage = 'essa eu ainda nao tenho exatamente desse jeito, vou guardar a ideia';
            await waitWithChatAction('typing', humanTextDelayMs(noAssetMessage, 0));
            if (await findNewerUserMessage()) {
                return NextResponse.json({ status: 'superseded_during_media_recovery' });
            }
            await sendTelegramMessage(botToken, chatId, noAssetMessage);
            await supabase.from('messages').insert({
                session_id: session.id,
                sender: 'bot',
                content: noAssetMessage,
            });
        }
    }

    return NextResponse.json({
        success: true,
        debug_stats: aiResponse.lead_stats,
        debug_funnel: nextStep
    });
    } finally {
        await releaseProcessingLease();
    }
}
