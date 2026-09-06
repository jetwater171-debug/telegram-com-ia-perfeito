import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
} from "node:crypto";
import { supabaseServer as supabase } from "@/lib/supabaseServer";

export const AI_CREDENTIAL_PROVIDERS = [
    "bai",
    "gemini",
    "groq",
    "nvidia",
    "cloudflare",
    "mistral",
    "openrouter",
    "cerebras",
    "custom",
] as const;

export type AiCredentialProvider = (typeof AI_CREDENTIAL_PROVIDERS)[number];

export type AiCredentialLimits = Partial<{
    rpm: number;
    tpm: number;
    rpd: number;
    tpd: number;
    maxConcurrency: number;
    timeoutMs: number;
    maxQueueMs: number;
}>;

export type AiCredential = {
    id: string;
    provider: AiCredentialProvider;
    apiKey: string;
    label: string;
    source: "database" | "environment" | "legacy";
    projectId?: string;
    accountId?: string;
    quotaGroupId: string;
    baseUrl?: string;
    model?: string;
    enabled: boolean;
    priority: number;
    weight: number;
    limits: AiCredentialLimits;
    inputCostPerMillion?: number;
    outputCostPerMillion?: number;
};

export const AI_CREDENTIALS_FALLBACK_SETTING = "ai_credentials_encrypted_json_v1";

type EncryptedSecret = {
    ciphertext: string;
    iv: string;
    tag: string;
};

const PROVIDER_ENV_PREFIX: Record<AiCredentialProvider, string> = {
    bai: "BAI",
    gemini: "GEMINI",
    groq: "GROQ",
    nvidia: "NVIDIA",
    cloudflare: "CLOUDFLARE_AI",
    mistral: "MISTRAL",
    openrouter: "OPENROUTER",
    cerebras: "CEREBRAS",
    custom: "AI_CUSTOM_GATEWAY",
};

const LEGACY_SETTING_KEY: Record<AiCredentialProvider, string> = {
    bai: "bai_api_key",
    gemini: "gemini_api_key",
    groq: "groq_api_key",
    nvidia: "nvidia_api_key",
    cloudflare: "cloudflare_ai_api_token",
    mistral: "mistral_api_key",
    openrouter: "openrouter_api_key",
    cerebras: "cerebras_api_key",
    custom: "ai_custom_gateway_api_key",
};

const cleanSecret = (value: unknown) => {
    const secret = String(value || "").trim();
    if (!secret
        || secret.startsWith("YOUR_")
        || secret.includes("********")
        || /^(?:placeholder|change_?me|replace_?me|example|test)$/i.test(secret)) return "";
    return secret;
};

const cleanText = (value: unknown, max = 500) => String(value || "").trim().slice(0, max);

const positiveNumber = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export const fingerprintAiCredential = (secret: string) =>
    createHash("sha256").update(secret).digest("hex").slice(0, 16);

const encryptionKey = () => {
    // Chave dedicada é preferida. Em instalações antigas, a service-role já é
    // um segredo exclusivo do servidor e mantém o cofre funcional sem guardar
    // nenhuma API key em texto puro. Definir a chave dedicada desacopla futuras
    // rotações da credencial do banco.
    const configured = cleanSecret(process.env.AI_CREDENTIALS_ENCRYPTION_KEY)
        || cleanSecret(process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!configured) return null;
    return createHash("sha256").update(configured).digest();
};

export const isAiCredentialEncryptionReady = () => Boolean(encryptionKey());

export const encryptAiCredentialSecret = (secretValue: string): EncryptedSecret => {
    const secret = cleanSecret(secretValue);
    const key = encryptionKey();
    if (!secret) throw new Error("credential_secret_required");
    if (!key) throw new Error("AI_CREDENTIALS_ENCRYPTION_KEY_not_configured");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return {
        ciphertext: ciphertext.toString("base64"),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
    };
};

const decryptAiCredentialSecret = (row: any) => {
    const key = encryptionKey();
    if (!key) return "";
    try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(String(row.secret_iv || ""), "base64"));
        decipher.setAuthTag(Buffer.from(String(row.secret_tag || ""), "base64"));
        return cleanSecret(Buffer.concat([
            decipher.update(Buffer.from(String(row.secret_ciphertext || ""), "base64")),
            decipher.final(),
        ]).toString("utf8"));
    } catch {
        return "";
    }
};

const normalizeProvider = (value: unknown): AiCredentialProvider | null => {
    const provider = cleanText(value, 30).toLowerCase() as AiCredentialProvider;
    return AI_CREDENTIAL_PROVIDERS.includes(provider) ? provider : null;
};

const quotaGroup = (
    provider: AiCredentialProvider,
    projectId: string,
    accountId: string,
    explicitQuotaGroupId: string,
    id: string,
) => {
    if (provider === "gemini") {
        // Quotas do Gemini são por projeto. Sem projectId, todas as chaves ficam
        // no mesmo bucket conservador para nunca multiplicar quota por acidente.
        return `gemini:project:${projectId || "unassigned"}`;
    }
    // NVIDIA e B.AI podem ter várias chaves da mesma conta. Nessas situações
    // accountId/quotaGroupId fazem as chaves dividirem o mesmo orçamento, sem
    // misturar contas diferentes. Uma chave sem identificação continua isolada
    // por compatibilidade com a configuração antiga.
    const providerPrefix = `${provider}:`;
    if (explicitQuotaGroupId) {
        return explicitQuotaGroupId.startsWith(providerPrefix)
            ? explicitQuotaGroupId
            : `${provider}:group:${explicitQuotaGroupId}`;
    }
    if (accountId) return `${provider}:account:${accountId}`;
    return `${provider}:credential:${id}`;
};

const normalizeCredential = ({
    raw,
    provider: forcedProvider,
    source,
    index,
}: {
    raw: any;
    provider?: AiCredentialProvider;
    source: AiCredential["source"];
    index: number;
}): AiCredential | null => {
    const provider = forcedProvider || normalizeProvider(raw?.provider);
    if (!provider) return null;
    const apiKey = cleanSecret(typeof raw === "string" ? raw : raw?.apiKey || raw?.api_key || raw?.key || raw?.secret);
    if (!apiKey) return null;
    const fingerprint = fingerprintAiCredential(apiKey);
    const id = cleanText(raw?.id, 120) || `${provider}-${source}-${fingerprint}`;
    const projectId = cleanText(raw?.projectId || raw?.project_id || raw?.quotaProjectId, 180);
    const accountId = cleanText(raw?.accountId || raw?.account_id, 180);
    const explicitQuotaGroupId = cleanText(raw?.quotaGroupId || raw?.quota_group_id, 180)
        .replace(/[^a-zA-Z0-9:_./-]/g, "-");
    const limitsSource = raw?.limits && typeof raw.limits === "object" ? raw.limits : raw || {};
    const limits: AiCredentialLimits = {};
    for (const key of ["rpm", "tpm", "rpd", "tpd", "maxConcurrency", "timeoutMs", "maxQueueMs"] as const) {
        const value = positiveNumber(limitsSource[key] ?? limitsSource[key.replace(/[A-Z]/g, (letter: string) => `_${letter.toLowerCase()}`)]);
        if (value !== undefined) limits[key] = value;
    }
    return {
        id,
        provider,
        apiKey,
        label: cleanText(raw?.label, 160) || `${provider} ${index + 1} · ${fingerprint.slice(-6)}`,
        source,
        projectId: projectId || undefined,
        accountId: accountId || undefined,
        quotaGroupId: quotaGroup(provider, projectId, accountId, explicitQuotaGroupId, id),
        baseUrl: cleanText(raw?.baseUrl || raw?.base_url, 1000) || undefined,
        model: cleanText(raw?.model, 300) || undefined,
        enabled: raw?.enabled !== false,
        priority: Math.max(0, Math.floor(positiveNumber(raw?.priority) ?? 100)),
        weight: Math.max(0.1, positiveNumber(raw?.weight) ?? 1),
        limits,
        inputCostPerMillion: positiveNumber(raw?.inputCostPerMillion || raw?.input_cost_per_million),
        outputCostPerMillion: positiveNumber(raw?.outputCostPerMillion || raw?.output_cost_per_million),
    };
};

const parseJsonArray = (value: unknown): any[] => {
    const text = String(value || "").trim();
    if (!text) return [] as any[];
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.credentials)) return parsed.credentials;
    } catch {
        return [];
    }
    return [];
};

const environmentCredentials = () => {
    const credentials: AiCredential[] = [];
    const add = (raw: any, provider: AiCredentialProvider | undefined, index: number) => {
        const normalized = normalizeCredential({ raw, provider, source: "environment", index });
        if (normalized?.enabled) credentials.push(normalized);
    };

    parseJsonArray(process.env.AI_CREDENTIALS_JSON).forEach((raw, index) => add(raw, undefined, index));
    for (const provider of AI_CREDENTIAL_PROVIDERS) {
        const prefix = PROVIDER_ENV_PREFIX[provider];
        const projectId = cleanText(process.env[`${prefix}_PROJECT_ID`], 180);
        const accountId = cleanText(process.env[`${prefix}_ACCOUNT_ID`], 180);
        const quotaGroupId = cleanText(process.env[`${prefix}_QUOTA_GROUP_ID`], 180);
        parseJsonArray(process.env[`AI_${provider.toUpperCase()}_CREDENTIALS_JSON`] || process.env[`${prefix}_CREDENTIALS_JSON`])
            .forEach((raw, index) => add(typeof raw === "string"
                ? { apiKey: raw, projectId, accountId, quotaGroupId }
                : { projectId, accountId, quotaGroupId, ...raw }, provider, index));
        String(process.env[`${prefix}_API_KEYS`] || "")
            .split(/[\r\n,;]+/)
            .map(cleanSecret)
            .filter(Boolean)
            .forEach((apiKey, index) => add({ apiKey, projectId, accountId, quotaGroupId }, provider, index));
    }
    return credentials;
};

const databaseCredentials = async () => {
    const rows: any[] = [];
    let from = 0;
    const pageSize = 1000;
    const legacyColumns = "id,provider,label,project_id,base_url,model,priority,weight,enabled,quota_rpm,quota_tpm,quota_rpd,quota_tpd,max_concurrency,timeout_ms,max_queue_ms,input_cost_per_million,output_cost_per_million,secret_ciphertext,secret_iv,secret_tag";
    while (true) {
        const primaryResult = await supabase
            .from("ai_provider_credentials")
            .select("id,provider,label,project_id,account_id,quota_group_id,base_url,model,priority,weight,enabled,quota_rpm,quota_tpm,quota_rpd,quota_tpd,max_concurrency,timeout_ms,max_queue_ms,input_cost_per_million,output_cost_per_million,secret_ciphertext,secret_iv,secret_tag")
            .eq("enabled", true)
            .range(from, from + pageSize - 1);
        let data: any[] | null = primaryResult.data as any[] | null;
        let error: any = primaryResult.error;
        if (error && /account_id|quota_group_id/i.test(String(error.message || ""))) {
            const legacyResult = await supabase
                .from("ai_provider_credentials")
                .select(legacyColumns)
                .eq("enabled", true)
                .range(from, from + pageSize - 1);
            data = legacyResult.data as any[] | null;
            error = legacyResult.error;
        }
        if (error) {
            const message = String(error.message || "");
            if (/ai_provider_credentials|schema cache|does not exist/i.test(message)) break;
            throw error;
        }
        rows.push(...(data || []));
        if (!data || data.length < pageSize) break;
        from += pageSize;
    }
    const { data: fallbackSetting, error: fallbackError } = await supabase
        .from("bot_settings")
        .select("value")
        .eq("key", AI_CREDENTIALS_FALLBACK_SETTING)
        .maybeSingle();
    if (!fallbackError) {
        try {
            const fallbackRows = JSON.parse(String(fallbackSetting?.value || "[]"));
            if (Array.isArray(fallbackRows)) rows.push(...fallbackRows);
        } catch {
            console.warn("[AI Credentials] fallback criptografado invalido; ignorando");
        }
    }
    return rows.map((row, index) => {
        const apiKey = decryptAiCredentialSecret(row);
        if (!apiKey) return null;
        return normalizeCredential({
            raw: {
                id: row.id,
                provider: row.provider,
                apiKey,
                label: row.label,
                projectId: row.project_id,
                accountId: row.account_id,
                quotaGroupId: row.quota_group_id,
                baseUrl: row.base_url,
                model: row.model,
                priority: row.priority,
                weight: row.weight,
                enabled: row.enabled,
                limits: {
                    rpm: row.quota_rpm,
                    tpm: row.quota_tpm,
                    rpd: row.quota_rpd,
                    tpd: row.quota_tpd,
                    maxConcurrency: row.max_concurrency,
                    timeoutMs: row.timeout_ms,
                    maxQueueMs: row.max_queue_ms,
                },
                inputCostPerMillion: row.input_cost_per_million,
                outputCostPerMillion: row.output_cost_per_million,
            },
            source: "database",
            index,
        });
    }).filter((item): item is AiCredential => Boolean(item));
};

export const loadAiCredentials = async (legacySettings: Record<string, string> = {}) => {
    const loaded = [...await databaseCredentials(), ...environmentCredentials()];
    for (const provider of AI_CREDENTIAL_PROVIDERS) {
        const settingSecret = cleanSecret(legacySettings[LEGACY_SETTING_KEY[provider]]);
        const prefix = PROVIDER_ENV_PREFIX[provider];
        const envSecret = cleanSecret(process.env[provider === "cloudflare" ? "CLOUDFLARE_AI_API_TOKEN" : `${prefix}_API_KEY`]);
        const apiKey = settingSecret || envSecret;
        if (!apiKey) continue;
        const projectId = cleanText(process.env[`${prefix}_PROJECT_ID`], 180);
        const accountId = cleanText(process.env[`${prefix}_ACCOUNT_ID`], 180);
        const quotaGroupId = cleanText(process.env[`${prefix}_QUOTA_GROUP_ID`], 180);
        const credential = normalizeCredential({
            raw: { apiKey, projectId, accountId, quotaGroupId, label: `${provider} legado` },
            provider,
            source: "legacy",
            index: 0,
        });
        if (credential) loaded.push(credential);
    }

    const seen = new Set<string>();
    return loaded
        .filter((credential) => credential.enabled)
        .sort((left, right) => left.priority - right.priority || right.weight - left.weight || left.id.localeCompare(right.id))
        .filter((credential) => {
            const duplicateKey = `${credential.provider}:${fingerprintAiCredential(credential.apiKey)}`;
            if (seen.has(duplicateKey)) return false;
            seen.add(duplicateKey);
            return true;
        });
};

export const maskAiCredential = (credential: Pick<AiCredential, "apiKey">) => {
    const secret = cleanSecret(credential.apiKey);
    return secret.length > 12 ? `${secret.slice(0, 6)}…${secret.slice(-4)}` : "********";
};
