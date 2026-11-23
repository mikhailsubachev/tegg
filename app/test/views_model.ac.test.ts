// Slice Q2, L1: the pure model of the type page's views (docs/contracts/v1-views.md §4.2 `app/ui/src/views/model.ts`):
// docs/acceptance/views.md FR-QRY-07 AC-1 (the model: which pages have tabs, `viewTabs` from `views:` with NFC / case
// dedupe, R184), AC-4 (`newViewDef`, R185 Create), AC-5 (`savedOffers`: R193's enabled and greyed queries and reasons,
// D-1763, AP-1515), AC-6 / AC-10 / AC-12 (the `views:` list after a drop, a move, a remove, an insert), FR-QRY-06 AC-23
// (`pageMarks`), FR-QRY-01 AC-13 (`groupByChoices`, `defaultGroupBy`). Data: app/test/views-data.ts (the fixture's types and
// queries). Written from the ACs and the contract only (D-61). The module loads inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { AUTOR, BOOK, PAGE, SUMMARIES, TAG, TASK, TYPES, summary } from './views-data';

type Mod = Record<string, any>;
async function model(): Promise<Mod> {
  const path = '../ui/src/views/model.ts';
  let m: Mod | null = null;
  try { m = (await import(/* @vite-ignore */ path)) as Mod; } catch { m = null; }
  assert.ok(m, 'ui/src/views/model.ts loads (v1-views §4.2)');
  return m!;
}
const names = (tabs: { name: string }[]) => tabs.map((t) => t.name);
const NFD = (s: string) => s.normalize('NFD');

test('fr_qry_07_ac1_tabs_come_from_views', async () => {
  const m = await model();
  assert.deepEqual(names(m.viewTabs(BOOK, SUMMARIES)), ['Rozečtené', 'Přečtené 2026', 'Výborné knihy'], 'Book: one tab per `views:` name, in order');
  // Slice Q3 (AC-Test-Change, D-2196; FR-QRY-07 AC-33): the icon follows the tab's effective display (`viewTabs().kind`:
  // the item's own valid `view`, else the summary's); `board` reads as `wall` (D-2172, D-2179).
  const wallSummaries = SUMMARIES.map((x: any) => (x.view === 'board' ? { ...x, view: 'wall' } : x));
  const kinds = m.viewTabs(BOOK, wallSummaries).map((t: any) => t.kind ?? null);
  assert.deepEqual(kinds, ['wall', 'table', 'table'], 'each tab\'s kind is its effective display');
  const own = { ...BOOK, viewItems: [{ name: 'Rozečtené', plain: false, view: null, group: { none: true } }, { name: 'Přečtené 2026', plain: false, view: 'wall' }, { name: 'Výborné knihy', plain: true, view: null }] };
  assert.deepEqual(m.viewTabs(own, wallSummaries).map((t: any) => t.kind ?? null), ['wall', 'wall', 'table'], 'an own `view` decides the icon');
  assert.deepEqual(m.viewTabs(AUTOR, SUMMARIES), [], 'Autor (no `views`): no view tab (only `All Autoři`)');
  // R184 odd values: duplicates by name key (NFC, case-insensitive) show once, at the first place.
  const dup = { ...BOOK, views: ['Rozečtené', 'rozečtené', NFD('Rozečtené'), 'Výborné knihy', 'Rozečtené'] };
  assert.deepEqual(names(m.viewTabs(dup, SUMMARIES)), ['Rozečtené', 'Výborné knihy'], 'a repeated name (case, NFD) is one tab at its first place');
  const lost = { ...BOOK, views: ['Rozečtené', 'Ztracený pohled'] };
  const t = m.viewTabs(lost, SUMMARIES);
  assert.deepEqual(names(t), ['Rozečtené', 'Ztracený pohled'], 'a name with no query is still a tab');
  assert.equal(t[1].summary ?? null, null, 'and has no summary (the not-found state)');
  assert.deepEqual(m.viewTabs({ ...BOOK, views: null, viewsUnreadable: true }, SUMMARIES), [], 'an unreadable `views`: no view tab');
  // AP-1503 (D-1787): defined types except Task and Tag have views; an undefined type has none.
  for (const ty of [BOOK, AUTOR, PAGE]) assert.equal(m.hasViews(ty.key, ty), true, `type/${ty.key} has views`);
  for (const k of ['quick-note', 'daily-note', 'image', 'pdf']) assert.equal(m.hasViews(k, { ...PAGE, key: k, exists: false }), true, `type/${k} has views (built-in definition, D-90)`);
  // Slice Q2-T (AC-Test-Change, D-1912; views.md part three, row part one FR-QRY-07 AC-14): Task has views (D-1787's
  // exception ends, v1-views §28.2).
  assert.equal(m.hasViews('task', TASK), true, 'the Tasks page has views');
  assert.equal(m.hasViews('tag', TAG), false, 'Tag has no views');
  assert.equal(m.hasViews('recept', null), false, 'an undefined type has no views');
  assert.ok(TYPES.length === 5, 'data');
});

test('fr_qry_07_ac4_new_view_creates_a_query_and_a_tab', async () => {
  const m = await model();
  const table = m.newViewDef(AUTOR, 'table', TYPES);
  const pick = (d: any) => ({ title: d.title, types: d.types, match: d.match, filters: d.filters, sort: d.sort, limit: d.limit, view: d.view, groupBy: d.groupBy, laneOrder: d.laneOrder, columns: d.columns });
  assert.deepEqual(pick(table), {
    title: 'New view', types: ['autor'], match: 'all', filters: [], sort: [{ by: 'modified', order: 'desc' }], limit: 50, view: 'table',
    groupBy: null, laneOrder: null, columns: ['poznámka', 'modified'],
  }, 'Table on Autor: R130 effective columns, no grouping');
  // Slice Q3 (AC-Test-Change, D-2196; FR-QRY-07 AC-32): `New view` offers Table, List, Wall; Wall has no group_by,
  // lanes or columns (board B).
  const wall = m.newViewDef(BOOK, 'wall', TYPES);
  assert.deepEqual([wall.types, wall.view, wall.groupBy, wall.groupNone, wall.lanes, wall.laneOrder, wall.columns], [['book'], 'wall', null, false, 'columns', null, []],
    'Wall on Book: no group_by, lanes columns (the default), no columns');
  assert.deepEqual(m.newViewDef(BOOK, 'list', TYPES).columns, ['author', 'rating', 'status', 'modified'], 'List on Book: the effective columns (`columns:` of book.yml)');
  assert.equal(m.defaultGroupBy(BOOK), 'status', 'defaultGroupBy(Book) = the first Select in schema order');
  const noSelect = { ...BOOK, attributes: BOOK.attributes.filter((a: any) => a.type !== 'select') };
  assert.equal(m.defaultGroupBy(noSelect), 'genres', 'no Select: the first multi-select');
  assert.equal(m.defaultGroupBy(AUTOR), 'tags', 'neither: tags');
});

test('fr_qry_07_ac5_show_a_saved_query', async () => {
  const m = await model();
  const tabs = m.viewTabs(BOOK, SUMMARIES);
  const o = m.savedOffers('book', SUMMARIES, tabs);
  assert.deepEqual(o.enabled.map((s: any) => s.name), ['Podle autora', 'Podle žánru', 'Seskupeno podle data'], 'Books: the enabled offers, not tabs already, by title (D-122)');
  assert.deepEqual(o.greyed.map((g: any) => [g.summary.name, g.reason]), [['Autoři', 'otherType'], ['Knihy a autoři', 'severalTypes'], ['Knihy odkazované odsud', 'needsNote']],
    'greyed by title with their reasons (R193)');
  const a = m.savedOffers('autor', SUMMARIES, []);
  assert.deepEqual(a.enabled.map((s: any) => s.name), ['Autoři'], 'Autoři: the enabled item is `Autoři`');
  const reasons = Object.fromEntries(a.greyed.map((g: any) => [g.summary.name, g.reason]));
  assert.equal(reasons['Knihy odkazované odsud'], 'otherType', 'a Book query using `this` on Autoři: the type reason comes first (AP-1515)');
  assert.equal(reasons['Knihy a autoři'], 'severalTypes', 'two types: severalTypes');
  for (const n of ['Rozečtené', 'Přečtené 2026', 'Výborné knihy', 'Podle autora', 'Podle žánru', 'Seskupeno podle data']) assert.equal(reasons[n], 'otherType', `${n} on Autoři: otherType`);
  const extra = [...SUMMARIES, summary('Novější pohled', 'table', ['book'], { state: 'newer' }), summary('Nečitelný pohled', null, null, { state: 'unreadable' }), summary('Všechno', 'list', [])];
  const e = m.savedOffers('book', extra, tabs);
  assert.ok(e.enabled.some((s: any) => s.name === 'Novější pohled'), 'a `version: 2` query of Book is offered (opens read-only)');
  assert.deepEqual(e.greyed.filter((g: any) => ['Nečitelný pohled', 'Všechno'].includes(g.summary.name)).map((g: any) => [g.summary.name, g.reason]),
    [['Nečitelný pohled', 'unreadable'], ['Všechno', 'allTypes']].sort((x, y) => x[0].localeCompare(y[0], 'cs')), 'unreadable: `Can\'t be read`; no types: allTypes');
  assert.ok(!m.savedOffers('book', SUMMARIES, m.viewTabs({ ...BOOK, views: [...BOOK.views, 'Podle žánru'] }, SUMMARIES)).enabled.some((s: any) => s.name === 'Podle žánru'),
    'once a tab, `Podle žánru` is no longer offered');
});

test('fr_qry_07_ac6_reorder_tabs_writes_views_once', async () => {
  const m = await model();
  const v = ['Rozečtené', 'Přečtené 2026', 'Výborné knihy'];
  assert.deepEqual(m.viewsAfterDrop(v, 'Výborné knihy', 'Rozečtené'), ['Výborné knihy', 'Rozečtené', 'Přečtené 2026'], 'drop before Rozečtené');
  assert.equal(m.viewsAfterDrop(v, 'Přečtené 2026', 'Výborné knihy'), null, 'a drop at its own place: unchanged (null)');
  assert.deepEqual(m.viewsAfterDrop(v, 'Přečtené 2026', null), ['Rozečtené', 'Výborné knihy', 'Přečtené 2026'], 'before null: last');
  assert.deepEqual(m.viewsAfterMove(v, 'Rozečtené', 1), ['Přečtené 2026', 'Rozečtené', 'Výborné knihy'], 'Move view right');
  assert.equal(m.viewsAfterMove(v, 'Rozečtené', -1), null, 'Move view left on the first view tab: nothing (never before All)');
  assert.equal(m.viewsAfterMove(v, 'Výborné knihy', 1), null, 'Move view right on the last: nothing');
});

test('fr_qry_07_ac10_remove_keeps_the_query', async () => {
  const m = await model();
  assert.deepEqual(m.viewsAfterRemove(['Rozečtené', 'Přečtené 2026', 'Výborné knihy'], 'Přečtené 2026'), ['Rozečtené', 'Výborné knihy'], 'Remove Přečtené 2026');
  assert.deepEqual(m.viewsAfterRemove(['Rozečtené'], 'Rozečtené'), [], 'the last one: [] (the key stays, AP-1498)');
  assert.deepEqual(m.viewsAfterRemove(['Rozečtené', 'rozečtené', NFD('Rozečtené'), 'Výborné knihy'], 'Rozečtené'), ['Výborné knihy'], 'every copy goes (R184)');
  assert.equal(m.viewsAfterRemove(['Rozečtené'], 'Výborné knihy'), null, 'a name not listed: unchanged');
  assert.deepEqual(m.viewsAfterInsert(['Rozečtené', 'Výborné knihy'], 'Výborné knihy (2)', 'Výborné knihy'), ['Rozečtené', 'Výborné knihy', 'Výborné knihy (2)'], 'Duplicate: right after the original');
  assert.deepEqual(m.viewsAfterInsert(['Rozečtené', 'Výborné knihy'], 'Kopie', 'Rozečtené'), ['Rozečtené', 'Kopie', 'Výborné knihy'], 'insert after a middle tab');
  assert.deepEqual(m.viewsAfterInsert([], 'New view', null), ['New view'], 'insert into an empty list');
  assert.deepEqual(m.viewsAfterInsert(['Rozečtené'], 'New view', null), ['Rozečtené', 'New view'], 'after null: appended');
});

test('fr_qry_06_ac23_views_are_marked_on_the_queries_page', async () => {
  const m = await model();
  const marks: Map<string, string[]> = m.pageMarks(TYPES, SUMMARIES);
  assert.deepEqual([...marks.keys()].sort(), ['přečtené 2026', 'rozečtené', 'výborné knihy'].sort(), 'the three Books views carry a mark, keyed by the lower-cased NFC name key (D-1818)');
  assert.deepEqual(marks.get('rozečtené'), ['Books'], 'Rozečtené: `Books page`');
  const two = m.pageMarks([BOOK, { ...AUTOR, views: ['Rozečtené'] }], SUMMARIES);
  assert.deepEqual((two as Map<string, string[]>).get('rozečtené'), ['Books', 'Autoři'], 'a query that is a tab on two type files shows both marks');
});

test('fr_qry_01_ac13_group_by_choices', async () => {
  const m = await model();
  assert.deepEqual(m.groupByChoices(BOOK), ['author', 'status', 'rating', 'genres', 'tags'], 'Book: Author, Status, Rating, Genres, then Tags; Finished (a date) isn\'t offered');
  assert.deepEqual(m.groupByChoices(AUTOR), ['tags'], 'Autor (only Text): only Tags');
  // Slice Q3 (AC-Test-Change, D-2196; FR-QRY-05 AC-34): the same choices in the Group menu, `None` first, the period
  // entries after (R223).
  let d: Mod | null = null;
  const displayPath = '../ui/src/views/display.ts';
  try { d = (await import(/* @vite-ignore */ displayPath)) as Mod; } catch { d = null; }
  assert.ok(d, 'ui/src/views/display.ts loads (v1-views §40.1)');
  assert.deepEqual(d!.groupChoices(BOOK, ['book']).map((c: any) => c.id), ['none', 'author', 'status', 'rating', 'genres', 'tags', 'period:finished', 'period:created', 'period:modified'], 'the Group menu\'s choices');
});
