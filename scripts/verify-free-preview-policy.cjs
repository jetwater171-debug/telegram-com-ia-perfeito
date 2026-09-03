const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/lib/previewDeliveryPolicy.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText;
const record = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, record, record.exports);
const { decideFreePreviewDelivery } = record.exports;

const hotTurn = {
  requestedByLead: false,
  recoveryRequest: false,
  modelAttemptedMedia: true,
  lastBotDeliveredMedia: false,
  adultVerified: true,
  sentPreviewCount: 1,
  userMessagesSinceLastMedia: 3,
  userTurnsInWindow: 7,
  leadHeat: 76,
  currentTextIsHot: true,
  leadMessageHasSubstance: true,
  blocksInitiative: false,
  currentStage: 'HOT_TALK',
};

assert.equal(decideFreePreviewDelivery(hotTurn).contextualInitiativeAllowed, true);
assert.equal(decideFreePreviewDelivery({ ...hotTurn, currentTextIsHot: false }).shouldDeliver, false);
assert.equal(decideFreePreviewDelivery({ ...hotTurn, lastBotDeliveredMedia: true }).shouldDeliver, false);
assert.equal(decideFreePreviewDelivery({ ...hotTurn, sentPreviewCount: 3 }).shouldDeliver, false);
assert.equal(decideFreePreviewDelivery({
  ...hotTurn,
  requestedByLead: true,
  modelAttemptedMedia: false,
  sentPreviewCount: 2,
}).requestedDeliveryAllowed, true);
const fourth = decideFreePreviewDelivery({
  ...hotTurn,
  requestedByLead: true,
  modelAttemptedMedia: false,
  sentPreviewCount: 3,
  userTurnsInWindow: 9,
  userMessagesSinceLastMedia: 2,
  leadHeat: 90,
});
assert.equal(fourth.fourthPreviewEligible, true);
assert.equal(fourth.requestedDeliveryAllowed, true);
assert.equal(decideFreePreviewDelivery({ ...hotTurn, requestedByLead: true, sentPreviewCount: 4 }).shouldDeliver, false);
assert.equal(decideFreePreviewDelivery({
  ...hotTurn,
  requestedByLead: true,
  recoveryRequest: true,
  modelAttemptedMedia: false,
  sentPreviewCount: 4,
}).requestedDeliveryAllowed, true, 'reentrega não consome uma nova prévia');
assert.equal(decideFreePreviewDelivery({ ...hotTurn, adultVerified: false }).shouldDeliver, false);

console.log('FREE_PREVIEW_POLICY_OK normal=3 exceptional=4 reaction_guard=1 recovery=1');
