"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

interface PreviewAsset {
    id: string;
    name: string;
    description?: string | null;
    triggers?: string | null;
    tags?: string[] | null;
    stage?: string | null;
    min_tarado?: number | null;
    max_tarado?: number | null;
    media_type: string;
    media_url: string;
    storage_path?: string | null;
    priority?: number | null;
    enabled?: boolean | null;
    created_at?: string | null;
}

const stages = ["TRIGGER_PHASE", "HOT_TALK", "PREVIEW", "SALES_PITCH", "NEGOTIATION", "CLOSING"];

export default function AdminPreviewsPage() {
    const [items, setItems] = useState<PreviewAsset[]>([]);
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [form, setForm] = useState({
        name: "",
        description: "",
        triggers: "",
        tags: "",
        stage: "PREVIEW",
        min_tarado: 0,
        max_tarado: 100,
        priority: 0,
        enabled: true,
    });

    useEffect(() => {
        ensureBucket();
        loadPreviews();
    }, []);

    const ensureBucket = async () => {
        try {
            await fetch("/api/admin/previews-bucket", { method: "POST" });
        } catch {
            // ignore
        }
    };

    const loadPreviews = async () => {
        const { data, error } = await supabase
            .from("preview_assets")
            .select("*")
            .order("priority", { ascending: false })
            .order("created_at", { ascending: false });
        if (!error && data) setItems(data as PreviewAsset[]);
    };

    const uploadPreview = async () => {
        if (!file) {
            setMsg("selecione um arquivo");
            return;
        }
        if (!form.name.trim()) {
            setMsg("informe um nome");
            return;
        }

        setLoading(true);
        setMsg("");

        try {
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
            const storagePath = `previews/${Date.now()}_${safeName}`;
            const { error: uploadError } = await supabase
                .storage
                .from("previews")
                .upload(storagePath, file, {
                    upsert: true,
                    contentType: file.type || undefined,
                });

            if (uploadError) {
                setMsg(`erro no upload: ${uploadError.message}`);
                setLoading(false);
                return;
            }

            const { data: publicUrl } = supabase.storage.from("previews").getPublicUrl(storagePath);
            const mediaType = file.type.startsWith("video") ? "video" : "image";
            const tags = form.tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);

            const { error: insertError } = await supabase
                .from("preview_assets")
                .insert({
                    name: form.name.trim(),
                    description: form.description.trim() || null,
                    triggers: form.triggers.trim() || null,
                    tags: tags.length ? tags : null,
                    stage: form.stage,
                    min_tarado: Number(form.min_tarado) || 0,
                    max_tarado: Number(form.max_tarado) || 100,
                    media_type: mediaType,
                    media_url: publicUrl.publicUrl,
                    storage_path: storagePath,
                    priority: Number(form.priority) || 0,
                    enabled: form.enabled,
                });

            if (insertError) {
                setMsg(`erro ao salvar: ${insertError.message}`);
            } else {
                setMsg("previa salva com sucesso");
                setForm({
                    name: "",
                    description: "",
                    triggers: "",
                    tags: "",
                    stage: "PREVIEW",
                    min_tarado: 0,
                    max_tarado: 100,
                    priority: 0,
                    enabled: true,
                });
                setFile(null);
                await loadPreviews();
            }
        } catch (e: any) {
            setMsg(e?.message || "erro inesperado");
        }

        setLoading(false);
    };

    const toggleEnabled = async (id: string, enabled: boolean) => {
        await supabase.from("preview_assets").update({ enabled }).eq("id", id);
        setItems((prev) => prev.map((p) => (p.id === id ? { ...p, enabled } : p)));
    };

    const updateField = async (id: string, patch: Partial<PreviewAsset>) => {
        await supabase.from("preview_assets").update(patch).eq("id", id);
        setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    };

    const deletePreview = async (item: PreviewAsset) => {
        if (!confirm(`deletar a previa \"${item.name}\"?`)) return;
        await supabase.from("preview_assets").delete().eq("id", item.id);
        if (item.storage_path) {
            await supabase.storage.from("previews").remove([item.storage_path]);
        }
        setItems((prev) => prev.filter((p) => p.id !== item.id));
    };

    return (
        <div className="min-h-screen bg-[#0b0f17] text-gray-100 font-sans">
            <div className="pointer-events-none fixed inset-0">
                <div className="absolute left-[-140px] top-[-160px] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(14,165,233,0.25),_transparent_70%)]" />
                <div className="absolute right-[-160px] top-[120px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(52,211,153,0.20),_transparent_70%)]" />
                <div className="absolute bottom-[-160px] left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,_rgba(255,122,24,0.10),_transparent_70%)]" />
            </div>

            <header className="sticky top-0 z-30 border-b border-white/10 bg-black/30 backdrop-blur">
                <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
                    <div>
                        <h1 className="text-xl font-semibold">Previas</h1>
                        <p className="text-sm text-gray-400">Cadastre midias e explique quando usar</p>
                    </div>
                    <Link href="/admin" className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-gray-100 transition hover:border-white/20">
                        Voltar
                    </Link>
                </div>
            </header>

            <main className="mx-auto w-full max-w-6xl px-6 py-10">
                <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
                    <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                        <h2 className="text-lg font-semibold">Nova previa</h2>
                        <div className="mt-4 flex flex-col gap-3">
                            <input
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder="Nome (ex: previa rebolando)"
                                className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                            />
                            <textarea
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                placeholder="Descricao curta do conteudo"
                                className="min-h-[90px] w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                            />
                            <textarea
                                value={form.triggers}
                                onChange={(e) => setForm({ ...form, triggers: e.target.value })}
                                placeholder="Quando usar (ex: pediu video, tarado alto, falou de bunda)"
                                className="min-h-[90px] w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                            />
                            <input
                                value={form.tags}
                                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                                placeholder="Tags (separe por virgula)"
                                className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                            />
                            <div className="grid grid-cols-2 gap-3">
                                <div className="flex flex-col gap-2">
                                    <span className="text-xs text-gray-400">Fase</span>
                                    <select
                                        value={form.stage}
                                        onChange={(e) => setForm({ ...form, stage: e.target.value })}
                                        className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                                    >
                                        {stages.map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex flex-col gap-2">
                                    <span className="text-xs text-gray-400">Prioridade</span>
                                    <input
                                        type="number"
                                        value={form.priority}
                                        onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                                        className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="flex flex-col gap-2">
                                    <span className="text-xs text-gray-400">Tarado minimo</span>
                                    <input
                                        type="number"
                                        value={form.min_tarado}
                                        onChange={(e) => setForm({ ...form, min_tarado: Number(e.target.value) })}
                                        className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                                    />
                                </div>
                                <div className="flex flex-col gap-2">
                                    <span className="text-xs text-gray-400">Tarado maximo</span>
                                    <input
                                        type="number"
                                        value={form.max_tarado}
                                        onChange={(e) => setForm({ ...form, max_tarado: Number(e.target.value) })}
                                        className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                                    />
                                </div>
                            </div>
                            <label className="flex items-center gap-2 text-sm text-gray-300">
                                <input
                                    type="checkbox"
                                    checked={form.enabled}
                                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                                    className="h-4 w-4 rounded border-white/20 bg-black/30"
                                />
                                ativa
                            </label>
                            <input
                                type="file"
                                accept="image/*,video/*"
                                onChange={(e) => setFile(e.target.files?.[0] || null)}
                                className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-100 file:mr-3 file:rounded-full file:border-0 file:bg-cyan-500/20 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-cyan-100"
                            />
                            <button
                                onClick={uploadPreview}
                                disabled={loading}
                                className="rounded-2xl border border-cyan-500/30 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100"
                            >
                                {loading ? "enviando..." : "salvar previa"}
                            </button>
                            {msg && (
                                <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-gray-200">
                                    {msg}
                                </div>
                            )}
                        </div>
                    </section>

                    <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                        <h2 className="text-lg font-semibold">Previas cadastradas</h2>
                        <div className="mt-4 grid gap-4">
                            {items.map((item) => (
                                <div key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <p className="text-sm font-semibold text-gray-100">{item.name}</p>
                                            <p className="text-xs text-gray-400">{item.media_type} · {item.stage || "PREVIEW"}</p>
                                        </div>
                                        <button
                                            onClick={() => deletePreview(item)}
                                            className="text-xs text-rose-300 hover:text-rose-200"
                                        >
                                            deletar
                                        </button>
                                    </div>
                                    <div className="mt-3 grid gap-2">
                                        <textarea
                                            defaultValue={item.description || ""}
                                            onBlur={(e) => updateField(item.id, { description: e.target.value })}
                                            placeholder="descricao"
                                            className="min-h-[70px] w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-gray-100 placeholder:text-gray-500"
                                        />
                                        <textarea
                                            defaultValue={item.triggers || ""}
                                            onBlur={(e) => updateField(item.id, { triggers: e.target.value })}
                                            placeholder="gatilhos"
                                            className="min-h-[70px] w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-gray-100 placeholder:text-gray-500"
                                        />
                                        <input
                                            defaultValue={(item.tags || []).join(", ")}
                                            onBlur={(e) => updateField(item.id, { tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
                                            placeholder="tags (virgula)"
                                            className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-gray-100 placeholder:text-gray-500"
                                        />
                                    </div>
                                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-300">
                                        <span>tarado</span>
                                        <input
                                            type="number"
                                            defaultValue={item.min_tarado ?? 0}
                                            onBlur={(e) => updateField(item.id, { min_tarado: Number(e.target.value) })}
                                            className="w-16 rounded-2xl border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-100"
                                        />
                                        <span>-</span>
                                        <input
                                            type="number"
                                            defaultValue={item.max_tarado ?? 100}
                                            onBlur={(e) => updateField(item.id, { max_tarado: Number(e.target.value) })}
                                            className="w-16 rounded-2xl border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-100"
                                        />
                                    </div>
                                    <div className="mt-3 flex flex-wrap items-center gap-3">
                                        <label className="flex items-center gap-2 text-xs text-gray-300">
                                            <input
                                                type="checkbox"
                                                checked={item.enabled ?? false}
                                                onChange={(e) => toggleEnabled(item.id, e.target.checked)}
                                                className="h-4 w-4 rounded border-white/20 bg-black/30"
                                            />
                                            ativa
                                        </label>
                                        <select
                                            value={item.stage || "PREVIEW"}
                                            onChange={(e) => updateField(item.id, { stage: e.target.value })}
                                            className="rounded-2xl border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-100"
                                        >
                                            {stages.map((s) => (
                                                <option key={s} value={s}>{s}</option>
                                            ))}
                                        </select>
                                        <input
                                            type="number"
                                            value={item.priority ?? 0}
                                            onChange={(e) => updateField(item.id, { priority: Number(e.target.value) })}
                                            className="w-20 rounded-2xl border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-100"
                                        />
                                    </div>
                                    <div className="mt-3 text-[11px] text-gray-500 break-all">ID: {item.id}</div>
                                </div>
                            ))}

                            {items.length === 0 && (
                                <div className="rounded-2xl border border-white/10 bg-black/20 p-6 text-center text-sm text-gray-400">
                                    Nenhuma previa cadastrada ainda.
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}
