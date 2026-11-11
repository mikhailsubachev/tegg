// D-1511 (FR-NAV-03 AC-11…AC-14; docs/contracts/ms3-shell.md §12.2): the two-finger swipe between pages, as in the
// browser. A gesture is the `wheel` events until 200 ms pass without one, and its first event decides it: a mostly
// vertical start, or a pointer over something that scrolls sideways (at its edges too) or over the graph's drawing
// (which pans, D-1169), never navigates. Otherwise the gesture's net deltaX counts, and at 120 px it goes Back
// (deltaX < 0: fingers move right) or Forward, once; the rest of the gesture (its momentum) is ignored. Nothing is
// prevented here: what scrolls keeps scrolling. Timing comes from the events' `timeStamp`, never from `Date`.

/** A gesture ends this long after its last `wheel` event (ms). */
export const SWIPE_GESTURE_GAP_MS = 200;
/** The net horizontal travel that navigates (px). */
export const SWIPE_DISTANCE_PX = 120;

/** Line and page wheel deltas in pixels (a mouse may report lines). */
const pixels = (d: number, mode: number) => (mode === 1 ? d * 16 : mode === 2 ? d * window.innerWidth : d);

/** `el` or an ancestor scrolls sideways (content wider than its box), or is the graph's drawing, which pans. */
export function scrollsOrPansSideways(el: Element | null): boolean {
  if (el?.closest('svg.graph-svg')) return true;
  for (let n = el; n; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1 && /^(auto|scroll)$/.test(getComputedStyle(n).overflowX)) return true;
  }
  return false;
}

type Options = {
  /** macOS's `Swipe between pages` scrolls with two fingers (`nav_swipe_scroll`), as last answered. */
  enabled: () => boolean;
  /** The palette, the New object picker or a dialog is open (AC-6): no navigation. */
  blocked: () => boolean;
  step: (dir: 'back' | 'forward') => void;
};

/** Installs the window `wheel` listener; returns its removal. */
export function installNavSwipe(o: Options): () => void {
  let last = -Infinity; // the previous wheel event's timeStamp
  let state: 'idle' | 'tracking' | 'done' = 'done';
  let net = 0;
  const onWheel = (e: WheelEvent) => {
    const fresh = e.timeStamp - last >= SWIPE_GESTURE_GAP_MS;
    last = e.timeStamp;
    if (fresh) {
      net = 0;
      const horizontal = Math.abs(e.deltaY) <= Math.abs(e.deltaX);
      state = o.enabled() && !e.ctrlKey && !e.metaKey && horizontal && !scrollsOrPansSideways(e.target instanceof Element ? e.target : null) ? 'tracking' : 'idle';
    }
    if (state !== 'tracking') return;
    net += pixels(e.deltaX, e.deltaMode);
    if (Math.abs(net) < SWIPE_DISTANCE_PX) return;
    state = 'done'; // one step per gesture, its momentum included
    if (!o.enabled() || o.blocked()) return;
    o.step(net < 0 ? 'back' : 'forward');
  };
  window.addEventListener('wheel', onWheel, { passive: true, capture: true });
  return () => window.removeEventListener('wheel', onWheel, { capture: true });
}
