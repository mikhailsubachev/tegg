// MS4 slice 4B real-app tests (L6, Appium mac2 on the built test app): docs/acceptance/daily-notes.md FR-DLY-01 AC-1
// once (⌘D on the built app), FR-DLY-01 AC-7 once (the duplicate notice writes nothing: bytes, mtime, inode), FR-DLY-02
// AC-1 (opening and leaving virtual notes leaves the vault unchanged), FR-DLY-02 AC-4 (⌘Q within 50 ms of the first
// keystroke writes the file once before exit), FR-DLY-04 AC-4 once (the file holds no section text). Interface:
// docs/contracts/ms3-shell.md §1, §6, §13.4 and docs/contracts/ms4-daily.md §4.1, §7 (TEGG_TEST, TEGG_APP_SUPPORT,
// TEGG_VAULT, TEGG_ROUTE, TEGG_PERF_LOG, TEGG_EXIT_AFTER; marks `route-ready:<route>`, `note-saved`). Written from the
// ACs and contracts only (D-61). Always TEGG_TEST=1 with a temporary Application Support and a temporary copy of the
// synthetic fixture (D-62). The helpers are copied from ms4_links.ac.test.ts (existing AC test files are not changed,
// TS-I3).
//
// The clock: L6 uses the system clock (ms3-shell §13.6; no clock injection exists for the built app, see the
// red-commit report), so "today" is computed here from Date.now() in the zone given to the app as `TZ`; (TZ) runs use
// TZ=Europe/Prague and TZ=America/Los_Angeles.
//
// Prerequisites as in ms3_shell.ac.test.ts: `npm run app:build`, `npm run e2e:setup`, Accessibility permission.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `tegg-ms4-4b-${name}-`));

/** A temp copy of tests/fixtures/vaults/daily (without its README.md) plus new-empty/.tegg. */
function dailyCopy(base: string): string {
  const v = join(base, 'Deník');
  cpSync(join(FX, 'daily'), v, { recursive: true, filter: (src) => relative(join(FX, 'daily'), src) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
/** Application Support with the Context panel closed (ui-state.json, ms3-shell §2). */
function support(base: string): string {
  const s = join(base, 'support');
  mkdirSync(s, { recursive: true });
  writeFileSync(join(s, 'ui-state.json'), JSON.stringify({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' } }));
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

const KEY: Record<string, number> = { a: 0, d: 2, q: 12, v: 9, k: 40, o: 31, n: 45, backslash: 42, lbracket: 33, enter: 36, escape: 53, tab: 48, space: 49, down: 125, end: 119, left: 123, right: 124 };
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


// ---------------------------------------------------------------- daily helpers (no AC assertions)
const ZONES = ['Europe/Prague', 'America/Los_Angeles'] as const;
/** Today's local date in `tz` (FR-DLY-01 AC-2: midnight is local). */
const todayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now());
function typeText(text: string) {
  osa(`tell application "System Events" to keystroke ${JSON.stringify(text)}`);
}
/** Paths under Daily/ (names NFC), for "no temp file" checks. */
function dailyDir(vault: string): string[] {
  const d = join(vault, 'Daily');
  return existsSync(d) ? readdirSync(d).map((n) => n.normalize('NFC')).sort() : [];
}
const FIXTURE_DAILY = ['2026-10-01.md', '2026-10-07.md', '2026-10-09.md', '2026-10-12 (2).md', '2026-10-12.md', '2026-10-16.md'];

// ---------------------------------------------------------------- preflight (fails fast on an assertion)
let pre: Promise<string | null> | undefined;
function preflight(): Promise<string | null> {
  pre ??= (async () => {
    if (!existsSync(EXE)) return `app not built: ${EXE} (cd app && npm run app:build)`;
    const base = tmp('preflight');
    const log = join(base, 'perf.jsonl');
    const mark = 'route-ready:daily/2026-10-20';
    const child = spawnApp(testEnv(support(base), log, { TEGG_VAULT: dailyCopy(base), TEGG_ROUTE: 'daily/2026-10-20', TEGG_EXIT_AFTER: mark }));
    const ok = await waitMark(log, mark);
    quitApp(child);
    await waitExit(child);
    rmSync(base, { recursive: true, force: true });
    return ok ? null : 'the app does not open daily/2026-10-20 (route-ready mark missing)';
  })();
  return pre;
}
async function ready() {
  const why = await preflight();
  assert.equal(why, null, why ?? '');
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

// ---------------------------------------------------------------- tests

for (const tz of ZONES) {
  test(`fr_dly_01_ac1_cmd_d_opens_today_on_the_built_app_${tz.replace(/\W/g, '_')}`, { timeout: 300_000 }, async () => {
    await ready();
    const base = tmp('dly01ac1');
    const vault = dailyCopy(base);
    const log = join(base, 'perf.jsonl');
    const before = tree(vault);
    const today = todayIn(tz);
    let d: Driver | undefined;
    try {
      d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'note/Pages/Zmínky.md', TZ: tz }));
      assert.ok(await waitMark(log, 'route-ready:note/Pages/Zmínky.md'), 'Zmínky shown');
      press('d', ['command']);
      assert.ok(await waitMark(log, `route-ready:daily/${today}`, 5000), `⌘D opens daily/${today} (the local date in ${tz})`);
      assert.ok(await shown(d, today, 3000), `the title field shows ${today}`);
      press('lbracket', ['command']);
      await sleep(500);
    } finally {
      await end(d);
    }
    assert.deepEqual(changedPaths(before, tree(vault)), [], '⌘D writes nothing (bytes, mtime, inode)');
    rmSync(base, { recursive: true, force: true });
  });
}

test('fr_dly_01_ac7_the_duplicate_notice_writes_nothing', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('dly01ac7');
  const vault = dailyCopy(base);
  const log = join(base, 'perf.jsonl');
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'daily/2026-10-12' }));
    assert.ok(await waitMark(log, 'route-ready:daily/2026-10-12'), 'daily/2026-10-12 shown');
    assert.ok(await shown(d, 'Other notes for this date', 3000), 'the D-319 notice');
    const l = await firstShown(d, 'Daily/2026-10-12.md');
    assert.ok(l, 'link Daily/2026-10-12.md');
    await l.click();
    assert.ok(await waitMark(log, 'route-ready:note/Daily/2026-10-12.md', 5000), 'opens note/Daily/2026-10-12.md');
    const dup = await firstShown(d, 'Duplicate titles');
    assert.ok(dup, 'link Duplicate titles');
    await dup.click();
    await sleep(800);
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(before, tree(vault)), [], 'both files keep bytes, mtime and inode; nothing merged, renamed or deleted');
  rmSync(base, { recursive: true, force: true });
});

for (const tz of ZONES) {
  test(`fr_dly_02_ac1_opening_and_leaving_virtual_notes_leaves_the_vault_unchanged_${tz.replace(/\W/g, '_')}`, { timeout: 300_000 }, async () => {
    await ready();
    const base = tmp('dly02ac1');
    const vault = dailyCopy(base);
    const log = join(base, 'perf.jsonl');
    const before = tree(vault);
    let d: Driver | undefined;
    try {
      d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'daily/2026-10-20', TZ: tz }));
      assert.ok(await waitMark(log, 'route-ready:daily/2026-10-20'), 'virtual 20 Oct shown');
      assert.ok(await shown(d, 'Not saved yet. Start typing to create this note.', 3000), 'the virtual marker');
      press('right', ['option', 'command']);
      press('left', ['option', 'command']);
      press('d', ['command']);
      await sleep(500);
      const pick = await firstShown(d, 'Pick date');
      assert.ok(pick, 'button Pick date');
      await pick.click();
      assert.ok(await shown(d, 'Calendar', 2000), 'the calendar');
      press('escape');
      press('backslash', ['command']);
      await sleep(300);
      press('backslash', ['command']);
      press('lbracket', ['command']);
      await sleep(500);
    } finally {
      await end(d);
    }
    assert.deepEqual(dailyDir(vault), FIXTURE_DAILY, 'no new file and no temp file in Daily/');
    assert.deepEqual(changedPaths(before, tree(vault)), [], "the vault's file list and every file's bytes, mtime and inode are unchanged");
    rmSync(base, { recursive: true, force: true });
  });
}

test('fr_dly_02_ac4_cmd_q_right_after_the_first_keystroke_writes_the_file_once', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('dly02ac4');
  const vault = dailyCopy(base);
  const log = join(base, 'perf.jsonl');
  const tz = 'Europe/Prague';
  const today = todayIn(tz);
  const before = tree(vault);
  const child = spawnApp(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: `daily/${today}`, TZ: tz }));
  try {
    assert.ok(await waitMark(log, `route-ready:daily/${today}`), `daily/${today} shown`);
    typeText('a');
    press('q', ['command']);
    await waitExit(child, 10_000);
    assert.ok(child.exitCode !== null || child.signalCode !== null, 'the app quit');
  } finally {
    quitApp(child);
  }
  const added = changedPaths(before, tree(vault));
  const name = added.find((p) => p.startsWith('Daily/'));
  assert.deepEqual(added.length, 1, `exactly one file written: ${added.join(', ')}`);
  const t = name ? readFileSync(join(vault, name), 'utf8') : '';
  assert.match(t, new RegExp(`^date: ${today}$`, 'm'), 'its date');
  assert.match(t, /^review: unreviewed$/m, 'the AC-2 frontmatter');
  assert.ok(/\ba\s*$/.test(t) || t.includes('a\n'), 'with the typed character');
  rmSync(base, { recursive: true, force: true });
});

test('fr_dly_04_ac4_the_daily_file_never_contains_section_text', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('dly04ac4');
  const vault = dailyCopy(base);
  const log = join(base, 'perf.jsonl');
  const tz = 'Europe/Prague';
  const today = todayIn(tz);
  let d: Driver | undefined;
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: `daily/${today}`, TZ: tz }));
    assert.ok(await waitMark(log, `route-ready:daily/${today}`), `daily/${today} shown`);
    assert.ok(await shown(d, 'Quick Notes', 3000) && await shown(d, 'Tasks due', 1000), 'the sections are shown');
    typeText('Žluťoučký kůň');
    const file = join(vault, 'Daily', `${today}.md`);
    const t1 = await waitFile(file, (x) => !!x?.includes('Žluťoučký kůň'), 5000);
    assert.ok(t1, 'the first write');
    typeText(' úpěl');
    const t2 = await waitFile(file, (x) => !!x?.includes('kůň úpěl'), 5000);
    assert.ok(t2, 'the next autosave');
    for (const s of ['Quick Notes', 'Tasks due', 'Coming in MS5', 'Nothing yet', 'Created', 'Modified']) {
      assert.ok(!t2!.replace(/^---\n[\s\S]*?\n---\n/, '').includes(s), `no section text ${JSON.stringify(s)} in the body`);
    }
  } finally {
    await end(d);
  }
  rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------- FR-DLY-02 AC-2 on the real core (L6 once)
// Added with `AC-Test-Change: L6 test for FR-DLY-02 AC-2; approved-by: owner`; the tests above are unchanged. The clock
// is the system clock (D-351), so `created`/`modified` are checked against the time of typing and the zone's offset at
// that instant instead of the L4/L5 test clock `2026-10-14T12:00:00+02:00`. Atomicity is observed from another process
// (e2e/helpers/external.ts `poll`): a reader never sees a partial `Daily/2026-10-14.md`.
const EXTERNAL = resolve(import.meta.dirname, 'helpers/external.ts');
/** `+HH:MM` / `-HH:MM` of `tz` at `ms`. */
function offsetIn(tz: string, ms: number): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(ms).find((p) => p.type === 'timeZoneName')!.value;
  return name === 'GMT' ? '+00:00' : name.replace('GMT', '');
}
const FIRST_WRITE = /^---\nid: [0-9A-HJKMNP-TV-Z]{26}\ntype: daily-note\ntitle: "2026-10-14"\ndate: 2026-10-14\ntags: \[deník\]\nreview: unreviewed\ncreated: (\S+)\nmodified: (\S+)\n---\n([\s\S]*)$/;
const TEMPLATE_BODY = '# Deník 14. 10. 2026\n\nVčera: [[2026-10-13]] · Zítra: [[2026-10-15]] · Dnes: 2026-10-14 · {{time}}\n\n## Poznámky';
/** The typed text the body holds after the expanded template (D-322: where the caret was, the end of the body). */
function typedPart(text: string): string | null {
  const m = FIRST_WRITE.exec(text);
  if (!m || !m[3].startsWith(TEMPLATE_BODY)) return null;
  return m[3].slice(TEMPLATE_BODY.length).replace(/^\n\n/, '').replace(/\n$/, '');
}

for (const tz of ZONES) {
  test(`fr_dly_02_ac2_first_keystroke_writes_exactly_one_file_on_the_real_core_${tz.replace(/\W/g, '_')}`, { timeout: 300_000 }, async () => {
    await ready();
    const base = tmp('dly02ac2');
    const vault = dailyCopy(base);
    const log = join(base, 'perf.jsonl');
    const reads = join(base, 'reads.jsonl');
    const rel = 'Daily/2026-10-14.md';
    const file = join(vault, rel);
    const before = tree(vault);
    let d: Driver | undefined;
    let poller: ChildProcess | undefined;
    let first = '';
    let t0 = 0;
    let t1 = 0;
    try {
      d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'daily/2026-10-14', TZ: tz }));
      assert.ok(await waitMark(log, 'route-ready:daily/2026-10-14'), 'virtual daily/2026-10-14 shown');
      assert.ok(await shown(d, 'Not saved yet. Start typing to create this note.', 3000), 'the virtual marker');
      assert.equal(existsSync(file), false, 'no file before the first keystroke');
      poller = spawn(process.execPath, [EXTERNAL, 'poll', file, '2', '8000', reads], { stdio: 'ignore' });
      await sleep(300);
      t0 = Date.now();
      typeText('Dnes');
      const t = await waitFile(file, (x) => typedPart(x ?? '') === 'Dnes', 5000);
      t1 = Date.now();
      assert.ok(t !== null, `${rel} written`);
      first = t!;
      assert.ok(await shown(d, 'Saved', 3000), 'Save state Saved');
      assert.ok(await gone(d, 'Not saved yet. Start typing to create this note.', 2000), 'the virtual marker disappears');
      await new Promise((r) => poller!.on('exit', r));
      poller = undefined;
      // Further typing autosaves into the same file (editor FR-EDT-09).
      typeText('!');
      const t2 = await waitFile(file, (x) => typedPart(x ?? '') === 'Dnes!', 5000);
      assert.equal(typedPart(t2 ?? ''), 'Dnes!', 'the next keystroke is saved into the same file');
      await sleep(1000);
    } finally {
      poller?.kill('SIGTERM');
      await end(d);
    }
    // Frontmatter in the D-324 order, `title` quoted, `date` bare (FR-FMT-11), template key, review, created, modified.
    const m = FIRST_WRITE.exec(first);
    assert.ok(m, `frontmatter in the D-324 order:\n${first}`);
    assert.equal(typedPart(first), 'Dnes', 'the expanded template body (FR-DLY-06 AC-1) with the typed text at the caret (D-322)');
    for (const [key, v] of [['created', m![1]], ['modified', m![2]]] as const) {
      assert.match(v, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/, `${key} is ISO 8601 with offset`);
      const at = Date.parse(v);
      assert.ok(at >= Math.floor(t0 / 1000) * 1000 - 1000 && at <= t1 + 1000, `${key} ${v} is the clock at the keystroke`);
      assert.equal(v.slice(-6), offsetIn(tz, at), `${key} carries the ${tz} offset`);
    }
    // Exactly one file; no temp file left in Daily/ and nothing else changed.
    assert.deepEqual(dailyDir(vault), [...FIXTURE_DAILY, '2026-10-14.md'].sort(), 'Daily/ gains exactly 2026-10-14.md and no temp file');
    assert.deepEqual(changedPaths(before, tree(vault)), [rel], 'no other vault file changes (bytes, mtime, inode)');
    // Create-exclusive temp + rename (FR-SYN-02): every read by another process is no file or a complete one.
    const seen = existsSync(reads) ? readFileSync(reads, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { text?: string; error?: string }) : [];
    assert.ok(seen.some((r) => r.text !== undefined), 'the reader saw the file');
    const bad = seen.filter((r) => (r.error !== undefined ? !r.error.includes('ENOENT') : !['D', 'Dn', 'Dne', 'Dnes'].includes(typedPart(r.text ?? '') ?? '')));
    assert.deepEqual(bad, [], 'no partial file was ever visible');
    rmSync(base, { recursive: true, force: true });
  });
}
async function gone(d: Driver, label: string, ms = 2000): Promise<boolean> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    if (!(await firstShown(d, label))) return true;
    await sleep(100);
  }
  return false;
}
