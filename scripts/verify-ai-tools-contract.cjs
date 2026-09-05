const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(process.env.TARGET_ROOT || process.cwd());
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const loadTypeScript = (relativePath, stubs = {}) => {
  const filename = path.join(root, relativePath);
  const compiled = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (id) => Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : require(id);
  new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
    localRequire, loaded, loaded.exports, filename, path.dirname(filename),
  );
  return loaded.exports;
};

try {
  const actions = loadTypeScript('src/lib/aiActions.ts');
  const previews = loadTypeScript('src/lib/previewRequestAnalyzer.ts', {
    '@/lib/previewVision': { getPreviewVisionSettings: async () => ({ apiKey: '' }) },
  });

  assert.equal(actions.normalizeAiAction('Gerar PIX'), 'generate_pix_payment');
  assert.equal(actions.normalizeAiAction('send_voice'), 'send_voice_reply');
  assert.equal(actions.normalizeAiAction('mandar prévia'), 'send_custom_preview');
  assert.equal(actions.normalizeAiAction('invente uma cobrança'), 'none');

  assert.equal(previews.classifyRequestedMediaLocally('manda uma foto sua'), 'photo');
  assert.equal(previews.classifyRequestedMediaLocally('quero um vídeo'), 'video');
  assert.equal(previews.classifyRequestedMediaLocally('quero ver vc pelada'), 'photo');
  assert.equal(previews.classifyRequestedMediaLocally('essa foto ficou linda'), 'not_media');
  assert.equal(previews.classifyRequestedMediaLocally('sim kkk'), 'not_media');

  const runtime = actions.buildAiToolRuntimePrompt({
    adultVerified: true,
    voiceConfigured: true,
    voiceRequested: true,
    canGeneratePayment: true,
    hasPendingPayment: false,
    selectedOffer: { sku: 'vip_monthly', value: 29.9, description: 'VIP mensal' },
  });
  assert.match(runtime, /send_voice_reply: voz configurada/);
  assert.match(runtime, /generate_pix_payment: autorizada agora/);
  assert.match(runtime, /VIP mensal, SKU vip_monthly, R\$ 29,90/);

  const telegram = read('src/lib/telegram.ts');
  const processor = read('src/app/api/process-message/route.ts');
  const gateway = read('src/lib/gemini.ts');
  assert.match(telegram, /sendTelegramCopyableCodeStrict/);
  assert.match(processor, /await sendTelegramCopyableCodeStrict\(botToken, chatId, payment\.pixCopiaCola\)/);
  assert.match(processor, /eventType: 'payment_code_sent'/);
  assert.match(processor, /eventType: 'voice_sent'/);
  assert.match(processor, /eventType: 'voice_failed'/);
  assert.match(gateway, /AI_GATEWAY_MAX_CANDIDATES_PER_CREDENTIAL/);
  assert.match(gateway, /AI_GATEWAY_TOTAL_DEADLINE_MS/);
  assert.match(gateway, /prompt estimado em \$\{estimatedTokens\} tokens excede a capacidade configurada/);

  console.log('AI_TOOLS_CONTRACT_OK actions=4 previews=5 runtime=3 strict_pix=1 voice_events=2 bounded_fallback=1 total_deadline=1');
} catch (error) {
  console.error(`AI_TOOLS_CONTRACT_FAIL ${error.message}`);
  process.exitCode = 1;
}
