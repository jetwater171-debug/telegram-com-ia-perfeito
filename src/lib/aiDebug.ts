import type { AiDebugData } from "../types";

type InsertResult = {
    data?: unknown;
    error?: unknown;
};

type MessageInsertBuilder = {
    insert: (row: Record<string, unknown>) => PromiseLike<InsertResult>;
};

export type MessageInsertClient = {
    from: (table: "messages") => MessageInsertBuilder;
};

export type AiDebugInsertResult = {
    storedDebug: boolean;
    error: unknown | null;
    debugError: unknown | null;
};

/**
 * Produces a detached, JSON-safe snapshot for the prompt inspector.
 * Debug payloads must never retain the response object's own `ai_debug` field,
 * otherwise persisting the message can create a circular reference.
 */
export function toSerializableDebugValue<T>(value: T): T {
    const ancestors: object[] = [];

    const serialized = JSON.stringify(value, function (key, currentValue) {
        if (key === "ai_debug") return undefined;
        if (typeof currentValue === "bigint") return currentValue.toString();
        if (currentValue instanceof Error) {
            return {
                name: currentValue.name,
                message: currentValue.message,
                stack: currentValue.stack,
            };
        }

        if (!currentValue || typeof currentValue !== "object") return currentValue;

        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
            ancestors.pop();
        }
        if (ancestors.includes(currentValue)) return "[Circular]";
        ancestors.push(currentValue);
        return currentValue;
    });

    return (serialized === undefined ? null : JSON.parse(serialized)) as T;
}

export async function insertMessageWithAiDebug(
    client: MessageInsertClient,
    row: Record<string, unknown>,
    aiDebug?: AiDebugData | null,
): Promise<AiDebugInsertResult> {
    let safeDebug: AiDebugData | null = null;
    let debugSerializationError: unknown | null = null;

    if (aiDebug) {
        try {
            safeDebug = toSerializableDebugValue(aiDebug);
        } catch (error) {
            debugSerializationError = error;
        }
    }

    if (debugSerializationError) {
        const fallback = await client.from("messages").insert(row);
        return {
            storedDebug: false,
            error: fallback.error || null,
            debugError: debugSerializationError,
        };
    }

    const primaryRow = safeDebug ? { ...row, ai_debug: safeDebug } : row;
    let primary: InsertResult;
    try {
        primary = await client.from("messages").insert(primaryRow);
    } catch (error) {
        if (!safeDebug) throw error;

        const fallback = await client.from("messages").insert(row);
        return {
            storedDebug: false,
            error: fallback.error || null,
            debugError: error,
        };
    }

    if (!primary.error) {
        return { storedDebug: Boolean(safeDebug), error: null, debugError: null };
    }

    if (!safeDebug) {
        return { storedDebug: false, error: primary.error, debugError: null };
    }

    const fallback = await client.from("messages").insert(row);
    return {
        storedDebug: false,
        error: fallback.error || null,
        debugError: primary.error,
    };
}

export function withAiDebugMessageIndex(
    aiDebug: AiDebugData | null | undefined,
    messageIndex: number,
): AiDebugData | null {
    if (!aiDebug) return null;
    return { ...aiDebug, message_index: messageIndex };
}

export function errorMessage(error: unknown) {
    if (!error) return "";
    if (error instanceof Error) return error.message;
    if (typeof error === "object" && "message" in error) {
        return String((error as { message?: unknown }).message || error);
    }
    return String(error);
}
