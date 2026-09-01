"use client";

import { useEffect, useMemo, useState } from 'react';
import { adminFetchJson } from '@/lib/adminApiClient';
import PromptVisualEditor from './PromptVisualEditor';

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

    const placeholderValidation = useMemo(() => {
        if (!template) return { missing: [], duplicated: [], unknown: [] };
        const known = new Set(template.requiredTokens);
        return {
            missing: template.requiredTokens.filter((token) => !template.content.includes(token)),
            duplicated: template.requiredTokens.filter((token) => template.content.split(token).length - 1 > 1),
            unknown: Array.from(new Set(template.content.match(/\{\{[A-Z0-9_]+\}\}/g) || [])).filter((token) => !known.has(token)),
        };
    }, [template]);
    const hasPlaceholderError = placeholderValidation.missing.length > 0 || placeholderValidation.duplicated.length > 0 || placeholderValidation.unknown.length > 0;

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
        if (hasPlaceholderError) {
            setMessage('Mantenha cada variável automática exatamente uma vez antes de salvar.');
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
                    <h1 className="admin-page-title">Editor da Lari</h1>
                    <p className="admin-page-subtitle">Organize visualmente tudo que a IA recebe. Arraste os blocos, edite as regras e configure PIX, áudio, prévias, memória e dados do lead com nomes fáceis.</p>
                </header>

                {template ? <PromptVisualEditor
                    key={`${template.updated_at || 'default'}:${template.hasOverride ? 'custom' : 'standard'}`}
                    content={template.content}
                    hasOverride={template.hasOverride}
                    updatedAt={template.updated_at}
                    missingPlaceholders={placeholderValidation.missing}
                    duplicatePlaceholders={placeholderValidation.duplicated}
                    unknownPlaceholders={placeholderValidation.unknown}
                    saving={saving}
                    onContentChange={(content) => setTemplate((current) => current ? { ...current, content } : current)}
                    onSave={saveTemplate}
                    onRestore={restoreDefault}
                /> : <section className="admin-card p-6 text-sm text-slate-400">{loading ? 'Preparando o editor visual...' : 'Não foi possível carregar a instrução da Lari.'}</section>}

                {message && <div className={`mt-6 rounded-2xl border p-3 text-center text-sm ${message.startsWith('Erro') || message.startsWith('Mantenha') ? 'border-rose-400/30 bg-rose-400/10 text-rose-100' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'}`}>{message}</div>}
            </main>
        </div>
    );
}
