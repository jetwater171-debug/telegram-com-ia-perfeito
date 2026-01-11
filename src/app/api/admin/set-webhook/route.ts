import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { appUrl } = body;

        if (!appUrl) return NextResponse.json({ error: 'App URL missing' }, { status: 400 });

        // 1. Get Token
        const { data: tokenData } = await supabase.from('bot_settings').select('value').eq('key', 'telegram_bot_token').single();
        const botToken = tokenData?.value;

        if (!botToken) {
            return NextResponse.json({ error: 'Token not found in DB' }, { status: 400 });
        }

        // 2. Call Telegram API
        const webhookUrl = `${appUrl}/api/telegram`;
        const tgUrl = `https://api.telegram.org/bot${botToken}/setWebhook?url=${webhookUrl}`;

        console.log("Setting webhook to:", webhookUrl);

        const res = await fetch(tgUrl);
        const data = await res.json();

        return NextResponse.json(data);

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
