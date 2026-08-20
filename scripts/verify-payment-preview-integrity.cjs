const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(process.env.TARGET_ROOT || process.cwd());
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const loadTypeScript = (relativePath, stubs = {}) => {
  const filename = path.join(root, relativePath);
  if (!fs.existsSync(filename)) throw new Error(`missing:${relativePath}`);
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

try {
  const payment = loadTypeScript('src/lib/paymentStatus.ts');
  const previews = loadTypeScript('src/lib/previewDeliveryPolicy.ts');
  const reconciliation = loadTypeScript('src/lib/paymentReconciliation.ts', {
    '@/lib/supabaseServer': { supabaseServer: {} },
    '@/lib/paymentGatewayService': { getPaymentStatusMultiGateway() {}, normalizePaymentGatewayId: (value) => value },
    '@/lib/leadScoring': { markLeadPaid: (value) => value },
    '@/lib/telegram': { sendTelegramMessage() {} },
    '@/lib/paymentStatus': payment,
  });

  assert.equal(payment.findPaymentStatus({ data: { payment: { status: 'APPROVED' } } }), 'approved');
  assert.equal(payment.isPaymentPaidPayload({ status: 'success', ok: true }), false);
  assert.equal(payment.isPaymentPaidPayload({ data: { paid_at: '2026-08-20T00:00:00Z' } }), true);
  assert.deepEqual(
    payment.collectPaymentReferenceCandidates({ data: { transaction: { txid: 'ABC-123' } } }),
    ['ABC-123'],
  );
  assert.equal(reconciliation.calculatePaidLedgerTotal([
    { payment_data: { paymentId: 'same', paid: true, value: 29.9 } },
    { payment_data: { paymentId: 'same', paid: true, value: 29.9 } },
    { payment_data: { paymentId: 'pending', paid: false, status: 'pending', value: 50 } },
  ]), 29.9);

  assert.equal(previews.shouldDeliverRequestedMedia({ userAskedMedia: false, userAffirmedMedia: false, isInitialGreeting: false }), false);
  assert.equal(previews.shouldDeliverRequestedMedia({ userAskedMedia: true, userAffirmedMedia: false, isInitialGreeting: false }), true);
  assert.equal(previews.shouldDeliverRequestedMedia({ userAskedMedia: true, userAffirmedMedia: false, isInitialGreeting: true }), true);
  assert.equal(
    previews.normalizePreviewMediaKey('HTTPS://cdn.example.com/a.jpg?token=1#x'),
    'https://cdn.example.com/a.jpg',
  );
  const unsent = previews.filterUnsentPreviewAssets(
    [
      { id: 'used', media_url: 'https://cdn.example.com/a.jpg?new=1' },
      { id: 'fresh', media_url: 'https://cdn.example.com/b.jpg' },
    ],
    ['https://cdn.example.com/a.jpg?old=1'],
  );
  assert.deepEqual(unsent.map((item) => item.id), ['fresh']);

  const route = read('src/app/api/process-message/route.ts');
  const webhook = read('src/app/api/payment/webhook/route.ts');
  const dashboard = read('src/app/admin/page.tsx');
  const syncRoute = read('src/app/api/admin/payment-sync/route.ts');
  const reconciliationSource = read('src/lib/paymentReconciliation.ts');

  assert.match(route, /shouldDeliverRequestedMedia/);
  assert.match(route, /reconcilePendingPayments/);
  assert.doesNotMatch(route, /available\.length > 0 \? available : candidateList/);
  assert.match(route, /mediaSuppressedForRepetition = true/);
  assert.match(webhook, /findPaymentMessageForWebhook/);
  assert.match(dashboard, /\/api\/admin\/payment-sync/);
  assert.match(syncRoute, /reconcilePendingPayments/);
  assert.match(reconciliationSource, /counted: true/);

  console.log('PAYMENT_PREVIEW_CHECK_OK payment=1 webhook=1 panel=1 explicit_media=1 unique_media=1');
} catch (error) {
  console.error(`PAYMENT_PREVIEW_CHECK_FAIL ${error.message}`);
  process.exitCode = 1;
}
