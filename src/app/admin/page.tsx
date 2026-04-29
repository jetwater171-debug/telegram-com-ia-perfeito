"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

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
    const [filter, setFilter] = useState<"all" | "active" | "paused" | "hot" | "paid">("all");
    const [search, setSearch] = useState("");
    const [phaseFilter, setPhaseFilter] = useState("all");
    const [latestFunnelBySession, setLatestFunnelBySession] = useState<Record<string, string>>({});
    const [lastMessageBySession, setLastMessageBySession] = useState<Record<string, LastMessage>>({});
    const [loading, setLoading] = useState(true);
    const [lastSync, setLastSync] = useState<Date | null>(null);

    useEffect(() => {
        fetchSessions();

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
                if (!msg?.session_id) return;
                setLastMessageBySession((prev) => ({
                    ...prev,
                    [msg.session_id]: {
                        content: msg.content || "",
                        sender: msg.sender || "",
                        created_at: msg.created_at || new Date().toISOString(),
                    },
                }));
                setSessions((prev) => sortSessions(prev.map((s) => (
                    s.id === msg.session_id ? { ...s, last_message_at: msg.created_at || s.last_message_at } : s
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
        return () => {
            window.clearInterval(fallback);
            supabase.removeChannel(channel);
        };
    }, []);

    const fetchSessions = async () => {
        const { data } = await supabase
            .from("sessions")
            .select("*")
            .order("last_message_at", { ascending: false });

        if (!data) {
            setLoading(false);
            return;
        }

        const sessionsData = data as Session[];
        const sessionIds = sessionsData.map((s) => s.id);
        const idsNeedingSteps = sessionsData.filter((s) => !s.funnel_step).map((s) => s.id);

        const [stepMap, lastMessageMap] = await Promise.all([
            idsNeedingSteps.length ? fetchLatestFunnelSteps(idsNeedingSteps) : Promise.resolve({}),
            sessionIds.length ? fetchLatestMessages(sessionIds) : Promise.resolve({}),
        ]);

        setLatestFunnelBySession(stepMap);
        setLastMessageBySession(lastMessageMap);
        setSessions(sortSessions(sessionsData));
        setLastSync(new Date());
        setLoading(false);
    };

    const fetchLatestFunnelSteps = async (sessionIds: string[]) => {
        const { data, error } = await supabase
            .from("funnel_events")
            .select("session_id, step, created_at")
            .in("session_id", sessionIds)
            .order("created_at", { ascending: false });
        if (error || !data) return {};

        const map: Record<string, string> = {};
        for (const row of data as any[]) {
            if (!map[row.session_id]) map[row.session_id] = row.step;
        }
        return map;
    };

    const fetchLatestMessages = async (sessionIds: string[]) => {
        const { data, error } = await supabase
            .from("messages")
            .select("session_id, sender, content, created_at")
            .in("session_id", sessionIds)
            .order("created_at", { ascending: false })
            .limit(Math.max(200, sessionIds.length * 4));
        if (error || !data) return {};

        const map: Record<string, LastMessage> = {};
        for (const row of data as any[]) {
            if (!map[row.session_id]) {
                map[row.session_id] = {
                    content: row.content || "",
                    sender: row.sender || "",
                    created_at: row.created_at || "",
                };
            }
        }
        return map;
    };

    const filteredSessions = useMemo(() => {
        let filtered = sessions;
        if (filter === "active") filtered = filtered.filter((s) => s.status === "active");
        if (filter === "paused") filtered = filtered.filter((s) => s.status === "paused");
        if (filter === "hot") filtered = filtered.filter((s) => getSafeStats(s, lastMessageBySession).tarado >= 70);
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

    const stats = useMemo(() => {
        const paidSessions = sessions.filter((s) => Number(s.total_paid || 0) > 0);
        const revenue = sessions.reduce((sum, s) => sum + Number(s.total_paid || 0), 0);
        const active = sessions.filter((s) => s.status === "active").length;
        const hot = sessions.filter((s) => getSafeStats(s, lastMessageBySession).tarado >= 70).length;
        const waiting = sessions.filter((s) => lastMessageBySession[s.id]?.sender === "user").length;
        return { total: sessions.length, active, hot, waiting, paid: paidSessions.length, revenue };
    }, [sessions, lastMessageBySession]);

    return (
        <div className="min-h-screen bg-[#080b10] text-slate-100">
            <header className="sticky top-0 z-30 border-b border-white/10 bg-[#080b10]/95 backdrop-blur">
                <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-400 text-sm font-black text-slate-950">LM</div>
                        <div>
                            <h1 className="text-lg font-semibold">Painel Lari Morais</h1>
                            <p className="text-xs text-slate-400">
                                {lastSync ? `Ao vivo, sincronizado ${formatTimeAgo(lastSync.toISOString())}` : "Carregando conversas"}
                            </p>
                        </div>
                    </div>
                    <nav className="flex flex-wrap gap-2 text-sm">
                        {[
                            ["/admin/insights", "Insights"],
                            ["/admin/scripts", "Scripts"],
                            ["/admin/previews", "Previas"],
                            ["/admin/variants", "Variacoes"],
                            ["/admin/optimizer", "IA"],
                            ["/admin/settings", "Config"],
                        ].map(([href, label]) => (
                            <Link key={href} href={href} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-200 transition hover:border-cyan-300/40 hover:bg-cyan-300/10">
                                {label}
                            </Link>
                        ))}
                    </nav>
                </div>
            </header>

            <main className="mx-auto grid w-full max-w-[1500px] gap-5 px-4 py-5 lg:grid-cols-[280px_1fr] lg:px-6">
                <aside className="space-y-4 lg:sticky lg:top-[88px] lg:h-[calc(100vh-108px)]">
                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Operacao</p>
                        <div className="mt-4 grid grid-cols-2 gap-3">
                            <Metric label="Conversas" value={stats.total} />
                            <Metric label="Ativas" value={stats.active} accent="text-emerald-200" />
                            <Metric label="Aguardando" value={stats.waiting} accent="text-amber-200" />
                            <Metric label="Quentes" value={stats.hot} accent="text-rose-200" />
                        </div>
                        <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3">
                            <p className="text-xs text-emerald-200">Receita</p>
                            <p className="mt-1 text-xl font-semibold text-emerald-50">{money.format(stats.revenue)}</p>
                            <p className="text-xs text-emerald-200/70">{stats.paid} leads pagos</p>
                        </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Filtros</p>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            {[
                                ["all", "Todos"],
                                ["active", "Ativos"],
                                ["paused", "Pausados"],
                                ["hot", "Quentes"],
                                ["paid", "Pagos"],
                            ].map(([key, label]) => (
                                <button
                                    key={key}
                                    onClick={() => setFilter(key as any)}
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
                            placeholder="Buscar nome, cidade, ID ou mensagem"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="mt-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50"
                        />
                        <select
                            value={phaseFilter}
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
                            <p className="text-sm text-slate-400">Mostrando {filteredSessions.length} de {sessions.length} conversas</p>
                            <h2 className="text-2xl font-semibold tracking-tight">Conversas recentes</h2>
                        </div>
                        <button onClick={fetchSessions} className="w-fit rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-200 transition hover:border-cyan-300/40">
                            Sincronizar agora
                        </button>
                    </div>

                    <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.035]">
                        <div className="hidden grid-cols-[minmax(240px,1.1fr)_minmax(260px,1.4fr)_120px_120px_120px] border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 lg:grid">
                            <span>Lead</span>
                            <span>Ultima mensagem</span>
                            <span>Funil</span>
                            <span>Score</span>
                            <span className="text-right">Valor</span>
                        </div>

                        {loading && <div className="p-8 text-center text-slate-500">Carregando painel...</div>}

                        {!loading && filteredSessions.map((session) => {
                            const safeStats = getSafeStats(session, lastMessageBySession);
                            const last = lastMessageBySession[session.id];
                            const funnelStep = getEffectiveFunnelStep(session, latestFunnelBySession);
                            const waiting = last?.sender === "user";
                            const memory = summarizeMemory(session);

                            return (
                                <Link
                                    key={session.id}
                                    href={`/admin/chat/${session.telegram_chat_id}`}
                                    className="grid gap-3 border-b border-white/10 px-4 py-4 transition last:border-b-0 hover:bg-white/[0.055] lg:grid-cols-[minmax(240px,1.1fr)_minmax(260px,1.4fr)_120px_120px_120px] lg:items-center"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={`h-2.5 w-2.5 rounded-full ${session.status === "active" ? "bg-emerald-300" : "bg-rose-300"}`} />
                                            <h3 className="truncate font-semibold text-slate-100">{session.user_name || "Desconhecido"}</h3>
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
                                            {cleanPreview(last?.content) || "Sem mensagem ainda"}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-500">{formatTimeAgo(last?.created_at || session.last_message_at)}</p>
                                    </div>

                                    <div className="text-xs">
                                        <span className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-slate-300">
                                            {funnelStep ? funnelStep.replace(/_/g, " ") : "INICIO"}
                                        </span>
                                    </div>

                                    <div>
                                        <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                                            <span>Hot</span>
                                            <span>{safeStats.tarado}%</span>
                                        </div>
                                        <div className="h-2 rounded-full bg-black/40">
                                            <div className="h-full rounded-full bg-rose-400" style={{ width: `${safeStats.tarado}%` }} />
                                        </div>
                                        <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                                            <span>Venda</span>
                                            <span>{safeStats.financeiro}%</span>
                                        </div>
                                    </div>

                                    <div className="text-left lg:text-right">
                                        <p className="font-semibold text-emerald-100">{money.format(Number(session.total_paid || 0))}</p>
                                        <p className="text-xs text-slate-500">{translateStatus(session.status)}</p>
                                    </div>
                                </Link>
                            );
                        })}

                        {!loading && filteredSessions.length === 0 && (
                            <div className="p-10 text-center text-slate-500">Nenhum chat encontrado com esse filtro.</div>
                        )}
                    </div>
                </section>
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

function sortSessions(rows: Session[]) {
    return [...rows].sort((a, b) => new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime());
}

function clampStat(n: number) {
    return Math.max(0, Math.min(100, Number(n) || 0));
}

function parseLeadScore(raw: unknown) {
    let stats = raw;
    if (typeof stats === "string") {
        try { stats = JSON.parse(stats); } catch { stats = null; }
    }
    if (!stats || typeof stats !== "object") return null;
    const data = stats as Record<string, unknown>;
    return {
        tarado: clampStat(Number(data.tarado)),
        financeiro: clampStat(Number(data.financeiro)),
        carente: clampStat(Number(data.carente)),
        sentimental: clampStat(Number(data.sentimental)),
    };
}

function getSafeStats(session: Session, lastMessageBySession: Record<string, LastMessage>) {
    const base = { tarado: 5, financeiro: 10, carente: 20, sentimental: 20 };
    const parsed = parseLeadScore(session.lead_score);
    if (parsed && !isAllZero(parsed)) return parsed;
    return applyHeuristicStats(lastMessageBySession[session.id]?.content || "", base);
}

function isAllZero(s: LeadStats) {
    return ["tarado", "financeiro", "carente", "sentimental"].every((key) => Number(s[key as keyof LeadStats] || 0) === 0);
}

function applyHeuristicStats(text: string, current: LeadStats) {
    const s = { ...current };
    const t = (text || "").toLowerCase();
    const inc = (key: keyof LeadStats, val: number) => {
        s[key] = clampStat(s[key] + val);
    };
    if (/(manda.*foto|quero ver|deixa eu ver|foto|video|manda mais)/i.test(t)) inc("tarado", 20);
    if (/(quanto custa|pix|vou comprar|passa o pix|preco|valor|mensal|vitalicio)/i.test(t)) inc("financeiro", 20);
    if (/(bom dia|boa noite|to sozinho|carente|saudade)/i.test(t)) inc("carente", 15);
    if (/(saudade|solidao|carinho|afeto)/i.test(t)) inc("sentimental", 15);
    return s;
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
