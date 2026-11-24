// Slice Q3, L1: docs/acceptance/views.md FR-UX-03 AC-56 (R227's commands `display.list`, `display.table`, `display.wall`,
// `group.open`, `group.remove`, `display.useQuery`, `group.useQuery`, with the kept `board.switchLanes` and
// `board.resetLaneOrder`: titles, no shortcut, `needsVault: true`, section `view`, listed exactly where R227 says) and
// NFR-OTH-02 AC-25 (R227's new catalog keys and texts, the removed keys gone, no text naming `Board` or `Kanban` as a
// display, group counts through `Intl.PluralRules`). Interface docs/contracts/v1-views.md §42.2, §42.4 (`ViewsStatus.display`).
// Written from the ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
async function mods() {
  const reg = await load('../ui/src/shell/registry.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(reg && cat && cmd, 'registry, catalog and commands modules load');
  return { reg: reg!, cat: cat!, cmd: cmd! };
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const VAULT = { name: 'Knihovna', path: '/tmp/Knihovna', placeholders: 0 };
type Display = { value: 'list' | 'table' | 'wall'; grouped: boolean; wall: boolean; writable: boolean; ownView: boolean; ownGroup: boolean; laneOrder: boolean; groupFocused: boolean; all: boolean };
type Board = { lanes: 'vertical' | 'horizontal'; laneOrder: boolean; cardFocused: boolean; laneFocused: boolean; taskFocused: boolean } | null;
type Usage = { kind: 'tab' | 'block'; ownSort: boolean; ownColumns: boolean } | null;
type Status = { typeKey: string | null; tab: string | null; writable: boolean; board: Board; sortable: boolean; usage: Usage; display: Display | null } | null;
function ctxOf(route: Record<string, unknown> | null, status: Status, calls: string[] = []) {
  return {
    vault: VAULT, types: [], counts: {}, route,
    actions: { go: (r: any) => calls.push(`go ${r.id}`), views: { status: () => status, run: (id: string) => calls.push(id) }, queryStatus: () => null, pinStatus: () => null },
  };
}
const BOOK = { id: 'type/<type>', param: 'book' };
const QUERY = { id: 'query/<name>', param: 'Rozečtené' };
const NOTE = { id: 'note/<path>', param: 'Pages/Zobrazení knih.md', path: 'Pages/Zobrazení knih.md', type: 'page' };
const disp = (o: Partial<Display> = {}): Display => ({ value: 'table', grouped: false, wall: false, writable: true, ownView: false, ownGroup: false, laneOrder: false, groupFocused: false, all: false, ...o });
const board = (o: Partial<NonNullable<Board>> = {}): Board => ({ lanes: 'vertical', laneOrder: false, cardFocused: false, laneFocused: false, taskFocused: false, ...o });
const st = (o: Partial<NonNullable<Status>> = {}): Status => ({ typeKey: 'book', tab: 'Přečtené 2026', writable: true, board: null, sortable: true, usage: { kind: 'tab', ownSort: false, ownColumns: false }, display: disp(), ...o });
const R227 = ['display.list', 'display.table', 'display.wall', 'group.open', 'group.remove', 'display.useQuery', 'group.useQuery', 'board.switchLanes', 'board.resetLaneOrder'];
const sorted = (xs: string[]) => [...xs].sort();

test('fr_ux_03_ac56_display_commands', async () => {
  const { reg, cat, cmd } = await mods();
  const ids = (route: Record<string, unknown> | null, s: Status) => sorted((cmd.commands(ctxOf(route, s)) as any[]).map((c) => c.id).filter((id: string) => R227.includes(id)));
  // Titles, section, needsVault, no shortcut.
  const all = cmd.commands(ctxOf(BOOK, st({ display: disp({ ownView: true, ownGroup: true, grouped: true }) }))) as any[];
  for (const [id, key, text] of [
    ['display.list', 'cmd.displayList', 'Display as list'], ['display.wall', 'cmd.displayWall', 'Display as wall'], ['group.open', 'cmd.groupBy', 'Group by…'],
    ['group.remove', 'cmd.removeGrouping', 'Remove grouping'], ['display.useQuery', 'cmd.useQueryDisplay', 'Use the query\'s display'], ['group.useQuery', 'cmd.useQueryGrouping', 'Use the query\'s grouping'],
  ]) {
    const c = all.find((x) => x.id === id);
    assert.ok(c, `${id} listed on a grouped Table tab with own display and grouping`);
    assert.deepEqual([c.title, cat.t(c.title), c.section, c.needsVault, c.shortcut ?? null], [key, text, 'view', true, null], `${id}: ${text}`);
  }
  const tableTitle = (cmd.commands(ctxOf(BOOK, st({ display: disp({ value: 'wall', wall: true }) }))) as any[]).find((x) => x.id === 'display.table');
  assert.equal(tableTitle && cat.t(tableTitle.title), 'Display as table', 'display.table: Display as table');
  // Where each is listed.
  assert.deepEqual(ids(BOOK, st()), sorted(['display.list', 'display.wall', 'group.open']), 'an ungrouped Table tab: the two other displays and Group by…');
  assert.deepEqual(ids(BOOK, st({ display: disp({ value: 'wall', wall: true, grouped: true, laneOrder: true }), board: board({ laneOrder: true }) })),
    sorted(['display.list', 'display.table', 'group.open', 'group.remove', 'board.switchLanes', 'board.resetLaneOrder']), 'a grouped wall: Switch lanes and Reset lane order too');
  assert.deepEqual(ids(BOOK, st({ display: disp({ value: 'table', grouped: true, laneOrder: true }) })),
    sorted(['display.list', 'display.wall', 'group.open', 'group.remove', 'board.resetLaneOrder']), 'a grouped Table: no Switch lanes');
  assert.deepEqual(ids(BOOK, st({ display: disp({ ownView: true }) })), sorted(['display.list', 'display.wall', 'group.open', 'display.useQuery']), 'an own view: Use the query\'s display');
  assert.deepEqual(ids(BOOK, st({ display: disp({ writable: false }), writable: false })), [], 'a tab that can\'t be written: none');
  assert.deepEqual(ids(BOOK, st({ tab: null, usage: null, display: disp({ all: true, value: 'wall', wall: true, grouped: true, laneOrder: false }), board: board() })),
    sorted(['display.list', 'display.table', 'group.open', 'group.remove', 'board.switchLanes']), '`All Books` as a grouped wall: no Use the query\'s …, no Reset lane order');
  assert.deepEqual(ids(QUERY, st({ typeKey: null, tab: null, usage: null, display: disp({ value: 'wall', wall: true, grouped: true, laneOrder: true }), board: board({ laneOrder: true }) })),
    sorted(['display.list', 'display.table', 'group.open', 'group.remove', 'board.switchLanes', 'board.resetLaneOrder']), 'query/<name>: never Use the query\'s …');
  assert.deepEqual(ids(NOTE, st({ typeKey: null, tab: null, usage: { kind: 'block', ownSort: false, ownColumns: false }, display: disp({ value: 'list', ownGroup: true, grouped: true }) })),
    sorted(['display.table', 'display.wall', 'group.open', 'group.remove', 'group.useQuery']), 'a selected block with own grouping');
  assert.deepEqual(ids(NOTE, st({ typeKey: null, tab: null, usage: null, display: null })), [], 'an inline block: none (D-2194 (e))');
  assert.deepEqual(ids(NOTE, null), [], 'no selected block: none');
  // Each runs views.run(id).
  const calls: string[] = [];
  const s = st({ display: disp({ ownView: true, ownGroup: true, grouped: true }) });
  const ctx = ctxOf(BOOK, s, calls);
  for (const id of ['display.wall', 'group.open', 'group.remove', 'display.useQuery', 'group.useQuery']) await (cmd.commands(ctx) as any[]).find((c) => c.id === id).run(ctx);
  assert.deepEqual(calls, ['display.wall', 'group.open', 'group.remove', 'display.useQuery', 'group.useQuery'], 'each runs views.run(id)');
  const sc = (reg.SHORTCUTS as { keys: string; command: string }[]).filter((x) => R227.slice(0, 7).includes(x.command));
  assert.deepEqual(sc, [], 'no shortcut');
});

const NEW: [string, Record<string, string | number>, string][] = [
  ['views.kind.wall', {}, 'Wall'], ['display.switch', {}, 'Display'], ['group.button', {}, 'Group'], ['group.buttonBy', { grouping: 'Status' }, 'Grouped by Status'],
  ['group.menu', {}, 'Group by'], ['group.none', {}, 'None'], ['group.byPeriod', { attribute: 'Due date' }, 'Due date · by period'], ['group.lanes', {}, 'Lanes'],
  ['group.columns', {}, 'Columns'], ['group.rows', {}, 'Rows'], ['group.scope.tab', {}, 'This tab\'s display and grouping'], ['group.scope.block', {}, 'This block\'s display and grouping'],
  ['group.scope.default', {}, 'Default for tabs and blocks without their own'], ['group.scope.thisMac', {}, 'Display and grouping of this page on this Mac'],
  ['group.useQuery', {}, 'Use the query\'s grouping'], ['display.useQuery', {}, 'Use the query\'s display'], ['group.drag', {}, 'Drag to move the group'],
  ['group.moved', { group: 'Reading' }, 'Moved group Reading'], ['typeSettings.viewKindBy', { display: 'Wall', attribute: 'Status' }, 'Wall · by Status'],
  ['query.editor.limitHint', {}, 'Applies to a List or Table without grouping'], ['cmd.displayList', {}, 'Display as list'], ['cmd.displayTable', {}, 'Display as table'],
  ['cmd.displayWall', {}, 'Display as wall'], ['cmd.groupBy', {}, 'Group by…'], ['cmd.removeGrouping', {}, 'Remove grouping'], ['cmd.useQueryDisplay', {}, 'Use the query\'s display'],
  ['cmd.useQueryGrouping', {}, 'Use the query\'s grouping'], ['purpose.tasks', {}, 'All tasks as a list, table or wall, grouped by status or date.'],
];
const REMOVED = ['views.kind.board', 'views.kind.boardBy', 'typeSettings.viewBoardBy', 'query.editor.board', 'query.editor.groupBy', 'query.editor.groupByHint', 'query.editor.lanes',
  'query.editor.groupByPeriod', 'query.editor.groupByPeriodHint', 'board.lanes', 'board.vertical', 'board.horizontal', 'board.verticalTitle', 'board.horizontalTitle'];
const KEPT = ['query.editor.view', 'query.editor.list', 'query.editor.table', 'query.editor.tableHint', 'query.block.brokenKey', 'query.block.usageNotEditable', 'query.block.readOnly',
  'views.changedOutside', 'views.kind.table', 'views.kind.list', 'board.laneCountOf', 'board.collapse', 'board.expand', 'board.none', 'board.dragColumn', 'board.dragRow', 'board.laneMoved',
  'cmd.switchLanes', 'cmd.resetLaneOrder', 'cmd.tasks.kanban'];

test('nfr_oth_02_ac25_display_strings', async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat, 'ui/src/i18n/catalog.ts loads');
  const en = cat!.en as Record<string, string>;
  const bad: string[] = [];
  for (const [key, vars, want] of NEW) {
    const got = key in en ? cat!.t(key, vars) : 'missing';
    if (got !== want) bad.push(`${key} ${JSON.stringify(vars)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  for (const key of REMOVED) if (key in en) bad.push(`${key}: removed by R227, still in the catalog`);
  for (const key of KEPT) if (!(key in en)) bad.push(`${key}: kept by R227, missing`);
  assert.deepEqual(bad, [], 'R227\'s new keys with their texts, the removed keys gone, the kept keys there');
  // No catalog text names Board or Kanban as a display (file names `Kanban`, `Schedule` stay in their texts).
  const allowed = new Set(['cmd.tasks.kanban']);
  const named = Object.entries(en).filter(([k, v]) => typeof v === 'string' && /\bBoard\b/.test(v) && !allowed.has(k)).map(([k]) => k);
  assert.deepEqual(named, [], 'no text says `Board`');
  // Group counts use Intl.PluralRules (`board.laneCountOf`): the header's `Reading, 3 Books`, `Lucie Horká, 1 Book`.
  assert.equal(cat!.t('board.laneCountOf', { count: 3, name: 'Book', plural: 'Books' }), '3 Books', 'other');
  assert.equal(cat!.t('board.laneCountOf', { count: 1, name: 'Book', plural: 'Books' }), '1 Book', 'one');
});
