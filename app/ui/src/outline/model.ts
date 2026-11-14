// Slice OL (docs/contracts/v1-outline.md §3.1, §3.2; docs/acceptance/outline.md R170, R172, R173): the outline's pure
// UI model, shared by the edge rail and its card. No DOM.
import type { OutlineNode } from '@tegg/doc';

export const REFRESH_MS = 120;
export const CURRENT_LINE = 30;
export const END_TOLERANCE = 2;
export const JUMP_TOP = 24;
export const FLASH_MS = 2000;
export const FLASH_FADE_MS = 300;
export const HOVER_OPEN_MS = 150;
export const HOVER_CLOSE_MS = 300;
export const RAIL_FADE_MS = 150;
export const CHEVRON_MS = 120;
export const ROW_H = 26;
export const INDENT = 14;
export const RAIL_MIN_PANE = 640;
export const RAIL_RIGHT = 14;
/** Vertical, horizontal. */
export const RAIL_PAD: [number, number] = [12, 8];
export const RAIL_LINE = 1.5;
export const RAIL_LINE_ON = 2;
export const RAIL_GAP = 7;
export const RAIL_MIN_GAP = 2;
export const RAIL_MARGIN = 48;
export const LINE_W: Record<1 | 2 | 3 | 4 | 5 | 6, number> = { 1: 18, 2: 13, 3: 9, 4: 7, 5: 5, 6: 4 };
export const CARD_W = 256;
export const CARD_RIGHT = 52;
export const CARD_MAX_H = 520;
export const CARD_MAX_VH = 0.8;
export const TEXT_CLEARANCE = 44;

type Tree = readonly OutlineNode[];

/** R172 rules 1–4: `tops` in viewport coordinates, in note order. */
export function currentSection(tops: readonly number[], o: { scrolls: boolean; atEnd: boolean }): number | null {
  if (!tops.length) return null;
  if (o.scrolls && o.atEnd) return tops.length - 1;
  let lo = 0;
  let hi = tops.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid] <= CURRENT_LINE) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** R173, D-1615, D-1635: the gap between rail lines for `n` lines in `height` px; null when they don't fit. */
export function railGap(n: number, height: number): number | null {
  if (n <= 1) return n * RAIL_LINE <= height ? RAIL_GAP : null;
  if (n * RAIL_LINE + (n - 1) * RAIL_GAP <= height) return RAIL_GAP;
  const gap = (height - n * RAIL_LINE) / (n - 1);
  return gap >= RAIL_MIN_GAP ? gap : null;
}

/** D-1616: rows with children the card doesn't show, plus the rows opened in this card. */
export function cardChevrons(tree: Tree, rows: readonly number[], tempOpen: ReadonlySet<number>): Set<number> {
  const shown = new Set(rows);
  const out = new Set<number>();
  for (const i of rows) {
    const n = tree[i];
    if (n && n.children.length && n.children.some((c) => !shown.has(c))) out.add(i);
  }
  for (const i of tempOpen) if (shown.has(i)) out.add(i);
  return out;
}

/** §3.4 step 3: the scroll top that puts an element at `JUMP_TOP` px below the viewport's top. */
export function jumpTop(elementTop: number, scrollTop: number, max: number): number {
  return Math.min(Math.max(elementTop + scrollTop - JUMP_TOP, 0), Math.max(0, max));
}
