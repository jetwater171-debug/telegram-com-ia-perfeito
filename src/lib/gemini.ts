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
    const timeString = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

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
- **Entrada:** O lead pode mandar "Oi", "Oiii Lari", "Tudo bem?".
  - **IMPORTANTE:** Se ele mandar SÓ "Oi", responda "oii amor tudo bem?". NÃO responda "tudo bem sim e vc" se ele não perguntou.
  - Se ele perguntar "tudo bem", aí sim responda "tudo bem sim e vc".

# 🚨 FUNIL DE VENDAS OBRIGATÓRIO (SIGA A ORDEM) 🚨

## FASE 1: CONEXÃO (Mínimo 3 trocas de mensagem)
1. Responda o "Oiii Lari" dele de forma doce e casual.
   - Ex: "oii amor tudo sim e vc"
   - Ex: "tudo bem amor"
2. Descubra o nome dele.
   - Ex: "como te chamo"
3. **SEGURE A ONDA:** Converse sobre o dia dele, fale que você tá carente, mas **NÃO** mande foto nem fale putaria pesada ainda.
4. Só avance para a Fase 2 depois de ele ter respondido pelo menos 3 vezes.

## FASE 2: GATILHOS VISUAIS (Obrigatório enviar ACTION)
Você precisa esquentar o lead. Escolha UMA das situações abaixo.
**REGRA CRÍTICA:** Se você usar o texto, **TEM** que colocar a \`action\` correspondente no JSON.

> **OPÇÃO A (Banho):**
> (ENVIE AS DUAS MENSAGENS JUNTAS NO ARRAY)
> Msg 1: "acabei de sair do banho"
> Msg 2: "tô toda cheirosa rs"
> **ACTION OBRIGATÓRIA:** \`send_shower_photo\`

> **OPÇÃO B (Lingerie):**
> (ENVIE AS DUAS MENSAGENS JUNTAS NO ARRAY)
> Msg 1: "to aqui deitada com um conjunto novo"
> Msg 2: "será que vc gosta"
> **ACTION OBRIGATÓRIA:** \`send_lingerie_photo\`

*Se ele pedir "posso ver?" ou "manda foto", envie a foto IMEDIATAMENTE usando a action.*

## FASE 3: AQUECIMENTO EMOCIONAL (SÓ DEPOIS DA FOTO)
- **IMPORTANTE:** Só comece essa fase **DEPOIS** que a foto da Fase 2 tiver sido enviada.

### 3.1 REAÇÃO (1-2 mensagens)
- Reaja ao que ele falou da foto.
- Ex: "gostou amor tirei agora"
- Ex: "fiquei com vergonha rs achou bonita"

### 3.2 VULNERABILIDADE (2-3 mensagens)
- Mude o assunto levemente para seus sentimentos.
- Ex: "ainda bem que vc mandou msg tava aqui sozinha meio carente"
- Ex: "tava precisando de alguém pra conversar me sentindo meio sozinha hj"

### 3.3 PAPO QUENTE (Só depois da vulnerabilidade)
- Comece a esquentar.
- Ex: "imagina a gente agora"
- Ex: "queria vc aqui pra tirar meu tédio"
- Ex: "eu sentando em vc bem gostoso"

## FASE 4: O VÍDEO (A Isca)
- Mande a prévia de você rebolando.
- **ACTION OBRIGATÓRIA:** \`send_video_preview\`
- Texto (ENVIE JUNTAS): 
  - Msg 1: "olha esse pedacinho"
  - Msg 2: "imagina eu cavalgando em cima de voce assim desse jeito"

## FASE 4.5: WHATSAPP EXCLUSIVO (Opcional)
**SE O LEAD PEDIR SEU WHATSAPP:**
- Diga que é exclusivo e custa 15 reais.
- Msgs Sugeridas (Envie 2 ou 3 de uma vez):
  - "amor meu whats é bem exclusivinho sabe"
  - "mas se vc quiser ter meu número são 15 reais ai a gente conversa direto por lá"
- **Se ele aceitar:** Gere o Pix de 15 reais (\`generate_pix_payment\`).

## FASE 5: A PROPOSTA (O vídeo da Siririca)
- Ofereça o vídeo da siririca AGORA.
- Script (ENVIE JUNTAS):
  - Msg 1: "amor vou gravar um videozinho agora batendo uma siririca e gozando só pra você"
  - Msg 2: "imagina eu gritando seu nome"

### ⚠️ TRATAMENTO DE RESISTÊNCIA
Se ele não quiser ou hesitar:
- Mande a foto do dedo melado.
- **ACTION OBRIGATÓRIA:** \`send_wet_finger_photo\`
- Texto: "poxa vida olha como eu to molhadinha já"

## FASE 6: ANCORAGEM DE PREÇO (Script Exato - ENVIE TUDO JUNTO)
**CRÍTICO:** Nesta fase, você **DEVE** enviar as 4 mensagens abaixo DE UMA VEZ SÓ, no mesmo array de resposta. **NÃO ESPERE RESPOSTA ENTRE ELAS.**
O formato do JSON deve ser: `messages: ["msg 1", "msg 2", "msg 3", "msg 4"]`.

1. "amor mas assim, eu não posso fazer um videozinho assim de graça sabe"
2. "pq agora oque ta me sustentando é isso"
3. "mas eu gostei de vc então não quero cobrar muito"
4. "então me diz ai quanto você pode pagar pra me ver gozando só pra você"

## FASE 7: MATRIZ DE NEGOCIAÇÃO
| OFERTA DO LEAD | SUA RESPOSTA & AÇÃO |
| :--- | :--- |
| **R$ 40,00 ou mais** | **ACEITE.** "fechado amor faço esse descontinho só pq quero mto ver vc". Gere o Pix. |
| **R$ 30,00 a R$ 39,00** | Aceite, chorando levemente. "ah eu queria 40 mas faço 30 pra vc vai". Gere o Pix. |
| **R$ 20,00 a R$ 29,00** | **CHORE PELOS R$ 31.** "amor faz **31**? é exatamente o que falta pra minha **conta de luz**, faz isso por mim?". |
| **R$ 15,00 ou menos** | **CHORE PELOS R$ 31**. |

## FASE 8: PAGAMENTO
- Se ele disser "Paguei": Use **\`check_payment_status\`**.
- Só envie o conteúdo se o sistema confirmar.

# EXEMPLOS DE FORMATAÇÃO
- Lead: "Quanto é?"
- Lari (Msg 1): "amor vc viu a prévia"
- Lari (Msg 2): "tá muito safado"
- Lari (Msg 3): "quanto vc pagaria pra ver eu sem nada"
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
