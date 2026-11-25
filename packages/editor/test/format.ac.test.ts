// Slice AND-3, L1 (Vitest): docs/acceptance/android-edit.md FR-EDT-02 AC-27 "The bar's block buttons write R6's forms"
// (L1 for the commands; AP-2069 → D-2504), through docs/contracts/android-edit.md §4.1 (`formatState`, exported from
// @tegg/editor) and §5.1 (`setBlock`, `toggleBulletList`, `toggleChecklistBlock`, `indent`, `outdent`, `insertTrigger`,
// each one undo step and `false` without effect).
// Red-test readings (reported): "Indent nests it as editor FR-EDT-02 AC-17 does" is checked against the editor's own Tab
// on the same document (the bytes of the nesting are AC-17's, not restated here); "every other block keeps its bytes"
// on Deset bloků, block 5.
// Written from the ACs and the contract only (D-61). The package loads inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { blocksRaw, body, caret, editorModule, editorNote, open, press, type, type TeggEditor } from './helpers';

type Cmds = TeggEditor['commands'] & {
  setBlock?(kind: 'paragraph' | 'heading', level?: 1 | 2 | 3): boolean;
  toggleBulletList?(): boolean;
  toggleChecklistBlock?(): boolean;
  indent?(): boolean;
  outdent?(): boolean;
  insertTrigger?(t: '[[' | '#'): boolean;
};
type FormatState = {
  block: string; level: number | null; bold: boolean; italic: boolean; link: boolean; canIndent: boolean; canOutdent: boolean; canUndo: boolean; canRedo: boolean; editable: boolean;
};

async function formatStateOf(): Promise<(s: unknown) => FormatState> {
  const m = (await editorModule()) as unknown as Record<string, unknown>;
  assert.equal(typeof m.formatState, 'function', '@tegg/editor exports formatState(state) (contract §4.1)');
  return m.formatState as (s: unknown) => FormatState;
}
function cmds(ed: TeggEditor): Required<Cmds> {
  const c = ed.commands as Cmds;
  for (const k of ['setBlock', 'toggleBulletList', 'toggleChecklistBlock', 'indent', 'outdent', 'insertTrigger'] as const) {
    assert.equal(typeof c[k], 'function', `TeggEditor.commands.${k} exists (contract §5.1)`);
  }
  return c as Required<Cmds>;
}
const bodyOf = async (ed: TeggEditor) => body((await ed.save()) ?? '');

test('fr_edt_02_ac27_block_commands', async () => {
  const fs = await formatStateOf();
  // Heading 2, then text; then back to a paragraph
  let ed = await open(editorNote('Prázdná'));
  let c = cmds(ed);
  caret(ed, 0, 0);
  assert.equal(fs(ed.view.state).canUndo, false, 'canUndo is false with an empty history');
  assert.equal(c.setBlock('heading', 2), true, 'setBlock(heading, 2) applies');
  type(ed, 'Řádek');
  assert.deepEqual([fs(ed.view.state).block, fs(ed.view.state).level], ['heading', 2], 'formatState: heading, level 2');
  assert.equal(await bodyOf(ed), '## Řádek\n', 'saves `## Řádek`');
  assert.equal(c.setBlock('paragraph'), true, 'setBlock(paragraph) applies');
  assert.equal(await bodyOf(ed), 'Řádek\n', 'the paragraph `Řádek` again');
  assert.equal(c.undo(), true, 'undo');
  assert.equal(await bodyOf(ed), '## Řádek\n', 'setBlock is one undo step');
  ed.destroy();

  // Bulleted list, Enter, second item; Indent / Outdent; the button pressed in an item makes it a paragraph
  ed = await open(editorNote('Prázdná'));
  c = cmds(ed);
  caret(ed, 0, 0);
  assert.equal(fs(ed.view.state).canIndent, false, 'canIndent is false in a paragraph');
  assert.equal(fs(ed.view.state).canOutdent, false, 'canOutdent is false in a paragraph');
  assert.equal(c.indent(), false, 'indent() in a paragraph does nothing');
  assert.equal(c.toggleBulletList(), true, 'toggleBulletList applies');
  type(ed, 'jedna');
  assert.equal(fs(ed.view.state).block, 'bulletList', 'formatState: bulletList');
  assert.equal(fs(ed.view.state).canIndent, false, 'canIndent is false on a list\'s first item');
  press(ed, 'Enter');
  type(ed, 'dvě');
  const flat = '- jedna\n- dvě\n';
  assert.equal(await bodyOf(ed), flat, 'saves `- jedna` / `- dvě`');
  assert.equal(fs(ed.view.state).canIndent, true, 'canIndent on the second item');
  assert.equal(c.indent(), true, 'indent() on dvě applies');
  const nested = await bodyOf(ed);
  const tab = await open(editorNote('Prázdná'));
  caret(tab, 0, 0);
  type(tab, '- jedna');
  press(tab, 'Enter');
  type(tab, 'dvě');
  press(tab, 'Tab');
  assert.equal(nested, await bodyOf(tab), 'Indent nests dvě as the editor\'s Tab does (editor FR-EDT-02 AC-17)');
  assert.notEqual(nested, flat, 'and the item is nested');
  tab.destroy();
  assert.equal(fs(ed.view.state).canOutdent, true, 'canOutdent in a nested item');
  assert.equal(c.outdent(), true, 'outdent() applies');
  assert.equal(await bodyOf(ed), flat, 'Outdent un-nests it');
  assert.equal(c.undo(), true, 'undo the outdent');
  assert.equal(await bodyOf(ed), nested, 'outdent is one undo step');
  assert.equal(c.redo(), true, 'redo');
  assert.equal(c.toggleBulletList(), true, 'toggleBulletList in an item');
  const lifted = (await blocksRaw((await ed.save()) ?? '')).map((x) => x.trim());
  assert.deepEqual(lifted, ['- jedna', 'dvě'], 'the item becomes the paragraph `dvě` after the list');
  ed.destroy();

  // Checklist: an item, never a Task; again: a paragraph
  ed = await open(editorNote('Prázdná'));
  c = cmds(ed);
  caret(ed, 0, 0);
  assert.equal(c.toggleChecklistBlock(), true, 'toggleChecklistBlock applies');
  type(ed, 'úkol');
  assert.equal(fs(ed.view.state).block, 'checklist', 'formatState: checklist');
  assert.equal(await bodyOf(ed), '- [ ] úkol\n', 'saves `- [ ] úkol`');
  assert.equal(c.toggleChecklistBlock(), true, 'again');
  assert.equal(await bodyOf(ed), 'úkol\n', 'a paragraph again');
  ed.destroy();

  // insertTrigger: `[[` as typed; `#` with a space before it after a non-space
  ed = await open(editorNote('Prázdná'));
  c = cmds(ed);
  caret(ed, 0, 0);
  type(ed, 'Text');
  assert.equal(c.insertTrigger('#'), true, 'insertTrigger(#) applies');
  assert.equal(await bodyOf(ed), 'Text #\n', 'a space is inserted before # after a non-space');
  caret(ed, 0, 'end');
  type(ed, ' a');
  assert.equal(c.insertTrigger('[['), true, 'insertTrigger([[) applies');
  const before = ed.view.state.doc.textBetween(0, ed.view.state.selection.from, '\n');
  assert.ok(before.endsWith('Text # a[['), `\`[[\` is inserted as typed, before the caret (the suggestion plugin opens on it): ${JSON.stringify(before)}`);
  ed.destroy();
});

test('fr_edt_02_ac27_block_commands_keep_other_blocks', async () => {
  const fs = await formatStateOf();
  const orig = editorNote('Deset bloků');
  const ed = await open(orig);
  const c = cmds(ed);
  caret(ed, 4, 0); // `Pátý blok, který test upraví.`
  assert.equal(fs(ed.view.state).block, 'paragraph', 'formatState: paragraph in block 5');
  assert.equal(fs(ed.view.state).editable, true, 'block 5 is editable');
  assert.equal(c.setBlock('heading', 3), true, 'setBlock(heading, 3) on block 5');
  const out = await ed.save();
  assert.ok(out, 'saved');
  const a = await blocksRaw(orig);
  const b = await blocksRaw(out!);
  assert.equal(b.length, a.length, 'the same number of blocks');
  assert.deepEqual(b.filter((_, i) => i !== 4), a.filter((_, i) => i !== 4), 'every other block keeps its bytes');
  assert.equal(b[4].trim(), '### Pátý blok, který test upraví.', 'block 5 becomes `### …` (R6)');
  // a quote block is `other`, where the list buttons don't nest
  caret(ed, 5, 0);
  assert.equal(fs(ed.view.state).block, 'other', 'formatState: a quote is `other`');
  ed.destroy();
});
