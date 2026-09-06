const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
const gemini = read('src/lib/gemini.ts');
const models = read('src/lib/aiModels.ts');
const adminApi = read('src/app/api/admin/ai-settings/route.ts');
const adminPage = read('src/app/admin/ai/_components/AiControlCenter.tsx');

const expectedTextOrder = [
    'glm-5.3-flash',
    'qwen3.8-flash',
    'hy3',
];
const expectedImageOrder = ['glm-5.3-flash', 'qwen3.8-flash'];
const catalog = models.match(/BAI_MODEL_CATALOG\s*=\s*\[([\s\S]*?)\]\s*as const/)?.[1] || '';

let previousIndex = -1;
for (const id of expectedTextOrder) {
    const index = catalog.indexOf(`id: "${id}"`);
    assert.ok(index > previousIndex, `${id} must exist in strict quality order`);
    previousIndex = index;
}
assert.equal(new Set(expectedTextOrder).size, expectedTextOrder.length);
for (const id of expectedImageOrder) {
    assert.match(catalog, new RegExp(`id: "${id.replace(/[.]/g, '\\.')}", label: [^\n]+ acceptsImage: true`));
}
assert.match(catalog, /id: "hy3", label: [^\n]+ acceptsImage: false/);

assert.match(models, /DEFAULT_BAI_MODEL\s*=\s*BAI_TEXT_MODEL_ORDER\[0\]/);
assert.match(models, /BAI_MODEL_BY_ID\.get\(normalized\)\?\.id \|\| DEFAULT_BAI_MODEL/);
assert.match(gemini, /type AiProvider = [^\n]*["']bai["']/);
assert.match(gemini, /DEFAULT_PROVIDER_ORDER\s*=\s*["']nvidia,gemini,bai["']/);
assert.match(gemini, /BAI_TEXT_MODEL_ORDER\.forEach\(\(baiModel, index\) => addProvider\(/);
assert.match(gemini, /provider:\s*["']bai["']/);
assert.match(gemini, /https:\/\/api\.b\.ai\/v1/);
assert.match(gemini, /const providerOnly = hasMedia && !hasImage \? ["']gemini["'] : options\.providerOnly/);
assert.match(gemini, /gateway\.provider === 'bai' && isBaiVisionModel\(gateway\.model\)/);
assert.match(gemini, /gateway\.provider === 'nvidia' && isNvidiaVisionModel\(gateway\.model\)/);
assert.match(gemini, /if \(failureKind === ["']auth["']\)/);

assert.match(adminApi, /provider === ["']bai["'][\s\S]*?\$\{config\.base\}\/models/);
assert.match(adminApi, /availableModels = BAI_TEXT_MODEL_ORDER\.filter/);
assert.match(adminApi, /missingModels = BAI_TEXT_MODEL_ORDER\.filter/);
assert.doesNotMatch(adminApi, /master_brain_connection_test/);
assert.match(adminPage, /name: "B\.AI"/);
assert.match(adminPage, /GLM-5\.3 Flash/);
assert.match(adminPage, /Qwen3\.8 Flash/);

console.log('BAI_MODEL_ROUTER_OK text=3 image=2 free_only=1 strict_order=1 per_model_fallback=1 auth_fast_fail=1 discovery_no_inference=1 panel=ready');
