const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(process.env.TARGET_ROOT || process.cwd());
const load = (relativePath) => {
  const filename = path.join(root, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(require, module, module.exports, filename, path.dirname(filename));
  return module.exports;
};

const orchestration = load('src/lib/aiOrchestration.ts');
for (const paid of [0, 19.9, 100, 200]) {
  const plan = orchestration.resolveAiOrchestrationPlan(paid);
  assert.equal(plan.separateStrategy, false);
  assert.equal(plan.reviewMode, 'critical');
  assert.equal(plan.evaluator, false);
}

const sales = load('src/lib/salesTiming.ts');
assert.equal(sales.detectPaidProduct('quero comprar sua calcinha'), 'custom_request');
assert.equal(sales.detectPaidProduct('se eu te pagar vc grava isso pra mim?'), 'custom_request');
assert.equal(sales.detectPaidProduct('quero te mandar 40 pro ifood'), 'gift');
assert.equal(
  sales.detectPaidProduct('eu quero um vídeo seu de quatro mostrando o cuzinho'),
  'custom_video',
);

const custom = sales.evaluateSalesTiming({
  userText: 'quero comprar sua calcinha',
  totalPaid: 80,
  recentMessages: [],
  leadMemory: {},
});
assert.equal(custom.activeProduct, 'custom_request');
assert.equal(custom.offerPlan.product, 'custom_request');
assert.match(custom.customRequestBrief, /calcinha/i);

const checkout = sales.evaluateSalesTiming({
  userText: 'fechou manda o pix',
  totalPaid: 80,
  recentMessages: [{ sender: 'bot', content: 'faço esse pedido personalizado por R$ 99,90', created_at: new Date().toISOString() }],
  leadMemory: { metadata: {
    sales_nurture_product: 'custom_request',
    sales_nurture_updated_at: new Date().toISOString(),
    sales_custom_request_brief: 'calcinha conforme combinado',
    sales_active_order: sales.buildSalesOrderSnapshot({
      orderId: 'order:custom-request',
      plan: { ...custom.offerPlan, requestBrief: 'calcinha conforme combinado' },
      status: 'offered',
    }),
  } },
});
assert.equal(checkout.canGeneratePayment, true);
assert.equal(checkout.offerPlan.value, 99.9);
assert.match(checkout.customRequestBrief, /calcinha/i);

const offeredAt = new Date();
const firstVideoOrder = sales.buildSalesOrderSnapshot({
  orderId: 'order:first-video',
  plan: {
    product: 'custom_video',
    tier: 'core',
    value: 19.9,
    description: 'Video Personalizado Lari',
    format: 'video combinado',
    explicitBudget: null,
    valueSource: 'standard',
    requestBrief: null,
  },
  status: 'offered',
  now: offeredAt,
});
const acceptedVideo = sales.evaluateSalesTiming({
  userText: 'fechou, manda sua chave pix',
  now: new Date(offeredAt.getTime() + 60_000),
  recentMessages: [{ sender: 'bot', content: 'uma oferta antiga por R$ 29,90', created_at: offeredAt.toISOString() }],
  leadMemory: { metadata: { sales_active_order: firstVideoOrder } },
});
assert.equal(acceptedVideo.activeProduct, 'custom_video');
assert.equal(acceptedVideo.canGeneratePayment, true);
assert.equal(acceptedVideo.offerPlan.value, 19.9);
assert.equal(acceptedVideo.activeOrder.orderId, 'order:first-video');

const paidOrderDoesNotReopen = sales.evaluateSalesTiming({
  userText: 'manda o pix de novo',
  recentMessages: [{ sender: 'bot', content: 'o video fica R$ 19,90', created_at: new Date().toISOString() }],
  leadMemory: { metadata: {
    sales_nurture_product: 'custom_video',
    sales_nurture_updated_at: new Date().toISOString(),
  } },
});
assert.equal(paidOrderDoesNotReopen.canGeneratePayment, false);

const secondVideoOrder = sales.buildSalesOrderSnapshot({
  orderId: 'order:second-video',
  plan: acceptedVideo.offerPlan,
  status: 'accepted',
  previous: null,
  now: new Date(offeredAt.getTime() + 2 * 24 * 60 * 60_000),
});
assert.notEqual(firstVideoOrder.orderId, secondVideoOrder.orderId);
assert.equal(sales.canonicalizeSalesOfferMessages(['fica R$ 29,90'], 19.9)[0], 'fica R$ 19,90');
assert.equal(sales.detectPaidProduct('manda um áudio gemendo meu nome'), 'erotic_audio');
assert.equal(sales.detectPaidProduct('geme o meu nome bem baixinho'), 'erotic_audio');

const route = fs.readFileSync(path.join(root, 'src/app/api/process-message/route.ts'), 'utf8');
const gateway = fs.readFileSync(path.join(root, 'src/lib/gemini.ts'), 'utf8');
const gatewayRouter = fs.readFileSync(path.join(root, 'src/lib/aiGatewayRouter.ts'), 'utf8');
const prompts = fs.readFileSync(path.join(root, 'src/lib/lariConversationPrompts.ts'), 'utf8');
const types = fs.readFileSync(path.join(root, 'src/types.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'custom_orders_migration.sql'), 'utf8');
assert.match(route, /recordCustomOrderSafe/);
assert.match(route, /const idempotencyKey = `\$\{session\.id\}:\$\{orderId\}`/);
assert.doesNotMatch(route, /aiResponse\.payment_details\?\.value \?\? inferredValue/);
assert.match(route, /payment_data\?\.order_id/);
assert.match(route, /sendMessageToGemini\(session\.id, finalUserMessage/);
assert.doesNotMatch(route, /Primeiro contato via \/start: usando saudação inicial padrão sem IA/);
assert.match(route, /const isActualFirstRelationshipTurn = !lastBotMsg/);
assert.match(gateway, /const reviewShouldReplace = reviewedMessages\.length > 0/);
assert.match(gateway, /review\?\.approved === false \|\| reviewIssues\.length > 0/);
assert.match(prompts, /Aprovar significa preservar/);
assert.doesNotMatch(gateway, /strategyCallPromise/);
assert.match(prompts, /MASTER BRAIN ÚNICO DA LARI/);
assert.match(prompts, /Responda sempre em 2 a 4 balões curtos/);
assert.match(gateway, /thinking = \{ type: 'disabled' \}/);
assert.doesNotMatch(gateway, /const isRetryable = gateway\.provider === 'bai'/);
assert.match(gatewayRouter, /timeoutMs: 10_000/);
assert.match(route, /aiRequestedVoiceAction = aiResponse\.action === 'send_voice_reply'/);
assert.match(route, /aiSelectedVoice = aiRequestedVoiceAction && conversionVoiceMoment/);
assert.match(prompts, /FERRAMENTAS REAIS DO BACKEND/);
assert.match(types, /"send_voice_reply"/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS custom_orders/i);
assert.ok(fs.existsSync(path.join(root, 'src/app/admin/orders/page.tsx')));

const quality = load('src/lib/conversationQuality.ts');
assert.doesNotMatch(
  quality.buildConversationRecoveryMessages({ userText: 'oi amor' })[0],
  /agora eu entendi|peguei seu ponto/i,
);

const stateBuilder = fs.readFileSync(path.join(root, 'src/lib/brain/stateBuilder.ts'), 'utf8');
const memoryRetriever = fs.readFileSync(path.join(root, 'src/lib/brain/memoryRetriever.ts'), 'utf8');
const eventStore = fs.readFileSync(path.join(root, 'src/lib/brain/eventStore.ts'), 'utf8');
assert.match(stateBuilder, /gapHours/);
assert.match(stateBuilder, /returning_day.*returning_days.*reactivation/);
assert.match(stateBuilder, /\.in\('status', \['active', 'uncertain'\]\)/);
assert.match(memoryRetriever, /\['active', 'uncertain'\]\.includes/);
assert.match(eventStore, /status: 'superseded'/);

console.log('MASTER_BRAIN_FAST_OK primary_calls=1 adaptive_review=1 custom_requests=1 multigateway_fallback=1 temporal_state=1 memory_v2=1');
