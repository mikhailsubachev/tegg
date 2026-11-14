// Slice OL, L1: the registry parts of docs/acceptance/outline.md FR-UX-03 AC-45 (R175's commands, ⌘J as the one new
// shortcut, the palette's routes, `help/shortcuts` under Navigation). D-1675: no Outline tab, no `Show outline`, no fold
// commands. Interface docs/contracts/v1-outline.md §6 (`SHORTCUTS` row after ⇧⌘G, `groupOf`, `ROUTE_TITLES`,
// `ShellActions.outlineJump` / `toggleOutlineRail`). The app-shell
// R4 table in shell-tables.ts changes in the build commit (D-1624); this file checks the slice's rows on their own.
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
function ctx(route: Record<string, unknown> | null, o: { calls?: string[]; vault?: typeof VAULT | null; panel?: boolean } = {}) {
  const calls = o.calls ?? [];
  return {
    vault: o.vault === undefined ? VAULT : o.vault, types: [], counts: { page: 10 }, ...(route ? { route } : {}),
    panel: { open: !!o.panel, tab: 'backlinks' },
    actions: { outlineJump: () => calls.push('outlineJump'), toggleOutlineRail: () => calls.push('toggleOutlineRail') },
  };
}
const GONE = ['panel.outline', 'outline.expandAll', 'outline.collapseAll'];
const find = (list: any[], id: string) => list.find((c) => c.id === id);

test('fr_ux_03_ac45_outline_commands_and_shortcut', async () => {
  const { reg, cat, cmd, grp } = await mods();
  const title = (c: any) => cat.t(c.title, c.vars ?? {});
  // R2 (D-1675): no Outline tab.
  assert.deepEqual((reg.PANEL_TABS as any[]).map((t) => t.id), ['backlinks', 'graph'], 'PANEL_TABS: Backlinks, Graph (D-1675)');
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
  const onNote = cmd.commands(ctx(NOTE, { panel: true })) as any[];
  const WANT: [string, string, string | null][] = [
    ['outline.jump', 'Outline: jump to heading…', '⌘J'], ['outline.toggleRail', 'Toggle outline rail', null],
  ];
  const TITLE_KEYS: Record<string, string> = { 'outline.jump': 'cmd.outline.jump', 'outline.toggleRail': 'cmd.outline.toggleRail' };
  for (const [id, t, keys] of WANT) {
    const c = find(onNote, id);
    assert.ok(c, `${id} is listed on a note`);
    assert.deepEqual([c.title, title(c), c.section, c.needsVault, c.shortcut ?? null, c.due ?? null], [TITLE_KEYS[id], t, 'view', true, keys, null], `${id}: ${t}`);
  }
  assert.deepEqual(shortcutClashes(onNote), [], 'no shortcut is shared (FR-UX-03 AC-7)');
  for (const c of onNote) assert.ok(!RESERVED.includes(c.shortcut), `${c.id} uses no reserved shortcut`);
  // Routes (R175).
  for (const [what, route] of [['note', NOTE], ['daily', DAILY], ['virtual daily', VIRTUAL], ['new', NEW]] as const) {
    const l = cmd.commands(ctx(route)) as any[];
    assert.ok(find(l, 'outline.jump'), `${what}: Outline: jump to heading… is listed`);
    assert.ok(find(l, 'outline.toggleRail'), `${what}: Toggle outline rail is listed`);
    for (const id of GONE) assert.ok(!find(l, id) && !find(cmd.commands(ctx(route, { panel: true })) as any[], id), `${what}: no ${id} (D-1675)`);
  }
  for (const [what, route] of OTHER) {
    const l = cmd.commands(ctx(route)) as any[];
    assert.ok(!find(l, 'outline.jump'), `${what}: no Outline: jump to heading…`);
    for (const id of GONE) assert.ok(!find(l, id), `${what}: no ${id} (D-1675)`);
    assert.ok(find(l, 'outline.toggleRail'), `${what}: Toggle outline rail on every route with a vault`);
  }
  assert.ok(!find(cmd.commands(ctx(null, { vault: null })) as any[], 'outline.toggleRail'), 'no vault: not listed (needsVault)');
  // Running them.
  const calls: string[] = [];
  const c = ctx(NOTE, { calls });
  const l = cmd.commands(c) as any[];
  for (const id of ['outline.jump', 'outline.toggleRail']) await find(l, id)?.run(c);
  assert.deepEqual(calls, ['outlineJump', 'toggleOutlineRail'], 'each runs its action (§6)');
  // help/shortcuts: ⌘J under Navigation.
  assert.equal(grp.groupOf('outline.jump'), 'navigation', 'groupOf puts outline.* in navigation');
  assert.equal(grp.ROUTE_TITLES['outline.jump'], 'cmd.outline.jump', 'ROUTE_TITLES names outline.jump');
  const nav = (grp.grouped() as Map<string, { keys: string; command: string }[]>).get('navigation') ?? [];
  assert.ok(nav.some((s) => s.keys === '⌘J' && s.command === 'outline.jump'), 'grouped(): ⌘J in Navigation');
});
