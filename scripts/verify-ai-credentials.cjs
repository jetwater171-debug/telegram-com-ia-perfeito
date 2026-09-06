const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'src/lib/aiCredentials.ts');

assert.ok(fs.existsSync(sourcePath), 'aiCredentials.ts deve existir');
const source = fs.readFileSync(sourcePath, 'utf8');
assert.doesNotMatch(source, /dotenv|\.env\.local/, 'o carregador não deve depender de dotenv/.env.local');

const compileAndLoad = (filename, sourceText) => {
    const compiled = ts.transpileModule(sourceText, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
        fileName: filename,
    }).outputText;
    const loaded = { exports: {} };
    const localRequire = (specifier) => {
        if (specifier === '@/lib/supabaseServer') {
            return {
                supabaseServer: {
                    from() {
                        return {
                            select() { return this; },
                            eq() { return this; },
                            maybeSingle: async () => ({ data: null, error: null }),
                            range: async () => ({ data: [], error: null }),
                        };
                    },
                },
            };
        }
        return require(specifier);
    };
    new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
        localRequire,
        loaded,
        loaded.exports,
        filename,
        path.dirname(filename),
    );
    return loaded.exports;
};

const credentialsModule = compileAndLoad(sourcePath, source);
const envKeys = [
    'AI_CREDENTIALS_JSON',
    'BAI_API_KEYS',
    'BAI_API_KEY',
    'GEMINI_CREDENTIALS_JSON',
    'GEMINI_API_KEYS',
    'GEMINI_API_KEY',
    'GEMINI_PROJECT_ID',
    'NVIDIA_API_KEYS',
    'NVIDIA_API_KEY',
];
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

const clearEnv = () => {
    for (const key of envKeys) delete process.env[key];
};

const restoreEnv = () => {
    clearEnv();
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value !== undefined) process.env[key] = value;
    }
};

const load = async (setup) => {
    clearEnv();
    setup();
    try {
        return await credentialsModule.loadAiCredentials({});
    } finally {
        restoreEnv();
    }
};

(async () => {
    const parsed = await load(() => {
        process.env.BAI_API_KEYS = ' bai-one, bai-two\n bai-three; bai-two ';
        process.env.GEMINI_CREDENTIALS_JSON = JSON.stringify([
            { apiKey: 'gemini-a', projectId: 'project-a' },
            { apiKey: 'gemini-b', projectId: 'project-a' },
        ]);
        process.env.NVIDIA_API_KEYS = 'nvidia-one';
        process.env.AI_CREDENTIALS_JSON = JSON.stringify([
            { provider: 'bai', apiKey: 'bai-one' },
            { provider: 'nvidia', apiKey: 'nvidia-two' },
            { provider: 'not-a-provider', apiKey: 'ignored' },
        ]);
    });

    assert.deepEqual(
        parsed.map(({ provider, apiKey }) => `${provider}:${apiKey}`).sort(),
        [
            'bai:bai-one',
            'bai:bai-two',
            'bai:bai-three',
            'nvidia:nvidia-one',
            'nvidia:nvidia-two',
            'gemini:gemini-a',
            'gemini:gemini-b',
        ].sort(),
        'deve aceitar listas separadas por vírgula, ponto e vírgula e newline, ignorar provider inválido e deduplicar por provider+secret',
    );
    assert.equal(parsed.filter((item) => item.apiKey === 'bai-one').length, 1, 'chave duplicada deve aparecer uma vez');

    const conservative = await load(() => {
        process.env.GEMINI_API_KEYS = 'gemini-unassigned-a,gemini-unassigned-b';
    });
    assert.equal(conservative.length, 2, 'keys Gemini distintas continuam disponíveis');
    assert.equal(conservative[0].projectId, undefined, 'projectId ausente não pode ser inventado');
    assert.equal(conservative[0].quotaGroupId, 'gemini:project:unassigned');
    assert.equal(conservative[0].quotaGroupId, conservative[1].quotaGroupId, 'Gemini sem projectId deve compartilhar bucket conservador');

    const sameProject = await load(() => {
        process.env.GEMINI_CREDENTIALS_JSON = JSON.stringify([
            { apiKey: 'same-project-a', projectId: 'authorized-project' },
            { apiKey: 'same-project-b', projectId: 'authorized-project' },
            { apiKey: 'other-project', projectId: 'another-authorized-project' },
        ]);
    });
    assert.equal(sameProject[0].quotaGroupId, sameProject[1].quotaGroupId, 'keys do mesmo projectId devem compartilhar quota');
    assert.notEqual(sameProject[0].quotaGroupId, sameProject[2].quotaGroupId, 'projectIds diferentes devem permanecer isolados');

    const invalid = await load(() => {
        process.env.GEMINI_CREDENTIALS_JSON = JSON.stringify([
            { apiKey: 'disabled', projectId: 'p', enabled: false },
            { apiKey: 'placeholder', projectId: 'p' },
        ]);
        process.env.GEMINI_API_KEYS = '********, YOUR_GEMINI_KEY';
    });
    assert.deepEqual(invalid, [], 'credenciais desabilitadas e placeholders não devem entrar no pool');

    console.log('AI_CREDENTIALS_VERIFY_OK parsing=1 dedupe=1 gemini_unassigned_conservative=1 gemini_project_group=1 no_dotenv=1');
})().catch((error) => {
    restoreEnv();
    console.error(error);
    process.exitCode = 1;
});
