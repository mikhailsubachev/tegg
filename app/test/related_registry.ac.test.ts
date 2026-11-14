// Slice REL, L1: the registry part of docs/acceptance/related.md FR-UX-03 AC-48 (R183): the `Related` tab between
// Backlinks and Graph (D-1699), the commands `panel.related` (`Show related`) and `related.toggleLinked` (its title
// follows the stored choice), section `view`, `needsVault`, no shortcut, R4 unchanged, the palette's routes (note, daily,
// new; not tag, graph, search, tasks), and what each runs. Interface docs/contracts/v1-related.md §3.2 (`PANEL_TABS`
// row, `commands(ctx)`, `ShellContext.related`, `ShellActions.showRelated` / `toggleRelatedLinked`). Written from the
// ACs and the contract only (D-61). Modules load inside the test (TS-I1).
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
  assert.ok(reg && cat && cmd, 'registry, catalog and commands modules load');
  return { reg: reg!, cat: cat!, cmd: cmd! };
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const VAULT = { name: 'Related', path: '/tmp/Related', placeholders: 0 };
const NOTE = { id: 'note/<path>', param: 'Pages/Rozpočet na offsite 2027.md', path: 'Pages/Rozpočet na offsite 2027.md', type: 'page' };
const DAILY = { id: 'daily/YYYY-MM-DD', param: '2026-09-30', date: '2026-09-30', path: 'Daily/2026-09-30.md' };
const VIRTUAL = { id: 'daily/YYYY-MM-DD', param: '2026-11-14', date: '2026-11-14', path: null };
const NEW = { id: 'new/<type>', param: 'page', type: 'page', path: null };
const NOT_LISTED: [string, Record<string, unknown>][] = [
  ['tag/<key>', { id: 'tag/<key>', param: 'včelaření', key: 'včelaření' }], ['graph/<path>', { id: 'graph/<path>', param: NOTE.path, path: NOTE.path }],
  ['search', { id: 'search' }], ['tasks', { id: 'tasks' }],
];
function ctx(route: Record<string, unknown> | null, o: { calls?: string[]; vault?: typeof VAULT | null; panel?: { open: boolean; tab: string }; showLinked?: boolean } = {}) {
  const calls = o.calls ?? [];
  return {
    vault: o.vault === undefined ? VAULT : o.vault, types: [], counts: { page: 10 }, ...(route ? { route } : {}),
    panel: o.panel ?? { open: false, tab: 'backlinks' },
    related: { showLinked: !!o.showLinked },
    actions: { showRelated: () => calls.push('showRelated'), toggleRelatedLinked: () => calls.push('toggleRelatedLinked') },
  };
}
const find = (list: any[], id: string) => list.find((c) => c.id === id);
const IDS = ['panel.related', 'related.toggleLinked'];

test('fr_ux_03_ac48_related_commands', async () => {
  const { reg, cat, cmd } = await mods();
  const title = (c: any) => cat.t(c.title, c.vars ?? {});
  // R178 / D-1699: the tab between Backlinks and Graph.
  const tabs = reg.PANEL_TABS as any[];
  const ids = tabs.map((t) => t.id);
  assert.ok(ids.indexOf('related') === ids.indexOf('backlinks') + 1 && ids.indexOf('graph') === ids.indexOf('related') + 1, `PANEL_TABS: backlinks, related, graph (D-1699): ${ids}`);
  const row = tabs.find((t) => t.id === 'related');
  assert.deepEqual([row?.name, row?.status?.built, row?.status?.due?.milestone, row?.reqs], ['related.tab', true, 'v1.0', ['FR-LNK-15', 'FR-NAV-05']], 'the related row (contract §3.2)');
  // R183: ids, titles, section, needsVault, no shortcut.
  const off = cmd.commands(ctx(NOTE)) as any[];
  const show = find(off, 'panel.related');
  assert.ok(show, 'panel.related is listed on a note');
  assert.deepEqual([show.title, title(show), show.section, show.needsVault, show.shortcut ?? null], ['cmd.related.show', 'Show related', 'view', true, null], 'panel.related: Show related');
  const tog = find(off, 'related.toggleLinked');
  assert.ok(tog, 'related.toggleLinked is listed on a note');
  assert.deepEqual([tog.title, title(tog), tog.section, tog.needsVault, tog.shortcut ?? null], ['cmd.related.showLinked', 'Related: Show linked notes', 'view', true, null], 'the switch off: Related: Show linked notes');
  const on = find(cmd.commands(ctx(NOTE, { showLinked: true })) as any[], 'related.toggleLinked');
  assert.deepEqual([on?.title, on ? title(on) : null], ['cmd.related.hideLinked', 'Related: Hide linked notes'], 'the switch on: Related: Hide linked notes');
  const sc = reg.SHORTCUTS as { keys: string; command: string }[];
  assert.deepEqual(sc.filter((s) => IDS.includes(s.command) || s.command.startsWith('related.')), [], 'R4: no shortcut for Related');
  assert.deepEqual(shortcutClashes(off), [], 'no shortcut is shared (FR-UX-03 AC-7)');
  for (const c of off) assert.ok(!RESERVED.includes(c.shortcut), `${c.id} uses no reserved shortcut`);
  // Routes: listed on note, daily (with and without a file) and new, whether or not the panel is open or on another tab.
  for (const [what, route] of [['note', NOTE], ['daily', DAILY], ['virtual daily', VIRTUAL], ['new', NEW]] as const) {
    for (const panel of [{ open: false, tab: 'backlinks' }, { open: true, tab: 'graph' }, { open: true, tab: 'related' }]) {
      const l = cmd.commands(ctx(route, { panel })) as any[];
      for (const id of IDS) assert.ok(find(l, id), `${what} (panel ${JSON.stringify(panel)}): ${id} is listed`);
    }
  }
  for (const [what, route] of NOT_LISTED) {
    const l = cmd.commands(ctx(route)) as any[];
    for (const id of IDS) assert.ok(!find(l, id), `${what}: ${id} is not listed`);
  }
  assert.ok(!find(cmd.commands(ctx(null, { vault: null })) as any[], 'panel.related'), 'no vault: not listed (needsVault)');
  // Running them.
  const calls: string[] = [];
  const c = ctx(NOTE, { calls });
  const l = cmd.commands(c) as any[];
  for (const id of IDS) await find(l, id)?.run(c);
  assert.deepEqual(calls, ['showRelated', 'toggleRelatedLinked'], 'each runs its action (§3.2)');
});
