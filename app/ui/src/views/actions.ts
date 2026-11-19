// Slice Q2 (docs/contracts/v1-views.md §4.7; R191, D-1771, D-1789): the palette's view, sort and board commands reach
// the surface that shows them through this bridge. `TypeViews`, `QueryPage` and a selected `QueryBlock` register a
// handler while they are shown; the latest one answers (`ShellActions.views`).
import { useEffect, useRef } from 'react';
import type { ViewsStatus } from '../shell/commands';

export type ViewsHandler = { status(): ViewsStatus | null; run(id: string): void };

const stack: ViewsHandler[] = [];

export const viewsActions: ViewsHandler = {
  status: () => stack[stack.length - 1]?.status() ?? null,
  run: (id) => stack[stack.length - 1]?.run(id),
};

/** Registers `h` while `on` (the handler object stays the same; its functions read the latest render). */
export function useViewsHandler(on: boolean, h: ViewsHandler): void {
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => {
    if (!on) return;
    const me: ViewsHandler = { status: () => ref.current.status(), run: (id) => ref.current.run(id) };
    stack.push(me);
    return () => { const i = stack.indexOf(me); if (i >= 0) stack.splice(i, 1); };
  }, [on]);
}

// ------------------------------------------------------------------ the focus the palette's commands act on

/** The last focused element outside a dialog (the palette takes the focus while it lists commands, D-139). */
let lastFocus: Element | null = null;
let watching = false;
export function watchFocus(): void {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  document.addEventListener('focusin', (e) => {
    const el = e.target as Element | null;
    if (!el || el.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return;
    lastFocus = el;
  }, true);
}
export function lastFocused(): Element | null {
  return lastFocus && lastFocus.isConnected ? lastFocus : null;
}
