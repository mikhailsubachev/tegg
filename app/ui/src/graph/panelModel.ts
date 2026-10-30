// Slice G2 (docs/contracts/v1-graph.md §15.2; graph-panel.md R114…R116): the right panel's pure model — the lower-depth
// offer (D-1033), the R115 state, the trigger and footer texts (R117) and the panel fit (D-1031).
//
// STUB (G2 red tests, TS-I1): no behaviour until slice G2 is built.
import type { GraphResultDto } from './types';
import type { NodeKey } from './graphModel';
import type { Point } from './layout';

export type PanelState = 'graph' | 'noLinks' | 'allHidden' | 'loading' | 'tooMany' | 'noFile' | 'deleted';
/** Red-test point AP-898: the input of `panelState`. */
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
/** R114 panel scale (D-1031). */
export const PANEL_SCALE: Record<string, number> = {};

/** D-1033: the largest d' < depth with depthTotals[d'−1] ≤ cap, or null. */
export function lowerDepthOffer(_depthTotals: number[], _depth: number, _cap: number): number | null {
  return null;
}
export function panelState(_input: PanelStateInput): PanelState | null {
  return null;
}
/** `Depth <d>`, `Depth <d> · <n> hidden` (R114, R117). */
export function triggerText(_depth: number, _hidden: number): string {
  return '';
}
/** `<n> objects · click a node to preview` (R117). */
export function footerText(_count: number): string {
  return '';
}
/** D-1031: the first-paint scale (≤ 1, ≥ 0.25) that fits every node's box inside `size` with `margin`, the centre pinned. */
export function panelFit(_positions: Map<NodeKey, Point>, _nodeBoxes: Map<NodeKey, { w: number; top: number; bottom: number }>, _size: { width: number; height: number }, _margin = 12): number {
  return Number.NaN;
}
