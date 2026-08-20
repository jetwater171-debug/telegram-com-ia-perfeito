"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_BAI_MODEL, DEFAULT_GEMINI_LITE_MODEL, DEFAULT_GEMINI_MODEL, DEFAULT_OPENROUTER_MODEL } from "@/lib/aiModels";

type ProviderKey = "bai" | "gemini" | "groq" | "nvidia" | "cloudflare" | "mistral" | "openrouter" | "cerebras" | "custom";
type SaveState = "loading" | "idle" | "saving" | "saved" | "error";

type AiSettings = {
    [key: string]: string | number | boolean;
    baiApiKeyMasked: string; baiApiKeySaved: boolean; baiApiKeySource: string;
    openrouterApiKeyMasked: string; openrouterApiKeySaved: boolean; openrouterApiKeySource: string;
    geminiApiKeyMasked: string; geminiApiKeySaved: boolean; geminiApiKeySource: string;
    groqApiKeyMasked: string; groqApiKeySaved: boolean; groqApiKeySource: string;
    nvidiaApiKeyMasked: string; nvidiaApiKeySaved: boolean; nvidiaApiKeySource: string;
    mistralApiKeyMasked: string; mistralApiKeySaved: boolean; mistralApiKeySource: string;
    cerebrasApiKeyMasked: string; cerebrasApiKeySaved: boolean; cerebrasApiKeySource: string;
    cloudflareApiTokenMasked: string; cloudflareApiTokenSaved: boolean; cloudflareApiTokenSource: string;
    customApiKeyMasked: string; customApiKeySaved: boolean; customApiKeySource: string;
    fishAudioApiKeyMasked: string; fishAudioApiKeySaved: boolean; fishAudioApiKeySource: string;
    aiModelOrder: string; aiStrategyModelOrder: string; aiDraftModelOrder: string; aiReviewModelOrder: string; aiEvaluatorModelOrder: string;
    aiStrategyEnabled: boolean; aiReviewEnabled: boolean; aiEvaluatorEnabled: boolean;
    aiSharedRateLimitEnabled: boolean; sharedRateLimitReady: boolean;
    openrouterBaseUrl: string; openrouterReferer: string; openrouterTitle: string;
    openrouterStrategyModel: string; openrouterDraftModel: string; openrouterReviewModel: string; openrouterEvaluatorModel: string;
    geminiStrategyModel: string; geminiDraftModel: string; geminiReviewModel: string; geminiEvaluatorModel: string;
    baiModel: string; groqModel: string; groqStarterModel: string; nvidiaModel: string; mistralModel: string; cerebrasModel: string; cloudflareModel: string;
    cloudflareAccountId: string; customBaseUrl: string; customModel: string; customTiers: string; customWeight: number;
    fishAudioEnabled: boolean; fishAudioVoiceId: string; fishAudioModel: string;
    fishAudioFrequencyPercent: number; fishAudioCooldownMinutes: number; fishAudioMaxChars: number;
};

type AiEvent = { at: string; role: string; provider: string; model: string; status: string; message?: string; durationMs?: number };
type AiStat = { role: string; provider: string; model: string; success?: number; error?: number; skipped?: number };
type RouterSnapshot = { key: string; inFlight: number; minuteRequests: number; minuteTokens: number; successes: number; failures: number; cooldownMs: number; ewmaLatencyMs: number; lastFailureKind?: string | null };

const PROVIDER_ORDER: ProviderKey[] = ["bai", "gemini", "groq", "nvidia", "cloudflare", "mistral", "openrouter", "cerebras", "custom"];
const PROVIDER_INFO: Record<ProviderKey, { label: string; short: string; description: string; keyUrl: string; keyLabel: string; color: string }> = {
    bai: { label: "B.AI · DeepSeek V4 Flash", short: "Principal de texto · 0 créditos agora", description: "Usa DeepSeek V4 Flash nas conversas de texto. Foto e outras mídias pulam esta rota e caem no Gemini.", keyUrl: "https://chat.b.ai/chat", keyLabel: "Abrir B.AI e gerar chave", color: "from-emerald-400 to-cyan-300" },
    gemini: { label: "Google Gemini", short: "Visão + fallback", description: "Analisa fotos e outras mídias dos leads e assume o texto se a B.AI estiver indisponível.", keyUrl: "https://aistudio.google.com/apikey", keyLabel: "Pegar chave no Google AI Studio", color: "from-blue-400 to-cyan-300" },
    groq: { label: "Groq", short: "Muito rápido", description: "Absorve conversas de texto com baixa latência e reduz a carga do Gemini.", keyUrl: "https://console.groq.com/keys", keyLabel: "Pegar chave na Groq", color: "from-orange-400 to-amber-300" },
    nvidia: { label: "NVIDIA NIM", short: "Modelos hospedados", description: "Rota oficial NVIDIA com modelos rápidos para distribuir as conversas e aliviar os provedores principais.", keyUrl: "https://build.nvidia.com/settings/api-keys", keyLabel: "Pegar chave na NVIDIA", color: "from-lime-400 to-green-300" },
    cloudflare: { label: "Cloudflare Workers AI", short: "Reserva barata", description: "Boa capacidade diária para o cérebro econômico dos primeiros contatos.", keyUrl: "https://dash.cloudflare.com/profile/api-tokens", keyLabel: "Criar token na Cloudflare", color: "from-amber-400 to-yellow-200" },
    mistral: { label: "Mistral", short: "Fallback oficial", description: "Rota oficial adicional quando os provedores principais estiverem cheios.", keyUrl: "https://console.mistral.ai/api-keys", keyLabel: "Pegar chave na Mistral", color: "from-red-400 to-orange-300" },
    openrouter: { label: "OpenRouter", short: "Agregador", description: "Última reserva com vários modelos e fallback interno automático.", keyUrl: "https://openrouter.ai/settings/keys", keyLabel: "Pegar chave no OpenRouter", color: "from-violet-400 to-fuchsia-300" },
    cerebras: { label: "Cerebras", short: "Trial rápido", description: "Rota rápida para clientes compradores enquanto houver crédito disponível.", keyUrl: "https://cloud.cerebras.ai/", keyLabel: "Abrir Cerebras Cloud", color: "from-emerald-400 to-lime-300" },
    custom: { label: "Gateway próprio", short: "OpenAI-compatible", description: "LiteLLM, 9Router, FreeLLMAPI ou outro endpoint administrado por você.", keyUrl: "", keyLabel: "", color: "from-slate-400 to-slate-200" },
};

const emptySettings: AiSettings = {
    baiApiKeyMasked: "", baiApiKeySaved: false, baiApiKeySource: "missing",
    openrouterApiKeyMasked: "", openrouterApiKeySaved: false, openrouterApiKeySource: "missing",
    geminiApiKeyMasked: "", geminiApiKeySaved: false, geminiApiKeySource: "missing",
    groqApiKeyMasked: "", groqApiKeySaved: false, groqApiKeySource: "missing",
    nvidiaApiKeyMasked: "", nvidiaApiKeySaved: false, nvidiaApiKeySource: "missing",
    mistralApiKeyMasked: "", mistralApiKeySaved: false, mistralApiKeySource: "missing",
    cerebrasApiKeyMasked: "", cerebrasApiKeySaved: false, cerebrasApiKeySource: "missing",
    cloudflareApiTokenMasked: "", cloudflareApiTokenSaved: false, cloudflareApiTokenSource: "missing",
    customApiKeyMasked: "", customApiKeySaved: false, customApiKeySource: "missing",
    fishAudioApiKeyMasked: "", fishAudioApiKeySaved: false, fishAudioApiKeySource: "missing",
    aiModelOrder: PROVIDER_ORDER.join(","), aiStrategyModelOrder: PROVIDER_ORDER.join(","), aiDraftModelOrder: PROVIDER_ORDER.join(","), aiReviewModelOrder: PROVIDER_ORDER.join(","), aiEvaluatorModelOrder: PROVIDER_ORDER.join(","),
    aiStrategyEnabled: true, aiReviewEnabled: true, aiEvaluatorEnabled: true,
    aiSharedRateLimitEnabled: true, sharedRateLimitReady: false,
    openrouterBaseUrl: "https://openrouter.ai/api/v1", openrouterReferer: "", openrouterTitle: "Lari Telegram Bot",
    openrouterStrategyModel: DEFAULT_OPENROUTER_MODEL, openrouterDraftModel: DEFAULT_OPENROUTER_MODEL, openrouterReviewModel: DEFAULT_OPENROUTER_MODEL, openrouterEvaluatorModel: DEFAULT_OPENROUTER_MODEL,
    geminiStrategyModel: DEFAULT_GEMINI_LITE_MODEL, geminiDraftModel: DEFAULT_GEMINI_MODEL, geminiReviewModel: DEFAULT_GEMINI_MODEL, geminiEvaluatorModel: DEFAULT_GEMINI_LITE_MODEL,
    baiModel: DEFAULT_BAI_MODEL, groqModel: "openai/gpt-oss-120b", groqStarterModel: "openai/gpt-oss-20b", nvidiaModel: "meta/llama-3.1-8b-instruct", mistralModel: "mistral-small-latest", cerebrasModel: "gpt-oss-120b", cloudflareModel: "@cf/openai/gpt-oss-20b",
    cloudflareAccountId: "", customBaseUrl: "", customModel: "auto", customTiers: "starter,buyer", customWeight: 5,
    fishAudioEnabled: false, fishAudioVoiceId: "24522123b5804bf691a8450d9187f03e", fishAudioModel: "s2.1-pro-free",
    fishAudioFrequencyPercent: 18, fishAudioCooldownMinutes: 30, fishAudioMaxChars: 240,
};

const inputClass = "w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:bg-black/40";

const parseOrder = (value: unknown): ProviderKey[] => {
    const parsed = String(value || "").split(",").map((item) => item.trim().toLowerCase().split(":")[0] as ProviderKey).filter((item) => PROVIDER_ORDER.includes(item));
    return Array.from(new Set([...parsed, ...PROVIDER_ORDER]));
};

const providerSecretMeta = (settings: AiSettings, provider: ProviderKey) => {
    if (provider === "bai") return { masked: settings.baiApiKeyMasked, saved: settings.baiApiKeySaved, source: settings.baiApiKeySource, payload: "baiApiKey" };
    if (provider === "gemini") return { masked: settings.geminiApiKeyMasked, saved: settings.geminiApiKeySaved, source: settings.geminiApiKeySource, payload: "geminiApiKey" };
    if (provider === "groq") return { masked: settings.groqApiKeyMasked, saved: settings.groqApiKeySaved, source: settings.groqApiKeySource, payload: "groqApiKey" };
    if (provider === "nvidia") return { masked: settings.nvidiaApiKeyMasked, saved: settings.nvidiaApiKeySaved, source: settings.nvidiaApiKeySource, payload: "nvidiaApiKey" };
    if (provider === "cloudflare") return { masked: settings.cloudflareApiTokenMasked, saved: settings.cloudflareApiTokenSaved, source: settings.cloudflareApiTokenSource, payload: "cloudflareApiToken" };
    if (provider === "mistral") return { masked: settings.mistralApiKeyMasked, saved: settings.mistralApiKeySaved, source: settings.mistralApiKeySource, payload: "mistralApiKey" };
    if (provider === "openrouter") return { masked: settings.openrouterApiKeyMasked, saved: settings.openrouterApiKeySaved, source: settings.openrouterApiKeySource, payload: "openrouterApiKey" };
    if (provider === "cerebras") return { masked: settings.cerebrasApiKeyMasked, saved: settings.cerebrasApiKeySaved, source: settings.cerebrasApiKeySource, payload: "cerebrasApiKey" };
    return { masked: settings.customApiKeyMasked, saved: settings.customApiKeySaved, source: settings.customApiKeySource, payload: "customApiKey" };
};

const providerModelMeta = (settings: AiSettings, provider: ProviderKey) => {
    if (provider === "bai") return { field: "baiModel", value: settings.baiModel, label: "Modelo de texto" };
    if (provider === "gemini") return { field: "geminiDraftModel", value: settings.geminiDraftModel, label: "Modelo da Lari" };
    if (provider === "groq") return { field: "groqStarterModel", value: settings.groqStarterModel, label: "Modelo econômico" };
    if (provider === "nvidia") return { field: "nvidiaModel", value: settings.nvidiaModel, label: "Modelo" };
    if (provider === "cloudflare") return { field: "cloudflareModel", value: settings.cloudflareModel, label: "Modelo" };
    if (provider === "mistral") return { field: "mistralModel", value: settings.mistralModel, label: "Modelo" };
    if (provider === "openrouter") return { field: "openrouterDraftModel", value: settings.openrouterDraftModel, label: "Modelo principal" };
    if (provider === "cerebras") return { field: "cerebrasModel", value: settings.cerebrasModel, label: "Modelo" };
    return { field: "customModel", value: settings.customModel, label: "Modelo" };
};

export default function AdminAiPage() {
    const [settings, setSettings] = useState<AiSettings>(emptySettings);
    const [order, setOrder] = useState<ProviderKey[]>(PROVIDER_ORDER);
    const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
    const [stats, setStats] = useState<AiStat[]>([]);
    const [recentEvents, setRecentEvents] = useState<AiEvent[]>([]);
    const [routerSnapshot, setRouterSnapshot] = useState<RouterSnapshot[]>([]);
    const [saveState, setSaveState] = useState<SaveState>("loading");
    const [message, setMessage] = useState("Carregando configuração...");
    const [testing, setTesting] = useState<Record<string, boolean>>({});
    const [testResults, setTestResults] = useState<Record<string, string>>({});
    const [fishTestUrl, setFishTestUrl] = useState("");
    const initializedRef = useRef(false);
    const lastQueuedRef = useRef("");
    const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());

    const buildPayload = useCallback((secretOverrides: Record<string, string> = {}) => ({
        ...settings,
        ...secretOverrides,
        aiModelOrder: order.join(","),
        aiDraftModelOrder: order.join(","),
        aiStrategyModelOrder: order.join(","),
        aiReviewModelOrder: order.join(","),
        aiEvaluatorModelOrder: order.join(","),
    }), [settings, order]);

    const load = useCallback(async () => {
        setSaveState("loading");
        const response = await fetch("/api/admin/ai-settings", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || data?.error) throw new Error(data?.error || `HTTP ${response.status}`);
        const next = { ...emptySettings, ...data.settings } as AiSettings;
        const nextOrder = parseOrder(next.aiModelOrder || next.aiDraftModelOrder);
        setSettings(next);
        setOrder(nextOrder);
        setStats(Array.isArray(data.stats) ? data.stats : []);
        setRecentEvents(Array.isArray(data.recentEvents) ? data.recentEvents : []);
        setRouterSnapshot(Array.isArray(data.routerSnapshot) ? data.routerSnapshot : []);
        lastQueuedRef.current = JSON.stringify({ settings: next, order: nextOrder });
        initializedRef.current = true;
        setSaveState("idle");
        setMessage("Tudo carregado. Alterações comuns salvam sozinhas.");
    }, []);

    useEffect(() => {
        load().catch((error) => {
            setSaveState("error");
            setMessage(`Erro ao carregar: ${error?.message || error}`);
        });
    }, [load]);

    useEffect(() => () => {
        if (fishTestUrl) URL.revokeObjectURL(fishTestUrl);
    }, [fishTestUrl]);

    const persist = useCallback((secretOverrides: Record<string, string> = {}) => {
        const payload = buildPayload(secretOverrides);
        setSaveState("saving");
        setMessage("Salvando automaticamente...");
        const job = async () => {
            const response = await fetch("/api/admin/ai-settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await response.json();
            if (!response.ok || data?.error) throw new Error(data?.error || `HTTP ${response.status}`);
            setSaveState("saved");
            setMessage(`Salvo automaticamente às ${new Date(data.savedAt || Date.now()).toLocaleTimeString()}.`);
            return data;
        };
        const queued = saveChainRef.current.then(job, job);
        saveChainRef.current = queued.catch(() => undefined);
        queued.catch((error) => {
            setSaveState("error");
            setMessage(`Erro ao salvar: ${error?.message || error}`);
        });
        return queued;
    }, [buildPayload]);

    useEffect(() => {
        if (!initializedRef.current) return;
        const signature = JSON.stringify({ settings, order });
        if (signature === lastQueuedRef.current) return;
        lastQueuedRef.current = signature;
        const timer = window.setTimeout(() => { void persist(); }, 800);
        return () => window.clearTimeout(timer);
    }, [settings, order, persist]);

    const updateSetting = (field: string, value: string | number | boolean) => setSettings((current) => ({ ...current, [field]: value }));

    const saveSecret = async (provider: ProviderKey) => {
        const meta = providerSecretMeta(settings, provider);
        const value = String(secretDrafts[provider] || "").trim();
        if (!value) return;
        await persist({ [meta.payload]: value });
        setSecretDrafts((current) => ({ ...current, [provider]: "" }));
        await load();
    };

    const testProvider = async (provider: ProviderKey) => {
        setTesting((current) => ({ ...current, [provider]: true }));
        setTestResults((current) => ({ ...current, [provider]: "Testando..." }));
        try {
            const response = await fetch("/api/admin/ai-settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider,
                    apiKey: secretDrafts[provider] || "",
                    accountId: settings.cloudflareAccountId,
                    baseUrl: settings.customBaseUrl,
                    model: providerModelMeta(settings, provider).value,
                }),
            });
            const data = await response.json();
            if (!response.ok || data?.error) throw new Error(data?.error || `HTTP ${response.status}`);
            setTestResults((current) => ({ ...current, [provider]: `Conectado em ${data.latencyMs}ms` }));
        } catch (error: any) {
            setTestResults((current) => ({ ...current, [provider]: `Falhou: ${error?.message || error}` }));
        } finally {
            setTesting((current) => ({ ...current, [provider]: false }));
        }
    };

    const moveProvider = (provider: ProviderKey, direction: -1 | 1) => setOrder((current) => {
        const index = current.indexOf(provider);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= current.length) return current;
        const next = [...current];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
    });

    const useRecommendedOrder = () => {
        setOrder(PROVIDER_ORDER);
        setSettings((current) => ({ ...current, aiStrategyEnabled: true, aiReviewEnabled: true, aiEvaluatorEnabled: true, aiSharedRateLimitEnabled: true }));
    };

    const providerTotals = useCallback((provider: ProviderKey) => {
        const rows = stats.filter((item) => item.provider === provider);
        return {
            success: rows.reduce((sum, item) => sum + Number(item.success || 0), 0),
            error: rows.reduce((sum, item) => sum + Number(item.error || 0), 0),
        };
    }, [stats]);

    const configuredCount = useMemo(() => PROVIDER_ORDER.filter((provider) => providerSecretMeta(settings, provider).source !== "missing").length, [settings]);
    const latestErrors = useMemo(() => recentEvents.filter((event) => event.status === "error").slice(0, 6), [recentEvents]);

    const testFishAudio = async () => {
        setTesting((current) => ({ ...current, fish: true }));
        try {
            const response = await fetch("/api/admin/fish-audio/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fishAudioApiKey: secretDrafts.fish || "", fishAudioVoiceId: settings.fishAudioVoiceId, fishAudioModel: settings.fishAudioModel }),
            });
            if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error || `HTTP ${response.status}`);
            const blob = await response.blob();
            if (fishTestUrl) URL.revokeObjectURL(fishTestUrl);
            setFishTestUrl(URL.createObjectURL(blob));
            setTestResults((current) => ({ ...current, fish: "Áudio pronto. Dê play abaixo." }));
        } catch (error: any) {
            setTestResults((current) => ({ ...current, fish: `Falhou: ${error?.message || error}` }));
        } finally {
            setTesting((current) => ({ ...current, fish: false }));
        }
    };

    return (
        <div className="min-h-screen bg-[#070a0f] text-slate-100">
            <header className="sticky top-0 z-20 border-b border-white/10 bg-[#070a0f]/95 backdrop-blur-xl">
                <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Central de inteligência</p>
                        <h1 className="mt-1 text-2xl font-semibold">APIs e roteamento da Lari</h1>
                        <p className="mt-1 text-sm text-slate-400">Cole as chaves, teste e pronto. O restante salva automaticamente.</p>
                    </div>
                    <SaveBadge state={saveState} message={message} />
                </div>
            </header>

            <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                <section className="space-y-6">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <TierCard title="Primeiro contato" value="1 IA" detail="Uma chamada econômica" color="cyan" />
                        <TierCard title="R$ 19,90+" value="2 IAs" detail="Cérebro + Lari" color="blue" />
                        <TierCard title="R$ 100+" value="3 IAs" detail="Revisão em todo turno" color="violet" />
                        <TierCard title="R$ 200+" value="4 IAs" detail="Avaliadora final" color="emerald" />
                    </div>

                    <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2 className="text-lg font-semibold">Ordem recomendada para volume</h2>
                                <p className="mt-1 text-sm text-slate-400">B.AI para texto → Gemini para visão/fallback → Groq → NVIDIA → Cloudflare → demais reservas.</p>
                            </div>
                            <button type="button" onClick={useRecommendedOrder} className="rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-cyan-200">Usar ordem recomendada</button>
                        </div>
                    </div>

                    <div className="space-y-4">
                        {order.map((provider, index) => {
                            const info = PROVIDER_INFO[provider];
                            const secret = providerSecretMeta(settings, provider);
                            const model = providerModelMeta(settings, provider);
                            const totals = providerTotals(provider);
                            return (
                                <article key={provider} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
                                    <div className="flex flex-col gap-4 p-5 md:flex-row md:items-start">
                                        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${info.color} text-base font-black text-slate-950`}>{index + 1}</div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h2 className="text-lg font-semibold">{info.label}</h2>
                                                <StatusPill source={secret.source} />
                                                <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-400">{info.short}</span>
                                            </div>
                                            <p className="mt-2 text-sm leading-6 text-slate-400">{info.description}</p>
                                            <div className="mt-3 flex flex-wrap gap-3 text-xs">
                                                <span className="text-emerald-300">{totals.success} sucessos</span>
                                                <span className="text-rose-300">{totals.error} erros</span>
                                                {secret.masked && <span className="text-slate-500">Chave: {secret.masked}</span>}
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 gap-2">
                                            <button type="button" onClick={() => moveProvider(provider, -1)} disabled={index === 0} className="rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-25">↑</button>
                                            <button type="button" onClick={() => moveProvider(provider, 1)} disabled={index === order.length - 1} className="rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-25">↓</button>
                                        </div>
                                    </div>

                                    <div className="grid gap-4 border-t border-white/10 bg-black/15 p-5 md:grid-cols-2">
                                        <Field label="API Key">
                                            <input
                                                type="password"
                                                value={secretDrafts[provider] || ""}
                                                onChange={(event) => setSecretDrafts((current) => ({ ...current, [provider]: event.target.value }))}
                                                onBlur={() => void saveSecret(provider)}
                                                placeholder={secret.masked ? "Cole somente para trocar a chave" : "Cole a chave aqui"}
                                                className={inputClass}
                                            />
                                            <p className="text-xs text-slate-500">A chave é salva quando você sair deste campo.</p>
                                        </Field>
                                        <Field label={model.label}>
                                            <input value={String(model.value)} onChange={(event) => updateSetting(model.field, event.target.value)} className={inputClass} />
                                        </Field>

                                        {provider === "cloudflare" && <Field label="Account ID"><input value={settings.cloudflareAccountId} onChange={(event) => updateSetting("cloudflareAccountId", event.target.value)} className={inputClass} placeholder="ID da conta Cloudflare" /></Field>}
                                        {provider === "custom" && <Field label="URL base"><input value={settings.customBaseUrl} onChange={(event) => updateSetting("customBaseUrl", event.target.value)} className={inputClass} placeholder="https://seu-gateway/v1" /></Field>}
                                        {provider === "groq" && <Field label="Modelo para compradores"><input value={settings.groqModel} onChange={(event) => updateSetting("groqModel", event.target.value)} className={inputClass} /></Field>}

                                        <div className="flex flex-wrap items-end gap-2 md:col-span-2">
                                            {info.keyUrl && <a href={info.keyUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/15">{info.keyLabel} ↗</a>}
                                            <button type="button" onClick={() => void testProvider(provider)} disabled={testing[provider]} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold hover:bg-white/5 disabled:opacity-50">{testing[provider] ? "Testando..." : "Testar conexão"}</button>
                                            {testResults[provider] && <span className={`text-xs ${testResults[provider].startsWith("Conectado") ? "text-emerald-300" : "text-amber-200"}`}>{testResults[provider]}</span>}
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </section>

                <aside className="space-y-5">
                    <Panel title="Resumo">
                        <div className="grid grid-cols-2 gap-3">
                            <Metric value={String(configuredCount)} label="APIs configuradas" />
                            <Metric value={String(stats.reduce((sum, item) => sum + Number(item.success || 0), 0))} label="Chamadas OK" />
                        </div>
                        <p className="mt-4 text-xs leading-5 text-slate-500">Provedor cheio, lento ou com erro sai da rota automaticamente. A Lari tenta o próximo sem duplicar a resposta.</p>
                        {routerSnapshot.length > 0 && <div className="mt-4 space-y-2 border-t border-white/10 pt-4">{routerSnapshot.slice(0, 6).map((item) => <div key={item.key} className="flex items-center justify-between gap-3 text-xs"><span className="truncate text-slate-400">{item.key}</span><span className={item.cooldownMs > 0 ? "text-amber-200" : "text-emerald-300"}>{item.cooldownMs > 0 ? `pausa ${Math.ceil(item.cooldownMs / 1000)}s` : `${item.minuteRequests}/min · ${item.ewmaLatencyMs || 0}ms`}</span></div>)}</div>}
                    </Panel>

                    <Panel title="Proteção para 30 leads/min">
                        <Toggle title="Limitador compartilhado" description={settings.sharedRateLimitReady ? "Pronto para coordenar todas as instâncias da Vercel." : "Falta SERVICE_ROLE e aplicar a migration do limitador."} checked={settings.aiSharedRateLimitEnabled} onChange={(value) => updateSetting("aiSharedRateLimitEnabled", value)} />
                        <Toggle title="Cérebro progressivo" description="Ativa mais camadas somente depois da compra." checked={settings.aiStrategyEnabled} onChange={(value) => updateSetting("aiStrategyEnabled", value)} />
                        <Toggle title="Revisora" description="Corrige respostas críticas e clientes compradores." checked={settings.aiReviewEnabled} onChange={(value) => updateSetting("aiReviewEnabled", value)} />
                        <Toggle title="Avaliadora elite" description="Quarta camada para clientes acima de R$ 200." checked={settings.aiEvaluatorEnabled} onChange={(value) => updateSetting("aiEvaluatorEnabled", value)} />
                    </Panel>

                    <Panel title="Fish Audio">
                        <div className="space-y-3">
                            <StatusPill source={settings.fishAudioApiKeySource} />
                            <Field label="API Key de voz">
                                <input type="password" value={secretDrafts.fish || ""} onChange={(event) => setSecretDrafts((current) => ({ ...current, fish: event.target.value }))} onBlur={() => { const value = String(secretDrafts.fish || "").trim(); if (value) void persist({ fishAudioApiKey: value }).then(() => setSecretDrafts((current) => ({ ...current, fish: "" }))); }} className={inputClass} placeholder={settings.fishAudioApiKeyMasked ? "Cole somente para trocar" : "Cole a chave Fish Audio"} />
                            </Field>
                            <a href="https://fish.audio/app/api-keys/" target="_blank" rel="noreferrer" className="block rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-center text-sm font-semibold text-cyan-100">Pegar chave no Fish Audio ↗</a>
                            <Toggle title="Enviar áudios" description="Mantém o modelo gratuito configurado." checked={settings.fishAudioEnabled} onChange={(value) => updateSetting("fishAudioEnabled", value)} />
                            <Field label="Voice ID"><input value={settings.fishAudioVoiceId} onChange={(event) => updateSetting("fishAudioVoiceId", event.target.value)} className={inputClass} /></Field>
                            <button type="button" onClick={() => void testFishAudio()} disabled={testing.fish} className="w-full rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold hover:bg-white/5">{testing.fish ? "Gerando..." : "Gerar áudio de teste"}</button>
                            {testResults.fish && <p className="text-xs text-slate-400">{testResults.fish}</p>}
                            {fishTestUrl && <audio controls src={fishTestUrl} className="w-full" />}
                        </div>
                    </Panel>

                    <Panel title="Erros recentes">
                        <div className="space-y-2">
                            {latestErrors.length === 0 && <p className="text-sm text-emerald-300">Nenhum erro recente.</p>}
                            {latestErrors.map((event, index) => (
                                <div key={`${event.at}-${index}`} className="rounded-xl border border-rose-400/15 bg-rose-400/[0.06] p-3">
                                    <div className="flex items-center justify-between gap-2 text-xs"><strong className="text-rose-200">{event.provider}</strong><span className="text-slate-600">{new Date(event.at).toLocaleTimeString()}</span></div>
                                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-400">{event.message || "erro sem detalhe"}</p>
                                </div>
                            ))}
                        </div>
                    </Panel>
                </aside>
            </main>
        </div>
    );
}

function SaveBadge({ state, message }: { state: SaveState; message: string }) {
    const style = state === "error" ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : state === "saving" || state === "loading" ? "border-amber-400/30 bg-amber-400/10 text-amber-100" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
    return <div className={`max-w-md rounded-xl border px-4 py-2.5 text-sm ${style}`}><strong>{state === "saving" ? "Salvando" : state === "error" ? "Atenção" : "Autosave ligado"}</strong><p className="mt-0.5 text-xs opacity-75">{message}</p></div>;
}

function TierCard({ title, value, detail, color }: { title: string; value: string; detail: string; color: string }) {
    return <div className={`rounded-2xl border border-${color}-300/20 bg-white/[0.035] p-4`}><p className="text-xs uppercase tracking-[0.15em] text-slate-500">{title}</p><strong className="mt-2 block text-xl">{value}</strong><p className="mt-1 text-xs text-slate-400">{detail}</p></div>;
}

function StatusPill({ source }: { source: string }) {
    const configured = source !== "missing";
    return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${configured ? "bg-emerald-400/10 text-emerald-200" : "bg-amber-400/10 text-amber-200"}`}>{source === "database" ? "Salva no painel" : source === "vercel" ? "Vercel" : "Falta chave"}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="grid gap-2 text-sm"><span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</span>{children}</label>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
    return <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"><h2 className="mb-4 text-base font-semibold">{title}</h2>{children}</section>;
}

function Metric({ value, label }: { value: string; label: string }) {
    return <div className="rounded-xl border border-white/10 bg-black/20 p-3"><strong className="text-xl">{value}</strong><p className="mt-1 text-xs text-slate-500">{label}</p></div>;
}

function Toggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
    return <label className="mb-3 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3 last:mb-0"><span><strong className="text-sm">{title}</strong><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5 shrink-0 accent-cyan-300" /></label>;
}
