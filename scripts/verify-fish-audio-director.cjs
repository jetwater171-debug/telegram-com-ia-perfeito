const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const compile = (relativePath, customRequire = require) => {
    const filename = path.resolve(__dirname, relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        fileName: filename,
    }).outputText;
    const loadedModule = { exports: {} };
    new Function('require', 'module', 'exports', '__filename', '__dirname', output)(customRequire, loadedModule, loadedModule.exports, filename, path.dirname(filename));
    return loadedModule.exports;
};

const fish = compile('../src/lib/fishAudio.ts');
const agent = compile('../src/lib/fishAudioScriptAgent.ts', (id) => id === '@/lib/fishAudio' ? fish : require(id));

const createOggPage = (payload, sequence, headerType = 0) => {
    const lacing = [];
    let remaining = payload.length;
    while (remaining >= 255) {
        lacing.push(255);
        remaining -= 255;
    }
    lacing.push(remaining);
    const header = Buffer.alloc(27 + lacing.length);
    header.write('OggS', 0, 'ascii');
    header[4] = 0;
    header[5] = headerType;
    header.writeUInt32LE(sequence, 18);
    header[26] = lacing.length;
    lacing.forEach((value, index) => { header[27 + index] = value; });
    return Buffer.concat([header, payload]);
};
const validOpus = Buffer.concat([
    createOggPage(Buffer.from('OpusHead'), 0, 2),
    createOggPage(Buffer.alloc(1_600, 7), 1, 4),
]);

assert.equal(fish.cleanTextForSpeech('vc é linda kkkkk rsrs'), 'Você é linda.');
assert.doesNotMatch(fish.buildExpressiveSpeech({ messageText: 'vc é linda kkkkk', userText: 'kkkkk' }), /kkkk|\brs\b/i);
assert.equal(fish.validateFishOpus(validOpus).pages, 2);
assert.throws(() => fish.validateFishOpus(validOpus.subarray(0, validOpus.length - 10)), /incompletos|truncado/);

const deepSeekCalls = [];
const fakeDeepSeek = async (url, init) => {
    deepSeekCalls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
            spoken_text: 'Você me deixa doida. Tô aqui pensando em você.',
            delivery: 'soft voice, playful, natural, unhurried',
            reaction: 'giggle',
        }) } }],
    }), { status: 200 });
};

(async () => {
    const settings = { apiKey: 'bai-test', model: 'deepseek-v4-flash', baseUrl: 'https://api.b.ai/v1' };
    const script = await agent.prepareFishAudioScript({
        settings,
        messageText: 'vc me deixa doida kkkkk, to aqui pensando em vc',
        userText: 'quero ouvir sua voz',
        emotionalContext: 'brincadeira carinhosa',
        fetcher: fakeDeepSeek,
    });
    assert.equal(script.source, 'deepseek');
    assert.equal(script.spokenText, 'Você me deixa doida. Tô aqui pensando em você.');
    assert.doesNotMatch(script.fishText, /kkkk|\brs\b/i);
    assert.match(script.fishText, /^\[soft voice, playful, natural, unhurried\] \[giggle\]/);
    assert.equal(deepSeekCalls[0].body.model, 'deepseek-v4-flash');
    assert.equal(deepSeekCalls[0].body.max_tokens, 450);

    const invented = await agent.prepareFishAudioScript({
        settings,
        messageText: 'vc me deixa doida kkkkk, to aqui pensando em vc',
        fetcher: async () => new Response(JSON.stringify({
            choices: [{ message: { content: '{"spoken_text":"Vou te mandar um presente de mil reais.","delivery":"excited","reaction":"none"}' } }],
        }), { status: 200 }),
    });
    assert.equal(invented.spokenText, 'Você me deixa doida, tô aqui pensando em você.');

    let fishBody = null;
    const originalFetch = global.fetch;
    global.fetch = async (_url, init) => {
        fishBody = JSON.parse(init.body);
        return new Response(validOpus, { status: 200 });
    };
    try {
        const audio = await fish.generateFishAudio({
            settings: { apiKey: 'fish-test', enabled: true, voiceId: 'voice-1', model: 's2.1-pro-free', frequencyPercent: 10, cooldownMinutes: 30, maxChars: 240 },
            text: script.fishText,
        });
        assert.equal(audio.length, validOpus.length);
        assert.deepEqual(fishBody.features, ['quality-guard']);
        assert.equal(fishBody.prosody.normalize_loudness, true);
        assert.equal(fishBody.temperature, 0.62);
    } finally {
        global.fetch = originalFetch;
    }

    const processSource = fs.readFileSync(path.resolve(__dirname, '../src/app/api/process-message/route.ts'), 'utf8');
    assert.match(processSource, /prepareFishAudioScript/);
    assert.match(processSource, /content:\s*preparedAudio\.script\.spokenText/);
    assert.match(processSource, /bai_api_key/);

    console.log('FISH_AUDIO_DIRECTOR_OK deepseek=1 exact_transcript=1 chat_laugh_removed=1 quality_guard=1 opus_validation=1');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
