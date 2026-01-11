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

        // Status Filter
        if (filter === 'active') filtered = filtered.filter(s => s.status === 'active');
        if (filter === 'paused') filtered = filtered.filter(s => s.status === 'paused');
        if (filter === 'hot') filtered = filtered.filter(s => (s.lead_score?.tarado || 0) > 70);

        // Search Filter
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
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m atrás`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h atrás`;
        return `${Math.floor(diffInSeconds / 86400)}d atrás`;
    };

    const getScoreColor = (value: number) => {
        if (value < 30) return 'bg-gray-600';
        if (value < 70) return 'bg-yellow-500';
        return 'bg-pink-500'; // Hot
    };

    return (
        <div className="min-h-screen bg-[#0f111a] text-gray-100 font-sans selection:bg-pink-500 selection:text-white">

            {/* TOP BAR */}
            <header className="bg-[#161b22] border-b border-gray-800 sticky top-0 z-20 shadow-lg">
                <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
                            Lari Morais <span className="text-gray-500 font-normal text-sm ml-2">Admin Dashboard</span>
                        </h1>
                    </div>

                    <div className="flex gap-4 items-center">
                        <div className="hidden md:flex gap-6 text-sm font-medium text-gray-400 mr-8">
                            <div className="flex flex-col items-center">
                                <span className="text-2xl font-bold text-white">{stats.total}</span>
                                <span className="text-xs uppercase tracking-wider">Total</span>
                            </div>
                            <div className="w-px bg-gray-700 h-8"></div>
                            <div className="flex flex-col items-center text-green-400">
                                <span className="text-2xl font-bold">{stats.active}</span>
                                <span className="text-xs uppercase tracking-wider">Online</span>
                            </div>
                            <div className="w-px bg-gray-700 h-8"></div>
                            <div className="flex flex-col items-center text-pink-400">
                                <span className="text-2xl font-bold">{stats.hot}</span>
                                <span className="text-xs uppercase tracking-wider">Hot 🔥</span>
                            </div>
                        </div>

                        <Link href="/admin/settings">
                            <button className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 transition px-4 py-2 rounded-lg text-sm font-medium">
                                ⚙️ Configurações
                            </button>
                        </Link>
                    </div>
                </div>
            </header>

            <div className="max-w-7xl mx-auto px-6 py-8">

                {/* FILTERS & SEARCH */}
                <div className="flex flex-col md:flex-row gap-4 mb-8 justify-between items-end md:items-center">
                    <div className="flex bg-[#161b22] p-1 rounded-lg border border-gray-800 shadow-sm">
                        {['all', 'active', 'paused', 'hot'].map((f) => (
                            <button
                                key={f}
                                onClick={() => setFilter(f as any)}
                                className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${filter === f
                                        ? 'bg-gray-700 text-white shadow-md'
                                        : 'text-gray-400 hover:text-white hover:bg-gray-800'
                                    } first-letter:uppercase`}
                            >
                                {f === 'hot' ? 'Hot Leads 🔥' : (f === 'paused' ? 'Pausados (Manual)' : (f === 'active' ? 'Ativos' : 'Todos'))}
                            </button>
                        ))}
                    </div>

                    <div className="relative w-full md:w-96 group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <span className="text-gray-500">🔍</span>
                        </div>
                        <input
                            type="text"
                            placeholder="Buscar por nome, cidade ou ID..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full bg-[#161b22] border border-gray-800 text-sm rounded-lg py-2.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500 transition shadow-sm group-hover:border-gray-700"
                        />
                    </div>
                </div>

                {/* GRID DE CARDS */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {getFilteredSessions().map(session => (
                        <Link key={session.id} href={`/admin/chat/${session.telegram_chat_id}`}>
                            <div className={`group relative bg-[#161b22] rounded-xl border transition-all duration-300 hover:-translate-y-1 hover:shadow-xl overflow-hidden
                                ${session.status === 'paused' ? 'border-red-900/50 hover:border-red-500/50' : 'border-gray-800 hover:border-pink-500/30'}
                            `}>
                                {/* Status Indicator Strip */}
                                <div className={`absolute top-0 left-0 w-full h-1 ${session.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`} />

                                <div className="p-5">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h2 className="text-lg font-bold text-gray-100 group-hover:text-pink-400 transition">
                                                {session.user_name || "Desconhecido"}
                                            </h2>
                                            <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                                                <span>📍 {session.user_city || "N/A"}</span>
                                                <span>•</span>
                                                <span>📱 {session.device_type || "N/A"}</span>
                                            </div>
                                        </div>
                                        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide border
                                            ${session.status === 'active'
                                                ? 'bg-green-900/20 text-green-400 border-green-900/50'
                                                : 'bg-red-900/20 text-red-400 border-red-900/50'}
                                        `}>
                                            {session.status}
                                        </span>
                                    </div>

                                    {/* Stats Grid */}
                                    <div className="grid grid-cols-2 gap-3 mb-4">
                                        <div className="bg-gray-800/50 p-2 rounded border border-gray-800">
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-gray-400">🔥 Tarado</span>
                                                <span className="font-bold">{session.lead_score?.tarado || 0}%</span>
                                            </div>
                                            <div className="w-full bg-gray-700 h-1.5 rounded-full overflow-hidden">
                                                <div className={`h-full ${getScoreColor(session.lead_score?.tarado || 0)}`} style={{ width: `${session.lead_score?.tarado || 0}%` }}></div>
                                            </div>
                                        </div>
                                        <div className="bg-gray-800/50 p-2 rounded border border-gray-800">
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-gray-400">💰 Financeiro</span>
                                                <span className="font-bold">{session.lead_score?.financeiro || 0}%</span>
                                            </div>
                                            <div className="w-full bg-gray-700 h-1.5 rounded-full overflow-hidden">
                                                <div className="h-full bg-green-500" style={{ width: `${session.lead_score?.financeiro || 0}%` }}></div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex justify-between items-center text-xs text-gray-500 pt-4 border-t border-gray-800">
                                        <div className="flex items-center gap-1">
                                            <span>🕒</span>
                                            <span>{formatTimeAgo(session.last_message_at)}</span>
                                        </div>
                                        <div className="font-mono opacity-50">
                                            #{session.telegram_chat_id}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </Link>
                    ))}

                    {getFilteredSessions().length === 0 && (
                        <div className="col-span-full py-12 text-center text-gray-500 flex flex-col items-center">
                            <div className="text-4xl mb-4">💤</div>
                            <p className="text-lg">Nenhum chat encontrado com esse filtro.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
