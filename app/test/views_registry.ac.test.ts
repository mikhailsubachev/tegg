// Slice Q2, L1: the registry parts of docs/acceptance/views.md FR-UX-03 AC-50 (R191's commands with R192's titles, no
// shortcut, `needsVault: true`, listed exactly where R191 says; D-1771) and FR-QRY-07 AC-17 (the old placeholders leave
// app-shell R3 and the catalog, AP-1517 / D-1801). Interface docs/contracts/v1-views.md §4.6 (removed keys), §4.7 (command
// ids, title keys, sections, `ShellActions.views` with `ViewsStatus`). Written from the ACs and the contract only (D-61).
// Modules load inside the tests (TS-I1).
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
type Board = { lanes: 'vertical' | 'horizontal'; laneOrder: boolean; cardFocused: boolean; laneFocused: boolean } | null;
// Slice Q3 (AC-Test-Change, D-2196; v1-views §42.4): `ViewsStatus.display`.
type Display = { value: 'list' | 'table' | 'wall'; grouped: boolean; wall: boolean; writable: boolean; ownView: boolean; ownGroup: boolean; laneOrder: boolean; groupFocused: boolean; all: boolean } | null;
type Status = { typeKey: string | null; tab: string | null; writable: boolean; board: Board; sortable: boolean; display?: Display } | null;
function ctxOf(route: Record<string, unknown> | null, status: Status, calls: string[] = [], vault = true) {
  return {
    vault: vault ? VAULT : null, types: [], counts: {}, route,
    actions: {
      go: (r: any) => calls.push(`go ${r.id}`),
      views: { status: () => status, run: (id: string) => calls.push(id) },
      queryStatus: () => null, pinStatus: () => null,
    },
  };
}
const BOOK_ROUTE = { id: 'type/<type>', param: 'book' };
const QUERY_ROUTE = { id: 'query/<name>', param: 'Rozečtené' };
const NOTE_ROUTE = { id: 'note/<path>', param: 'Pages/Čtení 2026.md', path: 'Pages/Čtení 2026.md', type: 'page' };
const board = (o: Partial<NonNullable<Board>> = {}): Board => ({ lanes: 'vertical', laneOrder: false, cardFocused: false, laneFocused: false, ...o });
const st = (o: Partial<NonNullable<Status>> = {}): Status => ({ typeKey: 'book', tab: null, writable: true, board: null, sortable: false, display: null, ...o });
const disp = (o: Partial<NonNullable<Display>> = {}): Display => ({ value: 'table', grouped: false, wall: false, writable: true, ownView: false, ownGroup: false, laneOrder: false, groupFocused: false, all: false, ...o });
const wallD = (o: Partial<NonNullable<Display>> = {}) => disp({ value: 'wall', wall: true, grouped: true, ...o });

/** R191 with R192's titles: [id, title key, English title, section]. */
const R191: [string, string, string, string][] = [
  ['views.new', 'cmd.newView', 'New view…', 'create'], ['views.edit', 'cmd.editView', 'Edit view', 'view'],
  ['views.next', 'cmd.nextView', 'Next view', 'view'], ['views.previous', 'cmd.previousView', 'Previous view', 'view'],
  ['views.moveLeft', 'cmd.moveViewLeft', 'Move view left', 'view'], ['views.moveRight', 'cmd.moveViewRight', 'Move view right', 'view'],
  ['board.switchLanes', 'cmd.switchLanes', 'Switch lanes', 'view'], ['sort.addLevel', 'cmd.addSortLevel', 'Add sort level', 'view'],
  ['board.resetLaneOrder', 'cmd.resetLaneOrder', 'Reset lane order', 'view'], ['board.cardNext', 'cmd.cardNext', 'Move card to next lane', 'view'],
  ['board.cardPrevious', 'cmd.cardPrevious', 'Move card to previous lane', 'view'], ['board.laneLeft', 'cmd.laneLeft', 'Move lane left', 'view'],
  ['board.laneRight', 'cmd.laneRight', 'Move lane right', 'view'], ['board.laneUp', 'cmd.laneUp', 'Move lane up', 'view'], ['board.laneDown', 'cmd.laneDown', 'Move lane down', 'view'],
];
/** Slice Q3 (R227): the id sets gain the display and grouping commands. */
const R227_IDS = ['display.list', 'display.table', 'display.wall', 'group.open', 'group.remove', 'display.useQuery', 'group.useQuery'];
const ALL_IDS = [...R191.map(([id]) => id), ...R227_IDS];

test('fr_ux_03_ac50_view_commands', async () => {
  const { reg, cat, cmd } = await mods();
  const ids = (route: Record<string, unknown> | null, s: Status) => (cmd.commands(ctxOf(route, s)) as any[]).map((c) => c.id).filter((id: string) => ALL_IDS.includes(id)).sort();
  const sorted = (l: string[]) => [...l].sort();
  // Titles, sections, needsVault, no shortcut.
  const all = cmd.commands(ctxOf(BOOK_ROUTE, st({ tab: 'Rozečtené', board: board({ laneOrder: true, cardFocused: true, laneFocused: true }), sortable: true, display: wallD({ laneOrder: true }) }))) as any[];
  for (const [id, key, text, section] of R191.filter(([id]) => !['board.laneUp', 'board.laneDown'].includes(id))) {
    const c = all.find((x) => x.id === id);
    assert.ok(c, `${id} listed on a writable vertical board tab with a focused card`);
    assert.deepEqual([c.title, cat.t(c.title), c.section, c.needsVault, c.shortcut ?? null], [key, text, section, true, null], `${id}: ${text}`);
  }
  // Where each is listed (R191, §4.7; slice Q3: R227's commands where the usage can be written, D-2196).
  const TABLE = ['display.list', 'display.wall', 'group.open'];
  const WALL_GROUPED = ['display.list', 'display.table', 'group.open', 'group.remove'];
  assert.deepEqual(ids(BOOK_ROUTE, st({ display: disp({ all: true }) })), sorted(['views.new', 'views.next', 'views.previous', ...TABLE]), '`All Books` selected: New view…, Next / Previous view, the other displays, Group by…');
  assert.deepEqual(ids(BOOK_ROUTE, st({ tab: 'Přečtené 2026', sortable: true, display: disp() })), sorted(['views.new', 'views.edit', 'views.next', 'views.previous', 'views.moveLeft', 'views.moveRight', 'sort.addLevel', ...TABLE]),
    'a table view tab: Edit view, Move view left / right, Add sort level');
  assert.deepEqual(ids(BOOK_ROUTE, st({ tab: 'Rozečtené', sortable: true, board: board({ laneOrder: true }), display: wallD({ laneOrder: true }) })),
    sorted(['views.new', 'views.edit', 'views.next', 'views.previous', 'views.moveLeft', 'views.moveRight', 'sort.addLevel', 'board.switchLanes', 'board.resetLaneOrder', ...WALL_GROUPED]),
    'a grouped wall tab with lane_order: also Switch lanes and Reset lane order');
  assert.deepEqual(ids(BOOK_ROUTE, st({ tab: 'Rozečtené', sortable: true, board: board({ cardFocused: true }), display: wallD() })).filter((x) => x.startsWith('board.')),
    sorted(['board.switchLanes', 'board.cardNext', 'board.cardPrevious', 'board.laneLeft', 'board.laneRight']), 'a focused card on a grouped wall in columns: card and lane left / right');
  assert.deepEqual(ids(BOOK_ROUTE, st({ tab: 'Podle žánru', sortable: true, board: board({ lanes: 'horizontal', laneFocused: true }), display: wallD() })).filter((x) => x.startsWith('board.lane')),
    sorted(['board.laneUp', 'board.laneDown']), 'a focused row header on a grouped wall in rows: Move lane up / down');
  assert.deepEqual(ids(BOOK_ROUTE, st({ tab: 'Rozečtené', writable: false, board: board(), display: wallD({ writable: false }) })).filter((x) => ['views.moveLeft', 'views.moveRight', 'board.switchLanes', ...R227_IDS].includes(x)), [],
    'a read-only type file / view: no Move view, no Switch lanes, no display or grouping command');
  assert.deepEqual(ids(QUERY_ROUTE, st({ typeKey: null, tab: null, sortable: true, board: board(), display: wallD() })), sorted(['board.switchLanes', 'sort.addLevel', ...WALL_GROUPED]), 'query/<name> of a grouped wall: Switch lanes, Add sort level, the displays and grouping');
  assert.deepEqual(ids(NOTE_ROUTE, st({ typeKey: null, tab: null, sortable: true, board: board(), display: wallD() })), sorted(['board.switchLanes', 'sort.addLevel', ...WALL_GROUPED]), 'a selected grouped-wall block');
  assert.deepEqual(ids(NOTE_ROUTE, null), [], 'a note without a selected block: none');
  assert.deepEqual(ids({ id: 'type/<type>', param: 'task' }, null), [], 'the Tasks page (no views, status null): none');
  assert.deepEqual(ids({ id: 'inbox' }, null), [], 'elsewhere: none');
  // Running them goes through ShellActions.views.run.
  const calls: string[] = [];
  const ctx = ctxOf(BOOK_ROUTE, st({ tab: 'Rozečtené', sortable: true, board: board({ laneOrder: true, cardFocused: true }), display: wallD({ laneOrder: true }) }), calls);
  for (const id of ['views.new', 'views.next', 'board.switchLanes', 'board.cardNext']) await (cmd.commands(ctx) as any[]).find((c) => c.id === id).run(ctx);
  assert.deepEqual(calls, ['views.new', 'views.next', 'board.switchLanes', 'board.cardNext'], 'each runs views.run(id)');
  // No vault: they need one.
  for (const c of (cmd.commands(ctxOf(BOOK_ROUTE, st(), [], false)) as any[]).filter((x) => ALL_IDS.includes(x.id))) assert.equal(c.needsVault, true, `${c.id} needs a vault`);
  // No shortcut (D-1771) and no clash.
  const sc = (reg.SHORTCUTS as { keys: string; command: string }[]).filter((s) => /^(views\.|board\.|sort\.|display\.|group\.)/.test(s.command));
  assert.deepEqual(sc, [], 'no shortcut for the view commands');
});

test('fr_qry_07_ac17_view_placeholders_removed', async () => {
  const { reg, cat } = await mods();
  const controls = reg.DISABLED_CONTROLS as any[];
  const text = (k: string) => (k in cat.en ? cat.t(k) : k);
  const labels = controls.map((c) => text(c.label));
  for (const l of ['Filter', 'Group', 'Add view']) assert.ok(!labels.includes(l), `R3 has no \`${l}\` control (AP-1517)`);
  assert.equal(labels.filter((l) => l === 'Edit').length, 1, 'one `Edit` left in R3 (Type settings › Templates; the Views one is gone)');
  assert.ok(labels.includes('New template'), 'the Templates controls stay');
  for (const k of ['ctl.filter', 'ctl.group', 'ctl.addView', 'ctl.addViewSettings', 'ctl.editView']) assert.ok(!(k in cat.en), `catalog key ${k} removed (§4.6, D-1801)`);
  assert.ok(!('typePage.allView' in cat.en) && cat.t('views.all', { plural: 'Books' }) === 'All Books', '`typePage.allView` is renamed to `views.all` (`All {plural}`)');
});
