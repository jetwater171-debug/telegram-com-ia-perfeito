const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');

const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
const loadPureTypeScriptModule = (relativePath) => {
    const filename = path.resolve(process.cwd(), relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        fileName: filename,
    }).outputText;
    const loadedModule = { exports: {} };
    new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(require, loadedModule, loadedModule.exports, filename, path.dirname(filename));
    return loadedModule.exports;
};

(async () => {
    const models = read('src/lib/aiModels.ts');
    const gateway = read('src/lib/gemini.ts');
    const worker = read('src/app/api/process-message/route.ts');
    const webhook = read('src/app/api/telegram/route.ts');
    const vision = read('src/lib/previewVision.ts');

    assert.match(models, /DEFAULT_GEMINI_MODEL = "gemini-3\.8-flash"/);
    assert.match(models, /DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3\.7-flash"/);
    assert.match(models, /\^gemini-\(\?:1\|2\)\\\./);
    assert.match(models, /"llama-3\.1-8b-instant": DEFAULT_GROQ_STARTER_MODEL/);
    assert.match(models, /deepseek\/deepseek-v4-flash-0731/);
    assert.match(gateway, /response_format/);
    assert.match(gateway, /require_parameters: true/);
    assert.match(gateway, /normalizeAiMessageList\(jsonResponse\.messages\)/);
    assert.match(worker, /normalizeAiMessageList\(aiResponse\.messages\)/);
    assert.match(worker, /Falha recuperavel na sessao/);
    assert.match(worker, /ai_response_unavailable/);
    assert.match(worker, /canned_reply_sent: false/);
    assert.match(worker, /sendTelegramMessageStrict/);
    assert.match(worker, /insertMessageWithAiDebug\(supabase/);
    assert.doesNotMatch(worker, /oii, me fala mais disso/);
    assert.match(webhook, /triggerProcessMessageWithRetry/);
    assert.match(vision, /google\/gemini-3\.8-flash/);
    assert.doesNotMatch(vision, /qwen\/qwen-2\.5-vl-72b-instruct/);

    const normalizerUrl = pathToFileURL(path.join(process.cwd(), 'src/lib/aiMessageNormalization.ts')).href;
    const { extractAiMessageText, normalizeAiMessageList } = await import(normalizerUrl);
    assert.equal(extractAiMessageText({ text: '  oii  ' }), 'oii');
    assert.deepEqual(
        normalizeAiMessageList([' uma ', { content: 'duas' }, [{ message: 'tres' }], { nope: 'ignorar' }]),
        ['uma', 'duas', 'tres'],
    );
    assert.doesNotThrow(() => normalizeAiMessageList([{ action: 'none' }]));

    assert.match(worker, /const receivedStartCommand = Boolean\(conversationStartAt\)/);
    assert.match(worker, /const isConversationStart = receivedStartCommand && !lastBotMsg/);
    assert.match(worker, /RETOMADA DE CONVERSA/);
    assert.doesNotMatch(worker, /const isReturningGreeting = Boolean\(lastBotMsg\)/);
    assert.doesNotMatch(worker, /isFirstContact: \/\^\\\/start/);

    console.log('AI_PRODUCTION_RECOVERY_OK normalize=1 no_canned_reply=1 retryable_worker=1 debug=1 structured_json=1 models=1 webhook=1 vision=1');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
