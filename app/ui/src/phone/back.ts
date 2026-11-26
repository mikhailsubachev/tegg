// Slice AND-2 (docs/contracts/android-phone.md §8.5; RA12, FR-NAV-03 AC-17, CP-3 → D-2431): what system Back does.
// First match wins: close the topmost layer, else go back, else let the app go to the background.
import { flushSync } from 'react-dom';

type Layer = { close(): void };

const layers: Layer[] = [];

/** A menu, the drawer, a sheet, the calendar or a full-screen map registers while open; the last one is on top. */
export function pushLayer(close: () => void): () => void {
  const l: Layer = { close };
  layers.push(l);
  installEscape();
  return () => {
    const i = layers.indexOf(l);
    if (i >= 0) layers.splice(i, 1);
  };
}

export const layerOpen = () => layers.length > 0;

let backFn: (() => boolean) | null = null;

/** The frame's history Back: true when it went back. */
export function setHistoryBack(f: () => boolean): void {
  backFn = f;
}

export function systemBack(): boolean {
  const top = layers[layers.length - 1];
  if (top) {
    // Closed before Back returns, as the system expects.
    flushSync(() => top.close());
    return true;
  }
  // Slice AND-3 (android-edit §10.6, CP-10): unsaved edits wait for a choice in the merge banner or the deleted alert.
  if (focusBlockingAlert()) return true;
  return backFn ? backFn() : false;
}

/** Focuses the merge banner or the deleted alert when one is shown; true when it did. */
export function focusBlockingAlert(): boolean {
  if (typeof document === 'undefined') return false;
  const a = document.querySelector<HTMLElement>('main .phone-merge, main .phone-deleted');
  if (!a) return false;
  a.focus();
  return true;
}

// Escape (a hardware keyboard, the tests) closes the top layer like system Back, wherever the focus is: a layer whose
// own key handler took it has stopped it before it gets here.
let escapeInstalled = false;
function installEscape(): void {
  if (escapeInstalled || typeof document === 'undefined') return;
  escapeInstalled = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const top = layers[layers.length - 1];
    if (!top) return;
    e.preventDefault();
    flushSync(() => top.close());
  });
}
