import { NextRequest, NextResponse } from 'next/server';
import { getSystemInstruction } from '@/lib/gemini';
import { supabaseServer as supabase } from '@/lib/supabaseServer';

export const maxDuration = 90;

export async function GET(req: NextRequest) {
    if (req.nextUrl.searchParams.get('key') !== process.env.VERCEL_GIT_COMMIT_SHA) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const { data } = await supabase.from('bot_settings')
        .select('key,value')
        .in('key', ['nvidia_api_key', 'nvidia_model']);
    const settings = Object.fromEntries((data || []).map((row: any) => [row.key, row.value || '']));
    const apiKey = String(settings.nvidia_api_key || process.env.NVIDIA_API_KEY || '').trim();
    if (!apiKey) return NextResponse.json({ ok: false, error: 'nvidia_key_missing' });

    const model = String(settings.nvidia_model || 'deepseek-ai/deepseek-v4-pro-0813');
    const systemInstruction = getSystemInstruction('', '', false, 0, {
        tarado: 25, carente: 25, sentimental: 20, financeiro: 15,
    });
    const startedAt = Date.now();
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(55_000),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemInstruction },
                { role: 'user', content: 'Oi, tudo bem? Responda usando o contrato completo pedido no prompt.' },
            ],
            response_format: { type: 'json_object' },
            chat_template_kwargs: { thinking: false },
            temperature: 0.85,
            max_tokens: 1_400,
            stream: false,
        }),
    });
    const raw = await response.text();
    let payload: any = null;
    try { payload = JSON.parse(raw); } catch { /* diagnostic only */ }
    const content = String(payload?.choices?.[0]?.message?.content || '');
    let parsed: any = null;
    try { parsed = JSON.parse(content); } catch { /* reported below */ }

    return NextResponse.json({
        ok: response.ok && Boolean(content),
        status: response.status,
        model: String(payload?.model || model),
        durationMs: Date.now() - startedAt,
        promptChars: systemInstruction.length,
        outputChars: content.length,
        jsonValid: Boolean(parsed && typeof parsed === 'object'),
        messageCount: Array.isArray(parsed?.messages) ? parsed.messages.filter(Boolean).length : 0,
        finishReason: payload?.choices?.[0]?.finish_reason || null,
        error: response.ok ? null : raw.slice(0, 500),
    });
}
