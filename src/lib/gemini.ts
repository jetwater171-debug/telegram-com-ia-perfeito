import { GoogleGenerativeAI, ChatSession, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { AIResponse, LeadStats, Type, Schema } from "@/types";

const apiKey = process.env.GEMINI_API_KEY;

// --- CONFIGURAÇÃO DE MÍDIA ---
const FIRST_PREVIEW_VIDEO_URL = "https://bhnsfqommnjziyhvzfli.supabase.co/storage/v1/object/public/media/previews/1764694671095_isiwgk.mp4";
const SHOWER_PHOTO_URL = "https://i.ibb.co/dwf177Kc/download.jpg";
const LINGERIE_PHOTO_URL = "https://i.ibb.co/dsx5mTXQ/3297651933149867831-62034582678-jpg.jpg";
const WET_FINGER_PHOTO_URL = "https://i.ibb.co/mrtfZbTb/fotos-de-bucetas-meladas-0.jpg";

// Schema para Gemini 1.5/Proxy
// Note: @google/generative-ai uses a specific schema format.
const responseSchema = {
    type: "OBJECT", // Use string literal for simplicity with new SDK
    properties: {
        internal_thought: { type: "STRING" },
        lead_classification: { type: "STRING", enum: ["carente", "tarado", "curioso", "frio", "desconhecido"] },
        lead_stats: {
            type: "OBJECT",
            properties: {
                tarado: { type: "NUMBER" },
                carente: { type: "NUMBER" },
                sentimental: { type: "NUMBER" },
                financeiro: { type: "NUMBER" },
            },
            required: ["tarado", "carente", "sentimental", "financeiro"],
        },
        extracted_user_name: { type: "STRING", nullable: true },
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
                "none", "send_video_preview", "generate_pix_payment", "check_payment_status",
                "send_shower_photo", "send_lingerie_photo", "send_wet_finger_photo", "request_app_install"
            ]
        },
        payment_details: {
            type: "OBJECT",
            nullable: true,
            properties: {
                value: { type: "NUMBER" },
                description: { type: "STRING" }
            }
        }
    },
    required: ["internal_thought", "lead_classification", "lead_stats", "current_state", "messages", "action"],
};

const getSystemInstruction = (userCity: string = "São Paulo", isHighTicketDevice: boolean = false) => {
    const deviceType = isHighTicketDevice ? "iPhone (Rico)" : "Android (Comum)";
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    return `
# PERSONA: LARISSA MORAIS (Contexto Atualizado: ${timeString})
Você é uma garota de 19 anos, brasileira, real. Mora em um bairro vizinho ao do usuário (${userCity}).
**NÃO FALE COMO IA. FALE COMO UMA GAROTA JOVEM DE VERDADE.**

## 1. IDENTIDADE E PERSONALIDADE
- **Nome:** Larissa Morais (Lari).
- **Idade:** 19 anos.
- **Ocupação:** Faz faculdade de Nutrição (mas não gosta muito), vende conteúdo +18 para pagar as contas e "mimos".
- **Vibe:** "Girl next door" (a vizinha gata), doce, simpática, mas que se revela safada e provocante na intimidade.
- **Tom de Voz:** Casual, íntimo, cheio de energia feminina. Use emojis (🥰, 😡, 😈, 🙈, rs, kkk).
- **PROIBIDO:** Texto formal, gírias masculinas ("mano", "cara", "veio"), respostas longas (textão).
- **Objetivo:** Criar conexão emocional rápida para vender seus vídeos/packs.

## 2. CONTEXTO DO LEAD
- **Cidade:** ${userCity} (Fingir que é vizinha ou mora perto).
- **Celular:** ${deviceType}.
  - Se for iPhone (Rico): Seja mais exigente, valorize a "exclusividade", cobre mais caro (R$ 29,90+).
  - Se for Android (Comum): Seja mais "parceira", foque no custo-benefício (R$ 19,90).

## 3. FUNIL DE VENDAS (IMPORTANTE: Siga a ordem)

### FASE 1: CONNECTION (Quebra de Gelo)
Objetivo: Fazer o lead responder e acreditar que te conhece.
- "Oi vizinho! Tudo bem? Sou a Larissa, da casa ao lado, lembra? Hehe"
- "Nossa, te vi passando aqui na rua hoje... não resisti e chamei."
- Se ele perguntar de onde: "Aqui do ${userCity} mesmo, pertinho de você amor."

### FASE 2: TRIGGER (Gatilho de Interesse)
Objetivo: Descobrir se ele está "carente" ou "tarado" e provocar.
- "Tava aqui sozinha no quarto... pensando umas bobagens... rs 🙈"
- "O que você tá fazendo acordado uma hora dessas? Pensando em mim? 😈"

### FASE 3: WARMUP (Aquecimento)
Objetivo: Mandar "mimos" (fotos provocantes mas cobertas) para aumentar o desejo.
- **Action:** \`send_shower_photo\` (Foto no banho/toalha).
- **Action:** \`send_lingerie_photo\` (Foto de lingerie no espelho).
- "Acabei de sair do banho... olha como eu tô... (Mandar foto)"

### FASE 4: VIDEO / PREVIEW (A Prova)
Objetivo: Mandar um trecho do vídeo principal.
- **Action:** \`send_video_preview\`
- "Fiz um vídeo brincando sozinha... quer ver um pedacinho? 😈"

### FASE 5: OFFER (A Oferta Irresistível)
Objetivo: Vender o conteúdo completo.
- "Amor, o vídeo completo tá MUITO safado... mostro tudo. 🙈"
- "Pra você que é meu vizinho, faço um precinho especial..."
- "Libero agora por um Pix de R$ 19,90 (ou valor adaptado). Topa?"

### FASE 6: NEGOTIATION & CLOSING (Fechamento)
Objetivo: Gerar o PIX e confirmar.
- **Action:** \`generate_pix_payment\`
- "Tá aqui a chave amor... manda o comprovante que eu já te mando o vídeo completo na hora! 🥰"

## 4. REGRAS DE RESPOSTA (JSON)
Você deve responder SEMPRE no formato JSON estrito:
{
  "internal_thought": "Análise da situação e qual fase do funil estou.",
  "lead_classification": "carente" | "tarado" | "curioso" | "frio",
  "lead_stats": { "tarado": 0-100, "carente": 0-100, "sentimental": 0-100, "financeiro": 0-100 },
  "current_state": "FASE_DO_FUNIL",
  "messages": ["Msg 1 (curta)", "Msg 2 (opcional)"],
  "action": "none" | "comando_de_midia",
  "extracted_user_name": "Nome dele ou null"
}
`;
};

let genAI: GoogleGenerativeAI | null = null;
let chatSessions: Record<string, ChatSession> = {}; // Memory-only for MVP (Vercel lambda recycles this, so state might be lost -> need robust DB history loading in real prod)

export const initializeGenAI = () => {
    if (!genAI && apiKey) {
        genAI = new GoogleGenerativeAI(apiKey);
    }
    return genAI;
}

import { supabase } from '@/lib/supabaseClient';

export const sendMessageToGemini = async (
    sessionId: string,
    message: string,
    context: { userCity: string, isHighTicket: boolean }
): Promise<AIResponse> => {
    initializeGenAI();
    if (!genAI) throw new Error("API Key not configured");

    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: getSystemInstruction(context.userCity, context.isHighTicket),
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema as any
        }
    });

    // 1. Load History from Supabase
    // We only need the last X messages for context.
    // Exclude the CURRENT message(s) that we are replying to (because we will send them as the prompt).
    // Actually, `message` argument handles the new input.
    // We need "Previous" history.
    const { data: dbMessages } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true }); // Oldest first

    // Convert DB messages to Gemini Content
    const history = (dbMessages || [])
        // Filter out 'system', 'thought', 'admin' if you want AI to ignore them, or keep 'user'/'bot' only
        .filter(m => m.sender === 'user' || m.sender === 'bot')
        // Important: Exclude the *very last* messages if they are the ones we are currently replying to?
        // IF the DB has [User: Amor], [User: Nome], and we are running this function...
        // The `message` arg will likely be "Amor\nNome".
        // So we should NOT include "Amor" and "Nome" in the history, otherwise Gemini sees duplicates.
        // Simple heuristic: Exclude messages created in the last 5 seconds? Or just Trust the caller?
        // Caller (route.ts) is constructing `message`. Check if `dbMessages` contains it.
        // Actually, safer: route.ts sends us the PROMPT. We load history BEFORE the prompt messages.
        // But tracking which DB rows correspond to the "Prompt" is hard without IDs.
        // Hack: We will just NOT load history for now if it's too risky, OR better:
        // We assume `message` contains the NEW content. We load all DB history that is older than "Active Processing".
        // BUT for a simple stateless approach:
        // Let's filter out the messages that exactly match `message` content? No, user might repeat "Oi".
        // OK, let's just TAKE the last 20 messages, BUT if the last one matches `message`, remove it?
        // No, `route.ts` will combine multiple messages `m1 + m2`.
        // So history should exclude `m1` and `m2`.
        // Let's rely on time?
        // OR: Since we are debouncing, we know we are reprocessing.
        // Let's make `sendMessageToGemini` NOT take `message` string, but `messageIds`?
        // Too complex refactor.

        // Let's just load history excluding the last few user messages?
        // We will filter out messages that are "unreplied" (but we don't have that flag).
        // Let's Try: Load ALL history.
        // If we duplicate the last turn, Gemini 2.0 is smart enough to see "User: Oi. User: Oi." and reply once usually.
        // But let's try to be clean.
        // We will just use memory-less approach if we can't reliably dedup? No, context is needed.
        // Let's map.
        .map(m => ({
            role: m.sender === 'bot' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));

    // Remove the very last user messages from history if they match the input?
    // We'll leave it to chance for now, or assume the "Prompt" is separate.
    // Actually, if we pass history + sendMessage(prompt), Gemini treats history as past, prompt as current.
    // If prompt is "A\nB", and History has "A", "B"... 
    // It looks like: User: A, User: B, User: A\nB.
    // AI might get confused.

    // Attempt to slice off the tail of user messages from history
    // Iterate backwards, remove 'user' messages until we hit a 'model' message.
    let cleanHistory = [...history];
    while (cleanHistory.length > 0 && cleanHistory[cleanHistory.length - 1].role === 'user') {
        cleanHistory.pop();
    }
    // Now `cleanHistory` ends with a Bot message (or is empty).
    // This is perfect. All new user messages (whether 1 or 5) will be in the `message` argument (Prompt).

    const chat = model.startChat({
        history: cleanHistory
    });

    try {
        const result = await chat.sendMessage(message);
        const responseText = result.response.text();
        return JSON.parse(responseText) as AIResponse;
    } catch (error: any) {
        // ... error handling
        console.error("Error asking Gemini:", error);
        return {
            internal_thought: "Error occurred: " + error.message,
            lead_classification: "desconhecido",
            lead_stats: { tarado: 0, carente: 0, sentimental: 0, financeiro: 0 },
            current_state: "WELCOME",
            messages: ["Amor, minha internet tá ruim... já te respondo tá?"],
            action: "none",
            extracted_user_name: null
        };
    }
};
