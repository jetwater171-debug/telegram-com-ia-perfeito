const normalize = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
const lower = (value: unknown) => normalize(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const isGreeting = (value: unknown) => /^(oi+e*|ola+|e\s*ai|eai|bom dia|boa tarde|boa noite)([,!?.\s].*)?$/i.test(lower(value));
const isGreetingOnly = (value: unknown) => /^(oi+e*|ola+|e\s*ai|eai|bom dia|boa tarde|boa noite|tudo bem)[!?.\s]*$/i.test(lower(value));
const isLoneLaugh = (value: unknown) => /^(?:k{2,}|r+s+|h{2,}a+h*)[!?.\s]*$/i.test(lower(value));

export const refineNewRelationshipMessages = (messages: unknown[], options: {
    userText: string;
    lastBotContent?: string;
    hasKnownName?: boolean;
    isConversationStart?: boolean;
}) => {
    const userText = normalize(options.userText);
    const userOnlyGreeting = isGreetingOnly(userText) || /^\/start(?:\s+\S+)?$/i.test(userText);
    const lastBotAlreadyGreeted = isGreeting(options.lastBotContent) || /\btudo bem\b/i.test(lower(options.lastBotContent));
    let cleaned = (messages || []).map((m) => normalize(m)).filter(Boolean).filter((message) => !isLoneLaugh(message));

    if (userOnlyGreeting && lastBotAlreadyGreeted) {
        cleaned = cleaned.filter((message) => !isGreeting(message));
    }

    const unique: string[] = [];
    const seen = new Set<string>();
    for (const message of cleaned) {
        const key = lower(message);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(message);
    }
    if (unique.length === 0 || (options.isConversationStart && userOnlyGreeting)) {
        return options.hasKnownName
            ? ['oii lindo, tudo bem?', 'como ta seu dia hj?']
            : ['oii, tudo bem?', 'como eu te chamo, anjo?'];
    }
    return unique.slice(0, 3);
};
