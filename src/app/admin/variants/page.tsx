"use client";
import { useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/adminApiClient';

type Variant = {
    id: string;
    stage: string;
    label: string | null;
    content: string;
    enabled: boolean;
    weight: number;
    successes: number;
    failures: number;
    updated_at: string;
};

const STAGES = [
    "WELCOME",
    "CONNECTION",
    "TRIGGER_PHASE",
    "HOT_TALK",
    "PREVIEW",
    "SALES_PITCH",
    "NEGOTIATION",
    "CLOSING",
    "PAYMENT_CHECK"
];

const EMPTY_VARIANT = {
    stage: "WELCOME",
    label: "",
    content: "",
    enabled: true,
    weight: 1
};

export default function AdminVariantsPage() {
    const [variants, setVariants] = useState<Variant[]>([]);
    const [draft, setDraft] = useState(EMPTY_VARIANT);
    const [msg, setMsg] = useState('');
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadVariants();
    }, []);

    const loadVariants = async () => {
        try {
            const data = await adminFetchJson<{ items: Variant[] }>('/api/admin/prompt-content?type=variants');
            setVariants(data.items || []);
        } catch (error: any) {
            setMsg(`Erro ao carregar: ${error?.message || error}`);
        } finally {
            setLoading(false);
        }
    };

    const createVariant = async () => {
        if (!draft.content.trim()) {
            setMsg("Preencha o conteudo.");
            return;
        }
        setSaving(true);
        setMsg('');
        try {
            await adminFetchJson('/api/admin/prompt-content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'variants', ...draft }) });
            setMsg("Variação criada.");
            setDraft(EMPTY_VARIANT);
            await loadVariants();
        } catch (error: any) {
            setMsg(`Erro ao salvar: ${error?.message || error}`);
        } finally {
            setSaving(false);
        }
    };

    const updateVariant = async (variant: Variant) => {
        setSaving(true);
        setMsg('');
        try {
            await adminFetchJson('/api/admin/prompt-content', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'variants', ...variant }) });
            setMsg("Variação atualizada.");
            await loadVariants();
        } catch (error: any) {
            setMsg(`Erro ao atualizar: ${error?.message || error}`);
        } finally {
            setSaving(false);
        }
    };

    const deleteVariant = async (id: string) => {
        if (!confirm("Apagar essa variacao?")) return;
        setSaving(true);
        setMsg('');
        try {
            await adminFetchJson(`/api/admin/prompt-content?type=variants&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            setMsg("Variação apagada.");
            await loadVariants();
        } catch (error: any) {
            setMsg(`Erro ao apagar: ${error?.message || error}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0b0f17] text-gray-100 font-sans">
            <div className="pointer-events-none fixed inset-0">
                <div className="absolute left-[-140px] top-[-160px] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(0,184,148,0.28),_transparent_70%)]" />
                <div className="absolute right-[-160px] top-[120px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(56,189,248,0.20),_transparent_70%)]" />
                <div className="absolute bottom-[-160px] left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,_rgba(255,122,24,0.10),_transparent_70%)]" />
            </div>

            <main className="mx-auto w-full max-w-6xl px-6 py-10">
                <header className="admin-page-header mb-5"><p className="admin-eyebrow">Experimentação</p><h1 className="admin-page-title">Testes de abordagem</h1><p className="admin-page-subtitle">Compare variações por etapa sem perder controle sobre peso, resultados e ativação.</p></header>
                <div className="admin-card mb-6 p-6">
                    <h2 className="text-lg font-semibold">Nova variação</h2>
                    <p className="mt-2 text-sm text-gray-400">Crie uma hipótese clara para uma etapa e acompanhe sucesso e falha.</p>

                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                        <select
                            value={draft.stage}
                            onChange={(e) => setDraft({ ...draft, stage: e.target.value })}
                            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                        >
                            {STAGES.map(stage => (
                                <option key={stage} value={stage}>{stage}</option>
                            ))}
                        </select>
                        <input
                            value={draft.label}
                            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                            placeholder="label (ex: Preview A)"
                            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                        />
                        <input
                            type="number"
                            value={draft.weight}
                            onChange={(e) => setDraft({ ...draft, weight: Number(e.target.value) })}
                            placeholder="peso"
                            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                        />
                    </div>
                    <textarea
                        value={draft.content}
                        onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                        placeholder="Conteudo da variacao..."
                        rows={6}
                        className="mt-4 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                    />
                    <div className="mt-4 flex items-center justify-between">
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                            <input
                                type="checkbox"
                                checked={draft.enabled}
                                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                                className="h-4 w-4 rounded border-white/20 bg-black/30"
                            />
                            ativa
                        </label>
                        <button
                            onClick={createVariant}
                            disabled={saving}
                            className="rounded-2xl border border-cyan-500/30 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100"
                        >
                            {saving ? 'salvando...' : 'salvar variacao'}
                        </button>
                    </div>
                </div>

                <div className="grid gap-4">
                    {variants.map((variant) => (
                        <div key={variant.id} className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="grid gap-3 md:grid-cols-3">
                                    <select
                                        value={variant.stage}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            setVariants(prev => prev.map(v => v.id === variant.id ? { ...v, stage: value } : v));
                                        }}
                                        className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                                    >
                                        {STAGES.map(stage => (
                                            <option key={stage} value={stage}>{stage}</option>
                                        ))}
                                    </select>
                                    <input
                                        value={variant.label || ''}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            setVariants(prev => prev.map(v => v.id === variant.id ? { ...v, label: value } : v));
                                        }}
                                        placeholder="Label"
                                        className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                                    />
                                    <input
                                        type="number"
                                        value={variant.weight || 1}
                                        onChange={(e) => {
                                            const value = Number(e.target.value);
                                            setVariants(prev => prev.map(v => v.id === variant.id ? { ...v, weight: value } : v));
                                        }}
                                        className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                                    />
                                </div>
                                <div className="flex items-center gap-3 text-sm text-gray-300">
                                    <span className="text-xs text-emerald-200">+{variant.successes || 0}</span>
                                    <span className="text-xs text-rose-200">-{variant.failures || 0}</span>
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={variant.enabled}
                                            onChange={(e) => {
                                                const value = e.target.checked;
                                                setVariants(prev => prev.map(v => v.id === variant.id ? { ...v, enabled: value } : v));
                                            }}
                                            className="h-4 w-4 rounded border-white/20 bg-black/30"
                                        />
                                        ativa
                                    </label>
                                    <button
                                        onClick={() => deleteVariant(variant.id)}
                                        className="rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200"
                                    >
                                        apagar
                                    </button>
                                </div>
                            </div>
                            <textarea
                                value={variant.content}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    setVariants(prev => prev.map(v => v.id === variant.id ? { ...v, content: value } : v));
                                }}
                                rows={6}
                                className="mt-4 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                            />
                            <div className="mt-3 flex items-center justify-end">
                                <button
                                    onClick={() => updateVariant(variant)}
                                    disabled={saving}
                                    className="rounded-2xl border border-emerald-500/30 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-100"
                                >
                                    {saving ? 'salvando...' : 'atualizar'}
                                </button>
                            </div>
                        </div>
                    ))}

                    {!loading && variants.length === 0 && (
                        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-sm text-gray-400">
                            Nenhuma variacao criada ainda.
                        </div>
                    )}
                    {loading && <div className="admin-card p-8 text-center text-sm text-slate-400">Carregando testes...</div>}
                </div>

                {msg && (
                    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-3 text-center text-sm text-gray-300">
                        {msg}
                    </div>
                )}
            </main>
        </div>
    );
}
