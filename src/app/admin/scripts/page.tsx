"use client";
import { useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/adminApiClient';

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
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadBlocks();
    }, []);

    const loadBlocks = async () => {
        try {
            const data = await adminFetchJson<{ items: PromptBlock[] }>('/api/admin/prompt-content?type=blocks');
            setBlocks(data.items || []);
        } catch (error: any) {
            setMsg(`Erro ao carregar: ${error?.message || error}`);
        } finally {
            setLoading(false);
        }
    };

    const createBlock = async () => {
        if (!draft.key.trim() || !draft.content.trim()) {
            setMsg("Preencha key e conteudo.");
            return;
        }
        setSaving(true);
        setMsg('');
        try {
            await adminFetchJson('/api/admin/prompt-content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'blocks', ...draft }) });
            setMsg("Instrução criada e ativada.");
            setDraft(EMPTY_BLOCK);
            await loadBlocks();
        } catch (error: any) {
            setMsg(`Erro ao salvar: ${error?.message || error}`);
        } finally {
            setSaving(false);
        }
    };

    const updateBlock = async (block: PromptBlock) => {
        setSaving(true);
        setMsg('');
        try {
            await adminFetchJson('/api/admin/prompt-content', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'blocks', ...block }) });
            setMsg("Instrução atualizada.");
            await loadBlocks();
        } catch (error: any) {
            setMsg(`Erro ao atualizar: ${error?.message || error}`);
        } finally {
            setSaving(false);
        }
    };

    const deleteBlock = async (id: string) => {
        if (!confirm("Apagar esse bloco?")) return;
        setSaving(true);
        setMsg('');
        try {
            await adminFetchJson(`/api/admin/prompt-content?type=blocks&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
            setMsg("Instrução apagada.");
            await loadBlocks();
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
                <header className="admin-page-header mb-5"><p className="admin-eyebrow">Comportamento</p><h1 className="admin-page-title">Instruções dinâmicas</h1><p className="admin-page-subtitle">Ajustes operacionais entram no contexto sem precisar de novo deploy. Use regras curtas, objetivas e testáveis.</p></header>
                <div className="admin-card mb-6 p-6">
                    <h2 className="text-lg font-semibold">Nova instrução</h2>
                    <p className="mt-2 text-sm text-gray-400">Evite repetir regras do contrato central; adicione somente conhecimento específico da operação.</p>

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

                    {!loading && blocks.length === 0 && (
                        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-sm text-gray-400">
                            Nenhum bloco criado ainda.
                        </div>
                    )}
                    {loading && <div className="admin-card p-8 text-center text-sm text-slate-400">Carregando instruções...</div>}
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
