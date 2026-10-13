// MS3 slice 3B real-app suite (L6, Appium mac2 on the built test app): docs/acceptance/read-view.md FR-SYN-06 AC-6
// (no-write tour), NFR-REL-03 AC-5 (invalid frontmatter never rewritten), FR-EDT-10 AC-5 and FR-TYP-08 AC-5 (relaunch).
// Interface: docs/contracts/ms3-shell.md §1, §6, §11 (TEGG_TEST, TEGG_APP_SUPPORT, TEGG_VAULT, TEGG_ROUTE, TEGG_PERF_LOG,
// TEGG_EXIT_AFTER; marks `route-ready:<route>`, `note-ready`). Written from the ACs and contracts only (D-61). Always
// TEGG_TEST=1 with temporary Application Support and vault copies of the synthetic fixture (D-62).
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
const PORT = Number(process.env.APPIUM_PORT ?? 4724);
const APPIUM_HOME = process.env.APPIUM_HOME ?? resolve(import.meta.dirname, '.appium');
const FX = join(REPO, 'tests/fixtures/vaults');
const MARK_TIMEOUT = 20_000;

// ---------------------------------------------------------------- setup helpers (no AC assertions)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `tegg-ms3-read-${name}-`));

/** A temp copy of tests/fixtures/vaults/read-view plus new-empty/.tegg (read-view.md "Fixture"). */
function readCopy(base: string): string {
  const v = join(base, 'Čtení');
  cpSync(join(FX, 'read-view'), v, { recursive: true });
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
  const q = `(label == "${label}" OR title == "${label}" OR value == "${label}")`;
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
/** The built app must exist and write the 3B `note-ready` mark on a note route (ms3-shell §11.5). */
function preflight(): Promise<string | null> {
  pre ??= (async () => {
    if (!existsSync(EXE)) return `app not built: ${EXE} (cd app && npm run app:build)`;
    const base = tmp('preflight');
    const log = join(base, 'perf.jsonl');
    const child = spawnApp(testEnv(join(base, 'support'), log, { TEGG_VAULT: readCopy(base), TEGG_ROUTE: 'note/Pages/Bloky.md', TEGG_EXIT_AFTER: 'note-ready' }));
    const ok = await waitMark(log, 'note-ready');
    quitApp(child);
    await waitExit(child);
    rmSync(base, { recursive: true, force: true });
    return ok ? null : 'the app does not write the note-ready mark on a note route (ms3-shell §11.5, slice 3B)';
  })();
  return pre;
}
async function ready() {
  const why = await preflight();
  assert.equal(why, null, why ?? '');
}

/** Opens a note through the switcher (⌘O, title pasted, ⏎). */
async function openBySwitcher(d: Driver, title: string) {
  press('o', ['command']);
  assert.ok(await shown(d, 'Quick switcher'), `switcher for ${title}`);
  paste(title);
  await sleep(300);
  press('enter');
  await sleep(500);
}
async function clickLabel(d: Driver, label: string): Promise<boolean> {
  const e = await firstShown(d, label);
  if (!e) return false;
  await e.click().catch(() => {});
  await sleep(300);
  return true;
}

const INVALID = ['Pages/Chyba uvozovky.md', 'Pages/Chyba odsazení.md', 'Pages/Chyba klíč.md', 'Pages/Chyba tabulátor.md', 'Pages/Neuzavřená.md'];

// ---------------------------------------------------------------- tests

test('fr_syn_06_ac6_read_view_tour_leaves_the_vault_untouched', { timeout: 900_000 }, async () => {
  await ready();
  const base = tmp('syn06');
  const vault = readCopy(base);
  const support = join(base, 'support');
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support, log, { TEGG_VAULT: vault, TEGG_ROUTE: 'note/Pages/Odkazy.md' }));
    assert.ok(await waitMark(log, 'note-ready'), 'Odkazy shown');
    // Every resolved link, unresolved link, date link and tag of Odkazy.
    const labels = ['Cíl', 'jiný text', 'text', 'kódovaný', 'Dvojník', 'Neexistuje', 'Reading list', 'Šablona', 'Smazaná',
      '2026-10-07', '2026-10-08', '#projekt', '#Projekt/alfa'];
    let clicked = 0;
    for (const l of labels) {
      await openBySwitcher(d, 'Odkazy');
      if (await clickLabel(d, l)) clicked++;
    }
    assert.ok(clicked >= labels.length - 1, `links found and activated: ${clicked}/${labels.length}`);
    // Every fixture note: open and toggle the source view on and off.
    for (const t of ['Bloky', 'Odkazy', 'Cíl', 'Dvojník', 'Vlastnosti', 'Jen systémové', 'Bez hlavičky', '2026-10-07']) {
      await openBySwitcher(d, t);
      press('u', ['option', 'command']);
      await sleep(200);
      press('u', ['option', 'command']);
    }
    await openBySwitcher(d, 'Vlastnosti');
    assert.ok(await clickLabel(d, 'Properties'), 'attribute strip collapsed');
    await openBySwitcher(d, 'Bloky');
    for (const c of ['Složené', 'Rozbalené']) await clickLabel(d, c);
  } finally {
    await end(d);
  }
  assert.deepEqual(tree(vault), before, 'every vault file and folder unchanged (bytes, mtime, inode), nothing created');
  rmSync(base, { recursive: true, force: true });
});

test('nfr_rel_03_ac5_invalid_frontmatter_files_never_rewritten', { timeout: 600_000 }, async () => {
  await ready();
  const base = tmp('rel03');
  const vault = readCopy(base);
  const support = join(base, 'support');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    for (const p of INVALID) {
      const log = join(base, `perf-${INVALID.indexOf(p)}.jsonl`);
      d = await session(testEnv(support, log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${p}` }));
      assert.ok(await waitMark(log, 'note-ready'), `${p} shown`);
      press('u', ['option', 'command']);
      await sleep(300);
      press('u', ['option', 'command']);
      await sleep(300);
      await openBySwitcher(d, 'Bloky');
      await end(d);
      d = undefined;
    }
  } finally {
    await end(d);
  }
  const after = tree(vault);
  for (const p of INVALID) assert.deepEqual(after[p], before[p], `${p}: bytes, mtime and inode unchanged`);
  assert.deepEqual(after, before, 'vault unchanged');
  rmSync(base, { recursive: true, force: true });
});

test('fr_edt_10_ac5_formatted_view_after_relaunch', { timeout: 240_000 }, async () => {
  await ready();
  const base = tmp('edt10');
  const vault = readCopy(base);
  const support = join(base, 'support');
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  const supportBefore = () => tree(support);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support, log, { TEGG_VAULT: vault, TEGG_ROUTE: 'note/Pages/Bloky.md' }));
    assert.ok(await waitMark(log, 'note-ready'), 'Bloky shown');
    await sleep(500);
    const sup = supportBefore();
    press('u', ['option', 'command']);
    assert.ok(await shown(d, 'Markdown source'), '⌥⌘U shows the source view');
    assert.ok(await shown(d, 'Show formatted note'), 'toggle pressed');
    await sleep(500);
    const supAfter = tree(support);
    assert.deepEqual(Object.keys(supAfter).filter((k) => k.endsWith('ui-state.json')).map((k) => supAfter[k]), Object.keys(sup).filter((k) => k.endsWith('ui-state.json')).map((k) => sup[k]), 'toggling writes nothing to the Application Support root');
    await end(d);
    d = await session(testEnv(support, join(base, 'perf2.jsonl'), { TEGG_VAULT: vault, TEGG_ROUTE: 'note/Pages/Bloky.md' }));
    assert.ok(await waitMark(join(base, 'perf2.jsonl'), 'note-ready'), 'relaunch');
    assert.ok(await shown(d, 'Show Markdown source'), 'relaunch opens the formatted view');
    assert.equal(await shown(d, 'Markdown source', 500), false, 'no source view after relaunch');
  } finally {
    await end(d);
  }
  assert.deepEqual(tree(vault), before, 'vault unchanged');
  rmSync(base, { recursive: true, force: true });
});

test('fr_typ_08_ac5_properties_state_survives_relaunch', { timeout: 240_000 }, async () => {
  await ready();
  const base = tmp('typ08');
  const vault = readCopy(base);
  const support = join(base, 'support');
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support, log, { TEGG_VAULT: vault, TEGG_ROUTE: 'note/Pages/Vlastnosti.md' }));
    assert.ok(await waitMark(log, 'note-ready'), 'Vlastnosti shown');
    assert.ok(await shown(d, 'Rozpracováno'), 'strip expanded by default');
    assert.ok(await clickLabel(d, 'Properties'), 'header button Properties');
    assert.equal(await shown(d, 'Rozpracováno', 1000), false, 'collapsed');
    await sleep(500);
    await end(d);
    d = undefined;
    const stored = JSON.parse(readFileSync(join(support, 'ui-state.json'), 'utf8'));
    assert.equal(stored.propertiesOpen, false, 'stored per machine in ui-state.json');
    d = await session(testEnv(support, join(base, 'perf2.jsonl'), { TEGG_VAULT: vault, TEGG_ROUTE: 'note/Pages/Vlastnosti.md' }));
    assert.ok(await waitMark(join(base, 'perf2.jsonl'), 'note-ready'), 'relaunch');
    assert.ok(await shown(d, 'Properties'), 'strip header shown');
    assert.equal(await shown(d, 'Rozpracováno', 1000), false, 'still collapsed after relaunch');
  } finally {
    await end(d);
  }
  assert.deepEqual(tree(vault), before, 'vault unchanged');
  rmSync(base, { recursive: true, force: true });
});
