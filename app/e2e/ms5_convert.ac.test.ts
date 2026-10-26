// MS5 slice 5A-2 real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/conversion.md
// FR-CNV-03 AC-7 (killed with SIGKILL at the test hook points `after-create` and `during-source-save`, cycles), AC-8
// (⇧⌘T ⏎ writes exactly two files within 1.2 s, atomically); FR-CNV-05 AC-2 once (the card's checkbox writes only the
// task), AC-5 (a body edit in the card is an atomic write of the task only); FR-CNV-08 AC-2 (Don't ask again survives a
// relaunch, stored in Application Support), AC-4 once (the object keeps bytes, mtime and inode); FR-SYN-06 AC-23 (a
// conversion writes exactly two files; opening R50 and browsing the Task cards write nothing; by bytes, mtime, inode).
// Interface: docs/contracts/ms3-shell.md §1, §6 (TEGG_TEST, TEGG_APP_SUPPORT, TEGG_VAULT, TEGG_ROUTE, TEGG_PERF_LOG,
// TEGG_EXIT_AFTER; `route-ready:<route>`, `note-ready`), docs/contracts/ms5-tasks.md §10 D-504 (TEGG_NOW) and §11.6
// (TEGG_TEST_HOLD=after-create | during-source-save:<vault path>, marks `hold:after-create`, `hold:during-source-save`),
// R50/R52/R54 accessible names. Written from the ACs and contracts only (D-61). Always TEGG_TEST=1 with a temporary
// Application Support and a temporary copy of the synthetic fixture tests/fixtures/vaults/tasks (+ new-empty/.tegg)
// (D-62). The helpers are copied from ms5_tasks.ac.test.ts and ms4_embeds.ac.test.ts (existing AC test files are not
// changed, TS-I3).
//
// The clock: TEGG_NOW is set to the tasks.md test clock (D-504); `modified`, `created` and `completed` are still checked
// only for their form (ISO 8601 with offset) and the id as a ULID (AP-345 rule; exact values are L5).
// FR-SYN-02 AC-4 deletes a leftover `.tegg-tmp` on the next vault open only when it is older than one minute, so after a
// kill the test ages any leftover temp file by two minutes (utimes) before the restart instead of waiting.
//
// Prerequisites as in ms3_shell.ac.test.ts: `npm run app:build`, `npm run e2e:setup`, Accessibility permission.
// TEGG_KILL_CYCLES (default 10) sets the FR-CNV-03 AC-7 cycle count (the milestone gate runs 10).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { osa as guardedOsa } from './helpers/osa.ts';

const REPO = resolve(import.meta.dirname, '../..');
const APP = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app');
const EXE = join(APP, 'Contents/MacOS/tegg');
const BUNDLE_ID = 'app.tegg.desktop';
const PORT = Number(process.env.APPIUM_PORT ?? 4728);
const APPIUM_HOME = process.env.APPIUM_HOME ?? resolve(import.meta.dirname, '.appium');
const FX = join(REPO, 'tests/fixtures/vaults');
const MARK_TIMEOUT = 20_000;
const TZ = 'Europe/Prague';
const NOW = '2026-10-14T12:00:00+02:00';

const BLOKY = 'Pages/Bloky.md';
const PORADA = 'Pages/Porada.md';
const T01 = 'Tasks/Zavolat Janě.md';
const ZAVOLAT = 'Zavolat do servisu kvůli kolu';
const ZAVOLAT_PARA = `${ZAVOLAT}\na domluvit termín.\n`;
const TASK = `Tasks/${ZAVOLAT}.md`;

// ---------------------------------------------------------------- setup helpers (no AC assertions)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `tegg-ms5-5a2-${name}-`));

/** A temp copy of tests/fixtures/vaults/tasks (without its README.md) plus new-empty/.tegg. `edit` changes files. */
function tasksCopy(base: string, edit?: (v: string) => void): string {
  const v = join(base, 'Úkoly');
  cpSync(join(FX, 'tasks'), v, { recursive: true, filter: (src) => relative(join(FX, 'tasks'), src) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  edit?.(v);
  return v;
}
function support(base: string, convert?: Record<string, unknown>): string {
  const s = join(base, 'support');
  mkdirSync(s, { recursive: true });
  writeFileSync(join(s, 'ui-state.json'), JSON.stringify({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, ...(convert ? { convert } : {}) }));
  return s;
}
const fx = (rel: string) => readFileSync(join(FX, 'tasks', rel), 'utf8');
const read = (vault: string, rel: string) => readFileSync(join(vault, rel), 'utf8');
const bodyOf = (t: string) => t.replace(/^---\n[\s\S]*?\n---\n/, '');

/** Bloky right after a conversion (FR-CNV-03 AC-2) and the task it creates (FR-CNV-03 AC-1), as files on disk. */
const PRE_BLOKY = () => fx(BLOKY).replace(ZAVOLAT_PARA, `![[${ZAVOLAT}]]\n`);
const PRE_TASK = `---\nid: 01JB5A0000000000000000W401\ntype: task\ntitle: ${ZAVOLAT}\nstatus: To do\nsource: "[[Bloky]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\na domluvit termín.\n`;
function preConverted(v: string) {
  writeFileSync(join(v, BLOKY), PRE_BLOKY());
  writeFileSync(join(v, TASK), PRE_TASK);
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
const inode = (t: Record<string, Entry>, p: string) => { const e = t[p.normalize('NFC')]; return e && e !== 'dir' ? e.ino : null; };
const tempFiles = (root: string) => Object.keys(tree(root)).filter((p) => p.includes('.tegg-tmp'));
/** Ages every leftover temp file by two minutes, so the next vault open's FR-SYN-02 AC-4 cleanup applies. */
function ageTempFiles(root: string) {
  const old = new Date(Date.now() - 120_000);
  for (const p of tempFiles(root)) utimesSync(join(root, p), old, old);
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
async function waitFile(path: string, ok: (t: string | null) => boolean, ms: number): Promise<string | null> {
  const endAt = Date.now() + ms;
  let t: string | null = null;
  while (Date.now() < endAt) {
    t = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (ok(t)) return t;
    await sleep(10);
  }
  return t;
}

type Env = Record<string, string>;
function testEnv(appSupport: string, perfLog: string, extra: Env = {}): Env {
  return { TEGG_TEST: '1', TEGG_APP_SUPPORT: appSupport, TEGG_PERF_LOG: perfLog, TZ, TEGG_NOW: NOW, ...extra };
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

// System Events key codes.
const KEY: Record<string, number> = {
  a: 0, f: 3, d: 2, k: 40, o: 31, t: 17, v: 9, x: 7, z: 6, enter: 36, escape: 53, tab: 48, space: 49, delete: 51, down: 125, up: 126, left: 123, right: 124,
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
// A predicate string literal can't hold a raw line break (mac2 refuses to parse it): written as `\n`.
const q = (label: string) => label.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
async function allShown(d: Driver, predicate: string): Promise<any[]> {
  const out: any[] = [];
  for (const e of await d.$$(`-ios predicate string:${predicate}`).catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) out.push(e);
  return out;
}
async function firstShown(d: Driver, label: string): Promise<any | null> {
  const l = q(label);
  const pred = `(label == "${l}" OR title == "${l}" OR value == "${l}")`;
  for (const sel of [`elementType IN {9, 10, 12, 17, 41, 42, 49, 80} AND ${pred}`, pred]) {
    const all = await allShown(d, sel);
    if (all.length) return all[0];
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
async function need(d: Driver, label: string, ms = 3000): Promise<any> {
  const endAt = Date.now() + ms;
  let e = await firstShown(d, label);
  while (!e && Date.now() < endAt) { await sleep(100); e = await firstShown(d, label); }
  assert.ok(e, `"${label}" is shown`);
  return e;
}
/** Puts the caret at the end of the first shown text among `labels` (click, then ⌘→). */
async function caretAtEnd(d: Driver, ...labels: string[]) {
  for (const l of labels) {
    const e = await firstShown(d, l);
    if (e) {
      await e.click().catch(() => {});
      await sleep(200);
      press('right', ['command']);
      await sleep(100);
      return;
    }
  }
  assert.fail(`none of ${JSON.stringify(labels)} is shown`);
}
async function openBySwitcher(d: Driver, title: string) {
  press('f', ['command', 'shift']); // D-760: ⇧⌘F and the Search page's Go to list replace ⌘O
  assert.ok(await shown(d, 'Search query'), `switcher for ${title}`);
  paste(title);
  await sleep(300);
  press('enter');
  await sleep(800);
}
const ZAVOLAT_LABELS = [ZAVOLAT, 'a domluvit termín.', `${ZAVOLAT}\na domluvit termín.`, `${ZAVOLAT} a domluvit termín.`];
/** ⇧⌘T on the Zavolat paragraph of Bloky, then ⏎ in R50 (FR-CNV-01 AC-3). Returns when ⏎ was sent. */
/** Converts the paragraph with ⇧⌘T ⏎; returns when ⏎ was pressed (FR-CNV-03 AC-8 times the conversion from there). */
async function convertZavolat(d: Driver): Promise<number> {
  assert.ok(await shown(d, 'Note body', 5000), 'the editor');
  await caretAtEnd(d, ...ZAVOLAT_LABELS);
  press('t', ['command', 'shift']);
  assert.ok(await shown(d, 'Turn into object', 2000), 'R50 (dialog "Turn into object")');
  press('enter');
  return Date.now();
}

// ---------------------------------------------------------------- preflight (fails fast on an assertion)
let pre: Promise<string | null> | undefined;
function preflight(): Promise<string | null> {
  pre ??= (async () => {
    if (!existsSync(EXE)) return `app not built: ${EXE} (cd app && npm run app:build)`;
    if (!existsSync(join(FX, 'tasks', BLOKY))) return 'fixture tests/fixtures/vaults/tasks/Pages/Bloky.md is missing';
    const base = tmp('preflight');
    const log = join(base, 'perf.jsonl');
    const mark = `route-ready:note/${BLOKY}`;
    const child = spawnApp(testEnv(support(base), log, { TEGG_VAULT: tasksCopy(base), TEGG_ROUTE: `note/${BLOKY}`, TEGG_EXIT_AFTER: mark }));
    const ok = await waitMark(log, mark);
    quitApp(child);
    await waitExit(child);
    rmSync(base, { recursive: true, force: true });
    return ok ? null : `the app does not open note/${BLOKY} (route-ready mark missing)`;
  })();
  return pre;
}
async function ready() {
  const why = await preflight();
  assert.equal(why, null, why ?? '');
}

const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$/;
/** The bytes with the given keys masked, after checking their form (AP-345 rule). */
function masked(t: string | null, keys: ('id' | 'created' | 'modified' | 'completed')[] = ['modified']): string {
  let out = t ?? '';
  for (const k of keys) {
    const m = new RegExp(`^${k}: (.*)$`, 'm').exec(out);
    assert.ok(m, `${k} is present`);
    if (k === 'id') assert.match(m![1], /^[0-9A-HJKMNP-TV-Z]{26}$/, 'id is a ULID');
    else assert.match(m![1], ISO_OFFSET, `${k} is an ISO 8601 date-time with offset`);
    out = out.replace(m![0], `${k}: <x>`);
  }
  return out;
}
/** FR-CNV-03 AC-1 bytes with id, created and modified masked. */
const TASK_AC1 = `---\nid: <x>\ntype: task\ntitle: ${ZAVOLAT}\nstatus: To do\nsource: "[[Bloky]]"\ncreated: <x>\nmodified: <x>\n---\na domluvit termín.\n`;
/** FR-CNV-03 AC-2 bytes of Bloky with modified masked. */
const BLOKY_AC2 = () => masked(fx(BLOKY)).replace(ZAVOLAT_PARA, `![[${ZAVOLAT}]]\n`);

type S = { base: string; vault: string; log: string; sup: string; d: Driver };
async function on(name: string, route: string, o: { edit?: (v: string) => void; convert?: Record<string, unknown>; extra?: Env } = {}): Promise<S> {
  const base = tmp(name);
  const vault = tasksCopy(base, o.edit);
  const log = join(base, 'perf.jsonl');
  const sup = support(base, o.convert);
  const d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: route, ...(o.extra ?? {}) }));
  assert.ok(await waitMark(log, `route-ready:${route}`), `${route} shown`);
  return { base, vault, log, sup, d };
}

// ---------------------------------------------------------------- FR-CNV-03 AC-7

test('fr_cnv_03_ac7_killed_during_a_conversion_cycles', { timeout: 60 * 60_000 }, async () => {
  await ready();
  const cycles = Number(process.env.TEGG_KILL_CYCLES ?? 10);
  const problems: string[] = [];
  for (let c = 0; c < cycles; c++) {
    const point = c % 2 === 0 ? 'after-create' : 'during-source-save';
    const hold = point === 'after-create' ? 'after-create' : `during-source-save:${BLOKY}`;
    const base = tmp(`cnv03-7-${c}`);
    const vault = tasksCopy(base);
    const sup = support(base);
    let d: Driver | undefined;
    try {
      const log = join(base, 'perf-run.jsonl');
      d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${BLOKY}`, TEGG_TEST_HOLD: hold }));
      assert.ok(await waitMark(log, `route-ready:note/${BLOKY}`), `cycle ${c}: Bloky shown`);
      await convertZavolat(d);
      if (!(await waitMark(log, `hold:${point}`, 5000))) { problems.push(`cycle ${c}: mark hold:${point} not reached`); continue; }
      const pid = Number(execFileSync('pgrep', ['-n', '-f', EXE], { encoding: 'utf8' }).trim());
      process.kill(pid, 'SIGKILL');
      await end(d);
      d = undefined;
      ageTempFiles(vault);
      const log2 = join(base, 'perf-restart.jsonl');
      const child = spawnApp(testEnv(sup, log2, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${BLOKY}`, TEGG_EXIT_AFTER: `route-ready:note/${BLOKY}` }));
      const up = await waitMark(log2, `route-ready:note/${BLOKY}`);
      await sleep(1000);
      quitApp(child);
      await waitExit(child);
      if (!up) { problems.push(`cycle ${c}: the app doesn't restart`); continue; }
      const b = read(vault, BLOKY);
      const original = b === fx(BLOKY);
      const converted = /^modified: /m.test(b) && masked(b) === BLOKY_AC2();
      if (!original && !converted) problems.push(`cycle ${c} (${point}): Bloky is neither its original bytes nor the AC-2 bytes`);
      const task = existsSync(join(vault, TASK)) ? read(vault, TASK) : null;
      if (converted && (task === null || masked(task, ['id', 'created', 'modified']) !== TASK_AC1)) problems.push(`cycle ${c} (${point}): Bloky has the embed but the task isn't the AC-1 bytes`);
      if (original && task !== null && !/^source: "\[\[Bloky\]\]"$/m.test(task)) problems.push(`cycle ${c} (${point}): the orphan task has no source "[[Bloky]]"`);
      if (original && task !== null && /^type: task$/m.test(task) === false) problems.push(`cycle ${c} (${point}): the orphan isn't a normal task`);
      if (tempFiles(vault).length) problems.push(`cycle ${c} (${point}): .tegg-tmp left after the cleanup: ${tempFiles(vault).length}`);
    } finally {
      await end(d);
    }
    rmSync(base, { recursive: true, force: true });
  }
  assert.deepEqual(problems, [], 'after every kill: Bloky original or the AC-2 bytes, never anything else; an embed only with the AC-1 file; no temp file left');
});

// ---------------------------------------------------------------- FR-CNV-03 AC-8

test('fr_cnv_03_ac8_shift_cmd_t_writes_exactly_two_files_in_the_built_app', { timeout: 300_000 }, async () => {
  await ready();
  const s = await on('cnv03-8', `note/${BLOKY}`);
  const before = tree(s.vault);
  let took = Infinity;
  try {
    const t0 = await convertZavolat(s.d);
    const a = await waitFile(join(s.vault, TASK), (t) => t !== null, 3000);
    const b = await waitFile(join(s.vault, BLOKY), (t) => !!t?.includes(`![[${ZAVOLAT}]]`), 3000);
    took = Date.now() - t0;
    assert.ok(a && b, 'both files written');
    await sleep(1500);
  } finally {
    await end(s.d);
  }
  assert.ok(took <= 1200, `within 1.2 s: ${took} ms`);
  const now = tree(s.vault);
  assert.deepEqual(changedPaths(before, now), [BLOKY, TASK].map((p) => p.normalize('NFC')).sort(), 'exactly two files; every other vault file untouched');
  assert.equal(before[TASK.normalize('NFC')], undefined, 'the task is a new file (create-exclusive)');
  assert.notEqual(inode(now, BLOKY), inode(before, BLOKY), 'Bloky: a temporary file renamed in Pages/ (new inode)');
  assert.deepEqual(tempFiles(s.vault), [], 'no .tegg-tmp left');
  assert.equal(masked(read(s.vault, TASK), ['id', 'created', 'modified']), TASK_AC1, 'the AC-1 bytes except id, created, modified');
  assert.equal(masked(read(s.vault, BLOKY)), BLOKY_AC2(), 'the AC-2 bytes except modified');
  rmSync(s.base, { recursive: true, force: true });
});

// ---------------------------------------------------------------- FR-CNV-05 AC-2, AC-5

test('fr_cnv_05_ac2_the_card_checkbox_writes_only_the_task_once', { timeout: 300_000 }, async () => {
  await ready();
  const s = await on('cnv05-2', `note/${PORADA}`);
  const before = tree(s.vault);
  try {
    assert.ok(await shown(s.d, 'Embedded: Zavolat Janě', 5000), 'the Task card');
    await (await need(s.d, 'Complete "Zavolat Janě"')).click();
    assert.ok(await waitFile(join(s.vault, T01), (t) => !!t?.includes('status: Done'), 3000), 'T01 written');
    assert.ok(await shown(s.d, 'Mark "Zavolat Janě" not done', 1500), 'the card follows');
    await sleep(1500);
  } finally {
    await end(s.d);
  }
  assert.deepEqual(changedPaths(before, tree(s.vault)), [T01.normalize('NFC')], 'only Tasks/Zavolat Janě.md; Porada keeps bytes, mtime and inode');
  assert.equal(masked(read(s.vault, T01), ['modified', 'completed']), masked(`${fx(T01).replace('status: To do', 'status: Done').replace(/^modified: .*$/m, `modified: ${NOW}\ncompleted: ${NOW}`)}`, ['modified', 'completed']), 'status: Done, completed and modified (FR-TSK-02 AC-10 bytes)');
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_cnv_05_ac5_a_body_edit_in_the_card_is_an_atomic_write_of_the_task', { timeout: 300_000 }, async () => {
  await ready();
  const s = await on('cnv05-5', `note/${PORADA}`);
  const before = tree(s.vault);
  let took = Infinity;
  try {
    assert.ok(await shown(s.d, 'Embedded: Zavolat Janě', 5000), 'the Task card');
    await caretAtEnd(s.d, 'Domluvit schůzku na příští týden.');
    const t0 = Date.now();
    paste(' Zítra.');
    const t = await waitFile(join(s.vault, T01), (x) => !!x?.includes('Zítra.'), 3000);
    took = Date.now() - t0;
    assert.ok(t, 'T01 written');
    await sleep(1500);
  } finally {
    await end(s.d);
  }
  assert.ok(took <= 1200, `within 1 s of the edit (+ 0.2 s probe slack): ${took} ms`);
  const now = tree(s.vault);
  assert.deepEqual(changedPaths(before, now), [T01.normalize('NFC')], 'only the task; Porada untouched');
  assert.notEqual(inode(now, T01), inode(before, T01), 'atomic: a temporary file renamed (new inode)');
  assert.deepEqual(tempFiles(s.vault), [], 'no .tegg-tmp left');
  assert.equal(masked(read(s.vault, T01)), masked(fx(T01)).replace('příští týden.', 'příští týden. Zítra.'), 'body line and modified only');
  rmSync(s.base, { recursive: true, force: true });
});

// ---------------------------------------------------------------- FR-CNV-08 AC-2, AC-4

/** Selects the Zavolat embed of a pre-converted Bloky as a block (↓ from the end of the paragraph before it). */
async function selectZavolatEmbed(d: Driver) {
  assert.ok(await shown(d, `Embedded: ${ZAVOLAT}`, 5000), 'the embed of the converted task');
  await caretAtEnd(d, 'Úvodní odstavec.');
  press('down');
  await sleep(300);
}

test('fr_cnv_08_ac2_dont_ask_again_survives_a_relaunch', { timeout: 300_000 }, async () => {
  await ready();
  const s = await on('cnv08-2', `note/${BLOKY}`, { edit: preConverted });
  const teggBefore = tree(join(s.vault, '.tegg'));
  const removed = fx(BLOKY).replace(`${ZAVOLAT_PARA}\n`, '');
  try {
    await selectZavolatEmbed(s.d);
    press('delete');
    assert.ok(await shown(s.d, 'Remove the embed?', 2000), 'asked the first time');
    await (await need(s.d, 'Don\'t ask again')).click();
    await (await need(s.d, 'Remove embed')).click();
    assert.ok(await waitFile(join(s.vault, BLOKY), (t) => !!t && !t.includes(`![[${ZAVOLAT}]]`), 3000), 'removed and saved');
    await sleep(800);
  } finally {
    await end(s.d);
  }
  assert.equal(masked(read(s.vault, BLOKY)), masked(removed), 'the embed paragraph removed');
  const ui = JSON.parse(readFileSync(join(s.sup, 'ui-state.json'), 'utf8'));
  assert.equal(ui?.convert?.skipRemoveConfirm, true, 'stored per machine in Application Support (ui-state.json, D-128)');
  assert.deepEqual(changedPaths(teggBefore, tree(join(s.vault, '.tegg'))), [], 'never in the vault (.tegg/ unchanged)');
  // Relaunch with the same Application Support on a fresh pre-converted copy.
  const vault2 = join(s.base, 'druhý');
  mkdirSync(vault2);
  cpSync(join(FX, 'tasks'), vault2, { recursive: true, filter: (src) => relative(join(FX, 'tasks'), src) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(vault2, '.tegg'), { recursive: true });
  preConverted(vault2);
  const log2 = join(s.base, 'perf-2.jsonl');
  let d2: Driver | undefined;
  let asked = true;
  try {
    d2 = await session(testEnv(s.sup, log2, { TEGG_VAULT: vault2, TEGG_ROUTE: `note/${BLOKY}` }));
    assert.ok(await waitMark(log2, `route-ready:note/${BLOKY}`), 'relaunched on Bloky');
    await selectZavolatEmbed(d2);
    press('delete');
    asked = await shown(d2, 'Remove the embed?', 1500);
    assert.ok(await waitFile(join(vault2, BLOKY), (t) => !!t && !t.includes(`![[${ZAVOLAT}]]`), 3000), 'removed at once after the relaunch');
  } finally {
    await end(d2);
  }
  assert.equal(asked, false, 'no dialog after the relaunch');
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_cnv_08_ac4_the_object_keeps_bytes_mtime_and_inode_once', { timeout: 300_000 }, async () => {
  await ready();
  const s = await on('cnv08-4', `note/${BLOKY}`, { edit: preConverted });
  const before = tree(s.vault);
  try {
    await selectZavolatEmbed(s.d);
    press('delete');
    assert.ok(await shown(s.d, 'Remove the embed?', 2000), 'the dialog');
    await (await need(s.d, 'Remove embed')).click();
    assert.ok(await waitFile(join(s.vault, BLOKY), (t) => !!t && !t.includes(`![[${ZAVOLAT}]]`), 3000), 'removed and saved');
    await sleep(1500);
  } finally {
    await end(s.d);
  }
  assert.deepEqual(changedPaths(before, tree(s.vault)), [BLOKY], `only Bloky; ${TASK} keeps bytes, mtime and inode; nothing trashed`);
  assert.equal(read(s.vault, TASK), PRE_TASK, 'source: "[[Bloky]]" kept');
  rmSync(s.base, { recursive: true, force: true });
});

// ---------------------------------------------------------------- FR-SYN-06 AC-23

test('fr_syn_06_ac23_opening_r50_and_browsing_task_cards_write_nothing', { timeout: 300_000 }, async () => {
  await ready();
  const s = await on('syn06-23a', `note/${BLOKY}`);
  const before = tree(s.vault);
  try {
    assert.ok(await shown(s.d, 'Note body', 5000), 'the editor');
    await caretAtEnd(s.d, 'Úvodní odstavec.');
    press('o', ['command', 'shift']);
    assert.ok(await shown(s.d, 'Turn into object', 2000), 'R50 opens');
    for (const t of ['Page', 'Quick Note', 'Task']) { const r = await firstShown(s.d, t); if (r) await r.click(); await sleep(150); }
    await (await need(s.d, 'Cancel')).click();
    await sleep(300);
    press('t', ['command', 'shift']);
    assert.ok(await shown(s.d, 'Turn into object', 2000), 'R50 opens again');
    press('escape');
    await sleep(300);
    for (const n of ['Porada', 'Dvě karty', 'Obal']) {
      await openBySwitcher(s.d, n);
      assert.ok(await shown(s.d, 'Embedded: Zavolat Janě', 5000), `${n}: the Task card`);
      await sleep(500);
    }
    await sleep(1500);
  } finally {
    await end(s.d);
  }
  assert.deepEqual(changedPaths(before, tree(s.vault)), [], 'no vault file changes bytes, mtime or inode');
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_syn_06_ac23_a_conversion_writes_exactly_two_files', { timeout: 300_000 }, async () => {
  await ready();
  const s = await on('syn06-23b', `note/${BLOKY}`);
  const before = tree(s.vault);
  const q3 = 'Tasks/Q3 rozpočet plán.md';
  try {
    assert.ok(await shown(s.d, 'Note body', 5000), 'the editor');
    await caretAtEnd(s.d, 'Q3: rozpočet/plán');
    press('t', ['command', 'shift']);
    assert.ok(await shown(s.d, 'Turn into object', 2000), 'R50');
    press('enter');
    assert.ok(await waitFile(join(s.vault, q3), (t) => t !== null, 3000), `${q3} created`);
    assert.ok(await waitFile(join(s.vault, BLOKY), (t) => !!t?.includes('![[Q3 rozpočet plán]]'), 3000), 'Bloky saved with the embed');
    await sleep(1500);
  } finally {
    await end(s.d);
  }
  const now = tree(s.vault);
  assert.deepEqual(changedPaths(before, now), [BLOKY, q3].map((p) => p.normalize('NFC')).sort(), 'exactly the new object and the source note');
  assert.notEqual(inode(now, BLOKY), inode(before, BLOKY), 'Bloky written atomically (new inode)');
  assert.deepEqual(tempFiles(s.vault), [], 'no .tegg-tmp left');
  assert.equal(bodyOf(read(s.vault, q3)), '', 'the Q3 task has an empty body');
  rmSync(s.base, { recursive: true, force: true });
});
