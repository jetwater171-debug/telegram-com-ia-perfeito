type StoredConversationMessage = {
    sender: string;
    content: unknown;
};

export type AiHistoryEntry = {
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
};

export const buildCleanAiHistory = (
    messages: StoredConversationMessage[],
    maxCharsPerRoleBlock = 900,
    maxEntries = 20,
    maxTotalChars = 5600,
): AiHistoryEntry[] => {
    const grouped = (messages || []).slice(-maxEntries).reduce<AiHistoryEntry[]>((history, message) => {
        if (message.sender !== 'user' && message.sender !== 'bot') return history;
        const text = String(message.content || '').replace(/\s+/g, ' ').trim();
        if (!text) return history;

        const role: AiHistoryEntry['role'] = message.sender === 'bot' ? 'model' : 'user';
        const previous = history.at(-1);
        if (previous?.role === role) {
            previous.parts[0].text = `${previous.parts[0].text}\n${text}`.slice(-maxCharsPerRoleBlock);
            return history;
        }

        history.push({ role, parts: [{ text: text.slice(-maxCharsPerRoleBlock) }] });
        return history;
    }, []);

    while (grouped[0]?.role === 'model') grouped.shift();
    while (grouped.at(-1)?.role === 'user') grouped.pop();

    let remaining = Math.max(800, maxTotalChars);
    const bounded: AiHistoryEntry[] = [];
    for (const entry of [...grouped].reverse()) {
        if (remaining <= 0) break;
        const text = entry.parts[0].text.slice(-remaining);
        if (!text) continue;
        bounded.unshift({ role: entry.role, parts: [{ text }] });
        remaining -= text.length;
    }

    while (bounded[0]?.role === 'model') bounded.shift();
    return bounded;
};
