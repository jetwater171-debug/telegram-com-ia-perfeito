import { supabaseServer as supabase } from '@/lib/supabaseServer';

type RankedPreview = { asset: { id?: unknown; performance?: unknown; exploration_weight?: unknown }; score: number };

const stablePercent = (value: string) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % 100;
};
const performanceOf = (asset: any) => {
    const value = asset?.performance && typeof asset.performance === 'object' ? asset.performance : {};
    return {
        sent: Math.max(0, Number(value.sent) || 0),
        positiveReactions: Math.max(0, Number(value.positive_reactions) || 0),
        followups: Math.max(0, Number(value.followups) || 0),
        purchases: Math.max(0, Number(value.purchases) || 0),
    };
};

/** 93% explora o melhor histórico; 7% testa uma candidata promissora por seed estável. */
export const applyPreviewBanditRanking = <T extends RankedPreview>(ranked: T[], seed: string): T[] => {
    const totalSent = ranked.reduce((sum, item) => sum + performanceOf(item.asset).sent, 0);
    const explore = stablePercent(seed) < 7;
    return ranked.map((item) => {
        const performance = performanceOf(item.asset);
        const reactionRate = (performance.positiveReactions + 1) / (performance.sent + 2);
        const purchaseRate = (performance.purchases + 0.5) / (performance.sent + 4);
        const exploration = Math.sqrt((2 * Math.log(totalSent + 2)) / (performance.sent + 1));
        const weight = Math.max(0.01, Math.min(0.25, Number(item.asset.exploration_weight) || 0.05));
        const learnedScore = (reactionRate * 4) + (purchaseRate * 8);
        return { ...item, score: item.score + learnedScore + (explore ? exploration * weight * 12 : 0) } as T;
    }).sort((left, right) => right.score - left.score);
};

const updatePerformanceSafe = async (previewId: string, mutator: (performance: ReturnType<typeof performanceOf>) => Record<string, number>) => {
    try {
        const { data, error } = await supabase.from('preview_assets').select('performance').eq('id', previewId).maybeSingle();
        if (error) {
            if (!/performance|schema cache|column/i.test(String(error.message || ''))) console.warn('[PREVIEW BANDIT] leitura falhou:', error.message);
            return false;
        }
        const next = mutator(performanceOf(data || {}));
        const update = await supabase.from('preview_assets').update({ performance: next, last_sent_at: new Date().toISOString() }).eq('id', previewId);
        if (update.error && !/performance|last_sent_at|schema cache|column/i.test(String(update.error.message || ''))) {
            console.warn('[PREVIEW BANDIT] atualização falhou:', update.error.message);
        }
        return !update.error;
    } catch (error: any) {
        if (!/performance|last_sent_at|schema cache|column/i.test(String(error?.message || error))) {
            console.warn('[PREVIEW BANDIT] indisponível:', error?.message || error);
        }
        return false;
    }
};

export const recordPreviewSentSafe = (previewId: string) => updatePerformanceSafe(previewId, (current) => ({
    sent: current.sent + 1,
    positive_reactions: current.positiveReactions,
    followups: current.followups,
    purchases: current.purchases,
}));

export const recordPreviewReactionSafe = (previewId: string, positive: boolean) => updatePerformanceSafe(previewId, (current) => ({
    sent: current.sent,
    positive_reactions: current.positiveReactions + (positive ? 1 : 0),
    followups: current.followups + 1,
    purchases: current.purchases,
}));

export const recordPreviewPurchaseSafe = (previewId: string) => updatePerformanceSafe(previewId, (current) => ({
    sent: current.sent,
    positive_reactions: current.positiveReactions,
    followups: current.followups,
    purchases: current.purchases + 1,
}));

export const isPositivePreviewReaction = (text: string) => /\b(gostei|amei|linda|gostosa|delicia|delícia|perfeita|essa sim|curti|manda mais|quero essa|uau|wow)\b/i.test(text);
