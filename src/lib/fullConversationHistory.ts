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
    throughMessageId?: string;
    /** @deprecated Mantido para compatibilidade; a leitura agora e limitada. */
    pageSize?: number;
    sourceMessageLimit?: number;
    currentTurnMessageIds?: ReadonlyArray<string | number>;
};

export type ConversationHistoryWindowOptions = {
    maxMessages: number;
    maxChars: number;
};

export const MAX_CONVERSATION_SOURCE_MESSAGES = 80;
export const MAX_CONVERSATION_WINDOW_MESSAGES = 60;
export const MAX_CONVERSATION_WINDOW_CHARS = 8_000;

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
 * Carrega somente a cauda estável da conversa. O histórico completo não entra
 * mais no turno: fatos duráveis pertencem à memória estruturada/checkpoint.
 */
export const loadFullConversationHistory = async ({
    supabase,
    sessionId,
    throughCreatedAt,
    throughMessageId,
    sourceMessageLimit = MAX_CONVERSATION_SOURCE_MESSAGES,
    currentTurnMessageIds = [],
}: LoadFullConversationHistoryOptions): Promise<FullConversationHistoryResult> => {
    const snapshotThroughCreatedAt = toSnapshotIso(throughCreatedAt);
    const safeSourceLimit = Math.max(1, Math.min(
        MAX_CONVERSATION_SOURCE_MESSAGES,
        Math.floor(Number(sourceMessageLimit) || MAX_CONVERSATION_SOURCE_MESSAGES),
    ));
    const currentIds = new Set(currentTurnMessageIds.map((id) => String(id)));
    const result = await supabase
        .from('messages')
        .select('id,sender,content,created_at,media_type')
        .eq('session_id', sessionId)
        .in('sender', ['user', 'bot'])
        .lte('created_at', snapshotThroughCreatedAt)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(safeSourceLimit) as unknown as { data?: ConversationHistoryRow[] | null; error?: unknown };
    if (result?.error) throw result.error;
    if (!Array.isArray(result?.data)) throw new Error('conversation history: consulta sem dados');

    const orderedRows = [...result.data].sort(compareRows);
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
        if (isSnapshotAfter(createdAt, snapshotThroughCreatedAt)
            || (throughMessageId && compareTimestamps(createdAt, snapshotThroughCreatedAt) === 0
                && compareIds(String(row.id), throughMessageId) > 0)) {
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
            sourceMessageCount: orderedRows.length,
            includedMessageCount: messages.length,
            excludedCurrentTurnCount: rowsExcludedAsCurrentTurn,
            chars: messages.reduce((total, message) => total + message.text.length, 0),
            pagesFetched: 1,
            rowsFetched: orderedRows.length,
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
    const safeMessageLimit = Math.max(1, Math.min(
        MAX_CONVERSATION_WINDOW_MESSAGES,
        Math.floor(Number(maxMessages) || MAX_CONVERSATION_WINDOW_MESSAGES),
    ));
    const safeCharLimit = Math.max(500, Math.min(
        MAX_CONVERSATION_WINDOW_CHARS,
        Math.floor(Number(maxChars) || MAX_CONVERSATION_WINDOW_CHARS),
    ));
    const normalized = (messages || []).map((message) => ({
        ...message,
        text: sanitizeConversationHistoryText(message?.text),
    })).filter((message) => message.text);
    const turns: FullConversationMessage[][] = [];
    for (const message of normalized) {
        const current = turns.at(-1);
        if (current && current[0].sender === message.sender) current.push(message);
        else turns.push([message]);
    }

    const selectedTurns: FullConversationMessage[][] = [];
    let messageCount = 0;
    let chars = 0;
    for (let index = turns.length - 1; index >= 0; index -= 1) {
        const turn = turns[index];
        const turnChars = turn.reduce((total, message) => total + message.text.length, 0);
        if (messageCount + turn.length > safeMessageLimit || chars + turnChars > safeCharLimit) {
            // Um turno excepcionalmente longo não pode apagar todo o histórico.
            // Preserva a cauda mais recente e sinaliza explicitamente qualquer corte.
            if (selectedTurns.length === 0) {
                const tail: FullConversationMessage[] = [];
                let remaining = safeCharLimit;
                for (let item = turn.length - 1; item >= 0 && tail.length < safeMessageLimit && remaining > 0; item -= 1) {
                    const message = turn[item];
                    if (message.text.length <= remaining) {
                        tail.push(message);
                        remaining -= message.text.length;
                    } else {
                        const marker = '[trecho anterior omitido] ';
                        if (remaining > marker.length) {
                            tail.push({ ...message, text: marker + message.text.slice(-(remaining - marker.length)) });
                        }
                        break;
                    }
                }
                selectedTurns.push(tail.reverse());
            }
            break;
        }
        selectedTurns.push(turn);
        messageCount += turn.length;
        chars += turnChars;
    }
    return selectedTurns.reverse().flat();
};

const localBubbleStamp = (createdAt: string, timezone = 'America/Sao_Paulo'): string => {
    const parsed = new Date(createdAt);
    if (!Number.isFinite(parsed.getTime())) return '';
    try {
        const parts = new Intl.DateTimeFormat('pt-BR', {
            timeZone: timezone,
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(parsed);
        const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
        return `${value('day')}/${value('month')}/${value('year')} ${value('hour')}:${value('minute')}`;
    } catch {
        return timezone === 'America/Sao_Paulo' ? '' : localBubbleStamp(createdAt, 'America/Sao_Paulo');
    }
};

/** Formato legível e datado, comum a todos os provedores. */
export const formatConversationBubble = (message: FullConversationMessage, timezone = 'America/Sao_Paulo') => {
    const text = sanitizeConversationHistoryText(message.text);
    if (!text) return '';
    const stamp = localBubbleStamp(message.createdAt, timezone);
    const speaker = message.sender === 'bot' ? 'LARI' : 'LEAD';
    return `${stamp ? `[${stamp}] ` : ''}${speaker}: ${text}`;
};

/**
 * Converte o histórico completo para o formato Gemini. Falas consecutivas do
 * mesmo autor viram um único bloco, preservando cada fala com newline.
 */
export const buildGeminiConversationHistory = (
    messages: FullConversationMessage[],
    timezone = 'America/Sao_Paulo',
): GeminiConversationHistoryEntry[] => {
    const history: GeminiConversationHistoryEntry[] = [];
    for (const message of messages || []) {
        if (message.sender !== 'user' && message.sender !== 'bot') continue;
        const text = formatConversationBubble(message, timezone);
        if (!text) continue;
        const role = message.sender === 'bot' ? 'model' : 'user';
        const previous = history.at(-1);
        if (previous?.role === role) {
            previous.parts[0].text = `${previous.parts[0].text}\n${text}`;
        } else {
            history.push({ role, parts: [{ text }] });
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
