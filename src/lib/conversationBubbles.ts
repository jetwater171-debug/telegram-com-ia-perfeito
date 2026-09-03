type ShapeConversationBubblesOptions = {
    preferredCount?: number;
    maxBubbles?: number;
    maxChars?: number;
    /** Lowercase the visible conversational start; URLs, e-mails and opaque codes stay intact. */
    lowercaseStart?: boolean;
};

const compact = (value: string) => String(value || '').replace(/\s+/g, ' ').trim();

const lowercaseStartSafely = (text: string) => {
    if (!text
        || /^(?:https?:\/\/|www\.)/iu.test(text)
        || /^\S+@\S+$/u.test(text)
        || /^(?:R\$|US\$|€|£|\$)\s*/u.test(text)) return text;
    if (/^[A-Z0-9_-]{8,}(?:\s|$)/u.test(text)) return text;
    if (/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{2,6}(?=\s|[,!.?:;]|$)/u.test(text)) {
        return text.replace(/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{2,6}/u, (token) => token.toLocaleLowerCase('pt-BR'));
    }
    return text.replace(/^\p{Lu}/u, (letter) => letter.toLocaleLowerCase('pt-BR'));
};

const splitBubble = (raw: string, maxChars: number) => {
    const source = String(raw || '').trim();
    const text = compact(source);
    if (!text) return [];

    // Existing short text remains a single bubble, even when it contains
    // multiple short sentences. The target only authorizes a sentence split
    // when the complete source message actually needs it.
    if (text.length <= maxChars && !/[\r\n]/u.test(source)) return [text];

    // Sentence boundaries are preferred. maxChars is intentionally a soft
    // target: an unpunctuated long sentence stays intact instead of being
    // broken into artificial typing fragments.
    const sentences = source
        .split(/(?<=[.!?;])\s+|\n+/u)
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

const boundedInteger = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(parsed) ? Math.floor(parsed) : fallback));
};

export const shapeConversationBubbles = (
    messages: string[],
    options: ShapeConversationBubblesOptions = {},
) => {
    // Four is a hard UX ceiling: more bubbles feel like token streaming.
    const preferredCount = boundedInteger(options.preferredCount, 1, 1, 4);
    const maxBubbles = boundedInteger(options.maxBubbles, preferredCount, 1, 4);
    const seen = new Set<string>();

    const requestedMaxChars = Number(options.maxChars);
    const maxChars = Math.max(40, Math.min(130, Number.isFinite(requestedMaxChars) ? requestedMaxChars : 100));
    const uniqueMessages = messages
        .map((message) => String(message || '').trim())
        .map((message) => options.lowercaseStart ? lowercaseStartSafely(message) : message)
        .filter((message) => {
            const key = normalizedKey(message);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    const units = uniqueMessages
        .flatMap((message) => splitBubble(message, maxChars))
        .map((message) => options.lowercaseStart ? lowercaseStartSafely(message) : message);

    if (units.length <= maxBubbles) return units;

    // maxBubbles is hard, but content is not discarded: all overflow is kept
    // in the final bubble, in its original order.
    const head = units.slice(0, maxBubbles - 1);
    const overflow = units.slice(maxBubbles - 1).join(' ');
    return [...head, overflow];
};
