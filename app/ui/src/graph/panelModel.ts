// Slice G2 (docs/contracts/v1-graph.md §15.2; graph-panel.md R114…R116): the right panel's pure model — the lower-depth
// offer (D-1033), the R115 state (D-1048), the trigger and footer texts (R117) and the panel fit (D-1031, D-1047).
import { t } from '../i18n/catalog';
import type { GraphResultDto } from './types';
import type { NodeKey } from './graphModel';
import type { Point } from './layout';

export type PanelState = 'graph' | 'noLinks' | 'allHidden' | 'loading' | 'tooMany' | 'noFile' | 'deleted';
/** D-1048: the input of `panelState`. */
export type PanelStateInput = {
  /** The page's object path; null on `new/<type>` and a virtual day (R115 No file). */
  path: string | null;
  /** The last error of `graph_neighbourhood`, if any. */
  error: 'CentreInTrash' | 'CentreNotFound' | 'NotReady' | null;
  /** True once 300 ms passed after the request without an answer (D-912). */
  waiting: boolean;
  /** The latest answer, or null. */
  result: GraphResultDto | null;
  /** The panel's cap (R116: 60). */
  cap?: number;
};

/** R116: the panel draws at most this many objects. */
export const PANEL_CAP = 60;

/** R114 panel scale (D-1031): diameters, the centre's ring, pill height, label width and font sizes, in px. */
export const PANEL_SCALE = {
  centre: 52,
  centreRing: 60,
  depth1: 34,
  deeper: 26,
  small: 26,
  medium: 34,
  large: 44,
  pill: 22,
  label: 96,
  centreFont: 13,
  font: 10,
  pillFont: 11,
} as const;

/** D-1033: the largest d' < depth with depthTotals[d'−1] ≤ cap, or null. */
export function lowerDepthOffer(depthTotals: number[], depth: number, cap: number): number | null {
  for (let d = depth - 1; d >= 1; d--) {
    const n = depthTotals[d - 1];
    if (typeof n === 'number' && n <= cap) return d;
  }
  return null;
}

/** D-1048 precedence: No file, Deleted, Loading, Too many, No links / All hidden, Graph; null before any answer. */
export function panelState(input: PanelStateInput): PanelState | null {
  if (input.path === null) return 'noFile';
  if (input.error === 'CentreInTrash' || input.error === 'CentreNotFound') return 'deleted';
  if (input.waiting || input.error === 'NotReady') return 'loading';
  const r = input.result;
  if (!r) return null;
  if (r.total > (input.cap ?? PANEL_CAP)) return 'tooMany';
  if (r.unfiltered <= 1) return 'noLinks';
  if (r.total <= 1) return 'allHidden';
  return 'graph';
}

/** `Depth <d>`, `Depth <d> · <n> hidden` (R114, R117; D-976: no ` · 0 hidden`). */
export function triggerText(depth: number, hidden: number): string {
  return hidden > 0 ? t('graph.panel.triggerHidden', { depth, count: hidden }) : t('graph.panel.trigger', { depth });
}

/** `<n> objects · click a node to preview` (R117); per Object preview setting (R128, AP-964 = D-1134). */
export function footerText(count: number, mode: 'click' | 'hover' | 'off' = 'click'): string {
  return t(mode === 'hover' ? 'graph.panel.footerHover' : mode === 'off' ? 'graph.panel.footerOff' : 'graph.panel.footer', { count });
}

/** D-1031, D-1047: the largest scale in [0.25, 1] at which every node's box (at 100 %), scaled about the canvas centre
 *  (where the centre is pinned), lies inside `size` with `margin`. */
export function panelFit(positions: Map<NodeKey, Point>, nodeBoxes: Map<NodeKey, { w: number; top: number; bottom: number }>, size: { width: number; height: number }, margin = 12): number {
  const cx = size.width / 2, cy = size.height / 2;
  let s = 1;
  const limit = (room: number, extent: number) => {
    if (extent > 0) s = Math.min(s, Math.max(0, room) / extent);
  };
  for (const [k, p] of positions) {
    const b = nodeBoxes.get(k);
    if (!b) continue;
    limit(cx - margin, cx - p.x + b.w / 2);
    limit(size.width - margin - cx, p.x - cx + b.w / 2);
    limit(cy - margin, cy - p.y + b.top);
    limit(size.height - margin - cy, p.y - cy + b.bottom);
  }
  return Math.min(1, Math.max(0.25, s));
}
