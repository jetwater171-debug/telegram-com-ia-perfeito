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
assert.equal(models.DEFAULT_GEMINI_MODEL, 'gemini-3.7-flash');
assert.equal(models.DEFAULT_GEMINI_FALLBACK_MODEL, 'gemini-3.6-flash');
assert.deepEqual([...models.GEMINI_MODEL_OPTIONS], [
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
]);
assert.ok(!models.OPENROUTER_MODEL_FALLBACK_ORDER.includes('openrouter/free'));
assert.ok(models.OPENROUTER_MODEL_FALLBACK_ORDER.includes('openai/gpt-4o-mini'));

const geminiSource = fs.readFileSync(path.resolve(__dirname, '../src/lib/gemini.ts'), 'utf8');
assert.match(geminiSource, /gateways\.map\(\(gateway, priority\)/);
assert.match(geminiSource, /DEFAULT_GEMINI_MODEL,[\s\S]*DEFAULT_GEMINI_FALLBACK_MODEL,[\s\S]*'gemini-3\.5-flash',[\s\S]*DEFAULT_GEMINI_LITE_MODEL/);
assert.match(geminiSource, /priority,/);

console.log('GEMINI_MODEL_ROUTING_OK first=gemini-3.7-flash second=gemini-3.6-flash third=gemini-3.5-flash capacity=gemini-3.5-flash-lite openrouter_free=removed');
