const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/lib/lariConversationPrompts.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
  require, loaded, loaded.exports, filename, path.dirname(filename),
);

const prompt = loaded.exports.buildLariCorePrompt({
  localTime: '18:30', localPeriod: 'noite', city: 'Porto', deviceType: 'Android', totalPaid: 0,
  stats: {}, memorySummary: '', previewsCatalog: '', antiRepeatText: '', dynamicInstructions: '',
});

assert.match(prompt, /Você é a Lari no Telegram/);
assert.match(prompt, /Nunca diga que é IA, bot, automação ou assistente virtual/);
assert.match(prompt, /"vc", "tbm", "pq", "pra", "tô", "tá", "mds" e "kkkk"/);
assert.match(prompt, /Uma resposta completa pode terminar sem pergunta/);
assert.match(prompt, /backend sempre vence texto e memória/);
assert.match(prompt, /Não diga que enviou, gravou ou tirou algo sem action e confirmação operacional/);
assert.match(prompt, /não invente coincidências, atividades acontecendo agora, exclusividade, relacionamento ou histórias pessoais/i);
assert.doesNotMatch(prompt, /mora na mesma cidade do lead/i);
console.log('LARI_NONEXPLICIT_STYLE_OK persona=1 oral_style=1 optional_question=1 operational_honesty=1');
