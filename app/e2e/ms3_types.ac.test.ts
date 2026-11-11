// MS3 slice 3D real-app suite (L6, Appium mac2 on the built test app): docs/acceptance/types.md FR-TYP-01 AC-2 (once),
// FR-TYP-09 AC-3 (sort survives a relaunch), AC-11 (no writes, once), FR-VLT-02 AC-8 (starter vault, once), FR-EDT-07
// AC-14 (one external edit). Interface: docs/contracts/ms3-shell.md §1, §6, §14 (TEGG_TEST, TEGG_APP_SUPPORT,
// TEGG_VAULT, TEGG_ROUTE, TEGG_PERF_LOG, TEGG_EXIT_AFTER, TEGG_TEST_PICK_DIR; marks `route-ready:<route>`,
// `note-ready`). Written from the ACs and contracts only (D-61). Always TEGG_TEST=1 with temporary Application Support
// and vault copies of the synthetic fixture (D-62).
//
// Prerequisites as in ms3_shell.ac.test.ts: `npm run app:build`, `npm run e2e:setup`, Accessibility permission.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { osa as guardedOsa } from './helpers/osa.ts';

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
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `tegg-ms3-types-${name}-`));

/** A temp copy of tests/fixtures/vaults/types plus new-empty/.tegg (types.md "Fixtures"). */
function typesCopy(base: string): string {
  const v = join(base, 'Typy');
  cpSync(join(FX, 'types'), v, { recursive: true });
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
  // D-835: the tidy job (D-805) is off in real-app tests; this fixture keeps objects outside their type's folder.
  return { TEGG_TEST: '1', TEGG_APP_SUPPORT: appSupport, TEGG_PERF_LOG: perfLog, TEGG_TEST_TIDY: '0', ...extra };
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
const osa = guardedOsa; // D-758: ⌘Q/⌘W only while Tegg is frontmost
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
/** The built app must exist and write the 3D `route-ready:type-settings/schůzka` mark (ms3-shell §14.7.1). */
function preflight(): Promise<string | null> {
  pre ??= (async () => {
    if (!existsSync(EXE)) return `app not built: ${EXE} (cd app && npm run app:build)`;
    const base = tmp('preflight');
    const log = join(base, 'perf.jsonl');
    const mark = 'route-ready:type-settings/schůzka';
    const child = spawnApp(testEnv(join(base, 'support'), log, { TEGG_VAULT: typesCopy(base), TEGG_ROUTE: 'type-settings/schůzka', TEGG_EXIT_AFTER: mark }));
    const ok = await waitMark(log, mark);
    quitApp(child);
    await waitExit(child);
    rmSync(base, { recursive: true, force: true });
    return ok ? null : 'the app does not show type-settings/<key> (route-ready mark missing; ms3-shell §14.7.1, slice 3D)';
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

test('fr_typ_01_ac2_create_writes_exactly_the_type_file_on_the_real_core', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('typ01');
  const vault = typesCopy(base);
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(join(base, 'support'), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'type/page' }));
    assert.ok(await waitMark(log, 'route-ready:type/page'), 'type/page shown');
    await paletteRun(d, 'New type…');
    assert.ok(await shown(d, 'New type'), 'dialog New type');
    paste('Čajovna');
    press('tab');
    paste('Čajovny');
    press('enter');
    const t = await waitFile(join(vault, '.tegg/types/čajovna.yml'), (x) => x !== null, 2000);
    assert.equal(t, readFileSync(join(REPO, 'tests/fixtures/types/expected/čajovna.yml'), 'utf8'), 'byte-identical to the expected file');
    assert.ok(await waitMark(log, 'route-ready:type-settings/čajovna'), 'route type-settings/čajovna');
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(before, tree(vault)), ['.tegg/types/čajovna.yml'], 'one file; no folder, no template');
  rmSync(base, { recursive: true, force: true });
});

test('fr_typ_09_ac3_sort_survives_a_relaunch', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('typ09sort');
  const vault = typesCopy(base);
  const support = join(base, 'support');
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support, log, { TEGG_VAULT: vault, TEGG_ROUTE: 'type/schůzka' }));
    assert.ok(await waitMark(log, 'route-ready:type/schůzka'), 'type/schůzka shown');
    const [p0, v0] = [await yOf(d, 'Prázdná schůzka'), await yOf(d, 'Schůzka ve stránkách')];
    assert.ok(p0 !== null && v0 !== null && v0 < p0, 'default: Modified descending (Ve stránkách above Prázdná)');
    const title = await firstShown(d, 'Title');
    assert.ok(title, 'column header Title');
    await title.click();
    await sleep(500);
  } finally {
    await end(d);
  }
  const log2 = join(base, 'perf2.jsonl');
  try {
    d = await session(testEnv(support, log2, { TEGG_VAULT: vault, TEGG_ROUTE: 'type/schůzka' }));
    assert.ok(await waitMark(log2, 'route-ready:type/schůzka'), 'relaunched on type/schůzka');
    const [p1, v1] = [await yOf(d, 'Prázdná schůzka'), await yOf(d, 'Schůzka ve stránkách')];
    assert.ok(p1 !== null && v1 !== null && p1 < v1, 'title ascending after the relaunch (Prázdná above Ve stránkách)');
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(before, tree(vault)), [], 'nothing written to the vault (machine-local state only)');
  rmSync(base, { recursive: true, force: true });
});

test('fr_typ_09_ac11_type_pages_write_nothing_on_the_real_core', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('typ09tour');
  const vault = typesCopy(base);
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(join(base, 'support'), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'type/schůzka' }));
    assert.ok(await waitMark(log, 'route-ready:type/schůzka'), 'type/schůzka shown');
    assert.ok(await shown(d, 'Columns'), 'red guard: the 3D type page (table with Columns, FR-TYP-09 AC-13)');
    for (const pl of ['Schůzky', 'Projekty', 'Osoby', 'Pages', 'Nápady']) {
      await paletteRun(d, `Go to type: ${pl}`);
      for (const h of ['Title', 'Modified']) await (await firstShown(d, h))?.click().catch(() => {});
      press('down');
      press('down');
    }
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(before, tree(vault)), [], 'bytes, mtime and inode unchanged; nothing created');
  rmSync(base, { recursive: true, force: true });
});

test('fr_vlt_02_ac8_starter_vault_on_the_real_core', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('vlt02');
  const parent = join(base, 'Trezory');
  execFileSync('mkdir', ['-p', parent]);
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(join(base, 'support'), log, { TEGG_TEST_PICK_DIR: parent }));
    assert.ok(await shown(d, 'Create new vault', 10_000), 'chooser');
    await (await firstShown(d, 'Create new vault'))?.click();
    assert.ok(await shown(d, 'Starter vault'), 'Starter vault choice');
    await (await firstShown(d, 'Starter vault'))?.click();
    await (await firstShown(d, 'Vault name'))?.click(); // the radio keeps the focus after its click
    paste('Startovní');
    await (await firstShown(d, 'Choose…'))?.click();
    await sleep(500);
    await (await firstShown(d, 'Create'))?.click();
    const root = join(parent, 'Startovní');
    assert.ok(await waitFile(join(root, '.tegg/types/meeting.yml'), (t) => t !== null, 5000), 'starter types written');
    const want = [...Object.keys(tree(join(FX, 'new-empty'))), ...Object.keys(tree(join(FX, 'new-starter')))].filter((p) => !p.endsWith('/')).sort();
    const listed = () => Object.keys(tree(root)).filter((p) => !p.endsWith('/')).sort();
    for (let i = 0; i < 50 && listed().length < want.length; i++) await sleep(100); // the starter files are written one by one
    const files = listed();
    assert.deepEqual(files, want, 'exactly new-empty plus new-starter');
    await paletteRun(d, 'Go to type: Meetings');
    await (await firstShown(d, 'New Meeting'))?.click();
    await sleep(300);
    paste('Kick-off');
    press('enter');
    const m = await waitFile(join(root, 'Meetings/Kick-off.md'), (t) => t !== null, 3000);
    assert.match(m ?? '', /\ntype: meeting\n[\s\S]*---\n## Agenda\n\n## Notes\n\n## Decisions\n$/);
  } finally {
    await end(d);
  }
  rmSync(base, { recursive: true, force: true });
});

test('fr_edt_07_ac14_external_edit_shows_in_the_panel_without_a_write', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('edt07');
  const vault = typesCopy(base);
  const log = join(base, 'perf.jsonl');
  const porada = join(vault, 'Schůzky/2026-10-07 Porada.md');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(join(base, 'support'), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'note/Schůzky/2026-10-07 Porada.md' }));
    assert.ok(await waitMark(log, 'note-ready'), 'Porada shown');
    assert.ok(await shown(d, 'Místo'), 'the panel row Místo');
    const next = readFileSync(porada, 'utf8').replace('místo:\n', 'místo: Brno\n');
    const tmpFile = join(base, 'next.md');
    writeFileSync(tmpFile, next);
    renameSync(tmpFile, porada); // another program, atomic
    const after = tree(vault);
    const t0 = Date.now();
    assert.ok(await shown(d, 'Brno', 2000), `Brno shown within 2 s (${Date.now() - t0} ms)`);
    await sleep(1500);
    assert.deepEqual(changedPaths(after, tree(vault)), [], 'no write by the app');
    assert.equal(readFileSync(porada, 'utf8'), next);
  } finally {
    await end(d);
  }
  rmSync(base, { recursive: true, force: true });
});
