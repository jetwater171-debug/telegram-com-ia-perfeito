"use client";
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

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

    useEffect(() => {
        loadVariants();
    }, []);

    const loadVariants = async () => {
        const { data } = await supabase
            .from('prompt_variants')
            .select('*')
            .order('updated_at', { ascending: false });
        setVariants((data as Variant[]) || []);
    };

    const createVariant = async () => {
        if (!draft.content.trim()) {
            setMsg("Preencha o conteudo.");
            return;
        }
        setSaving(true);
        setMsg('');
        const { error } = await supabase.from('prompt_variants').insert({
            stage: draft.stage,
            label: draft.label?.trim() || null,
            content: draft.content.trim(),
            enabled: draft.enabled,
            weight: Number(draft.weight || 1)
        });
        if (error) {
            setMsg("Erro ao salvar: " + error.message);
        } else {
            setMsg("Variacao criada.");
            setDraft(EMPTY_VARIANT);
            await loadVariants();
        }
        setSaving(false);
    };

    const updateVariant = async (variant: Variant) => {
        setSaving(true);
        setMsg('');
        const { error } = await supabase.from('prompt_variants').update({
            stage: variant.stage,
            label: variant.label,
            content: variant.content,
            enabled: variant.enabled,
            weight: Number(variant.weight || 1),
            updated_at: new Date().toISOString()
        }).eq('id', variant.id);
        if (error) {
            setMsg("Erro ao atualizar: " + error.message);
        } else {
            setMsg("Variacao atualizada.");
            await loadVariants();
        }
        setSaving(false);
    };

    const deleteVariant = async (id: string) => {
        if (!confirm("Apagar essa variacao?")) return;
        setSaving(true);
        setMsg('');
        const { error } = await supabase.from('prompt_variants').delete().eq('id', id);
        if (error) setMsg("Erro ao apagar: " + error.message);
        else {
            setMsg("Variacao apagada.");
            await loadVariants();
        }
        setSaving(false);
    };

    return (
        <div className="min-h-screen bg-[#0b0f17] text-gray-100 font-sans">
            <div className="pointer-events-none fixed inset-0">
                <div className="absolute left-[-140px] top-[-160px] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(0,184,148,0.28),_transparent_70%)]" />
                <div className="absolute right-[-160px] top-[120px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(56,189,248,0.20),_transparent_70%)]" />
                <div className="absolute bottom-[-160px] left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,_rgba(255,122,24,0.10),_transparent_70%)]" />
            </div>

            <header className="sticky top-0 z-30 border-b border-white/10 bg-black/30 backdrop-blur">
                <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
                    <div className="flex items-center gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/40 to-emerald-400/30 text-cyan-100 font-bold">LM</div>
                        <div>
                            <h1 className="text-xl font-semibold">Variacoes do Funil</h1>
                            <p className="text-sm text-gray-400">Aprendizado automatico por etapa</p>
                        </div>
                    </div>
                    <Link href="/admin" className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-gray-100 transition hover:border-white/20">
                        Voltar
                    </Link>
                </div>
            </header>

            <main className="mx-auto w-full max-w-6xl px-6 py-10">
                <div className="mb-6 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                    <h2 className="text-lg font-semibold">Nova variacao</h2>
                    <p className="mt-2 text-sm text-gray-400">Crie versoes alternativas para cada etapa do funil.</p>

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

                    {variants.length === 0 && (
                        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-sm text-gray-400">
                            Nenhuma variacao criada ainda.
                        </div>
                    )}
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
