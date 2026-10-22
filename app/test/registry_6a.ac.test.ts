// MS6 slice 6A, L1: the registry, shortcut and command changes of R75 (docs/acceptance/trash-media.md R75; FR-NAV-04
// AC-6: no `home` route and no `Go to Home`; FR-HIS-01 AC-1, AC-3, AC-9: `Move to trash` ⌘⌫, `Go to Trash`, `Restore`,
// `Delete permanently…`; FR-ATT-01 AC-3: `Add image or PDF…` ⇧⌘A, slash `Image` and `PDF` built; the R3 controls of 6A
// built; VERIFY_MILESTONE=MS6 lists nothing of 6A). Interface docs/contracts/ms6-trash-media.md §6.2 (registry), §8.
// The full R1…R4 comparison is app/test/registry.ac.test.ts against shell-tables.ts. Written from the ACs and the
// contract only (D-61). Modules load inside the tests (TS-I1).
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

const VAULT = { name: 'Zahrada', path: '/tmp/Zahrada', placeholders: 0 };
const TYPES = [
  ['page', 'Page', 'Pages'], ['task', 'Task', 'Tasks'], ['quick-note', 'Quick Note', 'Quick Notes'], ['daily-note', 'Daily Note', 'Daily Notes'],
  ['image', 'Image', 'Images'], ['pdf', 'PDF', 'PDFs'],
].map(([key, name, plural]) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system: true, invalid: false }));
const ctx = (route: Record<string, unknown> | null) => ({ vault: VAULT, types: TYPES, counts: { page: 3, task: 1, image: 1, pdf: 1 }, ...(route ? { route } : {}) });
const showDue = (d: { milestone: string; slice?: string }) => (d.slice ? `${d.milestone} (${d.slice})` : d.milestone);
const NOTE = { id: 'note/<path>', path: 'Tasks/Koupit semínka.md', type: 'task' };

test('fr_nav_04_ac6_routes_without_home_and_trash_built', async () => {
  const { reg } = await mods();
  const routes = reg.ROUTES as any[];
  assert.equal(routes.find((r) => r.id === 'home'), undefined, 'no home route (D-613; returns with FR-HOM-01 in v1.0)');
  const trash = routes.find((r) => r.id === 'trash');
  assert.ok(trash, 'route trash');
  assert.equal(trash.status.built, true, 'trash is built in 6A');
  assert.ok(!routes.some((r) => String(r.id).startsWith('media')), 'no media/<path> route (objects open as note/<path>, R76)');
  const ms6 = (reg.overdue('MS6') as string[]).join('\n');
  for (const re of [/^trash /m, /Move to trash/, /Add an image or PDF/, /FR-ATT-0[127]/, /FR-HIS-01/]) assert.ok(!re.test(ms6), `overdue('MS6') holds ${re}:\n${ms6}`);
});

test('fr_his_01_ac3_the_6a_controls_are_built', async () => {
  const { reg, cat } = await mods();
  const ctl = (reg.DISABLED_CONTROLS as any[]).map((c) => ({ label: c.label in cat.en ? cat.t(c.label) : c.label, req: c.req, due: showDue(c.due), where: String(c.where) }));
  const left = ctl.filter((c) => c.label === 'Move to trash' || c.label === 'Add an image or PDF' || c.label === 'file' || c.label === 'File' || ['FR-HIS-01', 'FR-ATT-01', 'FR-ATT-07'].includes(c.req));
  assert.deepEqual(left, [], 'task card, Inbox and capture Move to trash / Add an image or PDF and the File row are built (R75)');
  const slash = (reg.SLASH_ITEMS as any[]).filter((s) => s.group === 'media' && ['Image', 'PDF'].includes(cat.t(s.label)));
  assert.equal(slash.length, 2, 'slash Image and PDF are listed');
  for (const s of slash) assert.equal(s.status.built, true, `slash ${cat.t(s.label)} is built`);
});

test('fr_his_01_ac1_shortcuts_cmd_backspace_and_shift_cmd_a', async () => {
  const { reg } = await mods();
  const sc = reg.SHORTCUTS as { keys: string; command: string }[];
  assert.equal(sc.find((s) => s.keys === '⌘⌫')?.command, 'object.trash', '⌘⌫ Move to trash');
  assert.equal(sc.find((s) => s.keys === '⇧⌘A')?.command, 'media.add', '⇧⌘A Add image or PDF…');
  assert.ok(!sc.some((s) => s.command === 'goto.home'), 'no Go to Home shortcut');
});

test('fr_his_01_ac9_commands_are_registered_and_run', async () => {
  const { cat, cmd } = await mods();
  const title = (c: any) => cat.t(c.title, c.vars ?? {});
  const on = (route: Record<string, unknown>) => cmd.commands(ctx(route)) as any[];
  const find = (list: any[], t: string) => list.find((c) => title(c) === t);
  const note = on(NOTE);
  for (const t of ['Move to trash', 'Go to Trash', 'Add image or PDF…']) {
    const c = find(note, t);
    assert.ok(c, `${t} on a note page`);
    assert.ok(c.title in cat.en, `${t}: a catalog key`);
    assert.equal(c.due ?? null, null, `${t}: runs (not "Coming in")`);
    assert.equal(typeof c.run, 'function', `${t}: runs`);
  }
  assert.equal(find(note, 'Move to trash').id, 'object.trash', 'id object.trash');
  const onTrash = on({ id: 'trash' });
  for (const t of ['Restore', 'Delete permanently…']) assert.ok(find(onTrash, t), `${t} on the Trash page`);
  for (const route of [{ id: 'inbox' }, NOTE, { id: 'trash' }, { id: 'tasks' }]) {
    assert.ok(!on(route).some((c) => title(c) === 'Go to Home' || c.id === 'goto.home'), `no Go to Home on ${route.id}`);
  }
  const ids = note.map((c) => c.id);
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), [], 'command ids are unique');
});

test('fr_att_01_ac3_slash_image_and_pdf_are_enabled_in_the_editor', async () => {
  const ed = await load('../../packages/editor/src/index.ts');
  assert.ok(ed && typeof ed.slashItems === 'function', '@tegg/editor slashItems');
  const items = (ed!.slashItems() as any[]).filter((i) => i.group === 'media');
  const img = items.find((i) => i.label === 'Image');
  const pdf = items.find((i) => i.label === 'PDF');
  assert.ok(img && pdf, 'Image and PDF in the media group');
  assert.equal(img.due ?? null, null, 'Image is built (no Coming in MS6)');
  assert.equal(pdf.due ?? null, null, 'PDF is built');
});
