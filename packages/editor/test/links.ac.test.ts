// @tegg/editor pure helpers (L1): the wikilink text inserted for a chosen object (FR-EDT-06 AC-3, D-184, FR-LNK-14,
// FR-FMT-12 AC-2) and the slash-menu items (R6, FR-EDT-03 AC-5). docs/acceptance/editor.md R6;
// docs/contracts/ms3-shell.md §13.3 (`linkText`, `slashItems`).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { editorModule } from './helpers';

const FROM = 'Pages/Deset bloků.md';

test('fr_edt_06_ac3_link_text_for_each_chosen_object', async () => {
  const { linkText } = await editorModule();
  const cases: [Parameters<typeof linkText>[0], string, string][] = [
    [{ path: 'Pages/Cíl.md', title: 'Cíl', fromPath: FROM, stemResolves: true }, 'Cíl', '(a) Cíl'],
    [{ path: 'Pages/Cíl.md', title: 'Cíl', viaAlias: 'Reading list', fromPath: FROM, stemResolves: true }, 'Cíl|Reading list', '(b) alias'],
    [{ path: 'Pages/C tips.md', title: 'C# tips', fromPath: FROM, stemResolves: true }, 'C tips|C# tips', '(c) title ≠ stem'],
    [{ path: 'Pages/Senior Product Manager (2).md', title: 'Senior Product Manager', fromPath: FROM, stemResolves: true }, 'Senior Product Manager (2)|Senior Product Manager', '(d) SPM 2'],
    [{ path: 'Pages/Dvojník.md', title: 'Dvojník', fromPath: FROM, stemResolves: true }, 'Dvojník', '(e) same-folder Dvojník'],
    [{ path: 'Quick Notes/Dvojník.md', title: 'Dvojník', fromPath: FROM, stemResolves: false }, 'Quick Notes/Dvojník|Dvojník', '(e) other-folder Dvojník'],
    [{ path: 'Pages/Cíl.md', title: 'Cíl', fromPath: FROM, stemResolves: true }, 'Cíl', 'NFD file name → NFC target'],
  ];
  for (const [c, want, what] of cases) {
    const got = linkText(c);
    assert.equal(got, want, what);
    assert.equal(got, got.normalize('NFC'), `${what}: NFC`);
  }
});

const R6: [string, string, string | null][] = [
  ['objects', 'Task', null], ['objects', 'Turn into object…', null], ['objects', 'Embed object', null],
  ['blocks', 'Text', null], ['blocks', 'Heading 1', null], ['blocks', 'Heading 2', null], ['blocks', 'Heading 3', null],
  ['blocks', 'Bulleted list', null], ['blocks', 'Numbered list', null], ['blocks', 'Checklist', null], ['blocks', 'Quote', null],
  ['blocks', 'Callout', null], ['blocks', 'Code block', null], ['blocks', 'Divider', null], ['blocks', 'Table', null],
  ['media', 'Image', null], ['media', 'PDF', null], // built in 6A (trash-media.md R75)
  ['advanced', 'Block embed', 'v1.0'], ['advanced', 'Query', null], ['advanced', 'Mindmap', null], // Mindmap built in slice MM (R94, D-685); Query in slice Q (D-1447)
];

test('fr_edt_03_ac5_slash_items_are_r6_with_milestones', async () => {
  const { slashItems } = await editorModule();
  const items = slashItems();
  assert.equal(items.length, R6.length, 'R6 has 20 items');
  assert.deepEqual(items.map((i) => i.group), R6.map((r) => r[0]), 'groups in R6 order, Objects first');
  assert.deepEqual(items.map((i) => i.due?.milestone ?? null), R6.map((r) => r[2]), 'disabled items carry their milestone');
  const ids = items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});
