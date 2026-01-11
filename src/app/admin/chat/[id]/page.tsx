"use client";
import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useParams, useRouter } from 'next/navigation';

interface Message {
    id: string;
    sender: 'user' | 'bot' | 'system' | 'admin';
    content: string;
    created_at: string;
}

export default function AdminChatPage() {
    const { id: telegramChatId } = useParams();
    const router = useRouter();

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

        // 1. Pause Bot automatically if admin speaks
        if (session.status !== 'paused') {
            await supabase.from('sessions').update({ status: 'paused' }).eq('id', session.id);
            setSession({ ...session, status: 'paused' });
        }

        // 2. Send via API
        try {
            await fetch('/api/admin/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId: telegramChatId, text: input })
            });
            setInput("");
        } catch (error) {
            alert("Erro ao enviar: " + error);
        }
    };

    const toggleBot = async () => {
        if (!session) return;
        const newStatus = session.status === 'paused' ? 'active' : 'paused';
        await supabase.from('sessions').update({ status: newStatus }).eq('id', session.id);
        setSession({ ...session, status: newStatus });
    };

    const deleteChat = async () => {
        if (!confirm("⚠️ TEM CERTEZA?\n\nIsso vai apagar todo o histórico de mensagens e a sessão deste usuário do banco de dados.\n\nEssa ação não pode ser desfeita.")) return;

        if (session) {
            // Delete messages first (if no cascade)
            await supabase.from('messages').delete().eq('session_id', session.id);
            // Delete session
            await supabase.from('sessions').delete().eq('id', session.id);

            alert("Chat excluído com sucesso.");
            router.push('/admin');
        }
    };

    return (
        <div className="flex h-screen bg-gray-900 text-white font-sans">
            <div className="flex-1 flex flex-col max-w-5xl mx-auto w-full shadow-2xl border-x border-gray-800">

                {/* HEADER REFORMULADO */}
                <header className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center shadow-md z-10">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => router.push('/admin')}
                            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded transition flex items-center gap-2"
                        >
                            ⬅ Voltar
                        </button>

                        <div>
                            <h1 className="text-lg font-bold flex items-center gap-2">
                                {session?.user_name || "Carregando..."}
                                <span className="text-xs font-normal text-gray-500">ID: {telegramChatId}</span>
                            </h1>
                            <div className="flex items-center gap-2 text-sm">
                                <span className={`w-2 h-2 rounded-full ${session?.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
                                <span className="text-gray-300 capitalize">{session?.status === 'active' ? 'IA Ativa (Respondendo)' : 'IA Pausada (Manual)'}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={toggleBot}
                            className={`px-4 py-2 rounded font-semibold text-sm transition shadow-sm ${session?.status === 'paused'
                                    ? 'bg-green-600 hover:bg-green-500 text-white ring-2 ring-green-600 ring-offset-2 ring-offset-gray-800'
                                    : 'bg-yellow-600 hover:bg-yellow-500 text-white'
                                }`}
                        >
                            {session?.status === 'paused' ? '▶ ATIVAR IA' : '⏸ PAUSAR IA'}
                        </button>

                        <button
                            onClick={deleteChat}
                            className="px-4 py-2 rounded font-semibold text-sm bg-red-900/50 text-red-400 hover:bg-red-600 hover:text-white transition border border-red-900"
                            title="Excluir este chat"
                        >
                            🗑
                        </button>
                    </div>
                </header>

                {/* MESSAGES AREA */}
                <main className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-900 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                    {messages.length === 0 && (
                        <div className="flex h-full items-center justify-center text-gray-600 italic">
                            Nenhuma mensagem neste chat ainda.
                        </div>
                    )}

                    {messages.map((msg) => (
                        <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-start' : 'justify-end'}`}>
                            <div
                                className={`max-w-[80%] p-4 rounded-xl shadow-md ${msg.sender === 'user'
                                        ? 'bg-gray-800 text-gray-100 rounded-tl-none border border-gray-700'
                                        : (msg.sender === 'admin'
                                            ? 'bg-blue-600 text-white rounded-tr-none'
                                            : 'bg-pink-600 text-white rounded-tr-none')
                                    }`}
                            >
                                <div className="flex justify-between items-center mb-1 opacity-70 text-[10px] uppercase font-bold tracking-wider">
                                    <span>{msg.sender}</span>
                                    <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </main>

                {/* INPUT AREA */}
                <footer className="p-4 bg-gray-800 border-t border-gray-700 flex gap-3">
                    <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && sendManualMessage()}
                        className="flex-1 bg-gray-900 text-white rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-700 placeholder-gray-500"
                        placeholder="Escreva uma resposta manual (Isso vai pausar a IA automaticamente)..."
                    />
                    <button
                        onClick={sendManualMessage}
                        className="bg-blue-600 px-6 py-2 rounded-lg font-bold hover:bg-blue-500 transition shadow-lg"
                    >
                        Enviar
                    </button>
                </footer>
            </div>
        </div>
    );
}
