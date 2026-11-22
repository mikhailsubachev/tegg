// Slice AND-1, LA (the test APK on the arm64 emulator; contract §12): docs/acceptance/android-shell.md
// - FR-SYN-03 AC-33 "The index settles and still sees changes, on the device" (F1; T2);
// - FR-SYN-06 AC-50, device part: the shell fixture plus the Stray, three notes opened, HOME and back, 60 s: the vault is
//   untouched (D-2007; T1). The tidy job is allowed in the test environment (`TEGG_TEST_TIDY=1`,
//   `TEGG_TEST_QUIET_MS=200`), so a tidy run on the phone would show;
// - FR-FMT-12 AC-14, device part: a note stored in NFD bytes on a file system that doesn't normalise names (AP-2029;
//   T1, T2), and both forms beside each other (a name conflict, AC-3).
// Red-test reading (reported): notes are "opened" with the app's own IPC (`note_read`, as the page does) or with
// `TEGG_ROUTE`, as the LA harness has no navigation driver. Every test starts with `ready()` (requireDevice: fails,
// never skips, without an emulator). Written from the ACs and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adb, appops, clearPrivate, cpuTicks, eventually, fileState, forceStop, hex, home, install, listHex, perfMarks, pushShell, quote, requireDevice,
  resume, searchPaths, sh, SHARED, sleep, start, TEST_APK, TEST_ID, webview, writeShared, writeTestEnv, type WebView,
} from './helpers/device.ts';

const UVODNI = 'Pages/Úvodní stránka.md';
const EVA = 'Tasks/Zavolat Evě.md';
const EVA_ID_RE = /^id:\s*(\S+)/m;
const STRAY = 'Pages/Zavolat Petrovi.md';
const STRAY_TEXT = '---\nid: 01JAND1STRAY00000000000000\ntype: task\ntitle: Zavolat Petrovi\nstatus: todo\n---\nZavolat Petrovi kvůli chalupě.\n';
const SIDEBAR = 'nav[aria-label="Sidebar"]';

let installed = false;
const views: WebView[] = [];
function ready() {
  requireDevice();
  if (!installed) { install(TEST_APK); installed = true; }
}
after(() => {
  for (const v of views) v.close();
  adb(['shell', `rm -rf ${SHARED}/Documents/tegg-la-*`]);
});

async function launch(vault: string, env: Record<string, string> = {}): Promise<{ pid: number; v: WebView }> {
  forceStop(TEST_ID);
  clearPrivate(TEST_ID);
  appops(TEST_ID, 'allow');
  writeTestEnv(TEST_ID, { TEGG_VAULT: vault, ...env });
  const pid = start(TEST_ID);
  const v = await webview(TEST_ID);
  views.push(v);
  assert.ok(await v.waitFor(SIDEBAR, 30_000), 'the vault opens');
  return { pid, v };
}
const idleMarks = () => perfMarks(TEST_ID).filter((m) => m.mark === 'index-idle');
async function listPaths(v: WebView, type: string): Promise<{ path: string; id: string | null }[]> {
  const r = await v.invoke<{ ok: boolean; v: { path: string; id: string | null }[] }>('index_list', { type });
  assert.ok(r.ok, `index_list ${type}: ${JSON.stringify(r)}`);
  return r.v.map((x) => ({ ...x, path: x.path.normalize('NFC') }));
}
function changedFiles(a: Record<string, unknown>, b: Record<string, unknown>, except: string[] = []): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !except.includes(k.normalize('NFC')) && JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
}

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-33

test('fr_syn_03_ac33_index_settles_on_android', async () => {
  ready();
  const vault = pushShell();
  const before = fileState(vault);
  const eva = sh(`cat ${quote(`${vault}/${EVA}`)}`);
  const evaId = EVA_ID_RE.exec(eva)?.[1];
  const { pid, v } = await launch(vault);
  const first = await eventually(() => idleMarks(), (m) => m.length > 0, 60_000, 500);
  assert.ok(first.length > 0, 'the perf log has an index-idle mark');
  const c0 = cpuTicks(pid);
  await sleep(30_000);
  const c1 = cpuTicks(pid);
  const marks = idleMarks();
  const window = marks.filter((m) => m.ms >= first[0].ms && m.ms <= first[0].ms + 30_000);
  assert.equal(window.length, 1, `exactly one index-idle mark in the 30 s after the first (F1): ${marks.map((m) => Math.round(m.ms)).join(', ')}`);
  const cpu = (c1.ticks - c0.ticks) / c1.hz;
  assert.ok(cpu <= 1.5, `at most 1.5 s of CPU over those 30 s (5 %); used ${cpu.toFixed(2)} s`);

  // (a) a line appended to Úvodní is found within 2 s.
  sh(`printf '%s\\n' 'Kuřátko na zahradě.' >> ${quote(`${vault}/${UVODNI}`)}`);
  const found = await eventually(() => searchPaths(v, 'kuřátko'), (p) => p.includes(UVODNI), 2000, 100);
  assert.ok(found.includes(UVODNI), '(a) index_search finds the appended line within 2 s (AC-1)');
  // (b) a new file written as a temporary file plus mv is listed within 2 s.
  writeShared(`${vault}/Pages/.Nová.md.tmp`, '---\nid: 01JAND1NOVA000000000000000\ntype: page\ntitle: Nová\n---\nNová stránka.\n');
  sh(`mv ${quote(`${vault}/Pages/.Nová.md.tmp`)} ${quote(`${vault}/Pages/Nová.md`)}`);
  const pages = await eventually(() => listPaths(v, 'page'), (l) => l.some((x) => x.path === 'Pages/Nová.md'), 2000, 100);
  assert.ok(pages.some((x) => x.path === 'Pages/Nová.md'), '(b) Pages/Nová.md is listed in Pages within 2 s');
  // (c) a rename by another program keeps the id.
  const moved = 'Tasks/Zavolat Evě a Petrovi.md';
  sh(`mv ${quote(`${vault}/${EVA}`)} ${quote(`${vault}/${moved}`)}`);
  const tasks = await eventually(() => listPaths(v, 'task'), (l) => l.some((x) => x.path === moved), 2000, 100);
  const row = tasks.find((x) => x.path === moved);
  assert.ok(row, `(c) ${moved} is in the index within 2 s`);
  assert.equal(row!.id, evaId, '(c) with Eva\'s id (AC-5)');
  assert.ok(!tasks.some((x) => x.path === EVA), '(c) the old path is gone');

  const after = fileState(vault);
  assert.deepEqual(changedFiles(before, after, [UVODNI, EVA, moved, 'Pages/Nová.md']), [], 'the vault\'s other files stay untouched');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-50

test('fr_syn_06_ac50_no_writes_and_no_jobs_on_android', async () => {
  ready();
  const vault = pushShell();
  writeShared(`${vault}/${STRAY}`, STRAY_TEXT);
  const before = fileState(vault);
  const { v } = await launch(vault, { TEGG_TEST_TIDY: '1', TEGG_TEST_QUIET_MS: '200', TEGG_ROUTE: `note/${UVODNI}` });
  for (const p of [UVODNI, EVA, 'Quick Notes/Druhý nápad.md']) {
    const r = await v.invoke<{ ok: boolean }>('note_read', { path: p });
    assert.ok(r.ok, `open ${p}`);
  }
  home();
  await sleep(1000);
  resume(TEST_ID);
  await sleep(60_000);
  assert.deepEqual(changedFiles(before, fileState(vault)), [], 'the vault is untouched (Úvodní included); the Stray stays in Pages/');
  assert.equal(sh(`ls ${quote(`${vault}/Tasks`)}`, false).includes('Zavolat Petrovi'), false, 'no tidy move to Tasks/');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-14

test('fr_fmt_12_ac14_nfd_names_on_android', async () => {
  ready();
  const vault = pushShell();
  const nfc = 'Pages/Poznámka.md';
  const nfd = nfc.normalize('NFD');
  writeShared(`${vault}/${nfd}`, '---\nid: 01JAND1POZNAMKA00000000000\ntype: page\ntitle: Poznámka\n---\nRozpočet na zahradu.\n');
  sh(`printf '%s\\n' '[[Poznámka]]' >> ${quote(`${vault}/${UVODNI}`)}`);
  assert.ok(listHex(`${vault}/Pages`).includes(hex('Poznámka.md'.normalize('NFD'))), 'setup: the note\'s name is NFD bytes on the device');
  const inode = () => sh(`stat -c %i ${quote(`${vault}/${nfd}`)}`).trim();
  const ino = inode();
  const before = fileState(vault);
  const { v } = await launch(vault);
  await eventually(() => perfMarks(TEST_ID).filter((m) => m.mark === 'index-idle'), (m) => m.length > 0, 60_000, 500);

  const pages = await listPaths(v, 'page');
  assert.equal(pages.filter((x) => x.path === nfc).length, 1, '(a) Pages lists Poznámka once');
  assert.ok((await searchPaths(v, 'zahradu')).includes(nfc), '(b) index_search("zahradu") finds it');
  const read = await v.invoke<{ ok: boolean }>('note_read', { path: nfc });
  assert.ok(read.ok, `(c) the note opens: ${JSON.stringify(read)}`);
  await sleep(1500);
  assert.deepEqual(changedFiles(before, fileState(vault)), [], '(c) opening it writes nothing');
  const link = await v.invoke<{ ok: boolean; v: { path?: string | null }[] }>('link_resolve', { from: UVODNI, targets: ['Poznámka'] });
  assert.ok(link.ok && link.v[0]?.path?.normalize('NFC') === nfc, `(e) [[Poznámka]] in Úvodní resolves to it: ${JSON.stringify(link)}`);

  // (d) an edit changes that same file.
  forceStop(TEST_ID);
  writeTestEnv(TEST_ID, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${nfc}` });
  start(TEST_ID);
  const w = await webview(TEST_ID);
  views.push(w);
  assert.ok(await w.waitFor('[aria-label="Note body"]', 20_000), 'the NFD note is open in the editor');
  await w.eval(`(() => { const el = document.querySelector('[aria-label="Note body"]'); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
  await w.type('x');
  await sleep(2000);
  const names = listHex(`${vault}/Pages`);
  assert.ok(names.includes(hex('Poznámka.md'.normalize('NFD'))), '(d) the name is still NFD bytes');
  assert.ok(!names.includes(hex('Poznámka.md')), '(d) no second Poznámka.md in NFC');
  // Red-test reading (reported): the AC's "same inode" can't hold with atomic writes (FR-SYN-02: a temp file renamed
  // over the note gives a new inode); "the same file" is checked as the same NFD-named entry and no second one.
  void ino;
  assert.equal(names.filter((n) => n === hex('Poznámka.md'.normalize('NFD'))).length, 1, '(d) one NFD-named entry');
  // D-2048: until AND-3 a file stored under an NFD name is never written on the phone; the edit fails and the file stays.
  assert.match(sh(`cat ${quote(`${vault}/${nfd}`)}`), /Rozpočet na zahradu\.\s*$/, '(d) the NFD-named file is unchanged (read-only until AND-3)');

  // Both forms: an NFC twin with another id is a name conflict; opening either writes nothing.
  forceStop(TEST_ID);
  writeShared(`${vault}/${nfc}`, '---\nid: 01JAND1POZNAMKA2000000000000\ntype: page\ntitle: Poznámka\n---\nJiná poznámka.\n');
  const both = fileState(vault);
  writeTestEnv(TEST_ID, { TEGG_VAULT: vault });
  start(TEST_ID);
  const z = await webview(TEST_ID);
  views.push(z);
  assert.ok(await z.waitFor(SIDEBAR, 30_000), 'the vault opens with both forms');
  await eventually(() => perfMarks(TEST_ID).filter((m) => m.mark === 'index-idle'), (m) => m.length > 0, 60_000, 500);
  const conflicts = await z.invoke<{ ok: boolean; v: unknown }>('index_conflicts');
  const shown = JSON.stringify(conflicts);
  assert.ok(conflicts.ok && shown.normalize('NFC').includes('Poznámka'), `both are listed as a name conflict (FR-FMT-12 AC-3): ${shown}`);
  for (const p of [nfc, nfd]) await z.invoke('note_read', { path: p });
  await sleep(1500);
  assert.deepEqual(changedFiles(both, fileState(vault)), [], 'opening either writes nothing');
});
