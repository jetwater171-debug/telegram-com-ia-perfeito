const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const loadPureTypeScriptModule = (relativePath) => {
    const filename = path.resolve(__dirname, relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        fileName: filename,
    }).outputText;
    const loadedModule = { exports: {} };
    new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
        require, loadedModule, loadedModule.exports, filename, path.dirname(filename),
    );
    return loadedModule.exports;
};

const { shapeConversationBubbles } = loadPureTypeScriptModule('../src/lib/conversationBubbles.ts');

// A short existing message remains one bubble; preferredCount does not fabricate text.
assert.deepEqual(
    shapeConversationBubbles(['uma resposta curta. tudo bem?'], { preferredCount: 4, maxBubbles: 4 }),
    ['uma resposta curta. tudo bem?'],
);

// Dedupe remains accent/case/spacing-insensitive.
assert.deepEqual(
    shapeConversationBubbles(['igual', 'IGUAL', 'outra'], { maxBubbles: 4 }),
    ['igual', 'outra'],
);
assert.deepEqual(
    shapeConversationBubbles(['não quero não, obrigado.'], { maxBubbles: 2 }),
    ['não quero não, obrigado.'],
);

// Complete sentences are preferred, while answer, question and price survive
// the hard bubble limit in their original order.
const commercial = shapeConversationBubbles(
    ['Entendi sua ideia. Posso te ajudar com isso? O valor fica em R$ 29,90.'],
    { maxChars: 55, maxBubbles: 2 },
);
assert.equal(commercial.length, 2);
assert.match(commercial[0], /Entendi sua ideia\./);
assert.match(commercial[1], /Posso te ajudar com isso\?/);
assert.match(commercial[1], /R\$ 29,90\./);

// An unpunctuated long sentence may exceed the soft target when needed, but
// must retain the complete sentence instead of being cut into fragments.
const long = 'Eu consigo separar tudo com calma e depois te explicar cada detalhe para você escolher o melhor caminho';
const longBubbles = shapeConversationBubbles([long], { maxChars: 55, maxBubbles: 3 });
assert.deepEqual(longBubbles, [long]);
assert.equal(longBubbles.join(' '), long);

// Overflow is aggregated into the last bubble instead of being silently cut.
const overflow = shapeConversationBubbles(['primeiro.', 'segundo.', 'terceiro.', 'quarto.'], { maxBubbles: 2 });
assert.deepEqual(overflow, ['primeiro.', 'segundo. terceiro. quarto.']);

console.log('CONVERSATION_BUBBLES_OK', JSON.stringify({ commercial, longBubbles, overflow }));
