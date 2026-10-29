// Hover to preview (FR-LNK-12 AC-2; D-942, D-917): the delay counts from the last pointer movement over a
// reference; a key, a wheel or scroll, or a held button cancels it; leaving the reference and the preview hides a
// hover preview after the 300 ms grace unless the pointer comes back.
import { HOVER_GRACE } from './state';
import { close, getCurrent, getPrefs, show } from './store';
import type { PreviewTarget } from './types';

let timer: ReturnType<typeof setTimeout> | null = null;
let grace: ReturnType<typeof setTimeout> | null = null;
let over: HTMLElement | null = null;
/** The pointer is over the preview itself (its enter can come before the reference's leave). */
let onPopover = false;
let installed = false;

const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
const clearGrace = () => { if (grace) { clearTimeout(grace); grace = null; } };

function install() {
  if (installed) return;
  installed = true;
  const cancel = () => {
    clear();
    // Typing or scrolling hides a hover preview at once (D-942).
    const c = getCurrent();
    if (c && c.origin === 'hover') close('outside');
  };
  window.addEventListener('keydown', cancel, true);
  window.addEventListener('wheel', (e) => {
    // The wheel over a hover preview scrolls it.
    if ((e.target as HTMLElement | null)?.closest?.('[data-preview-popover]')) return;
    cancel();
  }, { capture: true, passive: true });
  window.addEventListener('pointerdown', clear, true);
}

export function hoverMove(target: PreviewTarget, el: HTMLElement, held: boolean, open?: () => void): void {
  install();
  clear();
  clearGrace();
  if (held) return;
  over = el;
  const c = getCurrent();
  // Already showing this reference: nothing to do.
  if (c && 'el' in c.anchor && c.anchor.el === el) return;
  timer = setTimeout(() => {
    timer = null;
    if (over !== el || !el.isConnected) return;
    show(target, { el }, 'hover', undefined, undefined, { open });
  }, getPrefs().hoverDelay);
}

export function hoverLeave(): void {
  clear();
  over = null;
  startGrace();
}

/** The pointer left a hover preview or its reference: hide after the grace. */
export function startGrace(fromPopover = false): void {
  if (fromPopover) onPopover = false;
  else if (onPopover) return;
  clearGrace();
  const c = getCurrent();
  if (!c || c.origin !== 'hover') return;
  grace = setTimeout(() => {
    grace = null;
    const now = getCurrent();
    if (now && now.seq === c.seq && now.origin === 'hover') close('outside');
  }, HOVER_GRACE);
}

/** The pointer is over the preview (or back on its reference): keep it. */
export function keepHover(): void {
  onPopover = true;
  clearGrace();
}

/** The popover is gone: the pointer is no longer over it. */
export function popoverGone(): void {
  onPopover = false;
}
