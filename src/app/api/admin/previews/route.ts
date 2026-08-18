import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import {
    analyzePreviewImage,
    DEFAULT_PREVIEW_VISION_FALLBACK_MODEL,
    DEFAULT_PREVIEW_VISION_MODEL,
    getPreviewVisionSettings,
} from '@/lib/previewVision';
import { loadMissingPreviewRequests, updateMissingPreviewRequest } from '@/lib/previewCatalog';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const MAX_FILES = 20;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_BATCH_BYTES = 80 * 1024 * 1024;

const ensureBucket = async () => {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) throw error;
    if (!(buckets || []).some((bucket: any) => bucket.name === 'previews')) {
        const { error: createError } = await supabase.storage.createBucket('previews', { public: true });
        if (createError) throw createError;
    }
};

const safeFilename = (value: string) => String(value || 'preview.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
const isMissingCatalogColumn = (error: any) => String(error?.code || '') === '42703'
    || /ai_analysis|analysis_status|analysis_model|analyzed_at|source_request_id/i.test(String(error?.message || ''));

const insertAssetCompat = async (payload: Record<string, any>) => {
    let result = await supabase.from('preview_assets').insert(payload).select('*').single();
    if (result.error && isMissingCatalogColumn(result.error)) {
        const {
            ai_analysis: _analysis,
            analysis_status: _status,
            analysis_model: _model,
            analyzed_at: _analyzedAt,
            source_request_id: _sourceRequestId,
            ...legacyPayload
        } = payload;
        result = await supabase.from('preview_assets').insert(legacyPayload).select('*').single();
    }
    if (result.error) throw result.error;
    return result.data;
};

const updateAssetCompat = async (id: string, payload: Record<string, any>) => {
    let result = await supabase.from('preview_assets').update(payload).eq('id', id).select('*').single();
    if (result.error && isMissingCatalogColumn(result.error)) {
        const {
            ai_analysis: _analysis,
            analysis_status: _status,
            analysis_model: _model,
            analyzed_at: _analyzedAt,
            source_request_id: _sourceRequestId,
            ...legacyPayload
        } = payload;
        result = await supabase.from('preview_assets').update(legacyPayload).eq('id', id).select('*').single();
    }
    if (result.error) throw result.error;
    return result.data;
};

export async function GET() {
    try {
        const [assetsResult, requests, visionSettings] = await Promise.all([
            supabase
                .from('preview_assets')
                .select('*')
                .order('priority', { ascending: false })
                .order('created_at', { ascending: false }),
            loadMissingPreviewRequests(),
            getPreviewVisionSettings(),
        ]);
        if (assetsResult.error) throw assetsResult.error;
        return NextResponse.json({
            assets: assetsResult.data || [],
            requests,
            settings: {
                primaryModel: visionSettings.primaryModel,
                fallbackModel: visionSettings.fallbackModel,
                openRouterConfigured: Boolean(visionSettings.apiKey),
            },
        });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || 'erro ao carregar previas' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const files = formData.getAll('files').filter((item): item is File => item instanceof File && item.size > 0);
        const confirmedAdult = formData.get('confirmedAdult') === 'true';
        const sourceRequestId = String(formData.get('requestId') || '').trim() || null;
        const manualName = String(formData.get('name') || '').trim();
        const manualDescription = String(formData.get('description') || '').trim();
        const manualTags = String(formData.get('tags') || '').split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean);

        if (!confirmedAdult) {
            return NextResponse.json({ error: 'confirme que todo material enviado e da Larissa adulta' }, { status: 400 });
        }
        if (files.length === 0) return NextResponse.json({ error: 'selecione pelo menos uma imagem ou video' }, { status: 400 });
        if (files.length > MAX_FILES) return NextResponse.json({ error: `envie no maximo ${MAX_FILES} arquivos por lote` }, { status: 400 });
        if (files.some((file) => file.size > MAX_FILE_BYTES)) return NextResponse.json({ error: 'cada arquivo deve ter no maximo 15MB' }, { status: 400 });
        if (files.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) return NextResponse.json({ error: 'o lote deve ter no maximo 80MB' }, { status: 400 });
        if (files.some((file) => !file.type.startsWith('image/') && !file.type.startsWith('video/'))) {
            return NextResponse.json({ error: 'o lote contem um formato que nao e imagem nem video' }, { status: 400 });
        }

        await ensureBucket();
        const results: Array<{ filename: string; ok: boolean; asset?: any; error?: string }> = [];

        const processFile = async (file: File) => {
            const buffer = Buffer.from(await file.arrayBuffer());
            const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
            const storagePath = `previews/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}_${safeFilename(file.name)}`;
            const { error: uploadError } = await supabase.storage.from('previews').upload(storagePath, buffer, {
                upsert: false,
                contentType: file.type || undefined,
            });
            if (uploadError) {
                results.push({ filename: file.name, ok: false, error: uploadError.message });
                return;
            }

            const publicUrl = supabase.storage.from('previews').getPublicUrl(storagePath).data.publicUrl;
            try {
                const analysis = mediaType === 'image'
                    ? await analyzePreviewImage({ buffer, mimeType: file.type || 'image/jpeg', filename: file.name })
                    : null;
                const tags = Array.from(new Set([
                    ...manualTags,
                    ...(analysis?.tags || []),
                    ...(analysis?.body_focus || []),
                    ...(analysis?.accessories || []),
                    analysis?.pose,
                    analysis?.outfit,
                    analysis?.setting,
                    analysis?.explicitness,
                    analysis ? 'ai-analisada' : 'video-manual',
                ].filter(Boolean).map((tag) => String(tag).toLowerCase()))).slice(0, 30);
                const descriptionParts = [
                    manualDescription,
                    analysis?.description,
                    analysis?.visual_summary && analysis.visual_summary !== analysis.description ? analysis.visual_summary : '',
                ].filter(Boolean);
                const asset = await insertAssetCompat({
                    name: manualName || analysis?.name || file.name.replace(/\.[^.]+$/, ''),
                    description: descriptionParts.join(' — ').slice(0, 1200) || 'video cadastrado pelo painel',
                    triggers: analysis?.triggers?.join(', ') || manualTags.join(', ') || null,
                    tags,
                    stage: analysis?.suggested_stage || 'PREVIEW',
                    min_tarado: analysis?.min_tarado ?? 0,
                    max_tarado: analysis?.max_tarado ?? 100,
                    media_type: mediaType,
                    media_url: publicUrl,
                    storage_path: storagePath,
                    priority: sourceRequestId ? 10 : 0,
                    enabled: true,
                    ai_analysis: analysis,
                    analysis_status: analysis ? 'completed' : 'manual_required',
                    analysis_model: analysis?.model || null,
                    analyzed_at: analysis ? new Date().toISOString() : null,
                    source_request_id: sourceRequestId,
                });
                results.push({ filename: file.name, ok: true, asset });

                if (sourceRequestId) {
                    await updateMissingPreviewRequest(sourceRequestId, {
                        status: 'fulfilled',
                        matched_preview_id: asset.id,
                    });
                }
            } catch (analysisError: any) {
                try {
                    const fallbackTags = Array.from(new Set([...manualTags, 'foto', 'previa'])).slice(0, 20);
                    const asset = await insertAssetCompat({
                        name: manualName || file.name.replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' '),
                        description: manualDescription || `Prévia da Lari (${file.name.replace(/\.[^.]+$/, '')})`,
                        triggers: manualTags.join(', ') || null,
                        tags: fallbackTags,
                        stage: 'PREVIEW',
                        min_tarado: 20,
                        max_tarado: 100,
                        media_type: mediaType,
                        media_url: publicUrl,
                        storage_path: storagePath,
                        priority: sourceRequestId ? 10 : 0,
                        enabled: true,
                        ai_analysis: { error: String(analysisError?.message || analysisError).slice(0, 800) },
                        analysis_status: 'heuristic',
                        analysis_model: 'heuristic-fallback',
                        analyzed_at: new Date().toISOString(),
                        source_request_id: sourceRequestId,
                    });
                    results.push({ filename: file.name, ok: true, asset });
                } catch (insertError: any) {
                    await supabase.storage.from('previews').remove([storagePath]);
                    results.push({ filename: file.name, ok: false, error: insertError?.message || 'falha ao salvar catalogo' });
                }
            }
        };

        const queue = [...files];
        const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
            while (queue.length > 0) {
                const file = queue.shift();
                if (file) await processFile(file);
            }
        });
        await Promise.all(workers);

        return NextResponse.json({
            ok: results.some((result) => result.ok),
            processed: results.length,
            succeeded: results.filter((result) => result.ok).length,
            failed: results.filter((result) => !result.ok).length,
            results,
        }, { status: results.some((result) => result.ok) ? 200 : 422 });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || 'erro no upload' }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json();
        const action = String(body?.action || '');

        if (action === 'settings') {
            const primaryModel = String(body.primaryModel || DEFAULT_PREVIEW_VISION_MODEL).trim();
            const fallbackModel = String(body.fallbackModel || DEFAULT_PREVIEW_VISION_FALLBACK_MODEL).trim();
            const { error } = await supabase.from('bot_settings').upsert([
                { key: 'preview_vision_model', value: primaryModel },
                { key: 'preview_vision_fallback_model', value: fallbackModel },
            ]);
            if (error) throw error;
            return NextResponse.json({ ok: true, settings: { primaryModel, fallbackModel } });
        }

        if (action === 'request') {
            const request = await updateMissingPreviewRequest(String(body.id || ''), {
                status: body.status,
                priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : undefined,
                matched_preview_id: body.matched_preview_id || undefined,
            });
            return NextResponse.json({ ok: true, request });
        }

        const id = String(body.id || '');
        if (!id) return NextResponse.json({ error: 'id obrigatorio' }, { status: 400 });
        if (action === 'reanalyze') {
            const { data: asset, error } = await supabase.from('preview_assets').select('*').eq('id', id).single();
            if (error || !asset) return NextResponse.json({ error: 'previa nao encontrada' }, { status: 404 });
            if (asset.media_type !== 'image') return NextResponse.json({ error: 'reanálise automatica disponivel apenas para imagens' }, { status: 400 });
            const imageResponse = await fetch(asset.media_url, { signal: AbortSignal.timeout(30_000) });
            if (!imageResponse.ok) throw new Error(`imagem retornou HTTP ${imageResponse.status}`);
            const analysis = await analyzePreviewImage({
                buffer: Buffer.from(await imageResponse.arrayBuffer()),
                mimeType: imageResponse.headers.get('content-type') || 'image/jpeg',
                filename: asset.name || 'preview.jpg',
            });
            const updated = await updateAssetCompat(id, {
                name: analysis.name,
                description: analysis.description,
                triggers: analysis.triggers.join(', '),
                tags: Array.from(new Set([
                    ...analysis.tags,
                    ...analysis.body_focus,
                    ...analysis.accessories,
                    analysis.pose,
                    analysis.outfit,
                    analysis.setting,
                    analysis.explicitness,
                    'ai-analisada',
                ].filter(Boolean).map((tag) => String(tag).toLowerCase()))).slice(0, 30),
                stage: analysis.suggested_stage,
                min_tarado: analysis.min_tarado,
                max_tarado: analysis.max_tarado,
                enabled: true,
                ai_analysis: analysis,
                analysis_status: 'completed',
                analysis_model: analysis.model,
                analyzed_at: new Date().toISOString(),
            });
            return NextResponse.json({ ok: true, asset: updated });
        }

        const allowed = ['name', 'description', 'triggers', 'tags', 'stage', 'min_tarado', 'max_tarado', 'priority', 'enabled'];
        const patch = Object.fromEntries(Object.entries(body.patch || {}).filter(([key]) => allowed.includes(key)));
        const updated = await updateAssetCompat(id, patch);
        return NextResponse.json({ ok: true, asset: updated });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || 'erro ao atualizar previa' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const id = req.nextUrl.searchParams.get('id') || '';
        if (!id) return NextResponse.json({ error: 'id obrigatorio' }, { status: 400 });
        const { data: asset } = await supabase.from('preview_assets').select('storage_path').eq('id', id).maybeSingle();
        const { error } = await supabase.from('preview_assets').delete().eq('id', id);
        if (error) throw error;
        if (asset?.storage_path) await supabase.storage.from('previews').remove([asset.storage_path]);
        return NextResponse.json({ ok: true });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || 'erro ao deletar previa' }, { status: 500 });
    }
}
