"use client";

import { useEffect, useMemo, useState } from 'react';
import { adminFetchJson } from '@/lib/adminApiClient';

type SystemInstructionTemplate = {
    key: string;
    label: string;
    content: string;
    defaultContent: string;
    requiredTokens: string[];
    hasOverride: boolean;
    updated_at: string | null;
};

export default function AdminScriptsPage() {
    const [template, setTemplate] = useState<SystemInstructionTemplate | null>(null);
    const [message, setMessage] = useState('');
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);

    const missingPlaceholders = useMemo(() => {
        if (!template) return [];
        return template.requiredTokens.filter((token) => !template.content.includes(token));
    }, [template]);

    const loadTemplate = async () => {
        try {
            const data = await adminFetchJson<SystemInstructionTemplate>('/api/admin/prompt-content?type=system-instruction');
            setTemplate(data);
        } catch (error: any) {
            setMessage(`Erro ao carregar: ${error?.message || error}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        let active = true;
        adminFetchJson<SystemInstructionTemplate>('/api/admin/prompt-content?type=system-instruction')
            .then((data) => { if (active) setTemplate(data); })
            .catch((error: any) => { if (active) setMessage(`Erro ao carregar: ${error?.message || error}`); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const saveTemplate = async () => {
        if (!template?.content.trim()) {
            setMessage('O system instruction não pode ficar vazio.');
            return;
        }
        if (missingPlaceholders.length > 0) {
            setMessage(`Mantenha os marcadores variáveis: ${missingPlaceholders.join(', ')}`);
            return;
        }
        setSaving(true);
        setMessage('');
        try {
            await adminFetchJson('/api/admin/prompt-content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'system-instruction', content: template.content }),
            });
            setMessage('System instruction completo salvo. Ele será usado no próximo turno processado.');
            await loadTemplate();
        } catch (error: any) {
            setMessage(`Erro ao salvar: ${error?.message || error}`);
        } finally {
            setSaving(false);
        }
    };

    const restoreDefault = async () => {
        if (!template || !confirm('Restaurar o template padrão completo? A versão personalizada salva será removida.')) return;
        setSaving(true);
        setMessage('');
        try {
            await adminFetchJson('/api/admin/prompt-content?type=system-instruction', { method: 'DELETE' });
            setMessage('Template padrão completo restaurado.');
            await loadTemplate();
        } catch (error: any) {
            setMessage(`Erro ao restaurar o padrão: ${error?.message || error}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0b0f17] font-sans text-gray-100">
            <div className="pointer-events-none fixed inset-0">
                <div className="absolute left-[-140px] top-[-160px] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(0,184,148,0.28),_transparent_70%)]" />
                <div className="absolute right-[-160px] top-[120px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(56,189,248,0.20),_transparent_70%)]" />
            </div>

            <main className="relative mx-auto w-full max-w-6xl px-6 py-10">
                <header className="admin-page-header mb-5">
                    <p className="admin-eyebrow">Comportamento</p>
                    <h1 className="admin-page-title">System instruction completo</h1>
                    <p className="admin-page-subtitle">Este é o documento principal usado para gerar cada resposta da Lari. Edite qualquer regra, texto, função ou catálogo no lugar em que aparece.</p>
                </header>

                <section className="admin-card p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h2 className="text-lg font-semibold">Template mestre</h2>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Ele já inclui persona, contrato, funções disponíveis, catálogo VIP e o pacote automático do backend na ordem real. Os marcadores entre chaves são substituídos a cada turno pelos dados reais do lead.</p>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${template?.hasOverride ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100'}`}>
                            {template?.hasOverride ? 'Versão personalizada ativa' : 'Usando template padrão'}
                        </span>
                    </div>

                    <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] p-4 text-sm leading-6 text-cyan-50">
                        <strong>Marcadores dinâmicos:</strong> mantenha cada <code className="rounded bg-black/20 px-1.5 py-0.5 text-cyan-100">&#123;&#123;...&#125;&#125;</code> no texto. Eles representam contexto do turno, perfil/origem/localização, memória, catálogo de prévias, anti-repetição, estado operacional, cérebro e compras confirmadas. O servidor substitui somente esses valores, nunca instruções.
                    </div>

                    {template ? <>
                        <textarea
                            value={template.content}
                            onChange={(event) => setTemplate({ ...template, content: event.target.value })}
                            rows={34}
                            className="mt-5 w-full rounded-2xl border border-cyan-400/25 bg-black/30 px-4 py-3 font-mono text-sm leading-6 text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                            aria-label="Template completo do system instruction"
                            spellCheck={false}
                        />
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                            <span>{template.content.length.toLocaleString('pt-BR')} caracteres {template.updated_at ? `· salvo em ${new Date(template.updated_at).toLocaleString('pt-BR')}` : '· padrão do código'}</span>
                            <div className="flex flex-wrap gap-3">
                                <button type="button" onClick={restoreDefault} disabled={saving} className="rounded-2xl border border-white/10 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5 disabled:opacity-50">Restaurar padrão</button>
                                <button type="button" onClick={saveTemplate} disabled={saving || missingPlaceholders.length > 0} className="rounded-2xl border border-cyan-500/30 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-50">{saving ? 'salvando...' : 'salvar system instruction'}</button>
                            </div>
                        </div>
                        {missingPlaceholders.length > 0 && <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-100">Faltam marcadores obrigatórios: {missingPlaceholders.join(', ')}. Restaure o padrão ou coloque-os de volta antes de salvar.</div>}
                    </> : <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">{loading ? 'Carregando template...' : 'Não foi possível carregar o template.'}</div>}
                </section>

                {message && <div className={`mt-6 rounded-2xl border p-3 text-center text-sm ${message.startsWith('Erro') || message.startsWith('Mantenha') ? 'border-rose-400/30 bg-rose-400/10 text-rose-100' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'}`}>{message}</div>}
            </main>
        </div>
    );
}
