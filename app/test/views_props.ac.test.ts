// Slice Q2, L2 (fast-check): properties of the pure sort and board models (docs/contracts/v1-views.md §4.2
// `queries/sort.ts`, `queries/board/model.ts`), twins of docs/acceptance/views.md FR-QRY-01 AC-11 (header clicks, D-1784,
// AP-1500) and FR-QRY-05 AC-19 (lane order, AP-1508). For random level lists over Book's sort keys: `headerClick` without
// ⇧ gives one level; with ⇧ it keeps every other level in place and never repeats a key; `levels` drops repeats keeping
// the first; `sameSort` is reflexive and ignores repeats. For random lane drags: `laneOrderAfterDrop` is a permutation of
// every lane value except `none`, with the dragged lane right before its target. Seeds: a fixed seed plus `QA_SEED`
// (TS-L2), printed; `QA_PROPERTY_SCALE` ≥ 100 runs 10 × 1,000. Written from the ACs and the contract only (D-61).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { GENRE_GROUP, STAV_GROUP } from './views-data';

const FIXED = 20261119;
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1;
const random = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31;
const SEEDS = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED : random + i)) : [FIXED, random];
const RUNS = scale >= 100 ? 1000 : 200;
console.log(`views properties: ${SEEDS.map((s) => `seed = ${s}`).join(', ')}`);
type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
const KEYS = ['title', 'created', 'modified', 'author', 'status', 'rating', 'genres', 'finished'];
const level = fc.record({ by: fc.constantFrom(...KEYS), order: fc.constantFrom('asc' as const, 'desc' as const) });

test('fr_qry_01_ac11_header_click_and_shift_click', async () => {
  const m = await load('../ui/src/queries/sort.ts');
  assert.ok(m, 'ui/src/queries/sort.ts loads');
  for (const seed of SEEDS) {
    fc.assert(fc.property(fc.array(level, { maxLength: 5 }), fc.constantFrom(...KEYS), (raw, key) => {
      const ls = m!.levels(raw) as { by: string; order: string }[];
      assert.equal(new Set(ls.map((l) => l.by)).size, ls.length, 'levels: no repeated key');
      assert.deepEqual(ls.map((l) => l.by), [...new Set(raw.map((l) => l.by))], 'levels: first places kept');
      assert.equal(m!.sameSort(raw, ls), true, 'sameSort ignores repeats');
      const click = m!.headerClick(ls, key, false) as { by: string; order: string }[];
      assert.equal(click.length, 1, 'a click leaves one level');
      assert.equal(click[0].by, key, 'on the clicked column');
      const shift = m!.headerClick(ls, key, true) as { by: string; order: string }[];
      const at = ls.findIndex((l) => l.by === key);
      if (at < 0) assert.deepEqual(shift, [...ls, { by: key, order: 'asc' }], '⇧-click on an unsorted column appends it ascending');
      else assert.deepEqual(shift, ls.map((l, i) => (i === at ? { by: key, order: l.order === 'asc' ? 'desc' : 'asc' } : l)), '⇧-click flips that level in place');
    }), { seed, numRuns: RUNS });
  }
});

test('fr_qry_05_ac19_lane_order_by_drag_and_reset', async () => {
  const m = await load('../ui/src/queries/board/model.ts');
  assert.ok(m, 'ui/src/queries/board/model.ts loads');
  for (const seed of SEEDS) {
    for (const group of [GENRE_GROUP, STAV_GROUP]) {
      const movable = (group.lanes as any[]).filter((l) => l.id !== 'none');
      fc.assert(fc.property(fc.constantFrom(...movable), fc.option(fc.constantFrom(...movable), { nil: null }), (lane, before) => {
        const out = m!.laneOrderAfterDrop(group, lane.id, before ? before.id : null) as string[] | null;
        const now = movable.map((l) => l.value);
        if (out === null) return;
        assert.deepEqual([...out].sort(), [...now].sort(), 'a permutation of every lane value except none');
        if (before && before.id !== lane.id) assert.equal(out.indexOf(lane.value), out.indexOf(before.value) - 1, 'the dragged lane lands right before its target');
        if (!before) assert.equal(out[out.length - 1], lane.value, 'before null: last');
        assert.notDeepEqual(out, now, 'a non-null answer changes the order');
      }), { seed, numRuns: RUNS });
    }
  }
});
