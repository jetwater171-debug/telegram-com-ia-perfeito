import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';

export async function GET() {
    const { data, error } = await supabase
        .from('bot_settings')
        .select('value')
        .eq('key', 'telegram_bot_token')
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ token: data?.value || '' });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const token = String(body?.token || '').trim();
        if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

        const { error } = await supabase.from('bot_settings').upsert({
            key: 'telegram_bot_token',
            value: token
        });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'error' }, { status: 500 });
    }
}
