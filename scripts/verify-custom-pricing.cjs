const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/lib/salesTiming.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText;
const record = { exports: {} };
const commercialFilename = path.resolve(__dirname, '../src/lib/commercialCatalog.ts');
const commercialCompiled = ts.transpileModule(fs.readFileSync(commercialFilename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: commercialFilename,
}).outputText;
const commercialRecord = { exports: {} };
new Function('require', 'module', 'exports', commercialCompiled)(require, commercialRecord, commercialRecord.exports);
const commercial = commercialRecord.exports;
new Function('require', 'module', 'exports', compiled)(
  (name) => name === '@/lib/commercialCatalog' ? commercial : require(name), record, record.exports,
);
const { buildModelPricedCustomOffer } = record.exports;

assert.equal(buildModelPricedCustomOffer(null, 'pedido'), null);
assert.equal(buildModelPricedCustomOffer(-10, 'pedido'), null);
assert.equal(buildModelPricedCustomOffer(2, 'pedido').value, 5);
assert.equal(buildModelPricedCustomOffer(67.345, 'vídeo específico').value, 67.35);
assert.equal(buildModelPricedCustomOffer(67.345, 'vídeo específico').tier, 'core');
assert.equal(buildModelPricedCustomOffer(99999, 'pedido').value, 5000);
assert.equal(buildModelPricedCustomOffer(120, 'pedido').valueSource, 'model_proposed');

const routeSource = fs.readFileSync(path.resolve(__dirname, '../src/app/api/process-message/route.ts'), 'utf8');
const actionsSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/aiActions.ts'), 'utf8');
assert.match(routeSource, /const modelCanPriceCustom = salesTiming\.activeProduct === 'custom_request'/);
assert.match(routeSource, /PREÇO PERSONALIZADO LIVRE/);
assert.match(routeSource, /buildModelPricedCustomOffer\(modelProposedValue, salesTiming\.customRequestBrief\)/);
assert.match(routeSource, /if \(modelPricedOffer\) offerPlan = modelPricedOffer/);
assert.match(routeSource, /sales_active_order: activeSalesOrder/);
assert.match(actionsSource, /allowModelCustomPrice\?: boolean/);
assert.match(actionsSource, /Esse valor vira a oferta autoritativa após validação do backend/);

console.log('CUSTOM_PRICING_OK freedom=1 backend_range=5-5000 runtime_bridge=1 persisted_offer=1');
