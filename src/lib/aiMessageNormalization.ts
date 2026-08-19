export const extractAiMessageText = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (!value || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    for (const key of ['text', 'content', 'message', 'value']) {
        const candidate = record[key];
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return '';
};

export const normalizeAiMessageList = (value: unknown): string[] => {
    const queue = Array.isArray(value) ? [...value] : [value];
    const normalized: string[] = [];
    while (queue.length > 0) {
        const item = queue.shift();
        if (Array.isArray(item)) {
            queue.unshift(...item);
            continue;
        }
        const text = extractAiMessageText(item);
        if (text) normalized.push(text);
    }
    return normalized;
};
