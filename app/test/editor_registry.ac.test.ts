// MS3 slice 3C, L1: the slash-menu registry equals R6 and joins the milestone check (FR-EDT-03 AC-5, FR-UX-02 AC-13),
// and the editor commands of R8 are registered (FR-UX-03 AC-13, with AC-7's integrity rules over R4 + R8).
// Written from docs/acceptance/editor.md (R6, R8) and docs/contracts/ms3-shell.md §13.4 only (D-61). Kept apart from
// registry.ac.test.ts so the 3A AC test file stays unchanged (TS-I3). Modules load dynamically (TS-I1).
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { R4, RESERVED, showDue, expandReqs, type Due } from './shell-tables';

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
beforeEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const d = (milestone: string): Due => ({ milestone });
/** R6 of editor.md: group, catalog label, milestone (null = built), requirement IDs. */
export const R6: [string, string, Due | null, string][] = [
  ['objects', 'Task', null, 'FR-TSK-01, FR-CNV-01'], // built in 5A-2 (R53, D-499)
  ['objects', 'Turn into object…', null, 'FR-CNV-01'],
  ['objects', 'Embed object', null, 'FR-EMB-01'], // built in 4F (R32, D-431)
  ['blocks', 'Text', null, 'FR-EDT-02'],
  ['blocks', 'Heading 1', null, 'FR-EDT-02'],
  ['blocks', 'Heading 2', null, 'FR-EDT-02'],
  ['blocks', 'Heading 3', null, 'FR-EDT-02'],
  ['blocks', 'Bulleted list', null, 'FR-EDT-02'],
  ['blocks', 'Numbered list', null, 'FR-EDT-02'],
  ['blocks', 'Checklist', null, 'FR-EDT-02, FR-TSK-11'],
  ['blocks', 'Quote', null, 'FR-EDT-02'],
  ['blocks', 'Callout', null, 'FR-EDT-02'],
  ['blocks', 'Code block', null, 'FR-EDT-02'],
  ['blocks', 'Divider', null, 'FR-EDT-02'],
  ['blocks', 'Table', null, 'FR-EDT-02'],
  ['media', 'Image', d('MS6'), 'FR-ATT-01, FR-ATT-03'],
  ['media', 'PDF', d('MS6'), 'FR-ATT-02'],
  ['advanced', 'Block embed', d('v1.0'), 'FR-EMB-01, FR-LNK-06'], // D-426, D-431
  ['advanced', 'Query', d('v1.0'), 'FR-QRY-06, FR-FMT-06'],
  ['advanced', 'Mindmap', d('v1.0'), 'FR-MMP-01'],
];

/** R8: shortcut (⌃⌥⇧⌘ order), command title prefix (null: title not fixed by the AC, see the report). */
export const R8: [string, string | null][] = [
  ['⌘Z', 'Undo'], ['⇧⌘Z', 'Redo'], ['⌘B', 'Bold'], ['⌘I', 'Italic'], ['⇧⌘S', 'Strikethrough'], ['⌘E', 'Inline code'],
  ['⇧⌘H', 'Highlight'], ['⇧⌘K', 'Insert link'], ['⇧⌘↑', 'Move block up'], ['⇧⌘↓', 'Move block down'],
  ['⌘/', 'Open block menu'], ['Esc', 'Select block'], ['⌘↩', null], ['⇧⌘V', 'Paste as plain text'], ['⌘S', 'Save now'],
];

test('fr_edt_03_ac5_slash_registry_matches_r6_and_is_overdue_checked', async () => {
  const { reg, cat } = await mods();
  type Item = { id: string; group: string; label: string; status?: { built: boolean; due?: Due }; due?: Due; reqs: string[] | string };
  const items = reg.SLASH_ITEMS as Item[] | undefined;
  assert.ok(Array.isArray(items), 'registry.ts exports SLASH_ITEMS (ms3-shell §13.4)');
  assert.deepEqual(items!.map((i) => i.group), R6.map((r) => r[0]), 'groups in R6 order');
  assert.deepEqual(items!.map((i) => (i.label in cat.en ? cat.t(i.label) : i.label)), R6.map((r) => r[1]), 'labels in R6 order (catalog)');
  for (const [k, row] of R6.entries()) {
    const item: Item = items![k];
    const due: Due | null = item.due ?? item.status?.due ?? null;
    const built: boolean = item.status ? item.status.built : !item.due;
    assert.equal(built, row[2] === null, `${row[1]}: built`);
    if (row[2]) assert.equal(due ? showDue(due) : null, showDue(row[2]), `${row[1]}: milestone`);
    assert.deepEqual(expandReqs(item.reqs), expandReqs(row[3]), `${row[1]}: requirement IDs`);
  }
  const listed = (m: string, label: string) => (reg.overdue(m) as string[]).join('\n').includes(label);
  for (const [, label, due] of R6) {
    if (!due) continue;
    assert.equal(listed('MS3', label), false, `${label} isn't overdue at MS3`);
    assert.equal(listed(due.milestone, label), true, `${label} is overdue at ${due.milestone} (FR-UX-02 AC-13)`);
  }
});

const NOTE_CTX = {
  vault: { name: 'Editor', path: '/tmp/Editor', placeholders: 0 },
  types: [{ key: 'page', name: 'Page', plural: 'Pages', folder: 'Pages', icon: 'file-text', color: 'gray', system: true, invalid: false }],
  counts: { page: 1 },
  route: { id: 'note/<path>', path: 'Pages/Deset bloků.md' },
};

test('fr_ux_03_ac13_editor_commands_registered_with_r8_shortcuts', async () => {
  const { reg, cat, cmd } = await mods();
  const list = cmd.commands(NOTE_CTX) as { id: string; title: string; shortcut?: string; due?: unknown; section?: string; needsVault?: boolean }[];
  const edit = list.filter((c) => String(c.id).startsWith('edit.'));
  assert.ok(edit.length >= R8.length, `edit.* commands registered: ${edit.map((c) => c.id).join(', ')}`);
  for (const id of ['edit.undo', 'edit.bold', 'edit.moveBlockUp', 'edit.blockMenu', 'edit.pastePlain', 'edit.saveNow']) {
    assert.ok(edit.some((c) => c.id === id), `${id} is registered (ms3-shell §13.4)`);
  }
  for (const [keys, title] of R8) {
    const c = edit.find((x) => x.shortcut === keys);
    assert.ok(c, `${keys}: an edit.* command with this shortcut`);
    assert.equal(c!.section, 'edit', `${keys}: section edit`);
    assert.equal(c!.needsVault, true, `${keys}: needsVault`);
    assert.ok(c!.title in cat.en, `${keys}: title is a catalog key`);
    if (title) assert.ok(String(cat.t(c!.title)).startsWith(title), `${keys}: "${cat.t(c!.title)}" should be "${title}"`);
  }
  // FR-UX-03 AC-7 with R8 added to R4: no shared enabled shortcut, none reserved by macOS.
  const enabled = list.filter((c) => !c.due && c.shortcut).map((c) => c.shortcut!);
  assert.deepEqual(enabled.filter((k, i) => enabled.indexOf(k) !== i), [], 'two enabled commands share a shortcut');
  for (const [keys] of R8) {
    assert.ok(!RESERVED.includes(keys), `${keys} is reserved by macOS`);
    // R4 now holds the rows of R8 (editor.md): no R8 key may be bound to a non-editor command.
    const bound = (reg.SHORTCUTS as { keys: string; command: string }[]).filter((x) => x.keys === keys);
    assert.ok(bound.every((x) => x.command.startsWith('edit.')), `${keys} collides with an R4 command`);
    void R4;
  }
  const shortcuts = (reg.SHORTCUTS as { keys: string }[]).map((s) => s.keys);
  for (const [keys] of R8) assert.ok(shortcuts.includes(keys), `SHORTCUTS lists ${keys} (R4 gets the rows of R8)`);
});
