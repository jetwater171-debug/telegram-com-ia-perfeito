"use client";
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

type PromptBlock = {
    id: string;
    key: string;
    label: string | null;
    content: string;
    enabled: boolean;
    updated_at: string;
};

const EMPTY_BLOCK = {
    key: '',
    label: '',
    content: '',
    enabled: true
};

export default function AdminScriptsPage() {
    const [blocks, setBlocks] = useState<PromptBlock[]>([]);
    const [draft, setDraft] = useState(EMPTY_BLOCK);
    const [msg, setMsg] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadBlocks();
    }, []);

    const loadBlocks = async () => {
        const { data } = await supabase
            .from('prompt_blocks')
            .select('*')
            .order('updated_at', { ascending: false });
        setBlocks((data as PromptBlock[]) || []);
    };

    const createBlock = async () => {
        if (!draft.key.trim() || !draft.content.trim()) {
            setMsg("Preencha key e conteudo.");
            return;
        }
        setSaving(true);
        setMsg('');
        const { error } = await supabase.from('prompt_blocks').upsert({
            key: draft.key.trim(),
            label: draft.label?.trim() || null,
            content: draft.content.trim(),
            enabled: draft.enabled
        });
        if (error) {
            setMsg("Erro ao salvar: " + error.message);
        } else {
            setMsg("Bloco criado/atualizado.");
            setDraft(EMPTY_BLOCK);
            await loadBlocks();
        }
        setSaving(false);
    };

    const updateBlock = async (block: PromptBlock) => {
        setSaving(true);
        setMsg('');
        const { error } = await supabase.from('prompt_blocks').update({
            label: block.label,
            content: block.content,
            enabled: block.enabled,
            updated_at: new Date().toISOString()
        }).eq('id', block.id);
        if (error) {
            setMsg("Erro ao atualizar: " + error.message);
        } else {
            setMsg("Bloco atualizado.");
            await loadBlocks();
        }
        setSaving(false);
    };

    const deleteBlock = async (id: string) => {
        if (!confirm("Apagar esse bloco?")) return;
        setSaving(true);
        setMsg('');
        const { error } = await supabase.from('prompt_blocks').delete().eq('id', id);
        if (error) setMsg("Erro ao apagar: " + error.message);
        else {
            setMsg("Bloco apagado.");
            await loadBlocks();
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
                            <h1 className="text-xl font-semibold">Scripts da Lari</h1>
                            <p className="text-sm text-gray-400">Edite instrucoes sem deploy</p>
                        </div>
                    </div>
                    <Link href="/admin" className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-gray-100 transition hover:border-white/20">
                        Voltar
                    </Link>
                </div>
            </header>

            <main className="mx-auto w-full max-w-6xl px-6 py-10">
                <div className="mb-6 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                    <h2 className="text-lg font-semibold">Novo bloco</h2>
                    <p className="mt-2 text-sm text-gray-400">Blocos ativos entram no prompt com prioridade sobre o texto fixo.</p>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <input
                            value={draft.key}
                            onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                            placeholder="key (ex: tone_override)"
                            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                        />
                        <input
                            value={draft.label}
                            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                            placeholder="label (ex: Tom de Conversa)"
                            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                        />
                    </div>
                    <textarea
                        value={draft.content}
                        onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                        placeholder="Conteudo do bloco..."
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
                            ativo
                        </label>
                        <button
                            onClick={createBlock}
                            disabled={saving}
                            className="rounded-2xl border border-cyan-500/30 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100"
                        >
                            {saving ? 'salvando...' : 'salvar bloco'}
                        </button>
                    </div>
                </div>

                <div className="grid gap-4">
                    {blocks.map((block) => (
                        <div key={block.id} className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs uppercase tracking-[0.2em] text-gray-500">{block.key}</p>
                                    <input
                                        value={block.label || ''}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, label: value } : b));
                                        }}
                                        placeholder="Label"
                                        className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                                    />
                                </div>
                                <div className="flex items-center gap-3 text-sm text-gray-300">
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={block.enabled}
                                            onChange={(e) => {
                                                const value = e.target.checked;
                                                setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, enabled: value } : b));
                                            }}
                                            className="h-4 w-4 rounded border-white/20 bg-black/30"
                                        />
                                        ativo
                                    </label>
                                    <button
                                        onClick={() => deleteBlock(block.id)}
                                        className="rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200"
                                    >
                                        apagar
                                    </button>
                                </div>
                            </div>
                            <textarea
                                value={block.content}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, content: value } : b));
                                }}
                                rows={6}
                                className="mt-4 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                            />
                            <div className="mt-3 flex items-center justify-end">
                                <button
                                    onClick={() => updateBlock(block)}
                                    disabled={saving}
                                    className="rounded-2xl border border-emerald-500/30 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-100"
                                >
                                    {saving ? 'salvando...' : 'atualizar'}
                                </button>
                            </div>
                        </div>
                    ))}

                    {blocks.length === 0 && (
                        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-sm text-gray-400">
                            Nenhum bloco criado ainda.
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
