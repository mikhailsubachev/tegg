// Slice Q2, L1: the sort model of views, blocks and query pages (docs/contracts/v1-views.md §4.2 `app/ui/src/queries/
// sort.ts`, D-1784): docs/acceptance/views.md FR-QRY-01 AC-11 (header click and ⇧-click, AP-1500; markers and the sort
// button, AP-1501; R188), AC-9 (the popover's steps: add, remove, reorder, clear; the order labels per kind, AP-1502).
// Data: app/test/views-data.ts. Written from the ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { AUTOR, BOOK } from './views-data';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
async function sort(): Promise<Mod> {
  const m = await load('../ui/src/queries/sort.ts');
  assert.ok(m, 'ui/src/queries/sort.ts loads (v1-views §4.2)');
  return m!;
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});
type L = { by: string; order: 'asc' | 'desc' };
const S = (...xs: [string, 'asc' | 'desc'][]): L[] => xs.map(([by, order]) => ({ by, order }));
/** Přečtené 2026's three levels (the fixture). */
const P26 = S(['finished', 'desc'], ['rating', 'asc'], ['title', 'asc']);
const NAMES: Record<string, string> = { title: 'Title', created: 'Created', modified: 'Modified', author: 'Author', status: 'Status', rating: 'Rating', genres: 'Genres', finished: 'Finished' };

test('fr_qry_01_ac11_header_click_and_shift_click', async () => {
  const m = await sort();
  // (a) a click on a level of several: the only level, keeping its order.
  const a = m.headerClick(P26, 'rating', false);
  assert.deepEqual(a, S(['rating', 'asc']), '(a) click on Rating (level 2): `sort: { by: rating, order: asc }`');
  // (b) a click on the only level flips it.
  const b = m.headerClick(a, 'rating', false);
  assert.deepEqual(b, S(['rating', 'desc']), '(b) a second click flips it');
  // (c) ⇧-click on an unsorted column appends it ascending; on a level it flips in place.
  const c = m.headerClick(b, 'finished', true);
  assert.deepEqual(c, S(['rating', 'desc'], ['finished', 'asc']), '(c) ⇧-click on Finished: level 2, ascending');
  assert.deepEqual(m.headerClick(c, 'finished', true), S(['rating', 'desc'], ['finished', 'desc']), '⇧-click on it again flips it in place');
  assert.deepEqual(m.headerClick(c, 'rating', true), S(['rating', 'asc'], ['finished', 'asc']), '⇧-click on level 1 flips it, its place stays');
  // (d) a click on an unsorted column: the only level, ascending.
  assert.deepEqual(m.headerClick(c, 'author', false), S(['author', 'asc']), '(d) click on Author: the only level, ascending');
  // Markers (AP-1500, AP-1501): ↑ / ↓ on every sorted column, numbers only with ≥ 2 levels.
  const mk: Map<string, { arrow: string; n: number | null }> = m.markers(P26);
  assert.deepEqual([...mk.entries()], [['finished', { arrow: '↓', n: 1 }], ['rating', { arrow: '↑', n: 2 }], ['title', { arrow: '↑', n: 3 }]], 'Finished ↓¹, Rating ↑², Title ↑³');
  assert.deepEqual([...m.markers(S(['title', 'asc'])).entries()], [['title', { arrow: '↑', n: null }]], 'one level: `Title ↑`, no number');
  // The sort button reads the first level and `+<n>`.
  assert.deepEqual(m.buttonText(P26, (k: string) => NAMES[k]), { text: 'Finished ↓', more: 2 }, 'Přečtené 2026: `Finished ↓` `+2`');
  assert.deepEqual(m.buttonText(S(['title', 'asc']), (k: string) => NAMES[k]), { text: 'Title ↑', more: 0 }, 'Výborné knihy: `Title ↑`');
  // Repeats count at their first level; sameSort compares the levels.
  assert.deepEqual(m.levels(S(['finished', 'desc'], ['rating', 'asc'], ['finished', 'asc'])), S(['finished', 'desc'], ['rating', 'asc']), 'a key used twice counts at its first level (R185)');
  assert.equal(m.sameSort(P26, S(['finished', 'desc'], ['rating', 'asc'], ['title', 'asc'])), true, 'sameSort: equal levels');
  assert.equal(m.sameSort(P26, S(['finished', 'desc'], ['rating', 'desc'], ['title', 'asc'])), false, 'sameSort: an order differs');
  assert.equal(m.sameSort(S(['title', 'asc']), S(['title', 'asc'], ['title', 'desc'])), true, 'sameSort ignores repeats');
});

test('fr_qry_01_ac9_sort_popover_writes_each_change_once', async () => {
  const m = await sort();
  const choices = m.sortChoices(BOOK);
  assert.deepEqual(choices, ['title', 'created', 'modified', 'author', 'status', 'rating', 'genres', 'finished'], 'Title, Created, Modified, then the attributes in schema order');
  assert.deepEqual(m.sortChoices(AUTOR), ['title', 'created', 'modified', 'poznámka'], 'Autor (string[] keys, D-1818)');
  // (a) Rating to `Bad first` is the level's order desc; (b) dragging the Title row first.
  const a = S(['finished', 'desc'], ['rating', 'desc'], ['title', 'asc']);
  assert.deepEqual(m.moveLevel(a, 2, 0), S(['title', 'asc'], ['finished', 'desc'], ['rating', 'desc']), '(b) Title row first');
  // (c) Remove on two levels leaves one.
  const b = m.moveLevel(a, 2, 0);
  assert.deepEqual(m.removeLevel(m.removeLevel(b, 2), 1), S(['title', 'asc']), '(c) remove two levels: Title ↑');
  assert.deepEqual(m.removeLevel(S(['title', 'asc']), 0), S(['modified', 'desc']), 'removing the last level: the R138 default Modified ↓ (AP-1502)');
  // (d) + Add sort: the first unused column of the list, ascending.
  assert.deepEqual(m.addLevel(S(['title', 'asc']), choices), S(['title', 'asc'], ['created', 'asc']), '(d) + Add sort adds Created ↑');
  assert.deepEqual(m.addLevel(S(['title', 'asc'], ['created', 'asc'], ['modified', 'desc']), choices), S(['title', 'asc'], ['created', 'asc'], ['modified', 'desc'], ['author', 'asc']), 'then Author');
  // (e) Clear.
  assert.deepEqual(m.clearSort(), S(['modified', 'desc']), '(e) Clear: Modified ↓, one level');
});

test('fr_qry_01_ac9_sort_popover_order_labels', async () => {
  const m = await sort();
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat, 'the catalog loads');
  const text = (x: any) => (typeof x === 'string' && x.includes('.') && !x.includes(' ') ? cat!.t(x) : x);
  const lab = (key: string) => { const l = m.orderLabels(key, BOOK); return [text(l.asc), text(l.desc)]; };
  assert.deepEqual(lab('finished'), ['Oldest first', 'Newest first'], 'a date: Oldest first / Newest first');
  assert.deepEqual(lab('created'), ['Oldest first', 'Newest first'], 'created (a date-time)');
  assert.deepEqual(lab('rating'), ['Excellent first', 'Bad first'], 'a select: <first option> first / <last option> first');
  assert.deepEqual(lab('status'), ['To read first', 'Read first'], 'status (a select)');
  assert.deepEqual(lab('title'), ['A → Z', 'Z → A'], 'title: A → Z / Z → A');
  assert.deepEqual(lab('genres'), ['A → Z', 'Z → A'], 'a multi-select: A → Z');
  assert.deepEqual(lab('author'), ['A → Z', 'Z → A'], 'a relation: A → Z');
});
