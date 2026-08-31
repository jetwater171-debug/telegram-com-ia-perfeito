const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const moduleCache = new Map();

// Carrega apenas módulos puros do domínio. O alias resolver evita depender de
// tsconfig-paths/Next e impede que o contrato faça chamadas de rede por acidente.
const aliasToFile = (id) => {
  const aliases = {
    '@/lib/commercialCatalog': 'src/lib/commercialCatalog.ts',
    '@/lib/salesTiming': 'src/lib/salesTiming.ts',
    '@/lib/brain/types': 'src/lib/brain/types.ts',
    '@/lib/brain/hardValidator': 'src/lib/brain/hardValidator.ts',
    '@/lib/leadMemoryEvidence': 'src/lib/leadMemoryEvidence.ts',
    '@/types': 'src/types.ts',
  };
  return aliases[id] ? path.join(root, aliases[id]) : null;
};

const loadTs = (relativeOrAbsolute) => {
  const filename = path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.join(root, relativeOrAbsolute);
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;

  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  moduleCache.set(filename, loaded);
  const localRequire = (id) => {
    const aliasFile = aliasToFile(id);
    return aliasFile ? loadTs(aliasFile) : require(id);
  };
  new Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    localRequire,
    loaded,
    loaded.exports,
    filename,
    path.dirname(filename),
  );
  return loaded.exports;
};

const catalog = loadTs('src/lib/commercialCatalog.ts');
const sales = loadTs('src/lib/salesTiming.ts');
const validator = loadTs('src/lib/brain/hardValidator.ts');
const prompts = fs.readFileSync(path.join(root, 'src/lib/lariConversationPrompts.ts'), 'utf8');
const route = fs.readFileSync(path.join(root, 'src/app/api/process-message/route.ts'), 'utf8');

const {
  COMMERCIAL_CATALOG,
  VIP_OFFERS,
  formatVipCatalog,
  detectCommercialSku,
  getCommercialOffer,
  isVipMenuRequest,
} = catalog;
const {
  buildSalesOrderSnapshot,
  canonicalizeSalesOfferMessages,
  detectPaidProduct,
  evaluateSalesTiming,
  extractExplicitBudget,
  guardPrematureSaleMessages,
} = sales;
const { confirmsAdultDeclarationPrompt, detectAdultDeclaration, validateMasterBrainResponse } = validator;

const now = new Date('2026-08-28T12:00:00.000Z');

// 1. Catálogo: os três VIPs e a chamada avulsa são SKUs fixos.
assert.deepEqual(
  VIP_OFFERS.map(({ sku, value }) => [sku, value]),
  [
    ['vip_monthly', 29.90],
    ['vip_lifetime', 49.90],
    ['vip_lifetime_call', 79.90],
  ],
);
assert.equal(COMMERCIAL_CATALOG.video_call_standalone.value, 50);
assert.equal(formatVipCatalog().match(/R\$\s*(?:29,90|49,90|79,90)/g)?.length, 3);
assert.match(formatVipCatalog(), /R\$ 29,90/);
assert.match(formatVipCatalog(), /R\$ 49,90/);
assert.match(formatVipCatalog(), /R\$ 79,90/);

assert.equal(detectCommercialSku('quero o mensal'), 'vip_monthly');
assert.equal(detectCommercialSku('quero o vitalício'), 'vip_lifetime');
assert.equal(detectCommercialSku('quero o vitalício com chamada'), 'vip_lifetime_call');
assert.equal(detectCommercialSku('quero só chamada'), 'video_call_standalone');
// Misturar mensal e chamada não pode escolher o combo mais caro por conta
// própria: o lead precisa receber uma pergunta clara de desambiguação.
assert.equal(detectCommercialSku('quero o VIP mensal + chamada'), null);
assert.equal(detectCommercialSku('quero mensal com chamada'), null);
assert.equal(isVipMenuRequest('quanto custa o VIP?'), true);

// 2. VIP genérico/menu: nunca escolhe um plano nem gera PIX por inferência.
for (const text of ['quero o VIP', 'quanto custa o VIP?', 'quero VIP manda o PIX']) {
  const result = evaluateSalesTiming({ userText: text, now });
  assert.equal(result.selectedSku, null, text);
  assert.equal(result.requiresSkuSelection, true, text);
  assert.equal(result.mustPresentVipMenu, true, text);
  assert.equal(result.offerPlan, null, text);
  assert.equal(result.canGeneratePayment, false, text);
}

// O diálogo real que motivou a correção: respostas de apresentação não podem
// somar um contador e transformar o turno seguinte em anúncio automático.
const screenshotConversation = [
  { sender: 'user', content: '/start', created_at: '2026-08-28T11:55:00.000Z' },
  { sender: 'bot', content: 'oii, como vc tá?', created_at: '2026-08-28T11:55:10.000Z' },
  { sender: 'bot', content: 'como é seu nome?', created_at: '2026-08-28T11:55:13.000Z' },
  { sender: 'user', content: 'to bem e voce', created_at: '2026-08-28T11:56:00.000Z' },
  { sender: 'user', content: 'me chamo leo', created_at: '2026-08-28T11:56:02.000Z' },
];
const prematureScreenshotOffer = evaluateSalesTiming({
  userText: 'me chamo leo',
  now,
  recentMessages: screenshotConversation,
  leadMemory: { metadata: { conversation_started_at: '2026-08-28T11:55:00.000Z' } },
});
assert.equal(prematureScreenshotOffer.proactiveVipOffer, false);
assert.equal(prematureScreenshotOffer.organicVipBridge, false);
assert.equal(prematureScreenshotOffer.activeProduct, null);
assert.equal(prematureScreenshotOffer.mustStateOfferNow, false);

const neutralConversation = [
  'me chamo leo',
  'sou de mococa',
  'trabalho com vendas',
  'hoje meu dia foi corrido',
  'agora to descansando em casa',
].map((content, index) => ({
  sender: 'user',
  content,
  created_at: new Date(now.getTime() - (6 - index) * 30_000).toISOString(),
}));
const neutralAfterSeveralTurns = evaluateSalesTiming({
  userText: 'agora to descansando em casa',
  now,
  recentMessages: neutralConversation,
  leadMemory: { metadata: { conversation_started_at: new Date(now.getTime() - 10 * 60_000).toISOString() } },
});
assert.equal(neutralAfterSeveralTurns.vipJourneyTurns, 5);
assert.equal(neutralAfterSeveralTurns.proactiveVipOffer, false);
assert.equal(neutralAfterSeveralTurns.activeProduct, null);

const warmConversation = [
  ...neutralConversation.slice(0, 3),
  { sender: 'user', content: 'vc é muito linda', created_at: '2026-08-28T11:58:00.000Z' },
  { sender: 'bot', content: 'assim vc me deixa com vontade de te provocar', created_at: '2026-08-28T11:58:10.000Z' },
  { sender: 'user', content: 'quero te ver sem roupa', created_at: '2026-08-28T11:59:00.000Z' },
];
const earnedVipBridge = evaluateSalesTiming({
  userText: 'quero te ver sem roupa',
  now,
  recentMessages: warmConversation,
  leadMemory: { metadata: { conversation_started_at: new Date(now.getTime() - 10 * 60_000).toISOString() } },
});
assert.equal(earnedVipBridge.organicVipBridge, true);
assert.equal(earnedVipBridge.proactiveVipOffer, true);
assert.equal(earnedVipBridge.selectedSku, 'vip_monthly');
assert.equal(earnedVipBridge.mustStateOfferNow, true);

assert.deepEqual(guardPrematureSaleMessages({
  messages: ['leo é um nome bonito', 'o VIP mensal fica R$ 29,90'],
  product: null,
  canPitchPrice: false,
  canGeneratePayment: false,
  userText: 'me chamo leo',
}), ['leo é um nome bonito']);
assert.deepEqual(guardPrematureSaleMessages({
  messages: ['assina meu VIP e libera o acesso'],
  product: null,
  canPitchPrice: false,
  canGeneratePayment: false,
  userText: 'sou de mococa',
}), []);

const menuWithoutAcceptance = evaluateSalesTiming({
  userText: 'sim',
  now,
  recentMessages: [{
    sender: 'bot',
    content: `mensal R$ 29,90 | vitalício R$ 49,90 | combo R$ 79,90`,
    created_at: now.toISOString(),
  }],
  leadMemory: {
    metadata: {
      sales_nurture_product: 'vip',
      sales_nurture_updated_at: now.toISOString(),
    },
  },
});
assert.equal(menuWithoutAcceptance.acceptedOffer, true);
assert.equal(menuWithoutAcceptance.selectedSku, null);
assert.equal(menuWithoutAcceptance.requiresSkuSelection, true);
assert.equal(menuWithoutAcceptance.canGeneratePayment, false);

// Um valor de catálogo sozinho só é SKU quando veio logo depois do menu
// vigente. Sem esse contexto, "quero o de 49,90" continua ambíguo.
assert.equal(detectCommercialSku('quero o de 49,90'), null);
const recentVipMenu = [{
  sender: 'bot',
  content: formatVipCatalog(),
  created_at: now.toISOString(),
}];
for (const [text, sku, value] of [
  ['quero o de 49,90', 'vip_lifetime', 49.90],
  ['quero esse de 79,90', 'vip_lifetime_call', 79.90],
]) {
  const contextualChoice = evaluateSalesTiming({
    userText: text,
    now: new Date(now.getTime() + 30_000),
    recentMessages: recentVipMenu,
    leadMemory: {
      metadata: {
        sales_nurture_product: 'vip',
        sales_nurture_updated_at: now.toISOString(),
      },
    },
  });
  assert.equal(contextualChoice.selectedSku, sku, text);
  assert.equal(contextualChoice.activeProduct, 'vip', text);
  assert.equal(contextualChoice.offerPlan?.sku, sku, text);
  assert.equal(contextualChoice.offerPlan?.value, value, text);
  assert.equal(contextualChoice.requiresSkuSelection, false, text);
  assert.equal(contextualChoice.canGeneratePayment, true, text);
}

// 3. Cada escolha explícita mantém seu SKU e preço até o checkout.
const selectedCases = [
  ['quero o mensal, manda o PIX', 'vip_monthly', 29.90],
  ['quero o vitalício, manda o PIX', 'vip_lifetime', 49.90],
  ['quero o vitalício com chamada, manda o PIX', 'vip_lifetime_call', 79.90],
  ['quero só chamada, manda o PIX', 'video_call_standalone', 50],
];
for (const [text, sku, value] of selectedCases) {
  const result = evaluateSalesTiming({ userText: text, now });
  assert.equal(result.selectedSku, sku, text);
  assert.equal(result.offerPlan?.sku, sku, text);
  assert.equal(result.offerPlan?.value, value, text);
  assert.equal(result.canGeneratePayment, true, text);
}

// 4. Não confundir vídeo personalizado com chamada.
assert.equal(detectPaidProduct('quero um vídeo seu de quatro mostrando o cuzinho'), 'custom_video');
assert.equal(detectPaidProduct('me manda um vídeo personalizado'), 'custom_video');
assert.equal(detectPaidProduct('quero uma chamada ao vivo'), 'video_call');

// Orçamento casual não vira limite de cobrança; limite explícito bloqueia PIX.
assert.equal(extractExplicitBudget('tenho 10k na conta'), null);
const underBudget = evaluateSalesTiming({
  userText: 'só tenho R$ 10 para o VIP mensal',
  now,
});
assert.equal(underBudget.explicitBudget, 10);
assert.equal(underBudget.fixedVipBudgetGap, true);
assert.equal(underBudget.canGeneratePayment, false);
assert.equal(underBudget.offerPlan?.value, 29.90);

// 5. Ordem aberta de outro SKU não autoriza reutilização silenciosa.
const monthly = evaluateSalesTiming({ userText: 'quero o mensal', now });
const monthlyOrder = buildSalesOrderSnapshot({
  orderId: 'order:monthly',
  plan: monthly.offerPlan,
  status: 'offered',
  now,
});
const incompatible = evaluateSalesTiming({
  userText: 'quero o vitalício, manda o PIX',
  now: new Date(now.getTime() + 60_000),
  leadMemory: { metadata: { sales_active_order: monthlyOrder } },
});
assert.equal(incompatible.selectedSku, 'vip_lifetime');
assert.equal(incompatible.activeOrder, null);
assert.equal(incompatible.offerPlan?.value, 49.90);
assert.equal(incompatible.canGeneratePayment, true);

// O aceite comercial fica preservado durante o gate 18+. Assim, "sim" como
// resposta à pergunta de idade retoma exatamente o mesmo SKU, sem pedir que o
// lead recomece a compra nem inferir outro pacote.
const acceptedMonthlyOrder = buildSalesOrderSnapshot({
  orderId: 'order:monthly:adult-gate',
  plan: evaluateSalesTiming({ userText: 'quero o mensal, manda o PIX', now }).offerPlan,
  status: 'accepted',
  now,
});
const resumedAfterAdultGate = evaluateSalesTiming({
  userText: 'sim',
  now: new Date(now.getTime() + 60_000),
  recentMessages: [{
    sender: 'bot',
    content: 'antes de gerar o pagamento, confirma pra mim que vc tem 18 anos ou mais?',
    created_at: now.toISOString(),
  }],
  leadMemory: { metadata: { sales_active_order: acceptedMonthlyOrder } },
});
assert.equal(resumedAfterAdultGate.selectedSku, 'vip_monthly');
assert.equal(resumedAfterAdultGate.canGeneratePayment, true);

// 6. Preço do texto e payment_details sempre são canônicos do catálogo.
assert.deepEqual(
  canonicalizeSalesOfferMessages(['VIP por R$ 19,90'], 29.90),
  ['VIP por R$ 29,90'],
);
const baseResponse = {
  internal_thought: 'test',
  lead_classification: 'curioso',
  lead_stats: { tarado: 0, carente: 0, sentimental: 0, financeiro: 0 },
  extracted_user_name: null,
  current_state: 'CLOSING',
  messages: ['vou gerar'],
  action: 'generate_pix_payment',
  next_best_action: 'GENERATE_PAYMENT',
  decision_confidence: 0.9,
  memory_updates: [],
};
const canonicalPayment = validateMasterBrainResponse({
  response: { ...baseResponse, payment_details: { value: 19.90, description: 'inventado' } },
  userText: 'quero o mensal, manda o PIX',
  canGeneratePayment: true,
  canPitchPrice: true,
  adultVerified: true,
  offer: { id: 'vip_monthly', value: 29.90, description: 'VIP Mensal Lari' },
});
assert.deepEqual(canonicalPayment.response.payment_details, {
  value: 29.90,
  description: 'VIP Mensal Lari',
});

// 7. Rejeição do VIP persiste e impede reoferta automática.
const rejected = evaluateSalesTiming({ userText: 'não quero VIP', now });
assert.equal(rejected.activeProduct, null);
assert.equal(rejected.vipJourneyStage, 'rejected');
assert.equal(rejected.canGeneratePayment, false);
assert.equal(rejected.metadataPatch.vip_sales_status, 'rejected');
const afterRejection = evaluateSalesTiming({
  userText: 'oi',
  now: new Date(now.getTime() + 60_000),
  leadMemory: { rejected_products: ['vip'] },
});
assert.equal(afterRejection.proactiveVipOffer, false);
assert.equal(afterRejection.acquisitionGoal, null);

// 8. Idade explícita e áudio: conteúdo sexual exige o gate booleano do backend.
assert.equal(detectAdultDeclaration('tenho 17 anos'), false);
assert.equal(detectAdultDeclaration('tenho 18 anos'), true);
assert.equal(detectAdultDeclaration('sou maior de idade'), true);
assert.equal(confirmsAdultDeclarationPrompt('sim', 'confirma pra mim que vc tem 18 anos ou mais?'), true);
assert.equal(confirmsAdultDeclarationPrompt('sim', 'quer ver uma foto?'), false);
const blockedMedia = validateMasterBrainResponse({
  response: { ...baseResponse, action: 'send_hot_video_preview', messages: ['toma'] },
  userText: 'manda nude',
  canGeneratePayment: false,
  canPitchPrice: false,
  adultVerified: false,
});
assert.equal(blockedMedia.response.action, 'none');
assert.match(blockedMedia.response.messages[0], /18 anos/i);

// O gate de maioridade vale para toda mídia do catálogo, inclusive foto
// genérica. O pedido nunca pode virar autorização implícita quando o booleano
// confiável do backend ainda é false.
for (const mediaCase of [
  ['manda uma foto pelada', 'send_hot_video_preview'],
  ['me manda uma foto de lingerie', 'send_lingerie_photo'],
  ['manda uma foto', 'send_video_preview'],
]) {
  const gatedMedia = validateMasterBrainResponse({
    response: { ...baseResponse, action: mediaCase[1], messages: ['toma aqui'] },
    userText: mediaCase[0],
    canGeneratePayment: false,
    canPitchPrice: false,
    adultVerified: false,
  });
  assert.equal(gatedMedia.response.action, 'none', mediaCase[0]);
  assert.equal(gatedMedia.response.next_best_action, 'ASK', mediaCase[0]);
  assert.match(gatedMedia.response.messages[0], /18 anos/i, mediaCase[0]);
}

// O detector precisa reconhecer o vocabulário real usado pelos leads para
// impedir que variações comuns escapem do gate sexual.
for (const phrase of [
  'fala safada comigo', 'to com tesao', 'estou com tesão', 'quero te ver pelada',
  'manda lingerie', 'mostra a calcinha', 'quero te comer', 'quero transar',
  'estou me masturbando', 'vou enfiar', 'quero sentar em você',
]) {
  assert.equal(validator.isExplicitSexualContext(phrase), true, phrase);
}

const eleven = loadTs('src/lib/elevenLabs.ts');
const safeVoice = eleven.buildElevenV3Performance({
  messageText: 'vou falar baixinho com você',
  userText: 'fala safada comigo',
  adultVerified: false,
});
assert.doesNotMatch(safeVoice, /seductively|moans|gasps|breathes heavily/i);
const adultVoice = eleven.buildElevenV3Performance({
  messageText: 'você me deixa doida',
  userText: 'fala safada comigo',
  adultVerified: true,
});
assert.match(adultVoice, /seductively/i);

// Contratos estruturais para não perder o vínculo entre catálogo, rota e gate.
assert.match(route, /evaluateSalesTiming\(/);
assert.match(route, /canonicalizeSalesOfferMessages/);
assert.match(route, /validateMasterBrainResponse/);
assert.match(route, /shouldDeliverRequestedMedia/);
assert.match(route, /lastBotAlreadyDeliveredMedia/);
assert.match(route, /userAffirmedMedia/);
assert.match(route, /adultPaymentVerificationRequired\)\) \{/);
assert.match(prompts, /VIP|vital/i);

console.log('LARI_COMMERCIAL_CONTRACT_OK skus=4 prices=4 menu_no_pix=1 contextual_price_selection=2 ambiguous_combo=1 explicit_acceptance=1 incompatible_order=1 canonical_price=1 rejection=1 adult_gate=3 sexual_phrases=11 voice_gate=1');
