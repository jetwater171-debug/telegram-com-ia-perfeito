const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

(async () => {
    const models = read('src/lib/aiModels.ts');
    const gateway = read('src/lib/gemini.ts');
    const worker = read('src/app/api/process-message/route.ts');
    const webhook = read('src/app/api/telegram/route.ts');
    const vision = read('src/lib/previewVision.ts');

    assert.match(models, /DEFAULT_GEMINI_MODEL = "gemini-3\.6-flash"/);
    assert.match(models, /"gemini-2\.5-flash": "gemini-3\.6-flash"/);
    assert.match(models, /"llama-3\.1-8b-instant": DEFAULT_GROQ_STARTER_MODEL/);
    assert.match(models, /deepseek\/deepseek-v4-flash-0731/);
    assert.match(gateway, /response_format/);
    assert.match(gateway, /require_parameters: true/);
    assert.match(gateway, /normalizeAiMessageList\(jsonResponse\.messages\)/);
    assert.match(worker, /normalizeAiMessageList\(aiResponse\.messages\)/);
    assert.match(worker, /Falha recuperavel na sessao/);
    assert.match(worker, /Recuperacao local enviada/);
    assert.match(webhook, /workerResponse\.ok/);
    assert.match(vision, /dots-studio\/dots-3-note-preview:free/);
    assert.doesNotMatch(vision, /qwen\/qwen-2\.5-vl-72b-instruct/);

    const normalizerUrl = pathToFileURL(path.join(process.cwd(), 'src/lib/aiMessageNormalization.ts')).href;
    const { extractAiMessageText, normalizeAiMessageList } = await import(normalizerUrl);
    assert.equal(extractAiMessageText({ text: '  oii  ' }), 'oii');
    assert.deepEqual(
        normalizeAiMessageList([' uma ', { content: 'duas' }, [{ message: 'tres' }], { nope: 'ignorar' }]),
        ['uma', 'duas', 'tres'],
    );
    assert.doesNotThrow(() => normalizeAiMessageList([{ action: 'none' }]));

    console.log('AI_PRODUCTION_RECOVERY_OK normalize=1 recovery=1 structured_json=1 models=1 webhook=1 vision=1');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
