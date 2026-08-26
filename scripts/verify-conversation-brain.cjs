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
assert.equal(firstOpening.length, 1);
assert.match(firstOpening[0], /(?:nome|chamar|se chama)/i);

const corePrompt = buildLariCorePrompt({
    localTime: '21:30', localPeriod: 'noite', city: 'São Paulo', deviceType: 'Android', totalPaid: 0,
    stats: {}, memorySummary: 'nome: Leo', previewsCatalog: 'foto-1', antiRepeatText: 'oiii', dynamicInstructions: 'nenhuma',
});
assert.match(corePrompt, /NÚCLEO HUMANO QUE VALE EM QUALQUER SITUAÇÃO/);
assert.match(corePrompt, /INTELIGÊNCIA SOCIAL POR TRÁS DA LARI/);
assert.match(corePrompt, /revisão silenciosa/i);
assert.doesNotMatch(corePrompt, /Churrasco \/ Picanha|MULTIMODALIDADE CONTÍNUA|mande fotos com frequência/i);
assert.equal(needsLariReview({ relationshipStage: 'new', messages: ['oi amor'] }), true);
assert.equal(needsLariReview({ relationshipStage: 'familiar', messages: ['entendi seu ponto'], strategyConfidence: 0.9 }), false);

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
assert.match(geminiSource, /buildLariCorePrompt/);
assert.match(geminiSource, /buildLariStrategyPrompt/);
assert.match(geminiSource, /buildLariDraftPrompt/);
assert.match(geminiSource, /buildLariReviewPrompt/);
assert.doesNotMatch(geminiSource, /const useSeparateReviewCall = false/);
assert.match(geminiSource, /filterConversationEpisodeMessages/);
assert.match(geminiSource, /Mensagens do lead neste episodio/);
assert.match(geminiSource, /isNewRelationship/);
assert.match(processSource, /refineNewRelationshipMessages/);
assert.match(processSource, /isEarlyConversationEpisode/);
assert.match(processSource, /const receivedStartCommand = Boolean\(conversationStartAt\)/);
assert.match(processSource, /const isConversationStart = receivedStartCommand && !lastBotMsg/);
assert.match(processSource, /RETOMADA DE CONVERSA/);
assert.match(processSource, /const isActualFirstRelationshipTurn = !lastBotMsg/);

console.log('CONVERSATION_BRAIN_OK history=80 separate_brain=1 episode_reset=1 first_contact=1 persona=1 self_review=1');
