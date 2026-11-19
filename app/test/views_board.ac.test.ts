// Slice Q2, L1: the pure board model (docs/contracts/v1-views.md §4.2 `app/ui/src/queries/board/model.ts`, §4.5):
// docs/acceptance/views.md FR-QRY-05 AC-10 (the lane model: `excludedValues`, CP-9 / D-1811), AC-19 (`laneOrderAfterDrop`:
// every lane's value except `none`, AP-1508), AC-14 (the change model `cardMove`: Select / single relation set, list kinds
// remove `raw` and add unless present, Alt adds only, D-1769; no drop on a non-target), AC-15 (unknown and `none` lanes
// aren't targets), AC-22 (`neighbourDropLane`: skips non-targets, the excluded lane is a target, AP-1505, AP-1510),
// FR-QRY-08 AC-2 (`prefillFor`: the lane's value plus the view's Select `is` filters, D-1439). Data: app/test/views-data.ts
// (GroupingDto shapes of §2). Written from the ACs and the contract only (D-61). The module loads inside the tests (TS-I1).
//
// `neighbourDropLane(group, laneId, dir)`: `dir` is +1 (next) or −1 (previous) here (the contract names no type; RT point).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { AUTHOR_GROUP, BOOK, GENRE_GROUP, ROZ_GROUP, STAV_GROUP, TAG_GROUP, def } from './views-data';

type Mod = Record<string, any>;
async function board(): Promise<Mod> {
  const path = '../ui/src/queries/board/model.ts';
  let m: Mod | null = null;
  try { m = (await import(/* @vite-ignore */ path)) as Mod; } catch { m = null; }
  assert.ok(m, 'ui/src/queries/board/model.ts loads (v1-views §4.2)');
  return m!;
}
const values = (p: any): Record<string, unknown> => Object.fromEntries((Array.isArray(p) ? p : p?.values ?? []) as [string, unknown][]);

test('fr_qry_05_ac10_board_by_select', async () => {
  const m = await board();
  assert.deepEqual(m.excludedValues(ROZ_GROUP), ['Reading', 'To read'], 'the labels of the non-excluded option lanes, in lane order (board.excludedLong, D-1811)');
  assert.deepEqual(m.excludedValues(STAV_GROUP), ['To read', 'Reading', 'Read'], 'no excluded lane: every option lane (unknown and none left out)');
});

test('fr_qry_05_ac19_lane_order_by_drag_and_reset', async () => {
  const m = await board();
  assert.deepEqual(m.laneOrderAfterDrop(ROZ_GROUP, 'option:To read', 'option:Reading'), ['To read', 'Reading', 'Read'], '`To read` before `Reading`');
  assert.equal(m.laneOrderAfterDrop(ROZ_GROUP, 'option:Reading', 'option:To read'), null, 'a drop at its own place: unchanged');
  assert.deepEqual(m.laneOrderAfterDrop(GENRE_GROUP, 'option:Cestopis', 'option:Román'), ['Cestopis', 'Román', 'Detektivka', 'Poezie', 'Eseje'], 'Podle žánru: every value except `none`');
  assert.deepEqual(m.laneOrderAfterDrop(AUTHOR_GROUP, 'relation:Autoři/Marek Sova.md', 'relation:Autoři/Eva Lindová.md'),
    ['[[Marek Sova]]', '[[Eva Lindová]]', '[[Lucie Horká]]', '[[Nikdo]]'], 'relation lanes are listed by their link text (AP-1508)');
  assert.deepEqual(m.laneOrderAfterDrop(STAV_GROUP, 'option:To read', null), ['Reading', 'Read', 'Rozečteno', 'To read'], 'before null: last, still before `none`');
  assert.equal(m.laneOrderAfterDrop(STAV_GROUP, 'none', 'option:To read'), null, '`none` can\'t move');
});

test('fr_qry_05_ac14_multi_value_and_relation_drags', async () => {
  const m = await board();
  // Select (Rozečtené): set.
  assert.deepEqual(m.cardMove(ROZ_GROUP, 4, 'option:To read', 'option:Reading', false), { key: 'status', shape: 'scalar', remove: ['To read'], add: 'Reading' }, 'Kniha o horách To read → Reading');
  assert.deepEqual(m.cardMove(ROZ_GROUP, 0, 'option:Reading', 'option:Read', false), { key: 'status', shape: 'scalar', remove: ['Reading'], add: 'Read' }, 'onto the excluded Read: a target (AP-1510)');
  assert.equal(m.cardMove(ROZ_GROUP, 4, 'option:To read', 'option:To read', false), null, 'onto its own lane: nothing');
  // Multi-select (Podle žánru).
  assert.deepEqual(m.cardMove(GENRE_GROUP, 0, 'option:Eseje', 'option:Poezie', false), { key: 'genres', shape: 'list', remove: ['Eseje'], add: 'Poezie' }, '(a) Sto zimních dní Eseje → Poezie');
  assert.deepEqual(m.cardMove(GENRE_GROUP, 0, 'option:Román', 'option:Eseje', false), { key: 'genres', shape: 'list', remove: ['Román'], add: null }, '(b) Román → Eseje (already there): only the removal');
  assert.deepEqual(m.cardMove(GENRE_GROUP, 1, 'option:Cestopis', 'option:Eseje', false), { key: 'genres', shape: 'list', remove: ['Cestopis'], add: 'Eseje' }, '(c) Čarovná mapa Cestopis → Eseje');
  assert.deepEqual(m.cardMove(GENRE_GROUP, 2, 'option:Román', 'option:Poezie', true), { key: 'genres', shape: 'list', remove: [], add: 'Poezie' }, '(d) Alt: add only');
  assert.equal(m.cardMove(GENRE_GROUP, 0, 'option:Román', 'option:Eseje', true), null, '(d) Alt onto a lane it already has: nothing');
  assert.deepEqual(m.cardMove(GENRE_GROUP, 3, 'none', 'option:Poezie', false), { key: 'genres', shape: 'list', remove: [], add: 'Poezie' }, '(e) from `No Genres`: adds the value');
  assert.equal(m.cardMove(GENRE_GROUP, 2, 'option:Román', 'none', false), null, 'onto `No Genres`: not a drop target');
  // Relation (Podle autora): the D-184 link text.
  assert.deepEqual(m.cardMove(AUTHOR_GROUP, 0, 'relation:Autoři/Lucie Horká.md', 'relation:Autoři/Marek Sova.md', false),
    { key: 'author', shape: 'scalar', remove: ['[[Lucie Horká]]'], add: '[[Marek Sova]]' }, 'Dům u řeky Lucie Horká → Marek Sova');
  assert.equal(m.cardMove(AUTHOR_GROUP, 0, 'relation:Autoři/Lucie Horká.md', 'unresolved:[[Nikdo]]', false), null, 'onto an unresolved link lane: not a target (D-1805)');
  // Tags (Podle štítku): the inline-only card has an empty raw.
  assert.deepEqual(m.cardMove(TAG_GROUP, 3, 'tag:večerní', 'tag:doporučené', false), { key: 'tags', shape: 'list', remove: [], add: 'doporučené' }, 'Světla přístavu večerní (inline) → doporučené');
});

test('fr_qry_05_ac15_no_value_unknown_and_excluded_lanes', async () => {
  const m = await board();
  assert.equal(m.cardMove(STAV_GROUP, 6, 'option:Read', 'unknown:Rozečteno', false), null, 'onto the unknown-value lane `Rozečteno`: no write');
  assert.equal(m.cardMove(STAV_GROUP, 6, 'option:Read', 'none', false), null, 'onto `No Status`: no write');
  assert.deepEqual(m.cardMove(STAV_GROUP, 7, 'unknown:Rozečteno', 'option:Reading', false), { key: 'status', shape: 'scalar', remove: ['Rozečteno'], add: 'Reading' }, 'from the unknown lane onto an option: sets it');
});

test('fr_qry_05_ac22_board_by_keyboard', async () => {
  const m = await board();
  const id = (l: any) => (l === null || l === undefined ? null : typeof l === 'string' ? l : l.id);
  assert.equal(id(m.neighbourDropLane(ROZ_GROUP, 'option:Reading', 1)), 'option:To read', 'next of Reading: To read');
  assert.equal(id(m.neighbourDropLane(ROZ_GROUP, 'option:To read', 1)), 'option:Read', 'next of To read: the excluded Read (a target, AP-1510)');
  assert.equal(id(m.neighbourDropLane(ROZ_GROUP, 'option:Read', 1)), null, 'the last lane: nothing');
  assert.equal(id(m.neighbourDropLane(ROZ_GROUP, 'option:Reading', -1)), null, 'the first lane, previous: nothing');
  assert.equal(id(m.neighbourDropLane(STAV_GROUP, 'option:Read', 1)), null, 'after Read only Rozečteno and No Status: skipped, nothing');
  assert.equal(id(m.neighbourDropLane(STAV_GROUP, 'unknown:Rozečteno', -1)), 'option:Read', 'from Rozečteno back: Read');
  assert.equal(id(m.neighbourDropLane(AUTHOR_GROUP, 'relation:Autoři/Marek Sova.md', 1)), null, 'unresolved and none lanes are skipped');
});

test('fr_qry_08_ac2_new_object_from_a_lane', async () => {
  const m = await board();
  const roz = def({ filters: [{ kind: 'filter', key: 'status', op: 'is_any_of', value: ['Reading', 'To read'], src: [0] }, { kind: 'filter', key: 'tags', op: 'has_none_of', value: ['odloženo'], src: [1] }] });
  assert.deepEqual(values(m.prefillFor(roz, ROZ_GROUP, 'option:Reading', BOOK)), { status: 'Reading' }, 'Rozečtené, `New Book in Reading`: status Reading');
  const zanr = def({ groupBy: 'genres', lanes: 'horizontal', sort: [{ by: 'title', order: 'asc' }] });
  assert.deepEqual(values(m.prefillFor(zanr, GENRE_GROUP, 'option:Poezie', BOOK)), { genres: ['Poezie'] }, 'Podle žánru, the Poezie tile: genres [Poezie]');
  const autor = def({ groupBy: 'author', columns: ['rating', 'genres'] });
  assert.deepEqual(values(m.prefillFor(autor, AUTHOR_GROUP, 'relation:Autoři/Marek Sova.md', BOOK)), { author: '[[Marek Sova]]' }, 'Podle autora, `New Book in Marek Sova`');
  const vyb = def({ filters: [{ kind: 'filter', key: 'rating', op: 'is', value: 'Excellent', src: [0] }] });
  assert.deepEqual(values(m.prefillFor(vyb, STAV_GROUP, 'option:To read', BOOK)), { status: 'To read', rating: 'Excellent' }, 'a board copy of Výborné knihy: the lane plus `rating: Excellent`');
  const over = def({ filters: [{ kind: 'filter', key: 'status', op: 'is', value: 'Read', src: [0] }] });
  assert.deepEqual(values(m.prefillFor(over, STAV_GROUP, 'option:Reading', BOOK)), { status: 'Reading' }, 'the lane overrides an `is` on the grouping key');
  assert.deepEqual(values(m.prefillFor(def({ groupBy: 'tags' }), TAG_GROUP, 'tag:doporučené', BOOK)), { tags: ['doporučené'] }, 'a tag lane: tags [key]');
});
