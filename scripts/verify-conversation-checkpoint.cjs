const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/lib/brain/eventStore.ts');
const rpcCalls = [];
let resolveRpc;
const supabaseServer = {
  rpc: (name, args) => {
    rpcCalls.push({ name, args });
    return new Promise((resolve) => { resolveRpc = resolve; });
  },
};

const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText;
const loaded = { exports: {} };
const localRequire = (id) => {
  if (id === '@/lib/supabaseServer') return { supabaseServer };
  if (id === '@/lib/brain/conversationStyle') return { evolveConversationStyle: (value) => value };
  return require(id);
};
new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
  localRequire, loaded, loaded.exports, filename, path.dirname(filename),
);

const { buildConversationCheckpoint, scheduleBrainConversationCheckpoint } = loaded.exports;
const previous = {
  summary: 'Contexto anterior',
  throughMessageId: '00000000-0000-0000-0000-000000000001',
  throughMessageAt: '2026-01-01T00:00:00Z',
  openLoops: ['combinar horário', 'pedir detalhes'],
  commitments: ['enviar acesso'],
  updatedAt: null,
};

const checkpoint = buildConversationCheckpoint({
  previous,
  summary: 'Snapshot completo atual',
  openLoops: ['nova pendência', 'NOVA PENDÊNCIA', 'mais um', 'terceiro', 'quarto', 'quinto', 'sexto'],
  commitments: ['novo compromisso', 'NOVO COMPROMISSO', 'segundo', 'terceiro', 'quarto'],
});
assert.equal(checkpoint.summary, 'Snapshot completo atual', 'não deve concatenar o resumo anterior');
assert.deepEqual(checkpoint.openLoops, ['nova pendência', 'mais um', 'terceiro', 'quarto', 'quinto']);
assert.deepEqual(checkpoint.commitments, ['novo compromisso', 'segundo', 'terceiro']);
assert.deepEqual(
  buildConversationCheckpoint({ previous, summary: 'Tudo resolvido', openLoops: [], commitments: [] }),
  { summary: 'Tudo resolvido', openLoops: [], commitments: [] },
  'listas vazias devem limpar itens resolvidos',
);
assert.equal(buildConversationCheckpoint({ summary: 'x'.repeat(1500) }).summary.length, 1200);

const migration = fs.readFileSync(path.join(root, 'conversation_context_migration.sql'), 'utf8');
assert.match(migration, /lead_conversation_checkpoints/);
assert.match(migration, /through_message_id uuid/);
assert.match(migration, /upsert_lead_conversation_checkpoint/);
assert.match(migration, /p_expected_previous_id uuid/);
assert.match(migration, /through_message_id is distinct from p_expected_previous_id/);
assert.match(migration, /messages_session_created_id_desc_idx/);

const route = fs.readFileSync(path.join(root, 'src/app/api/process-message/route.ts'), 'utf8');
assert.match(route, /await\s+scheduleBrainConversationCheckpoint\s*\(/,
  'o turno deve aguardar a persistência do checkpoint');

async function main() {
  const base = {
    sessionId: '00000000-0000-0000-0000-000000000010',
    throughMessageId: '00000000-0000-0000-0000-000000000002',
    throughMessageAt: '2026-01-01T00:01:00Z',
    state: { checkpoint: previous },
  };

  assert.equal(await scheduleBrainConversationCheckpoint({ ...base, checkpoint: null }), false);
  assert.equal(await scheduleBrainConversationCheckpoint({
    ...base,
    checkpoint: { summary: '   ', openLoops: [], commitments: [] },
  }), false);
  assert.equal(rpcCalls.length, 0, 'sem resumo não deve avançar o watermark');

  let settled = false;
  const persistence = scheduleBrainConversationCheckpoint({
    ...base,
    checkpoint: { summary: 'Snapshot persistido', openLoops: [], commitments: [] },
  }).then((result) => {
    settled = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(settled, false, 'deve permanecer pendente enquanto o RPC não terminou');
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, 'upsert_lead_conversation_checkpoint');
  assert.equal(rpcCalls[0].args.p_expected_previous_id, previous.throughMessageId);
  assert.equal(rpcCalls[0].args.p_through_message_id, base.throughMessageId);
  assert.equal(rpcCalls[0].args.p_summary, 'Snapshot persistido');

  resolveRpc({ data: true, error: null });
  assert.equal(await persistence, true);
  assert.equal(settled, true);
  console.log('CONVERSATION_CHECKPOINT_OK snapshot=complete resolved_loops=clear watermark_guard=1 cas=1 awaited=1');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
