export type ConversationEpisodeMessage = {
    sender?: string;
    content?: unknown;
    created_at?: string | null;
};

const START_COMMAND = /^\/start(?:\s+\S+)?$/i;

export const hasConversationStartCommand = (value: unknown) => String(value || '')
    .split(/\r?\n/)
    .some((line) => START_COMMAND.test(line.trim()));

export const findLatestConversationStartAt = (messages: ConversationEpisodeMessage[]) => (messages || [])
    .filter((message) => message.sender === 'user' && hasConversationStartCommand(message.content))
    .map((message) => String(message.created_at || ''))
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;

export const filterConversationEpisodeMessages = <T extends ConversationEpisodeMessage>(
    messages: T[],
    conversationStartedAt?: unknown,
    isConversationStart = false,
): T[] => {
    if (isConversationStart) return [];
    const startedAt = Date.parse(String(conversationStartedAt || ''));
    if (!Number.isFinite(startedAt)) return [...(messages || [])];
    return (messages || []).filter((message) => {
        const createdAt = Date.parse(String(message.created_at || ''));
        return Number.isFinite(createdAt) && createdAt >= startedAt;
    });
};
