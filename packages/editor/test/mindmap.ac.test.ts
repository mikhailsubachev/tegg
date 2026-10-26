// Slice MM, L1: the @tegg/editor side of mindmaps with real ProseMirror transactions and the save path through the real
// @tegg/doc (docs/acceptance/mindmap.md R93; contract docs/contracts/mm-mindmap.md §3). FR-MMP-01 AC-1 (W1, W1a, W1b,
// List view with the caret in the empty item), AC-2 (W2, W3), AC-3 (W4, W5), AC-4 (W6, W7, W8, W8a), AC-6 (one undo
// step each, Map/List not a step), AC-7 (`canTurnIntoMindmap`, D-768), AC-9 (W9…W9d and the tree the map gets after a
// title change), FR-MMP-02 AC-5 (`onNode` puts the caret at the end of the item), AC-18 (b) (Z Obsidianu reads back to
// the same tree), AC-22 (keys that would break "one list", D-772), FR-EDT-01 AC-2's guard for mindmaps (an editable
// callout, never a source block).
// Fixtures: tests/fixtures/vaults/mindmap and the editor fixture's Deset bloků (read only). Written from the ACs and
// the contract only (D-61); `mindmapView`, `canTurnIntoMindmap` and the `EditorUi.mindmap` hook exist as stubs, so
// the tests fail on their assertions (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextSelection } from '@tiptap/pm/state';
import { blockStart, editorModule, NOW, newId, press, REPO, type, type TeggEditor } from './helpers';

const fx = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/mindmap', rel), 'utf8');
const nfc = (s: string) => s.normalize('NFC');
/** `text` with its `modified:` line set to the editor's clock. */
const touched = (text: string) => text.replace(/^modified: .*$/m, `modified: ${NOW}`);
function sw(text: string, from: string, to: string): string {
  const i = text.indexOf(from);
  assert.ok(i >= 0 && text.indexOf(from, i + 1) < 0, `fixture text holds ${JSON.stringify(from)} exactly once`);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

type Ctl = { markdown: () => string; view: () => 'map' | 'list'; onNode: (p: number[] | null) => void; onLink: (t: string) => void; readOnly: boolean };
type Log = { ctls: Ctl[]; doms: HTMLElement[]; links: string[] };
const fresh = (): Log => ({ ctls: [], doms: [], links: [] });

function ui(log: Log) {
  const state = new Map<string, 'map' | 'list'>();
  return {
    resolve: () => ({ kind: 'note' as const, path: 'Pages/Lisabon.md', type: 'page', title: 'Lisabon' }),
    unresolved: (t: string) => `No note named ${t}`,
    sourceBlock: 'Source block',
    hint: 'Type / for commands',
    placeholder: (kind: string, value: string) => ({ name: `${kind} ${value}`, text: value }),
    onLink: (t: string) => { log.links.push(t); },
    onTag: () => {},
    onExternal: () => {},
    mindmap: (dom: HTMLElement, ctl: Ctl) => {
      log.ctls.push(ctl);
      log.doms.push(dom);
      return { update: () => {}, focusTree: () => {}, destroy: () => {} };
    },
    mindmapState: { get: (k: string) => state.get(k), set: (k: string, v: 'map' | 'list') => { state.set(k, v); } },
  };
}

type Ed = TeggEditor & {
  text(): string;
  historyDepth(): number;
  commands: TeggEditor['commands'] & {
    mindmapView(v: 'map' | 'list'): boolean;
    canTurnIntoMindmap(): 'yes' | 'disabled' | 'no';
    insertBlock(kind: string, opts?: { level?: number }): boolean;
    setCalloutType(t: string): boolean;
    selectBlockRange(from: number, to: number): boolean;
    slashInsert(from: number, to: number, kind: string): boolean;
  };
};
async function openMm(text: string, log: Log = fresh()): Promise<Ed> {
  const m = await editorModule();
  const ed = (m.createEditor as any)({ text, now: () => NOW, newId, ui: ui(log) }) as Ed;
  return ed;
}
/** save(), then markSaved (the app's autosave), returning what was written (null: nothing). */
async function saved(ed: Ed): Promise<string | null> {
  const out = await ed.save();
  if (out !== null) ed.markSaved(out);
  return out;
}

/** Collapsed caret right after the first occurrence of `needle` in the document's text (or at its start). */
function caretAfter(ed: Ed, needle: string, atStart = false) {
  let pos = -1;
  ed.view.state.doc.descendants((n: any, p: number) => {
    if (pos >= 0) return false;
    if (n.isText) {
      const i = nfc(n.text as string).indexOf(nfc(needle));
      if (i >= 0) pos = p + i + (atStart ? 0 : needle.length);
    }
    return true;
  });
  assert.ok(pos >= 0, `editor text holds ${JSON.stringify(needle)}`);
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, pos)));
}
/** Caret in the first textblock of top-level block `k` (`end` or start). */
function caretIn(ed: Ed, k: number, where: 'start' | 'end' = 'end') {
  const start = blockStart(ed, k);
  const node = ed.view.state.doc.child(k);
  let target: number | null = null;
  node.descendants((n: any, p: number) => {
    if (target !== null) return false;
    if (n.isTextblock) { target = start + 1 + p + 1 + (where === 'end' ? n.content.size : 0); return false; }
    return true;
  });
  if (node.isTextblock) target = where === 'end' ? start + node.nodeSize - 1 : start + 1;
  assert.ok(target !== null, `block ${k} has a text position`);
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.near(ed.view.state.doc.resolve(target!))));
}
/** The names of the caret's ancestors (innermost last). */
function ancestors(ed: Ed): string[] {
  const $f = ed.view.state.selection.$from;
  const out: string[] = [];
  for (let d = 1; d <= $f.depth; d++) out.push($f.node(d).type.name);
  return out;
}
/** Text of the caret's textblock and whether the caret is at its end. */
function caretText(ed: Ed): { text: string; atEnd: boolean } {
  const $f = ed.view.state.selection.$from;
  return { text: nfc($f.parent.textContent), atEnd: $f.parentOffset === $f.parent.content.size };
}
/** The tree the app computes from the block's current Markdown (contract §3.3: `ctl.markdown()`). */
async function ctlTree(ctl: Ctl, noteTitle: string): Promise<any> {
  const { mindmapTree } = await import('@tegg/doc');
  return mindmapTree(ctl.markdown(), noteTitle);
}
async function bodyOf(text: string): Promise<string> {
  const { parse } = await import('@tegg/doc');
  return text.slice(parse(text).bodyStart);
}
async function rawBlocks(text: string): Promise<string[]> {
  const { parse } = await import('@tegg/doc');
  return parse(text).blocks.map((b) => b.raw);
}
async function treeOf(raw: string, title: string): Promise<any> {
  const { mindmapTree } = await import('@tegg/doc');
  return mindmapTree(raw, title);
}
const PRAZDNA = () => fx('Pages/Prázdná.md');
const PREVODY = () => fx('Pages/Převody.md');
const ROZBALENI = () => fx('Pages/Rozbalení.md');
const VYJEZD = () => fx('Pages/Výjezd 2026.md');
const DESET = () => readFileSync(resolve(REPO, 'tests/fixtures/vaults/editor/Pages/Deset bloků.md'), 'utf8');

// ------------------------------------------------------------------------------------------------ FR-MMP-01 AC-1

test('fr_mmp_01_ac1_insert_mindmap_writes_w1_then_w1a_and_w1b', async () => {
  const log = fresh();
  const orig = PRAZDNA();
  const ed = await openMm(orig, log);
  caretIn(ed, 0);
  assert.equal(ed.commands.insertBlock('mindmap'), true, 'insertBlock(\'mindmap\') runs');
  assert.ok(ancestors(ed).includes('listItem') && ancestors(ed).includes('callout'), `caret in the single empty item: ${ancestors(ed).join(' > ')}`);
  assert.equal(caretText(ed).text, '', 'the item is empty');
  assert.equal(log.ctls.length, 1, 'the app is asked to draw one map (EditorUi.mindmap)');
  assert.equal(log.ctls[0].view(), 'list', 'a new mindmap starts in List (D-776)');
  assert.equal(await saved(ed), touched(orig) + '> [!mindmap]\n', 'W1: the title line alone, never an empty item (D-765)');
  type(ed, 'Výlet do Brna');
  assert.equal(await saved(ed), touched(orig) + '> [!mindmap]\n> - Výlet do Brna\n', 'W1a');
  press(ed, 'Enter');
  press(ed, 'Tab');
  type(ed, 'Doprava');
  assert.equal(await saved(ed), touched(orig) + '> [!mindmap]\n> - Výlet do Brna\n>   - Doprava\n', 'W1b');
  const t = await ctlTree(log.ctls[log.ctls.length - 1], 'Prázdná');
  assert.equal(t?.root?.kind, 'item', 'the map below the list: root item');
  assert.equal(t.root.item.children.length, 1, 'with one child (AP-737: the live map)');
});

test('fr_mmp_01_ac1_slash_mindmap_after_a_paragraph_with_text', async () => {
  const orig = PRAZDNA() + 'Text /mindmap\n';
  const ed = await openMm(orig);
  caretAfter(ed, 'Text /mindmap');
  const from = ed.view.state.selection.from;
  assert.equal(ed.commands.slashInsert(from - '/mindmap'.length, from, 'mindmap'), true, 'slashInsert(\'mindmap\') runs');
  assert.equal(await saved(ed), touched(PRAZDNA()) + 'Text\n\n> [!mindmap]\n', '`/mindmap` removed, the block inserted after that paragraph (FR-EDT-03 AC-4)');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-01 AC-2, AC-3

test('fr_mmp_01_ac2_turn_into_mindmap_wraps_a_list_w2_w3', async () => {
  for (const [k, before, after] of [
    [1, '* Kořen\n    * Větev s odsazením čtyř mezer\n* Druhý', '> [!mindmap]\n> * Kořen\n>     * Větev s odsazením čtyř mezer\n> * Druhý'],
    [2, '1) První krok\n2) Druhý krok', '> [!mindmap]\n> 1) První krok\n> 2) Druhý krok'],
  ] as const) {
    const log = fresh();
    const orig = PREVODY();
    const ed = await openMm(orig, log);
    caretIn(ed, k);
    assert.equal(ed.commands.turnInto('mindmap'), true, `turnInto('mindmap') on block ${k + 1}`);
    assert.equal(await saved(ed), touched(sw(orig, before, after)), `W${k + 1}: only the block changes (and modified)`);
    assert.ok(log.ctls.length >= 1, 'the app is asked to draw the map');
    assert.equal((await ctlTree(log.ctls[log.ctls.length - 1], 'Převody'))?.root?.kind, 'synthesized', 'the map: synthesized root');
  }
});

test('fr_mmp_01_ac3_turn_into_mindmap_on_text_blocks_w4_w5', async () => {
  const orig = PREVODY();
  let ed = await openMm(orig);
  caretIn(ed, 0);
  assert.equal(ed.commands.turnInto('mindmap'), true, 'turnInto(\'mindmap\') on block 1');
  assert.equal(await saved(ed), touched(sw(orig, 'Úvodní odstavec.', '> [!mindmap]\n> - Úvodní odstavec.')), 'W4');
  ed = await openMm(orig);
  assert.equal(ed.commands.selectBlockRange(3, 5), true, 'block selection 4–6');
  assert.equal(ed.commands.turnInto('mindmap'), true, 'turnInto(\'mindmap\') on the selection');
  const out = await saved(ed);
  assert.equal(out, touched(sw(orig, '## Nadpis jedna\n\nOdstavec dva.\n\nOdstavec tři.', '> [!mindmap]\n> - Nadpis jedna\n> - Odstavec dva.\n> - Odstavec tři.')), 'W5: one block, the gaps to blocks 3 and 7 kept');
  assert.equal((await rawBlocks(out ?? '')).length, 6, 'eight blocks become six');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-01 AC-4

test('fr_mmp_01_ac4_unwrap_w6_w7_w8_w8a', async () => {
  const orig = ROZBALENI();
  const b1 = '> [!mindmap] Titulek mapy\n> * Kořen\n>     * Větev';
  const b2 = '> [!mindmap]\n> 1. Jedna\n> 2. Dvě';
  const cases: [string, number, (e: Ed) => boolean, string, string][] = [
    ['W6', 0, (e) => e.commands.turnInto('bulletList'), b1, 'Titulek mapy\n\n* Kořen\n    * Větev'],
    ['W7', 0, (e) => e.commands.setCalloutType('note'), b1, '> [!note] Titulek mapy\n> * Kořen\n>     * Větev'],
    ['W8', 1, (e) => e.commands.turnInto('orderedList'), b2, '1. Jedna\n2. Dvě'],
    ['W8a', 1, (e) => e.commands.turnInto('bulletList'), b2, '- Jedna\n- Dvě'],
  ];
  const bad: string[] = [];
  for (const [w, k, act, before, after] of cases) {
    const ed = await openMm(orig);
    caretIn(ed, k, 'start');
    if (k === 0) caretAfter(ed, 'Kořen');
    else caretAfter(ed, 'Jedna');
    if (!act(ed)) { bad.push(`${w}: the command returned false`); continue; }
    const out = await saved(ed);
    if (out !== touched(sw(orig, before, after))) bad.push(`${w}: ${JSON.stringify(out && (await bodyOf(out)))}`);
  }
  assert.deepEqual(bad, [], 'W6…W8a exactly; nothing else but modified');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-01 AC-5, AC-6 (L1)

test('fr_mmp_01_ac6_each_write_is_one_undo_step', async () => {
  const deset = DESET();
  const tipIndex = (await rawBlocks(deset)).findIndex((r) => r.startsWith('> [!tip]+ Tip'));
  assert.ok(tipIndex >= 0, 'fixture: Deset bloků has the [!tip]+ callout');
  type Step = [string, string, (e: Ed) => boolean];
  const steps: Step[] = [
    ['W1', PRAZDNA(), (e) => { caretIn(e, 0); return e.commands.insertBlock('mindmap'); }],
    ['W2', PREVODY(), (e) => { caretIn(e, 1); return e.commands.turnInto('mindmap'); }],
    ['W3', PREVODY(), (e) => { caretIn(e, 2); return e.commands.turnInto('mindmap'); }],
    ['W4', PREVODY(), (e) => { caretIn(e, 0); return e.commands.turnInto('mindmap'); }],
    ['W5', PREVODY(), (e) => e.commands.selectBlockRange(3, 5) && e.commands.turnInto('mindmap')],
    ['W6', ROZBALENI(), (e) => { caretAfter(e, 'Kořen'); return e.commands.turnInto('bulletList'); }],
    ['W7', ROZBALENI(), (e) => { caretAfter(e, 'Kořen'); return e.commands.setCalloutType('note'); }],
    ['W8', ROZBALENI(), (e) => { caretAfter(e, 'Jedna'); return e.commands.turnInto('orderedList'); }],
    ['W10', deset, (e) => { caretIn(e, tipIndex); return e.commands.setCalloutType('mindmap'); }],
  ];
  const bad: string[] = [];
  for (const [w, text, act] of steps) {
    for (const afterSave of [false, true]) {
      const ed = await openMm(text);
      const body0 = await bodyOf(ed.text());
      if (!act(ed)) { bad.push(`${w}: the command returned false`); break; }
      const body1 = await bodyOf(ed.text());
      if (body1 === body0) { bad.push(`${w}: changed nothing`); break; }
      if (afterSave) await saved(ed);
      ed.commands.undo();
      const u = await bodyOf(ed.text());
      if (u !== body0) bad.push(`${w}${afterSave ? ' after its save' : ''}: ⌘Z gives ${JSON.stringify(u)}`);
      ed.commands.redo();
      const r = await bodyOf(ed.text());
      if (r !== body1) bad.push(`${w}${afterSave ? ' after its save' : ''}: ⇧⌘Z gives ${JSON.stringify(r)}`);
    }
  }
  assert.deepEqual(bad, [], 'one undo step each, redo re-applies to the same bytes');
});

test('fr_mmp_01_ac6_switching_map_and_list_is_not_an_undo_step', async () => {
  const orig = PREVODY();
  const ed = await openMm(orig);
  const body0 = await bodyOf(ed.text());
  caretIn(ed, 1);
  assert.equal(ed.commands.turnInto('mindmap'), true, 'W2');
  await saved(ed);
  caretAfter(ed, 'Druhý');
  assert.equal(ed.commands.mindmapView('list'), true, 'List');
  assert.equal(ed.commands.mindmapView('map'), true, 'Map');
  ed.commands.undo();
  assert.equal(await bodyOf(ed.text()), body0, '⌘Z after List, Map still undoes W2');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-01 AC-7 (L1)

test('fr_mmp_01_ac7_where_turn_into_mindmap_is_offered', async () => {
  const ed = await openMm(PREVODY());
  const got: string[] = [];
  for (let k = 0; k < 8; k++) {
    caretIn(ed, k);
    got.push(`${k + 1}:${ed.commands.canTurnIntoMindmap()}`);
  }
  assert.deepEqual(got, ['1:yes', '2:yes', '3:yes', '4:yes', '5:yes', '6:yes', '7:no', '8:no'], 'blocks 1–6 yes; quote and code no (D-768)');
  const sel = (a: number, b: number) => { ed.commands.selectBlockRange(a, b); return ed.commands.canTurnIntoMindmap(); };
  assert.deepEqual([sel(3, 5), sel(1, 2), sel(0, 1)], ['yes', 'disabled', 'disabled'], 'selection 4–6 yes; 2–3 (two lists) and 1–2 (paragraph and list) disabled');
  const r = await openMm(fx('Pages/Rozpoznání.md'));
  caretAfter(r, 'Jen text');
  assert.equal(r.commands.canTurnIntoMindmap(), 'no', 'a callout uses Callout type');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-01 AC-9 (L1)

test('fr_mmp_01_ac9_title_edits_change_only_the_first_line_w9_to_w9d', async () => {
  const bad: string[] = [];
  const check = async (w: string, text: string, edit: (e: Ed) => void, from: string, to: string, log = fresh()) => {
    const ed = await openMm(text, log);
    edit(ed);
    const out = await saved(ed);
    if (out !== touched(sw(text, from, to))) bad.push(`${w}: ${JSON.stringify(out)}`);
    return ed;
  };
  await check('W9', VYJEZD(), (e) => { caretIn(e, 1); type(e, ' – plán'); }, '> [!mindmap] Výjezd 2026\n', '> [!mindmap] Výjezd 2026 – plán\n');
  const log = fresh();
  const bez = fx('Pages/Bez titulku.md');
  const ed = await check('W9a', bez, (e) => { caretIn(e, 0, 'start'); type(e, 'Roční období'); }, '> [!mindmap]\n', '> [!mindmap] Roční období\n', log);
  const last = log.ctls[log.ctls.length - 1];
  assert.ok(last, 'the app draws the map of Bez titulku');
  assert.deepEqual((await ctlTree(last!, 'Bez titulku'))?.root, { kind: 'synthesized', text: 'Roční období' }, 'W9a: the map\'s root is the new title (AP-732)');
  // The title's text is deleted (in jsdom a Backspace key deletes no characters: that is the browser's own editing).
  { const st = ed.view.state; const { $from } = st.selection; ed.view.dispatch(st.tr.delete($from.start(), $from.end())); }
  const w9b = await saved(ed);
  if (w9b !== touched(bez)) bad.push(`W9b: ${JSON.stringify(w9b)}`);
  const slozene = fx('Pages/Složené.md');
  await check('W9c', slozene, (e) => {
    caretAfter(e, 'Složená mapa', true);
    const { from } = e.view.state.selection;
    e.view.dispatch(e.view.state.tr.insertText('Nová', from, from + 'Složená mapa'.length));
  }, '> [!mindmap]- Složená mapa\n', '> [!mindmap]- Nová\n');
  await check('W9d', fx('Pages/Rozpoznání.md'), (e) => { caretAfter(e, 'Velké písmeno'); type(e, ' B'); }, '> [!Mindmap] Velké písmeno\n', '> [!Mindmap] Velké písmeno B\n');
  assert.deepEqual(bad, [], 'W9…W9d exactly; nothing else but modified');
});

test('fr_mmp_01_ac9_enter_in_the_title_moves_to_the_first_item', async () => {
  const ed = await openMm(VYJEZD());
  caretIn(ed, 1);
  assert.equal(ed.commands.mindmapView('list'), true, 'List view');
  caretIn(ed, 1); // FR-UX-03 AC-15: switching to List puts the caret in the root item; back to the title
  press(ed, 'Enter');
  assert.ok(ancestors(ed).includes('listItem'), `⏎ in the title: the caret is in the first item (${ancestors(ed).join(' > ')})`);
  assert.equal(caretText(ed).text, 'Výjezd 2026', 'the first item');
  assert.equal(await ed.save(), null, '⏎ in the title writes nothing (single line)');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-5 (L1)

test('fr_mmp_02_ac5_a_node_click_puts_the_caret_at_the_end_of_the_item', async () => {
  const log = fresh();
  const orig = VYJEZD();
  const ed = await openMm(orig, log);
  assert.equal(log.ctls.length, 1, 'one map for Výjezd\'s block');
  const ctl = log.ctls[0];
  assert.equal(ctl.view(), 'map', 'opens in Map (D-684)');
  assert.equal(ctl.readOnly, false, 'editable note');
  ctl.onNode([0, 0]); // slice MM2 (D-788): a click no longer switches the view; the caret rule stays
  assert.deepEqual(caretText(ed), { text: 'Program', atEnd: true }, 'caret at the end of Program (D-776)');
  console.log('C0', log.ctls.length); type(ed, ' a cíle'); console.log('C1', log.ctls.length);
  assert.equal(await saved(ed), touched(sw(orig, '>   - Program\n', '>   - Program a cíle\n')), 'typing saves only that line'); console.log('C2', log.ctls.length);
  (globalThis as any).__MMDBG = 1; ctl.onNode([0]); (globalThis as any).__MMDBG = 0;
  assert.deepEqual(caretText(ed), { text: 'Výjezd 2026', atEnd: true }, 'the root item: end of that item');
  const vk = fresh();
  const e2 = await openMm(fx('Pages/Více kořenů.md'), vk);
  vk.ctls[0].onNode(null);
  assert.deepEqual(caretText(e2), { text: 'Témata', atEnd: true }, 'a title root: the caret at the end of the title (AP-732)');
  const bt = fresh();
  const e3 = await openMm(fx('Pages/Bez titulku.md'), bt);
  bt.ctls[0].onNode(null);
  assert.deepEqual(caretText(e3), { text: 'Jaro', atEnd: false }, 'a note-title root: the start of the first item (AP-732)');
  assert.equal(e3.view.state.selection.$from.parentOffset, 0, 'at the start');
});

test('fr_mmp_02_ac5_mindmap_view_command_switches_the_block_with_the_caret', async () => {
  const log = fresh();
  const ed = await openMm(VYJEZD(), log);
  caretAfter(ed, 'Plán výjezdu');
  assert.equal(ed.commands.mindmapView('list'), false, 'outside a mindmap: false');
  caretAfter(ed, 'Doprava');
  assert.equal(ed.commands.mindmapView('list'), true, 'in the mindmap: true');
  assert.equal(log.ctls[0]?.view(), 'list');
  assert.equal(ed.commands.mindmapView('map'), true);
  assert.equal(log.ctls[0]?.view(), 'map');
  assert.equal(await ed.save(), null, 'switching writes nothing (D-684)');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-18 (b) (L1)

test('fr_mmp_02_ac18_b_obsidian_tabs_read_back_to_the_same_tree', async () => {
  const orig = fx('Pages/Z Obsidianu.md');
  const ed = await openMm(orig);
  caretAfter(ed, 'List');
  type(ed, ' nový');
  const out = await saved(ed);
  assert.ok(out, 'the edit is saved');
  const [before] = await rawBlocks(orig);
  const [after] = await rawBlocks(out!);
  const head = orig.slice(0, orig.indexOf(before));
  assert.equal(out!.slice(0, head.length).replace(/^modified: .*$/m, ''), touched(head).replace(/^modified: .*$/m, ''), 'bytes before the callout unchanged (but modified)');
  assert.equal(out!.slice(out!.indexOf(after) + after.length), orig.slice(orig.indexOf(before) + before.length), 'bytes after the callout unchanged');
  const t0 = await treeOf(before, 'Z Obsidianu');
  const t1 = await treeOf(after, 'Z Obsidianu');
  assert.ok(t0 && t1, 'both callouts are mindmaps');
  const texts = (t: any): string[] => { const o: string[] = []; const w = (it: any[], l: number) => it.forEach((i) => { o.push(`${l}:${i.inline.map((r: any) => r.text ?? r.target ?? '').join('')}`); w(i.children, l + 1); }); w(t.items, 1); return o; };
  assert.deepEqual(texts(t1), ['1:Kořen', '2:Větev s tabulátorem', '3:List nový'], 'the same tree with `List nový` (AP-727)');
  caretAfter(ed, 'Kořen');
  type(ed, '!');
  const second = await saved(ed);
  const l1 = out!.split('\n');
  const l2 = (second ?? '').split('\n');
  const diff = l1.map((l, i) => (l === l2[i] ? null : i)).filter((i) => i !== null && !/^modified:/.test(l1[i!]));
  assert.equal(diff.length, 1, `a second edit changes only the edited line: ${JSON.stringify(diff.map((i) => [l1[i!], l2[i!]]))}`);
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-22 (L1)

test('fr_mmp_02_ac22_enter_on_an_empty_top_level_item_leaves_the_block', async () => {
  const orig = fx('Pages/Více kořenů.md');
  const ed = await openMm(orig);
  caretAfter(ed, 'Zdraví');
  press(ed, 'Enter');
  assert.ok(ancestors(ed).includes('listItem'), '⏎ creates an empty top-level item');
  press(ed, 'Enter');
  assert.deepEqual(ancestors(ed), ['paragraph'], `⏎ in it: a new empty top-level paragraph after the block (${ancestors(ed).join(' > ')})`);
  assert.equal(ed.view.state.doc.childCount, 2, 'the mindmap block and the new paragraph');
  assert.equal(await ed.save(), null, 'the file is unchanged');
});

test('fr_mmp_02_ac22_shift_tab_on_a_top_level_item_changes_nothing', async () => {
  const orig = fx('Pages/Více kořenů.md');
  const ed = await openMm(orig);
  caretAfter(ed, 'Rodina');
  const before = ed.view.state.doc.toJSON();
  press(ed, 'Tab', { shift: true });
  assert.deepEqual(ed.view.state.doc.toJSON(), before, '⇧Tab in Rodina changes nothing (D-772)');
  assert.equal(await ed.save(), null, 'nothing written');
});

test('fr_mmp_02_ac22_backspace_in_the_only_empty_item_gives_an_empty_paragraph', async () => {
  const orig = PRAZDNA();
  const ed = await openMm(orig);
  caretIn(ed, 0);
  assert.equal(ed.commands.insertBlock('mindmap'), true, 'W1');
  assert.ok(ancestors(ed).includes('listItem'), 'caret in the empty item');
  const depth = ed.historyDepth();
  press(ed, 'Backspace');
  assert.deepEqual(ancestors(ed), ['paragraph'], 'the block is an empty paragraph again');
  assert.equal(ed.view.state.doc.childCount, 1, 'one block');
  assert.equal(await bodyOf(ed.text()), '', 'the body is empty again');
  assert.equal(ed.historyDepth(), depth + 1, 'one undo step');
});

test('fr_mmp_02_ac22_a_code_block_nests_in_an_item_and_the_block_stays_a_mindmap', async () => {
  const log = fresh();
  const orig = fx('Pages/Více kořenů.md');
  const ed = await openMm(orig, log);
  caretAfter(ed, 'Porady');
  press(ed, 'Enter');
  const from = ed.view.state.selection.from;
  type(ed, '/code');
  assert.equal(ed.commands.slashInsert(from, from + 5, 'codeBlock'), true, '/code in a new line of the item');
  type(ed, 'x');
  const out = await saved(ed);
  const { parse } = await import('@tegg/doc');
  assert.deepEqual(parse(out ?? '').blocks.map((b) => b.kind), ['mindmap'], 'still a mindmap block (never a hint callout)');
  const t = await treeOf(parse(out ?? '').blocks[0]?.raw ?? '', 'Více kořenů');
  const porady = t?.items?.[1]?.children?.[0];
  assert.equal(porady?.more, true, 'the map shows `Porady …`');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-01 AC-2 guard

test('fr_fmt_05_ac4_editor_loads_mindmaps_as_editable_callouts_and_the_mermaid_fence_read_only', async () => {
  const log = fresh();
  const ed = await openMm(VYJEZD(), log);
  assert.deepEqual(ed.readonlyBlocks(), [], 'Výjezd: no read-only block (a mindmap is an editable callout)');
  assert.equal(ed.view.state.doc.child(1).type.name, 'callout', 'the mindmap block loads as the callout node');
  assert.equal(log.ctls.length, 1, 'and asks the app for its map');
  const r = fresh();
  const rz = await openMm(fx('Pages/Rozpoznání.md'), r);
  assert.equal(r.ctls.length, 4, 'Rozpoznání: maps for (5), (6), (9) and (10) only (R90)');
  assert.equal(rz.readonlyBlocks().length, 0, 'no read-only block');
  const m = await openMm(fx('Pages/Mermaid.md'));
  assert.deepEqual(m.readonlyBlocks(), [1], 'Mermaid: the `mindmap` fence is the only read-only source block');
  assert.equal(await m.save(), null, 'loading writes nothing');
});
