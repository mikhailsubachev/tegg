// Slice G3 (docs/contracts/v1-graph.md §16.3, §16.5; R120; D-942, AP-941, AP-942): the hover controller for nodes and
// List rows in the full view. The delay counts from the last pointer movement over a node; the ring shows while it
// runs (nodes only); at its end the preview shows in the column. A hover preview stays while the pointer is over the
// canvas or the column and hides 300 ms after it has left both (AP-941), or at once on `cancel` (Esc, a click on empty
// canvas, a key in the graph, a wheel, a pan). Timers are the window's, so a test's installed clock drives them.
// Slice "G3 in the panel" (v1-graph §17.1, AP-941 = D-1101): with `grace: 'popover'` (the right panel) a hover preview
// hides 300 ms after the pointer has left both the node it shows and the popover; the empty canvas counts as outside.
import { HOVER_GRACE } from '../preview/state';
import type { NodeKey } from './graphModel';

export type GraphHoverHost = {
  /** `preview.hoverDelay` now (D-923): a setting change applies to the next hover. */
  delay(): number;
  /** The delay ran out on `key`: show its preview in the column (`origin: 'hover'`). */
  show(key: NodeKey): void;
  /** Hide a hover preview (a clicked one stays). */
  hide(): void;
  /** Whether `key`'s hover preview is still shown (Esc or a click inside may have closed or kept it). */
  showing(key: NodeKey): boolean;
  /** The node that shows the ring (again: restart it), or null. */
  ring(key: NodeKey | null): void;
};

export type GraphHover = {
  /** The pointer entered or moved over a node (`ring`: a canvas node, not a List row). */
  move(key: NodeKey, ring: boolean): void;
  /** The pointer left the node: the delay stops and the ring goes. */
  leave(key: NodeKey): void;
  /** The pointer entered or left the canvas or the preview column (`'popover'`: the preview popover, panel only). */
  area(part: 'canvas' | 'column' | 'popover', inside: boolean): void;
  /** Hides at once and stops the delay. */
  cancel(): void;
  dispose(): void;
};

export function graphHover(host: GraphHoverHost, opts: { grace?: 'column' | 'popover' } = {}): GraphHover {
  const popoverGrace = opts.grace === 'popover';
  let timer: number | null = null;
  let grace: number | null = null;
  let over: NodeKey | null = null;
  let shown: NodeKey | null = null;
  const inside = { canvas: false, column: false, popover: false };
  const stop = () => { if (timer !== null) { window.clearTimeout(timer); timer = null; } };
  const stopGrace = () => { if (grace !== null) { window.clearTimeout(grace); grace = null; } };
  const hide = () => { shown = null; host.hide(); };
  /** `'popover'`: the pointer is on neither the shown node nor the popover. */
  const awayFromShown = () => !inside.popover && (shown === null || over !== shown);
  const startPopoverGrace = () => {
    stopGrace();
    if (shown === null) return;
    grace = window.setTimeout(() => { grace = null; if (awayFromShown()) hide(); }, HOVER_GRACE);
  };
  return {
    move(key, ring) {
      stopGrace();
      over = key;
      if (shown === key && host.showing(key)) return;
      stop();
      if (ring) host.ring(key); // the ring restarts with the delay
      timer = window.setTimeout(() => {
        timer = null;
        if (over !== key) return;
        shown = key;
        host.show(key); // the ring stays, full, while the pointer rests there
      }, host.delay());
    },
    leave(key) {
      if (over !== key) return;
      over = null;
      stop();
      host.ring(null);
      if (popoverGrace && shown !== null && !inside.popover) startPopoverGrace();
    },
    area(part, now) {
      inside[part] = now;
      if (popoverGrace) {
        if (part !== 'popover') return;
        if (now) stopGrace(); else if (awayFromShown()) startPopoverGrace();
        return;
      }
      if (inside.canvas || inside.column) { stopGrace(); return; }
      stopGrace();
      if (shown === null) return;
      grace = window.setTimeout(() => { grace = null; if (!inside.canvas && !inside.column) hide(); }, HOVER_GRACE);
    },
    cancel() {
      stop();
      stopGrace();
      over = null;
      host.ring(null);
      if (shown !== null) hide();
    },
    dispose() {
      stop();
      stopGrace();
    },
  };
}
