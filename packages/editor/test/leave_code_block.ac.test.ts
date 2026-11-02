// Leaving a code block by keyboard (L1, real ProseMirror): FR-EDT-02 AC-23 (D-1356, AP-1214; v0.113 feedback).
// docs/acceptance/editor.md FR-EDT-02 AC-23, FR-EDT-01 AC-3 (an empty paragraph is never written). The note is the
// AC-14 note: a copy of Prázdná whose body is only the code block ```js / let a = 1 / ```. Keys go through the view's
// keymaps (`press`), as a user's would; ⌘ is sent as `metaKey` (macOS, R8). Written from the ACs only (D-61).
// ↓ at the end of the last block (TipTap's `exitOnArrowDown`) is L5 only: in jsdom the gap-cursor keymap needs layout.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { body, caret, editorNote, frontWithoutModified, open, press, type, type TeggEditor } from './helpers';

const CODE = '```js\nlet a = 1\n```\n';
/** The AC-14 note: Prázdná (frontmatter only) followed by the code block. */
const NOTE = () => editorNote('Prázdná') + CODE;

/** Top-level node names and texts of the editor document. */
function blocks(ed: TeggEditor): { name: string; text: string }[] {
  const doc = ed.view.state.doc;
  const out: { name: string; text: string }[] = [];
  for (let i = 0; i < doc.childCount; i++) out.push({ name: doc.child(i).type.name, text: doc.child(i).textContent });
  return out;
}
/** Index of the top-level node holding the caret, and that node's name. */
function caretBlock(ed: TeggEditor): { index: number; name: string } {
  const $from = ed.view.state.selection.$from;
  assert.ok($from.depth >= 1, 'the caret is inside a block');
  return { index: $from.index(0), name: $from.node(1).type.name };
}
function mustBeInCode(ed: TeggEditor, code: string, what: string) {
  const b = blocks(ed);
  assert.equal(b.length, 1, `${what}: still one block (the code block): ${JSON.stringify(b)}`);
  assert.equal(b[0].text, code, `${what}: the code text`);
  assert.equal(caretBlock(ed).index, 0, `${what}: the caret stays in the code block`);
}
function mustHaveLeft(ed: TeggEditor, code: string, what: string) {
  const b = blocks(ed);
  assert.equal(b.length, 2, `${what}: a new block after the code block: ${JSON.stringify(b)}`);
  assert.equal(b[0].text, code, `${what}: the code is unchanged`);
  assert.equal(b[1].name, 'paragraph', `${what}: the new block is a paragraph`);
  assert.equal(b[1].text, '', `${what}: the new paragraph is empty`);
  assert.deepEqual(caretBlock(ed), { index: 1, name: 'paragraph' }, `${what}: the caret is in the new paragraph`);
}
async function savedAfterTyping(ed: TeggEditor, orig: string, codeEdited = false): Promise<string> {
  // With the code edited first, that edit is written; the empty paragraph adds nothing to it (FR-EDT-01 AC-3).
  if (codeEdited) await ed.save();
  else assert.equal(await ed.save(), null, 'an empty paragraph is never written (FR-EDT-01 AC-3)');
  type(ed, 'Dál');
  const out = await ed.save();
  assert.ok(out !== null, 'typing Dál is saved');
  assert.equal(await frontWithoutModified(out!), await frontWithoutModified(orig), 'the frontmatter differs only in modified');
  return out!;
}

test('fr_edt_02_ac23_enter_on_the_empty_last_line_leaves_the_code_block', async () => {
  const orig = NOTE();
  const ed = await open(orig);
  caret(ed, 0, 'end');
  press(ed, 'Enter');
  mustBeInCode(ed, 'let a = 1\n', 'the first ⏎ adds an empty line inside the code block');
  press(ed, 'Enter');
  mustHaveLeft(ed, 'let a = 1', 'the second ⏎ on the empty last line removes it and leaves');
  const out = await savedAfterTyping(ed, orig);
  assert.equal(await body(out), CODE + '\nDál\n', 'the code block byte-identical, one blank line, Dál');
  ed.destroy();
});

test('fr_edt_02_ac23_enter_on_an_inner_empty_line_stays_and_cmd_enter_leaves_from_it', async () => {
  const orig = NOTE();
  const ed = await open(orig);
  caret(ed, 0, 0);
  press(ed, 'Enter');
  mustBeInCode(ed, '\nlet a = 1', '⏎ at the start of the line');
  caret(ed, 0, 0); // the empty first line, which isn't the last one
  press(ed, 'Enter');
  mustBeInCode(ed, '\n\nlet a = 1', '⏎ on an empty line that isn\'t the last one stays a new line in the code');
  press(ed, 'Enter', { meta: true });
  mustHaveLeft(ed, '\n\nlet a = 1', '⌘⏎ on an inner empty line leaves the code block');
  const out = await savedAfterTyping(ed, orig, true);
  assert.equal(await body(out), '```js\n\n\nlet a = 1\n```\n\nDál\n', '⌘⏎ changed nothing in the code');
  ed.destroy();
});

test('fr_edt_02_ac23_cmd_enter_in_the_middle_of_a_line_leaves_without_changing_the_code', async () => {
  const orig = NOTE();
  const ed = await open(orig);
  caret(ed, 0, 3); // after `let`
  press(ed, 'Enter', { meta: true });
  mustHaveLeft(ed, 'let a = 1', '⌘⏎ inside a line');
  const out = await savedAfterTyping(ed, orig);
  assert.equal(await body(out), CODE + '\nDál\n', 'the code block byte-identical, one blank line, Dál');
  ed.destroy();
});
