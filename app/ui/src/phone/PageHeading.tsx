// Slice AND-2 (docs/contracts/android-phone.md §8.2): every page renders its heading through `PageHeading`. On the
// desktop it is the page's `h1`; on the phone it is portalled into the app bar, so the app bar holds the page's only
// `h1` (the shared heading ref of D-130 keeps working through the portal).
import { forwardRef, useSyncExternalStore, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** The phone frame's app bar registers its title slot (null when it unmounts). */
export function setHeadingSlot(el: HTMLElement | null): void {
  if (slot === el) return;
  slot = el;
  for (const f of listeners) f();
}

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const getSlot = () => slot;

/** The app bar's title slot on the phone (null on the desktop): `search` portals its field there (§8.2). */
export function useHeadingSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, getSlot, getSlot);
}

export const PageHeading = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(function PageHeading(props, ref) {
  const target = useSyncExternalStore(subscribe, getSlot, getSlot);
  const h = <h1 ref={ref} {...props} />;
  return target ? createPortal(h, target) : h;
});

// Slice AND-3 (docs/contracts/android-edit.md §7.3): the note's `Save state` sits in the app bar, before `More actions`.
let statusSlot: HTMLElement | null = null;
const statusListeners = new Set<() => void>();
export function setStatusSlot(el: HTMLElement | null): void {
  if (statusSlot === el) return;
  statusSlot = el;
  for (const f of statusListeners) f();
}
const subscribeStatus = (f: () => void) => { statusListeners.add(f); return () => { statusListeners.delete(f); }; };
const getStatusSlot = () => statusSlot;
/** The app bar's status slot on the phone (null on the desktop). */
export function useStatusSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribeStatus, getStatusSlot, getStatusSlot);
}
