const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const loadTypeScript = (relativePath) => {
    const filename = path.resolve(__dirname, relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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
    return loaded.exports;
};

const models = loadTypeScript('../src/lib/aiModels.ts');
assert.equal(models.DEFAULT_GEMINI_MODEL, 'gemini-3.8-flash');
assert.equal(models.DEFAULT_GEMINI_FALLBACK_MODEL, 'gemini-3.7-flash');
assert.deepEqual([...models.GEMINI_MODEL_OPTIONS], [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
]);
assert.ok(!models.OPENROUTER_MODEL_FALLBACK_ORDER.includes('openrouter/free'));
assert.deepEqual([...models.OPENROUTER_MODEL_FALLBACK_ORDER], ['deepseek/deepseek-chat']);

const geminiSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/gemini.ts'), 'utf8');
assert.match(geminiSource, /GoogleGenAI/);
assert.match(geminiSource, /usageMetadata/);
assert.doesNotMatch(geminiSource, /findIndex\(\(candidate\) => candidate\.quotaGroupId === credential\.quotaGroupId\)/, 'keys do mesmo projeto não devem ser descartadas');
assert.match(geminiSource, /gemini:project:unassigned/);
assert.match(geminiSource, /retryOptions: \{ attempts: 1 \}/);
assert.match(geminiSource, /allow_fallbacks: false/);

console.log('GEMINI_MODEL_ROUTING_OK first=gemini-3.8-flash project_quota_group=1 usage_metadata=1 sdk=current openrouter=deepseek-chat');
