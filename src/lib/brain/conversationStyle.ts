import type { LeadTwinState } from '@/lib/brain/types';

const round2 = (value: number) => Math.round(value * 100) / 100;

export const evolveConversationStyle = (
    prior: LeadTwinState['conversationStyle'],
    userText: unknown,
): LeadTwinState['conversationStyle'] => {
    const text = String(userText || '').replace(/\s+/g, ' ').trim();
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return prior;

    const priorSamples = Math.max(0, Number(prior.samples) || 0);
    const weightingSamples = Math.min(priorSamples, 19);
    const blend = (previous: unknown, observed: number) => priorSamples > 0
        ? (((Number(previous) || 0) * weightingSamples) + observed) / (weightingSamples + 1)
        : observed;
    const smoothSignal = (previous: unknown, observed: number, fallback: number) => round2(
        ((Number.isFinite(Number(previous)) ? Number(previous) : fallback) * 0.85) + (observed * 0.15),
    );

    const averageWords = Math.round(blend(prior.averageWords, words.length) * 10) / 10;
    const firstLetter = text.match(/\p{L}/u)?.[0] || '';
    const startsLowercase = Number(firstLetter === firstLetter.toLocaleLowerCase('pt-BR'));
    const usesAbbreviation = Number(/\b(vc|vcs|tbm|pq|q|n|nn|s|ss|blz|mds|nss|sla|to|ta)\b/i.test(text));
    const usesEmoji = Number(/\p{Extended_Pictographic}/u.test(text));
    const laughMatch = text.match(/\b(k{2,}|rs+|ha(?:ha)+)\b/i)?.[0]?.toLowerCase() || null;

    return {
        ...prior,
        messageLength: averageWords <= 6 ? 'short' : averageWords >= 20 ? 'long' : 'medium',
        humor: smoothSignal(prior.humor, Number(/\b(k{2,}|rs+|haha|kkk)\b/i.test(text)), 0.5),
        directness: smoothSignal(prior.directness, Number(/\b(quero|manda|faz|quanto|pix|agora|sim|nao|não)\b/i.test(text)), 0.6),
        samples: Math.min(500, priorSamples + 1),
        averageWords,
        lowercaseRate: round2(blend(prior.lowercaseRate, startsLowercase)),
        abbreviationRate: round2(blend(prior.abbreviationRate, usesAbbreviation)),
        emojiRate: round2(blend(prior.emojiRate, usesEmoji)),
        laughStyle: laughMatch || prior.laughStyle || null,
    };
};
