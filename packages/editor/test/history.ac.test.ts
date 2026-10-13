// FR-EDT-09 AC-2 (L1): each editor action is one undo step; undo reverts it exactly (nothing left to save) and redo
// re-applies it (the same bytes as before the undo); a new edit after an undo clears redo. Also FR-EDT-02 AC-18's
// one-character checklist patch (D-192) and NFR-REL-03 AC-9's verification refusal (VerifyError).
// docs/acceptance/editor.md; docs/contracts/ms3-shell.md §13.3, §13.6.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { caret, editorModule, editorNote, open, selectText, type, type TeggEditor } from './helpers';

const FROM = 'Pages/Deset bloků.md';
type Step = { name: string; note: string; act: (ed: TeggEditor) => boolean | void };

const STEPS: Step[] = [
  { name: 'typing_burst', note: 'Deset bloků', act: (ed) => { caret(ed, 4); type(ed, ' Nová věta.'); } },
  { name: 'block_move', note: 'Deset bloků', act: (ed) => { caret(ed, 2, 0); return ed.commands.moveBlock('down'); } },
  { name: 'duplicate', note: 'Deset bloků', act: (ed) => { caret(ed, 4, 0); return ed.commands.duplicateBlock(); } },
  { name: 'delete_blocks', note: 'Deset bloků', act: (ed) => { caret(ed, 1, 0); ed.commands.selectBlock(); ed.commands.extendBlockSelection('down'); return ed.commands.deleteBlocks(); } },
  { name: 'turn_into', note: 'Deset bloků', act: (ed) => { caret(ed, 4, 0); return ed.commands.turnInto('heading', { level: 2 }); } },
  { name: 'shortcut_conversion', note: 'Prázdná', act: (ed) => { caret(ed, 0, 0); type(ed, '- x'); } },
  { name: 'mark_toggle', note: 'Deset bloků', act: (ed) => { selectText(ed, 4, 'blok'); return ed.commands.toggleMark('bold'); } },
  { name: 'link_insertion', note: 'Deset bloků', act: (ed) => { caret(ed, 4); return ed.commands.insertLink({ path: 'Pages/Cíl.md', title: 'Cíl', fromPath: FROM, stemUnique: true }); } },
  { name: 'tag_insertion', note: 'Deset bloků', act: (ed) => { caret(ed, 4); return ed.commands.insertTag('projekt'); } },
  { name: 'paste', note: 'Deset bloků', act: (ed) => { caret(ed, 4); return ed.commands.pasteText(' Vložený text.'); } },
  { name: 'checkbox_toggle', note: 'Úkoly', act: (ed) => { caret(ed, 0, 0); return ed.commands.toggleChecklist(); } },
  { name: 'callout_type', note: 'Deset bloků', act: (ed) => { caret(ed, 8, 0); return ed.commands.turnInto('callout', { calloutType: 'warning' }); } },
  { name: 'table_change', note: 'Deset bloků', act: (ed) => { caret(ed, 7, 0); return ed.commands.tableAction('addRowBelow'); } },
];

for (const s of STEPS) {
  test(`fr_edt_09_ac2_one_undo_step_${s.name}`, async () => {
    const ed = await open(editorNote(s.note));
    const r = s.act(ed);
    assert.notEqual(r, false, `${s.name}: the action applies`);
    const after = await ed.save();
    assert.ok(after !== null, `${s.name}: the action changes the note`);
    assert.equal(ed.commands.undo(), true, `${s.name}: undo`);
    assert.equal(await ed.save(), null, `${s.name}: one undo restores the original exactly`);
    assert.equal(ed.commands.redo(), true, `${s.name}: redo`);
    assert.equal(await ed.save(), after, `${s.name}: redo re-applies the same bytes`);
    assert.equal(ed.commands.undo(), true, `${s.name}: undo again`);
    caret(ed, 0, 0);
    type(ed, 'Ž');
    assert.equal(ed.commands.redo(), false, `${s.name}: a new edit after undo clears redo`);
    ed.destroy();
  });
}

test('fr_edt_09_ac6_empty_history_undo_redo_do_nothing', async () => {
  const ed = await open(editorNote('Deset bloků'));
  assert.equal(ed.commands.undo(), false, 'undo with empty history');
  assert.equal(ed.commands.redo(), false, 'redo with empty history');
  assert.equal(await ed.save(), null, 'nothing to write');
});

test('fr_edt_02_ac18_checklist_toggle_is_a_one_character_patch', async () => {
  const orig = editorNote('Úkoly');
  const ed = await open(orig);
  caret(ed, 0, 0); // in `Koupit mléko`
  assert.equal(ed.commands.toggleChecklist(), true, 'toggleChecklist applies');
  const out = await ed.save();
  assert.ok(out !== null, 'saved');
  const strip = (t: string) => t.replace(/^modified: .*$/m, 'modified: X');
  const a = strip(orig), b = strip(out!);
  assert.equal(b.length, a.length, 'same length outside modified');
  const diffs = [...a].map((c, i) => (c !== b[i] ? i : -1)).filter((i) => i >= 0);
  assert.equal(diffs.length, 1, 'exactly one character changes');
  assert.equal(a[diffs[0]], ' ', 'from a space');
  assert.equal(b[diffs[0]], 'x', 'to x');
  assert.match(out!, /- \[x\] Koupit mléko\n- \[x\] Zavolat Evě\n- \[X\] Velké X/, 'others keep x and X');
});

test('nfr_rel_03_ac9_save_refused_with_verify_error_keeps_edits', async () => {
  const m = await editorModule();
  const g = globalThis as any;
  g.__TEGG_TEST__ = { ...(g.__TEGG_TEST__ ?? {}), faults: { verify: true } };
  try {
    const ed = m.createEditor({ text: editorNote('Deset bloků'), now: () => '2026-10-13T14:00:00+02:00', newId: () => '01JB0Z00000000000000000001' });
    caret(ed, 4);
    type(ed, ' Doplněno.');
    let thrown: unknown = null;
    try { await ed.save(); } catch (e) { thrown = e; }
    assert.ok(thrown instanceof m.VerifyError, `save() throws VerifyError after escalation, got ${String(thrown)}`);
    assert.match(ed.view.state.doc.textContent, /Doplněno\./, 'the edit stays in the editor');
  } finally {
    g.__TEGG_TEST__.faults = {};
  }
});
