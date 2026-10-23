// Bug #61 (D-689): convertUnit with `keepSelection` keeps the user's selection where they moved on, even when the
// live document's blocks no longer carry the `srcIndex` a reload would give them (Enter splits a block with
// `srcIndex: null`; a multi-block unit shifts the indices after it).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { editorModule, NOW, newId, readFixture } from './helpers';

const BLOKY = () => readFixture('tests/fixtures/vaults/tasks/Pages/Bloky.md');
const rec = { path: 'Tasks/x.md', created: '---\ntype: task\ntitle: x\n---\n', type: 'task', title: 'x' };
const ui = {
  resolve: () => ({ kind: 'note' as const, path: 'Pages/Zasedačka.md', type: 'page', title: 'Zasedačka' }),
  unresolved: (t: string) => `No note named ${t}`,
  sourceBlock: 'Source block',
  hint: 'Type / for commands',
  placeholder: (kind: string, value: string) => ({ name: `${kind} ${value}`, text: value }),
  onLink: () => {}, onTag: () => {}, onExternal: () => {},
  embed: () => ({ update: () => {}, selected: () => {}, destroy: () => {} }),
  embedChip: (value: string) => ({ title: value, type: 'page', state: 'ok' as const, description: 'Embedded note' }),
};
async function open() {
  const m = await editorModule();
  return (m.createEditor as any)({ text: BLOKY(), now: () => NOW, newId, ui, conversion: { afterUndo: () => {}, beforeRedo: () => Promise.resolve('x') } });
}
function textPos(ed: any, needle: string): number {
  let pos = -1;
  ed.view.state.doc.descendants((n: any, p: number) => {
    if (pos >= 0) return false;
    if (n.isText) { const i = (n.text as string).indexOf(needle); if (i >= 0) pos = p + i; }
    return true;
  });
  assert.ok(pos >= 0, `editor text holds ${JSON.stringify(needle)}`);
  return pos;
}
const Sel = (ed: any) => Object.getPrototypeOf(ed.view.state.selection).constructor as any; // TextSelection
function caret(ed: any, needle: string, offset = 0) {
  const p = textPos(ed, needle) + offset;
  ed.view.dispatch(ed.view.state.tr.setSelection(Sel(ed).create(ed.view.state.doc, p)));
}
function selectText(ed: any, from: string, to: string) {
  const a = textPos(ed, from);
  const b = textPos(ed, to) + to.length;
  ed.view.dispatch(ed.view.state.tr.setSelection(Sel(ed).create(ed.view.state.doc, a, b)));
}
const enter = (ed: any) => ed.view.someProp('handleKeyDown', (f: any) => f(ed.view, new KeyboardEvent('keydown', { key: 'Enter' })));
const caretText = (ed: any) => { const $h = ed.view.state.selection.$head; return $h.parent.textContent.slice(0, $h.parentOffset); };

test('bug_61_fr_cnv_03_kept_caret_after_enter_and_typing_before_the_unit', async () => {
  const ed = await open();
  caret(ed, 'Úvodní odstavec.', 'Úvodní odstavec.'.length);
  enter(ed);
  ed.view.dispatch(ed.view.state.tr.insertText('Nový řádek'));
  caret(ed, 'Závěrečný odstavec.');
  const unit = ed.conversionUnit();
  assert.ok(unit, 'a unit for the last paragraph');
  caret(ed, 'Nový řádek', 'Nový řádek'.length);
  assert.equal(typeof ed.commands.convertUnit(unit, 'Závěrečný odstavec.', rec, { keepSelection: true }), 'number', 'converted');
  assert.equal(ed.view.state.selection.empty, true, 'still a caret, not the embed selected as a block');
  assert.equal(caretText(ed), 'Nový řádek', 'the caret stays at the end of the new line');
});

test('bug_61_fr_cnv_03_kept_caret_after_a_multi_block_unit', async () => {
  const ed = await open();
  selectText(ed, 'Úvodní odstavec.', 'a domluvit termín.');
  const unit = ed.conversionUnit();
  assert.ok(unit && unit.count >= 2, 'a unit of two blocks');
  caret(ed, 'Odstavec pod nadpisem.', 3);
  assert.equal(typeof ed.commands.convertUnit(unit, 'Úvodní odstavec.', rec, { keepSelection: true }), 'number', 'converted');
  assert.equal(caretText(ed), 'Ods', 'the caret stays in the paragraph after the unit');
});

test('bug_61_fr_cnv_03_kept_node_selection_and_fallback_inside_the_unit', async () => {
  const ed = await open();
  caret(ed, 'Úvodní odstavec.');
  const unit = ed.conversionUnit();
  // A node selection after the unit: the `![[Zasedačka]]` embed block.
  const doc = ed.view.state.doc;
  let zas = -1;
  doc.forEach((n: any, p: number) => { if (zas < 0 && n.textContent.includes('Zasedačka') && !n.isTextblock) zas = p; });
  if (zas < 0) doc.forEach((n: any, p: number) => { if (zas < 0 && String(n.attrs?.source ?? '').includes('Zasedačka')) zas = p; });
  assert.ok(zas >= 0, 'the Zasedačka embed block');
  const m: any = await import(/* @vite-ignore */ String('@tiptap/pm/state'));
  ed.view.dispatch(ed.view.state.tr.setSelection(m.NodeSelection.create(doc, zas)));
  const name = ed.view.state.selection.node.type.name;
  assert.equal(typeof ed.commands.convertUnit(unit, 'Úvodní odstavec.', rec, { keepSelection: true }), 'number', 'converted');
  assert.ok(ed.view.state.selection instanceof m.NodeSelection && ed.view.state.selection.node.type.name === name, 'the same block stays selected');
  // Fallback: a caret inside the unit itself can't stay; the embed is selected as before (FR-CNV-01 AC-7).
  const ed2 = await open();
  caret(ed2, 'Závěrečný odstavec.');
  const u2 = ed2.conversionUnit();
  caret(ed2, 'Závěrečný odstavec.', 4);
  assert.equal(typeof ed2.commands.convertUnit(u2, 'Závěrečný odstavec.', rec, { keepSelection: true }), 'number', 'converted');
  assert.ok(ed2.view.state.selection instanceof m.NodeSelection, 'the embed is selected');
});
