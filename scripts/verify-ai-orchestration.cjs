const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const loadPureTypeScriptModule = (relativePath, stubs = {}) => {
    const filename = path.resolve(__dirname, relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
        fileName: filename,
    }).outputText;
    const loadedModule = { exports: {} };
    const localRequire = (id) => Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : require(id);
    const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', compiled);
    execute(localRequire, loadedModule, loadedModule.exports, filename, path.dirname(filename));
    return loadedModule.exports;
};

const {
    AI_ORCHESTRATION_THRESHOLDS,
    resolveAiOrchestrationPlan,
    shouldRunAiReview,
} = loadPureTypeScriptModule('../src/lib/aiOrchestration.ts');
const commercialCatalog = loadPureTypeScriptModule('../src/lib/commercialCatalog.ts');
const { evaluateSalesTiming } = loadPureTypeScriptModule('../src/lib/salesTiming.ts', {
    '@/lib/commercialCatalog': commercialCatalog,
});
const { VIP_MONTHLY_PRICE } = commercialCatalog;

const starter = resolveAiOrchestrationPlan(0);
assert.equal(starter.tier, 'starter');
assert.equal(starter.separateStrategy, false);
assert.equal(starter.reviewMode, 'critical');
assert.equal(starter.evaluator, false);
assert.equal(starter.historyMessageLimit, 18);
assert.equal(starter.historyMaxEntries, 16);
assert.equal(shouldRunAiReview(starter, true), true);
assert.equal(shouldRunAiReview(starter, false), false);

assert.equal(resolveAiOrchestrationPlan(AI_ORCHESTRATION_THRESHOLDS.buyer - 0.01).tier, 'starter');

const buyer = resolveAiOrchestrationPlan(AI_ORCHESTRATION_THRESHOLDS.buyer);
assert.equal(buyer.tier, 'buyer');
assert.equal(buyer.separateStrategy, false);
assert.equal(buyer.reviewMode, 'critical');
assert.equal(buyer.historyMessageLimit, 22);
assert.equal(buyer.historyMaxEntries, 20);
assert.equal(shouldRunAiReview(buyer, false), false);
assert.equal(shouldRunAiReview(buyer, true), true);

const premium = resolveAiOrchestrationPlan(AI_ORCHESTRATION_THRESHOLDS.premium);
assert.equal(premium.tier, 'premium');
assert.equal(shouldRunAiReview(premium, false), false);
assert.equal(premium.evaluator, false);
assert.equal(premium.historyMessageLimit, 26);
assert.equal(premium.historyMaxEntries, 22);

const elite = resolveAiOrchestrationPlan(AI_ORCHESTRATION_THRESHOLDS.elite);
assert.equal(elite.tier, 'elite');
assert.equal(elite.evaluator, false);
assert.equal(elite.historyMessageLimit, 30);
assert.equal(elite.historyMaxEntries, 24);

const vipPriceQuestion = evaluateSalesTiming({ userText: 'quanto custa o vip?' });
assert.equal(vipPriceQuestion.activeProduct, 'vip');
assert.equal(vipPriceQuestion.selectedSku, null);
assert.equal(vipPriceQuestion.requiresSkuSelection, true);
assert.equal(vipPriceQuestion.mustPresentVipMenu, true);
assert.equal(vipPriceQuestion.offerPlan, null);
assert.equal(vipPriceQuestion.canGeneratePayment, false);

const vipCheckout = evaluateSalesTiming({ userText: 'quero o vip, manda o pix' });
assert.equal(vipCheckout.canGeneratePayment, false);
assert.equal(vipCheckout.selectedSku, null);
assert.equal(vipCheckout.offerPlan, null);

const monthlyCheckout = evaluateSalesTiming({ userText: 'quero o mensal, manda o pix' });
assert.equal(monthlyCheckout.selectedSku, 'vip_monthly');
assert.equal(monthlyCheckout.canGeneratePayment, true);
assert.equal(monthlyCheckout.offerPlan?.value, VIP_MONTHLY_PRICE);

const vipBudgetGap = evaluateSalesTiming({ userText: 'so tenho 10 pra pagar o vip mensal, manda o pix' });
assert.equal(vipBudgetGap.fixedVipBudgetGap, true);
assert.equal(vipBudgetGap.canGeneratePayment, false);
assert.equal(vipBudgetGap.offerPlan?.value, VIP_MONTHLY_PRICE);

console.log('AI_ORCHESTRATION_OK master_brain=1 compact_history=1 vip_menu=1 explicit_sku=1 budget_gate=1');
