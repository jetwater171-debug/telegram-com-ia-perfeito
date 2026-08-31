const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(process.env.TARGET_ROOT || process.cwd());

// Carrega o módulo de reconciliação em memória. Todos os providers externos
// são stubs: este contrato nunca consulta gateway, Supabase ou Telegram reais.
const loadTypeScript = (relativePath, stubs = {}) => {
  const filename = path.join(root, relativePath);
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

const clone = (value) => JSON.parse(JSON.stringify(value));

const createFakeEventStoreSupabase = () => {
  const state = { row: null };
  const from = () => {
    let operation = 'select';
    let values = null;
    const filters = [];
    const matches = () => Boolean(state.row) && filters.every(({ key, value }) => String(state.row?.[key] ?? '') === String(value ?? ''));
    const execute = async (single = false) => {
      const matched = matches();
      if (operation === 'update' && matched) Object.assign(state.row, clone(values));
      const data = matched ? clone(state.row) : null;
      return { data: single ? data : (data ? [data] : []), error: null };
    };
    const query = {
      select() { if (operation !== 'update') operation = 'select'; return query; },
      eq(key, value) { filters.push({ key, value }); return query; },
      maybeSingle() { return execute(true); },
      insert(nextValues) {
        if (state.row) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
        state.row = { id: 'lead-event-1', ...clone(nextValues) };
        return Promise.resolve({ data: clone(state.row), error: null });
      },
      update(nextValues) { operation = 'update'; values = nextValues; return query; },
      then(resolve, reject) { return execute(false).then(resolve, reject); },
    };
    return query;
  };
  return { client: { from }, state };
};

const createFakeCustomOrdersSupabase = (initialStatus) => {
  const state = {
    row: initialStatus ? {
      id: 'custom-order-1',
      session_id: 'session-1',
      payment_id: 'payment-1',
      status: initialStatus,
      request_brief: 'briefing original',
      amount: 49.9,
    } : null,
  };
  const matches = (filters) => filters.every(({ key, value }) => String(state.row?.[key] ?? '') === String(value ?? ''));
  const from = () => {
    let operation = 'select';
    let values = null;
    const filters = [];
    const execute = async (single = false) => {
      const matched = state.row && matches(filters);
      if (operation === 'update' && matched) Object.assign(state.row, clone(values));
      return { data: single ? (matched ? clone(state.row) : null) : (matched ? [clone(state.row)] : []), error: null };
    };
    const query = {
      select() { operation = 'select'; return query; },
      eq(key, value) { filters.push({ key, value }); return query; },
      maybeSingle() { return execute(true); },
      update(nextValues) { operation = 'update'; values = nextValues; return query; },
      insert(nextValues) {
        if (state.row) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
        state.row = { id: 'custom-order-1', ...clone(nextValues) };
        return Promise.resolve({ data: clone(state.row), error: null });
      },
      then(resolve, reject) { return execute(false).then(resolve, reject); },
    };
    return query;
  };
  return { client: { from }, state };
};

const createFakeSupabase = (initialPaymentData, effectCounts) => {
  const database = {
    messages: [{
      id: 'message-payment-1',
      session_id: 'session-1',
      content: '[PIX GENERATED] ID: payment-1',
      payment_data: clone(initialPaymentData),
      created_at: '2026-08-28T12:00:00.000Z',
    }],
    sessions: [{ id: 'session-1', total_paid: 0, lead_score: 10, telegram_chat_id: null }],
    bot_settings: [],
    funnel_events: [],
  };

  const matches = (row, filters) => filters.every((filter) => {
    if (filter.type === 'eq') return String(row?.[filter.key] ?? '') === String(filter.value ?? '');
    if (filter.type === 'ilike') return String(row?.[filter.key] || '').toLowerCase().includes(filter.value.toLowerCase().replace(/%/g, ''));
    return true;
  });

  const execute = async (table, operation, payload, filters) => {
    const rows = database[table] || [];
    const matched = rows.filter((row) => matches(row, filters));
    if (operation === 'select') {
      if (payload.single) return { data: clone(matched[0] || null), error: null };
      return { data: clone(matched), error: null };
    }
    if (operation === 'update') {
      matched.forEach((row) => Object.assign(row, clone(payload.values)));
      return { data: clone(matched), error: null };
    }
    if (operation === 'insert') {
      const values = Array.isArray(payload.values) ? payload.values : [payload.values];
      values.forEach((value) => {
        if (table === 'messages' && String(value.content || '').includes('PAGAMENTO CONFIRMADO')) {
          effectCounts.confirmationMessages += 1;
        }
        if (table === 'funnel_events' && value.step === 'PAYMENT_CONFIRMED') {
          effectCounts.confirmationFunnelEvents += 1;
        }
        if (database[table]) database[table].push(clone(value));
      });
      return { data: clone(values), error: null };
    }
    return { data: null, error: null };
  };

  const from = (table) => {
    let operation = 'select';
    let payload = {};
    const filters = [];
    const query = {
      select(_columns) { operation = 'select'; return query; },
      eq(key, value) { filters.push({ type: 'eq', key, value }); return query; },
      ilike(key, value) { filters.push({ type: 'ilike', key, value: String(value) }); return query; },
      not() { return query; },
      limit() { return query; },
      order() { return query; },
      maybeSingle() { payload.single = true; return execute(table, operation, payload, filters); },
      update(values) { operation = 'update'; payload.values = values; return query; },
      insert(values) { operation = 'insert'; payload.values = values; return query; },
      upsert(values) { operation = 'insert'; payload.values = values; return query; },
      then(resolve, reject) { return execute(table, operation, payload, filters).then(resolve, reject); },
    };
    return query;
  };

  return { from, database };
};

const runCase = async ({
  paymentData,
  recordCustomOrder,
  markCustomOrder = true,
  claim,
  concurrent = false,
  notify = false,
  telegramFails = false,
  reservation = 'reserved',
}) => {
  const effectCounts = {
    confirmationMessages: 0,
    confirmationFunnelEvents: 0,
    appendEvents: 0,
    paymentOutcomes: 0,
    customOrderWrites: 0,
    telegramConfirmations: 0,
    externalReservations: 0,
  };
  const fakeSupabase = createFakeSupabase(paymentData, effectCounts);
  let claimUsed = false;
  const claimStub = async () => {
    if (claim === 'unavailable') return 'unavailable';
    if (claim === 'duplicate') return 'duplicate';
    if (claimUsed) return 'duplicate';
    claimUsed = true;
    return 'claimed';
  };
  const reconciliation = loadTypeScript('src/lib/paymentReconciliation.ts', {
    '@/lib/supabaseServer': { supabaseServer: fakeSupabase },
    '@/lib/paymentGatewayService': {
      getPaymentStatusMultiGateway: async () => ({ paid: true, status: 'approved' }),
      normalizePaymentGatewayId: (value) => value || 'wiinpay',
    },
    '@/lib/leadScoring': { markLeadPaid: (value) => Number(value || 0) + 100 },
    '@/lib/telegram': {
      sendTelegramMessageStrict: async () => {
        effectCounts.telegramConfirmations += 1;
        if (telegramFails) throw new Error('telegram_test_failure');
      },
    },
    '@/lib/paymentStatus': loadTypeScript('src/lib/paymentStatus.ts'),
    '@/lib/brain/eventStore': {
      appendLeadEventSafe: async () => { effectCounts.appendEvents += 1; return 'event-1'; },
      claimLeadEventSafe: claimStub,
      patchRealityStateSafe: async () => true,
      reserveLeadEventClaimSafe: async () => {
        effectCounts.externalReservations += 1;
        return reservation;
      },
    },
    '@/lib/brain/outcomeTracker': {
      trackPaymentOutcomeSafe: async () => { effectCounts.paymentOutcomes += 1; return {}; },
    },
    '@/lib/brain/previewBandit': { recordPreviewPurchaseSafe: async () => undefined },
    '@/lib/customOrders': {
      recordCustomOrderSafe: async () => {
        effectCounts.customOrderWrites += 1;
        return recordCustomOrder;
      },
      markCustomOrderPaidSafe: async () => markCustomOrder,
      markSessionSalesOrderPaidSafe: async () => true,
    },
  });
  const input = { id: 'message-payment-1', session_id: 'session-1' };
  const options = {
    notify,
    ...(notify ? { botToken: 'bot-token-test', telegramChatId: 'chat-test' } : {}),
    source: 'test',
    statusPayload: { paid: true, status: 'approved' },
  };
  let caughtError = null;
  let results = [];
  try {
    results = concurrent
      ? await Promise.all([
        reconciliation.reconcilePaymentMessage(input, options),
        reconciliation.reconcilePaymentMessage(input, options),
      ])
      : [await reconciliation.reconcilePaymentMessage(input, options)];
  } catch (error) {
    caughtError = error;
  }
  return { results, caughtError, effectCounts, paymentData: fakeSupabase.database.messages[0].payment_data, reconciliation, fakeSupabase };
};

(async () => {
  // -1. O CAS real do Event Store rejeita o owner antigo depois de um reclaim e
  // torna a fase notification_reserved irreversível.
  const eventStoreDb = createFakeEventStoreSupabase();
  const eventStore = loadTypeScript('src/lib/brain/eventStore.ts', {
    '@/lib/supabaseServer': { supabaseServer: eventStoreDb.client },
  });
  const claimInput = {
    sessionId: 'session-1', eventType: 'payment_confirmation_claimed', sourceId: 'payment-1',
    payload: { claim_token: 'owner-a', phase: 'processing' }, staleAfterMs: 1,
  };
  assert.equal(await eventStore.claimLeadEventSafe(claimInput), 'claimed');
  eventStoreDb.state.row.occurred_at = '2020-01-01T00:00:00.000Z';
  assert.equal(await eventStore.claimLeadEventSafe({
    ...claimInput,
    payload: { claim_token: 'owner-b', phase: 'processing' },
  }), 'claimed');
  assert.equal(await eventStore.reserveLeadEventClaimSafe({
    sessionId: 'session-1', eventType: claimInput.eventType, sourceId: 'payment-1', claimToken: 'owner-a',
  }), 'lost');
  assert.equal(await eventStore.reserveLeadEventClaimSafe({
    sessionId: 'session-1', eventType: claimInput.eventType, sourceId: 'payment-1', claimToken: 'owner-b',
  }), 'reserved');
  assert.equal(await eventStore.claimLeadEventSafe({
    ...claimInput,
    payload: { claim_token: 'owner-c', phase: 'processing' },
  }), 'reserved');

  // 0. Um reprocessamento pode atualizar o briefing, mas não rebaixa o estado
  // operacional que o admin já avançou para produção ou entrega.
  const deliveredStore = createFakeCustomOrdersSupabase('delivered');
  const customOrders = loadTypeScript('src/lib/customOrders.ts', {
    '@/lib/supabaseServer': { supabaseServer: deliveredStore.client },
  });
  assert.equal(await customOrders.recordCustomOrderSafe({
    sessionId: 'session-1', paymentId: 'payment-1', gateway: 'wiinpay',
    requestBrief: 'briefing atualizado', amount: 49.9, product: 'vip', orderId: 'order-1',
  }), true);
  assert.equal(deliveredStore.state.row.status, 'delivered');
  assert.equal(deliveredStore.state.row.request_brief, 'briefing atualizado');
  assert.equal(await customOrders.markCustomOrderPaidSafe('payment-1'), true);
  assert.equal(deliveredStore.state.row.status, 'delivered');

  // 0b. A tabela legada sem UNIQUE(payment_id) também grava o pedido: esse
  // caminho não depende de ON CONFLICT/UPSERT.
  const legacyStore = createFakeCustomOrdersSupabase(null);
  const legacyCustomOrders = loadTypeScript('src/lib/customOrders.ts', {
    '@/lib/supabaseServer': { supabaseServer: legacyStore.client },
  });
  assert.equal(await legacyCustomOrders.recordCustomOrderSafe({
    sessionId: 'session-1', paymentId: 'payment-1', gateway: 'wiinpay',
    requestBrief: 'briefing legado', amount: 29.9, product: 'vip', orderId: 'order-legacy',
  }), true);
  assert.equal(legacyStore.state.row.status, 'awaiting_payment');
  assert.equal(legacyStore.state.row.payment_id, 'payment-1');

  // 1. O SKU diz vitalício, mas o valor é mensal: contabiliza o pagamento e
  // encaminha para revisão manual, sem liberar o pacote errado.
  const mismatch = await runCase({
    paymentData: {
      paymentId: 'payment-1', gateway: 'wiinpay', paid: false, counted: false,
      product: 'vip', sku: 'vip_lifetime', value: 29.90, amount_cents: 2990,
      description: 'VIP Lari', order_id: 'order-1',
    },
    recordCustomOrder: true,
    claim: 'claimed',
  });
  assert.equal(mismatch.results[0].catalogMismatch, true);
  assert.equal(mismatch.paymentData.catalog_integrity, 'mismatch');
  assert.equal(mismatch.paymentData.fulfillment_status, 'paid_needs_manual_review');
  assert.match(mismatch.paymentData.last_status_payload.status, /approved/i);

  // 2. Duas confirmações simultâneas disputam o mesmo claim. Só a vencedora
  // executa o bloco de mensagem/evento/outcome de confirmação.
  const concurrent = await runCase({
    paymentData: {
      paymentId: 'payment-1', gateway: 'wiinpay', paid: false, counted: false,
      product: 'vip', sku: 'vip_lifetime', value: 49.90, amount_cents: 4990,
      description: 'VIP Vitalício Lari', order_id: 'order-1',
    },
    recordCustomOrder: true,
    claim: 'claimed',
    concurrent: true,
  });
  assert.equal(concurrent.results.filter((result) => result.freshlyConfirmed).length, 1);
  assert.equal(concurrent.effectCounts.confirmationMessages, 1);
  assert.equal(concurrent.effectCounts.confirmationFunnelEvents, 1);
  assert.equal(concurrent.effectCounts.appendEvents, 1);
  assert.equal(concurrent.effectCounts.paymentOutcomes, 1);

  // 3. Se custom_orders falhar, o pagamento permanece registrado com estado
  // reparável; a reconciliação pendente deve selecionar esse estado novamente.
  const failedOrder = await runCase({
    paymentData: {
      paymentId: 'payment-1', gateway: 'wiinpay', paid: false, counted: false,
      product: 'vip', sku: 'vip_lifetime', value: 49.90, amount_cents: 4990,
      description: 'VIP Vitalício Lari', order_id: 'order-1',
    },
    recordCustomOrder: false,
    claim: 'claimed',
  });
  assert.equal(failedOrder.results[0].fulfillmentOrderRecorded, false);
  assert.equal(failedOrder.paymentData.fulfillment_status, 'fulfillment_write_failed');
  assert.match(fs.readFileSync(path.join(root, 'src/lib/paymentReconciliation.ts'), 'utf8'), /fulfillmentNeedsRepair/);

  // 4. SKU e centavos coerentes passam sem mismatch e entram no fluxo normal
  // de entrega aguardando fulfillment do VIP comprado.
  const coherent = await runCase({
    paymentData: {
      paymentId: 'payment-1', gateway: 'wiinpay', paid: false, counted: false,
      product: 'vip', sku: 'vip_lifetime', value: 49.90, amount_cents: 4990,
      description: 'VIP Vitalício Lari', order_id: 'order-1',
    },
    recordCustomOrder: true,
    claim: 'claimed',
  });
  assert.equal(coherent.results[0].catalogMismatch, false);
  assert.equal(coherent.paymentData.catalog_integrity, 'valid');
  assert.equal(coherent.paymentData.fulfillment_status, 'paid_awaiting_fulfillment');
  assert.equal(coherent.results[0].fulfillmentReady, true);

  // 5. Persistir o pedido não basta: se a transição para pago falhar, o estado
  // fica explicitamente reparável e o poll tentará novamente.
  const failedPaidTransition = await runCase({
    paymentData: {
      paymentId: 'payment-1', gateway: 'wiinpay', paid: false, counted: false,
      product: 'vip', sku: 'vip_monthly', value: 29.90, amount_cents: 2990,
      description: 'VIP Mensal Lari', order_id: 'order-1',
    },
    recordCustomOrder: true,
    markCustomOrder: false,
    claim: 'claimed',
  });
  assert.equal(failedPaidTransition.results[0].fulfillmentOrderRecorded, true);
  assert.equal(failedPaidTransition.results[0].fulfillmentReady, false);
  assert.equal(failedPaidTransition.paymentData.fulfillment_status, 'fulfillment_write_failed');

  // 6. Ledger já contabilizado não impede uma confirmação que ainda não tinha
  // conseguido reservar seu claim.
  const countedBeforeClaim = await runCase({
    paymentData: {
      paymentId: 'payment-1', gateway: 'wiinpay', paid: true, counted: true,
      product: 'vip', sku: 'vip_monthly', value: 29.90, amount_cents: 2990,
      description: 'VIP Mensal Lari', order_id: 'order-1',
    },
    recordCustomOrder: true,
    claim: 'claimed',
  });
  assert.equal(countedBeforeClaim.results[0].freshlyConfirmed, true);
  const reconciliationSource = fs.readFileSync(path.join(root, 'src/lib/paymentReconciliation.ts'), 'utf8');
  assert.match(reconciliationSource, /staleAfterMs:\s*5\s*\*\s*60_000/);
  assert.match(reconciliationSource, /confirmation_dispatch_state:\s*'processing'/);
  assert.match(reconciliationSource, /confirmation_dispatch_state:\s*'notification_reserved'/);

  // 7. Depois que o envio Telegram foi reservado, uma repetição nunca entra no
  // bloco de efeitos. Uma falha ambígua fica para revisão em vez de duplicar.
  const reservedNotification = await runCase({
    paymentData: {
      paymentId: 'payment-1', gateway: 'wiinpay', paid: true, counted: true,
      product: 'vip', sku: 'vip_monthly', value: 29.90, amount_cents: 2990,
      description: 'VIP Mensal Lari', order_id: 'order-1',
      confirmation_dispatch_state: 'notification_reserved',
      confirmation_notification_reserved_at: '2026-08-28T12:01:00.000Z',
    },
    recordCustomOrder: true,
    claim: 'claimed',
  });
  assert.equal(reservedNotification.results[0].freshlyConfirmed, false);
  assert.equal(reservedNotification.effectCounts.confirmationMessages, 0);
  assert.equal(reservedNotification.effectCounts.confirmationFunnelEvents, 0);

  // 8. O reconciliador é o único responsável pelo Telegram. Sucesso completa;
  // falha após reserva permanece visível e nunca é marcada como concluída.
  const notified = await runCase({
    paymentData: {
      paymentId: 'payment-1', gateway: 'wiinpay', paid: false, counted: false,
      product: 'vip', sku: 'vip_monthly', value: 29.90, amount_cents: 2990,
      description: 'VIP Mensal Lari', order_id: 'order-1',
    },
    recordCustomOrder: true,
    claim: 'claimed',
    notify: true,
  });
  assert.equal(notified.caughtError, null);
  assert.equal(notified.effectCounts.telegramConfirmations, 1);
  assert.equal(notified.paymentData.confirmation_dispatch_state, 'completed');

  const failedNotification = await runCase({
    paymentData: {
      paymentId: 'payment-1', gateway: 'wiinpay', paid: false, counted: false,
      product: 'vip', sku: 'vip_monthly', value: 29.90, amount_cents: 2990,
      description: 'VIP Mensal Lari', order_id: 'order-1',
    },
    recordCustomOrder: true,
    claim: 'claimed',
    notify: true,
    telegramFails: true,
  });
  assert.match(String(failedNotification.caughtError?.message || ''), /telegram_test_failure/);
  assert.equal(failedNotification.effectCounts.telegramConfirmations, 1);
  assert.equal(failedNotification.paymentData.confirmation_dispatch_state, 'notification_reserved');
  assert.equal(failedNotification.paymentData.confirmation_completed_at, undefined);

  // 9. Se outro worker tomar o lease, o dono antigo perde o CAS antes do
  // Telegram. Mesmo numa confirmação concorrente, há uma única reserva/envio.
  const lostLease = await runCase({
    paymentData: {
      paymentId: 'payment-1', gateway: 'wiinpay', paid: false, counted: false,
      product: 'vip', sku: 'vip_monthly', value: 29.90, amount_cents: 2990,
      description: 'VIP Mensal Lari', order_id: 'order-1',
    },
    recordCustomOrder: true,
    claim: 'claimed',
    notify: true,
    reservation: 'lost',
  });
  assert.match(String(lostLease.caughtError?.message || ''), /claim_lost_before_notification/);
  assert.equal(lostLease.effectCounts.telegramConfirmations, 0);

  const concurrentNotification = await runCase({
    paymentData: {
      paymentId: 'payment-1', gateway: 'wiinpay', paid: false, counted: false,
      product: 'vip', sku: 'vip_monthly', value: 29.90, amount_cents: 2990,
      description: 'VIP Mensal Lari', order_id: 'order-1',
    },
    recordCustomOrder: true,
    claim: 'claimed',
    notify: true,
    concurrent: true,
  });
  assert.equal(concurrentNotification.caughtError, null);
  assert.equal(concurrentNotification.effectCounts.externalReservations, 1);
  assert.equal(concurrentNotification.effectCounts.telegramConfirmations, 1);

  console.log('PAYMENT_RECONCILIATION_CONTRACT_OK event_store_owner_cas=1 monotonic_order_status=1 mismatch=1 concurrent_claim=1 single_confirmation_block=1 repairable_fulfillment_failure=2 coherent_vip=1 counted_before_claim=1 retryable_processing=1 reserved_notification_no_resend=1 strict_notification=2 lease_owner_cas=2');
})().catch((error) => {
  console.error(`PAYMENT_RECONCILIATION_CONTRACT_FAIL ${error.stack || error.message}`);
  process.exitCode = 1;
});
