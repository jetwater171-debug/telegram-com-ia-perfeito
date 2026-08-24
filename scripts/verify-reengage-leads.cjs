const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 1. Verify route file existence and contents
const routePath = path.join(__dirname, '..', 'src', 'app', 'api', 'admin', 'reengage-leads', 'route.ts');
assert.ok(fs.existsSync(routePath), 'A rota /api/admin/reengage-leads deve existir');

const routeContent = fs.readFileSync(routePath, 'utf8');

// 2. Verify messages array
assert.match(routeContent, /continuar de onde a gente parou/);
assert.match(routeContent, /quando vc aparecer/);
assert.doesNotMatch(routeContent, /"oii+i*\??"/i);

// 3. Verify 1 hour inactivity cutoff
assert.match(routeContent, /60\s*\*\s*60\s*\*\s*1000/);
assert.match(routeContent, /lt\('last_message_at'/);

// 4. Verify direct telegram message without AI
assert.match(routeContent, /sendTelegramMessage/);
assert.doesNotMatch(routeContent, /callAiGatewayJson|callOpenRouterJson|callGeminiJson/);

// 5. Verify admin page button presence
const adminPagePath = path.join(__dirname, '..', 'src', 'app', 'admin', 'page.tsx');
const adminPageContent = fs.readFileSync(adminPagePath, 'utf8');
assert.match(adminPageContent, /Reativar elegíveis/);
assert.match(adminPageContent, /\/api\/admin\/reengage-leads/);

// 6. Verify single chat page button presence
const chatPagePath = path.join(__dirname, '..', 'src', 'app', 'admin', 'chat', '[id]', 'page.tsx');
const chatPageContent = fs.readFileSync(chatPagePath, 'utf8');
assert.match(chatPageContent, /chamar lead/);
assert.match(chatPageContent, /\/api\/admin\/reengage-leads/);

console.log('REENGAGE_LEADS_OK messages=3 no_lone_greeting=1 no_ai=1 one_hour_cutoff=1 admin_button=1 chat_button=1');
