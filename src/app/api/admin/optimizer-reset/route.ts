import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';

const RESET_KEYS = [
    'auto_optimizer_stage',
    'auto_optimizer_paid_offset',
    'auto_optimizer_unpaid_offset',
    'auto_optimizer_paid_summary',
    'auto_optimizer_unpaid_summary',
    'auto_optimizer_last_run',
    'auto_optimizer_last_result'
];

export async function POST() {
    try {
        const payload = RESET_KEYS.map((key) => ({ key, value: '' }));
        const { error } = await supabase.from('bot_settings').upsert(payload);
        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'error' }, { status: 500 });
    }
}
