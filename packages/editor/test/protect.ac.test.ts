// Slice AND-3, L1 (Vitest): docs/acceptance/android-edit.md FR-MMP-02 AC-37 "The map stays read-only while the note is
// edited" (L1 for the rule; AP-2081 → D-2516, CP-12 → D-2538), through docs/contracts/android-edit.md §5.2
// (`EditorOptions.protectMindmaps`): with it, every user edit next to or across a mindmap callout leaves the callout's
// lines byte for byte (a selection across the block is narrowed to the text outside it; Backspace at the start of the
// next block doesn't join; the block commands with the caret beside the block change only the caret's block); undo,
// redo and `reload()` are never filtered. Without the option (the desktop) the editor is unchanged.
// Fixture: tests/fixtures/vaults/phone-edit/Pages/Mapa v textu.md (`Před mapou.`; the callout; `Po mapě.`).
// Written from the ACs and the contract only (D-61). The package loads inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { TextSelection } from '@tiptap/pm/state';
import { blockStart, caret, editorModule, newId, NOW, press, readFixture, type, type TeggEditor } from './helpers';

const MAPA = readFixture('tests/fixtures/vaults/phone-edit/Pages/Mapa v textu.md');
const CALLOUT = '> [!mindmap] Plán\n> - Cesta\n>   - Vlak\n>   - [ ] Jízdenky\n';

type Cmds = TeggEditor['commands'] & { setBlock?(k: 'paragraph' | 'heading', l?: 1 | 2 | 3): boolean; toggleBulletList?(): boolean; toggleChecklistBlock?(): boolean };

async function openProtected(): Promise<TeggEditor> {
  const m = await editorModule();
  const ed = (m.createEditor as unknown as (o: Record<string, unknown>) => TeggEditor)({ text: MAPA, now: () => NOW, newId, protectMindmaps: true });
  assert.ok(ed, 'createEditor accepts protectMindmaps: true (contract §5.2)');
  return ed;
}
/** Selects from offset `a` of block `ka`'s text to offset `b` of block `kb`'s text. */
function selectAcross(ed: TeggEditor, ka: number, a: number, kb: number, b: number) {
  const doc = ed.view.state.doc;
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(doc, blockStart(ed, ka) + 1 + a, blockStart(ed, kb) + 1 + b)));
}
/** The saved text keeps the callout's lines (or nothing was saved). */
function keepsCallout(out: string | null, what: string) {
  if (out === null) return;
  assert.ok(out.includes(CALLOUT), `${what}: the callout's lines stay byte for byte:\n${out}`);
}

test('fr_mmp_02_ac37_protected_mindmap_rule', async () => {
  // the option exists and protects: a selection from `Před` to `Po` replaced by typed `x`
  let ed = await openProtected();
  selectAcross(ed, 0, 0, 2, 2);
  type(ed, 'x');
  let out = await ed.save();
  assert.ok(out !== null, 'typing over the selection changes the paragraphs');
  keepsCallout(out, 'typed x over Před…Po');
  assert.ok(out!.includes(CALLOUT), 'the callout is still there');
  assert.ok(!out!.includes('Před mapou.'), 'the selected text before the map is replaced');
  assert.ok(out!.includes(' mapě.'), 'the text after `Po` stays');
  assert.ok(out!.includes('x'), 'the typed x is there');
  assert.equal(ed.commands.undo(), true, 'undo is never filtered');
  assert.equal(await ed.save(), null, 'undo restores the original');
  ed.destroy();

  // Backspace at the start of `Po mapě.` doesn't join or remove the block
  ed = await openProtected();
  caret(ed, 2, 0);
  press(ed, 'Backspace');
  out = await ed.save();
  assert.equal(out, null, 'Backspace at the start of Po mapě. changes nothing');
  ed.destroy();

  // cut (delete the selection) and paste over a selection across the block
  ed = await openProtected();
  selectAcross(ed, 0, 0, 2, 2);
  ed.view.dispatch(ed.view.state.tr.deleteSelection().setMeta('uiEvent', 'cut'));
  out = await ed.save();
  keepsCallout(out, 'cut across the block');
  assert.ok(out && out.includes(CALLOUT) && !out.includes('Před mapou.'), 'cut removes only the paragraphs\' selected text');
  ed.destroy();
  ed = await openProtected();
  selectAcross(ed, 0, 0, 2, 2);
  assert.notEqual(ed.commands.pasteText('Vloženo'), undefined, 'pasteText runs');
  out = await ed.save();
  keepsCallout(out, 'paste over the block');
  assert.ok(out && out.includes('Vloženo') && out.includes(CALLOUT), 'paste replaces only the paragraphs\' selected text');
  ed.destroy();

  // the bar's block commands with the caret beside the block change only the caret's block
  ed = await openProtected();
  const c = ed.commands as Cmds;
  assert.equal(typeof c.setBlock, 'function', 'setBlock exists (contract §5.1)');
  caret(ed, 0, 'end');
  c.setBlock!('heading', 2);
  c.toggleBulletList?.();
  out = await ed.save();
  keepsCallout(out, 'block commands beside the block');
  assert.ok(out && out.includes(CALLOUT) && out.includes('Po mapě.'), 'only `Před mapou.` changes');
  ed.destroy();

  // no checkbox in the map toggles, and no caret goes inside the list
  ed = await openProtected();
  const inside = blockStart(ed, 1) + 3;
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.near(ed.view.state.doc.resolve(inside))));
  const sel = ed.view.state.selection.from;
  assert.ok(sel <= blockStart(ed, 1) || sel >= blockStart(ed, 2), `no caret inside the protected block (selection at ${sel})`);
  ed.commands.toggleChecklist();
  type(ed, 'z');
  out = await ed.save();
  keepsCallout(out, 'a toggle or typing next to the map');
  assert.ok(!out || !out.includes('- [x] Jízdenky'), 'Jízdenky doesn\'t toggle');
  ed.destroy();

  // reload is never filtered: a new text with another map loads as given
  ed = await openProtected();
  const other = MAPA.replace('>   - Vlak\n', '>   - Letadlo\n');
  (ed as unknown as { reload(t: string): void }).reload(other);
  assert.equal(await ed.save(), null, 'reload() loads the new text without a save');
  ed.destroy();
});
