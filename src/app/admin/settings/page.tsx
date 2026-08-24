"use client";
import React, { useEffect, useState } from "react";
import { adminFetchJson } from "@/lib/adminApiClient";

export default function AdminSettingsPage() {
    const [token, setToken] = useState("");
    const [username, setUsername] = useState("");
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");
    const [showToken, setShowToken] = useState(false);
    const [loadingInitial, setLoadingInitial] = useState(true);

    useEffect(() => {
        loadToken();
    }, []);

    const loadToken = async () => {
        try {
            const data = await adminFetchJson<{ token?: string; username?: string }>("/api/admin/bot-settings");
            if (data?.token !== undefined) setToken(data.token);
            if (data?.username !== undefined) setUsername(data.username);
        } catch (error: any) {
            setMsg(`Erro ao carregar: ${error?.message || error}`);
        } finally {
            setLoadingInitial(false);
        }
    };

    const saveToken = async () => {
        setLoading(true);
        setMsg("");

        try {
            const data = await adminFetchJson<{ username?: string }>("/api/admin/bot-settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token }),
            });
            if (data?.username) {
                setUsername(data.username);
                setMsg(`Salvo e validado. Bot conectado: @${data.username}`);
            } else {
                setMsg("Token salvo e validado.");
            }
        } catch (error: any) {
            setMsg(`Erro ao salvar: ${error?.message || error}`);
        } finally {
            setLoading(false);
        }
    };

    const connectWebhook = async () => {
        setLoading(true);
        setMsg("Conectando webhook...");
        try {
            const data = await adminFetchJson<{ ok?: boolean; description?: string }>("/api/admin/set-webhook", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ appUrl: window.location.origin }),
            });
            if (data.ok) {
                setMsg("Webhook conectado e confirmado pelo Telegram.");
            } else {
                throw new Error(data.description || "Telegram não confirmou o webhook");
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
                <header className="admin-page-header">
                    <p className="admin-eyebrow">Infraestrutura</p>
                    <h1 className="admin-page-title">Ajustes do bot</h1>
                    <p className="admin-page-subtitle">Conecte o Telegram e repare o webhook com validação real, sem expor credenciais.</p>
                </header>

                <section className="admin-card p-6">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-lg font-semibold text-white">Token do Telegram</h2>
                            <p className="text-sm text-slate-300">
                                Salve o token do bot e mantenha esse dado em sigilo.
                            </p>
                        </div>
                        <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
                            {loadingInitial ? "Verificando" : username ? "Conectado" : "Configurar"}
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
                        {username && (
                            <div className="flex items-center gap-2 text-xs text-slate-300">
                                <span>Bot ativo:</span>
                                <a
                                    href={`https://t.me/${username}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-cyan-300 underline hover:text-cyan-200"
                                >
                                    @{username}
                                </a>
                            </div>
                        )}
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
                            Validar e reconectar webhook
                        </button>
                    </div>

                    {msg && (
                        <div
                            className={`mt-5 rounded-xl border px-4 py-3 text-sm ${
                                msg.toLowerCase().includes("erro") || msg.toLowerCase().includes("falha")
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
