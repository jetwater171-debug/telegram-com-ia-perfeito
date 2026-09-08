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
    { href: "/admin/orders", label: "Pedidos", icon: "orders" },
    { href: "/admin/scripts", label: "Instruções", icon: "script" },
    { href: "/admin/variants", label: "Testes", icon: "flask" },
    { href: "/admin/ai", label: "Inteligência", icon: "brain" },
    { href: "/admin/ai/capacity", label: "Capacidade", icon: "chart" },
    { href: "/admin/payments", label: "Pagamentos", icon: "pix" },
    { href: "/admin/settings", label: "Ajustes", icon: "settings" },
];

const Icon = ({ name }: { name: string }) => {
    const paths: Record<string, ReactNode> = {
        chat: <><path d="M4 5h16v11H8l-4 3V5Z"/><path d="M8 9h8M8 12h5"/></>,
        chart: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></>,
        image: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m3 16 5-5 4 4 3-3 6 6M15 8h.01"/></>,
        orders: <><path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/><path d="m14 17 1.5 1.5L19 15"/></>,
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
    const router = useRouter();
    const [health, setHealth] = useState<Health | null>(null);
    const [healthOpen, setHealthOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState('');
    const searchRef = useRef<HTMLInputElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const hidden = pathname === '/admin/login';
    const loadHealth = useCallback(async () => {
        try { setHealth(await adminFetchJson<Health>('/api/admin/health')); }
        catch { setHealth(null); }
    }, []);
    useEffect(() => {
        if (hidden) return;
        const kickoff = window.setTimeout(() => void loadHealth(), 0);
        const timer = window.setInterval(loadHealth, 60_000);
        return () => { window.clearTimeout(kickoff); window.clearInterval(timer); };
    }, [hidden, loadHealth]);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(v => !v); }
            if (e.key === 'Escape') { setSearchOpen(false); setMenuOpen(false); setHealthOpen(false); triggerRef.current?.focus(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
    useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
    if (hidden) return null;
    const activeRoute = routes.find(r => r.href === pathname) || routes[0];
    const healthLabel = !health ? 'Sem confirmação' : health.status === 'healthy' ? 'Tudo operacional' : health.status === 'attention' ? 'Precisa de atenção' : 'Instabilidade';
    const navigate = () => { setMenuOpen(false); setSearchOpen(false); setQuery(''); };
    const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const results = routes.filter(r => normalize(r.label).includes(normalize(query)));
    return <>
        <a href="#admin-content" className="admin-skip-link">Pular para o conteúdo</a>
        {menuOpen && <button className="admin-mobile-scrim" aria-label="Fechar navegação" onClick={() => setMenuOpen(false)} />}
        <aside className={`admin-sidebar ${menuOpen ? 'is-open' : ''}`} id="admin-navigation">
            <Link href="/admin" className="admin-brand" onClick={navigate}>
                <span className="admin-monogram">L<span>•</span></span>
                <span><strong>Lari<span className="admin-brand-dot">.</span></strong><small>BUSINESS SUITE</small></span>
            </Link>
            <div className="admin-workspace-switch"><span className="admin-avatar">LM</span><span><b>Central da Lari</b><small>Seu espaço de trabalho</small></span><span className="text-slate-500">⌄</span></div>
            <nav aria-label="Navegação principal">
                {[{ label: 'OPERAÇÃO', items: routes.slice(0, 4) }, { label: 'INTELIGÊNCIA', items: routes.slice(4, 8) }, { label: 'GESTÃO', items: routes.slice(8) }].map(group => <div className="admin-nav-group" key={group.label}>
                    <p>{group.label}</p>
                    {group.items.map(route => {
                        const active = pathname === route.href || (route.href === '/admin' && pathname.startsWith('/admin/chat/'));
                        return <Link key={route.href} href={route.href} onClick={navigate} aria-current={active ? 'page' : undefined} className={`admin-nav-item ${active ? 'admin-nav-item-active' : ''}`}><Icon name={route.icon} /><span>{route.label}</span>{active && <span className="admin-active-dot" />}</Link>;
                    })}
                </div>)}
            </nav>
            <div className="admin-sidebar-footer"><div className="admin-avatar">A</div><span><b>Administrador</b><small>Controle da operação</small></span><button aria-label="Sair do painel" title="Sair do painel" onClick={async () => { await fetch('/api/admin/logout', { method: 'POST' }); router.push('/admin/login'); router.refresh(); }}>↗</button></div>
        </aside>
        <header className="admin-topbar">
            <div className="admin-topbar-inner">
                <button className="admin-menu-toggle" aria-label="Abrir navegação" aria-expanded={menuOpen} aria-controls="admin-navigation" onClick={() => setMenuOpen(v => !v)}>☰</button>
                <div className="admin-breadcrumb"><span>Workspace</span><span>/</span><b>{pathname.startsWith('/admin/chat/') ? 'Conversa' : activeRoute.label}</b></div>
                <div className="admin-topbar-actions">
                    <button ref={triggerRef} className="admin-search-trigger" onClick={() => setSearchOpen(true)}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><span>Ir para...</span><kbd>Ctrl K</kbd></button>
                    <button className="admin-health-pill" aria-expanded={healthOpen} onClick={() => setHealthOpen(v => !v)}><span className={`admin-status-dot ${health?.status === 'healthy' ? 'is-healthy' : health ? 'is-warning' : ''}`} /><span>{healthLabel}</span></button>
                </div>
            </div>
            {healthOpen && <div className="admin-health-popover"><div className="flex items-center justify-between"><b className="text-sm">Status dos serviços</b><button className="text-xs text-cyan-200" onClick={() => void loadHealth()}>Atualizar</button></div><p className="mt-2 text-xs text-slate-400">{healthLabel}</p><div className="mt-4 grid grid-cols-2 gap-3">{health && Object.entries(health.checks).map(([key, ok]) => <div key={key} className="flex items-center gap-2 text-xs"><span className={`admin-status-dot ${ok ? 'is-healthy' : 'is-warning'}`} />{{ database: 'Banco de dados', eventStore: 'Memória', deepseek: 'Modelo de IA', telegram: 'Telegram' }[key] || key}</div>)}</div></div>}
        </header>
        {searchOpen && <div className="admin-command-backdrop" onClick={() => { setSearchOpen(false); triggerRef.current?.focus(); }}><div role="dialog" aria-modal="true" aria-label="Ir para uma página" className="admin-command" onClick={e => e.stopPropagation()} onKeyDown={e => {
            if (e.key === 'Tab') { const elements = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input,button,a')); const first=elements[0], last=elements.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
        }}><div className="admin-command-input"><input ref={searchRef} aria-label="Buscar página" placeholder="O que você quer gerenciar?" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if(e.key === 'Enter' && results[0]) { router.push(results[0].href); navigate(); } }} /><button aria-label="Fechar busca" onClick={() => { setSearchOpen(false); triggerRef.current?.focus(); }}>Esc</button></div><div className="admin-command-results">{results.map(r => <Link key={r.href} href={r.href} onClick={navigate}><Icon name={r.icon} />{r.label}<span>↗</span></Link>)}{!results.length && <p>Nenhuma página encontrada.</p>}</div><footer>Escolha uma página para continuar</footer></div></div>}
    </>;
}
