"use client";
import { useEffect, useState } from 'react';
import { adminFetchJson } from '@/lib/adminApiClient';
import { SYSTEM_INSTRUCTION_BLOCK_KEY } from '@/lib/systemInstructionKeys';

type PromptBlock = {
    id: string;
    key: string;
    label: string | null;
    content: string;
    enabled: boolean;
    updated_at: string;
};

type SystemInstruction = {
    key: string;
    label: string;
    content: string;
    defaultContent: string;
    hasOverride: boolean;
    updated_at: string | null;
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
    const [systemInstruction, setSystemInstruction] = useState<SystemInstruction | null>(null);
    const [msg, setMsg] = useState('');
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadBlocks();
    }, []);

    const loadBlocks = async () => {
        try {
            const [blocksData, systemData] = await Promise.all([
                adminFetchJson<{ items: PromptBlock[] }>('/api/admin/prompt-content?type=blocks'),
                adminFetchJson<SystemInstruction>('/api/admin/prompt-content?type=system-instruction'),
            ]);
            setBlocks(blocksData.items || []);
            setSystemInstruction(systemData);
        } catch (error: any) {
            setMsg(`Erro ao carregar: ${error?.message || error}`);
        } finally {
            setLoading(false);
        }
    };

    const createBlock = async () => {
        if (draft.key.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') === SYSTEM_INSTRUCTION_BLOCK_KEY) {
            setMsg('Essa key é reservada para a instrução principal acima. Edite por lá.');
            return;
        }
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

    const saveSystemInstruction = async () => {
        if (!systemInstruction?.content.trim()) {
            setMsg('A instrução principal não pode ficar vazia. Restaure o padrão se precisar.');
            return;
        }
        setSaving(true);
        setMsg('');
        try {
            await adminFetchJson('/api/admin/prompt-content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'system-instruction', content: systemInstruction.content }),
            });
            setMsg('Instrução principal salva. Ela entrará no início do próximo turno processado.');
            await loadBlocks();
        } catch (error: any) {
            setMsg(`Erro ao salvar a instrução principal: ${error?.message || error}`);
        } finally {
            setSaving(false);
        }
    };

    const restoreSystemDefault = async () => {
        if (!systemInstruction || !confirm('Restaurar o texto padrão da instrução principal? A sua versão salva será removida.')) return;
        setSaving(true);
        setMsg('');
        try {
            await adminFetchJson('/api/admin/prompt-content?type=system-instruction', { method: 'DELETE' });
            setMsg('Padrão restaurado. Nenhuma instrução auxiliar foi alterada.');
            await loadBlocks();
        } catch (error: any) {
            setMsg(`Erro ao restaurar o padrão: ${error?.message || error}`);
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
                <header className="admin-page-header mb-5"><p className="admin-eyebrow">Comportamento</p><h1 className="admin-page-title">Instruções da IA</h1><p className="admin-page-subtitle">Edite a persona e o objetivo central sem misturar dados de cada lead. O backend completa o restante a cada turno.</p></header>

                <section className="admin-card mb-6 p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Ordem enviada ao modelo</p>
                            <h2 className="mt-1 text-lg font-semibold">A instrução principal vem primeiro</h2>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Você escreve a personalidade, o objetivo e as regras centrais aqui. O contrato operacional continua abaixo dela e o backend fecha o prompt com dados reais, sem você precisar copiar essas informações para o texto.</p>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${systemInstruction?.hasOverride ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100'}`}>{systemInstruction?.hasOverride ? 'Versão personalizada ativa' : 'Usando texto padrão'}</span>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-3">
                        <PromptOrderCard number="1" title="Sua instrução" description="Persona, objetivo e tom da Lari. Editável neste painel." tone="cyan" />
                        <PromptOrderCard number="2" title="Contrato e regras" description="Limites e validações fixos do sistema, aplicados antes da resposta." tone="violet" />
                        <PromptOrderCard number="3" title="Pacote automático" description="Funções, memória, dados do lead, estado e catálogo relevante." tone="emerald" />
                    </div>

                    <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-sm leading-6 text-amber-100">
                        Não escreva aqui localização, origem (Instagram/TikTok), histórico, PIX, mídia, memória ou catálogo como dados fixos. O backend injeta essas informações atualizadas no final do prompt e valida toda função antes de executá-la.
                    </div>

                    {systemInstruction ? <>
                        <textarea
                            value={systemInstruction.content}
                            onChange={(e) => setSystemInstruction({ ...systemInstruction, content: e.target.value })}
                            rows={22}
                            className="mt-5 w-full rounded-2xl border border-cyan-400/25 bg-black/30 px-4 py-3 font-mono text-sm leading-6 text-slate-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                            aria-label="Instrução principal da Lari"
                        />
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                            <span>{systemInstruction.content.length.toLocaleString('pt-BR')} caracteres {systemInstruction.updated_at ? `· salvo em ${new Date(systemInstruction.updated_at).toLocaleString('pt-BR')}` : '· padrão do código'}</span>
                            <div className="flex gap-3">
                                <button type="button" onClick={restoreSystemDefault} disabled={saving} className="rounded-2xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5 disabled:opacity-50">Restaurar padrão</button>
                                <button type="button" onClick={saveSystemInstruction} disabled={saving} className="rounded-2xl border border-cyan-500/30 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-50">{saving ? 'salvando...' : 'salvar instrução principal'}</button>
                            </div>
                        </div>
                    </> : <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">Carregando a instrução principal...</div>}
                </section>

                <div className="admin-card mb-6 p-6">
                    <h2 className="text-lg font-semibold">Blocos auxiliares</h2>
                    <p className="mt-2 text-sm text-gray-400">Entram como complementos subordinados. Use apenas regras operacionais específicas que não pertençam à instrução principal.</p>

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

function PromptOrderCard({ number, title, description, tone }: { number: string; title: string; description: string; tone: 'cyan' | 'violet' | 'emerald' }) {
    const tones = {
        cyan: 'border-cyan-300/25 bg-cyan-300/[0.06] text-cyan-100',
        violet: 'border-violet-300/25 bg-violet-300/[0.06] text-violet-100',
        emerald: 'border-emerald-300/25 bg-emerald-300/[0.06] text-emerald-100',
    };
    return <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
        <span className="text-xs font-black tracking-[0.18em] opacity-70">{number}</span>
        <h3 className="mt-2 text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs leading-5 opacity-75">{description}</p>
    </div>;
}
