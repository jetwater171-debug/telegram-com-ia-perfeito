const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
const gemini = read('src/lib/gemini.ts');
const models = read('src/lib/aiModels.ts');
const adminApi = read('src/app/api/admin/ai-settings/route.ts');
const adminPage = read('src/app/admin/ai/page.tsx');

assert.match(models, /DEFAULT_BAI_MODEL\s*=\s*["']deepseek-v4-flash["']/);
assert.match(gemini, /type AiProvider = [^\n]*["']bai["']/);
assert.match(gemini, /DEFAULT_PROVIDER_ORDER\s*=\s*["']bai,gemini,/);
assert.match(gemini, /provider:\s*["']bai["']/);
assert.match(gemini, /https:\/\/api\.b\.ai\/v1/);
assert.match(gemini, /const hasMedia = Boolean\(mediaMimeType\)/);
assert.match(gemini, /const providerOnly = hasMedia \? ["']gemini["'] : options\.providerOnly/);
assert.match(gemini, /preferGemini:\s*hasMedia/);
assert.match(gemini, /gateway\.provider === ["']bai["']/);
assert.match(adminApi, /bai_api_key/);
assert.match(adminApi, /\/chat\/completions/);
assert.match(adminApi, /max_tokens:\s*provider === ["']bai["'] \? 8 : 2/);
assert.match(adminPage, /B\.AI · DeepSeek V4 Flash/);
assert.match(adminPage, /Foto e outras mídias pulam esta rota e caem no Gemini/);

console.log('BAI_MEDIA_ROUTING_OK text_primary=bai model=deepseek-v4-flash media_fallback=gemini panel=ready connection_test_max_tokens=8');
