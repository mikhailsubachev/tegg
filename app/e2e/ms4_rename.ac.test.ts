// MS4 slice 4C real-app tests (L6, Appium mac2 on the built test app): docs/acceptance/rename.md FR-FMT-08 AC-5
// (commit renames, typing doesn't; route and Back), FR-LNK-03 AC-13 (only linking files change), AC-14 (one undo
// round trip), AC-16 (one skipped file listed and retried), FR-UX-07 AC-9 (non-blocking on the 500-backlink hub).
// FR-HIS-04 AC-6 is [MS4] with the first zip-backed client (4D-lite, D-396) and gets its L6 test there.
// Interface: docs/contracts/ms4-jobs.md §4, §7, §10 and ms3-shell.md §1, §6, §13.4 (TEGG_TEST, TEGG_APP_SUPPORT,
// TEGG_VAULT, TEGG_ROUTE, TEGG_PERF_LOG; marks `route-ready:<route>`, `note-ready`). Always TEGG_TEST=1 with a
// temporary Application Support and a temporary copy of the synthetic fixture (D-62). Vault checks by bytes, mtime and
// inode. Written from the ACs and the contracts only (D-61); the Appium helpers are copied from ms4_links.ac.test.ts.
//
// Prerequisites as in ms3_shell.ac.test.ts: `npm run app:build`, `npm run e2e:setup`, Accessibility permission.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { HUB, LINKS, NEW_HUB, copyVault, linker, linkerText, prepareHubVault } from './perf_rename.ts';
import { osa as guardedOsa } from './helpers/osa.ts';

const REPO = resolve(import.meta.dirname, '../..');
const APP = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app');
const EXE = join(APP, 'Contents/MacOS/tegg');
const BUNDLE_ID = 'app.tegg.desktop';
const PORT = Number(process.env.APPIUM_PORT ?? 4726);
const APPIUM_HOME = process.env.APPIUM_HOME ?? resolve(import.meta.dirname, '.appium');
const FX = join(REPO, 'tests/fixtures/vaults');
const MARK_TIMEOUT = 20_000;

const ALFA = 'Pages/Alfa.md';
const GAMA = 'Pages/Gama.md';
const ODKAZY = 'Pages/Odkazy.md';
const DEN = 'Daily/2026-10-14.md';
const GAMA_SET = [ALFA, GAMA, ODKAZY, 'Books/Vlastnosti.md', DEN, '_templates/Page/Page.md', 'Pages/Windows.md'].sort();

// ---------------------------------------------------------------- setup helpers (no AC assertions)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `tegg-ms4-4c-${name}-`));

/** A temp copy of tests/fixtures/vaults/rename (without its README.md) plus new-empty/.tegg. */
function renameCopy(base: string): string {
  const v = join(base, 'Přejmenování');
  cpSync(join(FX, 'rename'), v, { recursive: true, filter: (src) => relative(join(FX, 'rename'), src) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
function support(base: string, panel = false): string {
  const s = join(base, 'support');
  mkdirSync(s, { recursive: true });
  writeFileSync(join(s, 'ui-state.json'), JSON.stringify({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: panel, tab: 'backlinks' } }));
  return s;
}
const fixture = (rel: string) => readFileSync(join(FX, 'rename', rel), 'utf8');
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

type Entry = { sha: string; mtimeMs: number; ino: number } | 'dir';
function tree(root: string): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const st = lstatSync(p);
      const rel = relative(root, p).normalize('NFC');
      if (st.isDirectory()) { out[`${rel}/`] = 'dir'; walk(p); }
      else out[rel] = { sha: sha(readFileSync(p)), mtimeMs: st.mtimeMs, ino: st.ino };
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}
const changedPaths = (a: Record<string, Entry>, b: Record<string, Entry>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
const read = (vault: string, rel: string) => (existsSync(join(vault, rel)) ? readFileSync(join(vault, rel), 'utf8') : null);

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
async function waitFile(path: string, ok: (t: string | null) => boolean, ms: number): Promise<string | null> {
  const endAt = Date.now() + ms;
  let t: string | null = null;
  while (Date.now() < endAt) {
    t = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (ok(t)) return t;
    await sleep(25);
  }
  return t;
}

type Env = Record<string, string>;
function testEnv(appSupport: string, perfLog: string, extra: Env = {}): Env {
  // D-835: the tidy job (D-805) is off in real-app tests; this fixture keeps objects outside their type's folder.
  return { TEGG_TEST: '1', TEGG_APP_SUPPORT: appSupport, TEGG_PERF_LOG: perfLog, TEGG_TEST_TIDY: '0', ...extra };
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

const KEY: Record<string, number> = { a: 0, f: 3, v: 9, k: 40, o: 31, z: 6, enter: 36, escape: 53, tab: 48, lbracket: 33, down: 125 };
const osa = guardedOsa; // D-758: ⌘Q/⌘W only while Tegg is frontmost
function press(key: keyof typeof KEY | string, mods: ('command' | 'shift' | 'control' | 'option')[] = []) {
  osa(`tell application "System Events" to key code ${KEY[key]}${mods.length ? ` using {${mods.map((m) => `${m} down`).join(', ')}}` : ''}`);
}
function paste(text: string) {
  execFileSync('pbcopy', { input: text, env: { ...process.env, LANG: 'en_US.UTF-8' } });
  press('v', ['command']);
}
function typeAscii(text: string) {
  osa(`tell application "System Events" to keystroke ${JSON.stringify(text)}`);
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
async function containsShown(d: Driver, text: string, ms = 3000): Promise<boolean> {
  const t = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    // D-752: `value` only where it is text; CONTAINS on a number crashes the app (XCTest's agent).
    const els = await d.$$(`-ios predicate string:label CONTAINS "${t}" OR title CONTAINS "${t}" OR (elementType IN {48, 49, 52} AND value CONTAINS "${t}")`).catch(() => [] as any[]);
    for (const e of els) if (await e.isDisplayed().catch(() => false)) return true;
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
    const mark = `route-ready:note/${ALFA}`;
    const child = spawnApp(testEnv(support(base), log, { TEGG_VAULT: renameCopy(base), TEGG_ROUTE: `note/${ALFA}`, TEGG_EXIT_AFTER: mark }));
    const ok = await waitMark(log, mark);
    quitApp(child);
    await waitExit(child);
    rmSync(base, { recursive: true, force: true });
    return ok ? null : `the app does not open note/${ALFA} (route-ready mark missing)`;
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
  press('f', ['command', 'shift']); // D-760: ⇧⌘F and the Search page's Go to list replace ⌘O
  assert.ok(await shown(d, 'Search query'), `switcher for ${title}`);
  paste(title);
  await sleep(300);
  press('enter');
  await sleep(600);
}
/** Clicks the title field and selects its text. */
async function selectTitle(d: Driver) {
  const t = await firstShown(d, 'Title');
  assert.ok(t, 'the Title field');
  await t.click();
  press('a', ['command']);
}
/** Opens Alfa, replaces its title with Gama and commits with ↩; returns when Pages/Gama.md exists (or 1 s passed). */
async function renameAlfaToGama(d: Driver, vault: string, log: string) {
  assert.ok(await waitMark(log, `route-ready:note/${ALFA}`), 'Alfa shown');
  await selectTitle(d);
  paste('Gama');
  press('enter');
  const g = await waitFile(join(vault, GAMA), (t) => t !== null && /^title: Gama$/m.test(t), 1000);
  assert.ok(g, 'Pages/Gama.md with title: Gama within 1 s of ↩');
}

// ---------------------------------------------------------------- FR-FMT-08 AC-5

test('fr_fmt_08_ac5_commit_renames_typing_doesnt_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('fmt08ac5');
  const vault = renameCopy(base);
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${ALFA}` }));
    assert.ok(await waitMark(log, `route-ready:note/${ALFA}`), 'Alfa shown');
    await selectTitle(d);
    // `Gama` typed over 2 s.
    for (const ch of 'Gama') {
      typeAscii(ch);
      await sleep(500);
      assert.ok(existsSync(join(vault, ALFA)), 'Pages/Alfa.md keeps its path while typing');
    }
    await sleep(1500);
    const typing = changedPaths(before, tree(vault)).filter((p) => p !== ALFA);
    assert.deepEqual(typing, [], 'no other file is written while typing');
    const t0 = Date.now();
    press('enter');
    const g = await waitFile(join(vault, GAMA), (t) => t !== null && /^title: Gama$/m.test(t), 1000);
    assert.ok(g, `Pages/Gama.md with title: Gama within 1 s (${Date.now() - t0} ms)`);
    assert.ok(!existsSync(join(vault, ALFA)), 'Pages/Alfa.md is gone');
    const want = fixture(ALFA).replace('title: Alfa', 'title: Gama').replace('[[Alfa#Úvod]]', '[[Gama#Úvod]]').replace(/^modified: .*$/m, '');
    assert.equal(g!.replace(/^modified: .*$/m, ''), want, 'same id, title: Gama, the body unchanged except its self-link');
    assert.ok(await waitMark(log, `route-ready:note/${GAMA}`, 3000), 'the route becomes note/Pages/Gama.md');
    await openByTitle(d, 'Beta');
    press('lbracket', ['command']);
    await sleep(800);
    const title = await firstShown(d, 'Title');
    const value = title ? String(await title.getAttribute('value').catch(() => '')) : '';
    assert.equal(value.trim(), 'Gama', 'Back returns to Gama, not to a dead Pages/Alfa.md entry');
  } finally {
    await end(d);
  }
  rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------- FR-LNK-03 AC-13

test('fr_lnk_03_ac13_only_linking_files_change_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('lnk03ac13');
  const vault = renameCopy(base);
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${ALFA}` }));
    await renameAlfaToGama(d, vault, log);
    await waitFile(join(vault, 'Pages/Windows.md'), (t) => (t ?? '').includes('[[Gama]]'), 5000);
    await sleep(2000);
  } finally {
    await end(d);
  }
  const after = tree(vault);
  assert.deepEqual(changedPaths(before, after), GAMA_SET, 'exactly Alfa (renamed), Odkazy, Vlastnosti, Den, the template and Windows.md change');
  assert.deepEqual(Object.keys(after).filter((k) => k.includes('.tegg-tmp')), [], 'no .tegg-tmp remains');
  rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------- FR-LNK-03 AC-14

test('fr_lnk_03_ac14_one_undo_round_trip_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('lnk03ac14');
  const vault = renameCopy(base);
  const log = join(base, 'perf.jsonl');
  const pre = Object.fromEntries(GAMA_SET.map((p) => [p, read(vault, p)]));
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${ALFA}` }));
    await renameAlfaToGama(d, vault, log);
    await waitFile(join(vault, 'Pages/Windows.md'), (t) => (t ?? '').includes('[[Gama]]'), 5000);
    await paletteRun(d, 'Undo rename');
    const back = await waitFile(join(vault, ALFA), (t) => t === pre[ALFA], 5000);
    assert.equal(back, pre[ALFA], 'Pages/Alfa.md is back with its pre-rename bytes');
    await waitFile(join(vault, ODKAZY), (t) => t === pre[ODKAZY], 3000);
  } finally {
    await end(d);
  }
  const now = Object.fromEntries(GAMA_SET.map((p) => [p, read(vault, p)]));
  for (const p of GAMA_SET) assert.equal(sha(now[p] ?? ''), sha(pre[p] ?? ''), `${p}: bytes equal the pre-rename bytes (sha256)`);
  rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------- FR-LNK-03 AC-16

test('fr_lnk_03_ac16_one_skipped_file_listed_and_retried_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('lnk03ac16');
  const vault = renameCopy(base);
  const log = join(base, 'perf.jsonl');
  const daily = join(vault, 'Daily');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${ALFA}` }));
    // The Daily folder can't be written during the job, so Den is skipped (an I/O error of another app's lock).
    chmodSync(daily, 0o555);
    await renameAlfaToGama(d, vault, log);
    await waitFile(join(vault, 'Pages/Windows.md'), (t) => (t ?? '').includes('[[Gama]]'), 5000);
    assert.equal(read(vault, DEN), fixture(DEN), 'Den is not written');
    assert.ok(await shown(d, '1 note not updated', 5000), 'the status area shows "1 note not updated" (D-731)');
    const entry = await firstShown(d, '1 note not updated');
    await entry.click();
    assert.ok(await shown(d, 'Notes not updated', 3000), 'the non-modal list "Notes not updated"');
    // The row's texts sit too deep for XCUITest's predicate search; the page source has them (AC-Test-Change).
    assert.ok(await firstShown(d, 'Retry 2026-10-14'), 'a row for Den with its Retry button');
    assert.ok((await d.getPageSource()).includes(`value="${DEN}"`), 'a row with the path');
    chmodSync(daily, 0o755);
    const retry = await firstShown(d, 'Retry 2026-10-14');
    assert.ok(retry, 'button "Retry 2026-10-14"');
    await retry.click();
    const den = await waitFile(join(vault, DEN), (t) => (t ?? '').includes('[[Gama]]'), 5000);
    assert.equal(den, fixture(DEN).replace('[[Alfa]]', '[[Gama]]'), 'Retry rewrites only the link bytes');
    let gone = false;
    for (const endAt = Date.now() + 3000; !gone && Date.now() < endAt; await sleep(100)) gone = !(await firstShown(d, 'Retry 2026-10-14'));
    assert.ok(gone, 'the row is gone after a successful retry');
  } finally {
    try { chmodSync(daily, 0o755); } catch { /* gone */ }
    await end(d);
  }
  rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------- FR-UX-07 AC-9 on the hub

test('fr_ux_07_ac9_non_blocking_rename_on_the_500_backlink_hub_real_app', { timeout: 60 * 60_000 }, async () => {
  await ready();
  const base = tmp('ux07ac9');
  const prepared = prepareHubVault(base);
  assert.ok(prepared, 'reference vault (tools/gen-vault --seed 1 --small-images) with the hub');
  const vault = copyVault(prepared!, join(base, 'vault'));
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${HUB}` }));
    assert.ok(await waitMark(log, `route-ready:note/${HUB}`, 240_000), 'the hub is shown');
    await selectTitle(d);
    paste('Uzel');
    press('enter'); // ↩ commits and puts the caret in the body
    typeAscii(' psani behem prejmenovani');
    // The running state may be short on the reference machine; the L5 test holds the job to check it. Here: no dialog
    // ever, and the done state with Undo.
    let sawModal = false;
    const endAt = Date.now() + 60_000;
    let done = false;
    while (Date.now() < endAt && !done) {
      sawModal ||= (await d.$$('-ios predicate string:elementType == 61').catch(() => [] as any[])).length > 0; // XCUIElementTypeSheet
      done = await shown(d, 'Updated links in 500 notes', 200);
    }
    assert.equal(sawModal, false, 'no modal sheet while the job runs');
    assert.ok(done, 'the status "Updated links in 500 notes"');
    assert.ok(await shown(d, 'Undo', 1000), 'with Undo');
    const hub = await waitFile(join(vault, NEW_HUB), (t) => (t ?? '').includes('psani behem prejmenovani'), 5000);
    assert.ok((hub ?? '').includes('psani behem prejmenovani'), 'typing during the job is saved');
    let rewritten = 0;
    for (let i = 0; i < LINKS; i++) if (read(vault, linker(i)) === linkerText(i, 'Uzel')) rewritten++;
    assert.equal(rewritten, LINKS, 'every linking note rewritten');
  } finally {
    await end(d);
  }
  rmSync(base, { recursive: true, force: true });
});
