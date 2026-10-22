// MS5 slice 5B real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/capture.md — FR-CAP-01
// AC-1, AC-4, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12 (5B part), AC-13; FR-CAP-03 AC-1…AC-4; FR-CAP-04 AC-1, AC-3, AC-7
// (once); FR-CAP-05 AC-1…AC-7; FR-TSK-10 AC-9, AC-12 (once); FR-VLT-05 AC-2, AC-5, AC-6 (their L6 parts); FR-SET-03
// AC-4 (once after a relaunch); FR-SET-05 AC-1…AC-6; NFR-SEC-03 AC-4 (the pasteboard), AC-5 (no network); FR-SYN-06
// AC-24, AC-25. Interface: docs/contracts/ms5-capture.md §1 (windows, status item, hotkeys, single instance, launch at
// login), §8 (`capture-ready`), §11.1 (test hooks, holdhotkey.swift) and ms3-shell §1 (TEGG_ROUTE, marks). Always
// TEGG_TEST=1 with TEGG_NOW (D-504), a temporary Application Support and a temporary copy of the synthetic inbox
// fixture (D-62). Hotkeys are posted system-wide by System Events while Finder is frontmost; non-ASCII text goes
// through the pasteboard (S3 P1); accessibility values are read, not labels (P10). Written from the ACs and the
// contracts only (D-61). Shared helpers: app/e2e/helpers/capture.ts.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  APP, NOW, NetMonitor, REPO, activateFinder, appPids, appiumDown, captureOpen, captureValue, changedPaths, closeMain, end, frontmost,
  holdHotkey, hotkey, inboxCopy, mainOpen, maskId, need, palette, paste, pasteboard, press, quitApp, read, ready, session,
  setPasteboard, shown, sleep, spawnApp, statusItem, support, testEnv, tmp, tree, typeAscii, waitExit, waitFile, waitFor, waitMark,
  type Driver,
} from './helpers/capture.ts';

const net = new NetMonitor();
before(() => { net.start(); });
after(appiumDown);
process.on('exit', appiumDown);

// D-504: the test clock starts at TEGG_NOW and runs on, so a stamp a few seconds later is the same test minute.
const clk = (t: string | null) => t?.replace(/^(captured|created|modified): (\d{4}-\d\d-\d\dT\d\d:\d\d):\d\d([+-]\d\d:\d\d)$/gm, (_m, k, hm, o) => `${k}: ${hm}:00${o}`) ?? null;
const stamps = (now = NOW) => `review: unreviewed\ncreated: ${now}\nmodified: ${now}\n`; // D-595: no `captured`
/** D-604: a Task capture (review workflow off) has no `review` line. */
const plain = (now = NOW) => `created: ${now}\nmodified: ${now}\n`;
type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver };
function fresh(name: string, o: { shell?: { showStatusItem: boolean; openAtLogin: boolean }; ui?: Record<string, unknown> } = {}): Ctx {
  const base = tmp(name);
  return { base, vault: inboxCopy(base), sup: support(base, o), log: join(base, 'perf.jsonl') };
}
async function launch(c: Ctx, extra: Record<string, string> = {}, route = 'inbox') {
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, ...extra }));
  assert.ok(await waitMark(c.log, `route-ready:${route}`), `${route} shown`);
  return c.d;
}
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
/** Capture windows opened in this suite (the socket check below needs the capture criteria to have run). */
let opened = 0;
async function openByHotkey(d: Driver, k: 'quick' | 'task' = 'quick') {
  await activateFinder();
  hotkey(k);
  assert.ok(await waitFor(() => captureOpen(d), 3000), `the capture window opens (${k})`);
  opened++;
}
async function typeCapture(text: string) {
  if (/^[\x20-\x7e\n]*$/.test(text)) {
    for (const [i, l] of text.split('\n').entries()) { if (i) press('enter'); if (l) typeAscii(l); }
  } else paste(text);
  await sleep(200);
}
const mdFiles = (vault: string, folder: string) => (existsSync(join(vault, folder)) ? readdirSync(join(vault, folder)).filter((f) => f.endsWith('.md')).map((f) => f.normalize('NFC')) : []);

// ------------------------------------------------------------------------------------------------ FR-CAP-01

test('fr_cap_01_ac1_the_status_item_and_its_menu', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap01ac1');
  try {
    const d = await launch(c);
    await closeMain(d);
    await activateFinder();
    const item = await statusItem(d);
    assert.ok(item, 'the status item is present');
    await item.click();
    assert.ok(await waitFor(() => captureOpen(d), 1000), 'Quick Capture within 1 s');
    assert.ok(await shown(d, 'Type: Quick Note', 1000) && await shown(d, 'Saves to Doručené', 1000), 'Type: Quick Note, Saves to <vault>');
    assert.ok(!(await shown(d, 'Due: No date', 300)), 'no Due control'); // D-602 label
    assert.equal(await mainOpen(d), false, 'the main window stays hidden');
    press('escape');
    await d.execute('macos: rightClick', { elementId: (await statusItem(d)).elementId });
    for (const m of ['Quick Capture', 'New Task', 'Open Tegg', 'Settings…', 'Quit Tegg']) assert.ok(await shown(d, m, 1500), `menu item ${m}`);
    await (await need(d, 'New Task')).click();
    assert.ok(await waitFor(() => captureOpen(d), 2000) && await shown(d, 'Type: Task', 1000), 'New Task opens as Task');
    press('escape');
    await d.execute('macos: rightClick', { elementId: (await statusItem(d)).elementId });
    await (await need(d, 'Settings…')).click();
    assert.ok(await waitMark(c.log, 'route-ready:settings/appearance', 3000), 'Settings… shows settings/appearance');
    await d.execute('macos: rightClick', { elementId: (await statusItem(d)).elementId });
    await (await need(d, 'Quit Tegg')).click();
    assert.ok(await waitFor(() => appPids().length === 0, 5000), 'Quit Tegg quits');
  } finally { await cleanup(c); }
});

test('fr_cap_01_ac4_cmd_enter_saves_hides_within_300_ms_and_returns_to_finder', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap01ac4');
  try {
    const d = await launch(c);
    await openByHotkey(d);
    await typeCapture('Řádek jedna\nŘádek dva');
    const t0 = Date.now();
    press('enter', ['command']);
    assert.ok(await waitFor(async () => !(await captureOpen(d)), 300), `hidden within 300 ms (${Date.now() - t0} ms)`);
    assert.equal(frontmost(), 'Finder', 'Finder is frontmost again');
    const f = await waitFile(join(c.vault, 'Quick Notes/Řádek jedna.md'), (t) => t !== null, 3000);
    assert.ok(f?.endsWith('---\nŘádek dva\n'), 'one save');
  } finally { await cleanup(c); }
});

test('fr_cap_01_ac7_nothing_to_save', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap01ac7');
  try {
    const d = await launch(c);
    const before = tree(c.vault);
    await openByHotkey(d);
    press('enter', ['command']);
    assert.ok(await shown(d, 'Nothing to save', 2000), 'Nothing to save');
    assert.ok(await captureOpen(d), 'the window stays open');
    press('escape');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'nothing written');
  } finally { await cleanup(c); }
});

test('fr_cap_01_ac8_the_draft_survives_quit_and_relaunch', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap01ac8');
  try {
    let d = await launch(c);
    const before = tree(c.vault);
    await openByHotkey(d);
    await typeCapture('Rozepsaná myšlenka');
    press('escape');
    assert.ok(await waitFor(async () => !(await captureOpen(d)), 2000), 'Esc hides');
    await end(d);
    assert.ok(existsSync(join(c.sup, 'capture-draft.json')), 'the draft is in Application Support');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'never in the vault');
    d = await launch(c);
    await openByHotkey(d);
    assert.equal(await captureValue(d), 'Rozepsaná myšlenka', 'restored after quit and relaunch');
    c.d = d;
  } finally { await cleanup(c); }
});

test('fr_cap_01_ac9_window_placement_focus_loss_and_hotkeys_while_open', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap01ac9');
  try {
    const d = await launch(c);
    await closeMain(d);
    await activateFinder();
    const item = await statusItem(d);
    assert.ok(item, 'status item');
    const ir = await item.getElementRect(item.elementId);
    await item.click();
    assert.ok(await waitFor(() => captureOpen(d), 2000), 'opened from the status item');
    const w = await need(d, 'Quick Capture');
    const wr = await w.getElementRect(w.elementId);
    assert.ok(wr.y >= ir.y + ir.height - 2 && Math.abs(wr.x + wr.width / 2 - (ir.x + ir.width / 2)) < wr.width, 'below the status item');
    press('escape');
    await openByHotkey(d);
    const w2 = await need(d, 'Quick Capture');
    const r2 = await w2.getElementRect(w2.elementId);
    const screen = JSON.parse(execFileSync('osascript', ['-l', 'JavaScript', '-e', 'ObjC.import("AppKit"); const f = $.NSScreen.mainScreen.frame; JSON.stringify({w: f.size.width, h: f.size.height})'], { encoding: 'utf8' }));
    assert.ok(Math.abs(r2.x + r2.width / 2 - screen.w / 2) < 40 && r2.y < screen.h / 3, 'a hotkey centres it in the upper third');
    await typeCapture('Nezmizí');
    await activateFinder();
    // D-596 (replaces D-542's "focus loss doesn't hide it"): clicking into another app hides it and keeps the draft.
    assert.ok(await waitFor(async () => !(await captureOpen(d)), 2000), 'clicking into another app hides it');
    await openByHotkey(d);
    assert.equal(await captureValue(d), 'Nezmizí', 'the next open shows the same text');
    hotkey('quick');
    await sleep(500);
    assert.equal(await captureValue(d), 'Nezmizí', '⌃⌥Space while open keeps everything');
    hotkey('task');
    assert.ok(await shown(d, 'Type: Task', 1000), '⌃⌥T while open sets Task');
  } finally { await cleanup(c); }
});

test('fr_cap_01_ac10_a_read_only_folder_keeps_the_text', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap01ac10');
  try {
    const d = await launch(c);
    chmodSync(join(c.vault, 'Quick Notes'), 0o555);
    await openByHotkey(d);
    await typeCapture('Nesmí se ztratit');
    press('enter', ['command']);
    assert.ok(await shown(d, 'Couldn’t save. Your text is kept.', 3000), 'the status');
    assert.equal(await captureValue(d), 'Nesmí se ztratit', 'the text is unchanged');
    assert.ok(!readdirSync(join(c.vault, 'Quick Notes')).some((f) => f.includes('Nesmí') || f.includes('.tegg-tmp')), 'no .md and no .tegg-tmp file');
    chmodSync(join(c.vault, 'Quick Notes'), 0o755);
    await (await need(d, 'Try again')).click();
    assert.ok(await waitFile(join(c.vault, 'Quick Notes/Nesmí se ztratit.md'), (t) => t !== null, 3000), 'Try again writes once');
  } finally { chmodSync(join(c.vault, 'Quick Notes'), 0o755); await cleanup(c); }
});

test('fr_cap_01_ac11_with_no_vault_every_trigger_opens_the_message', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('cap01ac11');
  const sup = support(base);
  const log = join(base, 'perf.jsonl');
  let d: Driver | undefined;
  try {
    d = await session(testEnv(sup, log));
    assert.ok(await waitMark(log, 'ui-ready'), 'the chooser');
    for (const k of ['quick', 'task'] as const) {
      await openByHotkey(d, k);
      assert.ok(await shown(d, 'Open a vault in Tegg first.', 2000), `${k}: Open a vault in Tegg first.`);
      press('escape');
    }
  } finally { await end(d); rmSync(base, { recursive: true, force: true }); }
});

test('fr_cap_01_ac12_a_pasted_image_writes_nothing_until_ms6', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap01ac12');
  try {
    const d = await launch(c);
    const before = tree(c.vault);
    const png = join(c.base, 'obrazek.png');
    writeFileSync(png, Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'));
    execFileSync('osascript', ['-e', `set the clipboard to (read (POSIX file "${png}") as «class PNGf»)`]);
    await openByHotkey(d);
    press('v', ['command']);
    assert.ok(await shown(d, 'Images and PDFs can be added from MS6.', 2000), 'the MS6 message');
    press('escape');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'nothing written');
  } finally { await cleanup(c); }
});

test('fr_cap_01_ac13_the_confirmation_panel_and_open', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap01ac13');
  try {
    const d = await launch(c);
    await closeMain(d);
    await openByHotkey(d);
    await typeCapture('Koupit dárek pro Janu');
    press('enter', ['command']);
    assert.ok(await shown(d, 'Saved to Inbox', 2000), 'Saved to Inbox');
    assert.ok(await shown(d, 'Quick Note · Koupit dárek pro Janu', 1000), 'the line');
    assert.equal(frontmost(), 'Finder', 'the panel never takes the key focus');
    await (await need(d, 'Open')).click();
    assert.ok(await waitMark(c.log, 'route-ready:note/Quick Notes/Koupit dárek pro Janu.md', 3000), 'Open shows the note');
    await sleep(4500);
    assert.ok(!(await shown(d, 'Saved to Inbox', 200)), 'gone after 4 s');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-CAP-03

test('fr_cap_03_ac1_captures_with_the_main_window_closed', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap03ac1');
  try {
    const d = await launch(c, {}, 'settings/appearance');
    await closeMain(d);
    const state = await d.execute('macos: queryAppState', { bundleId: 'app.tegg.desktop' });
    assert.ok(Number(state) >= 3, `still running (${state})`);
    assert.ok(await statusItem(d), 'the status item is present');
    for (const [how, text, folder] of [['quick', 'Přes zkratku', 'Quick Notes'], ['task', 'Úkol přes zkratku', 'Tasks'], ['item', 'Přes ikonu', 'Quick Notes']] as const) {
      await activateFinder();
      if (how === 'item') await (await statusItem(d)).click(); else hotkey(how);
      assert.ok(await waitFor(() => captureOpen(d), 2000), `${how}: opens`);
      await typeCapture(text);
      press('enter', ['command']);
      assert.ok(await waitFile(join(c.vault, folder, `${text}.md`), (t) => t !== null, 3000), `${how}: writes ${folder}/${text}.md`);
      assert.equal(await mainOpen(d), false, `${how}: the main window stays closed`);
    }
    execFileSync('osascript', ['-e', 'tell application id "app.tegg.desktop" to reopen']);
    assert.ok(await waitFor(() => mainOpen(d), 3000), 'a Dock click (reopen) shows the main window');
    assert.ok(await waitMark(c.log, 'route-ready:settings/appearance', 1000), 'on the route it had');
  } finally { await cleanup(c); }
});

test('fr_cap_03_ac2_no_keystroke_is_lost', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('cap03ac2');
  try {
    const d = await launch(c);
    await closeMain(d);
    for (let i = 0; i < 10; i++) {
      await activateFinder();
      hotkey('quick');
      typeAscii('abc def');
      await waitFor(() => captureOpen(d), 2000);
      assert.equal(await captureValue(d), 'abc def', `run ${i}: exactly "abc def"`);
      press('enter', ['command']);
      const name = i === 0 ? 'abc def.md' : `abc def (${i + 1}).md`;
      assert.ok(await waitFile(join(c.vault, 'Quick Notes', name), (t) => t !== null, 3000), `run ${i}: ${name}`);
    }
  } finally { await cleanup(c); }
});

test('fr_cap_03_ac3_never_the_main_window', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap03ac3');
  try {
    const d = await launch(c);
    await closeMain(d);
    for (const finish of ['save', 'esc'] as const) {
      await activateFinder();
      let seenMain = false;
      let polling = true;
      const poll = (async () => { while (polling) { if (await mainOpen(d)) seenMain = true; await sleep(50); } })();
      hotkey('quick');
      await waitFor(() => captureOpen(d), 2000);
      if (finish === 'save') { await typeCapture('Bez hlavního okna'); press('enter', ['command']); } else press('escape');
      await waitFor(async () => !(await captureOpen(d)), 2000);
      await sleep(300);
      polling = false;
      await poll;
      assert.equal(seenMain, false, `${finish}: the main window is never shown`);
      assert.equal(frontmost(), 'Finder', `${finish}: Finder is frontmost again`);
    }
  } finally { await cleanup(c); }
});

test('fr_cap_03_ac4_capture_while_the_initial_index_runs', { timeout: 1_800_000 }, async () => {
  await ready();
  const base = tmp('cap03ac4');
  const out = join(base, 'ref');
  let d: Driver | undefined;
  try {
    execFileSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'), '--', '--seed', '1', '--small-images', '--out', out], { stdio: 'ignore' });
    assert.ok(existsSync(join(out, '.tegg/vault.yml')), 'the generated reference vault');
    const sup = support(base);
    const log = join(base, 'perf.jsonl');
    d = await session(testEnv(sup, log, { TEGG_VAULT: out }));
    assert.ok(await waitMark(log, 'ui-ready', 60_000), 'ui-ready');
    await openByHotkey(d);
    await typeCapture('Za běhu indexu');
    press('enter', ['command']);
    assert.ok(await waitFile(join(out, 'Pages/Za běhu indexu.md'), (t) => t !== null, 5000), 'written while the index runs (the vault default type is Page)');
    // D-604: a Page capture (review off) isn't an Inbox item; it is on the Pages type page once indexed.
    palette('Go to type: Pages');
    assert.ok(await shown(d, 'Za běhu indexu', 120_000), 'on the Pages type page when indexing has finished');
  } finally { await end(d); rmSync(base, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------------------------ FR-CAP-04

test('fr_cap_04_ac1_the_file_on_disk', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap04ac1');
  try {
    const d = await launch(c);
    const before = tree(c.vault);
    await openByHotkey(d);
    await typeCapture('Koupit dárek pro Janu\nNěco do 500 Kč, viz [[Plán webu]].');
    await (await need(d, 'Add tag…')).click();
    typeAscii('n');
    paste('ákup');
    press('enter');
    press('enter', ['command']);
    const t = await waitFile(join(c.vault, 'Quick Notes/Koupit dárek pro Janu.md'), (x) => x !== null, 3000);
    assert.equal(clk(maskId(t)), `---\nid: <ULID>\ntype: quick-note\ntitle: Koupit dárek pro Janu\ntags: [nákup]\n${stamps()}---\nNěco do 500 Kč, viz [[Plán webu]].\n`, 'FR-CAP-04 AC-1 bytes');
    assert.deepEqual(changedPaths(before, tree(c.vault)), ['Quick Notes/Koupit dárek pro Janu.md'], 'exactly one file');
  } finally { await cleanup(c); }
});

test('fr_cap_04_ac3_stamps_with_tegg_now_in_los_angeles', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap04ac3');
  try {
    const d = await launch(c, { TZ: 'America/Los_Angeles' });
    await openByHotkey(d);
    await typeCapture('Čas zachycení');
    press('enter', ['command']);
    const t = await waitFile(join(c.vault, 'Quick Notes/Čas zachycení.md'), (x) => x !== null, 3000);
    assert.ok(clk(t)?.includes(stamps('2026-10-14T03:00:00-07:00')), `captured = created = modified = 2026-10-14T03:00:00-07:00:\n${t}`);
  } finally { await cleanup(c); }
});

test('fr_cap_04_ac7_a_capture_lands_in_the_inbox', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap04ac7');
  try {
    const d = await launch(c);
    await openByHotkey(d);
    await typeCapture('Nová položka');
    press('enter', ['command']);
    assert.ok(await shown(d, 'Quick Note: Nová položka', 2000), 'the first card of Today within 2 s');
    await closeMain(d);
    await openByHotkey(d);
    await typeCapture('Se zavřeným oknem');
    press('enter', ['command']);
    await waitFile(join(c.vault, 'Quick Notes/Se zavřeným oknem.md'), (x) => x !== null, 3000);
    execFileSync('osascript', ['-e', 'tell application id "app.tegg.desktop" to reopen']);
    assert.ok(await shown(d, 'Quick Note: Se zavřeným oknem', 3000), 'there when the main window is opened');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-CAP-05

test('fr_cap_05_ac1_quick_capture_hotkey', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap05ac1');
  try {
    const d = await launch(c);
    await openByHotkey(d);
    assert.ok(await shown(d, 'Type: Quick Note', 1000), 'Type: Quick Note with the main window open behind Finder');
    press('escape');
    await closeMain(d);
    await openByHotkey(d);
    assert.ok(await shown(d, 'Type: Quick Note', 1000), 'and with it closed');
    press('escape');
    writeFileSync(join(c.vault, '.tegg/vault.yml'), readFileSync(join(c.vault, '.tegg/vault.yml'), 'utf8').replace('default-type: Quick Note', 'default-type: nápad'));
    await sleep(2500);
    await openByHotkey(d);
    assert.ok(await shown(d, 'Type: Nápad', 1000), 'default-type: nápad → Type: Nápad');
  } finally { await cleanup(c); }
});

test('fr_cap_05_ac2_new_task_hotkey', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap05ac2');
  writeFileSync(join(c.vault, '.tegg/vault.yml'), readFileSync(join(c.vault, '.tegg/vault.yml'), 'utf8').replace('default-type: Quick Note', 'default-type: nápad'));
  try {
    const d = await launch(c);
    await openByHotkey(d, 'task');
    for (const l of ['Type: Task', 'Due: No date', 'Priority: None']) assert.ok(await shown(d, l, 1000), l);
  } finally { await cleanup(c); }
});

test('fr_cap_05_ac3_also_when_tegg_is_frontmost', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap05ac3');
  try {
    const d = await launch(c, {}, 'note/Pages/Plán webu.md');
    const before = read(c.vault, 'Pages/Plán webu.md');
    await (await need(d, 'Note body')).click();
    hotkey('quick');
    assert.ok(await waitFor(() => captureOpen(d), 2000), 'the capture window opens');
    press('escape');
    await sleep(1500);
    assert.equal(read(c.vault, 'Pages/Plán webu.md'), before, 'no character reached the editor; nothing saved in the note');
  } finally { await cleanup(c); }
});

test('fr_cap_05_ac4_single_instance', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap05ac4');
  try {
    const d = await launch(c, {}, 'settings/appearance');
    await closeMain(d);
    const before = tree(c.vault);
    execFileSync('open', ['-n', APP]);
    assert.ok(await waitFor(() => appPids().length === 1, 3000), `exactly one process within 3 s: ${appPids().join(',')}`);
    assert.ok(await waitFor(() => mainOpen(d), 3000), 'the running one shows its main window');
    assert.ok(await waitMark(c.log, 'route-ready:settings/appearance', 1000), 'on the route it had');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'the vault is untouched');
    await openByHotkey(d);
    press('escape');
  } finally { await cleanup(c); }
});

test('fr_cap_05_ac5_a_hotkey_another_app_holds', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap05ac5');
  const holder = holdHotkey(c.base);
  try {
    assert.ok(holder, 'the hotkey holder runs (swiftc, helpers/holdhotkey.swift)');
    await sleep(500);
    const d = await launch(c);
    assert.ok(await shown(d, "⌃⌥Space couldn't be set up because another app uses it. Quick Capture still works from the menu bar.", 3000), 'the once-per-launch notice');
    palette('Go to Settings: Shortcuts');
    assert.ok(await shown(d, 'Not available: another app uses this shortcut.', 3000), 'Quick Capture: Not available');
    assert.ok(await shown(d, 'Active', 1000), 'New Task: Active');
    await d.execute('macos: rightClick', { elementId: (await statusItem(d)).elementId });
    const qc = await need(d, 'Quick Capture');
    assert.equal(String(await qc.getAttribute('keyboardShortcut').catch(() => '') ?? '').includes('space'), false, 'the menu shows Quick Capture without a shortcut');
    press('escape');
    await openByHotkey(d, 'task');
    press('escape');
    await (await statusItem(d)).click();
    assert.ok(await waitFor(() => captureOpen(d), 2000), 'the status item still opens it');
    press('escape');
  } finally { holder?.kill(); await cleanup(c); }
});

test('fr_cap_05_ac6_try_again_after_the_holder_exits', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap05ac6');
  const holder = holdHotkey(c.base);
  try {
    assert.ok(holder, 'the hotkey holder runs');
    await sleep(500);
    const d = await launch(c, {}, 'settings/shortcuts');
    assert.ok(await shown(d, 'Not available: another app uses this shortcut.', 3000), 'taken');
    holder!.kill();
    await sleep(500);
    await (await need(d, 'Try again')).click();
    assert.ok(await waitFor(async () => !(await shown(d, 'Not available: another app uses this shortcut.', 100)), 1000), 'Active within 1 s');
    await openByHotkey(d);
  } finally { holder?.kill(); await cleanup(c); }
});

test('fr_cap_05_ac7_released_on_quit', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap05ac7');
  try {
    const d = await launch(c);
    await d.execute('macos: rightClick', { elementId: (await statusItem(d)).elementId });
    await (await need(d, 'Quit Tegg')).click();
    assert.ok(await waitFor(() => appPids().length === 0, 5000), 'quit');
    const bin = join(c.base, 'holdhotkey');
    holdHotkey(c.base)?.kill();
    let ok = false;
    try { execFileSync(bin, ['--check', 'space', 't'], { stdio: 'ignore' }); ok = true; } catch { ok = false; }
    assert.equal(ok, true, 'the helper can register ⌃⌥Space and ⌃⌥T');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-TSK-10 (once)

test('fr_tsk_10_ac9_the_task_bytes_on_disk', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('tsk10ac9');
  try {
    const d = await launch(c);
    await openByHotkey(d, 'task');
    await typeCapture('Zavolat kominíkovi tomorrow !high #doma');
    press('enter', ['command']);
    const t = await waitFile(join(c.vault, 'Tasks/Zavolat kominíkovi.md'), (x) => x !== null, 3000);
    assert.equal(clk(maskId(t)), `---\nid: <ULID>\ntype: task\ntitle: Zavolat kominíkovi\nstatus: To do\npriority: High\ndue: 2026-10-15\ntags: [doma]\n${plain()}---\n`, 'FR-TSK-10 AC-9 bytes');
  } finally { await cleanup(c); }
});

test('fr_tsk_10_ac12_the_task_on_tasks_and_in_the_inbox', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('tsk10ac12');
  try {
    const d = await launch(c);
    await openByHotkey(d, 'task');
    await typeCapture('Zavolat kominíkovi tomorrow !high #doma');
    press('enter', ['command']);
    // D-604: Task's review workflow is off, so the capture is not an Inbox item; it is on the Tasks page.
    assert.ok(await waitFile(join(c.vault, 'Tasks/Zavolat kominíkovi.md'), (t) => t !== null, 3000), 'written');
    palette('Go to Tasks');
    assert.ok(await waitMark(c.log, 'route-ready:tasks', 3000), 'Tasks');
    assert.ok(await shown(d, 'Task: Zavolat kominíkovi', 2000), 'on the Tasks page');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-VLT-05 (L6 parts)

test('fr_vlt_05_ac2_cmd_n_and_the_hotkey_follow_default_napad', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('vlt05ac2');
  writeFileSync(join(c.vault, '.tegg/vault.yml'), readFileSync(join(c.vault, '.tegg/vault.yml'), 'utf8').replace('default-type: Quick Note', 'default-type: nápad'));
  try {
    const d = await launch(c);
    press('n', ['command']);
    assert.ok(await waitMark(c.log, 'route-ready:new/nápad', 3000), '⌘N opens new/nápad');
    paste('Nápad z klávesnice');
    press('enter');
    const t = await waitFile(join(c.vault, 'Nápady/Nápad z klávesnice.md'), (x) => x !== null, 3000);
    for (const l of ['type: nápad', 'hodnocení: 3', 'oblast: osobní', 'review: unreviewed']) assert.ok(t?.includes(`\n${l}\n`), l);
    await openByHotkey(d);
    assert.ok(await shown(d, 'Type: Nápad', 1000), '⌃⌥Space: Type: Nápad');
  } finally { await cleanup(c); }
});

test('fr_vlt_05_ac5_the_capture_window_updates_within_2_s', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('vlt05ac5');
  try {
    const d = await launch(c);
    await openByHotkey(d);
    press('escape');
    writeFileSync(join(c.vault, '.tegg/vault.yml'), readFileSync(join(c.vault, '.tegg/vault.yml'), 'utf8').replace('default-type: Quick Note', 'default-type: nápad'));
    await sleep(2000);
    await openByHotkey(d);
    assert.ok(await shown(d, 'Type: Nápad', 1000), 'the pre-warmed window updated');
  } finally { await cleanup(c); }
});

test('fr_vlt_05_ac6_ctrl_opt_t_ignores_the_default', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('vlt05ac6');
  writeFileSync(join(c.vault, '.tegg/vault.yml'), readFileSync(join(c.vault, '.tegg/vault.yml'), 'utf8').replace('default-type: Quick Note', 'default-type: nápad'));
  try {
    const d = await launch(c);
    await openByHotkey(d, 'task');
    assert.ok(await shown(d, 'Type: Task', 1000), 'Type: Task');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SET-03 AC-4 (once)

test('fr_set_03_ac4_date_time_choices_survive_a_relaunch', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('set03ac4');
  try {
    let d = await launch(c, {}, 'settings/date-time');
    await (await need(d, 'First day of week')).click();
    typeAscii('Sunday');
    press('enter');
    await sleep(500);
    await end(d);
    const st = JSON.parse(readFileSync(join(c.sup, 'ui-state.json'), 'utf8'));
    assert.equal(st.dateTime?.week, 'sunday', 'stored in Application Support');
    assert.ok(!existsSync(join(c.vault, '.tegg/ui-state.json')), 'nothing under .tegg/');
    d = await launch(c, {}, 'settings/date-time');
    assert.ok(await shown(d, 'Sunday', 2000), 'restored after a relaunch');
    c.d = d;
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SET-05

test('fr_set_05_ac1_defaults_and_storage', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('set05ac1');
  try {
    const d = await launch(c, { TEGG_TEST_LOGIN_ITEM: join(c.base, 'login.txt') }, 'settings/menu-bar');
    assert.ok(await statusItem(d), 'the status item is present');
    const before = tree(c.vault);
    await (await need(d, 'Open Tegg at login')).click();
    await (await need(d, 'Open Tegg at login')).click();
    await (await need(d, 'Show Tegg in the menu bar')).click();
    await (await need(d, 'Show Tegg in the menu bar')).click();
    await sleep(500);
    assert.ok(existsSync(join(c.sup, 'shell-settings.json')), 'stored in Application Support');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'every vault file untouched, nothing under .tegg/');
  } finally { await cleanup(c); }
});

test('fr_set_05_ac2_icon_off_and_on', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('set05ac2');
  try {
    let d = await launch(c, {}, 'settings/menu-bar');
    assert.ok(await statusItem(d), 'present');
    await (await need(d, 'Show Tegg in the menu bar')).click();
    assert.ok(await waitFor(async () => !(await statusItem(d)), 1000), 'removed within 1 s');
    await end(d);
    d = await launch(c, {}, 'settings/menu-bar');
    c.d = d;
    assert.equal(await statusItem(d), null, 'still absent after a relaunch');
    await (await need(d, 'Show Tegg in the menu bar')).click();
    assert.ok(await waitFor(async () => !!(await statusItem(d)), 1000), 'back');
  } finally { await cleanup(c); }
});

test('fr_set_05_ac3_icon_off_and_window_closed', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('set05ac3', { shell: { showStatusItem: false, openAtLogin: false } });
  try {
    const d = await launch(c);
    assert.equal(await statusItem(d), null, 'no status item');
    await closeMain(d);
    assert.ok(appPids().length >= 1, 'the app keeps running');
    for (const [k, text, folder] of [['quick', 'Bez ikony', 'Quick Notes'], ['task', 'Úkol bez ikony', 'Tasks']] as const) {
      await openByHotkey(d, k);
      await typeCapture(text);
      press('enter', ['command']);
      assert.ok(await waitFile(join(c.vault, folder, `${text}.md`), (t) => t !== null, 3000), `${k}: saved`);
    }
    execFileSync('osascript', ['-e', 'tell application id "app.tegg.desktop" to reopen']);
    assert.ok(await waitFor(() => mainOpen(d), 3000), 'a Dock click shows the main window');
  } finally { await cleanup(c); }
});

test('fr_set_05_ac4_login_item_register_and_unregister', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('set05ac4');
  const rec = join(c.base, 'login.txt');
  try {
    const d = await launch(c, { TEGG_TEST_LOGIN_ITEM: rec }, 'settings/menu-bar');
    await (await need(d, 'Open Tegg at login')).click();
    await sleep(300);
    await (await need(d, 'Open Tegg at login')).click();
    await sleep(300);
    assert.deepEqual(existsSync(rec) ? readFileSync(rec, 'utf8').split('\n').filter(Boolean) : [], ['register', 'unregister'], 'register, then unregister');
  } finally { await cleanup(c); }
});

test('fr_set_05_ac5_started_as_a_login_item', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('set05ac5');
  try {
    // The last vault is opened (recorded by a first run), with no main window shown.
    const first = spawnApp(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: 'inbox', TEGG_EXIT_AFTER: 'route-ready:inbox' }));
    await waitMark(c.log, 'route-ready:inbox');
    quitApp(first);
    await waitExit(first);
    const log2 = join(c.base, 'perf2.jsonl');
    c.d = await session(testEnv(c.sup, log2, { TEGG_TEST_LAUNCHED_AT_LOGIN: '1' }));
    const d = c.d;
    await sleep(2000);
    assert.equal(await mainOpen(d), false, 'no main window');
    assert.ok(await statusItem(d), 'the status item');
    await openByHotkey(d);
    assert.ok(await shown(d, 'Saves to Doručené', 1000), 'the capture window works at once on the last vault');
    press('escape');
    execFileSync('osascript', ['-e', 'tell application id "app.tegg.desktop" to reopen']);
    assert.ok(await waitFor(() => mainOpen(d), 3000), 'a Dock click shows the main window');
  } finally { await cleanup(c); }
});

test('fr_set_05_ac6_two_application_support_folders_keep_their_own', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('set05ac6');
  const other = support(c.base, { name: 'support-preview' });
  try {
    const d = await launch(c, {}, 'settings/menu-bar');
    await (await need(d, 'Show Tegg in the menu bar')).click();
    await end(d);
    const mine = JSON.parse(readFileSync(join(c.sup, 'shell-settings.json'), 'utf8'));
    assert.equal(mine.showStatusItem, false, 'this app: icon off');
    assert.ok(!existsSync(join(other, 'shell-settings.json')), 'the other folder (Tegg Preview) is untouched');
    c.d = await session(testEnv(other, join(c.base, 'p2.jsonl'), { TEGG_VAULT: c.vault, TEGG_ROUTE: 'settings/menu-bar' }));
    assert.ok(await statusItem(c.d), 'the other app keeps its own setting (icon on)');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ NFR-SEC-03, FR-SYN-06

test('nfr_sec_03_ac4_the_pasteboard_is_untouched', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('sec03ac4');
  try {
    const d = await launch(c);
    setPasteboard('Sentinel 5B ✓');
    await openByHotkey(d);
    typeAscii('Bez schranky');
    press('enter', ['command']);
    await waitFile(join(c.vault, 'Quick Notes/Bez schranky.md'), (t) => t !== null, 3000);
    assert.equal(pasteboard(), 'Sentinel 5B ✓', 'the pasteboard holds the same string');
  } finally { await cleanup(c); }
});

test('fr_syn_06_ac24_one_capture_one_file', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('syn06ac24');
  try {
    const d = await launch(c);
    const before = tree(c.vault);
    await openByHotkey(d);
    typeAscii('Jen otevreno');
    press('escape');
    await openByHotkey(d, 'task');
    press('escape');
    await (await statusItem(d))?.click();
    await waitFor(() => captureOpen(d), 2000);
    await (await need(d, 'Discard')).click();
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'opening, typing, Esc and Discard write nothing in the vault');
    await openByHotkey(d);
    typeAscii('Jedna');
    press('enter', ['command']);
    await waitFile(join(c.vault, 'Quick Notes/Jedna.md'), (t) => t !== null, 3000);
    assert.deepEqual(changedPaths(before, tree(c.vault)), ['Quick Notes/Jedna.md'], 'one capture, one file');
  } finally { await cleanup(c); }
});

test('fr_syn_06_ac25_the_switches_write_nothing_in_the_vault', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('syn06ac25');
  try {
    const d = await launch(c, { TEGG_TEST_LOGIN_ITEM: join(c.base, 'login.txt') }, 'settings/menu-bar');
    const before = tree(c.vault);
    for (const s of ['Show Tegg in the menu bar', 'Show Tegg in the menu bar', 'Open Tegg at login', 'Open Tegg at login']) { await (await need(d, s)).click(); await sleep(300); }
    palette('Go to Settings: Shortcuts');
    await sleep(500);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'nothing written in the vault');
  } finally { await cleanup(c); }
});

test('nfr_sec_03_ac5_no_internet_sockets_during_the_capture_criteria', () => {
  const r = net.stop();
  assert.ok(opened > 0, `the capture criteria ran (capture windows opened: ${opened})`);
  assert.ok(r.watched.length > 0, 'the monitor saw the app processes');
  assert.deepEqual(r.sockets, [], 'NFR-SEC-01: no non-IPC socket');
});
