import { supabaseServer as supabase } from '@/lib/supabaseServer';

export type MissingPreviewRequest = {
    id: string;
    normalized_key: string;
    requested_description: string;
    example_phrase?: string | null;
    tags?: string[] | null;
    request_count: number;
    priority: number;
    status: 'pending' | 'fulfilled' | 'dismissed';
    source_session_id?: string | null;
    matched_preview_id?: string | null;
    created_at?: string;
    updated_at?: string;
    last_requested_at?: string;
};

const REQUESTS_FALLBACK_KEY = 'preview_requests_queue';
const stopWords = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'uma', 'um', 'com', 'sem', 'pra', 'para', 'que', 'eu', 'vc', 'voce', 'você', 'foto', 'imagem', 'manda', 'mandar', 'quero', 'ver']);
const normalize = (value: unknown) => String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const cleanText = (value: unknown, max = 500) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanTags = (value: unknown) => Array.from(new Set(
    (Array.isArray(value) ? value : [])
        .map((tag) => normalize(tag).slice(0, 60))
        .filter(Boolean),
)).slice(0, 16);

export const normalizePreviewRequestKey = (description: string, tags: string[] = []) => {
    const tokens = normalize(`${description} ${tags.join(' ')}`)
        .split(' ')
        .filter((token) => token.length > 1 && !stopWords.has(token));
    return Array.from(new Set(tokens)).sort().slice(0, 12).join('-').slice(0, 180) || 'pedido-generico';
};

const loadFallbackRequests = async (): Promise<MissingPreviewRequest[]> => {
    const { data } = await supabase.from('bot_settings').select('value').eq('key', REQUESTS_FALLBACK_KEY).maybeSingle();
    try {
        const parsed = JSON.parse(data?.value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const saveFallbackRequests = async (items: MissingPreviewRequest[]) => {
    await supabase.from('bot_settings').upsert({
        key: REQUESTS_FALLBACK_KEY,
        value: JSON.stringify(items.slice(0, 250)),
    });
};

export const loadMissingPreviewRequests = async (): Promise<MissingPreviewRequest[]> => {
    const { data, error } = await supabase
        .from('preview_requests')
        .select('*')
        .order('priority', { ascending: false })
        .order('request_count', { ascending: false })
        .order('last_requested_at', { ascending: false })
        .limit(250);
    if (!error) return (data || []) as MissingPreviewRequest[];
    return loadFallbackRequests();
};

export const upsertMissingPreviewRequest = async (input: {
    description: string;
    tags?: string[];
    examplePhrase?: string;
    sessionId?: string;
}) => {
    const description = cleanText(input.description, 500);
    if (!description) return null;
    const tags = cleanTags(input.tags);
    const normalizedKey = normalizePreviewRequestKey(description, tags);
    const now = new Date().toISOString();

    const { data: existing, error: selectError } = await supabase
        .from('preview_requests')
        .select('*')
        .eq('normalized_key', normalizedKey)
        .maybeSingle();

    if (!selectError) {
        if (existing) {
            const { data } = await supabase
                .from('preview_requests')
                .update({
                    requested_description: description,
                    example_phrase: cleanText(input.examplePhrase, 300) || existing.example_phrase,
                    tags: Array.from(new Set([...(existing.tags || []), ...tags])).slice(0, 16),
                    request_count: Number(existing.request_count || 1) + 1,
                    priority: Math.min(100, Number(existing.priority || 0) + 1),
                    status: existing.status === 'fulfilled' ? 'fulfilled' : 'pending',
                    source_session_id: input.sessionId || existing.source_session_id,
                    last_requested_at: now,
                    updated_at: now,
                })
                .eq('id', existing.id)
                .select('*')
                .single();
            return data as MissingPreviewRequest | null;
        }

        const { data } = await supabase
            .from('preview_requests')
            .insert({
                normalized_key: normalizedKey,
                requested_description: description,
                example_phrase: cleanText(input.examplePhrase, 300) || null,
                tags,
                source_session_id: input.sessionId || null,
                last_requested_at: now,
                updated_at: now,
            })
            .select('*')
            .single();
        return data as MissingPreviewRequest | null;
    }

    const fallback = await loadFallbackRequests();
    const index = fallback.findIndex((item) => item.normalized_key === normalizedKey);
    if (index >= 0) {
        fallback[index] = {
            ...fallback[index],
            requested_description: description,
            example_phrase: cleanText(input.examplePhrase, 300) || fallback[index].example_phrase,
            tags: Array.from(new Set([...(fallback[index].tags || []), ...tags])).slice(0, 16),
            request_count: Number(fallback[index].request_count || 1) + 1,
            priority: Math.min(100, Number(fallback[index].priority || 0) + 1),
            last_requested_at: now,
            updated_at: now,
        };
    } else {
        fallback.unshift({
            id: crypto.randomUUID(),
            normalized_key: normalizedKey,
            requested_description: description,
            example_phrase: cleanText(input.examplePhrase, 300) || null,
            tags,
            request_count: 1,
            priority: 0,
            status: 'pending',
            source_session_id: input.sessionId || null,
            created_at: now,
            updated_at: now,
            last_requested_at: now,
        });
    }
    await saveFallbackRequests(fallback);
    return fallback.find((item) => item.normalized_key === normalizedKey) || null;
};

export const updateMissingPreviewRequest = async (
    id: string,
    patch: Partial<Pick<MissingPreviewRequest, 'status' | 'priority' | 'matched_preview_id'>>,
) => {
    const payload = { ...patch, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from('preview_requests').update(payload).eq('id', id).select('*').maybeSingle();
    if (!error) return data as MissingPreviewRequest | null;

    const fallback = await loadFallbackRequests();
    const next = fallback.map((item) => item.id === id ? { ...item, ...payload } as MissingPreviewRequest : item);
    await saveFallbackRequests(next);
    return next.find((item) => item.id === id) || null;
};

const tokensFor = (value: unknown) => new Set(normalize(value).split(' ').filter((token) => token.length > 1 && !stopWords.has(token)));

export const scorePreviewForContext = (asset: any, context: string, preferredTags: string[] = []) => {
    const queryTokens = tokensFor(`${context} ${preferredTags.join(' ')}`);
    const tags = cleanTags(asset?.tags);
    const tagTokens = tokensFor(tags.join(' '));
    const descriptionTokens = tokensFor(`${asset?.name || ''} ${asset?.description || ''} ${asset?.triggers || ''} ${JSON.stringify(asset?.ai_analysis || {})}`);
    let score = Number(asset?.priority || 0) * 0.15;
    for (const token of queryTokens) {
        if (tagTokens.has(token)) score += 5;
        if (descriptionTokens.has(token)) score += 2;
    }
    for (const preferredTag of preferredTags) {
        const normalizedTag = normalize(preferredTag);
        if (tags.some((tag) => tag.includes(normalizedTag) || normalizedTag.includes(tag))) score += 8;
    }
    return score;
};

