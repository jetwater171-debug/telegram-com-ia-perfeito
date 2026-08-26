const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const helperPath = path.join(__dirname, '..', 'src', 'lib', 'reengagement.ts');
const helperSource = fs.readFileSync(helperPath, 'utf8');
const compiled = ts.transpileModule(helperSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helperModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, helperModule, helperModule.exports);
const helper = helperModule.exports;

// 1. Verify route file existence and contents
const routePath = path.join(__dirname, '..', 'src', 'app', 'api', 'admin', 'reengage-leads', 'route.ts');
assert.ok(fs.existsSync(routePath), 'A rota /api/admin/reengage-leads deve existir');

const routeContent = fs.readFileSync(routePath, 'utf8');

// 2. Verify contextual and refusal-aware messages
assert.match(routeContent, /buildContextualReengagement/);
assert.doesNotMatch(routeContent, /continuar de onde a gente parou/);
assert.equal(helper.buildContextualReengagement({
    recentMessages: [{ sender: 'user', content: 'to saindo do trabalho agora' }],
    userName: 'Carlos',
}), 'como ficou aquele corre do trabalho?');
assert.equal(helper.buildContextualReengagement({
    recentMessages: [{ sender: 'user', content: 'não quero mais, para de mandar' }],
    userName: 'Carlos',
}), null);

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

console.log('REENGAGE_LEADS_OK contextual=1 refusal_gate=1 no_fake_continuation=1 no_ai=1 one_hour_cutoff=1 admin_button=1 chat_button=1');
