"use client";

import React, { useState } from "react";
import { AiDebugData, AiDebugStage } from "@/types";

interface PromptInspectorDrawerProps {
    open: boolean;
    onClose: () => void;
    debugData: AiDebugData | null;
    messageCreatedAt?: string;
    thoughtContent?: string;
}

export function PromptInspectorDrawer({
    open,
    onClose,
    debugData,
    messageCreatedAt,
    thoughtContent,
}: PromptInspectorDrawerProps) {
    const [activeTab, setActiveTab] = useState<"prompt" | "response" | "stages" | "history">("prompt");
    const [promptViewMode, setPromptViewMode] = useState<"all" | "system" | "user">("all");
    const [selectedStage, setSelectedStage] = useState<string>("strategy");
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    if (!open) return null;

    const copyToClipboard = (text: string, key: string) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        setCopiedKey(key);
        setTimeout(() => {
            setCopiedKey((prev) => (prev === key ? null : prev));
        }, 2000);
    };

    const hasStages = debugData?.stages && Object.keys(debugData.stages).length > 0;
    const stagesList: Array<{ key: string; label: string; data: AiDebugStage }> = [];
    if (debugData?.stages?.strategy) {
        stagesList.push({ key: "strategy", label: "1. Cérebro Estratégico", data: debugData.stages.strategy });
    }
    if (debugData?.stages?.draft) {
        stagesList.push({ key: "draft", label: "2. Rascunho da Lari", data: debugData.stages.draft });
    }
    if (debugData?.stages?.review) {
        stagesList.push({ key: "review", label: "3. Revisora", data: debugData.stages.review });
    }
    if (debugData?.stages?.evaluator) {
        stagesList.push({ key: "evaluator", label: "4. Avaliadora Elite", data: debugData.stages.evaluator });
    }

    const fullPromptText = [
        "=== SYSTEM INSTRUCTION ===",
        debugData?.system_prompt || "",
        "\n=== USER MESSAGE / CONTEXT ===",
        debugData?.user_prompt || "",
    ].filter(Boolean).join("\n");

    const activeStageData = debugData?.stages?.[selectedStage as keyof typeof debugData.stages];

    return (
        <div
            className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs transition-opacity"
            onClick={onClose}
        >
            <div
                className="flex h-full w-full max-w-3xl flex-col border-l border-white/10 bg-[#080b10] text-slate-100 shadow-2xl animate-in slide-in-from-right duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#0b0f16] px-5 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">
                            ⚡
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-base font-bold text-slate-50">Inspetor de Prompt & Resposta da IA</h2>
                                {debugData?.tier && (
                                    <span className="rounded border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-200">
                                        {debugData.tier}
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-slate-400">
                                {debugData?.model ? `${debugData.provider || "ai"}:${debugData.model}` : "Dados de geração da IA"}
                                {debugData?.duration_ms ? ` · ${debugData.duration_ms}ms` : ""}
                                {messageCreatedAt ? ` · ${formatDateTime(messageCreatedAt)}` : ""}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white"
                        title="Fechar painel"
                    >
                        ✕ Fechar
                    </button>
                </header>

                {/* Info bar when debug data is available */}
                {debugData ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/40 px-5 py-2.5 text-xs">
                        <div className="flex flex-wrap items-center gap-4 text-slate-400">
                            <div>
                                <span className="text-slate-500">Modelo: </span>
                                <span className="font-mono text-cyan-200">{debugData.model || "Desconhecido"}</span>
                            </div>
                            <div>
                                <span className="text-slate-500">Tempo: </span>
                                <span className="font-mono text-emerald-300">{debugData.duration_ms || 0} ms</span>
                            </div>
                            {debugData.tokens_estimated ? (
                                <div>
                                    <span className="text-slate-500">Tokens est.: </span>
                                    <span className="font-mono text-amber-200">~{debugData.tokens_estimated}</span>
                                </div>
                            ) : null}
                        </div>

                        <div className="flex items-center gap-2">
                            {activeTab === "prompt" && (
                                <button
                                    onClick={() => copyToClipboard(
                                        promptViewMode === "system"
                                            ? debugData.system_prompt
                                            : promptViewMode === "user"
                                                ? debugData.user_prompt
                                                : fullPromptText,
                                        "prompt"
                                    )}
                                    className="flex items-center gap-1.5 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
                                >
                                    {copiedKey === "prompt" ? "✓ Copiado!" : "📋 Copiar Prompt"}
                                </button>
                            )}
                            {activeTab === "response" && (
                                <button
                                    onClick={() => copyToClipboard(JSON.stringify(debugData.raw_response, null, 2), "response")}
                                    className="flex items-center gap-1.5 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
                                >
                                    {copiedKey === "response" ? "✓ Copiado!" : "📋 Copiar JSON"}
                                </button>
                            )}
                            {activeTab === "stages" && activeStageData && (
                                <button
                                    onClick={() => copyToClipboard(
                                        JSON.stringify({ prompt: activeStageData.prompt, output: activeStageData.output }, null, 2),
                                        "stage"
                                    )}
                                    className="flex items-center gap-1.5 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-300/20"
                                >
                                    {copiedKey === "stage" ? "✓ Copiado!" : "📋 Copiar Etapa"}
                                </button>
                            )}
                        </div>
                    </div>
                ) : null}

                {/* Tabs bar */}
                <div className="flex border-b border-white/10 bg-[#0b0f16]/60 px-5 pt-2">
                    <TabButton active={activeTab === "prompt"} onClick={() => setActiveTab("prompt")}>
                        📤 Prompt Enviado ({debugData?.system_prompt ? `${debugData.system_prompt.length} chars` : "0"})
                    </TabButton>
                    <TabButton active={activeTab === "response"} onClick={() => setActiveTab("response")}>
                        📥 Resposta Bruta (JSON)
                    </TabButton>
                    {hasStages && (
                        <TabButton active={activeTab === "stages"} onClick={() => setActiveTab("stages")}>
                            🧠 Etapas ({stagesList.length})
                        </TabButton>
                    )}
                    {debugData?.clean_history && debugData.clean_history.length > 0 && (
                        <TabButton active={activeTab === "history"} onClick={() => setActiveTab("history")}>
                            💬 Histórico Enviado ({debugData.clean_history.length})
                        </TabButton>
                    )}
                </div>

                {/* Content body */}
                <div className="flex-1 overflow-y-auto p-5">
                    {!debugData ? (
                        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber-300/30 bg-amber-300/10 text-xl text-amber-200">
                                ℹ️
                            </div>
                            <div className="max-w-md">
                                <h3 className="text-sm font-semibold text-slate-200">Prompt Detalhado Não Disponível para esta Mensagem</h3>
                                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                                    Esta mensagem foi gravada antes da ativação do inspetor ou não possui os metadados de debug vinculados.
                                    Todas as novas mensagens processadas a partir de agora terão o prompt mestre e a resposta JSON registrados em tempo real!
                                </p>
                            </div>
                            {thoughtContent && (
                                <div className="mt-4 w-full text-left">
                                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Pensamento Operacional Gravado:</p>
                                    <pre className="whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs text-amber-100">
                                        {thoughtContent}
                                    </pre>
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            {/* Tab 1: Prompt Enviado */}
                            {activeTab === "prompt" && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex gap-1.5">
                                            <SubViewButton
                                                active={promptViewMode === "all"}
                                                onClick={() => setPromptViewMode("all")}
                                            >
                                                Tudo Junto
                                            </SubViewButton>
                                            <SubViewButton
                                                active={promptViewMode === "system"}
                                                onClick={() => setPromptViewMode("system")}
                                            >
                                                System Instruction
                                            </SubViewButton>
                                            <SubViewButton
                                                active={promptViewMode === "user"}
                                                onClick={() => setPromptViewMode("user")}
                                            >
                                                Mensagem / Contexto do Lead
                                            </SubViewButton>
                                        </div>

                                        <span className="text-[11px] text-slate-500">
                                            {promptViewMode === "system"
                                                ? `${debugData.system_prompt?.length || 0} caracteres`
                                                : promptViewMode === "user"
                                                    ? `${debugData.user_prompt?.length || 0} caracteres`
                                                    : `${fullPromptText.length} caracteres`}
                                        </span>
                                    </div>

                                    {promptViewMode === "all" && (
                                        <CodeBlock text={fullPromptText} />
                                    )}
                                    {promptViewMode === "system" && (
                                        <CodeBlock text={debugData.system_prompt || "Nenhum system prompt registrado."} />
                                    )}
                                    {promptViewMode === "user" && (
                                        <CodeBlock text={debugData.user_prompt || "Nenhuma mensagem do usuário registrada."} />
                                    )}
                                </div>
                            )}

                            {/* Tab 2: Resposta Bruta (JSON) */}
                            {activeTab === "response" && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-slate-400">
                                            JSON integral retornado pelo modelo para esta resposta:
                                        </span>
                                        <button
                                            onClick={() => copyToClipboard(JSON.stringify(debugData.raw_response, null, 2), "response")}
                                            className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10"
                                        >
                                            {copiedKey === "response" ? "✓ Copiado!" : "Copiar"}
                                        </button>
                                    </div>
                                    <CodeBlock text={JSON.stringify(debugData.raw_response || {}, null, 2)} language="json" />
                                </div>
                            )}

                            {/* Tab 3: Etapas do Pipeline */}
                            {activeTab === "stages" && hasStages && (
                                <div className="space-y-4">
                                    <div className="flex flex-wrap gap-2">
                                        {stagesList.map((stage) => (
                                            <button
                                                key={stage.key}
                                                onClick={() => setSelectedStage(stage.key)}
                                                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${selectedStage === stage.key
                                                    ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-100"
                                                    : "border-white/10 bg-white/[0.04] text-slate-400 hover:text-slate-200"}`}
                                            >
                                                {stage.label}
                                                {stage.data.duration_ms ? ` (${stage.data.duration_ms}ms)` : ""}
                                            </button>
                                        ))}
                                    </div>

                                    {activeStageData ? (
                                        <div className="space-y-4">
                                            {activeStageData.model && (
                                                <div className="flex items-center gap-4 rounded-lg border border-white/10 bg-black/30 p-3 text-xs">
                                                    <div>
                                                        <span className="text-slate-500">Modelo: </span>
                                                        <span className="font-mono text-cyan-200">{activeStageData.provider || ""}:{activeStageData.model}</span>
                                                    </div>
                                                    {activeStageData.duration_ms && (
                                                        <div>
                                                            <span className="text-slate-500">Tempo: </span>
                                                            <span className="font-mono text-emerald-300">{activeStageData.duration_ms}ms</span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            <div>
                                                <div className="mb-2 flex items-center justify-between">
                                                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Prompt da Etapa:</span>
                                                    <button
                                                        onClick={() => copyToClipboard(activeStageData.prompt || "", "stage-prompt")}
                                                        className="text-xs text-cyan-300 hover:underline"
                                                    >
                                                        {copiedKey === "stage-prompt" ? "✓ Copiado" : "Copiar"}
                                                    </button>
                                                </div>
                                                <CodeBlock text={activeStageData.prompt || "Sem prompt registrado"} />
                                            </div>

                                            <div>
                                                <div className="mb-2 flex items-center justify-between">
                                                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Saída JSON da Etapa:</span>
                                                    <button
                                                        onClick={() => copyToClipboard(JSON.stringify(activeStageData.output, null, 2), "stage-output")}
                                                        className="text-xs text-cyan-300 hover:underline"
                                                    >
                                                        {copiedKey === "stage-output" ? "✓ Copiado" : "Copiar"}
                                                    </button>
                                                </div>
                                                <CodeBlock text={JSON.stringify(activeStageData.output || {}, null, 2)} language="json" />
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            )}

                            {/* Tab 4: Histórico Enviado */}
                            {activeTab === "history" && debugData.clean_history && (
                                <div className="space-y-3">
                                    <p className="text-xs text-slate-400">
                                        Janela de mensagens filtradas passadas no contexto do modelo ({debugData.clean_history.length} turnos):
                                    </p>
                                    {debugData.clean_history.map((item, idx) => (
                                        <div
                                            key={idx}
                                            className={`rounded-lg border p-3 text-xs leading-relaxed ${item.role === "assistant" || item.role === "model"
                                                ? "border-cyan-300/20 bg-cyan-300/[0.04]"
                                                : "border-white/10 bg-black/30"}`}
                                        >
                                            <div className="mb-1 font-semibold uppercase text-slate-400">
                                                {item.role === "assistant" || item.role === "model" ? "🤖 IA (Assistente)" : "👤 Lead (Usuário)"}
                                            </div>
                                            <p className="whitespace-pre-wrap break-words font-mono text-slate-200">{item.content}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className={`border-b-2 px-4 py-2.5 text-xs font-semibold transition ${active
                ? "border-cyan-400 text-cyan-200"
                : "border-transparent text-slate-400 hover:border-white/20 hover:text-slate-200"}`}
        >
            {children}
        </button>
    );
}

function SubViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${active
                ? "border-cyan-300/40 bg-cyan-300/15 text-cyan-200"
                : "border-white/10 bg-black/30 text-slate-400 hover:text-slate-200"}`}
        >
            {children}
        </button>
    );
}

function CodeBlock({ text, language = "markdown" }: { text: string; language?: string }) {
    return (
        <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black/60">
            <pre className="max-h-[60vh] overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-200 whitespace-pre-wrap break-words select-text">
                {text}
            </pre>
        </div>
    );
}

function formatDateTime(isoString: string) {
    try {
        return new Date(isoString).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    } catch {
        return isoString;
    }
}
