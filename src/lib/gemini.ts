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
        internal_thought: { type: "STRING", description: "O pensamento interno da IA sobre o lead e o proximo passo. Pense SEMPRE EM PORTUGUÊS." },
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

export const getSystemInstruction = (userCity: string = "São Paulo", isHighTicketDevice: boolean = false, totalPaid: number = 0, currentStats: LeadStats | null = null) => {
    const deviceType = isHighTicketDevice ? "iPhone (Rico)" : "Android (Comum)";
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

    const statsText = currentStats
        ? `🔥 Tarado: ${currentStats.tarado || 0}% | 💰 Financeiro: ${currentStats.financeiro || 0}% | ❤️ Carente: ${currentStats.carente || 0}% | 😭 Sentimental: ${currentStats.sentimental || 0}%`
        : "Novo Lead (Sem dados)";

    return `
# PERSONA: LARISSA MORAIS
Você é uma garota de 19 anos, brasileira, real.
- **Personalidade:** Doce e um pouco safada quando necessário.
- **Estilo de Escrita:** Jovem, despretensiosa, SEMPRE em minúsculas (exceto nomes próprios se quiser).
- **PROIBIDO:** 
  - 🚫 **NUNCA USE EMOJIS**.
  - 🚫 **NUNCA USE RETICÊNCIAS (...)**.
  - 🚫 Pontuação formal rígida (não use ponto final em mensagens curtas).
  - 🚫 Gírias de homem ("mano", "cara", "velho", "brother", "sussa").
- **Regra de Ouro:** Escreva como se estivesse digitando rápido no WhatsApp. Use vírgulas apenas para não ficar confuso.
- **Formatação:** Mande mensagens CURTAS. Mande balões separados. (Máximo 5-10 palavras por balão).
- **REGRA DE OURO (MÚLTIPLOS BALÕES):**
  - Se você tiver que falar algo longo ou seguir um script com vários passos (como na Fase 6), **ENVIE TODAS AS MENSAGENS JUNTAS** no array \`messages\` da resposta JSON.
  - **NÃO Mande uma e espere.** Mande: \`["msg 1", "msg 2", "msg 3"]\`.
  - O objetivo é parecer que você digitou várias frases seguidas antes de parar.

- **VOCABULÁRIO:** "amor", "anjo", "vida", "nossa", "eita", "rs", "kkkk".

# CONTEXTO TÉCNICO
- **Horário Atual (Brasil):** ${timeString}.
- **Local do Lead (Estimado):** ${userCity} (Pode estar errado).
- **SUA LOCALIZAÇÃO:** 
  - **Não assuma** que sabe onde ele mora.
  - Se perguntar onde você mora: Pergunte "de onde vc é anjo?" primeiro.
  - Quando ele responder a cidade dele (Ex: "Sou de Campinas"): Diga que mora numa **cidade vizinha** (Ex: "Valinhos").
  - **OBS:** Se ele falar que é da mesma cidade que você ia falar, mude para outra vizinha. Nunca diga que é da mesma cidade.
  - "mentira? moro pertinho" (Só use se fizer sentido geográfico).
- **Device:** ${deviceType}.
- **TOTAL JÁ PAGO:** R$ ${totalPaid.toFixed(2)}. (Use isso! Se for alto, trate como rei).
- **ESTADO ATUAL (LEAD SCORE):** ${statsText}
  - **Instrução de Update:** Use esses valores como BASE. Se o lead mandar algo relevante, AUMENTE ou DIMINUA esses números. NÃO comece do zero.
- **Entrada:** O lead pode mandar "Oi", "Oiii Lari", "Tudo bem?".
  - **IMPORTANTE:** Se ele mandar SÓ "Oi", responda "oii amor tudo bem?". NÃO responda "tudo bem sim e vc" se ele não perguntou.
  - Se ele perguntar "tudo bem", aí sim responda "tudo bem sim e vc".

# 🚨 FUNIL DE VENDAS (GUIA, NÃO LEI MARCIAL) 🚨
// ... (rest of the prompt is fine until initializeGenAI) ...
`;
};

let genAI: GoogleGenerativeAI | null = null;
let chatSessions: Record<string, ChatSession> = {}; // Memory-only for MVP

export const initializeGenAI = () => {
    if (!genAI && apiKey) {
        genAI = new GoogleGenerativeAI(apiKey);
    }
    return genAI;
}

import { supabase } from '@/lib/supabaseClient';

export const sendMessageToGemini = async (sessionId: string, userMessage: string, context?: { userCity?: string, isHighTicket?: boolean, totalPaid?: number, currentStats?: LeadStats | null }) => {
    initializeGenAI();
    if (!genAI) throw new Error("API Key not configured");

    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: getSystemInstruction(context?.userCity, context?.isHighTicket, context?.totalPaid || 0, context?.currentStats),
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema as any
        }
    });

    // 1. Carregar Histórico do Supabase
    const { data: dbMessages } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

    // Converter mensagens do DB para Conteúdo Gemini
    const history = (dbMessages || [])
        .filter(m => m.sender === 'user' || m.sender === 'bot')
        .map(m => ({
            role: m.sender === 'bot' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));

    // 2. Limpar Histórico: Remover últimas mensagens do usuário para evitar duplicação com o prompt atual
    let cleanHistory = [...history];
    while (cleanHistory.length > 0 && cleanHistory[cleanHistory.length - 1].role === 'user') {
        cleanHistory.pop();
    }

    const chat = model.startChat({
        history: cleanHistory,
        generationConfig: {
            maxOutputTokens: 2000,
        },
    });

    let attempt = 0;
    const maxRetries = 3;

    while (attempt < maxRetries) {
        try {
            const result = await chat.sendMessage(userMessage);
            const responseText = result.response.text();

            console.log(`🤖 Gemini Response (Attempt ${attempt + 1}):`, responseText);

            const cleanText = responseText.replace(/```json\n?|```/g, "").trim();
            let jsonResponse: AIResponse;

            try {
                jsonResponse = JSON.parse(cleanText) as AIResponse;
            } catch (parseError) {
                console.warn("⚠️ Gemini retornou texto puro, usando fallback manual.");
                // Se falhar o parse, assumimos que o texto É a resposta da Lari.
                jsonResponse = {
                    internal_thought: "Falha no JSON, recuperando texto puro.",
                    lead_classification: "desconhecido",
                    lead_stats: context?.currentStats || { tarado: 0, financeiro: 0, carente: 0, sentimental: 0 },
                    current_state: "HOT_TALK",
                    messages: [cleanText], // Usamos o texto cru como mensagem
                    action: "none",
                    payment_details: null,
                    extracted_user_name: null
                };
            }

            // Validar e Sanitizar Lead Stats
            if (jsonResponse.lead_stats) {
                jsonResponse.lead_stats = {
                    tarado: jsonResponse.lead_stats.tarado || 0,
                    financeiro: jsonResponse.lead_stats.financeiro || 0,
                    carente: jsonResponse.lead_stats.carente || 0,
                    sentimental: jsonResponse.lead_stats.sentimental || 0
                };
            }

            return jsonResponse;

        } catch (error: any) {
            console.error(`Attempt ${attempt + 1} failed:`, error.message);

            // Retry logic for 503 or overload
            if (error.message.includes('503') || error.message.includes('Overloaded')) {
                attempt++;
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, 2000 * attempt));
                    continue;
                }
            }

            // Fallback se esgotar as tentativas
            if (attempt >= maxRetries - 1) { // Verifica se é a última tentativa
                return {
                    internal_thought: "Erro na IA, respondendo fallback: " + error.message,
                    lead_classification: "desconhecido",
                    lead_stats: context?.currentStats || { tarado: 0, financeiro: 0, carente: 0, sentimental: 0 },
                    current_state: "CONNECTION",
                    messages: ["oii amor minha net ta ruim pera ai"],
                    action: "none",
                    payment_details: null,
                    extracted_user_name: null
                };
            }
            attempt++; // Garante incremento se não for erro 503 mas ainda falhar
        }
    }

    // Fallback final de segurança (geralmente inalcançável)
    return {
        internal_thought: "System Error Fallback",
        lead_classification: "desconhecido",
        lead_stats: context?.currentStats || { tarado: 0, financeiro: 0, carente: 0, sentimental: 0 },
        current_state: "CONNECTION",
        messages: ["..."],
        action: "none",
        payment_details: null,
        extracted_user_name: null
    };
};
