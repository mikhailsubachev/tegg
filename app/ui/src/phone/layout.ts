// Slice AND-2 (docs/contracts/android-phone.md §4.1; FR-UX-04 AC-1, D-2416): the layout is chosen by platform, not by
// width: Android gets the phone layout at every width, macOS the desktop.
import { platform } from '../platform';

export type Layout = 'phone' | 'desktop';

/** `width` is kept for a later narrow-window rule and ignored now (D-2416). */
export function layoutFor(o: { platform: 'android' | 'macos'; width: number }): Layout {
  return o.platform === 'android' ? 'phone' : 'desktop';
}

let cached: Layout | null = null;

/** `window.__TEGG_LAYOUT__` when set (the test hook, read once), else `layoutFor` of the platform. */
export function currentLayout(): Layout {
  if (cached) return cached;
  const w = (globalThis as { window?: { __TEGG_LAYOUT__?: unknown; innerWidth?: number } }).window;
  const forced = w?.__TEGG_LAYOUT__;
  const l: Layout = forced === 'phone' || forced === 'desktop' ? forced : layoutFor({ platform: platform(), width: w?.innerWidth ?? 0 });
  if (w) cached = l;
  return l;
}

export const isPhone = () => currentLayout() === 'phone';
