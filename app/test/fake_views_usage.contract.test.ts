// Keeps the fake core's slice Q2.1 behaviour (app/ui/test/fake-queries.ts, fake-schema.ts; docs/contracts/v1-views.md
// §21.1) honest against the shared Q2.1 corpus: tests/fixtures/queries-files/expected-views-usage.json (`items`,
// `fences`, `results`; L3, read by crates/tegg-core/tests/ac_views_usage.rs too) and the expected bytes of
// tests/fixtures/queries-files/expected/views-usage/ (types/, notes/knihy-na-cesty-renamed.md; README there). The WebKit
// tests (L5) run against this twin, so it must agree with the core. Not an AC test: the AC tests
// (app/test/views_usage_*.ac.test.ts, packages/doc/test/query_usage*.ac.test.ts, crates/*/tests/ac_views_usage*.rs)
// check the product.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { handle, queryFencesOf, queryRun, type SortDto } from '../ui/test/fake-queries';
import { handle as handleSchema, listTypes, renameView } from '../ui/test/fake-schema';

const REPO = resolve(import.meta.dirname, '../..');
const QFX = resolve(REPO, 'tests/fixtures/queries-files');
const BOOK = '.tegg/types/book.yml';
const CESTY = 'Pages/Knihy na cesty.md';

function tree(root: string, prefix: string, into: Record<string, string>) {
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      const rel = (prefix + relative(root, p)).normalize('NFC');
      if (rel === 'README.md') continue;
      into[rel] = readFileSync(p, 'utf8');
    }
  };
  walk(root);
  return into;
}
/** The base fixture, then (overlay) views-usage/ over it, then new-empty/.tegg/ (the overlay README's recipe). */
function vault(overlay: boolean): Record<string, string> {
  const files: Record<string, string> = {};
  tree(resolve(REPO, 'tests/fixtures/vaults/views'), '', files);
  if (overlay) tree(resolve(REPO, 'tests/fixtures/vaults/views-usage'), '', files);
  const ne = resolve(REPO, 'tests/fixtures/vaults/new-empty/.tegg');
  tree(ne, '.tegg/', files);
  return files;
}
const base = vault(false);
const over = vault(true);
const ex = JSON.parse(readFileSync(join(QFX, 'expected-views-usage.json'), 'utf8'));
const expected = (name: string) => readFileSync(join(QFX, 'expected/views-usage', name), 'utf8');
const S = (...xs: [string, 'asc' | 'desc'][]): SortDto[] => xs.map(([by, order]) => ({ by, order }));
const nfd = (s: string) => s.normalize('NFD');
const crlf = (t: string) => t.replace(/\n/g, '\r\n');

const V = { mtimeNs: '1', size: 1, hash: 'h' };
/** One `type_patch` of `ops` on `book.yml` = `text`: the written text (`text` itself when nothing is written) or the error. */
async function patch(text: string, ops: unknown[], files = base): Promise<{ text: string; wrote: boolean } | { error: any }> {
  const r = await handleSchema('type_patch', { key: 'book', base: V, ops }, { ...files, [BOOK]: text }, { [BOOK]: V });
  if (r.error) return { error: r.error };
  const w = (r.writes ?? {})[BOOK];
  return { text: w ?? text, wrote: w !== undefined };
}
async function wrote(text: string, ops: unknown[], what: string): Promise<string> {
  const r = await patch(text, ops);
  assert.ok('text' in r, `${what}: written (${JSON.stringify((r as any).error)})`);
  assert.ok((r as any).wrote, `${what}: a write`);
  return (r as { text: string }).text;
}
const viewSort = (name: string, sort: SortDto[] | null) => ({ op: 'viewSort', name, sort });
const viewColumns = (name: string, columns: string[] | null) => ({ op: 'viewColumns', name, columns });
const views = (names: string[]) => ({ op: 'views', names });
const itemOf = (it: any) => ({ name: it.name, sort: it.sortBroken ? 'broken' : it.sort, columns: it.columnsBroken ? 'broken' : it.columns, plain: it.plain });
const bookOf = (files: Record<string, string>, text?: string) => listTypes(text === undefined ? files : { ...files, [BOOK]: text }, {}).find((t) => t.key === 'book')!;

// ------------------------------------------------------------------------------------------------ L3

test('the twin reads the overlay book.yml items as expected-views-usage.json', () => {
  const t = bookOf(over);
  assert.deepEqual(t.views, ['Rozečtené', 'Přečtené 2026', 'Výborné knihy'], 'TypeDto.views: the names (D-1855)');
  assert.deepEqual(t.viewItems.map(itemOf), ex.items, 'TypeDto.viewItems');
  assert.equal(t.viewsSource, over[BOOK].split('\n').slice(12, 20).join('\n') + '\n', 'viewsSource: lines 13…20 as written');
  assert.deepEqual(bookOf(base).viewItems.map(itemOf), ['Rozečtené', 'Přečtené 2026', 'Výborné knihy'].map((name) => ({ name, sort: null, columns: null, plain: true })), 'the base: plain names');
  assert.equal(bookOf(base).viewsSource, 'views: [Rozečtené, Přečtené 2026, Výborné knihy]\n');
});

test('the twin reads every expected-views-usage.json fence', async () => {
  const d = await import('@tegg/doc');
  const bad: string[] = [];
  for (const e of ex.fences as any[]) {
    const f = (await queryFencesOf(readFileSync(resolve(REPO, e.file), 'utf8')))[e.fence - 1];
    const u = f ? d.fenceUsage(f.body) : null;
    const got = { saved: (f?.saved ?? '').normalize('NFC'), sort: u?.sort ?? null, columns: u?.columns ?? null };
    const want = { saved: String(e.saved).normalize('NFC'), sort: e.sort, columns: e.columns };
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${e.file} #${e.fence}\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, []);
});

test('the twin runs every expected-views-usage.json result (R200)', async () => {
  const types = listTypes(over, {});
  const bad: string[] = [];
  for (const row of ex.results as any[]) {
    let source: any = row.source;
    if (source.kind === 'fence') {
      const f = (await queryFencesOf(readFileSync(resolve(REPO, source.file), 'utf8')))[source.fence - 1];
      source = { kind: 'fence', body: f.body };
    }
    const r = await queryRun(source, null, row.env, over, types);
    const got: Record<string, unknown> = { state: r.state, broken: r.broken, usage: r.usage };
    const want: Record<string, unknown> = { state: row.state, broken: row.broken, usage: row.usage };
    if (row.lanes) { got.lanes = (r.group?.lanes ?? []).map((l) => ({ id: l.id, paths: l.cards.map((c) => r.rows[c.row].path) })); want.lanes = row.lanes; }
    else { got.paths = r.rows.map((x) => x.path); want.paths = row.paths; }
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${JSON.stringify(row.source)} (${row.env.locale})\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, []);
});

test('the twin keeps the query file\'s def and answers no usage on query/<name>, inline and missing queries', async () => {
  const types = listTypes(over, {});
  const env = ex.results[0].env;
  const tab = await queryRun({ kind: 'view', type: 'book', name: 'Přečtené 2026' }, null, env, over, types);
  const page = await queryRun({ kind: 'saved', name: 'Přečtené 2026' }, null, env, over, types);
  assert.deepEqual(tab.def, page.def, 'result.def is the query file\'s (D-1854)');
  assert.equal(page.usage, null, 'query/<name>: no usage');
  const inline = await queryRun({ kind: 'fence', body: 'title: Ruční dotaz\ntypes: [book]' }, null, env, over, types);
  assert.equal(inline.usage, null, 'an inline fence: no usage');
  const missing = await queryRun({ kind: 'view', type: 'book', name: 'Neexistuje' }, null, env, over, types);
  assert.deepEqual([missing.lookup, missing.usage], ['missing', null], 'a missing query: no usage');
  const empty = await queryRun({ kind: 'fence', body: 'saved: Přečtené 2026\nsort: []\ncolumns: [neznámý, author]' }, null, env, over, types);
  assert.deepEqual(empty.usage?.own, { sort: [], columns: ['neznámý', 'author'] }, '`sort: []` and unknown column keys are own values');
  const sideways = await queryRun({ kind: 'fence', body: 'saved: Přečtené 2026\nsort: sideways\ncolumns: author' }, null, env, over, types);
  assert.deepEqual(sideways.usage?.broken.map((b) => b.key), ['sort', 'columns'], 'broken shapes: one entry per key');
  assert.deepEqual(sideways.usage?.sort, page.def!.sort, 'and the query\'s values');
});

// ------------------------------------------------------------------------------------------------ type-file bytes (§14.2)

test('viewSort / viewColumns give expected/views-usage/types/*.yml (FR-QRY-07 AC-23, AC-24)', async () => {
  const b = base[BOOK], o = over[BOOK];
  const a = await wrote(b, [viewSort('Výborné knihy', S(['title', 'asc'], ['finished', 'asc']))], '(a)');
  assert.equal(a, expected('types/book-vyborne-shift-finished.yml'));
  const bb = await wrote(a, [viewSort('Výborné knihy', S(['title', 'asc']))], '(b)');
  assert.equal(bb, expected('types/book-vyborne-sort-title-only.yml'));
  assert.equal(await wrote(bb, [viewSort('Výborné knihy', null)], '(c)'), b, '(c) Use the query\'s sort: the base again');
  assert.deepEqual(await patch(bb, [viewSort('Výborné knihy', S(['title', 'asc']))]), { text: bb, wrote: false }, 'the same own sort: no write');
  assert.equal(await wrote(o, [viewSort('Přečtené 2026', S(['finished', 'asc']))], 'overlay'), expected('types/book-overlay-prectene-click-finished.yml'));
  assert.equal(await wrote(crlf(o), [viewSort('Přečtené 2026', S(['finished', 'asc']))], 'crlf'), expected('types/book-overlay-prectene-click-finished-crlf.yml'));
  assert.equal(await wrote(o.replace(/\n$/, ''), [viewSort('Přečtené 2026', S(['finished', 'asc']))], 'no newline'), expected('types/book-overlay-prectene-click-finished.yml').replace(/\n$/, ''));
  assert.equal(await wrote(b, [viewSort('Rozečtené', S(['status', 'asc'], ['modified', 'desc'], ['title', 'asc']))], 'add sort'), expected('types/book-rozectene-sort-add.yml'));
  const g = await wrote(b, [viewColumns('Přečtené 2026', ['author', 'rating', 'finished', 'genres'])], 'genres');
  assert.equal(g, expected('types/book-prectene-columns-genres.yml'));
  assert.equal(await wrote(g, [viewColumns('Přečtené 2026', ['finished', 'author', 'rating', 'genres'])], 'reordered'), expected('types/book-prectene-columns-reordered.yml'));
  const one = await wrote(b, [{ op: 'addAttribute', attribute: { key: 'stran', name: 'Stran', type: 'number' } }], 'stran 1');
  assert.equal(one, expected('types/book-new-property-stran-1.yml'));
  assert.equal(await wrote(one, [viewColumns('Přečtené 2026', ['author', 'rating', 'finished', 'stran'])], 'stran 2'), expected('types/book-new-property-stran-2.yml'));
  assert.equal(await wrote(o, [viewColumns('Přečtené 2026', ['author', 'rating', 'finished'])], 'no genres'), expected('types/book-overlay-prectene-no-genres.yml'));
  const refused = await patch(b, [viewSort('Neexistuje', S(['title', 'asc']))]);
  assert.equal((refused as any).error?.reason, 'viewNotListed', 'a name not in views: Rule(viewNotListed)');
});

test('views items keep their lines, unknown keys and quoting (FR-QRY-07 AC-25, FR-FMT-12 AC-13)', async () => {
  const o = over[BOOK];
  const sideways = o.replace('    sort:\n      - { by: rating, order: asc }\n      - { by: title, order: asc }\n', '    sort: sideways\n');
  assert.deepEqual(itemOf(bookOf(over, sideways).viewItems[1]), { name: 'Přečtené 2026', sort: 'broken', columns: ['author', 'rating', 'finished', 'genres'], plain: false }, '(b) a broken own sort');
  const x = expected('types/book-overlay-xbarva-input.yml');
  assert.deepEqual(itemOf(bookOf(over, x).viewItems[1]), ex.items[1], '(c) the unknown key ignored when read');
  const v = await wrote(x, [viewSort('Výborné knihy', S(['title', 'asc'], ['finished', 'asc']))], '(c) Výborné knihy');
  assert.equal(v, expected('types/book-overlay-xbarva-after-vyborne.yml'));
  assert.equal(await wrote(v, [viewSort('Přečtené 2026', S(['finished', 'asc']))], '(c) Přečtené 2026'), expected('types/book-overlay-xbarva-after-prectene.yml'));
  const dup = o.replace('  - Výborné knihy\n', '  - Výborné knihy\n  - name: přečtené 2026\n    columns: [author]\n');
  assert.equal(bookOf(over, dup).viewItems.length, 4, '(d) repeats kept');
  const first = await wrote(dup, [viewColumns('Přečtené 2026', ['author', 'rating', 'finished'])], '(d) first only');
  assert.ok(first.includes('    columns: [author, rating, finished]\n  - Výborné knihy\n  - name: přečtené 2026\n    columns: [author]\n'), first);
  assert.equal(await wrote(dup, [views(['Rozečtené', 'Výborné knihy'])], '(d) remove'), expected('types/book-overlay-without-prectene.yml'));
  assert.equal(await wrote(expected('types/book-overlay-quoted-name-input.yml'), [viewSort('Čtu, až bude čas', S(['title', 'asc']))], '(e)'), expected('types/book-overlay-quoted-name.yml'));
  const nfdIn = expected('types/book-overlay-nfd-input.yml');
  assert.equal(bookOf(over, nfdIn).viewItems[1].name, 'Přečtené 2026', '(f) an NFD name reads NFC');
  assert.equal(await wrote(nfdIn, [viewSort('Přečtené 2026', S(['finished', 'asc']))], '(f)'), expected('types/book-overlay-nfd-after-change.yml'));
  assert.equal(await wrote(o, [viewSort(nfd('PŘEČTENÉ 2026'), S(['finished', 'asc']))], 'name key'), expected('types/book-overlay-prectene-click-finished.yml'));
  const n = await wrote(base[BOOK], [viewColumns(nfd('Přečtené 2026'), [nfd('poznámka'), 'author'])], 'NFD values');
  assert.ok(n.includes('  - name: Přečtené 2026\n    columns: [poznámka, author]\n'), n);
  // Flow mapping items; unreadable items.
  const line13 = 'views: [Rozečtené, Přečtené 2026, Výborné knihy]\n';
  const flow = base[BOOK].replace(line13, 'views: [Rozečtené, { name: Přečtené 2026, columns: [author], x-barva: modrá }]\n');
  assert.deepEqual(bookOf(base, flow).viewItems.map(itemOf), [{ name: 'Rozečtené', sort: null, columns: null, plain: true }, { name: 'Přečtené 2026', sort: null, columns: ['author'], plain: false }]);
  assert.deepEqual(itemOf(bookOf(base, base[BOOK].replace(line13, 'views:\n  - name: Rozečtené\n')).viewItems[0]), { name: 'Rozečtené', sort: null, columns: null, plain: true }, 'only `name`: plain');
  for (const bad of ['views:\n  - sort: { by: title, order: asc }\n', 'views:\n  - name: [a]\n', 'views:\n  - name: "  "\n', 'views: [Rozečtené, 3]\n', 'views: [Rozečtené, [x]]\n']) {
    const t = bookOf(base, base[BOOK].replace(line13, bad));
    assert.deepEqual([t.state, t.views, t.viewItems, t.viewsUnreadable], ['ok', null, null, true], bad);
  }
  // Names-only changes: flow stays flow; a dragged block list keeps the item's lines; the same items write nothing.
  assert.equal(await wrote(base[BOOK], [views(['Výborné knihy', 'Rozečtené', 'Přečtené 2026'])], 'flow'), base[BOOK].replace(line13, 'views: [Výborné knihy, Rozečtené, Přečtené 2026]\n'));
  const dragged = await wrote(o, [views(['Výborné knihy', 'Rozečtené', 'Přečtené 2026'])], 'drag');
  assert.ok(dragged.includes('views:\n  - Výborné knihy\n  - Rozečtené\n  - name: Přečtené 2026\n    sort:\n      - { by: rating, order: asc }\n      - { by: title, order: asc }\n    columns: [author, rating, finished, genres]\nattributes:\n'), dragged);
  assert.deepEqual(await patch(o, [views(['Rozečtené', 'Přečtené 2026', 'Výborné knihy'])]), { text: o, wrote: false }, 'the same items: no write');
  assert.deepEqual(await patch(o, [viewSort('Přečtené 2026', S(['rating', 'asc'], ['title', 'asc']))]), { text: o, wrote: false }, 'the same own sort: no write');
  // Every other op keeps lines 13…20.
  const lines = o.split('\n').slice(12, 20).join('\n') + '\n';
  for (const op of [{ op: 'columns', keys: ['author', 'rating'] }, { op: 'preview', keys: ['rating'] }, { op: 'removeAttribute', key: 'genres' }, { op: 'addAttribute', attribute: { key: 'stran', name: 'Stran', type: 'number' } }]) {
    assert.ok((await wrote(o, [op], op.op)).includes(lines), `${op.op}: lines 13…20 kept`);
  }
});

test('rename, Duplicate, Remove and trash give the expected bytes (FR-QRY-07 AC-20, AC-21, AC-26; FR-LNK-03 AC-25)', async () => {
  const o = over[BOOK];
  assert.equal(renameView('book', o, 'Přečtené 2026', 'Přečtené letos'), expected('types/book-overlay-renamed.yml'), '(a) line 15 only');
  assert.equal(renameView('book', o, nfd('přečtené 2026'), 'Přečtené letos'), expected('types/book-overlay-renamed.yml'), '(a) by name key');
  const flow = base[BOOK].replace('views: [Rozečtené, Přečtené 2026, Výborné knihy]\n', 'views: [Rozečtené, { name: Přečtené 2026, columns: [author] }]\n');
  assert.equal(renameView('book', flow, 'Přečtené 2026', 'Přečtené letos'), flow.replace('{ name: Přečtené 2026,', '{ name: Přečtené letos,'), '(a) a flow mapping');
  const plan = (await handle('query_rename_plan', { name: 'Přečtené 2026', title: 'Přečtené letos' }, over)).result as any;
  assert.deepEqual(plan.views, [{ path: BOOK, pre: o, post: expected('types/book-overlay-renamed.yml') }], 'the rename plan');
  // The note side of the rename job: only the `saved:` lines (no `modified:` change).
  const usagePatch = (await handle('query_usage_patch', { path: CESTY, text: over[CESTY], from: 'Přečtené 2026', to: 'Přečtené letos' }, over)).result;
  assert.equal(usagePatch, expected('notes/knihy-na-cesty-renamed.md'), 'Cesty renamed');
  const dup = await wrote(o, [
    views(['Rozečtené', 'Přečtené 2026', 'Přečtené 2026 (2)', 'Výborné knihy']),
    viewSort('Přečtené 2026 (2)', S(['rating', 'asc'], ['title', 'asc'])),
    viewColumns('Přečtené 2026 (2)', ['author', 'rating', 'finished', 'genres']),
  ], '(b) duplicate');
  assert.equal(dup, expected('types/book-overlay-duplicate.yml'), '(b) one write');
  const removed = await wrote(o, [views(['Rozečtené', 'Výborné knihy'])], '(c) remove');
  assert.equal(removed, expected('types/book-overlay-without-prectene.yml'));
  assert.equal(await wrote(removed, [views(['Rozečtené', 'Výborné knihy', 'Přečtené 2026'])], '(c) re-add'), expected('types/book-overlay-readded-prectene.yml'));
  assert.equal(await wrote(base[BOOK], [views(['Rozečtené', 'Přečtené 2026'])], 'trash'), expected('types/book-trash-vyborne.yml'));
  // §15: the Undo (and the revert of a failed trash) puts the `views` lines back byte for byte.
  const before = bookOf(over).viewsSource;
  assert.equal(await wrote(removed, [{ op: 'viewsSource', source: before }], 'undo'), o, 'viewsSource: the overlay again');
  assert.equal(await wrote(crlf(removed), [{ op: 'viewsSource', source: crlf(before) }], 'undo crlf'), crlf(o), 'CRLF');
  const refused = await patch(removed, [{ op: 'viewsSource', source: 'views: Rozečtené\n' }]);
  assert.equal((refused as any).error?.reason, 'viewsUnreadable', 'a source whose views can\'t be read is refused');
});
