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
