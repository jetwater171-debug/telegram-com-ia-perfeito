"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";

type PreviewAsset = {
    id: string;
    name: string;
    description?: string | null;
    triggers?: string | null;
    tags?: string[] | null;
    stage?: string | null;
    min_tarado?: number | null;
    max_tarado?: number | null;
    media_type: "image" | "video";
    media_url: string;
    priority?: number | null;
    enabled?: boolean | null;
    analysis_status?: string | null;
    analysis_model?: string | null;
    ai_analysis?: Record<string, unknown> | null;
    created_at?: string | null;
};

type PreviewRequest = {
    id: string;
    requested_description: string;
    example_phrase?: string | null;
    tags?: string[] | null;
    request_count: number;
    priority: number;
    status: "pending" | "fulfilled" | "dismissed";
    last_requested_at?: string | null;
};

const stages = ["TRIGGER_PHASE", "HOT_TALK", "PREVIEW", "SALES_PITCH", "NEGOTIATION", "CLOSING"];

export default function AdminPreviewsPage() {
    const [assets, setAssets] = useState<PreviewAsset[]>([]);
    const [requests, setRequests] = useState<PreviewRequest[]>([]);
    const [files, setFiles] = useState<File[]>([]);
    const [confirmedAdult, setConfirmedAdult] = useState(false);
    const [selectedRequestId, setSelectedRequestId] = useState("");
    const [search, setSearch] = useState("");
    const [showDisabled, setShowDisabled] = useState(true);
    const [loading, setLoading] = useState(false);
    const [loadingPage, setLoadingPage] = useState(true);
    const [message, setMessage] = useState("");
    const [modelSettings, setModelSettings] = useState({
        primaryModel: "google/gemini-3.7-flash",
        fallbackModel: "qwen/qwen3.8-27b",
        openRouterConfigured: false,
    });
    const [manual, setManual] = useState({ name: "", description: "", tags: "" });

    const loadData = useCallback(async () => {
        setLoadingPage(true);
        try {
            const response = await fetch("/api/admin/previews", { cache: "no-store" });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "erro ao carregar");
            setAssets(payload.assets || []);
            setRequests(payload.requests || []);
            if (payload.settings) setModelSettings(payload.settings);
        } catch (error: any) {
            setMessage(error?.message || "erro ao carregar previas");
        } finally {
            setLoadingPage(false);
        }
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => void loadData(), 0);
        return () => window.clearTimeout(timer);
    }, [loadData]);

    const pendingRequests = useMemo(() => requests.filter((item) => item.status === "pending"), [requests]);
    const filteredAssets = useMemo(() => {
        const query = search.trim().toLowerCase();
        return assets.filter((asset) => {
            if (!showDisabled && !asset.enabled) return false;
            if (!query) return true;
            return [asset.name, asset.description, asset.triggers, ...(asset.tags || [])]
                .join(" ")
                .toLowerCase()
                .includes(query);
        });
    }, [assets, search, showDisabled]);

    const upload = async () => {
        if (files.length === 0) return setMessage("selecione pelo menos uma imagem");
        if (!confirmedAdult) return setMessage("confirme a maioridade e autorizacao do material");
        setLoading(true);
        setMessage(`analisando ${files.length} arquivo(s)... isso pode levar alguns segundos`);
        try {
            const formData = new FormData();
            files.forEach((file) => formData.append("files", file));
            formData.set("confirmedAdult", "true");
            if (selectedRequestId) formData.set("requestId", selectedRequestId);
            if (manual.name.trim()) formData.set("name", manual.name.trim());
            if (manual.description.trim()) formData.set("description", manual.description.trim());
            if (manual.tags.trim()) formData.set("tags", manual.tags.trim());
            const response = await fetch("/api/admin/previews", { method: "POST", body: formData });
            const payload = await response.json();
            if (!response.ok && !payload.results) throw new Error(payload.error || "erro no upload");
            setMessage(`${payload.succeeded || 0} analisada(s) e salva(s) · ${payload.failed || 0} com falha`);
            setFiles([]);
            setSelectedRequestId("");
            setManual({ name: "", description: "", tags: "" });
            const input = document.getElementById("preview-files") as HTMLInputElement | null;
            if (input) input.value = "";
            await loadData();
        } catch (error: any) {
            setMessage(error?.message || "erro inesperado");
        } finally {
            setLoading(false);
        }
    };

    const patchAsset = async (id: string, patch: Partial<PreviewAsset>) => {
        const response = await fetch("/api/admin/previews", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "asset", id, patch }),
        });
        const payload = await response.json();
        if (!response.ok) return setMessage(payload.error || "erro ao atualizar");
        setAssets((current) => current.map((asset) => asset.id === id ? payload.asset : asset));
    };

    const reanalyze = async (id: string) => {
        setLoading(true);
        setMessage("reanalisando imagem...");
        try {
            const response = await fetch("/api/admin/previews", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "reanalyze", id }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "erro na analise");
            setAssets((current) => current.map((asset) => asset.id === id ? payload.asset : asset));
            setMessage("analise atualizada");
        } catch (error: any) {
            setMessage(error?.message || "erro na analise");
        } finally {
            setLoading(false);
        }
    };

    const deleteAsset = async (asset: PreviewAsset) => {
        if (!confirm(`deletar "${asset.name}" permanentemente?`)) return;
        const response = await fetch(`/api/admin/previews?id=${encodeURIComponent(asset.id)}`, { method: "DELETE" });
        const payload = await response.json();
        if (!response.ok) return setMessage(payload.error || "erro ao deletar");
        setAssets((current) => current.filter((item) => item.id !== asset.id));
    };

    const updateRequest = async (id: string, status: PreviewRequest["status"]) => {
        const response = await fetch("/api/admin/previews", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "request", id, status }),
        });
        if (response.ok) setRequests((current) => current.map((item) => item.id === id ? { ...item, status } : item));
    };

    const saveModels = async () => {
        const response = await fetch("/api/admin/previews", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "settings",
                primaryModel: modelSettings.primaryModel,
                fallbackModel: modelSettings.fallbackModel,
            }),
        });
        const payload = await response.json();
        setMessage(response.ok ? "modelos de visao salvos" : payload.error || "erro ao salvar modelos");
    };

    return (
        <main className="min-h-screen bg-[#080c13] px-4 py-8 text-slate-100 lg:px-8">
            <div className="mx-auto max-w-[1500px] space-y-7">
                <section className="overflow-hidden rounded-3xl border border-cyan-300/15 bg-gradient-to-br from-cyan-300/[0.08] via-white/[0.03] to-fuchsia-400/[0.05] p-6 lg:p-8">
                    <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
                        <div>
                            <div className="mb-3 inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200">Catálogo inteligente</div>
                            <h1 className="text-3xl font-black tracking-tight lg:text-4xl">Prévias da Larissa</h1>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Envie várias imagens. A IA descreve pose, roupa, cenário, enquadramento, acessórios e situações em que cada prévia combina.</p>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <Metric label="imagens" value={assets.length} />
                            <Metric label="ativas" value={assets.filter((item) => item.enabled).length} />
                            <Metric label="pedidos" value={pendingRequests.length} accent />
                        </div>
                    </div>
                </section>

                {message && <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">{message}</div>}

                <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
                    <div className="space-y-6">
                        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                            <div className="flex items-center justify-between">
                                <div><h2 className="font-bold">Enviar novo lote</h2><p className="mt-1 text-xs text-slate-500">Até 20 arquivos por vez</p></div>
                                <span className="rounded-full bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-200">análise automática</span>
                            </div>

                            {selectedRequestId && (
                                <div className="mt-4 rounded-2xl border border-fuchsia-300/20 bg-fuchsia-300/10 p-3 text-xs text-fuchsia-100">
                                    Este upload vai completar: {requests.find((item) => item.id === selectedRequestId)?.requested_description}
                                    <button onClick={() => setSelectedRequestId("")} className="ml-2 font-bold underline">cancelar</button>
                                </div>
                            )}

                            <label className="mt-4 flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/20 bg-black/20 px-4 text-center transition hover:border-cyan-300/40 hover:bg-cyan-300/[0.04]">
                                <span className="text-2xl">＋</span><span className="mt-2 text-sm font-semibold">Escolher fotos ou vídeos</span><span className="mt-1 text-xs text-slate-500">JPG, PNG, WEBP, GIF ou MP4</span>
                                <input id="preview-files" type="file" accept="image/*,video/*" multiple className="hidden" onChange={(event) => setFiles(Array.from(event.target.files || []))} />
                            </label>

                            {files.length > 0 && <div className="mt-3 max-h-32 space-y-1 overflow-y-auto rounded-2xl bg-black/20 p-3 text-xs text-slate-300">{files.map((file) => <div key={`${file.name}-${file.size}`} className="flex justify-between gap-3"><span className="truncate">{file.name}</span><span className="shrink-0 text-slate-500">{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>)}</div>}

                            <details className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                                <summary className="cursor-pointer text-xs font-semibold text-slate-300">Complemento manual opcional</summary>
                                <div className="mt-3 grid gap-2">
                                    <input value={manual.name} onChange={(event) => setManual({ ...manual, name: event.target.value })} placeholder="nome para todas do lote" className="field" />
                                    <textarea value={manual.description} onChange={(event) => setManual({ ...manual, description: event.target.value })} placeholder="contexto que a IA não consegue ver" className="field min-h-20" />
                                    <input value={manual.tags} onChange={(event) => setManual({ ...manual, tags: event.target.value })} placeholder="tags extras separadas por vírgula" className="field" />
                                </div>
                            </details>

                            <label className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] p-3 text-xs leading-5 text-amber-100/90"><input type="checkbox" checked={confirmedAdult} onChange={(event) => setConfirmedAdult(event.target.checked)} className="mt-1" />Confirmo que todo material é da Larissa, adulta, e está autorizado para este catálogo.</label>
                            <button disabled={loading || files.length === 0} onClick={upload} className="mt-4 w-full rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40">{loading ? "Analisando e salvando..." : `Analisar e salvar ${files.length || ""}`}</button>
                        </section>

                        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                            <div className="flex items-center justify-between"><h2 className="font-bold">Modelos de visão</h2><span className={`h-2.5 w-2.5 rounded-full ${modelSettings.openRouterConfigured ? "bg-emerald-300" : "bg-rose-300"}`} /></div>
                            <p className="mt-1 text-xs leading-5 text-slate-500">O segundo modelo entra se o principal falhar ou recusar a análise.</p>
                            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Principal</label>
                            <input value={modelSettings.primaryModel} onChange={(event) => setModelSettings({ ...modelSettings, primaryModel: event.target.value })} className="field mt-2" />
                            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Fallback visual</label>
                            <input value={modelSettings.fallbackModel} onChange={(event) => setModelSettings({ ...modelSettings, fallbackModel: event.target.value })} className="field mt-2" />
                            <button onClick={saveModels} className="mt-3 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-white/5">Salvar modelos</button>
                        </section>
                    </div>

                    <div className="space-y-6">
                        <section className="rounded-3xl border border-fuchsia-300/15 bg-fuchsia-300/[0.04] p-5 lg:p-6">
                            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-lg font-bold">Fotos pedidas pelos leads</h2><p className="mt-1 text-xs text-slate-500">Pedidos repetidos sobem automaticamente de prioridade.</p></div><span className="rounded-full bg-fuchsia-300/10 px-3 py-1 text-xs font-bold text-fuchsia-200">{pendingRequests.length} pendentes</span></div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                                {pendingRequests.slice(0, 12).map((request) => (
                                    <div key={request.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                        <div className="flex items-start justify-between gap-3"><p className="text-sm font-semibold leading-5">{request.requested_description}</p><span className="shrink-0 rounded-full bg-white/5 px-2 py-1 text-[10px] text-slate-400">{request.request_count}x</span></div>
                                        {request.example_phrase && <p className="mt-2 text-xs italic text-slate-500">“{request.example_phrase}”</p>}
                                        <div className="mt-3 flex flex-wrap gap-1">{(request.tags || []).map((tag) => <Tag key={tag}>{tag}</Tag>)}</div>
                                        <div className="mt-4 flex gap-2"><button onClick={() => { setSelectedRequestId(request.id); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="rounded-xl bg-fuchsia-300 px-3 py-2 text-xs font-black text-slate-950">Produzir e enviar</button><button onClick={() => updateRequest(request.id, "dismissed")} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-400">ignorar</button></div>
                                    </div>
                                ))}
                                {!loadingPage && pendingRequests.length === 0 && <Empty text="Nenhuma lacuna detectada. O catálogo está cobrindo os pedidos atuais." />}
                            </div>
                        </section>

                        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 lg:p-6">
                            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center"><div><h2 className="text-lg font-bold">Biblioteca visual</h2><p className="mt-1 text-xs text-slate-500">O cérebro lê estes metadados para escolher a prévia.</p></div><div className="flex flex-wrap gap-2"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="buscar pose, roupa, cenário..." className="field w-full sm:w-72" /><label className="flex items-center gap-2 rounded-xl border border-white/10 px-3 text-xs text-slate-400"><input type="checkbox" checked={showDisabled} onChange={(event) => setShowDisabled(event.target.checked)} /> inativas</label></div></div>

                            <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                                {filteredAssets.map((asset) => (
                                    <article key={asset.id} className={`overflow-hidden rounded-2xl border bg-black/25 ${asset.enabled ? "border-white/10" : "border-rose-300/20 opacity-70"}`}>
                                        <div className="relative aspect-[4/3] overflow-hidden bg-black/50">
                                            {asset.media_type === "video" ? <video src={asset.media_url} controls preload="metadata" className="h-full w-full object-cover" /> : <img src={asset.media_url} alt={asset.name} loading="lazy" className="h-full w-full object-cover" />}
                                            <div className="absolute left-2 top-2 flex gap-1"><span className="rounded-full bg-black/70 px-2 py-1 text-[10px] font-bold uppercase">{asset.media_type}</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${asset.analysis_status === "completed" || asset.tags?.includes("ai-analisada") ? "bg-emerald-300 text-slate-950" : "bg-amber-300 text-slate-950"}`}>{asset.analysis_status || (asset.tags?.includes("ai-analisada") ? "analisada" : "manual")}</span></div>
                                        </div>
                                        <div className="p-4">
                                            <input defaultValue={asset.name} onBlur={(event) => patchAsset(asset.id, { name: event.target.value })} className="w-full bg-transparent text-sm font-bold outline-none" />
                                            <textarea defaultValue={asset.description || ""} onBlur={(event) => patchAsset(asset.id, { description: event.target.value })} className="mt-2 min-h-20 w-full resize-y rounded-xl border border-white/10 bg-black/20 p-2 text-xs leading-5 text-slate-400 outline-none focus:border-cyan-300/30" />
                                            <input defaultValue={(asset.tags || []).join(", ")} onBlur={(event) => patchAsset(asset.id, { tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })} className="field mt-2 text-xs" />
                                            <div className="mt-3 grid grid-cols-3 gap-2"><select value={asset.stage || "PREVIEW"} onChange={(event) => patchAsset(asset.id, { stage: event.target.value })} className="field col-span-2 text-[11px]">{stages.map((stage) => <option key={stage}>{stage}</option>)}</select><input type="number" value={asset.priority || 0} onChange={(event) => setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, priority: Number(event.target.value) } : item))} onBlur={(event) => patchAsset(asset.id, { priority: Number(event.target.value) })} className="field text-xs" title="prioridade" /></div>
                                            <div className="mt-3 flex items-center justify-between gap-2"><label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={asset.enabled ?? false} onChange={(event) => patchAsset(asset.id, { enabled: event.target.checked })} /> ativa</label><div className="flex gap-2">{asset.media_type === "image" && <button disabled={loading} onClick={() => reanalyze(asset.id)} className="text-xs font-semibold text-cyan-200 hover:text-cyan-100">reanalisar</button>}<button onClick={() => deleteAsset(asset)} className="text-xs font-semibold text-rose-300 hover:text-rose-200">deletar</button></div></div>
                                            {asset.analysis_model && <p className="mt-3 truncate text-[10px] text-slate-600">{asset.analysis_model}</p>}
                                        </div>
                                    </article>
                                ))}
                                {!loadingPage && filteredAssets.length === 0 && <Empty text="Nenhuma prévia encontrada." />}
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </main>
    );
}

function Metric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
    return <div className={`min-w-20 rounded-2xl border px-3 py-2 ${accent ? "border-fuchsia-300/20 bg-fuchsia-300/10" : "border-white/10 bg-black/20"}`}><strong className="block text-lg">{value}</strong><span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span></div>;
}

function Tag({ children }: { children: React.ReactNode }) {
    return <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-400">{children}</span>;
}

function Empty({ text }: { text: string }) {
    return <div className="col-span-full rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">{text}</div>;
}
