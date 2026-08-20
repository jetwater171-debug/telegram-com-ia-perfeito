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

    assert.match(models, /DEFAULT_GEMINI_MODEL = "gemini-3\.7-flash"/);
    assert.match(models, /DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3\.6-flash"/);
    assert.match(models, /"gemini-2\.5-flash": "gemini-3\.6-flash"/);
    assert.match(models, /"llama-3\.1-8b-instant": DEFAULT_GROQ_STARTER_MODEL/);
    assert.match(models, /deepseek\/deepseek-v4-flash-0731/);
    assert.match(gateway, /response_format/);
    assert.match(gateway, /require_parameters: true/);
    assert.match(gateway, /normalizeAiMessageList\(jsonResponse\.messages\)/);
    assert.match(worker, /normalizeAiMessageList\(aiResponse\.messages\)/);
    assert.match(worker, /Falha recuperavel na sessao/);
    assert.match(worker, /buildProcessingFailureRecoveryMessages/);
    assert.match(worker, /Recuperacao contextual enviada/);
    assert.match(worker, /contextual-local-recovery/);
    assert.match(worker, /insertMessageWithAiDebug\(supabase/);
    assert.doesNotMatch(worker, /oii, me fala mais disso/);
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

    const { buildProcessingFailureRecoveryMessages } = loadPureTypeScriptModule('src/lib/conversationQuality.ts');
    assert.deepEqual(
        buildProcessingFailureRecoveryMessages({
            userText: 'oi',
            recentBotTexts: [],
            recentUserTexts: ['oi'],
            isFirstContact: true,
        }),
        ['oiii, tudo bem?', 'como vc se chama?'],
    );
    assert.deepEqual(
        buildProcessingFailureRecoveryMessages({
            userText: '/start',
            recentBotTexts: [],
            recentUserTexts: ['/start'],
            isFirstContact: true,
        }),
        ['oiii, tudo bem?', 'como vc se chama?'],
    );
    const returningGreeting = buildProcessingFailureRecoveryMessages({
        userText: 'oi',
        recentBotTexts: ['oiii, tudo bem?'],
        recentUserTexts: ['oi'],
        isFirstContact: false,
    });
    assert.equal(returningGreeting.length, 1);
    assert.doesNotMatch(returningGreeting[0], /me fala mais disso/i);
    const returningStart = buildProcessingFailureRecoveryMessages({
        userText: '/start',
        recentBotTexts: ['a gente tava falando do seu dia'],
        recentUserTexts: ['/start', 'hoje foi corrido'],
        isFirstContact: false,
    });
    assert.equal(returningStart.length, 1);
    assert.doesNotMatch(returningStart.join(' '), /como vc se chama/i);

    const failedQuestion = buildProcessingFailureRecoveryMessages({
        userText: 'quanto custa o vip?',
        recentBotTexts: [],
        recentUserTexts: ['quanto custa o vip?'],
        isFirstContact: false,
    });
    assert.equal(failedQuestion.length, 2);
    assert.match(failedQuestion.join(' '), /travou/i);
    assert.match(failedQuestion.join(' '), /pergunta de novo/i);
    assert.doesNotMatch(failedQuestion.join(' '), /pix|pague|enviei|mandei/i);

    const repeatedFailure = buildProcessingFailureRecoveryMessages({
        userText: 'quanto custa o vip?',
        recentBotTexts: failedQuestion,
        recentUserTexts: ['quanto custa o vip?'],
        isFirstContact: false,
    });
    assert.equal(repeatedFailure.length, 2);
    assert.notDeepEqual(repeatedFailure, failedQuestion);

    assert.match(worker, /const receivedStartCommand = Boolean\(conversationStartAt\)/);
    assert.match(worker, /const isConversationStart = receivedStartCommand && !lastBotMsg/);
    assert.match(worker, /RETOMADA DE CONVERSA/);
    assert.match(worker, /const isReturningGreeting = Boolean\(lastBotMsg\)/);
    assert.doesNotMatch(worker, /isFirstContact: \/\^\\\/start/);

    console.log('AI_PRODUCTION_RECOVERY_OK normalize=1 contextual_recovery=1 debug=1 first_contact=1 retry=1 structured_json=1 models=1 webhook=1 vision=1');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
