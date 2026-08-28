const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
const gemini = read('src/lib/gemini.ts');
const models = read('src/lib/aiModels.ts');
const adminApi = read('src/app/api/admin/ai-settings/route.ts');
const adminPage = read('src/app/admin/ai/page.tsx');

const expectedTextOrder = [
    'deepseek-v4-flash',
    'deepseek-v4-flash-vision-exp',
    'glm-5.3-flash',
    'qwen3.8-flash',
    'mimo-v2.5',
    'hy3',
];
const expectedImageOrder = expectedTextOrder.slice(1, 5);
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
assert.match(catalog, /id: "deepseek-v4-flash", label: [^\n]+ acceptsImage: false/);
assert.match(catalog, /id: "hy3", label: [^\n]+ acceptsImage: false/);

assert.match(models, /DEFAULT_BAI_MODEL\s*=\s*BAI_TEXT_MODEL_ORDER\[0\]/);
assert.doesNotMatch(models, /["']deepseek-v4-flash["']:\s*DEFAULT_BAI_MODEL/);
assert.match(models, /["']deepseek-v4-flash-0731["']:\s*DEFAULT_BAI_MODEL/);
assert.match(gemini, /type AiProvider = [^\n]*["']bai["']/);
assert.match(gemini, /DEFAULT_PROVIDER_ORDER\s*=\s*["']bai,openrouter,/);
assert.match(gemini, /BAI_TEXT_MODEL_ORDER\.forEach\(\(baiModel, index\) => addProvider\(/);
assert.match(gemini, /provider:\s*["']bai["']/);
assert.match(gemini, /https:\/\/api\.b\.ai\/v1/);
assert.match(gemini, /const providerOnly = hasImage \? ["']bai["'] : hasMedia \? ["']gemini["'] : options\.providerOnly/);
assert.match(gemini, /!hasImage \|\| gateway\.provider !== ["']bai["'] \|\| isBaiVisionModel\(gateway\.model\)/);
assert.match(gemini, /gateway\.provider === ["']bai["'] && failureKind === ["']auth["']/);

assert.match(adminApi, /provider === ["']bai["'][\s\S]*?\$\{config\.base\}\/models/);
assert.match(adminApi, /availableModels = BAI_TEXT_MODEL_ORDER\.filter/);
assert.match(adminApi, /missingModels = BAI_TEXT_MODEL_ORDER\.filter/);
assert.doesNotMatch(adminApi, /master_brain_connection_test/);
assert.match(adminPage, /B\.AI · Roteador de 6 modelos/);
assert.match(adminPage, /Texto · melhor para o pior/);
assert.match(adminPage, /Fotos · somente multimodais/);

console.log('BAI_MODEL_ROUTER_OK text=6 image=4 strict_order=1 per_model_fallback=1 auth_fast_fail=1 discovery_no_inference=1 panel=ready');
