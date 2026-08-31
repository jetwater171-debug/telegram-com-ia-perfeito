const normalize = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
const lower = (value: unknown) => normalize(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const isGreeting = (value: unknown) => /^(oi+e*|ola+|e\s*ai|eai|bom dia|boa tarde|boa noite)([,!?.\s].*)?$/i.test(lower(value));
const isGreetingOnly = (value: unknown) => /^(oi+e*|ola+|e\s*ai|eai|bom dia|boa tarde|boa noite|tudo bem)[!?.\s]*$/i.test(lower(value));
const isLoneLaugh = (value: unknown) => /^(?:k{2,}|r+s+|h{2,}a+h*)[!?.\s]*$/i.test(lower(value));
const isGenericDayQuestion = (value: unknown) => /^(?:e\s+)?como (?:ta|esta|foi) (?:o )?seu dia\??$/i.test(lower(value));
const asksName = (value: unknown) => /\b(como (?:vc|voce) se chama|qual (?:e )?seu nome|como eu te chamo)\b/i.test(lower(value));

const tokens = (value: unknown) => lower(value).match(/[a-z0-9]+/g) || [];

export type ConversationLanguage = 'pt' | 'en' | 'es';

export const detectConversationLanguage = (value: unknown, acceptLanguage?: unknown): ConversationLanguage => {
    const text = ` ${lower(value)} `;
    const count = (pattern: RegExp) => (text.match(pattern) || []).length;
    const english = count(/\b(the|you|your|what|why|how|can|could|would|want|send|show|more|love|please|hello|hi|yes|no|pay|price)\b/g);
    const spanish = count(/\b(que|como|quiero|puedes|manda|muestra|hola|amor|precio|pagar|por favor|si|pero)\b/g);
    const portuguese = count(/\b(voce|vc|quero|manda|mostra|oi|ola|amor|preco|pagar|porque|nao|sim|cad[eê]|como)\b/g);
    if (english >= 2 && english > portuguese + 1 && english > spanish) return 'en';
    if (spanish >= 2 && spanish > portuguese + 1 && spanish > english) return 'es';
    const hint = lower(acceptLanguage);
    if (!normalize(value) && hint.startsWith('en')) return 'en';
    if (!normalize(value) && hint.startsWith('es')) return 'es';
    return 'pt';
};

const stableChoice = <T>(values: T[], key: unknown): T => {
    const seed = normalize(key) || 'default';
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) hash = ((hash * 31) + seed.charCodeAt(index)) >>> 0;
    return values[hash % values.length];
};

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
    const union = new Set([...leftTokens, ...rightTokens]).size;
    const smaller = Math.min(leftTokens.size, rightTokens.size);
    const jaccard = union > 0 ? shared / union : 0;
    const shortContainment = smaller <= 6 && shared / smaller >= 0.9;
    return jaccard >= 0.82 || shortContainment;
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
    variationKey?: string;
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
        const openings = ['oiii, tudo bem?', 'eii, tudo bem?', 'oii, como vc tá?'];
        return [
            stableChoice(openings, options.variationKey || userText),
            'como é seu nome?',
        ];
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

export const asksAboutResponderIdentity = (value: unknown) => {
    const text = lower(value);
    const identity = '(?:robo|bot|ia|inteligencia artificial|assistente virtual|human[oa]|pessoa(?: real| de verdade)?)';
    const article = '(?:(?:um|uma|a|o)\\s+)?';
    return new RegExp(`\\b(?:voce|vc|tu)\\s+(?:e|eh|es|seria)\\s+${article}${identity}\\b`).test(text)
        || new RegExp(`^(?:afinal[,:]?\\s+)?(?:e|eh|es)\\s+${article}${identity}\\s*[?!.,]*$`).test(text)
        || new RegExp(`\\b(?:estou|to|tou)\\s+(?:falando|conversando)\\s+com\\s+${article}${identity}\\b`).test(text)
        || /\b(?:voce|vc|tu)\s+(?:e|eh|es)\s+(?:a\s+)?(?:lari|larissa)\b/.test(text)
        || /\b(?:lari|larissa|pessoa|humano|humana)\b.{0,32}\bou\s+(?:(?:um|uma)\s+)?(?:bot|robo|ia)\b/.test(text)
        || /\b(?:bot|robo|ia)\s+ou\s+(?:(?:um|uma|a)\s+)?(?:lari|larissa|pessoa|humano|humana)\b/.test(text)
        || /(?:^|[.!?]\s*)(?:afinal[, ]+)?quem\s+(?:(?:esta|ta)\s+)?(?:respondendo|responde|fala|falando)(?:\s+(?:aqui|comigo|ai|por aqui))?\s*[?!.,]*$/.test(text);
};

const hasHonestResponderIdentity = (value: unknown) => {
    const text = lower(value);
    const identifiesAutomation = /\bsou\s+(?:(?:a|uma|o|um)\s+)?(?:assistente virtual|ia|inteligencia artificial|bot|robo|versao virtual)\b/.test(text);
    const deniesAutomation = /\bnao\s+sou\s+(?:(?:a|uma|o|um)\s+)?(?:assistente virtual|ia|inteligencia artificial|bot|robo)\b/.test(text);
    return identifiesAutomation && !deniesAutomation;
};

export const enforceLatestIntentMessages = (messages: string[], options: {
    latestUserText?: string;
    language?: ConversationLanguage;
}) => {
    const latest = lower(options.latestUserText);
    const combined = lower(messages.join(' '));
    if (options.language !== 'pt') return messages;

    // Uma referência a tecnologia ou uma crítica ao estilo não é, sozinha,
    // pergunta sobre identidade. Preserve respostas corretas já contextualizadas.
    if (asksAboutResponderIdentity(latest) && !hasHonestResponderIdentity(combined)) {
        return ['sou a assistente virtual da Lari aqui no Telegram'];
    }

    const reportsContradiction = /\b(contradicao|contradição|se contradiz|se contradisse|entrou em contradicao|entrou em contradição)\b/i.test(latest);
    if (reportsContradiction) {
        return [
            'vc tem razão, eu me contradisse',
            'eu que me confundi no assunto',
        ];
    }

    const asksHowToSubscribe = /\b(como (?:eu )?(?:assino|assinar|compro|comprar)|quero assinar|como ter acesso)\b/i.test(latest);
    if (asksHowToSubscribe && !/\b(vip|29[,.]90|49[,.]90|79[,.]90|pix|acesso)\b/i.test(combined)) {
        return ['te mostro as três opções do VIP pra vc escolher certinho'];
    }

    const saysMediaDidNotArrive = /\b(nao chegou|não chegou|nao apareceu|não apareceu|nao vi|não vi|cade a foto|cadê a foto|kd a foto)\b/i.test(latest);
    if (saysMediaDidNotArrive && /\b(cego|olha direito|ta ai|tá aí|eu mandei)\b/i.test(combined)) {
        return ['foi mal, vc tem razão: não tinha chegado'];
    }

    const correctsPaymentPromise = /\b(por que|porque|pq)\b.{0,35}\b(pagar|pagamento|pix)\b|\b(disse|falou|prometeu)\b.{0,45}\b(desculpa|gratis|grátis|sem pagar)\b/i.test(latest);
    if (correctsPaymentPromise && !/\b(tem razao|tem razão|vc ta certo|vc tá certo|combinado|eu tinha dito)\b/i.test(combined)) {
        return ['vc tem razão, eu tinha dito que seria pra te compensar. não vou mudar o combinado'];
    }

    return messages;
};

export const enforcePendingUserQuestionMessages = (messages: string[], options: {
    pendingQuestion?: string;
}) => {
    const pending = lower(options.pendingQuestion);
    if (!pending) return messages;

    const combined = lower(messages.join(' '));
    const asksWork = /\b(com o que (?:vc|voce) trabalha|(?:vc|voce) trabalha com o que|qual (?:e )?seu trabalho|o que (?:vc|voce) faz)\b/i.test(pending);
    if (asksWork && !/\b(trabalho|conteudo|modelo|foto|video)\b/i.test(combined)) {
        return ['trabalho criando conteúdo e também faço uns trabalhos como modelo'];
    }

    const asksStudy = /\b((?:vc|voce) (?:ta|esta) estudando|(?:vc|voce) estuda|faz faculdade|qual (?:e )?seu curso)\b/i.test(pending);
    if (asksStudy && !/\b(estud|faculdade|curso)\b/i.test(combined)) {
        return ['to terminando a faculdade ainda'];
    }

    const asksAge = /\b(quantos anos|qual (?:e )?sua idade|(?:vc|voce) tem quantos)\b/i.test(pending);
    if (asksAge && !/\b19\b/.test(combined)) return ['tenho 19'];

    const asksNameQuestion = /\b(qual (?:e )?seu nome|como (?:vc|voce) se chama|como eu te chamo)\b/i.test(pending);
    if (asksNameQuestion && !/\blari|larissa\b/i.test(combined)) return ['me chama de lari'];

    return messages;
};

export const enforceRoleOwnershipContinuityMessages = (messages: string[], options: {
    latestUserText?: string;
    recentBotTexts?: unknown[];
}) => {
    const latest = lower(options.latestUserText);
    const botTexts = (options.recentBotTexts || []).map(normalize).filter(Boolean);
    const recentSelfEducation = botTexts.find((text) =>
        /\b(?:to|tô|estou|faço|curso|estudo)\b.{0,45}\b(?:faculdade|curso)\b|\bfaculdade de\b/i.test(lower(text))
    );
    const leadOnlyAcknowledged = /^(ah+\s*)?(sim|entendi|legal|saquei|ata|a ta|a tá|blz|beleza)[!?.\s]*$/i.test(latest);
    if (!recentSelfEducation || !leadOnlyAcknowledged) return messages;

    const course = lower(recentSelfEducation).match(/\b(?:faculdade|curso)\s+de\s+([a-z]+(?:\s+[a-z]+){0,2})/i)?.[1] || '';
    let ownershipWasInverted = false;
    const safe = (messages || []).map(normalize).filter(Boolean).filter((message) => {
        const text = lower(message);
        const asksLeadAboutLarisCourse = /\bcomo (?:e|eh) (?:o )?(?:curso|faculdade) (?:pra|para) (?:vc|voce)\b/i.test(text);
        const treatsOwnCourseAsSomeoneElses = Boolean(course)
            && text.includes(course)
            && /\b(deve ser|parece ser|imagino que)\b/i.test(text);
        if (asksLeadAboutLarisCourse || treatsOwnCourseAsSomeoneElses) {
            ownershipWasInverted = true;
            return false;
        }
        return true;
    });

    if (!ownershipWasInverted) return messages;
    const meaningful = safe.filter((message) => !/^(entendi|sim|ah sim|ata|legal)[!?.\s]*$/i.test(lower(message)));
    return meaningful.length > 0
        ? meaningful
        : ['ainda falta um pouco pra eu terminar', 'mas to seguindo firme'];
};

/**
 * Ultima barreira local para correcoes e negativas. Ela nao tenta escrever a
 * conversa pela IA; apenas impede que uma resposta volte a insistir no que o
 * lead acabou de recusar ou pergunte novamente um desejo ja declarado.
 */
export const enforceSemanticTurnContinuityMessages = (messages: string[], options: {
    latestUserText?: string;
    recentUserTexts?: unknown[];
}) => {
    const latest = lower(options.latestUserText);
    const correction = /\b(nao quero|nao foi isso|sem isso|para com|nao faz|eu disse|ja falei)\b/i.test(latest);
    if (!correction) return messages;

    const rejectedAction = latest.match(/\bnao\s+quero\s+(?:que\s+)?(?:(?:te|me|vc|voce)\s+)?([a-z]{3,})\b/i)?.[1] || '';
    const previousTexts = (options.recentUserTexts || [])
        .map(lower)
        .filter((text) => text && text !== latest);
    const desireAlreadyKnown = previousTexts.some((text) => /\b(quero|vou|pode|faz|manda)\b/i.test(text));

    const safe = (messages || []).map(normalize).filter(Boolean).filter((message) => {
        const normalized = lower(message);
        const repeatsRejectedAction = rejectedAction
            && new RegExp(`\\b${rejectedAction}\\b`, 'i').test(normalized)
            && !new RegExp(`\\b(?:sem|nao|nunca)\\b.{0,18}\\b${rejectedAction}\\b`, 'i').test(normalized);
        const asksKnownDesireAgain = desireAlreadyKnown
            && /\b(?:me conta|fala|diz)\b.{0,24}\b(?:como|o que)\b.{0,24}\b(?:quer|queria|usar|fazer)\b/i.test(normalized);
        const danglingAlternative = /\bsem\s+[a-z]+(?:\s+[a-z]+){0,3}\s+(?:pode|vai)\s+ser\s+(?:com\s+)?(?:forca|forte|assim)\b/i.test(normalized);
        return !repeatsRejectedAction && !asksKnownDesireAgain && !danglingAlternative;
    });

    if (safe.length > 0) return safe;
    return desireAlreadyKnown
        ? ['entendi, sem isso', 'vou seguir só no que vc já tinha me pedido']
        : ['entendi, sem isso', 'me diz só o que vc prefere então'];
};

export const buildConversationRecoveryMessages = (options: {
    userText?: string;
    pendingQuestion?: string;
    recentBotTexts?: unknown[];
    recentUserTexts?: unknown[];
    action?: string;
    language?: ConversationLanguage;
}) => {
    const userText = lower(options.userText);
    const pendingQuestion = lower(options.pendingQuestion);
    const action = lower(options.action);
    const complaint = /\b(ja falei|repet|enrolando|nao respondeu|que resposta|nada a ver|parece bot|e bot|mentira|engan|errando|deu erro|nao funciona)\b/i.test(userText);
    const asksMedia = /\b(foto|fotinha|video|audio|voz|manda|mostra|quero ver)\b/i.test(userText)
        || action.startsWith('send_');
    const asksPaymentOrAccess = /\b(pix|pagar|pagamento|vip|acesso|link|chamada)\b/i.test(userText)
        || action.includes('payment');
    const affirmed = /^(sim|quero|pode|manda|bora|vamos|claro|com certeza|ok|beleza)\b/i.test(userText);
    const affectionateGreeting = /^(?:oi+e*|ola+|e\s*ai|eai|bom dia|boa tarde|boa noite)[,!?.\s]*(?:amor|vida|bb|bebe|lindo)[!?.\s]*$/i.test(userText);
    const greetingOnly = isGreetingOnly(userText);

    const localized = options.language === 'en'
        ? ['tell me, I want to answer what you just said properly']
        : options.language === 'es'
            ? ['dime, quiero responder bien a lo que acabas de decir']
            : null;
    if (localized) {
        const filtered = filterConversationConsistencyMessages(localized, {
            currentUserText: options.userText,
            recentUserTexts: options.recentUserTexts,
            recentBotTexts: options.recentBotTexts,
        });
        return filtered.length > 0 ? filtered : localized;
    }

    const pendingQuestionCandidates = (() => {
        if (/\b(com o que (?:vc|voce) trabalha|(?:vc|voce) trabalha com o que|qual (?:e )?seu trabalho|o que (?:vc|voce) faz)\b/i.test(pendingQuestion)) {
            return ['trabalho criando conteúdo e também faço uns trabalhos como modelo'];
        }
        if (/\b((?:vc|voce) (?:ta|esta) estudando|(?:vc|voce) estuda|faz faculdade|qual (?:e )?seu curso)\b/i.test(pendingQuestion)) {
            return ['to terminando a faculdade ainda'];
        }
        if (/\b(quantos anos|qual (?:e )?sua idade|(?:vc|voce) tem quantos)\b/i.test(pendingQuestion)) return ['tenho 19'];
        if (/\b(qual (?:e )?seu nome|como (?:vc|voce) se chama|como eu te chamo)\b/i.test(pendingQuestion)) return ['me chama de lari'];
        return null;
    })();

    const candidates = pendingQuestionCandidates || (affectionateGreeting
        ? [
            'fala comigo amor, tava por aqui',
            'tava por aqui sim amor, e vc?',
            'fala comigo amor, como vc ta?',
        ]
        : greetingOnly
            ? [
                'fala comigo, tava por aqui',
                'tava por aqui sim, e vc?',
                'fala comigo, como vc ta?',
            ]
        : complaint
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
                        'peguei essa parte',
                        'entendi o que vc quis dizer',
                        'faz sentido do jeito que vc explicou',
                    ]);

    const filtered = filterConversationConsistencyMessages(candidates, {
        currentUserText: options.userText,
        recentUserTexts: options.recentUserTexts,
        recentBotTexts: options.recentBotTexts,
    });
    if (filtered.length === 0) return ['entendi essa parte'];
    const variationKey = [userText, pendingQuestion, ...(options.recentBotTexts || []).slice(0, 3)].join('|');
    return [stableChoice(filtered, variationKey)];
};

export const buildProcessingFailureRecoveryMessages = (options: {
    userText?: string;
    recentBotTexts?: unknown[];
    recentUserTexts?: unknown[];
    isFirstContact?: boolean;
    language?: ConversationLanguage;
}) => {
    const userText = normalize(options.userText);
    const recentBotTexts = (options.recentBotTexts || []).map(normalize).filter(Boolean);
    const recentUserTexts = (options.recentUserTexts || []).map(normalize).filter(Boolean);
    const startsConversation = /^\/start(?:\s+\S+)?$/i.test(userText);
    const greetingOnly = isGreetingOnly(userText);

    if (options.language === 'en') {
        return greetingOnly ? ['hey, how are you?'] : ['my Telegram glitched right when I replied, send that last message again?'];
    }
    if (options.language === 'es') {
        return greetingOnly ? ['hola, cómo estás?'] : ['mi Telegram falló justo cuando respondí, me mandas ese último mensaje otra vez?'];
    }

    // A recuperação roda fora da IA. No primeiro contato ela precisa preservar a
    // abertura humana em vez de fingir que existe um assunto para o lead explicar.
    if ((startsConversation || greetingOnly) && options.isFirstContact !== false) {
        return [stableChoice([
            'oii, tudo bem? como posso te chamar?',
            'eii, chegou bem? qual seu nome?',
            'oi, tudo certo por aí? como vc se chama?',
        ], userText)];
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
