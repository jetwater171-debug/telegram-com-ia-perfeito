import { NextRequest, NextResponse } from 'next/server';
import { extractAiMessageText, normalizeAiMessageList } from '@/lib/aiMessageNormalization';
import { errorMessage, insertMessageWithAiDebug, withAiDebugMessageIndex } from '@/lib/aiDebug';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { sendMessageToGemini } from '@/lib/gemini';
import { sendTelegramMessage, sendTelegramPhoto, sendTelegramVideo, sendTelegramAction, sendTelegramCopyableCode, sendTelegramVoice, type TelegramMediaProtection } from '@/lib/telegram';
import { createPaymentMultiGateway, getPaymentStatusMultiGateway } from '@/lib/paymentGatewayService';
import { reconcilePaymentMessage, reconcilePendingPayments } from '@/lib/paymentReconciliation';
import { calculateLeadScore, markLeadPaid, parseLeadScore, toStoredLeadScore } from '@/lib/leadScoring';
import { shapeConversationBubbles } from '@/lib/conversationBubbles';
import { findLatestConversationStartAt } from '@/lib/conversationEpisode';
import {
    filterMalformedConversationMessages,
    isLikelyIncompleteLeadMessage,
    isLowSignalLeadReaction,
} from '@/lib/conversationTurn';
import {
    buildConversationRecoveryMessages,
    buildProcessingFailureRecoveryMessages,
    detectConversationLanguage,
    enforceLatestIntentMessages,
    filterConversationConsistencyMessages,
    refineNewRelationshipMessages,
} from '@/lib/conversationQuality';
import {
    mergeLeadMemoryPatch,
    mergeUniqueLeadMemoryValues as mergeUnique,
    normalizeLeadMemory,
} from '@/lib/leadMemory';
import {
    buildElevenLabsUnavailableReply,
    buildElevenV3Performance,
    cleanTextForElevenLabsSpeech,
    DEFAULT_ELEVENLABS_SETTINGS,
    ELEVENLABS_CONVERSION_AUDIO_MAX_CHARS,
    ELEVENLABS_REQUESTED_AUDIO_MAX_CHARS,
    generateElevenLabsAudio,
    isElevenLabsConversionMoment,
    isElevenLabsDeliveryPromise,
    isUnsafeForElevenLabsVoice,
    normalizeElevenLabsSettings,
    shouldUseElevenLabsAudio,
    userAskedForElevenLabsAudio,
} from '@/lib/elevenLabs';
import { prepareElevenLabsScript } from '@/lib/elevenLabsScriptAgent';
import {
    buildLeadVoicePolicy,
    estimateElevenLabsCredits,
    getElevenLabsSubscriptionForBudget,
    normalizeElevenLabsBudgetConfig,
    releaseElevenLabsBudget,
    reserveElevenLabsBudget,
    settleElevenLabsBudget,
} from '@/lib/elevenLabsBudget';
import { normalizeBaiModelName } from '@/lib/aiModels';
import { scorePreviewForContext, upsertMissingPreviewRequest } from '@/lib/previewCatalog';
import { analyzeMissingPhotoRequest, classifyRequestedMediaLocally } from '@/lib/previewRequestAnalyzer';
import { buildDeliveredPreviewCaption, isPhotoTakenNow, rankPreviewCandidatesByMoment } from '@/lib/previewMoment';
import {
    filterUnsentPreviewAssets,
    normalizePreviewMediaKey as normalizeMediaUrlKey,
    shouldDeliverRequestedMedia,
} from '@/lib/previewDeliveryPolicy';
import {
    buildSalesOrderSnapshot,
    canonicalizeSalesOfferMessages,
    evaluateSalesTiming,
    extractExplicitBudget,
    guardPrematureSaleMessages,
    readActiveSalesOrder,
    type ActiveSalesOrder,
} from '@/lib/salesTiming';
import {
    addMem0LeadTurn,
    formatMem0LeadMemoryContext,
    mem0LeadUserId,
    normalizeMem0LeadMemorySettings,
    searchMem0LeadMemories,
} from '@/lib/mem0LeadMemory';
import { formatBrainRuntimeContext, loadBrainRuntimeState } from '@/lib/brain/stateBuilder';
import {
    appendLeadEventSafe,
    markAdultDeclarationSafe,
    markAdultVerificationSafe,
    patchRealityStateSafe,
    persistBrainProjectionsSafe,
    persistMemoryUpdatesSafe,
    recordAiDecisionSafe,
} from '@/lib/brain/eventStore';
import { detectAdultDeclaration, validateMasterBrainResponse } from '@/lib/brain/hardValidator';
import { applyPreviewBanditRanking, recordPreviewPurchaseSafe, recordPreviewReactionSafe, recordPreviewSentSafe } from '@/lib/brain/previewBandit';
import { trackLeadResponseOutcomesSafe, trackPaymentOutcomeSafe } from '@/lib/brain/outcomeTracker';
import { markCustomOrderPaidSafe, markSessionSalesOrderPaidSafe, recordCustomOrderSafe } from '@/lib/customOrders';

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

const normalizeTelegramImageMimeType = (contentType: string | null, filePath: string) => {
    const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
    if (normalized.startsWith('image/')) return normalized;

    const extension = String(filePath || '').split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    const mimeByExtension: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        gif: 'image/gif',
    };
    return (extension && mimeByExtension[extension]) || 'image/jpeg';
};

const randomBetween = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));

const stablePercent = (value: string) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 100;
};

const humanTextDelayMs = (text: string, bubbleIndex: number) => {
    const raw = String(text || '').trim();
    const length = raw.length;
    const wordCount = raw.split(/\s+/).filter(Boolean).length;

    // Digitação ágil e natural no celular, sem disparar todos os balões juntos.
    const typingTimeMs = (length * 22) + (wordCount * 45) + randomBetween(120, 320);

    if (bubbleIndex === 0) {
        // Primeiro balão: a chamada de IA já funciona como a pausa de leitura.
        // Digitação rápida para responder quase de imediato.
        return Math.min(1_900, Math.max(350, typingTimeMs));
    }

    // Balões seguintes: intervalo curto e natural entre mensagens digitadas em sequência
    const gapBetweenBubblesMs = randomBetween(650, 1_100);
    const total = gapBetweenBubblesMs + typingTimeMs;
    return Math.min(3_200, Math.max(950, total));
};

const humanAudioRecordingDelayMs = (text: string) => {
    const raw = String(text || '').trim();
    const wordCount = raw.split(/\s+/).filter(Boolean).length;
    // Tempo de gravação de áudio ágil e realista
    const recordingTimeMs = 1_000 + (wordCount * 180) + randomBetween(200, 500);
    return Math.min(5_500, Math.max(1_200, recordingTimeMs));
};

const detectCityFromText = (input: string): string | null => {
    const match = input.match(/\b(?:sou|moro)\s+(?:de|do|da|em)\s+([\p{L}\s]{2,40})/iu);
    if (!match) return null;
    let city = match[1].trim();
    city = city.replace(/[\n\r\.\!\?].*$/, '').trim();

    const parts = city.split(/\s+/).slice(0, 3);
    return parts.join(' ');
};

const detectDeviceFromUserAgent = (userAgent: unknown) => {
    const ua = String(userAgent || '').toLowerCase();
    if (/iphone|ipad|ios/.test(ua)) return 'iPhone';
    if (/android/.test(ua)) return 'Android';
    if (/windows|macintosh|linux/.test(ua)) return 'Desktop';
    return 'Unknown';
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
    if (/(encontro presencial|marcar (?:um )?encontro|marcar (?:de )?sair|vamos sair|sair comigo|te encontrar|me encontra|a gente se encontr(?:ar|ando)|vem aqui|vem me ver|te busco|vou te buscar|me busca)/i.test(t)) wanted.push('encontro');
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

const sanitizeOutgoingMessage = (text: unknown, currentUserText = '') => {
    let out = extractAiMessageText(text);
    out = out.replace(/\beu\s+sou\s+a\s+lari\b/gi, 'eu sou lari');
    out = out.replace(/\beu\s+sou\s+a\s+larissa\b/gi, 'eu sou larissa');
    out = out.replace(/\bsou\s+a\s+lari\b/gi, 'sou lari');
    out = out.replace(/\bsou\s+a\s+larissa\b/gi, 'sou larissa');
    out = out.replace(/\bme\s+chamo\s+a\s+lari\b/gi, 'me chamo lari');
    out = out.replace(/\bme\s+chamo\s+a\s+larissa\b/gi, 'me chamo larissa');
    out = out.replace(/\bsou\s+eu\b/gi, 'sou lari');
    out = out.replace(/\beu\s+sou\s+eu\b/gi, 'eu sou lari');
    // A Lari responde da própria perspectiva; ela não copia o papel do lead.
    out = out.replace(/\b(?:eu\s+)?quero\s+te\s+comer\b/gi, 'quero dar pra vc');
    out = out.replace(/\b(?:eu\s+)?quero\s+comer\s+(?:vc|voce|você)\b/gi, 'quero dar pra vc');
    out = out.replace(/\b(?:eu\s+)?vou\s+te\s+comer\b/gi, 'vou dar pra vc');
    out = out.replace(/\b(?:eu\s+)?vou\s+comer\s+(?:vc|voce|você)\b/gi, 'vou dar pra vc');
    out = out.replace(/\b(?:eu\s+)?te\s+comeria\b/gi, 'eu daria pra vc');
    out = out.replace(/\bimagina\s+eu\s+te\s+comendo\b/gi, 'imagina eu dando pra vc');
    out = out.replace(/\bamoro\b/gi, 'amor o');
    out = out.replace(/\b(?:dar\s+)?(?:um\s+)?abra[cç]o\s+virtual\b/gi, 'te dar um abraço bem gostoso');
    out = out.replace(/\b(?:dar\s+)?(?:um\s+)?beijo\s+virtual\b/gi, 'te dar um beijinho bem gostoso');
    out = out.replace(/\b(?:um\s+)?carinho\s+virtual\b/gi, 'um carinho bem gostoso');
    out = out.replace(/\b(?:apoio|presen[cç]a|mundo)\s+virtual\b/gi, 'meu carinho');
    out = out.replace(/([a-záéíóúâêôãõç])((?:kkk|rsrs)+)\b/gi, '$1 $2');
    // A interface da Lari é texto puro: sem emojis nem suspense por reticências.
    out = out.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, '');
    out = out.replace(/(?:\.{3,}|…+)/gu, '');
    const mirroredContigo = out.match(/^\s*quero\s+(.+?)\s+contigo\s*[?!.]*\s*$/i);
    if (mirroredContigo && /^\s*quero\s+.+?\s+contigo\s*[?!.]*\s*$/i.test(String(currentUserText || ''))) {
        out = `quer ${mirroredContigo[1].trim()} comigo?`;
    }
    out = out.replace(/\s+/g, ' ');
    out = out.replace(/\s+([,.!?])/g, '$1').trim();
    out = fixGluedWords(out);
    return out;
};

const userAskedToRepeatMedia = (text: string) => /\b(de novo|outra vez|reenviar|reenvia|envia de novo|manda de novo|a mesma foto|o mesmo video|o mesmo vídeo)\b/i.test(text || '');

const isMediaSetupPromise = (message: string) => /\b(vou te mandar|vou mandar|vou separar|vou escolher|separei pra vc|tirei uma foto|fotinha pra vc|videozinho pra vc)\b/i.test(message || '');

const shouldProtectAdultPreview = (asset: any) => {
    if (!asset || typeof asset !== 'object') return false;
    const tags = Array.isArray(asset.tags) ? asset.tags : [];
    const analysis = asset.ai_analysis && typeof asset.ai_analysis === 'object'
        ? asset.ai_analysis
        : {};
    const explicitness = String(analysis.explicitness || '').toLowerCase();
    const searchable = [
        asset.name,
        asset.description,
        asset.triggers,
        ...tags,
        analysis.visual_summary,
        analysis.outfit,
        analysis.body_focus,
    ]
        .flat(Infinity)
        .map((value) => String(value || ''))
        .join(' ')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
    const manuallyProtected = tags.some((tag: unknown) =>
        /^(visualizacao-unica|view-once|protegida|protegido)$/i.test(String(tag || '').trim())
    );
    const nudeOrCoveredNude = /\b(nua|nuas|nude|nudes|pelada|peladas|sem roupa|sem roupas|sem calcinha|sem sutia|sem sutiã|tampando|cobrindo|cobre os peitos|cobre a buceta)\b/i.test(searchable);
    return manuallyProtected || explicitness === 'nude' || nudeOrCoveredNude;
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
        /sou uma inteligência artificial/i,
        /sou um robô/i,
        /assistente virtual/i,
        /abraço virtual/i,
        /abraco virtual/i,
        /beijo virtual/i,
        /carinho virtual/i,
        /apoio virtual/i,
        /mundo virtual/i,
        /apoio emocional/i,
        /ajuda psicológica/i,
        /nao posso/i,
        /não posso/i,
        /como assistente/i,
        /estou aqui para/i,
        /vou pedir pra gravarem/i,
        /vou pedir para gravarem/i,
        /vou pedir pra equipe/i,
        /vou pedir para equipe/i,
        /vou guardar a ideia/i,
        /vou guardar essa ideia/i,
        /ainda nao tenho gravado/i,
        /ainda não tenho gravado/i,
        /ainda nao tenho exatamente/i,
        /ainda não tenho exatamente/i,
        /nao tenho gravado/i,
        /não tenho gravado/i,
        /nao tenho foto/i,
        /não tenho foto/i,
        /\b(?:ainda\s+)?n[aã]o\s+tenho\b/i,
        /\bn[aã]o\s+(?:achei|encontrei)\s+(?:uma|essa|nenhuma)?\s*(?:foto|previa|prévia|imagem|video|vídeo)?\b/i,
    ];
    return messages.filter((msg) => !blocked.some((pattern) => pattern.test(msg)));
};

const isPrematureMediaReaction = (message: string) => {
    const text = normalizeLoopText(message);
    return /\b(o que achou|oq achou|me fala o que achou|gostou|curtiu|achou gostosa|achou bonita)\b/i.test(text)
        || /\b(ta aqui|tá aqui|te mandei|acabei de mandar|ja mandei|já mandei|vai aí|vai ai|olha aí|olha ai)\b/i.test(text)
        || /\b(?:olha|ve|vê|confere|toma)\b.{0,45}\b(?:essa|esse|foto|fotinha|imagem|previa|prévia|video|vídeo|pedacinho)\b/i.test(text)
        || /\b(?:tirei|separei|escolhi|mandei)\b.{0,45}\b(?:essa|uma|foto|fotinha|imagem|previa|prévia|video|vídeo|pedacinho)\b/i.test(text)
        || /\b(?:que tal|se liga|dá uma olhada|da uma olhada)\b.{0,35}\b(?:nesse|nessa|esse|essa|pedacinho|foto|previa|prévia)\b/i.test(text)
        || /\b(?:vou te mandar|to te mandando|tô te mandando|vou mandar|mandando agora)\b/i.test(text)
        || isMediaSetupPromise(message);
};

const isMediaAnnouncement = (message: string) => {
    const text = normalizeLoopText(message);
    return isPrematureMediaReaction(message)
        || /\b(?:foto|fotinha|fotos|imagem|imagens|selfie|previa|prévia|video|vídeo|nude|nudes|pedacinho)\b/i.test(text);
};

const buildNaturalMediaSetup = (userText: string, action?: string, suggested?: string) => {
    const safeSuggestion = String(suggested || '').trim();
    if (safeSuggestion && !isMediaAnnouncement(safeSuggestion)) return safeSuggestion;

    if (/video/i.test(String(action || '')) || /\bvideo|vídeo\b/i.test(userText)) {
        return 'vc falando assim me deixa ainda mais provocada';
    }
    if (/\b(leite|condensado|doce|lambuzad)\b/i.test(userText)) {
        return 'essa ideia foi bem especifica kkk mexeu comigo demais';
    }
    if (/\b(bunda|de 4|de quatro|costas|por tras|por trás)\b/i.test(userText)) {
        return 'so de imaginar essa cena eu ja fico toda arrepiada';
    }
    return 'vc falando assim me deixa toda arrepiada';
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

const removeUserEchoMessages = (messages: string[], userText: string) => {
    const normUser = normalizeLoopText(userText);
    if (!normUser || normUser.length < 3) return messages;
    return messages.filter((msg) => {
        const normMsg = normalizeLoopText(msg);
        return normMsg !== normUser && !normUser.includes(normMsg);
    });
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
    out = removeUserEchoMessages(out, opts.userText);
    out = removeGenericBotPhrases(out);
    out = removePrematureNameIntro(out, opts.userText, opts.extractedName);
    out = removeAnsweredNameQuestions(out, opts.userText, opts.sessionName);
    out = removeAnsweredCityQuestions(out, opts.hasCity, opts.userAskedCity);
    out = reduceOpeningRepetition(out, opts.lastBotContent);
    out = removeDuplicateNormalizedMessages(out);
    return out;
};

const extractPrices = (text: string) => {
    if (!text) return [];
    const matches = text.match(/\b\d{1,3}[.,]\d{2}\b/g) || [];
    return matches.map(m => Number(m.replace(',', '.'))).filter(n => !Number.isNaN(n));
};

const extractNegotiatedUserValue = (text: string) => {
    return extractExplicitBudget(text);
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
    send_voice_reply: 'CONNECTION',
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
    const askedForMedia = /\b(foto|fotinha|fotos|selfie|selfies|nude|nudes|previa|prévia|video|vídeo)\b/i.test(t)
        || /\b(manda|mostra|envia|quero ver|deixa ver|solta)\b.*\b(foto|fotinha|fotos|selfie|selfies|nude|nudes|pelada|nua|sem roupa|previa|prévia|video|vídeo|uma)\b/i.test(t)
        || /\b(quero te ver|qualquer foto|manda qualquer|me mostra vc|me mostra você)\b/i.test(t);
    if (!askedForMedia) return null;
    if (action === 'send_custom_preview') return null;

    if (/(de 4|quatro|costas|bunda|rab[ao]|empinad|por tras|por trás)/i.test(t)) {
        return {
            action: 'send_ass_photo_preview',
            intro: 'olha essa fotinha amor'
        };
    }
    if (/(banho|molhad|chuveiro|toalha)/i.test(t)) {
        return {
            action: 'send_shower_photo',
            intro: 'olha essa do banho amor'
        };
    }
    if (/(lingerie|calcinha|conjunto|cama|deitada)/i.test(t)) {
        return {
            action: 'send_lingerie_photo',
            intro: 'olha essa de lingerie amor'
        };
    }
    if (/(video|vídeo|rebol|movimento|dan[cç]ando)/i.test(t)) {
        return {
            action: action === 'send_hot_video_preview' ? 'send_hot_video_preview' : 'send_video_preview',
            intro: 'olha esse videozinho amor'
        };
    }
    return {
        action: 'send_shower_photo',
        intro: 'olha essa fotinha que separei pra vc amor'
    };
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
    if (/(leite|condensado|doce|lambuzada|food)/i.test(normalized)) add('leite condensado', 'food play');
    if (/(video|vídeo|rebol|dan[cç]|movimento)/i.test(normalized) || /video/i.test(String(action || ''))) add('video');
    if (tags.size === 0) add(/video/i.test(String(action || '')) ? 'video' : 'foto');
    return {
        description: text ? `Larissa atendendo ao pedido: "${text.slice(0, 260)}"` : `Larissa em previa ${Array.from(tags).join(', ')}`,
        tags: Array.from(tags),
        examplePhrase: text.slice(0, 300),
    };
};

const registerMissingPhotoRequest = async (input: {
    userText: string;
    description?: string;
    tags?: string[];
    action?: string;
    photoHint?: boolean;
    sessionId: string;
}) => {
    const analysis = await analyzeMissingPhotoRequest({
        requestText: input.userText,
        description: input.description,
        tags: input.tags,
        action: input.action,
        photoHint: input.photoHint,
    });
    if (analysis.media_kind !== 'photo') {
        console.log('[PREVIAS] Pedido fora da fila de fotos:', analysis.media_kind);
        return null;
    }
    return upsertMissingPreviewRequest({
        description: analysis.title,
        tags: analysis.tags,
        examplePhrase: input.userText,
        sessionId: input.sessionId,
        canonicalKey: analysis.canonical_key,
        adminBrief: analysis.production_brief,
        analysis,
        mediaType: 'photo',
    });
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
const normalizeLoopText = (text: unknown) => {
    return extractAiMessageText(text)
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
                'elevenlabs_api_key',
                'elevenlabs_enabled',
                'elevenlabs_voice_id',
                'elevenlabs_model',
                'elevenlabs_frequency_percent',
                'elevenlabs_cooldown_minutes',
                'elevenlabs_max_chars',
                'elevenlabs_budget_enabled',
                'elevenlabs_budget_reserve_percent',
                'elevenlabs_budget_acquisition_percent',
                'elevenlabs_budget_revenue_share_percent',
                'elevenlabs_budget_credits_per_brl',
                'elevenlabs_budget_free_lead_credits',
                'elevenlabs_budget_unpaid_max_chars',
                'elevenlabs_budget_buyer_max_chars',
                'elevenlabs_budget_fallback_credits',
                'elevenlabs_budget_cycle_key',
                'mem0_api_key',
                'mem0_enabled',
                'mem0_top_k',
                'bai_api_key',
                'bai_model',
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
    const baseElevenLabsSettings = normalizeElevenLabsSettings({
        apiKey: botConfig.elevenlabs_api_key || process.env.ELEVENLABS_API_KEY || '',
        enabled: (botConfig.elevenlabs_enabled || process.env.ELEVENLABS_ENABLED) === 'true',
        voiceId: botConfig.elevenlabs_voice_id || process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_SETTINGS.voiceId,
        model: botConfig.elevenlabs_model || process.env.ELEVENLABS_MODEL || DEFAULT_ELEVENLABS_SETTINGS.model,
        frequencyPercent: Number(botConfig.elevenlabs_frequency_percent || process.env.ELEVENLABS_FREQUENCY_PERCENT || DEFAULT_ELEVENLABS_SETTINGS.frequencyPercent),
        cooldownMinutes: Number(botConfig.elevenlabs_cooldown_minutes || process.env.ELEVENLABS_COOLDOWN_MINUTES || DEFAULT_ELEVENLABS_SETTINGS.cooldownMinutes),
        maxChars: Number(botConfig.elevenlabs_max_chars || process.env.ELEVENLABS_MAX_CHARS || DEFAULT_ELEVENLABS_SETTINGS.maxChars),
    });
    const elevenLabsBudgetConfig = normalizeElevenLabsBudgetConfig({
        enabled: (botConfig.elevenlabs_budget_enabled || process.env.ELEVENLABS_BUDGET_ENABLED) !== 'false',
        reservePercent: Number(botConfig.elevenlabs_budget_reserve_percent || process.env.ELEVENLABS_BUDGET_RESERVE_PERCENT),
        acquisitionPercent: Number(botConfig.elevenlabs_budget_acquisition_percent || process.env.ELEVENLABS_BUDGET_ACQUISITION_PERCENT),
        revenueSharePercent: Number(botConfig.elevenlabs_budget_revenue_share_percent || process.env.ELEVENLABS_BUDGET_REVENUE_SHARE_PERCENT),
        creditsPerBrl: Number(botConfig.elevenlabs_budget_credits_per_brl || process.env.ELEVENLABS_BUDGET_CREDITS_PER_BRL),
        freeLeadCredits: Number(botConfig.elevenlabs_budget_free_lead_credits || process.env.ELEVENLABS_BUDGET_FREE_LEAD_CREDITS),
        unpaidMaxChars: Number(botConfig.elevenlabs_budget_unpaid_max_chars || process.env.ELEVENLABS_BUDGET_UNPAID_MAX_CHARS),
        buyerMaxChars: Number(botConfig.elevenlabs_budget_buyer_max_chars || process.env.ELEVENLABS_BUDGET_BUYER_MAX_CHARS),
    });
    const leadVoicePolicy = buildLeadVoicePolicy({
        totalPaid: Number(session.total_paid || 0),
        configuredFrequencyPercent: baseElevenLabsSettings.frequencyPercent,
        configuredCooldownMinutes: baseElevenLabsSettings.cooldownMinutes,
        configuredMaxChars: baseElevenLabsSettings.maxChars,
        config: elevenLabsBudgetConfig,
    });
    const elevenLabsSettings = {
        ...baseElevenLabsSettings,
        frequencyPercent: leadVoicePolicy.frequencyPercent,
        cooldownMinutes: leadVoicePolicy.cooldownMinutes,
        maxChars: leadVoicePolicy.maxChars,
    };
    const mem0Settings = normalizeMem0LeadMemorySettings({
        apiKey: botConfig.mem0_api_key || process.env.MEM0_API_KEY || '',
        enabled: botConfig.mem0_enabled === 'true',
        topK: Number(botConfig.mem0_top_k || 8),
    });
    const mem0UserId = mem0LeadUserId(chatId);
    const elevenLabsScriptAgentSettings = {
        apiKey: botConfig.bai_api_key || process.env.BAI_API_KEY || '',
        model: normalizeBaiModelName(botConfig.bai_model || process.env.BAI_MODEL),
        baseUrl: process.env.BAI_BASE_URL || 'https://api.b.ai/v1',
        timeoutMs: 8_000,
    };

    const waitWithChatAction = async (
        action: Parameters<typeof sendTelegramAction>[2],
        durationMs: number,
    ) => {
        await sendTelegramAction(botToken, chatId, action);
        const heartbeat = durationMs > 3_000
            ? setInterval(() => {
                void sendTelegramAction(botToken, chatId, action);
            }, 3_000)
            : null;
        try {
            await new Promise((resolve) => setTimeout(resolve, durationMs));
        } finally {
            if (heartbeat) clearInterval(heartbeat);
        }
    };

    // Mensagens normais recebem 1.8s; uma frase claramente interrompida ganha
    // uma janela maior para o lead terminá-la antes de qualquer IA responder.
    // Se o lead mandar mais uma mensagem enquanto espera, este worker aborta e passa o bastão para a mais nova.
    const DEBOUNCE_WAIT_MS = 1800;
    const INCOMPLETE_TURN_WAIT_MS = 4200;
    const pollIntervalMs = 300;
    let waited = 0;
    let debounceWaitMs = DEBOUNCE_WAIT_MS;

    while (waited < debounceWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        waited += pollIntervalMs;

        const { data: latestMsgCheck } = await supabase
            .from('messages')
            .select('id,content')
            .eq('session_id', sessionId)
            .eq('sender', 'user')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (latestMsgCheck && triggerMessageId) {
            const latestIdStr = String(latestMsgCheck.id);
            const triggerIdStr = String(triggerMessageId);

            if (latestIdStr === triggerIdStr && isLikelyIncompleteLeadMessage(latestMsgCheck.content)) {
                debounceWaitMs = INCOMPLETE_TURN_WAIT_MS;
            }

            if (latestIdStr !== triggerIdStr) {
                console.log(`[PROCESSADOR] Debounce: lead enviou mensagem mais nova (${latestIdStr}). Abortando worker ${triggerIdStr}.`);
                return NextResponse.json({ status: 'superseded_during_debounce' });
            }
        }
    }

    // Uma conversa por vez. Leads diferentes continuam processando em paralelo,
    // mas dois workers da mesma sessão nunca geram resposta/pagamento duplicado.
    const workerToken = `${Date.now()}:${crypto.randomUUID()}`;
    let leaseMode: 'full' | 'token_only' = 'full';
    let leaseClaimed = false;
    const releaseProcessingLease = async () => {
        if (!leaseClaimed) return;
        const releasePatch = leaseMode === 'full'
            ? { processing_token: null, processing_started_at: null }
            : { processing_token: null };
        await supabase
            .from('sessions')
            .update(releasePatch)
            .eq('id', sessionId)
            .eq('processing_token', workerToken);
        leaseClaimed = false;
    };
    const tryClaimTokenOnlyLease = async () => {
        const { data, error } = await supabase
            .from('sessions')
            .update({ processing_token: workerToken })
            .eq('id', sessionId)
            .is('processing_token', null)
            .select('id');

        if (error) throw error;
        if (data?.length) {
            leaseClaimed = true;
            return true;
        }

        // O token inclui o instante em que foi criado. Se uma funcao serverless
        // morrer sem executar o finally, outro worker pode recuperar a sessao
        // depois do TTL sem permitir duas respostas simultaneas.
        const { data: occupiedSession, error: readError } = await supabase
            .from('sessions')
            .select('processing_token')
            .eq('id', sessionId)
            .single();
        if (readError) throw readError;

        const occupiedToken = String(occupiedSession?.processing_token || '');
        const occupiedSince = Number(occupiedToken.split(':', 1)[0]);
        const isExpired = Number.isFinite(occupiedSince)
            && occupiedSince > 0
            && Date.now() - occupiedSince >= PROCESSING_LEASE_TTL_MS;
        if (!occupiedToken || !isExpired) return false;

        const { data: recovered, error: recoveryError } = await supabase
            .from('sessions')
            .update({ processing_token: workerToken })
            .eq('id', sessionId)
            .eq('processing_token', occupiedToken)
            .select('id');
        if (recoveryError) throw recoveryError;
        leaseClaimed = Boolean(recovered?.length);
        return leaseClaimed;
    };
    const tryClaimProcessingLease = async () => {
        if (leaseMode === 'token_only') return tryClaimTokenOnlyLease();

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
                console.warn('[PROCESSADOR] Lease completo indisponivel; ativando trava atomica por processing_token.');
                leaseMode = 'token_only';
                return tryClaimTokenOnlyLease();
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

    const processingAttemptStartedAt = new Date().toISOString();

    try {
        // O worker pode ter esperado outro turno terminar. Confere novamente se
        // ainda representa a mensagem mais nova antes de gastar uma chamada de IA.
        if (triggerMessageId) {
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

        // Concilia o PIX pendente antes de montar o contexto. Assim a próxima
        // mensagem do lead já enxerga o LTV correto mesmo quando o gateway não
        // chamou o webhook.
        try {
            const paymentSync = await reconcilePendingPayments({
                sessionId,
                limit: 3,
                minCheckIntervalMs: 15_000,
                notify: true,
            });
            if (Number.isFinite(paymentSync.latestSessionTotal)) {
                session.total_paid = Number(paymentSync.latestSessionTotal);
            }
        } catch (paymentSyncError: any) {
            console.warn('[PROCESSADOR] Conciliação de pagamento adiada:', paymentSyncError?.message || paymentSyncError);
        }

    // Se chegamos aqui, DEVEMOS manter o status digitando ativo se o processamento demorar?
    // Digitando no Telegram dura ~5s. Pode ter expirado ou estar perto. 
    // Vamos enviar de novo só por segurança/frescor para o atraso real de geração.
    await sendTelegramAction(botToken, chatId, 'typing');

    // 5. Contexto e Lógica


    // Identificar contexto e a ultima oferta em paralelo.
    const [lastBotResult, lastOfferResult, recentSalesHistoryResult] = await Promise.all([
        supabase
            .from('messages')
            .select('created_at, content, media_url, media_type')
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
        supabase
            .from('messages')
            .select('sender,content,created_at,media_url,media_type')
            .eq('session_id', sessionId)
            .in('sender', ['user', 'bot'])
            .order('created_at', { ascending: false })
            .limit(40),
    ]);
    const lastBotMsg = lastBotResult.data;
    const lastOfferMsg = lastOfferResult.data;
    const recentSalesHistory = recentSalesHistoryResult.data || [];

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

    const groupedUserMessages = filteredGroupMessages.filter((m: any) => m.sender === 'user');
    const combinedText = filteredGroupMessages.map((m: any) => m.content).join("\n");
    const userOnlyText = groupedUserMessages.map((m: any) => m.content).join("\n");
    const latestUserText = String(groupedUserMessages.at(-1)?.content || userOnlyText).trim();
    const lastGroupedUserAt = filteredGroupMessages
        .filter((m: any) => m.sender === 'user' && m.created_at)
        .map((m: any) => String(m.created_at))
        .sort()
        .at(-1) || new Date().toISOString();
    const adultDeclaredNow = detectAdultDeclaration(userOnlyText);
    const leadMessageEventId = await appendLeadEventSafe({
        sessionId: String(session.id),
        eventType: 'lead_message',
        source: 'telegram',
        sourceId: triggerMessageId ? String(triggerMessageId) : String(lastGroupedUserAt || crypto.randomUUID()),
        payload: {
            content: userOnlyText.slice(0, 4_000),
            latest_content: latestUserText.slice(0, 2_000),
            grouped_message_count: groupedUserMessages.length,
            adult_declaration: adultDeclaredNow,
        },
        occurredAt: lastGroupedUserAt,
    });
    if (adultDeclaredNow) {
        await Promise.all([
            markAdultDeclarationSafe(String(session.id), lastGroupedUserAt),
            appendLeadEventSafe({
                sessionId: String(session.id),
                eventType: 'adult_declared',
                source: 'lead',
                sourceId: triggerMessageId ? `adult:${triggerMessageId}` : `adult:${lastGroupedUserAt}`,
                payload: { method: 'self_declared_telegram' },
                occurredAt: lastGroupedUserAt,
            }),
        ]);
    }
    // "kkkk" isolado é só reação à última fala. Não volta para a IA, pois ela
    // pode ressuscitar uma pergunta antiga e produzir texto sem sentido.
    if (groupedUserMessages.length === 1 && isLowSignalLeadReaction(userOnlyText)) {
        console.log('[PROCESSADOR] Reação curta isolada; aguardando próximo turno do lead.');
        return NextResponse.json({ status: 'low_signal_ignored' });
    }
    if (groupedUserMessages.length === 1 && isLikelyIncompleteLeadMessage(userOnlyText)) {
        console.log('[PROCESSADOR] Frase interrompida sem complemento; aguardando continuação do lead.');
        return NextResponse.json({ status: 'incomplete_turn_waiting' });
    }
    // O aprendizado do turno anterior roda em paralelo com a chamada principal.
    // Assim ele melhora a política sem acrescentar latência perceptível ao lead.
    const responseOutcomePromise = trackLeadResponseOutcomesSafe({
        sessionId: String(session.id),
        eventId: leadMessageEventId,
        userText: userOnlyText,
        occurredAt: lastGroupedUserAt,
    });
    const conversationStartAt = findLatestConversationStartAt(filteredGroupMessages);
    const receivedStartCommand = Boolean(conversationStartAt);
    // /start é só um comando técnico. Ele representa primeiro contato apenas
    // quando a sessão nunca recebeu uma resposta anterior da Lari.
    const isConversationStart = receivedStartCommand && !lastBotMsg;
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
    let leadMemory = normalizeLeadMemory(session.lead_memory);
    const missingAttribution = !leadMemory.metadata?.redirect_timezone
        || !leadMemory.metadata?.redirect_user_agent
        || !leadMemory.metadata?.redirect_country;
    if (missingAttribution) {
        const { data: redirectRow } = await supabase
            .from('lead_redirects')
            .select('code,ip,user_agent,referer,country,region,city,timezone,source_url,utm,metadata,clicked_at,created_at')
            .or(`session_id.eq.${session.id},telegram_chat_id.eq.${chatId}`)
            .order('clicked_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (redirectRow) {
            leadMemory = {
                ...leadMemory,
                metadata: {
                    ...(leadMemory.metadata || {}),
                    redirect_code: redirectRow.code || leadMemory.metadata?.redirect_code || '',
                    redirect_ip: redirectRow.ip || leadMemory.metadata?.redirect_ip || '',
                    redirect_utm: redirectRow.utm || leadMemory.metadata?.redirect_utm || {},
                    redirect_query_params: redirectRow.metadata?.query_params || leadMemory.metadata?.redirect_query_params || {},
                    redirect_source_url: redirectRow.source_url || leadMemory.metadata?.redirect_source_url || '',
                    redirect_referer: redirectRow.referer || leadMemory.metadata?.redirect_referer || '',
                    redirect_clicked_at: redirectRow.clicked_at || redirectRow.created_at || leadMemory.metadata?.redirect_clicked_at || '',
                    redirect_city: redirectRow.city || leadMemory.metadata?.redirect_city || '',
                    redirect_region: redirectRow.region || leadMemory.metadata?.redirect_region || '',
                    redirect_country: redirectRow.country || leadMemory.metadata?.redirect_country || '',
                    redirect_timezone: redirectRow.timezone || leadMemory.metadata?.redirect_timezone || '',
                    redirect_accept_language: redirectRow.metadata?.accept_language || leadMemory.metadata?.redirect_accept_language || '',
                    redirect_user_agent: redirectRow.user_agent || leadMemory.metadata?.redirect_user_agent || '',
                    adult_verified: true,
                    adult_verification_source: 'presell_redirect',
                    adult_verified_at: redirectRow.clicked_at || redirectRow.created_at || new Date().toISOString(),
                },
                updated_at: new Date().toISOString(),
            };
            const attributionPatch: any = { lead_memory: leadMemory };
            if ((!session.user_city || session.user_city === 'Unknown') && redirectRow.city) {
                attributionPatch.user_city = redirectRow.city;
                session.user_city = redirectRow.city;
            }
            if (!session.device_type || session.device_type === 'Unknown') {
                const detectedDevice = detectDeviceFromUserAgent(redirectRow.user_agent);
                if (detectedDevice !== 'Unknown') {
                    attributionPatch.device_type = detectedDevice;
                    session.device_type = detectedDevice;
                }
            }
            await supabase.from('sessions').update(attributionPatch).eq('id', session.id);
        }
    }
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
    if (isConversationStart) {
        // /start abre uma nova conversa mental sem apagar os fatos privados do lead.
        // O cerebro volta ao estagio inicial e nao reaproveita uma venda/gancho antigo.
        const freshMetadata = { ...(leadMemory.metadata || {}) } as Record<string, unknown>;
        for (const key of [
            'sales_nurture_product', 'sales_nurture_turns', 'sales_nurture_updated_at',
            'sales_checkout_ready', 'sales_offer_seen', 'sales_offer_value', 'sales_offer_tier',
        ]) delete freshMetadata[key];
        leadMemory = {
            ...leadMemory,
            dominant_type: 'desconhecido',
            emotional_context: 'inicio de uma nova conversa',
            relationship_stage: 'new',
            next_personal_step: 'conhecer naturalmente sem presumir intimidade ou retorno',
            conversation_hooks: [],
            last_offer: '',
            metadata: {
                ...freshMetadata,
                conversation_started_at: conversationStartAt || lastGroupedUserAt,
            },
            updated_at: new Date().toISOString(),
        };
    }
    const hasCity = Boolean(userCity);
    const cityQuestion = /(de onde (voce|vc|você) e|vc e de onde|você é de onde|qual (sua|a) cidade|onde (voce|vc|você) mora)/i.test(userOnlyText);
    const salesTiming = evaluateSalesTiming({
        userText: userOnlyText,
        recentMessages: recentSalesHistory,
        leadMemory,
        totalPaid: Number(session.total_paid || 0),
        leadScore: session.lead_score,
        deviceType: session.device_type,
    });
    const offerPlan = salesTiming.offerPlan;
    const adaptiveSalesDirective = [
        '# PLANO COMERCIAL ADAPTATIVO (INTERNO, NUNCA MOSTRE ESTE BLOCO)',
        `- Desejo pago ativo: ${salesTiming.activeProduct || 'ainda nao identificado'}.`,
        `- Aquecimento neste desejo: ${salesTiming.nurtureTurns} turno(s).`,
        `- Pode apresentar preco agora: ${salesTiming.canPitchPrice ? 'sim' : 'nao'}.`,
        `- Pode gerar PIX agora: ${salesTiming.canGeneratePayment ? 'sim' : 'nao; falta aceite ou pedido direto de pagamento'}.`,
        offerPlan
            ? `- Oferta indicada: ${offerPlan.format}, R$ ${offerPlan.value.toFixed(2).replace('.', ',')} (${offerPlan.description}).`
            : '- Ainda nao existe oferta definida; mantenha a conversa natural e deixe desejo/contexto aparecerem sem pergunta de qualificacao.',
        salesTiming.customRequestBrief
            ? `- Briefing do pedido personalizado: ${salesTiming.customRequestBrief}. Preserve este pedido; nao troque por VIP ou outro produto.`
            : '',
        offerPlan?.explicitBudget
            ? `- O lead declarou limite/disposicao de R$ ${offerPlan.explicitBudget.toFixed(2).replace('.', ',')}; nunca ultrapasse esse valor.`
            : '- Nao ha limite financeiro declarado. Nao presuma renda por aparelho, cidade ou localizacao.',
        salesTiming.fixedVipBudgetGap
            ? '- O VIP custa R$ 19,90 e o limite declarado e menor. Nao gere PIX do VIP nem invente desconto; esclareca o valor uma vez e deixe o lead escolher outro produto menor se quiser.'
            : '',
        '- Se o desejo mudar, abandone a oferta anterior e aqueça o novo desejo antes de precificar.',
        '- Venda o resultado que ele pediu; para pouco dinheiro, reduza o escopo do mesmo desejo em vez de empurrar outro produto.',
        '- Este plano pertence apenas ao cerebro. Mesmo em relacao nova, uma intencao comercial literal pode ser atendida imediatamente; sem intencao real, converse normalmente.',
    ].join('\n');
    const verifiedLeadName = sessionHasUsefulName(session.user_name) ? String(session.user_name).trim() : '';
    const identityDirective = verifiedLeadName
        ? `# IDENTIDADE DO LEAD\n- Nome verificado: ${verifiedLeadName}. Nunca chame o lead por outro nome.`
        : '# IDENTIDADE DO LEAD\n- Nome ainda nao confirmado. Nao invente nome nem apelido pessoal.';
    extraScript = [extraScript, adaptiveSalesDirective, identityDirective].filter(Boolean).join('\n\n');

    const brainRuntime = await loadBrainRuntimeState({
        session: { ...session, lead_memory: leadMemory },
        userText: userOnlyText,
        recentMessages: recentSalesHistory,
    });
    // O bot e a etapa posterior do presell. Portanto, uma sessao admitida pelo
    // webhook do Telegram ja cumpriu o gate +18, mesmo quando o Telegram remove
    // ou nao devolve o payload profundo do /start.
    const verifiedByPresell = Boolean(session.telegram_chat_id)
        || Boolean(leadMemory.metadata?.redirect_code)
        || (leadMemory.metadata?.adult_verified === true
            && leadMemory.metadata?.adult_verification_source === 'presell_redirect');
    if (verifiedByPresell && !brainRuntime.reality.adultVerified) {
        brainRuntime.reality.adultVerified = true;
        const verifiedAt = String(leadMemory.metadata?.adult_verified_at || lastGroupedUserAt);
        await Promise.all([
            markAdultVerificationSafe(String(session.id), verifiedAt),
            appendLeadEventSafe({
                sessionId: String(session.id),
                eventType: 'adult_verified',
                source: 'presell',
                sourceId: `presell:${String(leadMemory.metadata?.redirect_code || session.id)}`,
                payload: { method: 'presell_confirmation' },
                occurredAt: verifiedAt,
            }),
        ]);
    }
    if (adultDeclaredNow) brainRuntime.reality.adultVerified = true;
    extraScript = [extraScript, formatBrainRuntimeContext(brainRuntime)].filter(Boolean).join('\n\n');

    if (mem0Settings.enabled && mem0Settings.apiKey && userOnlyText.trim()) {
        try {
            const humanMemories = await searchMem0LeadMemories({
                settings: mem0Settings,
                userId: mem0UserId,
                query: userOnlyText,
            });
            const humanMemoryContext = formatMem0LeadMemoryContext(humanMemories);
            if (humanMemoryContext) {
                extraScript = [extraScript, humanMemoryContext].filter(Boolean).join('\n\n');
            }
            console.log('[MEM0] Memórias recuperadas', {
                sessionId: session.id,
                count: humanMemories.length,
            });
        } catch (error: any) {
            console.warn('[MEM0] Busca adiada; conversa continua com a memória local:', error?.message || error);
        }
    }

    const context = {
        userCity: hasCity ? userCity : undefined,
        // O aparelho ajuda a adaptar formato/linguagem, nunca a inventar poder de compra.
        isHighTicket: false,
        leadProfile: {
            userName: verifiedLeadName,
            deviceType: String(session.device_type || 'Unknown'),
            city: userCity || '',
            region: String(leadMemory.metadata?.redirect_region || ''),
            country: String(leadMemory.metadata?.redirect_country || ''),
            timezone: String(leadMemory.metadata?.redirect_timezone || ''),
            language: String(leadMemory.metadata?.redirect_accept_language || ''),
            userAgent: String(leadMemory.metadata?.redirect_user_agent || ''),
            sourceUrl: String(leadMemory.metadata?.redirect_source_url || ''),
            referer: String(leadMemory.metadata?.redirect_referer || ''),
            utm: leadMemory.metadata?.redirect_utm && typeof leadMemory.metadata.redirect_utm === 'object'
                ? leadMemory.metadata.redirect_utm
                : {},
            queryParams: leadMemory.metadata?.redirect_query_params && typeof leadMemory.metadata.redirect_query_params === 'object'
                ? leadMemory.metadata.redirect_query_params
                : {},
        },
        totalPaid: session.total_paid || 0,
        currentStats: session.lead_score,
        minutesSinceOffer,
        extraScript,
        leadMemory,
        isConversationStart,
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

    const priorTurnText = groupedUserMessages.slice(0, -1).map((message: any) => String(message.content || '')).join('\n').trim();
    const conversationLanguage = detectConversationLanguage(
        latestUserText,
        leadMemory?.metadata?.redirect_accept_language,
    );
    let finalUserMessage = `[CONTEXTO ANTERIOR DESTE TURNO]
${priorTurnText || '(nenhuma mensagem anterior no pacote)'}

[ULTIMA MENSAGEM DO LEAD — RESPOSTA OBRIGATORIA]
${latestUserText || combinedText}

[REGRA DE CONVERSA]
Responda primeiro e diretamente a ULTIMA MENSAGEM. Ela substitui pedido, hipotese ou assunto anterior quando houver correcao, objecao ou mudanca de intencao.
Use o bloco anterior apenas como contexto; nunca deixe a ultima pergunta sem resposta.
IDIOMA DO TURNO: ${conversationLanguage === 'en' ? 'English' : conversationLanguage === 'es' ? 'Español' : 'Português do Brasil'}. Responda somente nesse idioma, salvo se o lead pedir outro.
Use de 2 a 4 baloes curtos. Em conversa normal, responda e depois conduza o assunto em 2 ou 3 baloes; nunca deixe o lead carregar a conversa sozinho.
Cada balao deve ter uma funcao e no maximo 85 caracteres. Em flerte, venda ou fantasia adulta reciproca, use 3 ou 4 para fazer a cena ou a decisao avancar.
VOZ: pedido explicito de audio pode usar send_voice_reply em qualquer estagio. Sem pedido explicito, use voz somente perto da conversao (PREVIEW, SALES_PITCH, NEGOTIATION ou CLOSING). Nunca escreva "aqui minha voz", "vou gravar" ou outra promessa de audio nos baloes; o backend confirma a entrega ou troca por uma desculpa natural.`;
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
                const mimeType = normalizeTelegramImageMimeType(res.headers.get('content-type'), filePath);

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
    if (isConversationStart) {
        finalUserMessage = `${finalUserMessage}\n\n[INICIO DE CONVERSA: /start e uma entrada tecnica. Trate como primeiro contato desta conversa. Nao diga sumido, saudade, voltou, finalmente ou qualquer frase de reencontro. Nao existe resposta fixa: apenas converse no estagio real de desconhecidos.]`;
    } else if (receivedStartCommand) {
        finalUserMessage = `${finalUserMessage}\n\n[RETOMADA DE CONVERSA: /start e apenas um comando tecnico. Este lead ja conversou com voce. Ignore o comando na fala, preserve a memoria, a intimidade e o assunto que ja existem e responda como uma menina de 19 anos responderia naturalmente naquele momento. Nao se apresente de novo, nao pergunte o nome outra vez e nao use uma saudacao fixa.]`;
    }
    if (repetition.repeats >= 2) {
        finalUserMessage = `${finalUserMessage}\n\n[OBSERVACAO INTERNA: o lead repetiu a mesma mensagem ${repetition.repeats}x ("${repetition.last}"). Responda diferente, quebre o loop e puxe o assunto com algo novo e humano. Nao repita a mesma frase.]`;
    }
    if (hasExplicitSexualFantasyTrigger(userOnlyText)) {
        finalUserMessage = `${finalUserMessage}\n\n[OBSERVACAO INTERNA: o lead abriu putaria explicita. Responda ao mesmo tema, preserve os papeis da cena e conduza ativamente. Se o clima for reciproco, use 3-4 baloes curtos para situar, desenvolver e fazer o lead se imaginar na fantasia. So puxe previa ou oferta quando houver uma ponte real.]`;
    }
    if (cityQuestion && hasCity) {
        finalUserMessage = `${finalUserMessage}\n\n[OBSERVACAO INTERNA: o lead perguntou onde voce mora. Voce mora na MESMA cidade do lead: "${userCity}". Responda no PRIMEIRO BALAO de forma humana, curta e natural: "sou de ${userCity}, e vc?". NAO diga "cidade vizinha", NAO diga "daqui" e NAO responda seco.]`;
    }
    if (cityQuestion && !hasCity) {
        finalUserMessage = `${finalUserMessage}\n\n[OBSERVACAO INTERNA: o lead perguntou sua cidade, mas voce AINDA NAO sabe a cidade dele. Pergunte primeiro "e vc, é de onde?" e NAO diga sua cidade agora.]`;
    }

    console.log("[PROCESSADOR] Iniciando geração da resposta", {
        sessionId: session.id,
        groupedMessages: filteredGroupMessages.length,
        hasMedia: Boolean(mediaData),
    });
    let aiResponse: Awaited<ReturnType<typeof sendMessageToGemini>>;
    // Uma chamada do Master Brain resolve o turno inteiro. A revisora adaptativa
    // so entra em decisoes criticas e nunca atrasa toda conversa por padrao.
    const typingHeartbeat = setInterval(() => {
        void sendTelegramAction(botToken, chatId, 'typing').catch((error: any) => {
            console.warn('[PROCESSADOR] Falha ao renovar digitando:', error?.message || error);
        });
    }, 4000);
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
    if (salesTiming.salesContextActive || aiResponse.action === 'generate_pix_payment') {
        const attemptedPrematurePayment = aiResponse.action === 'generate_pix_payment' && !salesTiming.canGeneratePayment;
        if (attemptedPrematurePayment) {
            console.log('[VENDA] PIX prematuro bloqueado', {
                product: salesTiming.activeProduct,
                nurtureTurns: salesTiming.nurtureTurns,
                recentOffer: salesTiming.recentOffer,
            });
            aiResponse.action = 'none';
            aiResponse.payment_details = null;
            aiResponse.current_state = salesTiming.canPitchPrice ? 'SALES_PITCH' : 'HOT_TALK';
        }
        aiResponse.messages = guardPrematureSaleMessages({
            messages: Array.isArray(aiResponse.messages) ? aiResponse.messages : [],
            product: salesTiming.activeProduct,
            canPitchPrice: salesTiming.canPitchPrice,
            canGeneratePayment: salesTiming.canGeneratePayment,
            userText: userOnlyText,
        });
    }
    const backendMustGeneratePayment = salesTiming.canGeneratePayment
        && Boolean(salesTiming.offerPlan)
        && (salesTiming.directCheckout || salesTiming.acceptedOffer);
    if (backendMustGeneratePayment && aiResponse.action !== 'check_payment_status') {
        aiResponse.action = 'generate_pix_payment';
        aiResponse.current_state = 'CLOSING';
        aiResponse.next_best_action = 'GENERATE_PAYMENT';
        aiResponse.payment_details = salesTiming.offerPlan ? {
            value: salesTiming.offerPlan.value,
            description: salesTiming.offerPlan.description,
        } : aiResponse.payment_details;
    }

    // Cada venda recebe identidade propria. O modelo pode escrever a oferta,
    // mas produto, valor aceito e PIX passam a pertencer ao mesmo orderId.
    // Isso permite varias compras iguais, inclusive em dias diferentes, sem
    // reaproveitar a cobranca ou o pagamento de um pedido anterior.
    let activeSalesOrder: ActiveSalesOrder | null = salesTiming.activeOrder;
    const responseHasPrice = extractPrices((Array.isArray(aiResponse.messages) ? aiResponse.messages : []).join('\n')).length > 0;
    if (offerPlan && responseHasPrice) {
        aiResponse.messages = canonicalizeSalesOfferMessages(aiResponse.messages || [], offerPlan.value);
    }
    if (offerPlan && (responseHasPrice || aiResponse.action === 'generate_pix_payment')) {
        const nextOrderStatus = aiResponse.action === 'generate_pix_payment' ? 'accepted' : 'offered';
        const orderSource = String(triggerMessageId || lastGroupedUserAt).replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 120);
        activeSalesOrder = buildSalesOrderSnapshot({
            orderId: `order:${session.id}:${orderSource}:${offerPlan.product}`,
            plan: offerPlan,
            status: nextOrderStatus,
            previous: salesTiming.activeOrder,
        });
        aiResponse.offer_id = activeSalesOrder.orderId;
        if (aiResponse.action === 'generate_pix_payment') {
            aiResponse.payment_details = {
                value: activeSalesOrder.amount,
                description: activeSalesOrder.description,
            };
        }
    }
    const recentConversationWindow = recentSalesHistory.slice(0, 12);
    const userReportsMissingMedia = /\b(?:vc|voce|você)?\s*(?:nao|não)\s+(?:mandou|enviou)\s+(?:nada|a foto|o video|o vídeo)|\b(?:nao|não)\s+(?:chegou|veio)|\bcad[eê]\s+(?:a foto|o video|o vídeo|ela)\b/i.test(userOnlyText);
    const lastBotAlreadyDeliveredMedia = Boolean(lastBotMsg?.media_url);
    const lastBotExplicitlyOfferedMedia = !lastBotAlreadyDeliveredMedia
        && /\b(?:quer|quero que vc|posso|deixa eu)\b.{0,32}\b(?:ver|mostrar|mandar|enviar)\b.{0,20}\b(?:foto|fotinha|previa|prévia|video|vídeo|uma)|\b(?:quer|posso)\b.{0,20}\b(?:foto|fotinha|previa|prévia|video|vídeo)\b/i.test(String(lastBotMsg?.content || ''));
    const userAffirmedMedia = /^\s*(?:sim|quero|eu quero|manda|manda ai|manda aí|pode mandar|manda sim|mostra|deixa ver|solta|quero sim|claro|com certeza|bora|pode ser)\s*[!?.]*\s*$/i.test(userOnlyText)
        && lastBotExplicitlyOfferedMedia;

    const userMediaKind = classifyRequestedMediaLocally(userOnlyText);
    const userAskedPhoto = userMediaKind === 'photo' || (userAffirmedMedia && !/video/i.test(userOnlyText));
    const userAskedMedia = userMediaKind !== 'not_media'
        || userAskedPhoto
        || userAffirmedMedia
        || /\b(foto|fotinha|fotos|selfie|selfies|nude|nudes|video|vídeo|previa|prévia)\b/i.test(userOnlyText)
        || /\b(manda|mostra|envia|quero ver|deixa ver|solta)\b.*\b(foto|fotinha|fotos|selfie|selfies|nude|nudes|pelada|nua|sem roupa|previa|prévia|video|vídeo|uma)\b/i.test(userOnlyText)
        || /\b(?:manda|mostra|tem|quero)\b.{0,14}\b(?:outra|mais uma|mais)\b/i.test(userOnlyText)
        || /\b(quero te ver|qualquer foto|manda qualquer|manda (?:o que|oq) (?:vc|voce|você)?\s*(?:tem)?|me mostra vc|me mostra você|kd a foto|cadê a foto|cade a foto)\b/i.test(userOnlyText)
        || userReportsMissingMedia;

    const botMessagesPromiseMedia = (Array.isArray(aiResponse.messages) ? aiResponse.messages : []).some((msg: string) =>
        /\b(toma|olha só|olha so|olha essa|como eu t[oô]|te esperando|aqui pra vc|te mandei|olha a fotinha|olha aqui|olha amor|olha como|separei pra vc|olha o look|olha meu look|olha eu|tirando foto|tirei essa|tirei agora|fotinha pra vc|foto pra vc|olha essa foto|deitadinha aqui|olha como eu fico)\b/i.test(msg)
    );

    const isInitialGreeting = /^\s*(\/start(?:\s+.*)?|oi|oii|oiii|ola|olá|boa tarde|bom dia|boa noite|eai|fala|opa)\s*$/i.test(userOnlyText.trim())
        && recentSalesHistory.filter((m: any) => m.sender === 'user').length <= 1;

    const cooldownUntil = Date.parse(String(brainRuntime.reality.commercial.postPurchaseCooldownUntil || ''));
    const hardValidation = validateMasterBrainResponse({
        response: aiResponse,
        userText: userOnlyText,
        canGeneratePayment: salesTiming.canGeneratePayment,
        canPitchPrice: salesTiming.canPitchPrice,
        adultVerified: brainRuntime.reality.adultVerified,
        offer: offerPlan ? {
            id: activeSalesOrder?.orderId || `${salesTiming.activeProduct || 'offer'}:${Number(offerPlan.value).toFixed(2)}`,
            value: offerPlan.value,
            description: offerPlan.description,
        } : null,
        postPurchaseCooldownActive: Number.isFinite(cooldownUntil) && cooldownUntil > Date.now(),
        pendingPaymentId: brainRuntime.reality.payment.pendingPaymentId,
    });
    aiResponse = hardValidation.response;
    if (hardValidation.corrections.length > 0) {
        console.log('[HARD VALIDATOR] decisão corrigida:', hardValidation.corrections);
    }

    // O modelo descreve a relacao, mas nao tem autoridade para declarar compra,
    // pagamento ou entrega. Esses estados so podem nascer de eventos do backend.
    const hasConfirmedPurchase = Number(session.total_paid || 0) > 0;
    if (aiResponse.lead_memory_patch && typeof aiResponse.lead_memory_patch === 'object') {
        const memoryPatch: any = { ...aiResponse.lead_memory_patch };
        if (!hasConfirmedPurchase && String(memoryPatch.relationship_stage || '').toLowerCase() === 'buyer') {
            memoryPatch.relationship_stage = 'engaged';
        }
        const unconfirmedOperation = /\b(preview|foto|video|midia|pix|pagamento|cobranca)\b.{0,32}\b(enviad|entreg|gerad|criad|confirmad|pago|sucesso)|\b(enviad|entreg|gerad|criad|confirmad|pago)\b.{0,32}\b(preview|foto|video|midia|pix|pagamento|cobranca)\b/i;
        for (const field of ['known_facts', 'notes'] as const) {
            if (Array.isArray(memoryPatch[field])) {
                memoryPatch[field] = memoryPatch[field].filter((value: unknown) => !unconfirmedOperation.test(String(value || '')));
            }
        }
        if (unconfirmedOperation.test(String(memoryPatch.next_personal_step || ''))) {
            memoryPatch.next_personal_step = '';
        }
        aiResponse.lead_memory_patch = memoryPatch;
    }

    // Persistimos as inferencias somente depois das ferramentas terminarem.
    // Assim uma decisao de "enviar" nunca vira memoria de "enviado" antes da
    // confirmacao real de Telegram/gateway.
    const persistBrainAfterTurn = async () => {
        const responseOutcome = await responseOutcomePromise;
        if (responseOutcome.previewId) {
            await recordPreviewReactionSafe(responseOutcome.previewId, responseOutcome.positive);
        }
        await persistMemoryUpdatesSafe({
            sessionId: String(session.id),
            updates: aiResponse.memory_updates,
            sourceEventId: leadMessageEventId,
        });
        await persistBrainProjectionsSafe({
            sessionId: String(session.id),
            state: brainRuntime,
            relationshipStage: aiResponse.lead_memory_patch?.relationship_stage || leadMemory.relationship_stage,
            userText: userOnlyText,
            updates: aiResponse.memory_updates,
        });
        const decisionId = await recordAiDecisionSafe({
            sessionId: String(session.id),
            sourceEventId: leadMessageEventId,
            model: String(aiResponse.ai_debug?.model || ''),
            provider: String(aiResponse.ai_debug?.provider || ''),
            nextBestAction: String(aiResponse.next_best_action || 'TALK'),
            legacyAction: String(aiResponse.action || 'none'),
            confidence: Number(aiResponse.decision_confidence || 0.5),
            previewId: aiResponse.preview_id || null,
            offerId: aiResponse.offer_id || null,
            stateSnapshot: {
                reality: brainRuntime.reality,
                episode: brainRuntime.episode,
                temporal: brainRuntime.temporal,
                retrieved_memory_ids: brainRuntime.memories.map((memory) => memory.id),
            },
            validatorResult: {
                allowed: hardValidation.allowed,
                corrections: hardValidation.corrections,
            },
        });
        await appendLeadEventSafe({
            sessionId: String(session.id),
            eventType: 'ai_decision',
            source: 'master_brain',
            sourceId: decisionId || (triggerMessageId ? `decision:${triggerMessageId}` : null),
            payload: {
                decision_id: decisionId,
                next_best_action: aiResponse.next_best_action || 'TALK',
                action: aiResponse.action || 'none',
                preview_id: aiResponse.preview_id || null,
                offer_id: aiResponse.offer_id || null,
                validator_corrections: hardValidation.corrections,
            },
        });
    };

    const modelAttemptedMedia = botMessagesPromiseMedia || MEDIA_ACTIONS.has(String(aiResponse.action || ''));
    const requestedMediaDelivery = shouldDeliverRequestedMedia({
        userAskedMedia,
        userAffirmedMedia,
        isInitialGreeting,
    });
    const lastDeliveredMedia = recentConversationWindow.find((message: any) => message.sender === 'bot' && message.media_url);
    const lastDeliveredMediaAt = Date.parse(String(lastDeliveredMedia?.created_at || ''));
    const hoursSinceLastMedia = Number.isFinite(lastDeliveredMediaAt)
        ? Math.max(0, (Date.now() - lastDeliveredMediaAt) / 3_600_000)
        : Number.POSITIVE_INFINITY;
    const currentLeadHeat = Number(aiResponse.lead_stats?.tarado || 0);
    const currentAiStage = String(aiResponse.current_state || '').toUpperCase();
    const currentTextIsHot = hasExplicitSexualFantasyTrigger(userOnlyText)
        || /\b(tesao|tesão|safad|pelad|nua|buceta|peito|bunda|gozar|meter|chupar)\b/i.test(userOnlyText);
    const enoughConversationForSurprise = recentSalesHistory.filter((message: any) => message.sender === 'user').length >= 6;
    const leadMessageHasSubstance = userOnlyText.trim().split(/\s+/).filter(Boolean).length >= 3;
    const blocksSurprise = /\b(nao|não|para|chega|trabalho|familia|família|triste|problema|doente|hospital|morreu|pix|pagar|caro|dinheiro)\b/i.test(userOnlyText);
    const unsolicitedPreviewAllowed = modelAttemptedMedia
        && !requestedMediaDelivery
        && !lastBotAlreadyDeliveredMedia
        && hoursSinceLastMedia >= 24
        && enoughConversationForSurprise
        && leadMessageHasSubstance
        && !blocksSurprise
        && currentTextIsHot
        && ['HOT_TALK', 'PREVIEW'].includes(currentAiStage)
        && currentLeadHeat >= 70
        && stablePercent(`${session.id}:${triggerMessageId || lastGroupedUserAt}:unsolicited-preview`) < 8;
    let shouldDeliverMedia = requestedMediaDelivery || unsolicitedPreviewAllowed;
    if (unsolicitedPreviewAllowed) {
        console.log('[PREVIAS] Surpresa rara autorizada por calor, profundidade e cooldown de 24h.');
    }

    let generatedMessageIndex = 0;
    const insertGeneratedMessage = async (row: Record<string, unknown>) => {
        const messageIndex = generatedMessageIndex++;
        const indexedDebug = withAiDebugMessageIndex(aiResponse.ai_debug, messageIndex);
        const result = await insertMessageWithAiDebug(supabase, row, indexedDebug);
        if (result.debugError) {
            console.warn("[AI DEBUG] O envio ao lead continuou, mas o ai_debug nao foi persistido:", errorMessage(result.debugError));
        }
        if (result.error) {
            console.warn("[PROCESSADOR] Falha ao persistir mensagem gerada:", errorMessage(result.error));
        }
        await appendLeadEventSafe({
            sessionId: String(session.id),
            eventType: 'assistant_message',
            source: 'master_brain',
            sourceId: `${triggerMessageId || lastGroupedUserAt}:assistant:${messageIndex}`,
            payload: {
                content: String(row.content || '').slice(0, 4_000),
                media_type: row.media_type || null,
                action: aiResponse.action || 'none',
                next_best_action: aiResponse.next_best_action || 'TALK',
            },
        });
        return result;
    };
    let mediaSuppressedForPolicy = modelAttemptedMedia && !shouldDeliverMedia;
    let mediaSuppressedForRepetition = false;
    let sentMediaUrlsForSession: string[] = [];
    let sentMediaKeysForSession = new Set<string>();

    // A Lari pode oferecer uma prévia na conversa, mas o arquivo só sai depois
    // que o lead pede ou confirma. Isso corta mídia espontânea sem mudar o texto
    // ou o raciocínio do cérebro.
    if (!shouldDeliverMedia && MEDIA_ACTIONS.has(String(aiResponse.action || ''))) {
        console.log('[PREVIAS] Ação de mídia sem pedido explícito foi convertida em conversa.');
        aiResponse.action = 'none';
    }

    // Pedido de mídia só vira cobrança quando o lead também manifesta uma compra real.
    // Palavras soltas como "pix" ou "pagar" em uma reclamação não autorizam cobrança.
    const explicitTransactionRequest = salesTiming.directCheckout
        || /\b(quero comprar|vou comprar|quero pagar|vou pagar|pode cobrar|gera(?:r)? (?:o )?pix|manda (?:o )?pix|passa (?:o )?pix|qual (?:e|é)?\s*(?:o )?(?:pix|preco|preço|valor)|quanto custa)\b/i.test(userOnlyText);
    const explicitPaidProduct = /\b(vip|vitalicio|vitalício|mensal|chamada|videochamada|call|encontro social|encontro presencial|companhia presencial|whatsapp|numero pessoal|número pessoal|personalizad[oa]|sob encomenda|video completo|vídeo completo|audio erotico|áudio erótico)\b/i.test(userOnlyText);
    const rejectsPaymentNow = /\b(?:nao|não|sem)\b.{0,28}\b(?:pix|pagar|pagamento|cobrar)\b/i.test(userOnlyText)
        || /\b(?:pedi|quero|manda)\b.{0,30}\b(?:previa|prévia|foto)\b.{0,30}\b(?:nao|não|sem)\b.{0,12}\bpix\b/i.test(userOnlyText);
    const explicitPaidPurchaseIntent = !rejectsPaymentNow
        && explicitTransactionRequest
        && (explicitPaidProduct || /\bpix\b/i.test(userOnlyText));
    if (shouldDeliverMedia && !explicitPaidPurchaseIntent && aiResponse.action === 'generate_pix_payment') {
        console.log('[PROCESSADOR] Bloqueando PIX indevido para pedido de prévia/foto. Redirecionando para envio de prévia.');
        aiResponse.action = 'send_custom_preview';
        aiResponse.payment_details = null;
    }

    // Se o lead pediu mídia ou a IA escolheu ação de mídia ou a mensagem promete foto, garante action de mídia válida
    let contextualMedia: any = null;
    if (shouldDeliverMedia && (!MEDIA_ACTIONS.has(String(aiResponse.action || '')) || aiResponse.action === 'none')) {
        contextualMedia = resolveContextualMediaAction(userOnlyText, aiResponse.action);
        if (contextualMedia) {
            aiResponse.action = contextualMedia.action as any;
            aiResponse.current_state = (ACTION_STAGE_MAP[contextualMedia.action] || aiResponse.current_state) as any;
        } else {
            aiResponse.action = 'send_shower_photo';
        }
    }
    let pendingPhotoRequestAnalysis: Promise<unknown> | null = null;
    if (aiResponse.preview_request?.description && userAskedPhoto) {
        pendingPhotoRequestAnalysis = registerMissingPhotoRequest({
            userText: userOnlyText,
            description: aiResponse.preview_request.description,
            tags: aiResponse.preview_request.tags || [],
            action: aiResponse.preview_request.media_type === 'video' ? 'send_video_preview' : 'none',
            photoHint: true,
            sessionId: session.id,
        }).catch((error: any) => {
            console.warn('[PREVIAS] Falha ao registrar ideia sugerida pelo lead:', error?.message || error);
        });
    } else if (userAskedPhoto) {
        try {
            const requestedSpec = inferRequestedPreviewSpec(userOnlyText, aiResponse.action);
            let query = supabase
                .from('preview_assets')
                .select('id,name,description,triggers,tags,priority,media_type')
                .eq('enabled', true)
                .limit(1000);
            const { data: candidates } = await query;
            const bestScore = Math.max(0, ...(candidates || []).map((asset: any) =>
                scorePreviewForContext(asset, userOnlyText, requestedSpec.tags)
            ));
            if (bestScore < 4) {
                pendingPhotoRequestAnalysis = registerMissingPhotoRequest({
                    userText: userOnlyText,
                    description: requestedSpec.description,
                    tags: requestedSpec.tags,
                    action: aiResponse.action,
                    sessionId: session.id,
                }).catch((error: any) => {
                    console.warn('[PREVIAS] Falha ao analisar lacuna do catalogo:', error?.message || error);
                });
            }
        } catch (error: any) {
            console.warn('[PREVIAS] Falha ao verificar lacuna do catalogo:', error?.message || error);
        }
    }

    // A IA pode escolher de novo o mesmo preview_id. Antes de escrever qualquer
    // promessa de envio, trocamos por uma mídia nunca usada nesta conversa.
    if (MEDIA_ACTIONS.has(String(aiResponse.action || ''))) {
        const [sentMediaResult, catalogResult] = await Promise.all([
            supabase
                .from('messages')
                .select('media_url')
                .eq('session_id', session.id)
                .eq('sender', 'bot')
                .not('media_url', 'is', null)
                .limit(1000),
            supabase
                .from('preview_assets')
                .select('id,name,description,triggers,tags,media_url,media_type,priority,min_tarado,max_tarado,stage,ai_analysis,performance,exploration_weight')
                .eq('enabled', true)
                .not('media_url', 'is', null)
                .limit(1000),
        ]);

        if (!sentMediaResult.error && !catalogResult.error) {
            sentMediaUrlsForSession = (sentMediaResult.data || [])
                .map((row: any) => String(row.media_url || '').trim())
                .filter(Boolean);
            sentMediaKeysForSession = new Set(sentMediaUrlsForSession.map(normalizeMediaUrlKey).filter(Boolean));
            const catalog = (catalogResult.data || []).filter((asset: any) => asset.media_url);
            const isImgAsset = (t?: string | null) => t === 'image' || t === 'photo' || !t;
            const isVidAsset = (t?: string | null) => t === 'video';
            const action = String(aiResponse.action || '');
            const requestedType = userMediaKind === 'video' || /video/i.test(action)
                ? 'video'
                : userAskedPhoto || ['send_shower_photo', 'send_lingerie_photo', 'send_wet_finger_photo', 'send_ass_photo_preview'].includes(action)
                    ? 'image'
                    : null;
            const relevantCatalog = requestedType
                ? catalog.filter((asset: any) => requestedType === 'video' ? isVidAsset(asset.media_type) : isImgAsset(asset.media_type))
                : catalog;
            let unusedCatalog = filterUnsentPreviewAssets(relevantCatalog, sentMediaUrlsForSession);

            // Vídeo pode cair para uma foto inédita se não houver vídeos
            if (unusedCatalog.length === 0 && requestedType === 'video') {
                unusedCatalog = filterUnsentPreviewAssets(catalog, sentMediaUrlsForSession);
            }

            const requestedSpec = inferRequestedPreviewSpec(userOnlyText, aiResponse.action);
            const tarado = Number(aiResponse.lead_stats?.tarado || 0);
            const candidatePool = unusedCatalog;
            const momentRankedPreviews = rankPreviewCandidatesByMoment({
                assets: candidatePool,
                context: {
                    userText: userOnlyText,
                    preferredTags: requestedSpec.tags,
                    timeZone: String(leadMemory.metadata?.redirect_timezone || ''),
                    funnelState: String(aiResponse.current_state || session.funnel_step || ''),
                    leadHeat: tarado,
                },
                baseScore: (asset: any) => {
                    const inRange = tarado >= Number(asset.min_tarado ?? 0)
                        && tarado <= Number(asset.max_tarado ?? 100);
                    return scorePreviewForContext(asset, userOnlyText, requestedSpec.tags) + (inRange ? 3 : -3);
                },
            });
            const rankedPreviews = applyPreviewBanditRanking(
                momentRankedPreviews,
                `${session.id}:${triggerMessageId || lastGroupedUserAt}:${requestedSpec.tags.join(',')}`,
            );
            console.log('[PREVIAS] Ranking contextual do momento:', JSON.stringify(rankedPreviews.slice(0, 3).map((entry) => ({
                id: entry.asset.id,
                score: entry.score,
                period: entry.moment.period,
                requested: entry.moment.requestedSensuality,
                asset: entry.moment.assetSensuality,
                reasons: entry.moment.reasons,
            }))));
            const chosenPreview = rankedPreviews[0]?.asset || candidatePool[0];

            if (chosenPreview) {
                aiResponse.action = 'send_custom_preview';
                aiResponse.preview_id = chosenPreview.id;
            } else {
                console.log('[PREVIAS] Catálogo esgotado para esta conversa; repetição bloqueada.');
                aiResponse.action = 'none';
                aiResponse.preview_id = null;
                shouldDeliverMedia = false;
                mediaSuppressedForRepetition = true;
            }
        } else {
            console.warn('[PREVIAS] Falha no preflight anti-repeticao:', sentMediaResult.error?.message || catalogResult.error?.message);
            aiResponse.action = 'none';
            aiResponse.preview_id = null;
            shouldDeliverMedia = false;
            mediaSuppressedForRepetition = true;
        }
    }

    console.log("🤖 Resposta Gemini Stats:", JSON.stringify(aiResponse.lead_stats, null, 2));

    // 5. Atualizar Stats & Salvar Pensamentos
    const deterministicScore = calculateLeadScore([{ content: userOnlyText }], {
        initial: session.lead_score,
        totalPaid: Number(session.total_paid || 0),
        includeContextBoosts: false,
    });
    const deterministicStoredScore = toStoredLeadScore(deterministicScore);
    const brainScore = parseLeadScore(aiResponse.lead_stats, deterministicScore.score);
    const previousScore = parseLeadScore(session.lead_score);
    const reconcileScore = (key: 'tarado' | 'financeiro' | 'carente' | 'sentimental') => {
        // Os sinais objetivos continuam sendo a âncora; o cérebro geral adiciona a
        // leitura contextual (histórico, aparelho, localização, tom e memória).
        const contextualDelta = (brainScore[key] - previousScore[key]) * 0.35;
        return Math.max(0, Math.min(100, Math.round(deterministicScore.score[key] + contextualDelta)));
    };
    aiResponse.lead_stats = {
        ...deterministicStoredScore,
        tarado: reconcileScore('tarado'),
        financeiro: Number(session.total_paid || 0) > 0 ? 100 : reconcileScore('financeiro'),
        carente: reconcileScore('carente'),
        sentimental: reconcileScore('sentimental'),
    };

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
    const hadPendingPaymentBeforeTurn = Boolean(brainRuntime.reality.payment.pendingPaymentId);
    if (nextStep === 'PAYMENT_CHECK'
        && !hadPendingPaymentBeforeTurn
        && aiResponse.action !== 'check_payment_status') {
        // A intencao de gerar PIX ainda e apenas uma decisao. PAYMENT_CHECK so
        // existe depois que o gateway realmente devolve uma cobranca pendente.
        nextStep = aiResponse.action === 'generate_pix_payment' ? 'CLOSING' : 'SALES_PITCH';
    }

    const detectedLeadMemory = detectLeadMemorySignals(
        userOnlyText,
        Array.isArray(aiResponse.messages) ? aiResponse.messages : [],
        aiResponse,
        leadMemory
    );
    let updatedLeadMemory = mergeLeadMemoryPatch(detectedLeadMemory, aiResponse.lead_memory_patch);
    if (salesTiming.activeProduct && salesTiming.salesContextActive) {
        updatedLeadMemory = {
            ...updatedLeadMemory,
            metadata: {
                ...(updatedLeadMemory.metadata || {}),
                ...salesTiming.metadataPatch,
            },
            updated_at: new Date().toISOString(),
        };
    }

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
        try {
            const thoughtResult = await insertMessageWithAiDebug(supabase, {
                session_id: session.id,
                sender: 'thought',
                content: aiResponse.internal_thought,
            }, withAiDebugMessageIndex(aiResponse.ai_debug, -1));
            if (thoughtResult.debugError) {
                console.warn("[AI DEBUG] Thought salvo sem ai_debug:", errorMessage(thoughtResult.debugError));
            }
            if (thoughtResult.error) {
                console.warn("[PROCESSADOR] Falha ao inserir thought:", errorMessage(thoughtResult.error));
            }
        } catch (insertThoughtErr: any) {
            console.warn("[PROCESSADOR] Falha inesperada ao inserir thought:", insertThoughtErr?.message || insertThoughtErr);
        }
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

    const { data: recentConversationTextRows } = await supabase
        .from('messages')
        .select('sender,content')
        .eq('session_id', session.id)
        .in('sender', ['user', 'bot'])
        .order('created_at', { ascending: false })
        .limit(80);
    const recentBotTexts = (recentConversationTextRows || [])
        .filter((row: any) => row.sender === 'bot')
        .map((row: any) => String(row.content || ''))
        .filter((text: string) => text && !normalizeLoopText(text).startsWith('midia '));
    const recentUserTexts = (recentConversationTextRows || [])
        .filter((row: any) => row.sender === 'user')
        .map((row: any) => String(row.content || ''))
        .filter(Boolean);
    const buildRecoveryMessages = () => buildConversationRecoveryMessages({
        userText: latestUserText,
        recentBotTexts,
        recentUserTexts,
        action: String(aiResponse.action || 'none'),
        language: conversationLanguage,
    });

    const outgoingMessages = normalizeAiMessageList(aiResponse.messages);

    let safeMessages = filterConversationConsistencyMessages(
        outgoingMessages.length > 0 ? outgoingMessages : buildRecoveryMessages(),
        {
            currentUserText: latestUserText,
            recentUserTexts,
        },
    )
        .map((m) => sanitizeOutgoingMessage(m, latestUserText))
        .filter(Boolean);

    const lastBotContent = lastBotMsg?.content || '';
    safeMessages = applyConversationQualityGuards(safeMessages, {
        userText: latestUserText,
        // O perfil do Telegram nao prova como um lead novo prefere ser chamado.
        sessionName: lastBotMsg ? session.user_name : null,
        hasCity,
        userAskedCity: cityQuestion,
        extractedName: aiResponse.extracted_user_name,
        lastBotContent
    });
    safeMessages = enforceLatestIntentMessages(safeMessages, {
        latestUserText,
        language: conversationLanguage,
    });
    safeMessages = safeMessages.map((message) => sanitizeOutgoingMessage(message, latestUserText)).filter(Boolean);
    const relationshipStageBeforeTurn = String(leadMemory.relationship_stage || 'new').trim().toLowerCase();
    const episodeStartedAtMs = Date.parse(String(leadMemory.metadata?.conversation_started_at || ''));
    const episodeLeadTurns = Number.isFinite(episodeStartedAtMs)
        ? recentSalesHistory.filter((message: any) => message.sender === 'user'
            && Date.parse(String(message.created_at || '')) >= episodeStartedAtMs).length
        : Number.POSITIVE_INFINITY;
    const isEarlyConversationEpisode = isConversationStart || episodeLeadTurns <= 3;
    // O estado probabilistico pode estar atrasado, mas uma mensagem anterior da
    // Lari e um fato objetivo. Nunca rebaixe um retorno para primeiro contato.
    const isActualFirstRelationshipTurn = !lastBotMsg && (isConversationStart
        || !relationshipStageBeforeTurn
        || relationshipStageBeforeTurn === 'new'
        || relationshipStageBeforeTurn === 'unknown'
        || isEarlyConversationEpisode);
    if (isActualFirstRelationshipTurn) {
        safeMessages = refineNewRelationshipMessages(safeMessages, {
            userText: userOnlyText,
            lastBotContent,
            hasKnownName: sessionHasUsefulName(session.user_name) || userProbablyProvidedName(userOnlyText, aiResponse.extracted_user_name),
            isConversationStart,
            variationKey: String(session.id),
        });
    }
    if (mediaSuppressedForRepetition || mediaSuppressedForPolicy) {
        safeMessages = safeMessages.filter((message: string) => !isMediaAnnouncement(message));
    }
    if (safeMessages.length === 0 && (!userAskedMedia || mediaSuppressedForRepetition || mediaSuppressedForPolicy)) {
        safeMessages = mediaSuppressedForRepetition
            ? ['essa eu já tinha te mandado, me pede outra diferente']
            : buildRecoveryMessages();
    }
    if (cityQuestion && hasCity) {
        const forcedCityAnswer = `sou de ${userCity}, e vc?`;
        const withoutGenericCity = safeMessages.filter((msg: string) => {
            const norm = normalizeLoopText(msg);
            return !/(cidade vizinha|daqui|de onde vc|de onde voce|de onde você)/i.test(norm);
        });
        safeMessages = [forcedCityAnswer, ...withoutGenericCity.filter((msg: string) => normalizeLoopText(msg) !== normalizeLoopText(forcedCityAnswer))];
    }

    const stage = String(aiResponse.current_state || '').toUpperCase();
    const explicitFantasy = hasExplicitSexualFantasyTrigger(userOnlyText);
    const maxMessagesForTurn = (() => {
        if (stage === 'PAYMENT_CHECK' || aiResponse.action === 'generate_pix_payment') return 2;
        if (stage === 'NEGOTIATION' || stage === 'CLOSING' || stage === 'SALES_PITCH') return 3;
        if (explicitFantasy) return Math.min(4, Math.max(3, Number(aiResponse.recommended_message_count || 3)));
        if (isEarlyConversationEpisode) return 2;
        return Math.min(3, Math.max(2, Number(aiResponse.recommended_message_count || 2)));
    })();

    safeMessages = shapeConversationBubbles(safeMessages, {
        preferredCount: aiResponse.recommended_message_count || 2,
        maxBubbles: maxMessagesForTurn,
        maxChars: aiResponse.max_chars_per_message || 75,
    });

    safeMessages = filterConversationConsistencyMessages(safeMessages, {
        currentUserText: latestUserText,
        recentUserTexts,
        recentBotTexts,
    });
    safeMessages = filterMalformedConversationMessages(safeMessages);
    if (safeMessages.length === 0 && !MEDIA_ACTIONS.has(String(aiResponse.action || 'none'))) {
        safeMessages = buildRecoveryMessages();
    }
    safeMessages = safeMessages
        .map((message) => sanitizeOutgoingMessage(message, latestUserText))
        .filter(Boolean)
        .slice(0, 4);

    const isMediaDeliveryTurn = MEDIA_ACTIONS.has(String(aiResponse.action || 'none'));
    // Em turno de mídia, nenhum texto que prometa "olha" ou "te mandei" sai
    // antes do arquivo. A reação só é enviada depois da entrega confirmada.
    // Em mídia, o primeiro balão vira a legenda contextual da própria foto ou
    // vídeo. Os demais continuam a conversa depois da entrega, sem repetir a
    // legenda como uma nova mensagem solta.
    const previewCaptionCandidate = isMediaDeliveryTurn
        ? sanitizeOutgoingMessage(safeMessages[0] || '', latestUserText).slice(0, 85)
        : '';
    const deferredMediaMessages = isMediaDeliveryTurn ? safeMessages.slice(1, 4) : [];
    let outgoingToSend = isMediaDeliveryTurn
        ? []
        : safeMessages.slice(0, 4);
    if (aiResponse.action === 'generate_pix_payment') {
        // O backend envia texto + codigo somente depois de o gateway confirmar
        // a criacao. Isso elimina promessas falsas de PIX e pedido redundante
        // de comprovante antes mesmo de existir uma cobranca.
        outgoingToSend = [];
    }
    let operationalLeadMemory = updatedLeadMemory;
    let paymentCreatedThisTurn = false;
    const persistMediaDeliveryStatus = async (
        status: 'delivered' | 'recovered' | 'failed',
        details: { mediaType?: string; mediaUrl?: string; protected?: boolean; caption?: string } = {},
    ) => {
        const caption = sanitizeOutgoingMessage(details.caption || '', latestUserText).slice(0, 85);
        const previousCaptionHistory = Array.isArray(operationalLeadMemory.metadata?.preview_caption_history)
            ? operationalLeadMemory.metadata.preview_caption_history.map(String).filter(Boolean)
            : [];
        operationalLeadMemory = {
            ...operationalLeadMemory,
            metadata: {
                ...(operationalLeadMemory.metadata || {}),
                last_media_status: status,
                last_media_action: String(aiResponse.action || 'none'),
                last_media_type: details.mediaType || null,
                last_media_url: details.mediaUrl || null,
                last_media_protected: details.protected === true,
                last_media_at: new Date().toISOString(),
                ...(caption ? {
                    last_preview_caption: caption,
                    preview_caption_history: [...previousCaptionHistory, caption].slice(-20),
                } : {}),
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
            await insertGeneratedMessage({
                session_id: session.id,
                sender: 'bot',
                content: message,
            });
        }
    };
    const audioCooldownSince = new Date(Date.now() - elevenLabsSettings.cooldownMinutes * 60_000).toISOString();
    const { data: recentAudio } = elevenLabsSettings.enabled
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
    const userWantsAudio = userAskedForElevenLabsAudio(userOnlyText);
    const voiceReady = elevenLabsSettings.enabled
        && Boolean(elevenLabsSettings.apiKey)
        && Boolean(elevenLabsSettings.voiceId);
    const aiRequestedVoiceAction = aiResponse.action === 'send_voice_reply';
    const conversionVoiceMoment = isElevenLabsConversionMoment({
        stage,
        canPitchPrice: salesTiming.canPitchPrice,
        leadHeat: currentLeadHeat,
    });
    const aiSelectedVoice = aiRequestedVoiceAction && conversionVoiceMoment;
    const shouldForceVoice = (userWantsAudio || aiSelectedVoice) && voiceReady;
    const automaticConversionVoice = !userWantsAudio
        && !aiRequestedVoiceAction
        && conversionVoiceMoment
        && voiceReady
        && !recentAudio
        && aiResponse.action === 'none';

    if (aiRequestedVoiceAction && !aiSelectedVoice && !userWantsAudio) {
        // A voz automatica e um recurso de conversao, nao um enfeite de conversa comum.
        aiResponse.action = 'none';
        outgoingToSend = outgoingToSend.filter((message: string) => !isElevenLabsDeliveryPromise(message));
        if (outgoingToSend.length === 0) outgoingToSend = buildRecoveryMessages();
    }
    if (userWantsAudio && !voiceReady) {
        outgoingToSend = [buildElevenLabsUnavailableReply({
            language: conversationLanguage,
            seed: `${session.id}:${triggerMessageId || lastGroupedUserAt}:voice-unavailable`,
        })];
    }

    let preferredAudioIndex = (shouldForceVoice || automaticConversionVoice) ? outgoingToSend.findIndex((message: string) =>
        shouldUseElevenLabsAudio({
            settings: elevenLabsSettings,
            seed: `${session.id}:${triggerMessageId || lastGroupedUserAt}:${message}`,
            userText: userOnlyText,
            messageText: message,
            stage,
            action: String(aiResponse.action || 'none'),
            hasRecentAudio: shouldForceVoice ? false : Boolean(recentAudio),
        })
    ) : -1;
    if (shouldForceVoice && preferredAudioIndex < 0 && outgoingToSend.length > 0) {
        preferredAudioIndex = 0;
    }

    let audioSpokenText = '';
    const audioMaxChars = Math.min(
        elevenLabsSettings.maxChars,
        userWantsAudio ? ELEVENLABS_REQUESTED_AUDIO_MAX_CHARS : ELEVENLABS_CONVERSION_AUDIO_MAX_CHARS,
    );
    if (shouldForceVoice) {
        const combined = outgoingToSend.slice(0, userWantsAudio ? 2 : 1).join('. ');
        if (combined.length >= 8 && !isUnsafeForElevenLabsVoice(combined)) {
            outgoingToSend = [combined];
            preferredAudioIndex = 0;
            audioSpokenText = combined;
        }
    } else if (preferredAudioIndex >= 0) {
        audioSpokenText = outgoingToSend[preferredAudioIndex];
    }

    const preparedAudioPromise = preferredAudioIndex >= 0 && audioSpokenText
        ? (() => {
            const emotionalContext = String(session.lead_memory?.emotional_context || '');
            const deterministicFallback = () => ({
                spokenText: cleanTextForElevenLabsSpeech(audioSpokenText, audioMaxChars),
                elevenText: buildElevenV3Performance({
                    messageText: audioSpokenText,
                    userText: userOnlyText,
                    emotionalContext,
                    maxChars: audioMaxChars,
                }),
                delivery: 'deterministic',
                reaction: '',
                source: 'deterministic' as const,
            });
            return prepareElevenLabsScript({
                settings: elevenLabsScriptAgentSettings,
                messageText: audioSpokenText,
                userText: userOnlyText,
                emotionalContext,
                maxChars: audioMaxChars,
                // Um pedido explícito merece uma resposta criada para ser dita,
                // não a mera leitura de uma bolha de texto já montada.
                mode: userWantsAudio ? 'requested_audio' : 'voice_render',
                conversationContext: [
                    lastBotContent,
                    ...recentUserTexts.slice(-3),
                    ...recentBotTexts.slice(-3),
                ].filter(Boolean).join('\n').slice(-900),
                lariIdentityContext: JSON.stringify({
                    lari: {
                        name: 'Larissa Morais',
                        age: 19,
                        voice: 'brasileira jovem, íntima, espontânea, provocante quando o contexto permite',
                    },
                    relationship: {
                        leadName: session.user_name || null,
                        stage,
                        totalPaid: Number(session.total_paid || 0),
                        tier: leadVoicePolicy.tier,
                        scores: aiResponse.lead_stats || {},
                        memory: {
                            relationshipStage: operationalLeadMemory.relationship_stage || null,
                            emotionalContext: operationalLeadMemory.emotional_context || null,
                            knownFacts: operationalLeadMemory.known_facts || [],
                            desires: operationalLeadMemory.desires || [],
                            fetishes: operationalLeadMemory.fetiches || [],
                            objections: operationalLeadMemory.objections || [],
                            wantedProducts: operationalLeadMemory.wanted_products || [],
                            rejectedProducts: operationalLeadMemory.rejected_products || [],
                            conversationHooks: operationalLeadMemory.conversation_hooks || [],
                            notes: operationalLeadMemory.notes || [],
                        },
                    },
                }),
            }).catch((error: any) => {
                console.warn('[ELEVENLABS] Diretora DeepSeek indisponível; usando roteiro local:', error?.message || error);
                return deterministicFallback();
            }).then(async (script) => {
                console.log('[ELEVENLABS] Roteiro preparado', {
                    source: script.source,
                    delivery: script.delivery,
                    reaction: script.reaction || 'none',
                    spokenText: script.spokenText,
                });
                const subscription = await getElevenLabsSubscriptionForBudget({
                    apiKey: elevenLabsSettings.apiKey,
                    fallback: {
                        remainingCredits: Number(botConfig.elevenlabs_budget_fallback_credits || 40_000),
                        cycleKey: botConfig.elevenlabs_budget_cycle_key || 'manual:2026-08-27:40000',
                    },
                });
                const estimatedCredits = estimateElevenLabsCredits(script.elevenText);
                const source = userWantsAudio
                    ? 'requested' as const
                    : aiSelectedVoice ? 'ai_selected' as const : 'spontaneous' as const;
                const reservation = await reserveElevenLabsBudget({
                    supabase,
                    sessionId: String(session.id),
                    idempotencyKey: `${session.id}:${triggerMessageId || lastGroupedUserAt}:voice:${preferredAudioIndex}`,
                    source,
                    estimatedCredits,
                    subscription,
                    config: elevenLabsBudgetConfig,
                });
                if (!reservation.allowed) {
                    console.log('[ELEVENLABS BUDGET] Áudio convertido em texto', {
                        reason: reservation.reason,
                        tier: leadVoicePolicy.tier,
                        estimatedCredits,
                    });
                    throw new Error(`voice_budget:${reservation.reason}`);
                }

                try {
                    const generated = await generateElevenLabsAudio({ settings: elevenLabsSettings, text: script.elevenText });
                    await settleElevenLabsBudget({
                        supabase,
                        reservationId: reservation.reservationId,
                        actualCredits: generated.usage.actualCredits,
                        requestId: generated.usage.requestId,
                        spokenChars: generated.usage.spokenChars,
                        taggedChars: generated.usage.taggedChars,
                    }).catch((error: any) => {
                        // O provedor já cobrou neste ponto. Mantemos a reserva como
                        // proteção conservadora e não impedimos a entrega ao lead.
                        console.error('[ELEVENLABS BUDGET] Cobrança real não persistida:', error?.message || error);
                    });
                    return { audio: generated.audio, script, error: null as unknown };
                } catch (error: any) {
                    await releaseElevenLabsBudget({
                        supabase,
                        reservationId: reservation.reservationId,
                        reason: String(error?.message || error),
                    });
                    throw error;
                }
            }).catch((error: unknown) => ({ audio: null, script: deterministicFallback(), error }));
        })()
        : null;

    for (let i = 0; i < outgoingToSend.length; i++) {
        const msgText = outgoingToSend[i];
        let textToSend = msgText;

        const newerUserMsg = await findNewerUserMessage();

        if (newerUserMsg) {
            console.log(`[PROCESSADOR] Abortando envio. Lead mandou mensagem nova depois do pacote processado: ${newerUserMsg.id}`);
            return NextResponse.json({ status: 'superseded_during_send' });
        }

        if (i === preferredAudioIndex) {
            try {
                if (!preparedAudioPromise) throw new Error('audio nao preparado');
                const preparedAudio = await preparedAudioPromise;
                if (preparedAudio.error || !preparedAudio.audio) throw preparedAudio.error || new Error('audio vazio');
                await waitWithChatAction('record_voice', humanAudioRecordingDelayMs(preparedAudio.script.spokenText));
                const interruptedDuringRecording = await findNewerUserMessage();
                if (interruptedDuringRecording) {
                    console.log(`[PROCESSADOR] Áudio cancelado porque o lead enviou uma mensagem nova: ${interruptedDuringRecording.id}`);
                    return NextResponse.json({ status: 'superseded_during_recording' });
                }
                await sendTelegramVoice(botToken, chatId, preparedAudio.audio);
                await insertGeneratedMessage({
                    session_id: session.id,
                    sender: 'bot',
                    // O painel guarda a transcrição exata do que foi falado, não
                    // a versão visual do chat com "kkk", "rs" ou abreviações.
                    content: preparedAudio.script.spokenText,
                    media_type: 'audio',
                });
                continue;
            } catch (error: any) {
                console.error('[ELEVENLABS] Falha, usando texto como fallback:', error?.message || error);
                await supabase.from('messages').insert({
                    session_id: session.id,
                    sender: 'system',
                    content: `[ELEVENLABS ERROR] ${String(error?.message || error).slice(0, 500)}`,
                });
                if (userWantsAudio || aiSelectedVoice || isElevenLabsDeliveryPromise(msgText)) {
                    textToSend = buildElevenLabsUnavailableReply({
                        language: conversationLanguage,
                        seed: `${session.id}:${triggerMessageId || lastGroupedUserAt}:voice-failed`,
                    });
                }
            }
        }

        const modelDurationMs = Number(aiResponse.ai_debug?.duration_ms || 0);
        const messageDelayMs = i === 0 && modelDurationMs >= 8_000
            ? 150
            : humanTextDelayMs(textToSend, i);
        await waitWithChatAction('typing', messageDelayMs);
        const interruptedDuringTyping = await findNewerUserMessage();
        if (interruptedDuringTyping) {
            console.log(`[PROCESSADOR] Texto cancelado porque o lead enviou uma mensagem nova: ${interruptedDuringTyping.id}`);
            return NextResponse.json({ status: 'superseded_during_typing' });
        }

        await insertGeneratedMessage({
            session_id: session.id,
            sender: 'bot',
            content: textToSend
        });

        await sendTelegramMessage(botToken, chatId, textToSend);
    }

    if (mem0Settings.enabled && mem0Settings.apiKey && userOnlyText.trim()) {
        try {
            const memoryResult = await addMem0LeadTurn({
                settings: mem0Settings,
                userId: mem0UserId,
                sessionId: String(session.id),
                userText: userOnlyText,
                assistantMessages: outgoingToSend,
                occurredAt: lastGroupedUserAt,
            });
            console.log('[MEM0] Turno enviado para consolidação', {
                sessionId: session.id,
                status: 'status' in memoryResult ? memoryResult.status : 'skipped',
            });
        } catch (error: any) {
            console.warn('[MEM0] Gravação adiada; resposta já foi entregue:', error?.message || error);
        }
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

        const isImageType = (t?: string | null) => t === 'image' || t === 'photo' || !t;
        const isVideoType = (t?: string | null) => t === 'video';
        const matchesMediaType = (assetType?: string | null, targetType?: 'image' | 'video') => {
            if (!targetType) return true;
            return targetType === 'video' ? isVideoType(assetType) : isImageType(assetType);
        };

        const getRegisteredPreview = async (
            mediaType?: 'image' | 'video',
            excludeUrls: string[] = sentMediaUrlsForSession,
            preferredTags: string[] = preferredPreviewTags,
            requireRelevant = false,
        ) => {
            let data: any[] | null = null;
            let error: any = null;

            const res = await supabase
                .from('preview_assets')
                .select('*')
                .eq('enabled', true)
                .order('priority', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(1000);
            data = res.data;
            error = res.error;

            if (error || !data || data.length === 0) {
                const anyRes = await supabase
                    .from('preview_assets')
                    .select('*')
                    .order('priority', { ascending: false })
                    .limit(1000);
                data = anyRes.data || [];
            }

            if (!data || data.length === 0) return null;

            const excluded = new Set(excludeUrls.map((url) => normalizeMediaUrlKey(url)).filter(Boolean));
            const valid = (data || []).filter((item: any) => item?.media_url && matchesMediaType(item.media_type, mediaType));
            
            const candidateList = valid.length > 0 ? valid : (data || []).filter((item: any) => item?.media_url);
            if (candidateList.length === 0) return null;

            const available = candidateList.filter((item: any) => !excluded.has(normalizeMediaUrlKey(item.media_url)));
            if (available.length === 0) return null;
            const pool = available;

            const momentRanked = rankPreviewCandidatesByMoment({
                assets: pool,
                context: {
                    userText: userOnlyText,
                    preferredTags,
                    timeZone: String(operationalLeadMemory.metadata?.redirect_timezone || ''),
                    funnelState: String(aiResponse.current_state || session.funnel_step || ''),
                    leadHeat: Number(aiResponse.lead_stats?.tarado || 0),
                },
                baseScore: (item: any) => scorePreviewForContext(item, userOnlyText, preferredTags),
            });
            const ranked = applyPreviewBanditRanking(
                momentRanked,
                `${session.id}:${triggerMessageId || lastGroupedUserAt}:${preferredTags.join(',')}`,
            );
            return ranked[0]?.asset || pool[0];
        };

        let mediaUrl = null;
        let mediaType = null;
        let selectedPreviewAsset: any = null;

        if (aiResponse.action === 'send_custom_preview') {
            const previewId = (aiResponse as any).preview_id;
            if (previewId) {
                const { data: previewRow } = await supabase
                    .from('preview_assets')
                    .select('*')
                    .eq('id', previewId)
                    .maybeSingle();
                if (previewRow?.media_url && !sentMediaKeysForSession.has(normalizeMediaUrlKey(previewRow.media_url))) {
                    mediaUrl = previewRow.media_url;
                    mediaType = previewRow.media_type === 'video' ? 'video' : 'image';
                    selectedPreviewAsset = previewRow;
                }
            }
            if (!mediaUrl) {
                const fallbackPreview = await getRegisteredPreview(undefined, sentMediaUrlsForSession, requestedPreviewSpec.tags, false);
                if (fallbackPreview) {
                    mediaUrl = fallbackPreview.media_url;
                    mediaType = fallbackPreview.media_type === 'video' ? 'video' : 'image';
                    selectedPreviewAsset = fallbackPreview;
                }
            }
        } else {
            switch (aiResponse.action) {
                case 'send_shower_photo':
                case 'send_lingerie_photo':
                case 'send_wet_finger_photo':
                case 'send_ass_photo_preview': {
                    const registered = await getRegisteredPreview('image', sentMediaUrlsForSession, preferredPreviewTags, false)
                        || await getRegisteredPreview(undefined, sentMediaUrlsForSession, preferredPreviewTags, false);
                    mediaUrl = registered?.media_url || null;
                    mediaType = registered?.media_type === 'video' ? 'video' : 'image';
                    selectedPreviewAsset = registered;
                    break;
                }
                case 'send_video_preview':
                case 'send_hot_video_preview': {
                    const registered = await getRegisteredPreview('video', sentMediaUrlsForSession, preferredPreviewTags, false)
                        || await getRegisteredPreview('image', sentMediaUrlsForSession, preferredPreviewTags, false)
                        || await getRegisteredPreview(undefined, sentMediaUrlsForSession, preferredPreviewTags, false);
                    mediaUrl = registered?.media_url || null;
                    mediaType = registered?.media_type === 'video' ? 'video' : 'image';
                    selectedPreviewAsset = registered;
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
                        const paymentProduct = String(lastPayMsg.payment_data?.product || '');
                        const isSocialMeetupPayment = paymentProduct === 'social_meetup';
                        const storedPaid = lastPayMsg.payment_data?.paid === true || isPaymentPaidPayload(lastPayMsg.payment_data);

                        if (!paymentId) {
                            await sendTelegramMessage(botToken, chatId, "amor nao achei o codigo da transação aqui, manda o comprovante?");
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
                                content: `[SISTEMA: PAGAMENTO CONFIRMADO - ${lastPayMsg.payment_data?.description || paymentProduct || 'produto'} - R$ ${value}. TOTAL PAGO: R$ ${newTotal}]`
                            });

                            await sendTelegramMessage(
                                botToken,
                                chatId,
                                isSocialMeetupPayment
                                    ? 'pagamento confirmado, agora vamos alinhar e confirmar os detalhes do nosso encontro'
                                    : 'confirmado amor! obrigada, vou te mandar agora',
                            );

                            // Forçar IA a saber que pagou na proxima iteração se necessário, 
                            // mas aqui ela já recebe o input de sistema acima.
                            if (lastPayMsg.id) {
                                const confirmedAt = lastPayMsg.payment_data?.paid_at || new Date().toISOString();
                                await supabase.from('messages').update({
                                    payment_data: {
                                        ...(lastPayMsg.payment_data || {}),
                                        paid: true,
                                        counted: true,
                                        status: status || 'paid',
                                        fulfillment_status: isSocialMeetupPayment
                                            ? 'paid_awaiting_scheduling'
                                            : lastPayMsg.payment_data?.fulfillment_status || 'paid',
                                        paid_at: confirmedAt,
                                        last_checked_at: new Date().toISOString(),
                                        last_status_payload: statusData
                                    }
                                }).eq('id', lastPayMsg.id);
                                if (paymentProduct === 'custom_request') {
                                    await markCustomOrderPaidSafe(String(paymentId), confirmedAt);
                                }
                            }
                            const paymentOutcomeEventId = await appendLeadEventSafe({
                                sessionId: String(session.id),
                                eventType: 'payment_confirmed',
                                source: 'backend',
                                sourceId: String(paymentId),
                                payload: {
                                    payment_id: paymentId,
                                    product: paymentProduct || lastPayMsg.payment_data?.description || null,
                                    amount: Number(value || 0),
                                    total_confirmed: newTotal,
                                    gateway: lastPayMsg.payment_data?.gateway || null,
                                },
                            });
                            const paymentOutcome = await trackPaymentOutcomeSafe({
                                sessionId: String(session.id),
                                eventId: paymentOutcomeEventId,
                                amount: Number(value || 0),
                                product: String(paymentProduct || lastPayMsg.payment_data?.description || 'produto'),
                            });
                            if (paymentOutcome.previewId) await recordPreviewPurchaseSafe(paymentOutcome.previewId);
                            await patchRealityStateSafe(String(session.id), {
                                payment: {
                                    totalConfirmed: newTotal,
                                    lastConfirmedValue: Number(value || 0),
                                    pendingPaymentId: null,
                                },
                                commercial: {
                                    lastProductBought: paymentProduct || lastPayMsg.payment_data?.description || null,
                                    lastPurchaseAt: new Date().toISOString(),
                                    postPurchaseCooldownUntil: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
                                },
                            });
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
                            await sendTelegramMessage(botToken, chatId, "amor ainda não caiu aqui, tem certeza? (Status: " + status + ")");
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
                    const isSocialMeetup = salesTiming.activeProduct === 'social_meetup';
                    const paymentProduct = isSocialMeetup ? 'social_meetup' : (salesTiming.activeProduct || 'custom_offer');
                    const inferredValue = inferPixValue([
                        ...(Array.isArray(aiResponse.messages) ? aiResponse.messages : []),
                        combinedText,
                        lastBotMsg?.content || ''
                    ]);
                    const negotiatedUserValue = extractNegotiatedUserValue(userOnlyText);
                    // O backend, e nao apenas o modelo, garante o preco ja aceito/planejado.
                    // Isso evita cobrar acima do limite declarado ou trocar o produto no fechamento.
                    const value = isSocialMeetup
                        ? 500
                        : Number(salesTiming.offerPlan?.value ?? negotiatedUserValue ?? aiResponse.payment_details?.value ?? inferredValue ?? 19.90);
                    const description = isSocialMeetup
                        ? 'Encontro com Larissa Morais'
                        : (salesTiming.offerPlan?.description || aiResponse.payment_details?.description || "Pack Exclusivo");
                    const customRequestBrief = paymentProduct === 'custom_request'
                        ? String(salesTiming.customRequestBrief || salesTiming.offerPlan?.requestBrief || aiResponse.payment_details?.description || 'pedido personalizado').trim().slice(0, 2_000)
                        : null;
                    const idempotencyKey = `${session.id}:${paymentProduct}:${value.toFixed(2)}`;
                    // Idempotencia por sessao + produto + valor: uma nova tentativa
                    // reenviara exatamente o mesmo PIX, mesmo se outro produto tiver
                    // gerado uma cobranca mais recente na conversa.
                    const { data: lastPixMsg } = await supabase
                        .from('messages')
                        .select('id, payment_data, created_at')
                        .eq('session_id', session.id)
                        .eq('sender', 'system')
                        .ilike('content', '%PIX GENERATED%')
                        .filter('payment_data->>idempotency_key', 'eq', idempotencyKey)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    const lastPaymentData: any = lastPixMsg?.payment_data || {};
                    const sameValue = Number(lastPaymentData.value || 0) === Number(value);
                    const sameProduct = String(lastPaymentData.product || '') === paymentProduct
                        || (!lastPaymentData.product && String(lastPaymentData.description || '') === description);
                    const sameGateway = !isSocialMeetup || String(lastPaymentData.gateway || '') === 'wiinpay';
                    const notPaid = lastPaymentData.paid !== true;
                    const lastPixCode = lastPaymentData.pixCopiaCola;
                    const lastPaymentId = lastPaymentData.paymentId;

                    if (isSocialMeetup && sameValue && sameProduct && !notPaid) {
                        await sendTelegramMessage(botToken, chatId, 'seu encontro ja esta pago, agora falta so alinhar e confirmar os detalhes certinhos');
                        break;
                    }

                    if (sameValue && sameProduct && sameGateway && notPaid && lastPixCode) {
                        await sendTelegramMessage(botToken, chatId, "ta aqui o pix de novo amor");
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
                        await appendLeadEventSafe({
                            sessionId: String(session.id),
                            eventType: 'payment_resent',
                            source: 'backend',
                            sourceId: `${lastPaymentId || 'unknown'}:${triggerMessageId || lastGroupedUserAt}`,
                            payload: {
                                payment_id: lastPaymentId || null,
                                gateway: lastPaymentData.gateway || null,
                                product: paymentProduct,
                                amount: value,
                                description,
                            },
                        });
                        await patchRealityStateSafe(String(session.id), {
                            payment: { pendingPaymentId: String(lastPaymentId || '') || null },
                        });
                        paymentCreatedThisTurn = true;
                        break;
                    }
                    // Gerar Pagamento
                    const payment = await createPaymentMultiGateway({
                        value: value,
                        name: session.user_name || "Anônimo",
                        email: (session.user_name && session.user_name.toLowerCase().includes('operação kaique'))
                            ? 'operaçaokaique@gmail.com'
                            : `user_${chatId}@telegram.com`,
                        description: description,
                        metadata: {
                            session_id: session.id,
                            product: paymentProduct,
                            idempotency_key: idempotencyKey,
                            ...(customRequestBrief ? { custom_request_brief: customRequestBrief } : {}),
                        },
                    }, isSocialMeetup ? { onlyGateway: 'wiinpay' } : {});

                    // LOG DE DEBUG
                    await supabase.from('messages').insert({
                        session_id: session.id,
                        sender: 'system',
                        content: `[DEBUG] Resposta Gateway PIX: ${JSON.stringify(payment)}`
                    });

                    if (payment && payment.pixCopiaCola) {
                        await sendTelegramMessage(botToken, chatId, "ta aqui o pix amor");
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
                                product: paymentProduct,
                                custom_request_brief: customRequestBrief,
                                idempotency_key: idempotencyKey,
                                fulfillment_status: isSocialMeetup ? 'awaiting_payment' : 'pending',
                                pixCopiaCola: payment.pixCopiaCola,
                                qrCodeBase64: payment.qrCodeBase64 || null,
                                paid: false,
                                status: payment.status || 'pending'
                            }
                        });
                        if (customRequestBrief) {
                            await recordCustomOrderSafe({
                                sessionId: String(session.id),
                                paymentId: String(payment.paymentId),
                                gateway: payment.gateway,
                                requestBrief: customRequestBrief,
                                amount: value,
                                paymentData: {
                                    description,
                                    product: paymentProduct,
                                    idempotency_key: idempotencyKey,
                                },
                            });
                        }
                        await appendLeadEventSafe({
                            sessionId: String(session.id),
                            eventType: 'payment_created',
                            source: 'backend',
                            sourceId: String(payment.paymentId),
                            payload: {
                                payment_id: payment.paymentId,
                                gateway: payment.gateway,
                                product: paymentProduct,
                                amount: value,
                                description,
                            },
                        });
                        await patchRealityStateSafe(String(session.id), {
                            payment: { pendingPaymentId: String(payment.paymentId) },
                        });
                        paymentCreatedThisTurn = true;
                    } else {
                        await sendTelegramMessage(botToken, chatId, "amor o sistema caiu aqui rapidinho, tenta daqui a pouco?");
                    }
                } catch (err: any) {
                    console.error("Erro Pagamento:", err);
                    // LOG DE ERRO DEBUG
                    await supabase.from('messages').insert({
                        session_id: session.id,
                        sender: 'system',
                        content: `[DEBUG] Erro Gateway PIX: ${err.message || JSON.stringify(err)}`
                    });

                    await sendTelegramMessage(botToken, chatId, "amor nao consegui gerar o pix agora, que raiva");
                }
                break;
            }
        }

        if (!mediaUrl && MEDIA_ACTIONS.has(String(aiResponse.action || ''))) {
            const registered = await getRegisteredPreview(undefined, sentMediaUrlsForSession, preferredPreviewTags, false);
            if (registered?.media_url) {
                mediaUrl = registered.media_url;
                mediaType = registered.media_type || 'image';
                selectedPreviewAsset = registered;
            }
        }

        if (mediaUrl) {
            const protectedAdultAction = ['send_hot_video_preview', 'send_wet_finger_photo'].includes(String(aiResponse.action || ''));
            const protectionForPreview = (asset: any): TelegramMediaProtection => protectedAdultAction || shouldProtectAdultPreview(asset)
                ? { protectContent: true, hasSpoiler: true }
                : {};
            let mediaProtection = protectionForPreview(selectedPreviewAsset);
            const sendResolvedMedia = async (
                type: string,
                url: string,
                protection: TelegramMediaProtection = mediaProtection,
                asset: any = selectedPreviewAsset,
            ) => {
                const isVideo = type === 'video';
                const recentCaptions = Array.isArray(operationalLeadMemory.metadata?.preview_caption_history)
                    ? operationalLeadMemory.metadata.preview_caption_history.map(String).filter(Boolean)
                    : [];
                const generatedCaption = previewCaptionCandidate || buildDeliveredPreviewCaption({
                    asset,
                    userText: userOnlyText,
                    timeZone: String(operationalLeadMemory.metadata?.redirect_timezone || ''),
                    recentCaptions,
                    variationKey: `${session.id}:${triggerMessageId || lastGroupedUserAt}`,
                });
                const caption = sanitizeOutgoingMessage(generatedCaption, latestUserText).slice(0, 85);
                if (isVideo) {
                    await sendTelegramAction(botToken, chatId, 'upload_video');
                    const heartbeat = setInterval(() => {
                        void sendTelegramAction(botToken, chatId, 'upload_video');
                    }, 4_000);
                    try {
                        await sendTelegramVideo(botToken, chatId, url, caption, protection);
                    } finally {
                        clearInterval(heartbeat);
                    }
                    return caption;
                }

                const timeZone = String(operationalLeadMemory.metadata?.redirect_timezone || '');
                const isTakenNow = isPhotoTakenNow({
                    asset,
                    timeZone,
                });

                // Se a foto é no contexto "tirada agora", aplica um delay realista maior
                // simulando o tempo de pegar o celular, fazer a pose e tirar a foto na hora!
                const photoPreparationDelayMs = isTakenNow
                    ? randomBetween(4200, 6800)
                    : randomBetween(1500, 2500);

                await waitWithChatAction('upload_photo', photoPreparationDelayMs);
                const heartbeat = setInterval(() => {
                    void sendTelegramAction(botToken, chatId, 'upload_photo');
                }, 4_000);
                try {
                    await sendTelegramPhoto(botToken, chatId, url, caption, protection);
                } finally {
                    clearInterval(heartbeat);
                }
                return caption;
            };

            const { data: recentMediaRows } = await supabase
                .from('messages')
                .select('media_url')
                .eq('session_id', session.id)
                .eq('sender', 'bot')
                .not('media_url', 'is', null)
                .order('created_at', { ascending: false })
                .limit(1000);
            const recentUrls = new Set((recentMediaRows || []).map((row: any) => String(row.media_url || '')).filter(Boolean));
            const recentUrlKeys = new Set([...recentUrls].map(normalizeMediaUrlKey).filter(Boolean));

            if (recentUrlKeys.has(normalizeMediaUrlKey(mediaUrl))) {
                const alternative = await getRegisteredPreview(
                    mediaType === 'video' ? 'video' : 'image',
                    [...recentUrls, String(mediaUrl)],
                );
                if (alternative?.media_url) {
                    mediaUrl = alternative.media_url;
                    mediaType = alternative.media_type === 'video' ? 'video' : 'image';
                    selectedPreviewAsset = alternative;
                    mediaProtection = protectionForPreview(alternative);
                } else {
                    console.log('[PREVIAS] Entrega cancelada porque só restavam arquivos repetidos.');
                    await persistMediaDeliveryStatus('failed');
                    return NextResponse.json({ success: true, mediaSkipped: 'duplicate_catalog_exhausted' });
                }
            }

            let deliveredUrl = String(mediaUrl);
            let deliveredType = String(mediaType || '');
            let deliveredCaption = '';
            const deliveryErrors: string[] = [];
            let deliveryRecovered = false;

            try {
                deliveredCaption = await sendResolvedMedia(deliveredType, deliveredUrl, mediaProtection, selectedPreviewAsset);
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
                    registeredSameType && {
                        url: String(registeredSameType.media_url),
                        type: String(registeredSameType.media_type),
                        protection: protectionForPreview(registeredSameType),
                        asset: registeredSameType,
                    },
                    registeredAnyType && {
                        url: String(registeredAnyType.media_url),
                        type: String(registeredAnyType.media_type),
                        protection: protectionForPreview(registeredAnyType),
                        asset: registeredAnyType,
                    },
                ].filter((candidate): candidate is { url: string; type: string; protection: TelegramMediaProtection; asset: any } => Boolean(candidate?.url));

                let recovered = false;
                for (const candidate of fallbackCandidates) {
                    try {
                        deliveredCaption = await sendResolvedMedia(candidate.type, candidate.url, candidate.protection, candidate.asset);
                        deliveredUrl = candidate.url;
                        deliveredType = candidate.type;
                        mediaProtection = candidate.protection;
                        selectedPreviewAsset = candidate.asset;
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
                    return NextResponse.json({ success: false, mediaError: true });
                }

                await supabase.from('messages').insert({
                    session_id: session.id,
                    sender: 'system',
                    content: `[MÍDIA RECUPERADA] ${deliveryErrors[0].slice(0, 900)} | fallback: ${deliveredType}:${deliveredUrl}`
                });
            }

            await insertGeneratedMessage({
                session_id: session.id,
                sender: 'bot',
                content: deliveredCaption || (mediaProtection.protectContent
                    ? `[MÍDIA PROTEGIDA: ${aiResponse.action}]`
                    : `[MÍDIA: ${aiResponse.action}]`),
                media_url: deliveredUrl,
                media_type: deliveredType
            });
            await persistMediaDeliveryStatus(deliveryRecovered ? 'recovered' : 'delivered', {
                mediaType: deliveredType,
                mediaUrl: deliveredUrl,
                protected: mediaProtection.protectContent === true,
                caption: deliveredCaption,
            });
            await appendLeadEventSafe({
                sessionId: String(session.id),
                eventType: 'preview_sent',
                source: 'backend',
                sourceId: `${triggerMessageId || lastGroupedUserAt}:preview:${selectedPreviewAsset?.id || normalizeMediaUrlKey(deliveredUrl)}`,
                payload: {
                    preview_id: selectedPreviewAsset?.id || null,
                    media_type: deliveredType,
                    media_url: deliveredUrl,
                    protected: mediaProtection.protectContent === true,
                    recovered: deliveryRecovered,
                    requested_by_lead: userAskedMedia || userAffirmedMedia,
                    caption: deliveredCaption || null,
                },
            });
            const previousSentPreviewIds = brainRuntime.reality.media.sentPreviewIds || [];
            const deliveredPreviewId = String(selectedPreviewAsset?.id || '').trim();
            await patchRealityStateSafe(String(session.id), {
                media: {
                    lastPreviewId: deliveredPreviewId || null,
                    lastMediaUrl: deliveredUrl,
                    sentPreviewIds: deliveredPreviewId
                        ? Array.from(new Set([...previousSentPreviewIds, deliveredPreviewId])).slice(-100)
                        : previousSentPreviewIds,
                },
            });
            if (deliveredPreviewId) await recordPreviewSentSafe(deliveredPreviewId);
            await sendDeferredMediaReaction();
        } else if (isMediaDeliveryTurn && userAskedMedia) {
            await persistMediaDeliveryStatus('failed');
            if (userAskedPhoto) {
                await registerMissingPhotoRequest({
                    userText: userOnlyText,
                    description: requestedPreviewSpec.description,
                    tags: requestedPreviewSpec.tags,
                    action: aiResponse.action,
                    sessionId: session.id,
                }).catch((error: any) => {
                    console.warn('[PREVIAS] Falha ao registrar lacuna:', error?.message || error);
                });
            }
        }
    }

    // A análise pode usar outra IA, mas nunca segura os balões: só aguardamos a
    // persistência depois que a resposta ao lead já foi entregue.
    if (pendingPhotoRequestAnalysis) await pendingPhotoRequestAnalysis;
    if (paymentCreatedThisTurn) {
        nextStep = 'PAYMENT_CHECK';
        const { error: paymentStepError } = await supabase
            .from('sessions')
            .update({ funnel_step: nextStep })
            .eq('id', session.id);
        if (paymentStepError) {
            console.warn('[VENDA] PIX criado, mas falhou ao persistir PAYMENT_CHECK:', paymentStepError.message);
        } else if (previousStep !== nextStep) {
            await supabase.from('funnel_events').insert({
                session_id: session.id,
                step: nextStep,
                source: 'backend',
            });
        }
    }
    await persistBrainAfterTurn();

    return NextResponse.json({
        success: true,
        debug_stats: aiResponse.lead_stats,
        debug_funnel: nextStep
    });
    } catch (error: any) {
        const reason = String(error?.message || error || 'erro desconhecido');
        console.error(`[PROCESSADOR] Falha recuperavel na sessao ${sessionId}:`, reason);

        try {
            const { data: alreadyDelivered } = await supabase
                .from('messages')
                .select('id')
                .eq('session_id', sessionId)
                .eq('sender', 'bot')
                .gte('created_at', processingAttemptStartedAt)
                .limit(1);

            if (!alreadyDelivered?.length) {
                const { data: recentRecoveryRows, error: recentRecoveryError } = await supabase
                    .from('messages')
                    .select('sender,content,created_at')
                    .eq('session_id', sessionId)
                    .in('sender', ['user', 'bot'])
                    .order('created_at', { ascending: false })
                    .limit(80);
                if (recentRecoveryError) throw recentRecoveryError;

                const recentRows = recentRecoveryRows || [];
                const latestText = String(recentRows.find((row: any) => row.sender === 'user')?.content || '').trim();
                const recentBotTexts = recentRows
                    .filter((row: any) => row.sender === 'bot')
                    .map((row: any) => String(row.content || ''))
                    .filter(Boolean);
                const recentUserTexts = recentRows
                    .filter((row: any) => row.sender === 'user')
                    .map((row: any) => String(row.content || ''))
                    .filter(Boolean);
                const fallbackMessages = buildProcessingFailureRecoveryMessages({
                    userText: latestText,
                    recentBotTexts,
                    recentUserTexts,
                    isFirstContact: recentBotTexts.length === 0 && recentUserTexts.length <= 1,
                    language: detectConversationLanguage(latestText),
                });
                const safeReason = reason
                    .replace(/(?:sk|key|token|secret)[-_][a-z0-9_-]{8,}/gi, '[REDACTED]')
                    .slice(0, 1200);
                const recoveryDebug = {
                    timestamp: new Date().toISOString(),
                    run_id: `local-recovery-${crypto.randomUUID()}`,
                    model: 'contextual-local-recovery',
                    provider: 'local',
                    tier: 'recovery',
                    duration_ms: Math.max(0, Date.now() - Date.parse(processingAttemptStartedAt)),
                    system_prompt: 'Recuperação contextual determinística acionada após falha do processamento principal.',
                    user_prompt: latestText,
                    clean_history: recentRows.slice().reverse().map((row: any) => ({
                        role: row.sender === 'bot' ? 'assistant' : 'user',
                        content: String(row.content || ''),
                    })),
                    raw_response: { recovery_reason: safeReason },
                    final_response: { messages: fallbackMessages, action: 'none', recovered: true },
                };

                for (let recoveryIndex = 0; recoveryIndex < fallbackMessages.length; recoveryIndex += 1) {
                    const fallbackMessage = fallbackMessages[recoveryIndex];
                    await sendTelegramMessage(botToken, chatId, fallbackMessage);
                    const recoveryInsert = await insertMessageWithAiDebug(supabase, {
                        session_id: session.id,
                        sender: 'bot',
                        content: fallbackMessage,
                    }, withAiDebugMessageIndex(recoveryDebug, recoveryIndex));
                    if (recoveryInsert.debugError) {
                        console.warn('[AI DEBUG] Recuperacao salva sem ai_debug:', errorMessage(recoveryInsert.debugError));
                    }
                    if (recoveryInsert.error) {
                        console.warn('[PROCESSADOR] Falha ao persistir recuperacao:', errorMessage(recoveryInsert.error));
                    }
                }
                console.log(`[PROCESSADOR] Recuperacao contextual enviada para a sessao ${sessionId}.`);
            } else {
                console.log(`[PROCESSADOR] Recuperacao local dispensada: a sessao ${sessionId} ja recebeu resposta.`);
            }
        } catch (recoveryError: any) {
            console.error('[PROCESSADOR] Falha ao entregar recuperacao local:', recoveryError?.message || recoveryError);
        }

        return NextResponse.json({ success: true, recovered: true, reason }, { status: 200 });
    } finally {
        await releaseProcessingLease();
    }
}
