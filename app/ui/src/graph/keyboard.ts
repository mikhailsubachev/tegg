// Slice G3 (docs/contracts/v1-graph.md §16.3, §16.5; R120; AP-933…AP-936): the graph's keyboard rules, pure.
// Red-test stub (TS-I1): the contract's signatures, not implemented yet.
import type { Point } from './layout';
import type { NodeKey } from './graphModel';

export type Direction = 'left' | 'right' | 'up' | 'down';
export type PreviewMode = 'click' | 'hover' | 'off';
export type GraphKeyAction = 'focusDir' | 'preview' | 'open' | 'centre' | 'zoomIn' | 'zoomOut' | 'fit' | 'escape' | null;
/** The key event fields the rules read (a `KeyboardEvent` fits). */
export type KeyLike = { key: string; code?: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean };

/** R120 arrow rule (AP-934): from `from`'s layout position (x right, y down), the candidates for `dir` lie strictly
 *  ahead with |cross| ≤ primary; the lowest `primary + 2 × |cross|`, then the lowest distance, then the lowest sort
 *  key. `null`: no candidate. */
export function nearestInDirection(positions: Map<NodeKey, Point>, from: NodeKey, dir: Direction, sortKeys: Map<NodeKey, string>): NodeKey | null {
  void positions; void from; void dir; void sortKeys;
  throw new Error('keyboard.nearestInDirection: not implemented (G3)');
}
/** R120's key table for a key pressed with the focus on a node (`'node'`) or a List row (`'row'`); `null` for keys
 *  the graph doesn't take, and with ⌘, ⌃ or ⌥ held except ⌘⏎, ⌘⇧⏎ and ⌥Space. */
export function graphKeyAction(event: KeyLike, mode: PreviewMode, target: 'node' | 'row'): GraphKeyAction {
  void event; void mode; void target;
  throw new Error('keyboard.graphKeyAction: not implemented (G3)');
}
