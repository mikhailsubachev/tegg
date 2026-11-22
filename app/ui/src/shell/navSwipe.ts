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

/** D-1939: after a step, for this long, a gap counts as a pause only if the app was idle through it (ms). */
export const SWIPE_BUSY_WATCH_MS = 2000;
/** The idle check's tick (ms); a pause needs ticks spread over at least half the gesture gap. */
const TICK_MS = 16;
const IDLE_TICKS = Math.ceil(SWIPE_GESTURE_GAP_MS / 2 / TICK_MS);

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
  // D-1939: the time the app spends busy (drawing the page a swipe went to, loading its data) is never a pause between
  // that swipe's wheel events. After a step a timer ticks while the main thread is free; a gap ends the gesture only if
  // the ticks show the app was idle for at least half of it. A busy main thread delays the ticks and the next events.
  let stepAt = -Infinity;
  let ticks: number[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = () => {
    const now = performance.now();
    ticks.push(now);
    timer = now - stepAt < SWIPE_BUSY_WATCH_MS ? setTimeout(tick, TICK_MS) : null;
  };
  const watch = (from: number) => {
    stepAt = from;
    ticks = [];
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, TICK_MS);
  };
  const idleThrough = (from: number, to: number) => ticks.filter((t) => t > from && t < to).length >= IDLE_TICKS;
  const onWheel = (e: WheelEvent) => {
    const gap = e.timeStamp - last >= SWIPE_GESTURE_GAP_MS;
    const watching = e.timeStamp - stepAt < SWIPE_BUSY_WATCH_MS;
    const fresh = gap && (!watching || idleThrough(last, e.timeStamp));
    last = e.timeStamp;
    if (fresh) {
      net = 0;
      stepAt = -Infinity;
      const horizontal = Math.abs(e.deltaY) <= Math.abs(e.deltaX);
      state = o.enabled() && !e.ctrlKey && !e.metaKey && horizontal && !scrollsOrPansSideways(e.target instanceof Element ? e.target : null) ? 'tracking' : 'idle';
    }
    if (state !== 'tracking') return;
    net += pixels(e.deltaX, e.deltaMode);
    if (Math.abs(net) < SWIPE_DISTANCE_PX) return;
    state = 'done'; // one step per gesture, its momentum included
    if (!o.enabled() || o.blocked()) return;
    watch(e.timeStamp);
    o.step(net < 0 ? 'back' : 'forward');
  };
  window.addEventListener('wheel', onWheel, { passive: true, capture: true });
  return () => { if (timer) clearTimeout(timer); window.removeEventListener('wheel', onWheel, { capture: true }); };
}
