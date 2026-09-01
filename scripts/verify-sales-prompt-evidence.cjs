const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const loadTs = (relativePath, dependencyMap = {}) => {
  const filename = path.resolve(__dirname, '..', relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const record = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (name) => dependencyMap[name] || require(name), record, record.exports,
  );
  return record.exports;
};

const actions = loadTs('src/lib/aiActions.ts');
const commercial = loadTs('src/lib/commercialCatalog.ts');
const editor = loadTs('src/lib/systemInstructionEditor.ts', {
  '@/lib/aiActions': actions,
  '@/lib/commercialCatalog': commercial,
  '@/lib/systemInstructionKeys': {
    SYSTEM_INSTRUCTION_BLOCK_KEY: 'system_instruction_primary',
    SYSTEM_INSTRUCTION_BLOCK_LABEL: 'Instrução principal da Lari',
  },
});

const prompt = editor.DEFAULT_FULL_SYSTEM_INSTRUCTION_TEMPLATE;
assert.ok(prompt.length >= 14_000 && prompt.length < 24_000, `tamanho inesperado: ${prompt.length}`);
assert.deepEqual(editor.findMissingSystemInstructionTokens(prompt), []);
assert.deepEqual(editor.findDuplicateSystemInstructionTokens(prompt), []);
assert.deepEqual(editor.findUnknownSystemInstructionTokens(prompt), []);

for (const action of actions.AI_ACTION_DEFINITIONS) {
  assert.match(prompt, new RegExp(`^- ${action.name}\\s+—\\s+`, 'm'), `action ausente: ${action.name}`);
}

assert.match(prompt, /pedido de PIX vence flerte/);
assert.match(prompt, /Perguntar preço não autoriza PIX/);
assert.match(prompt, /messages\[0\] é a legenda curta e específica/);
assert.match(prompt, /Depois de uma foto.*não autoriza outra/s);
assert.match(prompt, /Nunca crie link, telefone, WhatsApp, Telegram/);
assert.match(prompt, /Só diga “pagamento confirmado” quando o backend confirmar/);
assert.match(prompt, /“manda o pix” após oferta única.*generate_pix_payment/s);
assert.doesNotMatch(prompt, /R\$\s*19[,.]90/);

const superseded = [
  'LARI — SYSTEM INSTRUCTION Telegram Conversational Sales Agent',
  '0. MISSÃO',
  '14. TURNS_SINCE_PROGRESS',
  '46. ESTADO COMERCIAL DETERMINÍSTICO',
  '{{LEAD_PROFILE}}',
].join('\n');
assert.equal(editor.isSupersededSeptemberPrompt(superseded), true);
assert.equal(editor.normalizeSystemInstructionTemplate(superseded), prompt);

const geminiSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/gemini.ts'), 'utf8');
assert.match(geminiSource, /fetiches:\s*\{\s*type:\s*"ARRAY"/);
assert.match(geminiSource, /favorite_media_types:\s*\{\s*type:\s*"ARRAY"/);

console.log(`SALES_PROMPT_EVIDENCE_OK chars=${prompt.length} blocks=12 actions=${actions.AI_ACTION_DEFINITIONS.length} variables=${editor.REQUIRED_SYSTEM_INSTRUCTION_TOKENS.length}`);
