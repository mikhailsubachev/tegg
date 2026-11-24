// Slice Q3 QA review (D-2218, D-2221, contract §41.6), L1 regressions of the pure modules:
// 1. D-2218: unknown-value and unresolved relation groups of a grouped Table or List get no grip (the wall's rule, one
//    predicate `laneMovable`); "after the last movable lane" stays before them (`beforeAfterLastMovable`, D-2217).
// 2. §41.6: a usage whose own `widths` is broken doesn't read the 0.6.0 `usageColumnWidths` entry; only an absent key does.
// 3. D-2221: the quick re-sort (`allSort.ts`) follows the core's `sort_rows`: Select values matched after folding case
//    and diacritics, numbers only from numbers, the last tie-break by the path's UTF-8 bytes.
import { test } from 'vitest';
import assert from 'node:assert/strict';

const lane = (id: string, kind: string, value: string | null, cards: number[], dropTarget: boolean) => ({
  id, kind, value, label: value ?? '', color: null, target: null, excluded: false, dropTarget, cards: cards.map((row) => ({ row, raw: value ? [value] : [] })), days: [], doneWithin: null,
});

test('bug_q3qa_fr_qry_05_unknown_and_unresolved_groups_have_no_grip', async () => {
  const display = await import('../../ui/src/views/display.ts');
  const model = await import('../../ui/src/queries/board/model.ts');
  const group = {
    key: 'status', kind: 'select', multiple: false, name: 'Status', dateTime: false,
    lanes: [
      lane('option:To read', 'option', 'To read', [0], true), lane('option:Reading', 'option', 'Reading', [1], true),
      lane('unknown:Rozečteno', 'unknown', 'Rozečteno', [2], false), lane('unresolved:[[Nikdo]]', 'unresolved', '[[Nikdo]]', [3], false), lane('none', 'none', null, [4], false),
    ],
  };
  const g = display.groupModel({ group } as never, 'table').map((x: { id: string; grip: boolean }) => [x.id, x.grip]);
  assert.deepEqual(g, [['option:To read', true], ['option:Reading', true], ['unknown:Rozečteno', false], ['unresolved:[[Nikdo]]', false], ['none', false]], 'D-2218: grips on the known groups only');
  assert.deepEqual(group.lanes.map((l) => model.laneMovable(l as never)), [true, true, false, false, false], 'one predicate for the wall and the groups');
  assert.equal(model.beforeAfterLastMovable(group as never), 'unknown:Rozečteno', 'after the last movable lane = before the first unknown one');
  // To read dropped "after the last movable group": after Reading, still before Rozečteno.
  assert.deepEqual(display.laneOrderForGroupDrop(group as never, 'option:To read', model.beforeAfterLastMovable(group as never)), ['Reading', 'To read', 'Rozečteno', '[[Nikdo]]'],
    'unknown and unresolved lanes keep their place after the known ones');
});

test('bug_q3qa_fr_qry_05_broken_own_widths_skip_the_0_6_0_entry', async () => {
  const w = await import('../../ui/src/tables/widths.ts');
  const key = 'tab:book/přečtené 2026';
  w.registerWidthsStore({ get: () => ({ usageColumnWidths: { [key]: { title: 300, author: 200 } } }) as never, update: () => {} });
  const write = async () => true;
  assert.deepEqual(w.widthsOf({ kind: 'usage', key, own: null, write }), { title: 300, author: 200 }, 'no `widths` key: the 0.6.0 entry');
  assert.deepEqual(w.widthsOf({ kind: 'usage', key, own: null, ownBroken: true, write } as never), {}, 'a broken `widths` key: not the 0.6.0 entry (R130\'s defaults)');
  assert.deepEqual(w.widthsOf({ kind: 'usage', key, own: [['title', 260]], write }), { title: 260 }, 'own valid widths');
  w.registerWidthsStore(null);
});

test('bug_q3qa_fr_qry_05_quick_resort_follows_the_core', async () => {
  const s = await import('../../ui/src/views/allSort.ts');
  const type = {
    key: 'book', attributes: [
      { key: 'status', name: 'Status', type: 'select', options: [{ label: 'To read' }, { label: 'Reading' }, { label: 'Read' }] },
      { key: 'pages', name: 'Pages', type: 'number' },
    ],
  };
  const row = (title: string, path: string, values: Record<string, unknown>) => ({ path, id: null, title, created: null, modified: null, values, links: [], tags: [] });
  const coll = new Intl.Collator('cs', { sensitivity: 'base', numeric: true });
  const by = (rows: unknown[], levels: unknown[]) => (s.sortTypeRows(rows as never, levels as never, type as never, coll) as { title: string; path: string }[]);
  // Select: `READ`, `to read`, `Réading` match their options after folding (the core's `fold`).
  const sel = by([row('A', 'Books/A.md', { status: 'READ' }), row('B', 'Books/B.md', { status: 'to read' }), row('C', 'Books/C.md', { status: 'Réading' }), row('D', 'Books/D.md', { status: 'Jiný' })],
    [{ by: 'status', order: 'asc' }]);
  assert.deepEqual(sel.map((r) => r.title), ['B', 'C', 'A', 'D'], 'option order after folding, then unknown values');
  // Number: only JSON numbers; a quoted `"5"` is empty (last).
  const num = by([row('A', 'Books/A.md', { pages: '5' }), row('B', 'Books/B.md', { pages: 300 }), row('C', 'Books/C.md', { pages: 12 })], [{ by: 'pages', order: 'asc' }]);
  assert.deepEqual(num.map((r) => r.title), ['C', 'B', 'A'], 'numbers numerically, a string number empty');
  // Path tie-break by UTF-8 bytes: U+FF5E (EF BD 9E) before U+1F600 (F0 9F 98 80), though UTF-16 orders them the other way.
  const tie = by([row('Stejná', 'Books/Stejná \u{1F600}.md', {}), row('Stejná', 'Books/Stejná ～.md', {})], [{ by: 'title', order: 'asc' }]);
  assert.deepEqual(tie.map((r) => r.path), ['Books/Stejná ～.md', 'Books/Stejná \u{1F600}.md'], 'the path by UTF-8 bytes');
});
