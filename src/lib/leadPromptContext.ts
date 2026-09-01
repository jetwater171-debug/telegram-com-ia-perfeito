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

const cleanUrl = (value: unknown) => {
    const raw = cleanText(value, 800);
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        return `${parsed.origin}${parsed.pathname}`.slice(0, 500);
    } catch {
        return raw.split(/[?#]/, 1)[0].slice(0, 500);
    }
};

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const firstValue = (...values: unknown[]) => {
    for (const value of values) {
        const cleaned = cleanText(value, 300);
        if (cleaned) return cleaned;
    }
    return '';
};

const detectSourceChannel = (utm: Record<string, unknown>, query: Record<string, unknown>, sourceUrl: string, referer: string) => {
    const declared = firstValue(utm.utm_source, query.utm_source, query.source, query.ref, query.origin);
    const haystack = [declared, sourceUrl, referer].join(' ').toLowerCase();
    if (/instagram|instagram\.com|\binsta\b/.test(haystack)) return 'instagram';
    if (/tiktok|tiktok\.com/.test(haystack) || utm.ttclid || query.ttclid) return 'tiktok';
    if (/facebook|facebook\.com|\bmeta\b/.test(haystack) || utm.fbclid || query.fbclid) return 'facebook/meta';
    if (/google|google\.com/.test(haystack) || utm.gclid || query.gclid) return 'google';
    if (/youtube|youtu\.be/.test(haystack)) return 'youtube';
    if (/telegram|t\.me/.test(haystack)) return 'telegram';
    return declared || (referer ? 'referencia_web' : sourceUrl ? 'acesso_direto_ou_link' : 'desconhecida');
};

const compact = (value: Record<string, unknown>) => Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== '' && item !== null && item !== undefined),
);

/**
 * Monta somente sinais úteis para a conversa. IP, user-agent bruto e IDs de
 * clique não são enviados ao modelo: eles não melhoram a resposta e aumentam
 * o risco de expor identificadores desnecessários.
 */
export const buildLeadPromptProfile = (input: LeadPromptProfileInput) => {
    const utm = asRecord(input.utm);
    const query = asRecord(input.queryParams);
    const sourceUrl = cleanUrl(input.sourceUrl);
    const referer = cleanUrl(input.referer);
    const campaign = compact({
        source: firstValue(utm.utm_source, query.utm_source),
        medium: firstValue(utm.utm_medium, query.utm_medium),
        campaign: firstValue(utm.utm_campaign, query.utm_campaign),
        content: firstValue(utm.utm_content, query.utm_content),
        term: firstValue(utm.utm_term, query.utm_term),
    });

    return compact({
        identity: compact({
            name: cleanText(input.userName, 160),
            telegramUsername: cleanText(input.telegramUsername, 160),
            telegramFirstName: cleanText(input.telegramFirstName, 160),
            telegramLastName: cleanText(input.telegramLastName, 160),
        }),
        origin: compact({
            channel: detectSourceChannel(utm, query, sourceUrl, referer),
            campaign,
            landingPage: sourceUrl,
            referrer: referer,
            redirectCode: cleanText(input.redirectCode, 120),
            clickedAt: cleanText(input.clickedAt, 80),
            startPayload: cleanText(input.startPayload, 160),
            clickTracking: compact({
                meta: Boolean(utm.fbclid || query.fbclid) || undefined,
                tiktok: Boolean(utm.ttclid || query.ttclid) || undefined,
                google: Boolean(utm.gclid || query.gclid) || undefined,
            }),
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
