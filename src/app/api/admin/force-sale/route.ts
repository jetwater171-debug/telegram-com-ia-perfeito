import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const chatId = String(body?.chatId || '').trim();
        if (!chatId) return NextResponse.json({ error: 'chatId required' }, { status: 400 });

        const { data: session } = await supabase
            .from('sessions')
            .select('*')
            .eq('telegram_chat_id', chatId)
            .single();

        if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });

        const { data: recentTrigger } = await supabase
            .from('messages')
            .select('id, created_at')
            .eq('session_id', session.id)
            .eq('sender', 'system')
            .ilike('content', '[ADMIN_TRIGGER_SALE]%')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (recentTrigger?.created_at) {
            const diffMs = Date.now() - new Date(recentTrigger.created_at).getTime();
            if (diffMs < 2 * 60 * 1000) {
                return NextResponse.json({ ok: true, skipped: true, reason: 'recent_trigger' });
            }
        }

        await supabase.from('messages').insert({
            session_id: session.id,
            sender: 'system',
            content: '[ADMIN_TRIGGER_SALE] iniciar venda agora'
        });

        const protocol = req.headers.get('x-forwarded-proto') || 'http';
        const host = req.headers.get('host');
        const workerUrl = `${protocol}://${host}/api/process-message`;

        await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: session.id })
        });

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'error' }, { status: 500 });
    }
}
