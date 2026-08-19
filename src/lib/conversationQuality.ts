const normalize = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
const lower = (value: unknown) => normalize(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const isGreeting = (value: unknown) => /^(oi+e*|ola+|e\s*ai|eai|bom dia|boa tarde|boa noite)([,!?.\s].*)?$/i.test(lower(value));
const isGreetingOnly = (value: unknown) => /^(oi+e*|ola+|e\s*ai|eai|bom dia|boa tarde|boa noite|tudo bem)[!?.\s]*$/i.test(lower(value));
const isLoneLaugh = (value: unknown) => /^(?:k{2,}|r+s+|h{2,}a+h*)[!?.\s]*$/i.test(lower(value));
const isGenericDayQuestion = (value: unknown) => /^(?:e\s+)?como (?:ta|esta|foi) (?:o )?seu dia\??$/i.test(lower(value));
const asksName = (value: unknown) => /\b(como (?:vc|voce) se chama|qual (?:e )?seu nome)\b/i.test(lower(value));

const stripPrematureEndearments = (value: unknown) => normalize(value)
    .replace(/\b(amorzinho|amor|anjo|vida|bb|bebe|bebê|lindo|gostoso)\b/gi, '')
    .replace(/\s+([,!.?])/g, '$1')
    .replace(/,\s*([!?])/g, '$1')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const refineNewRelationshipMessages = (messages: unknown[], options: {
    userText: string;
    lastBotContent?: string;
    hasKnownName?: boolean;
    isConversationStart?: boolean;
}) => {
    const userText = normalize(options.userText);
    const userOnlyGreeting = isGreetingOnly(userText) || /^\/start(?:\s+\S+)?$/i.test(userText);
    const lastBotAlreadyGreeted = isGreeting(options.lastBotContent) || /\btudo bem\b/i.test(lower(options.lastBotContent));
    let cleaned = (messages || []).map(stripPrematureEndearments).filter(Boolean).filter((message) => !isLoneLaugh(message));

    if (userOnlyGreeting && lastBotAlreadyGreeted) cleaned = cleaned.filter((message) => !isGreeting(message));
    if (userOnlyGreeting && !options.hasKnownName) {
        cleaned = cleaned.filter((message) => !isGenericDayQuestion(message));
        if (!cleaned.some(asksName)) cleaned.push('como vc se chama?');
    }

    const unique: string[] = [];
    const seen = new Set<string>();
    for (const message of cleaned) {
        const key = lower(message);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(message);
    }
    if (unique.length === 0) return options.hasKnownName ? ['eaii, tudo bem?'] : ['oiii, tudo bem?', 'como vc se chama?'];
    return unique.slice(0, 2);
};
