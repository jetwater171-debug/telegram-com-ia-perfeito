const normalize = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
const lower = (value: unknown) => normalize(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const isGreeting = (value: unknown) => /^(oi+e*|ola+|e\s*ai|eai|bom dia|boa tarde|boa noite)([,!?.\s].*)?$/i.test(lower(value));
const isGreetingOnly = (value: unknown) => /^(oi+e*|ola+|e\s*ai|eai|bom dia|boa tarde|boa noite|tudo bem)[!?.\s]*$/i.test(lower(value));
const isLoneLaugh = (value: unknown) => /^(?:k{2,}|r+s+|h{2,}a+h*)[!?.\s]*$/i.test(lower(value));
const isGenericDayQuestion = (value: unknown) => /^(?:e\s+)?como (?:ta|esta|foi) (?:o )?seu dia\??$/i.test(lower(value));
const asksName = (value: unknown) => /\b(como (?:vc|voce) se chama|qual (?:e )?seu nome|como eu te chamo)\b/i.test(lower(value));

const tokens = (value: unknown) => lower(value).match(/[a-z0-9]+/g) || [];

const isMeaningfulPhrase = (value: unknown) => {
    const text = lower(value);
    return text.length >= 8 && tokens(text).length >= 2;
};

const isNearDuplicate = (left: unknown, right: unknown) => {
    const leftText = lower(left);
    const rightText = lower(right);
    if (!leftText || !rightText) return false;
    if (leftText === rightText) return true;

    const leftTokens = new Set(tokens(leftText));
    const rightTokens = new Set(tokens(rightText));
    if (leftTokens.size < 4 || rightTokens.size < 4) return false;

    let shared = 0;
    leftTokens.forEach((token) => {
        if (rightTokens.has(token)) shared += 1;
    });
    return shared / Math.min(leftTokens.size, rightTokens.size) >= 0.8;
};

const stripPrematureEndearments = (value: unknown) => normalize(value)
    .replace(/\b(amorzinho|amor|anjo|vida|bb|bebe|bebê|lindo|gostoso|sumido)\b/gi, '')
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

    if (userOnlyGreeting && lastBotAlreadyGreeted) {
        cleaned = cleaned.filter((message) => !isGreeting(message));
    }
    if (userOnlyGreeting && !options.hasKnownName) {
        cleaned = cleaned.filter((message) => !isGenericDayQuestion(message));
        if (!cleaned.some(asksName)) cleaned.push('como é seu nome??');
    }

    const unique: string[] = [];
    const seen = new Set<string>();
    for (const message of cleaned) {
        const key = lower(message);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(message);
    }
    if (options.isConversationStart && userOnlyGreeting) {
        return options.hasKnownName
            ? ['oiii, tudo bem?']
            : ['oiii, tudo bem?', 'como é seu nome??'];
    }
    if (unique.length === 0) {
        return options.hasKnownName ? ['quero entender direito o que vc quis dizer'] : ['como é seu nome??'];
    }
    return unique.slice(0, 2);
};

export const filterConversationConsistencyMessages = (messages: unknown[], options: {
    currentUserText?: string;
    recentUserTexts?: unknown[];
    recentBotTexts?: unknown[];
}) => {
    const recentUserTexts = [options.currentUserText, ...(options.recentUserTexts || [])]
        .map(normalize)
        .filter(isMeaningfulPhrase);
    const recentBotTexts = (options.recentBotTexts || [])
        .map(normalize)
        .filter(isMeaningfulPhrase);
    const accepted: string[] = [];

    for (const item of messages || []) {
        const message = normalize(item);
        if (!message) continue;

        const echoesLead = isMeaningfulPhrase(message)
            && recentUserTexts.some((leadText) => isNearDuplicate(message, leadText));
        const repeatsBot = isMeaningfulPhrase(message)
            && recentBotTexts.some((botText) => isNearDuplicate(message, botText));
        const repeatsBatch = accepted.some((acceptedMessage) => isNearDuplicate(message, acceptedMessage));
        if (echoesLead || repeatsBot || repeatsBatch) continue;
        accepted.push(message);
    }

    return accepted;
};

export const buildConversationRecoveryMessages = (options: {
    userText?: string;
    recentBotTexts?: unknown[];
    recentUserTexts?: unknown[];
    action?: string;
}) => {
    const userText = lower(options.userText);
    const action = lower(options.action);
    const complaint = /\b(ja falei|repet|enrolando|nao respondeu|que resposta|nada a ver|parece bot|e bot|mentira|engan|errando|deu erro|nao funciona)\b/i.test(userText);
    const asksMedia = /\b(foto|fotinha|video|audio|voz|manda|mostra|quero ver)\b/i.test(userText)
        || action.startsWith('send_');
    const asksPaymentOrAccess = /\b(pix|pagar|pagamento|vip|acesso|link|chamada)\b/i.test(userText)
        || action.includes('payment');
    const affirmed = /^(sim|quero|pode|manda|bora|vamos|claro|com certeza|ok|beleza)\b/i.test(userText);

    const candidates = complaint
        ? [
            'vc tem razão, vc já explicou e eu que repeti',
            'eu me perdi na resposta e não vou te fazer repetir de novo',
            'vc já tinha deixado isso claro, eu que respondi outra coisa',
        ]
        : asksPaymentOrAccess
            ? [
                'entendi, vou direto no que vc pediu agora',
                'sim, peguei o que vc quer e vou resolver essa parte',
                'fechou, sem enrolar agora',
            ]
            : asksMedia
                ? [
                    'sim, entendi direitinho o que vc pediu',
                    'peguei a ideia, pode deixar',
                    'agora entendi o que vc quer ver',
                ]
                : affirmed
                    ? [
                        'sim, pode deixar',
                        'fechou, entendi',
                        'ta bom, peguei a ideia',
                    ]
                    : [
                        'agora eu entendi o que vc quis dizer',
                        'peguei seu ponto agora',
                        'sim, entendi direito agora',
                    ];

    const filtered = filterConversationConsistencyMessages(candidates, {
        currentUserText: options.userText,
        recentUserTexts: options.recentUserTexts,
        recentBotTexts: options.recentBotTexts,
    });
    return filtered.length > 0 ? filtered.slice(0, 1) : ['vou responder direito sem te fazer repetir'];
};

export const buildProcessingFailureRecoveryMessages = (options: {
    userText?: string;
    recentBotTexts?: unknown[];
    recentUserTexts?: unknown[];
    isFirstContact?: boolean;
}) => {
    const userText = normalize(options.userText);
    const recentBotTexts = (options.recentBotTexts || []).map(normalize).filter(Boolean);
    const recentUserTexts = (options.recentUserTexts || []).map(normalize).filter(Boolean);
    const startsConversation = /^\/start(?:\s+\S+)?$/i.test(userText);
    const greetingOnly = isGreetingOnly(userText);

    // A recuperação roda fora da IA. No primeiro contato ela precisa preservar a
    // abertura humana em vez de fingir que existe um assunto para o lead explicar.
    if ((startsConversation || greetingOnly) && options.isFirstContact !== false) {
        return ['oiii, tudo bem?', 'como é seu nome??'];
    }

    if (startsConversation || greetingOnly) {
        const greetings = filterConversationConsistencyMessages([
            'tava por aqui sim, e vc?',
            'to aqui, como vc tá?',
            'fala comigo, como vc tá?',
        ], {
            currentUserText: userText,
            recentUserTexts,
            recentBotTexts,
        });
        return greetings.length > 0 ? greetings.slice(0, 1) : ['tava por aqui sim'];
    }

    const asksQuestion = /\?|\b(quem|qual|quais|quanto|quantos|quanta|quantas|como|quando|onde|por que|porque|pq|cad[eê]|o que|oq)\b/i.test(lower(userText));
    const recoveryPairs = asksQuestion
        ? [
            ['eita, travou aqui bem na hora que eu fui te responder kkk', 'manda essa pergunta de novo pra mim?'],
            ['pera, deu uma travadinha aqui bem na hora kkk', 'repete só essa pergunta pra mim?'],
            ['ixi, meu telegram travou na hora da resposta', 'manda a pergunta mais uma vez?'],
        ]
        : [
            ['eita, travou aqui bem na hora que eu fui te responder kkk', 'manda essa última de novo pra mim?'],
            ['pera, deu uma travadinha aqui bem na hora kkk', 'repete só essa última pra mim?'],
            ['ixi, meu telegram travou na hora da resposta', 'manda sua última mensagem mais uma vez?'],
        ];

    for (const pair of recoveryPairs) {
        const filtered = filterConversationConsistencyMessages(pair, {
            currentUserText: userText,
            recentUserTexts,
            recentBotTexts,
        });
        if (filtered.length === pair.length) return filtered;
    }

    return ['voltei, manda só sua última mensagem de novo?'];
};
