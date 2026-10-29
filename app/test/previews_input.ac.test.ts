// v1.0 slice P (object previews), L1: `resolveRefInput` (docs/contracts/v1-previews.md §3.1), the single source of the
// R103 table (docs/acceptance/previews.md): every mode × reference kind × input × broken combination, with D-925 (⌘
// inputs open), D-928 (⌥Space previews in every mode), D-929 (⏎ on a chip is the mode's click action; on a row or card it
// opens), D-938 (a figure keeps its click, ⌥Space previews it), D-939 (broken references never preview: the Create offer,
// ⌥Space does nothing) and the `Link` menu on a chip's right-click (FR-LNK-13 AC-5, D-927). The criteria named are the
// R103 rows they check (FR-LNK-12 AC-1…AC-3, AC-7, FR-LNK-11 AC-6, AC-8, FR-LNK-13 AC-3, AC-5, FR-LNK-09 AC-6, FR-LNK-08
// AC-9, FR-NAV-08 AC-1); their L5 tests check the surfaces. Written from the ACs and the contract only (D-61). The
// module loads inside each test (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { need } from './read-helpers';

type Mode = 'click' | 'hover' | 'off';
type Kind = 'chip' | 'row' | 'card' | 'figure';
type Input = 'click' | 'dblclick' | 'modClick' | 'modDblclick' | 'enter' | 'modEnter' | 'altSpace' | 'hoverRest' | 'contextmenu';
type Action = 'preview' | 'open' | 'menu' | 'createOffer' | 'none' | 'default';

const MODES: Mode[] = ['click', 'hover', 'off'];
const KINDS: Kind[] = ['chip', 'row', 'card', 'figure'];
const INPUTS: Input[] = ['click', 'dblclick', 'modClick', 'modDblclick', 'enter', 'modEnter', 'altSpace', 'hoverRest', 'contextmenu'];

/** R103 for a reference that resolves. */
function resolved(mode: Mode, kind: Kind, input: Input): Action {
  const clickAction: Action = mode === 'click' ? 'preview' : 'open';
  if (kind === 'figure') {
    // D-938, R104 "not references": a figure keeps D-622 (a click selects it), double-click and ⌘-click open the Image
    // or PDF object as today (FR-LNK-09 AC-6), ⌘↩ opens (D-925), ⌥Space with it selected previews; nothing else is a
    // preview input (no hover preview, ⏎ and the right-click keep the figure's own behaviour).
    switch (input) {
      case 'click': return 'default';
      case 'dblclick': case 'modClick': case 'modDblclick': case 'modEnter': return 'open';
      case 'altSpace': return 'preview';
      case 'hoverRest': return 'none';
      case 'enter': case 'contextmenu': return 'default';
    }
  }
  switch (input) {
    case 'click': return clickAction; // row 1
    case 'dblclick': return 'open'; // row 2
    case 'modClick': case 'modDblclick': return 'open'; // row 3, D-925
    case 'hoverRest': return mode === 'hover' ? 'preview' : 'none'; // row 4
    case 'enter': return kind === 'chip' ? clickAction : 'open'; // rows 5, 6 (D-929)
    case 'modEnter': return 'open'; // row 7
    case 'altSpace': return 'preview'; // row 8 (D-928)
    case 'contextmenu': return kind === 'chip' ? 'menu' : 'default'; // row 9 (FR-LNK-13 AC-5)
  }
}
/** R103 last row (D-939): a broken reference never previews; whatever would preview or open offers Create instead;
 *  ⌥Space does nothing; the chip's right-click is the `Link` menu (with `Create "<target>"`, FR-LNK-13 AC-5); inputs
 *  that do nothing or keep the element's own behaviour stay so. */
function expected(mode: Mode, kind: Kind, input: Input, broken: boolean): Action {
  const a = resolved(mode, kind, input);
  if (!broken) return a;
  if (input === 'altSpace') return 'none';
  return a === 'preview' || a === 'open' ? 'createOffer' : a;
}

async function mod() {
  const m = await need('../ui/src/preview/input.ts', 'resolveRefInput');
  assert.equal(typeof m.resolveRefInput, 'function', 'resolveRefInput is a function');
  return m.resolveRefInput as (mode: Mode, kind: Kind, input: Input, broken: boolean) => Action;
}
function mismatches(f: (mode: Mode, kind: Kind, input: Input, broken: boolean) => Action, cases: [Mode, Kind, Input, boolean][]): string[] {
  const bad: string[] = [];
  for (const [m, k, i, b] of cases) {
    let got: unknown;
    try { got = f(m, k, i, b); } catch (e) { got = `threw ${String(e)}`; }
    const want = expected(m, k, i, b);
    if (got !== want) bad.push(`${m} ${k} ${i}${b ? ' broken' : ''}: want ${want}, got ${String(got)}`);
  }
  return bad;
}
function all(filter: (m: Mode, k: Kind, i: Input, b: boolean) => boolean): [Mode, Kind, Input, boolean][] {
  const out: [Mode, Kind, Input, boolean][] = [];
  for (const m of MODES) for (const k of KINDS) for (const i of INPUTS) for (const b of [false, true]) if (filter(m, k, i, b)) out.push([m, k, i, b]);
  return out;
}

test('fr_nav_08_ac1_resolve_ref_input_is_r103_for_every_combination', async () => {
  const f = await mod();
  const cases = all(() => true);
  assert.equal(cases.length, 3 * 4 * 9 * 2, 'every mode × kind × input × broken');
  assert.deepEqual(mismatches(f, cases), [], 'resolveRefInput = R103 (v1-previews §3.1)');
});

test('fr_lnk_12_ac1_click_to_preview_column', async () => {
  const f = await mod();
  const want: [Kind, Input, Action][] = [
    ['chip', 'click', 'preview'], ['row', 'click', 'preview'], ['card', 'click', 'preview'],
    ['chip', 'dblclick', 'open'], ['row', 'dblclick', 'open'], ['card', 'dblclick', 'open'],
    ['chip', 'hoverRest', 'none'], ['row', 'hoverRest', 'none'], ['card', 'hoverRest', 'none'],
    ['chip', 'modEnter', 'open'], ['row', 'modEnter', 'open'],
  ];
  const bad = want.filter(([k, i, a]) => f('click', k, i, false) !== a).map(([k, i, a]) => `${k} ${i}: want ${a}, got ${f('click', k, i, false)}`);
  assert.deepEqual(bad, [], 'click mode: a single click previews, a double-click opens, resting the pointer does nothing');
  assert.deepEqual(mismatches(f, all((m, k, i, b) => m === 'click' && !b && k !== 'figure')), [], 'the whole click-mode column');
});

test('fr_lnk_12_ac2_hover_to_preview_column', async () => {
  const f = await mod();
  for (const k of ['chip', 'row', 'card'] as Kind[]) {
    assert.equal(f('hover', k, 'hoverRest', false), 'preview', `hover: resting on a ${k} previews (AP-824)`);
    assert.equal(f('hover', k, 'click', false), 'open', `hover: a single click on a ${k} opens`);
  }
  assert.deepEqual(mismatches(f, all((m, k, i, b) => m === 'hover' && !b && k !== 'figure')), [], 'the whole hover-mode column');
});

test('fr_lnk_12_ac3_off_column_click_opens_and_only_alt_space_previews', async () => {
  const f = await mod();
  for (const k of ['chip', 'row', 'card'] as Kind[]) {
    for (const i of INPUTS) {
      const a = f('off', k, i, false);
      if (i === 'altSpace') assert.equal(a, 'preview', `off: ⌥Space on a ${k} still previews (AP-810)`);
      else assert.notEqual(a, 'preview', `off: ${i} on a ${k} never previews`);
    }
    assert.equal(f('off', k, 'click', false), 'open', `off: a single click on a ${k} opens`);
  }
  assert.deepEqual(mismatches(f, all((m, k, i, b) => m === 'off' && !b && k !== 'figure')), [], 'the whole Off column');
});

test('fr_lnk_12_ac7_enter_per_mode_and_kind', async () => {
  const f = await mod();
  const got = MODES.map((m) => [m, f(m, 'chip', 'enter', false), f(m, 'row', 'enter', false), f(m, 'card', 'enter', false)]);
  assert.deepEqual(got, [['click', 'preview', 'open', 'open'], ['hover', 'open', 'open', 'open'], ['off', 'open', 'open', 'open']],
    '⏎ on an inline chip is the mode\'s click action; on a row or card it opens (D-929)');
  for (const m of MODES) for (const k of KINDS) {
    assert.equal(f(m, k, 'modEnter', false), 'open', `${m} ${k}: ⌘↩ opens`);
    assert.equal(f(m, k, 'altSpace', false), 'preview', `${m} ${k}: ⌥Space previews`);
  }
});

test('fr_lnk_11_ac6_double_click_opens_every_reference_in_every_mode', async () => {
  const f = await mod();
  const bad = all((_m, k, i, b) => !b && i === 'dblclick').filter(([m, k]) => f(m, k, 'dblclick', false) !== 'open').map(([m, k]) => `${m} ${k}`);
  assert.deepEqual(bad, [], 'a double-click opens (R103 row 2)');
});

test('fr_lnk_11_ac8_cmd_click_and_cmd_double_click_open_in_every_mode', async () => {
  const f = await mod();
  const bad: string[] = [];
  for (const m of MODES) for (const k of KINDS) for (const i of ['modClick', 'modDblclick'] as Input[]) {
    const a = f(m, k, i, false);
    if (a !== 'open') bad.push(`${m} ${k} ${i}: ${a}`);
  }
  assert.deepEqual(bad, [], '⌘-click and ⌘-double-click open in the current view, never preview (D-925)');
});

test('fr_lnk_13_ac3_alt_space_previews_in_every_mode', async () => {
  const f = await mod();
  const bad: string[] = [];
  for (const m of MODES) for (const k of KINDS) {
    if (f(m, k, 'altSpace', false) !== 'preview') bad.push(`${m} ${k}: ${f(m, k, 'altSpace', false)}`);
  }
  assert.deepEqual(bad, [], '⌥Space previews in all three modes (D-928), a selected figure too (D-938)');
});

test('fr_lnk_13_ac5_right_click_on_a_chip_is_the_link_menu', async () => {
  const f = await mod();
  for (const m of MODES) {
    assert.equal(f(m, 'chip', 'contextmenu', false), 'menu', `${m}: the Link menu on a chip`);
    assert.equal(f(m, 'chip', 'contextmenu', true), 'menu', `${m}: a broken chip's menu (with Create "<target>")`);
    for (const k of ['row', 'card', 'figure'] as Kind[]) assert.equal(f(m, k, 'contextmenu', false), 'default', `${m}: a ${k} keeps its right-click`);
  }
});

test('fr_lnk_09_ac6_figures_keep_their_click_and_preview_with_alt_space', async () => {
  const f = await mod();
  for (const m of MODES) {
    assert.equal(f(m, 'figure', 'click', false), 'default', `${m}: a click selects the figure (D-622)`);
    assert.equal(f(m, 'figure', 'dblclick', false), 'open', `${m}: a double-click opens the Image object`);
    assert.equal(f(m, 'figure', 'modClick', false), 'open', `${m}: ⌘-click opens it`);
    assert.equal(f(m, 'figure', 'altSpace', false), 'preview', `${m}: ⌥Space on the selected figure previews (AP-820)`);
    assert.notEqual(f(m, 'figure', 'hoverRest', false), 'preview', `${m}: no hover preview on a figure`);
  }
  assert.deepEqual(mismatches(f, all((_m, k) => k === 'figure')), [], 'every figure combination');
});

test('fr_lnk_08_ac9_broken_references_offer_create_and_alt_space_does_nothing', async () => {
  const f = await mod();
  const bad: string[] = [];
  for (const m of MODES) for (const k of KINDS) for (const i of INPUTS) {
    const a = f(m, k, i, true);
    if (a === 'preview' || a === 'open') bad.push(`${m} ${k} ${i}: ${a}`);
  }
  assert.deepEqual(bad, [], 'a broken reference never previews or opens (D-939)');
  for (const m of MODES) for (const k of KINDS) assert.equal(f(m, k, 'altSpace', true), 'none', `${m} ${k}: ⌥Space on a broken reference does nothing`);
  for (const m of MODES) for (const k of ['chip', 'row', 'card'] as Kind[]) {
    for (const i of ['click', 'dblclick', 'modClick', 'modDblclick', 'enter', 'modEnter'] as Input[]) {
      assert.equal(f(m, k, i, true), 'createOffer', `${m} ${k} ${i}: the Create offer (backlinks.md FR-LNK-04 AC-4)`);
    }
  }
  assert.deepEqual(mismatches(f, all((_m, _k, _i, b) => b)), [], 'every broken combination');
});
