export type WorkerFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type WorkerTriggerResult = {
    attempts: number;
    status?: number;
    retried: boolean;
    retryable: boolean;
    uncertain?: boolean;
};

const waitBeforeWorkerRetry = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Dispara o worker no máximo três vezes. Repetimos apenas quando o próprio
 * worker confirma que ainda não houve efeito externo: falha 503 retryable ou
 * sessão ocupada 409. Falhas de rede ficam inconclusivas e não autorizam nova
 * chamada, evitando balões e PIX duplicados.
 */
export const triggerProcessMessageWithRetry = async ({
    workerUrl,
    sessionId,
    triggerMessageId,
    fetchImpl = fetch,
    sleepImpl = waitBeforeWorkerRetry,
}: {
    workerUrl: string;
    sessionId: string;
    triggerMessageId: string;
    fetchImpl?: WorkerFetch;
    sleepImpl?: (ms: number) => Promise<void>;
}): Promise<WorkerTriggerResult> => {
    let attempts = 0;

    const maxAttempts = 3;
    while (attempts < maxAttempts) {
        attempts += 1;
        let workerResponse: Response;
        try {
            workerResponse = await fetchImpl(workerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, triggerMessageId }),
            });
        } catch (error: any) {
            console.error('[WEBHOOK] Worker trigger failed; sem retry seguro:', error?.message || error);
            return { attempts, retried: attempts > 1, retryable: false, uncertain: true };
        }

        let workerBody = '';
        let parsedBody: any = null;
        try {
            workerBody = await workerResponse.text();
            parsedBody = JSON.parse(workerBody);
        } catch {
            // Corpo ausente/inválido não prova que a falha aconteceu antes dos efeitos.
        }

        const retryableBeforeEffects = workerResponse.status === 503
            && parsedBody !== null
            && typeof parsedBody === 'object'
            && parsedBody.retryable === true;
        const sessionBusy = workerResponse.status === 409
            && parsedBody !== null
            && typeof parsedBody === 'object'
            && parsedBody.error === 'session_busy'
            && parsedBody.retryable === true;

        if ((retryableBeforeEffects || sessionBusy) && attempts < maxAttempts) {
            console.warn(`[WEBHOOK] Worker ${sessionBusy ? 'ocupado' : 'indisponível antes da entrega'}; nova tentativa em 1s.`);
            await sleepImpl(1_000);
            continue;
        }

        if (!workerResponse.ok) {
            console.error(`[WEBHOOK] Worker respondeu ${workerResponse.status}: ${workerBody.slice(0, 800)}`);
        } else {
            console.log(`[WEBHOOK] Worker concluido ${workerResponse.status}: ${workerBody.slice(0, 400)}`);
        }

        return {
            attempts,
            status: workerResponse.status,
            retried: attempts > 1,
            retryable: retryableBeforeEffects || sessionBusy,
        };
    }

    return { attempts, retried: true, retryable: false };
};
