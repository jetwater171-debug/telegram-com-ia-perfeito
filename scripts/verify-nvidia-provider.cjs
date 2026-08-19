const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const gateway = read('src/lib/gemini.ts');
const router = read('src/lib/aiGatewayRouter.ts');
const api = read('src/app/api/admin/ai-settings/route.ts');
const page = read('src/app/admin/ai/page.tsx');

assert.match(gateway, /provider: 'nvidia'/);
assert.match(gateway, /https:\/\/integrate\.api\.nvidia\.com\/v1/);
assert.match(gateway, /NVIDIA_API_KEY/);
assert.match(gateway, /meta\/llama-3\.1-8b-instruct/);
assert.match(router, /normalizedProvider === 'nvidia'/);
assert.match(api, /nvidia_api_key/);
assert.match(api, /provider === "nvidia"/);
assert.match(page, /https:\/\/build\.nvidia\.com\/settings\/api-keys/);
assert.match(page, /nvidiaApiKeyMasked/);
assert.match(page, /nvidiaModel/);

console.log('NVIDIA_PROVIDER_OK gateway=1 router=1 autosave=1 connection_test=1 key_link=1');
