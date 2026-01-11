import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';
import { sendMessageToGemini } from '@/lib/gemini';
import { sendTelegramMessage, sendTelegramPhoto, sendTelegramVideo } from '@/lib/telegram';

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
        await supabase.from('messages').insert({
            session_id: session.id,
            sender: 'user',
            content: text
        });

        // 4. Check if paused
        if (session.status === 'paused') {
            return NextResponse.json({ ok: true });
        }

        // 5. Send to Gemini
        const context = {
            userCity: session.user_city || "São Paulo",
            isHighTicket: session.device_type === 'iPhone'
        };

        const aiResponse = await sendMessageToGemini(session.id, text, context);

        // Update Session Stats
        if (aiResponse.lead_stats) {
            await supabase.from('sessions').update({
                lead_score: aiResponse.lead_stats,
                status: aiResponse.current_state === 'CLOSING' ? 'closed' : session.status
            }).eq('id', session.id);
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
