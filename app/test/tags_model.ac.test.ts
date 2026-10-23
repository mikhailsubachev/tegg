// MS4 slice 4D-lite, L1: the tag model of the UI (docs/contracts/ms4-tags.md §6.2 `tags/model.ts`) on R80's rows and
// the rows of `tag/účty` (docs/acceptance/tags.md R81…R83): FR-TAG-07 AC-1 (All tags sorts: Most used, Name, Last used,
// each both directions, empty Last used last; the summary's distinct objects, AP-660), AC-2 (find: folded, leading `#`
// ignored), AC-4 (the sidebar's five), FR-TAG-06 AC-3 (the tag page comparators: Title, Type, Other tags per AP-661,
// Modified with missing values last), AC-5 (Type filter, grouping by type in D-122 order), AC-2 (summary unfiltered,
// AP-661 (c)). **(C)**: run with region `cs` and `en` (D-122 collation through `i18n/collate.ts`). The shapes of the
// results beyond the contract's names (row arrays, `{ groups: { type, rows }[] }`, type options with a count) are
// red-test point AP-673. Written from the ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function mods(locale: string) {
  const model = await load('../ui/src/tags/model.ts');
  const col = await load('../ui/src/i18n/collate.ts');
  assert.ok(model, 'ui/src/tags/model.ts loads (ms4-tags §6.2)');
  for (const k of ['allTagsRows', 'sidebarTags', 'tagPageRows', 'summary', 'typeOptions']) assert.equal(typeof model![k], 'function', `tags/model.ts exports ${k}`);
  assert.ok(col, 'i18n/collate.ts');
  col!.setCollationLocale(locale);
  return { m: model!, collator: col!.collator() as Intl.Collator };
}
afterEach(async () => {
  const col = await load('../ui/src/i18n/collate.ts');
  col?.setCollationLocale?.('cs');
});

const at = (s: string) => `${s}:00+02:00`;
const ns = (s: string | null) => (s === null ? null : String(BigInt(Date.parse(s)) * 1_000_000n));
const row = (key: string, name: string, file: string | null, color: string | null, count: number, last: string | null) =>
  ({ key, name, file: file ? { path: file, version: { mtimeNs: '0', size: 0, hash: '' } } : null, losers: [], color, colorRaw: color, count, lastUsed: last ? at(last) : null, lastUsedNs: ns(last ? at(last) : null) });
/** R80 (TagRowDto[] as `index_tags` returns it, key order). */
const R80 = [
  row('a/b', 'a/b', 'Tags/a b.md', null, 1, '2026-10-18T09:00'),
  row('cizí', 'cizí', 'Pages/Cizí štítek.md', null, 0, null),
  row('dvojí', 'dvojí', 'Tags/dvojí.md', 'red', 1, '2026-10-19T12:00'),
  row('finance', 'finance', null, null, 2, '2026-10-21T09:00'),
  row('neznámá', 'neznámá', 'Tags/neznámá.md', null, 1, '2026-09-10T09:00'),
  row('prázdný', 'prázdný', 'Tags/prázdný.md', 'teal', 0, null),
  row('účty', 'Účty', 'Tags/Účty.md', 'blue', 6, '2026-10-22T08:00'),
  row('účty-2026', 'účty-2026', null, null, 1, '2026-10-01T09:00'),
  row('účty/archiv', 'účty/archiv', null, null, 1, '2026-10-15T12:00'),
  row('čtení', 'čtení', null, null, 2, '2026-09-10T09:00'),
];
const obj = (path: string, title: string, type: string, tags: string[], modified: string | null, extra: Record<string, string | null> = {}) =>
  ({ path, id: null, title, type, modified: modified ? at(modified) : null, modifiedNs: ns(modified ? at(modified) : null), tags, review: null, status: null, due: null, completed: null, ...extra });
/** `tag_objects('účty')` (path order). */
const UCTY = [
  obj('Daily/2026-10-20.md', '2026-10-20', 'daily-note', [], '2026-10-20T21:00'),
  obj('Pages/Dvakrát.md', 'Dvakrát', 'page', ['účty/archiv'], '2026-10-15T12:00'),
  obj('Pages/Rozpočet.md', 'Rozpočet', 'page', ['finance'], '2026-10-21T09:00'),
  obj('Quick Notes/Faktura.md', 'Faktura', 'quick-note', [], '2026-10-22T08:00', { review: 'unreviewed' }),
  obj('Tasks/Zaplatit nájem.md', 'Zaplatit nájem', 'task', [], '2026-10-20T18:00', { status: 'Done', completed: '2026-10-20T18:00:00+02:00' }),
  obj('Tasks/Zavolat bance.md', 'Zavolat bance', 'task', [], '2026-10-12T08:00', { status: 'To do', due: '2026-10-21' }),
];
const TYPE_NAMES: Record<string, string> = { page: 'Page', task: 'Task', 'quick-note': 'Quick Note', 'daily-note': 'Daily Note', tag: 'Tag', projekt: 'Projekt' };
const names = (rows: any[]) => rows.map((r) => r.name);
const titles = (rows: any[]) => rows.map((r) => r.title);
const ui = (column: string, dir: 'asc' | 'desc', type: string | null = null, grouping: 'none' | 'type' = 'none') => ({ sort: { column, dir }, type, grouping });
const flatRows = (r: any) => (r.groups as any[]).flatMap((g) => g.rows);

for (const locale of ['cs', 'en']) {
  test(`fr_tag_07_ac1_all_tags_sorts (${locale})`, async () => {
    const { m, collator } = await mods(locale);
    const byName = [...R80].sort((a, b) => collator.compare(a.name, b.name));
    const ones = byName.filter((r) => r.count === 1).map((r) => r.name);
    assert.deepEqual(names(m.allTagsRows(R80, { column: 'count', dir: 'desc' }, '', collator)), ['Účty', 'čtení', 'finance', ...ones, 'cizí', 'prázdný'], 'Most used ↓, ties by D-122 name');
    assert.deepEqual(names(m.allTagsRows(R80, { column: 'name', dir: 'asc' }, '', collator)), byName.map((r) => r.name), 'Name ↑ (D-122)');
    assert.deepEqual(names(m.allTagsRows(R80, { column: 'name', dir: 'desc' }, '', collator)), byName.map((r) => r.name).reverse(), 'Name ↓');
    const used = R80.filter((r) => r.lastUsedNs !== null).sort((a, b) => (BigInt(a.lastUsedNs!) < BigInt(b.lastUsedNs!) ? -1 : 1) || 0);
    const last = (dir: 'asc' | 'desc') => names(m.allTagsRows(R80, { column: 'lastUsed', dir }, '', collator));
    assert.deepEqual(last('asc').slice(0, 8).map((n) => used.findIndex((r) => r.name === n) >= 0), Array(8).fill(true), 'Last used ↑: the dated tags first');
    assert.deepEqual(last('asc').slice(8).sort(), ['cizí', 'prázdný'], 'Last used ↑: empty last');
    assert.deepEqual(last('desc').slice(0, 2), ['Účty', 'finance'], 'Last used ↓: newest first');
    assert.deepEqual(last('desc').slice(8).sort(), ['cizí', 'prázdný'], 'Last used ↓: empty last too');
  });

  test(`fr_tag_07_ac1_summary_counts_distinct_objects (${locale})`, async () => {
    const { m } = await mods(locale);
    const objects = [...UCTY.map((o) => o.path), 'Projekty/Web.md', 'Pages/Lomítko.md', 'Pages/Kód.md', 'Pages/Kniha.md', 'Pages/schůzka (2).md'];
    const s = m.summary(objects.map((p) => obj(p, p, 'page', [], null)));
    assert.equal(s.objects, 11, '11 tagged objects (distinct, AP-660)');
  });

  test(`fr_tag_07_ac2_find_a_tag_is_folded (${locale})`, async () => {
    const { m, collator } = await mods(locale);
    const find = (q: string) => names(m.allTagsRows(R80, { column: 'name', dir: 'asc' }, q, collator)).sort();
    assert.deepEqual(find('ucty'), ['účty-2026', 'účty/archiv', 'Účty'].sort(), 'ucty keeps Účty, účty/archiv, účty-2026');
    assert.deepEqual(find('#fin'), ['finance'], 'a leading # is ignored');
    assert.deepEqual(find('UČTY'.normalize('NFD')), find('ucty'), 'case, diacritics and NFD folded');
    assert.deepEqual(find('xyz'), [], 'no match');
  });

  test(`fr_tag_07_ac4_sidebar_five_by_last_used (${locale})`, async () => {
    const { m, collator } = await mods(locale);
    assert.deepEqual(m.sidebarTags(R80, collator).map((r: any) => [r.name, r.count]), [['Účty', 6], ['finance', 2], ['dvojí', 1], ['a/b', 1], ['účty/archiv', 1]], 'R83: count ≥ 1, newest Last used first, 5');
    const tie = [...R80, row('nový', 'nový', null, null, 1, '2026-10-22T08:00')];
    assert.deepEqual(m.sidebarTags(tie, collator).slice(0, 2).map((r: any) => r.name), [...['Účty', 'nový']].sort(collator.compare), 'ties by D-122 name (AP-660)');
  });

  test(`fr_tag_06_ac3_tag_page_comparators (${locale})`, async () => {
    const { m, collator } = await mods(locale);
    const sorted = (column: string, dir: 'asc' | 'desc') => titles(flatRows(m.tagPageRows(UCTY, ui(column, dir), '', TYPE_NAMES, collator)));
    const az = ['2026-10-20', 'Dvakrát', 'Faktura', 'Rozpočet', 'Zaplatit nájem', 'Zavolat bance'];
    assert.deepEqual(sorted('title', 'asc'), az, 'Title ↑: digits before letters (D-122)');
    assert.deepEqual(sorted('title', 'desc'), [...az].reverse(), 'Title ↓');
    assert.deepEqual(sorted('modified', 'desc'), ['Faktura', 'Rozpočet', '2026-10-20', 'Zaplatit nájem', 'Dvakrát', 'Zavolat bance'], 'Modified ↓ (the default)');
    assert.deepEqual(sorted('modified', 'asc'), ['Zavolat bance', 'Dvakrát', 'Zaplatit nájem', '2026-10-20', 'Rozpočet', 'Faktura'], 'Modified ↑');
    const t = sorted('type', 'asc');
    const typeOrder = ['Daily Note', 'Page', 'Quick Note', 'Task'].sort(collator.compare);
    const typeOf = (title: string) => TYPE_NAMES[UCTY.find((o) => o.title === title)!.type];
    assert.deepEqual([...new Set(t.map(typeOf))], typeOrder, 'Type ↑ by type name (D-122)');
    const other = sorted('otherTags', 'asc');
    assert.deepEqual(other.slice(0, 2), ['Rozpočet', 'Dvakrát'].sort((a, b) => collator.compare(UCTY.find((o) => o.title === a)!.tags[0], UCTY.find((o) => o.title === b)!.tags[0])), 'Other tags ↑ by the first other tag (finance, účty/archiv)');
    assert.equal(other.length, 6, 'rows without other tags last (AP-661)');
    const missing = [...UCTY, obj('Pages/Bez data.md', 'Bez data', 'page', [], null)];
    for (const dir of ['asc', 'desc'] as const) {
      const r = titles(flatRows(m.tagPageRows(missing, ui('modified', dir), '', TYPE_NAMES, collator)));
      assert.equal(r[r.length - 1], 'Bez data', `Modified ${dir}: an object without modified is last`);
    }
  });

  test(`fr_tag_06_ac5_type_filter_and_grouping (${locale})`, async () => {
    const { m, collator } = await mods(locale);
    const opts = (m.typeOptions(UCTY, TYPE_NAMES, collator) as any[]).map((o) => [o.name ?? TYPE_NAMES[o.type], o.count]);
    assert.deepEqual(opts, [['Daily Note', 1], ['Page', 2], ['Quick Note', 1], ['Task', 2]].sort((a, b) => collator.compare(String(a[0]), String(b[0]))), 'the types among the tag\'s objects with counts, D-122');
    const task = m.tagPageRows(UCTY, ui('modified', 'desc', 'task'), '', TYPE_NAMES, collator);
    assert.deepEqual(titles(flatRows(task)), ['Zaplatit nájem', 'Zavolat bance'], 'Type: Task');
    const grouped = m.tagPageRows(UCTY, ui('title', 'asc', null, 'type'), '', TYPE_NAMES, collator);
    assert.deepEqual((grouped.groups as any[]).map((g) => [TYPE_NAMES[g.type] ?? g.type, g.rows.length]), [['Daily Note', 1], ['Page', 2], ['Quick Note', 1], ['Task', 2]].sort((a, b) => collator.compare(String(a[0]), String(b[0]))), 'groups in D-122 order of type names');
    const pages = (grouped.groups as any[]).find((g) => g.type === 'page');
    assert.deepEqual(titles(pages.rows), ['Dvakrát', 'Rozpočet'], 'each group sorted by the current sort');
    const one = m.tagPageRows(UCTY, ui('title', 'asc', 'task', 'type'), '', TYPE_NAMES, collator);
    assert.deepEqual((one.groups as any[]).map((g) => [g.type, g.rows.length]), [['task', 2]], 'Type: Task with grouping: one group Task 2');
    const none = m.tagPageRows(UCTY, ui('title', 'asc'), '', TYPE_NAMES, collator);
    assert.deepEqual((none.groups as any[]).map((g) => g.type), [null], 'No grouping: one group without a type');
  });

  test(`fr_tag_06_ac2_summary_is_unfiltered (${locale})`, async () => {
    const { m } = await mods(locale);
    assert.deepEqual(m.summary(UCTY), { objects: 6, types: 4 }, '6 objects of 4 types (AP-661 (c))');
    assert.deepEqual(m.summary([]), { objects: 0, types: 0 }, 'a new tag: 0 objects of 0 types');
  });
}

test('fr_tag_06_ac4_text_filter_is_folded_like_the_switcher', async () => {
  const { m, collator } = await mods('cs');
  const f = (q: string) => titles(flatRows(m.tagPageRows(UCTY, ui('title', 'asc'), q, TYPE_NAMES, collator)));
  assert.deepEqual(f('zavolat'), ['Zavolat bance'], 'zavolat');
  assert.deepEqual(f('ZAVOLAT'), ['Zavolat bance'], 'ZAVOLAT');
  assert.deepEqual(f('zavolat'.normalize('NFD')), ['Zavolat bance'], 'NFD');
  assert.deepEqual(f('najem'), ['Zaplatit nájem'], 'najem keeps Zaplatit nájem');
  assert.deepEqual(f('xyz'), [], 'xyz: no rows');
});
