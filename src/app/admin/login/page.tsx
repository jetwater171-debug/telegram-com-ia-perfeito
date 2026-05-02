"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

export default function AdminLoginPage() {
    return (
        <Suspense fallback={<LoginShell />}>
            <LoginForm />
        </Suspense>
    );
}

function LoginForm() {
    const searchParams = useSearchParams();
    const next = searchParams.get("next") || "/admin";
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError("");
        setLoading(true);

        const res = await fetch("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password })
        });

        setLoading(false);

        if (res.ok) {
            window.location.href = next.startsWith("/admin") ? next : "/admin";
            return;
        }

        const data = await res.json().catch(() => ({}));
        if (data?.error === "admin_password_not_configured") {
            setError("Senha do admin nao configurada no servidor.");
            return;
        }
        setError("Senha incorreta.");
    };

    return (
        <LoginShell>
            <form onSubmit={submit}>
                <label className="mb-2 block text-xs font-semibold text-slate-400">Senha</label>
                <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    autoFocus
                    className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50"
                    placeholder="Senha do admin"
                />

                {error && <p className="mt-3 text-sm text-rose-200">{error}</p>}

                <button
                    type="submit"
                    disabled={loading || !password.trim()}
                    className="mt-5 w-full rounded-lg border border-cyan-300/40 bg-cyan-300/15 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-slate-600"
                >
                    {loading ? "Entrando..." : "Entrar"}
                </button>
            </form>
        </LoginShell>
    );
}

function LoginShell({ children }: { children?: React.ReactNode }) {
    return (
        <main className="flex min-h-screen items-center justify-center bg-[#080b10] px-4 text-slate-100">
            <div className="w-full max-w-sm rounded-lg border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
                <div className="mb-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/70">Admin</p>
                    <h1 className="mt-2 text-2xl font-semibold">Painel protegido</h1>
                    <p className="mt-2 text-sm text-slate-400">Digite a senha para acessar as conversas e configuracoes.</p>
                </div>
                {children}
            </div>
        </main>
    );
}
