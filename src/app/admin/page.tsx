"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { BASE_LEAD_SCORE, parseLeadScore, parseLeadScoreMeta } from "@/lib/leadScoring";

interface LeadStats {
    tarado: number;
    carente: number;
    sentimental: number;
    financeiro: number;
}

interface Session {
    id: string;
    telegram_chat_id: string;
    user_name: string;
    status: string;
    last_message_at: string;
    lead_score: LeadStats | null | string;
    user_city: string;
    device_type: string;
    total_paid: number;
    funnel_step?: string;
    lead_memory?: unknown;
}

interface LastMessage {
    content: string;
    sender: string;
    created_at: string;
    media_type?: string;
}

const FUNNEL_STEPS = [
    "WELCOME",
    "CONNECTION",
    "TRIGGER_PHASE",
    "HOT_TALK",
    "PREVIEW",
    "SALES_PITCH",
    "NEGOTIATION",
    "CLOSING",
    "PAYMENT_CHECK",
];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function AdminDashboard() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [filter, setFilter] = useState<"all" | "active" | "paused" | "hot" | "paid" | "blocked">("all");
    const [search, setSearch] = useState("");
    const [phaseFilter, setPhaseFilter] = useState("all");
    const [latestFunnelBySession, setLatestFunnelBySession] = useState<Record<string, string>>({});
    const [lastMessageBySession, setLastMessageBySession] = useState<Record<string, LastMessage>>({});
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [visibleCount, setVisibleCount] = useState(50);
    const fetching = useRef(false);
    const syncingPayments = useRef(false);
    const [lastSync, setLastSync] = useState<Date | null>(null);
    const [recalculating, setRecalculating] = useState(false);
    const [scoreMessage, setScoreMessage] = useState("");
    const [reengaging, setReengaging] = useState(false);
    const [reengageMessage, setReengageMessage] = useState("");

    useEffect(() => {
        fetchSessions();
        syncPayments();

        const channel = supabase
            .channel("admin_live_dashboard")
            .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, (payload) => {
                const row = payload.new as Session | null;
                if (payload.eventType === "DELETE") {
                    const oldRow = payload.old as Session;
                    setSessions((prev) => prev.filter((s) => s.id !== oldRow.id));
                    return;
                }
                if (!row?.id) {
                    fetchSessions();
                    return;
                }
                setSessions((prev) => {
                    const exists = prev.some((s) => s.id === row.id);
                    const next = exists ? prev.map((s) => (s.id === row.id ? { ...s, ...row } : s)) : [row, ...prev];
                    return sortSessions(next);
                });
                setLastSync(new Date());
            })
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
                const msg = payload.new as any;
                if (!msg?.session_id || !["user", "bot", "admin"].includes(msg.sender)) return;
                setLastMessageBySession((prev) => prev[msg.session_id]?.created_at > msg.created_at ? prev : ({
                    ...prev,
                    [msg.session_id]: {
                        content: msg.content || "",
                        sender: msg.sender || "",
                        created_at: msg.created_at || new Date().toISOString(),
                        media_type: msg.media_type,
                    },
                }));
                setSessions((prev) => sortSessions(prev.map((s) => (
                    s.id === msg.session_id && msg.created_at > s.last_message_at ? { ...s, last_message_at: msg.created_at } : s
                ))));
                setLastSync(new Date());
            })
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "funnel_events" }, (payload) => {
                const row = payload.new as any;
                if (!row?.session_id || !row?.step) return;
                setLatestFunnelBySession((prev) => ({ ...prev, [row.session_id]: row.step }));
            })
            .subscribe();

        const fallback = window.setInterval(fetchSessions, 30000);
        const paymentFallback = window.setInterval(syncPayments, 30000);
        return () => {
            window.clearInterval(fallback);
            window.clearInterval(paymentFallback);
            supabase.removeChannel(channel);
        };
    }, []);

    const syncPayments = async () => {
        if (syncingPayments.current) return;
        syncingPayments.current = true;
        // A WiinPay nem sempre entrega webhook. O painel força uma conciliação
        // idempotente em paralelo, sem bloquear a abertura das conversas.
        try {
            const syncResponse = await fetch("/api/admin/payment-sync", {
                method: "POST",
                cache: "no-store",
            });
            if (!syncResponse.ok) console.warn("Falha ao sincronizar pagamentos no painel");
        } catch (error) {
            console.warn("Sincronização de pagamentos indisponível", error);
        } finally {
            syncingPayments.current = false;
        }
    };

    const fetchSessions = async () => {
        if (fetching.current) return;
        fetching.current = true;
        try {
            const rows: Session[] = [];
            const batchSize = 500;
            for (let offset = 0; ; offset += batchSize) {
                const { data, error } = await supabase.from("sessions")
                    .select("id,telegram_chat_id,user_name,status,last_message_at,lead_score,user_city,device_type,total_paid,funnel_step")
                    .order("last_message_at", { ascending: false, nullsFirst: false })
                    .order("id", { ascending: true })
                    .range(offset, offset + batchSize - 1);
                if (error) throw error;
                rows.push(...(data || []));
                if (!data || data.length < batchSize) break;
            }
            setSessions(sortSessions(rows));
            setLastSync(new Date());
            setLoadError("");
        } catch (error) {
            console.error("Falha ao carregar conversas", error);
            setLoadError("Não foi possível atualizar as conversas. Tente sincronizar novamente.");
        } finally {
            fetching.current = false;
            setLoading(false);
        }
    };

    const recalculateScores = async () => {
        setRecalculating(true);
        setScoreMessage("");
        try {
            const response = await fetch("/api/admin/recalculate-scores", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error || "Falha ao recalcular");
            setScoreMessage(`${data.updated || 0} conversas analisadas pelo histórico`);
            await fetchSessions();
        } catch (error: any) {
            setScoreMessage(error?.message || "Não foi possível atualizar os scores");
        } finally {
            setRecalculating(false);
        }
    };

    const handleReengageLeads = async () => {
        if (reengaging) return;
        setReengaging(true);
        setReengageMessage("");
        try {
            const response = await fetch("/api/admin/reengage-leads", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error || "Falha ao chamar leads");
            setReengageMessage(data.message || `${data.sentCount || 0} leads chamados!`);
            await fetchSessions();
        } catch (error: any) {
            setReengageMessage(error?.message || "Não foi possível chamar os leads");
        } finally {
            setReengaging(false);
        }
    };

    useEffect(() => { setVisibleCount(50); }, [filter, search, phaseFilter]);

    const filteredSessions = useMemo(() => {
        let filtered = sessions;
        if (filter === "active") filtered = filtered.filter((s) => s.status === "active");
        if (filter === "blocked") filtered = filtered.filter((s) => s.status === "blocked");
        if (filter === "paused") filtered = filtered.filter((s) => s.status === "paused");
        if (filter === "hot") filtered = filtered.filter((s) => getSafeStats(s).tarado >= 70);
        if (filter === "paid") filtered = filtered.filter((s) => Number(s.total_paid || 0) > 0);
        if (phaseFilter !== "all") {
            filtered = filtered.filter((s) => getEffectiveFunnelStep(s, latestFunnelBySession).toUpperCase() === phaseFilter);
        }
        if (search.trim()) {
            const lower = search.trim().toLowerCase();
            filtered = filtered.filter((s) => {
                const last = lastMessageBySession[s.id]?.content || "";
                return (
                    (s.user_name || "").toLowerCase().includes(lower) ||
                    (s.user_city || "").toLowerCase().includes(lower) ||
                    (s.device_type || "").toLowerCase().includes(lower) ||
                    (s.telegram_chat_id || "").includes(lower) ||
                    last.toLowerCase().includes(lower)
                );
            });
        }
        return filtered;
    }, [sessions, filter, search, phaseFilter, latestFunnelBySession, lastMessageBySession]);

    const previewIds = filteredSessions.slice(0, visibleCount).filter(s => s.status !== "blocked").map(s => s.id).join(",");
    const [previewState, setPreviewState] = useState<Record<string, "loaded" | "error">>({});
    useEffect(() => {
        let cancelled = false;
        const ids = previewIds ? previewIds.split(",") : [];
        // Keep the list independent of previews and avoid schema-cache joins.
        const worker = async () => {
            while (ids.length && !cancelled) {
                const id = ids.shift()!;
                const { data, error } = await supabase.from("messages")
                    .select("content,sender,created_at,media_type")
                    .eq("session_id", id).in("sender", ["user", "bot", "admin"])
                    .order("created_at", { ascending: false }).limit(1);
                if (cancelled) return;
                setPreviewState(prev => ({ ...prev, [id]: error ? "error" : "loaded" }));
                if (!error) setLastMessageBySession(prev => {
                    const message = data?.[0] as LastMessage | undefined;
                    if (!message || (prev[id]?.created_at || "") > message.created_at) return prev;
                    return { ...prev, [id]: message };
                });
            }
        };
        void Promise.all(Array.from({ length: 6 }, worker));
        return () => { cancelled = true; };
    }, [previewIds, lastSync]);

    const stats = useMemo(() => {
        const paidSessions = sessions.filter((s) => Number(s.total_paid || 0) > 0);
        const revenue = sessions.reduce((sum, s) => sum + Number(s.total_paid || 0), 0);
        const active = sessions.filter((s) => s.status === "active").length;
        const hot = sessions.filter((s) => getSafeStats(s).tarado >= 70).length;
        const waiting = sessions.filter((s) => lastMessageBySession[s.id]?.sender === "user").length;
        return { total: sessions.length, active, hot, waiting, paid: paidSessions.length, revenue };
    }, [sessions, lastMessageBySession]);

    return (
        <div className="min-h-screen bg-[#080b10] text-slate-100">
            <main className="mx-auto w-full max-w-[1500px] px-4 py-6 lg:px-6">
                <header className="admin-page-header mb-5 sm:flex-row sm:items-end sm:justify-between">
                    <div><p className="admin-eyebrow">Caixa de entrada</p><h1 className="admin-page-title">Conversas</h1><p className="admin-page-subtitle">Priorize quem está aguardando, acompanhe a trajetória e intervenha somente quando necessário.</p></div>
                    <p className="text-xs text-slate-500">{lastSync ? `Sincronizado ${formatTimeAgo(lastSync.toISOString())}` : 'Sincronizando dados...'}</p>
                </header>
                <div className="space-y-6">
                <aside className="space-y-5">
                    <div className="admin-overview"><div className="admin-overview-metrics">
                            <Metric label="Conversas" value={stats.total} />
                            <Metric label="Ativas" value={stats.active} accent="text-emerald-200" />
                            <Metric label="Aguardando" value={stats.waiting} accent="text-amber-200" />
                            <Metric label="Quentes" value={stats.hot} accent="text-rose-200" /><Metric label="Bloquearam" value={sessions.filter(s => s.status === "blocked").length} />
                        </div>
                        <div className="admin-revenue">
                            <p className="text-xs text-emerald-200">Receita</p>
                            <p className="mt-1 text-xl font-semibold text-emerald-50">{money.format(stats.revenue)}</p>
                            <p className="text-xs text-emerald-200/70">{stats.paid} leads pagos</p>
                        </div>
                    </div>

                    <div className="admin-filterbar"><div className="admin-filter-tabs" aria-label="Filtrar conversas">
                            {[
                                ["all", "Todos"],
                                ["active", "Ativos"],
                                ["paused", "Pausados"],
                                ["hot", "Quentes"],
                                ["paid", "Pagos"], ["blocked", "BLOQUEOU"],
                            ].map(([key, label]) => (
                                <button
                                    key={key}
                                    onClick={() => setFilter(key as any)} aria-pressed={filter === key}
                                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${filter === key
                                        ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                                        : "border-white/10 bg-black/20 text-slate-400 hover:text-slate-100"}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <input
                            type="text"
                            aria-label="Buscar conversas" placeholder="Buscar nome ou ID..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="mt-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50"
                        />
                        <select
                            aria-label="Filtrar por fase" value={phaseFilter}
                            onChange={(e) => setPhaseFilter(e.target.value)}
                            className="mt-3 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-cyan-300/50"
                        >
                            <option value="all">Todas as fases</option>
                            {FUNNEL_STEPS.map((step) => (
                                <option key={step} value={step}>{step.replace(/_/g, " ")}</option>
                            ))}
                        </select>
                    </div>
                </aside>

                <section className="min-w-0">
                    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <p className="text-sm text-slate-400">Mostrando {Math.min(visibleCount, filteredSessions.length)} de {filteredSessions.length} conversas · {sessions.length} no total</p>
                            <h2 className="text-lg font-medium tracking-tight">Conversas recentes</h2>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {scoreMessage && <span className="text-xs text-cyan-200">{scoreMessage}</span>}
                            {reengageMessage && <span className="text-xs font-medium text-pink-200">{reengageMessage}</span>}
                            <button
                                onClick={handleReengageLeads}
                                disabled={reengaging}
                                title="Envia mensagem direta para todos os leads sem falar há mais de 1 hora"
                                className="flex items-center gap-1.5 rounded-lg border border-pink-400/30 bg-pink-400/15 px-3 py-2 text-sm font-semibold text-pink-100 transition hover:border-pink-400/60 hover:bg-pink-400/25 disabled:opacity-50"
                            >
                                <span>💬</span>
                                <span>{reengaging ? "Chamando leads..." : "Reativar elegíveis"}</span>
                            </button>
                            <button onClick={recalculateScores} disabled={recalculating} className="rounded-lg border border-violet-300/30 bg-violet-300/10 px-3 py-2 text-sm font-semibold text-violet-100 transition hover:border-violet-300/60 disabled:opacity-50">
                                {recalculating ? "Analisando histórico..." : "Recalcular sinais"}
                            </button>
                            <button onClick={fetchSessions} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-200 transition hover:border-cyan-300/40">
                                Sincronizar
                            </button>
                        </div>
                    </div>

                    {loadError && <p role="alert" className="rounded-lg border border-amber-300/30 p-3 text-sm text-amber-200">{loadError}</p>}
                    <div className="admin-card overflow-hidden">
                        <div className="admin-lead-columns admin-lead-heading border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            <span>Lead</span>
                            <span>Ultima mensagem</span>
                            <span>Funil</span>
                            <span>Score</span>
                            <span className="text-right">Valor</span>
                        </div>

                        {loading && <div className="p-8 text-center text-slate-500">Carregando painel...</div>}

                        {!loading && filteredSessions.slice(0, visibleCount).map((session) => {
                            const safeStats = getSafeStats(session);
                            const last = lastMessageBySession[session.id];
                            const funnelStep = getEffectiveFunnelStep(session, latestFunnelBySession);
                            const waiting = last?.sender === "user";
                            const memory = summarizeMemory(session);
                            const scoreMeta = parseLeadScoreMeta(session.lead_score);

                            return (
                                <Link
                                    key={session.id}
                                    prefetch={false}
                                    href={`/admin/chat/${session.telegram_chat_id}`}
                                    className="admin-lead-columns gap-4 border-b border-white/10 px-4 py-5 transition last:border-b-0 hover:bg-white/[0.025]"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={`h-2.5 w-2.5 rounded-full ${session.status === "active" ? "bg-emerald-300" : "bg-rose-300"}`} />
                                            <h3 className="truncate font-semibold text-slate-100">{session.status === "blocked" ? "Lead removido" : session.user_name || "Desconhecido"}</h3>
                                            {waiting && <span className="rounded-md bg-amber-300/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100">RESPONDER</span>}
                                        </div>
                                        <p className="mt-1 truncate text-xs text-slate-500">
                                            {session.user_city || "Sem cidade"} / {session.device_type || "N/A"} / #{session.telegram_chat_id}
                                        </p>
                                        {memory && <p className="mt-1 truncate text-xs text-cyan-200/80">{memory}</p>}
                                    </div>

                                    <div className="min-w-0">
                                        <p className="truncate text-sm text-slate-200">
                                            <span className="text-slate-500">{labelSender(last?.sender)} </span>
                                            {session.status === "blocked" ? "BLOQUEOU · Histórico apagado" : cleanPreview(last?.content) || (last ? last.media_type === "audio" ? "Áudio" : last.media_type === "photo" ? "Foto" : last.media_type === "video" ? "Vídeo" : "Mensagem sem texto" : previewState[session.id] === "loaded" ? "Sem mensagem ainda" : previewState[session.id] === "error" ? "Prévia indisponível · abra a conversa" : "Carregando mensagem…")}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-500">{formatTimeAgo(last?.created_at || session.last_message_at)}</p>
                                    </div>

                                    <div className="text-xs">
                                        <span className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-slate-300">
                                            {session.status === 'blocked' ? '—' : funnelStep ? funnelStep.replace(/_/g, " ") : "INÍCIO"}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-3 gap-x-2 gap-y-2">
                                        {session.status === 'blocked' ? <span className="col-span-3 text-xs text-slate-500">Dados removidos</span> : <>
                                        <MiniScoreBar label="🔥 Abertura" value={safeStats.tarado} color="bg-rose-400" />
                                        <MiniScoreBar label="💬 Conexão" value={safeStats.carente} color="bg-cyan-400" />
                                        <MiniScoreBar label="💰 Intenção" value={safeStats.financeiro} color="bg-emerald-400" />
                                        {scoreMeta && <p className="col-span-3 text-[10px] text-slate-600">Confiança {scoreMeta.confidence}% · {scoreMeta.message_count} mensagens</p>}
                                        </>}
                                    </div>

                                    <div className="text-left lg:text-right">
                                        <p className="font-semibold text-emerald-100">{money.format(Number(session.total_paid || 0))}</p>
                                        <p className="text-xs text-slate-500">{translateStatus(session.status)}</p>
                                    </div>
                                </Link>
                            );
                        })}

                        {!loading && !loadError && filteredSessions.length === 0 && (
                            <div className="p-10 text-center text-slate-500">Nenhum chat encontrado com esse filtro.</div>
                        )}
                    </div>
                    {!loading && visibleCount < filteredSessions.length && <button onClick={() => setVisibleCount((count) => count + 50)} className="rounded-lg border border-white/10 px-4 py-3 text-sm text-cyan-200">Mostrar mais 50 conversas</button>}
                </section>
                </div>
            </main>
        </div>
    );
}

function Metric({ label, value, accent = "text-slate-100" }: { label: string; value: number; accent?: string }) {
    return (
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-1 text-2xl font-semibold ${accent}`}>{value}</p>
        </div>
    );
}

function MiniScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div>
            <div className="mb-1 flex justify-between text-[10px] text-slate-500"><span>{label}</span><span>{value}%</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-black/40">
                <div className={`h-full rounded-full transition-[width] duration-500 ${color}`} style={{ width: `${value}%` }} />
            </div>
        </div>
    );
}

function sortSessions(rows: Session[]) {
    return [...rows].sort((a, b) => new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime());
}

function getSafeStats(session: Session) {
    const parsed = parseLeadScore(session.lead_score);
    if (parsed && !isAllZero(parsed)) return parsed;
    return { ...BASE_LEAD_SCORE };
}

function isAllZero(s: LeadStats) {
    return ["tarado", "financeiro", "carente", "sentimental"].every((key) => Number(s[key as keyof LeadStats] || 0) === 0);
}

function getEffectiveFunnelStep(session: Session, latestFunnelBySession: Record<string, string>) {
    return session.funnel_step || latestFunnelBySession[session.id] || "";
}

function parseLeadMemory(raw: unknown) {
    if (!raw) return {};
    if (typeof raw === "string") {
        try { return JSON.parse(raw); } catch { return {}; }
    }
    return typeof raw === "object" ? raw as Record<string, unknown> : {};
}

function summarizeMemory(session: Session) {
    const memory = parseLeadMemory(session.lead_memory) as any;
    const wanted = Array.isArray(memory.wanted_products) ? memory.wanted_products.slice(0, 2).join(", ") : "";
    const rejected = Array.isArray(memory.rejected_products) ? memory.rejected_products.slice(0, 1).join(", ") : "";
    const type = memory.dominant_type && memory.dominant_type !== "desconhecido" ? memory.dominant_type : "";
    return [type, wanted ? `quer ${wanted}` : "", rejected ? `recusou ${rejected}` : ""].filter(Boolean).join(" / ");
}

function formatTimeAgo(dateString?: string) {
    if (!dateString) return "Nunca";
    const diffInSeconds = Math.max(0, Math.floor((Date.now() - new Date(dateString).getTime()) / 1000));
    if (diffInSeconds < 20) return "agora";
    if (diffInSeconds < 60) return `${diffInSeconds}s atras`;
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m atras`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h atras`;
    return `${Math.floor(diffInSeconds / 86400)}d atras`;
}

function translateStatus(status: string) {
    if (status === "blocked") return "BLOQUEOU";
    if (status === "active") return "Ativo";
    if (status === "paused") return "Pausado";
    if (status === "closed") return "Fechado";
    return status || "N/A";
}

function labelSender(sender?: string) {
    if (sender === "user") return "Lead:";
    if (sender === "bot") return "Lari:";
    if (sender === "admin") return "Voce:";
    if (sender === "system") return "Sistema:";
    if (sender === "thought") return "IA:";
    return "";
}

function cleanPreview(content?: string) {
    return (content || "").replace(/\s+/g, " ").trim();
}
