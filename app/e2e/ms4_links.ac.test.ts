// MS4 slice 4A real-app tests (L6, Appium mac2 on the built test app): docs/acceptance/backlinks.md FR-SYN-06 AC-9
// (a keyboard tour writes nothing, then one Create adds exactly one file), FR-LNK-04 AC-5 once (bytes, mtime and inode of
// the other files) and AC-12 once (opening and closing offers writes nothing), FR-LNK-01 AC-10 once (an own link shows
// in the target's panel). Interface: docs/contracts/ms3-shell.md §1, §6, §13.4 and docs/contracts/ms4-links.md §4, §5
// (TEGG_TEST, TEGG_APP_SUPPORT, TEGG_VAULT, TEGG_ROUTE, TEGG_PERF_LOG; marks `route-ready:<route>`, `note-ready`;
// `ui-state.json` in Application Support). Written from the ACs and contracts only (D-61). Always TEGG_TEST=1 with a
// temporary Application Support and a temporary copy of the synthetic fixture (D-62). The helpers are copied from
// ms3_types_followup.ac.test.ts (existing AC test files are not changed, TS-I3).
//
// Prerequisites as in ms3_shell.ac.test.ts: `npm run app:build`, `npm run e2e:setup`, Accessibility permission.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `tegg-ms4-4a-${name}-`));

/** A temp copy of tests/fixtures/vaults/backlinks (without its README.md) plus new-empty/.tegg. */
function linksCopy(base: string): string {
  const v = join(base, 'Odkazy');
  cpSync(join(FX, 'backlinks'), v, { recursive: true, filter: (src) => relative(join(FX, 'backlinks'), src) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
/** Application Support with the Context panel open on Backlinks (ui-state.json, ms3-shell §2). */
function support(base: string): string {
  const s = join(base, 'support');
  mkdirSync(s, { recursive: true });
  writeFileSync(join(s, 'ui-state.json'), JSON.stringify({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: true, tab: 'backlinks' } }));
  return s;
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
const changedPaths = (a: Record<string, Entry>, b: Record<string, Entry>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();

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

const KEY: Record<string, number> = { a: 0, v: 9, k: 40, o: 31, n: 45, backslash: 42, lbracket: 33, enter: 36, escape: 53, tab: 48, space: 49, down: 125, end: 119 };
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
async function firstShown(d: Driver, label: string): Promise<any | null> {
  const l = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const q = `(label == "${l}" OR title == "${l}" OR value == "${l}")`;
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
function preflight(): Promise<string | null> {
  pre ??= (async () => {
    if (!existsSync(EXE)) return `app not built: ${EXE} (cd app && npm run app:build)`;
    const base = tmp('preflight');
    const log = join(base, 'perf.jsonl');
    const mark = 'route-ready:note/Pages/Cíl.md';
    const child = spawnApp(testEnv(support(base), log, { TEGG_VAULT: linksCopy(base), TEGG_ROUTE: 'note/Pages/Cíl.md', TEGG_EXIT_AFTER: mark }));
    const ok = await waitMark(log, mark);
    quitApp(child);
    await waitExit(child);
    rmSync(base, { recursive: true, force: true });
    return ok ? null : 'the app does not open note/Pages/Cíl.md (route-ready mark missing)';
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
async function openByTitle(d: Driver, title: string) {
  press('o', ['command']);
  assert.ok(await shown(d, 'Quick switcher'), `switcher for ${title}`);
  paste(title);
  await sleep(300);
  press('enter');
  await sleep(600);
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

const TITLES = [
  'Cíl', 'Odkazy v textu', 'Rozbité odkazy', 'Markdown odkaz', 'Neplatná hlavička', 'Rychlá poznámka', '2026-10-07', '2026-10-08 Porada',
  'Starší porada', 'Porada s chybou', 'Bez typu s vlastností', 'Jana Nováková', 'Osamělá', 'Dvojník', 'Rychlý dvojník', 'Z rychlých', 'Ze stránek', 'Z kořene',
  'Senior Product Manager', 'SPM Alfa', 'SPM velkými', 'Odkaz na SPM', 'Čtení', 'Čtení podruhé', 'Cteni', 'Plán', 'Další rozbitý',
];
// `![[Chybí]]` is an R5 embed placeholder, not a chip (AP point in the red-commit report).
const BROKEN = ['Neexistuje', 'neexistuje', 'Neexistuje › Kapitola', 'jiný popis', 'Q3: plán?', 'Projekty/Alfa', 'Osoby/Eva Malá', 'Šablona', 'Smazaná'];

// ---------------------------------------------------------------- tests

test('fr_syn_06_ac9_keyboard_tour_writes_nothing_then_one_create', { timeout: 900_000 }, async () => {
  await ready();
  const base = tmp('syn06ac9');
  const vault = linksCopy(base);
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  let afterTour: Record<string, Entry> = {};
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'note/Pages/Cíl.md' }));
    assert.ok(await waitMark(log, 'route-ready:note/Pages/Cíl.md'), 'Cíl shown');
    assert.ok(await shown(d, '9 objects link here', 5000), "Cíl's Backlinks panel (FR-LNK-01 AC-1)");
    // Every fixture note opened with the panel open; every Show <n> more on Cíl.
    for (const t of TITLES) await openByTitle(d, t);
    await openByTitle(d, 'Cíl');
    for (let i = 0; i < 2; i++) {
      const more = await firstShown(d, 'Show 2 more');
      if (more) await more.click();
    }
    // Every group collapsed and expanded with the keyboard (⏎ on its header).
    for (const g of ['Pages, 4', 'Quick Notes, 1', 'Daily Notes, 1', 'Schůzky, 2', 'neznámý, 1']) {
      const h = await firstShown(d, g);
      assert.ok(h, `group header ${g}`);
      await h.click();
      await h.click();
    }
    // Every excerpt of Cíl's panel followed and Back.
    for (const title of ['Odkazy v textu', 'Rozbité odkazy', 'Markdown odkaz', 'Neplatná hlavička', 'Rychlá poznámka']) {
      const e = await firstShown(d, title);
      if (e) { await e.click(); await sleep(500); press('lbracket', ['command']); await sleep(500); }
    }
    await paletteRun(d, 'Go to Broken links');
    assert.ok(await shown(d, 'Broken links', 5000), 'Broken links page');
    await paletteRun(d, 'Go to Duplicate titles');
    assert.ok(await shown(d, 'Duplicate titles', 5000), 'Duplicate titles page');
    for (const q of ['senior', 'čtení']) {
      press('o', ['command']);
      paste(q);
      await sleep(500);
      press('escape');
    }
    // Every broken chip's offer opened and cancelled (FR-LNK-04 AC-12).
    await openByTitle(d, 'Rozbité odkazy');
    for (const label of BROKEN) {
      // A subpath chip may read `Neexistuje › Kapitola` (D-156) or `Neexistuje#Kapitola` in the editor.
      const c = (await firstShown(d, label)) ?? (label.includes(' › ') ? await firstShown(d, label.replace(' › ', '#')) : null);
      assert.ok(c, `broken chip ${label}`);
      await c.click();
      assert.ok(await shown(d, 'Create note', 2000), `offer for ${label}`);
      press('escape');
      await sleep(200);
    }
    afterTour = tree(vault);
    assert.deepEqual(changedPaths(before, afterTour), [], 'the tour leaves every file’s bytes, mtime and inode unchanged and creates nothing');
    // One Create "Neexistuje" (FR-LNK-04 AC-5 once).
    const c = await firstShown(d, 'Neexistuje');
    assert.ok(c, 'chip Neexistuje');
    await c.click();
    const create = await firstShown(d, 'Create "Neexistuje"');
    assert.ok(create, 'button Create "Neexistuje"');
    await create.click();
    const t = await waitFile(join(vault, 'Quick Notes/Neexistuje.md'), (x) => x !== null, 3000);
    assert.ok(t && /^title: Neexistuje$/m.test(t) && /^type: quick-note$/m.test(t), 'Quick Notes/Neexistuje.md written');
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(afterTour, tree(vault)), ['Quick Notes/Neexistuje.md'], 'exactly one file added; Rozbité odkazy and Další rozbitý keep bytes, mtime and inode');
  rmSync(base, { recursive: true, force: true });
});

test('fr_lnk_01_ac10_an_own_link_shows_in_the_targets_panel', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('lnk01ac10');
  const vault = linksCopy(base);
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'note/Pages/Osamělá.md' }));
    assert.ok(await waitMark(log, 'route-ready:note/Pages/Osamělá.md'), 'Osamělá shown');
    assert.ok(await shown(d, 'No backlinks yet', 5000), "Osamělá's empty panel (FR-LNK-01 AC-13)");
    press('end', ['command']);
    paste(' [[Cíl');
    assert.ok(await shown(d, 'Link suggestions', 3000), 'Link suggestions');
    press('enter');
    const t = await waitFile(join(vault, 'Pages/Osamělá.md'), (x) => (x ?? '').includes('[[Cíl]]'), 5000);
    assert.ok((t ?? '').includes('[[Cíl]]'), 'saved with the link');
    await openByTitle(d, 'Cíl');
    assert.ok(await shown(d, '10 objects link here', 1000), "Osamělá in Cíl's panel within 1 s");
    assert.ok(await firstShown(d, 'Osamělá'), 'entry Osamělá');
  } finally {
    await end(d);
  }
  rmSync(base, { recursive: true, force: true });
});
