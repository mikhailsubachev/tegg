// MS5 slice 5B, L1: the registry, shortcut and command changes of R62 (docs/acceptance/inbox.md R62; docs/contracts/
// ms5-capture.md §10). FR-NAV-04 AC-5 (routes, tabs, controls and shortcuts equal app-shell R1…R4 with R62; nothing of
// 5B is still TBD or disabled at MS5), FR-NAV-02 AC-1 (every 5B command is registered, has a catalog title and runs).
// The full R1…R4 comparison is app/test/registry.ac.test.ts against shell-tables.ts (updated to R62 in this commit,
// TS-I3). Written from the ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
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
async function mods() {
  const reg = await load('../ui/src/shell/registry.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(reg && cat && cmd, 'shell registry, catalog and commands modules load');
  return { reg: reg!, cat: cat!, cmd: cmd! };
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const VAULT = { name: 'Doručené', path: '/tmp/Doručené', placeholders: 0 };
const TYPES = [
  ['page', 'Page', 'Pages', true], ['task', 'Task', 'Tasks', true], ['quick-note', 'Quick Note', 'Quick Notes', true], ['daily-note', 'Daily Note', 'Daily Notes', true],
  ['nápad', 'Nápad', 'Nápady', false], ['schůzka', 'Schůzka', 'Schůzky', false],
].map(([key, name, plural, system]) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system, invalid: false }));
const ctx = (route: Record<string, unknown> | null) => ({ vault: VAULT, types: TYPES, counts: { 'quick-note': 9, task: 1 }, ...(route ? { route } : {}) });
const showDue = (d: { milestone: string; slice?: string }) => (d.slice ? `${d.milestone} (${d.slice})` : d.milestone);

// ------------------------------------------------------------------------------------------------ FR-NAV-04 AC-5

test('fr_nav_04_ac5_routes_follow_r62', async () => {
  const { reg } = await mods();
  const routes = reg.ROUTES as any[];
  const r = (id: string) => routes.find((x) => x.id === id);
  for (const id of ['inbox', 'settings/vault', 'settings/menu-bar', 'settings/shortcuts', 'settings/date-time']) {
    assert.ok(r(id), `route ${id}`);
    assert.equal(r(id).status.built, true, `${id} is built in 5B (R62)`);
  }
  assert.equal(r('inbox').design, 'Inbox', 'inbox: the Inbox board');
  assert.equal(r('capture'), undefined, 'capture is a window, not a route (AP-491)');
  // 6A (trash-media.md R75, D-613): `home` is removed; `pinned` stays TBD.
  assert.equal(r('home'), undefined, 'home is removed in 6A (D-613)');
  for (const id of ['pinned']) {
    assert.equal(r(id)?.status.built, false, `${id} stays TBD`);
    assert.equal(showDue(r(id).status.due), 'v1.0', `${id}: Coming in v1.0 (D-515, D-376)`);
  }
  const outline = (reg.PANEL_TABS as any[]).find((t) => t.id === 'outline');
  assert.equal(showDue(outline.status.due), 'v1.0', 'Outline tab: Coming in v1.0 (D-376)');
  // FR-UX-02 AC-13 with VERIFY_MILESTONE=MS5: no 5B entry (R62) and none of AP-493's MS3 (3E) entries is overdue.
  const ms5 = (reg.overdue('MS5') as string[]).join('\n');
  for (const re of [/^inbox /m, /^home /m, /^pinned /m, /^capture /m, /^settings\/(vault|menu-bar|shortcuts|date-time) /m, /^outline /m, /\(MS3 \(3E\)\)/, /\(MS5\)/]) {
    assert.ok(!re.test(ms5), `overdue('MS5') holds ${re}:\n${ms5}`);
  }
});

test('fr_nav_04_ac5_controls_and_shortcuts_follow_r62', async () => {
  const { reg, cat } = await mods();
  const ctl = (reg.DISABLED_CONTROLS as any[]).map((c) => ({ label: c.label in cat.en ? cat.t(c.label) : c.label, where: String(c.where), due: showDue(c.due), req: c.req }));
  assert.ok(!(reg.DISABLED_CONTROLS as any[]).some((c) => c.label === 'ctl.typePickerLink'), 'ctl.typePickerLink is removed (FR-VLT-05)');
  const has = (label: string, req: string, due: string, where: RegExp) => ctl.some((c) => c.label === label && c.req === req && c.due === due && where.test(c.where));
  // 6A (trash-media.md R75): the Inbox's Move to trash and the capture drop zone are built.
  assert.ok(!ctl.some((c) => c.label === 'Move to trash' && /inbox/i.test(c.where)), 'Move to trash in the Inbox is built (6A)');
  assert.ok(!ctl.some((c) => c.label === 'Add an image or PDF'), 'Add an image or PDF in the capture window is built (6A)');
  assert.ok(has('Change…', 'FR-SET-04', 'v1.0', /shortcuts/i), 'Change… on Settings: Shortcuts (v1.0)');
  for (const l of ['Font', 'Font size', 'Editor width', 'Accent color']) assert.ok(ctl.some((c) => c.label === l && c.due === 'v1.0'), `${l}: v1.0 (D-565)`);
  const sc = (reg.SHORTCUTS as any[]).find((s) => s.keys === '⇧⌘I');
  assert.equal(sc?.command, 'goto.inbox', '⇧⌘I Go to Inbox');
  const keys = (reg.SHORTCUTS as any[]).map((s) => String(s.keys));
  for (const k of ['⌃⌥Space', '⌃⌥T', '⌃⌥ Space']) assert.ok(!keys.includes(k), `${k} is global, not a main-window shortcut (R62 R4)`);
});

// ------------------------------------------------------------------------------------------------ FR-NAV-02 AC-1

test('fr_nav_02_ac1_every_5b_command_is_registered_and_runs', async () => {
  const { cat, cmd } = await mods();
  const want = [
    'Quick Capture', 'Capture a task', 'Go to Inbox', 'Mark reviewed', 'Mark unreviewed', 'Convert to…', 'Append to…', 'Link to…',
    'Add tags…', 'Select all items', 'Clear selection', 'Mark all reviewed', 'Show all in Inbox', 'Go to Settings: Vault',
    'Go to Settings: Menu bar and startup', 'Go to Settings: Shortcuts',
  ];
  const onInbox = cmd.commands(ctx({ id: 'inbox' })) as any[];
  const title = (c: any) => cat.t(c.title, c.vars ?? {});
  const missing: string[] = [];
  for (const w of want) {
    const c = onInbox.find((x) => title(x) === w);
    if (!c) { missing.push(w); continue; }
    assert.ok(c.title in cat.en, `${w}: title is a catalog key`);
    assert.equal(c.needsVault, true, `${w}: needsVault (R62)`);
    assert.equal(c.due ?? null, null, `${w}: runs (not "Coming in")`);
    assert.equal(typeof c.run, 'function', `${w}: runs`);
  }
  assert.deepEqual(missing, [], 'R62 palette commands on inbox');
  const ids = onInbox.map((c) => c.id);
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), [], 'command ids are unique');
  // AP-490: Mark reviewed / unreviewed on a note route whose object shows the Review row.
  const onNote = (cmd.commands(ctx({ id: 'note/<path>', path: 'Quick Notes/Koupit mléko.md', type: 'quick-note' })) as any[]).map(title);
  assert.ok(onNote.includes('Mark reviewed') || onNote.includes('Mark unreviewed'), 'a review command on a Quick Note');
  // `Change type…` also on an unwritten draft (FR-VLT-05 AC-4).
  const onDraft = (cmd.commands(ctx({ id: 'new/<type>', param: 'quick-note', type: 'quick-note' })) as any[]).map(title);
  assert.ok(onDraft.includes('Change type…'), 'Change type… on new/<type>');
  for (const c of [...onInbox]) assert.ok(c.title in cat.en, `${c.id}: catalog title`);
});
