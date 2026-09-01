"use client";
/* eslint-disable react-hooks/refs -- dnd-kit fornece callback refs e listeners próprios para os itens arrastáveis. */

import { useMemo, useState } from 'react';
import {
    closestCenter,
    DndContext,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    composePromptVisualBlocks,
    extractPromptTokens,
    movePromptItem,
    parsePromptFunctionItems,
    parsePromptVisualBlocks,
    PROMPT_FUNCTION_LABELS,
    PROMPT_TOKEN_LABELS,
    reorderPromptFunctionItems,
    updatePromptFunctionItem,
    type PromptBlockTone,
    type PromptVisualBlock,
} from '@/lib/promptVisualEditor';

const toneClasses: Record<PromptBlockTone, { border: string; surface: string; badge: string; dot: string }> = {
    cyan: { border: 'border-cyan-400/30', surface: 'bg-cyan-400/[0.055]', badge: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100', dot: 'bg-cyan-300' },
    blue: { border: 'border-sky-400/30', surface: 'bg-sky-400/[0.055]', badge: 'border-sky-300/25 bg-sky-300/10 text-sky-100', dot: 'bg-sky-300' },
    emerald: { border: 'border-emerald-400/30', surface: 'bg-emerald-400/[0.055]', badge: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100', dot: 'bg-emerald-300' },
    pink: { border: 'border-pink-400/30', surface: 'bg-pink-400/[0.055]', badge: 'border-pink-300/25 bg-pink-300/10 text-pink-100', dot: 'bg-pink-300' },
    amber: { border: 'border-amber-400/30', surface: 'bg-amber-400/[0.055]', badge: 'border-amber-300/25 bg-amber-300/10 text-amber-100', dot: 'bg-amber-300' },
    violet: { border: 'border-violet-400/30', surface: 'bg-violet-400/[0.055]', badge: 'border-violet-300/25 bg-violet-300/10 text-violet-100', dot: 'bg-violet-300' },
    indigo: { border: 'border-indigo-400/30', surface: 'bg-indigo-400/[0.055]', badge: 'border-indigo-300/25 bg-indigo-300/10 text-indigo-100', dot: 'bg-indigo-300' },
    slate: { border: 'border-slate-400/25', surface: 'bg-slate-400/[0.045]', badge: 'border-slate-300/20 bg-slate-300/10 text-slate-200', dot: 'bg-slate-300' },
    orange: { border: 'border-orange-400/30', surface: 'bg-orange-400/[0.055]', badge: 'border-orange-300/25 bg-orange-300/10 text-orange-100', dot: 'bg-orange-300' },
    rose: { border: 'border-rose-400/30', surface: 'bg-rose-400/[0.055]', badge: 'border-rose-300/25 bg-rose-300/10 text-rose-100', dot: 'bg-rose-300' },
};

const blockTypeLabel = (block: PromptVisualBlock) => block.kind === 'functions'
    ? 'Funções'
    : block.kind === 'dynamic' ? 'Dado automático' : 'Regra editável';

type SortableFunctionProps = {
    item: { name: string; content: string };
    index: number;
    count: number;
    onMove: (from: number, to: number) => void;
    onChange: (name: string, content: string) => void;
};

function SortableFunctionCard({ item, index, count, onMove, onChange }: SortableFunctionProps) {
    const id = `function:${item.name}`;
    const sortable = useSortable({ id });
    const metadata = PROMPT_FUNCTION_LABELS[item.name] || { label: item.name, category: 'Função', tone: 'slate' as const };
    const tone = toneClasses[metadata.tone];
    const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };

    return (
        <article ref={sortable.setNodeRef} style={style} className={`rounded-2xl border ${tone.border} ${tone.surface} p-4 shadow-[inset_0_1px_rgba(255,255,255,0.035)] ${sortable.isDragging ? 'z-20 opacity-70 shadow-2xl' : ''}`}>
            <div className="flex items-start gap-3">
                <button
                    type="button"
                    ref={sortable.setActivatorNodeRef}
                    {...sortable.attributes}
                    {...sortable.listeners}
                    className="flex h-11 w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-xl border border-white/10 bg-black/20 text-lg text-slate-400 hover:border-white/20 hover:text-white active:cursor-grabbing"
                    aria-label={`Arrastar ${metadata.label}`}
                    title="Arraste para mudar a ordem"
                >⋮⋮</button>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
                        <h4 className="font-semibold text-white">{metadata.label}</h4>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${tone.badge}`}>{metadata.category}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Pedido da IA, sempre confirmado pelo backend antes de executar.</p>
                </div>
                <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => onMove(index, index - 1)} disabled={index === 0} className="h-10 w-10 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-25" aria-label={`Mover ${metadata.label} para cima`}>↑</button>
                    <button type="button" onClick={() => onMove(index, index + 1)} disabled={index === count - 1} className="h-10 w-10 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-25" aria-label={`Mover ${metadata.label} para baixo`}>↓</button>
                </div>
            </div>
            <details className="mt-3 rounded-xl border border-white/[0.07] bg-black/15">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-300">Editar quando e como usar</summary>
                <div className="border-t border-white/[0.07] p-3">
                    <textarea
                        value={item.content}
                        onChange={(event) => onChange(item.name, event.target.value)}
                        rows={4}
                        className="w-full resize-y rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm leading-6 text-slate-100 outline-none focus:border-cyan-400/40"
                        aria-label={`Configuração de ${metadata.label}`}
                    />
                    <p className="mt-2 text-[11px] text-slate-600">Nome interno preservado: <code>{item.name}</code></p>
                </div>
            </details>
        </article>
    );
}

type SortableBlockProps = {
    block: PromptVisualBlock;
    index: number;
    count: number;
    expanded: boolean;
    onToggle: () => void;
    onMove: (from: number, to: number) => void;
    onChange: (id: string, content: string) => void;
    onDelete: (id: string) => void;
    onFunctionDragEnd: (blockId: string, event: DragEndEvent) => void;
};

function SortableBlockCard({ block, index, count, expanded, onToggle, onMove, onChange, onDelete, onFunctionDragEnd }: SortableBlockProps) {
    const id = `block:${block.id}`;
    const sortable = useSortable({ id });
    const tone = toneClasses[block.tone];
    const tokens = extractPromptTokens(block.content);
    const functions = block.kind === 'functions' ? parsePromptFunctionItems(block.content) : [];
    const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };

    const moveFunction = (from: number, to: number) => {
        if (to < 0 || to >= functions.length) return;
        onChange(block.id, reorderPromptFunctionItems(block.content, functions[from].name, functions[to].name));
    };

    return (
        <article ref={sortable.setNodeRef} style={style} className={`overflow-hidden rounded-[1.35rem] border ${tone.border} ${tone.surface} shadow-[0_20px_60px_-42px_rgba(0,0,0,0.95)] ${sortable.isDragging ? 'z-30 opacity-70 shadow-2xl' : ''}`}>
            <div className="flex items-start gap-3 p-4 sm:p-5">
                <button
                    type="button"
                    ref={sortable.setActivatorNodeRef}
                    {...sortable.attributes}
                    {...sortable.listeners}
                    className="flex h-12 w-12 shrink-0 cursor-grab touch-none items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-xl text-slate-400 hover:border-white/20 hover:text-white active:cursor-grabbing"
                    aria-label={`Arrastar bloco ${block.friendlyName}`}
                    title="Arraste para mudar a ordem enviada à IA"
                >⋮⋮</button>
                <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left" aria-expanded={expanded}>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
                        <h3 className="text-base font-semibold text-white sm:text-lg">{block.friendlyName}</h3>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${tone.badge}`}>{blockTypeLabel(block)}</span>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-slate-400">{block.description}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                        <span>{block.content.length.toLocaleString('pt-BR')} caracteres</span>
                        {functions.length > 0 && <span>• {functions.length} funções</span>}
                        {tokens.length > 0 && <span>• {tokens.length} dados automáticos</span>}
                    </div>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => onMove(index, index - 1)} disabled={index === 0} className="hidden h-10 w-10 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-25 sm:block" aria-label={`Mover ${block.friendlyName} para cima`}>↑</button>
                    <button type="button" onClick={() => onMove(index, index + 1)} disabled={index === count - 1} className="hidden h-10 w-10 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-25 sm:block" aria-label={`Mover ${block.friendlyName} para baixo`}>↓</button>
                    <button type="button" onClick={onToggle} className="h-10 w-10 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5" aria-label={expanded ? `Recolher ${block.friendlyName}` : `Abrir ${block.friendlyName}`}>{expanded ? '−' : '+'}</button>
                </div>
            </div>

            {expanded && <div className="border-t border-white/[0.075] bg-black/[0.12] p-4 sm:p-5">
                {tokens.length > 0 && <div className="mb-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Variáveis automáticas deste bloco</p>
                    <div className="flex flex-wrap gap-2">
                        {tokens.map((token) => <span key={token} className={`rounded-xl border px-2.5 py-1.5 text-xs font-semibold ${tone.badge}`} title={token}>{PROMPT_TOKEN_LABELS[token] || token}</span>)}
                    </div>
                </div>}

                {block.kind === 'functions' && functions.length > 0 ? <DndContext collisionDetection={closestCenter} onDragEnd={(event) => onFunctionDragEnd(block.id, event)}>
                    <SortableContext items={functions.map((item) => `function:${item.name}`)} strategy={verticalListSortingStrategy}>
                        <div className="grid gap-3 lg:grid-cols-2">
                            {functions.map((item, functionIndex) => <SortableFunctionCard
                                key={item.name}
                                item={item}
                                index={functionIndex}
                                count={functions.length}
                                onMove={moveFunction}
                                onChange={(name, content) => onChange(block.id, updatePromptFunctionItem(block.content, name, content))}
                            />)}
                        </div>
                    </SortableContext>
                </DndContext> : <textarea
                    value={block.content}
                    onChange={(event) => onChange(block.id, event.target.value)}
                    rows={Math.min(18, Math.max(7, block.content.split('\n').length + 1))}
                    className="w-full resize-y rounded-2xl border border-white/10 bg-black/25 px-4 py-3 font-mono text-sm leading-6 text-slate-100 outline-none focus:border-cyan-400/40 focus:ring-2 focus:ring-cyan-400/10"
                    aria-label={`Conteúdo do bloco ${block.friendlyName}`}
                    spellCheck={false}
                />}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex gap-2 sm:hidden">
                        <button type="button" onClick={() => onMove(index, index - 1)} disabled={index === 0} className="h-11 rounded-xl border border-white/10 px-3 text-sm text-slate-300 disabled:opacity-25">↑ subir</button>
                        <button type="button" onClick={() => onMove(index, index + 1)} disabled={index === count - 1} className="h-11 rounded-xl border border-white/10 px-3 text-sm text-slate-300 disabled:opacity-25">↓ descer</button>
                    </div>
                    <button type="button" onClick={() => onDelete(block.id)} className="ml-auto rounded-xl border border-rose-400/20 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-400/10">remover bloco</button>
                </div>
            </div>}
        </article>
    );
}

type PromptVisualEditorProps = {
    content: string;
    hasOverride: boolean;
    updatedAt: string | null;
    missingPlaceholders: string[];
    duplicatePlaceholders: string[];
    unknownPlaceholders: string[];
    saving: boolean;
    onContentChange: (content: string) => void;
    onSave: () => void;
    onRestore: () => void;
};

export default function PromptVisualEditor({ content, hasOverride, updatedAt, missingPlaceholders, duplicatePlaceholders, unknownPlaceholders, saving, onContentChange, onSave, onRestore }: PromptVisualEditorProps) {
    const [mode, setMode] = useState<'visual' | 'raw'>('visual');
    const [blocks, setBlocks] = useState<PromptVisualBlock[]>(() => parsePromptVisualBlocks(content));
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set(parsePromptVisualBlocks(content)
        .filter((block) => block.kind === 'functions' || block.friendlyName === 'Como vender' || block.friendlyName === 'Quem é a Lari')
        .map((block) => block.id)));
    const [announcement, setAnnouncement] = useState('');
    const [savedSnapshot] = useState(content);
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const syncBlocks = (nextBlocks: PromptVisualBlock[], announce?: string) => {
        setBlocks(nextBlocks);
        onContentChange(composePromptVisualBlocks(nextBlocks));
        if (announce) setAnnouncement(announce);
    };

    const moveBlock = (from: number, to: number) => {
        if (to < 0 || to >= blocks.length) return;
        const moved = blocks[from];
        syncBlocks(movePromptItem(blocks, from, to), `${moved.friendlyName} movido para a posição ${to + 1}.`);
    };

    const handleBlockDragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;
        const activeId = String(active.id).replace(/^block:/, '');
        const overId = String(over.id).replace(/^block:/, '');
        const from = blocks.findIndex((block) => block.id === activeId);
        const to = blocks.findIndex((block) => block.id === overId);
        if (from < 0 || to < 0) return;
        const moved = blocks[from];
        syncBlocks(arrayMove(blocks, from, to), `${moved.friendlyName} movido para a posição ${to + 1}.`);
    };

    const handleFunctionDragEnd = (blockId: string, { active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;
        const activeName = String(active.id).replace(/^function:/, '');
        const overName = String(over.id).replace(/^function:/, '');
        const next = blocks.map((block) => block.id === blockId
            ? { ...block, content: reorderPromptFunctionItems(block.content, activeName, overName) }
            : block);
        const friendly = PROMPT_FUNCTION_LABELS[activeName]?.label || activeName;
        syncBlocks(next, `${friendly} mudou de posição.`);
    };

    const updateBlock = (id: string, nextContent: string) => syncBlocks(blocks.map((block) => {
        if (block.id !== id) return block;
        const reparsed = parsePromptVisualBlocks(nextContent)[0];
        return { ...block, content: nextContent, heading: reparsed?.heading || block.heading };
    }));

    const deleteBlock = (id: string) => {
        const block = blocks.find((item) => item.id === id);
        if (!block || !confirm(`Remover o bloco “${block.friendlyName}”? Você poderá restaurar o padrão depois.`)) return;
        syncBlocks(blocks.filter((item) => item.id !== id), `${block.friendlyName} removido.`);
    };

    const addBlock = () => {
        const nextIndex = blocks.length + 1;
        const parsed = parsePromptVisualBlocks(`# NOVO BLOCO ${nextIndex}\n\nEscreva aqui a nova regra da Lari.`)[0];
        const next = [...blocks, { ...parsed, id: `section-new-${Date.now()}` }];
        syncBlocks(next, 'Novo bloco criado no final.');
        setExpanded((current) => new Set([...current, next.at(-1)!.id]));
    };

    const totalFunctions = useMemo(() => blocks.reduce((total, block) => total + parsePromptFunctionItems(block.content).length, 0), [blocks]);
    const totalVariables = useMemo(() => extractPromptTokens(content).length, [content]);
    const changed = content !== savedSnapshot;
    const hasPlaceholderError = missingPlaceholders.length > 0 || duplicatePlaceholders.length > 0 || unknownPlaceholders.length > 0;

    return (
        <div>
            <div className="sticky top-[4.5rem] z-40 -mx-2 rounded-2xl border border-white/[0.08] bg-[#090e17]/95 p-2 shadow-2xl backdrop-blur-xl sm:top-[4.9rem]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 gap-1 overflow-x-auto">
                        <button type="button" onClick={() => setMode('visual')} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold ${mode === 'visual' ? 'bg-cyan-400/15 text-cyan-100 ring-1 ring-cyan-300/25' : 'text-slate-400 hover:bg-white/5'}`}>Editor visual</button>
                        <button type="button" onClick={() => setMode('raw')} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold ${mode === 'raw' ? 'bg-violet-400/15 text-violet-100 ring-1 ring-violet-300/25' : 'text-slate-400 hover:bg-white/5'}`}>Texto completo real</button>
                    </div>
                    <div className="flex items-center gap-2">
                        {changed && <span className="hidden text-xs font-semibold text-amber-200 sm:inline">alterações não salvas</span>}
                        <button type="button" onClick={onSave} disabled={saving || hasPlaceholderError} className="rounded-xl border border-emerald-300/30 bg-emerald-400/15 px-4 py-2.5 text-sm font-bold text-emerald-100 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40">{saving ? 'salvando...' : 'Salvar alterações'}</button>
                    </div>
                </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.055] p-4"><p className="text-2xl font-semibold text-cyan-100">{blocks.length}</p><p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200/60">blocos arrastáveis</p></div>
                <div className="rounded-2xl border border-pink-400/20 bg-pink-400/[0.055] p-4"><p className="text-2xl font-semibold text-pink-100">{totalFunctions}</p><p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-pink-200/60">funções reais</p></div>
                <div className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.055] p-4"><p className="text-2xl font-semibold text-violet-100">{totalVariables}</p><p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-violet-200/60">variáveis automáticas</p></div>
            </div>

            {missingPlaceholders.length > 0 && <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100"><strong>Faltam dados automáticos obrigatórios.</strong> Coloque estes itens de volta antes de salvar: {missingPlaceholders.map((token) => PROMPT_TOKEN_LABELS[token] || token).join(', ')}.</div>}
            {duplicatePlaceholders.length > 0 && <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100"><strong>Existem variáveis repetidas.</strong> Deixe cada uma apenas uma vez: {duplicatePlaceholders.map((token) => PROMPT_TOKEN_LABELS[token] || token).join(', ')}.</div>}
            {unknownPlaceholders.length > 0 && <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-100"><strong>Existem variáveis que o backend não reconhece.</strong> Remova: {unknownPlaceholders.join(', ')}.</div>}

            {mode === 'visual' ? <div className="mt-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-semibold text-white">Ordem enviada para a IA</h2>
                        <p className="mt-1 text-sm text-slate-400">Arraste pela alça ⋮⋮. As cores separam venda, funções, memória, segurança e dados automáticos.</p>
                    </div>
                    <button type="button" onClick={addBlock} className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.07] px-3.5 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/10">+ Novo bloco</button>
                </div>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleBlockDragEnd}>
                    <SortableContext items={blocks.map((block) => `block:${block.id}`)} strategy={verticalListSortingStrategy}>
                        <div className="grid gap-3">
                            {blocks.map((block, index) => <SortableBlockCard
                                key={block.id}
                                block={block}
                                index={index}
                                count={blocks.length}
                                expanded={expanded.has(block.id)}
                                onToggle={() => setExpanded((current) => {
                                    const next = new Set(current);
                                    if (next.has(block.id)) next.delete(block.id); else next.add(block.id);
                                    return next;
                                })}
                                onMove={moveBlock}
                                onChange={updateBlock}
                                onDelete={deleteBlock}
                                onFunctionDragEnd={handleFunctionDragEnd}
                            />)}
                        </div>
                    </SortableContext>
                </DndContext>
            </div> : <div className="mt-5 rounded-[1.35rem] border border-violet-400/25 bg-violet-400/[0.045] p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-semibold text-white">Texto completo que forma o system instruction</h2>
                        <p className="mt-1 max-w-3xl text-sm text-slate-400">Esta é a mesma fonte do editor visual. Você ainda pode editar tudo diretamente aqui.</p>
                    </div>
                    <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-3 py-1 text-xs font-semibold text-violet-100">{content.length.toLocaleString('pt-BR')} caracteres</span>
                </div>
                <textarea
                    value={content}
                    onChange={(event) => onContentChange(event.target.value)}
                    rows={38}
                    className="mt-4 w-full rounded-2xl border border-violet-400/20 bg-black/30 px-4 py-3 font-mono text-sm leading-6 text-slate-100 outline-none focus:border-violet-300/40 focus:ring-2 focus:ring-violet-300/10"
                    aria-label="Template completo do system instruction"
                    spellCheck={false}
                />
                <button type="button" onClick={() => { setBlocks(parsePromptVisualBlocks(content)); setMode('visual'); }} className="mt-3 rounded-xl border border-white/10 px-3.5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/5">Voltar ao visual com este texto</button>
            </div>}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-black/20 p-4 text-xs text-slate-500">
                <span>{hasOverride ? 'Versão personalizada ativa' : 'Usando o padrão do sistema'} {updatedAt ? `• salvo em ${new Date(updatedAt).toLocaleString('pt-BR')}` : ''}</span>
                <button type="button" onClick={onRestore} disabled={saving} className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5 disabled:opacity-40">Restaurar padrão</button>
            </div>
            <p className="sr-only" aria-live="polite">{announcement}</p>
        </div>
    );
}
