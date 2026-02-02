"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function AdminOptimizerPage() {
    const [enabled, setEnabled] = useState(false);
    const [minInterval, setMinInterval] = useState(60);
    const [batchSize, setBatchSize] = useState(8);
    const [lastRun, setLastRun] = useState<string | null>(null);
    const [lastResult, setLastResult] = useState<string | null>(null);
    const [progress, setProgress] = useState<{ stage: string; paidOffset: number; unpaidOffset: number } | null>(null);
    const [msg, setMsg] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        const res = await fetch("/api/admin/optimizer-settings");
        const data = await res.json();
        const settings = data?.settings || {};
        setEnabled(settings.auto_optimizer_enabled === "true");
        setMinInterval(Number(settings.auto_optimizer_min_interval_min || 60));
        setBatchSize(Number(settings.auto_optimizer_batch_size || 8));
        setLastRun(settings.auto_optimizer_last_run || null);
        setLastResult(settings.auto_optimizer_last_result || null);
        setProgress({
            stage: settings.auto_optimizer_stage || "paid",
            paidOffset: Number(settings.auto_optimizer_paid_offset || 0),
            unpaidOffset: Number(settings.auto_optimizer_unpaid_offset || 0),
        });
    };

    const saveSettings = async () => {
        setLoading(true);
        setMsg("");
        const res = await fetch("/api/admin/optimizer-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled, minInterval, batchSize }),
        });
        const data = await res.json();
        setMsg(data?.error ? `erro: ${data.error}` : "configuracoes salvas");
        setLoading(false);
    };

    const runNow = async () => {
        setLoading(true);
        setMsg("");
        try {
            const res = await fetch("/api/cron/optimizer?force=1");
            const data = await res.json();
            if (data.ok) {
                setMsg("otimizador rodou agora");
            } else {
                setMsg(data.error || "falha ao rodar");
            }
            await loadSettings();
        } catch (e: any) {
            setMsg(e?.message || "erro ao rodar");
        }
        setLoading(false);
    };

    const resetProgress = async () => {
        setLoading(true);
        setMsg("");
        try {
            const res = await fetch("/api/admin/optimizer-reset", { method: "POST" });
            const data = await res.json();
            if (data.ok) {
                setMsg("progresso resetado");
            } else {
                setMsg(data.error || "falha ao resetar");
            }
            await loadSettings();
        } catch (e: any) {
            setMsg(e?.message || "erro ao resetar");
        }
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-[#0b0f17] text-gray-100 font-sans">
            <div className="pointer-events-none fixed inset-0">
                <div className="absolute left-[-140px] top-[-160px] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(0,184,148,0.28),_transparent_70%)]" />
                <div className="absolute right-[-160px] top-[120px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(56,189,248,0.20),_transparent_70%)]" />
                <div className="absolute bottom-[-160px] left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,_rgba(255,122,24,0.10),_transparent_70%)]" />
            </div>

            <header className="sticky top-0 z-30 border-b border-white/10 bg-black/30 backdrop-blur">
                <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
                    <div className="flex items-center gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/40 to-emerald-400/30 text-cyan-100 font-bold">LM</div>
                        <div>
                            <h1 className="text-xl font-semibold">IA Otimizadora</h1>
                            <p className="text-sm text-gray-400">Analisa conversas e ajusta o script automaticamente</p>
                        </div>
                    </div>
                    <Link href="/admin" className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-gray-100 transition hover:border-white/20">
                        Voltar
                    </Link>
                </div>
            </header>

            <main className="mx-auto w-full max-w-5xl px-6 py-10">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                    <h2 className="text-lg font-semibold">Configuracoes</h2>
                    <div className="mt-4 flex flex-wrap items-center gap-4">
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                            <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(e) => setEnabled(e.target.checked)}
                                className="h-4 w-4 rounded border-white/20 bg-black/30"
                            />
                            ativar otimizador
                        </label>
                        <div className="flex items-center gap-2 text-sm text-gray-300">
                            <span>intervalo (min)</span>
                            <input
                                type="number"
                                value={minInterval}
                                onChange={(e) => setMinInterval(Number(e.target.value))}
                                className="w-24 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                            />
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-300">
                            <span>lote (sessoes)</span>
                            <input
                                type="number"
                                value={batchSize}
                                onChange={(e) => setBatchSize(Number(e.target.value))}
                                className="w-24 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                            />
                        </div>
                    </div>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                        <button
                            onClick={saveSettings}
                            disabled={loading}
                            className="rounded-2xl border border-cyan-500/30 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100"
                        >
                            salvar
                        </button>
                        <button
                            onClick={runNow}
                            disabled={loading}
                            className="rounded-2xl border border-emerald-500/30 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-100"
                        >
                            rodar agora
                        </button>
                        <button
                            onClick={resetProgress}
                            disabled={loading}
                            className="rounded-2xl border border-amber-500/30 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100"
                        >
                            resetar progresso
                        </button>
                        <div className="text-xs text-gray-400">
                            ultimo run: {lastRun ? new Date(lastRun).toLocaleString() : "nunca"}
                        </div>
                    </div>
                </div>

                <div className="mt-6 grid gap-6 lg:grid-cols-2">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                        <h2 className="text-lg font-semibold">Progresso</h2>
                        <div className="mt-4 grid gap-3 text-sm text-gray-200">
                            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                                <span>estagio</span>
                                <span className="text-cyan-200">{progress?.stage || "paid"}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                                <span>pagas processadas</span>
                                <span className="text-cyan-200">{progress?.paidOffset ?? 0}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                                <span>nao pagas processadas</span>
                                <span className="text-cyan-200">{progress?.unpaidOffset ?? 0}</span>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                        <h2 className="text-lg font-semibold">Ultimo resultado</h2>
                        <pre className="mt-3 max-h-[360px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-gray-200 whitespace-pre-wrap">
                            {lastResult || "sem dados ainda"}
                        </pre>
                    </div>
                </div>

                {msg && (
                    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-3 text-center text-sm text-gray-300">
                        {msg}
                    </div>
                )}
            </main>
        </div>
    );
}
