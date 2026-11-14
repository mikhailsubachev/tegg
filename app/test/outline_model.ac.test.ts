// Slice OL, L1: the outline's UI model (docs/acceptance/outline.md R172, R173; docs/contracts/v1-outline.md §3.1, §3.2).
// `model.ts`: the constants, `currentSection` (FR-EDT-11 AC-9), `jumpTop` (AC-10), `railGap` (FR-EDT-16 AC-13),
// `cardChevrons` (FR-EDT-16 AC-8). D-1675: no Outline tab, so no fold model or fold store (`visibleRows`, `shownCurrent`,
// `foldButtons`, `toggle`, `allKeys`, `countText`, `folds.ts`; FR-EDT-11 AC-13, FR-STO-07 AC-7 removed). The trees are
// built here from the fixture's ATX lines with a reference of R171 rules 5–6 (parent, depth, descendants, key), so these
// tests depend only on the UI modules. Written from the ACs and the contract only (D-61). Modules load inside the tests
// (TS-I1).
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
const CTEN = () => treeOf('Pages/Čtenářské poznámky.md');
const ix = (tree: Node[], text: string, nth = 0) => tree.filter((n) => n.text === text)[nth].index;
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
