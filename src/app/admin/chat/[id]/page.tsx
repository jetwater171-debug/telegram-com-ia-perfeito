"use client";
import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useParams } from 'next/navigation';

interface Message {
    id: string;
    sender: 'user' | 'bot' | 'system' | 'admin';
    content: string;
    created_at: string;
}

export default function AdminChatPage() {
    // We use telegram_chat_id in URL for easier reading, but need session.id for DB
    // Or we passed telegram_chat_id, need to find session first.
    const { id: telegramChatId } = useParams();

    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [session, setSession] = useState<any>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (telegramChatId) loadSession();
    }, [telegramChatId]);

    const loadSession = async () => {
        let { data } = await supabase.from('sessions').select('*').eq('telegram_chat_id', telegramChatId).single();
        if (data) {
            setSession(data);
            loadMessages(data.id);
            subscribe(data.id);
        }
    };

    const loadMessages = async (sessionId: string) => {
        const { data } = await supabase.from('messages').select('*').eq('session_id', sessionId).order('created_at', { ascending: true });
        if (data) setMessages(data as Message[]);
        scrollToBottom();
    };

    const subscribe = (sessionId: string) => {
        const channel = supabase
            .channel(`chat_${sessionId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `session_id=eq.${sessionId}` }, (payload) => {
                setMessages(prev => [...prev, payload.new as Message]);
                scrollToBottom();
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    };

    const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

    const sendManualMessage = async () => {
        if (!input.trim() || !session) return;

        // 1. Pause Bot
        if (session.status !== 'paused') {
            await supabase.from('sessions').update({ status: 'paused' }).eq('id', session.id);
            setSession({ ...session, status: 'paused' });
        }

        // 2. Send to Telegram (Via API or direct if we have token here? Better via API)
        // We'll call a server action or just insert into messages and let a background job check? 
        // No, we need to effectively send to Telegram.
        // We can insert into DB with sender 'admin' and have a Trigger or polling process send it? 
        // OR create an API endpoint /api/admin/send

        // Simplest: Call our Telegram Webhook API logic or a specific admin endpoint.
        // I'll assume we implement /api/admin/send later. For now, just saving to DB to simulate.
        // Actually, sending to Telegram is crucial.
        // I will fetch to our own API.

        await fetch('/api/admin/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: telegramChatId, text: input })
        });

        // Save to DB (The API should do this, but if we want instant feedback...)
        // Let's let the API do it.

        setInput("");
    };

    const toggleBot = async () => {
        if (!session) return;
        const newStatus = session.status === 'paused' ? 'active' : 'paused';
        await supabase.from('sessions').update({ status: newStatus }).eq('id', session.id);
        setSession({ ...session, status: newStatus });
    };

    return (
        <div className="flex h-screen bg-gray-900 text-white">
            <div className="flex-1 flex flex-col">
                <header className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center">
                    <div>
                        <h1 className="text-xl font-bold">{session?.user_name} ({telegramChatId})</h1>
                        <p className="text-sm text-gray-400">{session?.user_city} | Status: {session?.status}</p>
                    </div>
                    <button
                        onClick={toggleBot}
                        className={`px-4 py-2 rounded ${session?.status === 'paused' ? 'bg-green-600' : 'bg-red-600'}`}
                    >
                        {session?.status === 'paused' ? 'Ativar IA' : 'Pausar IA'}
                    </button>
                </header>

                <main className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.map((msg) => (
                        <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-start' : 'justify-end'}`}>
                            <div className={`max-w-[70%] p-3 rounded-lg ${msg.sender === 'user' ? 'bg-gray-700' : (msg.sender === 'admin' ? 'bg-blue-600' : 'bg-pink-600')}`}>
                                <p className="text-xs font-bold mb-1 opacity-50">{msg.sender.toUpperCase()}</p>
                                <p>{msg.content}</p>
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </main>

                <footer className="p-4 bg-gray-800 border-t border-gray-700 flex gap-2">
                    <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && sendManualMessage()}
                        className="flex-1 bg-gray-700 rounded p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Escreva uma resposta manual..."
                    />
                    <button
                        onClick={sendManualMessage}
                        className="bg-blue-600 px-6 py-2 rounded hover:bg-blue-700"
                    >
                        Enviar
                    </button>
                </footer>
            </div>
        </div>
    );
}
