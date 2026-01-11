import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';
import { sendMessageToGemini } from '@/lib/gemini';
import { sendTelegramMessage, sendTelegramPhoto, sendTelegramVideo } from '@/lib/telegram';

// This route acts as a background worker.
// It waits, checks for newer messages (debounce), and then processes the response.
// It is called by the main Webhook but MUST NOT delay the webhook response.

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { sessionId } = body;

    console.log(`[PROCESSOR] Started for session ${sessionId}`);

    // CONFIG: Wait time
    const WAIT_TIME_MS = 6000;

    // 1. Wait (Debounce Delay)
    await new Promise(resolve => setTimeout(resolve, WAIT_TIME_MS));

    // 2. Check for newer messages
    // Logic: If there is any user message in this session created AFTER the specific message that triggered this? 
    // Actually, simple check: Get the LATEST user message.
    // We don't have the "Trigger Message ID" passed here, but we can assume we are processing "The Latest".
    // If we are NOT checking a specific ID, multiple workers might run?
    // Let's passed the `triggerMessageId` in the body for precision.

    const triggerMessageId = body.triggerMessageId;

    const { data: latestMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('session_id', sessionId)
        .eq('sender', 'user')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (latestMsg && triggerMessageId) {
        const latestIdStr = String(latestMsg.id);
        const triggerIdStr = String(triggerMessageId);

        if (latestIdStr !== triggerIdStr) {
            console.log(`[PROCESSOR] Aborting. Triggered by ${triggerIdStr} but latest is ${latestIdStr}`);
            // This means a newer message arrived and spawned its own worker. We die.
            return NextResponse.json({ status: 'superseded' });
        }
    }

    // 3. I am the Latest/Master. Process Everything.

    // Fetch Session Data
    const { data: session } = await supabase.from('sessions').select('*').eq('id', sessionId).single();
    if (!session) return NextResponse.json({ error: 'Session not found' });

    // Fetch Token (for sending msg)
    const { data: tokenData } = await supabase
        .from('bot_settings')
        .select('value')
        .eq('key', 'telegram_bot_token')
        .single();

    const botToken = tokenData?.value;
    if (!botToken) return NextResponse.json({ error: 'No token' });

    // Identify Context (Unreplied Messages)
    // Find last bot message time
    const { data: lastBotMsg } = await supabase
        .from('messages')
        .select('created_at')
        .eq('session_id', sessionId)
        .eq('sender', 'bot')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    const cutoffTime = lastBotMsg ? lastBotMsg.created_at : new Date(0).toISOString();

    // Fetch grouped messages
    const { data: groupMessages } = await supabase
        .from('messages')
        .select('content')
        .eq('session_id', sessionId)
        .eq('sender', 'user')
        .gt('created_at', cutoffTime)
        .order('created_at', { ascending: true });

    if (!groupMessages || groupMessages.length === 0) {
        console.log("[PROCESSOR] No messages to process?");
        return NextResponse.json({ status: 'done' });
    }

    const combinedText = groupMessages.map(m => m.content).join("\n");
    console.log(`[PROCESSOR] Sending to Gemini: ${combinedText}`);

    // 4. Call Gemini
    const context = {
        userCity: session.user_city || "São Paulo",
        isHighTicket: session.device_type === 'iPhone'
    };

    const aiResponse = await sendMessageToGemini(session.id, combinedText, context);

    // 5. Update Stats & Save Thoughts
    if (aiResponse.lead_stats) {
        await supabase.from('sessions').update({
            lead_score: aiResponse.lead_stats,
            status: aiResponse.current_state === 'CLOSING' ? 'closed' : session.status
        }).eq('id', session.id);
    }

    if (aiResponse.internal_thought) {
        await supabase.from('messages').insert({
            session_id: session.id,
            sender: 'thought',
            content: aiResponse.internal_thought
        });
    }

    // 6. Send Responses
    const chatId = session.telegram_chat_id;

    for (const msgText of aiResponse.messages) {
        await supabase.from('messages').insert({
            session_id: session.id,
            sender: 'bot',
            content: msgText
        });

        await sendTelegramMessage(botToken, chatId, msgText);
        await new Promise(r => setTimeout(r, 1000)); // Typing delay
    }

    // 7. Handle Media
    if (aiResponse.action !== 'none') {
        const SHOWER_PHOTO = "https://i.ibb.co/dwf177Kc/download.jpg";
        const LINGERIE_PHOTO = "https://i.ibb.co/dsx5mTXQ/3297651933149867831-62034582678-jpg.jpg";
        const WET_PHOTO = "https://i.ibb.co/mrtfZbTb/fotos-de-bucetas-meladas-0.jpg";
        const VIDEO_PREVIEW = "https://bhnsfqommnjziyhvzfli.supabase.co/storage/v1/object/public/media/previews/1764694671095_isiwgk.mp4";

        let mediaUrl = null;
        let mediaType = null;
        let caption = "";

        switch (aiResponse.action) {
            case 'send_shower_photo': mediaUrl = SHOWER_PHOTO; mediaType = 'image'; caption = ""; break;
            case 'send_lingerie_photo': mediaUrl = LINGERIE_PHOTO; mediaType = 'image'; break;
            case 'send_wet_finger_photo': mediaUrl = WET_PHOTO; mediaType = 'image'; break;
            case 'send_video_preview': mediaUrl = VIDEO_PREVIEW; mediaType = 'video'; break;
            case 'generate_pix_payment': await sendTelegramMessage(botToken, chatId, "[PIX]"); break;
        }

        if (mediaUrl) {
            if (mediaType === 'image') await sendTelegramPhoto(botToken, chatId, mediaUrl, caption);
            if (mediaType === 'video') await sendTelegramVideo(botToken, chatId, mediaUrl, "olha isso");

            await supabase.from('messages').insert({
                session_id: session.id,
                sender: 'bot',
                content: `[MEDIA: ${aiResponse.action}]`,
                media_url: mediaUrl,
                media_type: mediaType
            });
        }
    }

    return NextResponse.json({ success: true });
}
