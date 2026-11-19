// Slice Q2 (docs/contracts/v1-views.md §4.3 Live region; FR-UX-08 AC-24): the polite live region of views and boards
// (`board.moved`, `board.added`, `board.leftView`, `board.inlineKept`, `board.laneMoved`, `views.moved`), one
// announcement per action. Its own element at the start of the body, so it is the page's first polite region.
let host: HTMLElement | null = null;
let n = 0;

function region(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (host && host.isConnected) return host;
  host = document.createElement('div');
  host.id = 'views-live';
  host.className = 'sr-live';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  document.body.prepend(host);
  return host;
}

/** Announces `text` once (a new child, so the same text twice is read twice). */
export function announceView(text: string): void {
  const el = region();
  if (!el) return;
  const s = document.createElement('span');
  s.dataset.n = String(++n);
  s.textContent = text;
  el.replaceChildren(s);
}

/** Creates the region ahead of the first announcement (a live region must exist before it changes). */
export function ensureViewsLive(): void {
  region();
}
