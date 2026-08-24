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
  assert.equal(plan.separateStrategy, true);
  assert.equal(plan.reviewMode, 'always');
  assert.equal(plan.evaluator, false);
}

const sales = load('src/lib/salesTiming.ts');
assert.equal(sales.detectPaidProduct('quero comprar sua calcinha'), 'custom_request');
assert.equal(sales.detectPaidProduct('se eu te pagar vc grava isso pra mim?'), 'custom_request');
assert.equal(sales.detectPaidProduct('quero te mandar 40 pro ifood'), 'gift');

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
  leadMemory: { metadata: { sales_nurture_product: 'custom_request', sales_nurture_updated_at: new Date().toISOString(), sales_custom_request_brief: 'calcinha conforme combinado' } },
});
assert.equal(checkout.canGeneratePayment, true);
assert.equal(checkout.offerPlan.value, 99.9);
assert.match(checkout.customRequestBrief, /calcinha/i);

const route = fs.readFileSync(path.join(root, 'src/app/api/process-message/route.ts'), 'utf8');
const gateway = fs.readFileSync(path.join(root, 'src/lib/gemini.ts'), 'utf8');
const gatewayRouter = fs.readFileSync(path.join(root, 'src/lib/aiGatewayRouter.ts'), 'utf8');
const prompts = fs.readFileSync(path.join(root, 'src/lib/lariConversationPrompts.ts'), 'utf8');
const types = fs.readFileSync(path.join(root, 'src/types.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'custom_orders_migration.sql'), 'utf8');
assert.match(route, /recordCustomOrderSafe/);
assert.match(route, /sendMessageToGemini\(session\.id, finalUserMessage/);
assert.doesNotMatch(route, /Primeiro contato via \/start: usando saudação inicial padrão sem IA/);
assert.match(route, /const isActualFirstRelationshipTurn = !lastBotMsg/);
assert.match(gateway, /if \(reviewedMessages\.length > 0\)/);
assert.doesNotMatch(gateway, /review\.approved === false && reviewedMessages\.length/);
assert.match(gateway, /strategyCallPromise/);
assert.match(gateway, /thinking = \{ type: 'disabled' \}/);
assert.doesNotMatch(gateway, /const isRetryable = gateway\.provider === 'bai'/);
assert.match(gatewayRouter, /timeoutMs: 10_000/);
assert.match(route, /aiSelectedVoice = aiResponse\.action === 'send_voice_reply'/);
assert.match(prompts, /FERRAMENTAS REAIS DO BACKEND/);
assert.match(types, /"send_voice_reply"/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS custom_orders/i);
assert.ok(fs.existsSync(path.join(root, 'src/app/admin/orders/page.tsx')));

const quality = load('src/lib/conversationQuality.ts');
assert.doesNotMatch(
  quality.buildConversationRecoveryMessages({ userText: 'oi amor' })[0],
  /agora eu entendi|peguei seu ponto/i,
);

console.log('THREE_BRAIN_COMMERCE_OK layers=3 all_leads=1 custom_requests=1 multigateway_queue=1 temporal_state=1');
