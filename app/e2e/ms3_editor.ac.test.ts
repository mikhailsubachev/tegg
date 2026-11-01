// MS3 slice 3C real-app suite (L6, Appium mac2 on the built test app): docs/acceptance/editor.md FR-EDT-08 AC-5, AC-7
// (close, ⌘Q), AC-8 (5 rounds), AC-11 (chmod, quit dialog); FR-EDT-09 AC-1 (Edit menu), AC-3 (one undo after a save);
// FR-FMT-07 AC-8 (tour: bytes, mtime, inode); FR-FMT-12 AC-6 (NFD file name); FR-SYN-02 AC-6 (readers), AC-7 (kill
// cycles); FR-SYN-03 AC-12, AC-13 (real external writer), AC-19 (quit with the dialog open); FR-SYN-06 AC-7 (tour);
// FR-EDT-06 AC-4 (`Nová stránka` on the real core); NFR-REL-03 AC-7 (invalid UTF-8 bytes unchanged).
// Interface: docs/contracts/ms3-shell.md §1, §6, §13 (TEGG_TEST, TEGG_APP_SUPPORT, TEGG_VAULT, TEGG_ROUTE,
// TEGG_PERF_LOG; marks `note-ready`, `note-saved`; helper e2e/helpers/external.ts). Written from the ACs and contracts
// only (D-61). Always TEGG_TEST=1 with temporary Application Support and vault copies of the synthetic fixture (D-62).
//
// Prerequisites as in ms3_shell.ac.test.ts: `npm run app:build`, `npm run e2e:setup`, Accessibility permission.
// TEGG_KILL_CYCLES (default 20) sets the FR-SYN-02 AC-7 cycle count.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { osa as guardedOsa } from './helpers/osa.ts';

const REPO = resolve(import.meta.dirname, '../..');
const APP = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app');
const EXE = join(APP, 'Contents/MacOS/tegg');
const BUNDLE_ID = 'app.tegg.desktop';
const PORT = Number(process.env.APPIUM_PORT ?? 4725);
const APPIUM_HOME = process.env.APPIUM_HOME ?? resolve(import.meta.dirname, '.appium');
const FX = join(REPO, 'tests/fixtures/vaults');
const EXTERNAL = resolve(import.meta.dirname, 'helpers/external.ts');
const MARK_TIMEOUT = 20_000;
const DESET = 'Pages/Deset bloků.md';
const B5 = 'Pátý blok, který test upraví.';

// ---------------------------------------------------------------- setup helpers (no AC assertions)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `tegg-ms3-editor-${name}-`));

/** A temp copy of tests/fixtures/vaults/editor plus new-empty/.tegg (editor.md "Fixtures"). */
function editorCopy(base: string): string {
  const v = join(base, 'Editor');
  cpSync(join(FX, 'editor'), v, { recursive: true });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
const read = (vault: string, rel: string) => readFileSync(join(vault, rel), 'utf8');

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
function tempFiles(root: string): string[] {
  return Object.keys(tree(root)).filter((p) => p.endsWith('.tegg-tmp'));
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
async function waitFile(vault: string, rel: string, ok: (t: string) => boolean, ms: number): Promise<{ text: string; at: number } | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = existsSync(join(vault, rel)) ? read(vault, rel) : '';
    if (ok(t)) return { text: t, at: Date.now() };
    await sleep(10);
  }
  return null;
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
function external(...args: string[]): string {
  return execFileSync(process.execPath, [EXTERNAL, ...args], { encoding: 'utf8' });
}
function externalWrite(path: string, text: string) {
  const f = join(tmpdir(), `tegg-ext-${process.pid}-${Date.now()}.md`);
  writeFileSync(f, text);
  external('write', path, f);
  rmSync(f, { force: true });
}

// System Events key codes.
const KEY: Record<string, number> = {
  a: 0, f: 3, s: 1, w: 13, z: 6, o: 31, n: 45, q: 12, u: 32, v: 9, enter: 36, escape: 53, tab: 48, down: 125, up: 126, right: 124, left: 123, end: 119, lbracket: 33, slash: 44,
};
const osa = guardedOsa; // D-758: ⌘Q/⌘W only while Tegg is frontmost
function press(key: string, mods: ('command' | 'shift' | 'control' | 'option')[] = []) {
  osa(`tell application "System Events" to key code ${KEY[key]}${mods.length ? ` using {${mods.map((m) => `${m} down`).join(', ')}}` : ''}`);
}
function typeAscii(text: string) {
  osa(`tell application "System Events" to keystroke ${JSON.stringify(text)}`);
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
async function clickLabel(d: Driver, label: string): Promise<boolean> {
  const e = await firstShown(d, label);
  if (!e) return false;
  await e.click().catch(() => {});
  await sleep(300);
  return true;
}
/** Puts the caret at the end of the editor line whose text is `text` (click, then ⌘→). */
async function caretAtEnd(d: Driver, text: string) {
  assert.ok(await shown(d, 'Note body', 5000), 'the editor (textbox "Note body") is shown');
  assert.ok(await clickLabel(d, text), `editor text "${text}" found`);
  press('right', ['command']);
  await sleep(100);
}
async function openBySwitcher(d: Driver, title: string) {
  press('f', ['command', 'shift']); // D-760: ⇧⌘F and the Search page's Go to list replace ⌘O
  assert.ok(await shown(d, 'Search query'), `switcher for ${title}`);
  paste(title);
  await sleep(300);
  press('enter');
  await sleep(500);
}

/** Starts the app on Deset bloků of a fresh editor-fixture copy; waits for `note-ready` and the editor. */
async function onDeset(name: string, extra: Env = {}) {
  const base = tmp(name);
  const vault = editorCopy(base);
  const support = join(base, 'support');
  const log = join(base, 'perf.jsonl');
  const d = await session(testEnv(support, log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${DESET}`, ...extra }));
  assert.ok(await waitMark(log, 'note-ready'), 'Deset bloků shown (note-ready)');
  return { base, vault, support, log, d };
}

// ---------------------------------------------------------------- preflight
let pre: Promise<string | null> | undefined;
function preflight(): Promise<string | null> {
  pre ??= (async () => (existsSync(EXE) ? null : `app not built: ${EXE} (cd app && npm run app:build)`))();
  return pre;
}
async function ready() {
  const why = await preflight();
  assert.equal(why, null, why ?? '');
}

// ---------------------------------------------------------------- tests

test('fr_edt_08_ac5_autosave_on_disk_within_1_2_s', { timeout: 240_000 }, async () => {
  await ready();
  const s = await onDeset('edt08-5');
  try {
    await caretAtEnd(s.d, B5);
    typeAscii('Ahoj');
    const last = Date.now();
    const got = await waitFile(s.vault, DESET, (t) => t.includes(`${B5}Ahoj`), 5000);
    assert.ok(got, 'the edit reaches the file');
    assert.ok(got!.at - last <= 1200, `on disk ${got!.at - last} ms after the last key (≤ 1,200 ms)`);
  } finally {
    await end(s.d);
  }
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_edt_08_ac7_flush_on_window_close', { timeout: 240_000 }, async () => {
  await ready();
  const s = await onDeset('edt08-7w');
  try {
    await caretAtEnd(s.d, B5);
    typeAscii('W');
    press('w', ['command']);
    await sleep(2500);
    assert.ok(read(s.vault, DESET).includes(`${B5}W`), 'the file contains the edit after the window closes');
  } finally {
    await end(s.d);
  }
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_edt_08_ac7_flush_on_quit', { timeout: 240_000 }, async () => {
  await ready();
  const s = await onDeset('edt08-7q');
  try {
    await caretAtEnd(s.d, B5);
    typeAscii('Q');
    press('q', ['command']);
    await sleep(3000);
    assert.ok(read(s.vault, DESET).includes(`${B5}Q`), 'the file contains the edit after ⌘Q');
  } finally {
    await end(s.d);
  }
  rmSync(s.base, { recursive: true, force: true });
});

// data-safety FR-EDT-08 AC-3 (closing and quitting flush pending changes), verified by editor.md FR-EDT-08 AC-7.
test('fr_edt_08_ac3_close_and_quit_flush_pending_changes', { timeout: 300_000 }, async () => {
  await ready();
  const s = await onDeset('edt08-3');
  try {
    await caretAtEnd(s.d, B5);
    typeAscii('C');
    press('w', ['command']);
    await sleep(2500);
    assert.ok(read(s.vault, DESET).includes(`${B5}C`), 'closing the window flushed the edit');
  } finally {
    await end(s.d);
  }
  const s2 = await onDeset('edt08-3q');
  try {
    await caretAtEnd(s2.d, B5);
    typeAscii('Q');
    press('q', ['command']);
    await sleep(3000);
    assert.ok(read(s2.vault, DESET).includes(`${B5}Q`), 'quitting flushed the edit');
  } finally {
    await end(s2.d);
  }
  rmSync(s.base, { recursive: true, force: true });
  rmSync(s2.base, { recursive: true, force: true });
});

test('fr_edt_08_ac8_never_into_the_wrong_note_5_rounds', { timeout: 600_000 }, async () => {
  await ready();
  const s = await onDeset('edt08-8');
  const before = tree(s.vault);
  let a = '', c = '';
  try {
    for (let n = 1; n <= 5; n++) {
      await openBySwitcher(s.d, 'Deset bloků');
      await caretAtEnd(s.d, `${B5}${a}`);
      typeAscii(`A${n}`); a += `A${n}`;
      await openBySwitcher(s.d, 'Cíl');
      await caretAtEnd(s.d, `Cílová stránka pro odkazy.${c}`);
      typeAscii(`C${n}`); c += `C${n}`;
    }
    await openBySwitcher(s.d, 'Odstavce');
    await sleep(2500);
  } finally {
    await end(s.d);
  }
  assert.ok(read(s.vault, DESET).includes(`${B5}${a}`), 'Deset bloků has exactly the A strings in order');
  assert.ok(read(s.vault, 'Pages/Cíl.md').includes(`Cílová stránka pro odkazy.${c}`), 'Cíl has exactly the C strings');
  const after = tree(s.vault);
  const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  assert.deepEqual(changed.sort(), [DESET, 'Pages/Cíl.md'].sort(), 'no other file written');
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_edt_08_ac11_write_failure_with_chmod_and_quit_dialog', { timeout: 300_000 }, async () => {
  await ready();
  const s = await onDeset('edt08-11');
  const pages = join(s.vault, 'Pages');
  try {
    chmodSync(pages, 0o555);
    await caretAtEnd(s.d, B5);
    typeAscii('X');
    assert.ok(await shown(s.d, 'Not saved', 4000), 'Save state Not saved');
    assert.ok(await shown(s.d, 'Try again'), 'alert with Try again');
    press('q', ['command']);
    assert.ok(await shown(s.d, 'Quit without saving?', 4000), 'dialog Quit without saving?');
    assert.ok(await shown(s.d, 'Cancel') && (await shown(s.d, 'Quit anyway')), 'Cancel and Quit anyway');
    assert.ok(await clickLabel(s.d, 'Cancel'), 'Cancel');
    chmodSync(pages, 0o755);
    const got = await waitFile(s.vault, DESET, (t) => t.includes(`${B5}X`), 7000);
    assert.ok(got, 'the retry saves the current content within 5 s');
    assert.ok(await shown(s.d, 'Saved', 2000), 'Saved again');
    assert.deepEqual(tempFiles(s.vault), [], 'no .tegg-tmp file remains');
  } finally {
    try { chmodSync(pages, 0o755); } catch { /* gone */ }
    await end(s.d);
  }
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_edt_09_ac1_edit_menu_undo_redo', { timeout: 240_000 }, async () => {
  await ready();
  const s = await onDeset('edt09-1');
  try {
    await caretAtEnd(s.d, B5);
    typeAscii('M');
    assert.ok(await waitFile(s.vault, DESET, (t) => t.includes(`${B5}M`), 3000), 'saved');
    osa('tell application "System Events" to tell (first process whose bundle identifier is "app.tegg.desktop") to click menu item "Undo" of menu "Edit" of menu bar 1');
    assert.ok(await waitFile(s.vault, DESET, (t) => t.includes(`${B5}\n`), 3000), 'Edit › Undo undoes');
    osa('tell application "System Events" to tell (first process whose bundle identifier is "app.tegg.desktop") to click menu item "Redo" of menu "Edit" of menu bar 1');
    assert.ok(await waitFile(s.vault, DESET, (t) => t.includes(`${B5}M`), 3000), 'Edit › Redo redoes');
  } finally {
    await end(s.d);
  }
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_edt_09_ac3_one_undo_after_a_save', { timeout: 240_000 }, async () => {
  await ready();
  const s = await onDeset('edt09-3');
  const orig = read(s.vault, DESET);
  try {
    await caretAtEnd(s.d, B5);
    typeAscii(' Nova veta.');
    assert.ok(await waitFile(s.vault, DESET, (t) => t.includes('Nova veta.'), 3000), 'saved');
    press('z', ['command']);
    const got = await waitFile(s.vault, DESET, (t) => !t.includes('Nova veta.'), 1500);
    assert.ok(got, 'undone on disk within 1 s (+ event allowance)');
    const strip = (t: string) => t.replace(/^modified: .*$/m, '');
    assert.equal(strip(got!.text), strip(orig), 'body byte-identical, frontmatter differs only in modified');
  } finally {
    await end(s.d);
  }
  rmSync(s.base, { recursive: true, force: true });
});

const TOUR = ['Deset bloků', 'Cíl', 'Dvojník', 'C# tips', 'Senior Product Manager', 'Štítky', 'Bez hlavičky', 'Cizí hlavička',
  'Chyba uvozovky', 'Seznamy', 'Odsazený kód', 'Odstavce', 'Úkoly', 'Surové bloky', 'Prázdná'];

test('fr_fmt_07_ac8_tour_over_editor_fixture_changes_no_file', { timeout: 900_000 }, async () => {
  await ready();
  const s = await onDeset('fmt07-8');
  const before = tree(s.vault);
  try {
    assert.ok(await shown(s.d, 'Note body', 5000), 'the editor is shown');
    for (const t of TOUR) {
      await openBySwitcher(s.d, t);
      await clickLabel(s.d, 'Note body');
      for (const k of ['down', 'down', 'up', 'right', 'left']) press(k);
      press('a', ['command']);
      osa('tell application "System Events" to keystroke "c" using {command down}');
      press('down', ['command']);
    }
    await openBySwitcher(s.d, 'Deset bloků');
    await sleep(1500);
  } finally {
    await end(s.d);
  }
  assert.deepEqual(tree(s.vault), before, 'every file: bytes, mtime and inode unchanged');
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_syn_06_ac7_reading_tour_writes_nothing', { timeout: 900_000 }, async () => {
  await ready();
  const s = await onDeset('syn06-7');
  const before = tree(s.vault);
  try {
    for (const t of TOUR) {
      await openBySwitcher(s.d, t);
      await clickLabel(s.d, 'Note body');
      for (const k of ['down', 'down', 'down', 'down']) press(k);
      press('u', ['option', 'command']);
      await sleep(200);
      press('u', ['option', 'command']);
    }
    await openBySwitcher(s.d, 'Deset bloků');
    await caretAtEnd(s.d, B5);
    for (let i = 0; i < 4; i++) press('left', ['shift']); // a text selection: the toolbar shows
    assert.ok(await shown(s.d, 'Formatting', 2000), 'toolbar on the selection');
    press('right');
    press('slash', ['command']);
    assert.ok(await shown(s.d, 'Block actions', 2000), 'block menu');
    press('escape');
    press('z', ['command']); // empty history
    await clickLabel(s.d, 'Cíl'); // follow [[Cíl]]
    await sleep(500);
    press('lbracket', ['command']); // Back
    await sleep(1500);
  } finally {
    await end(s.d);
  }
  const after = tree(s.vault);
  const changed = Object.keys({ ...before, ...after }).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  assert.deepEqual(changed, [], 'bytes, mtime and inode unchanged; nothing created');
});

test('fr_fmt_12_ac6_nfd_file_name_edit_keeps_one_file', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('fmt12-6');
  const vault = editorCopy(base);
  renameSync(join(vault, 'Pages/Cíl.md'), join(vault, 'Pages', 'Cíl.md'));
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(join(base, 'support'), log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${DESET}` }));
    assert.ok(await waitMark(log, 'note-ready'), 'start');
    await openBySwitcher(d, 'Cíl');
    await caretAtEnd(d, 'Cílová stránka pro odkazy.');
    typeAscii(' NFD');
    await sleep(2500);
    const names = readdirSync(join(vault, 'Pages')).filter((n) => n.normalize('NFC') === 'Cíl.md');
    assert.equal(names.length, 1, `exactly one file named Cíl.md under NFC: ${names.map((n) => JSON.stringify(n)).join(', ')}`);
    assert.ok(readFileSync(join(vault, 'Pages', names[0]), 'utf8').includes('Cílová stránka pro odkazy. NFD'), 'containing the edit');
    press('f', ['command', 'shift']); // D-760: ⇧⌘F opens the Search page in place of ⌘O
    paste('Cíl');
    await sleep(600);
    // A result row is a link named by its title (D-1340, D-1345; before it a Go to row exposed "<title> <folder>");
    // the query field also shows "Cíl", as a text field, not a link.
    const rows = await d.$$('-ios predicate string:elementType == 39 AND (label == "Cíl" OR title == "Cíl")');
    let shownRows = 0;
    for (const h of rows) if (await h.isDisplayed().catch(() => false)) shownRows++;
    assert.equal(shownRows, 1, 'the switcher lists one object for it');
    assert.equal(/^id: (\S+)/m.exec(readFileSync(join(vault, 'Pages', names[0]), 'utf8'))?.[1], '01JB0E0000000000000000E002', 'same id');
  } finally {
    await end(d);
  }
  rmSync(base, { recursive: true, force: true });
});

/** The 5,000-word note of read-view §11.5 in shape (100 paragraphs × 50 words), written into the vault copy. */
function longNote(vault: string): { rel: string; text: string } {
  const words = ['žluťoučký', 'kůň', 'úpěl', 'ďábelské', 'ódy', 'příliš', 'čeština', 'řeka', 'les', 'dům'];
  const paras = Array.from({ length: 100 }, (_, p) => Array.from({ length: 50 }, (_, i) => words[(p * 7 + i * 3) % words.length]).join(' ') + '.');
  paras[50] = 'Prostřední odstavec pro psaní.';
  const text = `---\nid: 01JB0P0000000000000000P002\ntype: page\ntitle: Dlouhá\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n${paras.join('\n\n')}\n`;
  const rel = 'Pages/Dlouhá.md';
  writeFileSync(join(vault, rel), text);
  return { rel, text };
}

test('fr_syn_02_ac6_readers_never_see_a_partial_file', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('syn02-6');
  const vault = editorCopy(base);
  const note = longNote(vault);
  const log = join(base, 'perf.jsonl');
  const reads = join(base, 'reads.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(join(base, 'support'), log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${note.rel}` }));
    assert.ok(await waitMark(log, 'note-ready'), 'long note shown');
    await caretAtEnd(d, 'Prostřední odstavec pro psaní.');
    const poller = spawn(process.execPath, [EXTERNAL, 'poll', join(vault, note.rel), '5', '32000', reads], { stdio: 'ignore' });
    const until = Date.now() + 30_000;
    let typed = '';
    while (Date.now() < until) { typeAscii('ab'); typed += 'ab'; await sleep(100); }
    await new Promise((r) => poller.on('exit', r));
    const lines = readFileSync(reads, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { text?: string; error?: string });
    const [head, tail] = note.text.split('Prostřední odstavec pro psaní.');
    const bad = lines.filter((l) => {
      if (l.error || l.text === undefined) return true;
      if (l.text === note.text) return false;
      const t = l.text.replace(/^modified: .*$/m, 'modified: 2026-10-01T09:00:00+02:00').replace(/^(---\n)(?=type)/, '$1');
      const i = t.indexOf('Prostřední odstavec pro psaní.');
      if (i < 0) return true;
      const ins = t.slice(i + 'Prostřední odstavec pro psaní.'.length, t.length - tail.length);
      return !t.endsWith(tail) || !t.slice(0, i).endsWith(head.slice(head.indexOf('\n---\n') + 5)) || !typed.startsWith(ins);
    });
    assert.ok(lines.length > 2, `the reader saw saved versions: ${lines.length}`);
    assert.deepEqual(bad.length, 0, 'every read is complete and one of the saved versions (or the original)');
    press('f', ['command', 'shift']); // D-760: ⇧⌘F and the Search page's Go to list replace ⌘O
    paste('tegg-tmp');
    await sleep(600);
    assert.equal(await shown(d, 'Dlouhá.md.tegg-tmp', 500), false, 'the switcher never lists a .tegg-tmp file');
  } finally {
    await end(d);
  }
  rmSync(base, { recursive: true, force: true });
});

test('fr_syn_02_ac7_killed_while_typing_cycles', { timeout: 60 * 60_000 }, async () => {
  await ready();
  const cycles = Number(process.env.TEGG_KILL_CYCLES ?? 20);
  const base = tmp('syn02-7');
  const vault = editorCopy(base);
  const orig = read(vault, DESET);
  const problems: string[] = [];
  let d: Driver | undefined;
  for (let c = 0; c < cycles; c++) {
    const log = join(base, `perf-${c}.jsonl`);
    try {
      d = await session(testEnv(join(base, 'support'), log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${DESET}` }));
      assert.ok(await waitMark(log, 'note-ready'), `cycle ${c}: start`);
      const before = read(vault, DESET);
      const prev = before.slice(before.indexOf(B5) + B5.length).split('\n')[0];
      await caretAtEnd(d, B5 + prev);
      const killAt = Date.now() + 2000 + Math.floor(Math.random() * 8000);
      const times: number[] = [];
      let typed = '';
      while (Date.now() < killAt) { typeAscii('k'); typed += 'k'; times.push(Date.now()); await sleep(50); }
      const pid = Number(execFileSync('pgrep', ['-n', '-f', EXE], { encoding: 'utf8' }).trim());
      process.kill(pid, 'SIGKILL');
      await end(d);
      d = undefined;
      const after = read(vault, DESET);
      const m = /^---\n[\s\S]*?\n---\n/.exec(after);
      if (!m) { problems.push(`cycle ${c}: frontmatter missing`); continue; }
      const line = after.slice(after.indexOf(B5) + B5.length).split('\n')[0];
      const added = line.slice(prev.length);
      if (!line.startsWith(prev) || !typed.startsWith(added)) problems.push(`cycle ${c}: block 5 isn't the old text + a prefix of the typed text`);
      const lost = typed.length - added.length;
      const allowed = times.filter((t) => t > killAt - 1200).length;
      if (lost > allowed) problems.push(`cycle ${c}: lost ${lost} keys, allowed ${allowed} (last 1.2 s)`);
      if (after.replace(/^modified: .*$/m, '').replace(B5 + line, B5) !== orig.replace(/^modified: .*$/m, '')) problems.push(`cycle ${c}: other bytes changed`);
    } finally {
      await end(d);
      d = undefined;
    }
  }
  assert.deepEqual(problems, [], 'every kill leaves a valid file with a prefix of the typed text');
  rmSync(base, { recursive: true, force: true });
});

test('fr_syn_03_ac12_real_external_write_reloads_clean_note', { timeout: 240_000 }, async () => {
  await ready();
  const s = await onDeset('syn03-12');
  try {
    assert.ok(await shown(s.d, 'Note body', 5000), 'editor');
    const changed = read(s.vault, DESET).replace('Odstavec s _kurzívou_', 'Odstavec změněný jinde s _kurzívou_');
    externalWrite(join(s.vault, DESET), changed);
    let ok = false;
    const endAt = Date.now() + 2500;
    while (!ok && Date.now() < endAt) {
      const els = await s.d.$$('-ios predicate string:elementType IN {48, 49, 50, 52} AND value CONTAINS "změněný jinde"').catch(() => [] as any[]);
      ok = els.length > 0;
      await sleep(100);
    }
    assert.ok(ok, 'the editor shows the new text within 2 s');
    assert.equal(await shown(s.d, 'Note changed outside Tegg', 300), false, 'no dialog');
    assert.equal(read(s.vault, DESET), changed, 'no write');
  } finally {
    await end(s.d);
  }
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_syn_03_ac13_real_external_writer_with_unsaved_edit', { timeout: 240_000 }, async () => {
  await ready();
  const s = await onDeset('syn03-13');
  try {
    await caretAtEnd(s.d, B5);
    const theirs = read(s.vault, DESET).replace('| a \\| b | 1 |', '| a \\| b | 2 |');
    typeAscii('X');
    externalWrite(join(s.vault, DESET), theirs);
    assert.ok(await shown(s.d, 'Note changed outside Tegg', 2500), 'dialog within 2 s');
    for (const b of ['Keep mine', 'Keep theirs', 'Keep both', 'Compare']) assert.ok(await shown(s.d, b, 500), b);
    await sleep(10_000);
    assert.equal(read(s.vault, DESET), theirs, 'the file holds the other program\'s bytes after 10 s');
  } finally {
    await end(s.d);
  }
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_syn_03_ac19_quit_with_the_dialog_open_keeps_both', { timeout: 240_000 }, async () => {
  await ready();
  const s = await onDeset('syn03-19');
  try {
    await caretAtEnd(s.d, B5);
    const theirs = read(s.vault, DESET).replace('| a \\| b | 1 |', '| a \\| b | 2 |');
    typeAscii('X');
    externalWrite(join(s.vault, DESET), theirs);
    assert.ok(await shown(s.d, 'Note changed outside Tegg', 2500), 'merge dialog');
    press('q', ['command']);
    assert.ok(await shown(s.d, 'Quit and keep both versions?', 3000), 'quit asks');
    const btn = await s.d.$('-ios predicate string:elementType == 9 AND (label CONTAINS "Quit" OR title CONTAINS "Quit")');
    await btn.click();
    await sleep(3000);
    const copies = readdirSync(join(s.vault, 'Pages')).map((n) => n.normalize('NFC')).filter((n) => /^Deset bloků \(conflict \d{4}-\d\d-\d\d \d\d-\d\d\)\.md$/.test(n));
    assert.equal(copies.length, 1, 'Keep both copy created');
    assert.ok(read(s.vault, `Pages/${copies[0]}`).includes(`${B5}X`), 'with the editor\'s content');
    assert.equal(read(s.vault, DESET), theirs, 'the original keeps the other program\'s bytes');
  } finally {
    await end(s.d);
  }
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_edt_06_ac4_create_nova_stranka_on_the_real_core', { timeout: 240_000 }, async () => {
  await ready();
  const base = tmp('edt06-4');
  const vault = editorCopy(base);
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(join(base, 'support'), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'note/Pages/Prázdná.md' }));
    assert.ok(await waitMark(log, 'note-ready'), 'Prázdná shown');
    assert.ok(await clickLabel(d, 'Note body'), 'editor');
    typeAscii('[[');
    paste('Nová stránka');
    assert.ok(await shown(d, 'Create "Nová stránka"', 3000), 'Create row');
    press('up');
    press('down');
    assert.ok(await clickLabel(d, 'Create "Nová stránka"'), 'choose Create');
    await sleep(2500);
    assert.ok(existsSync(join(vault, 'Quick Notes/Nová stránka.md')), 'Quick Notes/Nová stránka.md created');
    assert.match(read(vault, 'Quick Notes/Nová stránka.md'), /^---\nid: \S+\ntype: quick-note\n/, 'default type Quick Note');
    assert.ok(read(vault, 'Pages/Prázdná.md').includes('[[Nová stránka]]'), 'link saved');
  } finally {
    await end(d);
  }
  rmSync(base, { recursive: true, force: true });
});

test('nfr_rel_03_ac7_invalid_utf8_bytes_unchanged', { timeout: 240_000 }, async () => {
  await ready();
  const base = tmp('rel03-7');
  const vault = editorCopy(base);
  const rel = 'Pages/Neplatné UTF-8.md';
  writeFileSync(join(vault, rel), Buffer.concat([Buffer.from('---\ntype: page\n---\nPřed chybou '), Buffer.from([0xff]), Buffer.from(' za chybou.\n')]));
  const before = tree(vault);
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(join(base, 'support'), log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${rel}` }));
    assert.ok(await waitMark(log, 'note-ready'), 'opened');
    assert.ok(await shown(d, "This file isn't valid UTF-8", 3000), 'alert');
    press('u', ['option', 'command']);
    await sleep(300);
    press('u', ['option', 'command']);
    typeAscii('x');
    await openBySwitcher(d, 'Cíl');
    await sleep(1500);
  } finally {
    await end(d);
  }
  assert.deepEqual(tree(vault)[rel], before[rel], 'bytes, mtime and inode unchanged after opening, toggling and leaving');
  rmSync(base, { recursive: true, force: true });
});

void spawnApp; void quitApp; void waitExit;
