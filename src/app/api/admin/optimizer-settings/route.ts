import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';

const OPT_KEYS = [
    'auto_optimizer_enabled',
    'auto_optimizer_min_interval_min',
    'auto_optimizer_last_run',
    'auto_optimizer_last_result'
];

export async function GET() {
    const { data, error } = await supabase
        .from('bot_settings')
        .select('key,value')
        .in('key', OPT_KEYS);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const settings = Object.fromEntries((data || []).map((d: any) => [d.key, d.value]));
    return NextResponse.json({ settings });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const enabled = body?.enabled === true;
        const minInterval = Number(body?.minInterval ?? 60);

        const { error } = await supabase.from('bot_settings').upsert([
            { key: 'auto_optimizer_enabled', value: enabled ? 'true' : 'false' },
            { key: 'auto_optimizer_min_interval_min', value: String(minInterval) }
        ]);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'error' }, { status: 500 });
    }
}
