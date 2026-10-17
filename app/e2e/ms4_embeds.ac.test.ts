// MS4 slice 4F real-app tests (L6, Appium mac2 on the built test app): docs/acceptance/embeds.md FR-EMB-01 AC-1 (once:
// Režimy shows 12 embeds), AC-7 (once: two files from the picker), AC-12 (insertion by keyboard, atomic), AC-13 (once: ⌫
// on a selected embed); FR-EMB-02 AC-7 (once: osoba.yml); FR-EMB-03 AC-2 (atomic embed edit), AC-3 (once: a real
// external writer), AC-7 (close, ⌘Q), AC-9 (3 rounds), AC-14 (kill cycles); FR-EMB-04 AC-8 (no hang); FR-FMT-07 AC-13
// (tour: bytes, mtime, inode); FR-SYN-06 AC-10 (keyboard tour, then one write per action). The benchmark of FR-EMB-02
// AC-13 is nfr_perf_embeds.ac.test.ts (perf_embeds.ts).
// Interface: docs/contracts/ms3-shell.md §1, §6, §13 (TEGG_TEST, TEGG_APP_SUPPORT, TEGG_VAULT, TEGG_ROUTE,
// TEGG_PERF_LOG; marks `route-ready:<route>`, `note-ready`; helper e2e/helpers/external.ts) and
// docs/contracts/ms4-embeds.md (R30 names: `Embedded: <title>`, `Open <title>`, `Display as`, `Embed object`).
// Written from the ACs and contracts only (D-61). Always TEGG_TEST=1 with a temporary Application Support and a
// temporary copy of the synthetic fixture (D-62). The helpers are copied from ms3_editor.ac.test.ts and
// ms4_links.ac.test.ts (existing AC test files are not changed, TS-I3).
//
// Prerequisites as in ms3_shell.ac.test.ts: `npm run app:build`, `npm run e2e:setup`, Accessibility permission.
// TEGG_KILL_CYCLES (default 10) sets the FR-EMB-03 AC-14 cycle count (10 nightly cycles per the AC).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const APP = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app');
const EXE = join(APP, 'Contents/MacOS/tegg');
const BUNDLE_ID = 'app.tegg.desktop';
const PORT = Number(process.env.APPIUM_PORT ?? 4727);
const APPIUM_HOME = process.env.APPIUM_HOME ?? resolve(import.meta.dirname, '.appium');
const FX = join(REPO, 'tests/fixtures/vaults');
const EXTERNAL = resolve(import.meta.dirname, 'helpers/external.ts');
const MARK_TIMEOUT = 20_000;

const VK = 'Pages/Vkládání.md';
const UP = 'Pages/Úpravy.md';
const UT = 'Pages/Upravitelná.md';
const P1 = 'První odstavec k úpravě.';
const OSOBA = '.tegg/types/osoba.yml';

// ---------------------------------------------------------------- setup helpers (no AC assertions)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `tegg-ms4-4f-${name}-`));

/** A temp copy of tests/fixtures/vaults/embeds (without its README.md) plus new-empty/.tegg (embeds.md "Fixture"). */
function embedsCopy(base: string): string {
  const v = join(base, 'Vložení');
  cpSync(join(FX, 'embeds'), v, { recursive: true, filter: (src) => relative(join(FX, 'embeds'), src) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
function support(base: string): string {
  const s = join(base, 'support');
  mkdirSync(s, { recursive: true });
  writeFileSync(join(s, 'ui-state.json'), JSON.stringify({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' } }));
  return s;
}
const read = (vault: string, rel: string) => readFileSync(join(vault, rel), 'utf8');
const fixture = (rel: string) => readFileSync(join(FX, 'embeds', rel), 'utf8');
const bodyOf = (t: string) => t.replace(/^---\n[\s\S]*?\n---\n/, '');
const frontOf = (t: string) => t.slice(0, t.length - bodyOf(t).length);
const noModified = (t: string) => t.replace(/^modified: .*$/m, 'modified: <x>');
const ISO_OFFSET = /^modified: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$/m;

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
const tempFiles = (root: string) => Object.keys(tree(root)).filter((p) => p.includes('.tegg-tmp'));
const inode = (vault: string, rel: string) => lstatSync(join(vault, rel)).ino;

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
const countMark = (file: string, mark: string) => marks(file).filter((m) => m === mark).length;
async function waitMarkCount(file: string, mark: string, n: number, ms = MARK_TIMEOUT): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (countMark(file, mark) >= n) return true;
    await sleep(25);
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
  return { TEGG_TEST: '1', TEGG_APP_SUPPORT: appSupport, TEGG_PERF_LOG: perfLog, TZ: 'Europe/Prague', ...extra };
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
type Read = { t: number; sha?: string; text?: string; error?: string };
function readsOf(file: string): Read[] {
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Read) : [];
}

// System Events key codes.
const KEY: Record<string, number> = {
  a: 0, s: 1, w: 13, z: 6, o: 31, n: 45, q: 12, k: 40, v: 9, u: 32, enter: 36, escape: 53, tab: 48, delete: 51, down: 125, up: 126, right: 124,
  left: 123, end: 119, home: 115, lbracket: 33, slash: 44,
};
const osa = (...lines: string[]) => execFileSync('osascript', lines.flatMap((l) => ['-e', l]), { encoding: 'utf8' });
function press(key: keyof typeof KEY | string, mods: ('command' | 'shift' | 'control' | 'option')[] = []) {
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
const q = (label: string) => label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
async function allShown(d: Driver, predicate: string): Promise<any[]> {
  const out: any[] = [];
  for (const e of await d.$$(`-ios predicate string:${predicate}`).catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) out.push(e);
  return out;
}
async function firstShown(d: Driver, label: string): Promise<any | null> {
  const l = q(label);
  const pred = `(label == "${l}" OR title == "${l}" OR value == "${l}")`;
  for (const sel of [`elementType IN {9, 10, 12, 17, 41, 42, 80} AND ${pred}`, pred]) {
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
async function gone(d: Driver, label: string, ms = 2000): Promise<boolean> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    if (!(await firstShown(d, label))) return true;
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
/** Puts the caret at the end of the line whose text is `text` (click, then ⌘→). */
async function caretAtEnd(d: Driver, text: string) {
  assert.ok(await clickLabel(d, text), `text "${text}" found`);
  press('right', ['command']);
  await sleep(100);
}
async function openBySwitcher(d: Driver, title: string) {
  press('o', ['command']);
  assert.ok(await shown(d, 'Quick switcher'), `switcher for ${title}`);
  paste(title);
  await sleep(300);
  press('enter');
  await sleep(600);
}
async function paletteRun(d: Driver, command: string) {
  press('k', ['command']);
  assert.ok(await shown(d, 'Command palette'), `palette for ${command}`);
  paste(command);
  await sleep(300);
  press('enter');
  await sleep(500);
}
/** The embed elements shown: frames (`Embedded: <title>` groups) and link-mode embeds (described `Embedded note`). */
async function embedCount(d: Driver): Promise<{ frames: number; links: number }> {
  const frames = await allShown(d, 'label BEGINSWITH "Embedded: "');
  const links: any[] = [];
  for (const t of ['Saturnin', 'Svíčková']) {
    for (const e of await allShown(d, `label == "${q(t)}" OR title == "${q(t)}"`)) {
      const help = `${await e.getAttribute('help').catch(() => '')} ${await e.getAttribute('roleDescription').catch(() => '')} ${await e.getAttribute('AXHelp').catch(() => '')}`;
      if (/Embedded note/.test(help)) links.push(e);
    }
  }
  return { frames: frames.length, links: links.length };
}

// ---------------------------------------------------------------- preflight (fails fast on an assertion)
let pre: Promise<string | null> | undefined;
function preflight(): Promise<string | null> {
  pre ??= (async () => {
    if (!existsSync(EXE)) return `app not built: ${EXE} (cd app && npm run app:build)`;
    if (!existsSync(join(FX, 'embeds/Pages/Režimy.md'))) return 'fixture tests/fixtures/vaults/embeds is missing';
    const base = tmp('preflight');
    const log = join(base, 'perf.jsonl');
    const mark = `route-ready:note/${UP}`;
    const child = spawnApp(testEnv(support(base), log, { TEGG_VAULT: embedsCopy(base), TEGG_ROUTE: `note/${UP}`, TEGG_EXIT_AFTER: mark }));
    const ok = await waitMark(log, mark);
    quitApp(child);
    await waitExit(child);
    rmSync(base, { recursive: true, force: true });
    return ok ? null : `the app does not open note/${UP} (route-ready mark missing)`;
  })();
  return pre;
}
async function ready() {
  const why = await preflight();
  assert.equal(why, null, why ?? '');
}
type S = { base: string; vault: string; log: string; d: Driver };
/** Starts the app on `route` of a fresh fixture copy and waits for `route-ready`. */
async function on(name: string, route: string, extra: Env = {}): Promise<S> {
  const base = tmp(name);
  const vault = embedsCopy(base);
  const log = join(base, 'perf.jsonl');
  const d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: route, ...extra }));
  assert.ok(await waitMark(log, `route-ready:${route}`), `${route} shown`);
  return { base, vault, log, d };
}
/** Opens the `Embed object` picker in a new paragraph below `Odstavec před.` by keyboard (Vkládání). */
async function pickerBelowFirst(d: Driver) {
  assert.ok(await shown(d, 'Note body', 5000), 'the editor');
  await caretAtEnd(d, 'Odstavec před.');
  press('enter');
  typeAscii('/emb');
  assert.ok(await shown(d, 'Embed object', 2000), 'the slash menu lists Embed object');
  press('enter');
  assert.ok(await shown(d, 'Embed suggestions', 2000), 'the picker (listbox Embed suggestions)');
}

// ---------------------------------------------------------------- FR-EMB-01

test('fr_emb_01_ac1_rezimy_shows_12_embeds_in_the_built_app', { timeout: 240_000 }, async () => {
  await ready();
  const s = await on('emb01-1', 'note/Pages/Režimy.md');
  try {
    assert.ok(await waitMark(s.log, 'note-ready'), 'note-ready');
    let c = { frames: 0, links: 0 };
    const endAt = Date.now() + 5000;
    while (Date.now() < endAt && c.frames + c.links < 12) { c = await embedCount(s.d); await sleep(200); }
    assert.equal(c.frames, 10, 'exactly 10 frames (full and card)');
    // D-442: the link-mode embeds are counted through AX when their description is exposed, else through the mark
    // `embeds-rendered:<n>` the app writes with TEGG_TEST=1.
    if (c.links !== 2) assert.ok(await waitMark(s.log, 'embeds-rendered:12', 3000), `2 link-mode embeds (AX found ${c.links}; mark embeds-rendered:12)`);
  } finally {
    await end(s.d);
  }
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_emb_01_ac7_create_from_the_picker_writes_two_files', { timeout: 300_000 }, async () => {
  await ready();
  const s = await on('emb01-7', `note/${VK}`);
  const t0 = tree(s.vault);
  let t1: Record<string, Entry> = {};
  try {
    await pickerBelowFirst(s.d);
    paste('Nová kapitola');
    assert.ok(await shown(s.d, 'Create "Nová kapitola"', 2000), 'Create "Nová kapitola"');
    press('enter');
    const a = await waitFile(s.vault, 'Quick Notes/Nová kapitola.md', (t) => /^type: quick-note$/m.test(t), 3000);
    assert.ok(a, 'Quick Notes/Nová kapitola.md created with the default type');
    assert.ok(await waitFile(s.vault, VK, (t) => t.includes('![[Nová kapitola]]'), 3000), 'Vkládání holds ![[Nová kapitola]]');
    await sleep(1500);
    t1 = tree(s.vault);
    assert.deepEqual(changedPaths(t0, t1), ['Pages/Vkládání.md', 'Quick Notes/Nová kapitola.md'].map((p) => p.normalize('NFC')).sort(), 'exactly two files written');
    assert.ok(await shown(s.d, 'Empty note', 2000), 'the new embed shows Empty note');
    await caretAtEnd(s.d, 'Odstavec po.');
    press('enter');
    typeAscii('/emb');
    assert.ok(await shown(s.d, 'Embed object', 2000), 'slash menu');
    press('enter');
    paste('C# nápad');
    assert.ok(await shown(s.d, 'Create "C# nápad"', 2000), 'Create "C# nápad"');
    press('enter');
    assert.ok(await waitFile(s.vault, 'Quick Notes/C nápad.md', (t) => /^type: quick-note$/m.test(t), 3000), 'Quick Notes/C nápad.md created');
    assert.ok(await waitFile(s.vault, VK, (t) => t.includes('![[C nápad]]'), 3000), 'Vkládání holds ![[C nápad]]');
    await sleep(1500);
  } finally {
    await end(s.d);
  }
  assert.deepEqual(changedPaths(t1, tree(s.vault)), ['Pages/Vkládání.md', 'Quick Notes/C nápad.md'].map((p) => p.normalize('NFC')).sort(), 'exactly two files written by the second choice');
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_emb_01_ac12_insert_by_keyboard_is_atomic', { timeout: 300_000 }, async () => {
  await ready();
  const s = await on('emb01-12', `note/${VK}`);
  const before = tree(s.vault);
  const ino0 = inode(s.vault, VK);
  const reads = join(s.base, 'reads.jsonl');
  let poller: ChildProcess | undefined;
  let at = 0;
  let got: { text: string; at: number } | null = null;
  try {
    // Keyboard only: the note opens with the focus on the title (D-130); ↓ enters the body, End ends the first line.
    press('down');
    press('end');
    press('enter');
    typeAscii('/emb');
    assert.ok(await shown(s.d, 'Embed object', 2000), 'the slash menu lists Embed object');
    press('enter');
    assert.ok(await shown(s.d, 'Embed suggestions', 2000), 'the picker');
    typeAscii('cil');
    await sleep(400);
    poller = spawn(process.execPath, [EXTERNAL, 'poll', join(s.vault, VK), '5', '4000', reads], { stdio: 'ignore' });
    await sleep(100);
    press('enter');
    at = Date.now();
    got = await waitFile(s.vault, VK, (t) => t.includes('![[Cíl]]'), 3000);
    await new Promise((r) => poller!.on('exit', r));
    poller = undefined;
  } finally {
    poller?.kill('SIGTERM');
    await end(s.d);
  }
  assert.ok(got, 'Vkládání is written');
  assert.ok(got!.at - at <= 1200, `on disk ${got!.at - at} ms after the choice (≤ 1,200 ms)`);
  const orig = fixture('Pages/Vkládání.md');
  assert.equal(bodyOf(got!.text), 'Odstavec před.\n\n![[Cíl]]\n\nOdstavec po.\n', 'exactly the AC-5 body');
  assert.equal(noModified(frontOf(got!.text)), noModified(frontOf(orig)), 'the frontmatter differs only in modified');
  assert.match(frontOf(got!.text), ISO_OFFSET, 'modified is ISO 8601 with offset');
  const final = read(s.vault, VK);
  const bad = readsOf(reads).filter((r) => r.error !== undefined || (r.text !== orig && r.text !== final));
  assert.deepEqual(bad.map((r) => r.t), [], 'a reader sees only complete versions (temp file + rename, FR-SYN-02)');
  assert.notEqual(inode(s.vault, VK), ino0, 'replaced through a rename (new inode)');
  assert.deepEqual(tempFiles(s.vault), [], 'no .tegg-tmp file left');
  assert.deepEqual(changedPaths(before, tree(s.vault)), [VK.normalize('NFC')], 'every other file keeps bytes, mtime and inode; no file created');
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_emb_01_ac13_backspace_on_a_selected_embed_never_touches_its_target', { timeout: 240_000 }, async () => {
  await ready();
  const s = await on('emb01-13', `note/${UP}`);
  const before = tree(s.vault);
  try {
    assert.ok(await shown(s.d, 'Embedded: Upravitelná', 5000), 'the Upravitelná embed is shown');
    await caretAtEnd(s.d, 'Hostitel před.');
    press('down');
    await sleep(200);
    press('delete');
    const got = await waitFile(s.vault, UP, (t) => !t.includes('Hostitel před.\n\n![[Upravitelná]]'), 3000);
    assert.ok(got, 'Úpravy is saved');
    assert.equal(bodyOf(got!.text), bodyOf(fixture(UP)).replace('![[Upravitelná]]\n\nHostitel mezi.', 'Hostitel mezi.'), '⌫ removes only that paragraph');
    await sleep(1500);
  } finally {
    await end(s.d);
  }
  assert.deepEqual(changedPaths(before, tree(s.vault)), [UP.normalize('NFC')], 'Pages/Upravitelná.md keeps bytes, mtime and inode; nothing trashed or deleted');
  rmSync(s.base, { recursive: true, force: true });
});

// ---------------------------------------------------------------- FR-EMB-02

test('fr_emb_02_ac7_default_mode_writes_osoba_yml_once', { timeout: 240_000 }, async () => {
  await ready();
  const s = await on('emb02-7', 'type-settings/osoba');
  const before = tree(s.vault);
  try {
    assert.ok(await shown(s.d, 'Default embed mode', 5000), 'radiogroup Default embed mode');
    assert.ok(await clickLabel(s.d, 'Full'), 'radio Full');
    const got = await waitFile(s.vault, OSOBA, (t) => t.includes('embed:'), 3000);
    assert.ok(got, 'osoba.yml is written');
    assert.equal(got!.text, fixture(OSOBA).replace('preview: [firma, role]\n', 'preview: [firma, role]\nembed: full\n'), 'exactly the line embed: full after preview');
    await sleep(1500);
  } finally {
    await end(s.d);
  }
  assert.deepEqual(changedPaths(before, tree(s.vault)), [OSOBA], 'only .tegg/types/osoba.yml changes; no note file is written');
  assert.deepEqual(tempFiles(s.vault), [], 'no .tegg-tmp file left');
  rmSync(s.base, { recursive: true, force: true });
});

// ---------------------------------------------------------------- FR-EMB-03

test('fr_emb_03_ac2_embed_edit_is_atomic_on_disk', { timeout: 300_000 }, async () => {
  await ready();
  const s = await on('emb03-2', `note/${UP}`);
  const before = tree(s.vault);
  const ino0 = inode(s.vault, UT);
  const reads = join(s.base, 'reads.jsonl');
  const orig = fixture(UT);
  let poller: ChildProcess | undefined;
  let got: { text: string; at: number } | null = null;
  let last = 0;
  try {
    assert.ok(await shown(s.d, 'Embedded: Upravitelná', 5000), 'the Upravitelná embed is shown');
    poller = spawn(process.execPath, [EXTERNAL, 'poll', join(s.vault, UT), '5', '6000', reads], { stdio: 'ignore' });
    await caretAtEnd(s.d, P1);
    paste(' Doplněno.');
    last = Date.now();
    got = await waitFile(s.vault, UT, (t) => t.includes(`${P1} Doplněno.`), 4000);
    await new Promise((r) => poller!.on('exit', r));
    poller = undefined;
    await sleep(500);
  } finally {
    poller?.kill('SIGTERM');
    await end(s.d);
  }
  assert.ok(got, 'the edit reaches Pages/Upravitelná.md');
  assert.ok(got!.at - last <= 1200, `on disk ${got!.at - last} ms after the last key (≤ 1,200 ms)`);
  assert.equal(noModified(got!.text), noModified(orig.replace(P1, `${P1} Doplněno.`)), 'only that paragraph and modified differ');
  const final = read(s.vault, UT);
  const bad = readsOf(reads).filter((r) => r.error !== undefined || (r.text !== orig && r.text !== final));
  assert.deepEqual(bad.map((r) => r.t), [], 'a reader every 5 ms sees only complete versions');
  assert.notEqual(inode(s.vault, UT), ino0, 'replaced through a rename (new inode)');
  assert.deepEqual(tempFiles(s.vault), [], 'no .tegg-tmp file left');
  assert.deepEqual(changedPaths(before, tree(s.vault)), [UT.normalize('NFC')], 'Pages/Úpravy.md and every other file keep bytes, mtime and inode');
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_emb_03_ac3_real_external_writer_with_an_unsaved_embed_edit', { timeout: 240_000 }, async () => {
  await ready();
  const s = await on('emb03-3', `note/${UP}`);
  const theirs = fixture(UT).replace('Text třetí části.', 'Text třetí části jinde.');
  const up0 = tree(s.vault)[UP.normalize('NFC')];
  try {
    assert.ok(await shown(s.d, 'Embedded: Upravitelná', 5000), 'the Upravitelná embed is shown');
    await caretAtEnd(s.d, P1);
    typeAscii('M');
    externalWrite(join(s.vault, UT), theirs);
    assert.ok(await shown(s.d, 'Note changed outside Tegg', 2500), 'the dialog Note changed outside Tegg within 2 s');
    assert.equal(read(s.vault, UT), theirs, "the file keeps the other program's bytes while the dialog is open");
    await sleep(1500);
    assert.equal(read(s.vault, UT), theirs, 'no write of the editor’s version');
  } finally {
    await end(s.d);
  }
  assert.deepEqual(tree(s.vault)[UP.normalize('NFC')], up0, 'Úpravy is not written');
  rmSync(s.base, { recursive: true, force: true });
});

for (const [how, key] of [['window_close', 'w'], ['quit', 'q']] as const) {
  test(`fr_emb_03_ac7_flush_on_${how}`, { timeout: 240_000 }, async () => {
    await ready();
    const s = await on(`emb03-7${key}`, `note/${UP}`);
    try {
      assert.ok(await shown(s.d, 'Embedded: Upravitelná', 5000), 'the Upravitelná embed is shown');
      await caretAtEnd(s.d, P1);
      typeAscii('Z');
      press(key, ['command']);
      await sleep(3000);
    } finally {
      await end(s.d);
    }
    assert.ok(read(s.vault, UT).includes(`${P1}Z`), `Pages/Upravitelná.md contains the embed edit after ${how === 'quit' ? '⌘Q' : 'the window closes'}`);
    assert.equal(read(s.vault, UP), fixture(UP), 'Úpravy keeps its bytes');
    rmSync(s.base, { recursive: true, force: true });
  });
}

// D-441 (AP-343): FR-EMB-03 AC-13's quit question with a failed embed write, made to fail by a read-only `Pages/` as
// editor.md FR-EDT-08 AC-11 (ms3_editor.ac.test.ts).
test('fr_emb_03_ac13_quit_without_saving_after_a_failed_embed_write', { timeout: 300_000 }, async () => {
  await ready();
  const s = await on('emb03-13', `note/${UP}`);
  const pages = join(s.vault, 'Pages');
  try {
    assert.ok(await shown(s.d, 'Embedded: Upravitelná', 5000), 'the Upravitelná embed is shown');
    chmodSync(pages, 0o555);
    await caretAtEnd(s.d, P1);
    typeAscii('Q');
    assert.ok(await shown(s.d, 'Not saved', 4000), 'Save state Not saved');
    assert.ok(await shown(s.d, 'Try again'), 'the alert with Try again');
    press('q', ['command']);
    assert.ok(await shown(s.d, 'Quit without saving?', 4000), 'dialog Quit without saving?');
    assert.ok(await clickLabel(s.d, 'Cancel'), 'Cancel');
    chmodSync(pages, 0o755);
    const got = await waitFile(s.vault, UT, (t) => t.includes(`${P1}Q`), 7000);
    assert.ok(got, 'the retry saves the embed edit within 5 s');
    assert.equal(read(s.vault, UP), fixture(UP), 'Úpravy keeps its bytes');
  } finally {
    try { chmodSync(pages, 0o755); } catch { /* gone */ }
    await end(s.d);
  }
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_emb_03_ac9_never_into_the_wrong_file_3_rounds', { timeout: 600_000 }, async () => {
  await ready();
  const s = await on('emb03-9', `note/${UP}`);
  const before = tree(s.vault);
  let h = '', e = '';
  try {
    assert.ok(await shown(s.d, 'Embedded: Upravitelná', 5000), 'the Upravitelná embed is shown');
    for (let n = 1; n <= 3; n++) {
      await caretAtEnd(s.d, `Hostitel mezi.${h}`);
      typeAscii(`H${n}`); h += `H${n}`;
      await caretAtEnd(s.d, `${P1}${e}`);
      typeAscii(`E${n}`); e += `E${n}`;
    }
    await caretAtEnd(s.d, 'Hostitel po.');
    await sleep(2500);
  } finally {
    await end(s.d);
  }
  assert.ok(read(s.vault, UP).includes(`Hostitel mezi.${h}\n`), 'Úpravy has exactly the H strings in order');
  assert.ok(!/E\d/.test(bodyOf(read(s.vault, UP))), 'no E string in Úpravy');
  assert.ok(read(s.vault, UT).includes(`${P1}${e}\n`), 'Upravitelná has exactly the E strings in order');
  assert.ok(!/H\d/.test(bodyOf(read(s.vault, UT))), 'no H string in Upravitelná');
  assert.deepEqual(changedPaths(before, tree(s.vault)), [UT, UP].map((p) => p.normalize('NFC')).sort(), 'no other file written');
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_emb_03_ac14_killed_while_typing_in_an_embed_cycles', { timeout: 60 * 60_000 }, async () => {
  await ready();
  const cycles = Number(process.env.TEGG_KILL_CYCLES ?? 10);
  const base = tmp('emb03-14');
  const vault = embedsCopy(base);
  const upOrig = fixture(UP);
  const utOrig = fixture(UT);
  const problems: string[] = [];
  let d: Driver | undefined;
  for (let c = 0; c < cycles; c++) {
    const log = join(base, `perf-${c}.jsonl`);
    try {
      d = await session(testEnv(join(base, 'support'), log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${UP}` }));
      assert.ok(await waitMark(log, 'note-ready'), `cycle ${c}: start`);
      assert.ok(await shown(d, 'Embedded: Upravitelná', 5000), `cycle ${c}: the embed is shown`);
      const before = read(vault, UT);
      const prev = before.slice(before.indexOf(P1) + P1.length).split('\n')[0];
      await caretAtEnd(d, P1 + prev);
      const killAt = Date.now() + 2000 + Math.floor(Math.random() * 8000);
      const times: number[] = [];
      let typed = '';
      while (Date.now() < killAt) { typeAscii('k'); typed += 'k'; times.push(Date.now()); await sleep(50); }
      const pid = Number(execFileSync('pgrep', ['-n', '-f', EXE], { encoding: 'utf8' }).trim());
      process.kill(pid, 'SIGKILL');
      await end(d);
      d = undefined;
      const after = read(vault, UT);
      if (!/^---\n[\s\S]*?\n---\n/.test(after) || !/^id: 01JB4F0000000000000000E022$/m.test(after)) { problems.push(`cycle ${c}: frontmatter invalid`); continue; }
      const line = after.slice(after.indexOf(P1) + P1.length).split('\n')[0];
      const added = line.slice(prev.length);
      if (!line.startsWith(prev) || !typed.startsWith(added)) problems.push(`cycle ${c}: the first paragraph isn't the old text + a prefix of the typed text`);
      const lost = typed.length - added.length;
      const allowed = times.filter((t) => t > killAt - 1200).length;
      if (lost > allowed) problems.push(`cycle ${c}: lost ${lost} keys, allowed ${allowed} (last 1.2 s)`);
      if (noModified(after).replace(P1 + line, P1) !== noModified(utOrig)) problems.push(`cycle ${c}: other bytes of Upravitelná changed`);
      if (read(vault, UP) !== upOrig) problems.push(`cycle ${c}: Pages/Úpravy.md changed`);
    } finally {
      await end(d);
      d = undefined;
    }
  }
  assert.deepEqual(problems, [], 'every kill leaves a valid Upravitelná with a prefix of the typed text and Úpravy byte-identical');
  rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------- FR-EMB-04

test('fr_emb_04_ac8_no_hang_on_cycles_and_depth', { timeout: 300_000 }, async () => {
  await ready();
  const s = await on('emb04-8', `note/${VK}`);
  const before = tree(s.vault);
  try {
    assert.ok(await waitMark(s.log, 'note-ready'), 'Vkládání ready');
    for (const t of ['Sama sebe', 'Kruh A', 'Obsah', 'Řetěz 1']) {
      const n = countMark(s.log, 'note-ready');
      const t0 = Date.now();
      await openBySwitcher(s.d, t);
      assert.ok(await waitMarkCount(s.log, 'note-ready', n + 1, 2000 - (Date.now() - t0) + 600), `${t}: note-ready within 2 s`);
      assert.ok(await firstShown(s.d, t === 'Řetěz 1' ? 'Embedded: Řetěz 2' : `Embedded: ${t === 'Kruh A' ? 'Kruh B' : t}`), `${t}: its embed frame is shown`);
      const k0 = Date.now();
      press('k', ['command']);
      assert.ok(await shown(s.d, 'Command palette', 500), `${t}: ⌘K opens the palette within 500 ms`);
      assert.ok(Date.now() - k0 <= 1500, `${t}: palette in ${Date.now() - k0} ms`);
      press('escape');
      assert.ok(await gone(s.d, 'Command palette', 1000), `${t}: Esc closes it`);
    }
    await sleep(1500);
  } finally {
    await end(s.d);
  }
  assert.deepEqual(changedPaths(before, tree(s.vault)), [], 'no vault file changes bytes, mtime or inode');
  rmSync(s.base, { recursive: true, force: true });
});

// ---------------------------------------------------------------- FR-FMT-07 AC-13 and FR-SYN-06 AC-10

const HOSTS = ['Režimy', 'Sekce', 'Rozbitá vložení', 'Uvnitř textu', 'NFD vložení', 'Kruh A', 'Kruh B', 'Sama sebe', 'Obsah', 'Karta sebe', 'Řetěz 1',
  'Kosočtverec', 'Úpravy', 'Vkládání', 'Vložení dvojníka'];
const TARGETS = ['Cíl', 'Upravitelná', 'Jana Nováková', 'Svíčková', 'Saturnin', 'Zavolat Janě', 'Praha', '2026-10-07', 'Řetěz 5', 'List', 'Bez hlavičky'];
/** Host texts to put the caret in, per note (one per host paragraph). */
const HOST_TEXTS: Record<string, string[]> = {
  'Režimy': ['Před vloženími.', 'Po vloženích.'], 'Úpravy': ['Hostitel před.', 'Hostitel mezi.', 'Hostitel po.'], 'Vkládání': ['Odstavec před.', 'Odstavec po.'],
  'Kruh A': ['Začátek A.'], 'Sama sebe': ['Před vložením sebe.', 'Po vložení sebe.'], 'Řetěz 1': ['Úroveň 1.'], 'Karta sebe': ['Karta sama sebe:'],
};
/** Embedded texts to enter (and leave with Esc) in editable embeds, per note. */
const EMBED_TEXTS: Record<string, string[]> = {
  'Režimy': ['Úvodní odstavec cíle.', 'Zápis dne.'], 'Úpravy': [P1, 'Text bez hlavičky.', 'Text druhé části.'], 'Kruh A': ['Začátek B.'], 'Řetěz 1': ['Úroveň 2.'],
  'Kosočtverec': ['Větev jedna.', 'Větev dvě.'], 'Vložení dvojníka': ['Rychlý dvojník.'],
};

/** The reading tour on the open note: caret in host blocks, into and out of editable embeds, every Display as menu
 *  opened and closed (Esc), scroll to the end. Returns how many Display as menus it opened. */
async function tour(d: Driver, title: string): Promise<number> {
  for (const t of HOST_TEXTS[title] ?? []) { await clickLabel(d, t); press('right', ['command']); }
  for (const t of EMBED_TEXTS[title] ?? []) { await clickLabel(d, t); press('escape'); await sleep(150); }
  let menus = 0;
  for (const b of await allShown(d, 'label == "Display as" OR title == "Display as"')) {
    await b.click().catch(() => {});
    if (await shown(d, 'Full', 800)) menus++;
    press('escape');
    await sleep(150);
  }
  press('end', ['command']);
  await sleep(200);
  return menus;
}

test('fr_fmt_07_ac13_showing_embeds_leaves_every_file_unchanged', { timeout: 900_000 }, async () => {
  await ready();
  const s = await on('fmt07-13', 'note/Pages/Režimy.md');
  const before = tree(s.vault);
  let menus = 0;
  try {
    assert.ok(await shown(s.d, 'Embedded: Cíl', 5000), 'Režimy shows its embeds');
    for (const t of [...HOSTS, ...TARGETS]) {
      if (t !== 'Režimy') await openBySwitcher(s.d, t);
      menus += await tour(s.d, t);
    }
    assert.ok(menus > 0, 'Display as menus were opened');
    await openBySwitcher(s.d, 'C# tips');
    await sleep(3000);
  } finally {
    await end(s.d);
  }
  assert.deepEqual(changedPaths(before, tree(s.vault)), [], 'every vault file keeps bytes, mtime and inode; no file created');
  rmSync(s.base, { recursive: true, force: true });
});

test('fr_syn_06_ac10_keyboard_tour_writes_nothing_then_one_write_per_action', { timeout: 1_200_000 }, async () => {
  await ready();
  const s = await on('syn06-10', 'note/Pages/Režimy.md');
  const before = tree(s.vault);
  let snap: Record<string, Entry> = {};
  try {
    assert.ok(await shown(s.d, 'Embedded: Cíl', 5000), 'Režimy shows its embeds');
    for (const t of HOSTS) {
      if (t !== 'Režimy') await openBySwitcher(s.d, t);
      await tour(s.d, t);
      // Every embed's Open followed, then Back (⌘[).
      const opens = (await allShown(s.d, 'label BEGINSWITH "Open "')).length;
      for (let i = 0; i < opens; i++) {
        const b = (await allShown(s.d, 'label BEGINSWITH "Open "'))[i];
        if (!b) break;
        await b.click().catch(() => {});
        await sleep(400);
        press('lbracket', ['command']);
        await sleep(500);
      }
    }
    await openBySwitcher(s.d, 'Vkládání');
    await pickerBelowFirst(s.d);
    press('escape');
    await sleep(300);
    await paletteRun(s.d, 'Go to type: Osoby');
    assert.ok(await clickLabel(s.d, 'Type settings'), 'Type settings');
    assert.ok(await shown(s.d, 'Default embed mode', 3000), 'type-settings/osoba visited');
    await sleep(3000);
    snap = tree(s.vault);
    assert.deepEqual(changedPaths(before, snap), [], 'the tour leaves every file’s bytes, mtime and inode unchanged and creates nothing');

    const action = async (what: string, want: string, act: () => Promise<void>, done: () => Promise<boolean>) => {
      const a = tree(s.vault);
      await act();
      const endAt = Date.now() + 4000;
      while (!(await done()) && Date.now() < endAt) await sleep(50);
      assert.ok(await done(), `${what}: done`);
      await sleep(1500);
      assert.deepEqual(changedPaths(a, tree(s.vault)), [want.normalize('NFC')], `${what}: exactly ${want}`);
    };
    await openBySwitcher(s.d, 'Vkládání');
    await action('one slash-menu insertion', VK, async () => {
      await pickerBelowFirst(s.d);
      typeAscii('cil');
      await sleep(400);
      press('enter');
    }, async () => read(s.vault, VK).includes('![[Cíl]]'));
    await openBySwitcher(s.d, 'Režimy');
    await action('one Display as change', 'Pages/Režimy.md', async () => {
      const b = (await allShown(s.d, 'label == "Display as" OR title == "Display as"'))[1];
      assert.ok(b, "Display as on Jana's card");
      await b.click();
      assert.ok(await clickLabel(s.d, 'Full'), 'Full');
    }, async () => read(s.vault, 'Pages/Režimy.md').includes('![[Jana Nováková|full]]'));
    await openBySwitcher(s.d, 'Úpravy');
    await action('one embed edit', UT, async () => {
      await caretAtEnd(s.d, P1);
      typeAscii(' Jednou');
    }, async () => read(s.vault, UT).includes(`${P1} Jednou`));
    await paletteRun(s.d, 'Go to type: Osoby');
    assert.ok(await clickLabel(s.d, 'Type settings'), 'Type settings');
    await action('one default change', OSOBA, async () => {
      assert.ok(await clickLabel(s.d, 'Full'), 'radio Full');
    }, async () => read(s.vault, OSOBA).includes('embed: full'));
  } finally {
    await end(s.d);
  }
  rmSync(s.base, { recursive: true, force: true });
});
