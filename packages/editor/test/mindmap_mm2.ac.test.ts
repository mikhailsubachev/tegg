// Slice MM2, L1: the @tegg/editor side of editing on the map and the layouts, with real ProseMirror transactions and
// the save path through the real @tegg/doc (docs/acceptance/mindmap.md part two, R95, R98; contract
// docs/contracts/mm-mindmap.md §6.3). FR-MMP-02 AC-23 (`ctl.edit`: W15, W15a, W15b, W16, W17, W17a, W18, W19, W20,
// W21, W22 bytes; the impossible `remove` / `move` cases return null and write nothing), AC-24 (`source()` values; an
// unchanged `setText` writes nothing), AC-25 (`insert` with an empty markdown returns null and writes nothing), AC-26
// (one undo step each, the view stays Map), AC-29 (`commands.mindmapLayout`: W12…W12d, W13, false outside a mindmap and
// when already so), AC-31 (`ctl.layout()`; `ctl.edit === null` when the editor is not editable), and the changed AC-5
// (D-794: `mindmapView('list')` with a focused node puts the caret at the end of that item).
// Fixture: tests/fixtures/vaults/mindmap (read only). Written from the ACs and the contract only (D-61); the stubs leave
// `ctl.edit` and `ctl.layout` unset and `mindmapLayout` returns false, so every test fails on an assertion (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextSelection } from '@tiptap/pm/state';
import { blockStart, editorModule, NOW, newId, REPO, type TeggEditor } from './helpers';

const fx = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/mindmap', rel), 'utf8');
const nfc = (s: string) => s.normalize('NFC');
const touched = (text: string) => text.replace(/^modified: .*$/m, `modified: ${NOW}`);
function sw(text: string, from: string, to: string): string {
  const i = text.indexOf(from);
  assert.ok(i >= 0 && text.indexOf(from, i + 1) < 0, `fixture text holds ${JSON.stringify(from)} exactly once`);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

type Edit = {
  source(path: number[]): string | null;
  setText(path: number[], markdown: string): boolean;
  insert(at: number[] | null, where: 'sibling' | 'child', markdown: string): number[] | null;
  remove(path: number[]): number[] | null;
  move(path: number[], dir: 'up' | 'down' | 'in' | 'out'): number[] | null;
  undo(): boolean;
  redo(): boolean;
};
type Ctl = {
  markdown: () => string; view: () => 'map' | 'list'; onNode: (p: number[] | null) => void; onLink: (t: string) => void; readOnly: boolean;
  layout?: () => 'right' | 'spider'; edit?: Edit | null;
};
type Handle = { update(o?: { now?: boolean }): void; focusTree(): void; destroy(): void; focusedNode(): number[] | null | undefined };
type Log = { ctls: Ctl[]; handles: Handle[]; updates: number; focused: number[] | null | undefined };
const fresh = (): Log => ({ ctls: [], handles: [], updates: 0, focused: undefined });

function ui(log: Log) {
  const state = new Map<string, 'map' | 'list'>();
  return {
    resolve: () => ({ kind: 'note' as const, path: 'Pages/Lisabon.md', type: 'page', title: 'Lisabon' }),
    unresolved: (t: string) => `No note named ${t}`,
    sourceBlock: 'Source block',
    hint: 'Type / for commands',
    placeholder: (kind: string, value: string) => ({ name: `${kind} ${value}`, text: value }),
    onLink: () => {},
    onTag: () => {},
    onExternal: () => {},
    mindmap: (_dom: HTMLElement, ctl: Ctl) => {
      log.ctls.push(ctl);
      const h: Handle = { update: () => { log.updates++; }, focusTree: () => {}, destroy: () => {}, focusedNode: () => log.focused };
      log.handles.push(h);
      return h;
    },
    mindmapState: { get: (k: string) => state.get(k), set: (k: string, v: 'map' | 'list') => { state.set(k, v); } },
  };
}

type Ed = TeggEditor & {
  text(): string;
  historyDepth(): number;
  commands: TeggEditor['commands'] & { mindmapView(v: 'map' | 'list'): boolean; mindmapLayout(l: 'right' | 'spider'): boolean };
};
async function openMm(text: string, log: Log = fresh(), extra: Record<string, unknown> = {}): Promise<Ed> {
  const m = await editorModule();
  return (m.createEditor as any)({ text, now: () => NOW, newId, ui: ui(log), ...extra }) as Ed;
}
async function saved(ed: Ed): Promise<string | null> {
  const out = await ed.save();
  if (out !== null) ed.markSaved(out);
  return out;
}
/** The ctl of the mindmap block the app would draw (the last one asked for). */
function ctlOf(log: Log): Ctl {
  assert.ok(log.ctls.length >= 1, 'the app is asked to draw the map (EditorUi.mindmap)');
  return log.ctls[log.ctls.length - 1];
}
/** `ctl.edit` as the contract's MindmapEdit (an assertion when the stub leaves it unset or null on an editable note). */
function editOf(log: Log): Edit {
  const ctl = ctlOf(log);
  assert.equal(ctl.readOnly, false, 'an editable note');
  const e = ctl.edit;
  assert.ok(e && typeof e.insert === 'function' && typeof e.setText === 'function' && typeof e.remove === 'function' && typeof e.move === 'function' && typeof e.source === 'function' && typeof e.undo === 'function' && typeof e.redo === 'function', 'ctl.edit is a MindmapEdit on an editable note (mm-mindmap §6.3)');
  return e!;
}
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
function caretIn(ed: Ed, k: number) {
  const start = blockStart(ed, k);
  const node = ed.view.state.doc.child(k);
  let target: number | null = null;
  node.descendants((n: any, p: number) => {
    if (target !== null) return false;
    if (n.isTextblock) { target = start + 1 + p + 1 + n.content.size; return false; }
    return true;
  });
  if (node.isTextblock) target = start + node.nodeSize - 1;
  assert.ok(target !== null, `block ${k} has a text position`);
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.near(ed.view.state.doc.resolve(target!))));
}
function caretText(ed: Ed): { text: string; atEnd: boolean } {
  const $f = ed.view.state.selection.$from;
  return { text: nfc($f.parent.textContent), atEnd: $f.parentOffset === $f.parent.content.size };
}
async function bodyOf(text: string): Promise<string> {
  const { parse } = await import('@tegg/doc');
  return text.slice(parse(text).bodyStart);
}

const VYJEZD = () => fx('Pages/Výjezd 2026.md');
const VICE = () => fx('Pages/Více kořenů.md');
const UZLY = () => fx('Pages/Uzly.md');
const PAVOUK = () => fx('Pages/Pavouk.md');
const NEZNAMA = () => fx('Pages/Neznámé metadata.md');
const METADATA = () => fx('Pages/Metadata.md');
const SLOZENE = () => fx('Pages/Složené.md');
const NAKUP = () => fx('Pages/Nákup.md');

const VY = {
  l3to8: '>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>   - Místo\n>     - [[Lisabon]]\n>   - Doprava\n',
};
/** R98: W15…W22 through `ctl.edit` (fixture, note title, the call, the path it returns, bytes before → after). */
type W = [string, () => string, (e: Edit) => number[] | boolean | null, number[] | boolean, string, string];
const WRITES: W[] = [
  ['W15', VYJEZD, (e) => e.insert([0, 2], 'sibling', 'Ubytování'), [0, 3], '>   - Doprava\n', '>   - Doprava\n>   - Ubytování\n'],
  ['W15a', VYJEZD, (e) => e.insert([0], 'sibling', 'Nocleh'), [0, 0], '> - Výjezd 2026\n', '> - Výjezd 2026\n>   - Nocleh\n'],
  ['W15b', VICE, (e) => e.insert(null, 'sibling', 'Spánek'), [3], '> - Zdraví\n', '> - Zdraví\n> - Spánek\n'],
  ['W16', VYJEZD, (e) => e.insert([0, 2], 'child', 'Vlak'), [0, 2, 0], '>   - Doprava\n', '>   - Doprava\n>     - Vlak\n'],
  ['W17', VYJEZD, (e) => e.setText([0, 0, 1], 'Plán 2027 v2'), true, '>     - Plán 2027\n', '>     - Plán 2027 v2\n'],
  ['W17a', VYJEZD, (e) => e.setText([0, 1, 0], '[[Lisabon]] město'), true, '>     - [[Lisabon]]\n', '>     - [[Lisabon]] město\n'],
  ['W18', VYJEZD, (e) => e.remove([0, 0, 1]), [0, 0, 0], '>     - Plán 2027\n', ''],
  ['W19', VYJEZD, (e) => e.move([0, 0], 'down'), [0, 1], VY.l3to8, '>   - Místo\n>     - [[Lisabon]]\n>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>   - Doprava\n'],
  ['W20', VYJEZD, (e) => e.move([0, 1], 'in'), [0, 0, 2], '>   - Místo\n>     - [[Lisabon]]\n', '>     - Místo\n>       - [[Lisabon]]\n'],
  ['W21', VYJEZD, (e) => e.move([0, 0, 0], 'out'), [0, 1], '>     - Přehled Q4\n>     - Plán 2027\n>   - Místo\n', '>     - Plán 2027\n>   - Přehled Q4\n>   - Místo\n'],
  ['W22', UZLY, (e) => e.setText([0, 6], 'Odstavec navíc x'), true, '>   - Odstavec navíc\n>\n>     Druhý odstavec', '>   - Odstavec navíc x\n>\n>     Druhý odstavec'],
];

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-23 (L1)

test('fr_mmp_02_ac23_edit_calls_write_w15_to_w22_exactly', async () => {
  const bad: string[] = [];
  for (const [w, text, act, wantRet, before, after] of WRITES) {
    const log = fresh();
    const orig = text();
    const ed = await openMm(orig, log);
    let e: Edit;
    try { e = editOf(log); } catch (err) { bad.push(`${w}: ${(err as Error).message}`); continue; }
    const updates0 = log.updates;
    const ret = act(e);
    if (JSON.stringify(ret) !== JSON.stringify(wantRet)) { bad.push(`${w}: returned ${JSON.stringify(ret)}, want ${JSON.stringify(wantRet)}`); continue; }
    const out = await saved(ed);
    const want = touched(sw(orig, before, after));
    if (out !== want) bad.push(`${w}: saved ${JSON.stringify(out && (await bodyOf(out)))}`);
    if (ctlOf(log).view() !== 'map') bad.push(`${w}: the view is ${ctlOf(log).view()}, not map`);
    if (log.updates <= updates0) bad.push(`${w}: handle.update() was not called at once after the edit`);
  }
  assert.deepEqual(bad, [], 'R98 bytes: only the named lines (and modified) change; the view stays Map; the map is updated at once');
});

test('fr_mmp_02_ac23_impossible_remove_and_move_return_null_and_write_nothing', async () => {
  const log = fresh();
  const ed = await openMm(VYJEZD(), log);
  const e = editOf(log);
  const depth = ed.historyDepth();
  const got = {
    'remove Program (has children)': e.remove([0, 0]),
    'remove the root': e.remove([0]),
    'remove a missing path': e.remove([0, 9]),
    'up on Program (first)': e.move([0, 0], 'up'),
    'down on Doprava (last)': e.move([0, 2], 'down'),
    'in on Program (first child)': e.move([0, 0], 'in'),
    'out on Program (first-level)': e.move([0, 0], 'out'),
    'up on the root': e.move([0], 'up'),
    'out on the root': e.move([0], 'out'),
    'in on the root': e.move([0], 'in'),
    'move a missing path': e.move([0, 9], 'down'),
    'setText on a missing path': e.setText([0, 9], 'x'),
  };
  assert.deepEqual(got, Object.fromEntries(Object.keys(got).map((k) => [k, k.startsWith('setText') ? false : null])), 'null (false for setText) for every impossible edit (D-787)');
  assert.equal(await ed.save(), null, 'nothing written');
  assert.equal(ed.historyDepth(), depth, 'no undo step');
  const vk = fresh();
  const e2 = await openMm(VICE(), vk);
  const edit2 = editOf(vk);
  assert.equal(edit2.remove([1]), null, 'Práce has a child: null');
  assert.deepEqual(edit2.remove([1, 0]), [1], 'Porady (no children): removed, the focus goes to its parent (no previous sibling)');
  assert.equal(await saved(e2), touched(sw(VICE(), '>   - Porady\n', '')), 'only that line (and modified)');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-24 (L1)

test('fr_mmp_02_ac24_source_is_the_first_paragraphs_markdown', async () => {
  const log = fresh();
  const ed = await openMm(VYJEZD(), log);
  const e = editOf(log);
  assert.equal(e.source([0, 0, 1]), 'Plán 2027', 'Plán 2027');
  assert.equal(e.source([0, 1, 0]), '[[Lisabon]]', 'the link as written');
  assert.equal(e.source([0]), 'Výjezd 2026', 'the root item');
  assert.equal(e.source([0, 9]), null, 'a missing path');
  assert.equal(e.setText([0, 0, 1], 'Plán 2027'), false, 'an unchanged text: false');
  assert.equal(await ed.save(), null, 'and nothing written');
  const u = fresh();
  await openMm(UZLY(), u);
  const eu = editOf(u);
  assert.equal(eu.source([0, 0]), '**Tučně**, `kód` a ==zvýraznění==', 'Uzly: the source line as written');
  assert.equal(eu.source([0, 1]), 'Odkaz na [[Lisabon]] a #cestování', 'link and tag as written');
  assert.equal(eu.source([0, 6]), 'Odstavec navíc', 'an item with more: its first paragraph only');
  assert.equal(eu.source([0, 10]), 'Řádek jedna\\\nřádek dva', 'a hard break: the paragraph source');
  const n = fresh();
  await openMm(NAKUP(), n);
  const en = editOf(n);
  assert.equal(en.source([0, 0]), 'Mléko', 'Nákup: the `[x] ` box is not part of the text');
  assert.equal(en.source([0]), 'Nákup', 'the root item without its box');
  const nf = fresh();
  await openMm(VYJEZD().normalize('NFD'), nf);
  assert.equal(editOf(nf).source([0, 0, 0]), 'Přehled Q4', 'NFC');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-25 (L1)

test('fr_mmp_02_ac25_insert_with_an_empty_markdown_returns_null_and_writes_nothing', async () => {
  const log = fresh();
  const ed = await openMm(VYJEZD(), log);
  const e = editOf(log);
  const depth = ed.historyDepth();
  assert.equal(e.insert([0, 2], 'sibling', ''), null, 'an empty sibling: null (D-795)');
  assert.equal(e.insert([0, 2], 'child', ''), null, 'an empty child: null');
  assert.equal(e.insert([0], 'sibling', ''), null, 'an empty first child of the root: null');
  assert.equal(e.insert([0, 9], 'sibling', 'Něco'), null, 'a missing path: null');
  assert.equal(await ed.save(), null, 'nothing written');
  assert.equal(ed.historyDepth(), depth, 'no undo step');
  assert.deepEqual(e.insert([0, 0], 'child', 'Rozpočet'), [0, 0, 2], 'a child of Program comes after Plán 2027 (the last child)');
  assert.equal(await saved(ed), touched(sw(VYJEZD(), '>     - Plán 2027\n', '>     - Plán 2027\n>     - Rozpočet\n')), 'the new last child');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-26 (L1)

test('fr_mmp_02_ac26_each_edit_is_one_undo_step_and_the_view_stays_map', async () => {
  type Step = [string, () => string, (ed: Ed, log: Log) => unknown];
  const steps: Step[] = [
    ['W12', VYJEZD, (ed) => { caretAfter(ed, 'Doprava'); return ed.commands.mindmapLayout('spider'); }],
    ...WRITES.filter(([w]) => ['W15', 'W16', 'W17', 'W18', 'W19', 'W20', 'W21'].includes(w)).map(([w, text, act]): Step => [w, text, (_ed, log) => act(editOf(log))]),
  ];
  const bad: string[] = [];
  for (const [w, text, act] of steps) {
    for (const afterSave of [false, true]) {
      const log = fresh();
      const ed = await openMm(text(), log);
      const body0 = await bodyOf(ed.text());
      const depth = ed.historyDepth();
      const ret = act(ed, log);
      if (ret === null || ret === false) { bad.push(`${w}: the call returned ${ret}`); break; }
      const body1 = await bodyOf(ed.text());
      if (body1 === body0) { bad.push(`${w}: changed nothing`); break; }
      if (ed.historyDepth() !== depth + 1) bad.push(`${w}: ${ed.historyDepth() - depth} undo steps`);
      if (afterSave) await saved(ed);
      const e = ctlOf(log).edit;
      const undone = e ? e.undo() : ed.commands.undo();
      if (!undone) bad.push(`${w}${afterSave ? ' after its save' : ''}: undo() returned false`);
      const u = await bodyOf(ed.text());
      if (u !== body0) bad.push(`${w}${afterSave ? ' after its save' : ''}: ⌘Z gives ${JSON.stringify(u)}`);
      if (ctlOf(log).view() !== 'map') bad.push(`${w}: the view after undo is ${ctlOf(log).view()}`);
      const redone = e ? e.redo() : ed.commands.redo();
      if (!redone) bad.push(`${w}${afterSave ? ' after its save' : ''}: redo() returned false`);
      const r = await bodyOf(ed.text());
      if (r !== body1) bad.push(`${w}${afterSave ? ' after its save' : ''}: ⇧⌘Z gives ${JSON.stringify(r)}`);
      if (ctlOf(log).view() !== 'map') bad.push(`${w}: the view after redo is ${ctlOf(log).view()}`);
    }
  }
  assert.deepEqual(bad, [], 'one undo step each; redo re-applies the same bytes; Map throughout');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-29 (L1)

test('fr_mmp_02_ac29_mindmap_layout_command_writes_w12_to_w12d_and_w13', async () => {
  const cases: [string, () => string, string, 'right' | 'spider', string, string][] = [
    ['W12', VYJEZD, 'Doprava', 'spider', '> [!mindmap] Výjezd 2026\n', '> [!mindmap|spider] Výjezd 2026\n'],
    ['W12a', PAVOUK, 'Delta', 'right', '> [!mindmap|spider] Pavouk\n', '> [!mindmap] Pavouk\n'],
    ['W12b', NEZNAMA, 'Větev', 'spider', '> [!mindmap|foo] Cizí\n', '> [!mindmap|spider] Cizí\n'],
    ['W12c', SLOZENE, 'Složená mapa', 'spider', '> [!mindmap]- Složená mapa\n', '> [!mindmap|spider]- Složená mapa\n'],
    ['W12d', METADATA, 'Tři', 'right', '> [!Mindmap|SPIDER]+ Velká písmena\n', '> [!Mindmap]+ Velká písmena\n'],
  ];
  const bad: string[] = [];
  for (const [w, text, at, to, before, after] of cases) {
    const log = fresh();
    const orig = text();
    const ed = await openMm(orig, log);
    caretAfter(ed, at);
    if (!ed.commands.mindmapLayout(to)) { bad.push(`${w}: mindmapLayout('${to}') returned false`); continue; }
    const out = await saved(ed);
    if (out !== touched(sw(orig, before, after))) bad.push(`${w}: ${JSON.stringify(out && (await bodyOf(out)))}`);
    const ctl = log.ctls.find((c) => c.markdown().startsWith(after.trimEnd())) ?? ctlOf(log);
    if (ctl.layout?.() !== to) bad.push(`${w}: ctl.layout() is ${ctl.layout?.()} after the switch`);
  }
  assert.deepEqual(bad, [], 'the switch rewrites the title line only (and modified)');
  const log = fresh();
  const orig = VYJEZD();
  const ed = await openMm(orig, log);
  caretAfter(ed, 'Doprava');
  assert.equal(ed.commands.mindmapLayout('spider'), true, 'W12');
  await saved(ed);
  assert.equal(ed.commands.mindmapLayout('right'), true, 'then right');
  assert.equal(await saved(ed), touched(orig), 'W13: byte-identical to the original (but modified)');
});

test('fr_mmp_02_ac29_mindmap_layout_is_false_outside_a_mindmap_and_when_already_so', async () => {
  const log = fresh();
  const ed = await openMm(VYJEZD(), log);
  caretAfter(ed, 'Plán výjezdu');
  assert.equal(ed.commands.mindmapLayout('spider'), false, 'outside any mindmap: false');
  caretAfter(ed, 'Poznámka pod mapou');
  assert.equal(ed.commands.mindmapLayout('right'), false, 'outside: false');
  caretAfter(ed, 'Doprava');
  assert.equal(ed.commands.mindmapLayout('right'), false, 'already right: false');
  assert.equal(await ed.save(), null, 'nothing written');
  const p = fresh();
  const pe = await openMm(PAVOUK(), p);
  caretAfter(pe, 'Delta');
  assert.equal(pe.commands.mindmapLayout('spider'), false, 'Pavouk is already spider: false');
  assert.equal(await pe.save(), null, 'nothing written');
  const m = fresh();
  const me = await openMm(METADATA(), m);
  caretAfter(me, 'Odstavec v calloutu');
  assert.equal(me.commands.mindmapLayout('spider'), false, 'an ordinary callout: false');
  assert.equal(await me.save(), null, 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-31 (L1)

test('fr_mmp_02_ac31_ctl_layout_is_the_stored_layout', async () => {
  const want: [() => string, string, ('right' | 'spider')[]][] = [
    [PAVOUK, 'Pavouk', ['spider']], [VYJEZD, 'Výjezd 2026', ['right']], [NEZNAMA, 'Neznámé metadata', ['right']], [METADATA, 'Metadata', ['spider']], [SLOZENE, 'Složené', ['right', 'right']],
  ];
  const bad: string[] = [];
  for (const [text, title, layouts] of want) {
    const log = fresh();
    await openMm(text(), log);
    const got = log.ctls.map((c) => (typeof c.layout === 'function' ? c.layout() : '<no layout()>'));
    if (JSON.stringify(got) !== JSON.stringify(layouts)) bad.push(`${title}: ${JSON.stringify(got)} ≠ ${JSON.stringify(layouts)}`);
  }
  assert.deepEqual(bad, [], 'ctl.layout() (mm-mindmap §6.3)');
});

test('fr_mmp_02_ac31_edit_is_null_when_the_editor_is_not_editable', async () => {
  const log = fresh();
  const ed = await openMm(PAVOUK(), log);
  const ctl = ctlOf(log);
  assert.equal(ctl.readOnly, false, 'an editable note: readOnly false');
  assert.ok(ctl.edit, 'and ctl.edit is set');
  assert.equal(await ed.save(), null, 'opening writes nothing');
  // A read-only editor (a read-only note, NFR-REL-03): the contract names no createEditor option for it, so the test
  // passes both `readOnly: true` and `editable: false` (an interface question in the red-test report); the map is
  // navigation only (D-786).
  const ro = fresh();
  const m = await editorModule();
  const red = (m.createEditor as any)({ text: PAVOUK(), now: () => NOW, newId, ui: ui(ro), readOnly: true, editable: false }) as Ed;
  const rctl = ctlOf(ro);
  assert.equal(rctl.readOnly, true, 'a read-only editor: readOnly true');
  assert.equal(rctl.edit, null, 'ctl.edit is null (navigation only, D-786)');
  assert.equal(rctl.layout?.(), 'spider', 'the stored layout is still drawn');
  assert.equal(await red.save(), null, 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-5 (D-794)

test('fr_mmp_02_ac5_list_with_a_focused_node_puts_the_caret_at_the_end_of_that_item', async () => {
  const log = fresh();
  const ed = await openMm(VYJEZD(), log);
  const ctl = ctlOf(log);
  assert.equal(ctl.view(), 'map', 'opens in Map');
  caretAfter(ed, 'Doprava'); // the block holding the caret (mindmapView, §3.2); the focused node comes from the handle
  log.focused = [0, 0];
  assert.equal(ed.commands.mindmapView('list'), true, 'List with Program focused');
  assert.equal(ctl.view(), 'list', 'List');
  assert.deepEqual(caretText(ed), { text: 'Program', atEnd: true }, 'the caret at the end of Program (D-794)');
  assert.equal(ed.commands.mindmapView('map'), true, 'Map');
  log.focused = [0, 1, 0];
  assert.equal(ed.commands.mindmapView('list'), true, 'List with Lisabon focused');
  assert.deepEqual(caretText(ed), { text: 'Lisabon', atEnd: true }, 'the caret at the end of the Lisabon item');
  assert.equal(ed.commands.mindmapView('map'), true, 'Map');
  log.focused = undefined;
  assert.equal(ed.commands.mindmapView('list'), true, 'List with no focused node');
  assert.deepEqual(caretText(ed), { text: 'Výjezd 2026', atEnd: true }, 'no focused node: the end of the root item (AC-6)');
  assert.equal(await ed.save(), null, 'switching writes nothing');
  const u = fresh();
  const ue = await openMm(UZLY(), u);
  caretAfter(ue, 'Obsah uzlů');
  u.focused = [0, 6];
  assert.equal(ue.commands.mindmapView('list'), true, 'List with the item with a second paragraph focused');
  assert.deepEqual(caretText(ue), { text: 'Odstavec navíc', atEnd: true }, 'the end of its first paragraph');
});
