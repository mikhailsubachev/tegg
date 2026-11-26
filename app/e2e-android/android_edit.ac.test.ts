// Slice AND-3, LA (the test APK on the emulator, with the test input method of AP-2084 → D-2519; contract
// docs/contracts/android-edit.md §6, §16.2, §17.2): docs/acceptance/android-edit.md
// - FR-EDT-01 AC-16 (the keyboard), AC-17 (the system menu), AC-19, AC-20 (keyboard input through the test IME);
// - FR-UX-04 AC-8 (the bar on the IME frame), AC-9 (the tap case once), AC-10 (the keyboard stays);
// - FR-EDT-06 AC-12, AC-13 (once); FR-EDT-08 AC-15…AC-18 (composition, kills, recovery, the renderer);
// - FR-FMT-07 AC-38, AC-39; FR-FMT-12 AC-18; FR-VLT-05 AC-17 (once); FR-DLY-02 AC-11 (once); FR-TSK-02 AC-14 (once);
//   FR-INB-02 AC-18 (once); FR-HIS-01 AC-16 (once); FR-UX-08 AC-30; NFR-SEC-01 AC-5.
// Every test starts with `ready()` (requireDevice, the test APK, the test IME): without an emulator it fails, never
// skips. A fresh vault copy in shared storage per test (`pushEdit`); "untouched" is AND-1's `fileState`; "zero writes"
// is the IPC log without a WRITE_COMMANDS entry; the page is driven through CDP where a tap needs no real finger, and
// through `input tap` where the AC is about the keyboard.
// Red-test readings (reported): "the desktop's result" on the device is the L5p comparison's expected bytes (the same
// cases); the caret is placed through CDP before the test IME's input.
// Written from the ACs and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  adb, eventually, fileState, forceStop, home, install, pidOf, pushVault, quote, REPO, requireDevice, resume, runAs, sh, SHARED, sleep, socketsOf, start, TEST_APK, TEST_ID,
  uiDump, uidOf, webview, writeShared, type WebView,
} from './helpers/device.ts';
import {
  actionModeShown, amKill, caretIn, cssRect, editorTextOf, imeShown, ipcLog, ipcWrites, killRenderer, launchPhone, pushEdit, pushReplace,
  recoveryFiles, removeTask, rendererPid, rotate, systemFrames, tapEl, tapWord, title, titleIs, tmpFiles, toDevice, uiDumpWindows, uiEditable, uiNode, webViewRect,
} from './helpers/phone.ts';
import { imeCommit, imeCompose, imeDelete, imeFinish, imeKey, imeRestore, imeUse, KEYCODE_DEL, KEYCODE_ENTER } from './helpers/ime.ts';

const views: WebView[] = [];
let installed = false;
function ready() {
  requireDevice();
  if (!installed) { install(TEST_APK); installed = true; }
  imeUse();
}
after(() => {
  for (const v of views) v.close();
  imeRestore();
  adb(['shell', `rm -rf ${SHARED}/Documents/tegg-la-*`]);
});
const NOW = '2026-10-14T12:00:00+02:00';
const PSANI = 'Pages/Psaní.md';
const BODY = '[role="textbox"][aria-label="Note body"]';
const BAR = '[role="toolbar"][aria-label="Formatting"]';
const read = (path: string) => sh(`cat ${quote(path)}`, false);
const fixture = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults', rel), 'utf8');
async function openEdit(route = `note/${PSANI}`, extra: Record<string, string> = {}, vault = pushEdit()) {
  const { pid, v } = await launchPhone(vault, { TEGG_ROUTE: route, TEGG_NOW: NOW, ...extra }, views);
  if (route.startsWith('note/')) assert.ok(await v.waitFor(BODY, 15_000), `${route}: the editor (Note body)`);
  return { pid, v, vault };
}
const waitFile = (path: string, ok: (t: string) => boolean, ms = 4000) => eventually(() => read(path), ok, ms, 200);
// `modified` and `completed` are instants with offset: the phone's clock runs on from TEGG_NOW (D-504; AP-345's rule,
// D-2557), so they are compared as instants (not before TEGG_NOW, within 10 minutes of it), the rest byte for byte.
const INSTANT = (key: string) => new RegExp(`^${key}: (\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(?:\\.\\d+)?[+-]\\d\\d:\\d\\d)$`, 'm');
function assertInstant(text: string, key: string): void {
  const m = INSTANT(key).exec(text);
  assert.ok(m, `${key} is ISO 8601 with offset`);
  const dt = Date.parse(m![1]) - Date.parse(NOW);
  assert.ok(dt >= 0 && dt <= 10 * 60_000, `${key} ${m![1]} is the clock running on from ${NOW}`);
}
const withModified = (text: string) => text.replace(/^modified: .*$/m, 'modified: <instant>');
/** The file with its `modified` instant checked and replaced by `<instant>`. */
const normModified = (text: string) => { assertInstant(text, 'modified'); return text.replace(INSTANT('modified'), 'modified: <instant>'); };

// ------------------------------------------------------------------------------------------------ FR-EDT-01 AC-16

test('fr_edt_01_ac16_open_without_keyboard_tap_to_edit', async () => {
  ready();
  const { v, vault } = await openEdit();
  await sleep(1000);
  assert.equal(imeShown(), false, 'mInputShown=false 1 s after note-ready');
  await tapWord(v, 'chléb');
  assert.ok(await eventually(() => imeShown(), (s) => s, 500, 50), 'a tap on chléb shows the keyboard within 500 ms');
  assert.ok(await v.waitFor(BAR, 1000), 'with RA15\'s bar');
  imeCommit('X');
  const t = await waitFile(`${vault}/${PSANI}`, (x) => x.includes('X'), 3000);
  const orig = fixture('phone-edit/Pages/Psaní.md');
  assert.equal(t.split('\n').filter((l, i) => l !== orig.split('\n')[i]).filter((l) => !l.startsWith('modified:')).length, 1, 'only the chléb line changes besides modified');
  // a draft from New: the keyboard is shown with the caret in Title (the bottom bar is hidden while the keyboard shows, §8)
  sh('input keyevent KEYCODE_BACK');
  assert.ok(await v.waitFor('[data-command="object.new"]', 2000), 'New, once the keyboard is hidden');
  await v.click('[data-command="object.new"]');
  await sleep(500);
  await v.eval(`(() => { const o = [...document.querySelectorAll('[role="dialog"][aria-label="New object"] [role="option"]')].find((x) => /^Page/.test(x.innerText)); o.click(); return true; })()`);
  assert.ok(await eventually(() => imeShown(), (s) => s, 1500, 100), 'the draft opens with the keyboard shown');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-01 AC-17

test('fr_edt_01_ac17_what_the_phone_editor_leaves_out', async () => {
  ready();
  const { v } = await openEdit('note/Pages/Deset bloků.md');
  const longPress = async (word: string) => {
    const r = await v.eval<{ x: number; y: number } | null>(`(() => { const w = document.createTreeWalker(document.querySelector('${BODY}'), NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const i = n.textContent.indexOf(${JSON.stringify(word)}); if (i >= 0) { const rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + ${word.length}); const b = rg.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } } return null; })()`);
    assert.ok(r, `${word} is shown`);
    const p = await toDevice(v, r!.x, r!.y);
    sh(`input swipe ${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.x)} ${Math.round(p.y)} 900`);
    await sleep(1000);
  };
  // Android 15's floating text toolbar is a PopupWindow that only `uiautomator dump --windows` lists (D-2557)
  const nodeAt = (xml: string, desc: string) => {
    const m = new RegExp(`<node[^>]*(?:text|content-desc)="${desc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`).exec(xml);
    return m ? { x: (Number(m[1]) + Number(m[3])) / 2, y: (Number(m[2]) + Number(m[4])) / 2 } : null;
  };
  // a clip on the clipboard first, so the menu offers Paste: Copy on another word's menu (D-2557)
  await longPress('Citace');
  const copy = nodeAt(uiDumpWindows(), 'Copy');
  assert.ok(copy, 'the system menu on Citace offers Copy');
  sh(`input tap ${Math.round(copy!.x)} ${Math.round(copy!.y)}`);
  await sleep(800);
  await longPress('blok');
  assert.ok(actionModeShown(), 'a long press on blok shows the system\'s selection menu');
  let dump = uiDumpWindows();
  const seen = new Set<string>();
  const collect = (xml: string) => { for (const m of xml.matchAll(/(?:text|content-desc)="(Cut|Copy|Paste|Select all)"/gi)) seen.add(m[1].toLowerCase()); };
  collect(dump);
  // the toolbar moves what doesn't fit into its overflow (`More options`)
  const more = nodeAt(dump, 'More options');
  if (more && seen.size < 4) { sh(`input tap ${Math.round(more.x)} ${Math.round(more.y)}`); await sleep(800); dump = uiDumpWindows(); collect(dump); }
  for (const item of ['Cut', 'Copy', 'Paste', 'Select all']) assert.ok(seen.has(item.toLowerCase()), `the system menu lists ${item}`);
});

// ------------------------------------------------------------------------------------------------ FR-EDT-01 AC-19, AC-20

test('fr_edt_01_ac19_keyboard_input_matches_the_desktop', async () => {
  ready();
  const orig = fixture('phone-edit/Pages/Psaní.md');
  // (a) composed words committed by a space, (b) a suggestion, (c) autocorrect
  let { v, vault } = await openEdit();
  await tapWord(v, 'Konec');
  await caretIn(v, 'Konec.', 0);
  for (const s of ['A', 'Ah', 'Aho', 'Ahoj']) imeCompose(s);
  imeCommit('Ahoj ');
  for (const s of ['s', 'sv', 'svě', 'svět', 'světe']) imeCompose(s);
  imeCommit('světe ');
  for (const s of ['z', 'za', 'zar', 'zari']) imeCompose(s);
  imeCommit('září ');
  imeCompose('pirvní');
  imeCommit('pirvní');
  imeDelete(6, 0);
  imeCommit('první ');
  let t = await waitFile(`${vault}/${PSANI}`, (x) => x.includes('první Konec.'), 4000);
  assert.equal(normModified(t), withModified(orig.replace('\nKonec.', '\nAhoj světe září první Konec.')), '(a)–(c): each word once, the suggestion and the correction');
  // (d) Enter after a composing chléb, Enter on the empty item; (e) Enter after Zavolat
  ({ v, vault } = await openEdit());
  await tapWord(v, 'chléb');
  // the tap's own caret lands with the keyboard: wait for it and ~300 ms before placing the caret (D-2557)
  assert.ok(await eventually(() => imeShown(), (s) => s, 1500), 'the keyboard');
  await sleep(300);
  await caretIn(v, 'chléb', 'end');
  imeCompose('chléb');
  imeFinish();
  imeKey(KEYCODE_ENTER);
  imeKey(KEYCODE_ENTER);
  await caretIn(v, 'Zavolat', 'end');
  imeKey(KEYCODE_ENTER);
  imeCommit('Nové');
  t = await waitFile(`${vault}/${PSANI}`, (x) => x.includes('Nové'), 4000);
  assert.ok(t.includes('- [ ] Zavolat\n- [ ] Nové\n'), '(e) a new `- [ ] ` item');
  assert.equal((t.match(/chléb/g) ?? []).length, 1, '(d) chléb once');
  // (f) Backspace at block starts and after the chip, through deleteSurroundingText and the key
  ({ v, vault } = await openEdit());
  await tapWord(v, 'Konec');
  for (const [text, off] of [['Konec.', 0], [' a #projekt', 0], ['první', 0], ['chléb', 0], ['Nákup', 0]] as const) {
    await caretIn(v, text, off);
    if (text === 'Konec.' || text === 'první') imeDelete(1, 0); else imeKey(KEYCODE_DEL);
  }
  t = await waitFile(`${vault}/${PSANI}`, (x) => !x.includes('[[Cíl]]'), 4000);
  assert.ok(!t.includes('[[Cíl]]'), '(f) the chip goes as a whole');
  // (g) triggers through commitText and inside a composition open their panels
  ({ v } = await openEdit());
  await tapWord(v, 'Konec');
  await caretIn(v, 'Konec.', 'end');
  imeCommit(' [[');
  assert.ok(await v.waitFor('[role="listbox"][aria-label="Link suggestions"]', 1500), '(g) [[ by commitText opens Link suggestions');
  imeCompose('#p');
  assert.ok(await v.waitFor('[role="listbox"][aria-label="Tag suggestions"]', 1500), '(g) #p inside a composition opens Tag suggestions');
});

test('fr_edt_01_ac20_czech_from_the_keyboard_is_nfc', async () => {
  ready();
  const { v, vault } = await openEdit();
  await tapWord(v, 'Konec');
  await caretIn(v, 'Konec.', 'end');
  imeCommit(' č');
  imeCommit(' ř ');
  const zl = 'Žluťoučký';
  imeCompose(zl);
  imeCommit(zl);
  const t = await waitFile(`${vault}/${PSANI}`, (x) => x.includes('Žluťoučký') || x.includes(zl), 4000);
  assert.ok(t.includes('Konec. č ř Žluťoučký\n'), 'saved in NFC through the test IME');
  assert.ok(!t.includes('̌') && !t.includes('́'), 'no combining marks in the file');
});

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-8, AC-9, AC-10

test('fr_ux_04_ac8_formatting_bar_on_the_keyboard', async () => {
  ready();
  const { v } = await openEdit();
  await tapWord(v, 'Konec');
  assert.ok(await eventually(() => imeShown(), (s) => s, 1000, 50), 'the keyboard shows');
  assert.ok(await v.waitFor(BAR, 500), 'the bar within 500 ms of the keyboard push');
  const f = systemFrames();
  const bar = await cssRect(v, BAR);
  const dpr = await v.eval<number>('devicePixelRatio');
  const wv = webViewRect();
  assert.ok(bar && f.ime && Math.abs(wv.top + bar.bottom * dpr - f.ime.top) <= 2, `the bar's bottom at the IME's top (± 2 device px): ${bar ? wv.top + bar.bottom * dpr : null} vs ${f.ime?.top}`);
  assert.equal(await v.eval<boolean>(`!!document.querySelector('nav[aria-label="Main"]')`), false, 'the bottom bar isn\'t rendered');
  sh('input keyevent KEYCODE_BACK');
  assert.ok(await eventually(() => v.eval<boolean>(`!document.querySelector('${BAR}') && !!document.querySelector('nav[aria-label="Main"]')`), (x) => x, 500), 'Back hides the keyboard: the bar goes, the bottom bar comes back within 500 ms');
  // landscape
  rotate(1);
  await sleep(1200);
  await tapWord(v, 'Konec');
  assert.ok(await v.waitFor(BAR, 1500), 'landscape: the bar above the keyboard');
  const lr = await cssRect(v, BAR);
  const insetL = await v.eval<number>(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inset-left')) || 0`);
  const firstBtn = await cssRect(v, `${BAR} button`);
  assert.ok(lr && firstBtn && firstBtn.left >= insetL - 0.5, 'no button under a side cutout');
  rotate(0);
});

test('fr_ux_04_ac9_caret_stays_in_view', async () => {
  ready();
  const { v } = await openEdit('note/Pages/Dlouhá poznámka.md', {}, pushVault(['tests/fixtures/vaults/views', 'tests/fixtures/vaults/new-empty/.tegg', 'tests/fixtures/vaults/phone'], 'Knihovna'));
  const word = await v.eval<string>(`(() => { const ps = [...document.querySelectorAll('${BODY} p')].filter((p) => { const r = p.getBoundingClientRect(); return r.bottom > 0 && r.bottom < innerHeight - 40; }); return (ps[ps.length - 1]?.innerText ?? '').trim().split(/\\s+/)[0]; })()`);
  await tapWord(v, word);
  const inBand = () => v.eval<boolean>(`(() => { const s = getSelection(); if (!s.rangeCount) return false; const c = s.getRangeAt(0).getBoundingClientRect(); const top = document.querySelector('header[role="banner"]').getBoundingClientRect().bottom; const bar = document.querySelector('${BAR}'); const bottom = (bar ? bar.getBoundingClientRect().top : innerHeight) - 8; return c.top >= top - 0.5 && c.bottom <= bottom + 0.5; })()`);
  assert.ok(await eventually(inBand, (x) => x, 1500), 'the caret is in the band within 500 ms of the resize');
});

test('fr_ux_04_ac10_bar_taps_keep_keyboard_and_selection', async () => {
  ready();
  const { v } = await openEdit('note/Pages/Deset bloků.md');
  await tapWord(v, 'Pátý');
  assert.ok(await eventually(() => imeShown(), (s) => s, 1000), 'the keyboard');
  assert.ok(await v.waitFor(BAR, 1000), 'the Formatting bar');
  for (const sel of [`${BAR} [data-command="edit.bold"]`, `${BAR} [data-command="edit.blockType"]`]) {
    await tapEl(v, sel);
    await sleep(300);
    if (sel.includes('blockType')) { await tapEl(v, '[data-command="edit.blockType:heading2"]'); await sleep(300); }
    assert.equal(imeShown(), true, `${sel}: mInputShown=true after the tap`);
  }
  await tapEl(v, `${BAR} [data-command="edit.undo"]`);
  await sleep(300);
  assert.equal(imeShown(), true, 'after Undo the keyboard stays');
  await caretIn(v, 'Pátý', 'end');
  imeCommit(' [[C');
  assert.ok(await v.waitFor('[role="listbox"][aria-label="Link suggestions"] [role="option"]', 2000), 'Link suggestions');
  await tapEl(v, '[role="listbox"][aria-label="Link suggestions"] [role="option"]');
  await sleep(300);
  assert.equal(imeShown(), true, 'after a link row the keyboard stays');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-06 AC-12, AC-13

test('fr_edt_06_ac12_link_panel_on_the_phone', async () => {
  ready();
  const { v } = await openEdit();
  await tapWord(v, 'Konec');
  await caretIn(v, 'Konec.', 'end');
  imeCommit(' [[cil');
  assert.ok(await v.waitFor('.phone-panel [role="listbox"][aria-label="Link suggestions"]', 2000), 'the panel');
  const f = systemFrames();
  const r = await cssRect(v, '.phone-panel');
  const dpr = await v.eval<number>('devicePixelRatio');
  const wv = webViewRect();
  assert.ok(r && f.ime && Math.abs(wv.top + r.bottom * dpr - f.ime.top) <= 2, 'its bottom edge at the keyboard\'s top (± 2 device px)');
  assert.match(await v.eval<string>(`document.querySelector('[aria-label="Link suggestions"] [role="option"]').innerText`), /^Cíl/, 'Cíl first');
});

test('fr_edt_06_ac13_choose_and_create_on_the_phone', async () => {
  ready();
  const { v, vault } = await openEdit();
  await tapWord(v, 'Konec');
  await caretIn(v, 'Konec.', 'end');
  imeCommit(' [[Nová stránka');
  assert.ok(await v.waitFor('[aria-label="Link suggestions"] [role="option"]', 2000), 'the panel');
  await v.eval(`(() => { const o = [...document.querySelectorAll('[aria-label="Link suggestions"] [role="option"]')].find((x) => x.innerText.trim() === 'Create "Nová stránka"'); o.click(); return true; })()`);
  const made = await eventually(() => sh(`ls ${quote(`${vault}/Quick Notes`)}`, false), (l) => l.includes('Nová stránka.md'), 3000);
  assert.ok(made.includes('Nová stránka.md'), 'Quick Notes/Nová stránka.md on the device');
  const t = await waitFile(`${vault}/${PSANI}`, (x) => x.includes('[[Nová stránka]]'), 3000);
  assert.ok(t.includes('[[Nová stránka]]'), 'Psaní holds [[Nová stránka]]');
  assert.deepEqual(ipcWrites().filter((c) => c === 'note_create' || c === 'note_write'), ['note_create', 'note_write'], 'note_create, then the edited note');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-08 AC-15…AC-18

test('fr_edt_08_ac15_composition_never_saved_half_done', async () => {
  ready();
  const { vault, v } = await openEdit();
  await tapWord(v, 'Konec');
  await caretIn(v, 'Konec.', 'end');
  imeCompose('zářijo');
  home();
  await sleep(2000);
  sh(`am force-stop ${TEST_ID}`);
  const t = read(`${vault}/${PSANI}`);
  assert.ok(t.includes('Konec.zářijo'), 'the file contains zářijo (the hidden flush, CP-6)');
  assert.deepEqual(tmpFiles(vault), [], 'no .tegg-tmp file is left');
});

test('fr_edt_08_ac16_android_may_stop_the_app', async () => {
  ready();
  // (a) and (d): Ahoj at the end of Psaní, then HOME + am kill, or the task removed from Recents
  for (const how of ['kill', 'recents'] as const) {
    const { v, vault } = await openEdit();
    await tapWord(v, 'Konec');
    await caretIn(v, 'Konec.', 'end');
    imeCommit(' Ahoj');
    if (how === 'kill') amKill(); else removeTask();
    await sleep(1500);
    assert.ok(read(`${vault}/${PSANI}`).includes('Konec. Ahoj'), `(${how === 'kill' ? 'a' : 'd'}) the file contains Ahoj`);
    const n = ipcLog().length;
    start(TEST_ID, { cold: false });
    const v2 = await webview(TEST_ID);
    views.push(v2);
    assert.ok(await titleIs(v2, 'Psaní', 15_000), 'the start lands on Psaní (D-2421)');
    await sleep(1500);
    assert.equal(await v2.eval<boolean>(`!!document.querySelector('[role="dialog"]')`), false, 'no dialog');
    assert.deepEqual(ipcLog().slice(n).map((x) => x.cmd).filter((c) => c === 'note_write'), [], 'no further write');
    assert.deepEqual(tmpFiles(vault), [], 'no .tegg-tmp file');
  }
  // (b) a new/quick-note draft with Nákup typed into Title, not committed
  {
    const { v, vault } = await openEdit('new/quick-note');
    assert.ok(await v.waitFor('main [role="textbox"][aria-label="Title"]', 5000), 'Title');
    imeCommit('Nákup');
    amKill();
    await sleep(1500);
    assert.match(read(`${vault}/Quick Notes/Nákup.md`), /^title: Nákup$/m, '(b) Quick Notes/Nákup.md with title: Nákup');
    assert.equal(ipcLog().filter((x) => x.cmd === 'note_create').length, 1, '(b) written once');
  }
  // (c) Porada with Sál B typed into místo, not committed
  {
    const vault = pushVault(['tests/fixtures/vaults/types', 'tests/fixtures/vaults/new-empty/.tegg'], 'Typy');
    const { v } = await openEdit('note/Schůzky/2026-10-07 Porada.md', {}, vault);
    await v.click('[data-command="phone.properties"]');
    const MISTO = '[role="dialog"][aria-label="Properties"] input[aria-label="Místo"]';
    assert.ok(await v.waitFor(MISTO, 3000), 'the Místo field');
    await tapEl(v, MISTO);
    assert.ok(await eventually(() => imeShown(), (s) => s, 1500), 'the keyboard for Místo');
    imeCommit('Sál B');
    amKill();
    await sleep(1500);
    assert.match(read(`${vault}/Schůzky/2026-10-07 Porada.md`), /^místo: Sál B$/m, '(c) the flush commits místo');
    assert.equal(ipcLog().filter((x) => x.cmd === 'note_write').length, 1, '(c) one write');
  }
});

test('fr_edt_08_ac17_unwritable_edits_kept_on_the_phone', async () => {
  ready();
  const { v, vault } = await openEdit();
  assert.deepEqual(recoveryFiles(), [], 'with nothing pending, recovery/ holds no file');
  await tapWord(v, 'Konec');
  await caretIn(v, 'Konec.', 'end');
  imeCommit('X');
  pushReplace(`${vault}/${PSANI}`, fixture('phone-edit/Pages/Psaní.md').replace('Konec.', 'Konec z disku.'));
  assert.ok(await v.waitFor('[role="alert"].phone-merge', 3000), 'the merge banner');
  const disk = read(`${vault}/${PSANI}`);
  home();
  await sleep(300);
  assert.equal(recoveryFiles().length, 1, 'the editor\'s content is in recovery/');
  assert.equal(read(`${vault}/${PSANI}`), disk, 'the vault stays as it was');
  amKill();
  start(TEST_ID, { cold: false });
  const v2 = await webview(TEST_ID);
  views.push(v2);
  assert.ok(await v2.waitFor('[role="alert"]', 15_000), 'the banner after a new start');
  assert.match(await v2.eval<string>(`[...document.querySelectorAll('[role="alert"]')].map((a) => a.innerText).join(' ')`), /Tegg kept your unsaved changes to “Psaní” on this phone\./, 'the recovered banner');
  await v2.click('[data-command="phone.merge.keepMine"]');
  const t = await waitFile(`${vault}/${PSANI}`, (x) => x.includes('Konec.X'), 3000);
  assert.ok(t.includes('Konec.X'), 'Keep mine writes the kept text');
  // the copy is dropped just after note_write returns (D-2557)
  assert.deepEqual(await eventually(() => recoveryFiles(), (f) => f.length === 0, 1000), [], 'any choice removes the recovery copy');
});

test('fr_edt_08_ac18_renderer_death_loses_at_most_one_second', async () => {
  ready();
  const { v, vault, pid } = await openEdit();
  await tapWord(v, 'Konec');
  await caretIn(v, 'Konec.', 'end');
  imeCommit(' Uloženo');
  await sleep(2000);
  imeCommit(' pozdě');
  await sleep(100);
  killRenderer();
  await sleep(500);
  assert.equal(pidOf(TEST_ID), pid, 'the app process keeps running');
  const v2 = await webview(TEST_ID, 10_000);
  views.push(v2);
  assert.ok(await titleIs(v2, 'Psaní', 5000), 'within 5 s the page reloads on note/Pages/Psaní.md');
  const t = read(`${vault}/${PSANI}`);
  assert.match(t, /^---\nid: 01JBAN3000000000000000E001\n[\s\S]*\n---\n/, 'the file is complete and its frontmatter valid');
  assert.ok(t.includes('Konec. Uloženo'), 'it holds the saved edit');
  await v2.eval('location.reload()').catch(() => undefined);
  await sleep(1500);
  assert.deepEqual(tmpFiles(vault), [], 'no .tegg-tmp file after the next open');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-38, AC-39

test('fr_fmt_07_ac38_opening_on_the_phone_writes_nothing', async () => {
  ready();
  const vault = pushVault(['tests/fixtures/vaults/new-empty/.tegg'], 'Korpus');
  sh(`mkdir -p ${quote(`${vault}/Pages`)}`);
  const r = adb(['push', `${resolve(REPO, 'tests/fixtures/format/roundtrip')}/.`, `${vault}/Pages`]);
  assert.equal(r.status, 0, 'the corpus is pushed');
  sh(`rm -f ${quote(`${vault}/Pages/README.md`)}`, false);
  const files = sh(`cd ${quote(`${vault}/Pages`)} && find . -name '*.md' | sort`, false).split('\n').map((l) => l.trim().replace(/^\.\//, '')).filter(Boolean);
  const before = fileState(vault);
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'inbox', TEGG_NOW: NOW }, views);
  for (const f of files) {
    await v.eval(`window.__TEGG_TEST__?.run?.('goto.search')`).catch(() => undefined);
    await v.click('[data-command="goto.search"]').catch(() => undefined);
    assert.ok(await v.waitFor('header[role="banner"] [role="search"] input', 5000), `${f}: the Search query`);
    await v.eval(`(() => { const i = document.querySelector('header[role="banner"] [role="search"] input'); i.focus(); i.select(); return true; })()`);
    await v.type(f.split('/').pop()!.replace(/\.md$/, ''));
    await sleep(600);
    await v.key('Enter');
    await sleep(800);
    for (const k of [0, 1, 2]) await v.eval(`(() => { const b = document.querySelector('${BODY}'); const c = b && b.children[${k}]; if (c) c.scrollIntoView(); return true; })()`);
    if (await v.waitFor(BODY, 500)) { await tapWord(v, (await v.eval<string>(`(document.querySelector('${BODY}')?.innerText ?? '').trim().split(/\\s+/)[0] ?? ''`)) || 'a').catch(() => undefined); }
    await v.eval(`(() => { const m = [...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0); if (m) m.scrollTop = m.scrollHeight; return true; })()`);
    sh('input keyevent KEYCODE_BACK');
    home();
    resume(TEST_ID);
    await sleep(500);
    sh('input keyevent KEYCODE_BACK');
  }
  assert.deepEqual(ipcWrites(), [], 'the IPC log has no write command');
  assert.deepEqual(fileState(vault), before, 'every file\'s SHA-256, size, inode and mtime are unchanged');
});

test('fr_fmt_07_ac39_one_edit_one_block_on_the_phone', async () => {
  ready();
  const { v, vault } = await openEdit('note/Pages/Deset bloků.md');
  await tapWord(v, 'Pátý');
  // the tap's own caret lands with the keyboard: wait for it and ~300 ms before placing the caret (D-2557)
  assert.ok(await eventually(() => imeShown(), (s) => s, 1500), 'the keyboard');
  await sleep(300);
  await caretIn(v, 'test upraví.', 'end');
  imeCommit(' Doplněno.');
  const orig = fixture('editor/Pages/Deset bloků.md');
  const t = await waitFile(`${vault}/Pages/Deset bloků.md`, (x) => x.includes('Doplněno.'), 4000);
  assert.equal(normModified(t), withModified(orig.replace('Pátý blok, který test upraví.', 'Pátý blok, který test upraví. Doplněno.')), 'only block 5 and modified differ');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-18

test('fr_fmt_12_ac18_nfd_named_note_read_only_on_the_phone', async () => {
  ready();
  const vault = pushEdit();
  const nfdPath = `${vault}/Pages/Poznámka.md`;
  writeShared(nfdPath, '---\nid: 01JBAN3000000000000000P001\ntype: page\ntitle: Poznámka\nreview: unreviewed\n---\n- [ ] Úkol v poznámce\n');
  writeShared(`${vault}/Pages/Úvodní.md`, '---\nid: 01JBAN3000000000000000P002\ntype: page\ntitle: Úvodní\n---\nViz [[Poznámka]].\n');
  const before = fileState(nfdPath);
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'note/Pages/Poznámka.md', TEGG_NOW: NOW }, views);
  assert.ok(await v.waitFor('[role="alert"]', 10_000), 'the alert');
  assert.match(await v.eval<string>(`[...document.querySelectorAll('[role="alert"]')].map((a) => a.innerText).join(' ')`), /This note's file name uses a Unicode form the phone can't save safely\. Edit it on the Mac\./, 'phone.nfdReadOnly');
  assert.equal(await v.eval<boolean>(`!!document.querySelector('main [contenteditable="true"]')`), false, 'the read view');
  await v.eval(`(() => { for (const c of document.querySelectorAll('main [role="checkbox"]')) c.click(); return true; })()`);
  await sleep(10_000);
  assert.deepEqual(fileState(nfdPath), before, 'after 10 s its bytes, name bytes, inode and mtime are unchanged');
  assert.ok(!ipcLog().some((x) => ['note_write', 'object_trash', 'note_trash'].includes(x.cmd)), 'no write command names it');
});

// ------------------------------------------------------------------------------------------------ once each

test('fr_vlt_05_ac17_choice_opens_an_unsaved_draft', async () => {
  ready();
  const vault = pushVault(['tests/fixtures/vaults/inbox', 'tests/fixtures/vaults/new-empty/.tegg'], 'Doručené');
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'inbox', TEGG_NOW: NOW }, views);
  await v.click('[data-command="object.new"]');
  await sleep(500);
  await v.eval(`(() => { const o = [...document.querySelectorAll('[role="dialog"][aria-label="New object"] [role="option"]')].find((x) => /^Nápad/.test(x.innerText)); o.click(); return true; })()`);
  assert.ok(await eventually(() => imeShown(), (s) => s, 1500), 'Title with the keyboard');
  imeCommit('Čajovna');
  imeKey(KEYCODE_ENTER);
  const t = await waitFile(`${vault}/Nápady/Čajovna.md`, (x) => x.includes('hodnocení'), 4000);
  for (const re of [/^hodnocení: 3$/m, /^oblast: osobní$/m, /^review: unreviewed$/m]) assert.match(t, re, `the first write holds ${re.source}`);
});

test('fr_dly_02_ac11_today_virtual_until_a_keystroke_on_the_phone', async () => {
  ready();
  const vault = pushVault(['tests/fixtures/vaults/daily', 'tests/fixtures/vaults/new-empty/.tegg'], 'Deník');
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'daily/2026-10-14', TEGG_NOW: NOW }, views);
  assert.ok(await v.waitFor(BODY, 10_000), 'the virtual day in the editor');
  await sleep(1000);
  assert.equal(imeShown(), false, 'no keyboard');
  await tapEl(v, BODY);
  assert.ok(await eventually(() => imeShown(), (s) => s, 1000), 'a tap shows the keyboard');
  imeCommit('Dnes');
  const t = await waitFile(`${vault}/Daily/2026-10-14.md`, (x) => x.includes('Dnes'), 4000);
  assert.match(t, /^date: 2026-10-14$/m, 'Daily/2026-10-14.md');
  assert.equal(ipcLog().filter((x) => x.cmd === 'daily_create').length, 1, 'once, through daily_create');
});

test('fr_tsk_02_ac14_checkboxes_complete_tasks_on_the_phone', async () => {
  ready();
  const vault = pushVault(['tests/fixtures/vaults/tasks', 'tests/fixtures/vaults/new-empty/.tegg', 'tests/fixtures/vaults/views-tasks'], 'Úkoly');
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'type/task', TEGG_NOW: NOW }, views);
  assert.ok(await v.waitFor('[data-command="task.complete:Tasks/Zalít květiny.md"]', 10_000), 'T03\'s checkbox');
  await tapEl(v, '[data-command="task.complete:Tasks/Zalít květiny.md"]');
  const t = await waitFile(`${vault}/Tasks/Zalít květiny.md`, (x) => x.includes('status: Done'), 3000);
  assertInstant(t, 'completed');
});

test('fr_inb_02_ac18_reviewed_on_the_phone', async () => {
  ready();
  const vault = pushVault(['tests/fixtures/vaults/inbox', 'tests/fixtures/vaults/new-empty/.tegg'], 'Doručené');
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'inbox', TEGG_NOW: NOW }, views);
  const sel = '[data-command="note.markReviewed:Quick Notes/Koupit mléko.md"]';
  assert.ok(await v.waitFor(sel, 10_000), 'Q1\'s Reviewed');
  await tapEl(v, sel);
  const t = await waitFile(`${vault}/Quick Notes/Koupit mléko.md`, (x) => x.includes('review: reviewed'), 3000);
  assert.match(t, /^review: reviewed$/m, 'Q1 is reviewed on the device');
});

test('fr_his_01_ac16_move_one_note_to_the_trash_on_the_phone', async () => {
  ready();
  const vault = pushEdit();
  const before = fileState(`${vault}/Pages`)['Psaní.md'];
  const { v } = await launchPhone(vault, { TEGG_ROUTE: `note/${PSANI}`, TEGG_NOW: NOW }, views);
  assert.ok(await v.waitFor('[data-command="phone.more"]', 5000), 'More actions');
  await v.click('[data-command="phone.more"]');
  await v.click('[data-command="object.trash"]');
  await sleep(1500);
  assert.equal(sh(`ls ${quote(`${vault}/${PSANI}`)} 2>/dev/null`, false).trim(), '', 'Pages/Psaní.md is gone');
  const after = fileState(`${vault}/.trash/Pages`)['Psaní.md'];
  assert.ok(after && before && after.sha256 === before.sha256 && after.mtime === before.mtime, '.trash/Pages/Psaní.md keeps its bytes and mtime');
  assert.ok(await titleIs(v, 'Inbox', 3000), 'the app goes Back to the Inbox');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-30, NFR-SEC-01 AC-5

test('fr_ux_08_ac30_talkback_while_editing', async () => {
  ready();
  const { v } = await openEdit();
  await tapWord(v, 'Konec');
  assert.ok(await eventually(() => imeShown(), (s) => s, 1000), 'the keyboard');
  await sleep(500);
  for (const name of ['Heading', 'Bold', 'Italic', 'Link', 'Tag', 'Bulleted list', 'Checklist', 'Indent']) assert.ok(uiNode(name).found, `uiautomator dump lists the bar's ${name}`);
  // the body is exposed as an editable text field holding the note's text (FR-UX-08 AC-30, D-2557)
  assert.ok(/<node[^>]*text="[^"]*Nákup[^"]*"[^>]*class="android\.widget\.EditText"/.test(uiDump()), 'the note body is an android.widget.EditText holding its text');
});

test('nfr_sec_01_ac5_editing_makes_no_connection', async () => {
  ready();
  const uid = uidOf(TEST_ID);
  const { v } = await openEdit('note/Pages/Prázdná.md');
  const seen: string[] = [];
  const sample = () => { seen.push(...socketsOf(uid)); };
  await tapEl(v, BODY);
  const html = readFileSync(resolve(REPO, 'tests/fixtures/editor/paste/web.html'), 'utf8');
  await v.eval(`(() => { const t = document.activeElement; const dt = new DataTransfer(); dt.setData('text/html', ${JSON.stringify(html)}); const e = new Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'clipboardData', { value: dt }); t.dispatchEvent(e); return true; })()`);
  for (let i = 0; i < 10; i++) { sample(); await sleep(100); }
  imeCommit(' https://example.org/a');
  for (let i = 0; i < 10; i++) { sample(); await sleep(100); }
  imeCommit(' [[');
  for (let i = 0; i < 10; i++) { sample(); await sleep(100); }
  assert.deepEqual([...new Set(seen)], [], 'no socket of the app\'s uid while pasting web.html, typing a URL and opening the link panel');
  const perms = sh(`dumpsys package ${TEST_ID}`, false);
  assert.ok(!/android\.permission\.INTERNET: granted=true/.test(perms), 'no INTERNET permission (AC-1)');
  void forceStop; void runAs; void title; void rendererPid; void uiEditable;
});
