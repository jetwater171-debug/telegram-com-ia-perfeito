export class AdminApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'AdminApiError';
        this.status = status;
    }
}

const parseResponse = async (response: Response) => {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return response.json().catch(() => ({}));
    const body = await response.text().catch(() => '');
    return body ? { message: body } : {};
};

export async function adminFetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
    const response = await fetch(input, { cache: 'no-store', ...init });
    const data = await parseResponse(response) as Record<string, unknown>;

    if (response.status === 401 && typeof window !== 'undefined') {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/admin/login?next=${encodeURIComponent(next)}`);
        throw new AdminApiError('Sua sessão expirou. Entre novamente.', 401);
    }

    if (!response.ok || data?.error) {
        throw new AdminApiError(String(data?.error || data?.message || `Falha HTTP ${response.status}`), response.status);
    }
    return data as T;
}
