"use client";
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

interface Session {
    id: string;
    telegram_chat_id: string;
    user_name: string;
    status: string;
    last_message_at: string;
    lead_score: any;
    user_city: string;
}

export default function AdminDashboard() {
    const [sessions, setSessions] = useState<Session[]>([]);

    useEffect(() => {
        fetchSessions();

        const channel = supabase
            .channel('sessions_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, (payload) => {
                fetchSessions();
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, []);

    const fetchSessions = async () => {
        const { data } = await supabase.from('sessions').select('*').order('last_message_at', { ascending: false });
        if (data) setSessions(data as Session[]);
    };

    return (
        <div className="p-8 bg-gray-900 min-h-screen text-white">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">Painel Admin - Monitoramento</h1>
                <Link href="/admin/settings">
                    <button className="bg-gray-700 px-4 py-2 rounded hover:bg-gray-600 border border-gray-600">
                        ⚙️ Configurar Bot
                    </button>
                </Link>
            </div>

            <div className="grid gap-4">
                {sessions.length === 0 && <p className="text-gray-500">Nenhuma conversa encontrada.</p>}

                {sessions.map(session => (
                    <Link key={session.id} href={`/admin/chat/${session.telegram_chat_id}`}>
                        <div className={`p-4 rounded-lg cursor-pointer border hover:border-blue-500 transition ${session.status === 'paused' ? 'bg-red-900/50 border-red-500' : 'bg-gray-800 border-gray-700'}`}>
                            <div className="flex justify-between items-center">
                                <h2 className="text-xl font-semibold">{session.user_name || "Sem Nome"} <span className="text-sm text-gray-400">({session.user_city})</span></h2>
                                <span className={`px-2 py-1 rounded text-xs ${session.status === 'active' ? 'bg-green-600' : 'bg-yellow-600'}`}>{session.status}</span>
                            </div>
                            <div className="text-sm text-gray-400 mt-2">
                                Chat ID: {session.telegram_chat_id} | Score: {session.lead_score?.tarado ?? 0}
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}
