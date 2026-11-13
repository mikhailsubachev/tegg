// D-1674 (FR-UX-03; found by FR-SYN-06 AC-42): a double-click whose first click opens another page (an embed's header
// title, D-1166, a link) must not deliver its second click to the page just opened, where whatever happens to be under
// the pointer (a link, a checkbox, a word to select) would act. After a route change, mouse events of a multi-click
// (`detail ≥ 2`) are swallowed until the next single press (`detail` 1), which works as usual. No timer: the system
// starts a new count once its double-click interval has passed.
let armed = false;

/** A route change: the multi-click in progress, if any, began on the page that was left. */
export function routeChanged(): void { armed = true; }

const KINDS = ['mousedown', 'mouseup', 'click', 'dblclick'] as const;

/** Installs the guard on `target` (capture phase, before the editor's own handlers); returns its removal. */
export function installMultiClickGuard(target: Window = window): () => void {
  const on = (e: MouseEvent) => {
    if (e.type === 'mousedown' && e.detail <= 1) { armed = false; return; }
    if (!armed || e.detail < 2) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  for (const k of KINDS) target.addEventListener(k, on, true);
  return () => { for (const k of KINDS) target.removeEventListener(k, on, true); };
}
