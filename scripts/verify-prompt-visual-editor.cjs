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
  new Function('require', 'module', 'exports', compiled)(name => dependencyMap[name] || require(name), record, record.exports);
  return record.exports;
};

const visual = loadTs('src/lib/promptVisualEditor.ts');
const actions = loadTs('src/lib/aiActions.ts');
const commercial = loadTs('src/lib/commercialCatalog.ts');
const editor = loadTs('src/lib/systemInstructionEditor.ts', {
  '@/lib/aiActions': actions,
  '@/lib/commercialCatalog': commercial,
  '@/lib/systemInstructionKeys': {},
});

const blocks = visual.parsePromptVisualBlocks(editor.DEFAULT_FULL_SYSTEM_INSTRUCTION_TEMPLATE);
assert.ok(blocks.length >= 12, 'o prompt completo precisa virar blocos úteis');
assert.equal(visual.composePromptVisualBlocks(blocks), editor.DEFAULT_FULL_SYSTEM_INSTRUCTION_TEMPLATE, 'abrir e recompor não pode mudar o prompt real');
assert.ok(blocks.some(block => block.friendlyName === 'Como vender'));
assert.ok(blocks.some(block => block.kind === 'functions'));
assert.ok(blocks.some(block => block.kind === 'dynamic'));

const functionBlock = blocks.find(block => block.kind === 'functions');
const functionItems = visual.parsePromptFunctionItems(functionBlock.content);
assert.equal(functionItems.length, actions.AI_ACTION_DEFINITIONS.length);
assert.equal(visual.PROMPT_FUNCTION_LABELS.generate_pix_payment.label, 'Gerar PIX');
assert.equal(visual.PROMPT_FUNCTION_LABELS.send_voice_reply.label, 'Mandar áudio');
assert.equal(visual.PROMPT_FUNCTION_LABELS.send_custom_preview.label, 'Mandar prévia ideal');

const reordered = visual.reorderPromptFunctionItems(functionBlock.content, 'generate_pix_payment', 'none');
const reorderedItems = visual.parsePromptFunctionItems(reordered);
assert.equal(reorderedItems[0].name, 'generate_pix_payment');
assert.equal(reorderedItems.length, functionItems.length);

const updated = visual.updatePromptFunctionItem(functionBlock.content, 'send_voice_reply', 'Mandar áudio. Faz: teste visual seguro.');
assert.match(updated, /^- send_voice_reply — Mandar áudio\. Faz: teste visual seguro\.$/m);
assert.equal(visual.extractPromptTokens(editor.DEFAULT_FULL_SYSTEM_INSTRUCTION_TEMPLATE).length, editor.REQUIRED_SYSTEM_INSTRUCTION_TOKENS.length);
assert.deepEqual(editor.findDuplicateSystemInstructionTokens(editor.DEFAULT_FULL_SYSTEM_INSTRUCTION_TEMPLATE), []);
assert.deepEqual(editor.findUnknownSystemInstructionTokens(editor.DEFAULT_FULL_SYSTEM_INSTRUCTION_TEMPLATE), []);
assert.deepEqual(editor.findDuplicateSystemInstructionTokens(`${editor.DEFAULT_FULL_SYSTEM_INSTRUCTION_TEMPLATE}\n{{LEAD_MEMORY}}`), ['{{LEAD_MEMORY}}']);
assert.deepEqual(editor.findUnknownSystemInstructionTokens(`${editor.DEFAULT_FULL_SYSTEM_INSTRUCTION_TEMPLATE}\n{{NAO_EXISTE}}`), ['{{NAO_EXISTE}}']);

const plainCopied = editor.DEFAULT_FULL_SYSTEM_INSTRUCTION_TEMPLATE
  .replace(/^#{1,3}\s+/gm, '')
  .replace(/^-\s+/gm, '');
const plainBlocks = visual.parsePromptVisualBlocks(plainCopied);
const plainFunctionBlock = plainBlocks.find(block => block.kind === 'functions');
assert.ok(plainBlocks.length >= 12, 'texto copiado sem Markdown também precisa virar blocos');
assert.ok(plainFunctionBlock, 'funções sem bullets continuam reconhecidas');
assert.equal(visual.parsePromptFunctionItems(plainFunctionBlock.content).length, actions.AI_ACTION_DEFINITIONS.length);
assert.equal(visual.composePromptVisualBlocks(plainBlocks), plainCopied, 'editor visual não altera o texto colado');

console.log(`PROMPT_VISUAL_EDITOR_OK blocks=${blocks.length} functions=${functionItems.length} variables=${editor.REQUIRED_SYSTEM_INSTRUCTION_TOKENS.length} lossless=1`);
