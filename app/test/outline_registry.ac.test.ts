// Slice OL, L1: the registry parts of docs/acceptance/outline.md FR-UX-03 AC-45 (R175's five commands, ⌘J as the one new
// shortcut, the palette's routes, `help/shortcuts` under Navigation) and FR-NAV-05 AC-4 (where `Show outline` is listed).
// Interface docs/contracts/v1-outline.md §6 (`PANEL_TABS` row, `SHORTCUTS` row after ⇧⌘G, `groupOf`, `ROUTE_TITLES`,
// `ShellContext.outline`, `ShellActions.showOutline` / `outlineJump` / `outlineFold` / `toggleOutlineRail`). The app-shell
// R2 / R4 tables in shell-tables.ts change in the build commit (D-1624); this file checks the slice's rows on their own.
// Written from the ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { RESERVED, shortcutClashes } from './shell-tables';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
async function mods() {
  const reg = await load('../ui/src/shell/registry.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  const grp = await load('../ui/src/shell/shortcutGroups.ts');
  assert.ok(reg && cat && cmd && grp, 'registry, catalog, commands and shortcutGroups modules load');
  return { reg: reg!, cat: cat!, cmd: cmd!, grp: grp! };
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const VAULT = { name: 'Outline', path: '/tmp/Outline', placeholders: 0 };
const NOTE = { id: 'note/<path>', param: 'Pages/Plán offsitu 2026.md', path: 'Pages/Plán offsitu 2026.md', type: 'page' };
const DAILY = { id: 'daily/YYYY-MM-DD', param: '2026-11-12', date: '2026-11-12', path: 'Daily/2026-11-12.md' };
const VIRTUAL = { id: 'daily/YYYY-MM-DD', param: '2026-11-13', date: '2026-11-13', path: null };
const NEW = { id: 'new/<type>', param: 'page', type: 'page', path: null };
const OTHER: [string, Record<string, unknown>][] = [
  ['tag/<key>', { id: 'tag/<key>', param: 'projekt', key: 'projekt' }], ['graph/<path>', { id: 'graph/<path>', param: NOTE.path, path: NOTE.path }],
  ['search', { id: 'search' }], ['tasks', { id: 'tasks' }], ['type/page', { id: 'type/<type>', param: 'page' }], ['inbox', { id: 'inbox' }],
];
type Outline = { canExpandAll: boolean; canCollapseAll: boolean } | null | undefined;
function ctx(route: Record<string, unknown> | null, o: { outline?: Outline; calls?: string[]; vault?: typeof VAULT | null } = {}) {
  const calls = o.calls ?? [];
  return {
    vault: o.vault === undefined ? VAULT : o.vault, types: [], counts: { page: 10 }, ...(route ? { route } : {}),
    panel: { open: !!o.outline, tab: o.outline ? 'outline' : 'backlinks' }, ...(o.outline !== undefined ? { outline: o.outline } : {}),
    actions: {
      showOutline: () => calls.push('showOutline'), outlineJump: () => calls.push('outlineJump'),
      outlineFold: (all: string) => calls.push(`outlineFold ${all}`), toggleOutlineRail: () => calls.push('toggleOutlineRail'),
    },
  };
}
const find = (list: any[], id: string) => list.find((c) => c.id === id);

test('fr_ux_03_ac45_outline_commands_and_shortcut', async () => {
  const { reg, cat, cmd, grp } = await mods();
  const title = (c: any) => cat.t(c.title, c.vars ?? {});
  // R2: the panel tab is built (D-1624, §6).
  const tab = (reg.PANEL_TABS as any[]).find((t) => t.id === 'outline');
  assert.ok(tab, 'PANEL_TABS has the outline row');
  assert.deepEqual({ name: tab.name, built: tab.status?.built, due: tab.status?.due, reqs: tab.reqs }, { name: 'tab.outline', built: true, due: { milestone: 'v1.0' }, reqs: ['FR-EDT-11', 'FR-NAV-05'] }, 'the outline row (§6)');
  // R4: ⌘J → outline.jump, right after ⇧⌘G.
  const sc = reg.SHORTCUTS as { keys: string; command: string }[];
  const j = sc.findIndex((s) => s.keys === '⌘J');
  assert.ok(j >= 0, '⌘J is in SHORTCUTS');
  assert.equal(sc[j].command, 'outline.jump', '⌘J → outline.jump');
  assert.equal(sc[j - 1]?.keys, '⇧⌘G', '⌘J comes right after ⇧⌘G (R4)');
  assert.deepEqual(sc.filter((s) => s.command.startsWith('outline.') || s.command === 'panel.outline'), [{ keys: '⌘J', command: 'outline.jump' }], 'only outline.jump has a shortcut');
  assert.equal(sc.filter((s) => s.keys === '⌘J').length, 1, '⌘J is used once');
  assert.ok(!RESERVED.includes('⌘J'), '⌘J isn\'t reserved by macOS');
  // R175: titles, sections, needsVault, shortcut.
  const onNote = cmd.commands(ctx(NOTE, { outline: { canExpandAll: true, canCollapseAll: true } })) as any[];
  const WANT: [string, string, string | null][] = [
    ['panel.outline', 'Show outline', null], ['outline.jump', 'Outline: jump to heading…', '⌘J'], ['outline.expandAll', 'Outline: Expand all', null],
    ['outline.collapseAll', 'Outline: Collapse all', null], ['outline.toggleRail', 'Toggle outline rail', null],
  ];
  const TITLE_KEYS: Record<string, string> = { 'panel.outline': 'cmd.outline.show', 'outline.jump': 'cmd.outline.jump', 'outline.expandAll': 'cmd.outline.expandAll', 'outline.collapseAll': 'cmd.outline.collapseAll', 'outline.toggleRail': 'cmd.outline.toggleRail' };
  for (const [id, t, keys] of WANT) {
    const c = find(onNote, id);
    assert.ok(c, `${id} is listed on a note with the Outline on screen`);
    assert.deepEqual([c.title, title(c), c.section, c.needsVault, c.shortcut ?? null, c.due ?? null], [TITLE_KEYS[id], t, 'view', true, keys, null], `${id}: ${t}`);
  }
  assert.deepEqual(shortcutClashes(onNote), [], 'no shortcut is shared (FR-UX-03 AC-7)');
  for (const c of onNote) assert.ok(!RESERVED.includes(c.shortcut), `${c.id} uses no reserved shortcut`);
  // Routes (R175).
  for (const [what, route] of [['note', NOTE], ['daily', DAILY], ['virtual daily', VIRTUAL], ['new', NEW]] as const) {
    const l = cmd.commands(ctx(route)) as any[];
    assert.ok(find(l, 'panel.outline') && find(l, 'outline.jump'), `${what}: Show outline and Outline: jump to heading… are listed`);
    assert.ok(find(l, 'outline.toggleRail'), `${what}: Toggle outline rail is listed`);
    assert.ok(!find(l, 'outline.expandAll') && !find(l, 'outline.collapseAll'), `${what}: the fold commands only while the Outline is on screen`);
  }
  for (const [what, route] of OTHER) {
    const l = cmd.commands(ctx(route)) as any[];
    assert.ok(!find(l, 'panel.outline') && !find(l, 'outline.jump'), `${what}: neither Show outline nor Outline: jump to heading…`);
    assert.ok(find(l, 'outline.toggleRail'), `${what}: Toggle outline rail on every route with a vault`);
  }
  assert.ok(!find(cmd.commands(ctx(null, { vault: null })) as any[], 'outline.toggleRail'), 'no vault: not listed (needsVault)');
  const fold = (o: Outline) => cmd.commands(ctx(NOTE, { outline: o })) as any[];
  assert.ok(find(fold({ canExpandAll: true, canCollapseAll: false }), 'outline.expandAll') && !find(fold({ canExpandAll: true, canCollapseAll: false }), 'outline.collapseAll'), 'Expand all only while a row is collapsed');
  assert.ok(!find(fold({ canExpandAll: false, canCollapseAll: true }), 'outline.expandAll') && find(fold({ canExpandAll: false, canCollapseAll: true }), 'outline.collapseAll'), 'Collapse all only while a heading with children is expanded');
  assert.ok(!find(fold(null), 'outline.expandAll') && !find(fold(null), 'outline.collapseAll'), 'ctx.outline null: neither');
  // Running them.
  const calls: string[] = [];
  const c = ctx(NOTE, { outline: { canExpandAll: true, canCollapseAll: true }, calls });
  const l = cmd.commands(c) as any[];
  for (const id of ['panel.outline', 'outline.jump', 'outline.expandAll', 'outline.collapseAll', 'outline.toggleRail']) await find(l, id)?.run(c);
  assert.deepEqual(calls, ['showOutline', 'outlineJump', 'outlineFold expand', 'outlineFold collapse', 'toggleOutlineRail'], 'each runs its action (§6)');
  // help/shortcuts: ⌘J under Navigation.
  assert.equal(grp.groupOf('outline.jump'), 'navigation', 'groupOf puts outline.* in navigation');
  assert.equal(grp.ROUTE_TITLES['outline.jump'], 'cmd.outline.jump', 'ROUTE_TITLES names outline.jump');
  const nav = (grp.grouped() as Map<string, { keys: string; command: string }[]>).get('navigation') ?? [];
  assert.ok(nav.some((s) => s.keys === '⌘J' && s.command === 'outline.jump'), 'grouped(): ⌘J in Navigation');
});

test('fr_nav_05_ac4_show_outline_opens_the_tab_listing', async () => {
  const { cmd } = await mods();
  for (const [what, route] of [['note', NOTE], ['daily', DAILY], ['new', NEW]] as const) assert.ok(find(cmd.commands(ctx(route)) as any[], 'panel.outline'), `listed on ${what}`);
  for (const [what, route] of OTHER.filter(([w]) => w !== 'inbox')) assert.equal(find(cmd.commands(ctx(route)) as any[], 'panel.outline'), undefined, `not listed on ${what}`);
});
