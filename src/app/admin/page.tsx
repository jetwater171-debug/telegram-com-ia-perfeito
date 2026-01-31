"use client";
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

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
}

export default function AdminDashboard() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'hot'>('all');
    const [search, setSearch] = useState('');
    const [phaseFilter, setPhaseFilter] = useState('all');
    const [latestFunnelBySession, setLatestFunnelBySession] = useState<Record<string, string>>({});
    const [lastUserBySession, setLastUserBySession] = useState<Record<string, string>>({});

    useEffect(() => {
        fetchSessions();

        const channel = supabase
            .channel('sessions_dashboard')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => {
                fetchSessions();
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, []);

    const clampStat = (n: number) => Math.max(0, Math.min(100, Number(n) || 0));

    const parseLeadScore = (raw: any) => {
        let stats = raw;
        if (typeof stats === 'string') {
            try { stats = JSON.parse(stats); } catch { stats = null; }
        }
        if (!stats || typeof stats !== 'object') return null;
        return {
            tarado: clampStat((stats as any).tarado),
            financeiro: clampStat((stats as any).financeiro),
            carente: clampStat((stats as any).carente),
            sentimental: clampStat((stats as any).sentimental)
        };
    };

    const isAllZero = (s: LeadStats) =>
        (Number(s.tarado) || 0) === 0 &&
        (Number(s.financeiro) || 0) === 0 &&
        (Number(s.carente) || 0) === 0 &&
        (Number(s.sentimental) || 0) === 0;

    const applyHeuristicStats = (text: string, current: LeadStats) => {
        const s = { ...current };
        const t = (text || '').toLowerCase();
        const inc = (key: keyof LeadStats, val: number) => {
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

    const fetchLatestFunnelSteps = async (sessionIds: string[]) => {
        if (!sessionIds.length) return {};
        const { data, error } = await supabase
            .from('funnel_events')
            .select('session_id, step, created_at')
            .in('session_id', sessionIds)
            .order('created_at', { ascending: false });
        if (error || !data) return {};

        const map: Record<string, string> = {};
        for (const row of data as any[]) {
            if (!map[row.session_id]) map[row.session_id] = row.step;
        }
        return map;
    };

    const fetchLatestUserMessages = async (sessionIds: string[]) => {
        if (!sessionIds.length) return {};
        const { data, error } = await supabase
            .from('messages')
            .select('session_id, sender, content, created_at')
            .in('session_id', sessionIds)
            .eq('sender', 'user')
            .order('created_at', { ascending: false });
        if (error || !data) return {};

        const map: Record<string, string> = {};
        for (const row of data as any[]) {
            if (!map[row.session_id] && row.content) {
                map[row.session_id] = row.content;
            }
        }
        return map;
    };

    const fetchSessions = async () => {
        const { data } = await supabase
            .from('sessions')
            .select('*')
            .order('last_message_at', { ascending: false });

        if (!data) return;

        const sessionsData = data as Session[];
        const idsNeedingSteps = sessionsData.filter(s => !s.funnel_step).map(s => s.id);
        const idsNeedingStats = sessionsData.filter(s => {
            const parsed = parseLeadScore(s.lead_score);
            return !parsed || isAllZero(parsed);
        }).map(s => s.id);

        const [stepMap, lastUserMap] = await Promise.all([
            idsNeedingSteps.length ? fetchLatestFunnelSteps(idsNeedingSteps) : Promise.resolve({}),
            idsNeedingStats.length ? fetchLatestUserMessages(idsNeedingStats) : Promise.resolve({})
        ]);

        setLatestFunnelBySession(stepMap);
        setLastUserBySession(lastUserMap);
        setSessions(sessionsData);
    };

    const getSafeStats = (session: Session) => {
        let stats = parseLeadScore(session.lead_score);
        const base = { tarado: 5, financeiro: 10, carente: 20, sentimental: 20 };
        if (!stats) stats = base;
        if (isAllZero(stats)) {
            const lastUserText = lastUserBySession[session.id] || '';
            stats = lastUserText ? applyHeuristicStats(lastUserText, base) : base;
        }

        return {
            tarado: clampStat(stats.tarado ?? base.tarado),
            financeiro: clampStat(stats.financeiro ?? base.financeiro),
            carente: clampStat(stats.carente ?? base.carente),
            sentimental: clampStat(stats.sentimental ?? base.sentimental)
        };
    };

    const getEffectiveFunnelStep = (session: Session) => {
        return session.funnel_step || latestFunnelBySession[session.id] || '';
    };

    const filteredSessions = useMemo(() => {
        let filtered = sessions;

        if (filter === 'active') filtered = filtered.filter(s => s.status === 'active');
        if (filter === 'paused') filtered = filtered.filter(s => s.status === 'paused');
        if (filter === 'hot') filtered = filtered.filter(s => getSafeStats(s).tarado > 70);
        if (phaseFilter !== 'all') filtered = filtered.filter(s => (getEffectiveFunnelStep(s) || '').toUpperCase() === phaseFilter);

        if (search) {
            const lower = search.toLowerCase();
            filtered = filtered.filter(s =>
                (s.user_name || '').toLowerCase().includes(lower) ||
                (s.user_city || '').toLowerCase().includes(lower) ||
                s.telegram_chat_id.includes(lower)
            );
        }

        return filtered;
    }, [sessions, filter, search, phaseFilter, latestFunnelBySession, lastUserBySession]);

    const stats = useMemo(() => {
        return {
            total: sessions.length,
            active: sessions.filter(s => s.status === 'active').length,
            paused: sessions.filter(s => s.status === 'paused').length,
            hot: sessions.filter(s => getSafeStats(s).tarado > 70).length
        };
    }, [sessions, lastUserBySession]);

    const formatTimeAgo = (dateString: string) => {
        if (!dateString) return 'Nunca';
        const date = new Date(dateString);
        const now = new Date();
        const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

        if (diffInSeconds < 60) return 'Agora mesmo';
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m atras`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h atras`;
        return `${Math.floor(diffInSeconds / 86400)}d atras`;
    };

    const translateStatus = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'active': return 'ATIVO';
            case 'closed': return 'FECHADO';
            case 'paused': return 'PAUSADO';
            default: return status?.toUpperCase() || 'N/A';
        }
    };

    return (
        <div className="min-h-screen bg-[#0b0f17] text-gray-100 font-sans">
            <div className="pointer-events-none fixed inset-0">
                <div className="absolute left-[-140px] top-[-160px] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(0,184,148,0.28),_transparent_70%)]" />
                <div className="absolute right-[-160px] top-[120px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(56,189,248,0.20),_transparent_70%)]" />
                <div className="absolute bottom-[-160px] left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,_rgba(255,122,24,0.10),_transparent_70%)]" />
            </div>

            <header className="sticky top-0 z-30 border-b border-white/10 bg-black/30 backdrop-blur">
                <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6">
                    <div className="flex items-center gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/40 to-emerald-400/30 text-cyan-100 font-bold">LM</div>
                        <div>
                            <h1 className="text-xl font-semibold">Painel Lari Morais</h1>
                            <p className="text-sm text-gray-400">Controle total das conversas e conversoes</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="hidden lg:flex items-center gap-2 text-xs font-semibold text-gray-300">
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Total {stats.total}</span>
                            <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-emerald-200">Ativos {stats.active}</span>
                            <span className="rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1 text-rose-200">Quentes {stats.hot}</span>
                            <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-amber-200">Pausados {stats.paused}</span>
                        </div>
                        <Link href="/admin/insights" className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-gray-100 transition hover:border-white/20">
                            Insights
                        </Link>
                        <Link href="/admin/scripts" className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-gray-100 transition hover:border-white/20">
                            Scripts
                        </Link>
                        <Link href="/admin/variants" className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-gray-100 transition hover:border-white/20">
                            Variacoes
                        </Link>
                        <Link href="/admin/optimizer" className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-gray-100 transition hover:border-white/20">
                            IA
                        </Link>
                        <Link href="/admin/settings" className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-gray-100 transition hover:border-white/20">
                            Configuracoes
                        </Link>
                    </div>
                </div>
            </header>

            <main className="mx-auto w-full max-w-7xl px-6 py-10">
                <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
                    <aside className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Filtros</p>
                        <div className="mt-4 flex flex-col gap-2">
                            {['all', 'active', 'paused', 'hot'].map((f) => (
                                <button
                                    key={f}
                                    onClick={() => setFilter(f as any)}
                                    className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${filter === f
                                        ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/30'
                                        : 'text-gray-400 border border-transparent hover:text-gray-200 hover:bg-white/5'}`}
                                >
                                    {f === 'hot' ? 'Quentes' : (f === 'paused' ? 'Pausados' : (f === 'active' ? 'Ativos' : 'Todos'))}
                                </button>
                            ))}
                        </div>

                        <div className="mt-8">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Busca</p>
                            <input
                                type="text"
                                placeholder="Buscar por nome, cidade ou ID"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="mt-3 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                            />
                        </div>

                        <div className="mt-8">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Fase do funil</p>
                            <select
                                value={phaseFilter}
                                onChange={(e) => setPhaseFilter(e.target.value)}
                                className="mt-3 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                            >
                                <option value="all">Todas</option>
                                <option value="WELCOME">WELCOME</option>
                                <option value="CONNECTION">CONNECTION</option>
                                <option value="TRIGGER_PHASE">TRIGGER_PHASE</option>
                                <option value="HOT_TALK">HOT_TALK</option>
                                <option value="PREVIEW">PREVIEW</option>
                                <option value="SALES_PITCH">SALES_PITCH</option>
                                <option value="NEGOTIATION">NEGOTIATION</option>
                                <option value="CLOSING">CLOSING</option>
                                <option value="PAYMENT_CHECK">PAYMENT_CHECK</option>
                            </select>
                        </div>

                        <div className="mt-8 rounded-2xl border border-white/10 bg-black/20 p-4">
                            <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Dica rapida</p>
                            <p className="mt-2 text-sm text-gray-300">Acompanhe os quentes e avance direto para oferta.</p>
                        </div>
                    </aside>

                    <section>
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                            {filteredSessions.map(session => {
                                const safeStats = getSafeStats(session);
                                const funnelStep = getEffectiveFunnelStep(session);

                                return (
                                    <Link key={session.id} href={`/admin/chat/${session.telegram_chat_id}`}
                                        className="group rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur transition hover:border-cyan-400/40 hover:shadow-[0_18px_45px_rgba(0,0,0,0.45)]">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <h2 className="text-lg font-semibold text-gray-100">{session.user_name || 'Desconhecido'}</h2>
                                                <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                                                    <span>{session.user_city || 'N/A'}</span>
                                                    <span>?</span>
                                                    <span>{session.device_type || 'N/A'}</span>
                                                </div>
                                            </div>
                                            <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${session.status === 'active'
                                                ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200'
                                                : 'border-rose-300/30 bg-rose-400/10 text-rose-200'}`}>
                                                {translateStatus(session.status)}
                                            </span>
                                        </div>

                                        <div className="mt-4 space-y-3">
                                            <div>
                                                <div className="mb-1 flex justify-between text-xs text-gray-400">
                                                    <span>Tarado</span><span>{safeStats.tarado}%</span>
                                                </div>
                                                <div className="h-1.5 w-full rounded-full bg-black/30">
                                                    <div className="h-full rounded-full bg-pink-500" style={{ width: `${safeStats.tarado}%` }} />
                                                </div>
                                            </div>
                                            <div>
                                                <div className="mb-1 flex justify-between text-xs text-gray-400">
                                                    <span>Financeiro</span><span>{safeStats.financeiro}%</span>
                                                </div>
                                                <div className="h-1.5 w-full rounded-full bg-black/30">
                                                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${safeStats.financeiro}%` }} />
                                                </div>
                                            </div>
                                            <div>
                                                <div className="mb-1 flex justify-between text-xs text-gray-400">
                                                    <span>Carente</span><span>{safeStats.carente}%</span>
                                                </div>
                                                <div className="h-1.5 w-full rounded-full bg-black/30">
                                                    <div className="h-full rounded-full bg-cyan-500" style={{ width: `${safeStats.carente}%` }} />
                                                </div>
                                            </div>
                                            <div>
                                                <div className="mb-1 flex justify-between text-xs text-gray-400">
                                                    <span>Sentimental</span><span>{safeStats.sentimental}%</span>
                                                </div>
                                                <div className="h-1.5 w-full rounded-full bg-black/30">
                                                    <div className="h-full rounded-full bg-purple-500" style={{ width: `${safeStats.sentimental}%` }} />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                                            <span>{formatTimeAgo(session.last_message_at)}</span>
                                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase text-gray-300">
                                                {funnelStep ? funnelStep.replace(/_/g, ' ') : 'INICIO'}
                                            </span>
                                            <span className="font-mono opacity-60">#{session.telegram_chat_id}</span>
                                        </div>
                                    </Link>
                                );
                            })}

                            {filteredSessions.length === 0 && (
                                <div className="col-span-full rounded-2xl border border-white/10 bg-white/5 p-10 text-center text-gray-500">
                                    Nenhum chat encontrado com esse filtro.
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}
