// Slice AND-3 (docs/contracts/android-edit.md §4.2, §9.3; FR-UX-04 AC-9): the caret stays between the app bar and
// whatever covers the bottom of `main` (the formatting bar, a docked panel, the bottom bar, else the viewport's bottom).

export type Band = { top: number; bottom: number };

export function caretBand(appBarBottom: number, coverTop: number): Band {
  return { top: appBarBottom, bottom: coverTop - 8 };
}

/** `scrollTop` unchanged when the caret lies inside the band, else the smallest change that brings it inside, clamped. */
export function caretScroll(caret: { top: number; bottom: number }, band: Band, scrollTop: number, maxScroll: number): number {
  let next = scrollTop;
  if (caret.bottom > band.bottom) next = scrollTop + (caret.bottom - band.bottom);
  else if (caret.top < band.top) next = scrollTop - (band.top - caret.top);
  return Math.max(0, Math.min(next, maxScroll));
}

type View = { state: { selection: { head: number } }; coordsAtPos: (pos: number) => { top: number; bottom: number } };

/** The top of what covers `main`'s bottom: a docked panel, the bar, else the viewport's bottom. */
function coverTop(): number {
  const covers = [...document.querySelectorAll<HTMLElement>('.phone-panel, .phone-link-panel, .phone-format-bar, .phone-bottombar')];
  const tops = covers.map((c) => c.getBoundingClientRect().top).filter((t) => t > 0);
  const vh = window.visualViewport?.height ?? window.innerHeight;
  return tops.length ? Math.min(...tops) : vh;
}

/** Scrolls `main` so the caret (the selection's head) lies inside the band. */
export function keepCaretInView(view: View, main: HTMLElement | null): void {
  if (!main) return;
  let caret: { top: number; bottom: number };
  try { caret = view.coordsAtPos(view.state.selection.head); } catch { return; }
  const bar = document.querySelector('header.phone-appbar');
  const top = bar ? bar.getBoundingClientRect().bottom : main.getBoundingClientRect().top;
  const max = main.scrollHeight - main.clientHeight;
  const next = caretScroll(caret, caretBand(top, coverTop()), main.scrollTop, max);
  if (Math.abs(next - main.scrollTop) >= 1) main.scrollTop = next;
}
