// Slice AND-2 (docs/contracts/android-phone.md §6.2, §12.2; CP-2 → D-2430): the page side of the native bridge
// `window.__TEGG_NATIVE__` the init script sets on Android, and the test hooks that drive it.
import { ipc } from '../ipc/client';
import type { InsetsDto } from '../ipc/types';

export type NativeState = { insets: InsetsDto; keyboard: boolean; systemDark: boolean | null; fontScale: number };

type Bridge = { state: NativeState; receive(kind: string, p: Partial<NativeState>): void; back(): boolean };

const DEFAULTS: NativeState = { insets: { top: 0, bottom: 0, left: 0, right: 0 }, keyboard: false, systemDark: null, fontScale: 1 };

function win(): (Window & { __TEGG_NATIVE__?: Bridge }) | undefined {
  return typeof window === 'undefined' ? undefined : (window as Window & { __TEGG_NATIVE__?: Bridge });
}

/** The bridge, created when the init script didn't (the L5p tests' pages). */
function bridge(): Bridge | undefined {
  const w = win();
  if (!w) return undefined;
  if (!w.__TEGG_NATIVE__) {
    w.__TEGG_NATIVE__ = {
      state: { ...DEFAULTS, insets: { ...DEFAULTS.insets } },
      receive(kind, p) {
        if (kind === 'window' && p) {
          Object.assign(this.state, p);
          window.dispatchEvent(new CustomEvent('tegg:native', { detail: this.state }));
        }
      },
      back: () => false,
    };
  }
  return w.__TEGG_NATIVE__;
}

export function nativeState(): NativeState {
  return bridge()?.state ?? DEFAULTS;
}

export function onNative(f: (s: NativeState) => void): () => void {
  const w = win();
  if (!w) return () => undefined;
  const h = () => f(nativeState());
  w.addEventListener('tegg:native', h);
  return () => w.removeEventListener('tegg:native', h);
}

export function setBackHandler(f: () => boolean): void {
  const b = bridge();
  if (b) b.back = f;
}

/** `android_window(dark)`: the bar icons for the resolved theme; the answer is merged into the state. */
export async function syncWindow(dark: boolean): Promise<void> {
  try {
    const s = await ipc.androidWindow(dark);
    const b = bridge();
    if (!b || !s) return;
    // A pushed state (insets from a test hook or the plugin) wins over zero insets in the answer.
    const zero = !s.insets || (s.insets.top === 0 && s.insets.bottom === 0 && s.insets.left === 0 && s.insets.right === 0);
    // A pushed night mode wins too: the answer to the theme's own sync must not undo the push that caused it.
    b.receive('window', { ...(zero ? {} : { insets: s.insets }), keyboard: s.keyboard, ...(b.state.systemDark === null ? { systemDark: s.systemDark } : {}), fontScale: s.fontScale });
  } catch {
    /* errors ignored (§6.2) */
  }
}

type TestHooks = Record<string, unknown>;

/** §12.2: the phone's test hooks, added to `window.__TEGG_TEST__` (in-memory only). */
export function installTestHooks(run: (id: string) => Promise<void>): void {
  const w = win() as (Window & { __TEGG_TEST__?: TestHooks }) | undefined;
  if (!w) return;
  const b = bridge();
  const t: TestHooks = (w.__TEGG_TEST__ ??= {});
  t.insets = (i: InsetsDto) => b?.receive('window', { insets: { ...i } });
  t.keyboard = (shown: boolean) => b?.receive('window', { keyboard: shown });
  t.systemBack = () => (b?.back() ? 'handled' : 'background');
  t.systemDark = (dark: boolean | null) => b?.receive('window', { systemDark: dark });
  t.run = run;
  // Slice AND-3 (android-edit §15.1): the page's visibility as the system changes it, with the same listeners.
  t.visibility = (state: 'hidden' | 'visible') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    if (state === 'hidden') window.dispatchEvent(new Event('pagehide'));
  };
}
