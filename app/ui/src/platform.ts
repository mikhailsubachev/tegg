// Slice AND-1 (docs/contracts/android-shell.md §9.1, D-2026): the platform the shell set in its init script.
// `macos` when it is absent (the desktop, the WebKit tests that don't set it).
export type Platform = 'android' | 'macos';

export function platform(): Platform {
  const w = (globalThis as { window?: { __TEGG_PLATFORM__?: string } }).window;
  return w?.__TEGG_PLATFORM__ === 'android' ? 'android' : 'macos';
}

export const isAndroid = () => platform() === 'android';
