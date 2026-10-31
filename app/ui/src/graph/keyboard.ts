// Slice G3 (docs/contracts/v1-graph.md §16.3, §16.5; R120; AP-933…AP-936): the graph's keyboard rules, pure: the arrow
// rule over layout positions and R120's key table for a focused node or List row.
import type { Point } from './layout';
import type { NodeKey } from './graphModel';

export type Direction = 'left' | 'right' | 'up' | 'down';
export type PreviewMode = 'click' | 'hover' | 'off';
export type GraphKeyAction = 'focusDir' | 'preview' | 'open' | 'centre' | 'zoomIn' | 'zoomOut' | 'fit' | 'escape' | null;
/** The key event fields the rules read (a `KeyboardEvent` fits). */
export type KeyLike = { key: string; code?: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean };

export const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

/** R120 arrow rule (AP-934): from `from`'s layout position (x right, y down), the candidates for `dir` lie strictly
 *  ahead with |cross| ≤ primary; the lowest `primary + 2 × |cross|`, then the lowest distance, then the lowest sort
 *  key. `null`: no candidate. */
export function nearestInDirection(positions: Map<NodeKey, Point>, from: NodeKey, dir: Direction, sortKeys: Map<NodeKey, string>): NodeKey | null {
  const o = positions.get(from);
  if (!o) return null;
  let best: { k: NodeKey; s: number; d: number; key: string } | null = null;
  for (const [k, p] of positions) {
    if (k === from) continue;
    const dx = p.x - o.x, dy = p.y - o.y;
    const [primary, cross] = dir === 'right' ? [dx, dy] : dir === 'left' ? [-dx, dy] : dir === 'down' ? [dy, dx] : [-dy, dx];
    if (!(primary > 0) || Math.abs(cross) > primary) continue;
    const s = primary + 2 * Math.abs(cross), d = Math.hypot(dx, dy), key = sortKeys.get(k) ?? k;
    if (!best || s < best.s || (s === best.s && (d < best.d || (d === best.d && key < best.key)))) best = { k, s, d, key };
  }
  return best?.k ?? null;
}

/** R120's key table for a key pressed with the focus on a node (`'node'`) or a List row (`'row'`); `null` for keys
 *  the graph doesn't take, and with ⌘, ⌃ or ⌥ held except ⌘⏎, ⌘⇧⏎ and ⌥Space (D-1107: ⇧ alone is fine). The List
 *  handles its tree keys (↑ ↓ ← → Home End) itself. */
export function graphKeyAction(event: KeyLike, mode: PreviewMode, target: 'node' | 'row'): GraphKeyAction {
  void target;
  const meta = !!event.metaKey, ctrl = !!event.ctrlKey, alt = !!event.altKey;
  if (event.key === 'Enter') {
    if (ctrl || alt) return null;
    if (meta) return 'open'; // ⌘⏎ and ⌘⇧⏎ (AP-933: in the current view until tabs)
    return mode === 'click' ? 'preview' : 'open';
  }
  if (alt && !meta && !ctrl && (event.code === 'Space' || event.key === ' ')) return 'preview'; // ⌥Space, every mode (D-928)
  if (meta || ctrl || alt) return null;
  if (event.key === 'Escape') return 'escape';
  if (ARROWS[event.key]) return 'focusDir';
  if (event.code === 'KeyC' || event.key === 'c' || event.key === 'C') return 'centre';
  if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return 'zoomIn';
  if (event.key === '-' || event.key === '−' || event.code === 'NumpadSubtract') return 'zoomOut';
  if (event.key === '0' || event.code === 'Numpad0') return 'fit';
  return null;
}
