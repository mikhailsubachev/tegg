// Slice Q, L2 (fast-check): docs/acceptance/queries.md FR-FMT-07 AC-29's property in TypeScript. Random query files
// (comments anywhere, unknown keys at both levels, flow and block styles, quoting, CRLF, NFD values, no final newline)
// and a random edit go through the fake core's twin of the patcher (app/ui/test/fake-queries.ts, the TS twin of
// `queries_q::patch`, docs/contracts/v1-queries.md §1.4, §5): every line outside the edited keys and `modified:` is
// byte-identical, the result parses to the intended query, and a no-op commit writes nothing. The UI's `defEquals`
// (app/ui/src/queries/model.ts, §4.2) must agree that the file now holds the intended definition, and that a no-op is
// no change, so the editor's commit rule (one write only when something changed, FR-QRY-01 AC-5) and the file agree.
// Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set), printed; `QA_PROPERTY_SCALE` ≥ 100 runs
// 10 seeds × 1,000 cases. Written from the ACs and the contract only (D-61). The model loads inside the test (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { queryPatch, queryRead, splitLines, type FilterItemDto, type QueryDefDto } from '../ui/test/fake-queries';

const FIXED_SEED = 20261110;
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1;
const random = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31;
const SEEDS = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : random + i)) : [FIXED_SEED, random];
const RUNS = scale >= 100 ? 1000 : 40;
console.log(`queries property: ${SEEDS.map((s) => `seed = ${s}`).join(', ')}`);
const NOW = '2026-11-10T10:00:00+01:00';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}

const STAV = ['Aktivní', 'Hotovo', 'Pozastaveno', 'aktivni'];
const itemArb = fc.oneof(
  fc.record({ k: fc.constant('scalar'), n: fc.nat(STAV.length - 1), nfd: fc.boolean(), extra: fc.boolean(), quote: fc.boolean() }),
  fc.record({ k: fc.constant('op'), op: fc.constantFrom('is_not', 'contains'), n: fc.nat(STAV.length - 1), extra: fc.boolean() }),
  fc.record({ k: fc.constant('num'), op: fc.constantFrom('gt', 'lt', 'eq'), v: fc.integer({ min: 0, max: 200000 }) }),
  fc.record({ k: fc.constant('group'), m: fc.constantFrom('all', 'any'), n: fc.nat(STAV.length - 1) }),
);
const fileArb = fc.record({
  version: fc.boolean(), headerComment: fc.boolean(), unknownTop: fc.nat(2), commentAt: fc.array(fc.nat(9), { maxLength: 3 }),
  typesBlock: fc.boolean(), matchComment: fc.boolean(), items: fc.array(itemArb, { minLength: 0, maxLength: 4 }), innerComment: fc.boolean(),
  viewComment: fc.boolean(), view: fc.constantFrom('list', 'table'), limit: fc.integer({ min: 1, max: 1000 }), crlf: fc.boolean(), final: fc.boolean(),
  titleNfd: fc.boolean(),
});
type FileSpec = typeof fileArb extends fc.Arbitrary<infer T> ? T : never;
function render(f: FileSpec): string {
  const L: string[] = [];
  const c = (i: number) => { if (f.commentAt.includes(i)) L.push(`# poznámka ${i}`); };
  L.push('# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Náhodný dotaz.');
  if (f.headerComment) L.push('# Napsáno ručně: komentáře musí přežít.');
  if (f.version) L.push('version: 1');
  c(0); L.push(`title: ${f.titleNfd ? 'Náhodný dotaz'.normalize('NFD') : 'Náhodný dotaz'}`);
  if (f.unknownTop === 1) L.push('x-barva: modrá');
  if (f.unknownTop === 2) L.push('x-pole:', '  - jedna', '  - dvě');
  c(1); L.push(...(f.typesBlock ? ['types:', '  - projekt'] : ['types: [projekt]']));
  c(2); L.push(f.matchComment ? 'match: all            # a nebo nebo' : 'match: all');
  c(3);
  if (!f.items.length) L.push('filters: []');
  else {
    L.push('filters:');
    if (f.innerComment) L.push('  # uvnitř filtrů');
    for (const it of f.items as any[]) {
      if (it.k === 'scalar') { const v = it.nfd ? STAV[it.n].normalize('NFD') : STAV[it.n]; L.push(`  - stav: ${it.quote ? `"${v}"` : v}`); if (it.extra) L.push('    x-poznámka: ručně'); }
      else if (it.k === 'op') { L.push(`  - stav: { ${it.op}: ${STAV[it.n]} }`); if (it.extra) L.push('    x-poznámka: ručně'); }
      else if (it.k === 'num') L.push(`  - rozpočet: { ${it.op}: ${it.v} }`);
      else L.push('  - group:', `      match: ${it.m}`, '      filters:', `        - stav: ${STAV[it.n]}`, '        - rozpočet: { gt: 1000 }');
    }
  }
  c(4); L.push('sort: { by: title, order: asc }');
  c(5); L.push(`limit: ${f.limit}`);
  c(6); L.push(f.viewComment ? `view: ${f.view}            # list nebo table` : `view: ${f.view}`);
  c(7); L.push('columns: [stav, rozpočet]');
  c(8); L.push('created: 2026-08-01T09:00:00+02:00', 'modified: 2026-08-01T09:00:00+02:00');
  c(9);
  const nl = f.crlf ? '\r\n' : '\n';
  return L.join(nl) + (f.final ? nl : '');
}
const editArb = fc.oneof(
  fc.constant({ e: 'none' as const }), fc.constant({ e: 'view' as const }), fc.record({ e: fc.constant('limit' as const), v: fc.integer({ min: 1, max: 1000 }) }),
  fc.constant({ e: 'match' as const }), fc.constant({ e: 'types' as const }), fc.constant({ e: 'columns' as const }), fc.constant({ e: 'order' as const }),
  fc.record({ e: fc.constant('add' as const), v: fc.integer({ min: 0, max: 99999 }) }), fc.constant({ e: 'removeLast' as const }),
);
type Edit = typeof editArb extends fc.Arbitrary<infer T> ? T : never;
function apply(d: QueryDefDto, x: Edit): { def: QueryDefDto; keys: string[] } {
  switch (x.e) {
    case 'none': return { def: d, keys: [] };
    case 'view': return { def: { ...d, view: d.view === 'list' ? 'table' : 'list' }, keys: ['view'] };
    case 'limit': return x.v === d.limit ? { def: d, keys: [] } : { def: { ...d, limit: x.v }, keys: ['limit'] };
    case 'match': return { def: { ...d, match: d.match === 'all' ? 'any' : 'all' }, keys: ['match'] };
    case 'types': return { def: { ...d, types: [...d.types, 'osoba'] }, keys: ['types'] };
    case 'columns': return { def: { ...d, columns: [...d.columns, 'modified'] }, keys: ['columns'] };
    case 'order': return { def: { ...d, sort: { ...d.sort, order: d.sort.order === 'asc' ? 'desc' : 'asc' } }, keys: ['sort'] };
    case 'add': return { def: { ...d, filters: [...d.filters, { kind: 'filter', key: 'rozpočet', op: 'gt', value: x.v, src: null }] }, keys: ['filters'] };
    case 'removeLast': return d.filters.length ? { def: { ...d, filters: d.filters.slice(0, -1) }, keys: ['filters'] } : { def: d, keys: [] };
  }
}
/** The file's lines without the lines of `keys` (and `modified:`), each with its line ending. */
function outside(text: string, keys: string[]): string[] {
  const r = queryRead(text, true, 'Náhodný dotaz');
  assert.ok(r.layout, 'the file reads with a layout');
  const drop = new Set<number>();
  for (const k of r.layout!.keys) if (keys.includes(k.key) || k.key === 'modified') for (let i = k.start; i < k.end; i++) drop.add(i);
  return splitLines(text).filter((_, i) => !drop.has(i)).map((l) => l.text + l.end);
}
const noSrc = (items: FilterItemDto[]): FilterItemDto[] => items.map((i) => (i.kind === 'group' ? { ...i, src: null, filters: noSrc(i.filters) } : { ...i, src: null } as FilterItemDto));
const plain = (d: QueryDefDto): QueryDefDto => ({ ...d, filters: noSrc(d.filters) });

test('fr_fmt_07_ac29_query_file_minimal_patches', async () => {
  const m = await load('../ui/src/queries/model.ts');
  assert.ok(m && typeof m.defEquals === 'function', 'ui/src/queries/model.ts exports defEquals (contract §4.2)');
  for (const seed of SEEDS) {
    fc.assert(fc.property(fileArb, editArb, (f, x) => {
      const text = render(f);
      const read = queryRead(text, true, 'Náhodný dotaz');
      assert.equal(read.state, 'ok', 'the random file reads');
      const { def, keys } = apply(read.def, x);
      const r = queryPatch(text, read, def, NOW);
      assert.ok(!('error' in r), `the commit is accepted (${'error' in r ? r.error.kind : ''})`);
      const out = (r as { text: string | null }).text;
      assert.equal(m!.defEquals(plain(read.def), plain(def)), keys.length === 0, 'the UI sees a change exactly when a key changed');
      if (!keys.length) { assert.equal(out, null, 'a no-op commit writes nothing'); return; }
      assert.ok(out !== null, 'a change writes');
      assert.deepEqual(outside(out!, keys), outside(text, keys), 'every line outside the edited keys and `modified:` is byte-identical');
      assert.ok(out!.includes(`modified: ${NOW}`), '`modified:` is the commit time');
      assert.equal(out!.endsWith('\n'), f.final, 'a missing final newline stays missing');
      if (f.crlf) assert.ok(!/[^\r]\n/.test(out!), 'CRLF stays CRLF');
      const back = queryRead(out!, true, 'Náhodný dotaz');
      assert.equal(back.state, 'ok', 'the result reads');
      assert.ok(m!.defEquals(plain(back.def), plain({ ...def, title: back.def.title })), 'the result parses to the intended query');
      if (f.unknownTop === 1) assert.ok(out!.includes('x-barva: modrá'), 'the unknown top-level key stays');
      if (!keys.includes('filters')) assert.equal((out!.match(/x-poznámka: ručně/g) ?? []).length, (text.match(/x-poznámka: ručně/g) ?? []).length, 'item extra keys stay');
    }), { seed, numRuns: RUNS });
  }
}, 600_000);
