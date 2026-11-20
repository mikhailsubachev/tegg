// Slice Q2.1: places a popup inside the window (docs/contracts/v1-views.md §20; D-1848, D-1861, D-1867; FR-QRY-07
// AC-19). The popup is `position: fixed` (rendered in a body portal by its owner); this hook sets its `left`, `top` and,
// when it fits on neither side, `max-height` with scrolling inside, before paint, again when its size changes and after
// a window resize (next animation frame). It also sets `data-placement` and `data-popup-scroll` (§19.1).
import { useLayoutEffect, type CSSProperties, type RefObject } from 'react';
import { placePopup, type Box } from './placement';

export type PopupOpener = Box | { x: number; y: number } | HTMLElement | null;

/** Places `el` for `opener` now (also used by popups that measure themselves). */
export function placeElement(el: HTMLElement, opener: PopupOpener, kind: 'menu' | 'context' | 'submenu', gap?: number): void {
  if (!opener || (opener instanceof HTMLElement && !opener.isConnected)) return;
  const box: Box | { x: number; y: number } = opener instanceof HTMLElement
    ? (() => { const r = opener.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })()
    : opener;
  // The natural size: without a limit set by an earlier placement.
  el.style.left = '0px';
  el.style.top = '0px';
  el.style.maxHeight = 'none';
  el.style.overflowY = '';
  const r = el.getBoundingClientRect();
  const size = { width: r.width, height: Math.max(r.height, el.scrollHeight) };
  const p = placePopup({ opener: box, size, viewport: { width: window.innerWidth, height: window.innerHeight }, kind, gap });
  el.style.left = `${p.left}px`;
  el.style.top = `${p.top}px`;
  el.style.bottom = 'auto';
  el.style.right = 'auto';
  if (p.maxHeight !== null) {
    el.style.maxHeight = `${p.maxHeight}px`;
    el.style.overflowY = 'auto';
    el.setAttribute('data-popup-scroll', '');
  } else {
    el.style.maxHeight = '';
    el.style.overflowY = '';
    el.removeAttribute('data-popup-scroll');
  }
  el.setAttribute('data-placement', p.placement);
}

/** §20: keeps the popup at `ref` placed for `opener`. Returns the style its owner spreads (`position: fixed`). */
export function usePopupPlacement(ref: RefObject<HTMLElement | null>, opener: PopupOpener, kind: 'menu' | 'context' | 'submenu', gap?: number): CSSProperties {
  // Every render: the content may have changed (a sort level added, a submenu's items).
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) placeElement(el, opener, kind, gap);
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let last = '';
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (ref.current) placeElement(ref.current, opener, kind, gap); });
    };
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      // Only a change of the content's size places it again (a limit this hook set changes the box, not the content).
      const k = `${el.scrollWidth}x${el.scrollHeight}`;
      if (k === last) return;
      last = k;
      again();
    });
    ro?.observe(el);
    window.addEventListener('resize', again);
    return () => { cancelAnimationFrame(frame); ro?.disconnect(); window.removeEventListener('resize', again); };
  }, [ref, opener, kind, gap]);
  return { position: 'fixed' };
}
