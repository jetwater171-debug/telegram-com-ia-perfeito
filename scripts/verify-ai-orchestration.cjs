const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const loadPureTypeScriptModule = (relativePath) => {
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
    const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', compiled);
    execute(require, loadedModule, loadedModule.exports, filename, path.dirname(filename));
    return loadedModule.exports;
};

const {
    AI_ORCHESTRATION_THRESHOLDS,
    resolveAiOrchestrationPlan,
    shouldRunAiReview,
} = loadPureTypeScriptModule('../src/lib/aiOrchestration.ts');
const { evaluateSalesTiming, VIP_PRICE } = loadPureTypeScriptModule('../src/lib/salesTiming.ts');

const starter = resolveAiOrchestrationPlan(0);
assert.equal(starter.tier, 'starter');
assert.equal(starter.separateStrategy, true);
assert.equal(starter.reviewMode, 'critical');
assert.equal(starter.evaluator, false);
assert.equal(starter.historyMessageLimit, 80);
assert.equal(starter.historyMaxEntries, 80);
assert.equal(shouldRunAiReview(starter, true), true);

assert.equal(resolveAiOrchestrationPlan(AI_ORCHESTRATION_THRESHOLDS.buyer - 0.01).tier, 'starter');

const buyer = resolveAiOrchestrationPlan(AI_ORCHESTRATION_THRESHOLDS.buyer);
assert.equal(buyer.tier, 'buyer');
assert.equal(buyer.separateStrategy, true);
assert.equal(buyer.historyMaxEntries, 80);
assert.equal(shouldRunAiReview(buyer, false), false);
assert.equal(shouldRunAiReview(buyer, true), true);

const premium = resolveAiOrchestrationPlan(AI_ORCHESTRATION_THRESHOLDS.premium);
assert.equal(premium.tier, 'premium');
assert.equal(shouldRunAiReview(premium, false), true);
assert.equal(premium.evaluator, false);
assert.equal(premium.historyMaxEntries, 100);

const elite = resolveAiOrchestrationPlan(AI_ORCHESTRATION_THRESHOLDS.elite);
assert.equal(elite.tier, 'elite');
assert.equal(elite.evaluator, true);
assert.equal(elite.historyMessageLimit, 120);
assert.equal(elite.historyMaxEntries, 120);

const vipPriceQuestion = evaluateSalesTiming({ userText: 'quanto custa o vip?' });
assert.equal(vipPriceQuestion.activeProduct, 'vip');
assert.equal(vipPriceQuestion.offerPlan?.value, VIP_PRICE);
assert.equal(vipPriceQuestion.canGeneratePayment, false);

const vipCheckout = evaluateSalesTiming({ userText: 'quero o vip, manda o pix' });
assert.equal(vipCheckout.canGeneratePayment, true);
assert.equal(vipCheckout.offerPlan?.value, VIP_PRICE);

const vipBudgetGap = evaluateSalesTiming({ userText: 'so tenho 10 pra pagar o vip, manda o pix' });
assert.equal(vipBudgetGap.fixedVipBudgetGap, true);
assert.equal(vipBudgetGap.canGeneratePayment, false);
assert.equal(vipBudgetGap.offerPlan?.value, VIP_PRICE);

console.log('AI_ORCHESTRATION_OK starter=brain+lari history=80 buyer=2 premium=3 elite=4 vip=19.90');
