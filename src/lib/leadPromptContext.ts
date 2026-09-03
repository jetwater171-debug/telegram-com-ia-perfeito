export type LeadPromptProfileInput = {
    userName?: unknown;
    telegramUsername?: unknown;
    telegramFirstName?: unknown;
    telegramLastName?: unknown;
    telegramLanguage?: unknown;
    deviceType?: unknown;
    city?: unknown;
    citySource?: unknown;
    technicalCity?: unknown;
    region?: unknown;
    country?: unknown;
    timezone?: unknown;
    language?: unknown;
    sourceUrl?: unknown;
    referer?: unknown;
    redirectCode?: unknown;
    clickedAt?: unknown;
    startPayload?: unknown;
    utm?: unknown;
    queryParams?: unknown;
};

const cleanText = (value: unknown, max = 240) => String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const compact = (value: Record<string, unknown>) => Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== '' && item !== null && item !== undefined),
);

/**
 * Monta somente sinais úteis para a conversa. IP, user-agent bruto e IDs de
 * clique não são enviados ao modelo: eles não melhoram a resposta e aumentam
 * o risco de expor identificadores desnecessários.
 */
export const buildLeadPromptProfile = (input: LeadPromptProfileInput) => {
    return compact({
        identity: compact({
            name: cleanText(input.userName, 160),
            telegramUsername: cleanText(input.telegramUsername, 160),
            telegramFirstName: cleanText(input.telegramFirstName, 160),
            telegramLastName: cleanText(input.telegramLastName, 160),
        }),
        location: compact({
            conversationCity: cleanText(input.city, 120),
            conversationCitySource: cleanText(input.citySource, 100),
            technicalEstimateCity: cleanText(input.technicalCity, 120),
            technicalEstimateRegion: cleanText(input.region, 120),
            technicalEstimateCountry: cleanText(input.country, 80),
            timezone: cleanText(input.timezone, 80),
        }),
        locale: compact({
            language: cleanText(input.language, 120),
            telegramLanguage: cleanText(input.telegramLanguage, 40),
        }),
        device: compact({
            type: cleanText(input.deviceType, 80),
        }),
    });
};

export const serializeLeadPromptProfile = (input: LeadPromptProfileInput) => JSON.stringify(buildLeadPromptProfile(input));
