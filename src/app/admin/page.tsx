"use client";
import { useEffect, useState } from 'react';
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
    const [stats, setStats] = useState({ total: 0, active: 0, paused: 0, hot: 0 });

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
            const loadedSessions = data as Session[];
            setSessions(loadedSessions);
            calculateStats(loadedSessions);
        }
    };

    const calculateStats = (data: Session[]) => {
        setStats({
            total: data.length,
            active: data.filter(s => s.status === 'active').length,
            paused: data.filter(s => s.status === 'paused').length,
            hot: data.filter(s => (s.lead_score?.tarado || 0) > 70).length
        });
    };

    const getFilteredSessions = () => {
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
    };

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

    const getSafeStats = (session: Session) => {
        let stats = session.lead_score;

        if (typeof stats === 'string') {
            try {
                stats = JSON.parse(stats);
            } catch (e) {
                stats = null as any;
            }
        }

        const base = { tarado: 5, financeiro: 10, carente: 20, sentimental: 20 };
        if (!stats) stats = base as any;

        const isAllZero = (s: any) =>
            (Number(s.tarado) || 0) === 0 &&
            (Number(s.financeiro) || 0) === 0 &&
            (Number(s.carente) || 0) === 0 &&
            (Number(s.sentimental) || 0) === 0;

        if (isAllZero(stats)) stats = base as any;

        const clamp = (n: number) => Math.max(0, Math.min(100, Number(n) || 0));

        return {
            tarado: clamp((stats as any).tarado ?? base.tarado),
            financeiro: clamp((stats as any).financeiro ?? base.financeiro),
            carente: clamp((stats as any).carente ?? base.carente),
            sentimental: clamp((stats as any).sentimental ?? base.sentimental)
        };
    };

    return (
        <div className="min-h-screen bg-[#0f111a] text-gray-100 font-sans">
            <header className="border-b border-gray-800 bg-[#12161f]">
                <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6">
                    <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/20 text-cyan-300 font-bold">LM</div>
                        <div>
                            <h1 className="text-xl font-semibold">Painel Lari Morais</h1>
                            <p className="text-sm text-gray-400">Visao geral dos leads e status</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="hidden md:flex items-center gap-2 text-xs font-semibold text-gray-300">
                            <span className="rounded-full border border-gray-700 bg-gray-800/60 px-3 py-1">Total {stats.total}</span>
                            <span className="rounded-full border border-emerald-700/50 bg-emerald-900/30 px-3 py-1 text-emerald-300">Ativos {stats.active}</span>
                            <span className="rounded-full border border-rose-700/50 bg-rose-900/30 px-3 py-1 text-rose-300">Quentes {stats.hot}</span>
                        </div>
                        <Link href="/admin/settings" className="rounded-full border border-gray-700 bg-gray-800/60 px-4 py-2 text-sm font-semibold text-gray-200 transition hover:border-gray-600">
                            Configuracoes
                        </Link>
                    </div>
                </div>
            </header>

            <div className="mx-auto w-full max-w-7xl px-6 py-8">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center rounded-full border border-gray-800 bg-[#141820] p-1">
                        {['all', 'active', 'paused', 'hot'].map((f) => (
                            <button
                                key={f}
                                onClick={() => setFilter(f as any)}
                                className={`rounded-full px-4 py-2 text-xs font-semibold transition ${filter === f
                                    ? 'bg-cyan-500/20 text-cyan-200'
                                    : 'text-gray-400 hover:text-gray-200'
                                    }`}
                            >
                                {f === 'hot' ? 'Quentes' : (f === 'paused' ? 'Pausados' : (f === 'active' ? 'Ativos' : 'Todos'))}
                            </button>
                        ))}
                    </div>

                    <div className="relative w-full md:w-96">
                        <input
                            type="text"
                            placeholder="Buscar por nome, cidade ou ID..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full rounded-2xl border border-gray-800 bg-[#141820] px-4 py-2.5 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                        />
                    </div>
                </div>

                <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {getFilteredSessions().map(session => {
                        const safeStats = getSafeStats(session);

                        return (
                            <Link key={session.id} href={`/admin/chat/${session.telegram_chat_id}`}
                                className="group rounded-3xl border border-gray-800/80 bg-[#141820] p-5 transition hover:border-cyan-500/40 hover:shadow-lg">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <h2 className="text-lg font-semibold text-gray-100">{session.user_name || 'Desconhecido'}</h2>
                                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                                            <span>{session.user_city || 'N/A'}</span>
                                            <span>-</span>
                                            <span>{session.device_type || 'N/A'}</span>
                                        </div>
                                    </div>
                                    <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${session.status === 'active'
                                        ? 'border-emerald-800/60 bg-emerald-900/30 text-emerald-300'
                                        : 'border-rose-800/60 bg-rose-900/30 text-rose-300'}`}>
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

                    {getFilteredSessions().length === 0 && (
                        <div className="col-span-full rounded-2xl border border-gray-800/80 bg-[#141820] p-10 text-center text-gray-500">
                            Nenhum chat encontrado com esse filtro.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
