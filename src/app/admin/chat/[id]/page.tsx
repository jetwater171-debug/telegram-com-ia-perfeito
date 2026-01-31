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
    const [leadTyping, setLeadTyping] = useState(false);

    useEffect(() => {
        let active = true;
        let cleanup = () => {};

        (async () => {
            if (!telegramChatId) return;
            const { data } = await supabase.from('sessions').select('*').eq('telegram_chat_id', telegramChatId).single();
            if (!active || !data) return;

            setSession(data);
            await loadMessages(data.id);
            cleanup = subscribe(data.id);
        })();

        return () => {
            active = false;
            cleanup();
        };
    }, [telegramChatId]);


    useEffect(() => {
        if (!messages || messages.length == 0) {
            setLeadTyping(false);
            return;
        }

        const lastMsg = messages[messages.length - 1];
        const lastIsUser = lastMsg.sender == 'user';
        if (!lastIsUser) {
            setLeadTyping(false);
            return;
        }

        const lastTime = new Date(lastMsg.created_at).getTime();
        const now = Date.now();
        const isRecent = (now - lastTime) <= 20000;
        setLeadTyping(isRecent);

        const typingTimeout = setTimeout(() => {
            setLeadTyping(false);
        }, 20000);

        return () => clearTimeout(typingTimeout);

    }, [messages]);
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
            // Listen for SESSION UPDATES (Realtime Stats/Funnel)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'sessions',
                filter: `id=eq.${sessionId}`
            }, (payload) => {
                console.log("Session update received:", payload.new);
                setSession(payload.new);
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    };

    const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

    const getSafeLeadScore = (raw: any) => {
        let stats = raw;
        if (typeof stats === 'string') {
            try {
                stats = JSON.parse(stats);
            } catch {
                stats = null;
            }
        }
        const base = { tarado: 5, financeiro: 10, carente: 20, sentimental: 20 };
        if (!stats) stats = base;

        const isAllZero = (s: any) =>
            (Number(s.tarado) || 0) === 0 &&
            (Number(s.financeiro) || 0) === 0 &&
            (Number(s.carente) || 0) === 0 &&
            (Number(s.sentimental) || 0) === 0;

        if (isAllZero(stats)) stats = base;

        const clamp = (n: number) => Math.max(0, Math.min(100, Number(n) || 0));
        return {
            tarado: clamp((stats as any).tarado ?? base.tarado),
            financeiro: clamp((stats as any).financeiro ?? base.financeiro),
            carente: clamp((stats as any).carente ?? base.carente),
            sentimental: clamp((stats as any).sentimental ?? base.sentimental)
        };
    };

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

    const safeLeadScore = getSafeLeadScore(session?.lead_score);

    return (
        <div className="flex h-screen bg-[#0f141d] text-white font-sans overflow-hidden">
            <div className="flex-1 flex flex-col w-full h-full relative shadow-none">

                {/* 1. TOP HEADER (Telegram Style) */}
                <header className="bg-[#141a24] px-4 py-2 flex items-center justify-between shadow-md z-10 shrink-0 " onClick={() => setShowMenu(!showMenu)}>
                    <div className="flex items-center gap-4">
                        <button onClick={(e) => { e.stopPropagation(); router.push('/admin'); }} className="text-gray-400 hover:text-white transition">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
                        </button>

                        <div className="flex items-center gap-3">
                            {/* Avatar Placeholder */}
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white
                                ${safeLeadScore.tarado > 70 ? 'bg-gradient-to-br from-pink-500 to-purple-500' : 'bg-gradient-to-br from-blue-400 to-blue-600'}
                            `}>
                                {session?.user_name?.substring(0, 2).toUpperCase() || "??"}
                            </div>

                            <div className="flex flex-col">
                                <h1 className="text-md font-bold text-white leading-tight">
                                    {session?.user_name || "Carregando..."}
                                </h1>
                                <p className="text-xs text-cyan-300">
                                    {leadTyping ? 'digitando...' : (session?.status === 'active' ? 'online (IA Ativa)' : 'offline (Pausado)')}
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
                            <div className="absolute right-0 top-10 bg-[#141a24] border border-[#0e1621] rounded-lg shadow-xl w-48 py-2 z-50">
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
                    className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-2 bg-[#0f141d] relative"
                    style={{
                        backgroundImage: `url("https://web.telegram.org/img/bg_0.png")`, // Telegram default dark pattern
                        backgroundBlendMode: 'soft-light',
                        backgroundSize: 'cover'
                    }}
                >
                    {/* Overlay to darken the background image matching theme */}
                    <div className="absolute inset-0 bg-[#0f141d]/80 pointer-events-none fixed" />

                    <div className="relative z-0 flex flex-col gap-1 pb-4">
                    {messages.map((msg) => {
                        const isMe = msg.sender === 'bot' || msg.sender === 'admin';
                        const isSystem = msg.sender === 'system';
                        const isThought = msg.sender === 'thought';

                        if (isSystem) {
                            return (
                                <div key={msg.id} className="flex justify-center my-2">
                                    <span className="bg-[#141a24]/80 text-gray-400 text-xs px-3 py-1 rounded-full">{msg.content}</span>
                                </div>
                            );
                        }

                        if (isThought) {
                            return (
                                <div key={msg.id} className="flex w-full justify-center my-1 animate-pulse">
                                    <div className="bg-yellow-900/30 border border-yellow-700/50 text-yellow-500 text-xs px-4 py-2 rounded-lg max-w-[80%] italic flex items-start gap-2">
                                        <span className="not-italic">IDEIA</span>
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
                                            : 'bg-[#2b2d31] text-white rounded-tl-none'}`}
                                >
                                    {isMe && msg.sender === 'admin' && (
                                        <p className="text-[10px] text-pink-400 font-bold mb-0.5">Voce (Manual)</p>
                                    )}

                                    <p className="whitespace-pre-wrap">{msg.content}</p>

                                    <div className={`text-[11px] mt-1 flex justify-end gap-1 ${isMe ? 'text-[#7c9cb6]' : 'text-[#a0aeb9]'}`}>
                                        {formatTime(msg.created_at)}
                                        {isMe && <span>OK</span>}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    <div ref={messagesEndRef} />
                </div>
                </main>

                {/* 3. INPUT AREA (Telegram Style) */}
                <footer className="bg-[#141a24] p-2 sm:p-3 flex items-end gap-2 shrink-0">
                    <button className="p-3 text-gray-500 hover:text-gray-300 transition shrink-0 rounded-full hover:bg-[#2b2d31]/20">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                    </button>

                    <div className="flex-1 bg-[#0f141d] rounded-2xl flex items-center min-h-[45px] max-h-[120px] shadow-inner">
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
            <div className="w-80 bg-[#141a24] border-l border-white/10 hidden lg:flex flex-col shrink-0 overflow-y-auto">
                <div className="p-6 flex flex-col items-center border-b border-white/10 bg-[#141a24]">
                    <div className={`w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold text-white mb-4 shadow-lg ring-4 ring-white/10
                        ${safeLeadScore.tarado > 70 ? 'bg-gradient-to-br from-pink-500 to-purple-600' : 'bg-gradient-to-br from-blue-400 to-blue-600'}
                    `}>
                        {session?.user_name?.substring(0, 2).toUpperCase() || "??"}
                    </div>
                    <h2 className="text-xl font-bold text-white">{session?.user_name || "Desconhecido"}</h2>
                    <p className="text-sm text-gray-300">{session?.user_city || "Localização desconhecida"}</p>
                    <p className="text-xs text-gray-400 mt-1">{session?.device_type || "Device não detectado"}</p>
                </div>

                <div className="p-6 space-y-6">
                    {/* INFO GRID - NEW */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-[#242f3d] p-3 rounded-lg border border-white/10 hover:border-white/30 transition">
                            <p className="text-gray-300 text-[10px] uppercase font-bold tracking-wider mb-1">Status</p>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded
                             ${session?.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                {session?.status === 'active' ? 'ONLINE' : 'OFFLINE'}
                            </span>
                        </div>
                        <div className="bg-[#242f3d] p-3 rounded-lg border border-white/10 hover:border-white/30 transition">
                            <p className="text-gray-300 text-[10px] uppercase font-bold tracking-wider mb-1">Fase Funil</p>
                            <span className="text-xs font-bold text-white block truncate" title={session?.funnel_step || 'INÍCIO'}>
                                {session?.funnel_step?.replace(/_/g, ' ') || 'INÍCIO'}
                            </span>
                        </div>
                    </div>

                    <div className="bg-[#242f3d] p-4 rounded-xl border border-white/10 space-y-3 hover:border-white/30 transition">
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-gray-300 font-medium">Cadastrado</span>
                            <span className="text-white font-mono bg-black/20 px-2 py-1 rounded">{new Date(session?.created_at).toLocaleDateString()}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-gray-300 font-medium">ID</span>
                            <span className="text-white font-mono select-all  hover:text-blue-300 bg-black/20 px-2 py-1 rounded w-32 truncate text-right" title="Copiar">{session?.telegram_chat_id}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-gray-300 font-medium">Device</span>
                            <span className="text-white">{session?.device_type || 'N/A'}</span>
                        </div>
                    </div>

                    {/* TOTAL PAID HIGHLIGHT */}
                    <div className="bg-gradient-to-br from-green-900/40 to-emerald-900/20 p-4 rounded-xl border border-green-500/50 text-center relative overflow-hidden group hover:border-green-400 transition-all shadow-lg">
                        <div className="absolute inset-0 bg-green-500/10 group-hover:bg-green-500/20 transition"></div>
                        <p className="text-green-300 text-xs font-bold uppercase tracking-wider mb-1">Total Gasto (LTV)</p>
                        <p className="text-3xl font-bold text-white tracking-tight drop-shadow-md">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(session?.total_paid || 0)}
                        </p>
                    </div>

                    <h3 className="text-white text-xs font-bold uppercase tracking-wider mb-4 border-b border-white/20 pb-2">Análise da IA</h3>

                    {/* TARADO */}
                    <div className="bg-[#1e2c3a] p-3 rounded-lg border border-pink-500/30 hover:border-pink-500/60 transition shadow-sm">
                        <div className="flex justify-between text-sm mb-2">
                            <span className="text-pink-400 font-bold flex items-center gap-2 drop-shadow-sm">🔥 Tarado</span>
                            <span className="font-bold text-white text-lg">{safeLeadScore.tarado || 0}%</span>
                        </div>
                        <div className="w-full bg-gray-800 h-3 rounded-full overflow-hidden border border-white/5">
                            <div
                                className="h-full bg-gradient-to-r from-pink-500 via-fuchsia-500 to-purple-500 transition-all duration-700 ease-out shadow-[0_0_15px_rgba(236,72,153,0.8)]"
                                style={{ width: `${safeLeadScore.tarado || 0}%` }}
                            />
                        </div>
                        <p className="text-[11px] text-gray-300 mt-2 leading-tight">Nível de excitação e abertura para conteúdo adulto.</p>
                    </div>

                    {/* FINANCEIRO */}
                    <div className="bg-[#1e2c3a] p-3 rounded-lg border border-lime-500/30 hover:border-lime-500/60 transition shadow-sm">
                        <div className="flex justify-between text-sm mb-2">
                            <span className="text-lime-400 font-bold flex items-center gap-2 drop-shadow-sm">💰 Financeiro</span>
                            <span className="font-bold text-white text-lg">{safeLeadScore.financeiro || 0}%</span>
                        </div>
                        <div className="w-full bg-gray-800 h-3 rounded-full overflow-hidden border border-white/5">
                            <div
                                className="h-full bg-gradient-to-r from-green-500 via-lime-500 to-emerald-400 transition-all duration-700 ease-out shadow-[0_0_15px_rgba(132,204,22,0.8)]"
                                style={{ width: `${safeLeadScore.financeiro || 0}%` }}
                            />
                        </div>
                        <p className="text-[11px] text-gray-300 mt-2 leading-tight">Capacidade de pagamento estimada.</p>
                    </div>

                    {/* CARENTE/SENTIMENTAL */}
                    <div className="bg-[#1e2c3a] p-3 rounded-lg border border-cyan-500/30 hover:border-cyan-500/60 transition shadow-sm">
                        <div className="flex justify-between text-sm mb-2">
                            <span className="text-cyan-400 font-bold flex items-center gap-2 drop-shadow-sm">❤️ Carente</span>
                            <span className="font-bold text-white text-lg">{safeLeadScore.carente || 0}%</span>
                        </div>
                        <div className="w-full bg-gray-800 h-3 rounded-full overflow-hidden border border-white/5">
                            <div
                                className="h-full bg-gradient-to-r from-blue-500 via-cyan-500 to-indigo-400 transition-all duration-700 ease-out shadow-[0_0_15px_rgba(6,182,212,0.8)]"
                                style={{ width: `${safeLeadScore.carente || 0}%` }}
                            />
                        </div>
                        <p className="text-[11px] text-gray-300 mt-2 leading-tight">Nível de conexão emocional e carência.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
