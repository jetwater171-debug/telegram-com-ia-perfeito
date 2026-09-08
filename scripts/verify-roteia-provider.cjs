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
assert.match(credentialsApi, /return testRoteiaConversationContract\(credential\)/);
console.log('ROTEIA_OK selected_model=1 four_roles=1 no_key_skipped=1 priority_preserved=1 timeout=20s');

// Execute o adaptador real com transporte simulado: o enum enviado deve ser
// exatamente o mesmo que o validador usa, e o prefixo não depende do lead.
const compile = (value) => ts.transpileModule(value, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const schemaCode = source.slice(source.indexOf('const toOpenRouterJsonSchema'), source.indexOf('const GEMINI_GATEWAY_TIMEOUT_MS'));
const messageCode = source.slice(source.indexOf('const toOpenRouterMessages'), source.indexOf('const buildJsonReminder'));
const callCode = source.slice(source.indexOf('const callOpenRouterJson'), source.indexOf('// Diagnóstico sem envio'));
let captured;
const dependencyNames = ['buildProviderConversationHistory','parseJsonText','fetch','AbortSignal'];
const invoke = new Function(...dependencyNames, compile(schemaCode + messageCode + callCode) + ';return callOpenRouterJson;')(
    history => history, JSON.parse,
    async (url, init) => {
        captured = {url, ...JSON.parse(init.body)};
        return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({lead_classification:'desconhecido',messages:['Olá!']})}}],usage:{prompt_tokens:2000,prompt_tokens_details:{cached_tokens:1500}}}), {status:200});
    }, AbortSignal,
);
(async () => {
    const schema = {type:'OBJECT', properties:{lead_classification:{type:'STRING',enum:['carente','tarado','curioso','frio','desconhecido']},messages:{type:'ARRAY',items:{type:'STRING'}}},required:['lead_classification','messages']};
    const gateway = {provider:'roteia',model:'deepseek/deepseek-v4-flash',apiKey:'test-only',baseUrl:'https://api.roteia.ai/v1'};
    const first = await invoke({},gateway,'draft','BASE FIXA\nTempo: 10:00',[],'Olá','responseSchema',schema,undefined,20000);
    assert.equal(captured.url,'https://api.roteia.ai/v1/chat/completions');
    assert.equal(captured.response_format.type,'json_schema');
    assert.deepEqual(captured.response_format.json_schema.schema.properties.lead_classification.enum,schema.properties.lead_classification.enum);
    assert.equal(captured.response_format.json_schema.schema.type,'object');
    assert.equal(first.usageCachedInputTokens,1500);
    assert.equal(captured.thinking,undefined);
    const stablePrefix = captured.messages[0].content.split('Tempo:')[0];
    await invoke({},gateway,'draft','BASE FIXA\nTempo: 10:01',[],'Oi','responseSchema',schema,undefined,20000);
    assert.equal(captured.messages[0].content.split('Tempo:')[0],stablePrefix);
    console.log('ROTEIA_CONTRACT_OK enum_sent=1 structured_output=1 stable_prefix=1 cache_accounting=1');
})().catch(error => { console.error(error); process.exitCode=1; });


