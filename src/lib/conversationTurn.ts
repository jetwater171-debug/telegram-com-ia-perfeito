const normalize = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Uma risada isolada não abre assunto nem merece uma chamada completa de IA. */
export const isLowSignalLeadReaction = (value: unknown) => {
    const text = normalize(value);
    return /^(?:k{2,}|(?:rs){1,}|h(?:a){2,}|haha+|hehe+)[!?.…\s]*$/i.test(text);
};

/** Detecta bolhas que são claramente a metade de uma frase digitada. */
export const isLikelyIncompleteLeadMessage = (value: unknown) => {
    const text = normalize(value);
    if (!text || isLowSignalLeadReaction(text)) return false;
    if (/[.…-]$/.test(String(value || '').trim())) return text.split(' ').length <= 6;

    return /^(?:to|tô)\s+(?:mor|morr|morrendo)$/i.test(text)
        || /^(?:eu|vc|voce)\s+(?:to|tô|vou|quer|quero)$/i.test(text)
        || /^(?:me|te)\s+(?:manda|fala|conta)$/i.test(text);
};

/** Remove respostas visivelmente quebradas antes de chegarem ao Telegram. */
export const filterMalformedConversationMessages = (messages: unknown[]) => {
    return (messages || []).map((value) => String(value || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .filter((message) => {
            const plain = normalize(message);
            const fragmentedLaughPrefix = /^(?:(?:k{1,3}|rs|ha)\s+){2,}/i.test(plain);
            const brokenPossessive = /\b(?:morrendo|morrer)\s+de\s+por\b/i.test(plain)
                || /\b(?:de|para)\s+por\s+(?:mim|vc|voce)\b/i.test(plain);
            return !fragmentedLaughPrefix && !brokenPossessive;
        });
};
