const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const loadTs = (relativePath, stubs = {}) => {
  const filename = path.join(root, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (id) => Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : require(id);
  new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
    localRequire, loaded, loaded.exports, filename, path.dirname(filename),
  );
  return loaded.exports;
};

const evidence = loadTs('src/lib/leadMemoryEvidence.ts');
const aiActions = loadTs('src/lib/aiActions.ts');
const memory = loadTs('src/lib/leadMemory.ts', { '@/types': {} , '@/lib/leadMemoryEvidence': evidence });
const brainTypes = loadTs('src/lib/brain/types.ts', { '@/types': {} });
const validator = loadTs('src/lib/brain/hardValidator.ts', {
  '@/lib/brain/types': brainTypes,
  '@/lib/leadMemoryEvidence': evidence,
  '@/lib/aiActions': aiActions,
});
const mem0 = loadTs('src/lib/mem0LeadMemory.ts');

assert.equal(evidence.isCompleteLiteralLeadEvidence('eu moro no Porto', 'eu moro no Porto'), true);
assert.equal(evidence.isCompleteLiteralLeadEvidence('Porto', 'eu moro no Porto'), false);
assert.equal(evidence.isCompleteLiteralLeadEvidence('moro no Porto', 'moro no Porto?'), false, 'pergunta não é declaração');
assert.equal(evidence.isCompleteLiteralLeadEvidence('vc mora no Porto', 'vc mora no Porto'), false, 'segunda pessoa não é autobiografia');
assert.equal(evidence.isCompleteLiteralLeadEvidence('ele mora no Porto', 'ele mora no Porto'), false, 'terceira pessoa não é autobiografia');
assert.equal(evidence.isCompleteLiteralLeadEvidence('eu moro no Porto', '"eu moro no Porto"'), false, 'citação não é declaração direta');
assert.equal(evidence.isCompleteLiteralLeadEvidence('eu disse que moro no Porto', 'eu disse que moro no Porto'), false, 'atribuição não é fato autobiográfico');
assert.equal(
  evidence.isCompleteLiteralLeadEvidence('o lead mora em Lisboa', 'eu moro no Porto, não em Lisboa'),
  false,
  'coincidência de Lisboa não vence a correção e a negação',
);
assert.equal(
  evidence.isCompleteLiteralLeadEvidence('a Lari mora em Lisboa', 'a Lari mora em Lisboa'),
  false,
  'frase literal sobre Lari não é fato do lead',
);

const response = {
  internal_thought: 'resumo',
  lead_classification: 'curioso',
  lead_stats: { tarado: 0, carente: 0, sentimental: 0, financeiro: 0 },
  current_state: 'CONNECTION',
  messages: ['entendi'],
  action: 'none',
  lead_memory_patch: null,
  next_best_action: 'TALK',
  decision_confidence: 1,
  memory_updates: [{
    kind: 'fact', key: 'cidade', content: 'o lead mora em Lisboa',
    confidence: 1, importance: 1, status: 'active',
  }],
};
const validated = validator.validateMasterBrainResponse({
  response,
  userText: 'eu moro no Porto, não em Lisboa',
  canGeneratePayment: false,
  canPitchPrice: false,
  adultVerified: true,
});
assert.equal(validated.response.memory_updates[0].kind, 'hypothesis');
assert.equal(validated.response.memory_updates[0].status, 'uncertain');

const current = { known_facts: ['ele mora em Lisboa'] };
const filtered = memory.mergeLeadMemoryPatch(current, {
  known_facts: ['o lead mora em Lisboa', 'eu moro no Porto'],
}, 'eu moro no Porto');
assert.deepEqual(filtered.known_facts, ['ele mora em Lisboa', 'eu moro no Porto']);

const legacyCompatible = memory.mergeLeadMemoryPatch(current, {
  known_facts: ['o lead mora em Lisboa'],
});
assert.deepEqual(legacyCompatible.known_facts, ['ele mora em Lisboa', 'o lead mora em Lisboa']);

let captured;
mem0.addMem0LeadTurn({
  settings: { enabled: true, apiKey: 'test-key' },
  userId: 'telegram:1',
  sessionId: 'session-1',
  userText: 'eu moro no Porto',
  assistantMessages: ['eu moro em Lisboa'],
  fetcher: async (_url, init) => {
    captured = JSON.parse(init.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'ok' }) };
  },
}).then(() => {
  assert.deepEqual(captured.messages, [{ role: 'user', content: 'eu moro no Porto' }]);
  assert.equal(captured.metadata.source_actor, 'lead');
  const context = mem0.formatMem0LeadMemoryContext([{ memory: 'eu moro no Porto' }]);
  assert.match(context, /NÃO CONFIÁVEIS/);
  assert.match(context, /autoria histórica é incerta/i);
  assert.match(context, /"type":"historical_memory_data"/);
  console.log('LEAD_MEMORY_EVIDENCE_OK literal=1 negation=1 actor=1 legacy=1 mem0_user_only=1');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
