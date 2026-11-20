// Slice Q2.1: popups stay in the window (docs/contracts/v1-views.md §20; D-1848, D-1861, D-1867; FR-QRY-07 AC-19).
// Pure (L1): where a popup of a given natural size goes for its opener, inside the window's 8 px margins.

/** As previews R104. */
export const POPUP_MARGIN = 8;
export type Box = { left: number; top: number; right: number; bottom: number };
export type Placement = 'below-start' | 'below-end' | 'above-start' | 'above-end' | 'right' | 'left';
export type Placed = { left: number; top: number; maxHeight: number | null; placement: Placement };

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(Math.max(v, lo), hi));

/** §20's rule: below the opener, left-aligned; right-aligned with the opener's right edge when the right edge would pass
 *  `width − 8`; clamped to the margins. Above when it doesn't fit below; when it fits on neither side, the side with more
 *  room with `maxHeight` = that room (scrolling inside). `context`: the same from the pointer. `submenu`: right of its
 *  item, else left, top-aligned with it, then clamped (a submenu taller than the window gets a `maxHeight`, D-1867). */
export function placePopup(o: {
  opener: Box | { x: number; y: number };
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  kind: 'menu' | 'context' | 'submenu';
  gap?: number;
}): Placed {
  const M = POPUP_MARGIN;
  const { width: vw, height: vh } = o.viewport;
  const { width: w, height: h } = o.size;
  const r: Box = 'x' in o.opener ? { left: o.opener.x, top: o.opener.y, right: o.opener.x, bottom: o.opener.y } : o.opener;
  const gap = o.gap ?? 4;
  const room = vh - 2 * M;

  if (o.kind === 'submenu') {
    const rightRoom = vw - M - r.right;
    const leftRoom = r.left - M;
    const right = w <= rightRoom || (w > leftRoom && rightRoom >= leftRoom);
    const left = clamp(right ? r.right : r.left - w, M, vw - M - w);
    const maxHeight = h > room ? room : null;
    const top = clamp(r.top, M, vh - M - Math.min(h, room));
    return { left, top, maxHeight, placement: right ? 'right' : 'left' };
  }

  let left = r.left;
  let end = false;
  if (left + w > vw - M) { left = r.right - w; end = true; }
  left = clamp(left, M, vw - M - w);

  // The edges a popup below / above starts from, kept inside the margins (a pointer may be in them).
  const belowTop = Math.max(r.bottom + gap, M);
  const aboveBottom = Math.min(r.top - gap, vh - M);
  const below = vh - M - belowTop;
  const above = aboveBottom - M;
  let top: number;
  let maxHeight: number | null = null;
  let up: boolean;
  if (h <= below) { up = false; top = belowTop; }
  else if (h <= above) { up = true; top = aboveBottom - h; }
  else if (below >= above) { up = false; maxHeight = Math.max(0, below); top = belowTop; }
  else { up = true; maxHeight = Math.max(0, above); top = aboveBottom - maxHeight; }
  const shown = maxHeight === null ? h : Math.min(h, maxHeight);
  top = clamp(top, M, vh - M - shown);
  return { left, top, maxHeight, placement: `${up ? 'above' : 'below'}-${end ? 'end' : 'start'}` as Placement };
}
