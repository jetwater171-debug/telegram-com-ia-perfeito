import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';

const STATUSES = ['awaiting_payment', 'paid', 'paid_needs_manual_review', 'in_progress', 'delivered', 'cancelled'] as const;

export async function GET() {
    const { data: rows, error } = await supabase
        .from('custom_orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(250);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const sessionIds = Array.from(new Set((rows || []).map((row: any) => row.session_id).filter(Boolean)));
    const { data: sessions } = sessionIds.length > 0
        ? await supabase.from('sessions').select('id,user_name,telegram_chat_id,total_paid').in('id', sessionIds)
        : { data: [] as any[] };
    const sessionMap = new Map((sessions || []).map((session: any) => [session.id, session]));
    return NextResponse.json({
        ok: true,
        orders: (rows || []).map((row: any) => ({ ...row, lead: sessionMap.get(row.session_id) || null })),
    });
}

export async function PATCH(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    const status = String(body?.status || '').trim();
    if (!id || !STATUSES.includes(status as typeof STATUSES[number])) {
        return NextResponse.json({ error: 'pedido ou status invalido' }, { status: 400 });
    }
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
        status,
        admin_notes: String(body?.admin_notes || '').trim().slice(0, 4_000) || null,
        updated_at: now,
    };
    if (status === 'delivered') patch.delivered_at = now;
    const { data, error } = await supabase.from('custom_orders').update(patch).eq('id', id).select('*').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, order: data });
}
