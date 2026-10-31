// Slice G3, L1 and L2: the graph's keyboard rules (app/ui/src/graph/keyboard.ts; docs/contracts/v1-graph.md §16.3,
// §16.5; docs/acceptance/graph.md R120, AP-933…AP-936): FR-UX-03 AC-23 (the arrow rule: R120's reference cases, and for
// random positions every move ends on a candidate with the lowest score, deterministically; L2 with fast-check), and
// R120's key table for AC-24 (⏎, ⌘⏎, ⌘⇧⏎, ⌥Space by mode), AC-25 (`C`, `+` / `=` / keypad, `−` / `-` / keypad, `0`),
// AC-26 (Esc) and AC-27 (nothing with ⌘, ⌃ or ⌥ except ⌘⏎, ⌘⇧⏎, ⌥Space). Written from the ACs and the contract only
// (D-61). Modules load inside the tests and every call goes through `run` (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';

type Mod = Record<string, any>;
async function keyboard(): Promise<Mod> {
  let m: Mod | null = null;
  try {
    m = (await import(/* @vite-ignore */ '../ui/src/graph/keyboard.ts')) as Mod;
  } catch {
    m = null;
  }
  assert.ok(m, 'ui/src/graph/keyboard.ts loads');
  return m!;
}
/** fast-check's own error wraps the first AssertionError; rethrown as one so the report names it. */
function check(f: () => void) {
  try {
    f();
  } catch (e) {
    if (e instanceof assert.AssertionError) throw e;
    assert.fail(`AssertionError in a property: ${(e as Error)?.message ?? e}`);
  }
}
function run<T>(what: string, f: () => T): T {
  try {
    return f();
  } catch (e) {
    assert.fail(`${what} threw: ${(e as Error)?.message ?? e}`);
  }
}
type Pt = { x: number; y: number };
type Dir = 'left' | 'right' | 'up' | 'down';

/** R120's reference positions (px). */
const REF: Record<string, Pt> = {
  A: { x: 400, y: 300 }, B: { x: 500, y: 300 }, C: { x: 470, y: 230 }, D: { x: 430, y: 390 }, E: { x: 300, y: 290 }, F: { x: 400, y: 180 }, G: { x: 330, y: 230 },
};
const map = (o: Record<string, Pt>) => new Map(Object.entries(o));
const keysOf = (o: Record<string, Pt>) => new Map(Object.keys(o).map((k) => [k, `Pages/${k}.md`]));

/** The R120 rule, as the AC states it: the test's oracle. */
function oracle(pos: Map<string, Pt>, from: string, dir: Dir, sort: Map<string, string>): string | null {
  const o = pos.get(from)!;
  let best: { k: string; s: number; d: number; key: string } | null = null;
  for (const [k, p] of pos) {
    if (k === from) continue;
    const dx = p.x - o.x, dy = p.y - o.y;
    const [primary, cross] = dir === 'right' ? [dx, dy] : dir === 'left' ? [-dx, dy] : dir === 'down' ? [dy, dx] : [-dy, dx];
    if (!(primary > 0) || Math.abs(cross) > primary) continue;
    const s = primary + 2 * Math.abs(cross), d = Math.hypot(dx, dy), key = sort.get(k)!;
    if (!best || s < best.s || (s === best.s && (d < best.d || (d === best.d && key < best.key)))) best = { k, s, d, key };
  }
  return best?.k ?? null;
}

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-23

test('fr_ux_03_ac23_arrow_keys_follow_the_direction_rule', async () => {
  const m = await keyboard();
  const near = (from: string, dir: Dir) => run(`nearestInDirection(${from}, ${dir})`, () => m.nearestInDirection(map(REF), from, dir, keysOf(REF)));
  assert.deepEqual(['right', 'up', 'down', 'left'].map((d) => near('A', d as Dir)), ['B', 'F', 'D', 'E'], 'from A: → B, ↑ F, ↓ D, ← E (R120)');
  assert.equal(near('B', 'right'), null, 'from B → none: the focus stays');
  const tie = { A: { x: 0, y: 0 }, P: { x: 10, y: 3 }, Q: { x: 10, y: -3 } };
  const sort = new Map([['A', 'Pages/A.md'], ['P', 'Pages/Z.md'], ['Q', 'Pages/B.md']]);
  assert.equal(run('nearestInDirection (tie)', () => m.nearestInDirection(map(tie), 'A', 'right', sort)), 'Q', 'equal score and distance: the lowest sort key');
  const edge = { A: { x: 0, y: 0 }, P: { x: 10, y: 10 }, R: { x: 10, y: 10.01 } };
  assert.equal(run('nearestInDirection (cone)', () => m.nearestInDirection(map(edge), 'A', 'right', keysOf(edge))), 'P', '|dy| ≤ dx is inside the cone; just outside is not');
  assert.equal(run('nearestInDirection (behind)', () => m.nearestInDirection(map({ A: { x: 0, y: 0 }, S: { x: 0, y: 0 } }), 'A', 'right', keysOf({ A: { x: 0, y: 0 }, S: { x: 0, y: 0 } }))), null, 'strictly ahead: dx > 0');
});

test('fr_ux_03_ac23_arrow_keys_follow_the_direction_rule_property', async () => {
  const m = await keyboard();
  const pts = fc.dictionary(fc.constantFrom(...'abcdefghijklmnop'.split('')), fc.record({ x: fc.integer({ min: 0, max: 60 }), y: fc.integer({ min: 0, max: 60 }) }), { minKeys: 1, maxKeys: 12 });
  check(() => fc.assert(fc.property(pts, fc.constantFrom<Dir>('left', 'right', 'up', 'down'), (o, dir) => {
    const pos = map(o);
    const sort = keysOf(o);
    const from = [...pos.keys()][0];
    const a = run('nearestInDirection', () => m.nearestInDirection(pos, from, dir, sort));
    const b = run('nearestInDirection (again)', () => m.nearestInDirection(new Map([...pos].reverse()), from, dir, sort));
    assert.equal(a, oracle(pos, from, dir, sort), `${dir} from ${from} in ${JSON.stringify(o)}: a candidate with the lowest score`);
    assert.equal(b, a, 'deterministic: the map order doesn\'t matter');
  }), { seed: 1030, numRuns: 400 }));
});

// ------------------------------------------------------------------------------------------------ the key table (R120)

const k = (key: string, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}, code?: string) =>
  ({ key, code: code ?? key, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift });

test('fr_ux_03_ac24_return_keys_on_a_focused_node_key_table', async () => {
  const m = await keyboard();
  const act = (e: ReturnType<typeof k>, mode: string, target = 'node') => run(`graphKeyAction(${e.key}, ${mode})`, () => m.graphKeyAction(e, mode, target));
  assert.deepEqual(['click', 'hover', 'off'].map((mode) => act(k('Enter'), mode)), ['preview', 'open', 'open'], '⏎: preview in click mode, open in hover and Off');
  assert.deepEqual(['click', 'hover', 'off'].map((mode) => act(k('Enter', { meta: true }), mode)), ['open', 'open', 'open'], '⌘⏎ opens in every mode');
  assert.deepEqual(['click', 'hover', 'off'].map((mode) => act(k('Enter', { meta: true, shift: true }), mode)), ['open', 'open', 'open'], '⌘⇧⏎ opens as ⌘⏎ until tabs (AP-933)');
  assert.deepEqual(['click', 'hover', 'off'].map((mode) => act(k(' ', { alt: true }, 'Space'), mode)), ['preview', 'preview', 'preview'], '⌥Space previews in every mode (D-928)');
  assert.deepEqual(['click', 'hover', 'off'].map((mode) => act(k('Enter'), mode, 'row')), ['preview', 'open', 'open'], 'List rows take the same rules (AP-939)');
});

test('fr_ux_03_ac25_c_centres_and_zoom_keys_key_table', async () => {
  const m = await keyboard();
  const act = (e: ReturnType<typeof k>) => run(`graphKeyAction(${e.key})`, () => m.graphKeyAction(e, 'click', 'node'));
  assert.equal(act(k('c', {}, 'KeyC')), 'centre', '`C` centres');
  assert.equal(act(k('C', { shift: true }, 'KeyC')), 'centre', '`C` with ⇧ too');
  for (const e of [k('+', { shift: true }, 'Equal'), k('=', {}, 'Equal'), k('+', {}, 'NumpadAdd')]) assert.equal(act(e), 'zoomIn', `${e.key} (${e.code}): Zoom in`);
  for (const e of [k('-', {}, 'Minus'), k('−', {}, 'Minus'), k('-', {}, 'NumpadSubtract')]) assert.equal(act(e), 'zoomOut', `${e.key} (${e.code}): Zoom out`);
  for (const e of [k('0', {}, 'Digit0'), k('0', {}, 'Numpad0')]) assert.equal(act(e), 'fit', `${e.code}: Fit to screen`);
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) assert.equal(act(k(key)), 'focusDir', `${key}: focus in that direction`);
});

test('fr_ux_03_ac26_escape_closes_then_leaves_key_table', async () => {
  const m = await keyboard();
  for (const mode of ['click', 'hover', 'off']) {
    assert.equal(run('graphKeyAction(Escape)', () => m.graphKeyAction(k('Escape'), mode, 'node')), 'escape', `${mode}: Esc`);
    assert.equal(run('graphKeyAction(Escape, row)', () => m.graphKeyAction(k('Escape'), mode, 'row')), 'escape', `${mode}: Esc on a row`);
  }
});

test('fr_ux_03_ac27_single_keys_only_with_focus_in_the_graph_key_table', async () => {
  const m = await keyboard();
  const act = (e: ReturnType<typeof k>) => run(`graphKeyAction(${e.key})`, () => m.graphKeyAction(e, 'click', 'node'));
  const none: [string, ReturnType<typeof k>][] = [
    ['⌘C', k('c', { meta: true }, 'KeyC')], ['⌘0', k('0', { meta: true }, 'Digit0')], ['⌥←', k('ArrowLeft', { alt: true })], ['⌃→', k('ArrowRight', { ctrl: true })],
    ['⌘=', k('=', { meta: true }, 'Equal')], ['⌥C', k('ç', { alt: true }, 'KeyC')], ['⌃⏎', k('Enter', { ctrl: true })], ['⌥⏎', k('Enter', { alt: true })],
    ['Space', k(' ', {}, 'Space')], ['x', k('x', {}, 'KeyX')], ['Tab', k('Tab')],
  ];
  const got = none.map(([what, e]) => [what, act(e)]);
  assert.deepEqual(got, none.map(([what]) => [what, null]), 'the graph takes none of these (D-916)');
  assert.equal(act(k('c', {}, 'KeyC')), 'centre', 'while plain `C` is taken');
});
