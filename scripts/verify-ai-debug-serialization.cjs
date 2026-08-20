const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const Module = require('module');

const root = path.resolve(__dirname, '..');
const aiDebugPath = path.join(root, 'src', 'lib', 'aiDebug.ts');
const geminiPath = path.join(root, 'src', 'lib', 'gemini.ts');

function loadTypeScriptModule(file) {
    const source = fs.readFileSync(file, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
    }).outputText;
    const loaded = new Module(file, module);
    loaded.filename = file;
    loaded.paths = Module._nodeModulePaths(path.dirname(file));
    loaded._compile(compiled, file);
    return loaded.exports;
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function main() {
    const { insertMessageWithAiDebug, toSerializableDebugValue } = loadTypeScriptModule(aiDebugPath);

    const rawResponse = { messages: ['oiii tudo bem?'] };
    const circularDebug = {
        timestamp: '2026-08-20T17:42:00.000Z',
        system_prompt: 'persona',
        user_prompt: '/start',
        raw_response: rawResponse,
    };
    rawResponse.ai_debug = circularDebug;

    const snapshot = toSerializableDebugValue(circularDebug);
    assert(JSON.stringify(snapshot).includes('oiii tudo bem?'), 'snapshot perdeu a resposta');
    assert(!Object.prototype.hasOwnProperty.call(snapshot.raw_response, 'ai_debug'), 'snapshot reteve ai_debug recursivo');

    const inserted = [];
    const successfulClient = {
        from() {
            return {
                async insert(row) {
                    JSON.stringify(row);
                    inserted.push(row);
                    return { error: null };
                },
            };
        },
    };
    const stored = await insertMessageWithAiDebug(successfulClient, { content: 'oiii tudo bem?' }, circularDebug);
    assert(stored.storedDebug === true, 'debug seguro nao foi persistido');
    assert(inserted.length === 1, 'insert seguro nao ocorreu exatamente uma vez');

    let attempts = 0;
    const recoveryClient = {
        from() {
            return {
                async insert(row) {
                    attempts += 1;
                    if (Object.prototype.hasOwnProperty.call(row, 'ai_debug')) {
                        throw new TypeError('debug serializer unavailable');
                    }
                    return { error: null };
                },
            };
        },
    };
    const recovered = await insertMessageWithAiDebug(recoveryClient, { content: 'resposta real' }, circularDebug);
    assert(recovered.storedDebug === false, 'fallback declarou debug persistido');
    assert(recovered.error === null, 'fallback da mensagem falhou');
    assert(recovered.debugError instanceof TypeError, 'falha do debug nao foi registrada');
    assert(attempts === 2, 'fallback sem ai_debug nao foi tentado');

    const geminiSource = fs.readFileSync(geminiPath, 'utf8');
    assert(!/raw_response:\s*draftResult\.data/.test(geminiSource), 'gemini ainda referencia o objeto de resposta diretamente');
    assert(/rawResponseForDebug\s*=\s*toSerializableDebugValue\(draftResult\.data\)/.test(geminiSource), 'gemini nao cria snapshot antes do ai_debug');

    console.log('AI_DEBUG_SERIALIZATION_OK circular_snapshot=detached inspector_failure=message_retried_without_debug direct_self_reference=absent');
}

main().catch((error) => {
    console.error(`AI_DEBUG_SERIALIZATION_FAIL ${error.stack || error.message}`);
    process.exit(1);
});
