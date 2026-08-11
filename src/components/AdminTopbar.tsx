"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const routes = [
    { href: "/admin", label: "Conversas" },
    { href: "/admin/insights", label: "Resultados" },
    { href: "/admin/previews", label: "Prévias" },
    { href: "/admin/scripts", label: "Instruções" },
    { href: "/admin/variants", label: "Testes" },
    { href: "/admin/ai", label: "Inteligência" },
    { href: "/admin/payments", label: "Pagamentos" },
    { href: "/admin/settings", label: "Configurações" },
];

export default function AdminTopbar() {
    const pathname = usePathname();
    const router = useRouter();
    if (pathname === "/admin/login" || pathname.startsWith("/admin/chat/")) return null;

    const logout = async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        router.push("/admin/login");
        router.refresh();
    };

    return (
        <header className="border-b border-white/10 bg-[#080b10] text-slate-100">
            <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:px-6">
                <Link href="/admin" className="flex shrink-0 items-center gap-3 lg:mr-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-300 to-emerald-300 text-sm font-black text-slate-950 shadow-lg shadow-cyan-500/10">LM</span>
                    <span>
                        <span className="block text-sm font-semibold">Central da Lari</span>
                        <span className="flex items-center gap-1.5 text-[11px] text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Operação online</span>
                    </span>
                </Link>

                <nav className="-mx-1 flex flex-1 gap-1 overflow-x-auto px-1 pb-1 lg:pb-0">
                    {routes.map((route) => {
                        const active = route.href === "/admin" ? pathname === route.href : pathname.startsWith(route.href);
                        return (
                            <Link key={route.href} href={route.href} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition ${active ? "bg-cyan-300 text-slate-950" : "text-slate-400 hover:bg-white/[0.06] hover:text-white"}`}>
                                {route.label}
                            </Link>
                        );
                    })}
                </nav>

                <button onClick={logout} className="hidden shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-400 transition hover:border-rose-300/30 hover:text-rose-200 lg:block">
                    Sair
                </button>
            </div>
        </header>
    );
}
