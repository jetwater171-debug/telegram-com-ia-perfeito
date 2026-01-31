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
    lead_score: LeadStats;
    user_city: string;
    device_type: string;
    total_paid: number;
}

export default function AdminDashboard() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'hot'>('all');
    const [search, setSearch] = useState('');

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

    const fetchSessions = async () => {
        const { data } = await supabase
            .from('sessions')
            .select('*')
            .order('last_message_at', { ascending: false });

        if (data) {
            setSessions(data as Session[]);
        }
    };

    const getSafeStats = (session: Session) => {
        let stats = session.lead_score as any;
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

        const clamp = (n: number) => Math.max(0, Math.min(100, Number(n) || 0));
        return {
            tarado: clamp(stats.tarado ?? base.tarado),
            financeiro: clamp(stats.financeiro ?? base.financeiro),
            carente: clamp(stats.carente ?? base.carente),
            sentimental: clamp(stats.sentimental ?? base.sentimental)
        };
    };

    const filteredSessions = useMemo(() => {
        let filtered = sessions;

        if (filter === 'active') filtered = filtered.filter(s => s.status === 'active');
        if (filter === 'paused') filtered = filtered.filter(s => s.status === 'paused');
        if (filter === 'hot') filtered = filtered.filter(s => (s.lead_score?.tarado || 0) > 70);

        if (search) {
            const lower = search.toLowerCase();
            filtered = filtered.filter(s =>
                (s.user_name || '').toLowerCase().includes(lower) ||
                (s.user_city || '').toLowerCase().includes(lower) ||
                s.telegram_chat_id.includes(lower)
            );
        }

        return filtered;
    }, [sessions, filter, search]);

    const stats = useMemo(() => {
        return {
            total: sessions.length,
            active: sessions.filter(s => s.status === 'active').length,
            paused: sessions.filter(s => s.status === 'paused').length,
            hot: sessions.filter(s => (s.lead_score?.tarado || 0) > 70).length
        };
    }, [sessions]);

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
        <div className="min-h-screen bg-gradient-to-br from-[#0b0f18] via-[#0c1220] to-[#0b0f18] text-gray-100 font-sans">
            <header className="border-b border-white/5 bg-black/20 backdrop-blur">
                <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-8">
                    <div className="flex items-center gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/30 to-emerald-400/30 text-cyan-200 font-bold">LM</div>
                        <div>
                            <h1 className="text-xl font-semibold">Painel Lari Morais</h1>
                            <p className="text-sm text-gray-400">Acompanhe a conversao em tempo real</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="hidden md:flex items-center gap-2 text-xs font-semibold text-gray-300">
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Total {stats.total}</span>
                            <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-emerald-200">Ativos {stats.active}</span>
                            <span className="rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1 text-rose-200">Quentes {stats.hot}</span>
                            <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-amber-200">Pausados {stats.paused}</span>
                        </div>
                        <Link href="/admin/settings" className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-gray-100 transition hover:border-white/20">
                            Configuracoes
                        </Link>
                    </div>
                </div>
            </header>

            <div className="mx-auto w-full max-w-7xl px-6 py-10">
                <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
                    <aside className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Filtros</p>
                        <div className="mt-3 flex flex-col gap-2">
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

                        <div className="mt-6">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Busca</p>
                            <input
                                type="text"
                                placeholder="Buscar por nome, cidade ou ID"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                            />
                        </div>
                    </aside>

                    <section>
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                            {filteredSessions.map(session => {
                                const safeStats = getSafeStats(session);

                                return (
                                    <Link key={session.id} href={`/admin/chat/${session.telegram_chat_id}`}
                                        className="group rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur transition hover:border-cyan-400/40 hover:shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
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
            </div>
        </div>
    );
}
