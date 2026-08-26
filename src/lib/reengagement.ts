const normalize = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const refusalPattern = /\b(nao quero|para de|pare de|me deixa|nao chama|nao manda|bloqueia|sai fora|some|nunca vou pagar|nao vou pagar|golpe|bot|robo|mentira|idiota|vai se foder|foda-se)\b/i;

export const canReengageLead = (recentMessages: Array<{ sender?: string; content?: string }>) => {
    const latestUser = recentMessages.find((message) => message.sender === 'user');
    if (!latestUser?.content) return false;
    return !refusalPattern.test(normalize(latestUser.content));
};

export const buildContextualReengagement = (options: {
    recentMessages: Array<{ sender?: string; content?: string }>;
    userName?: string | null;
}) => {
    if (!canReengageLead(options.recentMessages)) return null;
    const latestUser = normalize(options.recentMessages.find((message) => message.sender === 'user')?.content);
    const firstName = String(options.userName || '').trim().split(/\s+/)[0];
    const usableName = /^(novo|lead|desconhecido|unknown)$/i.test(firstName) ? '' : firstName;

    if (/\b(trabalho|trampo|servico|correria|turno)\b/i.test(latestUser)) return 'como ficou aquele corre do trabalho?';
    if (/\b(comer|comida|almoco|janta|fome|ifood)\b/i.test(latestUser)) return 'vc conseguiu comer direitinho?';
    if (/\b(serie|filme|jogo|game|carro|moto)\b/i.test(latestUser)) return 'e aquilo que vc tava me contando, como ficou?';
    if (/\b(vip|assinar|preco|valor|pix|comprar)\b/i.test(latestUser)) return 'ficou alguma dúvida do que vc queria pegar?';
    return usableName ? `${usableName}, como vc tá hoje?` : 'como vc tá hoje?';
};
