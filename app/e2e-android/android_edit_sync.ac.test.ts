// Slice AND-3, LA (the test APK on the emulator; contract docs/contracts/android-edit.md §17.2 `pushReplace`, the sync
// app's temp file then `mv`): docs/acceptance/android-edit.md
// - FR-SYN-03 AC-40 (a clean note reloads in place), AC-41 (once for `Keep both`), AC-43 (once for the delete), AC-44
//   (new files on a partly synced vault);
// - FR-SYN-04 AC-14 (once), AC-16 (the sync app's copies are found);
// - FR-SYN-06 AC-56 (the editing tour), AC-57 (no bulk job, no move); FR-SYN-02 AC-17 (a create never replaces a file).
// Every test starts with `ready()` (requireDevice, the test APK, the test IME): without an emulator it fails, never
// skips. Written from the ACs and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  adb, eventually, fileState, home, install, pushVault, quote, REPO, requireDevice, resume, sh, SHARED, sleep, start, TEST_APK, TEST_ID, webview, type WebView,
} from './helpers/device.ts';
import { caretIn, editorTextOf, imeShown, ipcLog, ipcWrites, launchPhone, pushEdit, pushReplace, rotate, tapEl, tapWord, titleIs, tmpFiles } from './helpers/phone.ts';
import { imeCommit, imeRestore, imeUse } from './helpers/ime.ts';
import { WRITE_COMMANDS } from '../ui/test/phone-writes.ts';

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
const read = (path: string) => sh(`cat ${quote(path)}`, false);
const exists = (path: string) => sh(`ls ${quote(path)} 2>/dev/null`, false).trim() !== '';
const fixture = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults', rel), 'utf8');
const NEVER = ['note_rename', 'type_move', 'type_move_plan', 'folder_move_preview', 'tidy_now', 'merge_start', 'tag_rename', 'tag_delete', 'inbox_bulk', 'type_patch', 'vault_settings_patch', 'media_add', 'media_add_paths', 'trash_delete', 'trash_empty'];
const noBulk = (what: string) => assert.deepEqual(ipcLog().map((x) => x.cmd).filter((c) => NEVER.includes(c) || c.startsWith('job_') || /^query_(apply|revert|create|duplicate|rename|trash|restore)$/.test(c)), [], `${what}: no bulk job or move (FR-SYN-06 AC-57)`);
async function openPsani(vault = pushEdit()) {
  const { v } = await launchPhone(vault, { TEGG_ROUTE: `note/${PSANI}`, TEGG_NOW: NOW }, views);
  assert.ok(await v.waitFor(BODY, 15_000), 'Psaní\'s editor');
  return { v, vault };
}

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-40

test('fr_syn_03_ac40_clean_note_reloads_in_place_on_the_phone', async () => {
  ready();
  const { v, vault } = await openPsani();
  await tapWord(v, 'Konec');
  await caretIn(v, 'Konec.', 3);
  const scroll = await v.eval<number>(`[...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0)?.scrollTop ?? 0`);
  const n = ipcLog().length;
  pushReplace(`${vault}/${PSANI}`, fixture('phone-edit/Pages/Psaní.md').replace('Text s [[Cíl]] a #projekt.', 'Text s [[Cíl]].'));
  assert.ok(await eventually(async () => ((await editorTextOf(v)) ?? '').includes('Text s [[Cíl]].\n'), (x) => x, 2000), 'within 2 s the editor shows the new text');
  const c = await v.eval<{ block: string; offset: number }>(`(() => { const s = getSelection(); const r = s.getRangeAt(0); const b = r.startContainer.parentElement.closest('p'); const pre = document.createRange(); pre.setStart(b, 0); pre.setEnd(r.startContainer, r.startOffset); return { block: b.innerText.trim(), offset: pre.toString().length }; })()`);
  assert.deepEqual([c.block, c.offset], ['Konec.', 3], 'the caret is still in Konec. at offset 3');
  assert.equal(imeShown(), true, 'the keyboard is still shown');
  const s2 = await v.eval<number>(`[...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0)?.scrollTop ?? 0`);
  assert.ok(Math.abs(s2 - scroll) <= 24, 'the scroll position holds (± one line)');
  assert.equal(await v.eval<boolean>(`!!document.querySelector('.phone-merge')`), false, 'no banner');
  assert.deepEqual(ipcLog().slice(n).map((x) => x.cmd).filter((x) => WRITE_COMMANDS.includes(x)), [], 'nothing is written');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-41 (Keep both)

test('fr_syn_03_ac41_both_changed_banner_on_the_phone', async () => {
  ready();
  const { v, vault } = await openPsani();
  await tapWord(v, 'Konec');
  await caretIn(v, 'Konec.', 'end');
  imeCommit('X');
  await sleep(150);
  const theirs = fixture('phone-edit/Pages/Psaní.md').replace('Konec.', 'Konec z jiného zařízení.');
  pushReplace(`${vault}/${PSANI}`, theirs);
  assert.ok(await v.waitFor('[role="alert"].phone-merge', 2000), 'within 2 s the banner');
  await sleep(10_000);
  assert.equal(read(`${vault}/${PSANI}`), theirs, 'the file keeps the external bytes (checked after 10 s)');
  await v.click('[data-command="phone.merge.keepBoth"]');
  const copy = `${vault}/Pages/Psaní (conflict 2026-10-14 12-00).md`;
  assert.ok(await eventually(() => exists(copy), (x) => x, 3000), 'Keep both creates Pages/Psaní (conflict 2026-10-14 12-00).md');
  assert.match(read(copy), /^id: 01JBAN3000000000000000E001$/m, 'with the same id');
  noBulk('AC-41');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-43 (delete)

test('fr_syn_03_ac43_deleted_or_renamed_while_editing_on_the_phone', async () => {
  ready();
  const { v, vault } = await openPsani();
  await tapWord(v, 'Konec');
  await caretIn(v, 'Konec.', 'end');
  imeCommit('X');
  await sleep(150);
  sh(`rm ${quote(`${vault}/${PSANI}`)}`);
  assert.ok(await eventually(() => v.eval<string>(`[...document.querySelectorAll('[role="alert"]')].map((a) => a.innerText).join(' ')`), (t) => /This note was deleted outside Tegg/.test(t), 3000), 'the deleted alert');
  await v.click('[data-command="phone.deleted.restore"]');
  const t = await eventually(() => read(`${vault}/${PSANI}`), (x) => x.includes('Konec.X'), 3000, 200);
  assert.ok(t.includes('Konec.X'), 'Restore file creates Pages/Psaní.md with the editor\'s content');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-44

test('fr_syn_03_ac44_new_files_on_a_partly_synced_vault', async () => {
  ready();
  // (a) the other device's Daily Note pushed before the first write
  const vault = pushEdit();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'daily/2026-10-14', TEGG_NOW: NOW }, views);
  assert.ok(await v.waitFor(BODY, 10_000), 'the virtual day');
  await tapEl(v, BODY);
  const theirs = '---\nid: 01JBAN3000000000000000D901\ntype: daily-note\ntitle: 2026-10-14\ndate: 2026-10-14\ncreated: 2026-10-14T08:00:00+02:00\nmodified: 2026-10-14T08:00:00+02:00\n---\nZ Macu.\n';
  sh(`mkdir -p ${quote(`${vault}/Daily`)}`);
  pushReplace(`${vault}/Daily/2026-10-14.md`, theirs);
  imeCommit('Dnes');
  assert.ok(await eventually(() => exists(`${vault}/Daily/2026-10-14 (2).md`), (x) => x, 4000), '(a) the phone\'s note is Daily/2026-10-14 (2).md');
  assert.equal(read(`${vault}/Daily/2026-10-14.md`), theirs, '(a) the pushed file keeps its bytes');
  // (b) a [[Lisabon create, then another device's Pages/Lisabon.md
  const { v: v2, vault: v2root } = await openPsani();
  await tapWord(v2, 'Konec');
  await caretIn(v2, 'Konec.', 'end');
  imeCommit(' [[Lisabon');
  assert.ok(await v2.waitFor('[aria-label="Link suggestions"] [role="option"]', 2000), 'the panel');
  await v2.eval(`(() => { const o = [...document.querySelectorAll('[aria-label="Link suggestions"] [role="option"]')].find((x) => x.innerText.trim() === 'Create “Lisabon”'); o.click(); return true; })()`);
  assert.ok(await eventually(() => exists(`${v2root}/Quick Notes/Lisabon.md`), (x) => x, 3000), 'Quick Notes/Lisabon.md');
  const before = fileState(`${v2root}/Quick Notes`);
  pushReplace(`${v2root}/Pages/Lisabon.md`, '---\nid: 01JBAN3000000000000000L002\ntype: page\ntitle: Lisabon\n---\nZ Macu.\n');
  await sleep(2500);
  assert.deepEqual(fileState(`${v2root}/Quick Notes`), before, '(b) nothing is renamed or rewritten');
  noBulk('AC-44');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-04 AC-14, AC-16

test('fr_syn_04_ac14_keep_one_on_the_phone', async () => {
  ready();
  const vault = pushVault(['tests/fixtures/vaults/conflicts', 'tests/fixtures/vaults/new-empty/.tegg'], 'Konflikty');
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'conflicts', TEGG_NOW: NOW }, views);
  assert.ok(await v.waitFor('main [role="list"][aria-label="Conflicts"] a', 10_000), 'the Conflicts list');
  await v.eval(`(() => { const a = [...document.querySelectorAll('main [role="list"][aria-label="Conflicts"] a')].find((x) => x.innerText.includes('conflicted copy')); a.click(); return true; })()`);
  await v.click('[data-command="phone.conflict.keep:1"]');
  await v.click('[data-command="phone.conflict.confirm"]');
  const copy = `${vault}/Pages/Plán (conflicted copy 2026-10-07).md`;
  assert.ok(await eventually(() => !exists(copy), (x) => x, 3000), 'the copy goes to the trash');
  assert.ok(exists(`${vault}/.trash/Pages/Plán (conflicted copy 2026-10-07).md`), 'in .trash/');
  assert.match(read(`${vault}/Pages/Plán.md`), /^id: 01JB0K0000000000000000K001$/m, 'Plán.md keeps its id');
});

test('fr_syn_04_ac16_sync_app_copies_are_found', async () => {
  ready();
  const vault = pushVault(['tests/fixtures/vaults/conflicts', 'tests/fixtures/vaults/new-empty/.tegg'], 'Konflikty');
  sh(`rm -f ${quote(`${vault}/Pages/Plán (conflicted copy 2026-10-07).md`)}`);
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'conflicts', TEGG_NOW: NOW }, views);
  const plan = fixture('conflicts/Pages/Plán.md');
  pushReplace(`${vault}/Pages/Plán (1).md`, plan.replace('Řádek 5 plánu.', 'Řádek 5 z telefonu.'));
  pushReplace(`${vault}/Pages/Zápis jiný (1).md`, '---\nid: 01JBAN3000000000000000C099\ntype: page\ntitle: Zápis jiný\n---\nNěco úplně jiného.\n');
  const listed = await eventually(() => v.eval<string>(`[...document.querySelectorAll('main [role="list"][aria-label="Conflicts"] a')].map((a) => a.innerText).join('|')`), (t) => t.includes('Plán (1).md'), 2000);
  assert.ok(listed.includes('Plán (1).md'), 'the copy with Plán\'s id is listed within 2 s');
  assert.ok(!listed.includes('Zápis jiný (1)'), 'a file of that pattern with its own id and other lines isn\'t');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-56, AC-57

test('fr_syn_06_ac56_editing_tour_on_the_phone', async () => {
  ready();
  const vault = pushEdit();
  const before = fileState(vault);
  const { v } = await launchPhone(vault, { TEGG_ROUTE: `note/${PSANI}`, TEGG_NOW: NOW }, views);
  assert.ok(await v.waitFor(BODY, 15_000), 'Psaní');
  // (a) the tour without writes
  for (const word of ['Nákup', 'chléb', 'Konec']) { await tapWord(v, word); await sleep(200); }
  sh('input keyevent KEYCODE_BACK');
  await v.click('[data-command="phone.more"]');
  await v.click('[data-command="phone.properties"]');
  await sleep(300);
  sh('input keyevent KEYCODE_BACK');
  await v.click('[data-command="object.new"]');
  await sleep(300);
  sh('input keyevent KEYCODE_BACK');
  rotate(1);
  await sleep(800);
  rotate(0);
  home();
  resume(TEST_ID);
  await sleep(800);
  start(TEST_ID);
  const v2 = await webview(TEST_ID);
  views.push(v2);
  await titleIs(v2, 'Psaní', 15_000);
  assert.deepEqual(ipcWrites(), [], '(a) zero writes');
  assert.deepEqual(fileState(vault), before, '(a) the vault is untouched');
  // (b) typing in Psaní for 10 s: Psaní only, at most 10 writes
  await tapWord(v2, 'Konec');
  await caretIn(v2, 'Konec.', 'end');
  const t0 = Date.now();
  while (Date.now() - t0 < 10_000) { imeCommit('a'); await sleep(200); }
  await sleep(1500);
  const writes = ipcLog().filter((x) => x.cmd === 'note_write');
  assert.ok(writes.length >= 1 && writes.length <= 10, `(b) at most 10 writes (${writes.length})`);
  const changed = Object.entries(fileState(vault)).filter(([k, s]) => JSON.stringify(before[k]) !== JSON.stringify(s)).map(([k]) => k);
  assert.deepEqual(changed, [PSANI], '(b) Psaní only');
  noBulk('AC-56');
});

test('fr_syn_06_ac57_still_no_bulk_job_or_move_on_the_phone', async () => {
  ready();
  const vault = pushVault(['tests/fixtures/vaults/type-moves', 'tests/fixtures/vaults/new-empty/.tegg'], 'Knihovna');
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'note/Pages/Kniha jinde.md', TEGG_NOW: NOW }, views);
  assert.ok(await v.waitFor(BODY, 15_000), 'Kniha jinde');
  await tapWord(v, 'Válka');
  await caretIn(v, 'Válka s mloky.', 'end');
  imeCommit(' Doplněno.');
  const t = await eventually(() => read(`${vault}/Pages/Kniha jinde.md`), (x) => x.includes('Doplněno.'), 4000, 200);
  assert.ok(t.includes('Doplněno.'), 'saved at its path');
  assert.equal(exists(`${vault}/Knihy/Kniha jinde.md`), false, 'not moved to Knihy/');
  noBulk('AC-57');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-02 AC-17

test('fr_syn_02_ac17_create_never_replaces_a_file', async () => {
  ready();
  const vault = pushEdit();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'new/quick-note', TEGG_NOW: NOW }, views);
  assert.ok(await v.waitFor('main [role="textbox"][aria-label="Title"]', 10_000), 'the draft\'s Title');
  imeCommit('Nákup');
  sh(`mkdir -p ${quote(`${vault}/Quick Notes`)}`);
  const pushed = '---\nid: 01JBAN3000000000000000X001\ntype: quick-note\ntitle: Nákup\n---\nZ jiného zařízení.\n';
  pushReplace(`${vault}/Quick Notes/Nákup.md`, pushed);
  const before = fileState(`${vault}/Quick Notes/Nákup.md`);
  sh('input keyevent KEYCODE_ENTER');
  assert.ok(await eventually(() => exists(`${vault}/Quick Notes/Nákup (2).md`), (x) => x, 4000), 'the draft becomes Quick Notes/Nákup (2).md');
  assert.equal(read(`${vault}/Quick Notes/Nákup.md`), pushed, 'the pushed file keeps its bytes');
  assert.deepEqual(fileState(`${vault}/Quick Notes/Nákup.md`), before, 'and its inode and mtime');
  assert.deepEqual(tmpFiles(vault), [], 'no temp file left');
});
