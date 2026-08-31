const normalizeEvidenceText = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s$]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const splitCompletePhrases = (value: unknown) => (String(value || '')
    .match(/[^.!?\r\n]+(?:[.!?]+|$)/gu) || [])
    .map((raw) => ({
        text: normalizeEvidenceText(raw),
        question: /[?？]/u.test(raw),
        quoted: /["“”«»]/u.test(raw),
    }))
    .filter((phrase) => phrase.text);

const OTHER_ACTOR = /\b(?:lari|larissa|assistente|ela|ele|eles|elas|o\s+lead|a\s+lead|o\s+usuario|a\s+usuaria)\b/u;
const SECOND_PERSON = /\b(?:voce|vc|tu|teu|tua|teus|tuas)\b/u;
const ATTRIBUTION = /\b(?:segundo|conforme|disse|falou|contou|afirmou|perguntou|respondeu|de\s+acordo)\b/u;
const FIRST_PERSON_DECLARATION = /\b(?:eu|meu|minha|meus|minhas|moro|sou|tenho|trabalho|estudo|gosto|prefiro|quero|posso|fa[cç]o|estou|to|tô|fui|nasci|vivo|conhe[cç]o|estava|era)\b/u;

/**
 * Regra deliberadamente conservadora: uma proposta de fato só tem evidência
 * quando reproduz uma frase completa da fala atual. Trechos, paráfrases,
 * coincidências de token e frases sobre outro ator não são prova literal.
 */
export const isCompleteLiteralLeadEvidence = (content: unknown, userText: unknown) => {
    const candidate = normalizeEvidenceText(content);
    if (!candidate || candidate.split(' ').filter(Boolean).length < 2) return false;
    if (OTHER_ACTOR.test(candidate) || SECOND_PERSON.test(candidate) || ATTRIBUTION.test(candidate)) return false;
    if (!FIRST_PERSON_DECLARATION.test(candidate)) return false;
    return splitCompletePhrases(userText).some((phrase) => !phrase.question && !phrase.quoted && phrase.text === candidate);
};

/**
 * Mantém fatos já existentes por compatibilidade, mas exige evidência literal
 * completa para cada fato novo quando o texto da fala atual está disponível.
 */
export const filterNewKnownFactsByEvidence = (
    proposedFacts: unknown[],
    currentFacts: unknown[],
    userText: unknown,
) => {
    const existing = new Set((currentFacts || []).map(normalizeEvidenceText).filter(Boolean));
    return (proposedFacts || [])
        .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .filter((value) => {
            const key = normalizeEvidenceText(value);
            return existing.has(key) || isCompleteLiteralLeadEvidence(value, userText);
        });
};
