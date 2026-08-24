"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetchJson } from "@/lib/adminApiClient";

type Order = {
    id: string;
    created_at: string;
    status: "awaiting_payment" | "paid" | "in_progress" | "delivered" | "cancelled";
    request_brief: string;
    amount: number;
    gateway?: string | null;
    payment_id?: string | null;
    admin_notes?: string | null;
    lead?: { user_name?: string | null; telegram_chat_id?: string | null; total_paid?: number | null } | null;
};

const statusLabel: Record<Order["status"], string> = {
    awaiting_payment: "Aguardando PIX",
    paid: "Pago · precisa produzir",
    in_progress: "Em produção",
    delivered: "Entregue",
    cancelled: "Cancelado",
};

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));

export default function CustomOrdersPage() {
    const [orders, setOrders] = useState<Order[]>([]);
    const [filter, setFilter] = useState<"all" | Order["status"]>("paid");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        try {
            const data = await adminFetchJson<{ orders: Order[] }>("/api/admin/custom-orders");
            setOrders(data.orders || []);
            setError("");
        } catch (err: any) {
            setError(err?.message || "Falha ao carregar pedidos");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const kickoff = window.setTimeout(() => void load(), 0);
        const timer = window.setInterval(() => void load(), 20_000);
        return () => {
            window.clearTimeout(kickoff);
            window.clearInterval(timer);
        };
    }, [load]);

    const update = async (order: Order, status: Order["status"]) => {
        await adminFetchJson("/api/admin/custom-orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: order.id, status, admin_notes: order.admin_notes || "" }),
        });
        await load();
    };

    const visible = useMemo(() => filter === "all" ? orders : orders.filter((order) => order.status === filter), [filter, orders]);
    const paidOpen = orders.filter((order) => order.status === "paid" || order.status === "in_progress").length;

    return (
        <div className="min-h-screen bg-[#080b10] text-slate-100">
            <header className="border-b border-white/5">
                <div className="mx-auto flex w-full max-w-6xl items-end justify-between gap-4 px-4 py-6">
                    <div>
                        <p className="admin-eyebrow">Venda sob demanda</p>
                        <h1 className="admin-page-title">Pedidos personalizados</h1>
                        <p className="admin-page-subtitle">Tudo que a Lari vende fora do catálogo aparece aqui com briefing, valor e pagamento.</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-right">
                        <p className="text-2xl font-black text-emerald-200">{paidOpen}</p>
                        <p className="text-xs text-emerald-100/70">pagos em aberto</p>
                    </div>
                </div>
            </header>

            <main className="mx-auto w-full max-w-6xl px-4 py-6">
                <div className="mb-5 flex flex-wrap gap-2">
                    {(["paid", "in_progress", "awaiting_payment", "delivered", "all"] as const).map((value) => (
                        <button key={value} onClick={() => setFilter(value)} className={`rounded-xl px-3 py-2 text-xs font-semibold ${filter === value ? "bg-emerald-300 text-slate-950" : "border border-white/10 bg-white/[.035] text-slate-300"}`}>
                            {value === "all" ? "Todos" : statusLabel[value]}
                        </button>
                    ))}
                    <button onClick={() => void load()} className="ml-auto rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300">Atualizar</button>
                </div>

                {error && <div className="mb-4 rounded-xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{error}</div>}
                {loading ? <p className="text-sm text-slate-500">Carregando pedidos...</p> : visible.length === 0 ? (
                    <div className="admin-card p-8 text-center text-slate-400">Nenhum pedido neste filtro.</div>
                ) : (
                    <div className="grid gap-4 lg:grid-cols-2">
                        {visible.map((order) => (
                            <article key={order.id} className="admin-card p-5">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-[.14em] text-emerald-200">{statusLabel[order.status]}</p>
                                        <h2 className="mt-2 text-lg font-semibold">{order.lead?.user_name || "Lead sem nome"}</h2>
                                        <p className="mt-1 text-xs text-slate-500">{new Date(order.created_at).toLocaleString("pt-BR")} · {order.gateway || "gateway pendente"}</p>
                                    </div>
                                    <strong className="text-xl text-emerald-200">{money(order.amount)}</strong>
                                </div>
                                <div className="mt-4 rounded-xl border border-white/8 bg-black/25 p-4 text-sm leading-6 text-slate-200">{order.request_brief}</div>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {order.lead?.telegram_chat_id && <Link href={`/admin/chat/${order.lead.telegram_chat_id}`} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200">Abrir conversa</Link>}
                                    {order.status === "paid" && <button onClick={() => void update(order, "in_progress")} className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-bold text-slate-950">Começar produção</button>}
                                    {order.status === "in_progress" && <button onClick={() => void update(order, "delivered")} className="rounded-lg bg-emerald-300 px-3 py-2 text-xs font-bold text-slate-950">Marcar entregue</button>}
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
