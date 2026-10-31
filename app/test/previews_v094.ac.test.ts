// @vitest-environment jsdom
// v0.94 feedback (D-1164, D-1166, D-1172), L1: docs/acceptance/previews.md part three. FR-LNK-09 AC-14 (the input
// resolver answers R130 for an embed in all three modes; R103's other kinds unchanged), FR-LNK-12 AC-20 (the reading of
// each stored `preview` value; no migration), FR-SET-07 AC-7 (a bad stored mode reads as hover, the default; a bad delay is
// clamped and rounded as AC-3; the provider doesn't rewrite it). Interfaces: `resolveRefInput` of preview/input.ts
// (docs/contracts/v1-previews.md §3.1), `readPreviewUi` of preview/state.ts (the normalizer slice P's L1 tests use, an
// interface choice of previews_model.ac.test.ts) and the public `PreviewProvider` / `usePreview` (§3). The embed kinds of
// the resolver are not named by the contract yet (previews.md part three: "§3.1 takes R130" in the build commit): this
// test proposes `'embed'` (a card, the header title and type icon of a full or section embed) and `'embedLink'` (a
// link-mode embed's chip) as red-test decisions for the owner. Written from the ACs and the contracts only (D-61). Modules
// load inside each test (TS-I1).
process.env.TZ = 'Europe/Prague';
import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup } from '@testing-library/react';
import { catalog, need } from './read-helpers';
import { DEFAULT_UI_STATE, NOW, ZONE, installIpc, mountProvider, settle, setTypes, uninstallIpc } from './previews-helpers';

// FR-SET-07 AC-7: the stored UI state of this file has a bad mode and an out-of-range delay; it is read at start (§1).
const BAD = { mode: 'sometimes', hoverDelay: 1720 };
(globalThis as any).__TEGG_TZ__ = ZONE;
(globalThis as any).__TEGG_UI_STATE__ = { ...DEFAULT_UI_STATE, preview: BAD };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) });
  await catalog().catch(() => {});
  await setTypes().catch(() => {});
});
afterEach(async () => {
  cleanup();
  await uninstallIpc();
  vi.useRealTimers();
});

type Mode = 'click' | 'hover' | 'off';
type Input = 'click' | 'dblclick' | 'modClick' | 'modDblclick' | 'enter' | 'modEnter' | 'altSpace' | 'hoverRest' | 'contextmenu';
type Action = 'preview' | 'open' | 'menu' | 'createOffer' | 'none' | 'default';
const MODES: Mode[] = ['click', 'hover', 'off'];
const INPUTS: Input[] = ['click', 'dblclick', 'modClick', 'modDblclick', 'enter', 'modEnter', 'altSpace', 'hoverRest', 'contextmenu'];

async function resolver() {
  const m = await need('../ui/src/preview/input.ts', 'resolveRefInput');
  assert.equal(typeof m.resolveRefInput, 'function', 'resolveRefInput is a function');
  return m.resolveRefInput as (mode: Mode, kind: string, input: Input, broken: boolean) => Action;
}
async function reader() {
  const m = await need('../ui/src/preview/state.ts', 'readPreviewUi');
  assert.equal(typeof m.readPreviewUi, 'function', 'readPreviewUi is a function');
  return m.readPreviewUi as (dto: unknown) => { mode: string; hoverDelay: number; width: number | null; height: number | null };
}

/** R130 for an embed that resolves: the same in every mode. */
function r130(kind: 'embed' | 'embedLink', input: Input): Action {
  switch (input) {
    case 'click': case 'dblclick': case 'modClick': case 'modDblclick': case 'enter': case 'modEnter': return 'open';
    case 'hoverRest': return 'none';
    case 'altSpace': return 'preview'; // D-928
    case 'contextmenu': return kind === 'embedLink' ? 'menu' : 'default'; // FR-LNK-13 AC-5 on a link-mode chip
  }
}
/** A broken embed keeps its current behaviour (embeds.md FR-LNK-07 AC-6): its unresolved chip offers Create for what
 *  would open (D-939), ⌥Space does nothing, resting does nothing; the right-click as for a resolved one. */
function r130Broken(kind: 'embed' | 'embedLink', input: Input): Action {
  const a = r130(kind, input);
  if (input === 'altSpace') return 'none';
  return a === 'open' ? 'createOffer' : a;
}
function call(f: (mode: Mode, kind: string, input: Input, broken: boolean) => Action, m: Mode, k: string, i: Input, b: boolean): unknown {
  try { return f(m, k, i, b); } catch (e) { return `threw ${String(e)}`; }
}

// ------------------------------------------------------------------------------------------------ FR-LNK-09 AC-14

test('fr_lnk_09_ac14_the_input_resolver_answers_r130_for_an_embed_in_every_mode', async () => {
  const f = await resolver();
  const bad: string[] = [];
  for (const m of MODES) for (const k of ['embed', 'embedLink'] as const) for (const i of INPUTS) {
    const got = call(f, m, k, i, false);
    const want = r130(k, i);
    if (got !== want) bad.push(`${m} ${k} ${i}: want ${want}, got ${String(got)}`);
  }
  assert.deepEqual(bad, [], 'R130: click, double-click, ⌘-click, ⌘-double-click, ⏎ and ⌘↩ open; resting does nothing; ⌥Space previews; the right-click is the Link menu on a link-mode chip, else the element\'s own behaviour');
});

test('fr_lnk_09_ac14_the_input_resolver_answers_r130_for_a_broken_embed', async () => {
  const f = await resolver();
  const bad: string[] = [];
  for (const m of MODES) for (const k of ['embed', 'embedLink'] as const) for (const i of INPUTS) {
    const got = call(f, m, k, i, true);
    const want = r130Broken(k, i);
    if (got !== want) bad.push(`${m} ${k} ${i} broken: want ${want}, got ${String(got)}`);
  }
  assert.deepEqual(bad, [], 'a broken embed keeps its current behaviour (the Create offer, never a preview)');
});

test('fr_lnk_09_ac14_the_input_resolver_keeps_r103_for_the_other_kinds', async () => {
  const f = await resolver();
  // Spot rows of R103 in every mode (the whole table is fr_nav_08_ac1_resolve_ref_input_is_r103_for_every_combination).
  const bad: string[] = [];
  for (const m of MODES) {
    const clickAction: Action = m === 'click' ? 'preview' : 'open';
    const rows: [string, Input, Action][] = [
      ['chip', 'click', clickAction], ['chip', 'enter', clickAction], ['chip', 'hoverRest', m === 'hover' ? 'preview' : 'none'], ['chip', 'contextmenu', 'menu'],
      ['row', 'click', clickAction], ['row', 'enter', 'open'], ['card', 'enter', 'open'], ['card', 'dblclick', 'open'],
      ['figure', 'click', 'default'], ['figure', 'altSpace', 'preview'], ['figure', 'hoverRest', 'none'],
    ];
    for (const [k, i, want] of rows) {
      const got = call(f, m, k, i, false);
      if (got !== want) bad.push(`${m} ${k} ${i}: want ${want}, got ${String(got)}`);
    }
  }
  assert.deepEqual(bad, [], 'R103\'s chip, row, card and figure answer as before');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-20 (L1)

test('fr_lnk_12_ac20_a_stored_value_stays_the_reading', async () => {
  const read = await reader();
  const cases: [unknown, { mode: string; hoverDelay: number; width: number | null; height: number | null }][] = [
    [{ mode: 'click' }, { mode: 'click', hoverDelay: 1000, width: null, height: null }],
    [{ mode: 'off' }, { mode: 'off', hoverDelay: 1000, width: null, height: null }],
    [{ mode: 'hover', hoverDelay: 400 }, { mode: 'hover', hoverDelay: 400, width: null, height: null }],
    [{ hoverDelay: 600 }, { mode: 'hover', hoverDelay: 600, width: null, height: null }],
    [{ mode: 'hover' }, { mode: 'hover', hoverDelay: 1000, width: null, height: null }],
    [{ width: 500, height: 300 }, { mode: 'hover', hoverDelay: 1000, width: 500, height: 300 }],
    [undefined, { mode: 'hover', hoverDelay: 1000, width: null, height: null }],
    [{}, { mode: 'hover', hoverDelay: 1000, width: null, height: null }],
  ];
  for (const [stored, want] of cases) {
    const frozen = stored && typeof stored === 'object' ? Object.freeze({ ...(stored as object) }) : stored;
    assert.deepEqual(read(frozen), want, `${JSON.stringify(stored)} reads as ${JSON.stringify(want)} (D-1164: hover, 1,000 ms by default)`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-SET-07 AC-7 (L1)

test('fr_set_07_ac7_a_bad_stored_mode_reads_as_hover', async () => {
  const read = await reader();
  for (const mode of ['click', 'hover', 'off'] as const) assert.equal(read({ mode }).mode, mode, `${mode} is kept`);
  for (const mode of ['sometimes', 1, null, 'Hover', '', true]) assert.equal(read({ mode }).mode, 'hover', `${JSON.stringify(mode)} reads as hover, the default (D-1172)`);
  const delays: [number, number][] = [[1720, 1500], [100, 200], [-5, 200], [1449, 1400], [1451, 1500], [430, 400], [470, 500]];
  const off = delays.filter(([v, w]) => read({ mode: 'sometimes', hoverDelay: v }).hoverDelay !== w).map(([v, w]) => `${v} → ${read({ mode: 'sometimes', hoverDelay: v }).hoverDelay}, want ${w}`);
  assert.deepEqual(off, [], 'a bad delay is clamped to 200…1500 and rounded to the nearest 100 ms (AC-3)');
});

test('fr_set_07_ac7_the_provider_reads_a_bad_mode_as_hover_without_rewriting_it', async () => {
  const ipc = await installIpc({ uiState: { ...DEFAULT_UI_STATE, preview: BAD } });
  const p = await mountProvider();
  await settle();
  assert.equal(p.api().mode, 'hover', 'a stored mode `sometimes` reads as hover (D-1172)');
  assert.equal(p.api().hoverDelay, 1500, 'a stored delay 1720 reads as 1500');
  await settle();
  assert.equal(ipc.count('ui_state_set'), 0, 'neither value is rewritten until the user changes the setting');
});
