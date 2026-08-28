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
  const aliases = {
    '@/lib/commercialCatalog': 'src/lib/commercialCatalog.ts',
    '@/lib/paymentStatus': 'src/lib/paymentStatus.ts',
  };
  const localRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    if (aliases[id]) return loadTypeScript(aliases[id], stubs);
    return require(id);
  };
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
    '@/lib/telegram': { sendTelegramMessageStrict() {} },
    '@/lib/paymentStatus': payment,
    '@/lib/brain/eventStore': {
      appendLeadEventSafe: async () => null,
      claimLeadEventSafe: async () => 'claimed',
      patchRealityStateSafe: async () => true,
      reserveLeadEventClaimSafe: async () => 'reserved',
    },
    '@/lib/brain/outcomeTracker': { trackPaymentOutcomeSafe: async () => ({}) },
    '@/lib/brain/previewBandit': { recordPreviewPurchaseSafe: async () => undefined },
    '@/lib/customOrders': {
      markCustomOrderPaidSafe: async () => true,
      markSessionSalesOrderPaidSafe: async () => true,
      recordCustomOrderSafe: async () => true,
    },
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
  const validLifetime = reconciliation.inspectCommercialPaymentIntegrity({
    sku: 'vip_lifetime', product: 'vip', value: 49.9, amount_cents: 4990,
  });
  assert.equal(validLifetime.catalogMismatch, false);
  assert.equal(validLifetime.commercialOffer.sku, 'vip_lifetime');
  const wrongLifetimePrice = reconciliation.inspectCommercialPaymentIntegrity({
    sku: 'vip_lifetime', product: 'vip', value: 29.9, amount_cents: 2990,
  });
  assert.equal(wrongLifetimePrice.catalogMismatch, true);
  const fixedProductWithoutSku = reconciliation.inspectCommercialPaymentIntegrity({
    product: 'vip', value: 49.9, amount_cents: 4990,
  });
  assert.equal(fixedProductWithoutSku.catalogMismatch, true);

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
  const customOrdersSource = read('src/lib/customOrders.ts');
  const eventStoreSource = read('src/lib/brain/eventStore.ts');
  const migration = read('ai_brain_v2_migration.sql');
  const outcomeSource = read('src/lib/brain/outcomeTracker.ts');

  assert.match(route, /shouldDeliverRequestedMedia/);
  assert.match(route, /reconcilePendingPayments/);
  assert.doesNotMatch(route, /available\.length > 0 \? available : candidateList/);
  assert.match(route, /mediaSuppressedForRepetition = true/);
  assert.match(webhook, /findPaymentMessageForWebhook/);
  assert.match(dashboard, /\/api\/admin\/payment-sync/);
  assert.match(syncRoute, /reconcilePendingPayments/);
  assert.match(reconciliationSource, /counted: true/);
  assert.match(reconciliationSource, /getCommercialOffer/);
  assert.match(reconciliationSource, /payment_confirmation_claimed/);
  assert.match(reconciliationSource, /fulfillment_write_failed/);
  assert.match(reconciliationSource, /paid_needs_manual_review/);
  assert.match(reconciliationSource, /fulfillmentOrderMarkedPaid/);
  assert.match(reconciliationSource, /confirmation_dispatch_state:\s*'processing'/);
  assert.match(reconciliationSource, /confirmation_dispatch_state:\s*'notification_reserved'/);
  assert.match(reconciliationSource, /sendTelegramMessageStrict/);
  assert.match(route, /notify:\s*true,\s*\n\s*botToken,\s*\n\s*telegramChatId:\s*chatId/);
  assert.match(customOrdersSource, /ignoreDuplicates:\s*true/);
  assert.match(customOrdersSource, /\['in_progress', 'delivered', 'cancelled'\]/);
  assert.match(route, /isPreviewSemanticallyRelevant\(previewRow, requestedPreviewSpec\.tags\)/);
  assert.match(route, /const lastPayMsg = explicitlyReferencedPayment\s*\|\|\s*currentOrderPayment/);
  assert.match(eventStoreSource, /claimLeadEventSafe/);
  assert.match(eventStoreSource, /reserveLeadEventClaimSafe/);
  assert.match(eventStoreSource, /claim_token/);
  assert.match(eventStoreSource, /23505|duplicate key/);
  assert.match(migration, /lead_events_idempotency_idx/);
  const newPixBlock = route.slice(route.indexOf("if (payment && payment.pixCopiaCola)"));
  assert.ok(newPixBlock.indexOf('paymentRecordWrite') >= 0);
  assert.ok(newPixBlock.indexOf('paymentRecordWrite') < newPixBlock.indexOf('ta aqui o pix`'));
  assert.match(reconciliationSource, /trackPaymentOutcomeSafe/);
  assert.match(outcomeSource, /conversation_continued/);
  assert.match(outcomeSource, /repeat_purchase/);
  assert.match(route, /responseOutcomePromise/);

  console.log('PAYMENT_PREVIEW_CHECK_OK payment=1 catalog_integrity=1 durable_before_send=1 claim_dedupe=1 fulfillment_repair=2 webhook=1 panel=1 explicit_media=1 direct_preview_relevance=1 unique_media=1 explicit_pix_priority=1 order_status_monotonic=1 outcomes=1');
} catch (error) {
  console.error(`PAYMENT_PREVIEW_CHECK_FAIL ${error.message}`);
  process.exitCode = 1;
}
