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
    onAttempt,
    onSuccess,
    onFailure,
}: {
    apiKey: string;
    baseUrl: string;
    preferredModel?: string | null;
    buildBody: (model: string) => Record<string, unknown>;
    parseResponse: (responseText: string, model: string) => T;
    fetcher?: FetchLike;
    timeoutMs?: number;
    totalTimeoutMs?: number;
    onAttempt?: (model: string) => void;
    onSuccess?: (model: string, data: T, responseText: string, durationMs: number) => void;
    onFailure?: (model: string, error: Error, durationMs: number) => void;
}): Promise<{ data: T; model: string; attempts: string[] }> => {
    const models = resolveBaiTextModelOrder(preferredModel);
    const attempts: string[] = [];
    let lastError: Error | null = null;
    const totalController = new AbortController();
    const totalTimer = setTimeout(() => totalController.abort(), Math.max(3_000, totalTimeoutMs));
    const controllers = new Map<string, AbortController>();
    const tasks = models.map(async (model) => {
        const startedAt = Date.now();
        const controller = new AbortController();
        controllers.set(model, controller);
        onAttempt?.(model);
        try {
            const response = await fetcher(`${String(baseUrl || 'https://api.b.ai/v1').replace(/\/$/, '')}/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${String(apiKey || '').trim()}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildBody(model)),
                signal: AbortSignal.any([
                    controller.signal,
                    totalController.signal,
                    AbortSignal.timeout(Math.max(1_000, timeoutMs)),
                ]),
            });
            const responseText = await response.text();
            if (!response.ok) {
                const error = Object.assign(
                    new Error(`B.AI ${model} ${response.status}: ${responseText.slice(0, 300)}`),
                    { status: response.status },
                );
                attempts.push(error.message);
                lastError = error;
                onFailure?.(model, error, Date.now() - startedAt);
                throw error;
            }

            try {
                const data = parseResponse(responseText, model);
                onSuccess?.(model, data, responseText, Date.now() - startedAt);
                return { data, model };
            } catch (parseError: any) {
                lastError = new Error(`B.AI ${model} retornou resposta invalida: ${parseError?.message || parseError}`);
                attempts.push(lastError.message);
                onFailure?.(model, lastError, Date.now() - startedAt);
                throw lastError;
            }
        } catch (error: any) {
            const normalized = error instanceof Error ? error : new Error(String(error));
            const cancelledByWinner = controller.signal.aborted && !totalController.signal.aborted;
            if (!cancelledByWinner && normalized !== lastError) {
                lastError = normalized;
                if (!attempts.includes(normalized.message)) attempts.push(normalized.message);
                onFailure?.(model, normalized, Date.now() - startedAt);
            }
            throw normalized;
        }
    });

    try {
        const winner = await Promise.any(tasks);
        controllers.forEach((controller, model) => {
            if (model !== winner.model) controller.abort();
        });
        await Promise.allSettled(tasks);
        return { ...winner, attempts };
    } catch {
        await Promise.allSettled(tasks);
        const aggregate = new Error(`Todos os modelos B.AI falharam: ${attempts.join(' | ')}`);
        Object.assign(aggregate, { status: Number((lastError as any)?.status || 0) || undefined });
        throw aggregate;
    } finally {
        clearTimeout(totalTimer);
    }
};
