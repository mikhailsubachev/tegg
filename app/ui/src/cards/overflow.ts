// Two rows, then `+N more` (docs/contracts/v1-cards.md §7.2; D-1949, D-1977): every item of a pill area is rendered;
// after layout the items after the second row get `hidden` and `data-overflow` (they stay in the DOM), and `+N more`
// becomes the last visible item of row 2, its tooltip naming the hidden items. `Unreviewed` is never hidden or counted.
// Recomputed within one animation frame of a size change. A pill whose value is cut gets `<Name>: <value>` as tooltip.
import { useLayoutEffect, type RefObject } from 'react';
import { catalogLocale, t } from '../i18n/catalog';

const ITEM = ':scope > [data-attribute], :scope > .card-unreviewed';

function list(xs: string[]): string {
  try { return new Intl.ListFormat(catalogLocale(), { type: 'unit', style: 'short' }).format(xs); } catch { return xs.join(', '); }
}

/** One pass over `area` (a `.card-pills` or the preview's region). */
export function layoutRows(area: HTMLElement): void {
  const items = [...area.querySelectorAll<HTMLElement>(ITEM)];
  for (const e of items) { e.hidden = false; e.removeAttribute('data-overflow'); e.style.maxWidth = ''; }
  area.querySelector(':scope > .card-more')?.remove();
  const titles = () => {
    // A cut value: the pill's tooltip names it in full (AP-1585).
    for (const e of items) {
      if (!e.hasAttribute('data-name-title') || e.hidden) continue;
      const base = e.getAttribute('data-name-title') ?? '';
      e.setAttribute('title', e.scrollWidth > e.clientWidth + 1 ? (e.getAttribute('aria-label') ?? base) : base);
    }
  };
  const rows = () => [...new Set(items.filter((e) => !e.hidden).map((e) => e.offsetTop))].sort((a, b) => a - b);
  const tops = rows();
  if (items.length === 0 || tops.length <= 2) { titles(); return; }
  const row2 = tops[1];
  const hidden: HTMLElement[] = [];
  const hide = (e: HTMLElement) => { e.hidden = true; e.setAttribute('data-overflow', ''); hidden.unshift(e); };
  // `Unreviewed`, the preview strip's footer link (D-1981) and a Task card's R43 chips (D-1904) are never hidden or counted.
  const fixed = (e: HTMLElement) => e.classList.contains('card-unreviewed') || e.hasAttribute('data-footer-link') || e.classList.contains('task-chip');
  for (const e of [...items].reverse()) if (e.offsetTop > row2 && !fixed(e)) hide(e);
  const more = document.createElement('span');
  more.className = 'card-more';
  area.insertBefore(more, items.find((e) => e.hasAttribute('data-footer-link')) ?? null);
  const tail = () => Math.max(more.offsetTop, ...items.filter((e) => e.hasAttribute('data-footer-link')).map((e) => e.offsetTop));
  const show = () => {
    more.textContent = t('card.more', { count: hidden.length });
    const hint = t('card.moreHint', { items: list(hidden.map((e) => e.getAttribute('aria-label') ?? (e.textContent ?? '').trim()).filter(Boolean)) });
    more.setAttribute('title', hint);
    more.setAttribute('aria-description', hint);
  };
  show();
  // `+N more` must sit on row 2: narrow the last visible item so it fits beside it, else hide that item and try again.
  const gap = parseFloat(getComputedStyle(area).columnGap) || 4;
  for (let guard = 0; guard <= items.length && tail() > row2; guard++) {
    const last = [...items].reverse().find((e) => !e.hidden && !fixed(e));
    if (!last) break;
    const avail = area.getBoundingClientRect().right - last.getBoundingClientRect().left - more.getBoundingClientRect().width - gap - 1;
    if (last.offsetTop === row2 && !last.style.maxWidth && avail >= 56 && avail < last.getBoundingClientRect().width) {
      last.style.maxWidth = `${Math.floor(avail)}px`;
      continue;
    }
    hide(last);
    show();
  }
  titles();
}

/** Keeps `area`'s items on two rows while it is mounted (§7.2). `deps` change when the items do. */
export function useTwoRows(ref: RefObject<HTMLElement | null>, deps: unknown[]): void {
  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    layoutRows(area);
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (ref.current) layoutRows(ref.current); });
    };
    let width = area.getBoundingClientRect().width;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      const w = area.getBoundingClientRect().width;
      if (Math.abs(w - width) < 0.5) return;
      width = w;
      layoutRows(area);
      again();
    }) : null;
    ro?.observe(area);
    void document.fonts?.ready.then(again).catch(() => {});
    return () => { ro?.disconnect(); cancelAnimationFrame(frame); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
