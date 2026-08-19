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
assert.deepEqual(repaired, ['como vc se chama?']);

const firstOpening = refineNewRelationshipMessages(
    ['Oi, tudo bem?', 'Como tá o seu dia, amor?', 'kkk'],
    { userText: '/start', lastBotContent: '', hasKnownName: false, isConversationStart: true },
);
assert.deepEqual(firstOpening, ['Oi, tudo bem?', 'como vc se chama?']);

const eightyMessages = Array.from({ length: 80 }, (_, index) => ({
    sender: index % 2 === 0 ? 'user' : 'bot',
    content: `mensagem ${index + 1} com contexto real`,
}));
const cleanHistory = buildCleanAiHistory(eightyMessages, 1_100, 44, 16_000);
assert.equal(cleanHistory.length, 44);
assert.match(cleanHistory.at(-1).parts[0].text, /mensagem 80/);

const geminiSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/gemini.ts'), 'utf8');
const processSource = fs.readFileSync(path.resolve(__dirname, '../src/app/api/process-message/route.ts'), 'utf8');
assert.match(geminiSource, /NÚCLEO HUMANO QUE VALE EM QUALQUER SITUAÇÃO/);
assert.match(geminiSource, /INTELIGÊNCIA SOCIAL POR TRÁS DA LARI/);
assert.match(geminiSource, /revisão silenciosa/);
assert.match(geminiSource, /filterConversationEpisodeMessages/);
assert.match(processSource, /refineNewRelationshipMessages/);

console.log('CONVERSATION_BRAIN_OK history=80 separate_brain=1 episode_reset=1 first_contact=1 persona=1 self_review=1');
