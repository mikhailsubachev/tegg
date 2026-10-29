// v1.0 slice P (object previews), L1: the `@tegg/editor` additions of docs/contracts/v1-previews.md §5 with real
// ProseMirror transactions and the save path through the real @tegg/doc. §5.1: `onLink` gains a gesture (`click` from
// `handleClickOn` leaves a collapsed TextSelection right after the chip, never a NodeSelection, D-926; `dblclick` from
// `handleDoubleClickOn`; `modClick`), ⌘↩ at a chip reports `modEnter` (D-209), ⌥Space at a chip reports `altSpace` and
// is consumed, elsewhere it isn't handled (D-928), ⏎ stays a text key (D-929). §5.2 `focusAfterChip(pos)`. §5.3
// `editLink`, `linkAt`, `removeLink` with the exact Markdown of previews.md FR-LNK-13 AC-6, AC-7, one undo step each.
// Criteria: FR-LNK-08 AC-1 (L1 for the caret), FR-LNK-13 AC-1 (L1 for the selection), AC-2, AC-3, AC-6 (L1 for the
// text), AC-7, FR-LNK-12 AC-7 (⏎ in the editor). Fixture: tests/fixtures/vaults/previews/Pages/Odkazy.md (read only).
// Written from the ACs and the contract only (D-61). New exports are looked up dynamically and asserted to be functions
// first, so a missing one is a failed assertion (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { editorModule, newId, readFixture } from './helpers';

const NOW = '2026-10-28T10:00:00+01:00';
const ODKAZY = () => readFixture('tests/fixtures/vaults/previews/Pages/Odkazy.md');
const touched = (text: string) => text.replace(/^modified: .*$/m, `modified: ${NOW}`);

type Gesture = string | undefined;
type LinkCall = { target: string; fragment: string | null; pos: number | undefined; dom: boolean; gesture: Gesture };
type Log = { links: LinkCall[]; tags: string[] };

const RESOLVED: Record<string, { path: string; type: string; title: string }> = {
  'Rozpočet 2027': { path: 'Pages/Rozpočet 2027.md', type: 'page', title: 'Rozpočet 2027' },
  'Projekt Alfa': { path: 'Projekty/Projekt Alfa.md', type: 'projekt', title: 'Projekt Alfa' },
  'Jana Nováková': { path: 'Osoby/Jana Nováková.md', type: 'osoba', title: 'Jana Nováková' },
  'Petr Dvořák': { path: 'Osoby/Petr Dvořák.md', type: 'osoba', title: 'Petr Dvořák' },
};
/** The app's side of the editor (ms3-shell §13.5 plus §5.1): records every `onLink` call with its gesture. */
function ui(log: Log) {
  return {
    resolve: (t: string) => {
      const r = RESOLVED[t.normalize('NFC')];
      return r ? { kind: 'note' as const, ...r } : { kind: 'unresolved' as const };
    },
    unresolved: (t: string) => `No note named ${t}`,
    sourceBlock: 'Source block',
    hint: 'Type / for commands',
    placeholder: (kind: string, value: string) => ({ name: `${kind} ${value}`, text: value }),
    onLink: (target: string, fragment: string | null, chip?: { pos: number; dom: HTMLElement | null }, gesture?: string) => {
      log.links.push({ target: target.normalize('NFC'), fragment, pos: chip?.pos, dom: !!chip?.dom, gesture });
    },
    onTag: (v: string) => { log.tags.push(v); },
    onExternal: () => {},
  };
}
async function open(text = ODKAZY()) {
  const m = await editorModule();
  const log: Log = { links: [], tags: [] };
  const element = document.createElement('div');
  document.body.appendChild(element);
  const ed = (m.createEditor as any)({ text, element, now: () => NOW, newId, ui: ui(log) });
  return { ed, log };
}

/** Position of the `n`-th wikiLink chip whose value is `value` (0-based). */
function chipPos(ed: any, value: string, n = 0): number {
  const found: number[] = [];
  ed.view.state.doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'wikiLink' && !node.attrs.embed && String(node.attrs.value).normalize('NFC') === value) found.push(pos);
    return true;
  });
  assert.ok(found.length > n, `chip [[${value}]] #${n} in the editor (found ${found.length})`);
  return found[n];
}
function setCaret(ed: any, pos: number) {
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, pos)));
}
/** Text position of `needle` (first occurrence). */
function textPos(ed: any, needle: string): number {
  let at = -1;
  ed.view.state.doc.descendants((n: any, p: number) => {
    if (at >= 0) return false;
    if (n.isText) {
      const i = (n.text as string).indexOf(needle);
      if (i >= 0) at = p + i;
    }
    return true;
  });
  assert.ok(at >= 0, `editor text holds ${JSON.stringify(needle)}`);
  return at;
}
function mouse(type: string, mods: { meta?: boolean } = {}, detail = 1) {
  return new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, metaKey: !!mods.meta, detail });
}
/** A click as ProseMirror's input handling dispatches it: `handleClickOn` from the chip up to the root (direct only for
 *  the chip), then `handleClick`. Returns whether a handler took it. */
function clickOn(ed: any, pos: number, ev: MouseEvent, prop: 'handleClickOn' | 'handleDoubleClickOn' = 'handleClickOn'): boolean {
  const view = ed.view;
  const node = view.state.doc.nodeAt(pos);
  assert.ok(node, `a node at ${pos}`);
  if (view.someProp(prop, (f: any) => f(view, pos, node, pos, ev, true))) return true;
  const $pos = view.state.doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    if (view.someProp(prop, (f: any) => f(view, pos, $pos.node(d), $pos.before(d), ev, false))) return true;
  }
  return !!view.someProp(prop === 'handleClickOn' ? 'handleClick' : 'handleDoubleClick', (f: any) => f(view, pos, ev));
}
function key(ed: any, init: KeyboardEventInit & { keyCode?: number }): boolean {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.keyCode !== undefined) Object.defineProperty(ev, 'keyCode', { value: init.keyCode });
  return !!ed.view.someProp('handleKeyDown', (f: any) => f(ed.view, ev));
}
/** ⌥Space on macOS (U.S. and Czech layouts): `key` is the no-break space, `code` Space. */
const altSpace = (ed: any) => key(ed, { key: ' ', code: 'Space', altKey: true, keyCode: 32 });
const modEnter = (ed: any) => key(ed, { key: 'Enter', code: 'Enter', metaKey: true, keyCode: 13 });
/** A function of the editor handle or its `commands` (§5.2, §5.3 say "on the editor handle"). */
function fn(ed: any, name: string): (...a: any[]) => any {
  const f = typeof ed[name] === 'function' ? ed[name].bind(ed) : typeof ed.commands?.[name] === 'function' ? ed.commands[name].bind(ed.commands) : null;
  assert.equal(typeof f, 'function', `the editor handle has ${name}() (v1-previews §5)`);
  return f!;
}
function body(text: string): string {
  return text.slice(text.indexOf('\n---\n', 4) + 5);
}

// ------------------------------------------------------------------------------------------------ §5.1 gestures

test('fr_lnk_08_ac1_a_click_on_a_chip_reports_click_and_leaves_the_caret_right_after_it', async () => {
  const { ed, log } = await open();
  const before = ed.text();
  const pos = chipPos(ed, 'Rozpočet 2027');
  setCaret(ed, textPos(ed, 'Osoby'));
  const handled = clickOn(ed, pos, mouse('click'));
  assert.equal(handled, true, 'the click on the chip is handled by the editor');
  assert.deepEqual(log.links, [{ target: 'Rozpočet 2027', fragment: null, pos, dom: true, gesture: 'click' }], 'onLink(target, fragment, chip, "click")');
  const sel = ed.view.state.selection;
  assert.ok(!(sel instanceof NodeSelection), 'never a NodeSelection (D-926)');
  assert.ok(sel instanceof TextSelection, 'a TextSelection');
  assert.equal(sel.empty, true, 'collapsed');
  assert.equal(sel.from, pos + 1, 'directly after the chip');
  assert.equal(ed.text(), before, 'nothing changed by the click');
  assert.equal(ed.dirty(), false, 'not dirty: no note_write for opening a preview');
  // Typing X then saves `Hlavní [[Rozpočet 2027]]X.` and nothing else but `modified`.
  ed.view.dispatch(ed.view.state.tr.insertText('X'));
  const saved = await ed.save();
  assert.equal(saved, touched(before.replace('Hlavní [[Rozpočet 2027]].', 'Hlavní [[Rozpočet 2027]]X.')), 'the chip bytes unchanged, X after it');
});

test('fr_lnk_13_ac1_click_caret_then_arrows_move_over_the_chip_as_one_position', async () => {
  const { ed, log } = await open();
  const pos = chipPos(ed, 'Projekt Alfa');
  clickOn(ed, pos, mouse('click'));
  assert.equal(log.links.at(-1)?.gesture, 'click', 'the click on Projekt Alfa reports `click`');
  assert.equal(ed.view.state.selection.from, pos + 1, 'caret directly after the chip');
  assert.equal(ed.view.state.selection.empty, true);
  // ← once: directly before the chip (the atom is one position).
  const left = TextSelection.create(ed.view.state.doc, pos);
  ed.view.dispatch(ed.view.state.tr.setSelection(left));
  assert.equal(ed.view.state.selection.from, pos, 'directly before the chip');
  // ⌫ after the chip removes the whole link in one step; ⌘Z restores it.
  setCaret(ed, pos + 1);
  const before = ed.text();
  key(ed, { key: 'Backspace', code: 'Backspace', keyCode: 8 });
  if (ed.text() === before) ed.view.dispatch(ed.view.state.tr.delete(pos, pos + 1)); // the browser's default delete
  assert.ok(ed.text().includes('Projekt .') && !ed.text().includes('[[Projekt Alfa]]'), 'the whole link is gone in one step');
  ed.commands.undo();
  assert.equal(body(ed.text()), body(before), '⌘Z restores it');
});

test('fr_lnk_13_ac1_a_click_on_the_text_beside_a_chip_is_not_a_link_gesture', async () => {
  const { ed, log } = await open();
  const pos = chipPos(ed, 'Rozpočet 2027');
  clickOn(ed, pos, mouse('click'));
  assert.equal(log.links.length, 1, 'setup: the chip click is reported');
  assert.equal(log.links[0].gesture, 'click', 'with the gesture `click`');
  const at = textPos(ed, 'Hlavní');
  const handled = clickOn(ed, at + 2, mouse('click'));
  assert.equal(log.links.length, 1, 'a click in the text beside the chip calls no onLink');
  assert.equal(handled, false, 'and is left to ProseMirror (caret as in any text)');
});

test('fr_lnk_13_ac2_double_click_on_a_chip_reports_dblclick_and_edits_nothing', async () => {
  const { ed, log } = await open();
  const before = ed.text();
  const pos = chipPos(ed, 'Rozpočet 2027');
  clickOn(ed, pos, mouse('click', {}, 1));
  const handled = clickOn(ed, pos, mouse('dblclick', {}, 2), 'handleDoubleClickOn');
  assert.equal(handled, true, 'the double-click on the chip is handled (no word selection)');
  assert.deepEqual(log.links.map((l) => l.gesture), ['click', 'dblclick'], 'the first click, then `dblclick` (D-37)');
  assert.deepEqual(log.links.map((l) => [l.target, l.pos]), [['Rozpočet 2027', pos], ['Rozpočet 2027', pos]]);
  assert.equal(ed.text(), before, 'no text change');
  assert.equal(ed.dirty(), false, 'no note_write');
  assert.ok(!(ed.view.state.selection instanceof NodeSelection), 'no node selection');
  assert.equal(ed.view.state.selection.empty, true, 'no word selected');
});

test('fr_lnk_11_ac8_cmd_click_on_a_chip_reports_mod_click', async () => {
  const { ed, log } = await open();
  const pos = chipPos(ed, 'Jana Nováková');
  const before = ed.text();
  clickOn(ed, pos, mouse('click', { meta: true }));
  assert.deepEqual(log.links.map((l) => [l.target, l.gesture]), [['Jana Nováková', 'modClick']], '⌘-click → `modClick` (D-925)');
  assert.equal(ed.text(), before);
});

test('fr_lnk_13_ac3_cmd_enter_at_a_chip_reports_mod_enter', async () => {
  const { ed, log } = await open();
  const pos = chipPos(ed, 'Projekt Alfa');
  setCaret(ed, pos + 1);
  const before = ed.text();
  assert.equal(modEnter(ed), true, '⌘↩ after the chip is handled');
  assert.deepEqual(log.links.map((l) => [l.target, l.gesture]), [['Projekt Alfa', 'modEnter']], '⌘↩ after the chip → `modEnter` (D-209)');
  setCaret(ed, pos);
  modEnter(ed);
  assert.deepEqual(log.links.map((l) => [l.target, l.gesture]), [['Projekt Alfa', 'modEnter'], ['Projekt Alfa', 'modEnter']], 'and before it');
  assert.equal(ed.text(), before, '⌘↩ changes no text');
});

test('fr_lnk_13_ac3_alt_space_at_a_chip_reports_alt_space_and_is_consumed', async () => {
  const { ed, log } = await open();
  const pos = chipPos(ed, 'Projekt Alfa');
  const before = ed.text();
  setCaret(ed, pos + 1);
  assert.equal(altSpace(ed), true, '⌥Space with the caret directly after the chip is consumed');
  setCaret(ed, pos);
  assert.equal(altSpace(ed), true, '… directly before it');
  ed.view.dispatch(ed.view.state.tr.setSelection(NodeSelection.create(ed.view.state.doc, pos)));
  assert.equal(altSpace(ed), true, '… with the chip selected');
  assert.deepEqual(log.links.map((l) => [l.target, l.pos, l.gesture]), [['Projekt Alfa', pos, 'altSpace'], ['Projekt Alfa', pos, 'altSpace'], ['Projekt Alfa', pos, 'altSpace']], 'onLink(…, "altSpace") each time');
  assert.equal(ed.text(), before, 'no no-break space is typed');
});

test('fr_lnk_13_ac3_alt_space_away_from_a_chip_is_not_handled', async () => {
  const { ed, log } = await open();
  // Red guard: at a chip, ⌥Space is the preview key (§5.1).
  const pos = chipPos(ed, 'Projekt Alfa');
  setCaret(ed, pos + 1);
  altSpace(ed);
  assert.deepEqual(log.links.map((l) => l.gesture), ['altSpace'], 'setup: at the chip ⌥Space reports altSpace');
  log.links.length = 0;
  setCaret(ed, textPos(ed, 'Hlavní') + 3);
  assert.equal(altSpace(ed), false, '⌥Space in plain text is left to the system (it types U+00A0, D-928)');
  setCaret(ed, pos - 2); // inside "Projekt " before the chip, not directly before it
  assert.equal(altSpace(ed), false, '… also one character away from the chip');
  assert.deepEqual(log.links, [], 'no onLink');
});

test('fr_lnk_12_ac7_enter_in_the_editor_is_a_text_key_even_at_a_chip', async () => {
  const { ed, log } = await open();
  const pos = chipPos(ed, 'Rozpočet 2027');
  // Red guard: the chip reports gestures (§5.1).
  clickOn(ed, pos, mouse('click'));
  assert.equal(log.links.at(-1)?.gesture, 'click', 'setup: a click reports `click`');
  log.links.length = 0;
  setCaret(ed, pos + 1);
  const blocks = ed.view.state.doc.childCount;
  key(ed, { key: 'Enter', code: 'Enter', keyCode: 13 });
  assert.deepEqual(log.links, [], '⏎ calls no onLink (D-929)');
  assert.equal(ed.view.state.doc.childCount, blocks + 1, '⏎ splits the paragraph as today');
});

// ------------------------------------------------------------------------------------------------ §5.2 focusAfterChip

test('fr_lnk_08_ac1_focus_after_chip_puts_the_caret_after_the_chip_and_focuses', async () => {
  const { ed } = await open();
  const focusAfterChip = fn(ed, 'focusAfterChip');
  const pos = chipPos(ed, 'Rozpočet 2027');
  setCaret(ed, textPos(ed, 'Mapa'));
  let focused = 0;
  const vf = ed.view.focus.bind(ed.view);
  ed.view.focus = () => { focused++; vf(); };
  const df = ed.view.dom.focus.bind(ed.view.dom);
  ed.view.dom.focus = (o?: FocusOptions) => { focused++; df(o); };
  focusAfterChip(pos);
  const sel = ed.view.state.selection;
  assert.ok(sel instanceof TextSelection && sel.empty, 'a collapsed caret');
  assert.equal(sel.from, pos + 1, 'directly after the chip (D-924)');
  assert.ok(focused > 0, 'the editor is focused');
});

// ------------------------------------------------------------------------------------------------ §5.3 link editing

test('fr_lnk_13_ac6_link_at_reads_target_fragment_and_alias', async () => {
  const { ed } = await open();
  const linkAt = fn(ed, 'linkAt');
  assert.deepEqual(linkAt(chipPos(ed, 'Rozpočet 2027|rozpočet')), { target: 'Rozpočet 2027', fragment: null, alias: 'rozpočet' });
  assert.deepEqual(linkAt(chipPos(ed, 'Rozpočet 2027')), { target: 'Rozpočet 2027', fragment: null, alias: null });
  assert.deepEqual(linkAt(chipPos(ed, 'Rozpočet 2027#Rozsah')), { target: 'Rozpočet 2027', fragment: 'Rozsah', alias: null });
  assert.deepEqual(linkAt(chipPos(ed, 'Rozpočet 2027#^otazka1')), { target: 'Rozpočet 2027', fragment: '^otazka1', alias: null });
  assert.equal(linkAt(textPos(ed, 'Hlavní')), null, 'null where there is no chip');
});

test('fr_lnk_13_ac6_edit_link_changes_the_target_keeping_the_alias_in_one_step', async () => {
  const { ed } = await open();
  const editLink = fn(ed, 'editLink');
  const before = ed.text();
  const pos = chipPos(ed, 'Rozpočet 2027|rozpočet');
  assert.equal(editLink(pos, { target: 'Projekt Alfa', alias: 'rozpočet' }), true, 'editLink returns true');
  assert.equal(body(ed.text()), body(before).replace('S popisem [[Rozpočet 2027|rozpočet]].', 'S popisem [[Projekt Alfa|rozpočet]].'), 'only that link changes (FR-FMT-07 AC-5)');
  const saved = await ed.save();
  assert.equal(saved, touched(before.replace('S popisem [[Rozpočet 2027|rozpočet]].', 'S popisem [[Projekt Alfa|rozpočet]].')), 'saved: `S popisem [[Projekt Alfa|rozpočet]].` and `modified`');
  ed.commands.undo();
  assert.equal(body(ed.text()), body(before), 'one undo step restores the link');
});

test('fr_lnk_13_ac6_edit_link_with_the_text_cleared_writes_the_bare_target', async () => {
  const { ed } = await open();
  const editLink = fn(ed, 'editLink');
  const before = ed.text();
  const pos = chipPos(ed, 'Rozpočet 2027|rozpočet');
  assert.equal(editLink(pos, { target: 'Rozpočet 2027', alias: null }), true);
  const saved = await ed.save();
  assert.equal(saved, touched(before.replace('S popisem [[Rozpočet 2027|rozpočet]].', 'S popisem [[Rozpočet 2027]].')), '`[[Rozpočet 2027]]` when the alias is cleared');
  ed.commands.undo();
  assert.equal(body(ed.text()), body(before), 'one undo step');
});

test('fr_lnk_13_ac6_edit_link_keeps_a_section_and_is_false_without_a_chip', async () => {
  const { ed } = await open();
  const editLink = fn(ed, 'editLink');
  const before = ed.text();
  assert.equal(editLink(textPos(ed, 'Hlavní'), { target: 'Projekt Alfa', alias: null }), false, 'false where there is no chip');
  assert.equal(ed.text(), before, 'and nothing changes');
  const pos = chipPos(ed, 'Jana Nováková');
  assert.equal(editLink(pos, { target: 'Petr Dvořák', alias: 'Jana' }), true);
  assert.equal(body(ed.text()), body(before).replace('Osoby [[Jana Nováková]] a', 'Osoby [[Petr Dvořák|Jana]] a'), 'the new target with the link text');
});

test('fr_lnk_13_ac7_remove_link_turns_the_chip_into_its_visible_text_in_one_step', async () => {
  const { ed } = await open();
  // Red guard: the Link menu puts the caret at the chip with focusAfterChip (§5.2) before `removeLink()`.
  const focusAfterChip = fn(ed, 'focusAfterChip');
  const before = ed.text();
  focusAfterChip(chipPos(ed, 'Rozpočet 2027|rozpočet'));
  assert.equal(ed.commands.removeLink(), true, 'removeLink at the caret after the chip');
  assert.equal(await ed.save(), touched(before.replace('S popisem [[Rozpočet 2027|rozpočet]].', 'S popisem rozpočet.')), '`S popisem rozpočet.`');
  ed.commands.undo();
  assert.equal(body(ed.text()), body(before), 'one undo step');

  const two = await open();
  const b2 = two.ed.text();
  fn(two.ed, 'focusAfterChip')(chipPos(two.ed, 'Projekt Alfa'));
  assert.equal(two.ed.commands.removeLink(), true);
  assert.equal(await two.ed.save(), touched(b2.replace('Projekt [[Projekt Alfa]].', 'Projekt Projekt Alfa.')), '`Projekt Projekt Alfa.`');
  two.ed.commands.undo();
  assert.equal(body(two.ed.text()), body(b2), 'one undo step');
});
