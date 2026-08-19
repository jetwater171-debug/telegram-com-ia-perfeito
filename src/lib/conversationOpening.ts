const normalizeOpening = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const buildFirstContactGreeting = (userText: string, hasPreviousBotMessage: boolean) => {
    if (hasPreviousBotMessage) return null;

    const value = normalizeOpening(userText).replace(/[!?.]+/g, '').trim();
    const isTechnicalStart = /^\/start(?:\s+\S+)?$/.test(value);
    const isGreetingOnly = /^(?:oi+|ola|e ai|bom dia|boa tarde|boa noite)$/.test(value);
    const asksHowAreYou = /^(?:oi+|ola|e ai|bom dia|boa tarde|boa noite)[, ]+(?:tudo bem|como vc ta|como voce ta)$/.test(value);

    if (isTechnicalStart || isGreetingOnly) {
        return ['oiii tudo bem?', 'como vc se chama?'];
    }
    if (asksHowAreYou) {
        return ['oiii, tudo bem sim e vc?', 'como vc se chama?'];
    }
    return null;
};

const extractIntroducedName = (userText: string) => {
    const raw = String(userText || '').trim();
    const explicit = raw.match(/\b(?:meu nome (?:e|é)|me chamo|pode me chamar de|sou o|sou a)\s+([\p{L}][\p{L}'-]{1,19})/iu);
    if (explicit?.[1]) return explicit[1].toLocaleLowerCase('pt-BR');

    const nameAndReturnQuestion = raw.match(/^([\p{L}][\p{L}'-]{1,19})\s*[, ]+e\s+(?:vc|voce|você)\??$/iu);
    if (nameAndReturnQuestion?.[1]) return nameAndReturnQuestion[1].toLocaleLowerCase('pt-BR');

    const single = raw.replace(/[^\p{L}'-]/gu, '').trim();
    if (/^[\p{L}][\p{L}'-]{1,19}$/u.test(single)) return single.toLocaleLowerCase('pt-BR');
    return null;
};

export const buildNameIntroductionReply = (userText: string, lastBotContent: string) => {
    const botWasAskingName = /\b(?:como vc se chama|como voce se chama|qual (?:e )?seu nome)\b/i.test(normalizeOpening(lastBotContent));
    if (!botWasAskingName) return null;

    const name = extractIntroducedName(userText);
    if (!name) return null;
    const asksHerName = /\b(?:e vc|e voce|qual seu nome|como vc se chama|como voce se chama)\b/i.test(normalizeOpening(userText));

    return {
        name,
        messages: asksHerName
            ? [`prazer ${name} kkk eu sou a lari`, 'como foi seu dia?']
            : [`prazer ${name} kkk`, 'como foi seu dia?'],
    };
};
