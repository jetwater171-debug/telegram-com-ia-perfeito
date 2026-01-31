import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';

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
        const caption = message.caption ? ` CAPTION: ${message.caption}` : '';
        text = `[VIDEO_UPLOAD] File_ID: ${message.video.file_id}${caption}`;
    }

    if (message.photo && message.photo.length > 0) {
        // Telegram envia várias resoluções. A última é a maior.
        const largestPhoto = message.photo[message.photo.length - 1];
        const caption = message.caption ? ` CAPTION: ${message.caption}` : '';
        text = `[PHOTO_UPLOAD] File_ID: ${largestPhoto.file_id}${caption}`;
    }

    if (!text) {
        return NextResponse.json({ ok: true });
    }
    let senderName = message.from.first_name || "Desconhecido";

    // CHECK FOR OP KAIQUE
    if (text && (
        text.trim().toLowerCase().startsWith('/start opkaique') ||
        text.trim().toLowerCase().startsWith('start opkaique')
    )) {
        senderName = `${senderName} (operação kaique)`;
    }

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
                    user_city: null,
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
        // ATUALIZAMOS 'last_bot_activity_at' para AGORA para impedir que o cron dispare
        // enquanto a IA ainda está pensando (o que causava o bug de duplicidade).
        const nowIso = new Date().toISOString();
        await supabase.from('sessions').update({
            reengagement_sent: false,
            last_bot_activity_at: nowIso,
            last_message_at: nowIso
        }).eq('id', session.id);

        // ATUALIZAÇÃO PARA OPERAÇÃO KAIQUE (Mesmo se usuário já existir)
        if (text && (
            text.trim().toLowerCase().startsWith('/start opkaique') ||
            text.trim().toLowerCase().startsWith('start opkaique')
        )) {
            if (!session.user_name?.toLowerCase().includes('(operação kaique)')) {
                const newName = `${session.user_name} (operação kaique)`;
                await supabase.from('sessions').update({ user_name: newName }).eq('id', session.id);
                session.user_name = newName;
            }
        }

        // 3. Save User Message
        const { data: insertedMsg } = await supabase.from('messages').insert({
            session_id: session.id,
            sender: 'user',
            content: text
        }).select().single();

        if (!insertedMsg) return NextResponse.json({ ok: true });

        if (session.status && session.status !== 'active') {
            return NextResponse.json({ ok: true, status: 'paused' });
        }

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
