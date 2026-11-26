// Bug (owner, 2026-11-25): converting an empty block into an object shows an error until the page is refreshed.
// On the built app the new embed of an empty paragraph converted with ⇧⌘O renders as a broken embed (`embed-broken`,
// `data-embed-state="broken"`) in most runs, although the new file exists and the source names it; a reload shows it.
// FR-CNV-03 AC-1/AC-2 (the converted blocks become an embed of the new object, conversion.md R51), FR-EMB-01 (a block
// embed shows its target). L6: the fake core of the WebKit tests answers too fast to show it.
// Helpers copied from ms5_convert.ac.test.ts (TS-I3: existing AC test files are not changed).
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
const _BLOKY_AC2 = () => masked(fx(BLOKY)).replace(ZAVOLAT_PARA, `![[${ZAVOLAT}]]\n`);

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


// ---------------------------------------------------------------- the regression

/** ⇧⌘O in a new empty paragraph after `Úvodní odstavec.`; `up` moves the Type radio from the preselection. */
async function convertEmpty(d: Driver, title: string, up: number) {
  assert.ok(await shown(d, 'Note body', 8000), 'the editor');
  await caretAtEnd(d, 'Úvodní odstavec.');
  press('enter');
  await sleep(300);
  press('o', ['command', 'shift']);
  assert.ok(await shown(d, 'Turn into object', 3000), 'R50 (dialog "Turn into object")');
  if (up) {
    press('tab'); await sleep(150);
    for (let i = 0; i < up; i++) { press('up'); await sleep(100); }
    press('tab', ['shift']); await sleep(150);
  }
  paste(title);
  await sleep(300);
  press('enter');
}

// The race shows in about half the runs (owner's report; 5 of 6 probe runs on 2026-11-25), so each type runs several times.
const RUNS: [string, number, string][] = [
  ['Page', 1, 'Prazdny p1'], ['Page', 1, 'Prázdný p2'], ['Page', 1, 'Prazdny p3'], ['Page', 1, 'Prázdný p4'], ['Page', 1, 'Prazdny p5'],
  ['Task', 0, 'Prazdny t1'], ['Task', 0, 'Prázdný t2'], ['Task', 0, 'Prazdny t3'],
];
for (const [type, up, name] of RUNS) {
  test(`bug_emptyconv_fr_cnv_03_the_embed_of_a_converted_empty_block_is_not_broken_${name.normalize('NFD').replace(/[^\x00-\x7f]/g, '').replace(/ /g, '_').toLowerCase()}`, { timeout: 300_000 }, async () => {
    await ready();
    const s = await on(`emptyconv-${type}`, `note/${BLOKY}`);
    const title = name;
    try {
      await convertEmpty(s.d, title, up);
      const file = `${type === 'Task' ? 'Tasks' : 'Pages'}/${title}.md`;
      const made = await waitFile(join(s.vault, file), (t) => t !== null, 5000);
      assert.ok(made !== null, `the new ${type} ${file} exists`);
      const host = await waitFile(join(s.vault, BLOKY), (t) => !!t && t.includes(`![[${title}]]`), 5000);
      assert.ok(host?.includes(`![[${title}]]`), 'Bloky embeds the new object');
      // The embed shows its target (an `Embedded: <title>` frame, or the Task card), never the broken frame.
      const ok = await shown(s.d, `Embedded: ${title}`, 5000) || await shown(s.d, `Complete "${title}"`, 1000);
      assert.ok(ok, `the embed of "${title}" shows the new object, not a broken embed`);
    } finally {
      await end(s.d);
      rmSync(s.base, { recursive: true, force: true });
    }
  });
}
