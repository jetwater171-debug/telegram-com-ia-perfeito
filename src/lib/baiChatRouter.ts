import { BAI_TEXT_MODEL_ORDER, normalizeBaiModelName } from '@/lib/aiModels';

type FetchLike = typeof fetch;

export const resolveBaiTextModelOrder = (preferredModel?: string | null) => {
    // Normaliza configurações antigas, mas a fila é sempre o catálogo gratuito.
    // Isso evita que um valor legado volte a acionar um modelo pago como fallback.
    normalizeBaiModelName(preferredModel);
    return [...BAI_TEXT_MODEL_ORDER];
};

export const callBaiChatWithFallback = async <T>({
    apiKey,
    baseUrl,
    preferredModel,
    buildBody,
    parseResponse,
    fetcher = fetch,
    timeoutMs = 8_000,
    totalTimeoutMs = 18_000,
}: {
    apiKey: string;
    baseUrl: string;
    preferredModel?: string | null;
    buildBody: (model: string) => Record<string, unknown>;
    parseResponse: (responseText: string, model: string) => T;
    fetcher?: FetchLike;
    timeoutMs?: number;
    totalTimeoutMs?: number;
}): Promise<{ data: T; model: string; attempts: string[] }> => {
    const models = resolveBaiTextModelOrder(preferredModel);
    const attempts: string[] = [];
    const deadline = Date.now() + Math.max(3_000, totalTimeoutMs);
    let lastError: Error | null = null;

    for (const model of models) {
        const remainingMs = deadline - Date.now();
        if (remainingMs < 750) break;

        try {
            const response = await fetcher(`${String(baseUrl || 'https://api.b.ai/v1').replace(/\/$/, '')}/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${String(apiKey || '').trim()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildBody(model)),
                signal: AbortSignal.timeout(Math.min(Math.max(1_000, timeoutMs), remainingMs)),
            });
            const responseText = await response.text();
            if (!response.ok) {
                const error = Object.assign(
                    new Error(`B.AI ${model} ${response.status}: ${responseText.slice(0, 300)}`),
                    { status: response.status },
                );
                attempts.push(error.message);
                if (response.status === 401 || response.status === 403) throw error;
                lastError = error;
                continue;
            }

            try {
                return { data: parseResponse(responseText, model), model, attempts };
            } catch (parseError: any) {
                lastError = new Error(`B.AI ${model} retornou resposta invalida: ${parseError?.message || parseError}`);
                attempts.push(lastError.message);
            }
        } catch (error: any) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (!attempts.includes(lastError.message)) attempts.push(lastError.message);
            if (Number(error?.status) === 401 || Number(error?.status) === 403) throw lastError;
        }
    }

    throw lastError || new Error(`Todos os modelos B.AI falharam: ${attempts.join(' | ')}`);
};
