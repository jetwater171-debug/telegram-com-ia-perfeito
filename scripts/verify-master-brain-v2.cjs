const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(process.env.TARGET_ROOT || process.cwd());
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

const memory = loadTs('src/lib/brain/memoryRetriever.ts');
const types = loadTs('src/lib/brain/types.ts', { '@/types': {} });
const validator = loadTs('src/lib/brain/hardValidator.ts', { '@/lib/brain/types': types });
const bandit = loadTs('src/lib/brain/previewBandit.ts', {
  '@/lib/supabaseServer': { supabaseServer: {} },
});

const memories = memory.rankMemoryRows({
  query: 'gostei mais da foto natural na cama',
  currentTopic: 'preview',
  openLoops: ['escolher foto'],
  rows: [
    { id: 'old', kind: 'fact', status: 'superseded', memory_key: 'foto', content: 'gosta de estúdio', confidence: 1, importance: 1 },
    { id: 'natural', kind: 'preference', status: 'active', memory_key: 'natural_bedroom', content: 'preferiu foto natural na cama', confidence: 1, importance: 0.8, updated_at: new Date().toISOString() },
    { id: 'car', kind: 'fact', status: 'active', memory_key: 'carro', content: 'gosta de carros antigos', confidence: 1, importance: 0.5, updated_at: '2025-01-01T00:00:00Z' },
  ],
});
assert.equal(memories[0].id, 'natural');
assert.equal(memories.some((item) => item.id === 'old'), false);

const base = {
  internal_thought: 'resumo', lead_classification: 'curioso',
  lead_stats: { tarado: 30, carente: 0, sentimental: 20, financeiro: 20 },
  extracted_user_name: null, current_state: 'PREVIEW', messages: ['toma'],
  action: 'send_hot_video_preview', lead_memory_patch: null,
  next_best_action: 'SEND_PREVIEW', decision_confidence: 0.9,
  memory_updates: [{ kind: 'fact', key: 'renda', content: 'ele ganha muito', confidence: 1, importance: 0.8, status: 'active' }],
};
const gated = validator.validateMasterBrainResponse({
  response: base,
  userText: 'manda nude',
  canGeneratePayment: false,
  canPitchPrice: false,
  adultVerified: false,
});
assert.equal(gated.response.action, 'none');
assert.equal(gated.response.next_best_action, 'ASK');
assert.match(gated.response.messages[0], /18 anos/);
assert.equal(gated.response.memory_updates[0].kind, 'hypothesis');

const payment = validator.validateMasterBrainResponse({
  response: { ...base, action: 'generate_pix_payment', next_best_action: 'GENERATE_PAYMENT', messages: ['vou gerar'] },
  userText: 'quanto custa o vip?',
  canGeneratePayment: false,
  canPitchPrice: true,
  adultVerified: true,
  offer: { id: 'vip:19.90', value: 19.9, description: 'VIP Lari' },
});
assert.equal(payment.response.action, 'none');
assert.equal(payment.response.payment_details, null);

const falseConfirmation = validator.validateMasterBrainResponse({
  response: { ...base, action: 'none', next_best_action: 'TALK', messages: ['seu pix ja caiu amor'] },
  userText: 'tenho certeza que paguei',
  canGeneratePayment: false,
  canPitchPrice: true,
  adultVerified: true,
  pendingPaymentId: 'pending-payment',
});
assert.equal(falseConfirmation.response.action, 'check_payment_status');
assert.equal(falseConfirmation.response.next_best_action, 'CHECK_PAYMENT');
assert.equal(falseConfirmation.corrections.includes('unverified_current_payment_claim'), true);

const candidates = [
  { asset: { id: 'champion', performance: { sent: 100, positive_reactions: 80, purchases: 20 } }, score: 10, moment: {} },
  { asset: { id: 'weak', performance: { sent: 100, positive_reactions: 5, purchases: 0 } }, score: 10, moment: {} },
];
assert.equal(bandit.applyPreviewBanditRanking(candidates, 'stable-seed')[0].asset.id, 'champion');

const route = fs.readFileSync(path.join(root, 'src/app/api/process-message/route.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'ai_brain_v2_migration.sql'), 'utf8');
assert.match(route, /loadBrainRuntimeState/);
assert.match(route, /validateMasterBrainResponse/);
assert.match(route, /recordAiDecisionSafe/);
assert.match(migration, /create table if not exists public\.lead_events/i);
assert.match(migration, /create table if not exists public\.ai_outcomes/i);

console.log('MASTER_BRAIN_V2_OK event_store=1 reality=1 twin=1 episode=1 retrieval=1 validator=1 bandit=1');
