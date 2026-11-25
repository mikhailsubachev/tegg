// Slice MM3, L1 and L2: the @tegg/editor side of drops and folds, with real ProseMirror transactions and the save path
// through the real @tegg/doc (docs/acceptance/mindmap.md part three, R231, R232; contract docs/contracts/mm-mindmap.md
// §7.3, §7.4). FR-MMP-02 AC-48 (L1 for the move command: `MindmapEdit.moveMindmapItem` writes W23…W31 and W35 exactly,
// W23…W25 byte-identical to W19…W21, one undo step, a drop that changes nothing writes nothing, the impossible drops),
// FR-MMP-02 AC-45 (the fold state of the open note: `MindmapCtl.folds` follows its item through moves, drops and undo,
// and never reaches the bytes or the history), FR-FMT-07 AC-38 (L1: W35 and a second drop change only the callout and
// the moved lines; L2: random drops on random mindmap callouts, fixed seed plus one per run). Fixture:
// tests/fixtures/vaults/mindmap (read only). Written from the ACs and the contract only (D-61); the stubs have no
// `moveMindmapItem` and no `folds`, so every test fails on an assertion (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { editorModule, NOW, newId, REPO, type TeggEditor } from './helpers';

const fx = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/mindmap', rel), 'utf8');
const touched = (text: string) => text.replace(/^modified: .*$/m, `modified: ${NOW}`);
function sw(text: string, from: string, to: string): string {
  const i = text.indexOf(from);
  assert.ok(i >= 0 && text.indexOf(from, i + 1) < 0, `fixture text holds ${JSON.stringify(from)} exactly once`);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

type Zone = 'before' | 'after' | 'child';
type Edit = {
  move(path: number[], dir: 'up' | 'down' | 'in' | 'out'): number[] | null;
  undo(): boolean;
  redo(): boolean;
  moveMindmapItem?: (from: number[], target: number[] | null, zone: Zone) => number[] | null;
};
type Folds = { folded(): (number[] | null)[]; toggle(path: number[] | null): boolean; set(path: number[] | null, folded: boolean): boolean };
type Ctl = { markdown: () => string; view: () => 'map' | 'list'; readOnly: boolean; edit?: Edit | null; folds?: Folds };
type Log = { ctls: Ctl[] };
type Ed = TeggEditor & { text(): string; historyDepth(): number };

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
      return { update: () => {}, focusTree: () => {}, destroy: () => {}, focusedNode: () => undefined };
    },
    mindmapState: { get: (k: string) => state.get(k), set: (k: string, v: 'map' | 'list') => { state.set(k, v); } },
  };
}
async function openMm(text: string, log: Log = { ctls: [] }): Promise<Ed> {
  const m = await editorModule();
  return (m.createEditor as any)({ text, now: () => NOW, newId, ui: ui(log) }) as Ed;
}
async function saved(ed: Ed): Promise<string | null> {
  const out = await ed.save();
  if (out !== null) ed.markSaved(out);
  return out;
}
function ctlOf(log: Log): Ctl {
  assert.ok(log.ctls.length >= 1, 'the app is asked to draw the map (EditorUi.mindmap)');
  return log.ctls[log.ctls.length - 1];
}
/** `ctl.edit.moveMindmapItem` (mm-mindmap §7.4); an assertion when the stub doesn't have it. */
function dropOf(log: Log): (from: number[], target: number[] | null, zone: Zone) => number[] | null {
  const e = ctlOf(log).edit;
  assert.ok(e && typeof e.moveMindmapItem === 'function', 'ctl.edit.moveMindmapItem exists (mm-mindmap §7.4)');
  return e!.moveMindmapItem!.bind(e);
}
function foldsOf(log: Log): Folds {
  const f = ctlOf(log).folds;
  assert.ok(f && typeof f.toggle === 'function' && typeof f.folded === 'function' && typeof f.set === 'function', 'ctl.folds exists (mm-mindmap §7.3)');
  return f!;
}

const VYJEZD = () => fx('Pages/Výjezd 2026.md');
const VICE = () => fx('Pages/Více kořenů.md');
const PAVOUK = () => fx('Pages/Pavouk.md');
const OBSIDIAN = () => fx('Pages/Z Obsidianu.md');

const L3_8 = '>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>   - Místo\n>     - [[Lisabon]]\n>   - Doprava\n';
const L4_8 = '>     - Přehled Q4\n>     - Plán 2027\n>   - Místo\n>     - [[Lisabon]]\n>   - Doprava\n';
const W19 = '>   - Místo\n>     - [[Lisabon]]\n>   - Program\n>     - Přehled Q4\n>     - Plán 2027\n>   - Doprava\n';
const PAV = '>   - Alfa\n>     - A1\n>     - A2\n>   - Beta\n>     - B1\n>   - Gama\n>   - Delta';

/** R232: [W, note, from, target, zone, the returned path, bytes before → after]. */
type D = [string, () => string, number[], number[] | null, Zone, number[], string, string];
const DROPS: D[] = [
  ['W23', VYJEZD, [0, 0], [0, 1], 'after', [0, 1], L3_8, W19],
  ['W24', VYJEZD, [0, 1], [0, 0], 'child', [0, 0, 2], '>   - Místo\n>     - [[Lisabon]]\n', '>     - Místo\n>       - [[Lisabon]]\n'],
  ['W25', VYJEZD, [0, 0, 0], [0, 0], 'after', [0, 1], '>     - Přehled Q4\n>     - Plán 2027\n>   - Místo\n', '>     - Plán 2027\n>   - Přehled Q4\n>   - Místo\n'],
  ['W26', VYJEZD, [0, 2], [0, 0, 0], 'before', [0, 0, 0], L3_8, '>   - Program\n>     - Doprava\n>     - Přehled Q4\n>     - Plán 2027\n>   - Místo\n>     - [[Lisabon]]\n'],
  ['W27', VYJEZD, [0, 1], [0, 0, 0], 'child', [0, 0, 0, 0], L4_8, '>     - Přehled Q4\n>       - Místo\n>         - [[Lisabon]]\n>     - Plán 2027\n>   - Doprava\n'],
  ['W28', VYJEZD, [0, 0, 0], [0], 'child', [0, 3], L3_8, '>   - Program\n>     - Plán 2027\n>   - Místo\n>     - [[Lisabon]]\n>   - Doprava\n>   - Přehled Q4\n'],
  ['W29', VICE, [1, 0], null, 'child', [3], '> - Rodina\n> - Práce\n>   - Porady\n> - Zdraví\n', '> - Rodina\n> - Práce\n> - Zdraví\n> - Porady\n'],
  ['W30', PAVOUK, [0, 2], [0, 1], 'before', [0, 1], PAV, '>   - Alfa\n>     - A1\n>     - A2\n>   - Gama\n>   - Beta\n>     - B1\n>   - Delta'],
  ['W31', PAVOUK, [0, 3], [0, 1], 'child', [0, 1, 1], PAV, '>   - Alfa\n>     - A1\n>     - A2\n>   - Beta\n>     - B1\n>     - Delta\n>   - Gama'],
  ['W35', OBSIDIAN, [0, 0, 0], [0], 'child', [0, 1], '> - Kořen\n> \t- Větev s tabulátorem\n> \t\t- List\n', '> - Kořen\n>   - Větev s tabulátorem\n>   - List\n'],
];

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-48 (L1)

test('fr_mmp_02_ac48_move_mindmap_item_writes_w23_to_w31_and_w35_exactly', async () => {
  const bad: string[] = [];
  for (const [w, text, from, target, zone, ret, before, after] of DROPS) {
    const log: Log = { ctls: [] };
    const orig = text();
    const ed = await openMm(orig, log);
    let drop;
    try { drop = dropOf(log); } catch (err) { bad.push(`${w}: ${(err as Error).message}`); continue; }
    const depth = ed.historyDepth();
    const got = drop(from, target, zone);
    if (JSON.stringify(got) !== JSON.stringify(ret)) bad.push(`${w}: returned ${JSON.stringify(got)}, want ${JSON.stringify(ret)}`);
    if (ed.historyDepth() !== depth + 1) bad.push(`${w}: ${ed.historyDepth() - depth} undo steps (one transaction)`);
    const out = await saved(ed);
    const want = touched(sw(orig, before, after));
    if (out !== want) bad.push(`${w}: saved ${JSON.stringify(out)}`);
    if (ctlOf(log).view() !== 'map') bad.push(`${w}: the view is ${ctlOf(log).view()}`);
  }
  assert.deepEqual(bad, [], 'R232: each drop saves exactly its "After" bytes (and modified), one transaction, the view stays Map');
});

test('fr_mmp_02_ac48_w23_w24_w25_equal_the_alt_moves_w19_w20_w21', async () => {
  const pairs: [string, [number[], number[] | null, Zone], [number[], 'up' | 'down' | 'in' | 'out']][] = [
    ['W23 = W19', [[0, 0], [0, 1], 'after'], [[0, 0], 'down']],
    ['W24 = W20', [[0, 1], [0, 0], 'child'], [[0, 1], 'in']],
    ['W25 = W21', [[0, 0, 0], [0, 0], 'after'], [[0, 0, 0], 'out']],
  ];
  const bad: string[] = [];
  for (const [what, d, m] of pairs) {
    const a: Log = { ctls: [] };
    const ea = await openMm(VYJEZD(), a);
    let drop;
    try { drop = dropOf(a); } catch (err) { bad.push(`${what}: ${(err as Error).message}`); continue; }
    drop(...d);
    const b: Log = { ctls: [] };
    const eb = await openMm(VYJEZD(), b);
    ctlOf(b).edit!.move(...m);
    const [x, y] = [await saved(ea), await saved(eb)];
    if (x === null || x !== y) bad.push(`${what}: ${JSON.stringify(x)} ≠ ${JSON.stringify(y)}`);
  }
  assert.deepEqual(bad, [], 'a drop writes the bytes of the ⌥ move that makes the same tree (D-766)');
});

test('fr_mmp_02_ac48_undo_and_redo_of_a_drop', async () => {
  const log: Log = { ctls: [] };
  const orig = VYJEZD();
  const ed = await openMm(orig, log);
  const drop = dropOf(log);
  assert.deepEqual(drop([0, 0], [0, 1], 'after'), [0, 1], 'W23');
  const w23 = touched(sw(orig, L3_8, W19));
  assert.equal(await saved(ed), w23, 'W23 saved');
  assert.equal(ctlOf(log).edit!.undo(), true, '⌘Z');
  assert.equal(await saved(ed), touched(orig), '⌘Z restores the original bytes in one step');
  assert.equal(ctlOf(log).edit!.redo(), true, '⇧⌘Z');
  assert.equal(await saved(ed), w23, '⇧⌘Z re-applies it');
});

test('fr_mmp_02_ac49_drops_that_change_nothing_or_are_impossible_write_nothing', async () => {
  const log: Log = { ctls: [] };
  const ed = await openMm(VYJEZD(), log);
  const drop = dropOf(log);
  const depth = ed.historyDepth();
  assert.deepEqual(drop([0, 0], [0, 1], 'before'), [0, 0], 'Program onto Místo\'s upper half: its own place, the same path back');
  assert.deepEqual(drop([0, 2], [0, 1], 'after'), [0, 2], 'Doprava after Místo: its own place');
  const impossible = {
    'Program into Přehled Q4 (its own subtree)': drop([0, 0], [0, 0, 0], 'child'),
    'Program after Plán 2027 (its own subtree)': drop([0, 0], [0, 0, 1], 'after'),
    'Program onto itself': drop([0, 0], [0, 0], 'child'),
    'the root item': drop([0], [0, 2], 'child'),
    'before the root': drop([0, 2], [0], 'before'),
    'after the root': drop([0, 2], [0], 'after'),
    'a missing path': drop([0, 9], [0, 0], 'child'),
    'a missing target': drop([0, 2], [0, 9], 'child'),
  };
  assert.deepEqual(impossible, Object.fromEntries(Object.keys(impossible).map((k) => [k, null])), 'null for every impossible drop (R231)');
  assert.equal(await ed.save(), null, 'nothing written');
  assert.equal(ed.historyDepth(), depth, 'no undo step');
  const v: Log = { ctls: [] };
  const ev = await openMm(VICE(), v);
  const dv = dropOf(v);
  assert.equal(dv([1], null, 'before'), null, 'before the synthesized root: null');
  assert.equal(dv([1], null, 'after'), null, 'after the synthesized root: null');
  assert.deepEqual(dv([2], null, 'child'), [2], 'Zdraví onto Témata: already the last top-level item, nothing changes');
  assert.equal(await ev.save(), null, 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-45 (L1: the fold state)

test('fr_mmp_02_ac45_folds_follow_their_items_and_never_reach_the_bytes_or_the_history', async () => {
  const log: Log = { ctls: [] };
  const orig = VYJEZD();
  const ed = await openMm(orig, log);
  const folds = foldsOf(log);
  const depth = ed.historyDepth();
  assert.equal(folds.toggle([0, 0]), true, 'fold Program');
  assert.equal(folds.toggle([0, 1]), true, 'fold Místo');
  assert.equal(folds.toggle([0, 2]), false, 'Doprava is a leaf: false');
  assert.equal(folds.toggle([0, 9]), false, 'a missing path: false');
  assert.deepEqual(folds.folded(), [[0, 0], [0, 1]], 'Program and Místo folded');
  assert.equal(await ed.save(), null, 'folding writes nothing');
  assert.equal(ed.historyDepth(), depth, 'a fold is no undo step');
  assert.equal(folds.toggle([0, 1]), true, 'unfold Místo');
  assert.deepEqual(folds.folded(), [[0, 0]], 'Program still folded');
  ctlOf(log).edit!.move([0, 0], 'down');
  assert.deepEqual(foldsOf(log).folded(), [[0, 1]], '⌥↓ on folded Program (W19): the fold follows the item');
  assert.equal(await saved(ed), touched(sw(orig, L3_8, W19)), 'W19\'s bytes');
  assert.equal(ctlOf(log).edit!.undo(), true, '⌘Z');
  assert.deepEqual(foldsOf(log).folded(), [[0, 0]], 'after ⌘Z the fold is back on Program at its old place');
  assert.equal(await saved(ed), touched(orig), '⌘Z undid the list edit, not the fold');
  dropOf(log)([0, 0], [0, 2], 'after');
  assert.deepEqual(foldsOf(log).folded(), [[0, 2]], 'a dragged folded node stays folded (R231)');
  const v: Log = { ctls: [] };
  await openMm(VICE(), v);
  assert.equal(foldsOf(v).toggle(null), true, 'the synthesized root Témata folds (null path)');
  assert.deepEqual(foldsOf(v).folded(), [null], 'Témata folded');
});

test('fr_mmp_02_ac45_an_external_reload_clears_the_folds', async () => {
  const log: Log = { ctls: [] };
  const orig = VYJEZD();
  const ed = await openMm(orig, log);
  assert.equal(foldsOf(log).toggle([0, 0]), true, 'fold Program');
  ed.reload(sw(orig, '>   - Doprava\n', '>   - Doprava\n>   - Hotel\n'));
  assert.deepEqual(foldsOf(log).folded(), [], 'a reload of the block from an external change shows it unfolded (AP-2115)');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-38 (L1)

test('fr_fmt_07_ac38_a_drop_rewrites_only_the_callout', async () => {
  const log: Log = { ctls: [] };
  const orig = OBSIDIAN();
  const ed = await openMm(orig, log);
  dropOf(log)([0, 0, 0], [0], 'child');
  const w35 = await saved(ed);
  const calloutWas = '> [!mindmap] Z Obsidianu\n> - Kořen\n> \t- Větev s tabulátorem\n> \t\t- List\n';
  assert.equal(w35, touched(sw(orig, calloutWas, '> [!mindmap] Z Obsidianu\n> - Kořen\n>   - Větev s tabulátorem\n>   - List\n')), 'W35: the callout in canonical form, every byte outside it unchanged (but modified)');
  dropOf(log)([0, 1], [0, 0], 'before');
  const second = await saved(ed);
  assert.equal(second, touched(sw(orig, calloutWas, '> [!mindmap] Z Obsidianu\n> - Kořen\n>   - List\n>   - Větev s tabulátorem\n')), 'a second drop changes only the moved lines');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-38 (L2)

const RUNS = Number(process.env.EDITOR_PROPERTY_RUNS ?? 40);
const RANDOM = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31;
const SEEDS = [20261125, RANDOM];
console.log(`mindmap MM3 drop property: seed = ${SEEDS[0]}, seed = ${SEEDS[1]}`);
const WORDS = ['Kořen', 'Větev', 'Žluťoučký kůň', 'Příprava', 'Účet', 'Řeka', 'Čtení', 'Dovolená', 'Šňůra', 'Plán', 'ďábel', 'Ústí'];

type Spec = { depths: number[]; words: number[]; marker: '-' | '*' | '1.'; indent: '2' | '4' | 'tab'; check: boolean; crlf: boolean; nfd: boolean; finalNewline: boolean; trailing: boolean; title: string | null };
const specArb: fc.Arbitrary<Spec> = fc
  .record({
    steps: fc.array(fc.integer({ min: -3, max: 1 }), { minLength: 1, maxLength: 24 }),
    words: fc.array(fc.integer({ min: 0, max: WORDS.length - 1 }), { minLength: 25, maxLength: 25 }),
    marker: fc.constantFrom<'-' | '*' | '1.'>('-', '*', '1.'),
    indent: fc.constantFrom<'2' | '4' | 'tab'>('2', '4', 'tab'),
    check: fc.boolean(), crlf: fc.boolean(), nfd: fc.boolean(), finalNewline: fc.boolean(), trailing: fc.boolean(),
    title: fc.option(fc.constantFrom(...WORDS), { nil: null }),
    multi: fc.boolean(),
  })
  .map((r) => {
    const maxDepth = r.indent === 'tab' ? 2 : 4;
    const depths = [0];
    for (const s of r.steps) depths.push(Math.max(r.multi ? 0 : 1, Math.min(maxDepth, depths[depths.length - 1] + s)));
    return { depths, words: r.words, marker: r.indent === 'tab' ? '-' : r.marker, indent: r.indent, check: r.check && r.marker !== '1.', crlf: r.crlf, nfd: r.nfd, finalNewline: r.finalNewline, trailing: r.trailing, title: r.title } as Spec;
  });

type T = { label: string; children: T[] };
function build(s: Spec): { text: string; callout: string; roots: T[]; paths: number[][] } {
  const lines: string[] = [];
  const roots: T[] = [];
  const stack: T[] = [];
  const counters: number[] = [];
  const indents: string[] = [''];
  const paths: number[][] = [];
  for (const [i, d] of s.depths.entries()) {
    counters.length = d + 1;
    counters[d] = (counters[d] ?? 0) + 1;
    paths.push(counters.slice(0, d + 1).map((n) => n - 1));
    const label = `${WORDS[s.words[i % s.words.length]]} ${i + 1}`;
    const node: T = { label, children: [] };
    if (d === 0) roots.push(node); else stack[d - 1].children.push(node);
    stack.length = d;
    stack[d] = node;
    const marker = s.marker === '1.' ? `${counters[d]}.` : s.marker;
    const box = s.check ? '[ ] ' : '';
    const indent = indents[d] ?? '';
    lines.push(`> ${indent}${marker} ${box}${s.nfd ? label.normalize('NFD') : label}`);
    indents.length = d + 1;
    indents[d + 1] = s.indent === 'tab' ? `${indent}\t` : s.indent === '4' ? `${indent}    ` : `${indent}${' '.repeat(marker.length + 1)}`;
  }
  const callout = [`> [!mindmap]${s.title ? ` ${s.title}` : ''}`, ...lines].join('\n');
  let text = '---\nid: 01JBMM0000000000000000P003\ntype: page\ntitle: Náhodná mapa\nmodified: 2026-10-01T09:00:00+02:00\n---\nÚvod.\n\n' + callout;
  if (s.trailing) text += '\n\nZávěr.';
  if (s.finalNewline) text += '\n';
  if (s.crlf) text = text.replace(/\n/g, '\r\n');
  return { text, callout: s.crlf ? callout.replace(/\n/g, '\r\n') : callout, roots, paths };
}
const at = (roots: T[], p: number[]) => p.reduce<T | null>((n, i, k) => (k === 0 ? roots[i] ?? null : n?.children[i] ?? null), null);
const outline = (items: T[], level = 1): string[] => items.flatMap((i) => [`${level}:${i.label}`, ...outline(i.children, level + 1)]);
const isPrefix = (a: number[], b: number[]) => a.length <= b.length && a.every((x, i) => b[i] === x);
/** The list model's move: remove `from`'s subtree, then put it before / after `target` or as its last child. */
function moved(roots: T[], from: number[], target: number[] | null, zone: Zone): T[] {
  const copy: T[] = JSON.parse(JSON.stringify(roots));
  const node = at(copy, from)!;
  const tnode = target ? at(copy, target) : null;
  const listOf = (items: T[], n: T): T[] | null => {
    if (items.includes(n)) return items;
    for (const i of items) { const r = listOf(i.children, n); if (r) return r; }
    return null;
  };
  const src = listOf(copy, node)!;
  src.splice(src.indexOf(node), 1);
  if (zone === 'child') (tnode ? tnode.children : copy).push(node);
  else {
    const list = listOf(copy, tnode!)!;
    list.splice(list.indexOf(tnode!) + (zone === 'before' ? 0 : 1), 0, node);
  }
  return copy;
}
type Item = { inline: { text?: string; target?: string }[]; children: Item[] };
const treeOutline = (items: Item[], level = 1): string[] => items.flatMap((i) => [`${level}:${i.inline.map((r) => r.text ?? r.target ?? '').join('').normalize('NFC')}`, ...treeOutline(i.children, level + 1)]);

test('fr_fmt_07_ac38_property_random_drops_rewrite_only_the_callout', { timeout: 600_000 }, async () => {
  const { mindmapTree } = await import('@tegg/doc');
  const failures: string[] = [];
  for (const seed of SEEDS) {
    await fc.assert(
      fc.asyncProperty(specArb, fc.nat(10_000), fc.nat(10_000), fc.constantFrom<Zone>('before', 'after', 'child'), fc.array(fc.nat(100), { maxLength: 4 }), async (s, pf, pt, zone, foldPicks) => {
        const mark = failures.length;
        const { text, callout, roots, paths } = build(s);
        const synthesized = roots.length > 1;
        const draggable = paths.filter((p) => synthesized || p.length > 1);
        if (draggable.length === 0) return true;
        const from = draggable[pf % draggable.length];
        const targets: (number[] | null)[] = [...paths.filter((p) => !isPrefix(from, p)), ...(synthesized ? [null] : [])];
        const target = targets[pt % targets.length];
        if (target === undefined) return true;
        const isRoot = target === null || (!synthesized && target.length === 1);
        const z: Zone = isRoot ? 'child' : zone; // the root item and a synthesized root have the child zone only (AP-2119)
        const want = outline(moved(roots, from, target, z));
        const results: (string | null)[] = [];
        for (const withFolds of [false, true]) {
          const log: Log = { ctls: [] };
          const ed = await openMm(text, log);
          const e = ctlOf(log).edit;
          if (!e || typeof e.moveMindmapItem !== 'function') { failures.push('ctl.edit.moveMindmapItem is missing (mm-mindmap §7.4)'); ed.destroy(); return false; }
          if (withFolds) {
            const f = ctlOf(log).folds;
            if (!f) { failures.push('ctl.folds is missing (mm-mindmap §7.3)'); ed.destroy(); return false; }
            for (const k of foldPicks) f.toggle(paths[k % paths.length]);
          }
          const ret = e.moveMindmapItem(from, target, z);
          if (ret === null) failures.push(`a valid drop returned null: ${JSON.stringify([from, target, z])}`);
          if (withFolds) for (const k of foldPicks) ctlOf(log).folds!.toggle(paths[(k + 1) % paths.length]);
          results.push(await ed.save());
          ed.destroy();
        }
        const [out, outFolded] = results;
        if (out !== outFolded) failures.push('folding and unfolding between edits changed the bytes');
        const unchanged = JSON.stringify(want) === JSON.stringify(outline(roots));
        if (unchanged) {
          if (out !== null) failures.push('a drop that leaves the list unchanged wrote');
        } else if (out === null) failures.push('the drop wrote nothing');
        else {
          const start = text.indexOf(callout);
          const pre = text.slice(text.indexOf('Úvod.'), start);
          const post = text.slice(start + callout.length);
          const os = out.indexOf(pre);
          if (os < 0 || !out.endsWith(post)) failures.push('bytes outside the callout changed');
          else {
            const t1 = mindmapTree(out.slice(os + pre.length, out.length - post.length), 'Náhodná mapa') as unknown as { items: Item[] } | null;
            const got = t1 ? treeOutline(t1.items) : null;
            if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`reads back as ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
          }
          // the ⌥ move that makes the same tree, when there is one (R232: equal bytes)
          const sib = (p: number[], d: number) => [...p.slice(0, -1), p[p.length - 1] + d];
          let alt: 'up' | 'down' | 'in' | 'out' | null = null;
          if (target && z === 'after' && JSON.stringify(target) === JSON.stringify(sib(from, 1))) alt = 'down';
          else if (target && z === 'before' && JSON.stringify(target) === JSON.stringify(sib(from, -1))) alt = 'up';
          else if (target && z === 'child' && from[from.length - 1] > 0 && JSON.stringify(target) === JSON.stringify(sib(from, -1))) alt = 'in';
          if (alt) {
            const log: Log = { ctls: [] };
            const ed = await openMm(text, log);
            ctlOf(log).edit!.move(from, alt);
            const viaAlt = await ed.save();
            ed.destroy();
            if (viaAlt !== out) failures.push(`the drop's bytes differ from ⌥ ${alt}`);
          }
        }
        if (failures.length > mark) failures.push(`case: ${JSON.stringify({ text, from, target, z })}`);
        return failures.length === mark;
      }),
      { seed, numRuns: RUNS, endOnFailure: true },
    ).catch((e) => failures.push(String(e).split('\n').slice(0, 6).join('\n')));
  }
  assert.deepEqual(failures.slice(0, 6), [], `${failures.length} failures`);
});
