"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import AdminIcon from "@/components/AdminIcon";

export default function AdminLoginPage() {
    return <Suspense fallback={<LoginShell />}><LoginForm /></Suspense>;
}

function LoginForm() {
    const searchParams = useSearchParams();
    const next = searchParams.get("next") || "/admin";
    const [password, setPassword] = useState("");
    const [visible, setVisible] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (loading) return;
        setError("");
        setLoading(true);
        try {
            const res = await fetch("/api/admin/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });
            if (res.ok) {
                window.location.href = next.startsWith("/admin") ? next : "/admin";
                return;
            }
            const data = await res.json().catch(() => ({}));
            setError(data?.error === "admin_password_not_configured"
                ? "Senha do admin não configurada no servidor."
                : res.status === 401 ? "Senha incorreta. Confira e tente novamente." : "Não foi possível entrar. Tente novamente em instantes.");
        } catch {
            setError("Não foi possível conectar. Verifique sua conexão e tente novamente.");
        } finally {
            setLoading(false);
        }
    };

    return <LoginShell>
        <form onSubmit={submit} aria-busy={loading}>
            <label htmlFor="admin-password" className="mb-2 block text-xs font-semibold text-slate-400">Sua senha de acesso</label>
            <div className="admin-password-field">
                <input id="admin-password" name="password" value={password} onChange={event => setPassword(event.target.value)} type={visible ? "text" : "password"} autoComplete="current-password" required autoFocus aria-invalid={Boolean(error)} aria-describedby={error ? "admin-login-error" : undefined} className="w-full rounded-lg border border-white/10 px-3 py-3 text-sm outline-none" placeholder="Digite sua senha" />
                <button type="button" aria-controls="admin-password" aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? "Ocultar" : "Mostrar"}</button>
            </div>
            {error && <p id="admin-login-error" role="alert" className="mt-3 text-sm text-rose-200">{error}</p>}
            <button type="submit" disabled={loading || !password.trim()} className="admin-button admin-button-primary mt-5 w-full">{loading ? "Entrando..." : "Acessar meu painel"}<AdminIcon name="arrow" /></button>
            <p className="admin-login-footnote"><AdminIcon name="check" />Acesso exclusivo à administração</p>
        </form>
    </LoginShell>;
}

function LoginShell({ children }: { children?: React.ReactNode }) {
    return <main className="flex min-h-screen items-center justify-center px-4 text-slate-100">
        <div className="admin-login-card">
            <div className="admin-brand"><span className="admin-monogram">L<span>•</span></span><span><strong>Lari<span className="admin-brand-dot">.</span></strong><small>BUSINESS SUITE</small></span></div>
            <div className="mb-7"><p className="admin-eyebrow">Seu espaço de trabalho</p><h1 className="admin-page-title">Bem-vindo de volta.</h1><p className="admin-page-subtitle">Conversas, inteligência e resultados.<br />Sua operação, em um só lugar.</p></div>
            {children}
        </div>
    </main>;
}
