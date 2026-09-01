import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import {
    DEFAULT_FULL_SYSTEM_INSTRUCTION_TEMPLATE,
    hasFullSystemInstructionTemplate,
    normalizeSystemInstructionTemplate,
    REQUIRED_SYSTEM_INSTRUCTION_TOKENS,
    SYSTEM_INSTRUCTION_BLOCK_KEY,
    SYSTEM_INSTRUCTION_BLOCK_LABEL,
} from '@/lib/systemInstructionEditor';

export const dynamic = 'force-dynamic';

type ContentType = 'blocks' | 'variants' | 'system-instruction';
const validType = (value: string | null): value is ContentType => value === 'blocks' || value === 'variants' || value === 'system-instruction';
const clean = (value: unknown, max: number) => String(value || '').replace(/\r\n/g, '\n').trim().slice(0, max);
const uuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(value || '')) ? String(value) : '';

const payloadFor = (type: ContentType, body: Record<string, unknown>) => {
    const content = clean(body.content, type === 'system-instruction' ? 60_000 : 30_000);
    if (!content) throw new Error('conteudo_obrigatorio');
    if (type === 'system-instruction') {
        return {
            key: SYSTEM_INSTRUCTION_BLOCK_KEY,
            label: SYSTEM_INSTRUCTION_BLOCK_LABEL,
            content,
            enabled: true,
            updated_at: new Date().toISOString(),
        };
    }
    if (type === 'blocks') {
        const key = clean(body.key, 120).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        if (!key) throw new Error('key_obrigatoria');
        if (key === SYSTEM_INSTRUCTION_BLOCK_KEY) throw new Error('key_reservada_para_instrucao_principal');
        return { key, label: clean(body.label, 160) || null, content, enabled: body.enabled !== false, updated_at: new Date().toISOString() };
    }
    const allowedStages = new Set(['WELCOME', 'CONNECTION', 'TRIGGER_PHASE', 'HOT_TALK', 'PREVIEW', 'SALES_PITCH', 'NEGOTIATION', 'CLOSING', 'PAYMENT_CHECK']);
    const stage = clean(body.stage, 80).toUpperCase();
    if (!allowedStages.has(stage)) throw new Error('etapa_invalida');
    return {
        stage,
        label: clean(body.label, 160) || null,
        content,
        enabled: body.enabled !== false,
        weight: Math.max(0.1, Math.min(100, Number(body.weight) || 1)),
        updated_at: new Date().toISOString(),
    };
};

export async function GET(request: NextRequest) {
    const type = request.nextUrl.searchParams.get('type');
    if (!validType(type)) return NextResponse.json({ error: 'tipo_invalido' }, { status: 400 });
    if (type === 'system-instruction') {
        const [{ data, error }, auxiliaryResult] = await Promise.all([
            supabase
                .from('prompt_blocks')
                .select('id, key, label, content, enabled, updated_at')
                .eq('key', SYSTEM_INSTRUCTION_BLOCK_KEY)
                .maybeSingle(),
            supabase
                .from('prompt_blocks')
                .select('key,label,content,enabled,updated_at')
                .eq('enabled', true)
                .neq('key', 'auto_optimizer')
                .neq('key', SYSTEM_INSTRUCTION_BLOCK_KEY)
                .order('updated_at', { ascending: false })
                .limit(100),
        ]);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (auxiliaryResult.error) return NextResponse.json({ error: auxiliaryResult.error.message }, { status: 500 });
        const legacyAuxiliaryText = (auxiliaryResult.data || [])
            .map((block) => {
                const key = String(block.key || 'bloco');
                const label = String(block.label || key);
                const content = String(block.content || '').trim();
                return content ? `## ${label} (${key})\n${content}` : '';
            })
            .filter(Boolean)
            .join('\n\n');
        let content = normalizeSystemInstructionTemplate(data?.content);
        if (!hasFullSystemInstructionTemplate(data?.content) && legacyAuxiliaryText) {
            content = content.replace(
                '{{BACKEND_STATE}}',
                `### BLOCOS AUXILIARES EXISTENTES — agora editáveis neste documento\n${legacyAuxiliaryText}\n\n{{BACKEND_STATE}}`,
            );
        }
        return NextResponse.json({
            key: SYSTEM_INSTRUCTION_BLOCK_KEY,
            label: SYSTEM_INSTRUCTION_BLOCK_LABEL,
            content,
            defaultContent: DEFAULT_FULL_SYSTEM_INSTRUCTION_TEMPLATE,
            requiredTokens: REQUIRED_SYSTEM_INSTRUCTION_TOKENS,
            hasOverride: Boolean(data?.content),
            updated_at: data?.updated_at || null,
        }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const table = type === 'blocks' ? 'prompt_blocks' : 'prompt_variants';
    let query = supabase.from(table).select('*').order('updated_at', { ascending: false });
    if (type === 'blocks') query = query.neq('key', 'auto_optimizer').neq('key', SYSTEM_INSTRUCTION_BLOCK_KEY);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ items: data || [] }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const type = String(body.type || '');
        if (!validType(type)) return NextResponse.json({ error: 'tipo_invalido' }, { status: 400 });
        const payload = payloadFor(type, body);
        const result = type === 'blocks' || type === 'system-instruction'
            ? await supabase.from('prompt_blocks').upsert(payload as Extract<typeof payload, { key: string }>, { onConflict: 'key' }).select('*').single()
            : await supabase.from('prompt_variants').insert(payload as Extract<typeof payload, { stage: string }>).select('*').single();
        if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
        return NextResponse.json({ ok: true, item: result.data });
    } catch (error: any) {
        return NextResponse.json({ error: String(error?.message || error) }, { status: 400 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const type = String(body.type || '');
        if (type === 'system-instruction') return NextResponse.json({ error: 'use_post_for_system_instruction' }, { status: 400 });
        const id = uuid(body.id);
        if (!validType(type) || !id) return NextResponse.json({ error: 'requisicao_invalida' }, { status: 400 });
        const table = type === 'blocks' ? 'prompt_blocks' : 'prompt_variants';
        const payload = payloadFor(type, body);
        const { data, error } = await supabase.from(table).update(payload).eq('id', id).select('*').single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, item: data });
    } catch (error: any) {
        return NextResponse.json({ error: String(error?.message || error) }, { status: 400 });
    }
}

export async function DELETE(request: NextRequest) {
    const type = request.nextUrl.searchParams.get('type');
    if (type === 'system-instruction') {
        const { error } = await supabase.from('prompt_blocks').delete().eq('key', SYSTEM_INSTRUCTION_BLOCK_KEY);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, restoredDefault: true });
    }
    const id = uuid(request.nextUrl.searchParams.get('id'));
    if (!validType(type) || !id) return NextResponse.json({ error: 'requisicao_invalida' }, { status: 400 });
    const table = type === 'blocks' ? 'prompt_blocks' : 'prompt_variants';
    let query = supabase.from(table).delete().eq('id', id);
    if (type === 'blocks') query = query.neq('key', SYSTEM_INSTRUCTION_BLOCK_KEY);
    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
