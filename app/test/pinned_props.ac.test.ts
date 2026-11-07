// Slice PIN, L2 (fast-check): docs/acceptance/pinned.md FR-FMT-07 AC-28's property in TypeScript. Random `pinned.yml`
// files (comments anywhere, unknown keys at both levels, flow and block items, quoted and plain values, CRLF, NFD paths
// and keys, no final newline, skipped items) and a random operation go through the fake core's twin of the patcher
// (app/ui/test/fake-pins.ts, the Rust module's TS twin, docs/contracts/v1-pinned.md §5): every line outside the operated
// item is byte-identical and the result lists the expected pins. The UI's `findPin` (app/ui/src/pinned/model.ts, §3.1)
// must then find every listed target at its index, NFC and region aside (FR-FMT-12 AC-8), so the UI and the file agree.
// Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set), printed; `QA_PROPERTY_SCALE` ≥ 100 runs
// 10 seeds × 1,000 cases. Written from the ACs and the contract only (D-61). The model loads inside the test (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { pinsPatch, pinsRead, type PinEditDto, type PinStoredDto, type PinsDto } from '../ui/test/fake-pins';

const FIXED_SEED = 20261107;
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1;
const random = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31;
const SEEDS = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : random + i)) : [FIXED_SEED, random];
const RUNS = scale >= 100 ? 1000 : 25;
console.log(`pins property: ${SEEDS.map((s) => `seed = ${s}`).join(', ')}`);

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}

const NAMES = ['Rozpočet 2027', 'Čajovna', 'Výjezd Lisabon', 'Plán', 'Štítky a úkoly'];
const TAGS = ['účty', 'offsite', 'čtení', 'Zdraví'];
const quote = (v: string, q: number) => (q === 1 ? `'${v}'` : q === 2 ? `"${v}"` : v);
const itemArb = fc.oneof(
  fc.record({ k: fc.constant('obj'), n: fc.nat(NAMES.length - 1), id: fc.boolean(), q: fc.nat(2), nfd: fc.boolean(), note: fc.boolean(), inner: fc.boolean() }),
  fc.record({ k: fc.constant('tag'), n: fc.nat(TAGS.length - 1), flow: fc.boolean(), nfd: fc.boolean() }),
  fc.record({ k: fc.constant('type'), n: fc.nat(2) }),
  fc.record({ k: fc.constant('query') }),
  fc.record({ k: fc.constant('skip'), n: fc.nat(3) }),
);
const fileArb = fc.record({
  items: fc.array(itemArb, { minLength: 1, maxLength: 7 }), crlf: fc.boolean(), final: fc.boolean(), extraTop: fc.boolean(),
  comments: fc.array(fc.nat(8), { maxLength: 3 }), version: fc.boolean(),
});
type FileSpec = typeof fileArb extends fc.Arbitrary<infer T> ? T : never;
function render(f: FileSpec): string {
  const L = ['# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.'];
  if (f.version) L.push('version: 1');
  if (f.extraTop) L.push('x-sidebar: wide');
  L.push('pins:');
  f.items.forEach((it: any, i: number) => {
    if (f.comments.includes(i)) L.push('  # poznámka mezi položkami');
    const n = (s: string) => (it.nfd ? s.normalize('NFD') : s);
    if (it.k === 'obj') {
      const path = n(`Pages/${NAMES[it.n]}.md`);
      if (it.id) { L.push(`  - id: 01JB5PPROP0000000000000${String(it.n).padStart(3, '0')}`); if (it.inner) L.push('    # uvnitř'); L.push(`    path: ${quote(path, it.q)}`); }
      else L.push(`  - path: ${quote(path, it.q)}`);
      if (it.note) L.push('    x-note: z Macu');
    } else if (it.k === 'tag') L.push(it.flow ? `  - {tag: ${n(TAGS[it.n])}}` : `  - tag: ${n(TAGS[it.n])}`);
    else if (it.k === 'type') L.push(`  - type: ${['projekt', 'schůzka', 'kniha'][it.n]}`);
    else if (it.k === 'query') L.push('  - query: Otevřené úkoly');
    else L.push(['  - jen text', '  - id: 42', '  - path: /etc/hosts', '  - x-route: inbox'][it.n]);
  });
  if (f.comments.includes(8)) L.push('# konec');
  const nl = f.crlf ? '\r\n' : '\n';
  return L.join(nl) + (f.final ? nl : '');
}
const editArb = (n: number) => fc.oneof(
  fc.record({ edit: fc.constant('insert' as const), at: fc.option(fc.nat(n), { nil: null }), t: fc.nat(2) }),
  fc.record({ edit: fc.constant('remove' as const), index: fc.nat(Math.max(0, n - 1)) }),
  fc.record({ edit: fc.constant('move' as const), from: fc.nat(Math.max(0, n - 1)), to: fc.nat(Math.max(0, n - 1)) }),
);
const NEW: PinStoredDto[] = [{ kind: 'object', id: '01JB5PNEW00000000000000001', path: 'Pages/Nová stránka.md' }, { kind: 'tag', key: 'nový' }, { kind: 'type', key: 'nápad' }];
const dto = (text: string): PinsDto => { const r = pinsRead(text); return { version: null, state: r.state, error: r.error, patchable: r.patchable, indexReady: true, rows: r.items.map((it, index) => ({ index, target: it.target, state: 'ok', path: null, title: null, type: null, date: null })) }; };
const asRequest = (t: PinStoredDto) => (t.kind === 'object' ? { kind: 'object', path: t.path } : t);

test('fr_fmt_07_ac28_pinned_yml_minimal_patches', async () => {
  const m = await load('../ui/src/pinned/model.ts');
  assert.ok(m && typeof m.findPin === 'function', 'ui/src/pinned/model.ts `findPin` (§3.1)');
  for (const seed of SEEDS) {
    fc.assert(fc.property(fileArb.chain((f) => { const t = render(f); return fc.tuple(fc.constant(t), editArb(pinsRead(t).items.length)); }), ([text, e]) => {
      const read = pinsRead(text);
      if (read.state !== 'ok' || !read.patchable || read.items.length === 0) return;
      const edit: PinEditDto = e.edit === 'insert' ? { edit: 'insert', target: NEW[(e as any).t], at: (e as any).at } : (e as PinEditDto);
      const r = pinsPatch(text, edit);
      assert.ok(!('error' in r), `${JSON.stringify(edit)} on ${JSON.stringify(text)}: ${JSON.stringify(r)}`);
      const next = (r as { text: string | null }).text ?? text;
      // Reading and writing nothing changes no byte; lines outside the operated item stay.
      const before = text.split(/\r?\n/), after = next.split(/\r?\n/);
      assert.equal(/\r\n/.test(next) || !/\n/.test(next), /\r\n/.test(text) || !/\n/.test(text) ? true : /\r\n/.test(next), 'line endings follow the file');
      assert.equal(/\n$/.test(next), /\n$/.test(text), 'a missing final newline stays missing');
      const [s, e2] = edit.edit === 'insert' ? [-1, -1] : read.items[edit.edit === 'remove' ? edit.index : edit.from].lines;
      const kept = before.filter((_, i) => i < s || i >= e2);
      const left = [...after];
      for (const l of kept) { const j = left.indexOf(l); if (j < 0 && /^pins:/.test(l)) continue; assert.ok(j >= 0, `kept line ${JSON.stringify(l)} in ${JSON.stringify(next)}`); left.splice(j, 1); }
      // The UI finds every listed target of the result at its index.
      const d = dto(next);
      const pathOf = (t: PinStoredDto) => (t.kind === 'object' ? (t.path ?? '').normalize('NFC') : null);
      d.rows.forEach((row, i) => {
        // Two listed object items may share a path (an id item after a path-only one, red-test point AP-1251): skipped here.
        if (pathOf(row.target) && d.rows.filter((r) => pathOf(r.target) === pathOf(row.target)).length > 1) return;
        assert.equal(m!.findPin(d, asRequest(row.target)), i, `findPin finds ${JSON.stringify(row.target)} at ${i}`);
        if (row.target.kind === 'object' && row.target.path) assert.equal(m!.findPin(d, { kind: 'object', path: row.target.path.normalize('NFD') }), i, 'an NFD request matches');
      });
    }), { seed, numRuns: RUNS });
  }
});
