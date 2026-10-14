// MS3 slice 3A, L1: the registries equal tables R1–R4 (FR-UX-02 AC-11, AC-13; FR-UX-03 AC-3 static part, AC-7).
// Written from docs/acceptance/app-shell.md and docs/contracts/ms3-shell.md §3.1–§3.3 only (D-61). Modules are
// imported dynamically inside each test so a missing module fails an assertion, not the file (TS-I1).
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { MILESTONE_ORDER, R1, R2, R3, R4, RESERVED, STATIC_COMMANDS, expandReqs, showDue, type Due } from './shell-tables';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function mods() {
  const reg = await load('../ui/src/shell/registry.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(reg, 'ui/src/shell/registry.ts is missing');
  assert.ok(cat, 'ui/src/i18n/catalog.ts is missing');
  assert.ok(cmd, 'ui/src/shell/commands.ts is missing');
  return { reg, cat, cmd };
}

beforeEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const dueOf = (s: { built: boolean; due?: Due }) => (s.due ? showDue(s.due) : null);

/** A command context for the fixture vault (ms3-shell §3.3 doesn't define ShellContext; see the report). */
const FIXTURE_TYPES = [
  ['page', 'Page', 'Pages', true], ['task', 'Task', 'Tasks', true], ['quick-note', 'Quick Note', 'Quick Notes', true],
  ['daily-note', 'Daily Note', 'Daily Notes', true], ['tag', 'Tag', 'Tags', true], ['image', 'Image', 'Images', true],
  ['pdf', 'PDF', 'PDFs', true], ['cesta', 'Cesta', 'Cesty', false], ['čajovna', 'Čajovna', 'Čajovny', false],
  ['schůzka', 'Schůzka', 'Schůzky', false],
].map(([key, name, plural, system]) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system, invalid: false }));
const CTX = {
  vault: { name: 'Trezor', path: '/tmp/Trezor', placeholders: 0 },
  types: FIXTURE_TYPES,
  counts: { page: 2, 'quick-note': 2, task: 1, 'schůzka': 1, recept: 1 },
};

test('fr_ux_02_ac11_route_registry_matches_r1', async () => {
  const { reg, cat } = await mods();
  const routes = reg.ROUTES as any[];
  assert.deepEqual(routes.map((r) => r.id).sort(), R1.map((r) => r.id).sort(), 'route ids');
  for (const row of R1) {
    const r = routes.find((x) => x.id === row.id)!;
    assert.equal(r.status.built, row.built, `${row.id}: built`);
    if (!row.built || r.status.due) assert.equal(dueOf(r.status), showDue(row.due), `${row.id}: milestone`);
    assert.deepEqual(expandReqs(r.reqs), expandReqs(row.reqs), `${row.id}: requirement IDs`);
    assert.equal(r.design, row.design, `${row.id}: design board`);
    assert.ok(r.name in cat.en, `${row.id}: name ${r.name} is not a catalog key`);
    assert.ok(r.purpose in cat.en, `${row.id}: purpose ${r.purpose} is not a catalog key`);
    assert.notEqual(cat.t(r.purpose).trim(), '', `${row.id}: empty purpose`);
  }
});

test('fr_ux_02_ac11_panel_tabs_and_disabled_controls_match_r2_r3', async () => {
  const { reg, cat } = await mods();
  const tabs = reg.PANEL_TABS as any[];
  assert.deepEqual(tabs.map((t) => t.id), R2.map((t) => t.id), 'R2 tabs in order');
  for (const row of R2) {
    const tab = tabs.find((t) => t.id === row.id)!;
    assert.equal(cat.t(tab.name), row.tab, `${row.id}: name`);
    assert.equal(tab.status.built, row.built, `${row.id}: built`);
    assert.equal(dueOf(tab.status), showDue(row.due), `${row.id}: milestone`);
    assert.deepEqual(expandReqs(tab.reqs), expandReqs(row.reqs), `${row.id}: requirement IDs`);
  }
  const controls = (reg.DISABLED_CONTROLS as any[]).map((c) => ({ label: c.label in cat.en ? cat.t(c.label) : c.label, due: showDue(c.due), req: c.req }));
  const expected = R3.map((c) => ({ label: c.label, due: showDue(c.due), req: c.req }));
  const norm = (xs: { label: string; due: string; req: string }[]) =>
    xs.map((x) => ({ ...x, label: /^New (?!type$|tab$|object$)/.test(x.label) ? 'New <Type>' : x.label })).sort((a, b) => a.label.localeCompare(b.label));
  assert.deepEqual(norm(controls), norm(expected), 'R3 disabled controls');
});

test('fr_ux_02_ac13_placeholders_cannot_outlive_their_milestone', async () => {
  const { reg } = await mods();
  const all = [...(reg.ROUTES as any[]), ...(reg.PANEL_TABS as any[])];
  assert.equal((reg.ROUTES as any[]).length, R1.length, 'route registry is not filled');
  assert.equal((reg.PANEL_TABS as any[]).length, R2.length, 'panel registry is not filled');
  assert.equal((reg.DISABLED_CONTROLS as any[]).length > 0, true, 'disabled-control list is empty');
  for (const e of all) {
    if (!e.status.built) assert.ok(MILESTONE_ORDER.includes(e.status.due?.milestone), `${e.id}: TBD without a milestone`);
    if (!e.status.built) assert.ok(Array.isArray(e.reqs) && e.reqs.length > 0, `${e.id}: TBD without requirement IDs`);
  }
  for (const c of reg.DISABLED_CONTROLS as any[]) {
    assert.ok(MILESTONE_ORDER.includes(c.due?.milestone), `${c.label}: no milestone`);
    assert.match(String(c.req), /^[A-Z]+-[A-Z]+-\d+$/, `${c.label}: no requirement ID`);
  }
  // overdue(): every TBD route/tab and disabled control due at or before the milestone, "MS3 (3D)" counting as MS3.
  assert.deepEqual(reg.overdue('MS2'), [], 'nothing is TBD at MS2');
  const ms3 = (reg.overdue('MS3') as string[]).join('\n');
  for (const id of ['settings/date-time']) { // conflicts and Edit: done in 3C; type-settings, New type, Starter vault: 3D (types.md R1, R3)
    assert.ok(ms3.includes(id), `overdue('MS3') must list ${id}:\n${ms3}`);
  }
  for (const id of ['inbox', 'today', 'pinned', 'Type picker', 'New tab']) {
    assert.ok(!ms3.includes(id), `overdue('MS3') must not list ${id} (due later):\n${ms3}`);
  }
  const tbd = R1.filter((r) => !r.built).length + R2.filter((r) => !r.built).length;
  assert.ok((reg.overdue('v1.x') as string[]).length >= tbd + 1, 'overdue(v1.x) lists every TBD entry and control');
  const m = process.env.VERIFY_MILESTONE;
  if (m) assert.deepEqual(reg.overdue(m), [], `entries still TBD or disabled at ${m} (AP-68)`);
});

test('fr_ux_03_ac3_navigation_and_static_commands_are_registered', async () => {
  const { cat, cmd } = await mods();
  const list = cmd.commands(CTX) as any[];
  const titles = list.map((c) => cat.t(c.title, c.vars ?? {}));
  for (const row of R1) if (row.goto) assert.ok(titles.includes(row.goto), `missing command "${row.goto}"; have: ${titles.join(' | ')}`);
  for (const t of STATIC_COMMANDS) assert.ok(titles.includes(t), `missing command "${t}"`);
  const typeCmds = list.filter((c) => String(c.id).startsWith('goto.type:')).map((c) => String(c.id).slice('goto.type:'.length)).sort();
  assert.deepEqual(typeCmds, ['cesta', 'daily-note', 'image', 'page', 'pdf', 'quick-note', 'recept', 'schůzka', 'task', 'čajovna'].sort(), 'one Go to type command per Types entry (no Tag)');
});

test('fr_ux_03_ac7_registry_integrity', async () => {
  const { reg, cat, cmd } = await mods();
  const list = cmd.commands(CTX) as any[];
  assert.ok(list.length > 0, 'command registry is empty');
  const ids = list.map((c) => c.id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'duplicate command ids');
  const enabled = list.filter((c) => !c.due && c.shortcut);
  const keys = enabled.map((c) => c.shortcut);
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [], 'two enabled commands share a shortcut');
  for (const c of list) assert.ok(c.title in cat.en, `title of ${c.id} is not a catalog key: ${c.title}`);
  for (const c of list) assert.ok(!RESERVED.includes(c.shortcut), `${c.id} uses the reserved ${c.shortcut}`);
  const shortcuts = reg.SHORTCUTS as { keys: string; command: string }[];
  assert.deepEqual(shortcuts.map((s) => s.keys).sort(), R4.map((r) => r.keys).sort(), 'shortcut table = R4 (keys in ⌃⌥⇧⌘ order)');
  for (const row of R4) {
    const s = shortcuts.find((x) => x.keys === row.keys)!;
    const c = list.find((x) => x.id === s.command);
    assert.ok(c, `${row.keys}: command ${s.command} is not registered`);
    assert.ok(cat.t(c.title).startsWith(row.command), `${row.keys}: bound to "${cat.t(c.title)}", R4 says "${row.command}"`);
    if (row.command !== 'Open command palette') assert.equal(c.shortcut, row.keys, `${row.keys}: command's shortcut`);
    assert.equal(!c.due, row.enabled, `${row.keys}: enabled state`);
  }
});
