// Keeps the fake core's slice Q2 behaviour (app/ui/test/fake-queries.ts, fake-schema.ts; docs/contracts/v1-views.md §5)
// honest against the shared Q2 corpus: tests/fixtures/queries-files/expected-views.json (reads, groups, results; L3,
// D-1814, read by crates/tegg-core/tests/ac_views.rs too) and the expected bytes of
// tests/fixtures/queries-files/expected/views/ (steps in sequence as its README lists them, D-1822). The WebKit tests
// (L5) run against this twin, so it must agree with the core. Not an AC test: the AC tests (app/test/views_*.ac.test.ts,
// packages/doc/test/board_move*.ac.test.ts, crates/*/tests/ac_views*.rs) check the product.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { columnsDefault, handle, queryCreateText, queryPatch, queryRead, queryRetitleText, queryRun, type QueryDefDto, type SortDto } from '../ui/test/fake-queries';
import { handle as handleSchema, listTypes, renameView } from '../ui/test/fake-schema';

const REPO = resolve(import.meta.dirname, '../..');
const FX = resolve(REPO, 'tests/fixtures/vaults/views');
const QFX = resolve(REPO, 'tests/fixtures/queries-files');
const NOW = '2026-11-19T10:00:00+01:00';
const CS = { today: '2026-11-19', zone: 'Europe/Prague', weekStart: 1, locale: 'cs' };

function viewsVault(): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (root: string, d: string, prefix: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { walk(root, p, prefix); continue; }
      const rel = (prefix + relative(root, p)).normalize('NFC');
      if (rel === 'README.md') continue;
      files[rel] = readFileSync(p, 'utf8');
    }
  };
  walk(FX, FX, '');
  const ne = resolve(REPO, 'tests/fixtures/vaults/new-empty/.tegg');
  walk(ne, ne, '.tegg/');
  return files;
}
const files = viewsVault();
const types = listTypes(files, {});
const cols = columnsDefault(types);
const ex = JSON.parse(readFileSync(join(QFX, 'expected-views.json'), 'utf8'));
const expected = (name: string) => readFileSync(join(QFX, 'expected/views', name), 'utf8');
const qfile = (name: string) => `.tegg/queries/${name.normalize('NFC')}.yml`;
const stem = (p: string) => p.split('/').pop()!.replace(/\.yml$/, '');
const crlf = (t: string) => t.replace(/\n/g, '\r\n');
const noNewline = (t: string) => t.replace(/\n$/, '');
const S = (...xs: [string, 'asc' | 'desc'][]): SortDto[] => xs.map(([by, order]) => ({ by, order }));

/** One commit of `change` on `text` (a query file): the written text. */
function commit(text: string, name: string, change: (d: QueryDefDto) => QueryDefDto): string {
  const read = queryRead(text, true, name, cols);
  const r = queryPatch(text, read, change(read.def), NOW);
  assert.ok('text' in r && r.text !== null, `${name}: the commit writes (${'error' in r ? r.error.kind : 'no change'})`);
  return (r as { text: string }).text;
}

// ------------------------------------------------------------------------------------------------ L3

test('the twin reads every query file as expected-views.json', () => {
  const bad: string[] = [];
  for (const [path, want] of Object.entries(ex.reads as Record<string, any>)) {
    assert.ok(files[path] !== undefined, `${path} is a fixture file`);
    const r = queryRead(files[path], true, stem(path), cols);
    // Q2-T's def keys (`groupPeriod`, `doneLane`, v1-views §24.1) aren't part of Q2's corpus: only its keys compare.
    const def = r.state === 'unreadable' || !want.def ? null : Object.fromEntries(Object.keys(want.def).map((k) => [k, (r.def as any)[k]]));
    const got = { state: r.state, line: r.line, def, broken: r.broken, usesThis: r.usesThis };
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${path}\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, []);
});

test('the twin groups every expected-views.json board', async () => {
  for (const g of ex.groups as any[]) {
    const r = await queryRun({ kind: 'saved', name: g.query }, null, g.env, files, types);
    assert.ok(r.group, `${g.query}: a group`);
    const got = { key: r.group!.key, kind: r.group!.kind, lanes: r.group!.lanes.map((l) => ({ id: l.id, label: l.label, excluded: l.excluded, dropTarget: l.dropTarget, paths: l.cards.map((c) => r.rows[c.row].path) })) };
    assert.deepEqual(got, { key: g.key, kind: g.kind, lanes: g.lanes }, `${g.query} (${g.env.locale})`);
  }
});

test('the twin runs every expected-views.json result', async () => {
  for (const row of ex.results as any[]) {
    const r = await queryRun({ kind: 'saved', name: row.query }, null, row.env, files, types);
    assert.deepEqual({ paths: r.rows.map((x) => x.path), state: r.state, broken: r.broken }, { paths: row.paths, state: row.state, broken: row.broken }, `${row.query} (${row.env.locale})`);
  }
});

test('the twin fills the Q2 fields of summaries and rows', async () => {
  const list = (await handle('queries_list', {}, files)).result as any[];
  const roz = list.find((s) => s.name === 'Rozečtené');
  assert.deepEqual([roz.view, roz.types], ['board', ['book']], 'QuerySummaryDto.view and types');
  const r = await queryRun({ kind: 'saved', name: 'Rozečtené' }, null, CS, files, types);
  assert.ok(r.rows.every((x) => typeof x.excerpt === 'string' && x.readOnly === false && 'status' in x.values), 'rows carry excerpt, readOnly and the grouping key');
  const usages = (await handle('query_view_usages', { name: 'rozečtené' }, files)).result;
  assert.deepEqual(usages, [{ type: 'book', path: '.tegg/types/book.yml' }], 'query_view_usages by name key');
});

// ------------------------------------------------------------------------------------------------ query-file bytes

test('sort writes give expected/views/*sort*.yml and *click*.yml', () => {
  const p26 = files[qfile('Přečtené 2026')];
  const steps: [string, SortDto[]][] = [
    ['prectene-2026-sort-rating-desc.yml', S(['finished', 'desc'], ['rating', 'desc'], ['title', 'asc'])],
    ['prectene-2026-sort-title-first.yml', S(['title', 'asc'], ['finished', 'desc'], ['rating', 'desc'])],
    ['prectene-2026-sort-one-level.yml', S(['title', 'asc'])],
    ['prectene-2026-sort-add-created.yml', S(['title', 'asc'], ['created', 'asc'])],
    ['prectene-2026-sort-cleared.yml', S(['modified', 'desc'])],
  ];
  let text = p26;
  for (const [name, sort] of steps) { text = commit(text, 'Přečtené 2026', (d) => ({ ...d, sort })); assert.equal(text, expected(name), name); }
  const clicks: [string, SortDto[]][] = [
    ['prectene-2026-click-rating.yml', S(['rating', 'asc'])],
    ['prectene-2026-click-rating-desc.yml', S(['rating', 'desc'])],
    ['prectene-2026-shift-finished.yml', S(['rating', 'desc'], ['finished', 'asc'])],
    ['prectene-2026-click-author.yml', S(['author', 'asc'])],
  ];
  text = p26;
  for (const [name, sort] of clicks) { text = commit(text, 'Přečtené 2026', (d) => ({ ...d, sort })); assert.equal(text, expected(name), name); }
  const vk = commit(files[qfile('Výborné knihy')], 'Výborné knihy', (d) => ({ ...d, sort: S(['title', 'asc'], ['finished', 'asc']) }));
  assert.equal(vk, expected('vyborne-knihy-sort-two-levels.yml'));
  assert.equal(commit(vk, 'Výborné knihy', (d) => ({ ...d, sort: S(['title', 'asc']) })), expected('vyborne-knihy-sort-back-to-one.yml'));
  assert.equal(commit(files[qfile('Podle žánru')], 'Podle žánru', (d) => ({ ...d, sort: S(['title', 'asc'], ['created', 'asc']) })), expected('podle-zanru-sort-add-level.yml'));
});

test('board writes give expected/views/*lanes*.yml and *lane-order*.yml', () => {
  const roz = files[qfile('Rozečtené')];
  const zanr = files[qfile('Podle žánru')];
  const autor = files[qfile('Podle autora')];
  assert.equal(commit(roz, 'Rozečtené', (d) => ({ ...d, lanes: 'horizontal' })), expected('rozectene-lanes-horizontal.yml'));
  assert.equal(commit(autor, 'Podle autora', (d) => ({ ...d, lanes: 'horizontal' })), expected('podle-autora-lanes-horizontal.yml'));
  for (const [v, f] of [['', (t: string) => t], ['-crlf', crlf], ['-no-newline', noNewline]] as const) {
    assert.equal(commit(f(zanr), 'Podle žánru', (d) => ({ ...d, lanes: 'vertical' })), expected(`podle-zanru-lanes-vertical${v}.yml`), `podle-zanru-lanes-vertical${v}`);
  }
  assert.deepEqual(queryPatch(autor, queryRead(autor, true, 'Podle autora', cols), { ...queryRead(autor, true, 'Podle autora', cols).def, lanes: 'vertical' }, NOW), { text: null }, 'a missing `lanes` is vertical: no write');
  assert.equal(commit(roz, 'Rozečtené', (d) => ({ ...d, laneOrder: ['To read', 'Reading', 'Read'] })), expected('rozectene-lane-order-to-read-first.yml'));
  assert.equal(commit(roz, 'Rozečtené', (d) => ({ ...d, laneOrder: null })), expected('rozectene-lane-order-reset.yml'));
  const cest = commit(zanr, 'Podle žánru', (d) => ({ ...d, laneOrder: ['Cestopis', 'Román', 'Detektivka', 'Poezie', 'Eseje'] }));
  assert.equal(cest, expected('podle-zanru-lane-order-cestopis.yml'));
  assert.equal(commit(cest, 'Podle žánru', (d) => ({ ...d, laneOrder: null })), expected('podle-zanru-lane-order-reset-after-drag.yml'));
  const tomas = ['[[Tomáš Rybář]]', '[[Eva Lindová]]', '[[Jana Brázdová]]', '[[Lucie Horká]]', '[[Marek Sova]]'];
  assert.equal(commit(autor, 'Podle autora', (d) => ({ ...d, laneOrder: tomas })), expected('podle-autora-lane-order-tomas.yml'));
});

test('editor and column writes give the expected files', () => {
  const p26 = files[qfile('Přečtené 2026')];
  assert.equal(commit(p26, 'Přečtené 2026', (d) => ({ ...d, columns: [...d.columns, 'genres'] })), expected('prectene-2026-columns-genres.yml'));
  assert.equal(commit(p26, 'Přečtené 2026', (d) => ({ ...d, columns: ['finished', 'author', 'rating'] })), expected('prectene-2026-columns-reordered.yml'));
  const g = commit(files[qfile('Rozečtené')], 'Rozečtené', (d) => ({ ...d, groupBy: 'genres' }));
  assert.equal(g, expected('rozectene-group-by-genres.yml'));
  assert.equal(commit(g, 'Rozečtené', (d) => ({ ...d, view: 'table', groupBy: null })), expected('rozectene-view-table.yml'), '`group_by: null` leaves the line');
  assert.equal(queryRetitleText(p26, queryRead(p26, true, 'Přečtené 2026', cols), 'Přečtené letos'), expected('prectene-letos-renamed.yml'));
});

test('New view gives new-view-*.yml', () => {
  const base = { types: [], match: 'all' as const, filters: [], sort: S(['modified', 'desc']), limit: 50, groupBy: null, lanes: 'vertical' as const, laneOrder: null };
  assert.equal(queryCreateText({ ...base, title: 'New view', types: ['autor'], view: 'table', columns: ['poznámka', 'modified'] }, NOW), expected('new-view-autor.yml'));
  assert.equal(queryCreateText({ ...base, title: 'New view', types: ['book'], view: 'board', groupBy: 'status', columns: [] }, NOW), expected('new-view-board-book.yml'), 'a new Board writes no columns (D-1910)');
});

test('the 4C link patch rewrites lane_order links', async () => {
  const p = qfile('Podle autora');
  const text = files[p].replace('group_by: author\n', 'group_by: author\nlane_order: ["[[Marek Sova]]", "[[Eva Lindová]]"]\n');
  const paths = Object.keys(files).filter((x) => x.endsWith('.md') && !x.startsWith('.trash/'));
  const r = await handle('queries_job', { patches: [{ kind: 'objectMoved', from: 'Autoři/Marek Sova.md', to: 'Autoři/Marek Sovák.md', paths }] }, { ...files, [p]: text });
  assert.equal(r.writes?.[p], expected('podle-autora-lane-order-marek-sovak.yml'));
});

// ------------------------------------------------------------------------------------------------ type-file bytes

const V = { mtimeNs: '1', size: 1, hash: 'h' };
async function views(key: string, text: string, names: string[]): Promise<string> {
  const p = `.tegg/types/${key}.yml`;
  const r = await handleSchema('type_patch', { key, base: V, ops: [{ op: 'views', names }] }, { ...files, [p]: text }, { [p]: V });
  assert.ok(!r.error, `${key}: views written (${JSON.stringify(r.error)})`);
  return (r.writes ?? {})[p] ?? text;
}

test('views writes give expected/views/types/*.yml', async () => {
  const book = files['.tegg/types/book.yml'];
  const V3 = ['Rozečtené', 'Přečtené 2026', 'Výborné knihy'];
  assert.equal(await views('autor', files['.tegg/types/autor.yml'], ['New view']), expected('types/autor-views-new-view.yml'));
  assert.equal(await views('book', book, [...V3, 'New view']), expected('types/book-views-new-view.yml'));
  assert.equal(await views('book', book, [...V3, 'Podle žánru']), expected('types/book-views-podle-zanru.yml'));
  assert.equal(await views('book', book, ['Výborné knihy', 'Rozečtené', 'Přečtené 2026']), expected('types/book-views-dragged.yml'));
  assert.equal(await views('book', crlf(book), ['Výborné knihy', 'Rozečtené', 'Přečtené 2026']), expected('types/book-views-crlf-dragged.yml'));
  assert.equal(await views('book', noNewline(book), ['Výborné knihy', 'Rozečtené', 'Přečtené 2026']), expected('types/book-views-no-newline-dragged.yml'));
  assert.equal(await views('book', book, ['Přečtené 2026', 'Rozečtené', 'Výborné knihy']), expected('types/book-views-move-right.yml'));
  assert.equal(await views('book', book, [...V3, 'Výborné knihy (2)']), expected('types/book-views-duplicate.yml'));
  const removed = await views('book', book, ['Rozečtené', 'Výborné knihy']);
  assert.equal(removed, expected('types/book-views-removed.yml'));
  assert.equal(await views('book', removed, []), expected('types/book-views-empty.yml'));
  const block = book.replace('views: [Rozečtené, Přečtené 2026, Výborné knihy]\n', 'views:\n  - Rozečtené\n  - Přečtené 2026\n  - Výborné knihy\n');
  assert.equal(await views('book', block, ['Rozečtené', 'Výborné knihy']), expected('types/book-views-block-to-flow.yml'));
  assert.equal(renameView('book', book, 'Přečtené 2026', 'Přečtené letos'), expected('types/book-views-renamed.yml'));
  assert.equal(await views('book', book, V3), book, 'the same list: no write');
  const scalar = book.replace('views: [Rozečtené, Přečtené 2026, Výborné knihy]', 'views: Rozečtené');
  const t = listTypes({ ...files, '.tegg/types/book.yml': scalar }, {}).find((x) => x.key === 'book')!;
  assert.deepEqual([t.views, t.viewsUnreadable], [null, true], 'a scalar `views` is unreadable');
  const refused = await handleSchema('type_patch', { key: 'book', base: V, ops: [{ op: 'views', names: [] }] }, { ...files, '.tegg/types/book.yml': scalar }, { '.tegg/types/book.yml': V });
  assert.equal((refused.error as any)?.reason, 'viewsUnreadable', 'refused with viewsUnreadable');
  const other = await handleSchema('type_patch', { key: 'book', base: V, ops: [{ op: 'preview', keys: ['author'] }] }, { ...files, '.tegg/types/book.yml': block }, { '.tegg/types/book.yml': V });
  assert.ok(((other.writes ?? {})['.tegg/types/book.yml'] ?? '').includes('views:\n  - Rozečtené\n  - Přečtené 2026\n  - Výborné knihy\n'), 'another op keeps the views block');
});

test('the rename plan patches views: lines', async () => {
  const r = await handle('query_rename_plan', { name: 'Přečtené 2026', title: 'Přečtené letos' }, files);
  assert.deepEqual((r.result as any).views, [{ path: '.tegg/types/book.yml', pre: files['.tegg/types/book.yml'], post: expected('types/book-views-renamed.yml') }]);
});
