type ShapeConversationBubblesOptions = {
    preferredCount?: number;
    maxBubbles?: number;
    maxChars?: number;
};

const compact = (value: string) => String(value || '').replace(/\s+/g, ' ').trim();

const splitBubble = (raw: string, maxChars: number) => {
    const text = compact(raw);
    if (!text) return [];

    // Existing short text remains a single bubble, even when it contains
    // multiple short sentences. The target only authorizes a sentence split
    // when the complete source message actually needs it.
    if (text.length <= maxChars) return [text];

    // Sentence boundaries are preferred. maxChars is intentionally a soft
    // target: an unpunctuated long sentence stays intact instead of being
    // broken into artificial typing fragments.
    const sentences = text
        .split(/(?<=[.!?;])\s+/u)
        .map(compact)
        .filter(Boolean);

    // An unpunctuated sentence has no safe boundary, so it stays intact even
    // when it exceeds maxChars.
    return sentences.length > 1 ? sentences : [text];
};

const normalizedKey = (text: string) => compact(text)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const shapeConversationBubbles = (
    messages: string[],
    options: ShapeConversationBubblesOptions = {},
) => {
    const preferredCount = Math.max(1, Math.min(6, Number(options.preferredCount || 1)));
    const maxBubbles = Math.max(1, Math.min(6, Number(options.maxBubbles || Math.max(1, preferredCount))));
    const seen = new Set<string>();

    const maxChars = Math.max(55, Math.min(130, Number(options.maxChars || 100)));
    const uniqueMessages = messages
        .map(compact)
        .filter((message) => {
            const key = normalizedKey(message);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    const units = uniqueMessages.flatMap((message) => splitBubble(message, maxChars));

    if (units.length <= maxBubbles) return units;

    // maxBubbles is hard, but content is not discarded: all overflow is kept
    // in the final bubble, in its original order.
    const head = units.slice(0, maxBubbles - 1);
    const overflow = units.slice(maxBubbles - 1).join(' ');
    return [...head, overflow];
};
