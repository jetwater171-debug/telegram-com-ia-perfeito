const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/lib/conversationTurn.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
}).outputText;
const loadedModule = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(require, loadedModule, loadedModule.exports, filename, path.dirname(filename));
const turn = loadedModule.exports;

assert.equal(turn.isLikelyIncompleteLeadMessage('to mor'), true);
assert.equal(turn.isLikelyIncompleteLeadMessage('mor de amor'), false);
assert.equal(turn.isLikelyIncompleteLeadMessage('oi'), false);
assert.equal(turn.isLowSignalLeadReaction('kkkkkk'), true);
assert.equal(turn.isLowSignalLeadReaction('kk você é demais'), false);
assert.equal(turn.isLowSignalLeadReaction('mor de amor\nkkkk'), false);
assert.deepEqual(
    turn.filterMalformedConversationMessages(['k kkk morrendo de por mim, é?', 'ahh sim, assim você me deixa sem jeito']),
    ['ahh sim, assim você me deixa sem jeito'],
);

const route = fs.readFileSync(path.resolve(__dirname, '../src/app/api/process-message/route.ts'), 'utf8');
assert.match(route, /isLikelyIncompleteLeadMessage/);
assert.match(route, /isLowSignalLeadReaction/);
assert.match(route, /low_signal_ignored/);
assert.match(route, /filterMalformedConversationMessages/);

console.log('CONVERSATION_TURNS_OK incomplete_wait=1 low_signal_skip=1 malformed_output_filter=1');
