"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type LimitName = "rpm" | "tpm" | "rpd" | "tpd";

type CapacityRow = {
    provider: string;
    model: string;
    credentialId: string;
    credentialLabel: string;
    projectId: string | null;
    quotaGroupId: string;
    used: Record<LimitName, number> & { inputTokens: number; outputTokens: number; reasoningTokens: number; contextTokens: number };
    limits: Record<LimitName, number | null> & { source?: string };
    remaining: Record<LimitName, number | null>;
    successes: number;
    errors: number;
    errors429: number;
    errors5xx: number;
    cooldownUntil: string | null;
    nextMinuteResetEstimate: string | null;
    nextDayReset: string | null;
    estimatedCostUsd: number;
    lastEventAt: string | null;
};

type Credential = { id: string; provider: string; label: string; projectId: string | null; quotaGroupId: string; model: string | null };
type CapacityResponse = { ready: boolean; migrationMissing: boolean; error: string | null; generatedAt: string; credentials: Credential[]; rows: CapacityRow[] };

const AUTO_REFRESH_MS = 60_000;
const LIMIT_LABELS: Record<LimitName, string> = { rpm: "RPM", tpm: "TPM", rpd: "RPD", tpd: "TPD" };

const number = (value: number | null | undefined) => value == null ? "não publicado" : value.toLocaleString("pt-BR");
const tokens = (value: number | null | undefined) => Number(value || 0).toLocaleString("pt-BR");
const dateTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString("pt-BR") : "—";
const money = (value: number | null | undefined) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" }).format(Number(value || 0));

function Metric({ label, used, limit, remaining }: { label: string; used: number; limit: number | null; remaining: number | null }) {
    return <div className="rounded-xl border border-white/10 bg-black/20 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
        <p className="mt-2 text-sm text-slate-100"><strong>{tokens(used)}</strong> usados</p>
        <p className="mt-1 text-xs text-slate-400">Limite: {number(limit)}</p>
        <p className={`mt-1 text-xs ${remaining == null ? "text-slate-500" : remaining === 0 ? "text-rose-300" : "text-emerald-300"}`}>Restante: {number(remaining)}</p>
    </div>;
}

export default function AiCapacityPage() {
    const [data, setData] = useState<CapacityResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);

    const load = useCallback(async (manual = false) => {
        if (manual) setRefreshing(true);
        else setLoading(true);
        try {
            const response = await fetch("/api/admin/ai-capacity", { cache: "no-store" });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar a capacidade de IA.");
            setData(payload);
            setError(null);
        } catch (cause: any) {
            setError(cause?.message || "Não foi possível carregar a capacidade de IA.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        if (!autoRefresh) return;
        const timer = window.setInterval(() => void load(true), AUTO_REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [autoRefresh, load]);

    const summary = useMemo(() => {
        const rows = data?.rows || [];
        return {
            providers: new Set(rows.map((row) => row.provider)).size,
            projects: new Set((data?.credentials || []).map((credential) => credential.projectId).filter(Boolean)).size,
            credentials: data?.credentials.length || 0,
            errors429: rows.reduce((total, row) => total + Number(row.errors429 || 0), 0),
            errors5xx: rows.reduce((total, row) => total + Number(row.errors5xx || 0), 0),
        };
    }, [data]);

    return <div className="min-h-screen bg-[#070b16] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <main className="mx-auto max-w-7xl space-y-6">
            <header className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 to-[#0d1729] p-6 sm:flex-row sm:items-start">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">IA · Capacidade operacional</p>
                    <h1 className="mt-2 text-2xl font-bold tracking-tight">Limites, consumo e saúde do router</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Dados reais coletados pelo gateway. Quando o provedor não publica um limite, a tela mostra isso em vez de inventar capacidade.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} className="h-4 w-4 accent-cyan-300" /> Atualizar a cada minuto</label>
                    <button type="button" onClick={() => void load(true)} disabled={refreshing} className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/15 disabled:opacity-50">{refreshing ? "Atualizando..." : "Atualizar agora"}</button>
                </div>
            </header>

            {error && <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100">{error}</div>}
            {data && !data.ready && <div className="rounded-xl border border-amber-300/30 bg-amber-300/[0.08] p-4 text-sm text-amber-100"><strong>Migração pendente.</strong> {data.error || "A persistência de telemetria ainda não está pronta; os números podem estar incompletos."}</div>}

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <SummaryCard value={String(summary.providers)} label="Provedores ativos" />
                <SummaryCard value={String(summary.credentials)} label="Credenciais cadastradas" />
                <SummaryCard value={String(summary.projects)} label="Projetos autorizados" />
                <SummaryCard value={tokens(summary.errors429)} label="Erros 429 hoje" tone="amber" />
                <SummaryCard value={tokens(summary.errors5xx)} label="Erros 5xx hoje" tone="rose" />
            </section>

            {loading && !data ? <div className="admin-card p-8 text-center text-sm text-slate-400">Carregando capacidade do router...</div> : null}
            {data?.rows.length === 0 && !loading ? <div className="admin-card p-8 text-center text-sm text-slate-400">Ainda não há chamadas registradas. As credenciais aparecem aqui assim que o router receber tráfego.</div> : null}

            <section className="space-y-4">
                {data?.rows.map((row, index) => <article key={`${row.provider}-${row.model}-${row.credentialId}-${index}`} className="admin-card overflow-hidden">
                    <div className="flex flex-col justify-between gap-3 border-b border-white/10 bg-black/15 p-5 md:flex-row md:items-start">
                        <div>
                            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-cyan-300/10 px-2.5 py-1 text-xs font-bold uppercase text-cyan-100">{row.provider}</span><strong className="text-base">{row.model}</strong></div>
                            <p className="mt-2 text-xs text-slate-400">Credencial: {row.credentialLabel} · Projeto: {row.projectId || "não informado"} · Grupo de quota: {row.quotaGroupId || "—"}</p>
                        </div>
                        <div className="text-xs text-slate-500">Último evento: {dateTime(row.lastEventAt)}</div>
                    </div>
                    <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
                        {(Object.keys(LIMIT_LABELS) as LimitName[]).map((key) => <Metric key={key} label={LIMIT_LABELS[key]} used={Number(row.used[key] || 0)} limit={row.limits[key]} remaining={row.remaining[key]} />)}
                    </div>
                    <div className="grid gap-3 border-t border-white/10 bg-black/10 p-5 md:grid-cols-2 xl:grid-cols-4">
                        <Detail title="Tokens" values={[`Entrada: ${tokens(row.used.inputTokens)}`, `Saída: ${tokens(row.used.outputTokens)}`, `Contexto: ${tokens(row.used.contextTokens)}`, `Raciocínio: ${tokens(row.used.reasoningTokens)}`]} />
                        <Detail title="Saúde" values={[`Sucessos: ${tokens(row.successes)}`, `Erros: ${tokens(row.errors)}`, `429: ${tokens(row.errors429)}`, `5xx: ${tokens(row.errors5xx)}`]} />
                        <Detail title="Janelas e pausa" values={[`Cooldown: ${dateTime(row.cooldownUntil)}`, `RPM: ${dateTime(row.nextMinuteResetEstimate)}`, `Diária: ${dateTime(row.nextDayReset)}`]} />
                        <Detail title="Custo e origem" values={[`Estimativa hoje: ${money(row.estimatedCostUsd)}`, `Limites: ${row.limits.source === "configured" ? "configurados" : "não publicados"}`, `Status: ${row.cooldownUntil && new Date(row.cooldownUntil) > new Date() ? "em cooldown" : "disponível"}`]} />
                    </div>
                </article>)}
            </section>

            {data && <p className="pb-6 text-center text-xs text-slate-600">Atualizado em {dateTime(data.generatedAt)} · {data.migrationMissing ? "migração de telemetria pendente" : "telemetria persistente ativa"}</p>}
        </main>
    </div>;
}

function SummaryCard({ value, label, tone = "cyan" }: { value: string; label: string; tone?: "cyan" | "amber" | "rose" }) {
    const colors = { cyan: "border-cyan-300/15 text-cyan-100", amber: "border-amber-300/15 text-amber-100", rose: "border-rose-300/15 text-rose-100" };
    return <div className={`admin-card border p-4 ${colors[tone]}`}><strong className="text-2xl">{value}</strong><p className="mt-1 text-xs text-slate-500">{label}</p></div>;
}

function Detail({ title, values }: { title: string; values: string[] }) {
    return <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</p><div className="mt-2 space-y-1 text-xs leading-5 text-slate-300">{values.map((value) => <p key={value}>{value}</p>)}</div></div>;
}
