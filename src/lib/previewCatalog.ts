import { supabaseServer as supabase } from '@/lib/supabaseServer';
import type { PhotoRequestAnalysis } from '@/lib/previewRequestAnalyzer';

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
    media_type?: 'photo' | 'video';
    admin_brief?: string | null;
    request_analysis?: PhotoRequestAnalysis | null;
    analysis_model?: string | null;
    analyzed_at?: string | null;
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
    const fallback = await loadFallbackRequests();
    const fallbackByKey = new Map(fallback.map((item) => [item.normalized_key, item]));
    const items = !error
        ? ((data || []) as MissingPreviewRequest[]).map((item) => ({
            ...(fallbackByKey.get(item.normalized_key) || {}),
            ...item,
            admin_brief: item.admin_brief || fallbackByKey.get(item.normalized_key)?.admin_brief || null,
            request_analysis: item.request_analysis || fallbackByKey.get(item.normalized_key)?.request_analysis || null,
            analysis_model: item.analysis_model || fallbackByKey.get(item.normalized_key)?.analysis_model || null,
        }))
        : fallback;
    return items.filter((item) => {
        if (item.media_type === 'video') return false;
        const legacyText = `${item.requested_description || ''} ${(item.tags || []).join(' ')}`;
        return !(/\b(video|vídeo|filmagem|gravacao|gravação)\b/i.test(legacyText)
            && !/\b(foto|fotinha|selfie|imagem|nude|pelada|nua)\b/i.test(legacyText));
    });
};

export const upsertMissingPreviewRequest = async (input: {
    description: string;
    tags?: string[];
    examplePhrase?: string;
    sessionId?: string;
    canonicalKey?: string;
    adminBrief?: string;
    analysis?: PhotoRequestAnalysis;
    mediaType?: 'photo';
}) => {
    const description = cleanText(input.description, 500);
    if (!description) return null;
    const tags = cleanTags(input.tags);
    if (input.analysis?.media_kind && input.analysis.media_kind !== 'photo') return null;
    const normalizedKey = cleanText(input.canonicalKey, 180)
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .toLowerCase()
        || normalizePreviewRequestKey(description, tags);
    const now = new Date().toISOString();

    const { data: existing, error: selectError } = await supabase
        .from('preview_requests')
        .select('*')
        .eq('normalized_key', normalizedKey)
        .maybeSingle();

    if (!selectError) {
        let matchedExisting = existing as MissingPreviewRequest | null;
        if (!matchedExisting) {
            const { data: candidates } = await supabase
                .from('preview_requests')
                .select('*')
                .eq('status', 'pending')
                .order('last_requested_at', { ascending: false })
                .limit(150);
            matchedExisting = findEquivalentRequest((candidates || []) as MissingPreviewRequest[], normalizedKey, tags);
        }
        const richFields = {
            media_type: 'photo' as const,
            admin_brief: cleanText(input.adminBrief, 900) || input.analysis?.production_brief || null,
            request_analysis: input.analysis || null,
            analysis_model: input.analysis?.model || null,
            analyzed_at: input.analysis ? now : null,
        };
        if (matchedExisting) {
            let usedLegacyColumns = false;
            let result = await supabase
                .from('preview_requests')
                .update({
                    requested_description: description,
                    example_phrase: cleanText(input.examplePhrase, 300) || matchedExisting.example_phrase,
                    tags: Array.from(new Set([...(matchedExisting.tags || []), ...tags])).slice(0, 20),
                    request_count: Number(matchedExisting.request_count || 1) + 1,
                    priority: Math.min(100, Number(matchedExisting.priority || 0) + 1),
                    status: matchedExisting.status === 'fulfilled' ? 'fulfilled' : 'pending',
                    source_session_id: input.sessionId || matchedExisting.source_session_id,
                    last_requested_at: now,
                    updated_at: now,
                    ...richFields,
                })
                .eq('id', matchedExisting.id)
                .select('*')
                .single();
            if (result.error && isMissingRequestColumn(result.error)) {
                usedLegacyColumns = true;
                result = await supabase.from('preview_requests').update({
                    requested_description: description,
                    example_phrase: cleanText(input.examplePhrase, 300) || matchedExisting.example_phrase,
                    tags: Array.from(new Set([...(matchedExisting.tags || []), ...tags])).slice(0, 20),
                    request_count: Number(matchedExisting.request_count || 1) + 1,
                    priority: Math.min(100, Number(matchedExisting.priority || 0) + 1),
                    status: matchedExisting.status === 'fulfilled' ? 'fulfilled' : 'pending',
                    source_session_id: input.sessionId || matchedExisting.source_session_id,
                    last_requested_at: now,
                    updated_at: now,
                }).eq('id', matchedExisting.id).select('*').single();
            }
            if (usedLegacyColumns && result.data) await saveRichFallbackOverlay(result.data as MissingPreviewRequest, richFields);
            return result.data as MissingPreviewRequest | null;
        }

        let usedLegacyColumns = false;
        let result = await supabase
            .from('preview_requests')
            .insert({
                normalized_key: normalizedKey,
                requested_description: description,
                example_phrase: cleanText(input.examplePhrase, 300) || null,
                tags,
                source_session_id: input.sessionId || null,
                last_requested_at: now,
                updated_at: now,
                ...richFields,
            })
            .select('*')
            .single();
        if (result.error && isMissingRequestColumn(result.error)) {
            usedLegacyColumns = true;
            result = await supabase.from('preview_requests').insert({
                normalized_key: normalizedKey,
                requested_description: description,
                example_phrase: cleanText(input.examplePhrase, 300) || null,
                tags,
                source_session_id: input.sessionId || null,
                last_requested_at: now,
                updated_at: now,
            }).select('*').single();
        }
        if (usedLegacyColumns && result.data) await saveRichFallbackOverlay(result.data as MissingPreviewRequest, richFields);
        return result.data as MissingPreviewRequest | null;
    }

    const fallback = await loadFallbackRequests();
    const equivalent = fallback.find((item) => item.normalized_key === normalizedKey)
        || findEquivalentRequest(fallback, normalizedKey, tags);
    const index = equivalent ? fallback.findIndex((item) => item.id === equivalent.id) : -1;
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
            media_type: 'photo',
            admin_brief: cleanText(input.adminBrief, 900) || input.analysis?.production_brief || null,
            request_analysis: input.analysis || null,
            analysis_model: input.analysis?.model || null,
            analyzed_at: input.analysis ? now : null,
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
            media_type: 'photo',
            admin_brief: cleanText(input.adminBrief, 900) || input.analysis?.production_brief || null,
            request_analysis: input.analysis || null,
            analysis_model: input.analysis?.model || null,
            analyzed_at: input.analysis ? now : null,
        });
    }
    await saveFallbackRequests(fallback);
    return index >= 0 ? fallback[index] : fallback.find((item) => item.normalized_key === normalizedKey) || null;
};

const isMissingRequestColumn = (error: any) => String(error?.code || '') === '42703'
    || /media_type|admin_brief|request_analysis|analysis_model|analyzed_at/i.test(String(error?.message || ''));

const saveRichFallbackOverlay = async (
    row: MissingPreviewRequest,
    richFields: Pick<MissingPreviewRequest, 'media_type' | 'admin_brief' | 'request_analysis' | 'analysis_model' | 'analyzed_at'>,
) => {
    const fallback = await loadFallbackRequests();
    const nextItem = { ...row, ...richFields } as MissingPreviewRequest;
    const index = fallback.findIndex((item) => item.normalized_key === row.normalized_key);
    if (index >= 0) fallback[index] = { ...fallback[index], ...nextItem };
    else fallback.unshift(nextItem);
    await saveFallbackRequests(fallback);
};

const similarityTokens = (key: string, tags: string[]) => new Set(
    normalize(`${key} ${tags.join(' ')}`).split(' ').filter((token) => token.length > 1 && !stopWords.has(token)),
);

const findEquivalentRequest = (items: MissingPreviewRequest[], key: string, tags: string[]) => {
    const incoming = similarityTokens(key.replace(/-/g, ' '), tags);
    if (incoming.size === 0) return null;
    let winner: MissingPreviewRequest | null = null;
    let winnerScore = 0;
    for (const item of items) {
        if (item.media_type === 'video') continue;
        const existing = similarityTokens(item.normalized_key.replace(/-/g, ' '), item.tags || []);
        const intersection = [...incoming].filter((token) => existing.has(token)).length;
        const score = (2 * intersection) / (incoming.size + existing.size || 1);
        if (score > winnerScore) {
            winner = item;
            winnerScore = score;
        }
    }
    return winnerScore >= 0.78 ? winner : null;
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
