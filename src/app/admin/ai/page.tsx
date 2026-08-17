"use client";

import { useEffect, useMemo, useState } from "react";
import {
    DEFAULT_GEMINI_LITE_MODEL,
    DEFAULT_GEMINI_MODEL,
    DEFAULT_OPENROUTER_MODEL,
    GEMINI_MODEL_OPTIONS,
} from "@/lib/aiModels";

type ProviderKey = "openrouter" | "gemini";

type AiSettings = {
    openrouterApiKeyMasked: string;
    geminiApiKeyMasked: string;
    openrouterApiKeySaved: boolean;
    geminiApiKeySaved: boolean;
    aiDraftModelOrder: string;
    aiStrategyEnabled: boolean;
    aiReviewEnabled: boolean;
    aiEvaluatorEnabled: boolean;
    openrouterStrategyModel: string;
    openrouterDraftModel: string;
    openrouterReviewModel: string;
    openrouterEvaluatorModel: string;
    geminiStrategyModel: string;
    geminiDraftModel: string;
    geminiReviewModel: string;
    geminiEvaluatorModel: string;
    fishAudioApiKeyMasked: string;
    fishAudioApiKeySaved: boolean;
    fishAudioEnabled: boolean;
    fishAudioVoiceId: string;
    fishAudioModel: string;
    fishAudioFrequencyPercent: number;
    fishAudioCooldownMinutes: number;
    fishAudioMaxChars: number;
};

type AiEvent = {
    at: string;
    role: string;
    provider: string;
    model: string;
    status: string;
    message?: string;
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
    openrouterApiKeySaved: false,
    geminiApiKeySaved: false,
    aiDraftModelOrder: "openrouter,gemini",
    aiStrategyEnabled: true,
    aiReviewEnabled: true,
    aiEvaluatorEnabled: true,
    openrouterStrategyModel: DEFAULT_OPENROUTER_MODEL,
    openrouterDraftModel: DEFAULT_OPENROUTER_MODEL,
    openrouterReviewModel: DEFAULT_OPENROUTER_MODEL,
    openrouterEvaluatorModel: DEFAULT_OPENROUTER_MODEL,
    geminiStrategyModel: DEFAULT_GEMINI_LITE_MODEL,
    geminiDraftModel: DEFAULT_GEMINI_MODEL,
    geminiReviewModel: DEFAULT_GEMINI_MODEL,
    geminiEvaluatorModel: DEFAULT_GEMINI_LITE_MODEL,
    fishAudioApiKeyMasked: "",
    fishAudioApiKeySaved: false,
    fishAudioEnabled: false,
    fishAudioVoiceId: "24522123b5804bf691a8450d9187f03e",
    fishAudioModel: "s2.1-pro-free",
    fishAudioFrequencyPercent: 18,
    fishAudioCooldownMinutes: 30,
    fishAudioMaxChars: 280,
};

const providerLabels: Record<ProviderKey, string> = {
    openrouter: "OpenRouter",
    gemini: "Gemini",
};

const roleLabels: Record<string, string> = {
    draft: "Lari",
    strategy: "Cérebro central",
    review: "Revisora",
    evaluator: "Avaliadora (legado)",
};

const PRESETS = {
    openrouterFree: {
        label: "DeepSeek V4 Flash",
        description: "Usa o DeepSeek barato primeiro e Gemini como reserva.",
        order: ["openrouter", "gemini"] as ProviderKey[],
        openrouter: {
            draft: DEFAULT_OPENROUTER_MODEL,
            strategy: DEFAULT_OPENROUTER_MODEL,
            review: DEFAULT_OPENROUTER_MODEL,
            evaluator: DEFAULT_OPENROUTER_MODEL,
        },
        gemini: {
            draft: DEFAULT_GEMINI_MODEL,
            strategy: DEFAULT_GEMINI_LITE_MODEL,
            review: DEFAULT_GEMINI_MODEL,
            evaluator: DEFAULT_GEMINI_LITE_MODEL,
        },
    },
    fullGemini: {
        label: "Full Gemini",
        description: "Usa Gemini em tudo. OpenRouter fica desligado da prioridade.",
        order: ["gemini", "openrouter"] as ProviderKey[],
        openrouter: {
            draft: DEFAULT_OPENROUTER_MODEL,
            strategy: DEFAULT_OPENROUTER_MODEL,
            review: DEFAULT_OPENROUTER_MODEL,
            evaluator: DEFAULT_OPENROUTER_MODEL,
        },
        gemini: {
            draft: DEFAULT_GEMINI_MODEL,
            strategy: DEFAULT_GEMINI_MODEL,
            review: DEFAULT_GEMINI_MODEL,
            evaluator: DEFAULT_GEMINI_LITE_MODEL,
        },
    },
};

const openRouterOptions = [
    DEFAULT_OPENROUTER_MODEL,
    "z-ai/glm-4.5-air:free",
    "openai/gpt-oss-120b:free",
    "google/gemma-4-31b-it:free",
    "openrouter/free",
];

const geminiOptions = [...GEMINI_MODEL_OPTIONS];

const inputClass = "rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300/60";

const parseOrder = (value?: string): ProviderKey[] => {
    const parsed = String(value || "")
        .split(",")
        .map((item) => item.trim().toLowerCase().split(":")[0])
        .filter((item): item is ProviderKey => item === "openrouter" || item === "gemini");
    return Array.from(new Set([...parsed, "openrouter", "gemini"]));
};

export default function AdminAiPage() {
    const [settings, setSettings] = useState<AiSettings>(emptySettings);
    const [order, setOrder] = useState<ProviderKey[]>(["openrouter", "gemini"]);
    const [openrouterApiKey, setOpenrouterApiKey] = useState("");
    const [geminiApiKey, setGeminiApiKey] = useState("");
    const [fishAudioApiKey, setFishAudioApiKey] = useState("");
    const [fishTestUrl, setFishTestUrl] = useState("");
    const [testingFish, setTestingFish] = useState(false);
    const [stats, setStats] = useState<AiStat[]>([]);
    const [recentEvents, setRecentEvents] = useState<AiEvent[]>([]);
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");

    useEffect(() => {
        load();
    }, []);

    useEffect(() => () => {
        if (fishTestUrl) URL.revokeObjectURL(fishTestUrl);
    }, [fishTestUrl]);

    const load = async () => {
        const res = await fetch("/api/admin/ai-settings", { cache: "no-store" });
        const data = await res.json();
        const next = data?.settings ? { ...emptySettings, ...data.settings } : emptySettings;
        setSettings(next);
        setOrder(parseOrder(next.aiDraftModelOrder));
        setStats(Array.isArray(data?.stats) ? data.stats : []);
        setRecentEvents(Array.isArray(data?.recentEvents) ? data.recentEvents : []);
    };

    const applyPreset = (preset: typeof PRESETS.openrouterFree) => {
        setOrder(preset.order);
        setSettings((prev) => ({
            ...prev,
            aiDraftModelOrder: preset.order.join(","),
            openrouterDraftModel: preset.openrouter.draft,
            openrouterStrategyModel: preset.openrouter.strategy,
            openrouterReviewModel: preset.openrouter.review,
            openrouterEvaluatorModel: preset.openrouter.evaluator,
            geminiDraftModel: preset.gemini.draft,
            geminiStrategyModel: preset.gemini.strategy,
            geminiReviewModel: preset.gemini.review,
            geminiEvaluatorModel: preset.gemini.evaluator,
        }));
        setMsg(`${preset.label} aplicado. Clique em Salvar para gravar.`);
    };

    const save = async () => {
        setLoading(true);
        setMsg("");
        const providerOrder = order.join(",");
        const openrouterKey = openrouterApiKey.trim();
        const geminiKey = geminiApiKey.trim();
        const fishKey = fishAudioApiKey.trim();
        const res = await fetch("/api/admin/ai-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ...settings,
                openrouterApiKey: openrouterKey,
                geminiApiKey: geminiKey,
                fishAudioApiKey: fishKey,
                aiModelOrder: providerOrder,
                aiDraftModelOrder: providerOrder,
                aiStrategyModelOrder: providerOrder,
                aiReviewModelOrder: providerOrder,
                aiEvaluatorModelOrder: providerOrder,
            }),
        });
        const data = await res.json();
        if (data?.error) {
            setMsg(`Erro: ${data.error}`);
        } else {
            setMsg("Configuração salva no banco. Se o campo da chave ficar vazio depois de atualizar, é normal: a chave fica oculta.");
            setOpenrouterApiKey("");
            setGeminiApiKey("");
            setFishAudioApiKey("");
            await load();
        }
        setLoading(false);
    };

    const testFishAudio = async () => {
        setTestingFish(true);
        setMsg("");
        try {
            const res = await fetch("/api/admin/fish-audio/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fishAudioApiKey: fishAudioApiKey.trim(),
                    fishAudioVoiceId: settings.fishAudioVoiceId,
                    fishAudioModel: settings.fishAudioModel,
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data?.error || `Fish Audio respondeu ${res.status}`);
            }
            const blob = await res.blob();
            if (fishTestUrl) URL.revokeObjectURL(fishTestUrl);
            setFishTestUrl(URL.createObjectURL(blob));
            setMsg("Áudio de teste gerado. Dê play abaixo para ouvir.");
        } catch (error: any) {
            setMsg(`Erro no teste de voz: ${error?.message || error}`);
        } finally {
            setTestingFish(false);
        }
    };

    const clearLogs = async () => {
        setLoading(true);
        const res = await fetch("/api/admin/ai-settings", { method: "DELETE" });
        const data = await res.json();
        setMsg(data?.error ? `Erro: ${data.error}` : "Erros limpos");
        await load();
        setLoading(false);
    };

    const moveProvider = (provider: ProviderKey, direction: -1 | 1) => {
        setOrder((current) => {
            const index = current.indexOf(provider);
            const target = index + direction;
            if (index < 0 || target < 0 || target >= current.length) return current;
            const next = [...current];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const providerTotals = (provider: ProviderKey) => {
        const rows = stats.filter((item) => item.provider === provider);
        return {
            ok: rows.reduce((sum, item) => sum + Number(item.success || 0), 0),
            error: rows.reduce((sum, item) => sum + Number(item.error || 0), 0),
        };
    };

    const errorRows = useMemo(() => {
        return stats
            .filter((item) => Number(item.error || 0) > 0)
            .sort((a, b) => Number(b.error || 0) - Number(a.error || 0))
            .slice(0, 8);
    }, [stats]);

    const statusWarnings = useMemo(() => {
        const text = recentEvents.map((event) => `${event.provider} ${event.message || ""}`).join("\n").toLowerCase();
        const warnings: string[] = [];
        if (text.includes("free-models-per-day") || text.includes("rate limit")) {
            warnings.push("OpenRouter Free bateu limite. Para voltar agora, coloque créditos no OpenRouter ou use Full Gemini.");
        }
        if (text.includes("403") || text.includes("denied access") || text.includes("forbidden")) {
            warnings.push("Gemini está recusando a chave/projeto. Troque a API Key ou habilite o projeto no Google AI Studio.");
        }
        return warnings;
    }, [recentEvents]);

    const hasConfiguredProvider = Boolean(settings.openrouterApiKeyMasked || settings.geminiApiKeyMasked);

    return (
        <div className="min-h-screen bg-[#080b10] text-slate-100">
            <header className="border-b border-white/10 bg-[#080b10]">
                <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-5 md:flex-row md:items-center md:justify-between">
                    <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">Admin</p>
                        <h1 className="text-xl font-semibold">Multi-IAs da Lari</h1>
                        <p className="text-sm text-slate-400">Escolha Gemini ou OpenRouter Free e acompanhe erros.</p>
                    </div>
                </div>
            </header>

            <main className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-6 lg:grid-cols-[1.1fr_0.9fr]">
                <section className="space-y-5">
                    {!hasConfiguredProvider && (
                        <div role="alert" className="rounded-lg border border-rose-400/40 bg-rose-400/10 p-4 text-rose-50">
                            <p className="font-semibold">Bot sem provedor de IA</p>
                            <p className="mt-1 text-sm text-rose-100/80">
                                Nenhuma chave está configurada. O Telegram usa respostas locais de emergência até você salvar uma chave Gemini ou OpenRouter abaixo.
                            </p>
                        </div>
                    )}
                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold">Preset principal</h2>
                                <p className="text-sm text-slate-400">Só dois modos para não confundir.</p>
                            </div>
                            <button onClick={save} disabled={loading} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">
                                {loading ? "Salvando..." : "Salvar"}
                            </button>
                        </div>
                        {statusWarnings.length > 0 && (
                            <div className="mt-4 grid gap-2">
                                {statusWarnings.map((warning) => (
                                    <div key={warning} className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                                        {warning}
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <PresetButton preset={PRESETS.fullGemini} onClick={() => applyPreset(PRESETS.fullGemini)} active={order[0] === "gemini"} />
                            <PresetButton preset={PRESETS.openrouterFree} onClick={() => applyPreset(PRESETS.openrouterFree)} active={order[0] === "openrouter"} />
                        </div>
                        {msg && <div className="mt-4 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200">{msg}</div>}
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <h2 className="text-lg font-semibold">Ordem atual</h2>
                        <div className="mt-4 grid gap-3">
                            {order.map((provider, index) => {
                                const totals = providerTotals(provider);
                                return (
                                    <div key={provider} className="grid gap-3 rounded-lg border border-white/10 bg-black/25 p-4 sm:grid-cols-[42px_1fr_auto] sm:items-center">
                                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-400 text-sm font-black text-slate-950">{index + 1}</span>
                                        <div>
                                            <strong className="text-base uppercase tracking-[0.08em]">{providerLabels[provider]}</strong>
                                            <p className="mt-2 text-sm">
                                                <span className="text-emerald-200">ok {totals.ok}</span>
                                                <span className="mx-2 text-slate-500">|</span>
                                                <span className="text-red-200">erro {totals.error}</span>
                                            </p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => moveProvider(provider, -1)} disabled={index === 0} className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 disabled:opacity-30">Subir</button>
                                            <button onClick={() => moveProvider(provider, 1)} disabled={index === order.length - 1} className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 disabled:opacity-30">Descer</button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <h2 className="text-lg font-semibold">Camadas da Lari</h2>
                        <p className="mt-1 text-sm text-slate-400">O caminho normal usa o cérebro central e a Lari. A revisão extra só entra em decisões críticas.</p>
                        <div className="mt-4 grid gap-3">
                            <LayerToggle
                                title="Lari responde"
                                description="Camada principal que escreve a resposta final."
                                checked
                                locked
                                onChange={() => undefined}
                            />
                            <LayerToggle
                                title="Cérebro central"
                                description="Analisa cada lead, usa memória persistente e planeja os balões antes da Lari responder."
                                checked={settings.aiStrategyEnabled}
                                onChange={(checked) => setSettings((prev) => ({ ...prev, aiStrategyEnabled: checked }))}
                            />
                            <LayerToggle
                                title="Revisora"
                                description="Revisa PIX e respostas de baixa confiança; conversas normais usam guardas locais mais rápidas."
                                checked={settings.aiReviewEnabled}
                                onChange={(checked) => setSettings((prev) => ({ ...prev, aiReviewEnabled: checked }))}
                            />
                            <LayerToggle
                                title="Score integrado"
                                description="A classificação vem do cérebro e as barrinhas são calculadas no backend, sem uma chamada extra."
                                checked
                                locked
                                onChange={() => undefined}
                            />
                        </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <h2 className="text-lg font-semibold">Chaves</h2>
                        <p className="mt-1 text-sm text-slate-400">
                            A chave nunca volta preenchida no campo por segurança. O que importa é o selo salva no banco.
                        </p>
                        <div className="mt-4 grid gap-4">
                            <KeyField
                                label="Gemini API Key"
                                value={geminiApiKey}
                                onChange={setGeminiApiKey}
                                placeholder="AIza..."
                                masked={settings.geminiApiKeyMasked}
                                saved={settings.geminiApiKeySaved}
                            />
                            <KeyField
                                label="OpenRouter API Key"
                                value={openrouterApiKey}
                                onChange={setOpenrouterApiKey}
                                placeholder="sk-or-..."
                                masked={settings.openrouterApiKeyMasked}
                                saved={settings.openrouterApiKeySaved}
                            />
                        </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <h2 className="text-lg font-semibold">Modelos</h2>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <ModelSelect title="Gemini Lari" value={settings.geminiDraftModel} options={geminiOptions} onChange={(value) => setSettings((prev) => ({ ...prev, geminiDraftModel: value, geminiStrategyModel: value, geminiReviewModel: value }))} />
                            <ModelSelect title="OpenRouter Lari" value={settings.openrouterDraftModel} options={openRouterOptions} onChange={(value) => setSettings((prev) => ({ ...prev, openrouterDraftModel: value, openrouterStrategyModel: value, openrouterReviewModel: value }))} />
                        </div>
                    </div>

                    <div className="rounded-lg border border-fuchsia-300/20 bg-fuchsia-300/[0.04] p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-fuchsia-200">Fish Audio</p>
                                <h2 className="mt-1 text-lg font-semibold">Voz natural da Lari</h2>
                                <p className="mt-1 max-w-xl text-sm leading-6 text-slate-400">
                                    Envia um áudio curto em momentos naturais. Emoção, pausa e tom são escolhidos pelo contexto; PIX e links continuam sempre em texto.
                                </p>
                            </div>
                            <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={settings.fishAudioEnabled}
                                    onChange={(event) => setSettings((prev) => ({ ...prev, fishAudioEnabled: event.target.checked }))}
                                    className="h-5 w-5 accent-fuchsia-300"
                                />
                                {settings.fishAudioEnabled ? "Ligada" : "Desligada"}
                            </label>
                        </div>

                        <div className="mt-5 grid gap-4">
                            <KeyField
                                label="Fish Audio API Key"
                                value={fishAudioApiKey}
                                onChange={setFishAudioApiKey}
                                placeholder="sk-fish-..."
                                masked={settings.fishAudioApiKeyMasked}
                                saved={settings.fishAudioApiKeySaved}
                            />
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="ID da voz">
                                    <input
                                        value={settings.fishAudioVoiceId}
                                        onChange={(event) => setSettings((prev) => ({ ...prev, fishAudioVoiceId: event.target.value }))}
                                        className={inputClass}
                                        placeholder="ID do modelo de voz"
                                    />
                                </Field>
                                <Field label="Modelo Fish">
                                    <select
                                        value={settings.fishAudioModel}
                                        onChange={(event) => setSettings((prev) => ({ ...prev, fishAudioModel: event.target.value }))}
                                        className={inputClass}
                                    >
                                        <option value="s2.1-pro-free">S2.1 Pro Free</option>
                                        <option value="s2.1-pro">S2.1 Pro</option>
                                    </select>
                                </Field>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-3">
                                <Field label={`Frequência: ${settings.fishAudioFrequencyPercent}%`}>
                                    <input
                                        type="range"
                                        min="1"
                                        max="60"
                                        value={settings.fishAudioFrequencyPercent}
                                        onChange={(event) => setSettings((prev) => ({ ...prev, fishAudioFrequencyPercent: Number(event.target.value) }))}
                                        className="w-full accent-fuchsia-300"
                                    />
                                </Field>
                                <Field label="Intervalo por lead (min)">
                                    <input
                                        type="number"
                                        min="1"
                                        max="1440"
                                        value={settings.fishAudioCooldownMinutes}
                                        onChange={(event) => setSettings((prev) => ({ ...prev, fishAudioCooldownMinutes: Number(event.target.value) }))}
                                        className={inputClass}
                                    />
                                </Field>
                                <Field label="Máximo de caracteres">
                                    <input
                                        type="number"
                                        min="60"
                                        max="500"
                                        value={settings.fishAudioMaxChars}
                                        onChange={(event) => setSettings((prev) => ({ ...prev, fishAudioMaxChars: Number(event.target.value) }))}
                                        className={inputClass}
                                    />
                                </Field>
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={testFishAudio}
                                    disabled={testingFish || (!fishAudioApiKey.trim() && !settings.fishAudioApiKeyMasked)}
                                    className="rounded-lg border border-fuchsia-200/30 bg-fuchsia-300/10 px-4 py-2 text-sm font-semibold text-fuchsia-100 disabled:opacity-40"
                                >
                                    {testingFish ? "Gerando voz..." : "Ouvir teste"}
                                </button>
                                {fishTestUrl && <audio controls autoPlay src={fishTestUrl} className="h-10 max-w-full" />}
                            </div>
                            <p className="text-xs leading-5 text-slate-500">
                                Configuração inicial: voz brasileira jovem e conversacional, 18% das respostas e no máximo um áudio a cada 30 minutos por lead.
                            </p>
                        </div>
                    </div>
                </section>

                <aside className="space-y-5">
                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-lg font-semibold">Erros por IA</h2>
                            <button onClick={clearLogs} disabled={loading} className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300">Limpar</button>
                        </div>
                        <div className="mt-4 space-y-2">
                            {errorRows.length === 0 && <p className="text-sm text-slate-400">Sem erro registrado.</p>}
                            {errorRows.map((item) => (
                                <div key={`${item.role}-${item.provider}-${item.model}`} className="rounded-lg border border-white/10 bg-black/25 p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <strong className="text-sm text-slate-100">{item.provider.toUpperCase()}</strong>
                                        <span className="text-xs text-slate-400">{roleLabels[item.role] || item.role}</span>
                                    </div>
                                    <p className="mt-1 break-all text-xs text-slate-400">{item.model}</p>
                                    <p className="mt-2 text-sm">
                                        <span className="text-emerald-200">ok {item.success || 0}</span>
                                        <span className="mx-2 text-slate-500">|</span>
                                        <span className="text-red-200">erro {item.error || 0}</span>
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <h2 className="text-lg font-semibold">Últimos erros</h2>
                        <div className="mt-4 max-h-[420px] overflow-auto space-y-2">
                            {recentEvents.filter((event) => event.status === "error").length === 0 && <p className="text-sm text-slate-400">Sem erro recente.</p>}
                            {recentEvents.filter((event) => event.status === "error").slice(0, 8).map((event, index) => (
                                <div key={`${event.at}-${index}`} className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-semibold text-red-100">{event.provider}:{event.model}</span>
                                        <span className="text-red-100/60">{new Date(event.at).toLocaleString()}</span>
                                    </div>
                                    {event.message && <p className="mt-2 whitespace-pre-wrap text-red-100/80">{event.message.slice(0, 300)}</p>}
                                </div>
                            ))}
                        </div>
                    </div>
                </aside>
            </main>
        </div>
    );
}

function PresetButton({ preset, onClick, active }: { preset: typeof PRESETS.openrouterFree; onClick: () => void; active: boolean }) {
    return (
        <button onClick={onClick} type="button" className={`rounded-lg border p-4 text-left transition ${active ? "border-cyan-300/60 bg-cyan-300/10" : "border-white/10 bg-black/25 hover:border-cyan-300/40"}`}>
            <strong className="text-base text-slate-100">{preset.label}</strong>
            <p className="mt-2 text-sm leading-6 text-slate-400">{preset.description}</p>
            <p className="mt-3 text-xs text-cyan-200">Ordem: {preset.order.map((item) => providerLabels[item]).join(" -> ")}</p>
        </button>
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

function KeyField({
    label,
    value,
    onChange,
    placeholder,
    masked,
    saved,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    masked: string;
    saved: boolean;
}) {
    return (
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
                <span className={`rounded-md px-2 py-1 text-xs ${saved ? "bg-emerald-400/10 text-emerald-200" : "bg-amber-400/10 text-amber-200"}`}>
                    {saved ? "salva no banco" : masked ? "usando env da Vercel" : "não configurada"}
                </span>
            </div>
            {masked && <p className="mt-2 text-xs text-slate-400">Atual: {masked}</p>}
            <input value={value} onChange={(event) => onChange(event.target.value)} type="password" className={`mt-3 w-full ${inputClass}`} placeholder={placeholder} />
            <p className="mt-2 text-xs text-slate-500">Cole uma nova chave só se quiser trocar a atual.</p>
        </div>
    );
}

function LayerToggle({
    title,
    description,
    checked,
    locked = false,
    onChange,
}: {
    title: string;
    description: string;
    checked: boolean;
    locked?: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className={`flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/25 p-4 ${locked ? "opacity-80" : ""}`}>
            <div>
                <strong className="text-sm text-slate-100">{title}</strong>
                <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
            </div>
            <span className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${checked ? "text-emerald-200" : "text-slate-500"}`}>
                    {locked ? "Sempre ligada" : checked ? "Ligada" : "Desligada"}
                </span>
                <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={(event) => onChange(event.target.checked)}
                    className="h-5 w-5 accent-cyan-400 disabled:cursor-not-allowed"
                />
            </span>
        </label>
    );
}

function ModelSelect({ title, value, options, onChange }: { title: string; value: string; options: string[]; onChange: (value: string) => void }) {
    return (
        <Field label={title}>
            <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>
                {!options.includes(value) && value && <option value={value}>{value}</option>}
                {options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                ))}
            </select>
        </Field>
    );
}
