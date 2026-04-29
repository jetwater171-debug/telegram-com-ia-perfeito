"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useParams, useRouter } from "next/navigation";

interface Message {
    id: string;
    sender: "user" | "bot" | "system" | "admin" | "thought";
    content: string;
    created_at: string;
    media_url?: string | null;
    media_type?: string | null;
}

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function AdminChatPage() {
    const params = useParams();
    const telegramChatId = Array.isArray(params.id) ? params.id[0] : params.id;
    const router = useRouter();

    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [session, setSession] = useState<any>(null);
    const [latestFunnelStep, setLatestFunnelStep] = useState<string | null>(null);
    const [leadTyping, setLeadTyping] = useState(false);
    const [showThoughts, setShowThoughts] = useState(false);
    const [showSystem, setShowSystem] = useState(false);
    const [actionMsg, setActionMsg] = useState("");
    const [forceLoading, setForceLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [lastSync, setLastSync] = useState<Date | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const didInitialScroll = useRef(false);

    useEffect(() => {
        let active = true;
        let cleanup = () => {};

        (async () => {
            if (!telegramChatId) return;
            setLoading(true);
            const { data } = await supabase
                .from("sessions")
                .select("*")
                .eq("telegram_chat_id", telegramChatId)
                .single();

            if (!active || !data) {
                setLoading(false);
                return;
            }

            setSession(data);
            await loadLatestFunnel(data.id, data.funnel_step);
            await loadMessages(data.id);
            cleanup = subscribe(data.id);
            setLoading(false);
        })();

        return () => {
            active = false;
            cleanup();
        };
    }, [telegramChatId]);

    useEffect(() => {
        if (!session?.id) return;
        const timer = window.setInterval(() => loadMessages(session.id, false), 15000);
        return () => window.clearInterval(timer);
    }, [session?.id]);

    useEffect(() => {
        if (!messages.length) {
            setLeadTyping(false);
            return;
        }
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.sender !== "user") {
            setLeadTyping(false);
            return;
        }
        const isRecent = Date.now() - new Date(lastMsg.created_at).getTime() <= 20000;
        setLeadTyping(isRecent);
        const typingTimeout = window.setTimeout(() => setLeadTyping(false), 20000);
        return () => window.clearTimeout(typingTimeout);
    }, [messages]);

    useEffect(() => {
        if (!messages.length) return;
        if (!didInitialScroll.current) {
            didInitialScroll.current = true;
            scrollToBottom("auto");
            return;
        }
        scrollToBottom("smooth");
    }, [messages.length]);

    const loadLatestFunnel = async (sessionId: string, currentStep?: string) => {
        if (currentStep) {
            setLatestFunnelStep(null);
            return;
        }
        const { data } = await supabase
            .from("funnel_events")
            .select("step, created_at")
            .eq("session_id", sessionId)
            .order("created_at", { ascending: false })
            .limit(1);
        setLatestFunnelStep(data?.[0]?.step || null);
    };

    const loadMessages = async (sessionId: string, shouldScroll = true) => {
        const { data } = await supabase
            .from("messages")
            .select("*")
            .eq("session_id", sessionId)
            .order("created_at", { ascending: true });
        if (data) {
            setMessages(data as Message[]);
            setLastSync(new Date());
            if (shouldScroll) window.setTimeout(() => scrollToBottom("auto"), 0);
        }
    };

    const subscribe = (sessionId: string) => {
        const channel = supabase
            .channel(`admin_chat_${sessionId}_${Date.now()}`)
            .on("postgres_changes", {
                event: "INSERT",
                schema: "public",
                table: "messages",
                filter: `session_id=eq.${sessionId}`,
            }, (payload) => {
                setMessages((prev) => {
                    const exists = prev.some((m) => m.id === payload.new.id);
                    if (exists) return prev;
                    return [...prev, payload.new as Message].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                });
                setLastSync(new Date());
            })
            .on("postgres_changes", {
                event: "UPDATE",
                schema: "public",
                table: "messages",
                filter: `session_id=eq.${sessionId}`,
            }, (payload) => {
                setMessages((prev) => prev.map((m) => (m.id === payload.new.id ? payload.new as Message : m)));
                setLastSync(new Date());
            })
            .on("postgres_changes", {
                event: "*",
                schema: "public",
                table: "sessions",
                filter: `id=eq.${sessionId}`,
            }, (payload) => {
                if (payload.eventType === "DELETE") {
                    router.push("/admin");
                    return;
                }
                setSession(payload.new);
                setLastSync(new Date());
            })
            .on("postgres_changes", {
                event: "INSERT",
                schema: "public",
                table: "funnel_events",
                filter: `session_id=eq.${sessionId}`,
            }, (payload) => {
                const step = (payload.new as any)?.step;
                if (step) setLatestFunnelStep(step);
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    };

    const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
        messagesEndRef.current?.scrollIntoView({ behavior });
    };

    const sendManualMessage = async () => {
        const text = input.trim();
        if (!text || !session || !telegramChatId) return;

        if (session.status !== "paused") {
            await supabase.from("sessions").update({ status: "paused" }).eq("id", session.id);
            setSession({ ...session, status: "paused" });
        }

        try {
            setInput("");
            await fetch("/api/admin/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chatId: telegramChatId, text }),
            });
        } catch (error) {
            setActionMsg(`Erro ao enviar: ${String(error)}`);
        }
    };

    const forceSale = async () => {
        if (!telegramChatId) return;
        setForceLoading(true);
        setActionMsg("");
        try {
            const res = await fetch("/api/admin/force-sale", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chatId: telegramChatId }),
            });
            const data = await res.json();
            setActionMsg(data?.ok ? "Venda solicitada para a IA." : data?.error || "Falha ao forcar venda");
        } catch (e: any) {
            setActionMsg(e?.message || "Erro ao forcar venda");
        }
        setForceLoading(false);
    };

    const toggleBot = async () => {
        if (!session) return;
        const newStatus = session.status === "paused" ? "active" : "paused";
        await supabase.from("sessions").update({ status: newStatus }).eq("id", session.id);
        setSession({ ...session, status: newStatus });
    };

    const deleteChat = async () => {
        if (!session || !confirm("Tem certeza? Isso apaga todo o historico.")) return;
        await supabase.from("messages").delete().eq("session_id", session.id);
        await supabase.from("sessions").delete().eq("id", session.id);
        router.push("/admin");
    };

    const lastUserMessage = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].sender === "user" && messages[i].content) return messages[i].content;
        }
        return "";
    }, [messages]);

    const visibleMessages = useMemo(() => {
        return messages.filter((msg) => {
            if (msg.sender === "thought" && !showThoughts) return false;
            if (msg.sender === "system" && !showSystem) return false;
            return true;
        });
    }, [messages, showThoughts, showSystem]);

    const safeLeadScore = getSafeLeadScore(session?.lead_score, lastUserMessage);
    const effectiveFunnelStep = session?.funnel_step || latestFunnelStep || "";
    const leadMemory = useMemo(() => parseLeadMemory(session?.lead_memory), [session?.lead_memory]);
    const lastMessage = messages[messages.length - 1];

    return (
        <div className="flex h-screen overflow-hidden bg-[#080b10] text-slate-100">
            <div className="flex min-w-0 flex-1 flex-col">
                <header className="border-b border-white/10 bg-[#080b10]/95 backdrop-blur">
                    <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                            <button
                                onClick={() => router.push("/admin")}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-cyan-300/40 hover:text-white"
                                title="Voltar"
                            >
                                <span className="text-lg">{"<"}</span>
                            </button>
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-slate-950 ${safeLeadScore.tarado >= 70 ? "bg-rose-300" : "bg-cyan-300"}`}>
                                {initials(session?.user_name)}
                            </div>
                            <div className="min-w-0">
                                <h1 className="truncate text-base font-semibold">{session?.user_name || "Carregando..."}</h1>
                                <p className="truncate text-xs text-slate-400">
                                    {leadTyping ? "lead acabou de mandar mensagem" : session?.status === "active" ? "IA ativa" : "IA pausada"} / {lastSync ? `sync ${formatTimeAgo(lastSync.toISOString())}` : "sync pendente"}
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <SegmentButton active={showSystem} onClick={() => setShowSystem(!showSystem)}>Sistema</SegmentButton>
                            <SegmentButton active={showThoughts} onClick={() => setShowThoughts(!showThoughts)}>Ideias IA</SegmentButton>
                            <button
                                onClick={() => session?.id && loadMessages(session.id)}
                                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/40"
                            >
                                Sincronizar
                            </button>
                            <button
                                onClick={forceSale}
                                className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:border-amber-300/60"
                                disabled={forceLoading}
                            >
                                {forceLoading ? "forcando..." : "forcar venda"}
                            </button>
                            <button
                                onClick={toggleBot}
                                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-cyan-300/40"
                            >
                                {session?.status === "paused" ? "Ativar IA" : "Pausar IA"}
                            </button>
                            <button
                                onClick={deleteChat}
                                className="rounded-lg border border-rose-300/30 bg-rose-300/10 px-3 py-2 text-xs font-semibold text-rose-100 transition hover:border-rose-300/60"
                            >
                                Apagar
                            </button>
                        </div>
                    </div>
                </header>

                <main className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
                    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
                        {loading && <div className="p-10 text-center text-slate-500">Carregando conversa...</div>}

                        {visibleMessages.map((msg, index) => {
                            const previous = visibleMessages[index - 1];
                            const showDate = !previous || !isSameDay(previous.created_at, msg.created_at);

                            return (
                                <React.Fragment key={msg.id}>
                                    {showDate && (
                                        <div className="flex justify-center py-2">
                                            <span className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-slate-500">
                                                {formatDate(msg.created_at)}
                                            </span>
                                        </div>
                                    )}
                                    <MessageBubble message={msg} />
                                </React.Fragment>
                            );
                        })}

                        {!loading && visibleMessages.length === 0 && (
                            <div className="p-10 text-center text-slate-500">Nenhuma mensagem visivel nesta conversa.</div>
                        )}

                        {leadTyping && (
                            <div className="flex justify-start">
                                <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-cyan-100">IA preparando resposta...</div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>
                </main>

                <footer className="border-t border-white/10 bg-[#080b10]/95 px-3 py-3 sm:px-5">
                    <div className="mx-auto flex w-full max-w-4xl items-end gap-2">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    sendManualMessage();
                                }
                            }}
                            className="max-h-36 min-h-[48px] w-full resize-none rounded-lg border border-white/10 bg-black/35 px-3 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50"
                            placeholder="Enviar mensagem manual..."
                            rows={2}
                        />
                        <button
                            onClick={sendManualMessage}
                            disabled={!input.trim()}
                            className={`rounded-lg border px-4 py-3 text-sm font-semibold transition ${input.trim()
                                ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/20"
                                : "border-white/10 text-slate-600"}`}
                        >
                            Enviar
                        </button>
                    </div>
                    {actionMsg && <div className="mx-auto mt-2 w-full max-w-4xl text-xs text-amber-200">{actionMsg}</div>}
                </footer>
            </div>

            <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-white/10 bg-[#0b0f16] p-4 xl:block">
                <div className="space-y-4">
                    <Panel title="Lead">
                        <div className="flex items-center gap-3">
                            <div className={`flex h-12 w-12 items-center justify-center rounded-lg text-sm font-bold text-slate-950 ${safeLeadScore.tarado >= 70 ? "bg-rose-300" : "bg-cyan-300"}`}>
                                {initials(session?.user_name)}
                            </div>
                            <div className="min-w-0">
                                <p className="truncate font-semibold">{session?.user_name || "Desconhecido"}</p>
                                <p className="truncate text-xs text-slate-500">#{session?.telegram_chat_id}</p>
                            </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                            <Info label="Status" value={session?.status === "active" ? "Ativo" : "Pausado"} tone={session?.status === "active" ? "text-emerald-200" : "text-rose-200"} />
                            <Info label="Funil" value={effectiveFunnelStep ? effectiveFunnelStep.replace(/_/g, " ") : "INICIO"} />
                            <Info label="Cidade" value={session?.user_city || "N/A"} />
                            <Info label="Device" value={session?.device_type || "N/A"} />
                        </div>
                    </Panel>

                    <Panel title="Valor">
                        <p className="text-3xl font-semibold text-emerald-100">{money.format(Number(session?.total_paid || 0))}</p>
                        <p className="mt-1 text-xs text-slate-500">Total pago por este lead</p>
                    </Panel>

                    <Panel title="Score">
                        <ScoreBar label="Hot" value={safeLeadScore.tarado} color="bg-rose-400" />
                        <ScoreBar label="Financeiro" value={safeLeadScore.financeiro} color="bg-emerald-400" />
                        <ScoreBar label="Carente" value={safeLeadScore.carente} color="bg-cyan-400" />
                        <ScoreBar label="Sentimental" value={safeLeadScore.sentimental} color="bg-violet-400" />
                    </Panel>

                    <Panel title="Memoria">
                        <div className="space-y-3">
                            <InfoLine label="Perfil" value={leadMemory.dominant_type} />
                            <InfoLine label="Tom" value={leadMemory.best_tone} />
                            <TagList label="Quer" items={leadMemory.wanted_products} />
                            <TagList label="Recusou" items={leadMemory.rejected_products} />
                            <TagList label="Desejos" items={leadMemory.desires} />
                            <TagList label="Objecoes" items={leadMemory.objections} />
                            <InfoLine label="Ultima oferta" value={leadMemory.last_offer} />
                        </div>
                    </Panel>

                    <Panel title="Ultimo evento">
                        <p className="text-sm text-slate-200">{lastMessage ? cleanText(lastMessage.content) : "Sem mensagens"}</p>
                        <p className="mt-2 text-xs text-slate-500">{lastMessage ? `${senderName(lastMessage.sender)} / ${formatTimeAgo(lastMessage.created_at)}` : ""}</p>
                    </Panel>
                </div>
            </aside>
        </div>
    );
}

function MessageBubble({ message }: { message: Message }) {
    const isMe = message.sender === "bot" || message.sender === "admin";
    const isSystem = message.sender === "system";
    const isThought = message.sender === "thought";

    if (isSystem || isThought) {
        return (
            <div className="flex justify-center">
                <div className={`max-w-[92%] rounded-lg border px-3 py-2 text-xs leading-relaxed ${isThought
                    ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
                    : "border-white/10 bg-white/[0.04] text-slate-400"}`}>
                    <span className="font-semibold">{isThought ? "IA" : "Sistema"}: </span>
                    <span className="whitespace-pre-wrap break-words">{message.content}</span>
                    <span className="ml-2 text-[10px] opacity-60">{formatTime(message.created_at)}</span>
                </div>
            </div>
        );
    }

    return (
        <div className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[86%] rounded-lg border px-3 py-2 shadow-sm sm:max-w-[72%] ${isMe
                ? "border-cyan-300/20 bg-[#123044] text-slate-50"
                : "border-white/10 bg-[#111822] text-slate-100"}`}>
                <div className="mb-1 flex items-center justify-between gap-4">
                    <span className={`text-[11px] font-semibold ${message.sender === "admin" ? "text-amber-200" : isMe ? "text-cyan-100" : "text-slate-400"}`}>
                        {senderName(message.sender)}
                    </span>
                    <span className="text-[10px] text-slate-500">{formatTime(message.created_at)}</span>
                </div>
                {message.media_url && (
                    <div className="mb-2 overflow-hidden rounded-md border border-white/10 bg-black/20">
                        {message.media_type === "video" ? (
                            <video src={message.media_url} controls className="max-h-72 w-full object-contain" />
                        ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={message.media_url} alt="" className="max-h-72 w-full object-contain" />
                        )}
                    </div>
                )}
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
            </div>
        </div>
    );
}

function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${active
                ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                : "border-white/10 bg-white/[0.04] text-slate-400 hover:text-slate-100"}`}
        >
            {children}
        </button>
    );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</h2>
            {children}
        </section>
    );
}

function Info({ label, value, tone = "text-slate-100" }: { label: string; value: string; tone?: string }) {
    return (
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-slate-500">{label}</p>
            <p className={`mt-1 truncate font-semibold ${tone}`}>{value}</p>
        </div>
    );
}

function InfoLine({ label, value }: { label: string; value: unknown }) {
    if (!value) return null;
    return (
        <div className="text-sm">
            <span className="text-slate-500">{label}: </span>
            <span className="text-slate-200">{String(value)}</span>
        </div>
    );
}

function TagList({ label, items }: { label: string; items: unknown }) {
    const list = Array.isArray(items) ? items.filter(Boolean).slice(0, 5) : [];
    if (!list.length) return null;
    return (
        <div>
            <p className="mb-2 text-xs text-slate-500">{label}</p>
            <div className="flex flex-wrap gap-1.5">
                {list.map((item) => (
                    <span key={`${label}-${String(item)}`} className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs text-slate-200">
                        {String(item)}
                    </span>
                ))}
            </div>
        </div>
    );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className="mb-3 last:mb-0">
            <div className="mb-1 flex justify-between text-xs text-slate-400">
                <span>{label}</span>
                <span>{value}%</span>
            </div>
            <div className="h-2 rounded-full bg-black/40">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
            </div>
        </div>
    );
}

function parseLeadMemory(raw: unknown) {
    if (!raw) return {};
    if (typeof raw === "string") {
        try { return JSON.parse(raw); } catch { return {}; }
    }
    return typeof raw === "object" ? raw as Record<string, any> : {};
}

function getSafeLeadScore(raw: unknown, fallbackText: string) {
    const base = { tarado: 5, financeiro: 10, carente: 20, sentimental: 20 };
    let stats = raw;
    if (typeof stats === "string") {
        try { stats = JSON.parse(stats); } catch { stats = null; }
    }
    if (!stats || typeof stats !== "object" || isAllZero(stats as any)) {
        stats = applyHeuristicStats(fallbackText, base);
    }
    const data = stats as Record<string, unknown>;
    return {
        tarado: clampStat(Number(data.tarado ?? base.tarado)),
        financeiro: clampStat(Number(data.financeiro ?? base.financeiro)),
        carente: clampStat(Number(data.carente ?? base.carente)),
        sentimental: clampStat(Number(data.sentimental ?? base.sentimental)),
    };
}

function applyHeuristicStats(text: string, current: any) {
    const s = { ...current };
    const t = (text || "").toLowerCase();
    const inc = (key: keyof typeof s, val: number) => { s[key] = clampStat(s[key] + val); };
    if (/(manda.*foto|quero ver|deixa eu ver|foto|video|manda mais)/i.test(t)) inc("tarado", 20);
    if (/(quanto custa|pix|vou comprar|passa o pix|preco|valor|mensal|vitalicio)/i.test(t)) inc("financeiro", 20);
    if (/(bom dia|boa noite|to sozinho|carente|saudade)/i.test(t)) inc("carente", 15);
    if (/(saudade|solidao|carinho|afeto)/i.test(t)) inc("sentimental", 15);
    return s;
}

function isAllZero(s: Record<string, unknown>) {
    return ["tarado", "financeiro", "carente", "sentimental"].every((key) => Number(s[key] || 0) === 0);
}

function clampStat(n: number) {
    return Math.max(0, Math.min(100, Number(n) || 0));
}

function initials(name?: string) {
    if (!name) return "??";
    return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

function senderName(sender: string) {
    if (sender === "user") return "Lead";
    if (sender === "bot") return "Lari";
    if (sender === "admin") return "Voce";
    if (sender === "system") return "Sistema";
    if (sender === "thought") return "IA";
    return sender;
}

function formatTime(isoString: string) {
    return new Date(isoString).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(isoString: string) {
    return new Date(isoString).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTimeAgo(dateString?: string) {
    if (!dateString) return "nunca";
    const diffInSeconds = Math.max(0, Math.floor((Date.now() - new Date(dateString).getTime()) / 1000));
    if (diffInSeconds < 20) return "agora";
    if (diffInSeconds < 60) return `${diffInSeconds}s atras`;
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m atras`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h atras`;
    return `${Math.floor(diffInSeconds / 86400)}d atras`;
}

function isSameDay(a: string, b: string) {
    return new Date(a).toDateString() === new Date(b).toDateString();
}

function cleanText(text?: string) {
    return (text || "").replace(/\s+/g, " ").trim();
}
