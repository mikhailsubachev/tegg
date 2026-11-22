// Slice AND-1, LA (the test APK on the arm64 emulator, driven by adb and CDP; contract §12, CP-4 → D-2039):
// docs/acceptance/android-shell.md AR-03 AC-8, AC-10; FR-VLT-01 AC-18…AC-22, AC-25…AC-28; FR-STO-07 AC-13;
// FR-EDT-08 AC-14; FR-UX-01 AC-7; AR-08 AC-5; NFR-SEC-01 AC-3 (the socket monitor around the run, checked last).
// Each test pushes a fresh copy of its synthetic fixture to `/sdcard/Documents/tegg-la-<random>/` (D-62), sets "All
// files access" with `appops`, gives test hooks through `test-env.json` (contract §7.1) and reads private files with
// `run-as`. Every test starts with `requireDevice()`: without an emulator it fails (never skips).
//
// Red-test readings (reported to the owner):
// - AC-18's "UiAutomator dump every 250 ms" is a CDP MutationObserver installed as soon as the WebView answers (CP-4);
//   the first frames before the DevTools socket opens are not observed.
// - Notes are opened with `TEGG_ROUTE` (contract §7.1) or the app's own IPC (`note_read`), and the theme is switched
//   with `ui_state_set` (FR-STO-07 AC-13), as the LA harness has no palette driver.
// - The release build of FR-UX-01 AC-7 and AR-08 AC-5 is a release-variant APK built for 0.5.0 and signed with the
//   throwaway test key, named by `TEGG_LA_RELEASE_APK` (the owner's key never runs in a gate); its private files are
//   written with `adb root` (google_apis image), as it isn't debuggable.
// - "The private files dir's listing is the same" (FR-VLT-01 AC-20) leaves out the perf log, which the test itself asks
//   the app to write there (contract §7.1).
// Written from the ACs and the contract only (D-61).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  adb, adbRoot, appops, back, clearPrivate, eventually, fileState, forceStop, foregroundPackage, hex, home, install, listHex, mainLabel,
  perfMarks, pidOf, pushShell, pushVault, quote, releaseApk, RELEASE_ID, REPO, requireDevice, resume, runAs, searchPaths, sh, SHARED,
  SHELL_COUNTS, sleep, socketsOf, start, tapText, TEST_APK, TEST_ID, typeCounts, uiDump, uidOf, webview, writeShared, writeTestEnv,
  inputText, deviceAttached, type WebView,
} from './helpers/device.ts';
import { startMonitor } from './helpers/socket-monitor.ts';

const UVODNI = 'Pages/Úvodní stránka.md';
const EVA = 'Tasks/Zavolat Evě.md';
const CHOOSER = 'main[aria-label="Choose a vault"]';
const ACCESS = 'main[aria-label="Allow access to your notes"]';
const SIDEBAR = 'nav[aria-label="Sidebar"]';
const S = {
  accessTitle: 'Allow access to your notes',
  openSettings: 'Open settings',
  stillOff: 'Access is still off. Turn on “Allow access to manage all files” for Tegg.',
  found: 'Vaults on this phone',
  fullPath: 'Enter the full path of the folder, starting with /storage/emulated/0/.',
  outsideShared: 'Tegg can open vaults in this phone\'s shared storage only, for example in Documents.',
  notAVault: 'This folder isn\'t a Tegg vault.',
  notAVaultHint: 'Open a folder that holds .tegg/vault.yml, or create a new vault.',
  notFound: 'The file or folder wasn’t found.',
};

let views: WebView[] = [];
let stopMonitor: (() => void) | null = null;
let monitorLog = '';

let installed = false;
/** Each test's first step: the device (asserted, never skipped) and the test APK installed once. */
function ready() {
  requireDevice();
  if (!installed) { install(TEST_APK); installed = true; }
}
before(() => {
  // No assertion here: without a device every test fails at ready() with its own AssertionError.
  monitorLog = join(mkdtempSync(join(tmpdir(), 'tegg-la-sockets-')), 'sockets.jsonl');
  if (deviceAttached()) stopMonitor = startMonitor(monitorLog);
});
after(() => {
  stopMonitor?.();
  for (const v of views) v.close();
  adb(['shell', `rm -rf ${SHARED}/Documents/tegg-la-* ${quote(`${SHARED}/Documents/Můj trezor`)} ${quote(`${SHARED}/Documents/${'Poznámky'.normalize('NFD')}`)}`]);
});

/** A fresh start of the test APK: private files cleared, access set, `test-env.json` written, cold start. */
async function launch(o: { vault?: string; access?: 'allow' | 'deny'; env?: Record<string, string>; keepPrivate?: boolean } = {}): Promise<{ pid: number; v: WebView }> {
  forceStop(TEST_ID);
  if (!o.keepPrivate) clearPrivate(TEST_ID);
  appops(TEST_ID, o.access ?? 'allow');
  writeTestEnv(TEST_ID, { ...(o.vault ? { TEGG_VAULT: o.vault } : {}), ...(o.env ?? {}) });
  const pid = start(TEST_ID);
  const v = await webview(TEST_ID);
  views.push(v);
  return { pid, v };
}
const text = (v: WebView, selector: string) => v.eval<string>(`(document.querySelector(${JSON.stringify(selector)})?.innerText ?? '')`);
const hasText = (v: WebView, t: string) => v.eval<boolean>(`document.body.innerText.includes(${JSON.stringify(t)})`);
const vaultOpen = (v: WebView, ms = 15_000) => v.waitFor(SIDEBAR, ms);
const privateFiles = () => runAs(TEST_ID, 'cd files && find . -type f -exec stat -c "%n %s" {} \\;', false).split('\n').filter(Boolean).sort();
const ok = <T>(r: { ok: boolean; v?: T; e?: unknown }, what: string): T => { assert.ok(r.ok, `${what}: ${JSON.stringify(r.e)}`); return r.v as T; };

/** Puts the caret at the end of the note body and types `t` (CDP insertText). */
async function typeAtEnd(v: WebView, t: string) {
  assert.ok(await v.waitFor('[aria-label="Note body"]', 10_000), 'the note body is shown');
  await v.eval(`(() => { const el = document.querySelector('[aria-label="Note body"]'); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
  await v.type(t);
}

/** Types into the chooser's `Folder path` field and presses `Open`. */
async function openTyped(v: WebView, path: string) {
  assert.ok(await v.waitFor(`${CHOOSER} input[aria-label="Folder path"], ${CHOOSER} [data-command="vault.openPath"]`, 10_000), 'the Folder path field');
  await v.eval(`(() => { const i = [...document.querySelectorAll('${CHOOSER} input')].find((e) => e.getAttribute('aria-label') === 'Folder path' || e.labels?.[0]?.textContent?.trim() === 'Folder path'); i.focus(); i.select(); return true; })()`);
  await v.type(path);
  await v.click('[data-command="vault.openPath"]');
}

// ------------------------------------------------------------------------------------------------ AR-03 AC-8

test('ar_03_ac8_mobile_entry_point_starts', async () => {
  ready();
  const t0 = Date.now();
  const { pid, v } = await launch();
  assert.ok(await v.waitFor(CHOOSER, Math.max(1, 15_000 - (Date.now() - t0))), 'the chooser shows within 15 s');
  const marks = perfMarks(TEST_ID);
  assert.ok(marks.some((m) => m.mark === 'ui-ready'), `the perf log has ui-ready: ${marks.map((m) => m.mark).join(', ')}`);
  const setup = marks.filter((m) => m.mark === 'setup-done');
  assert.equal(setup.length, 1, 'one setup-done mark');
  assert.deepEqual(setup[0].windows, ['main'], 'setup-done lists exactly one window, main');
  const desktopOnly = marks.filter((m) => /capture|saved|hotkey|tray|status-item|single-instance/i.test(m.mark));
  assert.deepEqual(desktopOnly.map((m) => m.mark), [], 'no capture, saved-panel, hotkey, tray or single-instance mark');
  assert.equal(sh(`pidof ${TEST_ID}`).trim(), String(pid), 'one process');
});

// ------------------------------------------------------------------------------------------------ AR-03 AC-10

test('ar_03_ac10_excluded_commands_refused_on_android', async () => {
  ready();
  const vault = pushShell();
  const { pid, v } = await launch({ vault });
  assert.ok(await vaultOpen(v), 'the shell fixture opens');
  await sleep(2000);
  const before = fileState(vault);
  for (const cmd of ['capture_create', 'import_start', 'note_rename', 'tag_rename', 'type_move', 'tidy_now', 'query_create', 'vault_pick_dir', 'app_quit', 'open_external', 'graph_neighbourhood']) {
    const r = await v.invoke<{ ok: boolean }>(cmd, { path: UVODNI, title: 'Jiný název', from: 'práce', to: 'zaměstnání', url: 'https://example.invalid/' });
    assert.equal(r.ok, false, `${cmd} is refused from the main webview`);
  }
  await sleep(1500);
  assert.equal(pidOf(TEST_ID), pid, 'the app keeps running (same pid)');
  assert.equal(foregroundPackage(), TEST_ID, 'no other window or app came up');
  assert.deepEqual(fileState(vault), before, 'the vault is untouched');
  ok(await v.invoke('vault_start'), 'vault_start (positive control)');
  ok(await v.invoke('note_read', { path: UVODNI }), 'note_read (positive control)');
  ok(await v.invoke('vault_recent'), 'vault_recent (positive control)');
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-18

test('fr_vlt_01_ac18_remembered_vault_never_shows_chooser', async () => {
  ready();
  const vault = pushShell();
  await launch({ vault });
  forceStop(TEST_ID);
  for (let i = 1; i <= 5; i++) {
    start(TEST_ID, { cold: true, wait: false });
    const v = await webview(TEST_ID);
    views.push(v);
    const seen = await v.observeNever(CHOOSER);
    assert.ok(await vaultOpen(v, 20_000), `cold start ${i}: the remembered vault reaches the landing`);
    await sleep(1000);
    assert.equal(await seen(), false, `cold start ${i}: the chooser was never in the DOM`);
    assert.equal(await hasText(v, 'Choose a vault'), false, `cold start ${i}: no "Choose a vault"`);
    forceStop(TEST_ID);
  }
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-19

test('fr_vlt_01_ac19_opening_state_and_failure', async () => {
  ready();
  const vault = pushShell();
  const first = await launch({ vault });
  assert.ok(await vaultOpen(first.v), 'the vault opens and is remembered');
  forceStop(TEST_ID);
  writeTestEnv(TEST_ID, {}); // remembered by the app itself from now on
  sh(`rm -r ${quote(vault)}`);
  const filesBefore = privateFiles();
  start(TEST_ID);
  const v = await webview(TEST_ID);
  views.push(v);
  assert.ok(await v.waitFor(CHOOSER, 15_000), 'the start ends in failed: the chooser');
  assert.ok(await hasText(v, vault), `the FR-VLT-01 AC-7 message names ${vault}`);
  assert.equal(sh(`ls -d ${quote(vault)} 2>/dev/null; echo $?`).trim().split('\n').pop(), '1', 'nothing is created at the old path');
  const added = privateFiles().filter((f) => !filesBefore.some((b) => b.split(' ')[0] === f.split(' ')[0]));
  assert.deepEqual(added.filter((f) => !/perf\.jsonl|ui-state\.json|recent|last-vault/.test(f)), [], 'no index for the missing vault appears in the private files dir');
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-20

test('fr_vlt_01_ac20_no_vault_without_all_files_access', async () => {
  ready();
  const vault = pushShell();
  const vaultBefore = fileState(vault);
  forceStop(TEST_ID);
  clearPrivate(TEST_ID);
  appops(TEST_ID, 'deny');
  writeTestEnv(TEST_ID, { TEGG_VAULT: vault });
  const filesBefore = privateFiles();
  start(TEST_ID, { wait: false });
  const v = await webview(TEST_ID);
  views.push(v);
  const chooser = await v.observeNever(CHOOSER);
  const side = await v.observeNever(SIDEBAR);
  assert.ok(await v.waitFor(ACCESS, 15_000), `the permission screen "${S.accessTitle}"`);
  assert.ok(await hasText(v, `Vault: ${vault}`), `it names the vault: "Vault: ${vault}"`);
  assert.equal((await text(v, `${ACCESS} [data-command="android.openSettings"]`)).trim(), S.openSettings, 'the button Open settings');
  await sleep(3000);
  assert.equal(await chooser(), false, 'no chooser');
  assert.equal(await side(), false, 'no sidebar, so no type count');
  assert.ok(!perfMarks(TEST_ID).some((m) => m.mark === 'vault-opened'), 'no vault-opened mark');
  const without = (l: string[]) => l.filter((f) => !/perf\.jsonl/.test(f));
  assert.deepEqual(without(privateFiles()), without(filesBefore), 'the private files dir is the same (no index for the vault)');
  assert.deepEqual(fileState(vault), vaultBefore, 'the vault is untouched');

  const none = await launch({ access: 'deny' });
  assert.ok(await none.v.waitFor(ACCESS, 15_000), 'no vault remembered: the same screen');
  assert.equal(await hasText(none.v, 'Vault: '), false, 'without the Vault: line');
  assert.equal(await hasText(none.v, S.found), false, 'and no vault search');
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-21

test('fr_vlt_01_ac21_open_settings_and_recheck', async () => {
  ready();
  const vault = pushShell();
  const { v } = await launch({ vault, access: 'deny' });
  assert.ok(await v.waitFor(ACCESS, 15_000), 'the permission screen');
  await v.click('[data-command="android.openSettings"]');
  assert.equal(await eventually(() => foregroundPackage(), (p) => p === 'com.android.settings', 5000), 'com.android.settings', 'Open settings shows the system page');
  const intent = sh('dumpsys activity activities', false);
  assert.match(intent, /MANAGE_APP_ALL_FILES_ACCESS_PERMISSION|ManageAppExternalSources|AppManageExternalStorage|ManageExternalStorage/i, 'the "All files access" page for this app');
  back();
  assert.ok(await eventually(() => hasText(v, S.stillOff), (x) => x, 3000), `returning without granting adds "${S.stillOff}"`);
  assert.ok(await v.waitFor(ACCESS, 500), 'the screen stays');

  await v.click('[data-command="android.openSettings"]');
  await eventually(() => foregroundPackage(), (p) => p === 'com.android.settings', 5000);
  appops(TEST_ID, 'allow');
  back();
  const t = Date.now();
  assert.ok(await vaultOpen(v, 2500), 'within 2 s of the resume the remembered vault opens');
  assert.ok(Date.now() - t <= 2500, `moved on in ${Date.now() - t} ms`);
  assert.deepEqual(await typeCounts(v), SHELL_COUNTS, 'the type counts equal the fixture\'s');
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-22

test('fr_vlt_01_ac22_access_revoked_while_open', async () => {
  ready();
  const vault = pushShell();
  const { v } = await launch({ vault, env: { TEGG_ROUTE: `note/${UVODNI}` } });
  assert.ok(await vaultOpen(v), 'the vault opens on Úvodní');
  const counts = await typeCounts(v);
  const eva = await searchPaths(v, 'Evě');
  await typeAtEnd(v, 'x');
  home();
  await sleep(300);
  const denyAt = appops(TEST_ID, 'deny');
  await sleep(2000);
  resume(TEST_ID);
  const w = await webview(TEST_ID);
  views.push(w);
  assert.ok(await w.waitFor(ACCESS, 10_000), 'the permission screen shows; the vault is closed');
  assert.equal(await w.waitFor(SIDEBAR, 300), false, 'no vault frame');
  const uvodni = sh(`cat ${quote(`${vault}/${UVODNI}`)}`);
  assert.match(uvodni, /x\s*$/, 'Úvodní holds the x (flushed before the app left, FR-EDT-08 AC-14)');
  const late = Object.entries(fileState(vault)).filter(([, s]) => s.mtime * 1000 > denyAt + 999).map(([f]) => f);
  assert.deepEqual(late, [], 'no file was written after deny');

  appops(TEST_ID, 'allow');
  home();
  resume(TEST_ID);
  assert.ok(await w.waitFor(SIDEBAR, 10_000), 'granting again reopens the vault');
  assert.deepEqual(await typeCounts(w), counts, 'the same type counts');
  assert.deepEqual(await searchPaths(w, 'Evě'), eva, 'the same index_search("Evě") result');
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-25

test('fr_vlt_01_ac25_typed_path', async () => {
  ready();
  sh(`rm -rf ${SHARED}/Documents/tegg-la-x`);
  const pushed = pushShell();
  const vault = `${SHARED}/Documents/tegg-la-x/shell`;
  sh(`mkdir -p ${SHARED}/Documents/tegg-la-x && mv ${quote(pushed)} ${quote(vault)}`);
  for (const typed of [vault, `  ${vault}/ `, '/sdcard/Documents/tegg-la-x/shell']) {
    const { v } = await launch();
    assert.ok(await v.waitFor(CHOOSER, 15_000), 'the chooser');
    await openTyped(v, typed);
    assert.ok(await vaultOpen(v), `typing ${JSON.stringify(typed)} opens the vault`);
    const recent = ok(await v.invoke<{ ok: boolean }>('vault_recent'), 'vault_recent') as unknown as { path: string }[];
    assert.equal(recent[0]?.path, vault, `vault_recent's first entry is ${vault}`);
  }
  const docsBefore = sh(`ls -laR ${SHARED}/Documents/tegg-la-x`, false);
  const refusals: [string, string[]][] = [
    ['Documents/tegg-la-x/shell', [S.fullPath]],
    [`/data/user/0/${TEST_ID}/files`, [S.outsideShared]],
    [`${SHARED}/../../data`, [S.outsideShared]],
    [`${SHARED}/Documents/tegg-la-x/chybí`, [S.notFound]],
    [`${SHARED}/Documents/tegg-la-x`, [S.notAVault, S.notAVaultHint]],
  ];
  for (const [typed, messages] of refusals) {
    const { v } = await launch();
    assert.ok(await v.waitFor(CHOOSER, 15_000), 'the chooser');
    await openTyped(v, typed);
    for (const m of messages) assert.ok(await eventually(() => hasText(v, m), (x) => x, 3000), `${typed}: "${m}"`);
    assert.equal(await v.waitFor(SIDEBAR, 300), false, `${typed}: no vault opens`);
  }
  assert.equal(sh(`ls -laR ${SHARED}/Documents/tegg-la-x`, false), docsBefore, 'no refused path created or changed anything');
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-26

test('fr_vlt_01_ac26_new_vault_on_android', async () => {
  ready();
  const target = `${SHARED}/Documents/Můj trezor`;
  sh(`rm -rf ${quote(target)} ${quote(target.normalize('NFD'))}`);
  const docsBefore = listHex(`${SHARED}/Documents`);
  const { v } = await launch();
  assert.ok(await v.waitFor(CHOOSER, 15_000), 'the chooser');
  await v.click('[data-command="vault.new"]');
  assert.ok(await v.waitFor('form[aria-label="New vault"]', 3000), 'the New vault form');
  const location = await v.eval<string>(`[...document.querySelectorAll('form[aria-label="New vault"] input')].find((i) => (i.getAttribute('aria-label') ?? i.labels?.[0]?.textContent ?? '').trim() === 'Location')?.value ?? null`);
  assert.equal(location, `${SHARED}/Documents`, 'Location holds /storage/emulated/0/Documents');
  await v.eval(`(() => { const i = [...document.querySelectorAll('form[aria-label="New vault"] input')].find((e) => (e.getAttribute('aria-label') ?? e.labels?.[0]?.textContent ?? '').trim() === 'Vault name'); i.focus(); return true; })()`);
  await v.type('Můj trezor'.normalize('NFD'));
  await v.eval(`(() => { const r = [...document.querySelectorAll('form[aria-label="New vault"] input[type=radio]')].find((e) => (e.labels?.[0]?.textContent ?? e.getAttribute('aria-label') ?? '').includes('Empty')); r?.click(); return true; })()`);
  await v.click('[data-command="vault.create"]');
  assert.ok(await vaultOpen(v), 'the new vault opens');
  const added = listHex(`${SHARED}/Documents`).filter((n) => !docsBefore.includes(n));
  assert.deepEqual(added, [hex('Můj trezor'.normalize('NFC'))], 'exactly /storage/emulated/0/Documents/Můj trezor/ is created, NFC');
  const mask = (t: string) => t.replace(/^(id|created|modified):.*$/gm, '$1: *');
  const expected = resolve(REPO, 'tests/fixtures/vaults/new-empty');
  const walk = (d: string, rel = ''): string[] => readdirSync(d).flatMap((n) => statSync(join(d, n)).isDirectory() ? walk(join(d, n), `${rel}${n}/`) : [`${rel}${n}`]);
  const files = walk(expected).sort();
  const onPhone = sh(`cd ${quote(target)} && find . -type f | sed 's#^./##' | sort`).split('\n').filter(Boolean);
  assert.deepEqual(onPhone, files, 'the files of new-empty, nothing else');
  for (const f of files) {
    assert.equal(mask(sh(`cat ${quote(`${target}/${f}`)}`)), mask(readFileSync(join(expected, f), 'utf8')), `${f} equals new-empty byte for byte (ids, timestamps aside)`);
  }
  forceStop(TEST_ID);
  start(TEST_ID);
  const again = await webview(TEST_ID);
  views.push(again);
  const seen = await again.observeNever(CHOOSER);
  assert.ok(await vaultOpen(again), 'a cold start reopens it (AC-18)');
  assert.equal(await seen(), false, 'without the chooser');

  const outside = await launch();
  assert.ok(await outside.v.waitFor(CHOOSER, 15_000), 'the chooser');
  const docs2 = listHex(`${SHARED}/Documents`);
  await outside.v.click('[data-command="vault.new"]');
  await outside.v.eval(`(() => { const ins = [...document.querySelectorAll('form[aria-label="New vault"] input')]; const by = (n) => ins.find((e) => (e.getAttribute('aria-label') ?? e.labels?.[0]?.textContent ?? '').trim() === n); by('Location').focus(); by('Location').select(); return true; })()`);
  await outside.v.type(`/data/user/0/${TEST_ID}/files`);
  await outside.v.eval(`(() => { const i = [...document.querySelectorAll('form[aria-label="New vault"] input')].find((e) => (e.getAttribute('aria-label') ?? e.labels?.[0]?.textContent ?? '').trim() === 'Vault name'); i.focus(); return true; })()`);
  await outside.v.type('Jiný trezor');
  await outside.v.click('[data-command="vault.create"]');
  assert.ok(await eventually(() => hasText(outside.v, S.outsideShared), (x) => x, 3000), `a Location outside shared storage: "${S.outsideShared}"`);
  assert.deepEqual(listHex(`${SHARED}/Documents`), docs2, 'nothing is created');
  assert.equal(runAs(TEST_ID, 'ls files', false).includes('Jiný trezor'), false, 'nothing in private storage either');
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-27

test('fr_vlt_01_ac27_recent_vaults_keep_disk_path', async () => {
  ready();
  const nfdName = 'Poznámky'.normalize('NFD');
  const local = join(mkdtempSync(join(tmpdir(), 'tegg-la-nfd-')), nfdName);
  mkdirSync(local);
  // D-2051: the vault's .tegg/ is in the folder before the push (adb skips an empty folder).
  cpSync(resolve(REPO, 'tests/fixtures/vaults/new-empty/.tegg'), join(local, '.tegg'), { recursive: true });
  const onPhone = `${SHARED}/Documents/${nfdName}`;
  sh(`rm -rf ${quote(onPhone)} ${quote(`${SHARED}/Documents/Poznámky`)}`);
  const pushed = adb(['push', local, `${SHARED}/Documents/`]);
  assert.equal(pushed.status, 0, `push the NFD folder: ${pushed.stderr}`);
  assert.ok(listHex(`${SHARED}/Documents`).includes(hex(nfdName)), 'setup: Documents/Poznámky is stored in NFD bytes');

  const { v } = await launch();
  assert.ok(await v.waitFor('[data-command="vault.openFound"]', 20_000), 'Vaults on this phone lists vaults');
  const clicked = await v.eval<boolean>(`(() => { const b = [...document.querySelectorAll('[data-command="vault.openFound"]')].find((e) => e.innerText.normalize('NFC').includes('Poznámky')); if (!b) return false; b.click(); return true; })()`);
  assert.ok(clicked, 'Poznámky is listed in Vaults on this phone');
  assert.ok(await vaultOpen(v), 'it opens');
  forceStop(TEST_ID);
  start(TEST_ID);
  const w = await webview(TEST_ID);
  views.push(w);
  assert.ok(await vaultOpen(w), 'after a force-stop the vault reopens (AC-18)');
  const recent = ok(await w.invoke('vault_recent'), 'vault_recent') as { name: string; path: string; exists: boolean }[];
  const mine = recent.filter((e) => e.path.normalize('NFC').endsWith('/Poznámky'));
  assert.equal(mine.length, 1, `listed once: ${JSON.stringify(recent)}`);
  assert.equal(mine[0].exists, true, 'exists: true');
  assert.equal(mine[0].name, 'Poznámky', 'the name in NFC');
  assert.equal(hex(mine[0].path), hex(onPhone), 'the stored path is the on-disk (NFD) one');
  ok(await w.invoke('vault_open', { path: mine[0].path }), 'opening it again from the list');
  const again = ok(await w.invoke('vault_recent'), 'vault_recent') as { path: string }[];
  assert.equal(again.filter((e) => e.path.normalize('NFC').endsWith('/Poznámky')).length, 1, 'no second entry');
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-28

test('fr_vlt_01_ac28_vault_rules_on_android', async () => {
  ready();
  const vault = pushShell();
  const second = pushVault(['tests/fixtures/vaults/new-empty'], 'Můj trezor');
  const before = fileState(vault);
  const filesBefore = privateFiles();
  const { v } = await launch({ vault });
  assert.ok(await vaultOpen(v), 'the shell fixture opens');
  await sleep(3000);
  assert.deepEqual(fileState(vault), before, 'opening the shell fixture writes nothing (AC-4)');
  const index = privateFiles().filter((f) => !filesBefore.includes(f) && !/perf\.jsonl|test-env\.json|ui-state\.json|recent|last-vault/.test(f));
  assert.ok(index.length > 0, `its index lives in the private files dir (FR-STO-07 AC-13): ${index.join(', ')}`);
  assert.equal(sh(`find ${quote(vault)} -newer ${quote(`${vault}/.tegg/vault.yml`)} -type f`, false).trim(), '', 'no file in the vault is newer than before');
  await v.click('button[aria-label$=". Switch vault"]');
  assert.ok(await v.waitFor('[role="menu"][aria-label="Vaults"]', 3000), 'the switcher menu');
  await v.eval(`(() => { const i = [...document.querySelectorAll('[role="menu"][aria-label="Vaults"] [role="menuitem"]')].find((e) => e.textContent.trim().startsWith('Open folder as vault')); i.click(); return true; })()`);
  await openTyped(v, second);
  assert.ok(await v.waitFor('button[aria-label="Vault: Můj trezor. Switch vault"]', 10_000), 'the second vault opens from the switcher');
  assert.deepEqual(fileState(vault), before, 'the first vault is closed untouched (AC-8)');
  const recent = ok(await v.invoke('vault_recent'), 'vault_recent') as { path: string; exists: boolean }[];
  for (const p of [vault, second]) {
    const e = recent.find((x) => x.path.normalize('NFC') === p.normalize('NFC'));
    assert.ok(e && e.exists === true, `the switcher's list has ${p} with exists: true`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-STO-07 AC-13

test('fr_sto_07_ac13_machine_local_in_private_storage', async () => {
  ready();
  const vault = pushShell();
  const listing = () => ({
    root: sh(`ls -la ${SHARED}`, false).split('\n').filter((l) => !/ \.$| \.\.$/.test(l)).map((l) => l.replace(/\s+\d{4}-\d\d-\d\d \d\d:\d\d/, '')).join('\n'),
    documents: sh(`ls -laR ${SHARED}/Documents`, false),
    download: sh(`ls -laR ${SHARED}/Download`, false),
  });
  const vaultBefore = fileState(vault);
  const before = listing();
  const { v } = await launch({ vault, env: { TEGG_ROUTE: `note/${UVODNI}` } });
  assert.ok(await vaultOpen(v), 'the vault opens');
  ok(await v.invoke('note_read', { path: EVA }), 'a second note');
  const ui = ok(await v.invoke('ui_state_get'), 'ui_state_get') as Record<string, unknown> | null;
  ok(await v.invoke('ui_state_set', { state: { ...(ui ?? { version: 1 }), theme: 'dark' } }), 'switch the theme');
  forceStop(TEST_ID);
  start(TEST_ID);
  const w = await webview(TEST_ID);
  views.push(w);
  assert.ok(await vaultOpen(w), 'the app starts again on the vault');
  const priv = runAs(TEST_ID, 'ls -R files/');
  assert.match(priv, /ui-state\.json/, 'ui-state.json is in the private files dir');
  assert.match(priv, /recent/, 'the recent-vaults list is in the private files dir');
  assert.ok(privateFiles().some((f) => !/perf\.jsonl|test-env\.json|ui-state\.json|recent|last-vault/.test(f)), 'the index is in the private files dir');
  assert.deepEqual(fileState(vault), vaultBefore, 'the vault folder is the same (names, sizes, SHA-256, inodes, mtimes)');
  assert.deepEqual(listing(), before, 'nothing else under /storage/emulated/0 was created or changed');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-08 AC-14

test('fr_edt_08_ac14_flush_when_backgrounded', async () => {
  ready();
  const vault = pushShell();
  const { v } = await launch({ vault, env: { TEGG_ROUTE: `note/${UVODNI}` } });
  assert.ok(await vaultOpen(v), 'Úvodní is open');
  await typeAtEnd(v, 'Ahoj');
  home();
  await sleep(2000);
  forceStop(TEST_ID);
  assert.match(sh(`cat ${quote(`${vault}/${UVODNI}`)}`), /Ahoj/, 'the file contains Ahoj');
  assert.equal(sh(`find ${quote(vault)} -name '*.tegg-tmp*'`, false).trim(), '', 'no .tegg-tmp file is left (FR-SYN-02 AC-1)');
});

// ------------------------------------------------------------------------------------------------ AR-08 AC-5

test('ar_08_ac5_test_hooks_only_in_test_apk', async () => {
  ready();
  const vault = pushShell();
  const { v } = await launch({ vault });
  assert.ok(await vaultOpen(v), 'the test APK: test-env.json with TEGG_VAULT opens that vault at start');
  assert.equal(await v.waitFor(CHOOSER, 300), false, 'without the chooser');

  install(releaseApk());
  adb(['shell', `am force-stop ${RELEASE_ID}`]);
  appops(RELEASE_ID, 'allow');
  adbRoot();
  const env = JSON.stringify({ TEGG_TEST: '1', TEGG_VAULT: vault });
  const files = `/data/user/0/${RELEASE_ID}/files`;
  sh(`mkdir -p ${files} && printf '%s' ${quote(env)} > ${files}/test-env.json && chown -R $(stat -c %u ${files}/..):$(stat -c %g ${files}/..) ${files}`);
  sh(`am start -W -n ${RELEASE_ID}/.MainActivity`);
  // D-2051: wait for the first screen, not a fixed time (D-688).
  const dump = await eventually(() => uiDump(), (x) => /Choose a vault|Switch vault/.test(x), 20_000, 500);
  assert.match(dump, /Choose a vault/, 'the release build ignores test-env.json: the chooser');
  assert.doesNotMatch(dump, /Switch vault/, 'no vault opened from test-env.json');
});

// ------------------------------------------------------------------------------------------------ FR-UX-01 AC-7

test('fr_ux_01_ac7_version_label_on_android', async () => {
  ready();
  const vault = pushShell();
  const { v } = await launch({ vault });
  assert.ok(await vaultOpen(v), 'the test APK opens the vault');
  assert.equal((await text(v, `${SIDEBAR} button[aria-label="Tegg: About and Settings"]`)).trim(), 'dev', 'the test APK shows dev');

  install(releaseApk());
  adb(['shell', `pm clear ${RELEASE_ID}`]);
  appops(RELEASE_ID, 'allow');
  sh(`am start -W -n ${RELEASE_ID}/.MainActivity`);
  await eventually(() => uiDump(), (x) => /Folder path/.test(x), 15_000, 500);
  tapText('Folder path');
  inputText(vault);
  tapText('Open');
  // D-2051: the label is read through DevTools (the LA's release-variant APK is debuggable; the real release is not).
  const rv = await webview(RELEASE_ID);
  views.push(rv);
  assert.ok(await rv.waitFor(SIDEBAR, 15_000), 'the release-variant APK opens the vault');
  assert.equal((await text(rv, `${SIDEBAR} button[aria-label="Tegg: About and Settings"]`)).trim(), 'v0.5.0', 'the release APK built for 0.5.0 shows v0.5.0 on the sidebar\'s bottom-left button');
});

// ------------------------------------------------------------------------------------------------ NFR-SEC-01 AC-3

test('nfr_sec_01_ac3_no_sockets_on_android', async () => {
  ready();
  stopMonitor?.();
  stopMonitor = null;
  const uid = uidOf(TEST_ID);
  assert.deepEqual(socketsOf(uid), [], 'no socket of the app\'s uid now');
  const logs = [monitorLog, process.env.TEGG_LA_SOCKET_LOG ?? ''].filter((p) => p && existsSync(p));
  assert.ok(process.env.TEGG_LA_SOCKET_LOG && existsSync(process.env.TEGG_LA_SOCKET_LOG), 'the step\'s monitor ran around the whole run (TEGG_LA_SOCKET_LOG)');
  const samples = logs.flatMap((p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { at: number; uids: number[]; sockets: string[] }));
  assert.ok(samples.length > 1, 'the monitor sampled during the run');
  assert.ok(samples.every((s) => s.uids.includes(uid) || s.uids.length > 0), 'the samples covered the app\'s uid');
  const hits = samples.filter((s) => s.sockets.length > 0).map((s) => `${new Date(s.at).toISOString()}: ${s.sockets.join(' | ')}`);
  assert.deepEqual(hits, [], 'no /proc/net/{tcp,tcp6,udp,udp6} entry belonged to the app during the run');
});

// Keep `writeShared` reachable for the watcher tests' helpers (same module).
void writeShared;
