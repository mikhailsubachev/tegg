// MS3 3D follow-up real-app test (L6 once, Appium mac2 on the built test app): docs/acceptance/types.md FR-TYP-01
// AC-10 (`Create type "<value>"` on the shell fixture writes exactly `.tegg/types/recept.yml`, D-251, D-259).
// Interface: docs/contracts/ms3-shell.md §1, §6, §14.7.1, §15.6 (TEGG_TEST, TEGG_APP_SUPPORT, TEGG_VAULT, TEGG_ROUTE,
// TEGG_PERF_LOG; marks `route-ready:<route>`). Written from the ACs and contracts only (D-61). Always TEGG_TEST=1 with
// temporary Application Support and a vault copy of the synthetic fixture (D-62). The helpers are copied from
// ms3_types.ac.test.ts (existing AC test files are not changed, TS-I3).
//
// Prerequisites as in ms3_shell.ac.test.ts: `npm run app:build`, `npm run e2e:setup`, Accessibility permission.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const APP = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app');
const EXE = join(APP, 'Contents/MacOS/tegg');
const BUNDLE_ID = 'app.tegg.desktop';
const PORT = Number(process.env.APPIUM_PORT ?? 4726);
const APPIUM_HOME = process.env.APPIUM_HOME ?? resolve(import.meta.dirname, '.appium');
const FX = join(REPO, 'tests/fixtures/vaults');
const MARK_TIMEOUT = 20_000;

// ---------------------------------------------------------------- setup helpers (no AC assertions)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `tegg-ms3-3dfu-${name}-`));

/** A temp copy of tests/fixtures/vaults/shell plus new-empty/.tegg (FR-TYP-01 AC-10 uses the shell fixture). */
function shellCopy(base: string): string {
  const v = join(base, 'Trezor');
  cpSync(join(FX, 'shell'), v, { recursive: true });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}

type Entry = { sha: string; mtimeMs: number; ino: number } | 'dir';
function tree(root: string): Record<string, Entry> {
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

function marks(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { mark: string }).mark);
}

async function waitMark(file: string, mark: string, ms = MARK_TIMEOUT): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (marks(file).includes(mark)) return true;
    await sleep(50);
  }
  return false;
}

type Env = Record<string, string>;
function testEnv(appSupport: string, perfLog: string, extra: Env = {}): Env {
  return { TEGG_TEST: '1', TEGG_APP_SUPPORT: appSupport, TEGG_PERF_LOG: perfLog, ...extra };
}

/** Starts the executable directly (no UI driving); returns the process. */
function spawnApp(env: Env): ChildProcess {
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  return spawn(EXE, [], { env: { ...clean, ...env }, stdio: 'ignore' });
}

function quitApp(child?: ChildProcess) {
  try { execFileSync('osascript', ['-e', `tell application id "${BUNDLE_ID}" to quit`], { stdio: 'ignore', timeout: 5000 }); } catch { /* not running */ }
  if (child && child.exitCode === null) child.kill('SIGTERM');
}

async function waitExit(child: ChildProcess, ms = 10_000) {
  const end = Date.now() + ms;
  while (child.exitCode === null && child.signalCode === null && Date.now() < end) await sleep(50);
}

// System Events key codes.
const KEY: Record<string, number> = {
  u: 32, a: 0, s: 1, d: 2, f: 3, i: 34, k: 40, n: 45, o: 31, p: 35, t: 17, v: 9, comma: 43, backslash: 42, lbracket: 33,
  rbracket: 30, enter: 36, escape: 53, tab: 48, space: 49, down: 125, up: 126,
};
const osa = (...lines: string[]) => execFileSync('osascript', lines.flatMap((l) => ['-e', l]), { encoding: 'utf8' });
function press(key: keyof typeof KEY | string, mods: ('command' | 'shift' | 'control' | 'option')[] = []) {
  osa(`tell application "System Events" to key code ${KEY[key]}${mods.length ? ` using {${mods.map((m) => `${m} down`).join(', ')}}` : ''}`);
}
function paste(text: string) {
  execFileSync('pbcopy', { input: text, env: { ...process.env, LANG: 'en_US.UTF-8' } });
  press('v', ['command']);
}

// ---------------------------------------------------------------- Appium
let appium: ChildProcess | undefined;
async function appiumUp() {
  if (appium) return;
  // Own process group: `npx` starts Appium as a child, and Appium starts WebDriverAgent's xcodebuild, so killing only
  // the `npx` pid leaves both running and the test process never exits.
  appium = spawn('npx', ['appium', '--port', String(PORT), '--log-level', 'error'], { cwd: import.meta.dirname, env: { ...process.env, APPIUM_HOME }, stdio: 'ignore', detached: true });
  appium.unref();
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (await fetch(`http://127.0.0.1:${PORT}/status`).then((r) => r.ok, () => false)) return;
    await sleep(200);
  }
  assert.fail(`Appium did not start on port ${PORT} (run npm run e2e:setup)`);
}
function appiumDown() {
  if (appium?.pid) {
    try { process.kill(-appium.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  appium = undefined;
}
after(appiumDown);
process.on('exit', appiumDown);

type Driver = Awaited<ReturnType<typeof import('webdriverio').remote>>;
/** Launches the app through Appium with the given environment and returns the session. */
async function session(env: Env): Promise<Driver> {
  await appiumUp();
  const { remote } = await import('webdriverio');
  return remote({
    hostname: '127.0.0.1', port: PORT, logLevel: 'error',
    capabilities: {
      platformName: 'mac', 'appium:automationName': 'Mac2', 'appium:bundleId': BUNDLE_ID, 'appium:appPath': APP,
      'appium:environment': env, 'appium:newCommandTimeout': 300,
    } as any,
  });
}
async function end(d: Driver | undefined) {
  await d?.execute('macos: terminateApp', { bundleId: BUNDLE_ID }).catch(() => {});
  await d?.deleteSession().catch(() => {});
}
async function rect(e: any) {
  const { x, y } = await e.getLocation();
  const { width, height } = await e.getSize();
  return { x, y, width, height };
}
// Static text is exposed with its text as the AX value, not the label (macOS), so firstShown matches all three.
/** The first displayed element with that label, title or value; buttons and links first (a region and its header
 *  button can share a name), so the lookup is never ambiguous. */
async function firstShown(d: Driver, label: string): Promise<any | null> {
  const l = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); // predicate string literal: escape \ and "
  const q = `(label == "${l}" OR title == "${l}" OR value == "${l}")`;
  // XCUIElementType: 9 button, 10 radio button, 12 checkbox, 17 toolbar button, 41 toggle, 42 link, 80 tab.
  for (const sel of [`-ios predicate string:elementType IN {9, 10, 12, 17, 41, 42, 80} AND ${q}`, `-ios predicate string:${q}`]) {
    for (const e of await d.$$(sel).catch(() => [] as any[])) {
      if (await e.isDisplayed().catch(() => false)) return e;
    }
  }
  return null;
}
async function shown(d: Driver, label: string, ms = 3000): Promise<boolean> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    if (await firstShown(d, label)) return true;
    await sleep(100);
  }
  return false;
}

// ---------------------------------------------------------------- preflight (fails fast on an assertion)
let pre: Promise<string | null> | undefined;
/** The built app must exist and show the undefined type page `type/recept` (route-ready mark, ms3-shell §14.7.1). */
function preflight(): Promise<string | null> {
  pre ??= (async () => {
    if (!existsSync(EXE)) return `app not built: ${EXE} (cd app && npm run app:build)`;
    const base = tmp('preflight');
    const log = join(base, 'perf.jsonl');
    const mark = 'route-ready:type/recept';
    const child = spawnApp(testEnv(join(base, 'support'), log, { TEGG_VAULT: shellCopy(base), TEGG_ROUTE: 'type/recept', TEGG_EXIT_AFTER: mark }));
    const ok = await waitMark(log, mark);
    quitApp(child);
    await waitExit(child);
    rmSync(base, { recursive: true, force: true });
    return ok ? null : 'the app does not show type/recept (route-ready mark missing; ms3-shell §14.7.1)';
  })();
  return pre;
}
async function ready() {
  const why = await preflight();
  assert.equal(why, null, why ?? '');
}

async function paletteRun(d: Driver, command: string) {
  press('k', ['command']);
  assert.ok(await shown(d, 'Command palette'), `palette for ${command}`);
  paste(command);
  await sleep(300);
  press('enter');
  await sleep(500);
}
async function waitFile(path: string, ok: (t: string | null) => boolean, ms: number): Promise<string | null> {
  const endAt = Date.now() + ms;
  let t: string | null = null;
  while (Date.now() < endAt) {
    t = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (ok(t)) return t;
    await sleep(50);
  }
  return t;
}
/** Vertical position of the first displayed element with that label (null if not shown). */
async function yOf(d: Driver, label: string): Promise<number | null> {
  const e = await firstShown(d, label);
  return e ? (await rect(e)).y : null;
}
const changedPaths = (a: Record<string, Entry>, b: Record<string, Entry>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();

// ---------------------------------------------------------------- tests

test('fr_typ_01_ac10_create_type_from_an_undefined_value_on_the_real_core', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('typ01ac10');
  const vault = shellCopy(base);
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(join(base, 'support'), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'type/recept' }));
    assert.ok(await waitMark(log, 'route-ready:type/recept'), 'type/recept shown');
    const button = await firstShown(d, 'Create type "recept"');
    assert.ok(button, 'button Create type "recept" on the undefined type page');
    await button.click();
    assert.ok(await shown(d, 'New type'), 'dialog New type');
    press('a', ['command']); // Plural name is focused and prefilled `Recept`
    paste('Recepty');
    press('enter');
    const t = await waitFile(join(vault, '.tegg/types/recept.yml'), (x) => x !== null, 2000);
    assert.equal(t, readFileSync(join(REPO, 'tests/fixtures/types/expected/recept.yml'), 'utf8'), 'byte-identical to the expected file');
    assert.ok(await waitMark(log, 'route-ready:type-settings/recept'), 'route type-settings/recept');
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(before, tree(vault)), ['.tegg/types/recept.yml'], 'one file; Recepty/Svíčková.md keeps bytes, mtime and inode');
  rmSync(base, { recursive: true, force: true });
});
