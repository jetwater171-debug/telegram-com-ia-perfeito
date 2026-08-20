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

export async function insertMessageWithAiDebug(
    client: MessageInsertClient,
    row: Record<string, unknown>,
    aiDebug?: AiDebugData | null,
): Promise<AiDebugInsertResult> {
    const primaryRow = aiDebug ? { ...row, ai_debug: aiDebug } : row;
    const primary = await client.from("messages").insert(primaryRow);

    if (!primary.error) {
        return { storedDebug: Boolean(aiDebug), error: null, debugError: null };
    }

    if (!aiDebug) {
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
