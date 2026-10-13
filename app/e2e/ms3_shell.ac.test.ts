// MS3 slice 3A real-app suite (L6, Appium mac2 on the built test app): docs/acceptance/app-shell.md.
// Interface: docs/contracts/ms2-shell.md §1, §3 and docs/contracts/ms3-shell.md §1, §3.7, §6 (TEGG_TEST, TEGG_APP_SUPPORT,
// TEGG_VAULT, TEGG_TEST_PICK_DIR, TEGG_THEME, TEGG_ROUTE, TEGG_PERF_LOG; marks `ui-ready`, `route-ready:<route>`).
// Written from the ACs and contracts only (D-61). Always TEGG_TEST=1 with temporary Application Support and vault
// copies of the synthetic fixture: never the owner's Application Support or vault (D-62).
//
// Prerequisites (once per machine): `npm run app:build`, `npm run e2e:setup` (mac2 driver + WebDriverAgentMac;
// APPIUM_HOME defaults to app/e2e/.appium), Accessibility permission for the terminal. Keys are sent with System
// Events; text with diacritics goes through the pasteboard (pbcopy + ⌘V), as typed keystrokes can't produce it.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const APP = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app');
const EXE = join(APP, 'Contents/MacOS/tegg');
const BUNDLE_ID = 'app.tegg.desktop';
const PORT = Number(process.env.APPIUM_PORT ?? 4724);
const APPIUM_HOME = process.env.APPIUM_HOME ?? resolve(import.meta.dirname, '.appium');
const FX = join(REPO, 'tests/fixtures/vaults');
const MARK_TIMEOUT = 20_000;

const EVA = 'Tasks/Zavolat Evě.md';
const CTVRTEK = 'Quick Notes/Nápad na čtvrtek.md';

// ---------------------------------------------------------------- setup helpers (no AC assertions)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `tegg-ms3-${name}-`));

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
  a: 0, s: 1, d: 2, f: 3, i: 34, k: 40, n: 45, o: 31, p: 35, t: 17, v: 9, comma: 43, backslash: 42, lbracket: 33,
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
/** The first displayed element with that label or title, controls first: a tab and its panel, or a button and the
 *  dialog it opens, share a name, and a strict lookup would fail on the ambiguity. XCUIElementType: 9 button,
 *  10 radio button, 12 checkbox, 17 toolbar button, 41 toggle, 42 link, 80 tab (web role=tab). */
async function byLabel(d: Driver, label: string): Promise<any> {
  const q = `(label == "${label}" OR title == "${label}")`;
  for (const sel of [`-ios predicate string:elementType IN {9, 10, 12, 17, 41, 42, 80} AND ${q}`, `-ios predicate string:${q}`]) {
    for (const e of await d.$$(sel).catch(() => [] as any[])) {
      if (await e.isDisplayed().catch(() => false)) return e;
    }
  }
  const all = await d.$$(`-ios predicate string:${q}`).catch(() => [] as any[]);
  return all.length > 0 ? all[0] : d.$(`-ios predicate string:${q}`); // a non-existing element, as before
}
async function shown(d: Driver, label: string, ms = 3000): Promise<boolean> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    const e = await byLabel(d, label);
    if ((await e.isExisting().catch(() => false)) && (await e.isDisplayed().catch(() => false))) return true;
    await sleep(100);
  }
  return false;
}

// ---------------------------------------------------------------- preflight (fails fast on an assertion)
let pre: Promise<string | null> | undefined;
/** The built app must exist and honour the 3A test hooks (`TEGG_ROUTE`, `route-ready:` marks). */
function preflight(): Promise<string | null> {
  pre ??= (async () => {
    if (!existsSync(EXE)) return `app not built: ${EXE} (cd app && npm run app:build)`;
    const base = tmp('preflight');
    const log = join(base, 'perf.jsonl');
    const child = spawnApp(testEnv(join(base, 'support'), log, { TEGG_VAULT: shellCopy(base), TEGG_ROUTE: 'settings/appearance', TEGG_EXIT_AFTER: 'route-ready:settings/appearance' }));
    const ok = await waitMark(log, 'route-ready:settings/appearance');
    quitApp(child);
    await waitExit(child);
    rmSync(base, { recursive: true, force: true });
    return ok ? null : 'the app does not honour TEGG_ROUTE / write route-ready marks (ms3-shell §1)';
  })();
  return pre;
}
async function ready() {
  const why = await preflight();
  assert.equal(why, null, why ?? '');
}

// ---------------------------------------------------------------- tests

test('fr_ux_02_ac10_layout_state_restored_and_machine_local', { timeout: 180_000 }, async () => {
  await ready();
  const base = tmp('ac10');
  const vault = shellCopy(base);
  const support = join(base, 'support');
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support, log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${EVA}` }));
    assert.ok(await waitMark(log, `route-ready:note/${EVA}`), 'note route shown');
    press('s', ['control', 'command']);
    press('backslash', ['command']);
    await (await byLabel(d, 'Outline')).click();
    await sleep(500);
    await end(d);
    const state = JSON.parse(readFileSync(join(support, 'ui-state.json'), 'utf8'));
    assert.equal(state.sidebarOpen, false, 'sidebar state stored');
    assert.deepEqual(state.rightPanel, { open: true, tab: 'outline' }, 'panel state stored');
    d = await session(testEnv(support, log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${EVA}` }));
    assert.ok(await shown(d, 'Context panel', MARK_TIMEOUT), 'panel open after relaunch');
    assert.equal(await shown(d, 'Sidebar', 1000), false, 'sidebar collapsed after relaunch');
    const outline = await byLabel(d, 'Outline');
    assert.equal(String(await outline.getAttribute('selected')), 'true', 'Outline tab selected after relaunch');
  } finally {
    await end(d);
  }
  assert.deepEqual(tree(vault), before, 'vault byte-identical with unchanged mtimes and inodes');
  rmSync(base, { recursive: true, force: true });
});

test('fr_ux_02_ac16_launch_landing_in_the_real_app', { timeout: 240_000 }, async () => {
  await ready();
  const base = tmp('ac16');
  const vault = shellCopy(base);
  const support = join(base, 'support');
  const run = async (what: string, extra: Env, wantMark: string, stayMs = 1500) => {
    const log = join(base, `${what}.jsonl`);
    const snap = tree(vault);
    const child = spawnApp(testEnv(support, log, { TEGG_VAULT: vault, ...extra }));
    const ok = await waitMark(log, wantMark);
    await sleep(stayMs);
    quitApp(child);
    await waitExit(child);
    assert.ok(ok, `${what}: expected mark ${wantMark}, got ${marks(log).filter((m) => m.startsWith('route-ready:')).join(', ')}`);
    assert.deepEqual(tree(vault), snap, `${what}: vault byte-identical before and after launch`);
  };
  await run('(b) no note opened', {}, 'route-ready:home');
  await run('open Eva', { TEGG_ROUTE: `note/${EVA}` }, `route-ready:note/${EVA}`);
  await run('(a) relaunch after Eva', {}, `route-ready:note/${EVA}`);
  renameSync(join(vault, EVA), join(vault, 'Tasks/Zavolat Evě a Petrovi.md'));
  await run('(c) renamed while closed', {}, 'route-ready:note/Tasks/Zavolat Evě a Petrovi.md');
  rmSync(join(vault, 'Tasks/Zavolat Evě a Petrovi.md'));
  await run('(d) deleted while closed', {}, 'route-ready:home');
  rmSync(base, { recursive: true, force: true });
});

test('fr_ux_02_ac16_launch_landing_trashed_note_goes_home', { timeout: 120_000 }, async () => {
  await ready();
  const base = tmp('ac16t');
  const vault = shellCopy(base);
  const support = join(base, 'support');
  const log1 = join(base, 'a.jsonl');
  let child = spawnApp(testEnv(support, log1, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${EVA}` }));
  assert.ok(await waitMark(log1, `route-ready:note/${EVA}`), 'Eva opened');
  await sleep(1500);
  quitApp(child);
  await waitExit(child);
  mkdirSync(join(vault, '.trash/Tasks'), { recursive: true });
  renameSync(join(vault, EVA), join(vault, '.trash', EVA));
  const snap = tree(vault);
  const log2 = join(base, 'b.jsonl');
  child = spawnApp(testEnv(support, log2, { TEGG_VAULT: vault }));
  const ok = await waitMark(log2, 'route-ready:home');
  quitApp(child);
  await waitExit(child);
  assert.ok(ok, 'moved into .trash: lands on home');
  assert.deepEqual(tree(vault), snap, 'vault byte-identical');
  rmSync(base, { recursive: true, force: true });
});

test('fr_ux_02_ac18_window_minimum_size_800_by_500', { timeout: 120_000 }, async () => {
  await ready();
  const base = tmp('ac18');
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(join(base, 'support'), log, { TEGG_VAULT: shellCopy(base) }));
    assert.ok(await waitMark(log, 'ui-ready'), 'ui-ready');
    try { osa('tell application "System Events" to tell (first process whose bundle identifier is "app.tegg.desktop") to set size of window 1 to {600, 400}'); } catch { /* refused */ }
    await sleep(500);
    const size = osa('tell application "System Events" to tell (first process whose bundle identifier is "app.tegg.desktop") to get size of window 1').trim().split(/,\s*/).map(Number);
    assert.ok(size[0] >= 800 && size[1] >= 500, `window resized to ${size.join(' × ')}`);
  } finally {
    await end(d);
    rmSync(base, { recursive: true, force: true });
  }
});

test('fr_ux_01_ac2_native_window_buttons_in_the_title_bar', { timeout: 120_000 }, async () => {
  await ready();
  const base = tmp('ux01');
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(join(base, 'support'), log, { TEGG_VAULT: shellCopy(base) }));
    assert.ok(await waitMark(log, 'ui-ready'), 'ui-ready');
    const win = await d.$('-ios class chain:**/XCUIElementTypeWindow');
    const w = await rect(win);
    const buttons = [];
    for (const id of ['_XCUI:CloseWindow', '_XCUI:MinimizeWindow', '_XCUI:FullScreenWindow']) {
      const b = await d.$(`-ios class chain:**/XCUIElementTypeWindow/XCUIElementTypeButton[\`identifier == "${id}"\`]`);
      assert.ok(await b.isExisting(), `${id} exists`);
      const r = await rect(b);
      assert.ok(r.y >= w.y && r.y + r.height <= w.y + 44, `${id} lies inside the 44 px title bar`);
      buttons.push(r);
    }
    const web = await d.$$('-ios class chain:**/XCUIElementTypeWebView/**/XCUIElementTypeButton');
    for (const e of web) {
      const r = await rect(e);
      for (const b of buttons) {
        const hit = r.x < b.x + b.width && b.x < r.x + r.width && r.y < b.y + b.height && b.y < r.y + r.height;
        assert.ok(!hit, `web control at ${r.x},${r.y} overlaps a window button`);
      }
    }
    const before = osa('tell application "System Events" to tell (first process whose bundle identifier is "app.tegg.desktop") to get position of window 1').trim();
    await d.execute('macos: clickAndDrag', { startX: w.x + w.width / 2, startY: w.y + 22, endX: w.x + w.width / 2 + 80, endY: w.y + 72, duration: 0.5 });
    await sleep(500);
    const after = osa('tell application "System Events" to tell (first process whose bundle identifier is "app.tegg.desktop") to get position of window 1').trim();
    assert.notEqual(after, before, 'dragging an empty title bar area moves the window');
  } finally {
    await end(d);
    rmSync(base, { recursive: true, force: true });
  }
});

test('fr_ux_03_ac1_palette_opens_on_a_route_in_the_real_app', { timeout: 120_000 }, async () => {
  await ready();
  const base = tmp('ux03-1');
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(join(base, 'support'), log, { TEGG_VAULT: shellCopy(base), TEGG_ROUTE: 'inbox' }));
    assert.ok(await waitMark(log, 'route-ready:inbox'), 'inbox shown');
    press('k', ['command']);
    assert.ok(await shown(d, 'Command palette'), '⌘K opens the palette');
    press('escape');
    press('p', ['command', 'shift']);
    assert.ok(await shown(d, 'Command palette'), '⇧⌘P opens the palette');
  } finally {
    await end(d);
    rmSync(base, { recursive: true, force: true });
  }
});

test('fr_ux_03_ac12_keys_work_right_after_launch', { timeout: 120_000 }, async () => {
  await ready();
  const base = tmp('ux03-12');
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(join(base, 'support'), log, { TEGG_VAULT: shellCopy(base) }));
    assert.ok(await waitMark(log, 'ui-ready'), 'ui-ready');
    press('k', ['command']);
    assert.ok(await shown(d, 'Command palette'), '⌘K opens the palette without a click');
    press('escape');
    await sleep(300);
    assert.equal(await shown(d, 'Command palette', 500), false, 'Esc closes it');
    press('o', ['command']);
    assert.ok(await shown(d, 'Quick switcher'), '⌘O opens the switcher');
  } finally {
    await end(d);
    rmSync(base, { recursive: true, force: true });
  }
});

test('fr_set_02_ac4_theme_stored_per_machine', { timeout: 180_000 }, async () => {
  await ready();
  const base = tmp('set02');
  const vault = shellCopy(base);
  const support = join(base, 'support');
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support, log, { TEGG_VAULT: vault, TEGG_ROUTE: 'settings/appearance' }));
    assert.ok(await waitMark(log, 'route-ready:settings/appearance'), 'settings shown');
    await (await byLabel(d, 'Dark')).click();
    await sleep(500);
    await end(d);
    d = undefined;
    assert.equal(JSON.parse(readFileSync(join(support, 'ui-state.json'), 'utf8')).theme, 'dark', 'stored under the Application Support root');
    d = await session(testEnv(support, log, { TEGG_VAULT: vault, TEGG_ROUTE: 'settings/appearance' }));
    assert.ok(await shown(d, 'Dark', MARK_TIMEOUT), 'settings after relaunch');
    assert.equal(String(await (await byLabel(d, 'Dark')).getAttribute('value')), '1', 'Dark selected after relaunch');
  } finally {
    await end(d);
  }
  assert.deepEqual(tree(vault), before, 'vault (including .tegg/vault.yml) byte-identical');
  rmSync(base, { recursive: true, force: true });
});

test('fr_vlt_01_ac9_chooser_in_the_real_app', { timeout: 120_000 }, async () => {
  await ready();
  const base = tmp('vlt9');
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(join(base, 'support'), log));
    assert.ok(await waitMark(log, 'ui-ready'), 'ui-ready with the chooser');
    assert.ok(await shown(d, 'Create new vault'), 'Create new vault');
    assert.ok(await shown(d, 'Open existing folder'), 'Open existing folder');
    assert.equal(await shown(d, 'Sidebar', 500), false, 'no sidebar');
    press('enter');
    assert.ok(await shown(d, 'Vault name'), '⏎ activates Create new vault');
  } finally {
    await end(d);
    rmSync(base, { recursive: true, force: true });
  }
});

const maskIds = (s: string) => s.replace(/^(\s*(?:id|created|modified):).*$/gm, '$1 *');

test('fr_vlt_01_ac11_new_vault_in_the_real_app', { timeout: 180_000 }, async () => {
  await ready();
  const base = tmp('vlt11');
  const parent = join(base, 'parent');
  mkdirSync(parent);
  const support = join(base, 'support');
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support, log, { TEGG_TEST_PICK_DIR: parent }));
    assert.ok(await waitMark(log, 'ui-ready'), 'chooser ready');
    await (await byLabel(d, 'Create new vault')).click();
    await (await byLabel(d, 'Vault name')).click();
    paste('Můj trezor'.normalize('NFD'));
    await (await byLabel(d, 'Choose…')).click();
    await sleep(300);
    await (await byLabel(d, 'Create')).click();
    assert.ok(await waitMark(log, 'route-ready:home'), 'the new vault opens on home');
  } finally {
    await end(d);
    d = undefined;
  }
  assert.deepEqual(readdirSync(parent).map((n) => n.normalize('NFC')), ['Můj trezor'], 'only the vault folder in the parent');
  assert.deepEqual(readdirSync(parent), ['Můj trezor'], 'folder name written in NFC');
  const got = tree(join(parent, 'Můj trezor'));
  const want = tree(join(FX, 'new-empty'));
  assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort(), 'same file list as tests/fixtures/vaults/new-empty');
  for (const f of Object.keys(want).filter((k) => !k.endsWith('/'))) {
    assert.equal(maskIds(readFileSync(join(parent, 'Můj trezor', f), 'utf8')), maskIds(readFileSync(join(FX, 'new-empty', f), 'utf8')), `${f} bytes`);
  }
  const log2 = join(base, 'perf2.jsonl');
  const child = spawnApp(testEnv(support, log2));
  const reopened = await waitMark(log2, 'route-ready:home');
  quitApp(child);
  await waitExit(child);
  assert.ok(reopened, 'a relaunch opens the new vault');
  rmSync(base, { recursive: true, force: true });
});

test('fr_vlt_01_ac13_cancel_writes_nothing', { timeout: 180_000 }, async () => {
  await ready();
  const base = tmp('vlt13');
  const parent = join(base, 'parent');
  mkdirSync(parent);
  const support = join(base, 'support');
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support, log, { TEGG_TEST_PICK_DIR: '' }));
    assert.ok(await waitMark(log, 'ui-ready'), 'chooser ready');
    await sleep(500);
    const p0 = tree(parent);
    const s0 = Object.fromEntries(Object.entries(tree(support)).filter(([k]) => !k.endsWith('.jsonl')));
    // Cancelled folder dialog.
    await (await byLabel(d, 'Create new vault')).click();
    await (await byLabel(d, 'Choose…')).click();
    assert.ok(await shown(d, 'Create new vault') || await shown(d, 'Vault name'), 'after a cancelled folder dialog');
    if (await shown(d, 'Vault name', 300)) { press('escape'); }
    assert.ok(await shown(d, 'Create new vault'), 'Esc in the form returns to the chooser');
    await (await byLabel(d, 'Create new vault')).click();
    await (await byLabel(d, 'Cancel')).click();
    assert.ok(await shown(d, 'Open existing folder'), 'Cancel returns to the chooser');
    assert.deepEqual(tree(parent), p0, 'parent folder unchanged');
    assert.deepEqual(Object.fromEntries(Object.entries(tree(support)).filter(([k]) => !k.endsWith('.jsonl'))), s0, 'Application Support unchanged');
  } finally {
    await end(d);
    rmSync(base, { recursive: true, force: true });
  }
});

test('fr_vlt_03_ac5_icloud_stub_banner_in_the_real_app', { timeout: 120_000 }, async () => {
  await ready();
  const base = tmp('vlt03');
  const vault = shellCopy(base);
  const stub = join(vault, 'Pages/.Odložená poznámka.md.icloud');
  writeFileSync(stub, '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>NSURLNameKey</key><string>Odložená poznámka.md</string><key>NSURLFileSizeKey</key><integer>120</integer></dict></plist>\n');
  const before = tree(vault)['Pages/.Odložená poznámka.md.icloud'];
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(join(base, 'support'), log, { TEGG_VAULT: vault }));
    assert.ok(await waitMark(log, 'ui-ready'), 'ui-ready');
    const banner = await d.$('-ios predicate string:(label CONTAINS "1 file" OR value CONTAINS "1 file") AND NOT (label CONTAINS "files")');
    assert.ok(await banner.isExisting(), 'banner naming 1 file');
  } finally {
    await end(d);
  }
  assert.deepEqual(tree(vault)['Pages/.Odložená poznámka.md.icloud'], before, 'stub unchanged (D-113)');
  rmSync(base, { recursive: true, force: true });
});

test('fr_nav_01_ac13_new_object_on_the_real_core', { timeout: 240_000 }, async () => {
  await ready();
  const base = tmp('nav13');
  const vaultA = shellCopy(join(base, 'a'));
  const vaultB = shellCopy(join(base, 'b'));
  const ctvrtek = tree(vaultA)[CTVRTEK];
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    // (a) and (b) through New object.
    d = await session(testEnv(join(base, 'support-a'), log, { TEGG_VAULT: vaultA }));
    assert.ok(await waitMark(log, 'ui-ready'), 'ui-ready');
    const files0 = Object.keys(tree(vaultA));
    press('n', ['command']);
    assert.ok(await shown(d, 'New object'), 'New object dialog');
    paste('Nový nápad'.normalize('NFD'));
    press('enter');
    await sleep(1500);
    press('n', ['command']);
    assert.ok(await shown(d, 'New object'), 'New object dialog again');
    paste('Nápad na čtvrtek');
    press('enter');
    await sleep(1500);
    const added = Object.keys(tree(vaultA)).filter((p) => !files0.includes(p)).sort();
    // `added` is sorted by UTF-16 code unit, where `o` (U+006F) comes before `á` (U+00E1).
    assert.deepEqual(added, ['Quick Notes/Nový nápad.md', 'Quick Notes/Nápad na čtvrtek (2).md'], 'exactly the two new files, NFC');
    assert.ok(readdirSync(join(vaultA, 'Quick Notes')).includes('Nový nápad.md'), 'file name on disk in NFC');
    assert.deepEqual(tree(vaultA)[CTVRTEK], ctvrtek, '(b) Čtvrtek byte-identical');
    await end(d);
    d = undefined;
    // The switcher's create item for the same title and type, on a second copy.
    const logB = join(base, 'perf-b.jsonl');
    d = await session(testEnv(join(base, 'support-b'), logB, { TEGG_VAULT: vaultB }));
    assert.ok(await waitMark(logB, 'ui-ready'), 'ui-ready (b)');
    press('o', ['command']);
    assert.ok(await shown(d, 'Quick switcher'), 'switcher');
    paste('Nový nápad');
    await sleep(500);
    press('enter');
    await sleep(1500);
    const viaDialog = readFileSync(join(vaultA, 'Quick Notes/Nový nápad.md'), 'utf8');
    const viaSwitcher = readFileSync(join(vaultB, 'Quick Notes/Nový nápad.md'), 'utf8');
    assert.equal(maskIds(viaDialog), maskIds(viaSwitcher), '(a) same bytes as the switcher create item, apart from id and timestamps');
  } finally {
    await end(d);
    rmSync(base, { recursive: true, force: true });
  }
});

const GOTO = ['Go to Home', 'Go to Inbox', 'Go to Today', 'Go to Tasks', 'Go to Search', 'Go to Tags', 'Go to Pinned', 'Go to Saved queries',
  'Go to Graph', 'Go to Trash', 'Go to Import', 'Go to Conflicts', 'Go to Quick capture', 'Go to Settings: Appearance',
  'Go to Settings: Date & time', 'Go to Settings: Vault', 'Go to Settings: Shortcuts', 'Go to Settings: Menu bar and startup',
  'Go to Settings: Trash and history', 'Go to Settings: Previews'];
const TYPES = ['Pages', 'Tasks', 'Quick Notes', 'Daily Notes', 'Cesty', 'Čajovny', 'Schůzky', 'Images', 'PDFs', 'recept'];

test('fr_syn_06_ac5_keyboard_tour_leaves_the_vault_untouched', { timeout: 600_000 }, async () => {
  await ready();
  const base = tmp('syn06');
  const vault = shellCopy(base);
  const support = join(base, 'support');
  const before = tree(vault);
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  const palette = async (title: string) => { press('k', ['command']); await sleep(150); paste(title); await sleep(150); press('enter'); await sleep(400); };
  try {
    d = await session(testEnv(support, log, { TEGG_VAULT: vault }));
    assert.ok(await waitMark(log, 'ui-ready'), 'ui-ready');
    for (const g of GOTO) await palette(g);
    await palette('Open vault…'); press('escape'); await sleep(300);
    for (const t of TYPES) await palette(`Go to type: ${t}`);
    for (const q of ['Porada', 'Zavolat Evě', 'Bez hlavičky']) { press('o', ['command']); await sleep(150); paste(q); await sleep(400); press('enter'); await sleep(500); }
    press('s', ['control', 'command']); press('s', ['control', 'command']);
    press('backslash', ['command']); press('backslash', ['command']);
    press('backslash', ['command', 'shift']); press('escape');
    for (const t of ['Theme: Dark', 'Theme: Light', 'Theme: System']) await palette(t);
    for (const q of ['porada', 'nápad']) { press('f', ['command', 'shift']); await sleep(300); paste(q); await sleep(800); }
    await end(d);
    d = undefined;
    const log2 = join(base, 'perf2.jsonl');
    const child = spawnApp(testEnv(support, log2, { TEGG_VAULT: vault }));
    assert.ok(await waitMark(log2, 'ui-ready'), 'relaunch');
    await sleep(1000);
    quitApp(child);
    await waitExit(child);
    assert.ok(marks(log).filter((m) => m.startsWith('route-ready:')).length >= GOTO.length, 'the tour visited the routes (route-ready marks)');
  } finally {
    await end(d);
  }
  assert.deepEqual(tree(vault), before, 'every vault file: bytes, mtime and inode unchanged; no file or folder created (incl. .tegg/)');
  rmSync(base, { recursive: true, force: true });
});
