const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = require('@google/genai');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local'), quiet: true });

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=') || 'true'];
}));

const supabaseUrl = args.url || process.env.REANALYZE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = args.key || process.env.REANALYZE_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const limit = Math.max(1, Math.min(100, Number(args.limit || 100)));
const onlyMissing = args.all !== 'true';

if (!supabaseUrl || !supabaseKey) throw new Error('Supabase URL/key ausentes');

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

const cleanText = (value, max = 700) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanList = (value, max = 20) => Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, 100).toLowerCase())
    .filter(Boolean))).slice(0, max);
const clamp = (value, min, max, fallback) => Number.isFinite(Number(value))
    ? Math.min(max, Math.max(min, Number(value)))
    : fallback;
const normalizeKeyword = (value) => cleanText(value, 80).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const parseJson = (value) => {
    const raw = String(value || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return JSON.parse(raw); } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('resposta visual sem JSON');
        return JSON.parse(match[0]);
    }
};

const normalizeAnalysis = (input, model) => {
    const explicitness = ['safe', 'suggestive', 'nude', 'explicit'].includes(input?.explicitness)
        ? input.explicitness
        : 'suggestive';
    const fallbackSensuality = explicitness === 'explicit' ? 'explicit'
        : explicitness === 'nude' ? 'hot'
            : explicitness === 'suggestive' ? 'sensual' : 'casual';
    const sensuality = ['casual', 'sensual', 'hot', 'explicit'].includes(input?.sensuality_level)
        ? input.sensuality_level
        : fallbackSensuality;
    const minTarado = Math.round(clamp(input?.min_tarado, 0, 100, sensuality === 'casual' ? 0 : 25));
    const periods = cleanList(input?.time_compatibility, 5)
        .map(normalizeKeyword)
        .filter((item) => ['madrugada', 'manha', 'tarde', 'noite', 'qualquer'].includes(item));
    const tags = cleanList(input?.tags, 25);
    if (!tags.includes('lari')) tags.unshift('lari');
    return {
        name: cleanText(input?.name, 100) || 'Prévia da Lari',
        description: cleanText(input?.description, 700) || cleanText(input?.visual_summary, 700),
        visual_summary: cleanText(input?.visual_summary, 700) || cleanText(input?.description, 700),
        pose: cleanText(input?.pose, 140),
        camera_angle: cleanText(input?.camera_angle, 100),
        framing: cleanText(input?.framing, 100),
        outfit: cleanText(input?.outfit, 180),
        accessories: cleanList(input?.accessories, 10),
        setting: cleanText(input?.setting, 160),
        expression: cleanText(input?.expression, 140),
        plausible_as_recent: input?.plausible_as_recent !== false,
        moment_context: cleanText(input?.moment_context, 220),
        time_compatibility: periods.length ? periods : ['qualquer'],
        explicitness,
        sensuality_level: sensuality,
        lighting: ['daylight', 'night', 'indoor', 'neutral'].includes(input?.lighting) ? input.lighting : 'neutral',
        conversation_contexts: cleanList(input?.conversation_contexts, 12),
        send_when: cleanText(input?.send_when, 320),
        avoid_when: cleanList(input?.avoid_when, 12),
        body_focus: cleanList(input?.body_focus, 10),
        tags,
        triggers: cleanList(input?.triggers, 20),
        suggested_stage: ['TRIGGER_PHASE', 'HOT_TALK', 'PREVIEW', 'SALES_PITCH', 'CLOSING'].includes(input?.suggested_stage)
            ? input.suggested_stage : 'PREVIEW',
        min_tarado: minTarado,
        max_tarado: Math.round(clamp(input?.max_tarado, minTarado, 100, 100)),
        confidence: clamp(input?.confidence, 0, 1, 0.85),
        model,
    };
};

const promptSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'lib', 'previewVision.ts'), 'utf8');
const promptStart = promptSource.indexOf('const prompt = `');
const promptEnd = promptSource.indexOf('`;\n\n    // 1.', promptStart);
if (promptStart < 0 || promptEnd < 0) throw new Error('prompt visual não encontrado');
const prompt = promptSource.slice(promptStart + 'const prompt = `'.length, promptEnd);

const analyzeWithOpenRouter = async ({ buffer, mimeType }) => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return null;
    for (const model of ['google/gemini-3.8-flash', 'google/gemini-3.7-flash', 'google/gemini-3.6-flash']) {
        try {
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                signal: AbortSignal.timeout(45_000),
                headers: {
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://lari-telegram-ia-v2.vercel.app',
                    'X-Title': 'Lari Preview Catalog Reanalysis',
                },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` } },
                    ] }],
                    temperature: 0.1,
                    max_tokens: 1800,
                    response_format: { type: 'json_object' },
                    provider: { allow_fallbacks: false },
                }),
            });
            if (!response.ok) continue;
            const payload = await response.json();
            const content = payload?.choices?.[0]?.message?.content;
            if (content) return normalizeAnalysis(parseJson(content), String(payload?.model || model));
        } catch { /* tenta próximo provider */ }
    }
    return null;
};

const analyzeWithGemini = async ({ buffer, mimeType }) => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return null;
    const genAI = new GoogleGenAI({ apiKey: key });
    const safetySettings = Object.values(HarmCategory).filter((value) => typeof value === 'string').map((category) => ({
        category,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    }));
    for (const modelName of ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']) {
        try {
            const result = await genAI.models.generateContent({
                model: modelName,
                contents: [{ role: 'user', parts: [
                    { text: prompt },
                    { inlineData: { mimeType, data: buffer.toString('base64') } },
                ] }],
                config: {
                    safetySettings,
                    responseMimeType: 'application/json',
                    maxOutputTokens: 1800,
                    temperature: 0.1,
                    httpOptions: { timeout: 45_000, retryOptions: { attempts: 1 } },
                },
            });
            const content = result.text;
            if (content) return normalizeAnalysis(parseJson(content), `${modelName}-direct`);
        } catch { /* tenta próximo modelo */ }
    }
    return null;
};

const heuristic = (asset) => {
    const searchable = normalizeKeyword(`${asset.name} ${asset.description} ${(asset.tags || []).join(' ')}`);
    const explicitness = /sexo|penetracao|masturb|buceta/.test(searchable) ? 'explicit'
        : /nua|nu |pelada|sem roupa|seios/.test(searchable) ? 'nude'
            : /sensual|lingerie|calcinha|decote|leite/.test(searchable) ? 'suggestive' : 'safe';
    const sensuality = explicitness === 'explicit' ? 'explicit' : explicitness === 'nude' ? 'hot' : explicitness === 'suggestive' ? 'sensual' : 'casual';
    const bed = /cama|deitad|quarto/.test(searchable);
    return normalizeAnalysis({
        name: asset.name,
        description: asset.description,
        visual_summary: asset.description || asset.name,
        pose: bed ? 'deitada na cama' : 'pose espontânea',
        setting: bed ? 'quarto e cama' : 'ambiente interno',
        outfit: explicitness === 'nude' || explicitness === 'explicit' ? 'nua ou cobrindo o corpo' : 'roupa visível',
        plausible_as_recent: true,
        moment_context: bed ? 'momento deitada no quarto' : 'foto espontânea',
        time_compatibility: bed ? ['noite', 'madrugada', 'manha'] : ['qualquer'],
        explicitness,
        sensuality_level: sensuality,
        lighting: bed ? 'indoor' : 'neutral',
        conversation_contexts: sensuality === 'casual' ? ['casual_chat', 'first_contact'] : sensuality === 'sensual' ? ['flirting', 'preview'] : ['hot_talk', 'explicit_request'],
        send_when: 'quando o pedido e a intensidade da conversa combinarem com a foto',
        avoid_when: sensuality === 'casual' ? [] : ['first_contact', 'casual_chat'],
        tags: asset.tags || [],
        triggers: String(asset.triggers || '').split(',').map((item) => item.trim()).filter(Boolean),
        min_tarado: sensuality === 'casual' ? 0 : sensuality === 'sensual' ? 20 : 45,
        max_tarado: 100,
        confidence: 0.55,
    }, 'heuristic-catalog-reanalysis');
};

const main = async () => {
    const { data, error } = await supabase.from('preview_assets').select('*').order('priority', { ascending: false });
    if (error) throw error;
    const images = (data || []).filter((asset) => (asset.media_type === 'image' || asset.media_type === 'photo' || !asset.media_type) && asset.media_url);
    const queue = images.filter((asset) => !onlyMissing || !asset.ai_analysis?.sensuality_level).slice(0, limit);
    console.log(`REANALYZE_START total=${images.length} queue=${queue.length}`);
    let completed = 0;
    let heuristicCount = 0;
    let failed = 0;
    for (const asset of queue) {
        try {
            const imageResponse = await fetch(asset.media_url, { signal: AbortSignal.timeout(30_000) });
            if (!imageResponse.ok) throw new Error(`imagem HTTP ${imageResponse.status}`);
            const buffer = Buffer.from(await imageResponse.arrayBuffer());
            const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
            let analysis = await analyzeWithOpenRouter({ buffer, mimeType });
            if (!analysis) analysis = await analyzeWithGemini({ buffer, mimeType });
            if (!analysis) {
                analysis = heuristic(asset);
                heuristicCount += 1;
            }
            const tags = Array.from(new Set([
                ...analysis.tags,
                ...analysis.body_focus,
                ...analysis.accessories,
                analysis.pose,
                analysis.outfit,
                analysis.setting,
                analysis.explicitness,
                analysis.sensuality_level,
                'ai-analisada',
            ].filter(Boolean).map((tag) => String(tag).toLowerCase()))).slice(0, 30);
            const update = await supabase.from('preview_assets').update({
                name: analysis.name,
                description: analysis.description,
                triggers: analysis.triggers.join(', '),
                tags,
                stage: analysis.suggested_stage,
                min_tarado: analysis.min_tarado,
                max_tarado: analysis.max_tarado,
                enabled: true,
                ai_analysis: analysis,
                analysis_status: analysis.model === 'heuristic-catalog-reanalysis' ? 'heuristic' : 'completed',
                analysis_model: analysis.model,
                analyzed_at: new Date().toISOString(),
            }).eq('id', asset.id).select('id,name,analysis_status,analysis_model,ai_analysis').single();
            if (update.error) throw update.error;
            completed += 1;
            console.log(`REANALYZE_ITEM ok=${asset.id} mode=${update.data.analysis_status} level=${analysis.sensuality_level} periods=${analysis.time_compatibility.join('|')}`);
        } catch (error) {
            failed += 1;
            console.error(`REANALYZE_ITEM failed=${asset.id} error=${cleanText(error?.message || error, 180)}`);
        }
    }
    const { data: verified, error: verifyError } = await supabase.from('preview_assets')
        .select('id,analysis_status,analysis_model,analyzed_at,ai_analysis')
        .in('id', queue.map((asset) => asset.id));
    if (verifyError) throw verifyError;
    const valid = (verified || []).filter((asset) => asset.ai_analysis?.sensuality_level
        && Array.isArray(asset.ai_analysis?.time_compatibility)
        && Array.isArray(asset.ai_analysis?.conversation_contexts)).length;
    console.log(`REANALYZE_DONE completed=${completed} heuristic=${heuristicCount} failed=${failed} verified=${valid}/${queue.length}`);
    if (failed > 0 || valid !== queue.length) process.exitCode = 1;
};

main().catch((error) => {
    console.error(`REANALYZE_FATAL ${cleanText(error?.message || error, 300)}`);
    process.exit(1);
});
