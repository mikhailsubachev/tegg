// Slice Q3: the ungrouped wall's grid (docs/contracts/v1-views.md §40.1 `queries/board/grid.ts`; R224; board W1;
// D-2185): as many columns as fit while each card is at least 220 px, cards 220…300 px, the rows to render around the
// viewport, and the keyboard's neighbours in reading order.

export const GRID = { min: 220, max: 300, gap: 12 } as const;

/** Columns and card width for a content width (fewer cards than columns: 300 px cards, left-aligned). */
export function gridOf(width: number, count: number): { columns: number; cardWidth: number } {
  const columns = Math.max(1, Math.floor((width + GRID.gap) / (GRID.min + GRID.gap)));
  if (count < columns) return { columns, cardWidth: GRID.max };
  const cardWidth = Math.min(GRID.max, (width - (columns - 1) * GRID.gap) / columns);
  return { columns, cardWidth };
}

/** The rows to render: the visible ones (by measured heights, the gap included in each) ± `overscan`. */
export function windowRows(heights: readonly number[], scrollTop: number, viewport: number, overscan = 2): [number, number] {
  const n = heights.length;
  if (n === 0) return [0, -1];
  let top = 0;
  let first = n - 1;
  let i = 0;
  for (; i < n; i++) {
    if (top + heights[i]! > scrollTop) { first = i; break; }
    top += heights[i]!;
  }
  if (i === n) first = n - 1;
  let last = first;
  let y = top;
  for (let j = first; j < n; j++) {
    last = j;
    y += heights[j]!;
    if (y >= scrollTop + viewport) break;
  }
  return [Math.max(0, first - overscan), Math.min(n - 1, last + overscan)];
}

/** The card a key moves to (→ / ← reading order, ↓ / ↑ the same column), clamped to the cards. */
export function gridNeighbour(index: number, key: string, columns: number, count: number): number {
  const c = Math.max(1, columns);
  let next = index;
  if (key === 'ArrowRight') next = index + 1;
  else if (key === 'ArrowLeft') next = index - 1;
  else if (key === 'ArrowDown') next = index + c < count ? index + c : index;
  else if (key === 'ArrowUp') next = index - c >= 0 ? index - c : index;
  return Math.min(Math.max(0, next), Math.max(0, count - 1));
}
