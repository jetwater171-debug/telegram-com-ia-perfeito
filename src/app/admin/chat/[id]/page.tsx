"use client";
import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useParams, useRouter } from 'next/navigation';

interface Message {
    id: string;
    sender: 'user' | 'bot' | 'system' | 'admin' | 'thought';
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
    const [showMenu, setShowMenu] = useState(false);

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
            .channel(`chat_${sessionId}_${Date.now()}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `session_id=eq.${sessionId}`
            }, (payload) => {
                setMessages(prev => {
                    const exists = prev.some(m => m.id === payload.new.id);
                    if (exists) return prev;
                    return [...prev, payload.new as Message];
                });
                scrollToBottom();
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    };

    const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

    const sendManualMessage = async () => {
        if (!input.trim() || !session) return;

        // Auto-pause functionality
        if (session.status !== 'paused') {
            await supabase.from('sessions').update({ status: 'paused' }).eq('id', session.id);
            setSession({ ...session, status: 'paused' });
        }

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
        setShowMenu(false);
    };

    const deleteChat = async () => {
        if (!confirm("⚠️ TEM CERTEZA? Deletar todo o histórico?")) return;
        if (session) {
            await supabase.from('messages').delete().eq('session_id', session.id);
            await supabase.from('sessions').delete().eq('id', session.id);
            router.push('/admin');
        }
    };

    // Helper to format time like Telegram (23:45)
    const formatTime = (isoString: string) => {
        return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="flex h-screen bg-[#0e1621] text-white font-sans overflow-hidden">
            <div className="flex-1 flex flex-col w-full h-full relative shadow-none">

                {/* 1. TOP HEADER (Telegram Style) */}
                <header className="bg-[#17212b] px-4 py-2 flex items-center justify-between shadow-md z-10 shrink-0 cursor-pointer" onClick={() => setShowMenu(!showMenu)}>
                    <div className="flex items-center gap-4">
                        <button onClick={(e) => { e.stopPropagation(); router.push('/admin'); }} className="text-gray-400 hover:text-white transition">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
                        </button>

                        <div className="flex items-center gap-3">
                            {/* Avatar Placeholder */}
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white
                                ${session?.lead_score?.tarado > 70 ? 'bg-gradient-to-br from-pink-500 to-purple-500' : 'bg-gradient-to-br from-blue-400 to-blue-600'}
                            `}>
                                {session?.user_name?.substring(0, 2).toUpperCase() || "??"}
                            </div>

                            <div className="flex flex-col">
                                <h1 className="text-md font-bold text-white leading-tight">
                                    {session?.user_name || "Carregando..."}
                                </h1>
                                <p className="text-xs text-blue-400">
                                    {session?.status === 'active' ? 'online (IA Ativa)' : 'offline (Pausado)'}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="relative">
                        <button className="text-gray-400 hover:text-white p-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg>
                        </button>

                        {/* Dropdown Menu */}
                        {showMenu && (
                            <div className="absolute right-0 top-10 bg-[#17212b] border border-[#0e1621] rounded-lg shadow-xl w-48 py-2 z-50">
                                <button onClick={toggleBot} className="w-full text-left px-4 py-2 hover:bg-[#202b36] text-sm flex items-center gap-2">
                                    {session?.status === 'paused' ? '▶ Ativar IA' : '⏸ Pausar IA'}
                                </button>
                                <button onClick={deleteChat} className="w-full text-left px-4 py-2 hover:bg-[#202b36] text-red-400 text-sm flex items-center gap-2">
                                    🗑 Apagar Conversa
                                </button>
                            </div>
                        )}
                    </div>
                </header>

                {/* 2. MESSAGES AREA (Telegram Pattern Background) */}
                <main
                    className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-2 bg-[#0e1621] relative"
                    style={{
                        backgroundImage: `url("https://web.telegram.org/img/bg_0.png")`, // Telegram default dark pattern
                        backgroundBlendMode: 'soft-light',
                        backgroundSize: 'cover'
                    }}
                >
                    {/* Overlay to darken the background image matching theme */}
                    <div className="absolute inset-0 bg-[#0e1621]/80 pointer-events-none fixed" />

                    <div className="relative z-0 flex flex-col gap-1 pb-4">
                        {messages.map((msg) => {
                            const isMe = msg.sender === 'bot' || msg.sender === 'admin';
                            const isSystem = msg.sender === 'system';
                            const isThought = msg.sender === 'thought';

                            if (isSystem) {
                                return (
                                    <div key={msg.id} className="flex justify-center my-2">
                                        <span className="bg-[#17212b]/80 text-gray-400 text-xs px-3 py-1 rounded-full">{msg.content}</span>
                                    </div>
                                );
                            }

                            if (isThought) {
                                return (
                                    <div key={msg.id} className="flex w-full justify-center my-1 animate-pulse">
                                        <div className="bg-yellow-900/30 border border-yellow-700/50 text-yellow-500 text-xs px-4 py-2 rounded-lg max-w-[80%] italic flex items-start gap-2">
                                            <span className="not-italic">💭</span>
                                            <span>{msg.content}</span>
                                        </div>
                                    </div>
                                );
                            }

                            return (
                                <div key={msg.id} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                                    <div
                                        className={`relative max-w-[85%] sm:max-w-[70%] px-3 py-2 rounded-lg text-[15px] shadow-sm leading-snug break-words
                                            ${isMe
                                                ? 'bg-[#2b5278] text-white rounded-tr-none'
                                                : 'bg-[#182533] text-white rounded-tl-none'}
                                        `}
                                    >
                                        {/* Sender Name (Only for Admin to distinguish) */}
                                        {isMe && msg.sender === 'admin' && (
                                            <p className="text-[10px] text-pink-400 font-bold mb-0.5">Você (Manual)</p>
                                        )}

                                        <p className="whitespace-pre-wrap">{msg.content}</p>

                                        <div className={`text-[11px] mt-1 flex justify-end gap-1 ${isMe ? 'text-[#7c9cb6]' : 'text-[#6c7883]'}`}>
                                            {formatTime(msg.created_at)}
                                            {isMe && <span>✓✓</span>}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </div>
                </main>

                {/* 3. INPUT AREA (Telegram Style) */}
                <footer className="bg-[#17212b] p-2 sm:p-3 flex items-end gap-2 shrink-0">
                    <button className="p-3 text-gray-500 hover:text-gray-300 transition shrink-0 rounded-full hover:bg-[#2b2d31]/20">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                    </button>

                    <div className="flex-1 bg-[#0e1621] rounded-2xl flex items-center min-h-[45px] max-h-[120px] shadow-inner">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    sendManualMessage();
                                }
                            }}
                            className="w-full bg-transparent text-white px-4 py-3 focus:outline-none resize-none overflow-hidden h-[46px]"
                            placeholder="Mensagem..."
                            rows={1}
                        />
                    </div>

                    <button
                        onClick={sendManualMessage}
                        className={`p-3 rounded-full shrink-0 transition-all duration-200 transform hover:scale-105 active:scale-95
                            ${input.trim() ? 'bg-[#5288c1] text-white shadow-lg' : 'bg-transparent text-gray-500'}
                        `}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill={input.trim() ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                    </button>
                </footer>
            </div>

            {/* 4. RIGHT SIDEBAR (Lead Stats) */}
            <div className="w-80 bg-[#17212b] border-l border-black/10 hidden lg:flex flex-col shrink-0 overflow-y-auto">
                <div className="p-6 flex flex-col items-center border-b border-black/10">
                    <div className={`w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold text-white mb-4 shadow-lg
                        ${session?.lead_score?.tarado > 70 ? 'bg-gradient-to-br from-pink-500 to-purple-600' : 'bg-gradient-to-br from-blue-400 to-blue-600'}
                    `}>
                        {session?.user_name?.substring(0, 2).toUpperCase() || "??"}
                    </div>
                    <h2 className="text-xl font-bold text-white">{session?.user_name || "Desconhecido"}</h2>
                    <p className="text-sm text-gray-500">{session?.user_city || "Localização desconhecida"}</p>
                    <p className="text-xs text-gray-600 mt-1">{session?.device_type || "Device não detectado"}</p>
                </div>

                <div className="p-6 space-y-6">
                    <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-4">Análise da IA</h3>

                    {/* TARADO */}
                    <div>
                        <div className="flex justify-between text-sm mb-1">
                            <span className="text-pink-400 font-medium">🔥 Tarado / Safadeza</span>
                            <span className="font-bold">{session?.lead_score?.tarado || 0}%</span>
                        </div>
                        <div className="w-full bg-gray-700 h-2 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-pink-500 to-purple-500 transition-all duration-500"
                                style={{ width: `${session?.lead_score?.tarado || 0}%` }}
                            />
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1">Nível de excitação e abertura para conteúdo adulto.</p>
                    </div>

                    {/* FINANCEIRO */}
                    <div>
                        <div className="flex justify-between text-sm mb-1">
                            <span className="text-green-400 font-medium">💰 Financeiro / Poder</span>
                            <span className="font-bold">{session?.lead_score?.financeiro || 0}%</span>
                        </div>
                        <div className="w-full bg-gray-700 h-2 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500"
                                style={{ width: `${session?.lead_score?.financeiro || 0}%` }}
                            />
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1">Capacidade de pagamento estimada.</p>
                    </div>

                    {/* CARENTE/SENTIMENTAL */}
                    <div>
                        <div className="flex justify-between text-sm mb-1">
                            <span className="text-blue-400 font-medium">❤️ Sentimental / Carente</span>
                            <span className="font-bold">{session?.lead_score?.carente || 0}%</span>
                        </div>
                        <div className="w-full bg-gray-700 h-2 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-blue-500 to-indigo-400 transition-all duration-500"
                                style={{ width: `${session?.lead_score?.carente || 0}%` }} // Mapeando 'carente' aqui
                            />
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1">Nível de conexão emocional e carência.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
