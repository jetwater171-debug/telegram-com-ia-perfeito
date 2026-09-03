const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/lib/brain/memoryRetriever.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: filename,
}).outputText;
const loaded = { exports: {} };
const localRequire = (id) => id === '@/lib/brain/types' ? {} : require(id);
new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)(
  localRequire, loaded, loaded.exports, filename, path.dirname(filename),
);

const { rankMemoryRows } = loaded.exports;
const now = new Date('2026-09-03T12:00:00.000Z');
const base = {
  kind: 'fact',
  memory_key: 'cidade do lead',
  content: 'O lead mora no Porto.',
  updated_at: '2026-09-02T12:00:00.000Z',
  importance: 0.8,
  confidence: 0.9,
};

const memories = rankMemoryRows({
  query: 'onde o lead mora?',
  rows: [
    { ...base, id: 'expired', valid_until: '2026-09-03T11:59:59.000Z' },
    { ...base, id: 'future', valid_from: '2026-09-04T00:00:00.000Z' },
    { ...base, id: 'superseded-status', status: 'superseded' },
    { ...base, id: 'superseded-marker', superseded_at: '2026-09-02T13:00:00.000Z' },
    { ...base, id: 'inferred', source_type: 'llm', confidence: 0.45 },
    { ...base, id: 'direct', source_type: 'lead', confidence: 1, importance: 1 },
  ],
  now,
  limit: 20,
});

assert.deepEqual(memories.map((memory) => memory.id), ['direct', 'inferred']);
assert.equal(memories[0].confidence, 1);

const sourced = rankMemoryRows({
  query: 'cidade', now, limit: 3,
  rows: [
    { ...base, id: 'legacy-without-source' },
    { ...base, id: 'lead-event-source', source_event_id: 'event-1' },
  ],
});
assert.deepEqual(sourced.map((memory) => memory.id), ['lead-event-source', 'legacy-without-source']);

const many = Array.from({ length: 20 }, (_, index) => ({
  ...base,
  id: `memory-${index}`,
  memory_key: `assunto ${index}`,
  content: `Detalhe persistente ${index}`,
}));
assert.equal(rankMemoryRows({ rows: many, query: 'detalhe', now, limit: 20 }).length, 20);

const stateBuilderSource = fs.readFileSync(path.join(root, 'src/lib/brain/stateBuilder.ts'), 'utf8');
const eventStoreSource = fs.readFileSync(path.join(root, 'src/lib/brain/eventStore.ts'), 'utf8');
assert.match(stateBuilderSource, /\.is\('superseded_by', null\)/);
assert.match(stateBuilderSource, /\.lte\('valid_from', temporal\.now\)/);
assert.match(stateBuilderSource, /valid_until\.is\.null,valid_until\.gt/);
assert.match(stateBuilderSource, /\.limit\(240\)/);
assert.match(stateBuilderSource, /limit: 8/);
assert.match(eventStoreSource, /superseded_by: nextMemoryId/);

console.log('MEMORY_RETRIEVER_OK ranking=1 validity=1 source=1 upstream_filter=1 supersession_link=1');
