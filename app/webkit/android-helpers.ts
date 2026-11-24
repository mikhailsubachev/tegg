// Slice AND-1, L5 helpers (WebKit + the fake core): the Android start flow of docs/contracts/android-shell.md §5, §9 on
// top of ../ui/test/fake-core.ts. No AC outcome is asserted here except through `must` (a missing element is an
// AssertionError, TS-I1).
//
// The test sets `window.__TEGG_PLATFORM__` (`android` or `macos`, AP-2026 → D-2026) before the app's scripts run. On
// Android the fake core also answers RA2's four Android-only commands:
// - `vault_start` → the current `StartStateDto` (§5.1), scripted per test (`hold`: the answer is computed when the
//   command is called but delivered later, the race of F2), and `vault:start` events through `setStart`;
// - `vault_find` → `FoundVaultDto[]` (`{ name, path, rel }`), optionally held;
// - `storage_access` → `{ granted, sharedRoot }`; `storage_access_settings` → `null` (recorded).
// `vault_current` answers `null` until the start state is `open` (the Android shell has no vault before that; the page
// must not ask it at all on Android). A `MutationObserver` installed before the app records whether the chooser
// (`main[aria-label="Choose a vault"]`) or the permission screen ever entered the DOM.
//
// Slice AND-2 (docs/contracts/android-phone.md CP-6 → D-2434): `'android'` gets the phone layout (D-2416), so these
// AND-1 tests of the client and the start flow force the desktop layout with `window.__TEGG_LAYOUT__ = 'desktop'`
// (§4.1, §12.2), the default of `layout`. The phone harness (./phone-helpers.ts, §14.1) passes `layout: null` (unset)
// and adds its own fake-core handlers through `beforeGoto`.
import type { Page } from '@playwright/test';
import { installFakeCore, shellVault, type FakeCoreHandle, type FakeOptions, type FakeVault } from '../ui/test/fake-core';

export const SHARED = '/storage/emulated/0';
export const SHELL_PATH = `${SHARED}/Documents/tegg-la-x/shell`;
export const EVA = 'Tasks/Zavolat Evě.md';
export const UVODNI = 'Pages/Úvodní stránka.md';

export type StartDto =
  | { state: 'needsAccess'; path?: string }
  | { state: 'opening'; name: string; path: string }
  | { state: 'open'; vault?: unknown }
  | { state: 'failed'; path: string; kind: string }
  | { state: 'none' };
export type FoundVaultDto = { name: string; path: string; rel: string };

export type AndroidOptions = FakeOptions & {
  platform?: 'android' | 'macos';
  vault?: FakeVault | null;
  /** The state `vault_start` answers first (default `open` when a vault is given, else `none`). */
  start?: StartDto;
  /** Delivers `vault_start`'s first answer after this many ms (computed when called). */
  holdStartMs?: number;
  found?: FoundVaultDto[];
  findHoldMs?: number;
  granted?: boolean;
  /** `window.__TEGG_LAYOUT__` before the app's scripts (CP-6): `desktop` by default; `null` leaves it unset. */
  layout?: 'desktop' | 'phone' | null;
  /** Runs after the fake core's init scripts and before `page.goto('/')` (more init scripts, e.g. the phone harness). */
  beforeGoto?: () => Promise<void>;
};

/** The shell fixture named `shell` at `SHELL_PATH`, landing on Eva (FR-UX-02 AC-16 (a)). */
export function shellAtPhone(): { vault: FakeVault; opts: FakeOptions } {
  const vault = { ...shellVault(), name: 'shell' };
  const id = /^id:\s*(\S+)/m.exec(vault.files[EVA] ?? '')?.[1] ?? null;
  return { vault, opts: { vaultPath: SHELL_PATH, last: { path: EVA, id }, recent: [{ name: 'shell', path: SHELL_PATH, exists: true }] } };
}

export type AndroidHandle = FakeCoreHandle & {
  /** Sets the start state and emits `vault:start` with it (an `open` without `vault` carries the fake's vault). */
  setStart(dto: StartDto): Promise<void>;
  /** Whether the chooser / the permission screen was ever in the DOM since the page loaded. */
  seenChooser(): Promise<boolean>;
  seenAccessScreen(): Promise<boolean>;
  /** Dispatches `visibilitychange` with `document.visibilityState` set to `state`; returns the page's `Date.now()`. */
  visibility(state: 'hidden' | 'visible'): Promise<number>;
};

export async function startAndroid(page: Page, o: AndroidOptions = {}): Promise<AndroidHandle> {
  const vault = o.vault === undefined ? null : o.vault;
  const core = await installFakeCore(page, vault, o);
  const start: StartDto = o.start ?? (vault ? { state: 'open' } : { state: 'none' });
  await page.addInitScript((cfg) => {
    const w = window as any;
    w.__TEGG_PLATFORM__ = cfg.platform;
    if (cfg.layout) w.__TEGG_LAYOUT__ = cfg.layout;
    w.__teggSeen = { chooser: false, access: false };
    const check = () => {
      if (document.querySelector('main[aria-label="Choose a vault"]')) w.__teggSeen.chooser = true;
      if (document.querySelector('main[aria-label="Allow access to your notes"]')) w.__teggSeen.access = true;
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] });
    const x = w.__teggFake;
    if (!x || cfg.platform !== 'android') return;
    const h = x.handlers as Record<string, (a: any) => unknown>;
    for (const c of ['vault_start', 'vault_find', 'storage_access', 'storage_access_settings']) x.reads.add(c);
    const current = h.vault_current;
    const fill = (d: any) => (d.state === 'open' && !d.vault ? { state: 'open', vault: current({}) } : d);
    const a = (w.__teggAndroid = { state: null as any, settings: 0, firstHeld: false });
    a.state = fill(cfg.start);
    w.__teggAndroidSet = (d: any) => { a.state = fill(d); return x.emit('vault:start', a.state); };
    h.vault_current = (args: any) => (a.state?.state === 'open' ? current(args) : null);
    h.vault_start = () => {
      const now = JSON.parse(JSON.stringify(a.state));
      if (cfg.holdStartMs && !a.firstHeld) {
        a.firstHeld = true;
        return new Promise((r) => setTimeout(() => r(now), cfg.holdStartMs));
      }
      return now;
    };
    h.vault_find = () => {
      if (!cfg.granted) throw { kind: 'NoAccess', message: '' };
      const out = JSON.parse(JSON.stringify(cfg.found));
      return cfg.findHoldMs ? new Promise((r) => setTimeout(() => r(out), cfg.findHoldMs)) : out;
    };
    h.storage_access = () => ({ granted: !!cfg.granted, sharedRoot: '/storage/emulated/0' });
    h.storage_access_settings = () => { a.settings++; return null; };
  }, { platform: o.platform ?? 'android', start, holdStartMs: o.holdStartMs ?? 0, found: o.found ?? [], findHoldMs: o.findHoldMs ?? 0, granted: o.granted ?? true, layout: o.layout === undefined ? 'desktop' : o.layout });
  if (o.beforeGoto) await o.beforeGoto();
  await page.goto('/');
  return Object.assign(core, {
    setStart: (dto: StartDto) => page.evaluate((d) => (window as any).__teggAndroidSet(d), dto),
    seenChooser: () => page.evaluate(() => !!(window as any).__teggSeen?.chooser),
    seenAccessScreen: () => page.evaluate(() => !!(window as any).__teggSeen?.access),
    visibility: (state: 'hidden' | 'visible') => page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
      Object.defineProperty(document, 'hidden', { value: s === 'hidden', configurable: true });
      const t = Date.now();
      document.dispatchEvent(new Event('visibilitychange'));
      return t;
    }, state),
  });
}

export const chooser = (page: Page) => page.getByRole('main', { name: 'Choose a vault' });
export const accessScreen = (page: Page) => page.getByRole('main', { name: 'Allow access to your notes' });

/** The RA5 strings (English catalog). */
export const S = {
  accessTitle: 'Allow access to your notes',
  accessBody: 'Tegg keeps your notes as files in a folder on this phone. Android shows that folder to Tegg only when “All files access” is on. Tegg opens only the vault folder you choose.',
  openSettings: 'Open settings',
  stillOff: 'Access is still off. Turn on “Allow access to manage all files” for Tegg.',
  recent: 'Recent vaults',
  found: 'Vaults on this phone',
  searching: 'Looking for vaults…',
  noneFound: 'No vaults found in this phone\'s storage.',
  path: 'Folder path',
  openPath: 'Open',
  fullPath: 'Enter the full path of the folder, starting with /storage/emulated/0/.',
  outsideShared: 'Tegg can open vaults in this phone\'s shared storage only, for example in Documents.',
  notAVault: 'This folder isn\'t a Tegg vault.',
  notAVaultHint: 'Open a folder that holds .tegg/vault.yml, or create a new vault.',
  unsupported: 'This isn’t available yet.',
};
