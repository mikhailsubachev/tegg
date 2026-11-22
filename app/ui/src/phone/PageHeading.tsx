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

export const PageHeading = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(function PageHeading(props, ref) {
  const target = useSyncExternalStore(subscribe, getSlot, getSlot);
  const h = <h1 ref={ref} {...props} />;
  return target ? createPortal(h, target) : h;
});
