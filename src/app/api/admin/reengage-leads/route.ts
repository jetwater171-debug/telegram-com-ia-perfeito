import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { sendTelegramMessage } from '@/lib/telegram';
import { buildContextualReengagement } from '@/lib/reengagement';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const singleChatId = body?.chatId ? String(body.chatId).trim() : null;

        // 1. Obter Token do Bot
        const { data: tokenData, error: tokenError } = await supabase
            .from('bot_settings')
            .select('value')
            .eq('key', 'telegram_bot_token')
            .single();

        const botToken = tokenData?.value;
        if (!botToken || tokenError) {
            return NextResponse.json({ error: 'Token do Telegram não configurado' }, { status: 400 });
        }

        // 2. Limite de 1 hora atrás
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        let query = supabase
            .from('sessions')
            .select('id, telegram_chat_id, user_name, last_message_at, last_bot_activity_at, status')
            .eq('status', 'active')
            .not('telegram_chat_id', 'is', null);

        if (singleChatId) {
            query = query.eq('telegram_chat_id', singleChatId);
        } else {
            // Buscar sessões inativas há pelo menos 1 hora
            query = query.lt('last_message_at', oneHourAgo);
        }

        const { data: sessions, error: sessionsError } = await query.limit(100);

        if (sessionsError) {
            console.error('[CHAMAR_LEADS] Erro ao buscar sessões:', sessionsError);
            return NextResponse.json({ error: sessionsError.message }, { status: 500 });
        }

        if (!sessions || sessions.length === 0) {
            return NextResponse.json({
                ok: true,
                totalTargeted: 0,
                sentCount: 0,
                message: 'Nenhum lead elegível sem falar há mais de 1 hora.',
            });
        }

        let sentCount = 0;
        const errors: Array<{ sessionId: string; chatId: string; error: string }> = [];

        for (const session of sessions) {
            const chatId = session.telegram_chat_id;
            if (!chatId) continue;

            const { data: recentMessages } = await supabase
                .from('messages')
                .select('sender,content')
                .eq('session_id', session.id)
                .in('sender', ['user', 'bot'])
                .order('created_at', { ascending: false })
                .limit(12);
            const text = buildContextualReengagement({
                recentMessages: recentMessages || [],
                userName: session.user_name,
            });
            if (!text) continue;

            try {
                // Enviar direto no Telegram sem IA
                await sendTelegramMessage(botToken, chatId, text);

                const nowIso = new Date().toISOString();

                // Registrar no banco de dados como mensagem do bot
                await supabase.from('messages').insert({
                    session_id: session.id,
                    sender: 'bot',
                    content: text,
                });

                // Atualizar atividade da sessão
                await supabase.from('sessions').update({
                    last_message_at: nowIso,
                    last_bot_activity_at: nowIso,
                    reengagement_sent: true,
                }).eq('id', session.id);

                sentCount++;
                // Pequeno intervalo entre envios para evitar rate limit do Telegram
                if (sessions.length > 1) {
                    await new Promise((resolve) => setTimeout(resolve, 250));
                }
            } catch (err: any) {
                console.error(`[CHAMAR_LEADS] Falha ao enviar para ${chatId}:`, err);
                errors.push({
                    sessionId: session.id,
                    chatId,
                    error: err?.message || String(err),
                });
            }
        }

        return NextResponse.json({
            ok: true,
            totalTargeted: sessions.length,
            sentCount,
            errors,
            message: `${sentCount} lead(s) chamado(s) com sucesso!`,
        });
    } catch (error: any) {
        console.error('[CHAMAR_LEADS] Erro geral:', error);
        return NextResponse.json({ error: error?.message || 'Erro interno' }, { status: 500 });
    }
}
