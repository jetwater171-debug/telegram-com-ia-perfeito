"use client";
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

type FunnelEvent = {
    session_id: string;
    step: string;
    created_at: string;
};

type SessionRow = {
    id: string;
    total_paid: number | null;
};

const FUNNEL_STEPS = [
    'WELCOME',
    'CONNECTION',
    'TRIGGER_PHASE',
    'HOT_TALK',
    'PREVIEW',
    'SALES_PITCH',
    'NEGOTIATION',
    'CLOSING',
    'PAYMENT_CHECK',
    'PAYMENT_CONFIRMED'
];

export default function AdminInsightsPage() {
    const [events, setEvents] = useState<FunnelEvent[]>([]);
    const [sessions, setSessions] = useState<SessionRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchAll();

        const channel = supabase
            .channel('insights_dashboard')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'funnel_events' }, fetchAll)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, fetchAll)
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const fetchAll = async () => {
        setLoading(true);
        const [{ data: ev }, { data: ses }] = await Promise.all([
            supabase.from('funnel_events').select('session_id, step, created_at'),
            supabase.from('sessions').select('id, total_paid')
        ]);
        setEvents((ev as FunnelEvent[]) || []);
        setSessions((ses as SessionRow[]) || []);
        setLoading(false);
    };

    const metrics = useMemo(() => {
        const stepToSessions = new Map<string, Set<string>>();
        const stepToSessionsNext = new Map<string, Set<string>>();
        FUNNEL_STEPS.forEach(step => stepToSessions.set(step, new Set()));

        for (const event of events) {
            const step = event.step?.toUpperCase();
            if (!stepToSessions.has(step)) continue;
            stepToSessions.get(step)!.add(event.session_id);
        }

        const paidSessions = new Set(
            sessions.filter(s => Number(s.total_paid || 0) > 0).map(s => s.id)
        );

        for (let i = 0; i < FUNNEL_STEPS.length - 1; i++) {
            const current = FUNNEL_STEPS[i];
            const next = FUNNEL_STEPS[i + 1];
            const currentSet = stepToSessions.get(current) || new Set();
            const nextSet = stepToSessions.get(next) || new Set();
            const progressed = new Set<string>();
            currentSet.forEach(id => {
                if (nextSet.has(id)) progressed.add(id);
            });
            stepToSessionsNext.set(current, progressed);
        }

        const rows = FUNNEL_STEPS.map((step, idx) => {
            const reachedSet = stepToSessions.get(step) || new Set();
            const reached = reachedSet.size;
            const paidAfter = [...reachedSet].filter(id => paidSessions.has(id)).length;
            const paidRate = reached ? Math.round((paidAfter / reached) * 100) : 0;
            const nextSet = stepToSessionsNext.get(step);
            const progressed = nextSet ? nextSet.size : 0;
            const progressRate = reached && idx < FUNNEL_STEPS.length - 1 ? Math.round((progressed / reached) * 100) : 0;
            return { step, reached, paidAfter, paidRate, progressed, progressRate };
        });

        return {
            totalSessions: sessions.length,
            totalPaid: sessions.filter(s => Number(s.total_paid || 0) > 0).length,
            rows
        };
    }, [events, sessions]);

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
                            <h1 className="text-xl font-semibold">Insights do Funil</h1>
                            <p className="text-sm text-gray-400">Taxa de sucesso por etapa</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Link href="/admin" className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-gray-100 transition hover:border-white/20">
                            Voltar
                        </Link>
                    </div>
                </div>
            </header>

            <main className="mx-auto w-full max-w-7xl px-6 py-10">
                <div className="grid gap-6 lg:grid-cols-3">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                        <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Total de leads</p>
                        <p className="mt-3 text-3xl font-semibold">{metrics.totalSessions}</p>
                    </div>
                    <div className="rounded-3xl border border-emerald-400/20 bg-emerald-500/10 p-6 backdrop-blur">
                        <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">Leads que pagaram</p>
                        <p className="mt-3 text-3xl font-semibold text-emerald-100">{metrics.totalPaid}</p>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                        <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Atualizacao</p>
                        <p className="mt-3 text-sm text-gray-300">{loading ? 'carregando...' : 'tempo real'}</p>
                    </div>
                </div>

                <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                    <div className="mb-4 flex items-center justify-between">
                        <h2 className="text-lg font-semibold">Conversao por etapa</h2>
                        <span className="text-xs text-gray-400">taxa de progresso e taxa de pagamento</span>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="text-xs uppercase text-gray-500">
                                <tr>
                                    <th className="py-2">Etapa</th>
                                    <th className="py-2">Chegaram</th>
                                    <th className="py-2">Progrediram</th>
                                    <th className="py-2">Taxa prox etapa</th>
                                    <th className="py-2">Pagaram</th>
                                    <th className="py-2">Taxa pagto</th>
                                </tr>
                            </thead>
                            <tbody>
                                {metrics.rows.map((row) => (
                                    <tr key={row.step} className="border-t border-white/10">
                                        <td className="py-3 font-semibold text-gray-100">{row.step.replace(/_/g, ' ')}</td>
                                        <td className="py-3 text-gray-300">{row.reached}</td>
                                        <td className="py-3 text-gray-300">{row.progressed}</td>
                                        <td className="py-3 text-gray-300">{row.step === 'PAYMENT_CONFIRMED' ? '-' : `${row.progressRate}%`}</td>
                                        <td className="py-3 text-emerald-200">{row.paidAfter}</td>
                                        <td className="py-3 text-emerald-200">{row.paidRate}%</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>
        </div>
    );
}
