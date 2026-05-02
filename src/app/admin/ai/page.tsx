"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type AiSettings = {
    openrouterApiKeyMasked: string;
    geminiApiKeyMasked: string;
    openrouterBaseUrl: string;
    openrouterReferer: string;
    openrouterTitle: string;
    aiModelOrder: string;
    aiStrategyModelOrder: string;
    aiDraftModelOrder: string;
    aiReviewModelOrder: string;
    aiEvaluatorModelOrder: string;
    openrouterStrategyModel: string;
    openrouterDraftModel: string;
    openrouterReviewModel: string;
    openrouterEvaluatorModel: string;
    geminiStrategyModel: string;
    geminiDraftModel: string;
    geminiReviewModel: string;
    geminiEvaluatorModel: string;
};

type AiEvent = {
    at: string;
    role: string;
    provider: string;
    model: string;
    status: string;
    message?: string;
    durationMs?: number;
};

type AiStat = {
    role: string;
    provider: string;
    model: string;
    success?: number;
    error?: number;
    skipped?: number;
};

const emptySettings: AiSettings = {
    openrouterApiKeyMasked: "",
    geminiApiKeyMasked: "",
    openrouterBaseUrl: "https://openrouter.ai/api/v1",
    openrouterReferer: "",
    openrouterTitle: "Lari Telegram Bot",
    aiModelOrder: "",
    aiStrategyModelOrder: "openrouter,gemini",
    aiDraftModelOrder: "openrouter,gemini",
    aiReviewModelOrder: "openrouter,gemini",
    aiEvaluatorModelOrder: "openrouter,gemini",
    openrouterStrategyModel: "z-ai/glm-4.5-air:free",
    openrouterDraftModel: "z-ai/glm-4.5-air:free",
    openrouterReviewModel: "openai/gpt-oss-120b:free",
    openrouterEvaluatorModel: "openai/gpt-oss-120b:free",
    geminiStrategyModel: "gemini-2.5-flash",
    geminiDraftModel: "gemini-2.5-flash",
    geminiReviewModel: "gemini-2.5-flash",
    geminiEvaluatorModel: "gemini-2.5-flash",
};

const roleLabels: Record<string, string> = {
    strategy: "Estrategista",
    draft: "Lari",
    review: "Revisora",
    evaluator: "Avaliadora",
};

const inputClass = "rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300/60";

export default function AdminAiPage() {
    const [settings, setSettings] = useState<AiSettings>(emptySettings);
    const [openrouterApiKey, setOpenrouterApiKey] = useState("");
    const [geminiApiKey, setGeminiApiKey] = useState("");
    const [recentEvents, setRecentEvents] = useState<AiEvent[]>([]);
    const [stats, setStats] = useState<AiStat[]>([]);
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");

    useEffect(() => {
        load();
    }, []);

    const load = async () => {
        const res = await fetch("/api/admin/ai-settings", { cache: "no-store" });
        const data = await res.json();
        if (data?.settings) setSettings({ ...emptySettings, ...data.settings });
        setRecentEvents(Array.isArray(data?.recentEvents) ? data.recentEvents : []);
        setStats(Array.isArray(data?.stats) ? data.stats : []);
    };

    const save = async () => {
        setLoading(true);
        setMsg("");
        const res = await fetch("/api/admin/ai-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...settings, openrouterApiKey, geminiApiKey }),
        });
        const data = await res.json();
        if (data?.error) {
            setMsg(`Erro: ${data.error}`);
        } else {
            setMsg("Configuracao salva");
            setOpenrouterApiKey("");
            setGeminiApiKey("");
            await load();
        }
        setLoading(false);
    };

    const clearLogs = async () => {
        setLoading(true);
        setMsg("");
        const res = await fetch("/api/admin/ai-settings", { method: "DELETE" });
        const data = await res.json();
        setMsg(data?.error ? `Erro: ${data.error}` : "Logs limpos");
        await load();
        setLoading(false);
    };

    const worstModel = useMemo(() => {
        return [...stats].sort((a, b) => Number(b.error || 0) - Number(a.error || 0))[0];
    }, [stats]);

    const update = (key: keyof AiSettings, value: string) => {
        setSettings((prev) => ({ ...prev, [key]: value }));
    };

    return (
        <div className="min-h-screen bg-[#080b10] text-slate-100">
            <header className="sticky top-0 z-30 border-b border-white/10 bg-[#080b10]/95 backdrop-blur">
                <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">Admin</p>
                        <h1 className="text-xl font-semibold">Multi-IAs da Lari</h1>
                        <p className="text-sm text-slate-400">Fallback real entre OpenRouter e Gemini</p>
                    </div>
                    <nav className="flex flex-wrap gap-2 text-sm">
                        <Link href="/admin" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-200">Conversas</Link>
                        <Link href="/admin/optimizer" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-200">Otimizador</Link>
                        <Link href="/admin/settings" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-200">Config</Link>
                    </nav>
                </div>
            </header>

            <main className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 lg:grid-cols-[1.2fr_0.8fr]">
                <section className="space-y-5">
                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold">Chaves dos provedores</h2>
                                <p className="text-sm text-slate-400">OpenRouter e Gemini sao os provedores. Chave salva nao aparece inteira.</p>
                            </div>
                            <span className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200">Seguro</span>
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <Field label={`OpenRouter ${settings.openrouterApiKeyMasked ? `(${settings.openrouterApiKeyMasked})` : "(nao salvo)"}`}>
                                <input value={openrouterApiKey} onChange={(e) => setOpenrouterApiKey(e.target.value)} type="password" className={inputClass} placeholder="sk-or-..." />
                            </Field>
                            <Field label={`Gemini ${settings.geminiApiKeyMasked ? `(${settings.geminiApiKeyMasked})` : "(opcional)"}`}>
                                <input value={geminiApiKey} onChange={(e) => setGeminiApiKey(e.target.value)} type="password" className={inputClass} placeholder="AIza..." />
                            </Field>
                            <Field label="OpenRouter Referer">
                                <input value={settings.openrouterReferer} onChange={(e) => update("openrouterReferer", e.target.value)} className={inputClass} />
                            </Field>
                            <Field label="OpenRouter Title">
                                <input value={settings.openrouterTitle} onChange={(e) => update("openrouterTitle", e.target.value)} className={inputClass} />
                            </Field>
                        </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <h2 className="text-lg font-semibold">Ordem dos provedores</h2>
                        <p className="mt-1 text-sm text-slate-400">Use somente openrouter e gemini. A primeira tenta primeiro; se falhar, cai para a proxima.</p>

                        <div className="mt-4 grid gap-4">
                            <TextArea label="Lari responde" value={settings.aiDraftModelOrder} onChange={(v) => update("aiDraftModelOrder", v)} />
                            <TextArea label="Estrategista" value={settings.aiStrategyModelOrder} onChange={(v) => update("aiStrategyModelOrder", v)} />
                            <TextArea label="Revisora" value={settings.aiReviewModelOrder} onChange={(v) => update("aiReviewModelOrder", v)} />
                            <TextArea label="Avaliadora de lead" value={settings.aiEvaluatorModelOrder} onChange={(v) => update("aiEvaluatorModelOrder", v)} />
                            <TextArea label="Ordem global extra" value={settings.aiModelOrder} onChange={(v) => update("aiModelOrder", v)} placeholder="opcional: openrouter,gemini" />
                        </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <h2 className="text-lg font-semibold">Modelos por provedor</h2>
                        <p className="mt-1 text-sm text-slate-400">Aqui voce escolhe o modelo usado dentro de cada provedor.</p>

                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <ModelColumn
                                title="OpenRouter"
                                values={{
                                    draft: settings.openrouterDraftModel,
                                    strategy: settings.openrouterStrategyModel,
                                    review: settings.openrouterReviewModel,
                                    evaluator: settings.openrouterEvaluatorModel,
                                }}
                                onChange={{
                                    draft: (value) => update("openrouterDraftModel", value),
                                    strategy: (value) => update("openrouterStrategyModel", value),
                                    review: (value) => update("openrouterReviewModel", value),
                                    evaluator: (value) => update("openrouterEvaluatorModel", value),
                                }}
                            />
                            <ModelColumn
                                title="Gemini"
                                values={{
                                    draft: settings.geminiDraftModel,
                                    strategy: settings.geminiStrategyModel,
                                    review: settings.geminiReviewModel,
                                    evaluator: settings.geminiEvaluatorModel,
                                }}
                                onChange={{
                                    draft: (value) => update("geminiDraftModel", value),
                                    strategy: (value) => update("geminiStrategyModel", value),
                                    review: (value) => update("geminiReviewModel", value),
                                    evaluator: (value) => update("geminiEvaluatorModel", value),
                                }}
                            />
                        </div>

                        <div className="mt-5 flex flex-wrap gap-3">
                            <button onClick={save} disabled={loading} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">
                                {loading ? "Salvando..." : "Salvar Multi-IAs"}
                            </button>
                            <button onClick={load} disabled={loading} className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-200">
                                Recarregar
                            </button>
                        </div>
                        {msg && <div className="mt-4 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200">{msg}</div>}
                    </div>
                </section>

                <aside className="space-y-5">
                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <h2 className="text-lg font-semibold">Saude das IAs</h2>
                        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                            <Metric label="Modelos" value={stats.length} />
                            <Metric label="Erros" value={stats.reduce((sum, item) => sum + Number(item.error || 0), 0)} />
                            <Metric label="Sucessos" value={stats.reduce((sum, item) => sum + Number(item.success || 0), 0)} />
                        </div>
                        <div className="mt-4 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm">
                            <p className="text-xs uppercase tracking-[0.18em] text-red-200/80">Mais erro</p>
                            <p className="mt-1 font-semibold text-red-100">{worstModel ? `${roleLabels[worstModel.role] || worstModel.role} - ${worstModel.provider}:${worstModel.model}` : "Sem dados"}</p>
                            <p className="text-xs text-red-100/70">{worstModel ? `${worstModel.error || 0} erros` : "Ainda nao teve chamada registrada"}</p>
                        </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-lg font-semibold">Ranking de erro</h2>
                            <button onClick={clearLogs} disabled={loading} className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300">Limpar</button>
                        </div>
                        <div className="mt-3 max-h-72 overflow-auto space-y-2">
                            {stats.length === 0 && <p className="text-sm text-slate-400">Sem estatistica ainda.</p>}
                            {stats.map((item) => (
                                <div key={`${item.role}-${item.provider}-${item.model}`} className="rounded-lg border border-white/10 bg-black/25 p-3 text-sm">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium text-slate-100">{item.provider}:{item.model}</span>
                                        <span className="text-xs text-slate-400">{roleLabels[item.role] || item.role}</span>
                                    </div>
                                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-300">
                                        <span>ok: {item.success || 0}</span>
                                        <span>erro: {item.error || 0}</span>
                                        <span>skip: {item.skipped || 0}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <h2 className="text-lg font-semibold">Ultimos eventos</h2>
                        <div className="mt-3 max-h-[420px] overflow-auto space-y-2">
                            {recentEvents.length === 0 && <p className="text-sm text-slate-400">Sem evento ainda.</p>}
                            {recentEvents.map((event, index) => (
                                <div key={`${event.at}-${index}`} className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className={event.status === "error" ? "text-red-200" : event.status === "success" ? "text-emerald-200" : "text-amber-200"}>
                                            {event.status.toUpperCase()}
                                        </span>
                                        <span className="text-slate-500">{new Date(event.at).toLocaleString()}</span>
                                    </div>
                                    <p className="mt-1 text-slate-200">{roleLabels[event.role] || event.role} - {event.provider}:{event.model}</p>
                                    {event.message && <p className="mt-1 whitespace-pre-wrap text-slate-400">{event.message}</p>}
                                </div>
                            ))}
                        </div>
                    </div>
                </aside>
            </main>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="grid gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
            {children}
        </label>
    );
}

function TextArea({ label, value, onChange, placeholder = "openrouter,gemini" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
    return (
        <label className="grid gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
            <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={1} placeholder={placeholder} className="min-h-11 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300/60" />
        </label>
    );
}

function ModelColumn({
    title,
    values,
    onChange,
}: {
    title: string;
    values: Record<"draft" | "strategy" | "review" | "evaluator", string>;
    onChange: Record<"draft" | "strategy" | "review" | "evaluator", (value: string) => void>;
}) {
    return (
        <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <h3 className="font-semibold text-slate-100">{title}</h3>
            <div className="mt-4 grid gap-3">
                <Field label="Lari responde">
                    <input value={values.draft} onChange={(e) => onChange.draft(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Estrategista">
                    <input value={values.strategy} onChange={(e) => onChange.strategy(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Revisora">
                    <input value={values.review} onChange={(e) => onChange.review(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Avaliadora">
                    <input value={values.evaluator} onChange={(e) => onChange.evaluator(e.target.value)} className={inputClass} />
                </Field>
            </div>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-lg border border-white/10 bg-black/25 p-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">{value}</p>
        </div>
    );
}
