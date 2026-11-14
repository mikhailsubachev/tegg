// Slice OL (docs/contracts/v1-outline.md §3.5; outline.md R172 rules 1–7, D-1608): the current section. Each heading's
// offset in the scroll content is cached per source; a scroll only reads `scrollTop` (one frame per burst). The cache
// is rebuilt on a new source, a layout change of the note body (ResizeObserver) and after a reveal. Never on input.
import { currentSection, END_TOLERANCE } from './model';
import { setCurrent, type OutlineSource } from './store';

let rebuildNow: (() => void) | null = null;
/** After a folded callout opened (a reveal), the offsets change. */
export function invalidateTracker(): void { rebuildNow?.(); }
let computeNow: (() => void) | null = null;
/** The current section from the scroll position now, not after the next frame (⌘J reads it). */
export function syncTracker(): void { computeNow?.(); }

/** A rendered element: itself, else its nearest ancestor that has a layout box (inside a folded callout). */
export function rendered(el: HTMLElement | null): HTMLElement | null {
  for (let e = el; e; e = e.parentElement) if (e.getClientRects().length > 0) return e;
  return null;
}

/** D-1673: the viewport's top in client coordinates: the bottom of a sticky bar inside `main` (the note toolbar,
 *  `data-sticky-top`), else `main`'s own top. The jump, heading links and the current-section line measure from it. */
export function viewportTop(main: HTMLElement): number {
  const mt = main.getBoundingClientRect().top;
  const bar = main.querySelector<HTMLElement>('[data-sticky-top]');
  return bar ? Math.max(mt, bar.getBoundingClientRect().bottom) : mt;
}

export function trackCurrent(main: HTMLElement, src: OutlineSource, body: Element | null): () => void {
  let offsets: number[] = [];
  const compute = () => {
    const st = main.scrollTop;
    const scrolls = main.scrollHeight > main.clientHeight;
    const atEnd = st + main.clientHeight >= main.scrollHeight - END_TOLERANCE;
    setCurrent(currentSection(offsets.map((o) => o - st), { scrolls, atEnd }));
  };
  const rebuild = () => {
    const mt = viewportTop(main);
    const st = main.scrollTop;
    let last = -Infinity;
    offsets = src.tree.map((_n, i) => {
      const el = rendered(src.element(i));
      const o = el ? el.getBoundingClientRect().top - mt + st : last;
      last = Math.max(last, o);
      return last;
    });
    compute();
  };
  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; compute(); });
  };
  main.addEventListener('scroll', onScroll, { passive: true });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => rebuild()) : null;
  if (body) ro?.observe(body);
  ro?.observe(main);
  rebuild();
  rebuildNow = rebuild;
  computeNow = compute;
  return () => {
    if (computeNow === compute) computeNow = null;
    main.removeEventListener('scroll', onScroll);
    if (raf) cancelAnimationFrame(raf);
    ro?.disconnect();
    if (rebuildNow === rebuild) rebuildNow = null;
  };
}
