const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'lib', 'previewMoment.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
    },
    fileName: sourcePath,
});
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-moment-routing-'));
const compiledPath = path.join(tempDir, 'previewMoment.cjs');
fs.writeFileSync(compiledPath, transpiled.outputText);
const { rankPreviewCandidatesByMoment, scorePreviewMomentFit } = require(compiledPath);

const atSaoPauloHour = (hour) => new Date(`2026-08-20T${String(hour).padStart(2, '0')}:00:00-03:00`);
const asset = (id, analysis, extra = {}) => ({
    id,
    name: id,
    media_type: 'image',
    tags: [],
    triggers: [],
    ai_analysis: analysis,
    ...extra,
});

const casualSelfie = asset('casual-selfie', {
    explicitness: 'safe',
    sensuality_level: 'casual',
    time_compatibility: ['qualquer'],
    conversation_contexts: ['first_contact', 'casual_chat'],
    setting: 'selfie no espelho dentro de casa',
});
const nightSensual = asset('night-sensual', {
    explicitness: 'suggestive',
    sensuality_level: 'sensual',
    time_compatibility: ['noite', 'madrugada'],
    conversation_contexts: ['flirting', 'preview'],
    setting: 'deitada na cama do quarto com luz baixa',
});
const daylightCasual = asset('daylight-casual', {
    explicitness: 'safe',
    sensuality_level: 'casual',
    time_compatibility: ['manha', 'tarde'],
    conversation_contexts: ['casual_chat'],
    setting: 'foto externa no parque com sol e céu azul',
});
const explicitNude = asset('explicit-nude', {
    explicitness: 'explicit',
    sensuality_level: 'explicit',
    time_compatibility: ['qualquer'],
    conversation_contexts: ['explicit_request'],
    setting: 'quarto',
    avoid_when: ['first_contact', 'casual_chat'],
});

const casualRanking = rankPreviewCandidatesByMoment({
    assets: [explicitNude, casualSelfie],
    context: {
        userText: 'manda uma selfie normal sua',
        funnelState: 'WELCOME',
        leadHeat: 80,
        timeZone: 'America/Sao_Paulo',
        now: atSaoPauloHour(14),
    },
});
assert.equal(casualRanking[0].asset.id, 'casual-selfie', 'pedido casual não pode receber nude mesmo com leadHeat alto');
assert.equal(casualRanking.some((entry) => entry.asset.id === 'explicit-nude'), false, 'mismatch explícito deve sair do pool quando existe alternativa');

const explicitRanking = rankPreviewCandidatesByMoment({
    assets: [casualSelfie, explicitNude],
    context: {
        userText: 'manda uma foto pelada sem roupa',
        funnelState: 'HOT_TALK',
        timeZone: 'America/Sao_Paulo',
        now: atSaoPauloHour(23),
    },
});
assert.equal(explicitRanking[0].asset.id, 'explicit-nude', 'pedido explícito deve selecionar mídia explícita coerente');

const nightRanking = rankPreviewCandidatesByMoment({
    assets: [daylightCasual, nightSensual],
    context: {
        userText: 'manda uma foto sensual agora',
        funnelState: 'PREVIEW',
        leadHeat: 45,
        timeZone: 'America/Sao_Paulo',
        now: atSaoPauloHour(23),
    },
});
assert.equal(nightRanking[0].asset.id, 'night-sensual', 'à noite deve preferir cena noturna e sensual');

const dayRanking = rankPreviewCandidatesByMoment({
    assets: [nightSensual, daylightCasual],
    context: {
        userText: 'manda uma foto normal sua agora',
        funnelState: 'WELCOME',
        timeZone: 'America/Sao_Paulo',
        now: atSaoPauloHour(14),
    },
});
assert.equal(dayRanking[0].asset.id, 'daylight-casual', 'de dia deve preferir cena diurna casual');

const nightOutdoorFit = scorePreviewMomentFit({
    asset: daylightCasual,
    context: {
        userText: 'manda foto normal',
        funnelState: 'WELCOME',
        timeZone: 'America/Sao_Paulo',
        now: atSaoPauloHour(23),
    },
});
assert.ok(nightOutdoorFit.score < 0, 'foto externa diurna precisa ser penalizada à noite');
assert.ok(nightOutdoorFit.reasons.includes('cena-diurna-fora-do-momento'));

const routeSource = fs.readFileSync(path.join(root, 'src', 'app', 'api', 'process-message', 'route.ts'), 'utf8');
assert.match(routeSource, /rankPreviewCandidatesByMoment\s*\(/g, 'roteamento deve aplicar ranking contextual');
assert.match(routeSource, /stage,ai_analysis/, 'preflight deve carregar análise visual e estágio');

console.log('PREVIEW_MOMENT_ROUTING_OK casual=1 explicit=1 night=1 day=1 mismatch=1 integration=1');
