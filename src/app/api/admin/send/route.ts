import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';
import { sendTelegramMessage } from '@/lib/telegram';

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { chatId, text } = body;

    // 0. Fetch Bot Token
    const { data: tokenData } = await supabase
        .from('bot_settings')
        .select('value')
        .eq('key', 'telegram_bot_token')
        .single();

    const botToken = tokenData?.value;
    if (!botToken) {
        return NextResponse.json({ error: 'Bot Token not configured' }, { status: 400 });
    }

    // 1. Get Session ID
    const { data: session } = await supabase.from('sessions').select('id, status').eq('telegram_chat_id', chatId).single();

    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    // 2. Send to Telegram
    await sendTelegramMessage(botToken, chatId, text);

    // 3. Save to DB
    await supabase.from('messages').insert({
        session_id: session.id,
        sender: 'admin',
        content: text
    });

    // 4. Ensure bot is paused
    if (session.status !== 'paused') {
        await supabase.from('sessions').update({ status: 'paused' }).eq('id', session.id);
    }

    return NextResponse.json({ ok: true });
}
