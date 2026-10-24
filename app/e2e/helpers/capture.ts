// Shared helpers for the MS5 slice 5B real-app tests (L6, Appium mac2 on the built test app, D-382):
// app/e2e/ms5_capture.ac.test.ts, ms5_inbox.ac.test.ts, nfr_perf_10.ac.test.ts, perf_capture.ts and perf_inbox.ts.
// Interface: docs/contracts/ms3-shell.md §1, §6 (TEGG_TEST, TEGG_APP_SUPPORT, TEGG_VAULT, TEGG_ROUTE, TEGG_PERF_LOG,
// TEGG_EXIT_AFTER; `ui-ready`, `route-ready:<route>`), ms5-tasks.md D-504 (TEGG_NOW), ms5-capture.md §1 (windows
// `main`, `capture`, `capture-saved`; status item; hotkeys; single instance; launch at login), §8 (the `capture-ready`
// mark), §11.1 (TEGG_TEST_LAUNCHED_AT_LOGIN, TEGG_TEST_LOGIN_ITEM, TEGG_TEST_REVEAL, TEGG_TEST_FAIL_CAPTURE,
// helpers/holdhotkey.swift). Always TEGG_TEST=1 with a temporary Application Support and a temporary copy of the
// synthetic fixture tests/fixtures/vaults/inbox (+ new-empty/.tegg) (D-62). Test code; the only assertions here are
// the `need`/`ready` lookups, which turn a missing element or app into an AssertionError (TS-I1).
//
// Prerequisites as in ms3_shell.ac.test.ts: `npm run app:build`, `npm run e2e:setup`, Accessibility and Automation
// permission for the terminal, Xcode (swiftc) for the hotkey holder.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

export const REPO = resolve(import.meta.dirname, '../../..');
export const APP = resolve(import.meta.dirname, '../../src-tauri/target/release/bundle/macos/Tegg.app');
export const EXE = join(APP, 'Contents/MacOS/tegg');
export const BUNDLE_ID = 'app.tegg.desktop';
export const PORT = Number(process.env.APPIUM_PORT ?? 4726);
export const APPIUM_HOME = process.env.APPIUM_HOME ?? resolve(import.meta.dirname, '../.appium');
export const FX = join(REPO, 'tests/fixtures/vaults');
export const MARK_TIMEOUT = 20_000;
/** The test clock (capture.md, D-504): Wednesday 14 Oct 2026, 12:00 in Prague. */
export const NOW = '2026-10-14T12:00:00+02:00';
export const TZ = 'Europe/Prague';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const tmp = (name: string) => mkdtempSync(join(tmpdir(), `tegg-ms5-5b-${name}-`));
export const nfc = (s: string) => s.normalize('NFC');

// ------------------------------------------------------------------------------------------------ vaults and support

/** A temp copy of tests/fixtures/vaults/inbox (without its README.md) plus new-empty/.tegg. */
export function inboxCopy(base: string, name = 'Doručené'): string {
  const v = join(base, name);
  cpSync(join(FX, 'inbox'), v, { recursive: true, filter: (src) => relative(join(FX, 'inbox'), src) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
export const fx = (rel: string) => readFileSync(join(FX, 'inbox', rel), 'utf8');

/** A temporary Application Support folder with a UI state (theme light) and, optionally, shell settings / a draft. */
export function support(base: string, o: { ui?: Record<string, unknown>; shell?: { showStatusItem: boolean; openAtLogin: boolean }; name?: string } = {}): string {
  const s = join(base, o.name ?? 'support');
  mkdirSync(s, { recursive: true });
  writeFileSync(join(s, 'ui-state.json'), JSON.stringify({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, ...(o.ui ?? {}) }));
  if (o.shell) writeFileSync(join(s, 'shell-settings.json'), JSON.stringify(o.shell));
  return s;
}

export type Entry = { sha: string; mtimeMs: number; ino: number } | 'dir';
/** Every file under `root` (dot-folders included): bytes, mtime and inode; directories as 'dir'. NFC keys. */
export function tree(root: string): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const st = lstatSync(p);
      const rel = relative(root, p).normalize('NFC');
      if (st.isDirectory()) { out[`${rel}/`] = 'dir'; walk(p); }
      else out[rel] = { sha: createHash('sha256').update(readFileSync(p)).digest('hex'), mtimeMs: st.mtimeMs, ino: st.ino };
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}
export const changedPaths = (a: Record<string, Entry>, b: Record<string, Entry>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
export const read = (vault: string, rel: string) => (existsSync(join(vault, rel)) ? readFileSync(join(vault, rel), 'utf8') : null);

// ------------------------------------------------------------------------------------------------ marks

export type Mark = { mark: string; ms?: number; trigger?: string; kind?: string };
export function marksOf(file: string): Mark[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) as Mark; } catch { return { mark: '?' }; } });
}
export const marks = (file: string) => marksOf(file).map((m) => m.mark);
export async function waitMark(file: string, mark: string, ms = MARK_TIMEOUT, from = 0): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (marks(file).slice(from).includes(mark)) return true;
    await sleep(25);
  }
  return false;
}
/** The `capture-ready` marks (§8), in order. */
export const readyMarks = (file: string) => marksOf(file).filter((m) => m.mark === 'capture-ready');
export async function waitFile(path: string, ok: (t: string | null) => boolean, ms: number): Promise<string | null> {
  const endAt = Date.now() + ms;
  let t: string | null = null;
  while (Date.now() < endAt) {
    t = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (ok(t)) return t;
    await sleep(20);
  }
  return t;
}

// ------------------------------------------------------------------------------------------------ the app process

export type Env = Record<string, string>;
export function testEnv(appSupport: string, perfLog: string, extra: Env = {}): Env {
  return { TEGG_TEST: '1', TEGG_APP_SUPPORT: appSupport, TEGG_PERF_LOG: perfLog, TZ, TEGG_NOW: NOW, ...extra };
}
export function spawnApp(env: Env): ChildProcess {
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  return spawn(EXE, [], { env: { ...clean, ...env }, stdio: 'ignore' });
}
export function quitApp(child?: ChildProcess) {
  try { execFileSync('osascript', ['-e', `tell application id "${BUNDLE_ID}" to quit`], { stdio: 'ignore', timeout: 5000 }); } catch { /* not running */ }
  if (child && child.exitCode === null) child.kill('SIGTERM');
}
export async function waitExit(child: ChildProcess, ms = 10_000) {
  const end = Date.now() + ms;
  while (child.exitCode === null && child.signalCode === null && Date.now() < end) await sleep(50);
}
/** PIDs of processes running this app bundle's executable. */
export function appPids(): string[] {
  try { return execFileSync('pgrep', ['-f', EXE], { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; }
}

// ------------------------------------------------------------------------------------------------ keys, apps, pasteboard

export const KEY: Record<string, number> = {
  a: 0, d: 2, k: 40, n: 45, t: 17, v: 9, w: 13, q: 12, r: 15, space: 49, enter: 36, escape: 53, tab: 48, delete: 51, down: 125, up: 126, left: 123, right: 124, lbracket: 33, i: 34,
};
export const osa = (...lines: string[]) => execFileSync('osascript', lines.flatMap((l) => ['-e', l]), { encoding: 'utf8' });
export function press(key: keyof typeof KEY | string, mods: ('command' | 'shift' | 'control' | 'option')[] = []) {
  osa(`tell application "System Events" to key code ${KEY[key]}${mods.length ? ` using {${mods.map((m) => `${m} down`).join(', ')}}` : ''}`);
}
/** The global hotkeys, posted system-wide (S3): ⌃⌥Space Quick Capture, ⌃⌥T New Task. */
export const hotkey = (k: 'quick' | 'task') => press(k === 'quick' ? 'space' : 't', ['control', 'option']);
export function typeAscii(text: string) {
  osa(`tell application "System Events" to keystroke ${JSON.stringify(text)}`);
}
/** Non-ASCII text through the pasteboard (S3 finding P1). */
export function paste(text: string) {
  execFileSync('pbcopy', { input: text, env: { ...process.env, LANG: 'en_US.UTF-8' } });
  press('v', ['command']);
}
export function pasteboard(): string {
  return execFileSync('pbpaste', { encoding: 'utf8', env: { ...process.env, LANG: 'en_US.UTF-8' } });
}
export function setPasteboard(text: string) {
  execFileSync('pbcopy', { input: text, env: { ...process.env, LANG: 'en_US.UTF-8' } });
}
export function palette(command: string) {
  // ⌘K goes to the frontmost app: after a capture, focus is back in the app the capture came from (FR-CAP-01 AC-4).
  osa(`tell application id "${BUNDLE_ID}" to activate`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  press('k', ['command']);
  paste(command);
  press('enter');
}
export async function activateFinder() {
  osa('tell application "Finder" to activate');
  await sleep(400);
}
export function frontmost(): string {
  return osa('tell application "System Events" to get name of first application process whose frontmost is true').trim();
}

// ------------------------------------------------------------------------------------------------ the hotkey holder (§11.1)

/** Compiles app/e2e/helpers/holdhotkey.swift into `base` and starts it holding ⌃⌥Space (until killed). */
export function holdHotkey(base: string): ChildProcess | null {
  const src = resolve(import.meta.dirname, 'holdhotkey.swift');
  const bin = join(base, 'holdhotkey');
  try { execFileSync('swiftc', ['-O', src, '-o', bin], { stdio: 'ignore' }); } catch { return null; }
  const p = spawn(bin, [], { stdio: 'ignore' });
  return p;
}

// ------------------------------------------------------------------------------------------------ NFR-SEC-01 socket monitor

/** Internet sockets of the app's processes and the WebKit helpers started after it (S3 netmon, ported). */
export class NetMonitor {
  private before = new Set(pidsOf('com\\.apple\\.WebKit\\.(Networking|WebContent|GPU)'));
  private timer?: NodeJS.Timeout;
  readonly sockets = new Set<string>();
  readonly watched = new Set<string>();
  start(intervalMs = 200) { this.timer = setInterval(() => this.poll(), intervalMs); return this; }
  poll() {
    const ours = [...pidsOf(EXE.replace(/[.]/g, '\\.')), ...pidsOf('com\\.apple\\.WebKit\\.(Networking|WebContent|GPU)').filter((p) => !this.before.has(p))];
    ours.forEach((p) => this.watched.add(p));
    if (!ours.length) return;
    let out = '';
    try { out = execFileSync('lsof', ['-nP', '-a', '-i', '-p', ours.join(',')], { encoding: 'utf8' }); } catch { out = ''; }
    out.split('\n').slice(1).filter(Boolean).forEach((l) => this.sockets.add(l.replace(/\s+/g, ' ')));
  }
  stop() { clearInterval(this.timer); this.poll(); return { watched: [...this.watched], sockets: [...this.sockets] }; }
}
function pidsOf(pattern: string): string[] {
  try { return execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; }
}

// ------------------------------------------------------------------------------------------------ Appium

let appium: ChildProcess | undefined;
export async function appiumUp() {
  if (appium) return;
  appium = spawn('npx', ['appium', '--port', String(PORT), '--log-level', 'error'], { cwd: resolve(import.meta.dirname, '..'), env: { ...process.env, APPIUM_HOME }, stdio: 'ignore', detached: true });
  appium.unref();
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (await fetch(`http://127.0.0.1:${PORT}/status`).then((r) => r.ok, () => false)) return;
    await sleep(200);
  }
  assert.fail(`Appium did not start on port ${PORT} (run npm run e2e:setup)`);
}
export function appiumDown() {
  if (appium?.pid) {
    try { process.kill(-appium.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  appium = undefined;
}

export type Driver = Awaited<ReturnType<typeof import('webdriverio').remote>>;
export async function session(env: Env, o: { noReset?: boolean } = {}): Promise<Driver> {
  await appiumUp();
  const { remote } = await import('webdriverio');
  return remote({
    hostname: '127.0.0.1', port: PORT, logLevel: 'error',
    capabilities: {
      platformName: 'mac', 'appium:automationName': 'Mac2', 'appium:bundleId': BUNDLE_ID, 'appium:appPath': APP,
      'appium:environment': env, 'appium:newCommandTimeout': 300, ...(o.noReset ? { 'appium:noReset': true } : {}),
    } as any,
  });
}
export async function end(d: Driver | undefined) {
  await d?.execute('macos: terminateApp', { bundleId: BUNDLE_ID }).catch(() => {});
  await d?.deleteSession().catch(() => {});
}
export async function firstShown(d: Driver, label: string): Promise<any | null> {
  const l = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const q = `(label == "${l}" OR title == "${l}" OR value == "${l}")`;
  for (const sel of [`-ios predicate string:elementType IN {9, 10, 12, 17, 41, 42, 49, 80} AND ${q}`, `-ios predicate string:${q}`]) {
    for (const e of await d.$$(sel).catch(() => [] as any[])) {
      if (await e.isDisplayed().catch(() => false)) return e;
    }
  }
  return null;
}
export async function shown(d: Driver, label: string, ms = 3000): Promise<boolean> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    if (await firstShown(d, label)) return true;
    await sleep(100);
  }
  return false;
}
export async function need(d: Driver, label: string, ms = 3000): Promise<any> {
  const endAt = Date.now() + ms;
  let e = await firstShown(d, label);
  while (!e && Date.now() < endAt) { await sleep(100); e = await firstShown(d, label); }
  assert.ok(e, `"${label}" is shown`);
  return clickable(d, e);
}
/** D-751: XCUITest's click does nothing on an element macOS reports as not hittable (a link inside a clickable table
 *  row, for one), so `click()` falls back to a mouse click at the element's centre, as a user would click; its
 *  double-click doesn't reach web content at all (an image in a note), so `doubleClick()` is always one at the centre. */
export function clickable(d: Driver, e: any): any {
  return new Proxy(e, {
    get(target, prop) {
      if (prop === 'click' || prop === 'doubleClick') {
        return async () => {
          // Only web content (link 42, image 43, text 48): a status-menu item isn't hittable either, but its click works.
          const web = ['42', '43', '48'].includes(String(await target.getAttribute('elementType').catch(() => '')));
          if (prop === 'click' && (!web || String(await target.getAttribute('hittable').catch(() => 'true')) !== 'false')) return target.click();
          const r = await d.getElementRect(target.elementId);
          await d.execute(prop === 'click' ? 'macos: click' : 'macos: doubleClick', { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
/** An XCUITest predicate: some element's text contains `text`. */
export function textContains(text: string): string {
  const t = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `(label CONTAINS "${t}" OR value CONTAINS "${t}" OR title CONTAINS "${t}")`;
}
/** D-751: a menu item by name (XCUIElementTypeMenuItem): the open menu and a column header can carry the same name. */
export async function needMenuItem(d: Driver, label: string, ms = 3000): Promise<any> {
  const l = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const endAt = Date.now() + ms;
  while (true) {
    for (const e of await d.$$(`-ios predicate string:elementType == 54 AND (label == "${l}" OR title == "${l}")`).catch(() => [] as any[])) {
      if (await e.isDisplayed().catch(() => false)) return clickable(d, e);
    }
    if (Date.now() > endAt) break;
    await sleep(100);
  }
  assert.fail(`menu item "${label}" is shown`);
}
/** D-751: a button by name inside the group (`role="group"`) whose name is `group` (case-insensitive). */
export async function needInGroup(d: Driver, group: string, label: string, ms = 3000): Promise<any> {
  const g = group.replace(/"/g, '\\"');
  const l = label.replace(/"/g, '\\"');
  const endAt = Date.now() + ms;
  while (true) {
    for (const box of await d.$$(`-ios predicate string:label ==[c] "${g}"`).catch(() => [] as any[])) {
      for (const e of await box.$$(`-ios predicate string:label == "${l}" OR title == "${l}"`).catch(() => [] as any[])) {
        if (await e.isDisplayed().catch(() => false)) return clickable(d, e);
      }
    }
    if (Date.now() > endAt) break;
    await sleep(100);
  }
  assert.fail(`"${label}" in the group "${group}" is shown`);
}
/** A window of the app by title (`main` is `Tegg`, the capture window `Quick Capture`). */
export async function windowShown(d: Driver, title: string): Promise<boolean> {
  for (const w of await d.$$(`-ios predicate string:elementType == 4 AND title == "${title}"`).catch(() => [] as any[])) {
    if (await w.isDisplayed().catch(() => false)) return true;
  }
  return false;
}
export const captureOpen = (d: Driver) => windowShown(d, 'Quick Capture');
export const mainOpen = (d: Driver) => windowShown(d, 'Tegg');
export async function waitFor(fn: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    if (await fn()) return true;
    await sleep(25);
  }
  return fn();
}
/** The status item (menu bar extra) of the app. */
export async function statusItem(d: Driver): Promise<any | null> {
  for (const e of await d.$$('-ios class chain:**/XCUIElementTypeStatusItem').catch(() => [] as any[])) {
    if (await e.isExisting().catch(() => false)) return e;
  }
  return null;
}
/** Closes the main window with ⌘W (FR-CAP-03: it hides; the app keeps running). */
export async function closeMain(d: Driver) {
  press('w', ['command']);
  await waitFor(async () => !(await mainOpen(d)), 3000);
}
/** The text value of the capture field (WebKit exposes the textarea's value). */
export async function captureValue(d: Driver): Promise<string> {
  const f = await firstShown(d, 'Capture text');
  return f ? nfc(String((await f.getAttribute('value').catch(() => '')) ?? '')) : '<no field>';
}

// ------------------------------------------------------------------------------------------------ preflight

let pre: Promise<string | null> | undefined;
/** The built app exists and opens the `inbox` route (5B) with the test hooks. */
export function preflight(): Promise<string | null> {
  pre ??= (async () => {
    if (!existsSync(EXE)) return `app not built: ${EXE} (cd app && npm run app:build)`;
    const base = tmp('preflight');
    const log = join(base, 'perf.jsonl');
    const mark = 'route-ready:inbox';
    const child = spawnApp(testEnv(support(base), log, { TEGG_VAULT: inboxCopy(base), TEGG_ROUTE: 'inbox', TEGG_EXIT_AFTER: mark }));
    const ok = await waitMark(log, mark);
    quitApp(child);
    await waitExit(child);
    rmSync(base, { recursive: true, force: true });
    return ok ? null : 'the app does not open the route inbox (route-ready:inbox missing)';
  })();
  return pre;
}
export async function ready() {
  const why = await preflight();
  assert.equal(why, null, why ?? '');
}
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
/** The bytes with `id` masked after checking it is a ULID. */
export function maskId(t: string | null): string {
  const m = /^id: (.*)$/m.exec(t ?? '');
  assert.ok(m && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(m[1]), `id is a new ULID: ${m?.[1]}`);
  return (t ?? '').replace(m![0], 'id: <ULID>');
}
export { ISO_OFFSET };
