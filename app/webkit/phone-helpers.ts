// Slice AND-2, the L5p harness (docs/contracts/android-phone.md §14.1; layers in docs/test-strategy.md, D-2009, D-2428):
// the phone layout with the fake core over mocked IPC, `__TEGG_PLATFORM__ = 'android'` and `__TEGG_LAYOUT__` unset, in
// the Playwright projects `phone-webkit` and `phone-chromium` (412 × 915, device scale factor 2.625, touch, mobile).
//
// `startPhone` is AND-1's `startAndroid` plus, on Android, the fake core's answers to `android_window` (`{ insets: <last
// injected>, keyboard: false, systemDark: <prefers-color-scheme>, fontScale: 1 }`) and `android_open_url` (records the
// URL when the §4.4 table accepts it, else rejects `{ kind: 'Unsupported' }`), then the safe-area insets
// `__TEGG_TEST__.insets({ top: 36, bottom: 24, left: 0, right: 0 })` unless `insets: null`.
//
// No AC outcome is asserted here except through `must` and the `need*` lookups, which turn a missing element or test
// hook into an AssertionError instead of a timeout or a TypeError (TS-I1). Written from the ACs and the contract (D-61).
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import { READ_COMMANDS as PHONE_READS, WRITE_COMMANDS } from '../ui/test/phone-writes';
import { startAndroid, type AndroidHandle, type AndroidOptions } from './android-helpers';
import { eventually, mainName, must, seen, sleep } from './helpers';

export { eventually, mainName, must, seen, sleep, WRITE_COMMANDS, PHONE_READS };

export const REPO = resolve(import.meta.dirname, '../..');
const FX = resolve(REPO, 'tests/fixtures/vaults');

export type Insets = { top: number; bottom: number; left: number; right: number };
export type Size = { width: number; height: number };
/** RA8 / L5p: the boards' frame, a small phone, landscape (FR-UX-04). */
export const FRAME: Size = { width: 412, height: 915 };
export const SMALL: Size = { width: 360, height: 800 };
export const LANDSCAPE: Size = { width: 915, height: 412 };
export const KEYBOARD: Size = { width: 412, height: 520 };
/** The board's status bar (36 px) and a navigation bar of 24 px (test-strategy L5p). */
export const INSETS: Insets = { top: 36, bottom: 24, left: 0, right: 0 };

export const nfc = (s: string) => s.normalize('NFC');
export const flat = (s: string | null | undefined) => nfc((s ?? '').replace(/\s+/g, ' ').trim());
export const rx = (s: string) => new RegExp(`^⟦?${nfc(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}⟧?$`);

// ------------------------------------------------------------------------------------------------ fixtures

const BINARY = /\.(png|jpe?g|gif|webp|pdf)$/i;
const SKIP = new Set(['README.md', 'make-phone.mjs', 'make-media.mjs']);
/** Loads fixture folders in order (later ones overlay earlier ones); a folder whose name starts with `.` goes under that
 *  name. Binary files (images, PDFs) go to `bin` as base64. */
export function loadVault(name: string, dirs: string[], edit?: (files: Record<string, string>, bin: Record<string, string>) => void): FakeVault {
  const files: Record<string, string> = {};
  const bin: Record<string, string> = {};
  for (const dir of dirs) {
    const abs = resolve(FX, dir);
    const prefix = dir.split('/').pop()!.startsWith('.') ? `${dir.split('/').pop()}/` : '';
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        const rel = nfc(prefix + relative(abs, p));
        if (SKIP.has(rel)) continue;
        if (BINARY.test(rel)) bin[rel] = readFileSync(p).toString('base64');
        else files[rel] = readFileSync(p, 'utf8');
      }
    };
    walk(abs);
  }
  edit?.(files, bin);
  return { name, files, bin };
}
/** `views/` + `new-empty/.tegg/` + the AND-2 overlay `phone/` (android-phone.md "Fixtures"). */
export const phoneVault = (edit?: (files: Record<string, string>, bin: Record<string, string>) => void) =>
  loadVault('Knihovna', ['views', 'new-empty/.tegg', 'phone'], edit);
/** The views fixture's clock (the overlay's): Thursday 19 Nov 2026, 10:00 in Prague. */
export const NOW = '2026-11-19T10:00:00+01:00';
export const TODAY = '2026-11-19';
export const VAULT_PATH = '/storage/emulated/0/Documents/Knihovna';
export const PH = {
  mapa: 'Pages/Mapa výletu.md', siroky: 'Pages/Široký obsah.md', ven: 'Pages/Odkazy ven.md', dlouha: 'Pages/Dlouhá poznámka.md',
  vlak: 'Quick Notes/Nápad z vlaku.md', caj: 'Quick Notes/Koupit čaj.md', den: 'Daily/2026-10-21.md', cteniTag: 'Tags/čtení.md',
  img: 'Images/Široký.md', png: '_attachments/široký.png', pins: '.tegg/pinned.yml', cteni: 'Pages/Čtení 2026.md', book: '.tegg/types/book.yml',
} as const;
export const B = (title: string) => `Books/${nfc(title)}.md`;

/** RA9's routes on `views/` + `phone/` (one concrete instance of each pattern). */
export const RA9_ROUTES = [
  'inbox', 'today', 'daily/2026-10-21', 'type/book', 'type/task', 'queries', 'query/Rozečtené', 'tags', 'tag/čtení', 'search',
  `note/${PH.mapa}`, 'conflicts', 'settings', 'settings/appearance', 'settings/date-time', 'settings/vault', 'settings/storage',
];
/** RA9's "Not offered" routes (and CP-9's two). */
export const NOT_OFFERED = [
  'new/book', 'home', 'graph', `graph/${PH.mapa}`, 'trash', 'type-settings/book', 'help/shortcuts', 'settings/shortcuts', 'settings/menu-bar',
  'settings/trash-history', 'settings/previews', 'settings/backups', 'broken-links', 'duplicate-titles',
];

export const ui = (o: { theme?: UiStateDto['theme']; extra?: Record<string, unknown> } = {}): UiStateDto =>
  ({ version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, propertiesOpen: true, preview: { mode: 'hover', hoverDelay: 1000 }, ...(o.extra ?? {}) } as UiStateDto);

// ------------------------------------------------------------------------------------------------ start

export type PhoneOptions = AndroidOptions & {
  /** The safe-area insets injected after start (`null`: none). */
  insets?: Insets | null;
  viewport?: Size;
  /** ISO instant of the page clock (default NOW); `null`: the real clock. `install`: a controllable clock. */
  now?: string | null;
  install?: boolean;
  region?: string;
  /** `window.__TEGG_ROUTE__` (the start route). */
  route?: string;
  reducedMotion?: 'reduce' | 'no-preference';
  colorScheme?: 'light' | 'dark';
  /** What to wait for after start: the phone frame (default with a vault), the chooser, the permission screen, nothing. */
  wait?: 'frame' | 'chooser' | 'access' | 'none';
  /** The app's layout: unset (the phone on Android) unless a test compares with the desktop. */
  layout?: 'desktop' | 'phone' | null;
};
export type PhoneHandle = AndroidHandle & {
  /** URLs `android_open_url` accepted, in order. */
  openedUrls(): Promise<string[]>;
  /** The `dark` arguments of `android_window`, in order. */
  windowCalls(): Promise<boolean[]>;
};

/** In-page (serialized): the fake core's Android answers of §14.1. */
function phoneFake() {
  const w = window as any;
  const x = w.__teggFake;
  const p = (w.__teggPhone = { opened: [] as string[], window: [] as boolean[], insets: { top: 0, bottom: 0, left: 0, right: 0 } });
  if (!x) return;
  x.reads.add('android_window');
  x.reads.add('android_open_url');
  const allowed = (u: unknown) => {
    const s = String(u ?? '').trim();
    if (!s) return false;
    try { return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(s).protocol.toLowerCase()); } catch { return false; }
  };
  x.handlers.android_window = (a: any) => {
    p.window.push(!!a?.dark);
    return { insets: { ...p.insets }, keyboard: false, systemDark: matchMedia('(prefers-color-scheme: dark)').matches, fontScale: 1 };
  };
  x.handlers.android_open_url = (a: any) => {
    if (!allowed(a?.url)) throw { kind: 'Unsupported', message: '' };
    p.opened.push(String(a.url));
    return null;
  };
}

/** Whether `window.__TEGG_TEST__[name]` is a function (the AND-2 hooks of §12.2). */
export async function hasHook(page: Page, name: string, ms = 5000): Promise<boolean> {
  return eventually(() => page.evaluate((n) => typeof (window as any).__TEGG_TEST__?.[n] === 'function', name).catch(() => false), (v) => v, ms);
}
async function needHook(page: Page, name: string, ms = 5000) {
  assert.ok(await hasHook(page, name, ms), `the test hook window.__TEGG_TEST__.${name}() exists (contract §12.2)`);
}

export async function startPhone(page: Page, o: PhoneOptions = {}): Promise<PhoneHandle> {
  await page.setViewportSize(o.viewport ?? FRAME);
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'cs');
  if (o.route) await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, nfc(o.route));
  if (o.reducedMotion || o.colorScheme) await page.emulateMedia({ ...(o.reducedMotion ? { reducedMotion: o.reducedMotion } : {}), ...(o.colorScheme ? { colorScheme: o.colorScheme } : {}) });
  if (o.now !== null) {
    const t = new Date(o.now ?? NOW);
    if (o.install) await page.clock.install({ time: t }); else await page.clock.setFixedTime(t);
  }
  const vault = o.vault === undefined ? phoneVault() : o.vault;
  const core = await startAndroid(page, {
    vaultPath: VAULT_PATH, uiState: ui(), previewStored: 'asGiven', ...o, vault, platform: 'android',
    layout: o.layout === undefined ? null : o.layout,
    beforeGoto: async () => { await page.addInitScript(phoneFake); await o.beforeGoto?.(); },
  });
  const insets = o.insets === undefined ? INSETS : o.insets;
  if (insets && o.layout !== 'desktop') await injectInsets(page, insets);
  const wait = o.wait ?? (vault ? 'frame' : 'none');
  if (wait === 'frame') await must(bottomBar(page), 'the phone frame (navigation "Main", RA8)', 10_000);
  if (wait === 'chooser') await must(page.getByRole('main', { name: 'Choose a vault' }), 'the chooser', 10_000);
  if (wait === 'access') await must(page.getByRole('main', { name: 'Allow access to your notes' }), 'the permission screen', 10_000);
  return Object.assign(core, {
    openedUrls: () => page.evaluate(() => [...((window as any).__teggPhone?.opened ?? [])] as string[]),
    windowCalls: () => page.evaluate(() => [...((window as any).__teggPhone?.window ?? [])] as boolean[]),
  });
}

/** `__TEGG_TEST__.insets(i)` (§12.2); also what the fake's `android_window` answers from now on. */
export async function injectInsets(page: Page, i: Insets) {
  await needHook(page, 'insets');
  await page.evaluate((v) => { const w = window as any; if (w.__teggPhone) w.__teggPhone.insets = v; w.__TEGG_TEST__.insets(v); }, i);
}

/** A new page in a context with the project's options (the phone in the L5p projects). */
export async function phonePage(browser: Browser): Promise<Page> {
  return browser.newPage();
}
/** A desktop page (macOS layout) for comparisons in the same test: 1,440 × 900, no touch. */
export async function desktopPage(browser: Browser): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  return { page: await context.newPage(), context };
}
/** The same vault on the desktop layout (`__TEGG_PLATFORM__ = 'macos'`), waiting for the sidebar. */
export async function startDesktop(page: Page, o: PhoneOptions = {}): Promise<AndroidHandle> {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'cs');
  if (o.route) await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, nfc(o.route));
  if (o.now !== null) await page.clock.setFixedTime(new Date(o.now ?? NOW));
  const vault = o.vault === undefined ? phoneVault() : o.vault;
  const core = await startAndroid(page, { vaultPath: VAULT_PATH, uiState: ui(), previewStored: 'asGiven', ...o, vault, platform: 'macos', layout: 'desktop' });
  await must(page.getByRole('navigation', { name: 'Sidebar' }), 'the desktop frame (navigation "Sidebar")', 10_000);
  return core;
}

// ------------------------------------------------------------------------------------------------ the frame (RA8, §8)

export const appBar = (page: Page) => page.getByRole('banner');
export const bottomBar = (page: Page) => page.getByRole('navigation', { name: rx('Main') });
export const barButton = (page: Page, name: 'Menu' | 'Search' | 'New' | 'Today') => bottomBar(page).getByRole('button', { name: rx(name) });
export const drawer = (page: Page) => page.getByRole('dialog', { name: rx('Navigation') });
export const sheet = (page: Page, name: string) => page.getByRole('dialog', { name: rx(name) });
export const backButton = (page: Page) => appBar(page).getByRole('button', { name: rx('Back') });
export const moreButton = (page: Page) => appBar(page).getByRole('button', { name: rx('More actions') });
export const moreMenu = (page: Page) => page.getByRole('menu', { name: rx('More actions') });
export const main = (page: Page) => page.getByRole('main');
export const notice = (page: Page) => page.locator('div.phone-notice[role="status"]');
export const pageHeading = (page: Page) => page.getByRole('heading', { level: 1 });

/** Opens the drawer with `Menu` (RA10) and returns it. */
export async function openDrawer(page: Page): Promise<Locator> {
  await (await must(barButton(page, 'Menu'), 'the bottom bar\'s Menu button')).click();
  return must(drawer(page), 'the drawer (dialog "Navigation")');
}
/** Taps a drawer entry by its visible name (opening the drawer first). */
export async function drawerEntry(page: Page, name: string | RegExp, ms = 3000): Promise<void> {
  const d = (await seen(drawer(page), 200)) ? drawer(page) : await openDrawer(page);
  const e = d.getByRole('link', { name: typeof name === 'string' ? new RegExp(`^⟦?${nfc(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}⟧?(\\s*\\d+)?$`) : name })
    .or(d.getByRole('button', { name: typeof name === 'string' ? new RegExp(`^⟦?${nfc(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}⟧?(\\s*\\d+)?$`) : name }));
  await (await must(e, `drawer entry "${name}"`, ms)).click();
}
/** `__TEGG_TEST__.systemBack()` (§12.2): `'handled'` or `'background'`. */
export async function systemBack(page: Page): Promise<string> {
  await needHook(page, 'systemBack', 2000);
  return page.evaluate(() => String((window as any).__TEGG_TEST__.systemBack()));
}
/** The on-screen keyboard (§12.2): `keyboard(true)` resizes the viewport to 412 × 520 and sets the hook's state;
 *  `keyboard(false)` restores `back` (default 412 × 915). */
export async function keyboard(page: Page, shown: boolean, back: Size = FRAME) {
  await needHook(page, 'keyboard', 2000);
  if (shown) await page.setViewportSize(KEYBOARD);
  await page.evaluate((s) => (window as any).__TEGG_TEST__.keyboard(s), shown);
  if (!shown) await page.setViewportSize(back);
}
/** `__TEGG_TEST__.systemDark(d)` (§12.2). */
export async function systemDark(page: Page, dark: boolean | null) {
  await needHook(page, 'systemDark', 2000);
  await page.evaluate((d) => (window as any).__TEGG_TEST__.systemDark(d), dark);
}

export type Rect = { x: number; y: number; width: number; height: number; top: number; bottom: number; left: number; right: number };
export async function rect(loc: Locator): Promise<Rect | null> {
  if (!(await seen(loc, 1000))) return null;
  return loc.first().evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
}

/** The hit area of a control (FR-UX-04 AC-5): its box, or the 48 × 48 box around its centre when
 *  `document.elementFromPoint` at that box's four corners returns the control (or a node inside it). */
export async function hitArea(loc: Locator): Promise<{ width: number; height: number }> {
  return loc.first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    if (r.width >= 48 && r.height >= 48) return { width: r.width, height: r.height };
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const w = Math.max(48, r.width);
    const h = Math.max(48, r.height);
    const corners = [[cx - w / 2 + 0.5, cy - h / 2 + 0.5], [cx + w / 2 - 0.5, cy - h / 2 + 0.5], [cx - w / 2 + 0.5, cy + h / 2 - 0.5], [cx + w / 2 - 0.5, cy + h / 2 - 0.5]];
    const hits = corners.every(([x, y]) => { const t = document.elementFromPoint(x, y); return !!t && (t === e || e.contains(t) || t.contains(e) && t.closest('button, a, [role]') === e); });
    return hits ? { width: w, height: h } : { width: r.width, height: r.height };
  });
}

// ------------------------------------------------------------------------------------------------ touch

/** A one-finger drag by (dx, dy) starting at `from` (viewport CSS px): CDP touch events on Chromium (real scrolling);
 *  synthetic pointer and touch events on WebKit (no native scrolling there, so scroll amounts are checked on Chromium). */
/** D-2452: a drag of `want` px scrolls by want − 16 … want + 4 px (the engine's touch slop), 0 within ± 4 px. */
export function byTheDrag(moved: number, want: number): boolean {
  if (want === 0) return Math.abs(moved) <= 4;
  const m = Math.sign(want) * moved;
  return m >= Math.abs(want) - 16 && m <= Math.abs(want) + 4;
}
export async function touchDrag(page: Page, from: { x: number; y: number }, dx: number, dy: number, o: { steps?: number; holdMs?: number } = {}) {
  const steps = o.steps ?? 10;
  if (page.context().browser()?.browserType().name() === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const pt = (x: number, y: number) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x, from.y) });
    if (o.holdMs) await sleep(o.holdMs);
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(from.x + (dx * i) / steps, from.y + (dy * i) / steps) });
      await sleep(16);
    }
    // D-2452: the finger rests before lifting, so the engine doesn't fling.
    await sleep(150);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.evaluate(async ([f, ddx, ddy, n, hold]) => {
      const target = document.elementFromPoint(f.x, f.y) ?? document.body;
      const fire = (type: string, x: number, y: number) => {
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
        const T = (window as any).Touch;
        const TE = (window as any).TouchEvent;
        if (T && TE) {
          try {
            const t = new T({ identifier: 7, target, clientX: x, clientY: y });
            const map: Record<string, string> = { pointerdown: 'touchstart', pointermove: 'touchmove', pointerup: 'touchend' };
            target.dispatchEvent(new TE(map[type], { bubbles: true, cancelable: true, composed: true, touches: type === 'pointerup' ? [] : [t], targetTouches: type === 'pointerup' ? [] : [t], changedTouches: [t] }));
          } catch { /* Touch constructors missing on this engine */ }
        }
      };
      fire('pointerdown', f.x, f.y);
      if (hold) await new Promise((r) => setTimeout(r, hold));
      for (let i = 1; i <= n; i++) { fire('pointermove', f.x + (ddx * i) / n, f.y + (ddy * i) / n); await new Promise((r) => setTimeout(r, 16)); }
      fire('pointerup', f.x + ddx, f.y + ddy);
    }, [from, dx, dy, steps, o.holdMs ?? 0] as const);
  }
}
/** A long press of `ms` at `at` (no movement), plus the `contextmenu` the engine would send. Returns whether the
 *  page prevented the `contextmenu` (a long press does nothing, §8.5). */
export async function longPress(page: Page, at: { x: number; y: number }, ms = 800): Promise<boolean> {
  await touchDrag(page, at, 0, 0, { steps: 1, holdMs: ms });
  return page.evaluate((p) => {
    const t = document.elementFromPoint(p.x, p.y) ?? document.body;
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y });
    t.dispatchEvent(e);
    return e.defaultPrevented;
  }, at);
}
/** Two-finger pinch around `centre` from `from` to `to` px apart (horizontal), CDP touch (Chromium only). */
export async function pinch(page: Page, centre: { x: number; y: number }, from: number, to: number, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  const pts = (d: number) => [{ x: centre.x - d / 2, y: centre.y, id: 1 }, { x: centre.x + d / 2, y: centre.y, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / steps) });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
/** A tap through the touchscreen at the centre of `loc`. */
export async function tap(page: Page, loc: Locator, what: string) {
  const r = await rect(await must(loc, what));
  assert.ok(r, `${what}: has a box`);
  await page.touchscreen.tap(r!.x + r!.width / 2, r!.y + r!.height / 2);
}
export const isChromium = (page: Page) => page.context().browser()?.browserType().name() === 'chromium';

// ------------------------------------------------------------------------------------------------ writes (§2.3)

/** The `WRITE_COMMANDS` calls the fake core saw, in order (with whether they succeeded). */
export async function writesSeen(core: AndroidHandle): Promise<string[]> {
  return (await core.calls()).filter((c) => WRITE_COMMANDS.includes(c.cmd)).map((c) => c.cmd);
}
export type FileState = { files: Record<string, string>; bin: Record<string, string> };
/** The fake core's vault files (text and binary) now. */
export async function fileStateOf(core: AndroidHandle): Promise<FileState> {
  const bin = Object.fromEntries(Object.entries(await core.binary()).map(([k, v]) => [k, Buffer.from(v).toString('base64')]));
  return { files: await core.files(), bin };
}
/** Asserts "zero writes" (§2.3): no `WRITE_COMMANDS` call, no written path, the files as `before`. */
export async function assertZeroWrites(core: AndroidHandle, before: FileState, what: string) {
  assert.deepEqual(await writesSeen(core), [], `${what}: no write command (WRITE_COMMANDS, contract §2.3)`);
  assert.deepEqual(await core.writesTo(), [], `${what}: nothing written`);
  const now = await fileStateOf(core);
  const changed = [...new Set([...Object.keys(before.files), ...Object.keys(now.files)])].filter((k) => before.files[k] !== now.files[k])
    .concat([...new Set([...Object.keys(before.bin), ...Object.keys(now.bin)])].filter((k) => before.bin[k] !== now.bin[k]));
  assert.deepEqual(changed, [], `${what}: every vault file is unchanged`);
}

// ------------------------------------------------------------------------------------------------ probes

/** Elements that scroll vertically (overflow-y auto/scroll with more content than room), as short descriptions. */
export async function verticalScrollers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const se = document.scrollingElement as HTMLElement;
    if (se.scrollHeight > se.clientHeight + 1) out.push('document');
    for (const e of document.querySelectorAll('body *') as NodeListOf<HTMLElement>) {
      const s = getComputedStyle(e);
      if (!/(auto|scroll)/.test(s.overflowY) || e.scrollHeight <= e.clientHeight + 1) continue;
      if (e.closest('[role="dialog"]')) continue;
      out.push(`${e.tagName.toLowerCase()}${e.getAttribute('aria-label') ? `[aria-label="${e.getAttribute('aria-label')}"]` : ''}${e.className && typeof e.className === 'string' ? `.${e.className.split(/\s+/).join('.')}` : ''}`);
    }
    return out;
  });
}
export type Control = { role: string; name: string; command: string | null; width: number; height: number; hitW: number; hitH: number; x: number; y: number; exempt: boolean; row: boolean; text: boolean; inert: boolean; html: string };
/** Every visible control (button, link, tab, menuitem, menuitemradio, checkbox, radio, switch, option) in `scope`
 *  (default the document), outside inert subtrees. `exempt`: a link or chip in a note's running text, or a map node
 *  (FR-UX-04 AC-5); `row`: a row of an object list (FR-UX-03 AC-8's exception); `text`: a text input. */
export async function controls(page: Page, scope?: Locator): Promise<Control[]> {
  const fn = (root: Element) => {
    const ROLES: Record<string, string> = { BUTTON: 'button', A: 'link', SUMMARY: 'button', SELECT: 'combobox', TEXTAREA: 'textbox' };
    const roleOf = (e: Element): string => {
      const r = e.getAttribute('role');
      if (r) return r;
      if (e.tagName === 'INPUT') {
        const t = (e as HTMLInputElement).type;
        return t === 'checkbox' ? 'checkbox' : t === 'radio' ? 'radio' : ['button', 'submit', 'reset'].includes(t) ? 'button' : 'textbox';
      }
      if (e.tagName === 'A' && !e.hasAttribute('href')) return '';
      return ROLES[e.tagName] ?? '';
    };
    const WANT = new Set(['button', 'link', 'tab', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'checkbox', 'radio', 'switch', 'option', 'textbox', 'searchbox', 'combobox']);
    const out: any[] = [];
    for (const e of root.querySelectorAll('a, button, input, select, textarea, summary, [role]') as NodeListOf<HTMLElement>) {
      const role = roleOf(e);
      if (!WANT.has(role)) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(e).visibility === 'hidden') continue;
      const name = (e.getAttribute('aria-label') ?? e.innerText ?? (e as HTMLInputElement).value ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
      const inText = !!e.closest('article p, article li, article td, article th, article blockquote, article h1, article h2, article h3, article h4, article h5, article h6, [data-note-body] p, [data-note-body] li, .read-view p, .read-view li, .read-view td');
      const mapNode = role === 'treeitem' || !!e.closest('[role="tree"]');
      const row = !!e.closest('[data-query-result], [data-path], [data-board-card], [data-query-row], [data-pin-row], li, tr') && (role === 'link' || role === 'button' && !e.hasAttribute('data-command'));
      // the hit area (FR-UX-04 AC-5): the box, or the 48 × 48 box around its centre when elementFromPoint at its corners
      // returns the control
      let hitW = r.width;
      let hitH = r.height;
      if (r.width < 48 || r.height < 48) {
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const w = Math.max(48, r.width);
        const h = Math.max(48, r.height);
        const pts = [[cx - w / 2 + 0.5, cy - h / 2 + 0.5], [cx + w / 2 - 0.5, cy - h / 2 + 0.5], [cx - w / 2 + 0.5, cy + h / 2 - 0.5], [cx + w / 2 - 0.5, cy + h / 2 - 0.5]];
        if (pts.every(([x, y]) => { const t = document.elementFromPoint(x, y); return !!t && (t === e || e.contains(t)); })) { hitW = w; hitH = h; }
      }
      out.push({
        hitW, hitH, html: e.outerHTML.slice(0, 120),
        role, name, command: e.getAttribute('data-command') ?? (e.closest('[data-command]') as HTMLElement | null)?.getAttribute('data-command') ?? null,
        width: r.width, height: r.height, x: r.left + r.width / 2, y: r.top + r.height / 2, exempt: inText || mapNode, row,
        text: ['textbox', 'searchbox', 'combobox'].includes(role), inert: !!e.closest('[inert]'),
      });
    }
    return out;
  };
  return (scope ?? page.locator('body')).first().evaluate(fn);
}

/** `document.scrollingElement.scrollWidth` and `innerWidth` (FR-UX-04 AC-6), and elements wider than the viewport
 *  that don't scroll inside their own box. */
export async function sidewaysOverflow(page: Page): Promise<{ scrollWidth: number; innerWidth: number; offenders: string[] }> {
  return page.evaluate(() => {
    const se = document.scrollingElement as HTMLElement;
    const offenders: string[] = [];
    for (const e of document.querySelectorAll('main *') as NodeListOf<HTMLElement>) {
      if (e.scrollWidth <= e.clientWidth + 1) continue;
      const s = getComputedStyle(e);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) continue;
      // D-2457: inside an ancestor that scrolls sideways (the map area) it scrolls in that box.
      let boxed = false;
      for (let a = e.parentElement; a && a.tagName !== 'MAIN'; a = a.parentElement) if (/(auto|scroll)/.test(getComputedStyle(a).overflowX) && a.getBoundingClientRect().right <= innerWidth + 1) { boxed = true; break; }
      if (boxed) continue;
      const r = e.getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.left < -1) offenders.push(`${e.tagName.toLowerCase()}.${String(e.className).split(/\s+/).join('.')}`);
    }
    return { scrollWidth: se.scrollWidth, innerWidth, offenders: offenders.slice(0, 10) };
  });
}

/** Text of the topmost block of `main`'s scroller (the first visible paragraph or heading). */
export async function firstVisibleBlock(page: Page): Promise<string> {
  return page.evaluate(() => {
    const m = [...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0) as HTMLElement | undefined;
    if (!m) return '';
    const top = Math.max(m.getBoundingClientRect().top, 0);
    for (const b of m.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li') as NodeListOf<HTMLElement>) {
      const r = b.getBoundingClientRect();
      if (r.bottom > top + 2) return (b.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    }
    return '';
  });
}
/** Scrolls `main` so that the block whose text starts with `text` is at its top. */
export async function scrollBlockToTop(page: Page, text: string) {
  await page.evaluate((t) => {
    const m = [...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0) as HTMLElement;
    const b = [...m.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li')].find((e) => ((e as HTMLElement).innerText ?? '').trim().startsWith(t)) as HTMLElement | undefined;
    if (!b) return;
    m.scrollTop += b.getBoundingClientRect().top - m.getBoundingClientRect().top;
  }, text);
}
/** The scroll position of the visible `main`. */
export const mainScroll = (page: Page) => page.evaluate(() => ([...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0) as HTMLElement | undefined)?.scrollTop ?? -1);

/** Visible text of the elements matched in `scope`, in order. */
export async function texts(loc: Locator): Promise<string[]> {
  return (await loc.allInnerTexts()).map(flat);
}

/** Every visible text node outside user content (`[data-user-content]`) in `scope` that isn't wrapped in `⟦ ⟧`
 *  (NFR-OTH-02 AC-26 with the pseudo-locale). */
export async function unwrappedTexts(scope: Locator): Promise<string[]> {
  return scope.first().evaluate((root) => {
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? '').trim();
      if (!t || /^[\s\p{P}\p{S}\d]*$/u.test(t)) continue;
      const el = n.parentElement;
      if (!el || el.closest('[data-user-content], code, pre, article, [role="tree"], time, [data-user-text]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const host = el.closest('*:not(span)') ?? el;
      const full = ((host as HTMLElement).innerText ?? '').trim();
      if (!/⟦[\s\S]*⟧/.test(full) && !/^⟦/.test(t)) out.push(t);
    }
    return [...new Set(out)].slice(0, 20);
  });
}
