const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/lib/brain/conversationStyle.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText;
const record = { exports: {} };
new Function('require', 'module', 'exports', compiled)((name) => name === '@/lib/brain/types' ? {} : require(name), record, record.exports);
const { evolveConversationStyle } = record.exports;

const base = { messageLength: 'adaptive', humor: 0.5, directness: 0.6 };
assert.strictEqual(evolveConversationStyle(base, ''), base, 'trigger vazio não altera o perfil');

const first = evolveConversationStyle(base, 'kkkk vc é impossível mds');
assert.equal(first.samples, 1);
assert.equal(first.messageLength, 'short');
assert.equal(first.averageWords, 5);
assert.equal(first.lowercaseRate, 1);
assert.equal(first.abbreviationRate, 1);
assert.equal(first.laughStyle, 'kkkk');
assert.ok(first.humor > base.humor && first.humor < 0.75, 'uma risada suaviza, não domina o perfil');

const second = evolveConversationStyle(first, 'Quero entender melhor como isso funciona antes de decidir qualquer coisa');
assert.equal(second.samples, 2);
assert.equal(second.lowercaseRate, 0.5);
assert.ok(second.averageWords > first.averageWords);
assert.ok(second.directness < 0.8, 'uma palavra direta não domina o perfil');

console.log('CONVERSATION_STYLE_MEMORY_OK rolling=1 empty_guard=1 humor=smoothed directness=smoothed');
