import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
    insertMessageWithAiDebug,
    withAiDebugMessageIndex,
} from "../src/lib/aiDebug.ts";

const sampleDebug = {
    timestamp: "2026-08-20T00:00:00.000Z",
    run_id: "run-test",
    model: "model-test",
    system_prompt: "system prompt",
    user_prompt: "user prompt",
    raw_response: { messages: ["draft"] },
    final_response: { messages: ["final"] },
};

const successfulRows = [];
const successClient = {
    from(table) {
        assert.equal(table, "messages");
        return {
            async insert(row) {
                successfulRows.push(row);
                return { error: null };
            },
        };
    },
};

const successResult = await insertMessageWithAiDebug(
    successClient,
    { session_id: "session", sender: "bot", content: "oi" },
    sampleDebug,
);
assert.equal(successResult.storedDebug, true);
assert.equal(successfulRows.length, 1);
assert.deepEqual(successfulRows[0].ai_debug, sampleDebug);

const fallbackRows = [];
const fallbackClient = {
    from() {
        return {
            async insert(row) {
                fallbackRows.push(row);
                return fallbackRows.length === 1
                    ? { error: { message: "ai_debug unavailable" } }
                    : { error: null };
            },
        };
    },
};
const fallbackResult = await insertMessageWithAiDebug(
    fallbackClient,
    { session_id: "session", sender: "thought", content: "thought" },
    sampleDebug,
);
assert.equal(fallbackResult.storedDebug, false);
assert.equal(fallbackRows.length, 2);
assert.ok("ai_debug" in fallbackRows[0]);
assert.ok(!("ai_debug" in fallbackRows[1]));

const indexed = withAiDebugMessageIndex(sampleDebug, 2);
assert.equal(indexed?.run_id, "run-test");
assert.equal(indexed?.message_index, 2);
assert.equal(sampleDebug.message_index, undefined);

const [routeSource, geminiSource, drawerSource, pageSource, migrationSource] = await Promise.all([
    readFile(new URL("../src/app/api/process-message/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/gemini.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/admin/chat/[id]/components/PromptInspectorDrawer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/admin/chat/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../ai_debug_migration.sql", import.meta.url), "utf8"),
]);

assert.match(routeSource, /insertGeneratedMessage\(\{/);
assert.match(routeSource, /withAiDebugMessageIndex\(aiResponse\.ai_debug/);
assert.match(geminiSource, /run_id:\s*crypto\.randomUUID\(\)/);
assert.match(geminiSource, /raw_response:\s*draftResult\.data/);
assert.match(geminiSource, /final_response:\s*\{/);
assert.match(drawerSource, /Resposta final enviada/);
assert.match(drawerSource, /Retorno bruto do rascunho/);
assert.match(pageSource, /setShowAdvancedView\(\(current\) => !current\)/);
assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS ai_debug JSONB/i);

console.log("ADVANCED_VIEW_VERIFICATION PASS: debug persisted on generated messages; fallback preserved; raw and final JSON separated; inspector wired");
