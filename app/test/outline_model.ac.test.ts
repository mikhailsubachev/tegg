// Slice OL, L1: the outline's UI model and fold store (docs/acceptance/outline.md R170, R172, R173, R176; docs/contracts/
// v1-outline.md §3.1, §3.2, §5). `model.ts`: the constants, `visibleRows`, `shownCurrent`, `foldButtons`, `toggle`,
// `allKeys` (FR-EDT-11 AC-13), `currentSection` (AC-9), `jumpTop` (AC-10), `countText` (AC-1), `railGap` (FR-EDT-16
// AC-13), `cardChevrons` (FR-EDT-16 AC-8). `folds.ts`: `noteKey`, `foldsOf`, `withFolds` (prune, the 200 cap, order of the
// last change), `rekeyFolds` (FR-STO-07 AC-7, the L1 part). The trees are built here from the fixture's ATX lines with a
// reference of R171 rules 5–6 (parent, depth, descendants, fold key), so these tests depend only on the UI modules.
// Written from the ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
//
// Red-test points (reported, not decided): `toggle`'s `collapsed` argument is passed as a `ReadonlySet<string>` like
// `visibleRows` and `foldButtons` (§3.1 doesn't type it); `folds.ts`'s `vault` argument is passed as the vault's path
// string (§5 says the key is `vault.path.normalize('NFC')`).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
async function model(): Promise<Mod> {
  const m = await load('../ui/src/outline/model.ts');
  assert.ok(m, 'ui/src/outline/model.ts loads (v1-outline §3.1)');
  return m!;
}
async function folds(): Promise<Mod> {
  const m = await load('../ui/src/outline/folds.ts');
  assert.ok(m, 'ui/src/outline/folds.ts loads (v1-outline §3.1, §5)');
  return m!;
}
function fnOf(m: Mod, name: string): (...a: any[]) => any {
  assert.equal(typeof m[name], 'function', `exports ${name}`);
  return (...a: any[]) => { try { return m[name](...a); } catch (e) { assert.fail(`${name} threw: ${(e as Error)?.message ?? e}`); } };
}

const FX = resolve(import.meta.dirname, '../../tests/fixtures/vaults/outline');
type Node = { level: number; text: string; from: number; to: number; index: number; depth: number; parent: number | null; children: number[]; descendants: number; key: string };
/** R171 rules 5–6 over the note's top-level ATX lines (the fixture notes used here have no other headings). */
function treeOf(rel: string): Node[] {
  const text = readFileSync(resolve(FX, rel), 'utf8');
  const out: Node[] = [];
  const seen = new Map<string, number>();
  let at = 0;
  for (const line of text.split('\n')) {
    const m = /^(#{1,6}) (.+)$/.exec(line);
    if (m && !line.startsWith('---')) {
      const level = m[1].length, t = m[2].trim();
      let parent: number | null = null;
      for (let j = out.length - 1; j >= 0; j--) if (out[j].level < level) { parent = j; break; }
      const depth = parent === null ? 1 : out[parent].depth + 1;
      const k = `${level}:${t.normalize('NFC')}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
      const n: Node = { level, text: t, from: at, to: at + line.length, index: out.length, depth, parent, children: [], descendants: 0, key: `${k}#${seen.get(k)}` };
      if (parent !== null) out[parent].children.push(n.index);
      for (let p = parent; p !== null; p = out[p].parent) out[p].descendants++;
      out.push(n);
    }
    at += line.length + 1;
  }
  return out;
}
const ARCH = () => treeOf('Pages/Architektura.md');
const PLAN = () => treeOf('Pages/Plán offsitu 2026.md');
const CTEN = () => treeOf('Pages/Čtenářské poznámky.md');
const ix = (tree: Node[], text: string, nth = 0) => tree.filter((n) => n.text === text)[nth].index;
const keyOf = (tree: Node[], text: string, nth = 0) => tree[ix(tree, text, nth)].key;
const names = (tree: Node[], idx: number[]) => idx.map((i) => tree[i]?.text ?? `#${i}`);

// ------------------------------------------------------------------------------------------------ §3.2 constants

test('fr_edt_11_ac10_click_jumps_to_the_heading_constants_and_jump_top', async () => {
  const m = await model();
  const want: Record<string, unknown> = {
    REFRESH_MS: 120, CURRENT_LINE: 30, END_TOLERANCE: 2, JUMP_TOP: 24, FLASH_MS: 2000, FLASH_FADE_MS: 300, HOVER_OPEN_MS: 150, HOVER_CLOSE_MS: 300,
    RAIL_FADE_MS: 150, CHEVRON_MS: 120, ROW_H: 26, INDENT: 14, RAIL_MIN_PANE: 640, RAIL_RIGHT: 14, RAIL_PAD: [12, 8], RAIL_LINE: 1.5, RAIL_LINE_ON: 2,
    RAIL_GAP: 7, RAIL_MIN_GAP: 2, RAIL_MARGIN: 48, LINE_W: { 1: 18, 2: 13, 3: 9, 4: 7, 5: 5, 6: 4 }, CARD_W: 256, CARD_RIGHT: 52, CARD_MAX_H: 520,
    CARD_MAX_VH: 0.8, TEXT_CLEARANCE: 44,
  };
  const bad = Object.entries(want).filter(([k, v]) => JSON.stringify(m[k]) !== JSON.stringify(v)).map(([k, v]) => `${k}: want ${JSON.stringify(v)}, got ${JSON.stringify(m[k])}`);
  assert.deepEqual(bad, [], 'the constants of §3.2');
  const jumpTop = fnOf(m, 'jumpTop');
  assert.equal(jumpTop(500, 100, 10_000), 576, 'element top 500 at scrollTop 100: 500 + 100 − 24');
  assert.equal(jumpTop(10, 0, 10_000), 0, 'clamped at 0');
  assert.equal(jumpTop(5000, 0, 3000), 3000, 'clamped at the end (the note can\'t scroll that far)');
  assert.equal(jumpTop(-200, 900, 10_000), 676, 'a heading above the viewport');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-1 (count)

test('fr_edt_11_ac1_outline_tab_lists_the_headings_count_text', async () => {
  const m = await model();
  const countText = fnOf(m, 'countText');
  assert.equal(countText(11), '11 headings', 'outline.count, other');
  assert.equal(countText(1), '1 heading', 'outline.count, one');
  assert.equal(countText(18), '18 headings', 'Architektura');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-9

test('fr_edt_11_ac9_current_section_follows_scrolling_rule', async () => {
  const m = await model();
  const cs = fnOf(m, 'currentSection');
  const no = { scrolls: true, atEnd: false };
  assert.equal(cs([50, 300, 900], no), null, 'no heading top at or above the 30 px line: nothing current');
  assert.equal(cs([-400, 20, 31, 700], no), 1, 'the last top ≤ 30');
  assert.equal(cs([-400, -100, 30, 700], no), 2, 'exactly at the line counts');
  assert.equal(cs([-400, 31, 700], no), 0, 'Den 1 at 31 px (1 px below the line): Program, the heading before it');
  assert.equal(cs([-900, 400, 700], { scrolls: true, atEnd: true }), 2, 'scrolled to the end: the last heading');
  assert.equal(cs([60, 120], { scrolls: false, atEnd: true }), null, 'a note that doesn\'t scroll uses only rule 1');
  assert.equal(cs([10, 120], { scrolls: false, atEnd: true }), 0, 'a note that doesn\'t scroll, a heading above the line');
  assert.equal(cs([], { scrolls: true, atEnd: true }), null, 'no headings: nothing current');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-13

test('fr_edt_11_ac13_collapse_and_expand_model', async () => {
  const m = await model();
  const [visibleRows, foldButtons, toggle, allKeys, shownCurrent] = ['visibleRows', 'foldButtons', 'toggle', 'allKeys', 'shownCurrent'].map((n) => fnOf(m, n));
  const arch = ARCH();
  assert.equal(arch.length, 18, 'fixture: Architektura has 18 headings');
  const none = new Set<string>();
  assert.deepEqual(visibleRows(arch, none), arch.map((n) => n.index), 'nothing collapsed: every row');
  assert.deepEqual(foldButtons(arch, none), { expandAll: false, collapseAll: true }, 'nothing collapsed: only Collapse all');
  // One row.
  const hl = toggle(arch, none, ix(arch, 'Hlavička'), false);
  assert.deepEqual(hl, [keyOf(arch, 'Hlavička')], 'the chevron of Hlavička collapses one row: ["3:Hlavička#1"]');
  assert.equal(keyOf(arch, 'Hlavička'), '3:Hlavička#1', 'the reference key');
  const hidden = names(arch, visibleRows(arch, new Set(hl)));
  assert.equal(hidden.length, 16, 'its 2 children are hidden');
  assert.ok(!hidden.includes('Povinné klíče') && !hidden.includes('Neznámé klíče'), 'Povinné klíče and Neznámé klíče hidden');
  assert.deepEqual(foldButtons(arch, new Set(hl)), { expandAll: true, collapseAll: true }, 'both buttons');
  assert.deepEqual(toggle(arch, new Set(hl), ix(arch, 'Hlavička'), false), [], 'a second click restores it');
  // A whole branch (⌥-click).
  const branch = toggle(arch, none, ix(arch, 'Úložiště'), true);
  const BRANCH = ['Úložiště', 'Rozvržení trezoru', 'Složky podle typu', 'Denní poznámky', 'Názvy souborů', 'Hlavička', 'Indexování'];
  assert.deepEqual(branch, BRANCH.map((t) => keyOf(arch, t)), '⌥-click on Úložiště: it and every descendant with children, in note order');
  const plain = toggle(arch, new Set(branch), ix(arch, 'Úložiště'), false);
  assert.deepEqual(plain, BRANCH.slice(1).map((t) => keyOf(arch, t)), 'a plain click then expands Úložiště only');
  assert.deepEqual(names(arch, visibleRows(arch, new Set(plain))), ['Úložiště', 'Rozvržení trezoru', 'Indexování', 'Synchronizace', 'Konflikty', 'Stejný řádek upraven', 'Složky iCloudu'], '7 rows');
  assert.deepEqual(toggle(arch, new Set(branch), ix(arch, 'Úložiště'), true), [], '⌥-click on the collapsed row expands it and its branch');
  // All.
  const all = allKeys(arch);
  assert.deepEqual(all, arch.filter((n) => n.children.length).map((n) => n.key), 'allKeys: the 9 headings with children, in note order');
  assert.deepEqual(names(arch, visibleRows(arch, new Set(all))), ['Úložiště', 'Synchronizace'], 'Collapse all leaves 2 rows');
  assert.deepEqual(foldButtons(arch, new Set(all)), { expandAll: true, collapseAll: false }, 'only Expand all');
  assert.equal(allKeys(CTEN()).length, 14, 'Čtenářské: 14 keys');
  assert.deepEqual(foldButtons(treeOf('Pages/Jeden nadpis.md'), none), { expandAll: false, collapseAll: false }, 'Jeden: neither button');
  assert.deepEqual(foldButtons(PLAN(), none), { expandAll: false, collapseAll: true }, 'Plán: Collapse all only');
  // Current in a collapsed branch (R172 rule 5).
  const coll = new Set([keyOf(arch, 'Úložiště')]);
  const vis = visibleRows(arch, coll);
  assert.equal(shownCurrent(arch, vis, ix(arch, 'Časová pásma')), ix(arch, 'Úložiště'), 'the nearest visible ancestor carries the mark');
  assert.equal(shownCurrent(arch, arch.map((n) => n.index), ix(arch, 'Časová pásma')), ix(arch, 'Časová pásma'), 'visible: itself');
  assert.equal(shownCurrent(arch, vis, null), null, 'nothing current');
  // Keys in an NFD tree are NFC: a stored NFC key still collapses the NFD heading (FR-FMT-12 AC-10).
  const nfd = arch.map((n) => ({ ...n, text: n.text.normalize('NFD') }));
  assert.ok(!names(nfd, visibleRows(nfd, new Set(['3:Složky podle typu#1']))).some((t) => t.normalize('NFC') === 'Denní poznámky'), 'the NFC key folds the NFD heading');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-13

test('fr_edt_16_ac13_many_top_level_headings_rail_gap', async () => {
  const m = await model();
  const railGap = fnOf(m, 'railGap');
  const h = 850 - 48;
  assert.equal(railGap(18, h), 7, '18 lines fit at 7 px');
  assert.equal(railGap(60, h), 7, '60 lines: 60 × 1.5 + 59 × 7 = 503 ≤ 802');
  const g200 = railGap(200, h);
  assert.ok(typeof g200 === 'number' && g200 >= 2 && 200 * 1.5 + 199 * g200 <= h + 1e-9, `200 lines fit with a gap ≥ 2 (D-1634): ${g200}`);
  assert.ok(g200 > 2.4 && g200 < 2.53, `the largest gap that fits (about 2.52): ${g200}`);
  assert.equal(railGap(300, h), null, '300 lines: 300 × 3.5 − 2 = 1,048 > 802, no rail');
  assert.equal(railGap(120, 400), null, 'too little height: no rail');
  const g = railGap(100, 600);
  assert.ok(typeof g === 'number' && g >= 2 && g < 7, `CP-8: the same rule for any row set (100 rows in 600 px): ${g}`);
});

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-8

test('fr_edt_16_ac8_card_rows_and_chevrons_model', async () => {
  const m = await model();
  const cardChevrons = fnOf(m, 'cardChevrons');
  const cten = CTEN();
  const H1 = cten.filter((n) => n.depth === 1).map((n) => n.index);
  const rep = ix(cten, 'Replikace'), zp = ix(cten, 'Zpoždění replikace'), tr = ix(cten, 'Transakce');
  const rows = [...H1, ...cten[rep].children, ...cten[zp].children].sort((a, b) => a - b);
  assert.equal(rows.length, 16, 'the 16 rail rows with Zpoždění replikace current');
  const chev = [...(cardChevrons(cten, rows, new Set<number>()) as Set<number>)].sort((a, b) => a - b);
  const want = [...H1.filter((i) => i !== rep), ix(cten, 'Vedoucí a následovníci')].sort((a, b) => a - b);
  assert.deepEqual(names(cten, chev), names(cten, want), 'chevrons on the 11 H1 other than Replikace and on Vedoucí a následovníci: 12');
  const opened = [...rows, ...cten[tr].children].sort((a, b) => a - b);
  const chev2 = [...(cardChevrons(cten, opened, new Set([tr])) as Set<number>)];
  assert.ok(chev2.includes(tr), 'a row opened in this card keeps its chevron');
  assert.equal(chev2.length, 12, '12 chevrons after opening Transakce');
  const arch = ARCH();
  assert.equal((cardChevrons(arch, arch.map((n) => n.index), new Set<number>()) as Set<number>).size, 0, 'Architektura: every row shown, no chevron (V5)');
});

// ------------------------------------------------------------------------------------------------ FR-STO-07 AC-7 (L1)

const VAULT = '/Users/test/Trezor Outline';
const ID1 = '01JC5N00000000000000000001';
const base = () => ({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: true, tab: 'outline', width: 288 }, propertiesOpen: true });

test('fr_sto_07_ac7_fold_state_in_ui_state', async () => {
  const f = await folds();
  const [noteKey, foldsOf, withFolds, rekeyFolds] = ['noteKey', 'foldsOf', 'withFolds', 'rekeyFolds'].map((n) => fnOf(f, n));
  assert.equal(f.OUTLINE_NOTES_MAX, 200, 'OUTLINE_NOTES_MAX = 200');
  assert.equal(noteKey(ID1, 'Pages/Plán offsitu 2026.md'), ID1, 'the id when there is one');
  assert.equal(noteKey(null, 'Pages/Bez hlavičky.md'.normalize('NFD')), 'Pages/Bez hlavičky.md'.normalize('NFC'), 'else the vault path in NFC');
  const plan = PLAN();
  const valid = plan.filter((n) => n.children.length).map((n) => n.key);
  // Collapse.
  const ui0 = base();
  const ui1 = withFolds(ui0, VAULT, ID1, ['1:Program#1'], valid);
  assert.deepEqual(ui1.vaults?.[VAULT]?.outline?.collapsed, { [ID1]: ['1:Program#1'] }, 'vaults[<vault>].outline.collapsed[<id>] = ["1:Program#1"]');
  const { vaults: _v, ...rest } = ui1;
  assert.deepEqual(rest, ui0, 'nothing else of the UI state changes');
  assert.deepEqual(ui0, base(), 'the input is not mutated');
  assert.deepEqual(foldsOf(ui1, VAULT, ID1), ['1:Program#1'], 'foldsOf reads them back');
  assert.deepEqual(foldsOf(ui1, VAULT, 'Pages/Jiná.md') ?? [], [], 'another note: nothing collapsed');
  assert.deepEqual(foldsOf(ui1, '/Users/test/Jiný trezor', ID1) ?? [], [], 'another vault: nothing collapsed');
  // Expand removes the entry.
  const ui2 = withFolds(ui1, VAULT, ID1, [], valid);
  assert.equal(ui2.vaults?.[VAULT]?.outline?.collapsed?.[ID1], undefined, 'nothing collapsed: the note\'s entry is removed');
  // Stale keys are dropped at the note's next fold write.
  const stale = withFolds({ ...base(), vaults: { [VAULT]: { outline: { collapsed: { [ID1]: ['1:Program#1'] } } } } }, VAULT, ID1, ['1:Program#1', '1:Cíle#1'], valid.filter((k) => k !== '1:Program#1'));
  assert.deepEqual(stale.vaults[VAULT].outline.collapsed[ID1], ['1:Cíle#1'], 'keys matching no heading are dropped');
  // Order of the last change, and the 200 cap.
  const seeded: Record<string, string[]> = {};
  for (let i = 0; i < 200; i++) seeded[`01JC5Z${String(i).padStart(20, '0')}`] = ['1:Kapitola#1'];
  const full = { ...base(), vaults: { [VAULT]: { outline: { collapsed: seeded }, sidebar: { pinnedCollapsed: true } } } };
  const capped = withFolds(full, VAULT, ID1, ['1:Program#1'], valid);
  const keys = Object.keys(capped.vaults[VAULT].outline.collapsed);
  assert.equal(keys.length, 200, 'above 200 notes the oldest is dropped in the same write');
  assert.equal(keys[0], Object.keys(seeded)[1], 'the entry changed longest ago is gone');
  assert.equal(keys[keys.length - 1], ID1, 'Plán\'s entry is last');
  assert.deepEqual(capped.vaults[VAULT].sidebar, { pinnedCollapsed: true }, 'the vault\'s other entries are kept');
  const again = withFolds(capped, VAULT, keys[0], ['1:Kapitola#1', '1:Program#1'], ['1:Kapitola#1']);
  assert.equal(Object.keys(again.vaults[VAULT].outline.collapsed).pop(), keys[0], 'a change moves the note\'s entry last');
  // Re-key a path to the id after the first edit.
  const path = 'Pages/Bez hlavičky.md';
  const withPath = withFolds(base(), VAULT, path, ['1:Jedna#1'], ['1:Jedna#1']);
  const moved = rekeyFolds(withPath, VAULT, path, '01JC5N0000000000000000NEW1');
  assert.ok(moved, 'rekeyFolds moves the entry');
  assert.deepEqual(moved.vaults[VAULT].outline.collapsed, { '01JC5N0000000000000000NEW1': ['1:Jedna#1'] }, 'the path key moves to the id key');
  assert.equal(rekeyFolds(base(), VAULT, path, '01JC5N0000000000000000NEW1'), null, 'nothing to move: null');
});
