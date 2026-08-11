export type LeadScoreKey = "tarado" | "financeiro" | "carente" | "sentimental";
export type LeadScore = Record<LeadScoreKey, number>;
export type LeadScoreMessage = { content?: string | null; created_at?: string | null };

export type LeadScoreMeta = {
    version: 2;
    updated_at: string;
    confidence: number;
    message_count: number;
    dominant: LeadScoreKey;
    signals: Record<string, number>;
};

export type StoredLeadScore = LeadScore & { _meta?: LeadScoreMeta };

export const BASE_LEAD_SCORE: LeadScore = { tarado: 5, financeiro: 5, carente: 5, sentimental: 5 };

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
const normalizeText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s$]/g, " ").replace(/\s+/g, " ").trim();

export function parseLeadScore(raw: unknown, fallback: LeadScore = BASE_LEAD_SCORE): LeadScore {
    let value = raw;
    if (typeof value === "string") {
        try { value = JSON.parse(value); } catch { value = null; }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...fallback };
    const data = value as Record<string, unknown>;
    return {
        tarado: clamp(Number(data.tarado ?? fallback.tarado)),
        financeiro: clamp(Number(data.financeiro ?? fallback.financeiro)),
        carente: clamp(Number(data.carente ?? fallback.carente)),
        sentimental: clamp(Number(data.sentimental ?? fallback.sentimental)),
    };
}

export function parseLeadScoreMeta(raw: unknown): LeadScoreMeta | null {
    let value = raw;
    if (typeof value === "string") {
        try { value = JSON.parse(value); } catch { return null; }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const meta = (value as Record<string, unknown>)._meta;
    return meta && typeof meta === "object" && !Array.isArray(meta) ? meta as LeadScoreMeta : null;
}

export function calculateLeadScore(messages: LeadScoreMessage[], options: {
    initial?: unknown;
    totalPaid?: number;
    funnelStep?: string;
    includeContextBoosts?: boolean;
} = {}) {
    const score = parseLeadScore(options.initial);
    const previousMeta = parseLeadScoreMeta(options.initial);
    const signals: Record<string, number> = { ...(previousMeta?.signals || {}) };
    const userMessages = messages.map((message) => normalizeText(String(message.content || ""))).filter(Boolean).slice(-500);

    const add = (key: LeadScoreKey, amount: number, signal: string) => {
        const previousCount = signals[signal] || 0;
        signals[signal] = previousCount + 1;
        const adjusted = amount > 0 ? amount / (1 + previousCount * 0.45) : amount;
        score[key] = clamp(score[key] + adjusted);
    };

    for (const text of userMessages) {
        const shortReply = text.split(" ").length <= 2;

        if (/\b(quero te comer|te comeria|transar|foder|meter|chupar|gozar|pau|rola|buceta|porra|de quatro|de 4)\b/.test(text)) add("tarado", 18, "sexual_explicito");
        if (/\b(nude|nudes|pelada|sem roupa|manda foto|manda video|quero ver|mostra|manda mais|pack)\b/.test(text)) add("tarado", 10, "pedido_midia");
        if (/\b(gostosa|delicia|tesao|safada|gata|linda)\b/.test(text)) add("tarado", 4, "elogio_quente");
        if (/\b(nao quero putaria|sem putaria|nao manda|nao gostei|para com isso|me respeita|so amizade|nao quero nada sexual)\b/.test(text)) add("tarado", -28, "rejeicao_sexual");

        if (/\b(passa o pix|manda o pix|vou comprar|eu compro|pode gerar|gera o pix|fechado|quero assinar|vou pagar)\b/.test(text)) add("financeiro", 25, "intencao_compra");
        if (/\b(quanto custa|qual o valor|preco|valor|mensal|vitalicio|quanto e)\b/.test(text)) add("financeiro", 10, "perguntou_preco");
        if (/\b(tenho dinheiro|posso pagar|recebi hoje|caiu o pagamento)\b/.test(text)) add("financeiro", 10, "capacidade_pagamento");
        if (/\b(ta caro|muito caro|sem dinheiro|to liso|estou liso|desempregado|nao tenho dinheiro)\b/.test(text)) add("financeiro", -15, "objecao_preco");
        if (/\b(golpe|fake|nao confio|prova que e real)\b/.test(text)) add("financeiro", -8, "objecao_confianca");

        if (/\b(to sozinho|estou sozinho|ninguem me quer|queria uma namorada|fica comigo|nao me abandona|preciso de voce|me da atencao)\b/.test(text)) add("carente", 18, "busca_atencao");
        if (/\b(saudade|sdds|me chama|fala comigo|sumiu|sonhei com voce|bom dia amor|boa noite amor)\b/.test(text)) add("carente", 8, "apego");
        if (/\b(so quero conversar|queria conversar|companhia|carinho)\b/.test(text)) add("carente", 7, "busca_companhia");

        if (/\b(solidao|depressivo|triste|chorando|desabafo|traicao|ex namorada|terminamos|coracao partido|sentindo falta)\b/.test(text)) add("sentimental", 18, "desabafo");
        if (/\b(amor|carinho|afeto|apaixonado|gosto de voce|te amo|saudade)\b/.test(text)) add("sentimental", 7, "vinculo_afetivo");

        if (/\b(nao quero conversar|me deixa|para de falar|nao enche|chata|vai embora)\b/.test(text)) {
            add("carente", -18, "rejeicao_contato");
            add("sentimental", -18, "rejeicao_contato");
        } else if (shortReply && /^(nao|n|blz|ok|ta|sim|ss|hm|aham)$/.test(text)) {
            add("carente", -3, "resposta_fria");
            add("sentimental", -2, "resposta_fria");
        }
    }

    if (options.includeContextBoosts !== false) {
        const funnel = String(options.funnelStep || "").toUpperCase();
        const boosts: Record<string, number> = { SALES_PITCH: 5, NEGOTIATION: 12, CLOSING: 20, PAYMENT_CHECK: 28, PAYMENT_CONFIRMED: 100 };
        if (boosts[funnel]) {
            score.financeiro = Math.max(score.financeiro, boosts[funnel]);
            signals[`funil_${funnel.toLowerCase()}`] = 1;
        }
    }

    if (Number(options.totalPaid || 0) > 0) {
        score.financeiro = 100;
        signals.pagamento_confirmado = 1;
    }

    const keys = Object.keys(score) as LeadScoreKey[];
    const dominant = keys.reduce((best, key) => score[key] > score[best] ? key : best, keys[0]);
    const signalCount = Object.values(signals).reduce((sum, count) => sum + count, 0);
    const messageCount = (previousMeta?.message_count || 0) + userMessages.length;
    const meta: LeadScoreMeta = {
        version: 2,
        updated_at: new Date().toISOString(),
        confidence: clamp(10 + messageCount * 7 + signalCount * 4),
        message_count: messageCount,
        dominant,
        signals,
    };
    return { score, meta };
}

export const toStoredLeadScore = (result: ReturnType<typeof calculateLeadScore>): StoredLeadScore => ({ ...result.score, _meta: result.meta });

export function markLeadPaid(raw: unknown): StoredLeadScore {
    const score = parseLeadScore(raw);
    const oldMeta = parseLeadScoreMeta(raw);
    return {
        ...score,
        financeiro: 100,
        _meta: {
            version: 2,
            updated_at: new Date().toISOString(),
            confidence: 100,
            message_count: oldMeta?.message_count || 0,
            dominant: "financeiro",
            signals: { ...(oldMeta?.signals || {}), pagamento_confirmado: 1 },
        },
    };
}
