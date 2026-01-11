import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';
import { sendMessageToGemini } from '@/lib/gemini';
import { sendTelegramMessage, sendTelegramPhoto, sendTelegramVideo } from '@/lib/telegram';

export async function GET(req: NextRequest) {
    // DIAGNOSTIC ROUTE
    const checks = {
        supabaseConfig: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        geminiConfig: !!process.env.GEMINI_API_KEY,
        dbConnection: false,
        tokenFound: false,
        webhookUrl: req.nextUrl.toString().replace('GET', 'POST') // Approximate
    };

    try {
        const { data, error } = await supabase.from('bot_settings').select('*').limit(1);
        if (!error) checks.dbConnection = true;

        const { data: token } = await supabase.from('bot_settings').select('value').eq('key', 'telegram_bot_token').single();
        let webhookInfo = null;

        if (token && token.value) {
            checks.tokenFound = true;
            // CHECK TELEGRAM API STATUS
            try {
                const tgRes = await fetch(`https://api.telegram.org/bot${token.value}/getWebhookInfo`);
                webhookInfo = await tgRes.json();
            } catch (err: any) {
                webhookInfo = { error: err.message };
            }
        }

        return NextResponse.json({ status: 'Online', checks, webhookInfo }, { status: 200 });
    } catch (e: any) {
        return NextResponse.json({ status: 'Error', error: e.message, checks }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const message = body.message || body.edited_message;

    if (!message || !message.text) {
        return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id.toString();
    const text = message.text;
    const senderName = message.from.first_name || "Desconhecido";

    try {
        // 0. Fetch Bot Token
        const { data: tokenData } = await supabase
            .from('bot_settings')
            .select('value')
            .eq('key', 'telegram_bot_token')
            .single();

        const botToken = tokenData?.value;
        if (!botToken) {
            console.error("Bot Token not configured in DB");
            return NextResponse.json({ ok: true }); // Silent fail to avoid retries spam
        }

        // 2. Get or Create Session
        let { data: session, error } = await supabase
            .from('sessions')
            .select('*')
            .eq('telegram_chat_id', chatId)
            .single();

        if (error || !session) {
            console.log("Creating new session for", chatId);
            const { data: newSession, error: createError } = await supabase
                .from('sessions')
                .insert([{
                    telegram_chat_id: chatId,
                    user_city: "São Paulo",
                    device_type: "Unknown",
                    user_name: senderName,
                    status: 'active'
                }])
                .select()
                .single();

            if (createError) {
                console.error("Failed to create session", createError);
                return NextResponse.json({ error: 'DB Error' }, { status: 500 });
            }
            session = newSession;
        }

        // 3. Save User Message
        const { data: insertedMsg } = await supabase.from('messages').insert({
            session_id: session.id,
            sender: 'user',
            content: text
        }).select().single();

        if (!insertedMsg) return NextResponse.json({ ok: true });

        // 4. Trigger Background Processing (Fire and Forget)
        // We do NOT await this request fully, or we await the handshake but not the response?
        // In Vercel, to be safe, we must return 200 OK to Telegram immediately.
        // We will try to rely on the fact that Vercel might keep the outgoing request alive 
        // if we initiate it. 

        // Get the absolute URL for the worker
        const protocol = req.headers.get('x-forwarded-proto') || 'http';
        const host = req.headers.get('host');
        const workerUrl = `${protocol}://${host}/api/process-message`;

        console.log(`[WEBHOOK] Triggering worker at ${workerUrl}`);

        fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: session.id,
                triggerMessageId: insertedMsg.id
            })
        }).catch(err => console.error("Worker trigger failed (expected if non-awaited):", err));

        // Return immediately so Telegram sends next updates if any
        return NextResponse.json({ ok: true });

    } catch (error) {
        console.error("Webhook Error:", error);
        return NextResponse.json({ error: 'Error processing update' }, { status: 500 });
    }
}
