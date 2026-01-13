import { NextRequest, NextResponse, after } from 'next/server';
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

    if (!message) {
        return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id.toString();

    // Extract Text OR Video File ID
    let text = message.text;

    // 0. Detect Audio/Voice
    if (message.voice) {
        text = `[AUDIO_UUID: ${message.voice.file_id}]`;
    } else if (message.audio) {
        text = `[AUDIO_UUID: ${message.audio.file_id}]`;
    }

    if (message.video) {
        text = `[VIDEO_UPLOAD] File_ID: ${message.video.file_id}`;
    }

    if (!text) {
        return NextResponse.json({ ok: true });
    }
    const senderName = message.from.first_name || "Desconhecido";

    // 0. Detect Audio/Voice



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
            return NextResponse.json({ ok: true });
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

        // 3.5. Reset Reengagement Flag & Update Timestamp
        // Quando o usuário fala, o bot não precisa mais cobrar.
        await supabase.from('sessions').update({
            reengagement_sent: false,
            // Opcional: last_user_activity aqui se quiséssemos trackear
        }).eq('id', session.id);

        // 3. Save User Message
        const { data: insertedMsg } = await supabase.from('messages').insert({
            session_id: session.id,
            sender: 'user',
            content: text
        }).select().single();

        if (!insertedMsg) return NextResponse.json({ ok: true });

        // 4. Trigger Background Processing (Reliable with `after`)
        const protocol = req.headers.get('x-forwarded-proto') || 'http';
        const host = req.headers.get('host');
        const workerUrl = `${protocol}://${host}/api/process-message`;

        console.log(`[WEBHOOK] Scheduling worker at ${workerUrl}`);

        after(async () => {
            console.log(`[WEBHOOK] Executing background worker trigger...`);
            try {
                await fetch(workerUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId: session.id,
                        triggerMessageId: insertedMsg.id
                    })
                });
            } catch (err) {
                console.error("Worker trigger failed:", err);
            }
        });

        return NextResponse.json({ ok: true });

    } catch (error) {
        console.error("Webhook Error:", error);
        return NextResponse.json({ error: 'Error processing update' }, { status: 500 });
    }
}
