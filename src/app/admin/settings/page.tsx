"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";

export default function AdminSettingsPage() {
    const [token, setToken] = useState("");
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");
    const [showToken, setShowToken] = useState(false);

    useEffect(() => {
        loadToken();
    }, []);

    const loadToken = async () => {
        const res = await fetch("/api/admin/bot-settings");
        const data = await res.json();
        if (data?.token !== undefined) setToken(data.token);
    };

    const saveToken = async () => {
        setLoading(true);
        setMsg("");

        const res = await fetch("/api/admin/bot-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (data?.error) {
            setMsg("Erro ao salvar: " + data.error);
        } else {
            setMsg("Token salvo com sucesso!");
        }
        setLoading(false);
    };

    const connectWebhook = async () => {
        setLoading(true);
        setMsg("Conectando webhook...");
        try {
            const res = await fetch("/api/admin/set-webhook", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ appUrl: window.location.origin }),
            });
            const data = await res.json();
            if (data.ok) {
                setMsg("Webhook conectado com sucesso! O bot deve responder agora.");
            } else {
                setMsg("Erro no Telegram: " + (data.description || JSON.stringify(data)));
            }
        } catch (e: any) {
            setMsg("Falha na requisicao: " + e.message);
        }
        setLoading(false);
    };

    return (
        <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -top-24 right-10 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
                <div className="absolute bottom-0 left-10 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl" />
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />
            </div>

            <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
                <header className="flex flex-col gap-2">
                    <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/80">Admin</p>
                    <h1 className="text-3xl font-semibold text-white">Configuracoes do Bot</h1>
                    <p className="text-sm text-slate-300">
                        Ajuste o token do Telegram e reconecte o webhook quando precisar.
                    </p>
                </header>

                <nav className="flex flex-wrap gap-2 rounded-full border border-white/10 bg-white/5 p-1 text-sm">
                    <Link href="/admin/insights" className="rounded-full px-3 py-1.5 text-slate-200 transition hover:bg-white/10">
                        Insights
                    </Link>
                    <Link href="/admin/scripts" className="rounded-full px-3 py-1.5 text-slate-200 transition hover:bg-white/10">
                        Scripts
                    </Link>
                    <Link href="/admin/variants" className="rounded-full px-3 py-1.5 text-slate-200 transition hover:bg-white/10">
                        Variacoes
                    </Link>
                    <Link href="/admin/optimizer" className="rounded-full px-3 py-1.5 text-slate-200 transition hover:bg-white/10">
                        IA
                    </Link>
                    <Link href="/admin" className="rounded-full px-3 py-1.5 text-slate-200 transition hover:bg-white/10">
                        Voltar
                    </Link>
                </nav>

                <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 via-white/3 to-white/5 p-6 shadow-[0_20px_50px_-30px_rgba(15,23,42,0.9)]">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-lg font-semibold text-white">Token do Telegram</h2>
                            <p className="text-sm text-slate-300">
                                Salve o token do bot e mantenha esse dado em sigilo.
                            </p>
                        </div>
                        <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
                            Seguro
                        </span>
                    </div>

                    <div className="mt-5 flex flex-col gap-3">
                        <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                            Token do Bot
                        </label>
                        <div className="flex flex-col gap-3 sm:flex-row">
                            <input
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                                type={showToken ? "text" : "password"}
                                className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
                                placeholder="123456:ABC-DEF..."
                                autoComplete="off"
                            />
                            <button
                                type="button"
                                onClick={() => setShowToken((prev) => !prev)}
                                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 transition hover:bg-white/10"
                            >
                                {showToken ? "Ocultar" : "Mostrar"}
                            </button>
                        </div>
                    </div>

                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                        <button
                            onClick={saveToken}
                            disabled={loading}
                            className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition ${
                                loading
                                    ? "cursor-not-allowed bg-slate-700 text-slate-300"
                                    : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                            }`}
                        >
                            {loading ? "Processando..." : "Salvar Token"}
                        </button>

                        <button
                            onClick={connectWebhook}
                            disabled={loading}
                            className="w-full rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
                        >
                            Conectar Webhook (Reparar Bot)
                        </button>
                    </div>

                    {msg && (
                        <div
                            className={`mt-5 rounded-xl border px-4 py-3 text-sm ${
                                msg.includes("Erro")
                                    ? "border-red-500/30 bg-red-500/10 text-red-200"
                                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                            }`}
                        >
                            {msg}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
