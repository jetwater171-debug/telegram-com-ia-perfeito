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

        // --- DEBOUNCE V2: TOKEN BASED ---
        // Generate a unique token for this execution
        const processingToken = crypto.randomUUID();

        // Update the session with this token. This signals "I am the latest active process"
        await supabase.from('sessions').update({
            processing_token: processingToken
        }).eq('id', session.id);

        // Wait 6 seconds
        await new Promise(resolve => setTimeout(resolve, 6000));

        // Re-fetch the session to check if the token changed
        const { data: refreshedSession } = await supabase
            .from('sessions')
            .select('processing_token')
            .eq('id', session.id)
            .single();

        // If the token in DB is different from my token, it means a newer message arrived 
        // and overwrote the token. I should die.
        if (refreshedSession?.processing_token !== processingToken) {
            console.log(`[DEBOUNCE V2] process ${processingToken} superseded by ${refreshedSession?.processing_token}`);
            return NextResponse.json({ ok: true });
        }

        // I AM THE SURVIVOR!
        // Fetch all unreplied user messages

        // Find last bot message time
        const { data: lastBotMsg } = await supabase
            .from('messages')
            .select('created_at')
            .eq('session_id', session.id)
            .eq('sender', 'bot')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        const cutoffTime = lastBotMsg ? lastBotMsg.created_at : new Date(0).toISOString();

        // Fetch all user messages since last bot reply
        const { data: groupMessages } = await supabase
            .from('messages')
            .select('content')
            .eq('session_id', session.id)
            .eq('sender', 'user')
            .gt('created_at', cutoffTime)
            .order('created_at', { ascending: true });

        // Combine them
        const combinedText = groupMessages?.map(m => m.content).join("\n") || text;
        console.log(`[GROUPING V2] Sending to Gemini: ${combinedText}`);

        // --- DEBOUNCE END ---

        // 4. Check if paused
        if (session.status === 'paused') {
            return NextResponse.json({ ok: true });
        }

        // 5. Send to Gemini
        const context = {
            userCity: session.user_city || "São Paulo",
            isHighTicket: session.device_type === 'iPhone'
        };

        const aiResponse = await sendMessageToGemini(session.id, combinedText, context);

        // Update Session Stats
        if (aiResponse.lead_stats) {
            await supabase.from('sessions').update({
                lead_score: aiResponse.lead_stats,
                status: aiResponse.current_state === 'CLOSING' ? 'closed' : session.status
            }).eq('id', session.id);
        }

        // Save AI Thought to DB (Visible only in Admin)
        if (aiResponse.internal_thought) {
            await supabase.from('messages').insert({
                session_id: session.id,
                sender: 'thought', // New sender type for internal thoughts
                content: aiResponse.internal_thought
            });
        }

        // Execute Actions and Send Messages
        for (const msgText of aiResponse.messages) {
            await supabase.from('messages').insert({
                session_id: session.id,
                sender: 'bot',
                content: msgText
            });

            await sendTelegramMessage(botToken, chatId, msgText);

            await new Promise(r => setTimeout(r, 1000));
        }

        // Handle Media Actions
        if (aiResponse.action !== 'none') {
            let mediaUrl = null;
            let mediaType = null;
            let caption = "";

            const SHOWER_PHOTO = "https://i.ibb.co/dwf177Kc/download.jpg";
            const LINGERIE_PHOTO = "https://i.ibb.co/dsx5mTXQ/3297651933149867831-62034582678-jpg.jpg";
            const WET_PHOTO = "https://i.ibb.co/mrtfZbTb/fotos-de-bucetas-meladas-0.jpg";
            const VIDEO_PREVIEW = "https://bhnsfqommnjziyhvzfli.supabase.co/storage/v1/object/public/media/previews/1764694671095_isiwgk.mp4";

            switch (aiResponse.action) {
                case 'send_shower_photo':
                    mediaUrl = SHOWER_PHOTO;
                    mediaType = 'image';
                    caption = "🙈";
                    await sendTelegramPhoto(botToken, chatId, mediaUrl, caption);
                    break;
                case 'send_lingerie_photo':
                    mediaUrl = LINGERIE_PHOTO;
                    mediaType = 'image';
                    await sendTelegramPhoto(botToken, chatId, mediaUrl);
                    break;
                case 'send_wet_finger_photo':
                    mediaUrl = WET_PHOTO;
                    mediaType = 'image';
                    await sendTelegramPhoto(botToken, chatId, mediaUrl);
                    break;
                case 'send_video_preview':
                    mediaUrl = VIDEO_PREVIEW;
                    mediaType = 'video';
                    await sendTelegramVideo(botToken, chatId, mediaUrl, "Olha isso...");
                    break;
                case 'generate_pix_payment':
                    await sendTelegramMessage(botToken, chatId, "[SISTEMA: Link de pagamento Pix gerado - Integração Pendente]");
                    break;
            }

            if (mediaUrl) {
                await supabase.from('messages').insert({
                    session_id: session.id,
                    sender: 'bot',
                    content: `[MEDIA: ${aiResponse.action}]`,
                    media_url: mediaUrl,
                    media_type: mediaType
                });
            }
        }

        return NextResponse.json({ ok: true });

    } catch (error) {
        console.error("Webhook Error:", error);
        return NextResponse.json({ error: 'Error processing update' }, { status: 500 });
    }
}
