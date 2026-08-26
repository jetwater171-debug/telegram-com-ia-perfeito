const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
const gemini = read('src/lib/gemini.ts');
const models = read('src/lib/aiModels.ts');
const adminApi = read('src/app/api/admin/ai-settings/route.ts');
const adminPage = read('src/app/admin/ai/page.tsx');

assert.match(models, /DEFAULT_BAI_MODEL\s*=\s*["']deepseek-v4-flash-vision-exp["']/);
assert.match(models, /["']deepseek-v4-flash["']:\s*DEFAULT_BAI_MODEL/);
assert.match(gemini, /type AiProvider = [^\n]*["']bai["']/);
assert.match(gemini, /DEFAULT_PROVIDER_ORDER\s*=\s*["']bai,gemini,/);
assert.match(gemini, /provider:\s*["']bai["']/);
assert.match(gemini, /https:\/\/api\.b\.ai\/v1/);
assert.match(gemini, /const hasMedia = Boolean\(mediaMimeType\)/);
assert.match(gemini, /const hasImage = mediaMimeType\.startsWith\(["']image\/["']\)/);
assert.match(gemini, /const providerOnly = hasMedia && !hasImage \? ["']gemini["'] : options\.providerOnly/);
assert.match(gemini, /gateway\.provider === ["']bai["'] && isBaiVisionModel\(gateway\.model\)/);
assert.match(gemini, /gateway\.provider === ["']bai["']/);
assert.match(adminApi, /bai_api_key/);
assert.match(adminApi, /\/chat\/completions/);
assert.match(adminApi, /master_brain_connection_test/);
assert.match(adminApi, /response_format:[\s\S]*json_schema/);
assert.match(adminApi, /reasoning_effort:\s*["']low["']/);
assert.match(adminPage, /B\.AI · DeepSeek V4 Flash/);
assert.match(adminPage, /DeepSeek V4 Flash Vision no texto e nas fotos/);

console.log('BAI_MEDIA_ROUTING_OK text_primary=bai model=deepseek-v4-flash-vision-exp image_primary=bai gemini_fallback=1 panel=ready strict_json_test=1');
