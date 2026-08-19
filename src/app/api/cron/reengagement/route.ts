import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { sendTelegramMessage } from '@/lib/telegram';

export const dynamic = 'force-dynamic'; // Garantir que não faça cache

export async function GET(req: NextRequest) {
    try {
        console.log("[CRON] Verificando inatividade para reengajamento...");

        // 1. Configurar Tempo Limite (5 minutos atrás)
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

        // 2. Buscar sessões elegíveis
        // - last_bot_activity_at < 5 min atrás
        // - reengagement_sent = false
        // - status != 'closed' (opcional, dependendo da lógica)

        const { data: sessions, error } = await supabase
            .from('sessions')
            .select('*')
            .lt('last_bot_activity_at', fiveMinutesAgo)
            .eq('reengagement_sent', false)
            .eq('status', 'active') // Evitar mandar pra pausados/fechados
            .limit(5); // Processar em lotes menores para evitar timeout

        if (error) {
            console.error("[CRON] Erro ao buscar sessões:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        if (!sessions || sessions.length === 0) {
            console.log("[CRON] Nenhuma sessão para reengajar.");
            return NextResponse.json({ processed: 0 });
        }

        console.log(`[CRON] Encontradas ${sessions.length} sessões inativas.`);

        // 3. Obter Token do Bot
        const { data: tokenData } = await supabase
            .from('bot_settings')
            .select('value')
            .eq('key', 'telegram_bot_token')
            .single();

        const botToken = tokenData?.value;
        if (!botToken) {
            console.error("[CRON] Token do bot não encontrado.");
            return NextResponse.json({ error: "No Token" }, { status: 500 });
        }

        // 4. Processar Cada Sessão
        let processedCount = 0;
        const messagesToSent = [
            "taa ai ainda??",
            "amor?? sumiu?",
            "ta ocupadinho vida?",
            "me deixou no vácuo amor kkk",
            "oii amor, ta por aí ainda?",
            "sumiu pq anjo? kkk"
        ];

        for (const session of sessions) {
            const chatId = session.telegram_chat_id;
            if (!chatId) continue;

            console.log(`[CRON] Enviando reengajamento para sessão ${session.id} (Chat ${chatId})`);

            const msg = messagesToSent[Math.floor(Math.random() * messagesToSent.length)];
            await sendTelegramMessage(botToken, chatId, msg);
            await new Promise(r => setTimeout(r, 500));

            // Registrar envio para não mandar de novo E atualizar timestamp
            await supabase.from('sessions').update({
                reengagement_sent: true,
                last_bot_activity_at: new Date().toISOString()
            }).eq('id', session.id);

            // Registrar mensagem no histórico como 'bot'
            await supabase.from('messages').insert({
                session_id: session.id,
                sender: 'bot',
                content: msg
            });

            processedCount++;
        }

        return NextResponse.json({ processed: processedCount, success: true });

    } catch (e: any) {
        console.error("[CRON] Erro Crítico:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
