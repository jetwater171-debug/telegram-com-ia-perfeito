"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
    const [input, setInput] = useState('');
    const [session, setSession] = useState<any>(null);
    const [latestFunnelStep, setLatestFunnelStep] = useState<string | null>(null);
    const [leadTyping, setLeadTyping] = useState(false);
    const [showThoughts, setShowThoughts] = useState(false);
    const [showSystem, setShowSystem] = useState(true);
    const [actionMsg, setActionMsg] = useState('');
    const [forceLoading, setForceLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const didInitialScroll = useRef(false);

    useEffect(() => {
        let active = true;
        let cleanup = () => {};

        (async () => {
            if (!telegramChatId) return;
            const { data } = await supabase
                .from('sessions')
                .select('*')
                .eq('telegram_chat_id', telegramChatId)
                .single();

            if (!active || !data) return;
            setSession(data);
            if (!data.funnel_step) {
                const { data: funnelRows } = await supabase
                    .from('funnel_events')
                    .select('step, created_at')
                    .eq('session_id', data.id)
                    .order('created_at', { ascending: false })
                    .limit(1);
                setLatestFunnelStep(funnelRows?.[0]?.step || null);
            } else {
                setLatestFunnelStep(null);
            }
            await loadMessages(data.id);
            cleanup = subscribe(data.id);
        })();

        return () => {
            active = false;
            cleanup();
        };
    }, [telegramChatId]);

    useEffect(() => {
        if (!messages.length) {
            setLeadTyping(false);
            return;
        }

        const lastMsg = messages[messages.length - 1];
        const lastIsUser = lastMsg.sender === 'user';
        if (!lastIsUser) {
            setLeadTyping(false);
            return;
        }

        const lastTime = new Date(lastMsg.created_at).getTime();
        const isRecent = (Date.now() - lastTime) <= 20000;
        setLeadTyping(isRecent);

        const typingTimeout = setTimeout(() => setLeadTyping(false), 20000);
        return () => clearTimeout(typingTimeout);
    }, [messages]);

    const loadMessages = async (sessionId: string) => {
        const { data } = await supabase
            .from('messages')
            .select('*')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true });
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
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'sessions',
                filter: `id=eq.${sessionId}`
            }, (payload) => {
                setSession(payload.new);
            })
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'funnel_events',
                filter: `session_id=eq.${sessionId}`
            }, (payload) => {
                const step = (payload.new as any)?.step;
                if (step) setLatestFunnelStep(step);
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    };

    const scrollToBottom = (behavior: ScrollBehavior = 'smooth') =>
        messagesEndRef.current?.scrollIntoView({ behavior });

    useEffect(() => {
        if (!messages.length) return;
        if (!didInitialScroll.current) {
            didInitialScroll.current = true;
            scrollToBottom('auto');
            return;
        }
        scrollToBottom('smooth');
    }, [messages.length]);

    const clampStat = (n: number) => Math.max(0, Math.min(100, Number(n) || 0));

    const applyHeuristicStats = (text: string, current: any) => {
        const s = { ...current };
        const t = (text || '').toLowerCase();
        const inc = (key: keyof typeof s, val: number) => {
            s[key] = clampStat(s[key] + val);
        };

        if (/(manda.*foto|quero ver|deixa eu ver|cad[e?]|nudes?|foto|video|pelada|sem roupa|manda mais)/i.test(t)) inc('tarado', 20);
        if (/(gostosa|delicia|tesao|safada|linda|d[ei]l?icia)/i.test(t)) inc('tarado', 10);
        if (/(quero transar|chupar|comer|foder|gozar|pau|buceta|porra|me come|te comer)/i.test(t)) inc('tarado', 30);

        if (/(quanto custa|pix|vou comprar|passa o pix|quanto e|preco|valor|mensal|vitalicio)/i.test(t)) inc('financeiro', 20);
        if (/(tenho dinheiro|sou rico|ferrari|viajei|carro|viagem)/i.test(t)) inc('financeiro', 20);
        if (/(ta caro|caro|sem dinheiro|liso|desempregado)/i.test(t)) inc('financeiro', -20);

        if (/(bom dia amor|boa noite vida|sonhei com vc|to sozinho|ninguem me quer|queria uma namorada|carente|me chama|sdds|saudade)/i.test(t)) inc('carente', 15);
        if (t.trim().split(/\s+/).length <= 2) inc('carente', -10);

        if (/(saudade|solidao|sentindo falta|carinho|afeto)/i.test(t)) inc('sentimental', 15);

        return s;
    };

    const getSafeLeadScore = (raw: any, fallbackText: string) => {
        let stats = raw;
        if (typeof stats === 'string') {
            try { stats = JSON.parse(stats); } catch { stats = null; }
        }
        const base = { tarado: 5, financeiro: 10, carente: 20, sentimental: 20 };
        if (!stats) stats = base;

        const isAllZero = (s: any) =>
            (Number(s.tarado) || 0) === 0 &&
            (Number(s.financeiro) || 0) === 0 &&
            (Number(s.carente) || 0) === 0 &&
            (Number(s.sentimental) || 0) === 0;

        if (isAllZero(stats)) stats = base;

        if (isAllZero(stats)) {
            stats = fallbackText ? applyHeuristicStats(fallbackText, base) : base;
        }
        return {
            tarado: clampStat((stats as any).tarado ?? base.tarado),
            financeiro: clampStat((stats as any).financeiro ?? base.financeiro),
            carente: clampStat((stats as any).carente ?? base.carente),
            sentimental: clampStat((stats as any).sentimental ?? base.sentimental)
        };
    };

    const sendManualMessage = async () => {
        if (!input.trim() || !session) return;

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
            setInput('');
        } catch (error) {
            alert('Erro ao enviar: ' + error);
        }
    };

    const forceSale = async () => {
        if (!telegramChatId) return;
        setForceLoading(true);
        setActionMsg('');
        try {
            const res = await fetch('/api/admin/force-sale', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId: telegramChatId })
            });
            const data = await res.json();
            if (data?.ok) {
                setActionMsg('forcando venda...');
            } else {
                setActionMsg(data?.error || 'falha ao forcar venda');
            }
        } catch (e: any) {
            setActionMsg(e?.message || 'erro ao forcar venda');
        }
        setForceLoading(false);
    };

    const toggleBot = async () => {
        if (!session) return;
        const newStatus = session.status === 'paused' ? 'active' : 'paused';
        await supabase.from('sessions').update({ status: newStatus }).eq('id', session.id);
        setSession({ ...session, status: newStatus });
    };

    const deleteChat = async () => {
        if (!confirm('Tem certeza? Isso apaga todo o historico.')) return;
        if (session) {
            await supabase.from('messages').delete().eq('session_id', session.id);
            await supabase.from('sessions').delete().eq('id', session.id);
            router.push('/admin');
        }
    };

    const formatTime = (isoString: string) => {
        return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const lastUserMessage = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].sender === 'user' && messages[i].content) return messages[i].content;
        }
        return '';
    }, [messages]);

    const safeLeadScore = getSafeLeadScore(session?.lead_score, lastUserMessage);
    const effectiveFunnelStep = session?.funnel_step || latestFunnelStep || '';

    const filteredMessages = useMemo(() => {
        return messages.filter(msg => {
            if (msg.sender === 'thought' && !showThoughts) return false;
            if (msg.sender === 'system' && !showSystem) return false;
            return true;
        });
    }, [messages, showThoughts, showSystem]);

    return (
        <div className="flex h-screen bg-[#0b0f17] text-white font-sans">
            <div className="flex-1 flex flex-col">
                <header className="sticky top-0 z-20 border-b border-white/10 bg-black/30 backdrop-blur">
                    <div className="flex items-center justify-between px-5 py-4">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => router.push('/admin')}
                                className="rounded-full border border-white/10 p-2 text-gray-300 transition hover:text-white"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
                            </button>

                            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-bold text-white ${safeLeadScore.tarado > 70 ? 'bg-gradient-to-br from-pink-500 to-purple-500' : 'bg-gradient-to-br from-blue-400 to-cyan-500'}`}>
                                {session?.user_name?.substring(0, 2).toUpperCase() || '??'}
                            </div>

                            <div>
                                <h1 className="text-lg font-semibold">{session?.user_name || 'Carregando...'}</h1>
                                <p className="text-xs text-cyan-200">
                                    {leadTyping ? 'digitando...' : (session?.status === 'active' ? 'online (IA ativa)' : 'offline (pausado)')}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="hidden md:flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs">
                                <button
                                    onClick={() => setShowSystem(!showSystem)}
                                    className={`rounded-full px-2 py-1 ${showSystem ? 'bg-white/10 text-white' : 'text-gray-400'}`}
                                >
                                    System
                                </button>
                                <button
                                    onClick={() => setShowThoughts(!showThoughts)}
                                    className={`rounded-full px-2 py-1 ${showThoughts ? 'bg-white/10 text-white' : 'text-gray-400'}`}
                                >
                                    Ideias
                                </button>
                            </div>
                            <button
                                onClick={forceSale}
                                className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:border-amber-400/60"
                                disabled={forceLoading}
                            >
                                {forceLoading ? 'forcando...' : 'forcar venda'}
                            </button>
                            <button
                                onClick={toggleBot}
                                className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-100 transition hover:border-white/20"
                            >
                                {session?.status === 'paused' ? 'Ativar IA' : 'Pausar IA'}
                            </button>
                            <button
                                onClick={deleteChat}
                                className="rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 transition hover:border-rose-400/60"
                            >
                                Apagar
                            </button>
                        </div>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto px-4 py-6">
                    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
                        {filteredMessages.map((msg) => {
                            const isMe = msg.sender === 'bot' || msg.sender === 'admin';
                            const isSystem = msg.sender === 'system';
                            const isThought = msg.sender === 'thought';

                            if (isSystem) {
                                return (
                                    <div key={msg.id} className="flex justify-center">
                                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300">
                                            {msg.content}
                                        </span>
                                    </div>
                                );
                            }

                            if (isThought) {
                                return (
                                    <div key={msg.id} className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
                                        <span className="font-semibold">IDEIA:</span> {msg.content}
                                    </div>
                                );
                            }

                            return (
                                <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                    <div
                                        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow ${isMe
                                            ? 'bg-gradient-to-br from-[#1f3a5a] to-[#1b2b45] text-white'
                                            : 'bg-[#131a27] text-gray-100'}`}
                                    >
                                        {msg.sender === 'admin' && (
                                            <div className="mb-1 text-[10px] font-semibold text-pink-300">Voce (manual)</div>
                                        )}
                                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                        <div className="mt-2 flex justify-end text-[10px] text-gray-400">
                                            {formatTime(msg.created_at)}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </div>
                </main>

                <footer className="border-t border-white/10 bg-black/30 px-4 py-4">
                    <div className="mx-auto flex w-full max-w-3xl items-end gap-3">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    sendManualMessage();
                                }
                            }}
                            className="min-h-[52px] w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                            placeholder="Digite uma mensagem..."
                            rows={2}
                        />
                        <button
                            onClick={sendManualMessage}
                            className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${input.trim()
                                ? 'bg-cyan-500/20 text-cyan-100 border border-cyan-500/30'
                                : 'border border-white/10 text-gray-500'}`}
                        >
                            Enviar
                        </button>
                    </div>
                    {actionMsg && (
                        <div className="mx-auto mt-3 w-full max-w-3xl text-center text-xs text-amber-200">
                            {actionMsg}
                        </div>
                    )}
                </footer>
            </div>

            <aside className="hidden w-80 border-l border-white/10 bg-black/30 p-6 lg:block">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                    <div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-3xl text-2xl font-bold text-white ${safeLeadScore.tarado > 70 ? 'bg-gradient-to-br from-pink-500 to-purple-500' : 'bg-gradient-to-br from-blue-400 to-cyan-500'}`}>
                        {session?.user_name?.substring(0, 2).toUpperCase() || '??'}
                    </div>
                    <h2 className="mt-4 text-center text-lg font-semibold">{session?.user_name || 'Desconhecido'}</h2>
                    <p className="mt-1 text-center text-xs text-gray-400">{session?.user_city || 'Cidade nao informada'}</p>

                    <div className="mt-6 space-y-3 text-xs text-gray-300">
                        <div className="flex items-center justify-between">
                            <span>Status</span>
                            <span className={`rounded-full px-2 py-0.5 ${session?.status === 'active' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/20 text-rose-200'}`}>
                                {session?.status === 'active' ? 'ONLINE' : 'PAUSADO'}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span>Fase funil</span>
                            <span className="text-gray-100">{effectiveFunnelStep ? effectiveFunnelStep.replace(/_/g, ' ') : 'INICIO'}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span>ID</span>
                            <span className="font-mono text-[11px] text-gray-400">{session?.telegram_chat_id}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span>Device</span>
                            <span className="text-gray-100">{session?.device_type || 'N/A'}</span>
                        </div>
                    </div>

                    <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-center">
                        <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">Total gasto</p>
                        <p className="mt-2 text-2xl font-semibold text-emerald-100">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(session?.total_paid || 0)}
                        </p>
                    </div>

                    <div className="mt-6 space-y-4">
                        <div>
                            <div className="mb-1 flex justify-between text-xs text-gray-400"><span>Tarado</span><span>{safeLeadScore.tarado}%</span></div>
                            <div className="h-1.5 w-full rounded-full bg-black/40">
                                <div className="h-full rounded-full bg-pink-500" style={{ width: `${safeLeadScore.tarado}%` }} />
                            </div>
                        </div>
                        <div>
                            <div className="mb-1 flex justify-between text-xs text-gray-400"><span>Financeiro</span><span>{safeLeadScore.financeiro}%</span></div>
                            <div className="h-1.5 w-full rounded-full bg-black/40">
                                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${safeLeadScore.financeiro}%` }} />
                            </div>
                        </div>
                        <div>
                            <div className="mb-1 flex justify-between text-xs text-gray-400"><span>Carente</span><span>{safeLeadScore.carente}%</span></div>
                            <div className="h-1.5 w-full rounded-full bg-black/40">
                                <div className="h-full rounded-full bg-cyan-500" style={{ width: `${safeLeadScore.carente}%` }} />
                            </div>
                        </div>
                        <div>
                            <div className="mb-1 flex justify-between text-xs text-gray-400"><span>Sentimental</span><span>{safeLeadScore.sentimental}%</span></div>
                            <div className="h-1.5 w-full rounded-full bg-black/40">
                                <div className="h-full rounded-full bg-purple-500" style={{ width: `${safeLeadScore.sentimental}%` }} />
                            </div>
                        </div>
                    </div>
                </div>
            </aside>
        </div>
    );
}
