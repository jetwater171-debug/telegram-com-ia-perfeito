const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/lib/modelReplyContract.ts');
const source = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
}).outputText;
const fakeRequire = (specifier) => {
    if (specifier === '@/lib/aiMessageNormalization') {
        return { normalizeAiMessageList: (value) => Array.isArray(value) ? value.map(String).filter(Boolean) : [] };
    }
    if (specifier === '@/lib/commercialCatalog') {
        return { VIP_OFFERS: [{ amountCents: 2990 }, { amountCents: 4990 }, { amountCents: 7990 }] };
    }
    if (specifier === '@/lib/brain/hardValidator') return { isExplicitSexualContext: () => false };
    throw new Error(`unexpected import: ${specifier}`);
};
const loadedModule = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
    fakeRequire, loadedModule, loadedModule.exports, filename, path.dirname(filename),
);
const { inspectModelReply } = loadedModule.exports;

const inspect = (messages, extra = {}) => inspectModelReply(messages, { action: 'none', ...extra });

const intact = ['o mensal fica R$ 29,90', 'quer que eu te explique como funciona?'];
assert.deepEqual(inspect(intact), []);
assert.deepEqual(intact, ['o mensal fica R$ 29,90', 'quer que eu te explique como funciona?']);
assert.ok(inspect(Array.from({ length: 5 }, () => 'ok')).includes('telegram_message_limits'));
assert.ok(inspect(['x'.repeat(4097)]).includes('telegram_message_limits'));

assert.ok(inspect(['seu pix foi gerado e já está pronto']).includes('unverified_pix_generation'));
assert.deepEqual(inspect(['seu pix foi gerado e já está pronto'], { pixGenerated: true }), []);
assert.ok(inspect(['o pagamento caiu aqui e foi confirmado']).includes('unverified_current_payment_confirmation'));
assert.deepEqual(inspect(['o pagamento caiu aqui e foi confirmado'], { currentPaymentConfirmed: true }), []);
assert.ok(inspect(['seu acesso ao vip já foi liberado']).includes('unverified_fulfillment_release'));
assert.deepEqual(inspect(['seu acesso ao vip já foi liberado'], { fulfillmentReleased: true }), []);

for (const neutral of [
    'quer que eu gere o pix?',
    'vou conferir se o pagamento caiu',
    'a compra anterior foi confirmada',
    'quando o pix cair eu libero seu acesso',
]) assert.deepEqual(inspect([neutral]), [], neutral);

assert.ok(inspect(['vou te mandar assim que o áudio ficar pronto'], { voiceUnavailable: true }).includes('unavailable_delivery_promise'));
console.log('MODEL_REPLY_CONTRACT_OK cases=14');
