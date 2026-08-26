const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const loadPureTypeScriptModule = (relativePath) => {
    const filename = path.resolve(__dirname, relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        fileName: filename,
    }).outputText;
    const loadedModule = { exports: {} };
    new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
        require, loadedModule, loadedModule.exports, filename, path.dirname(filename),
    );
    return loadedModule.exports;
};

const quality = loadPureTypeScriptModule('../src/lib/conversationQuality.ts');
const prompts = loadPureTypeScriptModule('../src/lib/lariConversationPrompts.ts');

assert.deepEqual(
    quality.filterConversationConsistencyMessages(
        ['Quero te ver peladinha', 'eu quero que vc me veja bem de pertinho'],
        {
            currentUserText: 'vamos fazer a chamada?',
            recentUserTexts: ['Quero te ver peladinha'],
            recentBotTexts: [],
        },
    ),
    ['eu quero que vc me veja bem de pertinho'],
    'uma frase antiga do lead não pode voltar como fala da Lari',
);

assert.deepEqual(
    quality.filterConversationConsistencyMessages(
        ['kkkk verdade, no relógio parece que trava mesmo'],
        {
            currentUserText: 'no relógio parece que o tempo não passa',
            recentUserTexts: [],
            recentBotTexts: ['quando a gente fica olhando o relógio parece que trava mesmo kkk'],
        },
    ),
    ['kkkk verdade, no relógio parece que trava mesmo'],
    'uma resposta contextual válida não pode ser apagada por compartilhar o assunto',
);

assert.deepEqual(
    quality.filterConversationConsistencyMessages(
        ['entendi me conta essa parte melhor', 'vc já explicou, eu que me perdi'],
        {
            currentUserText: 'já falei',
            recentUserTexts: [],
            recentBotTexts: ['entendi, me conta só essa parte melhor'],
        },
    ),
    ['vc já explicou, eu que me perdi'],
    'variação quase idêntica de um fallback recente deve ser removida',
);

assert.deepEqual(
    quality.filterConversationConsistencyMessages(['sim'], {
        currentUserText: 'sim', recentUserTexts: [], recentBotTexts: [],
    }),
    ['sim'],
    'respostas curtas naturais não devem ser bloqueadas como eco',
);

const recovery = quality.buildConversationRecoveryMessages({
    userText: 'já falei, vc ta repetindo',
    recentBotTexts: ['entendi, me conta só essa parte melhor'],
    recentUserTexts: ['quero o vip'],
});
assert.equal(recovery.length, 1);
assert.doesNotMatch(recovery[0], /me conta|me explica/i);
assert.match(recovery[0], /vc (?:tem razão|já)|eu (?:me perdi|que respondi)/i);

assert.deepEqual(quality.enforceLatestIntentMessages(['agora eu entendi'], {
    latestUserText: 'como assinar moça?',
    language: 'pt',
}), ['o vip é 19,90. se quiser fechar, eu já gero o pix pra vc']);
assert.deepEqual(quality.enforceLatestIntentMessages(['tá cego é?'], {
    latestUserText: 'não chegou foto nenhuma',
    language: 'pt',
}), ['foi mal, vc tem razão: não tinha chegado']);
assert.equal(quality.detectConversationLanguage('Can you show me more please?'), 'en');
assert.equal(quality.detectConversationLanguage('como faço pra assinar?'), 'pt');
assert.equal(quality.refineNewRelationshipMessages(['oiii, tudo bem?'], {
    userText: '/start',
    isConversationStart: true,
    hasKnownName: false,
    variationKey: 'lead-123',
}).length, 1);

assert.equal(prompts.needsLariReview({
    relationshipStage: 'familiar',
    userText: 'já falei, vc ta repetindo',
    messages: ['entendi seu ponto'],
    strategyConfidence: 0.95,
}), true);
assert.equal(prompts.needsLariReview({
    relationshipStage: 'familiar',
    userText: 'ok',
    messages: ['entendi, me conta só essa parte melhor'],
    strategyConfidence: 0.95,
}), true);

const routeSource = fs.readFileSync(path.resolve(__dirname, '../src/app/api/process-message/route.ts'), 'utf8');
assert.match(routeSource, /filterConversationConsistencyMessages/);
assert.match(routeSource, /buildConversationRecoveryMessages/);
assert.doesNotMatch(routeSource, /\['entendi, me conta só essa parte melhor'\]/);
assert.doesNotMatch(routeSource, /\['entendi, me explica só essa parte melhor'\]/);

console.log('CONVERSATION_CONSISTENCY_OK historical_echo=1 near_duplicate=1 short_reply=1 contextual_recovery=1 review_escalation=1');
