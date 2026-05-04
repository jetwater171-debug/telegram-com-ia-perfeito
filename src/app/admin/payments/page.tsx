"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type GatewayKey = "wiinpay" | "pushinpay";

type PaymentSettings = {
    order: string;
    webhookBaseUrl: string;
    wiinpay: {
        enabled: boolean;
        saved: boolean;
        masked: string;
        envFallback: boolean;
    };
    pushinpay: {
        enabled: boolean;
        saved: boolean;
        masked: string;
        envFallback: boolean;
        environment: "production" | "sandbox";
    };
    webhook?: {
        tokenSaved: boolean;
        tokenMasked: string;
        envFallback: boolean;
    };
};

const emptySettings: PaymentSettings = {
    order: "wiinpay,pushinpay",
    webhookBaseUrl: "",
    wiinpay: { enabled: true, saved: false, masked: "", envFallback: false },
    pushinpay: { enabled: false, saved: false, masked: "", envFallback: false, environment: "production" },
};

const labels: Record<GatewayKey, string> = {
    wiinpay: "WiinPay",
    pushinpay: "PushinPay",
};

const parseOrder = (value?: string): GatewayKey[] => {
    const parsed = String(value || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item): item is GatewayKey => item === "wiinpay" || item === "pushinpay");
    return Array.from(new Set([...parsed, "wiinpay", "pushinpay"]));
};

const inputClass = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-300/60";

export default function AdminPaymentsPage() {
    const [settings, setSettings] = useState<PaymentSettings>(emptySettings);
    const [order, setOrder] = useState<GatewayKey[]>(["wiinpay", "pushinpay"]);
    const [wiinpayApiKey, setWiinpayApiKey] = useState("");
    const [pushinpayApiKey, setPushinpayApiKey] = useState("");
    const [webhookToken, setWebhookToken] = useState("");
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");

    useEffect(() => {
        load();
    }, []);

    const load = async () => {
        const res = await fetch("/api/admin/payment-gateways", { cache: "no-store" });
        const data = await res.json();
        const next = data?.settings ? { ...emptySettings, ...data.settings } : emptySettings;
        setSettings(next);
        setOrder(parseOrder(next.order));
    };

    const moveGateway = (gateway: GatewayKey, direction: -1 | 1) => {
        setOrder((current) => {
            const index = current.indexOf(gateway);
            const target = index + direction;
            if (index < 0 || target < 0 || target >= current.length) return current;
            const next = [...current];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const save = async () => {
        setLoading(true);
        setMsg("");
        const res = await fetch("/api/admin/payment-gateways", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                order: order.join(","),
                webhookBaseUrl: settings.webhookBaseUrl,
                webhookToken: webhookToken.trim(),
                wiinpay: {
                    enabled: settings.wiinpay.enabled,
                    apiKey: wiinpayApiKey.trim(),
                },
                pushinpay: {
                    enabled: settings.pushinpay.enabled,
                    apiKey: pushinpayApiKey.trim(),
                    environment: settings.pushinpay.environment,
                },
            }),
        });
        const data = await res.json();
        if (data?.error) {
            setMsg(`Erro: ${data.error}`);
        } else {
            setMsg("Gateways salvos. O proximo PIX ja usa essa ordem.");
            setWiinpayApiKey("");
            setPushinpayApiKey("");
            setWebhookToken("");
            await load();
        }
        setLoading(false);
    };

    const webhookUrl = settings.webhookBaseUrl
        ? `${settings.webhookBaseUrl.replace(/\/$/, "")}/api/payment/webhook?gateway=pushinpay`
        : "/api/payment/webhook?gateway=pushinpay";
    const webhookUrlHint = settings.webhook?.tokenSaved || settings.webhook?.envFallback || webhookToken.trim()
        ? `${webhookUrl}&token=SEU_TOKEN_WEBHOOK`
        : webhookUrl;

    return (
        <div className="min-h-screen bg-[#080b10] text-slate-100">
            <header className="border-b border-white/10 bg-[#080b10]">
                <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-5 md:flex-row md:items-center md:justify-between">
                    <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-emerald-300">Admin</p>
                        <h1 className="text-xl font-semibold">Gateways PIX</h1>
                        <p className="text-sm text-slate-400">Ordem, fallback e credenciais de pagamento da Lari.</p>
                    </div>
                    <nav className="flex flex-wrap gap-2 text-sm">
                        <Link href="/admin" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-200">Conversas</Link>
                        <Link href="/admin/ai" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-200">Multi-IAs</Link>
                        <Link href="/admin/settings" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-200">Config</Link>
                    </nav>
                </div>
            </header>

            <main className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-6 lg:grid-cols-[1fr_0.95fr]">
                <section className="space-y-5">
                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-semibold">Prioridade</h2>
                                <p className="text-sm text-slate-400">Se o primeiro falhar, a Lari tenta o proximo automaticamente.</p>
                            </div>
                            <button onClick={save} disabled={loading} className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">
                                {loading ? "Salvando..." : "Salvar"}
                            </button>
                        </div>

                        <div className="mt-4 grid gap-3">
                            {order.map((gateway, index) => (
                                <div key={gateway} className="grid gap-3 rounded-lg border border-white/10 bg-black/25 p-4 sm:grid-cols-[42px_1fr_auto] sm:items-center">
                                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-400 text-sm font-black text-slate-950">{index + 1}</span>
                                    <div>
                                        <strong className="text-base uppercase tracking-[0.08em]">{labels[gateway]}</strong>
                                        <p className="mt-1 text-sm text-slate-400">
                                            {settings[gateway].enabled ? "Ligado" : "Desligado"} / {settings[gateway].saved ? "chave no banco" : settings[gateway].envFallback ? "usando env" : "sem chave"}
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => moveGateway(gateway, -1)} disabled={index === 0} className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 disabled:opacity-30">Subir</button>
                                        <button onClick={() => moveGateway(gateway, 1)} disabled={index === order.length - 1} className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 disabled:opacity-30">Descer</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {msg && <div className="mt-4 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200">{msg}</div>}
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                        <h2 className="text-lg font-semibold">Webhook</h2>
                        <p className="mt-1 text-sm text-slate-400">Use uma URL publica do app para a PushinPay confirmar pagamento sem depender do lead avisar.</p>
                        <label className="mt-4 grid gap-2 text-sm">
                            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Base publica do app</span>
                            <input value={settings.webhookBaseUrl} onChange={(event) => setSettings((prev) => ({ ...prev, webhookBaseUrl: event.target.value }))} className={inputClass} placeholder="https://seu-app.vercel.app" />
                        </label>
                        <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3">
                            <p className="text-xs uppercase tracking-[0.16em] text-emerald-200">URL PushinPay</p>
                            <p className="mt-2 break-all text-sm text-slate-100">{webhookUrlHint}</p>
                        </div>
                        <label className="mt-4 grid gap-2 text-sm">
                            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Token do webhook</span>
                            {settings.webhook?.tokenMasked && <span className="text-xs text-slate-400">Atual: {settings.webhook.tokenMasked}</span>}
                            <input value={webhookToken} onChange={(event) => setWebhookToken(event.target.value)} type="password" className={inputClass} placeholder="opcional, para validar token no webhook" />
                            <span className="text-xs text-slate-500">Se preencher token, a Lari envia esse token automaticamente na URL do PIX criado.</span>
                        </label>
                    </div>
                </section>

                <aside className="space-y-5">
                    <GatewayCard
                        title="WiinPay"
                        enabled={settings.wiinpay.enabled}
                        onEnabled={(enabled) => setSettings((prev) => ({ ...prev, wiinpay: { ...prev.wiinpay, enabled } }))}
                        masked={settings.wiinpay.masked}
                        saved={settings.wiinpay.saved}
                        envFallback={settings.wiinpay.envFallback}
                        apiKey={wiinpayApiKey}
                        setApiKey={setWiinpayApiKey}
                        placeholder="chave WiinPay"
                    />

                    <GatewayCard
                        title="PushinPay"
                        enabled={settings.pushinpay.enabled}
                        onEnabled={(enabled) => setSettings((prev) => ({ ...prev, pushinpay: { ...prev.pushinpay, enabled } }))}
                        masked={settings.pushinpay.masked}
                        saved={settings.pushinpay.saved}
                        envFallback={settings.pushinpay.envFallback}
                        apiKey={pushinpayApiKey}
                        setApiKey={setPushinpayApiKey}
                        placeholder="Bearer token PushinPay"
                    >
                        <label className="mt-4 grid gap-2 text-sm">
                            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Ambiente</span>
                            <select value={settings.pushinpay.environment} onChange={(event) => setSettings((prev) => ({ ...prev, pushinpay: { ...prev.pushinpay, environment: event.target.value as "production" | "sandbox" } }))} className={inputClass}>
                                <option value="production">Producao</option>
                                <option value="sandbox">Sandbox</option>
                            </select>
                        </label>
                    </GatewayCard>
                </aside>
            </main>
        </div>
    );
}

function GatewayCard({
    title,
    enabled,
    onEnabled,
    masked,
    saved,
    envFallback,
    apiKey,
    setApiKey,
    placeholder,
    children,
}: {
    title: string;
    enabled: boolean;
    onEnabled: (enabled: boolean) => void;
    masked: string;
    saved: boolean;
    envFallback: boolean;
    apiKey: string;
    setApiKey: (value: string) => void;
    placeholder: string;
    children?: ReactNode;
}) {
    return (
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold">{title}</h2>
                    <p className="mt-1 text-sm text-slate-400">{saved ? "Chave salva no banco" : envFallback ? "Usando variavel de ambiente" : "Sem chave configurada"}</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                    <span>{enabled ? "Ligado" : "Desligado"}</span>
                    <input type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} className="h-5 w-5 accent-emerald-400" />
                </label>
            </div>
            {masked && <p className="mt-3 text-xs text-slate-400">Atual: {masked}</p>}
            <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" className={`mt-4 ${inputClass}`} placeholder={placeholder} />
            <p className="mt-2 text-xs text-slate-500">Cole uma nova chave so quando quiser trocar a atual.</p>
            {children}
        </div>
    );
}
