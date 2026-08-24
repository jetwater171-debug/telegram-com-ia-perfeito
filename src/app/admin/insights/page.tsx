"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminFetchJson } from '@/lib/adminApiClient';

type InsightData = {
    overview: { totalSessions: number; activeSessions: number; paidSessions: number; revenue: number };
    funnel: Array<{ step: string; reached: number; progressed: number; progressRate: number; paidAfter: number; paidRate: number }>;
    brain: { decisions: number; corrected: number; correctionRate: number; providerUsage: Record<string, number>; actions: Record<string, number>; lastDecisionAt: string | null };
    outcomes: { total: number; reward: number; counts: Record<string, number> };
    generatedAt: string;
};

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const nice = (value: string) => value.replace(/_/g, ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase());

export default function AdminInsightsPage() {
    const [data, setData] = useState<InsightData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setError('');
        try {
            setData(await adminFetchJson<InsightData>('/api/admin/insights'));
        } catch (caught: any) {
            setError(caught?.message || 'Não foi possível carregar os resultados');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const kickoff = window.setTimeout(() => void load(), 0);
        const timer = window.setInterval(load, 30_000);
        return () => { window.clearTimeout(kickoff); window.clearInterval(timer); };
    }, [load]);

    const topActions = useMemo(() => Object.entries(data?.brain.actions || {}).sort((a, b) => b[1] - a[1]).slice(0, 6), [data]);
    const topProvider = useMemo(() => Object.entries(data?.brain.providerUsage || {}).sort((a, b) => b[1] - a[1])[0], [data]);
    const maxReached = Math.max(1, ...(data?.funnel || []).map((row) => row.reached));

    return (
        <div className="min-h-screen text-slate-100">
            <main className="mx-auto w-full max-w-[1450px] px-4 py-7 lg:px-6 lg:py-9">
                <header className="admin-page-header mb-5 sm:flex-row sm:items-end sm:justify-between">
                    <div><p className="admin-eyebrow">Decisões & receita</p><h1 className="admin-page-title">Resultados da operação</h1><p className="admin-page-subtitle">Funil, comportamento do Master Brain e feedback real em uma visão única.</p></div>
                    <button onClick={() => void load()} disabled={loading} className="rounded-xl border border-white/10 bg-white/[.04] px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-cyan-300/30 hover:text-white disabled:opacity-50">{loading ? 'Atualizando...' : 'Atualizar agora'}</button>
                </header>

                {error && <div className="mb-5 rounded-xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">{error}</div>}

                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <Metric label="Leads" value={data?.overview.totalSessions ?? '—'} note={`${data?.overview.activeSessions || 0} ativos`} />
                    <Metric label="Compradores" value={data?.overview.paidSessions ?? '—'} note="pagamento confirmado" accent="emerald" />
                    <Metric label="Receita" value={data ? money.format(data.overview.revenue) : '—'} note="total conciliado" accent="emerald" />
                    <Metric label="Decisões IA" value={data?.brain.decisions ?? '—'} note={`${data?.brain.correctionRate || 0}% corrigidas pelo validator`} accent="cyan" />
                    <Metric label="Outcomes" value={data?.outcomes.total ?? '—'} note={`reward ${Number(data?.outcomes.reward || 0).toFixed(1)}`} accent="violet" />
                </section>

                <section className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_.85fr]">
                    <div className="admin-card overflow-hidden">
                        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4"><div><h2 className="font-semibold text-white">Trajetória do funil</h2><p className="mt-1 text-xs text-slate-500">alcance, avanço e conversão acumulada</p></div><span className="rounded-lg border border-white/8 bg-black/20 px-2.5 py-1 text-xs text-slate-400">tempo real</span></div>
                        <div className="divide-y divide-white/[.06]">
                            {(data?.funnel || []).map((row) => (
                                <div key={row.step} className="grid gap-3 px-5 py-3.5 lg:grid-cols-[170px_1fr_80px_80px] lg:items-center">
                                    <div><p className="text-sm font-semibold text-slate-200">{nice(row.step)}</p><p className="text-[11px] text-slate-600">{row.reached} chegaram</p></div>
                                    <div className="h-2 overflow-hidden rounded-full bg-black/35"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-300" style={{ width: `${Math.max(row.reached ? 4 : 0, row.reached / maxReached * 100)}%` }} /></div>
                                    <div><p className="text-xs text-slate-500">avanço</p><p className="text-sm font-semibold text-cyan-100">{row.step === 'PAYMENT_CONFIRMED' ? '—' : `${row.progressRate}%`}</p></div>
                                    <div><p className="text-xs text-slate-500">pagaram</p><p className="text-sm font-semibold text-emerald-200">{row.paidRate}%</p></div>
                                </div>
                            ))}
                            {!data && <div className="p-10 text-center text-sm text-slate-500">Carregando trajetória...</div>}
                        </div>
                    </div>

                    <div className="space-y-5">
                        <div className="admin-card p-5"><p className="admin-eyebrow">Cérebro ativo</p><h2 className="mt-2 text-lg font-semibold text-white">{topProvider?.[0] || 'Aguardando decisões'}</h2><p className="mt-1 text-sm text-slate-400">{topProvider ? `${topProvider[1]} decisões registradas` : 'O provider aparecerá assim que houver tráfego.'}</p><div className="mt-4 grid grid-cols-2 gap-3"><SmallMetric label="Validadas" value={Math.max(0, Number(data?.brain.decisions || 0) - Number(data?.brain.corrected || 0))} /><SmallMetric label="Corrigidas" value={data?.brain.corrected || 0} /></div></div>
                        <div className="admin-card p-5"><p className="admin-eyebrow">Próximas ações</p><div className="mt-4 space-y-3">{topActions.map(([action, count]) => <div key={action} className="flex items-center justify-between gap-3"><span className="text-sm text-slate-300">{nice(action)}</span><span className="rounded-lg bg-white/[.05] px-2 py-1 text-xs font-semibold text-cyan-100">{count}</span></div>)}{topActions.length === 0 && <p className="text-sm text-slate-500">Sem decisões no período.</p>}</div></div>
                    </div>
                </section>
            </main>
        </div>
    );
}

function Metric({ label, value, note, accent = 'slate' }: { label: string; value: string | number; note: string; accent?: 'slate' | 'emerald' | 'cyan' | 'violet' }) {
    const colors = { slate: 'text-white', emerald: 'text-emerald-200', cyan: 'text-cyan-200', violet: 'text-violet-200' };
    return <div className="admin-card p-4"><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-slate-500">{label}</p><p className={`mt-2 text-2xl font-semibold tracking-tight ${colors[accent]}`}>{value}</p><p className="mt-1 text-xs text-slate-600">{note}</p></div>;
}

function SmallMetric({ label, value }: { label: string; value: number }) {
    return <div className="rounded-xl border border-white/8 bg-black/20 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold text-white">{value}</p></div>;
}
