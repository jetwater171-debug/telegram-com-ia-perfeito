"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useParams, useRouter } from "next/navigation";
import { parseLeadScore, parseLeadScoreMeta } from "@/lib/leadScoring";
import { AiDebugData } from "@/types";
import { PromptInspectorDrawer } from "./components/PromptInspectorDrawer";

interface Message {
    id: string;
    sender: "user" | "bot" | "system" | "admin" | "thought";
    content: string;
    created_at: string;
    media_url?: string | null;
    media_type?: string | null;
    ai_debug?: AiDebugData | null;
}

interface MediaPreview {
    src: string;
    type: string;
    label: string;
}

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function AdminChatPage() {
    const params = useParams();
    const telegramChatId = Array.isArray(params.id) ? params.id[0] : params.id;
    const router = useRouter();

    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [session, setSession] = useState<any>(null);
    const [leadOrigin, setLeadOrigin] = useState<any>(null);
    const [latestFunnelStep, setLatestFunnelStep] = useState<string | null>(null);
    const [typingClock, setTypingClock] = useState(() => Date.now());
    const [showThoughts, setShowThoughts] = useState(false);
    const [showSystem, setShowSystem] = useState(false);
    const [showAdvancedView, setShowAdvancedView] = useState(false);
    const [selectedInspectorMessage, setSelectedInspectorMessage] = useState<{
        debugData: AiDebugData | null;
        createdAt?: string;
        thoughtContent?: string;
    } | null>(null);
    const [actionMsg, setActionMsg] = useState("");
    const [forceLoading, setForceLoading] = useState(false);
    const [scoreLoading, setScoreLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [lastSync, setLastSync] = useState<Date | null>(null);
    const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);
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
            await loadLeadOrigin(data);
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
        const timer = window.setInterval(() => setTypingClock(Date.now()), 5000);
        return () => window.clearInterval(timer);
    }, []);

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

    const loadLeadOrigin = async (currentSession: any) => {
        if (!currentSession?.id && !currentSession?.telegram_chat_id) return;

        let row: any = null;
        if (currentSession.telegram_chat_id) {
            const { data } = await supabase
                .from("lead_redirects")
                .select("*")
                .eq("telegram_chat_id", currentSession.telegram_chat_id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
            row = data;
        }

        if (!row && currentSession.id) {
            const { data } = await supabase
                .from("lead_redirects")
                .select("*")
                .eq("session_id", currentSession.id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
            row = data;
        }

        setLeadOrigin(row);
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

    const recalculateScore = async () => {
        if (!session?.id) return;
        setScoreLoading(true);
        setActionMsg("");
        try {
            const response = await fetch("/api/admin/recalculate-scores", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId: session.id }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error || "Falha ao recalcular");
            const { data: freshSession } = await supabase.from("sessions").select("*").eq("id", session.id).single();
            if (freshSession) setSession(freshSession);
            setActionMsg("Barrinhas atualizadas usando todo o histórico do lead.");
        } catch (error: any) {
            setActionMsg(error?.message || "Não foi possível atualizar as barrinhas.");
        } finally {
            setScoreLoading(false);
        }
    };

    const visibleMessages = useMemo(() => {
        return messages.filter((msg) => {
            if (msg.sender === "thought" && !showThoughts && !showAdvancedView) return false;
            if (msg.sender === "system" && !showSystem) return false;
            return true;
        });
    }, [messages, showThoughts, showSystem, showAdvancedView]);

    const leadTyping = useMemo(() => {
        const lastMsg = messages[messages.length - 1];
        return Boolean(lastMsg && lastMsg.sender === "user" && typingClock - new Date(lastMsg.created_at).getTime() <= 20000);
    }, [messages, typingClock]);

    const safeLeadScore = parseLeadScore(session?.lead_score);
    const scoreMeta = parseLeadScoreMeta(session?.lead_score);
    const effectiveFunnelStep = session?.funnel_step || latestFunnelStep || "";
    const leadMemory = useMemo(() => parseLeadMemory(session?.lead_memory), [session?.lead_memory]);
    const originInfo = useMemo(() => buildOriginInfo(session, leadMemory, leadOrigin), [session, leadMemory, leadOrigin]);
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
                            <SegmentButton
                                active={showAdvancedView}
                                onClick={() => setShowAdvancedView((current) => !current)}
                            >
                                ⚡ Visão Avançada
                            </SegmentButton>
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
                            const associatedDebug = findAssociatedDebug(messages, msg);

                            return (
                                <React.Fragment key={msg.id}>
                                    {showDate && (
                                        <div className="flex justify-center py-2">
                                            <span className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-slate-500">
                                                {formatDate(msg.created_at)}
                                            </span>
                                        </div>
                                    )}
                                    <MessageBubble
                                        message={msg}
                                        onOpenMedia={setMediaPreview}
                                        showAdvancedView={showAdvancedView}
                                        associatedDebug={associatedDebug}
                                        onInspectPrompt={(targetMsg, debug) => {
                                            setSelectedInspectorMessage({
                                                debugData: debug || targetMsg.ai_debug || null,
                                                createdAt: targetMsg.created_at,
                                                thoughtContent: targetMsg.sender === "thought" ? targetMsg.content : undefined,
                                            });
                                        }}
                                    />
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

                    <Panel title="Origem">
                        <OriginDetails origin={originInfo} />
                    </Panel>

                    <Panel title="Valor">
                        <p className="text-3xl font-semibold text-emerald-100">{money.format(Number(session?.total_paid || 0))}</p>
                        <p className="mt-1 text-xs text-slate-500">Total pago por este lead</p>
                    </Panel>

                    <Panel title="Score">
                        <ScoreBar label="🔥 Tarado" hint="Interesse sexual, libido e fetiche" value={safeLeadScore.tarado} color="bg-rose-400" />
                        <ScoreBar label="💔 Carência" hint="Busca de afeto, solidão e atenção" value={safeLeadScore.carente} color="bg-cyan-400" />
                        <ScoreBar label="💰 Financeiro" hint="Poder aquisitivo, aparelho e propensão" value={safeLeadScore.financeiro} color="bg-emerald-400" />
                        {scoreMeta && (
                            <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-slate-500">
                                Confiança {scoreMeta.confidence}% · {scoreMeta.message_count} mensagens analisadas · atualizado {formatTimeAgo(scoreMeta.updated_at)}
                            </div>
                        )}
                        <button onClick={recalculateScore} disabled={scoreLoading} className="mt-3 w-full rounded-lg border border-violet-300/30 bg-violet-300/10 px-3 py-2 text-xs font-semibold text-violet-100 transition hover:border-violet-300/60 disabled:opacity-50">
                            {scoreLoading ? "Analisando histórico..." : "Recalcular pelo histórico"}
                        </button>
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
                        <p className="text-sm text-slate-200">{lastMessage ? cleanText(cleanTextForBubble(lastMessage.content)) : "Sem mensagens"}</p>
                        <p className="mt-2 text-xs text-slate-500">{lastMessage ? `${senderName(lastMessage.sender)} / ${formatTimeAgo(lastMessage.created_at)}` : ""}</p>
                    </Panel>
                </div>
            </aside>

            {mediaPreview && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm"
                    onClick={() => setMediaPreview(null)}
                >
                    <button
                        onClick={() => setMediaPreview(null)}
                        className="absolute right-4 top-4 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
                    >
                        Fechar
                    </button>
                    <div className="max-h-[92vh] w-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
                        {mediaPreview.type === "video" ? (
                            <video src={mediaPreview.src} controls autoPlay className="mx-auto max-h-[92vh] w-full object-contain" />
                        ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={mediaPreview.src} alt={mediaPreview.label} className="mx-auto max-h-[92vh] w-full object-contain" />
                        )}
                    </div>
                </div>
            )}

            <PromptInspectorDrawer
                open={Boolean(selectedInspectorMessage)}
                onClose={() => setSelectedInspectorMessage(null)}
                debugData={selectedInspectorMessage?.debugData || null}
                messageCreatedAt={selectedInspectorMessage?.createdAt}
                thoughtContent={selectedInspectorMessage?.thoughtContent}
            />
        </div>
    );
}

function MessageBubble({
    message,
    onOpenMedia,
    showAdvancedView,
    associatedDebug,
    onInspectPrompt,
}: {
    message: Message;
    onOpenMedia: (media: MediaPreview) => void;
    showAdvancedView: boolean;
    associatedDebug: AiDebugData | null;
    onInspectPrompt: (targetMsg: Message, debug?: AiDebugData | null) => void;
}) {
    const isMe = message.sender === "bot" || message.sender === "admin";
    const isSystem = message.sender === "system";
    const isThought = message.sender === "thought";
    const mediaSrc = getMessageMediaSrc(message);
    const displayText = cleanTextForBubble(message.content);
    const effectiveDebug = message.ai_debug || associatedDebug;

    if (isSystem || isThought) {
        return (
            <div className="flex justify-center">
                <div className={`max-w-[92%] rounded-lg border px-3 py-2 text-xs leading-relaxed ${isThought
                    ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
                    : "border-white/10 bg-white/[0.04] text-slate-400"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{isThought ? "IA (Pensamento)" : "Sistema"}: </span>
                        <div className="flex items-center gap-2">
                            {isThought && (showAdvancedView || message.ai_debug) && (
                                <button
                                    type="button"
                                    onClick={() => onInspectPrompt(message, message.ai_debug)}
                                    className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold transition ${message.ai_debug
                                        ? "border border-cyan-400/40 bg-cyan-400/15 text-cyan-200 hover:bg-cyan-400/25"
                                        : "border border-amber-300/30 bg-amber-300/10 text-amber-200 hover:bg-amber-300/20"}`}
                                    title="Inspecionar prompt completo e resposta bruta da IA"
                                >
                                    <span>⚡ {message.ai_debug ? "Ver Prompt & JSON" : "Inspecionar"}</span>
                                    {message.ai_debug?.model && <span className="opacity-75">· {message.ai_debug.model}</span>}
                                    {message.ai_debug?.duration_ms ? <span className="text-emerald-300">· {message.ai_debug.duration_ms}ms</span> : null}
                                </button>
                            )}
                            <span className="text-[10px] opacity-60">{formatTime(message.created_at)}</span>
                        </div>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words">{displayText}</div>
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
                {mediaSrc && (
                    <button
                        type="button"
                        onClick={() => onOpenMedia({ src: mediaSrc, type: getMessageMediaType(message), label: displayText || "Midia do lead" })}
                        className="mb-2 block w-full overflow-hidden rounded-md border border-white/10 bg-black/20 text-left transition hover:border-cyan-300/50"
                        title="Abrir em tamanho grande"
                    >
                        {getMessageMediaType(message) === "video" ? (
                            <video src={mediaSrc} controls preload="metadata" className="max-h-72 w-full object-contain" />
                        ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={mediaSrc} alt="" className="max-h-72 w-full object-contain" />
                        )}
                    </button>
                )}
                {displayText && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{displayText}</p>}

                {message.sender === "bot" && (showAdvancedView || effectiveDebug) && (
                    <div className="mt-2.5 flex justify-end border-t border-white/5 pt-1.5">
                        <button
                            type="button"
                            onClick={() => onInspectPrompt(message, effectiveDebug)}
                            className="flex items-center gap-1.5 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-200 transition hover:border-cyan-400/60 hover:bg-cyan-400/20"
                            title="Inspecionar o prompt completo e a resposta da IA para esta mensagem"
                        >
                            <span>⚡ {effectiveDebug ? "Ver Prompt & Resposta IA" : "Sem dados deste turno"}</span>
                            {effectiveDebug?.model && <span className="opacity-75">· {effectiveDebug.model}</span>}
                            {effectiveDebug?.duration_ms ? <span className="text-emerald-300">· {effectiveDebug.duration_ms}ms</span> : null}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function findAssociatedDebug(messages: Message[], currentMsg: Message): AiDebugData | null {
    if (currentMsg.ai_debug) return currentMsg.ai_debug;
    if (currentMsg.sender === "bot") {
        const msgIndex = messages.findIndex((m) => m.id === currentMsg.id);
        if (msgIndex >= 0) {
            for (let i = msgIndex - 1; i >= 0; i--) {
                const prev = messages[i];
                if (prev.sender === "user") break;
                if (prev.sender === "thought" && prev.ai_debug) {
                    const diffMs = Math.abs(new Date(currentMsg.created_at).getTime() - new Date(prev.created_at).getTime());
                    if (diffMs <= 120_000) {
                        return prev.ai_debug;
                    }
                }
            }
        }
    }
    return null;
}

function getMessageMediaSrc(message: Message) {
    if (message.media_url) return message.media_url;
    if (!getMessageMediaType(message)) return "";
    return `/api/admin/media/${encodeURIComponent(message.id)}`;
}

function getMessageMediaType(message: Message) {
    if (message.media_type === "image" || message.media_type === "video") return message.media_type;
    if (message.media_url) {
        if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(message.media_url)) return "video";
        return "image";
    }
    if (/\[PHOTO_UPLOAD\]/i.test(message.content || "")) return "image";
    if (/\[VIDEO_UPLOAD\]/i.test(message.content || "")) return "video";
    if (/\[MÍDIA/i.test(message.content || "")) {
        return /video/i.test(message.content || "") ? "video" : "image";
    }
    return "";
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

function OriginDetails({ origin }: { origin: ReturnType<typeof buildOriginInfo> }) {
    const params = objectEntries(origin.queryParams);
    const utms = objectEntries(origin.utm);
    const hasData = origin.code || origin.sourceUrl || origin.referer || params.length || utms.length || origin.ip;

    if (!hasData) {
        return <p className="text-sm text-slate-500">Sem origem capturada. Use o link /entrar com UTMs para rastrear os proximos leads.</p>;
    }

    return (
        <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs">
                <Info label="Origem" value={origin.utm.utm_source || "N/A"} />
                <Info label="Campanha" value={origin.utm.utm_campaign || "N/A"} />
                <Info label="Meio" value={origin.utm.utm_medium || "N/A"} />
                <Info label="Click ID" value={origin.utm.fbclid ? "Meta" : origin.utm.ttclid ? "TikTok" : origin.utm.gclid ? "Google" : "N/A"} />
            </div>

            {utms.length > 0 && <KeyValueList title="UTMs e IDs" items={utms} />}
            {params.length > 0 && <KeyValueList title="Parametros" items={params} />}

            <InfoLine label="Codigo" value={origin.code} />
            <InfoLine label="Cidade" value={[origin.city, origin.region, origin.country].filter(Boolean).join(" / ")} />
            <InfoLine label="IP" value={origin.ip} />
            <InfoLine label="Dispositivo" value={origin.device} />
            <InfoLine label="Clique" value={origin.clickedAt ? formatDateTime(origin.clickedAt) : ""} />

            {origin.sourceUrl && (
                <div>
                    <p className="mb-1 text-xs text-slate-500">Link de entrada</p>
                    <a className="block break-words rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-cyan-200 hover:border-cyan-300/40" href={origin.sourceUrl} target="_blank" rel="noreferrer">
                        {shortUrl(origin.sourceUrl)}
                    </a>
                </div>
            )}

            {origin.referer && (
                <div>
                    <p className="mb-1 text-xs text-slate-500">Referer</p>
                    <p className="break-words rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-slate-300">{shortUrl(origin.referer)}</p>
                </div>
            )}
        </div>
    );
}

function KeyValueList({ title, items }: { title: string; items: Array<[string, string]> }) {
    return (
        <div>
            <p className="mb-2 text-xs text-slate-500">{title}</p>
            <div className="space-y-1.5">
                {items.map(([key, value]) => (
                    <div key={`${title}-${key}`} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs">
                        <p className="text-slate-500">{key}</p>
                        <p className="mt-0.5 break-words text-slate-200">{value}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ScoreBar({ label, hint, value, color }: { label: string; hint: string; value: number; color: string }) {
    return (
        <div className="mb-3 last:mb-0">
            <div className="mb-1 flex justify-between text-xs text-slate-400">
                <span>{label}</span>
                <span className="font-semibold text-slate-200">{value}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/40">
                <div className={`h-full rounded-full transition-[width] duration-500 ${color}`} style={{ width: `${value}%` }} />
            </div>
            <p className="mt-1 text-[10px] text-slate-600">{hint}</p>
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

function buildOriginInfo(session: any, leadMemory: Record<string, any>, redirect: any) {
    const metadata = leadMemory?.metadata && typeof leadMemory.metadata === "object" ? leadMemory.metadata : {};
    const redirectMetadata = redirect?.metadata && typeof redirect.metadata === "object" ? redirect.metadata : {};
    const memoryUtm = metadata.redirect_utm && typeof metadata.redirect_utm === "object" ? metadata.redirect_utm : {};
    const rowUtm = redirect?.utm && typeof redirect.utm === "object" ? redirect.utm : {};
    const memoryParams = metadata.redirect_query_params && typeof metadata.redirect_query_params === "object" ? metadata.redirect_query_params : {};
    const rowParams = redirectMetadata.query_params && typeof redirectMetadata.query_params === "object" ? redirectMetadata.query_params : {};

    return {
        code: String(redirect?.code || metadata.redirect_code || ""),
        utm: normalizeObject({ ...memoryUtm, ...rowUtm }),
        queryParams: normalizeObject({ ...memoryParams, ...rowUtm, ...rowParams }),
        sourceUrl: String(redirect?.source_url || metadata.redirect_source_url || ""),
        referer: String(redirect?.referer || metadata.redirect_referer || ""),
        ip: String(redirect?.ip || metadata.redirect_ip || ""),
        city: String(redirect?.city || metadata.redirect_city || session?.user_city || ""),
        region: String(redirect?.region || ""),
        country: String(redirect?.country || metadata.redirect_country || ""),
        device: detectDeviceLabel(String(redirect?.user_agent || metadata.redirect_user_agent || ""), session?.device_type),
        clickedAt: String(redirect?.clicked_at || metadata.redirect_clicked_at || redirect?.created_at || "")
    };
}

function normalizeObject(input: Record<string, unknown>) {
    return Object.fromEntries(
        Object.entries(input || {})
            .map(([key, value]) => [key, value == null ? "" : String(value)])
            .filter(([key, value]) => Boolean(key) && Boolean(value))
    ) as Record<string, string>;
}

function objectEntries(input: Record<string, string>) {
    return Object.entries(input || {}).sort(([a], [b]) => a.localeCompare(b));
}

function detectDeviceLabel(userAgent: string, fallback?: string) {
    const ua = userAgent.toLowerCase();
    if (/iphone|ipad|ios/.test(ua)) return "iPhone";
    if (/android/.test(ua)) return "Android";
    if (/windows|macintosh|linux/.test(ua)) return "Desktop";
    return fallback || "";
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

function formatDateTime(isoString: string) {
    return new Date(isoString).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
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

function cleanTextForBubble(text?: string) {
    const raw = text || "";
    const upload = raw.match(/^\[(PHOTO_UPLOAD|VIDEO_UPLOAD)\]\s+File_ID:\s*[^\s]+(?:\s+CAPTION:\s*([\s\S]*))?$/i);
    if (upload) {
        const caption = upload[2]?.trim();
        if (caption) return caption;
        return upload[1].toUpperCase() === "VIDEO_UPLOAD" ? "🎥 Vídeo recebido do lead" : "📸 Foto recebida do lead";
    }
    const mediaSent = raw.match(/^\[MÍDIA(?:\s+PROTEGIDA)?:\s*([^\]]+)\]/i);
    if (mediaSent) {
        const action = mediaSent[1].trim();
        return action.includes("video") ? `🎥 [Vídeo Enviado ao Lead: ${action}]` : `📸 [Foto Enviada ao Lead: ${action}]`;
    }
    return raw;
}

function shortUrl(value: string) {
    if (value.length <= 180) return value;
    return `${value.slice(0, 150)}...${value.slice(-20)}`;
}
