const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const cache = new Map();
const aliases = {
  '@/lib/commercialCatalog': 'src/lib/commercialCatalog.ts',
  '@/lib/funnelEngine': 'src/lib/funnelEngine.ts',
  '@/lib/salesTiming': 'src/lib/salesTiming.ts',
};
const loadTs = (relative) => {
  const filename = path.isAbsolute(relative) ? relative : path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const record = { exports: {} };
  cache.set(filename, record);
  new Function('require', 'module', 'exports', output)(
    (id) => aliases[id] ? loadTs(aliases[id]) : require(id), record, record.exports,
  );
  return record.exports;
};

const catalog = loadTs('src/lib/commercialCatalog.ts');
const funnelEngine = loadTs('src/lib/funnelEngine.ts');
const sales = loadTs('src/lib/salesTiming.ts');
const now = new Date('2026-09-08T15:00:00.000Z');

assert.deepEqual(funnelEngine.FUNNEL_STAGES, [
  'opening', 'rapport', 'context', 'bed_preview', 'warming', 'desire',
  'strong_preview', 'offer', 'objection', 'negotiation', 'order_bump',
  'checkout', 'payment_pending', 'fulfillment', 'post_purchase', 'cooldown',
]);

assert.equal(funnelEngine.resolveFunnelState({ userText: '/start' }).stage, 'opening');
assert.equal(funnelEngine.resolveFunnelState({ userText: 'cadê meu acesso?', activeProduct: 'vip' }).stage, 'fulfillment');
assert.equal(funnelEngine.resolveFunnelState({ userText: 'quero ver mais', metadata: { funnel_preview_count: 0 } }).stage, 'bed_preview');
assert.equal(funnelEngine.resolveFunnelState({ userText: 'quero ver mais', metadata: { funnel_preview_count: 2 } }).stage, 'strong_preview');
assert.equal(funnelEngine.resolveFunnelState({ userText: 'quero ver mais', metadata: { funnel_preview_count: 3 } }).preview.exceptionalOnly, true);

const monthlyItems = catalog.buildCommercialLineItems(catalog.COMMERCIAL_CATALOG.vip_monthly, true);
assert.equal(monthlyItems.length, 2);
assert.equal(catalog.totalCommercialLineItems(monthlyItems), 3990);
assert.match(catalog.renderVipOrderBumpMessage(), /R\$ 10,00/);

const negotiated = sales.evaluateSalesTiming({ userText: 'quero o mensal, tenho 20 reais pra pagar', now });
assert.equal(negotiated.selectedSku, 'vip_monthly');
assert.equal(negotiated.offerPlan.value, 20);
assert.equal(negotiated.funnel.stage, 'negotiation');
assert.equal(negotiated.fixedCatalogBudgetGap, false);

const belowVipFloor = sales.evaluateSalesTiming({ userText: 'quero o mensal, só tenho 14', now });
assert.equal(belowVipFloor.fixedVipBudgetGap, true);
assert.equal(belowVipFloor.canGeneratePayment, false);

const migrateHighTier = sales.evaluateSalesTiming({ userText: 'quero o vitalício, tenho 20 reais pra pagar', now });
assert.equal(migrateHighTier.selectedSku, 'vip_monthly');
assert.equal(migrateHighTier.offerPlan.value, 20);
assert.equal(migrateHighTier.canGeneratePayment, false);

const acceptedVip = sales.evaluateSalesTiming({ userText: 'quero o mensal', now });
assert.equal(acceptedVip.funnel.orderBump.shouldOffer, true);
assert.equal(acceptedVip.funnel.stage, 'order_bump');
assert.equal(acceptedVip.canGeneratePayment, false);
assert.equal(acceptedVip.metadataPatch.funnel_order_bump_status, 'none');
const offeredOrder = sales.buildSalesOrderSnapshot({ orderId: 'vip:monthly', plan: acceptedVip.offerPlan, status: 'offered', now });

const bumpAccepted = sales.evaluateSalesTiming({
  userText: 'sim', now: new Date(now.getTime() + 60_000),
  leadMemory: { metadata: { sales_active_order: offeredOrder, funnel_order_bump_status: 'offered' } },
});
assert.equal(bumpAccepted.funnel.orderBump.status, 'accepted');
assert.equal(bumpAccepted.offerPlan.value, 39.90);
assert.equal(bumpAccepted.offerPlan.lineItems.length, 2);
assert.equal(bumpAccepted.canGeneratePayment, true);
const combinedOrder = sales.buildSalesOrderSnapshot({ orderId: 'vip:monthly:bump', plan: bumpAccepted.offerPlan, status: 'accepted', now });
assert.equal(sales.readActiveSalesOrder(combinedOrder, new Date(now.getTime() + 60_000)).amount, 39.90);

const bumpDeclined = sales.evaluateSalesTiming({
  userText: 'não', now: new Date(now.getTime() + 60_000),
  leadMemory: { metadata: { sales_active_order: offeredOrder, funnel_order_bump_status: 'offered' } },
});
assert.equal(bumpDeclined.funnel.orderBump.status, 'declined');
assert.equal(bumpDeclined.offerPlan.value, 29.90);
assert.equal(bumpDeclined.canGeneratePayment, true);

for (const userText of ['pode incluir', 'quero a foto']) {
  const accepted = sales.evaluateSalesTiming({ userText, now,
    leadMemory: { metadata: { sales_active_order: offeredOrder, funnel_order_bump_status: 'offered' } },
  });
  assert.equal(accepted.offerPlan.product, 'vip');
  assert.equal(accepted.offerPlan.value, 39.90);
  assert.equal(accepted.canGeneratePayment, true);
}
assert.equal(funnelEngine.resolvePendingAddonDecision('inclui uma chamada'), null);
const neutralAfterDecline = sales.evaluateSalesTiming({ userText: 'como funciona?', now,
  leadMemory: { metadata: { sales_active_order: offeredOrder, funnel_order_bump_status: 'declined' } },
});
assert.equal(neutralAfterDecline.canGeneratePayment, false);
const discountedOrder = sales.buildSalesOrderSnapshot({ orderId: 'discounted', plan: negotiated.offerPlan, status: 'offered', now });
const discountedAccepted = sales.evaluateSalesTiming({ userText: 'sim', now,
  leadMemory: { metadata: { sales_active_order: discountedOrder, funnel_order_bump_status: 'offered' } },
});
assert.equal(discountedAccepted.offerPlan.value, 30);
assert.equal(discountedAccepted.offerPlan.lineItems[0].value, 20);
assert.equal(sales.evaluateSalesTiming({ userText: 'quero o vitalício por 20 reais, manda o pix', now }).canGeneratePayment, false);

const photoRequestBeforePreview = sales.evaluateSalesTiming({
  userText: 'sério mesmo deixa eu ver a sua foto',
  now,
  recentMessages: [
    { sender: 'user', content: 'quero te ver', created_at: '2026-09-08T14:57:00.000Z' },
    { sender: 'bot', content: 'vai ter que aguentar meu ritmo', created_at: '2026-09-08T14:58:00.000Z' },
  ],
  leadMemory: { metadata: { funnel_preview_count: 0 } },
});
assert.equal(photoRequestBeforePreview.proactiveVipOffer, false);
assert.equal(photoRequestBeforePreview.canPitchPrice, false);
assert.equal(photoRequestBeforePreview.offerPlan, null);

const explicitVipRequestBeforePreview = sales.evaluateSalesTiming({ userText: 'quanto custa seu vip?', now });
assert.equal(explicitVipRequestBeforePreview.activeProduct, 'vip');
assert.equal(explicitVipRequestBeforePreview.canPitchPrice, true);

const immediateCheckout = sales.evaluateSalesTiming({ userText: 'quero o mensal, manda o pix', now });
assert.equal(immediateCheckout.funnel.orderBump.shouldOffer, false);
assert.equal(immediateCheckout.canGeneratePayment, true);

assert.equal(sales.buildModelPricedCustomOffer(2, 'pedido').value, 15);
assert.equal(sales.buildModelPricedCustomOffer(14.99, 'pedido').value, 15);

console.log('COMMERCIAL_FUNNEL_OK stages=16 vip_floor=15 custom_floor=15 bump=10 support_priority=1');
const exactPlan = sales.evaluateSalesTiming({ userText: 'quero mensal por 22,38 reais', now }).offerPlan;
const exactOrder = sales.buildSalesOrderSnapshot({ orderId: 'exact-2238', plan: exactPlan, status: 'offered', now });
const exactMemory = { metadata: { sales_active_order: exactOrder, funnel_order_bump_status: 'declined' } };
for (const userText of ['entao vai', 'então vai!', 'então pode mandar']) {
  const result = sales.evaluateSalesTiming({ userText, leadMemory: exactMemory, now });
  assert.equal(result.canGeneratePayment, true, userText);
  assert.equal(result.offerPlan.value, 22.38);
}
assert.equal(sales.evaluateSalesTiming({ userText: 'entao vai', now }).canGeneratePayment, false);
const question = sales.evaluateSalesTiming({ userText: 'e a foto personalizada com meu nome?', leadMemory: exactMemory, now });
assert.equal(question.activeOrder.orderId, exactOrder.orderId);
assert.equal(question.offerPlan.value, 22.38);
assert.equal(question.canGeneratePayment, false);
assert.equal(question.addonQuestion, true);
