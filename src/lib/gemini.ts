import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { AIResponse, LeadStats, AiDebugData } from "@/types";
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import {
    DEFAULT_BAI_MODEL,
    DEFAULT_GEMINI_FALLBACK_MODEL,
    DEFAULT_GEMINI_LITE_MODEL,
    DEFAULT_GEMINI_MODEL,
    DEFAULT_GROQ_QUALITY_MODEL,
    DEFAULT_GROQ_STARTER_MODEL,
    DEFAULT_OPENROUTER_MODEL,
    GEMINI_MODEL_OPTIONS,
    isBaiVisionModel,
    normalizeBaiModelName,
    normalizeGeminiModelName,
    normalizeGroqModelName,
    normalizeOpenRouterPrimaryModel,
    OPENROUTER_MODEL_FALLBACK_ORDER,
} from '@/lib/aiModels';
import { buildCleanAiHistory } from '@/lib/aiHistory';
import { toSerializableDebugValue } from '@/lib/aiDebug';
import { normalizeAiMessageList } from '@/lib/aiMessageNormalization';
import { filterConversationEpisodeMessages } from '@/lib/conversationEpisode';
import { scorePreviewForContext } from '@/lib/previewCatalog';
import {
    resolveAiOrchestrationPlan,
    shouldRunAiReview,
    type AiIntelligenceTier,
} from '@/lib/aiOrchestration';
import {
    aiGatewayRouter,
    estimateAiTokens,
    GatewayCapacityError,
    resolveGatewayRatePolicy,
    type GatewayRatePolicy,
    type GatewayRouteCandidate,
} from '@/lib/aiGatewayRouter';
import { VIP_PRICE } from '@/lib/salesTiming';
import {
    buildLariCorePrompt,
    buildLariDraftPrompt,
    buildLariReviewPrompt,
    needsLariReview,
} from '@/lib/lariConversationPrompts';

const readSecret = (value?: string) => {
    const secret = String(value || "").trim();
    if (!secret || secret.startsWith("YOUR_")) return "";
    return secret;
};

const envGeminiApiKey = readSecret(process.env.GEMINI_API_KEY);
const envOpenRouterApiKey = readSecret(process.env.OPENROUTER_API_KEY);
const defaultOpenRouterBaseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const defaultOpenRouterReferer = process.env.OPENROUTER_REFERER || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const defaultOpenRouterTitle = process.env.OPENROUTER_TITLE || "Lari Telegram Bot";


// Schema de resposta estruturada do Gemini.
// Note: @google/generative-ai uses a specific schema format.
const responseSchema = {
    type: "OBJECT", // Use string literal for simplicity with new SDK
    properties: {
        internal_thought: { type: "STRING", description: "Resumo operacional curto sobre intencao, objetivo e proximo passo. Sem raciocinio passo a passo. Em portugues." },
        lead_classification: { type: "STRING", enum: ["carente", "tarado", "curioso", "frio", "desconhecido"] },
        lead_stats: {
            type: "OBJECT",
            properties: {
                tarado: { type: "NUMBER" },
                carente: { type: "NUMBER" },
                sentimental: { type: "NUMBER" },
                financeiro: { type: "NUMBER" },
            },
            required: ["tarado", "carente", "sentimental", "financeiro"], // OBRIGATÓRIO: Sempre mande o estado completo.
        },
        extracted_user_name: { type: "STRING", nullable: true },
        audio_transcription: { type: "STRING", nullable: true, description: "Se o usuário enviou um áudio, transcreva EXATAMENTE o que ele disse aqui. Se não for áudio, mande null." },
        current_state: {
            type: "STRING",
            enum: [
                "WELCOME", "CONNECTION", "TRIGGER_PHASE", "HOT_TALK", "PREVIEW", "SALES_PITCH", "NEGOTIATION", "CLOSING", "PAYMENT_CHECK"
            ]
        },
        messages: {
            type: "ARRAY",
            items: { type: "STRING" }
        },
        action: {
            type: "STRING",
            enum: [
                "none", "send_video_preview", "send_hot_video_preview", "send_ass_photo_preview", "send_custom_preview",
                "generate_pix_payment", "check_payment_status", "send_shower_photo", "send_lingerie_photo",
                "send_wet_finger_photo", "send_voice_reply"
            ]
        },
        preview_id: { type: "STRING", nullable: true },
        preview_request: {
            type: "OBJECT",
            nullable: true,
            properties: {
                media_type: { type: "STRING", enum: ["photo", "video"] },
                description: { type: "STRING" },
                tags: { type: "ARRAY", items: { type: "STRING" } },
                reason: { type: "STRING", nullable: true }
            },
            required: ["media_type", "description", "tags"]
        },
        payment_details: {
            type: "OBJECT",
            nullable: true,
            properties: {
                value: { type: "NUMBER" },
                description: { type: "STRING" }
            }
        },
        lead_memory_patch: {
            type: "OBJECT",
            nullable: true,
            properties: {
                best_tone: { type: "STRING" },
                emotional_context: { type: "STRING" },
                relationship_stage: { type: "STRING", enum: ["new", "familiar", "engaged", "buyer", "returning"] },
                next_personal_step: { type: "STRING" },
                wanted_products: { type: "ARRAY", items: { type: "STRING" } },
                rejected_products: { type: "ARRAY", items: { type: "STRING" } },
                desires: { type: "ARRAY", items: { type: "STRING" } },
                objections: { type: "ARRAY", items: { type: "STRING" } },
                known_facts: { type: "ARRAY", items: { type: "STRING" } },
                conversation_hooks: { type: "ARRAY", items: { type: "STRING" } },
                notes: { type: "ARRAY", items: { type: "STRING" } }
            }
        },
        next_best_action: {
            type: "STRING",
            enum: [
                "TALK", "REACT", "ASK", "FLIRT", "REASSURE", "SEND_PREVIEW", "SEND_FREE_MEDIA",
                "EXPLORE_DESIRE", "BUILD_VALUE", "MAKE_OFFER", "HANDLE_OBJECTION", "NEGOTIATE",
                "CLOSE", "GENERATE_PAYMENT", "CHECK_PAYMENT", "DELIVER", "POST_PURCHASE",
                "COOLDOWN", "CHANGE_TOPIC"
            ]
        },
        decision_confidence: { type: "NUMBER" },
        offer_id: { type: "STRING", nullable: true },
        memory_updates: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    kind: { type: "STRING", enum: ["fact", "hypothesis", "preference", "episode", "outcome"] },
                    key: { type: "STRING" },
                    content: { type: "STRING" },
                    confidence: { type: "NUMBER" },
                    importance: { type: "NUMBER" },
                    status: { type: "STRING", enum: ["active", "superseded", "uncertain", "expired"] }
                },
                required: ["kind", "key", "content", "confidence", "importance", "status"]
            }
        }
    },
    required: ["internal_thought", "lead_classification", "lead_stats", "current_state", "messages", "action", "lead_memory_patch", "next_best_action", "decision_confidence", "memory_updates"],
};

const centralBrainSchema = {
    type: "OBJECT",
    properties: {
        intent: { type: "STRING" },
        lead_type: { type: "STRING", enum: ["carente", "tarado", "curioso", "frio", "desconhecido"] },
        temperature: { type: "NUMBER" },
        emotional_context: { type: "STRING" },
        relationship_stage: { type: "STRING", enum: ["new", "familiar", "engaged", "buyer", "returning"] },
        connection_cue: { type: "STRING" },
        objective: { type: "STRING" },
        product_to_sell: { type: "STRING", nullable: true },
        should_sell_now: { type: "BOOLEAN" },
        response_angle: { type: "STRING" },
        must_answer: { type: "STRING" },
        next_step: { type: "STRING" },
        next_best_action: {
            type: "STRING",
            enum: [
                "TALK", "REACT", "ASK", "FLIRT", "REASSURE", "SEND_PREVIEW", "SEND_FREE_MEDIA",
                "EXPLORE_DESIRE", "BUILD_VALUE", "MAKE_OFFER", "HANDLE_OBJECTION", "NEGOTIATE",
                "CLOSE", "GENERATE_PAYMENT", "CHECK_PAYMENT", "DELIVER", "POST_PURCHASE",
                "COOLDOWN", "CHANGE_TOPIC"
            ]
        },
        message_plan: {
            type: "ARRAY",
            items: { type: "STRING" }
        },
        recommended_message_count: { type: "NUMBER" },
        max_chars_per_message: { type: "NUMBER" },
        avoid: {
            type: "ARRAY",
            items: { type: "STRING" }
        },
        action_hint: {
            type: "STRING",
            enum: [
                "none", "send_video_preview", "send_hot_video_preview", "send_ass_photo_preview", "send_custom_preview",
                "generate_pix_payment", "check_payment_status", "send_shower_photo", "send_lingerie_photo",
                "send_wet_finger_photo", "send_voice_reply"
            ]
        },
        payment_value_hint: { type: "NUMBER", nullable: true },
        confidence: { type: "NUMBER" },
        memory_patch: {
            type: "OBJECT",
            properties: {
                best_tone: { type: "STRING" },
                emotional_context: { type: "STRING" },
                relationship_stage: { type: "STRING", enum: ["new", "familiar", "engaged", "buyer", "returning"] },
                next_personal_step: { type: "STRING" },
                wanted_products: { type: "ARRAY", items: { type: "STRING" } },
                rejected_products: { type: "ARRAY", items: { type: "STRING" } },
                desires: { type: "ARRAY", items: { type: "STRING" } },
                objections: { type: "ARRAY", items: { type: "STRING" } },
                known_facts: { type: "ARRAY", items: { type: "STRING" } },
                conversation_hooks: { type: "ARRAY", items: { type: "STRING" } },
                notes: { type: "ARRAY", items: { type: "STRING" } }
            },
            required: ["best_tone", "emotional_context", "relationship_stage", "next_personal_step", "wanted_products", "rejected_products", "desires", "objections", "known_facts", "conversation_hooks", "notes"]
        }
    },
    required: ["intent", "lead_type", "temperature", "emotional_context", "relationship_stage", "connection_cue", "objective", "should_sell_now", "response_angle", "must_answer", "next_step", "next_best_action", "message_plan", "recommended_message_count", "max_chars_per_message", "avoid", "action_hint", "confidence", "memory_patch"],
};

const reviewSchema = {
    type: "OBJECT",
    properties: {
        approved: { type: "BOOLEAN" },
        score: { type: "NUMBER" },
        issues: {
            type: "ARRAY",
            items: { type: "STRING" }
        },
        messages: {
            type: "ARRAY",
            items: { type: "STRING" }
        },
        action: {
            type: "STRING",
            enum: [
                "none", "send_video_preview", "send_hot_video_preview", "send_ass_photo_preview", "send_custom_preview",
                "generate_pix_payment", "check_payment_status", "send_shower_photo", "send_lingerie_photo",
                "send_wet_finger_photo", "send_voice_reply"
            ]
        },
        current_state: {
            type: "STRING",
            enum: [
                "WELCOME", "CONNECTION", "TRIGGER_PHASE", "HOT_TALK", "PREVIEW", "SALES_PITCH", "NEGOTIATION", "CLOSING", "PAYMENT_CHECK"
            ]
        },
        preview_id: { type: "STRING", nullable: true },
        payment_details: {
            type: "OBJECT",
            nullable: true,
            properties: {
                value: { type: "NUMBER" },
                description: { type: "STRING" }
            }
        }
    },
    required: ["approved", "score", "issues", "messages", "action", "current_state"],
};

const REVIEW_ACTIONS = new Set([
    'none', 'send_video_preview', 'send_hot_video_preview', 'send_ass_photo_preview', 'send_custom_preview',
    'generate_pix_payment', 'check_payment_status', 'send_shower_photo', 'send_lingerie_photo',
    'send_wet_finger_photo', 'send_voice_reply',
]);
const REVIEW_STATES = new Set([
    'WELCOME', 'CONNECTION', 'TRIGGER_PHASE', 'HOT_TALK', 'PREVIEW',
    'SALES_PITCH', 'NEGOTIATION', 'CLOSING', 'PAYMENT_CHECK',
]);

export const getSystemInstruction = (
    userCity: string = "",
    _deprecatedNeighborCity: string = "",
    isHighTicketDevice: boolean = false,
    totalPaid: number = 0,
    currentStats: LeadStats | null = null,
    minutesSinceOffer: number = 999,
    previewsCatalog: string = "",
    extraScript: string = "",
    leadMemory: any = null,
    antiRepeatText: string = "",
    leadProfile: any = null,
) => {
    const now = new Date();
    const profile = leadProfile && typeof leadProfile === 'object' && !Array.isArray(leadProfile)
        ? leadProfile
        : {};
    const requestedTimeZone = String(profile.timezone || '').trim();
    let effectiveTimeZone = 'America/Sao_Paulo';
    if (requestedTimeZone) {
        try {
            new Intl.DateTimeFormat('pt-BR', { timeZone: requestedTimeZone }).format(now);
            effectiveTimeZone = requestedTimeZone;
        } catch {
            effectiveTimeZone = 'America/Sao_Paulo';
        }
    }
    const hour = Number(new Intl.DateTimeFormat('pt-BR', {
        timeZone: effectiveTimeZone,
        hour: '2-digit',
        hour12: false,
    }).format(now));
    const period = hour < 6 ? 'madrugada' : hour < 12 ? 'manha' : hour < 18 ? 'tarde' : 'noite';
    const time = now.toLocaleTimeString('pt-BR', {
        timeZone: effectiveTimeZone,
        hour: '2-digit',
        minute: '2-digit',
    });
    const stats = currentStats || { tarado: 0, carente: 0, sentimental: 0, financeiro: 0 };
    const list = (value: any) => Array.isArray(value) && value.length > 0 ? value.join(', ') : 'nenhum';
    const memory = leadMemory && typeof leadMemory === 'object' ? leadMemory : {};
    const cleanProfileValue = (value: unknown, max = 260) => String(value || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max) || 'desconhecido';
    const compactObject = (value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return 'nenhum';
        const entries = Object.entries(value as Record<string, unknown>)
            .slice(0, 16)
            .map(([key, item]) => `${cleanProfileValue(key, 60)}=${cleanProfileValue(item, 180)}`);
        return entries.length > 0 ? entries.join(', ') : 'nenhum';
    };
    const deviceType = cleanProfileValue(profile.deviceType || (isHighTicketDevice ? 'iPhone' : 'Unknown'), 80);
    const memorySummary = [
        `tipo dominante: ${cleanProfileValue(memory.dominant_type)}`,
        `tom que funciona: ${cleanProfileValue(memory.best_tone)}`,
        `contexto emocional: ${cleanProfileValue(memory.emotional_context)}`,
        `estagio da relacao: ${cleanProfileValue(memory.relationship_stage || 'new')}`,
        `proximo passo pessoal: ${cleanProfileValue(memory.next_personal_step)}`,
        `produtos desejados: ${list(memory.wanted_products)}`,
        `produtos recusados: ${list(memory.rejected_products)}`,
        `desejos e preferencias: ${list(memory.desires)}`,
        `objecoes: ${list(memory.objections)}`,
        `fatos confirmados: ${list(memory.known_facts)}`,
        `ganchos pendentes: ${list(memory.conversation_hooks)}`,
        `sensibilidade a preco: ${cleanProfileValue(memory.price_sensitivity)}`,
        `ultima oferta: ${cleanProfileValue(memory.last_offer)}`,
        `notas: ${list(memory.notes)}`,
    ].join('\n- ');

    return buildLariCorePrompt({
        localTime: time,
        localPeriod: period,
        city: userCity,
        deviceType,
        profileSummary: compactObject(profile),
        totalPaid,
        offerAgeMinutes: minutesSinceOffer,
        stats,
        memorySummary,
        previewsCatalog,
        antiRepeatText,
        dynamicInstructions: extraScript,
    });
};

// Helper para garantir que Stats sejam sempre numéricos e válidos
export const parseLeadStats = (input: any): LeadStats => {
    let stats = input;

    // Se vier string JSON (bug do banco/ai)
    if (typeof stats === 'string') {
        try {
            stats = JSON.parse(stats);
        } catch (e) {
            stats = {};
        }
    }

    // Se for nulo ou indefinido
    if (!stats) stats = {};

    if (Object.keys(stats).length == 0) {
        stats = { tarado: 5, financeiro: 10, carente: 20, sentimental: 20 };
    }

    const clamp = (n: number) => Math.max(0, Math.min(100, n));

    return {
        tarado: clamp(Number(stats.tarado) || 0),
        financeiro: clamp(Number(stats.financeiro) || 0),
        carente: clamp(Number(stats.carente) || 0),
        sentimental: clamp(Number(stats.sentimental) || 0)
    };
};

let genAI: GoogleGenerativeAI | null = null;
let genAIKey = "";

export const initializeGenAI = (runtimeGeminiApiKey: string = envGeminiApiKey) => {
    const key = readSecret(runtimeGeminiApiKey);
    if (key && (!genAI || genAIKey !== key)) {
        genAI = new GoogleGenerativeAI(key);
        genAIKey = key;
    }
    return genAI;
}

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

export const repairJsonText = (text: string): string => {
    let clean = String(text || '').trim();
    if (!clean) return '{}';

    // 1. Limpa blocos de markdown
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    // 2. Extrai o bloco externo JSON { ... } ou [ ... ] se houver texto ao redor
    const firstBrace = clean.indexOf('{');
    const firstBracket = clean.indexOf('[');
    let startIdx = -1;
    let endIdx = -1;

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        startIdx = firstBrace;
        endIdx = clean.lastIndexOf('}');
    } else if (firstBracket !== -1) {
        startIdx = firstBracket;
        endIdx = clean.lastIndexOf(']');
    }

    if (startIdx !== -1) {
        if (endIdx > startIdx) {
            clean = clean.slice(startIdx, endIdx + 1);
        } else {
            clean = clean.slice(startIdx);
        }
    }

    // 3. Converte aspas simples em duplas se não houver aspas duplas estruturais
    if (!clean.includes('"') && clean.includes("'")) {
        clean = clean.replace(/'/g, '"');
    }

    let repaired = '';
    let inString = false;
    let isEscaped = false;

    const isValidValueStarter = (str: string, idx: number) => {
        if (idx >= str.length) return true;
        const ch = str[idx];
        if (ch === '"' || ch === '{' || ch === '[' || ch === ']' || ch === '}') return true;
        if (ch === '-' || (ch >= '0' && ch <= '9')) {
            return /^-?\d+(\.\d+)?/.test(str.slice(idx));
        }
        if (str.startsWith('true', idx) || str.startsWith('false', idx) || str.startsWith('null', idx)) {
            return true;
        }
        return false;
    };

    for (let i = 0; i < clean.length; i++) {
        const char = clean[i];

        if (inString) {
            if (isEscaped) {
                isEscaped = false;
                repaired += char;
                continue;
            }

            if (char === '\\') {
                isEscaped = true;
                repaired += char;
                continue;
            }

            if (char === '\n') {
                repaired += '\\n';
                continue;
            }

            if (char === '\r') {
                continue;
            }

            if (char === '\t') {
                repaired += '\\t';
                continue;
            }

            if (char === '"') {
                let nextIdx = i + 1;
                while (nextIdx < clean.length && /\s/.test(clean[nextIdx])) {
                    nextIdx++;
                }

                if (nextIdx >= clean.length) {
                    inString = false;
                    repaired += '"';
                    continue;
                }

                const nextChar = clean[nextIdx];

                if (nextChar === ':') {
                    inString = false;
                    repaired += '"';
                } else if (nextChar === '}' || nextChar === ']') {
                    inString = false;
                    repaired += '"';
                } else if (nextChar === ',') {
                    let afterCommaIdx = nextIdx + 1;
                    while (afterCommaIdx < clean.length && /\s/.test(clean[afterCommaIdx])) {
                        afterCommaIdx++;
                    }
                    if (isValidValueStarter(clean, afterCommaIdx)) {
                        inString = false;
                        repaired += '"';
                    } else {
                        repaired += '\\"';
                    }
                } else {
                    repaired += '\\"';
                }
                continue;
            }

            repaired += char;
        } else {
            if (char === '"') {
                inString = true;
                repaired += '"';
            } else {
                repaired += char;
            }
        }
    }

    if (inString) {
        repaired += '"';
    }

    // Remove vírgulas sobressalentes antes de fechamentos
    repaired = repaired.replace(/,\s*([\}\]])/g, '$1');

    // Balanceia chaves e colchetes não fechados se truncado
    let openBraces = 0;
    let openBrackets = 0;
    let inStr2 = false;
    let isEsc2 = false;

    for (let i = 0; i < repaired.length; i++) {
        const c = repaired[i];
        if (inStr2) {
            if (isEsc2) { isEsc2 = false; continue; }
            if (c === '\\') { isEsc2 = true; continue; }
            if (c === '"') { inStr2 = false; }
            continue;
        }
        if (c === '"') { inStr2 = true; continue; }
        if (c === '{') openBraces++;
        else if (c === '}') openBraces = Math.max(0, openBraces - 1);
        else if (c === '[') openBrackets++;
        else if (c === ']') openBrackets = Math.max(0, openBrackets - 1);
    }

    while (openBrackets > 0) {
        repaired += ']';
        openBrackets--;
    }
    while (openBraces > 0) {
        repaired += '}';
        openBraces--;
    }

    return repaired;
};

const fallbackExtractJson = <T,>(rawText: string): T => {
    const messagesMatch = rawText.match(/"messages"\s*:\s*\[([\s\S]*?)\]/i);
    const messages: string[] = [];
    if (messagesMatch) {
        const itemRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
        let match;
        while ((match = itemRegex.exec(messagesMatch[1])) !== null) {
            if (match[1]?.trim()) messages.push(match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'));
        }
    }

    const extractStringProp = (prop: string) => {
        const m = rawText.match(new RegExp(`"${prop}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, 'i'));
        return m ? m[1].replace(/\\"/g, '"') : null;
    };

    const extractNumberProp = (prop: string) => {
        const m = rawText.match(new RegExp(`"${prop}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`, 'i'));
        return m ? Number(m[1]) : null;
    };

    const extractBooleanProp = (prop: string) => {
        const m = rawText.match(new RegExp(`"${prop}"\\s*:\\s*(true|false)`, 'i'));
        return m ? m[1].toLowerCase() === 'true' : null;
    };

    const result: Record<string, any> = {
        messages: messages.length > 0 ? messages : undefined,
        intent: extractStringProp('intent') || 'conversar',
        lead_type: extractStringProp('lead_type') || 'desconhecido',
        temperature: extractNumberProp('temperature') ?? 50,
        emotional_context: extractStringProp('emotional_context') || '',
        relationship_stage: extractStringProp('relationship_stage') || 'new',
        connection_cue: extractStringProp('connection_cue') || '',
        objective: extractStringProp('objective') || '',
        action: extractStringProp('action') || 'none',
        current_state: extractStringProp('current_state') || 'CONNECTION',
        preview_id: extractStringProp('preview_id'),
        approved: extractBooleanProp('approved') ?? true,
        score: extractNumberProp('score') ?? 8,
        issues: [],
    };

    Object.keys(result).forEach((k) => result[k] === undefined && delete result[k]);
    return result as T;
};

export const parseJsonText = <T,>(text: string): T => {
    const raw = String(text || '').trim();
    if (!raw) return {} as T;

    try {
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        return JSON.parse(cleaned) as T;
    } catch {
        // Fallthrough to repair
    }

    try {
        const repaired = repairJsonText(raw);
        return JSON.parse(repaired) as T;
    } catch {
        // Fallthrough to regex boundary match
    }

    try {
        const jsonMatch = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (jsonMatch) {
            const repairedMatch = repairJsonText(jsonMatch[0]);
            return JSON.parse(repairedMatch) as T;
        }
    } catch {
        // Fallthrough to emergency property recovery
    }

    try {
        const extracted = fallbackExtractJson<T>(raw);
        if (extracted && typeof extracted === 'object' && Object.keys(extracted).length > 0) {
            console.warn('[AI Gateway] JSON recuperado via extrator de emergência regex');
            return extracted;
        }
    } catch {
        // Fail
    }

    throw new Error(`Falha ao extrair JSON da resposta: ${raw.slice(0, 200)}`);
};

const toOpenRouterJsonSchema = (value: any, strict = false): any => {
    if (Array.isArray(value)) return value.map((item) => toOpenRouterJsonSchema(item, strict));
    if (!value || typeof value !== 'object') return value;
    const output: Record<string, any> = {};
    for (const [key, nested] of Object.entries(value)) {
        if (key === 'nullable') continue;
        output[key] = key === 'type' && typeof nested === 'string'
            ? nested.toLowerCase()
            : toOpenRouterJsonSchema(nested, strict);
    }
    if (value.nullable === true && typeof output.type === 'string') {
        output.type = [output.type, 'null'];
    }
    if (strict && output.properties && typeof output.properties === 'object') {
        output.additionalProperties = false;
        output.required = Object.keys(output.properties);
    }
    return output;
};
const GEMINI_GATEWAY_TIMEOUT_MS = 9000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, label: string) => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} excedeu ${timeoutMs}ms`)), timeoutMs);
    promise.then(
        (value) => {
            clearTimeout(timer);
            resolve(value);
        },
        (error) => {
            clearTimeout(timer);
            reject(error);
        },
    );
});

class AiGatewayHttpError extends Error {
    status: number;
    retryAfterMs: number;

    constructor(message: string, status: number, retryAfterMs = 0) {
        super(message);
        this.name = 'AiGatewayHttpError';
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}

const parseRetryAfterMs = (value: string | null) => {
    if (!value) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
};

type AiRole = "strategy" | "draft" | "review" | "evaluator";
type AiProvider = "bai" | "openrouter" | "gemini" | "groq" | "nvidia" | "mistral" | "cerebras" | "cloudflare" | "custom";

type AiGatewayConfig = {
    provider: AiProvider;
    model: string;
    label: string;
    apiKey?: string;
    baseUrl?: string;
    role?: AiRole;
    tiers?: AiIntelligenceTier[];
    weight?: number;
    policy?: GatewayRatePolicy;
};

type AiMessage = {
    role: "user" | "assistant";
    content: string;
};

type AiRuntimeSettings = {
    openRouterApiKey: string;
    geminiApiKey: string;
    openRouterBaseUrl: string;
    openRouterReferer: string;
    openRouterTitle: string;
    aiModelOrder: string;
    aiStrategyModelOrder: string;
    aiDraftModelOrder: string;
    aiReviewModelOrder: string;
    aiEvaluatorModelOrder: string;
    aiStrategyEnabled: boolean;
    aiReviewEnabled: boolean;
    aiEvaluatorEnabled: boolean;
    aiSharedRateLimitEnabled: boolean;
    openRouterStrategyModel: string;
    openRouterDraftModel: string;
    openRouterReviewModel: string;
    openRouterEvaluatorModel: string;
    geminiStrategyModel: string;
    geminiDraftModel: string;
    geminiReviewModel: string;
    geminiEvaluatorModel: string;
    directGateways: AiGatewayConfig[];
};

const AI_SETTING_KEYS = [
    "bai_api_key",
    "bai_model",
    "openrouter_api_key",
    "gemini_api_key",
    "openrouter_base_url",
    "openrouter_referer",
    "openrouter_title",
    "ai_model_order",
    "ai_strategy_model_order",
    "ai_draft_model_order",
    "ai_review_model_order",
    "ai_evaluator_model_order",
    "ai_strategy_enabled",
    "ai_review_enabled",
    "ai_evaluator_enabled",
    "openrouter_strategy_model",
    "openrouter_draft_model",
    "openrouter_review_model",
    "openrouter_evaluator_model",
    "gemini_strategy_model",
    "gemini_draft_model",
    "gemini_review_model",
    "gemini_evaluator_model",
    "groq_api_key",
    "groq_model",
    "groq_starter_model",
    "nvidia_api_key",
    "nvidia_model",
    "mistral_api_key",
    "mistral_model",
    "cerebras_api_key",
    "cerebras_model",
    "cloudflare_ai_api_token",
    "cloudflare_account_id",
    "cloudflare_model",
    "ai_custom_gateway_api_key",
    "ai_custom_gateway_base_url",
    "ai_custom_gateway_model",
    "ai_custom_gateway_tiers",
    "ai_custom_gateway_weight",
    "ai_shared_rate_limit_enabled",
];

const ROLE_ENV_KEYS: Record<AiRole, string> = {
    strategy: "AI_STRATEGY_MODEL_ORDER",
    draft: "AI_DRAFT_MODEL_ORDER",
    review: "AI_REVIEW_MODEL_ORDER",
    evaluator: "AI_EVALUATOR_MODEL_ORDER",
};

const DEFAULT_PROVIDER_ORDER = "bai,openrouter,groq,gemini,nvidia,cloudflare,mistral,cerebras,custom";
const DEFAULT_OPENROUTER_MODELS: Record<AiRole, string> = {
    strategy: DEFAULT_OPENROUTER_MODEL,
    draft: DEFAULT_OPENROUTER_MODEL,
    review: DEFAULT_OPENROUTER_MODEL,
    evaluator: DEFAULT_OPENROUTER_MODEL,
};

const getGeminiModelName = () => normalizeGeminiModelName(process.env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL);

const getBotSettingsMap = async (keys: string[]) => {
    const { data, error } = await supabase
        .from("bot_settings")
        .select("key,value")
        .in("key", keys);

    if (error) {
        console.warn("[AI Gateway] falha ao carregar settings:", error.message);
        return {} as Record<string, string>;
    }

    return Object.fromEntries((data || []).map((item: any) => [item.key, item.value || ""])) as Record<string, string>;
};

const buildDirectOpenAiGateways = (settings: Record<string, string>): AiGatewayConfig[] => {
    const gateways: AiGatewayConfig[] = [];
    const configured = (settingKey: string, envKey: string, fallback = '') => String(settings[settingKey] || process.env[envKey] || fallback).trim();
    const addProvider = ({
        provider,
        apiKey,
        baseUrl,
        models,
        tiers,
        weight,
    }: {
        provider: Exclude<AiProvider, 'openrouter' | 'gemini'>;
        apiKey: string;
        baseUrl: string;
        models: Partial<Record<AiRole, string>>;
        tiers: AiIntelligenceTier[];
        weight: number;
    }) => {
        const key = readSecret(apiKey);
        if (!key) return;
        for (const role of Object.keys(models) as AiRole[]) {
            const model = String(models[role] || '').trim();
            if (!model) continue;
            gateways.push({
                provider,
                apiKey: key,
                baseUrl: baseUrl.replace(/\/$/, ''),
                model,
                role,
                tiers,
                weight,
                label: `${provider}:${model}`,
            });
        }
    };

    // Converte automaticamente o V4 Flash textual salvo no painel para a nova
    // rota multimodal escolhida. Assim um setting antigo nao impede o deploy de
    // realmente trocar o modelo em producao.
    const baiModel = normalizeBaiModelName(configured('bai_model', 'BAI_MODEL', DEFAULT_BAI_MODEL));
    addProvider({
        provider: 'bai',
        apiKey: configured('bai_api_key', 'BAI_API_KEY'),
        baseUrl: process.env.BAI_BASE_URL || 'https://api.b.ai/v1',
        models: {
            strategy: baiModel,
            draft: baiModel,
            review: baiModel,
            evaluator: baiModel,
        },
        tiers: ['starter', 'buyer', 'premium', 'elite'],
        weight: 50,
    });

    const groqApiKey = configured('groq_api_key', 'GROQ_API_KEY');
    const groqStarterModel = normalizeGroqModelName(configured('groq_starter_model', 'GROQ_STARTER_MODEL', DEFAULT_GROQ_STARTER_MODEL), DEFAULT_GROQ_STARTER_MODEL);
    const groqQualityModel = normalizeGroqModelName(configured('groq_model', 'GROQ_DRAFT_MODEL', DEFAULT_GROQ_QUALITY_MODEL), DEFAULT_GROQ_QUALITY_MODEL);
    addProvider({
        provider: 'groq',
        apiKey: groqApiKey,
        baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
        models: {
            draft: groqStarterModel,
        },
        tiers: ['starter'],
        weight: 18,
    });
    addProvider({
        provider: 'groq',
        apiKey: groqApiKey,
        baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
        models: {
            strategy: normalizeGroqModelName(process.env.GROQ_STRATEGY_MODEL, DEFAULT_GROQ_STARTER_MODEL),
            draft: groqQualityModel,
            review: normalizeGroqModelName(process.env.GROQ_REVIEW_MODEL, DEFAULT_GROQ_STARTER_MODEL),
            evaluator: normalizeGroqModelName(process.env.GROQ_EVALUATOR_MODEL, groqQualityModel),
        },
        tiers: ['buyer', 'premium', 'elite'],
        weight: 18,
    });

    const nvidiaModel = configured('nvidia_model', 'NVIDIA_DRAFT_MODEL', 'meta/llama-3.1-8b-instruct');
    addProvider({
        provider: 'nvidia',
        apiKey: configured('nvidia_api_key', 'NVIDIA_API_KEY'),
        baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
        models: {
            strategy: process.env.NVIDIA_STRATEGY_MODEL || nvidiaModel,
            draft: nvidiaModel,
            review: process.env.NVIDIA_REVIEW_MODEL || nvidiaModel,
            evaluator: process.env.NVIDIA_EVALUATOR_MODEL || nvidiaModel,
        },
        tiers: ['starter', 'buyer', 'premium', 'elite'],
        weight: 14,
    });

    const mistralModel = configured('mistral_model', 'MISTRAL_DRAFT_MODEL', 'mistral-small-latest');
    addProvider({
        provider: 'mistral',
        apiKey: configured('mistral_api_key', 'MISTRAL_API_KEY'),
        baseUrl: process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
        models: {
            strategy: process.env.MISTRAL_STRATEGY_MODEL || mistralModel,
            draft: mistralModel,
            review: process.env.MISTRAL_REVIEW_MODEL || mistralModel,
            evaluator: process.env.MISTRAL_EVALUATOR_MODEL || mistralModel,
        },
        tiers: ['starter', 'buyer', 'premium', 'elite'],
        weight: 8,
    });

    const cerebrasModel = configured('cerebras_model', 'CEREBRAS_DRAFT_MODEL', 'gpt-oss-120b');
    addProvider({
        provider: 'cerebras',
        apiKey: configured('cerebras_api_key', 'CEREBRAS_API_KEY'),
        baseUrl: process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1',
        models: {
            strategy: process.env.CEREBRAS_STRATEGY_MODEL || cerebrasModel,
            draft: cerebrasModel,
            review: process.env.CEREBRAS_REVIEW_MODEL || cerebrasModel,
            evaluator: process.env.CEREBRAS_EVALUATOR_MODEL || cerebrasModel,
        },
        tiers: ['buyer', 'premium', 'elite'],
        weight: 10,
    });

    const cloudflareAccountId = configured('cloudflare_account_id', 'CLOUDFLARE_ACCOUNT_ID');
    const cloudflareModel = configured('cloudflare_model', 'CLOUDFLARE_DRAFT_MODEL', '@cf/openai/gpt-oss-20b');
    addProvider({
        provider: 'cloudflare',
        apiKey: configured('cloudflare_ai_api_token', 'CLOUDFLARE_AI_API_TOKEN'),
        baseUrl: process.env.CLOUDFLARE_AI_BASE_URL
            || (cloudflareAccountId ? `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/v1` : 'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1'),
        models: {
            strategy: process.env.CLOUDFLARE_STRATEGY_MODEL || cloudflareModel,
            draft: cloudflareModel,
            review: process.env.CLOUDFLARE_REVIEW_MODEL || cloudflareModel,
            evaluator: process.env.CLOUDFLARE_EVALUATOR_MODEL || cloudflareModel,
        },
        tiers: ['starter', 'buyer'],
        weight: cloudflareAccountId ? 12 : 0,
    });

    const customBaseUrl = configured('ai_custom_gateway_base_url', 'AI_CUSTOM_GATEWAY_BASE_URL');
    const customModel = configured('ai_custom_gateway_model', 'AI_CUSTOM_DRAFT_MODEL', 'auto');
    const customTiers = configured('ai_custom_gateway_tiers', 'AI_CUSTOM_GATEWAY_TIERS', 'starter,buyer')
        .split(',')
        .map((tier) => tier.trim())
        .filter((tier): tier is AiIntelligenceTier => ['starter', 'buyer', 'premium', 'elite'].includes(tier));
    if (customBaseUrl) {
        addProvider({
            provider: 'custom',
            apiKey: configured('ai_custom_gateway_api_key', 'AI_CUSTOM_GATEWAY_API_KEY'),
            baseUrl: customBaseUrl,
            models: {
                strategy: process.env.AI_CUSTOM_STRATEGY_MODEL || customModel,
                draft: customModel,
                review: process.env.AI_CUSTOM_REVIEW_MODEL || customModel,
                evaluator: process.env.AI_CUSTOM_EVALUATOR_MODEL || customModel,
            },
            tiers: customTiers.length > 0 ? customTiers : ['starter', 'buyer'],
            weight: Math.max(1, Math.min(40, Number(settings.ai_custom_gateway_weight || process.env.AI_CUSTOM_GATEWAY_WEIGHT || 5))),
        });
    }

    return gateways.filter((gateway) => gateway.weight !== 0);
};

const getAiRuntimeSettings = async (): Promise<AiRuntimeSettings> => {
    const settings = await getBotSettingsMap(AI_SETTING_KEYS);
    return {
        openRouterApiKey: readSecret(settings.openrouter_api_key) || envOpenRouterApiKey,
        geminiApiKey: readSecret(settings.gemini_api_key) || envGeminiApiKey,
        openRouterBaseUrl: settings.openrouter_base_url || defaultOpenRouterBaseUrl,
        openRouterReferer: settings.openrouter_referer || defaultOpenRouterReferer,
        openRouterTitle: settings.openrouter_title || defaultOpenRouterTitle,
        aiModelOrder: settings.ai_model_order || process.env.AI_MODEL_ORDER || "",
        aiStrategyModelOrder: settings.ai_strategy_model_order || process.env.AI_STRATEGY_MODEL_ORDER || DEFAULT_PROVIDER_ORDER,
        aiDraftModelOrder: settings.ai_draft_model_order || process.env.AI_DRAFT_MODEL_ORDER || DEFAULT_PROVIDER_ORDER,
        aiReviewModelOrder: settings.ai_review_model_order || process.env.AI_REVIEW_MODEL_ORDER || DEFAULT_PROVIDER_ORDER,
        aiEvaluatorModelOrder: settings.ai_evaluator_model_order || process.env.AI_EVALUATOR_MODEL_ORDER || DEFAULT_PROVIDER_ORDER,
        // Estrategia, voz e action vivem no Master Brain da chamada principal.
        aiStrategyEnabled: false,
        aiReviewEnabled: true,
        aiEvaluatorEnabled: false,
        aiSharedRateLimitEnabled: settings.ai_shared_rate_limit_enabled !== "false" && process.env.AI_SHARED_RATE_LIMIT_ENABLED !== "false",
        openRouterStrategyModel: normalizeOpenRouterPrimaryModel(settings.openrouter_strategy_model || process.env.OPENROUTER_STRATEGY_MODEL || DEFAULT_OPENROUTER_MODELS.strategy),
        openRouterDraftModel: normalizeOpenRouterPrimaryModel(settings.openrouter_draft_model || process.env.OPENROUTER_DRAFT_MODEL || DEFAULT_OPENROUTER_MODELS.draft),
        openRouterReviewModel: normalizeOpenRouterPrimaryModel(settings.openrouter_review_model || process.env.OPENROUTER_REVIEW_MODEL || DEFAULT_OPENROUTER_MODELS.review),
        openRouterEvaluatorModel: normalizeOpenRouterPrimaryModel(settings.openrouter_evaluator_model || process.env.OPENROUTER_EVALUATOR_MODEL || DEFAULT_OPENROUTER_MODELS.evaluator),
        geminiStrategyModel: normalizeGeminiModelName(settings.gemini_strategy_model || process.env.GEMINI_STRATEGY_MODEL, DEFAULT_GEMINI_LITE_MODEL),
        geminiDraftModel: normalizeGeminiModelName(settings.gemini_draft_model || process.env.GEMINI_DRAFT_MODEL, getGeminiModelName()),
        geminiReviewModel: normalizeGeminiModelName(settings.gemini_review_model || process.env.GEMINI_REVIEW_MODEL, DEFAULT_GEMINI_LITE_MODEL),
        geminiEvaluatorModel: normalizeGeminiModelName(settings.gemini_evaluator_model || process.env.GEMINI_EVALUATOR_MODEL, getGeminiModelName()),
        directGateways: buildDirectOpenAiGateways(settings),
    };
};

const getRoleProviderModel = (role: AiRole, provider: AiProvider, settings: AiRuntimeSettings) => {
    if (provider === "gemini") {
        const map: Record<AiRole, string> = {
            strategy: settings.geminiStrategyModel,
            draft: settings.geminiDraftModel,
            review: settings.geminiReviewModel,
            evaluator: settings.geminiEvaluatorModel,
        };
        return map[role] || getGeminiModelName();
    }

    const map: Record<AiRole, string> = {
        strategy: settings.openRouterStrategyModel,
        draft: settings.openRouterDraftModel,
        review: settings.openRouterReviewModel,
        evaluator: settings.openRouterEvaluatorModel,
    };
    return map[role] || DEFAULT_OPENROUTER_MODELS[role];
};

const parseAiModelEntry = (entry: string, role: AiRole, settings: AiRuntimeSettings): AiGatewayConfig | null => {
    const trimmed = entry.trim();
    if (!trimmed) return null;

    const providerOnly = trimmed.toLowerCase();
    if (providerOnly === "openrouter" || providerOnly === "gemini") {
        const provider = providerOnly as AiProvider;
        const model = getRoleProviderModel(role, provider, settings);
        return { provider, model, label: `${provider}:${model}` };
    }
    if (["bai", "groq", "nvidia", "mistral", "cerebras", "cloudflare", "custom"].includes(providerOnly)) return null;

    const providerMatch = trimmed.match(/^(openrouter|gemini):(.+)$/i);
    if (!providerMatch) {
        const model = normalizeOpenRouterPrimaryModel(trimmed);
        return { provider: "openrouter", model, label: `openrouter:${model}` };
    }

    const provider = providerMatch[1].toLowerCase() as AiProvider;
    const configuredModel = providerMatch[2].trim();
    if (!configuredModel) return null;
    const model = provider === "openrouter"
        ? normalizeOpenRouterPrimaryModel(configuredModel)
        : configuredModel;
    return { provider, model, label: `${provider}:${model}` };
};

const parseAiModelOrder = (value: string | null | undefined, role: AiRole, settings: AiRuntimeSettings): AiGatewayConfig[] => {
    if (!value) return [];
    return value
        .split(",")
        .map((entry) => parseAiModelEntry(entry, role, settings))
        .filter((entry): entry is AiGatewayConfig => Boolean(entry));
};

const parseProviderPreference = (value: string | null | undefined) => {
    const supported: AiProvider[] = ['bai', 'gemini', 'groq', 'nvidia', 'cloudflare', 'mistral', 'openrouter', 'cerebras', 'custom'];
    const parsed = String(value || '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase().split(':')[0] as AiProvider)
        .filter((provider): provider is AiProvider => supported.includes(provider));
    const legacyTwoProviderOrder = parsed.length > 0 && parsed.every((provider) => provider === 'openrouter' || provider === 'gemini');
    if (legacyTwoProviderOrder) return supported;
    if (!parsed.includes('bai')) return Array.from(new Set(['bai', ...parsed, ...supported]));
    return Array.from(new Set([...parsed, ...supported]));
};

const getAiGatewayOrder = (role: AiRole, settings: AiRuntimeSettings, tier?: AiIntelligenceTier): AiGatewayConfig[] => {
    const roleSettingMap: Record<AiRole, string> = {
        strategy: settings.aiStrategyModelOrder,
        draft: settings.aiDraftModelOrder,
        review: settings.aiReviewModelOrder,
        evaluator: settings.aiEvaluatorModelOrder,
    };
    const roleSpecific = parseAiModelOrder(roleSettingMap[role], role, settings);
    const globalOrder = parseAiModelOrder(settings.aiModelOrder, role, settings);
    const defaults = parseAiModelOrder(DEFAULT_PROVIDER_ORDER, role, settings);

    // Mantém somente fallbacks nomeados e previsíveis; nunca usa o roteador aleatório /free.
    const extraOpenRouterModels: AiGatewayConfig[] = settings.openRouterApiKey
        ? OPENROUTER_MODEL_FALLBACK_ORDER.map((model) => ({
            provider: "openrouter" as AiProvider,
            model,
            label: `openrouter:${model}`,
        }))
        : [];

    const extraGeminiModels: AiGatewayConfig[] = settings.geminiApiKey
        ? GEMINI_MODEL_OPTIONS.map((model) => ({
            provider: "gemini" as AiProvider,
            model,
            label: `gemini:${model}`,
        }))
        : [];
    const directGateways = settings.directGateways
        .filter((gateway) => gateway.role === role)
        .filter((gateway) => !tier || !gateway.tiers || gateway.tiers.includes(tier));

    const configuredPreference = parseProviderPreference(roleSettingMap[role] || settings.aiModelOrder || DEFAULT_PROVIDER_ORDER);
    // DeepSeek V4 pela B.AI é a linha principal textual. O painel continua
    // ordenando todos os fallbacks, mas não pode acidentalmente deslocar o
    // Master Brain; mídia incompatível é roteada ao Gemini acima desta camada.
    // Mantem o DeepSeek V4 da B.AI em primeiro. Se ele estiver sem saldo,
    // prioriza fallbacks de qualidade (DeepSeek via OpenRouter e Groq) antes de
    // chegar no Gemini Lite, que deve ser somente a ultima rede de seguranca.
    const qualityFallbacks: AiProvider[] = ['openrouter', 'groq', 'gemini'];
    const providerPreference = [
        'bai' as AiProvider,
        ...qualityFallbacks,
        ...configuredPreference.filter((provider) => provider !== 'bai' && !qualityFallbacks.includes(provider as AiProvider)),
    ];
    const providerRank = new Map(providerPreference.map((provider, index) => [provider, index]));
    const order = [...roleSpecific, ...globalOrder, ...directGateways, ...defaults, ...extraOpenRouterModels, ...extraGeminiModels]
        .map((gateway, index) => ({ gateway, index }))
        .sort((left, right) => {
            const providerDelta = Number(providerRank.get(left.gateway.provider) ?? 999) - Number(providerRank.get(right.gateway.provider) ?? 999);
            return providerDelta || left.index - right.index;
        })
        .map((item) => item.gateway);
    const seen = new Set<string>();
    return order.filter((gateway) => {
        if (gateway.provider === "openrouter" && !settings.openRouterApiKey) return false;
        if (gateway.provider === "gemini" && !settings.geminiApiKey) return false;
        if (gateway.provider !== 'openrouter' && gateway.provider !== 'gemini' && !gateway.apiKey) return false;
        const key = `${gateway.provider}:${gateway.model}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const stablePercent = (value: string) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 100;
};

const getTierAwareGatewayOrder = ({
    role,
    settings,
    tier,
    routingKey,
    preferGemini = false,
}: {
    role: AiRole;
    settings: AiRuntimeSettings;
    tier?: AiIntelligenceTier;
    routingKey?: string;
    preferGemini?: boolean;
}) => {
    const normal = getAiGatewayOrder(role, settings, tier);
    const geminiPrimary: AiGatewayConfig[] = [];

    // Linha principal estrita: qualidade primeiro, depois capacidade. A lista normal
    // entra apenas quando todos estes modelos estiverem indisponíveis ou em cooldown.
    if (preferGemini && settings.geminiApiKey) {
        const roleModel = getRoleProviderModel(role, 'gemini', settings);
        [
            DEFAULT_GEMINI_MODEL,
            DEFAULT_GEMINI_FALLBACK_MODEL,
            'gemini-3.5-flash',
            DEFAULT_GEMINI_LITE_MODEL,
            roleModel,
        ].forEach((model) => geminiPrimary.push({
            provider: 'gemini',
            model,
            label: `gemini:${model}`,
        }));
    }

    const seen = new Set<string>();
    return [...geminiPrimary, ...normal].filter((gateway) => {
        const key = `${gateway.provider}:${gateway.model}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

let sharedLimiterDisabledUntil = 0;

const reserveSharedGatewayCapacity = async (
    settings: AiRuntimeSettings,
    gateway: AiGatewayConfig,
    policy: GatewayRatePolicy,
    estimatedTokens: number,
) => {
    const serviceRoleConfigured = Boolean(readSecret(process.env.SUPABASE_SERVICE_ROLE_KEY));
    if (!settings.aiSharedRateLimitEnabled || !serviceRoleConfigured || sharedLimiterDisabledUntil > Date.now()) return null;

    const bucketKey = gateway.provider === 'openrouter'
        ? 'openrouter:account'
        : `${gateway.provider}:${gateway.model}`;
    try {
        const { data, error } = await supabase.rpc('reserve_ai_gateway_capacity', {
            p_bucket_key: bucketKey,
            p_rpm: policy.rpm,
            p_tpm: policy.tpm,
            p_rpd: policy.rpd,
            p_tpd: policy.tpd,
            p_estimated_tokens: estimatedTokens,
        });
        if (error) throw error;
        const result = (data || {}) as any;
        return {
            allowed: result.allowed !== false,
            retryAfterMs: Math.max(0, Number(result.retry_after_ms || 0)),
        };
    } catch (error: any) {
        const message = String(error?.message || error);
        const migrationMissing = /reserve_ai_gateway_capacity|schema cache|function public/i.test(message);
        const cooldownMs = migrationMissing ? 6 * 60 * 60_000 : 60_000;
        sharedLimiterDisabledUntil = Date.now() + cooldownMs;
        console.warn(`[AI Gateway] limitador compartilhado indisponivel; usando controle local por ${migrationMissing ? '6h' : '60s'}:`, message);
        return null;
    }
};

const toOpenRouterMessages = (systemInstruction: string, history: AiMessage[], userContent: string, mediaPart?: any) => {
    const inlineData = mediaPart?.inlineData;
    const userMessageContent = inlineData?.mimeType?.startsWith('image/')
        ? [
            { type: "text", text: userContent },
            {
                type: "image_url",
                image_url: {
                    url: `data:${inlineData.mimeType};base64,${inlineData.data}`
                }
            }
        ]
        : userContent;

    return [
    { role: "system", content: systemInstruction },
    ...history.map((message) => ({
        role: message.role,
        content: message.content,
    })),
        { role: "user", content: userMessageContent },
    ];
};

const buildJsonReminder = (schemaName: string, schemaConfig?: any) => {
    let schemaHint = '';
    if (schemaConfig?.properties) {
        const keys = Object.keys(schemaConfig.properties);
        schemaHint = `\n- Campos esperados no JSON: ${keys.join(', ')}.`;
    }
    return `

FORMATO OBRIGATORIO:
- Responda SOMENTE um objeto JSON valido (iniciando em { e terminando em }).
- Nao use blocos markdown (sem \`\`\`json).
- Nao escreva nenhuma palavra ou texto antes ou depois do JSON.
- NUNCA use aspas duplas dentro de textos/mensagens. Se precisar citar algo, use aspas simples (') ou escape com (\\").
- Nunca quebre linhas no meio de uma string JSON sem usar \\n.
- Nao inclua virgula no ultimo item antes de } ou ].${schemaHint}
- O JSON deve seguir o schema interno: ${schemaName}.`;
};

const appendAiGatewayEvent = async (event: {
    role: AiRole;
    provider: AiProvider;
    model: string;
    tier?: AiIntelligenceTier;
    status: "success" | "error" | "skipped";
    message?: string;
    durationMs?: number;
}) => {
    try {
        const { data } = await supabase
            .from("bot_settings")
            .select("key,value")
            .in("key", ["ai_gateway_recent_events", "ai_gateway_stats"]);

        const map = Object.fromEntries((data || []).map((item: any) => [item.key, item.value || ""]));
        const recent = (() => {
            try { return JSON.parse(map.ai_gateway_recent_events || "[]"); } catch { return []; }
        })();
        const stats = (() => {
            try { return JSON.parse(map.ai_gateway_stats || "{}"); } catch { return {}; }
        })();

        const label = `${event.provider}:${event.model}`;
        const tier = event.tier || 'unknown';
        const statKey = `${tier}|${event.role}|${label}`;
        const current = stats[statKey] || { tier, role: event.role, provider: event.provider, model: event.model, success: 0, error: 0, skipped: 0 };
        current[event.status] = Number(current[event.status] || 0) + 1;
        current.last_at = new Date().toISOString();
        current.last_message = String(event.message || "").slice(0, 500);
        stats[statKey] = current;

        const nextRecent = [{
            at: new Date().toISOString(),
            role: event.role,
            tier,
            provider: event.provider,
            model: event.model,
            status: event.status,
            message: String(event.message || "").slice(0, 700),
            durationMs: event.durationMs || 0,
        }, ...recent].slice(0, 80);

        await supabase.from("bot_settings").upsert([
            { key: "ai_gateway_recent_events", value: JSON.stringify(nextRecent) },
            { key: "ai_gateway_stats", value: JSON.stringify(stats) },
        ]);
    } catch (error: any) {
        console.warn("[AI Gateway] falha ao registrar evento:", error?.message || error);
    }
};

const recordAiGatewayEvent = (event: Parameters<typeof appendAiGatewayEvent>[0]) => {
    void withTimeout(appendAiGatewayEvent(event), 1_200, 'telemetria do gateway')
        .catch((error: any) => console.warn('[AI Gateway] telemetria ignorada para nao atrasar o lead:', error?.message || error));
};

const callOpenRouterJson = async <T,>(
    settings: AiRuntimeSettings,
    gateway: AiGatewayConfig,
    role: AiRole,
    systemInstruction: string,
    history: AiMessage[],
    userContent: string,
    schemaName: string,
    responseSchemaConfig: any,
    mediaPart?: any,
    timeoutMs = 18_000,
): Promise<{ data: T; resolvedModel: string; usageTotalTokens?: number }> => {
    const apiKey = gateway.apiKey || settings.openRouterApiKey;
    const baseUrl = String(gateway.baseUrl || settings.openRouterBaseUrl).replace(/\/$/, '');
    if (!apiKey) throw new Error(`${gateway.provider.toUpperCase()} API key not configured`);

    const headers: Record<string, string> = {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
    };
    if (gateway.provider === 'openrouter') {
        headers["HTTP-Referer"] = settings.openRouterReferer;
        headers["X-Title"] = settings.openRouterTitle;
    }

    const body: Record<string, unknown> = {
        model: gateway.provider === 'openrouter'
            ? normalizeOpenRouterPrimaryModel(gateway.model)
            : gateway.model,
        messages: toOpenRouterMessages(systemInstruction, history, userContent, mediaPart),
        temperature: role === "draft" ? 0.85 : 0.35,
        max_tokens: gateway.provider === 'bai'
            ? role === 'review' ? 900 : role === 'strategy' ? 1_200 : 1_400
            : 1_400,
    };
    const deepSeekV4 = /deepseek-v4/i.test(String(gateway.model || ''));
    if (deepSeekV4) {
        const criticalTurn = /\b(pix|pagar|pagamento|pre[cç]o|valor|caro|desconto|comprar|comprovante|contradi|reclam|n[aã]o quero|generate_pix_payment|check_payment_status|send_(?:custom_)?preview|send_voice_reply|payment_details|preview_id)\b/i.test(userContent);
        if (role === 'evaluator') {
            body.reasoning_effort = 'max';
            body.thinking = { type: 'enabled' };
        } else if (role === 'strategy' || criticalTurn) {
            // Low e raciocinio real do V4. Medium/high mapeiam ambos para high
            // e estavam levando conversas simples a 20-40 segundos.
            body.reasoning_effort = 'low';
            body.thinking = { type: 'enabled' };
        } else {
            // Redacao e revisao cotidiana precisam de naturalidade e velocidade,
            // nao de uma cadeia longa de raciocinio invisivel.
            body.thinking = { type: 'disabled' };
        }
    }
    if (gateway.provider === 'openrouter') {
        body.provider = { allow_fallbacks: true, require_parameters: true };
        body.response_format = {
            type: 'json_schema',
            json_schema: {
                name: schemaName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'response',
                strict: false,
                schema: toOpenRouterJsonSchema(responseSchemaConfig),
            },
        };
    } else if (gateway.provider === 'bai') {
        body.response_format = {
            type: 'json_schema',
            json_schema: {
                name: schemaName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'response',
                strict: true,
                schema: toOpenRouterJsonSchema(responseSchemaConfig, true),
            },
        };
    }

    let response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers,
        body: JSON.stringify(body),
    });

    let responseBody = await response.text();
    if (gateway.provider === 'bai'
        && response.status === 400
        && /json_schema|response_format|schema|additionalproperties|required/i.test(responseBody)) {
        // Compatibilidade temporária para contas/rotas B.AI que ainda não
        // propagam JSON Schema ao modelo selecionado. O reminder JSON e o hard
        // validator continuam obrigatórios; a telemetria registra o modelo real.
        body.response_format = { type: 'json_object' };
        response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            signal: AbortSignal.timeout(timeoutMs),
            headers,
            body: JSON.stringify(body),
        });
        responseBody = await response.text();
    }
    if (!response.ok) {
        throw new AiGatewayHttpError(
            `${gateway.provider} ${response.status}: ${responseBody.slice(0, 500)}`,
            response.status,
            parseRetryAfterMs(response.headers.get('retry-after')),
        );
    }

    const payload = parseJsonText<any>(responseBody);
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${gateway.provider} empty response from ${gateway.model}`);
    return {
        data: parseJsonText<T>(String(content)),
        resolvedModel: String(payload?.model || gateway.model),
        usageTotalTokens: Number(payload?.usage?.total_tokens || 0) || undefined,
    };
};

const callGeminiJson = async <T,>(
    settings: AiRuntimeSettings,
    gateway: AiGatewayConfig,
    systemInstruction: string,
    responseSchemaConfig: any,
    history: any[],
    parts: any[],
    timeoutMs = GEMINI_GATEWAY_TIMEOUT_MS,
): Promise<T> => {
    initializeGenAI(settings.geminiApiKey);
    if (!genAI) throw new Error("GEMINI_API_KEY not configured");
    const model = genAI.getGenerativeModel({
        model: gateway.model,
        systemInstruction,
        safetySettings,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchemaConfig
        }
    });
    const chat = model.startChat({ history });
    const result = await withTimeout(
        chat.sendMessage(parts),
        timeoutMs,
        `Gemini ${gateway.model}`,
    );
    return parseJsonText<T>(result.response.text());
};

const callAiGatewayJson = async <T,>(options: {
    settings: AiRuntimeSettings;
    role: AiRole;
    providerOnly?: AiProvider;
    schemaName: string;
    systemInstruction: string;
    responseSchemaConfig: any;
    history: any[];
    text: string;
    mediaPart?: any;
    orchestrationTier?: AiIntelligenceTier;
    routingKey?: string;
}): Promise<{ data: T; gateway: AiGatewayConfig; attempts: string[] }> => {
    const mediaMimeType = String(options.mediaPart?.inlineData?.mimeType || '').trim();
    const hasMedia = Boolean(mediaMimeType);
    const hasImage = mediaMimeType.startsWith('image/');
    // Foto pertence exclusivamente ao DeepSeek V4 Vision. Outros modelos so
    // podem entrar depois, na recuperacao textual, se a chamada visual falhar.
    // Audio/video continuam no Gemini porque o endpoint B.AI nao os recebe.
    const providerOnly = hasImage ? 'bai' : hasMedia ? 'gemini' : options.providerOnly;
    const gateways = getTierAwareGatewayOrder({
        role: options.role,
        settings: options.settings,
        tier: options.orchestrationTier,
        routingKey: options.routingKey,
        preferGemini: hasMedia && !hasImage,
    })
        .filter((gateway) => !providerOnly || gateway.provider === providerOnly);
    const attempts: string[] = [];
    const openRouterHistory: AiMessage[] = options.history.map((message: any) => ({
        role: (message.role === "model" ? "assistant" : "user") as AiMessage["role"],
        content: String(message.parts?.[0]?.text || ""),
    })).filter((message: AiMessage) => Boolean(message.content.trim()));

    if (gateways.length === 0) throw new Error(`Nenhum gateway configurado para ${options.role}`);

    const estimatedTokens = estimateAiTokens(
        options.systemInstruction,
        options.text,
        openRouterHistory,
        options.mediaPart ? '[media]' : '',
    );
    const candidates: GatewayRouteCandidate<AiGatewayConfig>[] = gateways.map((gateway, priority) => {
        const policy = gateway.policy || resolveGatewayRatePolicy(gateway.provider, gateway.model);
        return {
            key: `${gateway.provider}:${gateway.model}`,
            provider: gateway.provider,
            model: gateway.model,
            priority,
            weight: Math.max(1, Number(gateway.weight || (gateway.provider === 'bai' ? 60 : gateway.provider === 'gemini' ? 30 : gateway.provider === 'groq' ? 18 : 7))),
            policy,
            value: { ...gateway, policy },
        };
    });
    const excluded = new Set<string>();
    const tierQueueMs: Record<AiIntelligenceTier, number> = { starter: 2_200, buyer: 3_200, premium: 4_000, elite: 5_000 };
    const maxQueueMs = tierQueueMs[options.orchestrationTier || 'starter'];

    while (excluded.size < candidates.length) {
        let lease;
        try {
            lease = await aiGatewayRouter.acquire(candidates, {
                routingKey: `${options.routingKey || 'anonymous'}:${options.role}`,
                estimatedTokens,
                maxQueueMs,
                exclude: excluded,
            });
        } catch (capacityError: any) {
            const detail = capacityError instanceof GatewayCapacityError
                ? `capacidade esgotada; nova tentativa em ${capacityError.retryAfterMs}ms`
                : String(capacityError?.message || capacityError);
            attempts.push(detail);
            break;
        }

        const gateway = lease.candidate.value;
        const policy = lease.candidate.policy;
        const startedAt = Date.now();
        const sharedCapacity = await reserveSharedGatewayCapacity(options.settings, gateway, policy, estimatedTokens);
        if (sharedCapacity?.allowed === false) {
            lease.cancelBeforeDispatch();
            excluded.add(lease.candidate.key);
            aiGatewayRouter.defer(lease.candidate.key, Math.max(1_000, sharedCapacity.retryAfterMs), 'quota');
            const message = `${gateway.label} sem capacidade compartilhada por ${sharedCapacity.retryAfterMs}ms`;
            attempts.push(message);
            recordAiGatewayEvent({ tier: options.orchestrationTier, role: options.role, provider: gateway.provider, model: gateway.model, status: 'skipped', message });
            continue;
        }

        try {
            if (gateway.provider !== "gemini") {
                if (options.mediaPart) {
                    const mimeType = String(options.mediaPart?.inlineData?.mimeType || '');
                    const acceptsImage = gateway.provider === 'bai' && isBaiVisionModel(gateway.model);
                    if (!mimeType.startsWith('image/') || !acceptsImage) {
                        const message = `${gateway.label} pulado: midia nao suportada neste provider`;
                        attempts.push(message);
                        lease.cancelBeforeDispatch();
                        excluded.add(lease.candidate.key);
                        recordAiGatewayEvent({ tier: options.orchestrationTier, role: options.role, provider: gateway.provider, model: gateway.model, status: "skipped", message });
                        continue;
                    }
                }
                let result: { data: T; resolvedModel: string; usageTotalTokens?: number };
                try {
                    result = await callOpenRouterJson<T>(
                        options.settings,
                        gateway,
                        options.role,
                        `${options.systemInstruction}${buildJsonReminder(options.schemaName, options.responseSchemaConfig)}`,
                        openRouterHistory,
                        options.text,
                        options.schemaName,
                        options.responseSchemaConfig,
                        options.mediaPart,
                        policy.timeoutMs,
                    );
                } catch (initialError: any) {
                    // O gateway externo ja tem fallback, circuit breaker e
                    // idempotencia. Repetir o mesmo provider dobrava a latencia
                    // (20s + 24s) antes de tentar a proxima rota.
                    throw initialError;
                }
                const resolvedGateway = {
                    ...gateway,
                    model: result.resolvedModel,
                    label: `${gateway.provider}:${result.resolvedModel}`,
                };
                const durationMs = Date.now() - startedAt;
                lease.succeed(durationMs, result.usageTotalTokens);
                recordAiGatewayEvent({ tier: options.orchestrationTier, role: options.role, provider: gateway.provider, model: result.resolvedModel, status: "success", durationMs, message: `fila ${lease.queueWaitMs}ms | tokens ~${result.usageTotalTokens || estimatedTokens}` });
                return { data: result.data, gateway: resolvedGateway, attempts };
            }

            const parts: any[] = [{ text: options.text }];
            if (options.mediaPart) parts.push(options.mediaPart);
            let data: T;
            try {
                data = await callGeminiJson<T>(
                    options.settings,
                    gateway,
                    options.systemInstruction,
                    options.responseSchemaConfig,
                    options.history,
                    parts,
                    policy.timeoutMs,
                );
            } catch (geminiError: any) {
                const isTimeout = /timeout|timed out|abort|excedeu/i.test(geminiError?.message || String(geminiError));
                if (isTimeout) {
                    const retryTimeoutMs = Math.min(20_000, policy.timeoutMs + 4_000);
                    console.warn(`[AI Gateway] Gemini ${gateway.model} sofreu timeout (${geminiError?.message || geminiError}); executando 1 retry com timeout ${retryTimeoutMs}ms...`);
                    await sleep(500);
                    data = await callGeminiJson<T>(
                        options.settings,
                        gateway,
                        options.systemInstruction,
                        options.responseSchemaConfig,
                        options.history,
                        parts,
                        retryTimeoutMs,
                    );
                } else {
                    throw geminiError;
                }
            }
            const durationMs = Date.now() - startedAt;
            lease.succeed(durationMs);
            recordAiGatewayEvent({ tier: options.orchestrationTier, role: options.role, provider: gateway.provider, model: gateway.model, status: "success", durationMs, message: `fila ${lease.queueWaitMs}ms | tokens estimados ${estimatedTokens}` });
            return { data, gateway, attempts };
        } catch (error: any) {
            excluded.add(lease.candidate.key);
            const durationMs = Date.now() - startedAt;
            const failureKind = lease.fail(error, durationMs, Number(error?.retryAfterMs || 0));
            const message = `${gateway.label} falhou (${failureKind}): ${error?.message || error}`;
            attempts.push(message);
            console.warn(`[AI Gateway] ${message}`);
            recordAiGatewayEvent({ tier: options.orchestrationTier, role: options.role, provider: gateway.provider, model: gateway.model, status: "error", message, durationMs });
        }
    }

    throw new Error(`Todos os gateways de IA falharam (${options.role}): ${attempts.join(" | ")}`);
};

export const extractLeadTextFromPrompt = (message: string) => {
    const raw = String(message || '').trim();
    const grouped = raw.match(/\[MENSAGENS DO LEAD NO MESMO TURNO\]\s*([\s\S]*?)(?:\n\s*\[REGRA DE CONVERSA\]|$)/i)?.[1];
    if (grouped) return grouped.trim();
    const caption = raw.match(/(?:Legenda do (?:usu[aá]rio|lead):)\s*([^\n]+)/i)?.[1];
    if (caption) return caption.trim();
    return raw
        .split(/\n\s*\[(?:OBSERVACAO INTERNA|INICIO DE CONVERSA|REGRA DE CONVERSA)[^\]]*\]/i)[0]
        .trim();
};

const makeFallbackStrategy = (message: string, leadMemory?: any) => {
    const literalText = extractLeadTextFromPrompt(message);
    const text = literalText.toLowerCase();
    const storedStage = String(leadMemory?.relationship_stage || 'new').toLowerCase();
    const relationshipStage = ['new', 'familiar', 'engaged', 'buyer', 'returning'].includes(storedStage)
        ? storedStage
        : 'new';
    const wantsMedia = /\b(foto|fotinha|fotos|selfie|nude|nudes|pr[eé]via|v[ií]deo)\b/i.test(text);
    const wantsAudio = /\b([aá]udio|voz|grava|ouvir sua voz|fala meu nome)\b/i.test(text);
    const wantsPayment = /\b(manda|passa|gera|pode gerar)\b.{0,18}\b(pix|chave)\b|\b(vou pagar|quero pagar|como pago)\b/i.test(text);
    const asksPrice = /\b(quanto custa|qual (?:o )?valor|qual (?:o )?pre[cç]o|fica quanto)\b/i.test(text);
    const asksProduct = /\b(vip|chamada|call|whats(?:app)?|personalizad[oa]|encontro|avalia[cç][aã]o)\b/i.test(text);
    const isSexual = /\b(nude|pelad[ao]|bunda|peito|pau|buceta|gozar|tes[aã]o|safad[ao]|putaria|comer|chupar|meter)\b/i.test(text);
    const isStart = /^\s*\/start(?:\s+\S+)?\s*$/i.test(literalText);
    const shouldSellNow = wantsPayment || asksPrice || asksProduct;
    const intent = isStart ? 'primeiro contato'
        : wantsPayment ? 'confirmar pagamento'
            : asksPrice ? 'perguntar preco'
                : wantsMedia ? 'pedir midia'
                    : wantsAudio ? 'pedir audio'
                        : isSexual ? 'conversa adulta'
                            : 'conversar';

    return {
        intent,
        lead_type: wantsPayment || asksPrice ? 'comprador' : isSexual ? 'tarado' : 'desconhecido',
        temperature: wantsPayment ? 90 : asksPrice || asksProduct ? 70 : isSexual ? 65 : 35,
        emotional_context: 'hipotese leve; responder primeiro ao conteudo literal',
        relationship_stage: isStart ? 'new' : relationshipStage,
        connection_cue: 'usar somente um detalhe confirmado da mensagem atual ou da memoria',
        objective: isStart ? 'abrir a conversa com simplicidade e descobrir o nome'
            : wantsMedia ? 'entregar a midia pedida se houver action disponivel'
                : wantsAudio ? 'responder ao pedido de audio sem desviar'
                    : wantsPayment ? 'confirmar o produto aceito antes de gerar pagamento'
                        : asksPrice ? 'informar o preco do produto identificado sem gerar pix'
                            : 'responder naturalmente e manter o assunto atual',
        product_to_sell: asksProduct ? 'produto citado pelo lead' : null,
        should_sell_now: shouldSellNow,
        response_angle: 'especifica, curta e coerente com o estagio real',
        must_answer: literalText || 'reconhecer o turno atual',
        next_step: isStart ? 'perguntar como ele se chama'
            : shouldSellNow ? 'responder a intencao comercial sem pressao'
                : 'reagir ao assunto e deixar um gancho natural',
        next_best_action: wantsPayment ? 'GENERATE_PAYMENT'
            : asksPrice || asksProduct ? 'MAKE_OFFER'
                : wantsMedia ? 'SEND_PREVIEW'
                    : isSexual ? 'FLIRT'
                        : isStart ? 'ASK' : 'TALK',
        message_plan: isStart ? ['cumprimentar', 'perguntar o nome'] : ['responder ao ponto principal', 'adicionar no maximo um gancho'],
        recommended_message_count: isStart ? 2 : 1,
        max_chars_per_message: 100,
        avoid: ['template', 'apelido precoce', 'troca brusca de assunto', 'venda sem sinal real', 'promessa sem action'],
        action_hint: wantsMedia ? 'send_custom_preview' : wantsPayment ? 'generate_pix_payment' : 'none',
        payment_value_hint: wantsPayment && /\bvip\b/i.test(text + ' ' + String(leadMemory?.last_offer || '')) ? VIP_PRICE : null,
        confidence: 0.72,
        memory_patch: {
            best_tone: isSexual ? 'provocante no ritmo do lead' : 'natural e atenta',
            emotional_context: '',
            relationship_stage: isStart ? 'new' : relationshipStage,
            next_personal_step: isStart ? 'descobrir o nome sem interrogar' : 'continuar o assunto atual',
            wanted_products: asksProduct ? ['produto citado pelo lead'] : [],
            rejected_products: [],
            desires: [],
            objections: [],
            known_facts: [],
            conversation_hooks: literalText ? [literalText.slice(0, 140)] : [],
            notes: [],
        },
    };
};

const mergeBrainAndDraftMemory = (brainPatch: any, draftPatch: any) => {
    const brain = brainPatch && typeof brainPatch === 'object' ? brainPatch : {};
    const draft = draftPatch && typeof draftPatch === 'object' ? draftPatch : {};
    const listKeys = ['wanted_products', 'rejected_products', 'desires', 'objections', 'known_facts', 'conversation_hooks', 'notes'];
    const relationshipRank: Record<string, number> = { new: 0, familiar: 1, engaged: 2, buyer: 3, returning: 4 };
    const brainStage = String(brain.relationship_stage || 'new');
    const draftStage = String(draft.relationship_stage || 'new');
    const relationshipStage = (relationshipRank[draftStage] ?? 0) >= (relationshipRank[brainStage] ?? 0)
        ? draftStage
        : brainStage;

    const merged: Record<string, unknown> = { ...brain, ...draft, relationship_stage: relationshipStage };
    for (const key of listKeys) {
        merged[key] = Array.from(new Set([
            ...(Array.isArray(brain[key]) ? brain[key] : []),
            ...(Array.isArray(draft[key]) ? draft[key] : []),
        ].map((item) => String(item || '').trim()).filter(Boolean)));
    }
    return merged;
};

const makeLocalFallbackResponse = (
    message: string,
    context?: {
        currentStats?: LeadStats | null;
        leadMemory?: any;
        isConversationStart?: boolean;
    },
    media?: { mimeType: string, data: string }
): AIResponse => {
    const literalText = extractLeadTextFromPrompt(message);
    const text = literalText.toLowerCase();
    const stats = context?.currentStats || { tarado: 5, financeiro: 10, carente: 20, sentimental: 20 };
    const hasImage = Boolean(media?.mimeType?.startsWith('image/'));
    const hasAudio = Boolean(media?.mimeType?.startsWith('audio/'));
    const paymentLike = /\b(comprovante|paguei|pix|recibo|banco|transfer[eê]ncia|qr|pagamento|caiu|confere)\b/i.test(text);
    const wantsMedia = /\b(foto|fotinha|fotos|selfie|nude|nudes|pr[eé]via|v[ií]deo)\b/i.test(text);
    const wantsCheckout = !wantsMedia && /\b(manda|passa|gera|pode gerar)\b.{0,18}\b(pix|chave)\b|\b(vou pagar|quero pagar|como pago)\b/i.test(text);
    const wantsVipPrice = /\bvip\b/i.test(text) && /\b(quanto|valor|pre[cç]o|custa)\b/i.test(text);
    const isSexual = /\b(nude|nudes|pelad[ao]|bunda|peito|pau|buceta|gozar|tes[aã]o|safad[ao]|putaria|comer|chupar|meter)\b/i.test(text);
    const relationshipStage = String(context?.leadMemory?.relationship_stage || 'new').trim().toLowerCase();
    const isNewRelationship = !relationshipStage || relationshipStage === 'new' || relationshipStage === 'unknown';
    const base = {
        lead_stats: stats,
        extracted_user_name: null,
        audio_transcription: null,
        payment_details: null,
        lead_memory_patch: null,
        decision_confidence: 0.35,
        memory_updates: [],
    };

    if (context?.isConversationStart || /^\s*\/start(?:\s+\S+)?\s*$/i.test(literalText)) {
        return { ...base, internal_thought: 'Fallback: primeiro contato simples.', lead_classification: 'desconhecido', current_state: 'WELCOME', messages: ['oiii, tudo bem?', 'como vc se chama?'], action: 'none' };
    }
    if (/\b(qual (?:e|é) (?:o )?seu nome|como vc se chama|como voc[eê] se chama|quem (?:e|é) vc)\b/i.test(text)) {
        return { ...base, internal_thought: 'Fallback: responder nome.', lead_classification: 'desconhecido', current_state: 'CONNECTION', messages: ['sou a larissa, mas pode me chamar de lari', 'e vc?'], action: 'none' };
    }
    if (/\b(quantos anos|sua idade|idade)\b/i.test(text)) {
        return { ...base, internal_thought: 'Fallback: responder idade.', lead_classification: 'desconhecido', current_state: 'CONNECTION', messages: ['tenho 19, e vc?'], action: 'none' };
    }
    if (hasImage && paymentLike) {
        return { ...base, internal_thought: 'Fallback: possível comprovante.', lead_classification: 'curioso', current_state: 'PAYMENT_CHECK', messages: ['vou conferir aqui rapidinho'], action: 'check_payment_status' };
    }
    if (hasImage) {
        return { ...base, internal_thought: 'Fallback: foto recebida sem inventar detalhes.', lead_classification: isSexual ? 'tarado' : 'curioso', current_state: isSexual ? 'HOT_TALK' : 'CONNECTION', messages: ['vi sim', 'o que vc queria que eu reparasse nela?'], action: 'none' };
    }
    if (hasAudio) {
        return { ...base, internal_thought: 'Fallback: áudio recebido.', lead_classification: 'desconhecido', current_state: 'CONNECTION', messages: ['ouvi aqui', 'gostei do seu jeito de falar'], action: 'none' };
    }
    if (wantsMedia) {
        return { ...base, internal_thought: 'Fallback: mídia pedida, entregar sem cobrar.', lead_classification: 'curioso', current_state: 'PREVIEW', messages: ['vou escolher uma que combine com o que vc pediu'], action: 'send_custom_preview' };
    }
    if (wantsVipPrice) {
        return { ...base, internal_thought: 'Fallback: informar preço sem gerar PIX.', lead_classification: 'curioso', current_state: 'SALES_PITCH', messages: [`o vip é R$ ${VIP_PRICE.toFixed(2).replace('.', ',')}`, 'quer que eu te explique o que tem nele?'], action: 'none' };
    }
    if (wantsCheckout && /\bvip\b/i.test(text + ' ' + String(context?.leadMemory?.last_offer || ''))) {
        return { ...base, internal_thought: 'Fallback: aceite explícito do VIP.', lead_classification: 'curioso', current_state: 'PAYMENT_CHECK', messages: ['fechou, vou gerar o pix do vip'], action: 'generate_pix_payment', payment_details: { value: VIP_PRICE, description: 'VIP Lari' } };
    }
    if (isSexual) {
        return { ...base, internal_thought: 'Fallback: acompanhar conversa adulta sem vender.', lead_classification: 'tarado', current_state: 'HOT_TALK', messages: ['vc é bem direto hein kkk', 'gostei de saber o que passou na sua cabeça'], action: 'none' };
    }
    if (/^\s*(oi+|oie|ol[aá]|e\s*a[ií]|eai|bom dia|boa tarde|boa noite)(?:[,!?.\s].*)?$/i.test(literalText)) {
        return { ...base, internal_thought: 'Fallback: saudação no estágio real.', lead_classification: 'desconhecido', current_state: 'CONNECTION', messages: isNewRelationship ? ['oiii, tudo bem?', 'como vc se chama?'] : ['oiii, tudo bem?'], action: 'none' };
    }
    return { ...base, internal_thought: 'Fallback: reconhecer sem inventar.', lead_classification: 'desconhecido', current_state: 'CONNECTION', messages: ['entendi', 'e como foi isso pra vc?'], action: 'none' };
};

export const sendMessageToGemini = async (sessionId: string, userMessage: string, context?: {
    userCity?: string;
    isHighTicket?: boolean;
    totalPaid?: number;
    currentStats?: LeadStats | null;
    minutesSinceOffer?: number;
    extraScript?: string;
    leadMemory?: any;
    isConversationStart?: boolean;
    leadProfile?: {
        deviceType?: string;
        city?: string;
        region?: string;
        country?: string;
        timezone?: string;
        language?: string;
        userAgent?: string;
        sourceUrl?: string;
        referer?: string;
        utm?: Record<string, unknown>;
        queryParams?: Record<string, unknown>;
    };
}, media?: { mimeType: string, data: string }) => {
    const executionStartedAt = Date.now();
    const aiSettings = await getAiRuntimeSettings();
    const orchestration = resolveAiOrchestrationPlan(context?.totalPaid || 0);
    initializeGenAI(aiSettings.geminiApiKey);
    if (!aiSettings.openRouterApiKey && !aiSettings.geminiApiKey && aiSettings.directGateways.length === 0) {
        throw new Error("[AI Gateway] Nenhuma chave de IA configurada. Não é permitido enviar respostas simuladas.");
    }

    const currentStats = parseLeadStats(context?.currentStats);
    const [previewResult, promptBlocksResult, messagesResult, purchasesResult] = await Promise.all([
        supabase
            .from('preview_assets')
            .select('id,name,description,media_type,stage,min_tarado,max_tarado,tags,triggers,priority,enabled,ai_analysis,analysis_status')
            .eq('enabled', true)
            .order('priority', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1000),
        supabase
            .from('prompt_blocks')
            .select('key,label,content,enabled,updated_at')
            .eq('enabled', true)
            .neq('key', 'auto_optimizer')
            .order('updated_at', { ascending: false })
            .limit(20),
        supabase
            .from('messages')
            .select('sender,content,created_at')
            .eq('session_id', sessionId)
            .in('sender', ['user', 'bot'])
            .order('created_at', { ascending: false })
            .limit(orchestration.historyMessageLimit),
        supabase
            .from('messages')
            .select('content,payment_data,created_at')
            .eq('session_id', sessionId)
            .eq('sender', 'system')
            .order('created_at', { ascending: false })
            .limit(30),
    ]);

    let previewRows: any[] | null = previewResult.data as any[] | null;
    let previewError = previewResult.error;
    if (previewError && /ai_analysis|analysis_status/i.test(String(previewError.message || ''))) {
        const legacyPreviewResult = await supabase
            .from('preview_assets')
            .select('id,name,description,media_type,stage,min_tarado,max_tarado,tags,triggers,priority,enabled')
            .eq('enabled', true)
            .order('priority', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1000);
        previewRows = legacyPreviewResult.data;
        previewError = legacyPreviewResult.error;
    }

    const rankedPreviewRows = (!previewError ? (previewRows || []) : [])
        .map((preview: any) => ({
            ...preview,
            contextual_score: scorePreviewForContext(preview, userMessage),
        }))
        .sort((a: any, b: any) => Number(b.contextual_score || 0) - Number(a.contextual_score || 0)
            || Number(b.priority || 0) - Number(a.priority || 0));

    const previewsCatalog = rankedPreviewRows
        .slice(0, 40)
        .map((p: any) => {
            const tags = Array.isArray(p.tags) ? p.tags.join(', ') : '';
            const desc = String(p.description || '').replace(/\s+/g, ' ').slice(0, 160);
            const trig = String(p.triggers || '').replace(/\s+/g, ' ').slice(0, 160);
            const visual = p.ai_analysis && typeof p.ai_analysis === 'object'
                ? [p.ai_analysis.pose, p.ai_analysis.outfit, p.ai_analysis.accessories?.join?.(', '), p.ai_analysis.setting, p.ai_analysis.framing, p.ai_analysis.explicitness, p.ai_analysis.moment_context, p.ai_analysis.time_compatibility?.join?.(', ')].filter(Boolean).join(' | ')
                : '';
            const taradoRange = `${Number(p.min_tarado ?? 0)}-${Number(p.max_tarado ?? 100)}`;
            return `ID: ${p.id} | Nome: ${p.name} | Tipo: ${p.media_type} | Fase: ${p.stage || 'PREVIEW'} | Tarado: ${taradoRange} | Tags: ${tags} | Visual: ${visual || desc} | Quando usar: ${trig || desc}`;
        })
        .join('\n');

    const { data: promptBlocks, error: promptBlocksError } = promptBlocksResult;

    const promptBlocksText = (!promptBlocksError ? (promptBlocks || []) : [])
        .map((block: any) => {
            const key = String(block.key || 'bloco');
            const label = String(block.label || key);
            const content = String(block.content || '').trim().slice(0, 2500);
            return content ? `## ${label} (${key})\n${content}` : '';
        })
        .filter(Boolean)
        .join('\n\n');

    const dynamicScript = [
        // Contexto operacional deste turno vem primeiro para nunca ser cortado por
        // blocos longos do painel (limite total de 12 mil caracteres).
        context?.extraScript || "",
        promptBlocksText,
    ].filter(Boolean).join('\n\n').slice(0, orchestration.promptBlockMaxChars);

    // O perfil persistente guarda a historia longa; o modelo recebe apenas a janela recente.
    const dbMessages = [...(messagesResult.data || [])].reverse();
    // Cada /start abre um episodio novo. O marcador persistido impede que o turno
    // seguinte reimporte flerte, venda ou intimidade de episodios anteriores.
    const promptMessages = filterConversationEpisodeMessages(
        dbMessages,
        context?.leadMemory?.metadata?.conversation_started_at,
        context?.isConversationStart,
    );
    const episodeLeadMessageCount = promptMessages.filter((message: any) => message.sender === 'user').length;

    const purchaseHistory = (purchasesResult.data || [])
        .filter((message: any) => message?.payment_data?.paid === true
            || /PAGAMENTO CONFIRMADO/i.test(String(message?.content || '')))
        .map((message: any) => {
            const data = message?.payment_data || {};
            const content = String(message?.content || '');
            const description = String(data.description || content.match(/PAGAMENTO CONFIRMADO(?: VIA WEBHOOK)? - (.*?) - R\$/i)?.[1] || 'produto').trim();
            const value = Number(data.value || content.match(/R\$\s*(\d+(?:[.,]\d{1,2})?)/i)?.[1]?.replace(',', '.') || 0);
            const identity = `${description.toLowerCase().replace(/\s+/g, ' ')}:${value.toFixed(2)}`;
            return { identity, description, value, at: String(data.paid_at || message?.created_at || '') };
        })
        .filter((purchase: any, index: number, rows: any[]) => rows.findIndex((row) => row.identity === purchase.identity) === index)
        .slice(0, 10);

    const purchaseHistoryText = purchaseHistory.length > 0
        ? purchaseHistory.map((purchase: any) => `- ${purchase.description}: R$ ${purchase.value.toFixed(2).replace('.', ',')} (${purchase.at || 'data nao informada'})`).join('\n')
        : '- nenhum produto confirmado encontrado na janela operacional';

    const recentBotMessages = (promptMessages || [])
        .filter((m: any) => m.sender === 'bot' && typeof m.content === 'string' && !m.content.startsWith('[M'))
        .slice(-8)
        .map((m: any) => String(m.content || '').trim())
        .filter(Boolean);

    const recentWords = Array.from(new Set(
        recentBotMessages
            .join(' ')
            .toLowerCase()
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .match(/\b[a-z0-9]{4,}\b/g) || []
    ))
        .filter(w => ['amor', 'anjo', 'vida', 'nossa', 'imagina', 'perfeito', 'gostoso', 'vip'].includes(w))
        .slice(0, 12);

    const antiRepeatText = [
        recentBotMessages.length > 0 ? `Ultimas respostas da Lari:\n${recentBotMessages.map(m => `- ${m}`).join('\n')}` : '',
        recentWords.length > 0 ? `Evite repetir agora: ${recentWords.join(', ')}` : ''
    ].filter(Boolean).join('\n\n');

    const baseInstruction = getSystemInstruction(
        context?.userCity,
        undefined,
        context?.isHighTicket,
        context?.totalPaid || 0,
        currentStats,
        context?.minutesSinceOffer || 999,
        previewsCatalog,
        dynamicScript,
        context?.leadMemory || null,
        antiRepeatText,
        context?.leadProfile || null,
    ) + `

# MASTER BRAIN ÚNICO — CONTEXTO INTERNO
- Nivel: ${orchestration.tier} (${orchestration.label}).
- Total confirmado: R$ ${orchestration.totalPaid.toFixed(2).replace('.', ',')}.
- Mensagens do lead neste episodio: ${episodeLeadMessageCount}.
- Modo: ${orchestration.objective}.
- Leitura, estrategia, redacao, memoria e escolha de action acontecem nesta unica chamada principal.
- A revisao externa e excepcional e so pode rodar em pagamento, contradicao, falha evidente ou baixa confianca.
- Mais inteligencia melhora memoria, coerencia, personalizacao e qualidade. Ela nunca autoriza pressao, culpa, urgencia falsa, exploracao de solidao, dificuldade financeira ou dependencia emocional.
- Se REALITY_STATE.adultVerified=true, a maioridade ja foi confirmada no presell: nunca pergunte idade de novo. Se estiver false, respeite o gate do backend.
- Depois de uma compra, primeiro confirme entrega e satisfacao. Uma nova oferta so entra quando combinar com um pedido, preferencia ou abertura real do lead.

# COMPRAS CONFIRMADAS — CONTEXTO INTERNO
${purchaseHistoryText}

⚠️ IMPORTANTE: RESPONDA APENAS NO FORMATO JSON.`;

    // Agrupa os varios baloes do mesmo turno e garante history valido para o SDK Gemini.
    const cleanHistory = buildCleanAiHistory(
        promptMessages || [],
        orchestration.tier === 'elite' ? 1_600 : orchestration.tier === 'premium' ? 1_400 : orchestration.tier === 'buyer' ? 1_200 : 1_100,
        orchestration.historyMaxEntries,
        orchestration.historyMaxChars,
    );

    // 3. Montar Mensagem Atual (Com ou sem mídia)
    const currentMessageParts: any[] = [{ text: userMessage }];

    if (media) {
        currentMessageParts.push({
            inlineData: {
                mimeType: media.mimeType,
                data: media.data
            }
        });
    }

    let attempt = 0;
    const maxRetries = 1;

    while (attempt < maxRetries) {
        try {
            let strategy: any = makeFallbackStrategy(userMessage, context?.leadMemory);
            let strategyStatus = 'integrado na chamada unica';
            let strategyResultInfo: any = null;
            let draftResultInfo: any = null;
            let reviewResultInfo: any = null;
            let evaluatorResultInfo: any = null;
            const draftPrompt = buildLariDraftPrompt(baseInstruction);

            const draftParts: any[] = [{
                text: `${userMessage}

[MODO MASTER BRAIN]
Resolva agora, em uma unica decisao, entendimento, continuidade, estrategia comercial, memoria, ferramenta e resposta final.
Use somente fatos e opcoes do backend. Nao espere outra IA completar seu trabalho.`
            }];
            if (media) draftParts.push(currentMessageParts[1]);
            let mediaRecoveryUsed = false;
            let draftResult: Awaited<ReturnType<typeof callAiGatewayJson<AIResponse>>>;
            const draftStartTime = Date.now();
            try {
                draftResult = await callAiGatewayJson<AIResponse>({
                    settings: aiSettings,
                    role: "draft",
                    orchestrationTier: orchestration.tier,
                    routingKey: sessionId,
                    schemaName: "responseSchema",
                    systemInstruction: draftPrompt,
                    responseSchemaConfig: responseSchema as any,
                    history: cleanHistory,
                    text: draftParts[0].text,
                    mediaPart: media ? currentMessageParts[1] : undefined,
                });
            } catch (visionError: any) {
                const hasImage = Boolean(media?.mimeType?.startsWith('image/'));
                if (!hasImage) throw visionError;

                mediaRecoveryUsed = true;
                console.warn('[AI Gateway] Visao indisponivel ou bloqueada; repetindo o turno pelo cerebro textual:', visionError?.message || visionError);

                const textOnlyRecoveryPrompt = `${draftParts[0].text}

[RECUPERACAO INTERNA DE MIDIA]
O lead enviou uma foto que o sistema de visao nao conseguiu analisar.
Responda usando a legenda, o historico, a memoria e o perfil completo do lead.
Nao diga que houve erro, bloqueio ou censura. Nao peca para reenviar a foto.
Nao invente detalhes visuais nem descreva anatomia que voce nao confirmou.
Reconheca o envio de forma natural e reaja ao clima real da legenda.`;

                draftResult = await callAiGatewayJson<AIResponse>({
                    settings: aiSettings,
                    role: "draft",
                    orchestrationTier: orchestration.tier,
                    routingKey: sessionId,
                    schemaName: "responseSchema",
                    systemInstruction: draftPrompt,
                    responseSchemaConfig: responseSchema as any,
                    history: cleanHistory,
                    text: textOnlyRecoveryPrompt,
                });
            }
            const responseText = JSON.stringify(draftResult.data);

            draftResultInfo = {
                name: "Rascunho da Lari",
                role: "draft",
                model: draftResult.gateway.model,
                provider: draftResult.gateway.provider,
                duration_ms: Date.now() - draftStartTime,
                prompt: draftPrompt,
                user_prompt: draftParts[0].text,
                gateway_attempts: draftResult.attempts,
                output: toSerializableDebugValue(draftResult.data),
            };

            console.log(`AI Gateway Draft (${draftResult.gateway.label}) Attempt ${attempt + 1}:`, responseText);

            const jsonResponse = draftResult.data;
            if (!jsonResponse || typeof jsonResponse !== 'object') {
                throw new Error('Rascunho da IA nao retornou um objeto JSON');
            }
            jsonResponse.messages = normalizeAiMessageList(jsonResponse.messages);
            jsonResponse.lead_memory_patch = mergeBrainAndDraftMemory(strategy?.memory_patch, jsonResponse.lead_memory_patch);
            jsonResponse.next_best_action = jsonResponse.next_best_action || strategy?.next_best_action || 'TALK';
            jsonResponse.decision_confidence = Math.max(0, Math.min(1, Number(jsonResponse.decision_confidence ?? strategy?.confidence ?? 0.5)));
            jsonResponse.memory_updates = Array.isArray(jsonResponse.memory_updates) ? jsonResponse.memory_updates.slice(0, 12) : [];
            jsonResponse.offer_id = jsonResponse.offer_id ?? null;
            jsonResponse.recommended_message_count = Math.max(2, Math.min(4, Number(jsonResponse.messages?.length || strategy?.recommended_message_count || 2)));
            jsonResponse.max_chars_per_message = Math.max(45, Math.min(85, Number(Math.max(0, ...(jsonResponse.messages || []).map((message) => String(message || '').length)) || strategy?.max_chars_per_message || 75)));
            strategy = {
                ...strategy,
                intent: jsonResponse.lead_classification || strategy?.intent || 'conversa',
                relationship_stage: jsonResponse.lead_memory_patch?.relationship_stage || strategy?.relationship_stage || context?.leadMemory?.relationship_stage || 'new',
                objective: jsonResponse.next_best_action || 'TALK',
                next_step: jsonResponse.next_best_action || 'TALK',
                next_best_action: jsonResponse.next_best_action || 'TALK',
                confidence: jsonResponse.decision_confidence,
                memory_patch: jsonResponse.lead_memory_patch || strategy?.memory_patch || null,
            };
            strategyStatus = `integrado no Master Brain via ${draftResult.gateway.label}`;

            let review: any = {
                approved: true,
                score: 8,
                issues: [],
                messages: [],
                action: jsonResponse.action,
                current_state: jsonResponse.current_state,
                preview_id: jsonResponse.preview_id ?? null,
                payment_details: jsonResponse.payment_details ?? null
            };
            let reviewStatus = 'sem revisao';
            const criticalReviewNeeded = needsLariReview({
                isConversationStart: context?.isConversationStart,
                relationshipStage: strategy?.relationship_stage || context?.leadMemory?.relationship_stage,
                userText: extractLeadTextFromPrompt(userMessage),
                action: jsonResponse.action,
                messages: jsonResponse.messages,
                strategyConfidence: strategy?.confidence,
            });
            const useSeparateReviewCall = aiSettings.aiReviewEnabled
                && shouldRunAiReview(orchestration, criticalReviewNeeded);

            if (!aiSettings.aiReviewEnabled) {
                reviewStatus = 'desativada no painel';
            } else if (!useSeparateReviewCall) {
                reviewStatus = 'guardas locais (rota rapida)';
            } else {
            try {
                const reviewStartTime = Date.now();
                const reviewPrompt = buildLariReviewPrompt(baseInstruction);

                const reviewResult = await callAiGatewayJson<any>({
                    settings: aiSettings,
                    role: "review",
                    orchestrationTier: orchestration.tier,
                    routingKey: sessionId,
                    schemaName: "reviewSchema",
                    systemInstruction: reviewPrompt,
                    responseSchemaConfig: reviewSchema as any,
                    history: cleanHistory,
                    text: `MENSAGEM DO LEAD:\n${userMessage}

ESTRATEGIA:\n${JSON.stringify(strategy)}

RASCUNHO DA LARI:\n${JSON.stringify(jsonResponse)}

Revise e corrija se necessario.`
                });
                review = reviewResult.data;
                reviewStatus = `ia revisora via ${reviewResult.gateway.label}`;
                reviewResultInfo = {
                    name: "Revisora de Qualidade",
                    role: "review",
                    model: reviewResult.gateway.model,
                    provider: reviewResult.gateway.provider,
                    duration_ms: Date.now() - reviewStartTime,
                    prompt: reviewPrompt,
                    user_prompt: `MENSAGEM DO LEAD:\n${userMessage}\n\nESTRATEGIA:\n${JSON.stringify(strategy)}\n\nRASCUNHO DA LARI:\n${JSON.stringify(jsonResponse)}\n\nRevise e corrija se necessario.`,
                    gateway_attempts: reviewResult.attempts,
                    output: reviewResult.data,
                };
            } catch (reviewError: any) {
                console.warn("Revisora falhou, mantendo rascunho da Lari:", reviewError?.message || reviewError);
            }
            console.log("🧪 Revisão Lari:", JSON.stringify(review));

            }

            const reviewScore = Number(review?.score);
            if (Number.isFinite(reviewScore) && reviewScore < 70) {
                review.approved = false;
                review.issues = Array.from(new Set([
                    ...(Array.isArray(review?.issues) ? review.issues : []),
                    'score_abaixo_do_minimo',
                ]));
            }
            const reviewedMessages = Array.isArray(review?.messages)
                ? normalizeAiMessageList(review.messages)
                : [];

            // A revisora excepcional nao pode degradar silenciosamente uma
            // decisao especifica do Master Brain em fala generica.
            // A revisora so substitui quando reprova/corrige ou quando o draft
            // realmente veio vazio.
            const reviewIssues = Array.isArray(review?.issues) ? review.issues.filter(Boolean) : [];
            const reviewShouldReplace = reviewedMessages.length > 0
                && (jsonResponse.messages.length === 0 || review?.approved === false || reviewIssues.length > 0);
            if (reviewShouldReplace) {
                jsonResponse.messages = reviewedMessages;
                if (REVIEW_ACTIONS.has(String(review?.action || ''))) {
                    jsonResponse.action = review.action;
                }
                if (REVIEW_STATES.has(String(review?.current_state || ''))) {
                    jsonResponse.current_state = review.current_state;
                }
                if (Object.prototype.hasOwnProperty.call(review || {}, 'preview_id')) {
                    jsonResponse.preview_id = review.preview_id ?? null;
                }
                if (Object.prototype.hasOwnProperty.call(review || {}, 'payment_details')) {
                    jsonResponse.payment_details = review.payment_details ?? null;
                }
            }

            let evaluator: any = { approved: true, score: null, issues: [], messages: [] };
            let evaluatorStatus = orchestration.evaluator ? 'avaliadora indisponivel' : 'nao exigida neste nivel';
            const useEvaluatorCall = aiSettings.aiEvaluatorEnabled && orchestration.evaluator;

            if (useEvaluatorCall) {
                try {
                    const evaluatorStartTime = Date.now();
                    const evaluatorPrompt = `${baseInstruction}

# IA 4: AVALIADORA FINAL DE CLIENTE ELITE
Voce e a ultima camada antes do envio. Avalie a conversa inteira, o plano, a memoria, as compras confirmadas e a resposta final da Lari.
Preserve espontaneidade, perspectiva feminina, continuidade, produto pedido, preco combinado e actions validas.
Corrija contradicao, repeticao, intimidade precoce, resposta generica, promessa de midia sem action, PIX sem aceite, oferta imediatamente depois da compra sem abertura real ou qualquer pressao baseada em solidao e dificuldade financeira.
Mais inteligencia significa melhor leitura e servico, nao mais mensagens nem mais insistencia.
Se corrigir, devolva somente os baloes finais e os campos operacionais corretos. Nao explique nada ao lead.
Retorne JSON com: approved, score, issues, messages, action, current_state, preview_id e payment_details.`;

                    const evaluatorResult = await callAiGatewayJson<any>({
                        settings: aiSettings,
                        role: 'evaluator',
                        orchestrationTier: orchestration.tier,
                        routingKey: sessionId,
                        schemaName: 'reviewSchema',
                        systemInstruction: evaluatorPrompt,
                        responseSchemaConfig: reviewSchema as any,
                        history: cleanHistory,
                        text: `MENSAGEM DO LEAD:\n${userMessage}

ESTRATEGIA:\n${JSON.stringify(strategy)}

RESPOSTA FINAL PROPOSTA:\n${JSON.stringify(jsonResponse)}

Faca a avaliacao final.`
                    });
                    evaluator = evaluatorResult.data;
                    evaluatorStatus = `ia avaliadora via ${evaluatorResult.gateway.label}`;
                    evaluatorResultInfo = {
                        name: "Avaliadora Elite",
                        role: "evaluator",
                        model: evaluatorResult.gateway.model,
                        provider: evaluatorResult.gateway.provider,
                        duration_ms: Date.now() - evaluatorStartTime,
                        prompt: evaluatorPrompt,
                        user_prompt: `MENSAGEM DO LEAD:\n${userMessage}\n\nESTRATEGIA:\n${JSON.stringify(strategy)}\n\nRESPOSTA FINAL PROPOSTA:\n${JSON.stringify(jsonResponse)}\n\nFaca a avaliacao final.`,
                        gateway_attempts: evaluatorResult.attempts,
                        output: evaluatorResult.data,
                    };

                    const evaluatorScore = Number(evaluator?.score);
                    if (Number.isFinite(evaluatorScore) && evaluatorScore < 70) {
                        evaluator.approved = false;
                        evaluator.issues = Array.from(new Set([
                            ...(Array.isArray(evaluator?.issues) ? evaluator.issues : []),
                            'score_abaixo_do_minimo',
                        ]));
                    }
                    const evaluatedMessages = Array.isArray(evaluator?.messages)
                        ? normalizeAiMessageList(evaluator.messages)
                        : [];
                    const evaluatorIssues = Array.isArray(evaluator?.issues) ? evaluator.issues.filter(Boolean) : [];
                    const evaluatorShouldReplace = evaluatedMessages.length > 0
                        && (jsonResponse.messages.length === 0 || evaluator?.approved === false || evaluatorIssues.length > 0);
                    if (evaluatorShouldReplace) {
                        jsonResponse.messages = evaluatedMessages;
                        if (REVIEW_ACTIONS.has(String(evaluator?.action || ''))) {
                            jsonResponse.action = evaluator.action;
                        }
                        if (REVIEW_STATES.has(String(evaluator?.current_state || ''))) {
                            jsonResponse.current_state = evaluator.current_state;
                        }
                        if (Object.prototype.hasOwnProperty.call(evaluator || {}, 'preview_id')) {
                            jsonResponse.preview_id = evaluator.preview_id ?? null;
                        }
                        if (Object.prototype.hasOwnProperty.call(evaluator || {}, 'payment_details')) {
                            jsonResponse.payment_details = evaluator.payment_details ?? null;
                        }
                    }
                } catch (evaluatorError: any) {
                    evaluatorStatus = 'falhou; resposta revisada preservada';
                    console.warn('Avaliadora final falhou, mantendo resposta revisada:', evaluatorError?.message || evaluatorError);
                }
            } else if (orchestration.evaluator && !aiSettings.aiEvaluatorEnabled) {
                evaluatorStatus = 'desativada no painel';
            }

            const orchestrationThought = `ORQUESTRACAO: ${orchestration.tier} | R$ ${orchestration.totalPaid.toFixed(2)} | ${orchestration.objective}`;
            const strategyThought = `CEREBRO CENTRAL (${strategyStatus}${mediaRecoveryUsed ? ', recuperacao textual de midia' : ''}): ${strategy?.intent || 'n/a'} | ${strategy?.lead_type || 'n/a'} | ${strategy?.objective || 'n/a'} | ${strategy?.next_step || 'n/a'} | conexao: ${strategy?.connection_cue || 'n/a'}`;
            const reviewThought = `REVISAO (${reviewStatus}): ${review?.approved ? 'aprovada' : 'corrigida'} | score ${review?.score ?? 'n/a'} | ${(review?.issues || []).slice(0, 3).join(', ')}`;
            const evaluatorThought = `AVALIADORA (${evaluatorStatus}): ${evaluator?.approved === false ? 'corrigida' : 'aprovada'} | score ${evaluator?.score ?? 'n/a'} | ${(evaluator?.issues || []).slice(0, 3).join(', ')}`;
            const memoryThought = `MEMORIA: ${strategy?.relationship_stage || 'new'} | ${strategy?.emotional_context || 'n/a'} | ${strategy?.memory_patch?.next_personal_step || 'n/a'}`;
            jsonResponse.internal_thought = [orchestrationThought, strategyThought, reviewThought, evaluatorThought, memoryThought, jsonResponse.internal_thought].filter(Boolean).join('\n');

            // Validar e Sanitizar Lead Stats
            // GARANTIR QUE SEMPRE EXISTA para não quebrar o update no banco
            // --- LÓGICA DE STATS BLINDADA ---
            const newStatsFromAI = jsonResponse.lead_stats;

            if (newStatsFromAI) {
                jsonResponse.lead_stats = parseLeadStats(newStatsFromAI);
            } else {
                jsonResponse.lead_stats = currentStats;
            }

            // Montar payload estruturado para o Inspetor de Prompt e Resposta da IA
            const totalDurationMs = Date.now() - executionStartedAt;
            const cleanHistoryForDebug = (cleanHistory || []).map((h: any) => ({
                role: h.role === 'model' ? 'assistant' : 'user',
                content: String(h.parts?.[0]?.text || ''),
            }));

            const rawResponseForDebug = toSerializableDebugValue(draftResult.data) as Record<string, any>;
            const debugStages: Record<string, any> = {};
            if (strategyResultInfo) debugStages.strategy = strategyResultInfo;
            if (draftResultInfo) debugStages.draft = draftResultInfo;
            if (reviewResultInfo) debugStages.review = reviewResultInfo;
            if (evaluatorResultInfo) debugStages.evaluator = evaluatorResultInfo;
            for (const stage of Object.values(debugStages)) {
                stage.clean_history = cleanHistoryForDebug;
            }

            const aiDebug: AiDebugData = {
                timestamp: new Date().toISOString(),
                run_id: crypto.randomUUID(),
                model: draftResult?.gateway?.model || 'gemini-3.5-flash',
                provider: draftResult?.gateway?.provider || 'gemini',
                tier: orchestration.tier,
                duration_ms: totalDurationMs,
                system_prompt: draftPrompt,
                user_prompt: draftParts[0]?.text || userMessage,
                clean_history: cleanHistoryForDebug,
                raw_response: rawResponseForDebug,
                final_response: {
                    internal_thought: jsonResponse.internal_thought,
                    lead_classification: jsonResponse.lead_classification,
                    lead_stats: jsonResponse.lead_stats,
                    extracted_user_name: jsonResponse.extracted_user_name,
                    audio_transcription: jsonResponse.audio_transcription,
                    current_state: jsonResponse.current_state,
                    messages: jsonResponse.messages,
                    action: jsonResponse.action,
                    next_best_action: jsonResponse.next_best_action,
                    decision_confidence: jsonResponse.decision_confidence,
                    payment_details: jsonResponse.payment_details,
                    preview_id: jsonResponse.preview_id,
                    offer_id: jsonResponse.offer_id,
                    preview_request: jsonResponse.preview_request,
                    lead_memory_patch: jsonResponse.lead_memory_patch,
                    memory_updates: jsonResponse.memory_updates,
                    recommended_message_count: jsonResponse.recommended_message_count,
                    max_chars_per_message: jsonResponse.max_chars_per_message,
                },
                stages: Object.keys(debugStages).length > 0 ? debugStages : undefined,
                media: { attached: Boolean(media), mime_type: media?.mimeType || null },
                tokens_estimated: estimateAiTokens(draftPrompt, draftParts[0]?.text || userMessage, cleanHistoryForDebug),
            };
            jsonResponse.ai_debug = toSerializableDebugValue(aiDebug);

            console.log("[AI Gateway Final Return] Stats Calculados:", JSON.stringify(jsonResponse.lead_stats));

            return jsonResponse;

        } catch (error: any) {
            console.error(`Attempt ${attempt + 1} failed:`, error.message);

            const isJsonError = error instanceof SyntaxError || error.message.includes('JSON');
            const isNetworkError = error.message.includes('503') || error.message.includes('Overloaded') || error.message.includes('fetch');

            if (isJsonError || isNetworkError) {
                console.warn(`⚠️ Retrying due to error: ${error.message}`);
                attempt++;
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, 500 * attempt));
                    continue;
                }
            } else {
                // If it's a critical API error (validation etc), break immediately
                attempt = maxRetries;
            }

            // Fotos sensiveis podem ser recusadas por todos os modelos de visao.
            // Se ate a recuperacao textual falhar, nunca deixe o lead no vacuo.
            if (media?.mimeType?.startsWith('image/')) {
                console.error('[AI Gateway] Recuperacao de foto esgotada; usando resposta local de emergencia.');
                return makeLocalFallbackResponse(userMessage, {
                    currentStats,
                    leadMemory: context?.leadMemory,
                    isConversationStart: context?.isConversationStart,
                }, media);
            }

            // Se esgotou todas as tentativas com todas as IAs reais
            if (attempt >= maxRetries) {
                throw new Error(`[AI Gateway] Todas as IAs reais falharam após ${maxRetries} tentativas: ${error?.message || error}`);
            }
        }
    }

    throw new Error("[AI Gateway] Resposta de IA indisponível.");
};
