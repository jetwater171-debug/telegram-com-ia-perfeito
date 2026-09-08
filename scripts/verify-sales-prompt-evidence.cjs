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
  '@/lib/lariConversationPrompts': loadTs('src/lib/lariConversationPrompts.ts'),
  '@/lib/systemInstructionKeys': {
    SYSTEM_INSTRUCTION_BLOCK_KEY: 'system_instruction_primary',
    SYSTEM_INSTRUCTION_BLOCK_LABEL: 'Instrução principal da Lari',
  },
});

const prompt = editor.DEFAULT_FULL_SYSTEM_INSTRUCTION_TEMPLATE;
assert.ok(prompt.length >= 10_000 && prompt.length < 18_000, `tamanho inesperado: ${prompt.length}`);
assert.deepEqual(editor.findMissingSystemInstructionTokens(prompt), []);
assert.deepEqual(editor.findDuplicateSystemInstructionTokens(prompt), []);
assert.deepEqual(editor.findUnknownSystemInstructionTokens(prompt), []);

assert.match(prompt, /Quando produto, valor e aceite estiverem inequívocos.*generate_pix_payment/);
assert.match(prompt, /Perguntar preço não autoriza PIX/);
assert.match(prompt, /messages\[0\] é a legenda curta e específica/);
assert.match(prompt, /Depois de uma foto.*não autoriza(?:m)? outra/s);
assert.match(prompt, /4 a 7 palavras/);
assert.match(prompt, /Não existe oferta obrigatória no terceiro turno nem por contagem de mensagens/);
assert.match(prompt, /Nunca diga que é IA, bot, automação ou assistente virtual/);
assert.match(prompt, /PROMPT_VERSION: lari-commercial-funnel-v3/);
assert.match(prompt, /conexão curta → desejo identificável → aquecimento no mesmo tema → prévia quando elegível/);
assert.match(prompt, /Depois que ele vir e pedir mais, elogiar com desejo ou demonstrar curiosidade maior/);
assert.match(prompt, /depois de no máximo dois turnos úteis sobre o mesmo desejo/);
assert.match(prompt, /Se não houver pedido específico, mas houver desejo de ver mais/);
assert.match(prompt, /Se houver pedido específico de foto, vídeo, áudio, chamada ou outra experiência/);
assert.match(prompt, /Desejo específico ou pergunta comercial tira o turno de TALK/);
assert.match(prompt, /Nunca invente arquivo, link, código PIX/);
assert.match(prompt, /Responder não executa uma operação/);
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
const rigidLegacy = '# LARI — AGENTE DE CONVERSA E VENDAS\nA REGRA QUE NUNCA PODE SER QUEBRADA: AVANÇAR';
assert.equal(editor.isLegacyRigidSalesPrompt(rigidLegacy), true);
assert.equal(editor.normalizeSystemInstructionTemplate(rigidLegacy), prompt);

const geminiSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/gemini.ts'), 'utf8');
assert.match(geminiSource, /fetiches:\s*\{\s*type:\s*"ARRAY"/);
assert.match(geminiSource, /favorite_media_types:\s*\{\s*type:\s*"ARRAY"/);
assert.match(geminiSource, /action:\s*\{\s*type:\s*"STRING",\s*enum:\s*AI_ACTION_NAMES/s);
assert.equal(actions.AI_ACTION_NAMES.length, actions.AI_ACTION_DEFINITIONS.length);

console.log(`SALES_PROMPT_EVIDENCE_OK chars=${prompt.length} actions_in_schema=${actions.AI_ACTION_DEFINITIONS.length} variables=${editor.REQUIRED_SYSTEM_INSTRUCTION_TOKENS.length}`);
