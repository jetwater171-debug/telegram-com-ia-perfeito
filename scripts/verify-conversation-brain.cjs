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
    new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(require, loadedModule, loadedModule.exports, filename, path.dirname(filename));
    return loadedModule.exports;
};

const {
    filterConversationEpisodeMessages,
    findLatestConversationStartAt,
    hasConversationStartCommand,
} = loadPureTypeScriptModule('../src/lib/conversationEpisode.ts');
const { refineNewRelationshipMessages } = loadPureTypeScriptModule('../src/lib/conversationQuality.ts');
const { buildLariCorePrompt, needsLariReview } = loadPureTypeScriptModule('../src/lib/lariConversationPrompts.ts');
const { buildCleanAiHistory } = loadPureTypeScriptModule('../src/lib/aiHistory.ts');

assert.equal(hasConversationStartCommand('/start\noi'), true);
assert.equal(hasConversationStartCommand('oi normal'), false);

const messages = [
    { sender: 'user', content: 'quero putaria', created_at: '2026-08-19T10:00:00.000Z' },
    { sender: 'bot', content: 'mensagem antiga íntima', created_at: '2026-08-19T10:00:01.000Z' },
    { sender: 'user', content: '/start', created_at: '2026-08-19T10:25:00.000Z' },
    { sender: 'bot', content: 'oiii, tudo bem?', created_at: '2026-08-19T10:25:01.000Z' },
    { sender: 'user', content: 'oi', created_at: '2026-08-19T10:29:00.000Z' },
];
const startedAt = findLatestConversationStartAt(messages);
assert.equal(startedAt, '2026-08-19T10:25:00.000Z');
const episode = filterConversationEpisodeMessages(messages, startedAt, false);
assert.deepEqual(episode.map((message) => message.content), ['/start', 'oiii, tudo bem?', 'oi']);
assert.deepEqual(filterConversationEpisodeMessages(messages, startedAt, true), []);

const repaired = refineNewRelationshipMessages(
    ['Oi, tudo bem?', 'Como tá o seu dia, amor?', 'kkk'],
    { userText: 'oi', lastBotContent: 'oiii, tudo bem?', hasKnownName: false },
);
assert.deepEqual(repaired, ['como é seu nome??']);

const firstOpening = refineNewRelationshipMessages(
    ['Oi, tudo bem?', 'Como tá o seu dia, amor?', 'kkk'],
    { userText: '/start', lastBotContent: '', hasKnownName: false, isConversationStart: true },
);
assert.equal(firstOpening.length, 2);
assert.match(firstOpening[0], /(?:oi|eii)/i);
assert.match(firstOpening[1], /(?:nome|chamar|se chama)/i);

const corePrompt = buildLariCorePrompt({
    localTime: '21:30', localPeriod: 'noite', city: 'São Paulo', deviceType: 'Android', totalPaid: 0,
    stats: {}, memorySummary: 'nome: Leo', previewsCatalog: 'foto-1', antiRepeatText: 'oiii', dynamicInstructions: 'nenhuma',
});
assert.match(corePrompt, /LARI — MASTER BRAIN DE CONVERSA/);
assert.match(corePrompt, /PRIORIDADE E VERDADE/);
assert.match(corePrompt, /Antes de finalizar, confira silenciosamente/i);
assert.match(corePrompt, /messages deve conter de 1 a 4 balões/i);
assert.match(corePrompt, /Nunca diga que é IA, bot, automação ou assistente virtual/i);
assert.doesNotMatch(corePrompt, /Churrasco \/ Picanha|MULTIMODALIDADE CONTÍNUA|mande fotos com frequência/i);
assert.equal(needsLariReview({ relationshipStage: 'new', messages: ['oi amor'] }), false);
assert.equal(needsLariReview({
    relationshipStage: 'familiar',
    userText: 'não quero isso, eu disse para parar',
    messages: ['tá bom amor'],
    strategyConfidence: 0.9,
}), true);
assert.equal(needsLariReview({
    relationshipStage: 'familiar',
    userText: 'fiz churrasco hoje',
    messages: ['aí sim kkk ficou bom?', 'qual corte vc fez?'],
    strategyConfidence: 0.9,
}), false);

const eightyMessages = Array.from({ length: 80 }, (_, index) => ({
    sender: index % 2 === 0 ? 'user' : 'bot',
    content: `mensagem ${index + 1} com contexto real`,
}));
const cleanHistory = buildCleanAiHistory(eightyMessages, 1_100, 80, 24_000);
assert.equal(cleanHistory.length, 80);
assert.match(cleanHistory[0].parts[0].text, /mensagem 1/);
assert.match(cleanHistory.at(-1).parts[0].text, /mensagem 80/);

const geminiSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/gemini.ts'), 'utf8');
const processSource = fs.readFileSync(path.resolve(__dirname, '../src/app/api/process-message/route.ts'), 'utf8');
assert.match(geminiSource, /getSystemInstruction/);
assert.doesNotMatch(geminiSource, /buildLariStrategyPrompt/);
assert.match(geminiSource, /buildLariReviewPrompt/);
assert.doesNotMatch(geminiSource, /const useSeparateReviewCall = false/);
assert.match(geminiSource, /filterConversationEpisodeMessages/);
assert.match(geminiSource, /episodeLeadMessageCount/);
assert.match(processSource, /const receivedStartCommand = Boolean\(conversationStartAt\)/);
assert.match(processSource, /const isConversationStart = receivedStartCommand && !lastBotMsg/);
assert.match(processSource, /RETOMADA DE CONVERSA/);
assert.match(processSource, /shapeConversationBubbles/);
assert.match(processSource, /lowercaseStart: true/);
assert.match(processSource, /isPresellAdultVerificationGuaranteed/);

console.log('CONVERSATION_BRAIN_OK history=80 single_draft=1 adaptive_review=1 episode_reset=1 first_contact=1 persona=1');
