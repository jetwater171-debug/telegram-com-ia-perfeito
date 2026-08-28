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

const prompts = loadPureTypeScriptModule('../src/lib/lariConversationPrompts.ts');
const quality = loadPureTypeScriptModule('../src/lib/conversationQuality.ts');
const bubbles = loadPureTypeScriptModule('../src/lib/conversationBubbles.ts');
const orchestration = loadPureTypeScriptModule('../src/lib/aiOrchestration.ts');
const models = loadPureTypeScriptModule('../src/lib/aiModels.ts');
const timing = loadPureTypeScriptModule('../src/lib/humanDeliveryTiming.ts');
const adult = loadPureTypeScriptModule('../src/lib/adultVerification.ts');

const core = prompts.buildLariCorePrompt({
    localTime: '00:21',
    localPeriod: 'madrugada',
    city: 'Mococa',
    deviceType: 'Android',
    totalPaid: 0,
    stats: { tarado: 10, carente: 20, sentimental: 20, financeiro: 10 },
    memorySummary: 'estágio: new; nome: desconhecido',
    previewsCatalog: 'foto_deitada | foto_banho',
    antiRepeatText: 'oiii, tudo bem?',
    dynamicInstructions: 'VIP: mensal R$ 29,90; vitalício R$ 49,90; combo R$ 79,90; chamada R$ 50,00',
});

assert.ok(core.length > 6_500, 'o contrato central precisa cobrir os cenários essenciais');
assert.match(core, /pacote literal mais recente/i);
assert.match(core, /Primeiro contato:/i);
assert.match(core, /Conversa cotidiana continua cotidiana/i);
assert.match(core, /Mídia é ação, não promessa/i);
assert.match(core, /Pergunta de preço recebe preço/i);
assert.match(core, /mensal R\$ 29,90/i);
assert.match(core, /vitalício R\$ 49,90/i);
assert.match(core, /R\$ 79,90/i);
assert.match(core, /chamada.*R\$ 50,00/i);
assert.doesNotMatch(core, /VIP custa exatamente R\$ 19,90/i);
assert.match(core, /não sexualize uma saudação/i);
assert.doesNotMatch(core, /Churrasco \/ Picanha|Academia \/ Treino|MULTIMODALIDADE CONTÍNUA|SEDUÇÃO HIPNÓTICA/i);

const start = quality.refineNewRelationshipMessages(
    ['oi amor, tudo bem?', 'to deitadinha no meu quarto', 'kkk'],
    { userText: '/start', hasKnownName: false, isConversationStart: true, variationKey: 'lead-123' },
);
assert.equal(start.length, 2);
assert.match(start[0], /^(oi|eii)/i);
assert.match(start[1], /(nome|cham)/i);
assert.notEqual(start[0], 'oiii, tudo bem?');

const alreadyGreeted = quality.refineNewRelationshipMessages(
    ['oii, tudo bem?', 'como ta seu dia amor?', 'como vc se chama?'],
    { userText: 'oi', lastBotContent: 'oiii, tudo bem?', hasKnownName: false },
);
assert.deepEqual(alreadyGreeted, ['como vc se chama?']);

const knownLead = quality.refineNewRelationshipMessages(
    ['oi sumido amor', 'como ta seu dia?'],
    { userText: 'oi', lastBotContent: '', hasKnownName: true },
);
assert.deepEqual(knownLead, ['oi', 'como ta seu dia?']);

assert.deepEqual(
    bubbles.shapeConversationBubbles(['uma resposta específica e natural'], { preferredCount: 3, maxBubbles: 4 }),
    ['uma resposta específica e natural'],
    'o formatador não deve fabricar vários balões',
);
assert.deepEqual(
    bubbles.shapeConversationBubbles(['igual', 'igual', 'outra'], { maxBubbles: 4 }),
    ['igual', 'outra'],
    'mensagens duplicadas devem ser removidas',
);

assert.equal(prompts.needsLariReview({ isConversationStart: true, relationshipStage: 'new', messages: ['oiii'] }), true);
assert.equal(prompts.needsLariReview({
    relationshipStage: 'familiar',
    userText: 'quero o mensal, manda o pix',
    action: 'generate_pix_payment',
    messages: ['fechou, vou gerar', 'te mando agora'],
    strategyConfidence: 0.95,
}), true);
assert.equal(prompts.needsLariReview({
    relationshipStage: 'familiar',
    userText: 'fiz churrasco hoje',
    messages: ['aí sim kkk ficou bom?', 'qual corte vc fez?'],
    strategyConfidence: 0.95,
}), false);

const starter = orchestration.resolveAiOrchestrationPlan(0);
assert.equal(starter.separateStrategy, false);
assert.equal(starter.reviewMode, 'critical');
assert.equal(orchestration.shouldRunAiReview(starter, true), true);
assert.equal(orchestration.shouldRunAiReview(starter, false), false);
assert.equal(models.normalizeGeminiModelName('gemini-3.5-flash'), 'gemini-3.5-flash');
assert.equal(models.normalizeGroqModelName('llama-3.1-8b-instant'), 'openai/gpt-oss-20b');

const firstBubbleDelay = timing.humanTextDelayMs({
    text: 'legal te conhecer, leo',
    bubbleIndex: 0,
    random: () => 0,
});
const secondBubbleDelay = timing.humanTextDelayMs({
    text: 'o que vc gosta de fazer quando ta de boa?',
    bubbleIndex: 1,
    random: () => 0,
});
const slowModelFirstBubbleDelay = timing.humanTextDelayMs({
    text: 'oi',
    bubbleIndex: 0,
    modelDurationMs: 9_000,
    random: () => 0,
});
assert.ok(firstBubbleDelay >= 900);
assert.ok(secondBubbleDelay >= 1_700);
assert.ok(secondBubbleDelay > firstBubbleDelay);
assert.equal(slowModelFirstBubbleDelay, 850);
assert.ok(timing.humanTextDelayMs({ text: 'x'.repeat(500), bubbleIndex: 2, random: () => 1 }) <= 5_200);

assert.equal(adult.isPresellAdultVerificationGuaranteed(undefined), true);
assert.equal(adult.isPresellAdultVerificationGuaranteed('false'), false);
const verifiedByPresell = adult.withPresellAdultVerification({}, '2026-08-28T12:00:00.000Z');
assert.equal(verifiedByPresell.adult_verified, true);
assert.equal(verifiedByPresell.adult_verification_source, 'presell_entry_contract');
assert.equal(adult.hasTrustedAdultVerification(verifiedByPresell), true);

const geminiSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/gemini.ts'), 'utf8');
const routeSource = fs.readFileSync(path.resolve(__dirname, '../src/app/api/process-message/route.ts'), 'utf8');
assert.match(geminiSource, /extractLeadTextFromPrompt/);
assert.match(geminiSource, /needsLariReview/);
assert.doesNotMatch(geminiSource, /const useSeparateReviewCall = false/);
assert.match(routeSource, /isEarlyConversationEpisode/);
assert.match(routeSource, /const DEBOUNCE_WAIT_MS = 4000/);
assert.match(routeSource, /humanTextDelayMs\(\{/);
assert.doesNotMatch(routeSource, /modelDurationMs >= 8_000\s*\?\s*150/);
assert.match(routeSource, /preferredCount: aiResponse\.recommended_message_count \|\| 2/);
assert.doesNotMatch(routeSource, /amor já te mandei várias prévias|calma amor, assim vc me deixa sem fôlego/);

console.log('LARI_HUMANIZATION_OK prompt=1 start=1 gradual=1 no_templates=1 bubbles=1 review=1 media=1 sales=1');
