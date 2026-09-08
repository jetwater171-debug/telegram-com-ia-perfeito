const fs = require('node:fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
const source = fs.readFileSync('src/lib/gemini.ts', 'utf8');
const routerSource = fs.readFileSync('src/lib/aiGatewayRouter.ts', 'utf8');
const credentialsApi = fs.readFileSync('src/app/api/admin/ai-credentials/route.ts', 'utf8');
const models = ts.transpileModule(fs.readFileSync('src/lib/aiModels.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const m={exports:{}};new Function('exports',models)(m.exports);
const section=source.slice(source.indexOf('const buildDirectOpenAiGateways'),source.indexOf('const getAiRuntimeSettings'));
const activeProviders = JSON.parse(source.match(/const AUTO_GATEWAY_PROVIDERS[^=]*= (\[[^;]+\])/)[1].replaceAll("'", '"'));
const env={AUTO_GATEWAY_PROVIDERS:activeProviders,...m.exports,process:{env:{}},readSecret:x=>x||'',currentGatewayModelCost:()=>({}),defaultOpenRouterBaseUrl:'https://openrouter.ai/api/v1'};
const js=ts.transpileModule(section,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const build=new Function(...Object.keys(env),js+';return buildDirectOpenAiGateways;')(...Object.values(env));
const routes=build({},[{provider:'roteia',id:'test',apiKey:'test-only',model:'vendor/chosen-model',quotaGroupId:'test',priority:100,weight:1,limits:{}}]);
assert.equal(routes.length,4);
assert.ok(routes.every(r=>r.provider==='roteia'&&r.model==='vendor/chosen-model'&&r.baseUrl==='https://api.roteia.ai/v1'));
assert.equal(build({},[]).filter(r=>r.provider==='roteia').length,0);
const api=fs.readFileSync('src/app/api/admin/ai-settings/route.ts','utf8');
const normalization=api.slice(api.indexOf('const normalizeProviderOrder'),api.indexOf('const loadGatewayDashboard'));
const normalize=new Function('ACTIVE_PROVIDERS',ts.transpileModule(normalization,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';return normalizeProviderOrder;')(['bai','gemini','nvidia','roteia']);
assert.equal(normalize('roteia,nvidia,gemini,bai'),'roteia,nvidia,gemini,bai');
assert.match(routerSource, /normalizedProvider === 'roteia'[\s\S]*?timeoutMs: 20_000/);
assert.match(routerSource, /provider === 'roteia'[\s\S]*?20_000/);
assert.match(credentialsApi, /credential\.provider === "roteia" \? 20_000 : 8_000/);
console.log('ROTEIA_OK selected_model=1 four_roles=1 no_key_skipped=1 priority_preserved=1 timeout=20s');


