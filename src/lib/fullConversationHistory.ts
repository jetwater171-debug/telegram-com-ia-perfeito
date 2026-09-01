import type { SupabaseClient } from '@supabase/supabase-js';

export type ConversationSender = 'user' | 'bot';

export type ConversationHistoryRow = {
    id: string | number;
    sender: string;
    content?: unknown;
    created_at?: unknown;
    media_type?: unknown;
};

export type FullConversationMessage = {
    id: string;
    sender: ConversationSender;
    role: 'user' | 'model';
    text: string;
    createdAt: string;
    mediaContext?: string;
};

export type GeminiConversationHistoryEntry = {
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
};

export type ProviderConversationHistoryEntry = {
    role: 'user' | 'assistant';
    content: string;
};

export type FullConversationHistoryDiagnostics = {
    snapshotThroughCreatedAt: string;
    sourceMessageCount: number;
    includedMessageCount: number;
    excludedCurrentTurnCount: number;
    chars: number;
    pagesFetched: number;
    rowsFetched: number;
    rowsIncluded: number;
    rowsExcludedAsCurrentTurn: number;
    rowsIgnoredForSender: number;
    rowsIgnoredWithoutText: number;
    rowsIgnoredAfterSnapshot: number;
    rowsWithInvalidCreatedAt: number;
    firstCreatedAt: string | null;
    lastCreatedAt: string | null;
};

export type FullConversationHistoryResult = {
    messages: FullConversationMessage[];
    diagnostics: FullConversationHistoryDiagnostics;
};

export type FullConversationHistorySupabase = Pick<SupabaseClient, 'from'>;

export type LoadFullConversationHistoryOptions = {
    supabase: FullConversationHistorySupabase;
    sessionId: string;
    throughCreatedAt?: string | Date;
    pageSize?: number;
    currentTurnMessageIds?: ReadonlyArray<string | number>;
};

export type ConversationHistoryWindowOptions = {
    maxMessages: number;
    maxChars: number;
};

const MAX_PAGE_SIZE = 1_000;
const DEFAULT_PAGE_SIZE = 500;

const toSnapshotIso = (value?: string | Date) => {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : new Date().toISOString();
    const raw = String(value || '').trim();
    return Number.isFinite(Date.parse(raw)) ? raw : new Date().toISOString();
};

const compareIds = (left: string, right: string) => {
    if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
        try {
            const a = BigInt(left);
            const b = BigInt(right);
            return a < b ? -1 : a > b ? 1 : 0;
        } catch {
            // Fall through for values outside the runtime's BigInt support.
        }
    }
    return left < right ? -1 : left > right ? 1 : 0;
};

const fractionalPart = (value: string) => value.match(/T\d{2}:\d{2}:\d{2}\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/)?.[1] || '';

const compareTimestamps = (left: string, right: string): number | null => {
    const leftTime = Date.parse(left);
    const rightTime = Date.parse(right);
    if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return null;
    if (leftTime !== rightTime) return leftTime - rightTime;
    const leftFraction = fractionalPart(left).padEnd(12, '0');
    const rightFraction = fractionalPart(right).padEnd(12, '0');
    return leftFraction < rightFraction ? -1 : leftFraction > rightFraction ? 1 : 0;
};

const compareRows = (left: ConversationHistoryRow, right: ConversationHistoryRow) => {
    const timestampOrder = compareTimestamps(String(left.created_at || ''), String(right.created_at || ''));
    if (timestampOrder !== null && timestampOrder !== 0) {
        return timestampOrder;
    }
    if (timestampOrder !== null) return compareIds(String(left.id), String(right.id));
    const leftValid = Number.isFinite(Date.parse(String(left.created_at || '')));
    const rightValid = Number.isFinite(Date.parse(String(right.created_at || '')));
    if (leftValid !== rightValid) return leftValid ? -1 : 1;
    return compareIds(String(left.id), String(right.id));
};

const MEDIA_MARKER = /\[(?:PHOTO_UPLOAD|VIDEO_UPLOAD|AUDIO_UUID|M[IÍ]DIA(?:\s+PROTEGIDA)?)[^\]]*\]/giu;
const FILE_ID = /\b(?:file[_ -]?id|fileId)\s*:\s*[^\s,\]|]+/giu;
// URLs comuns fazem parte da fala e devem permanecer. Só removemos URLs de
// transporte do Telegram/Bot API, que carregam caminhos ou tokens internos.
const TELEGRAM_TRANSPORT_URL = /\bhttps?:\/\/(?:api\.telegram\.org|telegram\.org)\/(?:file\/)?bot[^\s<>"']+/giu;
const BASE64_DATA_URI = /data:[^\s;,]+;base64,[A-Za-z0-9+/=]+/gu;
// A plain long word can be legitimate conversation text. Only strip opaque
// long tokens when they also contain base64-specific punctuation or padding.
const SUSPICIOUS_BASE64 = /\b(?=[A-Za-z0-9+/=]{160,}\b)(?=[A-Za-z0-9+/=]*[+/=])[A-Za-z0-9+/=]{160,}\b/gu;

const mediaLabel = (value: unknown) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    if (normalized.includes('audio') || normalized.includes('voice') || normalized.includes('ogg')) return 'áudio';
    if (normalized.includes('video') || normalized.includes('mp4')) return 'vídeo';
    if (normalized.includes('photo') || normalized.includes('image') || normalized.includes('jpeg') || normalized.includes('png')) return 'foto';
    return 'mídia';
};

/**
 * Remove apenas transporte/infraestrutura da mensagem. O texto restante é
 * mantido, sem enviar URL, File ID, base64 ou colunas operacionais ao modelo.
 */
export const sanitizeConversationHistoryText = (value: unknown) => {
    let text = String(value ?? '').replace(/\r\n?/g, '\n').trim();
    if (!text) return '';
    text = text
        .replace(TELEGRAM_TRANSPORT_URL, '')
        .replace(BASE64_DATA_URI, '')
        .replace(SUSPICIOUS_BASE64, '')
        .replace(FILE_ID, '')
        .replace(/\bcaption\s*:\s*/giu, '')
        .replace(MEDIA_MARKER, (marker) => {
            const label = mediaLabel(marker);
            return label ? `[mídia enviada: ${label}]` : '[mídia enviada]';
        })
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return text;
};

const isSnapshotAfter = (createdAt: string, snapshotThroughCreatedAt: string) => {
    const comparison = compareTimestamps(createdAt, snapshotThroughCreatedAt);
    return comparison !== null && comparison > 0;
};

const toHistoryMessage = (row: ConversationHistoryRow): FullConversationMessage | null => {
    const sender = row.sender === 'bot' || row.sender === 'user' ? row.sender : null;
    if (!sender) return null;
    const text = sanitizeConversationHistoryText(row.content);
    const mediaContext = mediaLabel(row.media_type);
    if (!text && !mediaContext) return null;
    const visibleText = [text, mediaContext && !text.toLowerCase().includes(mediaContext) ? `[mídia: ${mediaContext}]` : '']
        .filter(Boolean)
        .join('\n');
    return {
        id: String(row.id),
        sender,
        role: sender === 'bot' ? 'model' : 'user',
        text: visibleText,
        createdAt: String(row.created_at || ''),
        ...(mediaContext ? { mediaContext } : {}),
    };
};

/**
 * Carrega todo o histórico user/bot até um snapshot estável. A paginação usa
 * created_at + id e nunca corta por quantidade, tamanho ou episódio.
 */
export const loadFullConversationHistory = async ({
    supabase,
    sessionId,
    throughCreatedAt,
    pageSize = DEFAULT_PAGE_SIZE,
    currentTurnMessageIds = [],
}: LoadFullConversationHistoryOptions): Promise<FullConversationHistoryResult> => {
    const snapshotThroughCreatedAt = toSnapshotIso(throughCreatedAt);
    const safePageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(Number(pageSize) || DEFAULT_PAGE_SIZE)));
    const currentIds = new Set(currentTurnMessageIds.map((id) => String(id)));
    const rows: ConversationHistoryRow[] = [];
    let pagesFetched = 0;
    let rowsFetched = 0;
    let expectedSourceCount: number | null = null;

    for (let offset = 0; ; ) {
        const query = supabase
            .from('messages')
            .select('id,sender,content,created_at,media_type', { count: 'exact' })
            .eq('session_id', sessionId)
            .in('sender', ['user', 'bot'])
            .lte('created_at', snapshotThroughCreatedAt)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(offset, offset + safePageSize - 1);
        const result = await query as unknown as {
            data?: ConversationHistoryRow[] | null;
            error?: unknown;
            count?: number | null;
        };
        if (result?.error) throw result.error;
        if (!Array.isArray(result?.data)) throw new Error('full conversation history: página sem dados');
        if (!Number.isInteger(result.count) || Number(result.count) < 0) {
            throw new Error('full conversation history: count exact indisponível');
        }
        if (expectedSourceCount === null) expectedSourceCount = Number(result.count);
        if (Number(result.count) !== expectedSourceCount) {
            throw new Error('full conversation history: count mudou durante o snapshot');
        }
        const page = result.data;
        pagesFetched += 1;
        rowsFetched += page.length;
        rows.push(...page);
        if (rows.length > expectedSourceCount) throw new Error('full conversation history: paginação excedeu count exact');
        if (rows.length === expectedSourceCount) break;
        if (page.length === 0) throw new Error('full conversation history: página vazia antes do count exact');
        offset += page.length;
    }

    const orderedRows = [...rows].sort(compareRows);
    let rowsExcludedAsCurrentTurn = 0;
    let rowsIgnoredForSender = 0;
    let rowsIgnoredWithoutText = 0;
    let rowsIgnoredAfterSnapshot = 0;
    let rowsWithInvalidCreatedAt = 0;
    const messages: FullConversationMessage[] = [];

    for (const row of orderedRows) {
        if (currentIds.has(String(row.id))) {
            rowsExcludedAsCurrentTurn += 1;
            continue;
        }
        if (row.sender !== 'user' && row.sender !== 'bot') {
            rowsIgnoredForSender += 1;
            continue;
        }
        const createdAt = String(row.created_at || '');
        if (!Number.isFinite(Date.parse(createdAt))) rowsWithInvalidCreatedAt += 1;
        if (isSnapshotAfter(createdAt, snapshotThroughCreatedAt)) {
            rowsIgnoredAfterSnapshot += 1;
            continue;
        }
        const message = toHistoryMessage(row);
        if (!message) {
            rowsIgnoredWithoutText += 1;
            continue;
        }
        messages.push(message);
    }

    return {
        messages,
        diagnostics: {
            snapshotThroughCreatedAt,
            sourceMessageCount: rowsFetched,
            includedMessageCount: messages.length,
            excludedCurrentTurnCount: rowsExcludedAsCurrentTurn,
            chars: messages.reduce((total, message) => total + message.text.length, 0),
            pagesFetched,
            rowsFetched,
            rowsIncluded: messages.length,
            rowsExcludedAsCurrentTurn,
            rowsIgnoredForSender,
            rowsIgnoredWithoutText,
            rowsIgnoredAfterSnapshot,
            rowsWithInvalidCreatedAt,
            firstCreatedAt: messages[0]?.createdAt || null,
            lastCreatedAt: messages.at(-1)?.createdAt || null,
        },
    };
};

/**
 * Seleciona a janela recente que vai ao modelo. A memória estruturada resume o
 * passado durável; repetir toda a sessão em cada turno só aumenta custo e ruído.
 */
export const selectRecentConversationHistory = (
    messages: FullConversationMessage[],
    { maxMessages, maxChars }: ConversationHistoryWindowOptions,
) => {
    const safeMessageLimit = Math.max(1, Math.floor(Number(maxMessages) || 1));
    const safeCharLimit = Math.max(500, Math.floor(Number(maxChars) || 500));
    const selected: FullConversationMessage[] = [];
    let chars = 0;

    for (let index = (messages || []).length - 1; index >= 0; index -= 1) {
        if (selected.length >= safeMessageLimit) break;
        const message = messages[index];
        const text = sanitizeConversationHistoryText(message?.text);
        if (!text) continue;
        const remaining = safeCharLimit - chars;
        if (remaining <= 0) break;
        if (text.length > remaining && selected.length > 0) break;
        const visibleText = text.length <= remaining ? text : text.slice(-remaining).trimStart();
        selected.push({ ...message, text: visibleText });
        chars += visibleText.length;
    }

    return selected.reverse();
};

/**
 * Converte o histórico completo para o formato Gemini. Falas consecutivas do
 * mesmo autor viram um único bloco, preservando cada fala com newline.
 */
export const buildGeminiConversationHistory = (
    messages: FullConversationMessage[],
): GeminiConversationHistoryEntry[] => {
    const history: GeminiConversationHistoryEntry[] = [];
    let previousUtcDay = '';
    for (const message of messages || []) {
        if (message.sender !== 'user' && message.sender !== 'bot') continue;
        const text = sanitizeConversationHistoryText(message.text);
        if (!text) continue;
        const role = message.sender === 'bot' ? 'model' : 'user';
        const utcDay = /^\d{4}-\d{2}-\d{2}/.test(message.createdAt)
            ? message.createdAt.slice(0, 10)
            : '';
        const dayMarker = utcDay && utcDay !== previousUtcDay ? `[dia UTC: ${utcDay}]\n` : '';
        if (utcDay) previousUtcDay = utcDay;
        const visibleText = `${dayMarker}${text}`;
        const previous = history.at(-1);
        if (previous?.role === role) {
            previous.parts[0].text = `${previous.parts[0].text}\n${visibleText}`;
        } else {
            history.push({ role, parts: [{ text: visibleText }] });
        }
    }
    return history;
};

/** Serializa o mesmo histórico integral para APIs compatíveis com OpenAI. */
export const buildProviderConversationHistory = (
    history: ReadonlyArray<{
        role?: string;
        content?: unknown;
        parts?: ReadonlyArray<{ text?: unknown }>;
    }>,
): ProviderConversationHistoryEntry[] => history.map((entry): ProviderConversationHistoryEntry => {
    const role: ProviderConversationHistoryEntry['role'] = entry.role === 'model' || entry.role === 'assistant'
        ? 'assistant'
        : 'user';
    return {
        role,
        content: typeof entry.content === 'string'
            ? entry.content
            : (entry.parts || []).map((part) => String(part?.text || '')).join('\n'),
    };
}).filter((entry) => entry.content.length > 0);
