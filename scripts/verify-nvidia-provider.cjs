const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const gateway = read('src/lib/gemini.ts');
const router = read('src/lib/aiGatewayRouter.ts');
const api = read('src/app/api/admin/ai-settings/route.ts');
const page = read('src/app/admin/ai/_components/AiControlCenter.tsx');
const models = read('src/lib/aiModels.ts');

assert.match(gateway, /provider: 'nvidia'/);
assert.match(gateway, /https:\/\/integrate\.api\.nvidia\.com\/v1/);
assert.match(gateway, /NVIDIA_API_KEY/);
for (const model of [
    'deepseek-ai/deepseek-v4-pro-0813',
    'deepseek-ai/deepseek-v4-flash-0731',
    'moonshotai/kimi-k3',
    'nvidia/nemotron-3.5-lightning-30b-a3b',
]) assert.match(models, new RegExp(model.replace(/[.]/g, '\\.'), 'i'));
assert.match(gateway, /NVIDIA_TEXT_MODEL_ORDER/);
assert.doesNotMatch(gateway, /NVIDIA_ALLOW_TRIAL_ENDPOINT_IN_PRODUCTION/);
assert.match(gateway, /body\.chat_template_kwargs/);
assert.match(gateway, /body\.reasoning_budget/);
assert.match(router, /normalizedProvider === 'nvidia'/);
assert.match(api, /nvidia_api_key/);
assert.match(api, /provider === "nvidia"/);
assert.match(page, /https:\/\/build\.nvidia\.com\/settings\/api-keys/);
assert.match(page, /api\/admin\/ai-credentials/);
assert.match(page, /accountId/);

console.log('NVIDIA_PROVIDER_OK exact_models=4 gateway=1 router=1 hosted_endpoint_production=1 reasoning_contracts=1 autosave=1 connection_test=1 key_link=1');
