import { NextRequest, NextResponse } from "next/server";
import { supabaseServer as supabase } from "@/lib/supabaseServer";
import {
    AI_CREDENTIAL_PROVIDERS,
    AI_CREDENTIALS_FALLBACK_SETTING,
    encryptAiCredentialSecret,
    fingerprintAiCredential,
    isAiCredentialEncryptionReady,
    loadAiCredentials,
    maskAiCredential,
    type AiCredentialProvider,
} from "@/lib/aiCredentials";
import { DEFAULT_NVIDIA_MODEL } from "@/lib/aiModels";

export const dynamic = "force-dynamic";
const ACTIVE_ROUTER_PROVIDERS = new Set<AiCredentialProvider>(["bai", "gemini", "nvidia"]);

const cleanText = (value: unknown, max = 500) => String(value || "").trim().slice(0, max);
const nullablePositive = (value: unknown) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};
const nullableDecimal = (value: unknown) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const loadLegacySettings = async () => {
    const { data } = await supabase.from("bot_settings").select("key,value").in("key", [
        "bai_api_key", "gemini_api_key", "groq_api_key", "nvidia_api_key",
        "cloudflare_ai_api_token", "mistral_api_key", "openrouter_api_key",
        "cerebras_api_key", "ai_custom_gateway_api_key",
    ]);
    return Object.fromEntries((data || []).map((row: any) => [row.key, row.value || ""]));
};

const credentialTableMissing = (error: unknown) => /ai_provider_credentials|schema cache|does not exist|could not find the table/i
    .test(String((error as any)?.message || error || ""));

const loadFallbackCredentialRows = async () => {
    const { data, error } = await supabase.from("bot_settings")
        .select("value").eq("key", AI_CREDENTIALS_FALLBACK_SETTING).maybeSingle();
    if (error) throw error;
    try {
        const parsed = JSON.parse(String(data?.value || "[]"));
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
};

const saveFallbackCredentialRows = async (rows: any[]) => {
    const { error } = await supabase.from("bot_settings").upsert({
        key: AI_CREDENTIALS_FALLBACK_SETTING,
        value: JSON.stringify(rows.slice(-2_000)),
    });
    if (error) throw error;
};

const safeProviderError = (value: unknown) => String(value || "teste falhou")
    .replace(/(?:Bearer|key|api[_ -]?key)\s+[^\s,;]+/gi, "[redacted]")
    .slice(0, 300);

const testCredential = async (credential: Awaited<ReturnType<typeof loadAiCredentials>>[number]) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(15_000, credential.limits.timeoutMs || 8_000));
    const startedAt = Date.now();
    try {
        let url: string;
        let init: RequestInit;
        if (credential.provider === "gemini") {
            url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(credential.apiKey)}`;
            init = { signal: controller.signal };
        } else if (credential.provider === "nvidia") {
            url = `${credential.baseUrl || "https://integrate.api.nvidia.com/v1"}/chat/completions`;
            init = {
                method: "POST",
                headers: { Authorization: `Bearer ${credential.apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: credential.model || DEFAULT_NVIDIA_MODEL,
                    messages: [{ role: "user", content: "Responda apenas OK" }],
                    max_tokens: 2,
                    temperature: 0,
                }),
                signal: controller.signal,
            };
        } else {
            url = `${credential.baseUrl || "https://api.b.ai/v1"}/models`;
            init = { headers: { Authorization: `Bearer ${credential.apiKey}` }, signal: controller.signal };
        }
        const response = await fetch(url, init);
        const responseText = await response.text();
        if (!response.ok) throw new Error(`http_${response.status}: ${responseText}`);
        let modelCount: number | null = null;
        try {
            const payload = JSON.parse(responseText || "{}");
            modelCount = Array.isArray(payload?.models) ? payload.models.length
                : Array.isArray(payload?.data) ? payload.data.length
                    : null;
        } catch {
            // Uma resposta 2xx já confirma autenticação; a contagem é opcional.
        }
        return {
            ok: true,
            provider: credential.provider,
            credentialId: credential.id,
            latencyMs: Date.now() - startedAt,
            modelCount,
        };
    } finally {
        clearTimeout(timeout);
    }
};

export async function GET() {
    try {
        const credentials = await loadAiCredentials(await loadLegacySettings());
        return NextResponse.json({
            encryptionReady: isAiCredentialEncryptionReady(),
            credentials: credentials.map((credential) => ({
                id: credential.id,
                provider: credential.provider,
                label: credential.label,
                masked: maskAiCredential(credential),
                source: credential.source,
                projectId: credential.projectId || null,
                accountId: credential.accountId || null,
                quotaGroupId: credential.quotaGroupId,
                baseUrl: credential.baseUrl || null,
                model: credential.model || null,
                enabled: credential.enabled,
                priority: credential.priority,
                weight: credential.weight,
                limits: credential.limits,
                inputCostPerMillion: credential.inputCostPerMillion || null,
                outputCostPerMillion: credential.outputCostPerMillion || null,
                removable: credential.source === "database",
            })),
        });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "erro" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const provider = cleanText(body.provider, 30).toLowerCase() as AiCredentialProvider;
        if (!AI_CREDENTIAL_PROVIDERS.includes(provider) || !ACTIVE_ROUTER_PROVIDERS.has(provider)) {
            return NextResponse.json({ error: "provedor_invalido" }, { status: 400 });
        }
        const secret = cleanText(body.apiKey || body.secret, 8000);
        if (!secret) return NextResponse.json({ error: "api_key_obrigatoria" }, { status: 400 });
        const projectId = cleanText(body.projectId, 180);
        const accountId = cleanText(body.accountId, 180);
        const quotaGroupId = cleanText(body.quotaGroupId, 180).replace(/[^a-zA-Z0-9:_./-]/g, "-");
        if (provider === "gemini" && !projectId) {
            return NextResponse.json({ error: "gemini_project_id_obrigatorio_para_pool_legitimo" }, { status: 400 });
        }
        const encrypted = encryptAiCredentialSecret(secret);
        const fingerprint = fingerprintAiCredential(secret);
        const id = cleanText(body.id, 120) || `${provider}-${fingerprint}`;
        const row = {
            id,
            provider,
            label: cleanText(body.label, 160) || `${provider} · ${fingerprint.slice(-6)}`,
            project_id: projectId || null,
            account_id: accountId || null,
            // Gemini ignora este campo em runtime e sempre agrupa por projectId.
            quota_group_id: provider === "gemini" ? `gemini:project:${projectId}` : quotaGroupId || null,
            base_url: cleanText(body.baseUrl, 1000) || null,
            model: cleanText(body.model, 300) || null,
            priority: Math.max(0, Math.floor(Number(body.priority) || 100)),
            weight: Math.max(0.1, Number(body.weight) || 1),
            enabled: body.enabled !== false,
            quota_rpm: nullablePositive(body?.limits?.rpm),
            quota_tpm: nullablePositive(body?.limits?.tpm),
            quota_rpd: nullablePositive(body?.limits?.rpd),
            quota_tpd: nullablePositive(body?.limits?.tpd),
            max_concurrency: nullablePositive(body?.limits?.maxConcurrency),
            timeout_ms: nullablePositive(body?.limits?.timeoutMs),
            max_queue_ms: nullablePositive(body?.limits?.maxQueueMs),
            input_cost_per_million: nullableDecimal(body.inputCostPerMillion),
            output_cost_per_million: nullableDecimal(body.outputCostPerMillion),
            secret_ciphertext: encrypted.ciphertext,
            secret_iv: encrypted.iv,
            secret_tag: encrypted.tag,
            updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from("ai_provider_credentials").upsert(row);
        let compatibilityStorage = false;
        if (error) {
            if (!credentialTableMissing(error)) throw error;
            const rows = await loadFallbackCredentialRows();
            const existingIndex = rows.findIndex((item: any) => String(item?.id || "") === id);
            if (existingIndex >= 0) rows[existingIndex] = row;
            else rows.push(row);
            await saveFallbackCredentialRows(rows);
            compatibilityStorage = true;
        }
        return NextResponse.json({ ok: true, id, compatibilityStorage, masked: `${secret.slice(0, 6)}…${secret.slice(-4)}` });
    } catch (error: any) {
        const status = /ENCRYPTION_KEY|credential_secret/i.test(String(error?.message || "")) ? 503 : 500;
        return NextResponse.json({ error: error?.message || "erro" }, { status });
    }
}

// Testa uma credencial salva sem nunca devolver seu segredo. É PATCH para não
// conflitar com o POST, que cadastra uma nova credencial.
export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const id = cleanText(body.id || req.nextUrl.searchParams.get("id"), 120);
        if (!id) return NextResponse.json({ error: "credential_id_obrigatorio" }, { status: 400 });
        const credential = (await loadAiCredentials(await loadLegacySettings()))
            .find((item) => item.id === id && ACTIVE_ROUTER_PROVIDERS.has(item.provider));
        if (!credential) return NextResponse.json({ error: "credential_not_found_or_disabled" }, { status: 404 });
        const result = await testCredential(credential);
        return NextResponse.json(result);
    } catch (error: any) {
        const status = /AbortError|aborted|timeout/i.test(String(error?.name || error?.message || "")) ? 504 : 400;
        return NextResponse.json({ ok: false, error: safeProviderError(error?.message || error) }, { status });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const id = cleanText(body.id || req.nextUrl.searchParams.get("id"), 120);
        if (!id) return NextResponse.json({ error: "credential_id_obrigatorio" }, { status: 400 });
        // Remoção recuperável: desabilita o registro em vez de apagar o segredo.
        const { data, error } = await supabase
            .from("ai_provider_credentials")
            .update({ enabled: false, updated_at: new Date().toISOString() })
            .eq("id", id)
            .select("id")
            .maybeSingle();
        if (error && !credentialTableMissing(error)) throw error;
        let fallbackDisabled = false;
        const rows = await loadFallbackCredentialRows();
        const fallbackIndex = rows.findIndex((item: any) => String(item?.id || "") === id);
        if (fallbackIndex >= 0) {
            rows[fallbackIndex] = { ...rows[fallbackIndex], enabled: false, updated_at: new Date().toISOString() };
            await saveFallbackCredentialRows(rows);
            fallbackDisabled = true;
        }
        if (!data && !fallbackDisabled) return NextResponse.json({ error: "credential_not_found" }, { status: 404 });
        return NextResponse.json({ ok: true, id, disabled: true });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "erro" }, { status: 500 });
    }
}
