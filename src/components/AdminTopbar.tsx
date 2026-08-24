"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { adminFetchJson } from "@/lib/adminApiClient";

type Health = {
    ok: boolean;
    status: "healthy" | "attention" | "degraded";
    latencyMs: number;
    checks: { database: boolean; eventStore: boolean; deepseek: boolean; telegram: boolean };
    brain?: { model?: string; provider?: string; lastAction?: string };
    counters?: { activeSessions?: number; events?: number; outcomes?: number };
};

const routes = [
    { href: "/admin", label: "Conversas", icon: "chat" },
    { href: "/admin/insights", label: "Resultados", icon: "chart" },
    { href: "/admin/previews", label: "Prévias", icon: "image" },
    { href: "/admin/scripts", label: "Instruções", icon: "script" },
    { href: "/admin/variants", label: "Testes", icon: "flask" },
    { href: "/admin/ai", label: "Inteligência", icon: "brain" },
    { href: "/admin/payments", label: "Pagamentos", icon: "pix" },
    { href: "/admin/settings", label: "Ajustes", icon: "settings" },
];

const Icon = ({ name }: { name: string }) => {
    const paths: Record<string, ReactNode> = {
        chat: <><path d="M4 5h16v11H8l-4 3V5Z"/><path d="M8 9h8M8 12h5"/></>,
        chart: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></>,
        image: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m3 16 5-5 4 4 3-3 6 6M15 8h.01"/></>,
        script: <><path d="M6 3h9l3 3v15H6z"/><path d="M9 10h6M9 14h6M9 18h4"/></>,
        flask: <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M8 15h8"/></>,
        brain: <><path d="M9.5 4.5A3 3 0 0 0 5 7a3 3 0 0 0 .5 5.5A3 3 0 0 0 9 17v2"/><path d="M14.5 4.5A3 3 0 0 1 19 7a3 3 0 0 1-.5 5.5A3 3 0 0 1 15 17v2M12 3v18M8 9h4M12 14h4"/></>,
        pix: <><path d="m12 3 4 4-4 4-4-4 4-4ZM7 8l4 4-4 4-4-4 4-4ZM17 8l4 4-4 4-4-4 4-4ZM12 13l4 4-4 4-4-4 4-4Z"/></>,
        settings: <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A7 7 0 0 0 15 6l-.3-2.6h-4L10.4 6A7 7 0 0 0 8.8 7L6.4 6 4.4 9.5 6.5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1A7 7 0 0 0 10.5 18l.3 2.6h4l.3-2.6a7 7 0 0 0 1.6-1l2.4 1 2-3.4-2.1-1.5a7 7 0 0 0 .1-1Z"/></>,
    };
    return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
};

export default function AdminTopbar() {
    const pathname = usePathname();
    const hidden = pathname === "/admin/login" || pathname.startsWith("/admin/chat/");
    const router = useRouter();
    const [health, setHealth] = useState<Health | null>(null);
    const [healthOpen, setHealthOpen] = useState(false);
    const mountedRef = useRef(true);

    const loadHealth = useCallback(async () => {
        try {
            const data = await adminFetchJson<Health>("/api/admin/health");
            if (mountedRef.current) setHealth(data);
        } catch {
            if (mountedRef.current) setHealth((current) => current ? { ...current, ok: false, status: "degraded" } : null);
        }
    }, []);

    useEffect(() => {
        if (hidden) return;
        mountedRef.current = true;
        const kickoff = window.setTimeout(() => void loadHealth(), 0);
        const timer = window.setInterval(loadHealth, 30_000);
        return () => { mountedRef.current = false; window.clearTimeout(kickoff); window.clearInterval(timer); };
    }, [hidden, loadHealth]);

    if (hidden) return null;

    const logout = async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        router.push("/admin/login");
        router.refresh();
    };
    const statusLabel = !health ? "Verificando" : health.status === "healthy" ? "Tudo operacional" : health.status === "attention" ? "Atenção" : "Instabilidade";
    const statusColor = !health ? "bg-slate-400" : health.status === "healthy" ? "bg-emerald-300" : health.status === "attention" ? "bg-amber-300" : "bg-rose-300";

    return (
        <header className="admin-topbar">
            <div className="relative mx-auto flex w-full max-w-[1580px] flex-col gap-3 px-4 py-3 2xl:flex-row 2xl:items-center 2xl:px-6">
                <div className="flex items-center justify-between gap-3">
                    <Link href="/admin" className="group flex shrink-0 items-center gap-3 2xl:mr-4">
                        <span className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-200 via-emerald-300 to-teal-500 text-sm font-black text-slate-950 shadow-[0_12px_35px_-12px_rgba(45,212,191,.75)]">
                            LM<span className="absolute inset-x-2 bottom-1 h-px bg-white/50" />
                        </span>
                        <span>
                            <span className="block text-sm font-semibold tracking-tight text-white">Central da Lari</span>
                            <span className="block text-[11px] text-slate-500">operação & inteligência</span>
                        </span>
                    </Link>
                    <button type="button" onClick={() => setHealthOpen((open) => !open)} className="admin-health-pill 2xl:hidden">
                        <span className={`h-2 w-2 rounded-full ${statusColor}`} /> {statusLabel}
                    </button>
                </div>

                <nav className="admin-nav-scroll" aria-label="Navegação administrativa">
                    {routes.map((route) => {
                        const active = route.href === "/admin" ? pathname === route.href : pathname.startsWith(route.href);
                        return (
                            <Link key={route.href} href={route.href} className={`admin-nav-item ${active ? "admin-nav-item-active" : ""}`}>
                                <Icon name={route.icon} />
                                <span>{route.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                <div className="relative hidden shrink-0 items-center gap-2 2xl:flex">
                    <button type="button" onClick={() => setHealthOpen((open) => !open)} className="admin-health-pill">
                        <span className={`h-2 w-2 rounded-full ${statusColor}`} />
                        <span>{statusLabel}</span>
                    </button>
                    <button onClick={logout} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-500 transition hover:border-rose-300/30 hover:bg-rose-300/5 hover:text-rose-200">Sair</button>
                </div>

                {healthOpen && (
                    <div className="admin-health-popover">
                        <div className="flex items-start justify-between gap-4">
                            <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-cyan-200">Saúde operacional</p><p className="mt-1 text-sm text-slate-400">checagem real do backend</p></div>
                            <button onClick={() => void loadHealth()} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5">Atualizar</button>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            {health && Object.entries(health.checks).map(([key, value]) => <HealthCheck key={key} label={key} ok={value} />)}
                        </div>
                        <div className="mt-3 rounded-xl border border-white/8 bg-black/20 p-3 text-xs text-slate-400">
                            <p className="font-semibold text-slate-200">{health?.brain?.provider || "—"} · {health?.brain?.model || "checando modelo"}</p>
                            <p className="mt-1">Última ação: {health?.brain?.lastAction || "—"} · {health?.latencyMs ?? "—"}ms</p>
                            <p className="mt-1">{health?.counters?.events || 0} eventos · {health?.counters?.activeSessions || 0} conversas ativas</p>
                        </div>
                    </div>
                )}
            </div>
        </header>
    );
}

function HealthCheck({ label, ok }: { label: string; ok: boolean }) {
    const names: Record<string, string> = { database: "Banco", eventStore: "Memória V2", deepseek: "DeepSeek", telegram: "Telegram" };
    return <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[.035] px-3 py-2 text-xs text-slate-300"><span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-300" : "bg-rose-300"}`} />{names[label] || label}</div>;
}
