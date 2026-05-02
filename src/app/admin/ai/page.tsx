"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ProviderKey = "openrouter" | "gemini";
type RoleKey = "draft" | "strategy" | "review" | "evaluator";

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

const providerLabels: Record<ProviderKey, string> = {
    openrouter: "OpenRouter",
    gemini: "Gemini",
};

const roleLabels: Record<RoleKey | string, string> = {
    draft: "Lari responde",
    strategy: "Estrategista",
    review: "Revisora",
    evaluator: "Avaliadora",
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

const openRouterPresets = [
    { id: "z-ai/glm-4.5-air:free", label: "GLM 4.5 Air Free", note: "Principal free para roleplay e conversa natural" },
    { id: "openai/gpt-oss-120b:free", label: "GPT OSS 120B Free", note: "Bom para estrategia/revisao e JSON" },
    { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B Free", note: "Fallback free mais comportado" },
    { id: "openrouter/free", label: "OpenRouter Free Auto", note: "Fallback automatico quando quiser salvar limite" },
    { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2", note: "Pago barato, forte para persona/conversa" },
    { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5", note: "Premium para revisao e texto natural" },
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash via OpenRouter", note: "Alternativa pelo proprio OpenRouter" },
];

const geminiPresets = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
];

const setupPresets = [
    {
        id: "free-lari",
        label: "Free recomendado",
        note: "Comeca no OpenRouter gratis e usa Gemini como backup.",
        order: ["openrouter", "gemini"] as ProviderKey[],
        openrouter: {
            draft: "z-ai/glm-4.5-air:free",
            strategy: "z-ai/glm-4.5-air:free",
            review: "openai/gpt-oss-120b:free",
            evaluator: "openai/gpt-oss-120b:free",
        },
        gemini: {
            draft: "gemini-2.5-flash",
            strategy: "gemini-2.5-flash-lite",
            review: "gemini-2.5-flash",
            evaluator: "gemini-2.5-flash-lite",
        },
    },
    {
        id: "quality-lari",
        label: "Mais qualidade",
        note: "Usa modelos pagos/baratos melhores no OpenRouter e Gemini de backup.",
        order: ["openrouter", "gemini"] as ProviderKey[],
        openrouter: {
            draft: "deepseek/deepseek-v3.2",
            strategy: "openai/gpt-oss-120b:free",
            review: "anthropic/claude-sonnet-4.5",
            evaluator: "openai/gpt-oss-120b:free",
        },
        gemini: {
            draft: "gemini-2.5-flash",
            strategy: "gemini-2.5-flash",
            review: "gemini-2.5-flash",
            evaluator: "gemini-2.5-flash-lite",
        },
    },
    {
        id: "gemini-first",
        label: "Gemini primeiro",
        note: "Deixa Gemini responder e OpenRouter fica como reserva.",
        order: ["gemini", "openrouter"] as ProviderKey[],
        openrouter: {
            draft: "z-ai/glm-4.5-air:free",
            strategy: "z-ai/glm-4.5-air:free",
            review: "openai/gpt-oss-120b:free",
            evaluator: "openai/gpt-oss-120b:free",
        },
        gemini: {
            draft: "gemini-2.5-flash",
            strategy: "gemini-2.5-flash",
            review: "gemini-2.5-flash",
            evaluator: "gemini-2.5-flash-lite",
        },
    },
];

const inputClass = "rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300/60";

const parseProviderOrder = (value?: string): ProviderKey[] => {
    const parsed = String(value || "")
        .split(",")
        .map((item) => item.trim().toLowerCase().split(":")[0])
        .filter((item): item is ProviderKey => item === "openrouter" || item === "gemini");
    return Array.from(new Set([...parsed, "openrouter", "gemini"]));
};

export default function AdminAiPage() {
    const [settings, setSettings] = useState<AiSettings>(emptySettings);
    const [providerOrder, setProviderOrder] = useState<ProviderKey[]>(["openrouter", "gemini"]);
    const [openrouterApiKey, setOpenrouterApiKey] = useState("");
    const [geminiApiKey, setGeminiApiKey] = useState("");
    const [recentEvents, setRecentEvents] = useState<AiEvent[]>([]);
    const [stats, setStats] = useState<AiStat[]>([]);
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");
    const [dragging, setDragging] = useState<ProviderKey | null>(null);
    const [openCard, setOpenCard] = useState<ProviderKey>("openrouter");

    useEffect(() => {
        load();
    }, []);

    const load = async () => {
        const res = await fetch("/api/admin/ai-settings", { cache: "no-store" });
        const data = await res.json();
        const nextSettings = data?.settings ? { ...emptySettings, ...data.settings } : emptySettings;
        setSettings(nextSettings);
        setProviderOrder(parseProviderOrder(nextSettings.aiDraftModelOrder || nextSettings.aiModelOrder));
        setRecentEvents(Array.isArray(data?.recentEvents) ? data.recentEvents : []);
        setStats(Array.isArray(data?.stats) ? data.stats : []);
    };

    const save = async () => {
        setLoading(true);
        setMsg("");
        const order = providerOrder.join(",");
        const res = await fetch("/api/admin/ai-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ...settings,
                openrouterApiKey,
                geminiApiKey,
                aiModelOrder: order,
                aiDraftModelOrder: order,
                aiStrategyModelOrder: order,
                aiReviewModelOrder: order,
                aiEvaluatorModelOrder: order,
            }),
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

    const update = (key: keyof AiSettings, value: string) => {
        setSettings((prev) => ({ ...prev, [key]: value }));
    };

    const moveProvider = (provider: ProviderKey, direction: -1 | 1) => {
        setProviderOrder((current) => {
            const index = current.indexOf(provider);
            const target = index + direction;
            if (index < 0 || target < 0 || target >= current.length) return current;
            const next = [...current];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const onDropProvider = (target: ProviderKey) => {
        if (!dragging || dragging === target) return;
        setProviderOrder((current) => {
            const next = current.filter((item) => item !== dragging);
            const targetIndex = next.indexOf(target);
            next.splice(targetIndex, 0, dragging);
            return next;
        });
        setDragging(null);
    };

    const providerHealth = (provider: ProviderKey) => {
        const items = stats.filter((item) => item.provider === provider);
        return {
            success: items.reduce((sum, item) => sum + Number(item.success || 0), 0),
            error: items.reduce((sum, item) => sum + Number(item.error || 0), 0),
            skipped: items.reduce((sum, item) => sum + Number(item.skipped || 0), 0),
        };
    };

    const applySetupPreset = (preset: (typeof setupPresets)[number]) => {
        setProviderOrder(preset.order);
        setSettings((prev) => ({
            ...prev,
            aiModelOrder: preset.order.join(","),
            aiDraftModelOrder: preset.order.join(","),
            aiStrategyModelOrder: preset.order.join(","),
            aiReviewModelOrder: preset.order.join(","),
            aiEvaluatorModelOrder: preset.order.join(","),
            openrouterDraftModel: preset.openrouter.draft,
            openrouterStrategyModel: preset.openrouter.strategy,
            openrouterReviewModel: preset.openrouter.review,
            openrouterEvaluatorModel: preset.openrouter.evaluator,
            geminiDraftModel: preset.gemini.draft,
            geminiStrategyModel: preset.gemini.strategy,
            geminiReviewModel: preset.gemini.review,
            geminiEvaluatorModel: preset.gemini.evaluator,
        }));
        setOpenCard(preset.order[0]);
        setMsg(`Preset aplicado: ${preset.label}. Clique em Salvar tudo para gravar.`);
    };

    const worstModel = useMemo(() => {
        return [...stats].sort((a, b) => Number(b.error || 0) - Number(a.error || 0))[0];
    }, [stats]);

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
                                <h2 className="text-lg font-semibold">Configuracao rapida</h2>
                                <p className="text-sm text-slate-400">Escolha um modo pronto e depois ajuste se quiser.</p>
                            </div>
                            <button onClick={save} disabled={loading} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">
                                {loading ? "Salvando..." : "Salvar tudo"}
                            </button>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                            {setupPresets.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => applySetupPreset(preset)}
                                    className="rounded-lg border border-white/10 bg-black/25 p-4 text-left transition hover:border-cyan-300/50 hover:bg-cyan-300/10"
                                >
                                    <strong className="text-sm text-slate-100">{preset.label}</strong>
                                    <p className="mt-1 text-xs leading-5 text-slate-400">{preset.note}</p>
                                    <p className="mt-3 text-xs text-cyan-200">Ordem: {preset.order.map((item) => providerLabels[item]).join(" -> ")}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold">Prioridade de tentativa</h2>
                                <p className="text-sm text-slate-400">Arraste ou use Subir/Descer. O primeiro responde; se falhar, cai para o proximo.</p>
                            </div>
                            <span className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-xs text-cyan-200">
                                {providerLabels[providerOrder[0]]} primeiro
                            </span>
                        </div>

                        <div className="mt-4 grid gap-3">
                            {providerOrder.map((provider, index) => {
                                const health = providerHealth(provider);
                                const enabled = provider === "openrouter" ? !!settings.openrouterApiKeyMasked || !!openrouterApiKey : !!settings.geminiApiKeyMasked || !!geminiApiKey;
                                return (
                                    <article
                                        key={provider}
                                        draggable
                                        onDragStart={() => setDragging(provider)}
                                        onDragOver={(event) => event.preventDefault()}
                                        onDrop={() => onDropProvider(provider)}
                                        className={`grid gap-3 rounded-lg border p-3 transition md:grid-cols-[42px_1fr_auto_auto] md:items-center ${enabled ? "border-white/10 bg-black/25" : "border-amber-400/20 bg-amber-400/5"}`}
                                    >
                                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-400 text-sm font-black text-slate-950">{index + 1}</span>
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <strong className="text-base uppercase tracking-[0.08em]">{providerLabels[provider]}</strong>
                                                <span className={`rounded-md px-2 py-0.5 text-xs ${enabled ? "bg-emerald-400/10 text-emerald-200" : "bg-amber-400/10 text-amber-200"}`}>
                                                    {enabled ? "Ligado" : "Sem chave"}
                                                </span>
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                                <span className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-emerald-200">ok {health.success}</span>
                                                <span className="rounded-md border border-red-400/20 bg-red-400/10 px-2 py-1 text-red-200">erro {health.error}</span>
                                                <span className="rounded-md border border-slate-400/20 bg-slate-400/10 px-2 py-1 text-slate-300">skip {health.skipped}</span>
                                            </div>
                                        </div>
                                        <button type="button" onClick={() => setOpenCard(provider)} className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200">Configurar</button>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={() => moveProvider(provider, -1)} disabled={index === 0} className="h-9 rounded-md border border-white/10 px-2 text-xs text-slate-200 disabled:opacity-30">Subir</button>
                                            <button type="button" onClick={() => moveProvider(provider, 1)} disabled={index === providerOrder.length - 1} className="h-9 rounded-md border border-white/10 px-2 text-xs text-slate-200 disabled:opacity-30">Descer</button>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold">Configuracao das IAs</h2>
                                <p className="text-sm text-slate-400">Configure chave e modelos de cada provedor. O bot usa a mesma Lari em todos.</p>
                            </div>
                            <span className="rounded-md border border-white/10 bg-black/25 px-3 py-2 text-xs text-slate-300">Salvar no bot_settings</span>
                        </div>

                        <div className="mt-4 space-y-3">
                            <ProviderCard
                                provider="openrouter"
                                title="OpenRouter"
                                description="Principal para usar modelos free e pagos dentro do OpenRouter."
                                isOpen={openCard === "openrouter"}
                                onToggle={() => setOpenCard(openCard === "openrouter" ? "gemini" : "openrouter")}
                                enabled={!!settings.openrouterApiKeyMasked || !!openrouterApiKey}
                            >
                                <div className="grid gap-4">
                                    <Field label={`API Key ${settings.openrouterApiKeyMasked ? `(${settings.openrouterApiKeyMasked})` : "(nao salva)"}`}>
                                        <input value={openrouterApiKey} onChange={(e) => setOpenrouterApiKey(e.target.value)} type="password" className={inputClass} placeholder="sk-or-..." />
                                    </Field>
                                </div>
                                <ModelGrid
                                    provider="openrouter"
                                    onApplyPreset={(preset) => {
                                        setSettings((prev) => ({
                                            ...prev,
                                            openrouterDraftModel: preset.openrouter.draft,
                                            openrouterStrategyModel: preset.openrouter.strategy,
                                            openrouterReviewModel: preset.openrouter.review,
                                            openrouterEvaluatorModel: preset.openrouter.evaluator,
                                        }));
                                    }}
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
                                    stats={stats.filter((item) => item.provider === "openrouter")}
                                />
                            </ProviderCard>

                            <ProviderCard
                                provider="gemini"
                                title="Gemini"
                                description="Backup direto do Google Gemini para manter a Lari respondendo se OpenRouter cair."
                                isOpen={openCard === "gemini"}
                                onToggle={() => setOpenCard(openCard === "gemini" ? "openrouter" : "gemini")}
                                enabled={!!settings.geminiApiKeyMasked || !!geminiApiKey}
                            >
                                <div className="grid gap-4 md:grid-cols-2">
                                    <Field label={`API Key ${settings.geminiApiKeyMasked ? `(${settings.geminiApiKeyMasked})` : "(nao salva)"}`}>
                                        <input value={geminiApiKey} onChange={(e) => setGeminiApiKey(e.target.value)} type="password" className={inputClass} placeholder="AIza..." />
                                    </Field>
                                </div>
                                <ModelGrid
                                    provider="gemini"
                                    onApplyPreset={(preset) => {
                                        setSettings((prev) => ({
                                            ...prev,
                                            geminiDraftModel: preset.gemini.draft,
                                            geminiStrategyModel: preset.gemini.strategy,
                                            geminiReviewModel: preset.gemini.review,
                                            geminiEvaluatorModel: preset.gemini.evaluator,
                                        }));
                                    }}
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
                                    stats={stats.filter((item) => item.provider === "gemini")}
                                />
                            </ProviderCard>
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

function ProviderCard({
    provider,
    title,
    description,
    isOpen,
    enabled,
    onToggle,
    children,
}: {
    provider: ProviderKey;
    title: string;
    description: string;
    isOpen: boolean;
    enabled: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    return (
        <article className="rounded-lg border border-white/10 bg-black/20">
            <header className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-100">{title}</h3>
                        <span className={`rounded-md px-2 py-0.5 text-xs ${enabled ? "bg-emerald-400/10 text-emerald-200" : "bg-amber-400/10 text-amber-200"}`}>
                            {enabled ? "Ligado" : "Sem chave"}
                        </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{description}</p>
                </div>
                <button type="button" onClick={onToggle} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-200">
                    {isOpen ? "Fechar" : `Configurar ${providerLabels[provider]}`}
                </button>
            </header>
            {isOpen && <div className="border-t border-white/10 p-4">{children}</div>}
        </article>
    );
}

function ModelGrid({
    provider,
    values,
    onChange,
    onApplyPreset,
    stats,
}: {
    provider: ProviderKey;
    values: Record<RoleKey, string>;
    onChange: Record<RoleKey, (value: string) => void>;
    onApplyPreset: (preset: (typeof setupPresets)[number]) => void;
    stats: AiStat[];
}) {
    const presets = provider === "openrouter" ? openRouterPresets.map((item) => item.id) : geminiPresets;
    return (
        <div className="mt-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h4 className="text-sm font-semibold text-slate-200">Modelos por funcao</h4>
                    <p className="text-xs text-slate-500">Pode usar o preset pronto ou trocar campo por campo.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {setupPresets.map((preset) => (
                        <button key={preset.id} type="button" onClick={() => onApplyPreset(preset)} className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-200">
                            {preset.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
                {(Object.keys(roleLabels).filter((key) => ["draft", "strategy", "review", "evaluator"].includes(key)) as RoleKey[]).map((role) => (
                    <Field key={role} label={roleLabels[role]}>
                        <select value={values[role]} onChange={(e) => onChange[role](e.target.value)} className={inputClass}>
                            {!presets.includes(values[role]) && values[role] && <option value={values[role]}>{values[role]}</option>}
                            {presets.map((model) => (
                                <option key={model} value={model}>{model}</option>
                            ))}
                        </select>
                    </Field>
                ))}
            </div>

            {provider === "openrouter" && (
                <div className="mt-4 grid gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Biblioteca OpenRouter pronta</p>
                    {openRouterPresets.map((preset) => (
                        <div key={preset.id} className="rounded-lg border border-white/10 bg-black/25 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <p className="text-sm font-semibold text-slate-100">{preset.label}</p>
                                    <p className="text-xs text-slate-400">{preset.id} - {preset.note}</p>
                                    <ModelCounter stats={stats} model={preset.id} />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button type="button" onClick={() => onChange.draft(preset.id)} className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-200">Lari</button>
                                    <button type="button" onClick={() => onChange.strategy(preset.id)} className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-200">Estrategia</button>
                                    <button type="button" onClick={() => onChange.review(preset.id)} className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-200">Revisao</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {provider === "gemini" && (
                <div className="mt-4 rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-slate-400">
                    Gemini fica melhor como backup estavel. Para custo/velocidade, use Flash Lite em estrategia/avaliacao e Flash na Lari/revisao.
                </div>
            )}
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

function Metric({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-lg border border-white/10 bg-black/25 p-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">{value}</p>
        </div>
    );
}

function ModelCounter({ stats, model }: { stats: AiStat[]; model: string }) {
    const totals = stats
        .filter((item) => item.model === model)
        .reduce(
            (acc, item) => ({
                success: acc.success + Number(item.success || 0),
                error: acc.error + Number(item.error || 0),
            }),
            { success: 0, error: 0 }
        );

    return (
        <p className="mt-2 text-xs text-slate-500">
            ok {totals.success} erro {totals.error}
        </p>
    );
}
