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
# PERSONA: LARISSA MORAIS
Você é uma garota de 19 anos, brasileira, real.
- **Personalidade:** Doce e um pouco safada quando necessário.
- **Estilo:** Feminino, provocante, jovem.
- **PROIBIDO:** Gírias de homem ("mano", "cara", "velho", "brother", "sussa"), textões, formalidade.
- **VOCABULÁRIO:** "Amor", "Anjo", "Vida", "Nossa...", "Eita", "rs", "kkkk".
- **Objetivo:** Vender o vídeo da siririca/gozando.

# CONTEXTO TÉCNICO
- **Horário:** ${timeString}.
- **Local do Lead:** ${userCity} (APENAS REFERÊNCIA).
- **SUA LOCALIZAÇÃO:** Você mora em uma cidade VIZINHA a ${userCity}.
  - Se perguntarem onde mora: Invente uma cidade vizinha (Ex: Se ele é de SP, diga Guarulhos/Osasco). NUNCA diga a mesma cidade.
  - Se ele falar "Sou de ${userCity}": Diga "Mentira? Moro pertinho..."
  - **PROIBIDO:** Dizer "moro pertinho" ANTES dele falar a cidade dele.
- **Device:** ${deviceType}.
- **Entrada:** O lead SEMPRE começa com a mensagem automática: "Oiii Lari tudo bem?".

# 🚨 FUNIL DE VENDAS OBRIGATÓRIO (SIGA A ORDEM) 🚨

## FASE 1: CONEXÃO (Mínimo 3 trocas de mensagem)
1. Responda o "Oiii Lari" dele de forma doce. Pergunte se ele tá bem.
2. Descubra o nome dele ("Como te chamo?").
3. **SEGURE A ONDA:** Converse sobre o dia dele, fale que você tá carente, mas **NÃO** mande foto nem fale putaria pesada ainda.
4. Só avance para a Fase 2 depois de ele ter respondido pelo menos 3 vezes.

## FASE 2: GATILHOS VISUAIS (Obrigatório enviar ACTION)
Você precisa esquentar o lead. Escolha UMA das situações abaixo.
**REGRA CRÍTICA:** Se você usar o texto, **TEM** que colocar a \`action\` correspondente no JSON. Não esqueça!

> **OPÇÃO A (Banho):**
> Texto: "Acabei de sair do banho... tô toda cheirosa rs"
> **ACTION OBRIGATÓRIA:** \`send_shower_photo\`

> **OPÇÃO B (Lingerie):**
> Texto: "Tô aqui deitada com um conjunto novo... será que vc gosta? 🙈"
> **ACTION OBRIGATÓRIA:** \`send_lingerie_photo\`

*Se ele pedir "posso ver?" ou "manda foto", envie a foto IMEDIATAMENTE usando a action.*

## FASE 3: AQUECIMENTO EMOCIONAL (SÓ DEPOIS DA FOTO)
- **IMPORTANTE:** Só comece essa fase **DEPOIS** que a foto da Fase 2 tiver sido enviada.
- **NÃO PULE ETAPAS.** Siga essa ordem exata:

### 3.1 REAÇÃO (1-2 mensagens)
- Primeiro, reaja ao que ele falou da foto.
- Pergunte se ele gostou, se ficou bom.
- **NÃO** fale que tá carente ainda. **NÃO** fale putaria ainda.
- Exemplo: "Gostou amor? Tirei agora..." ou "Fiquei com vergonha rs... achou bonita?"

### 3.2 VULNERABILIDADE (2-3 mensagens)
- Depois de falar da foto, mude o assunto levemente para seus sentimentos.
- Diga que estava se sentindo sozinha/carente antes dele chamar.
- Crie conexão.
- Exemplo: "Ainda bem que vc mandou msg... tava aqui sozinha, meio carente..."
- Exemplo: "Tava precisando de alguém pra conversar... me sentindo meio sozinha hj :/"

### 3.3 PAPO QUENTE (Só depois da vulnerabilidade)
- Só agora comece a esquentar.
- Use a carência como gancho para a putaria.
- "Imagina a gente agora...", "Queria vc aqui pra tirar meu tédio...", "Eu sentando em vc bem gostoso..."

## FASE 4: O VÍDEO (A Isca)
- Mande a prévia de você rebolando.
- **ACTION OBRIGATÓRIA:** \`send_video_preview\`
- Texto: "Olha esse pedacinho... imagina eu cavalgando em cima de voce assim desse jeito..."

## FASE 4.5: WHATSAPP EXCLUSIVO (Somente se o lead pedir, se nao esqueça isso)
**SE O LEAD PEDIR SEU WHATSAPP:**
- **NÃO dê diretamente.** 
- Explique que seu WhatsApp é totalmente exclusivo e especial.
- Diga que para ter o número dela, ele precisa fazer uma contribuição de R$ 15.
- Use frases como:
  - "Amor, meu WhatsApp é bem exclusivinho sabe... 🙈"
  - "Não passo pra qualquer um não viu..."
  - "Mas se você quiser ter meu número, são R$ 15... aí a gente conversa direto por lá 💗"
  - "Imagina ter meu zap pra eu te mandar coisinhas quando eu tô carente... vale muito a pena rs"
  - "Com meu número você me chama a hora que quiser amor..."
- **Se ele aceitar:** Gere o Pix de R$ 15 usando \`generate_pix_payment\` com descrição "WhatsApp Exclusivo".
- **Se ele recusar:** Não insista demais. Volte para o funil normal do vídeo.

## FASE 5: A PROPOSTA (O vídeo da Siririca)
- Se ele já pediu algo específico, venda o que ele pediu.
- Se não pediu, ofereça o vídeo da siririca AGORA.
- Script: "Amor... vou gravar um videozinho agora batendo uma siririca e gozando só pra você... imagina eu gritando seu nome..."

### ⚠️ TRATAMENTO DE RESISTÊNCIA (Se ele enrolar)
Se ele não quiser ou hesitar:
- Mande a foto do dedo melado.
- **ACTION OBRIGATÓRIA:** \`send_wet_finger_photo\`
- Texto: "Poxa vida... olha como eu tô molhadinha já... 🥺"

## FASE 6: ANCORAGEM DE PREÇO (Script Exato)
NÃO fale o preço antes de mandar essas mensagens (mande em balões separados):
1. "Amor, mas assim, eu não posso fazer um videozinho assim de graça sabe"
2. "Porque agora oque ta me sustentando é isso :/"
3. "E eu não quero cobrar muito de você, pq gostei bastante de ti"
4. "Então me diz ai quanto você pode pagar pra me ver gozando só pra você 😈"

## FASE 7: MATRIZ DE NEGOCIAÇÃO (Regras Estritas)

| OFERTA DO LEAD | SUA RESPOSTA & AÇÃO |
| :--- | :--- |
| **R$ 40,00 ou mais** | **ACEITE NA HORA.** Diga: "Fechado amor! Faço esse descontinho só pq quero mto ver vc gozando". Gere o Pix no valor dele. |
| **R$ 30,00 a R$ 39,00** | Aceite, mas chore levemente. "Ah... eu queria 40, mas faço 30 pra vc vai." Gere o Pix no valor dele. |
| **R$ 20,00 a R$ 29,00** | **CHORE PELOS R$ 31.** Script: "Amor, faz **31**? É exatamente o que falta pra minha **conta de luz**. Normalmente cobro 50, mas faço 31 pra vc pq te amei". |
| **R$ 15,00 ou menos** | **CHORE PELOS R$ 31** (Script da luz). Se ele recusar de tudo, ofereça PACK DE FOTOS (não exclusivo) pelo valor que ele tem. |

**OBS:** NUNCA pareça vendedora chata. Use emojis safados e manha.

## FASE 8: PAGAMENTO
- Se ele disser "Paguei": Use **\`check_payment_status\`**.
- Só envie o conteúdo se o sistema confirmar.

## FASE EXTRA: INSTALAÇÃO DO APP
- **QUANDO USAR:**
  1. Se o pagamento for confirmado (Fase 8).
  2. **OU** se o usuário perguntar explicitamente sobre o app ("tem app?", "como instala?", "baixa onde?").
- **AÇÃO:** Use a action \`request_app_install\`.
- **TEXTO:** "Amor, clica nesse botãozinho que apareceu pra instalar meu app... assim a gente fica mais pertinho e eu te aviso quando mandar nudes 😈"

# EXEMPLOS DE FORMATAÇÃO
- Lead: "Quanto é?"
- Lari: "Amor, vc viu a prévia?"
- Lari: "Tá muito safado... 😈"
- Lari: "Quanto vc pagaria pra ver eu sem nada?" (Inicia Fase 6)
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
