const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/lib/aiModels.ts');
const source = fs.readFileSync(filename, 'utf8');
assert.doesNotMatch(source, /deepseek-ai\/deepseek-v4-(?:pro|flash)(?!-(?:0813|0731))(?=["'])/, 'não reintroduzir aliases NVIDIA sem versão');

const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
    },
    fileName: filename,
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
    require,
    loaded,
    loaded.exports,
    filename,
    path.dirname(filename),
);

const models = loaded.exports;
const nvidiaIds = models.NVIDIA_MODEL_CATALOG.map((model) => model.id);
assert.deepEqual(nvidiaIds, [
    'deepseek-ai/deepseek-v4-pro-0813',
    'deepseek-ai/deepseek-v4-flash-0731',
    'moonshotai/kimi-k3',
    'nvidia/nemotron-3.5-lightning-30b-a3b',
], 'catálogo NVIDIA deve usar os IDs versionados exatos e a ordem de prioridade');
assert.deepEqual([...models.NVIDIA_TEXT_MODEL_ORDER], nvidiaIds);
assert.deepEqual([...models.NVIDIA_IMAGE_MODEL_ORDER], ['moonshotai/kimi-k3']);
assert.equal(models.DEFAULT_NVIDIA_MODEL, 'deepseek-ai/deepseek-v4-pro-0813');

assert.deepEqual([...models.GEMINI_MODEL_OPTIONS], [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
], 'catálogo Gemini deve conter somente os quatro modelos 3.x fortes');
assert.equal(models.DEFAULT_GEMINI_MODEL, 'gemini-3.8-flash');
assert.equal(models.DEFAULT_GEMINI_FALLBACK_MODEL, 'gemini-3.7-flash');
assert.equal(models.DEFAULT_GEMINI_LITE_MODEL, 'gemini-3.6-flash');
assert.equal(models.normalizeGeminiModelName('gemini-2.5-flash'), 'gemini-3.6-flash');
assert.equal(models.normalizeGeminiModelName('gemini-2.5-flash-lite'), 'gemini-3.6-flash');
assert.equal(models.normalizeGeminiModelName('gemini-3.5-flash-lite'), 'gemini-3.6-flash');
assert.equal(models.normalizeGeminiModelName('gemini-9.9-unknown'), 'gemini-3.8-flash');

assert.equal(models.NVIDIA_MODEL_CATALOG.length, new Set(nvidiaIds).size, 'IDs NVIDIA devem ser únicos');
assert.ok(models.NVIDIA_MODEL_CATALOG.every((model) => model.contextTokens === 1_000_000));
assert.ok(!models.GEMINI_MODEL_OPTIONS.includes('gemini-2.0-flash'));

console.log('AI_MODEL_CATALOG_VERIFY_OK nvidia=4 exact_ids=1 nvidia_order=1 gemini_order=1 gemini_defaults=1');
