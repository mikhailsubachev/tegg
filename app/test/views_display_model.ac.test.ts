// Slice Q3, L1: the pure display and grouping models (docs/contracts/v1-views.md §40.1 `app/ui/src/views/display.ts`,
// `app/ui/src/queries/board/grid.ts`; §40.2 `views/model.ts` `newViewDef`, `views/usage.ts` `canUseQuery`): effective
// values (`usage` first, else `def`), own keys, the Group menu's choices and names, the group model of a grouped Table or
// List (only groups with rows, flat periods, grips), the lane order of a header drop, `Reset lane order` on a usage,
// notices per display, `limit` per display, write routing, Type settings texts, widths to write (0.6.0 widths), `All
// <plural>` state and def, the wall grid (sizes, windowing, keyboard). Criteria: FR-QRY-05 AC-32 (routing), AC-34
// (choices), AC-35 (effective values), AC-36 (notices), AC-37 (grid), AC-39 (group model), AC-42 (drops, reset), AC-43,
// AC-44 (widths), FR-QRY-07 AC-32 (`newViewDef`), FR-QRY-01 AC-21 (`limit`, the done-lane offer), FR-TYP-09 AC-37,
// FR-TYP-01 AC-29, FR-FMT-12 AC-16. Data: app/test/views-data.ts (Book, Autor). Written from the ACs and the contract
// only (D-61). Modules load inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { AUTOR, BOOK, TYPES } from './views-data';

type Mod = Record<string, any>;
async function load(path: string, what: string): Promise<Mod> {
  let m: Mod | null = null;
  try { m = (await import(/* @vite-ignore */ path)) as Mod; } catch { m = null; }
  assert.ok(m, `${what} loads (v1-views §40)`);
  return m!;
}
/** Asserts that the module exports every named function (a missing one is an assertion failure, TS-I1). */
function has(m: Mod, names: string[], what: string): Mod {
  for (const n of names) assert.equal(typeof m[n], 'function', `${what} exports ${n} (v1-views §40)`);
  return m;
}
const display = async (names: string[]) => has(await load('../ui/src/views/display.ts', 'ui/src/views/display.ts'), names, 'views/display.ts');
const grid = async (names: string[]) => has(await load('../ui/src/queries/board/grid.ts', 'ui/src/queries/board/grid.ts'), names, 'queries/board/grid.ts');
const NFD = (s: string) => s.normalize('NFD');
const LUCIE = 'relation:Autoři/Lucie Horká.md';
const EVA = 'relation:Autoři/Eva Lindová.md';

// ------------------------------------------------------------------------------------------------ DTO builders

const lane = (id: string, kind: string, label: string, cards: number[], o: { excluded?: boolean; color?: string | null; target?: string | null } = {}) => ({
  id, kind, value: kind === 'none' ? null : kind === 'relation' ? `[[${label}]]` : label, label, color: o.color ?? null, target: o.target ?? null, excluded: o.excluded ?? false,
  dropTarget: kind === 'option' || kind === 'relation' || kind === 'tag', cards: cards.map((row) => ({ row, raw: [label] })), days: [], doneWithin: null,
});
const row = (title: string) => ({ path: `Books/${title}.md`, id: null, title, type: 'book', values: {}, links: [] });
const qdef = (o: Record<string, unknown> = {}) => ({
  title: 'Dotaz', types: ['book'], match: 'all', filters: [], sort: [{ by: 'title', order: 'asc' }], limit: 50, view: 'table', groupBy: null, groupPeriod: false,
  groupNone: false, lanes: 'columns', laneOrder: null, columns: ['author', 'status', 'finished'], doneLane: null, ...o,
});
type Own = { sort?: unknown; columns?: unknown; view?: unknown; group?: unknown; lanes?: unknown; laneOrder?: unknown; widths?: unknown };
const usage = (kind: 'tab' | 'block', own: Own, eff: Record<string, unknown>, broken: string[] = []) => ({
  kind, own: { sort: null, columns: null, view: null, group: null, lanes: null, laneOrder: null, widths: null, ...own },
  broken: broken.map((key) => ({ reason: 'badValue', at: null, key, type: null })),
  sort: [{ by: 'title', order: 'asc' }], columns: ['author', 'status', 'finished'], view: 'table', groupBy: null, groupPeriod: false, lanes: 'columns', laneOrder: null, widths: [], ...eff,
});
const result = (o: { def?: Record<string, unknown>; usage?: unknown; group?: unknown; rows?: unknown[]; broken?: string[] }) => ({
  form: 'reference', name: 'Dotaz', lookup: 'ok', line: null, def: qdef(o.def ?? {}), state: 'ok', broken: (o.broken ?? []).map((key) => ({ reason: 'badValue', at: null, key, type: null })),
  targets: [], usesRelative: false, rows: o.rows ?? [], indexReady: true, group: o.group ?? null, usage: o.usage ?? null,
});
/** The overlay's `Výborné knihy` tab: a Table grouped by Author, its own lane order and widths (R228). */
const VYB = result({
  def: { title: 'Výborné knihy' },
  rows: [row('Cizí přístavy'), row('Čarovná mapa'), row('Mapa bez severu')],
  usage: usage('tab', { group: { none: false, key: 'author', period: false }, laneOrder: ['[[Lucie Horká]]'], widths: [['title', 260], ['author', 180]] },
    { view: 'table', groupBy: 'author', laneOrder: ['[[Lucie Horká]]'], widths: [['title', 260], ['author', 180]] }),
  group: {
    key: 'author', kind: 'relation', multiple: false, name: 'Author',
    lanes: [
      lane(LUCIE, 'relation', 'Lucie Horká', [1], { target: 'Autoři/Lucie Horká.md' }),
      lane(EVA, 'relation', 'Eva Lindová', [0, 2], { target: 'Autoři/Eva Lindová.md' }),
      lane('relation:Autoři/Marek Sova.md', 'relation', 'Marek Sova', [], { target: 'Autoři/Marek Sova.md' }),
      lane('none', 'none', '', []),
    ],
  },
});
/** Zobrazení's block 2: a Table grouped by the query's status with its own lane order (R228); `Read` has no rows. */
const B2 = result({
  def: { title: 'Rozečtené', view: 'wall', groupBy: 'status', laneOrder: ['Reading', 'To read', 'Read'], columns: ['author', 'rating'] },
  rows: [row('Dům u řeky'), row('Kniha o horách'), row('Noční vlak'), row('Účetní ze Žižkova'), row('Světla přístavu')],
  usage: usage('block', { view: 'table', laneOrder: ['To read'], widths: [['title', 240]] }, { view: 'table', groupBy: 'status', laneOrder: ['To read'], widths: [['title', 240]] }),
  group: {
    key: 'status', kind: 'select', multiple: false, name: 'Status',
    lanes: [lane('option:To read', 'option', 'To read', [0, 1], { color: 'gray' }), lane('option:Reading', 'option', 'Reading', [2, 3, 4], { color: 'blue' }), lane('option:Read', 'option', 'Read', [], { color: 'green', excluded: true })],
  },
});
/** The overlay's tab `Rozečtené`: own `group_by: none` over a grouped wall default. */
const ROZ_TAB = result({
  def: { title: 'Rozečtené', view: 'wall', groupBy: 'status', laneOrder: ['Reading', 'To read', 'Read'] },
  usage: usage('tab', { group: { none: true } }, { view: 'wall', groupBy: null, laneOrder: ['Reading', 'To read', 'Read'] }),
});
/** query/Rozečtené: no usage, the query file's grouped wall. */
const ROZ_PAGE = result({
  def: { title: 'Rozečtené', view: 'wall', groupBy: 'status', lanes: 'columns', laneOrder: ['Reading', 'To read', 'Read'] },
  group: { key: 'status', kind: 'select', multiple: false, name: 'Status', lanes: [lane('option:Reading', 'option', 'Reading', [0]), lane('option:To read', 'option', 'To read', [1])] },
  rows: [row('Noční vlak'), row('Dům u řeky')],
});
/** Zobrazení's block 5: broken view, group_by, lanes, widths; the query's Table, not grouped. */
const B5 = result({ def: { title: 'Výborné knihy' }, usage: usage('block', { view: 'broken', group: { none: false, key: 'finished', period: false }, lanes: 'broken', widths: 'broken' }, {}, ['view', 'group_by', 'lanes', 'widths']) });

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-32 (routing)

test('fr_qry_05_ac32_display_switch_on_a_tab', async () => {
  const m = await display(['writeRoute', 'effectiveDisplay', 'effectiveGrouping']);
  assert.equal(m.writeRoute(VYB.usage), 'item', 'a tab writes its views: item');
  assert.equal(m.writeRoute(B2.usage), 'fence', 'a block writes its fence');
  assert.equal(m.writeRoute(null), 'query', 'query/<name> writes the query file');
  assert.equal(m.writeRoute('all'), 'thisMac', 'All <plural> writes ui-state.json');
  // (7) Switching displays keeps the grouping and lane order (only the drawing changes).
  const asWall = { ...VYB, usage: { ...VYB.usage, view: 'wall', own: { ...(VYB.usage as any).own, view: 'wall' } } };
  assert.equal(m.effectiveDisplay(asWall), 'wall', 'the wall');
  assert.deepEqual(m.effectiveGrouping(asWall), { key: 'author', period: false }, 'the grouping kept');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-34 (choices)

test('fr_qry_05_ac34_group_menu', async () => {
  const m = await display(['groupChoices', 'groupName']);
  const ids = (cs: { id: string }[]) => cs.map((c) => c.id);
  assert.deepEqual(ids(m.groupChoices(BOOK, ['book'])),
    ['none', 'author', 'status', 'rating', 'genres', 'tags', 'period:finished', 'period:created', 'period:modified'], 'Book: None, Select / multi-select / relation, Tags, periods; no month entry');
  assert.deepEqual(ids(m.groupChoices(AUTOR, ['autor'])), ['none', 'tags', 'period:created', 'period:modified'], 'Autor (only a Text attribute)');
  assert.deepEqual(ids(m.groupChoices(BOOK, ['book', 'autor'])), ['none', 'tags', 'period:created', 'period:modified'], 'a query over several types');
  const choice = m.groupChoices(BOOK, ['book']).find((c: { id: string }) => c.id === 'period:finished');
  assert.deepEqual(choice, { id: 'period:finished', key: 'finished', period: true }, 'a period choice');
  assert.equal(m.groupName(choice, BOOK), 'Finished · by period', '`<Name> · by period`');
  assert.equal(m.groupName({ id: 'status', key: 'status', period: false }, BOOK), 'Status', 'an attribute\'s name');
  assert.equal(m.groupName({ id: 'tags', key: 'tags', period: false }, BOOK), 'Tags', 'Tags');
  // CP-37 (D-2202): an attribute keyed `none` isn't listed.
  const withNone = { ...BOOK, attributes: [...BOOK.attributes, { ...BOOK.attributes[1], key: 'none', name: 'Žádný' }] };
  assert.equal(ids(m.groupChoices(withNone, ['book'])).filter((x: string) => x === 'none').length, 1, 'only the `None` entry has the id none');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-35 (effective)

test('fr_qry_05_ac35_own_and_effective_values', async () => {
  const m = await display(['effectiveDisplay', 'effectiveGrouping', 'effectiveLanes', 'effectiveLaneOrder', 'effectiveWidths', 'ownKeys']);
  assert.equal(m.effectiveDisplay(ROZ_TAB), 'wall', 'tab Rozečtené: a wall');
  assert.equal(m.effectiveGrouping(ROZ_TAB), null, 'own none: not grouped');
  assert.deepEqual(m.ownKeys(ROZ_TAB), { view: null, group: 'own', lanes: null, laneOrder: null, widths: null }, 'own grouping only');
  assert.equal(m.effectiveDisplay(ROZ_PAGE), 'wall', 'query/Rozečtené: the def');
  assert.deepEqual(m.effectiveGrouping(ROZ_PAGE), { key: 'status', period: false }, 'query/Rozečtené: grouped by status');
  assert.equal(m.effectiveLanes(ROZ_PAGE), 'columns', 'its lanes');
  assert.deepEqual(m.effectiveLaneOrder(ROZ_PAGE), ['Reading', 'To read', 'Read'], 'its lane order');
  assert.equal(m.effectiveDisplay(B2), 'table', 'block 2: its own Table');
  assert.deepEqual(m.effectiveLaneOrder(B2), ['To read'], 'block 2: its own lane order, never merged');
  assert.deepEqual(m.effectiveWidths(B2), [['title', 240]], 'block 2: its own widths');
  assert.deepEqual(m.effectiveWidths(ROZ_PAGE), [], 'a query page: no vault widths');
  assert.deepEqual(m.ownKeys(B5), { view: 'broken', group: 'own', lanes: 'broken', laneOrder: null, widths: 'broken' }, 'block 5\'s own keys');
  const u = await load('../ui/src/views/usage.ts', 'ui/src/views/usage.ts');
  assert.equal(typeof u.canUseQuery, 'function', 'views/usage.ts exports canUseQuery');
  assert.equal(u.canUseQuery(ROZ_TAB, 'grouping'), true, '`Use the query\'s grouping` on tab Rozečtené');
  assert.equal(u.canUseQuery(ROZ_TAB, 'view'), false, 'no own view: no `Use the query\'s display`');
  assert.equal(u.canUseQuery(B5, 'view'), true, 'a broken own view counts');
  assert.equal(u.canUseQuery(ROZ_PAGE, 'grouping'), false, 'never on query/<name>');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-36 (notices)

test('fr_qry_05_ac36_broken_values', async () => {
  const m = await display(['noticeKeys']);
  assert.deepEqual(m.noticeKeys(B5), ['view', 'group_by', 'widths'], 'block 5 (a Table): view, group_by, widths; no lanes notice (D-2194 (g))');
  const wallRows = result({ def: { view: 'wall', groupBy: 'status' }, usage: usage('tab', { lanes: 'broken' }, { view: 'wall', groupBy: 'status' }, ['lanes']), group: B2.group });
  assert.deepEqual(m.noticeKeys(wallRows), ['lanes'], 'a broken lanes on a grouped wall shows');
  const ungroupedOrder = result({ usage: usage('tab', { laneOrder: 'broken' }, {}, ['lane_order']) });
  assert.deepEqual(m.noticeKeys(ungroupedOrder), [], 'lane_order only when grouped');
  const brokenWidthsOnWall = result({ def: { view: 'wall' }, usage: usage('tab', { widths: 'broken' }, { view: 'wall' }, ['widths']) });
  assert.deepEqual(m.noticeKeys(brokenWidthsOnWall), [], 'widths only on a Table');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-37 (grid)

test('fr_qry_05_ac37_ungrouped_wall', async () => {
  const g = await grid(['gridOf', 'windowRows', 'gridNeighbour']);
  assert.deepEqual(g.GRID, { min: 220, max: 300, gap: 12 }, 'GRID');
  for (const [w, cols] of [[952, 4], [1200, 5], [700, 3], [460, 2], [300, 1]] as const) {
    const r = g.gridOf(w, 40);
    assert.equal(r.columns, cols, `${w} px: ${cols} columns`);
    assert.ok(Math.abs(r.cardWidth - Math.min(300, (w - (cols - 1) * 12) / cols)) <= 1, `${w} px: card width ${r.cardWidth}`);
    if (w >= 220) assert.ok(r.cardWidth >= 220 - 1 && r.cardWidth <= 300 + 1, `${w} px: 220…300 px`);
  }
  assert.equal(g.gridOf(1200, 2).cardWidth, 300, 'fewer cards than columns: 300 px');
  // Keyboard: → / ← in reading order, ↓ / ↑ the same column, clamped.
  assert.equal(g.gridNeighbour(0, 'ArrowRight', 4, 8), 1, '→');
  assert.equal(g.gridNeighbour(3, 'ArrowRight', 4, 8), 4, '→ wraps to the next row (reading order)');
  assert.equal(g.gridNeighbour(4, 'ArrowLeft', 4, 8), 3, '←');
  assert.equal(g.gridNeighbour(1, 'ArrowDown', 4, 8), 5, '↓ the same column');
  assert.equal(g.gridNeighbour(6, 'ArrowUp', 4, 8), 2, '↑ the same column');
  assert.equal(g.gridNeighbour(0, 'ArrowLeft', 4, 8), 0, 'clamped at the first card');
  assert.equal(g.gridNeighbour(7, 'ArrowRight', 4, 8), 7, 'clamped at the last card');
  // Windowing: the visible rows ± 2.
  const [first, last] = g.windowRows(Array(40).fill(100), 1000, 300, 2);
  assert.equal(first, 8, 'rows from the first visible row (10) − 2');
  assert.ok(last >= 14 && last <= 15, `to the last visible row + 2 (${last})`);
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-39 (group model)

test('fr_qry_05_ac39_grouped_table', async () => {
  const m = await display(['groupModel']);
  const vyb = m.groupModel(VYB, 'table').map((x: any) => ({ id: x.id, count: x.count, rows: x.rows, grip: x.grip }));
  assert.deepEqual(vyb, [{ id: LUCIE, count: 1, rows: [1], grip: true }, { id: EVA, count: 2, rows: [0, 2], grip: true }], 'only groups with rows (D-2184), in lane order');
  const b2 = m.groupModel(B2, 'table').map((x: any) => x.id);
  assert.deepEqual(b2, ['option:To read', 'option:Reading'], 'block 2: no Read group although it is a lane of the wall');
  const head = m.groupModel(B2, 'table')[0];
  assert.equal(head.label, 'To read', 'the label');
  assert.equal(head.color, 'gray', 'an option\'s colour');
  // Periods are flat; `none` and `done` have no grip.
  const sched = result({
    def: { view: 'table', groupBy: 'due', groupPeriod: true },
    rows: Array.from({ length: 6 }, (_, i) => row(`Úkol ${i}`)),
    group: {
      key: 'due', kind: 'date', multiple: false, name: 'Due date',
      lanes: [
        lane('period:today', 'period', 'Today & overdue', [0]),
        { ...lane('period:week', 'period', 'This week', [2, 1]), days: [{ date: '2026-10-15', label: 'čtvrtek 15.', cards: [{ row: 2, raw: [] }] }, { date: '2026-10-16', label: 'pátek 16.', cards: [{ row: 1, raw: [] }] }] },
        lane('period:later', 'period', 'Later', []),
        lane('none', 'none', 'Not scheduled', [3]),
        lane('done', 'done', 'Done', [4, 5]),
      ],
    },
  });
  const s = m.groupModel(sched, 'table').map((x: any) => ({ id: x.id, rows: x.rows, grip: x.grip }));
  assert.deepEqual(s, [
    { id: 'period:today', rows: [0], grip: true },
    { id: 'period:week', rows: [2, 1], grip: true },
    { id: 'none', rows: [3], grip: false },
    { id: 'done', rows: [4, 5], grip: false },
  ], 'flat periods, no empty Later, no grip on none and done');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-42 (drops, reset)

test('fr_qry_05_ac42_group_order_and_folds', async () => {
  const m = await display(['laneOrderForGroupDrop', 'resetLaneOrderChange']);
  assert.deepEqual(m.laneOrderForGroupDrop(B2.group, 'option:Reading', 'option:To read'), ['Reading', 'To read', 'Read'], 'every lane of the grouping, the hidden Read included');
  assert.deepEqual(m.laneOrderForGroupDrop(VYB.group, EVA, LUCIE), ['[[Eva Lindová]]', '[[Lucie Horká]]', '[[Marek Sova]]'], 'relation lanes as link values; none never written');
  assert.deepEqual(m.resetLaneOrderChange(B2), [], 'the query has a lane_order: `lane_order: []`');
  assert.equal(m.resetLaneOrderChange(VYB), null, 'the query has none: remove the own key');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-43, AC-44 (widths)

test('fr_qry_05_ac43_widths_are_stored_with_the_usage', async () => {
  const m = await display(['widthsToWrite']);
  const order = ['author', 'rating', 'finished'];
  assert.deepEqual(m.widthsToWrite(null, null, { key: 'title', width: 300 }, order), [['title', 300]], 'Title 300 on a tab without widths');
  assert.deepEqual(m.widthsToWrite([['title', 300]], null, { key: 'author', width: 200 }, order), [['title', 300], ['author', 200]], 'Author 200: Title first, then column order');
  assert.deepEqual(m.widthsToWrite([['author', 200], ['title', 300]], null, { key: 'rating', width: 120 }, order), [['title', 300], ['author', 200], ['rating', 160]], 'the changed width clamped (R130: 160 minimum)');
});

test('fr_qry_05_ac44_widths_kept_by_0_6', async () => {
  const m = await display(['widthsToWrite']);
  assert.deepEqual(m.widthsToWrite(null, { title: 200, author: 180 }, { key: 'rating', width: 150 }, ['author', 'rating', 'finished']),
    [['title', 200], ['author', 180], ['rating', 150]], 'the 0.6.0 widths plus the change, in column order');
  assert.deepEqual(m.widthsToWrite([['title', 260]], { title: 400 }, { key: 'author', width: 190 }, ['author', 'status']), [['title', 260], ['author', 190]], 'own widths win over a kept entry');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-32 (newViewDef)

test('fr_qry_07_ac32_new_view_offers_table_list_wall', async () => {
  const m = await load('../ui/src/views/model.ts', 'ui/src/views/model.ts');
  for (const t of [AUTOR, BOOK]) {
    const d = m.newViewDef(t, 'wall', TYPES);
    assert.deepEqual(
      { view: d.view, groupBy: d.groupBy, groupNone: d.groupNone, lanes: d.lanes, laneOrder: d.laneOrder, columns: d.columns, groupPeriod: d.groupPeriod, doneLane: d.doneLane, types: d.types },
      { view: 'wall', groupBy: null, groupNone: false, lanes: 'columns', laneOrder: null, columns: [], groupPeriod: false, doneLane: null, types: [t.key] },
      `${t.name}: Wall with no group_by, lanes or columns`,
    );
  }
  assert.equal(m.newViewDef(BOOK, 'table', TYPES).view, 'table', 'Table stays');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-21 (editor model)

test('fr_qry_01_ac21_editor_without_view_lanes_group_by', async () => {
  const m = await display(['limitApplies']);
  assert.equal(m.limitApplies('list', false), true, 'an ungrouped List');
  assert.equal(m.limitApplies('table', false), true, 'an ungrouped Table');
  assert.equal(m.limitApplies('table', true), false, 'a grouped Table: every result');
  assert.equal(m.limitApplies('list', true), false, 'a grouped List');
  assert.equal(m.limitApplies('wall', false), false, 'an ungrouped wall (D-2189)');
  assert.equal(m.limitApplies('wall', true), false, 'a grouped wall');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-37

test('fr_typ_09_ac37_all_tab_display_and_grouping_on_this_mac', async () => {
  const m = await display(['allViewOf', 'allDef', 'writeRoute']);
  assert.deepEqual(m.allViewOf({ version: 1 }, 'book'), { view: 'table', groupBy: null, groupPeriod: false, lanes: 'columns' }, 'missing: a Table, not grouped');
  const st = { view: 'wall', groupBy: 'status', groupPeriod: false, lanes: 'rows' };
  assert.deepEqual(m.allViewOf({ version: 1, allView: { book: st } }, 'book'), st, 'the stored state');
  const sort = [{ by: 'modified', order: 'desc' }];
  const d = m.allDef(BOOK, st, sort);
  assert.deepEqual({ types: d.types, filters: d.filters, view: d.view, groupBy: d.groupBy, lanes: d.lanes, laneOrder: d.laneOrder, sort: d.sort, columns: d.columns },
    { types: ['book'], filters: [], view: 'wall', groupBy: 'status', lanes: 'rows', laneOrder: null, sort, columns: ['author', 'rating', 'status', 'modified'] }, 'allDef (CP-34, D-2199)');
  assert.equal(m.writeRoute('all'), 'thisMac', 'All Books writes ui-state.json');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-29

test('fr_typ_01_ac29_views_section_names_displays', async () => {
  const m = await display(['viewKindText']);
  assert.equal(m.viewKindText('wall', 'Status'), 'Wall · by Status', 'a grouped wall');
  assert.equal(m.viewKindText('table', 'Author'), 'Table · by Author', 'a grouped Table (D-2194 (b))');
  assert.equal(m.viewKindText('list', 'Genres'), 'List · by Genres', 'a grouped List');
  assert.equal(m.viewKindText('wall', null), 'Wall', 'an ungrouped wall');
  assert.equal(m.viewKindText('table', null), 'Table', 'an ungrouped Table');
  assert.equal(m.viewKindText('wall', 'Due date · by period').includes('Board'), false, 'never `Board`');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-16 (keys)

test('fr_fmt_12_ac16_display_keys_are_nfc', async () => {
  const m = await display(['groupModel', 'laneOrderForGroupDrop']);
  const nfdGroup = { ...VYB.group as any, lanes: (VYB.group as any).lanes.map((l: any) => ({ ...l, id: NFD(l.id), label: NFD(l.label) })) };
  const r = { ...VYB, group: nfdGroup };
  assert.deepEqual(m.groupModel(r, 'table').map((x: any) => x.id), [LUCIE, EVA], 'group ids NFC');
  const order = m.laneOrderForGroupDrop(nfdGroup, NFD(EVA), NFD(LUCIE));
  assert.deepEqual(order, ['[[Eva Lindová]]', '[[Lucie Horká]]', '[[Marek Sova]]'], 'the written lane order NFC');
});
