import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';

export async function GET() {
    const [tokenResult, usernameResult] = await Promise.all([
        supabase.from('bot_settings').select('value').eq('key', 'telegram_bot_token').single(),
        supabase.from('bot_settings').select('value').eq('key', 'telegram_bot_username').single()
    ]);

    const token = tokenResult.data?.value ? String(tokenResult.data.value).trim() : (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    let username = usernameResult.data?.value ? String(usernameResult.data.value).trim() : '';

    return NextResponse.json({ token, username });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const token = String(body?.token || '').trim();
        if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

        let botUsername = '';
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
                cache: 'no-store',
                signal: controller.signal
            }).finally(() => clearTimeout(timeout));

            if (res.ok) {
                const json = await res.json();
                if (json.ok && json.result?.username) {
                    botUsername = String(json.result.username).replace(/^@/, '').trim();
                }
            }
        } catch (err) {
            console.error('[ADMIN BOT SETTINGS] Failed to verify token with Telegram getMe:', err);
        }

        const rows: { key: string; value: string }[] = [
            { key: 'telegram_bot_token', value: token }
        ];
        if (botUsername) {
            rows.push({ key: 'telegram_bot_username', value: botUsername });
        }

        const { error } = await supabase.from('bot_settings').upsert(rows);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, username: botUsername });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'error' }, { status: 500 });
    }
}
