// Slice 5B (D-586, FR-INB-01 AC-12; docs/contracts/ms5-capture.md §15.10): the Inbox renders a window of cards around
// the viewport. Cards have a fixed height (styles.css `.inbox-card`), so every card's place is known exactly: groups
// stack a heading and rows of `cols` cards; a group outside the window is one spacer, a rendered group has spacers
// above and below its rendered rows.

/** At most this many cards are in the page (AC-12: 100). */
export const MAX_CARDS = 90;

export type Metrics = {
  /** Card height and the grid gap (px). */
  card: number;
  gap: number;
  /** A group's heading block, margins included (px). */
  head: number;
  /** The `minmax()` minimum of a column (px), as `.inbox-cards`. */
  minCol: number;
};
export const DEFAULT_METRICS: Metrics = { card: 180, gap: 10, head: 44, minCol: 260 };

/** Columns of `repeat(auto-fill, minmax(minCol, 1fr))` in a container `width` px wide. */
export function columns(width: number, m: Metrics): number {
  return Math.max(1, Math.floor((width + m.gap) / (m.minCol + m.gap)));
}

const rowsOf = (n: number, cols: number) => Math.ceil(n / cols);
const blockOf = (rows: number, m: Metrics) => (rows === 0 ? 0 : rows * m.card + (rows - 1) * m.gap);

/** A group's slice to render: rows `[fromRow, toRow)`, the spacers above and below them, or nothing (`toRow` 0). */
export type GroupSlice = { fromRow: number; toRow: number; top: number; bottom: number; height: number };

/** The rendered slice of each group for a viewport `[top, top + height)` in list coordinates, keeping at most
 *  `MAX_CARDS` cards: the rows in view plus as many rows above and below as fit. */
export function windowOf(sizes: number[], cols: number, m: Metrics, top: number, height: number): GroupSlice[] {
  const rowStep = m.card + m.gap;
  const budgetRows = Math.max(1, Math.floor(MAX_CARDS / cols));
  const visibleRows = Math.ceil(height / rowStep) + 1;
  const buffer = Math.max(0, Math.floor((budgetRows - visibleRows) / 2));
  const lo = top - buffer * rowStep;
  const hi = top + height + buffer * rowStep;
  let y = 0;
  let left = budgetRows;
  const out: GroupSlice[] = [];
  for (const n of sizes) {
    const rows = rowsOf(n, cols);
    const cardsTop = y + m.head;
    const height = n === 0 ? 0 : m.head + blockOf(rows, m);
    let fromRow = rows;
    let toRow = rows;
    if (n > 0 && left > 0 && cardsTop + blockOf(rows, m) >= lo && y <= hi) {
      fromRow = Math.max(0, Math.min(rows - 1, Math.floor((lo - cardsTop) / rowStep)));
      toRow = Math.min(rows, Math.max(fromRow + 1, Math.ceil((hi - cardsTop) / rowStep)));
      if (toRow - fromRow > left) toRow = fromRow + left;
      left -= toRow - fromRow;
    }
    const rendered = toRow > fromRow;
    out.push({
      fromRow: rendered ? fromRow : 0,
      toRow: rendered ? toRow : 0,
      top: rendered ? fromRow * rowStep : 0,
      bottom: rendered ? (rows - toRow) * rowStep : 0,
      height,
    });
    y += height;
  }
  return out;
}

/** The top of the card at `index` (0-based in the shown order) in list coordinates. */
export function cardTop(sizes: number[], cols: number, m: Metrics, index: number): number {
  let y = 0;
  let i = index;
  for (const n of sizes) {
    if (i < n) return y + m.head + Math.floor(i / cols) * (m.card + m.gap);
    i -= n;
    y += n === 0 ? 0 : m.head + blockOf(rowsOf(n, cols), m);
  }
  return y;
}
