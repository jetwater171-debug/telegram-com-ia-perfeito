const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(process.env.TARGET_ROOT || process.cwd());
const loadTs = (relativePath, stubs = {}) => {
  const filename = path.join(root, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
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

const types = loadTs('src/lib/brain/types.ts', { '@/types': {} });
const { validateMasterBrainResponse, detectAdultDeclaration } = loadTs('src/lib/brain/hardValidator.ts', {
  '@/lib/brain/types': types,
});

const base = (action) => ({
  internal_thought: 'eval', lead_classification: 'desconhecido',
  lead_stats: { tarado: 0, carente: 0, sentimental: 0, financeiro: 0 },
  extracted_user_name: null, current_state: 'CONNECTION',
  messages: ['resposta 1', 'resposta 2', 'resposta 3', 'resposta 4', 'resposta 5'],
  action, lead_memory_patch: null, decision_confidence: 0.8,
  memory_updates: [{ kind: 'fact', key: 'trabalho', content: 'trabalha à noite', confidence: 1, importance: 0.7, status: 'active' }],
});

const texts = [
  'oi', 'como vc ta', 'trabalho à noite', 'gostei dessa', 'manda uma foto',
  'manda nude', 'quero um vídeo sem roupa', 'quanto custa o vip?', 'quero o vip',
  'fechou manda o pix', 'vou pagar agora', 'achei caro', 'tem desconto?', 'não quero',
  'paguei confere', 'manda o comprovante', 'prefiro natural', 'essa da cama foi melhor',
  'sou maior de idade', 'tenho 21 anos', 'tenho 17 anos', 'vamos falar de carro',
  'me manda uma prévia', 'quero comprar foto personalizada', 'pode gerar a cobrança',
];
const actions = [
  'none', 'send_custom_preview', 'send_hot_video_preview', 'send_wet_finger_photo',
  'generate_pix_payment', 'check_payment_status', 'request_app_install', 'invented_action',
];

let cases = 0;
let corrections = 0;
for (const text of texts) {
  for (const action of actions) {
    for (const adultVerified of [false, true]) {
      for (const canGeneratePayment of [false, true]) {
        for (const canPitchPrice of [false, true]) {
          const result = validateMasterBrainResponse({
            response: base(action), text,
            userText: text,
            adultVerified,
            canGeneratePayment,
            canPitchPrice,
            offer: { id: 'vip:19.90', value: 19.9, description: 'VIP Lari' },
          });
          cases += 1;
          corrections += result.corrections.length;
          assert.ok(result.response.messages.length <= 4);
          assert.notEqual(result.response.action, 'invented_action');
          if (!adultVerified && /nude|sem roupa/i.test(text) && /send_/.test(action)) {
            assert.equal(result.response.action, 'none');
          }
          if (action === 'generate_pix_payment' && !canGeneratePayment) {
            assert.equal(result.response.action, 'none');
          }
          if (/prévia|previa/.test(text) && action === 'generate_pix_payment') {
            assert.equal(result.response.action, 'none');
          }
          if (text !== 'trabalho à noite') {
            assert.equal(result.response.memory_updates[0].kind, 'hypothesis');
          }
        }
      }
    }
  }
}

assert.equal(detectAdultDeclaration('sou maior de idade'), true);
assert.equal(detectAdultDeclaration('tenho 21 anos'), true);
assert.equal(detectAdultDeclaration('tenho 17 anos'), false);

const accepted = validateMasterBrainResponse({
  response: base('generate_pix_payment'),
  userText: 'fechou, manda o pix do vip',
  adultVerified: true,
  canGeneratePayment: true,
  canPitchPrice: true,
  offer: { id: 'vip:19.90', value: 19.9, description: 'VIP Lari' },
});
assert.equal(accepted.response.action, 'generate_pix_payment');
assert.deepEqual(accepted.response.payment_details, { value: 19.9, description: 'VIP Lari' });

console.log(`MASTER_BRAIN_EVAL_OK cases=${cases} corrections=${corrections} payment_gate=1 adult_gate=1 memory_truth=1 message_limit=1`);
