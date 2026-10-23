// Bug #64 (D-689, follow-up of #61): a reload never keeps an empty paragraph (sourceDoc reconcile), so convertUnit's
// result lacks the ones the user made this session. `keepSelection` must still keep a caret near where the user is,
// never select the embed and scroll there.
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
  const ed = (m.createEditor as any)({ text: BLOKY(), now: () => NOW, newId, ui, conversion: { afterUndo: () => {}, beforeRedo: () => Promise.resolve('x') } });
  // Record whether a transaction asks to scroll (the conversion must not when the selection is kept).
  const scrolls: boolean[] = [];
  const dispatch = ed.view.dispatch.bind(ed.view);
  ed.view.dispatch = (tr: any) => { scrolls.push(!!tr.scrolledIntoView); dispatch(tr); };
  return { ed, scrolls };
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
const TextSel = (ed: any) => Object.getPrototypeOf(ed.view.state.selection).constructor as any;
const setCaret = (ed: any, p: number) => ed.view.dispatch(ed.view.state.tr.setSelection(TextSel(ed).create(ed.view.state.doc, p)));
const enter = (ed: any) => ed.view.someProp('handleKeyDown', (f: any) => f(ed.view, new KeyboardEvent('keydown', { key: 'Enter' })));
const caretText = (ed: any) => { const $h = ed.view.state.selection.$head; return $h.parent.textContent.slice(0, $h.parentOffset); };

async function lastParagraphUnit(ed: any) {
  setCaret(ed, textPos(ed, 'Závěrečný odstavec.'));
  const unit = ed.conversionUnit();
  assert.ok(unit, 'a unit for the last paragraph');
  return unit;
}

test('bug_64_fr_cnv_03_enter_without_typing_keeps_a_caret_and_doesnt_scroll', async () => {
  const { ed, scrolls } = await open();
  setCaret(ed, textPos(ed, 'Úvodní odstavec.') + 'Úvodní odstavec.'.length);
  enter(ed);
  const empty = ed.view.state.selection.head;
  assert.equal(ed.view.state.selection.$head.parent.content.size, 0, 'the caret is in a new empty paragraph');
  const unit = await lastParagraphUnit(ed);
  setCaret(ed, empty);
  scrolls.length = 0;
  assert.equal(typeof ed.commands.convertUnit(unit, 'Závěrečný odstavec.', rec, { keepSelection: true }), 'number', 'converted');
  const sel = ed.view.state.selection;
  assert.ok(sel.empty && sel.$head.parent.isTextblock, `a caret, not the embed selected as a block (${sel.constructor.name})`);
  assert.ok(sel.from <= textPos(ed, 'Zavolat do servisu'), 'the caret stays near the top, before the next paragraph');
  assert.deepEqual(scrolls.filter(Boolean), [], 'nothing asks to scroll');
});

test('bug_64_fr_cnv_03_an_empty_paragraph_between_the_caret_and_the_unit_keeps_the_caret', async () => {
  const { ed, scrolls } = await open();
  setCaret(ed, textPos(ed, 'Úvodní odstavec.') + 'Úvodní odstavec.'.length);
  enter(ed);
  const unit = await lastParagraphUnit(ed);
  // The caret is below the empty paragraph and above the unit.
  setCaret(ed, textPos(ed, 'Odstavec pod nadpisem.') + 3);
  scrolls.length = 0;
  assert.equal(typeof ed.commands.convertUnit(unit, 'Závěrečný odstavec.', rec, { keepSelection: true }), 'number', 'converted');
  assert.equal(caretText(ed), 'Ods', 'the caret stays in its paragraph');
  assert.deepEqual(scrolls.filter(Boolean), [], 'nothing asks to scroll');
});

// QA review of PR #65: the empty paragraph right after the converted block sits next to the new embed; the caret must
// stay a caret there, never select the embed (the next keystroke would replace it).
for (const [where, needle] of [['at the end of the note', 'Závěrečný odstavec.'], ['in the middle', 'Úvodní odstavec.']] as const) {
  test(`bug_64_fr_cnv_03_enter_after_the_unit_keeps_a_caret_${where.replace(/ /g, '_')}`, async () => {
    const { ed, scrolls } = await open();
    setCaret(ed, textPos(ed, needle));
    const unit = ed.conversionUnit();
    assert.ok(unit, `a unit for "${needle}"`);
    setCaret(ed, textPos(ed, needle) + needle.length);
    enter(ed);
    assert.equal(ed.view.state.selection.$head.parent.content.size, 0, 'the caret is in a new empty paragraph');
    scrolls.length = 0;
    assert.equal(typeof ed.commands.convertUnit(unit, needle, rec, { keepSelection: true }), 'number', 'converted');
    const sel = ed.view.state.selection;
    assert.ok(sel.empty && sel.$head.parent.isTextblock, `a caret in a text block, not the embed selected (${sel.constructor.name})`);
    assert.deepEqual(scrolls.filter(Boolean), [], 'nothing asks to scroll');
  });
}

test('bug_64_fr_cnv_03_a_nested_node_selection_in_an_unchanged_block_stays', async () => {
  const { ed, scrolls } = await open();
  setCaret(ed, textPos(ed, 'Úvodní odstavec.'));
  const unit = ed.conversionUnit();
  // Select the nested list item `zjistit cenu` as a node.
  const m: any = await import(/* @vite-ignore */ String('@tiptap/pm/state'));
  let item = -1;
  ed.view.state.doc.descendants((n: any, p: number) => {
    if (item < 0 && n.type.name === 'listItem' && n.textContent.trim() === 'zjistit cenu') item = p;
    return item < 0;
  });
  assert.ok(item > 0, 'the nested item');
  ed.view.dispatch(ed.view.state.tr.setSelection(m.NodeSelection.create(ed.view.state.doc, item)));
  scrolls.length = 0;
  assert.equal(typeof ed.commands.convertUnit(unit, 'Úvodní odstavec.', rec, { keepSelection: true }), 'number', 'converted');
  const sel = ed.view.state.selection;
  assert.ok(sel instanceof m.NodeSelection && sel.node.textContent.trim() === 'zjistit cenu', 'the same item stays selected');
  assert.deepEqual(scrolls.filter(Boolean), [], 'nothing asks to scroll');
});
