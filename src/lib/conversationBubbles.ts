type ShapeConversationBubblesOptions = {
    preferredCount?: number;
    maxBubbles?: number;
    maxChars?: number;
};

const compact = (value: string) => String(value || '').replace(/\s+/g, ' ').trim();

const splitByWords = (text: string, maxChars: number) => {
    const words = compact(text).split(' ').filter(Boolean);
    const chunks: string[] = [];
    let current = '';

    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= maxChars || !current) {
            current = candidate;
            continue;
        }
        chunks.push(current);
        current = word;
    }

    if (current) chunks.push(current);
    return chunks;
};

const findNaturalMidpoint = (text: string) => {
    const midpoint = text.length / 2;
    const candidates = Array.from(text.matchAll(/(?:,\s+|\s+(?:mas|so que|só que|agora|entao|então|porque|e ai|e aí|e)\s+)/gi))
        .map((match) => (match.index || 0) + match[0].length)
        .filter((index) => index >= 18 && text.length - index >= 18)
        .sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint));
    return candidates[0] || -1;
};

const splitBubble = (raw: string, maxChars: number, encourageSplit: boolean) => {
    const text = compact(raw);
    if (!text) return [];

    const naturalParts = text
        .split(/(?<=[!?])\s+|(?<=\.)\s+|;\s+|\s+[—–-]\s+/u)
        .map(compact)
        .filter(Boolean);

    const chunks = naturalParts.flatMap((part) => {
        if (part.length <= maxChars) return [part];
        const midpoint = findNaturalMidpoint(part);
        if (midpoint > 0) {
            return [part.slice(0, midpoint), part.slice(midpoint)].flatMap((piece) => splitByWords(piece, maxChars));
        }
        return splitByWords(part, maxChars);
    });

    if (encourageSplit && chunks.length === 1 && chunks[0].length >= 62) {
        const midpoint = findNaturalMidpoint(chunks[0]);
        if (midpoint > 0) {
            return [chunks[0].slice(0, midpoint), chunks[0].slice(midpoint)].map(compact).filter(Boolean);
        }
    }

    return chunks;
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
    const preferredCount = Math.max(2, Math.min(3, Number(options.preferredCount || 2)));
    const maxBubbles = Math.max(2, Math.min(3, Number(options.maxBubbles || 3)));
    const maxChars = Math.max(60, Math.min(120, Number(options.maxChars || 90)));
    const encourageSplit = messages.length < preferredCount;
    const seen = new Set<string>();

    return messages
        .flatMap((message) => splitBubble(message, maxChars, encourageSplit))
        .map(compact)
        .filter((message) => {
            const key = normalizedKey(message);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, maxBubbles);
};

