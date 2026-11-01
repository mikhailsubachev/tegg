// MS6 slice 6A, L5 (WebKit + fake core): the trash, docs/acceptance/trash-media.md FR-HIS-01 AC-1 (Move to trash
// from a note: one rename, no dialog, Back, toast with Undo, autosave flush first), AC-2 (a changed file is never
// trashed), AC-3 (task card, Type page rows, palette; Daily Notes and unsaved objects), AC-4 (R70/R71 list, live,
// (TZ)), AC-5 (restore, ` (2)`, folder rows), AC-6 (read-only from the trash), AC-7 (delete permanently: dialog,
// system trash), AC-8 (empty trash, failures), AC-9 (keyboard, strings, contrast). The Inbox's part of AC-3 is
// inbox_trash.ac.test.ts. Interface docs/contracts/ms6-trash-media.md §4 (`trash_list`, `object_trash`,
// `trash_restore`, `trash_delete`, `trash_empty`, `trash:changed`), §6.2 (`moveToTrash`, TrashPage, registry), §8, §9.2
// (fake core: `trashedAt`, `moves()`, `systemTrash()`). Written from the ACs and the contract only (D-61). Every lookup
// goes through `must` (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  ROW_ORDER, TM, TRASHED_AT, ZONES, alertWith, callsOf, caretIn, click, deleteBtn, deletedText, description, dialogNamed, editorBody,
  emptyBtn, eventually, flat, gotoTrash, isDisabled, liveSays, main, moreBtn, moreItem, must, mustBeOn, nfc, openTM, original, restoreBtn, rowPaths,
  rowsWhen, runCommand, seen, sidebar, sleep, startTM, tmVault, toastWith, trashHeading, trashList, trashRow, undoIn, vaultWrites6a, ws, zeroRegion,
  type FakeCoreHandle,
} from './trash-media-helpers';
import { goToQuery, gotoType, openNote, pseudoLocale, searchResultsList } from './helpers';
import { axeContrast } from './read-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const UKOL = 'Koupit semínka';
const trashedUkol = `.trash/${TM.ukol}`;

async function trashCalls(core: FakeCoreHandle) {
  return (await callsOf(core, 'object_trash')).map((c) => ({ path: nfc(String((c.args as any)?.path)), base: (c.args as any)?.base, ok: c.ok }));
}
async function filesNow(core: FakeCoreHandle) {
  return core.files();
}

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_his_01_ac1_more_move_to_trash_from_a_note', async ({ page }) => {
  const core = await openTM(page, TM.ukol, UKOL);
  const base = await core.version(TM.ukol);
  await moreItem(page, 'Move to trash');
  assert.ok(!(await seen(page.getByRole('dialog'), 300)), 'no confirmation (AP-536)');
  const calls = await eventually(() => trashCalls(core), (c) => c.length > 0, 2000);
  assert.deepEqual(calls.map((c) => [c.path, c.base]), [[nfc(TM.ukol), base]], 'object_trash(path, the loaded version)');
  assert.deepEqual(await core.moves(), [{ kind: 'trash', from: nfc(TM.ukol), to: nfc(trashedUkol) }], 'one rename');
  const files = await filesNow(core);
  assert.equal(files[nfc(TM.ukol)], undefined, 'the note left its folder');
  assert.equal(files[nfc(trashedUkol)], original(TM.ukol), 'the bytes are untouched in .trash/');
  assert.deepEqual(await core.writesTo(), [], 'nothing else written');
  await mustBeOn(page, 'Inbox', 'no history: the app goes to the Inbox', 3000);
  assert.ok(await liveSays(page, `Moved "${UKOL}" to the trash`), 'the live region');
  const toast = await must(toastWith(page, `Moved "${UKOL}" to the trash`), 'the toast');
  await click(undoIn(toast), 'Undo');
  assert.ok((await eventually(() => callsOf(core, 'trash_restore'), (c) => c.length > 0, 2000)).some((c) => nfc(String((c.args as any)?.path)) === nfc(trashedUkol)), 'Undo restores it (AC-5)');
  assert.equal((await filesNow(core))[nfc(TM.ukol)], original(TM.ukol), 'back at its path, same bytes');
  await mustBeOn(page, UKOL, 'Undo returns to the note');
});

test('fr_his_01_ac1_cmd_backspace_outside_the_text_goes_back', async ({ page }) => {
  const core = await openTM(page, TM.plan, 'Plán zahrady');
  await openNote(page, UKOL);
  // In the body ⌘⌫ keeps deleting to the line start.
  await caretIn(page, 1, 'Mrkev a ředkvičky.');
  await page.keyboard.press('Meta+Backspace');
  await sleep(300);
  assert.deepEqual(await trashCalls(core), [], 'in the body ⌘⌫ is text editing, not Move to trash');
  // Outside the text (the header's More button).
  await (await must(moreBtn(page), 'button "More"')).focus();
  await page.keyboard.press('Meta+Backspace');
  const calls = await eventually(() => trashCalls(core), (c) => c.length > 0, 2000);
  assert.equal(calls.length, 1, '⌘⌫ outside the text moves the note to the trash');
  await mustBeOn(page, 'Search', 'the app goes Back (to the Search entry the note was opened from, D-1348)');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Plán zahrady', 'and Back again to Plán zahrady');
});

test('fr_his_01_ac1_unsaved_edits_are_saved_first', async ({ page }) => {
  const core = await openTM(page, TM.ukol, UKOL);
  await caretIn(page, 1, 'Mrkev a ředkvičky.');
  await page.keyboard.insertText(' Hned.');
  await moreItem(page, 'Move to trash');
  const calls = await eventually(() => core.calls(), (c) => c.some((x) => x.cmd === 'object_trash'), 3000);
  const w = calls.findIndex((c) => c.cmd === 'note_write' && nfc(String((c.args as any)?.path)) === nfc(TM.ukol));
  const t = calls.findIndex((c) => c.cmd === 'object_trash');
  assert.ok(w >= 0 && t > w, `the autosave is flushed first (D-196): write at ${w}, trash at ${t}`);
  const trashed = (await filesNow(core))[nfc(trashedUkol)] ?? '';
  assert.ok(trashed.includes('Mrkev a ředkvičky. Hned.'), 'the trashed file has the edit');
});

test('fr_his_01_ac1_a_failed_save_stops_the_trash', async ({ page }) => {
  const core = await openTM(page, TM.ukol, UKOL);
  await caretIn(page, 1, 'Mrkev a ředkvičky.');
  await core.writeControl({ fail: 'Io', path: TM.ukol });
  await page.keyboard.insertText(' Hned.');
  await moreItem(page, 'Move to trash');
  assert.ok(await seen(page.getByRole('alert'), 3000), "the save's alert");
  await sleep(300);
  assert.deepEqual((await trashCalls(core)).filter((c) => c.ok !== false), [], 'nothing moved');
  assert.equal((await filesNow(core))[nfc(TM.ukol)], original(TM.ukol), 'the file stays');
  assert.equal((await core.moves()).length, 0, 'no rename');
  // The Move to trash must have been offered and acted on (the menu item exists and is enabled).
  assert.ok((await core.calls()).some((c) => c.cmd === 'note_write'), 'the flush was attempted');
});

// ------------------------------------------------------------------------------------------------ AC-2

test('fr_his_01_ac2_a_changed_file_is_never_trashed', async ({ page }) => {
  const core = await openTM(page, TM.ukol, UKOL);
  const theirs = original(TM.ukol).replace('Mrkev a ředkvičky.', 'Mrkev, ředkvičky a hrách.');
  await core.setFile(TM.ukol, theirs, { silent: true });
  await moreItem(page, 'Move to trash');
  await must(alertWith(page, `"${UKOL}" changed outside Tegg. It wasn't moved to the trash.`), 'the alert', 3000);
  assert.equal((await filesNow(core))[nfc(TM.ukol)], theirs, 'nothing moves');
  assert.equal((await filesNow(core))[nfc(trashedUkol)], undefined, 'not in .trash/');
  assert.ok(await seen(editorBody(page).getByText('Mrkev, ředkvičky a hrách.'), 2000), 'the note reloads');
});

// ------------------------------------------------------------------------------------------------ AC-3

test('fr_his_01_ac3_task_card_menu', async ({ page }) => {
  const core = await startTM(page);
  await runCommand(page, 'Go to Tasks');
  const card = await must(main(page).getByRole('article', { name: `Task: ${UKOL}`, exact: true }), 'the task card', 5000);
  await click(card.getByRole('button', { name: `More actions for "${UKOL}"`, exact: true }), 'More actions');
  const item = page.getByRole('menu').last().getByRole('menuitem', { name: 'Move to trash', exact: true });
  assert.equal(await isDisabled(item), false, 'enabled (tasks.md R43, no longer Coming in MS6)');
  await click(item, 'Move to trash');
  assert.deepEqual(await eventually(() => core.moves(), (m) => m.length > 0, 2000), [{ kind: 'trash', from: nfc(TM.ukol), to: nfc(trashedUkol) }], 'the same rename');
  assert.ok(!(await seen(main(page).getByRole('article', { name: `Task: ${UKOL}`, exact: true }), 300)) || (await eventually(async () => main(page).getByRole('article', { name: `Task: ${UKOL}`, exact: true }).count(), (n) => n === 0, 1000)) === 0, 'the card leaves');
});

test('fr_his_01_ac3_type_page_rows', async ({ page }) => {
  const core = await startTM(page);
  await gotoType(page, 'Pages');
  const row = (t: string) => main(page).getByRole('row').filter({ hasText: t }).first();
  await (await must(row('Zahrada'), 'row Zahrada')).click({ button: 'right' });
  await click(page.getByRole('menu').last().getByRole('menuitem', { name: 'Move to trash', exact: true }), 'context menu Move to trash');
  const m1 = await eventually(() => core.moves(), (m) => m.length > 0, 2000);
  assert.deepEqual(m1, [{ kind: 'trash', from: nfc(TM.zahrada), to: nfc('.trash/Pages/Zahrada (2).md') }], 'Zahrada goes to .trash/ with ` (2)` (T2 holds the name)');
  await (await must(row('Odkazy'), 'row Odkazy')).focus();
  await page.keyboard.press('Meta+Backspace');
  const m2 = await eventually(() => core.moves(), (m) => m.length > 1, 2000);
  assert.deepEqual(m2[1], { kind: 'trash', from: nfc(TM.odkazy), to: nfc(`.trash/${TM.odkazy}`) }, '⌘⌫ on a focused row');
});

test('fr_his_01_ac3_palette_on_a_note_page', async ({ page }) => {
  const core = await openTM(page, TM.plan, 'Plán zahrady');
  await runCommand(page, 'Move to trash');
  const m = await eventually(() => core.moves(), (x) => x.length > 0, 2000);
  assert.deepEqual(m, [{ kind: 'trash', from: nfc(TM.plan), to: nfc(`.trash/${TM.plan}`) }], 'only the note (its media stay, FR-ATT-09)');
  const files = await filesNow(core);
  for (const p of [TM.img, TM.pdfObj]) assert.equal(files[nfc(p)], original(p), `${p} stays`);
  const bin = await core.binary();
  for (const p of [TM.png, TM.pdf]) assert.ok(bin[nfc(p)], `${p} stays`);
});

test('fr_his_01_ac3_nothing_to_delete_on_virtual_or_unsaved_objects', async ({ page }) => {
  const core = await startTM(page);
  await runCommand(page, 'Go to Today');
  await mustBeOn(page, '2026-10-22', 'the virtual Daily Note of today', 3000);
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Move to trash');
  await sleep(100);
  const opt = page.getByRole('listbox', { name: 'Commands' }).getByRole('option', { name: /Move to trash/ }).first();
  await must(opt, 'the palette lists Move to trash');
  assert.equal(await isDisabled(opt), true, 'aria-disabled on a virtual Daily Note');
  assert.match(await description(opt), /Nothing to delete yet\./, 'reason Nothing to delete yet.');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+n');
  await sleep(300);
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Move to trash');
  await sleep(100);
  const opt2 = page.getByRole('listbox', { name: 'Commands' }).getByRole('option', { name: /Move to trash/ }).first();
  assert.equal(await isDisabled(opt2), true, 'aria-disabled on an unsaved new object (D-523)');
  await page.keyboard.press('Escape');
  assert.deepEqual(await vaultWrites6a(core), [], 'nothing written');
});

test('fr_his_01_ac3_a_daily_note_can_be_trashed', async ({ page }) => {
  const daily = 'Daily/2026-10-22.md';
  const vault = tmVault((f) => {
    f[daily] = '---\nid: 01JB6A0000000000000000F020\ntype: daily-note\ntitle: "2026-10-22"\ndate: 2026-10-22\ncreated: 2026-10-22T08:00:00+02:00\nmodified: 2026-10-22T08:00:00+02:00\n---\nRáno.\n';
  });
  const core = await startTM(page, { vault });
  await runCommand(page, 'Go to Today');
  await mustBeOn(page, '2026-10-22', 'today', 3000);
  await runCommand(page, 'Move to trash');
  const m = await eventually(() => core.moves(), (x) => x.length > 0, 2000);
  assert.deepEqual(m, [{ kind: 'trash', from: daily, to: `.trash/${daily}` }], 'the Daily Note goes to the trash');
  await runCommand(page, 'Go to Today');
  await mustBeOn(page, '2026-10-22', 'its virtual successor shows again (D-321)', 3000);
  assert.equal((await callsOf(core, 'daily_create')).length, 0, 'nothing created');
});

// ------------------------------------------------------------------------------------------------ AC-4 (TZ)

for (const tz of ZONES) {
  test.describe(`trash list in ${tz}`, () => {
    test.use({ timezoneId: tz });
    test(`fr_his_01_ac4_rows_in_order_${tz.replace(/\W/g, '_')}`, async ({ page }) => {
      await startTM(page);
      await gotoTrash(page);
      assert.ok(await seen(main(page).getByText('6 items', { exact: true }), 2000), 'summary 6 items');
      assert.deepEqual(await rowsWhen(page, (r) => r.length === 6), ROW_ORDER, 'R71 order: T3, T2, T4, T5, Folder, T1');
      const want: [string, string, string, string][] = [
        [TM.t3, 'object', 'Smazaný obrázek', 'Images'], [TM.t2, 'object', 'Zahrada', 'Pages'], [TM.t4, 'file', 'osiřelý.jpg', '_attachments'],
        [TM.t5, 'object', 'Hotovo', 'Tasks'], [TM.folder, 'folder', 'Recepty', 'Recepty'], [TM.t1, 'object', 'Stará poznámka', 'Quick Notes'],
      ];
      for (const [path, kind, title, folder] of want) {
        const row = await must(trashRow(page, path), `row ${path}`);
        assert.equal(await row.getAttribute('data-kind'), kind, `${title}: data-kind`);
        const text = ws(await row.innerText());
        assert.ok(text.includes(title), `${title}: title`);
        assert.ok(text.includes(folder), `${title}: original folder ${folder}`);
        assert.ok(text.includes(ws(deletedText(TRASHED_AT[path], 'cs', tz))), `${title}: ${deletedText(TRASHED_AT[path], 'cs', tz)} in ${text}`);
        await must(restoreBtn(page, title), `Restore "${title}"`);
        await must(deleteBtn(page, title), `Delete "${title}" permanently…`);
        await must(row.getByRole('button', { name: title, exact: true }), `${title}: the title opens it`);
      }
      assert.ok(ws(await trashRow(page, TM.folder).innerText()).includes('1 object'), 'Recepty: 1 object (plural forms)');
      assert.ok(!ws(await trashRow(page, TM.folder).innerText()).includes('1 objects'), 'not "1 objects"');
      const all = await rowPaths(page);
      assert.ok(!all.includes(TM.sablona) && !all.includes(TM.plan), 'templates and live notes are not listed');
    });
  });
}

test('fr_his_01_ac4_sidebar_trash_and_live_updates', async ({ page }) => {
  const core = await startTM(page);
  const entry = sidebar(page).locator('a, button, [role="link"], [role="button"]').filter({ has: page.getByText('Trash', { exact: true }) }).first();
  await click(entry, 'sidebar Trash');
  await must(trashHeading(page), 'heading Trash', 3000);
  assert.deepEqual(await rowsWhen(page, (r) => r.length === 6), ROW_ORDER, 'six rows');
  await core.renameFile(TM.zahrada, '.trash/Pages/Zahrada (2).md');
  assert.ok((await rowsWhen(page, (r) => r.includes('.trash/Pages/Zahrada (2).md'))).includes('.trash/Pages/Zahrada (2).md'), 'a file moved into .trash/ by another program is listed within 2 s');
  await core.renameFile(TM.t5, TM.ukol.replace('Koupit semínka', 'Hotovo'));
  assert.ok(!(await rowsWhen(page, (r) => !r.includes(TM.t5))).includes(TM.t5), 'a file moved out of .trash/ leaves within 2 s');
});

// ------------------------------------------------------------------------------------------------ AC-5

test('fr_his_01_ac5_restore_puts_the_file_back', async ({ page }) => {
  const core = await startTM(page);
  await gotoTrash(page);
  await click(restoreBtn(page, 'Stará poznámka'), 'Restore "Stará poznámka"');
  assert.deepEqual(await eventually(() => core.moves(), (m) => m.length > 0, 2000), [{ kind: 'restore', from: nfc(TM.t1), to: 'Quick Notes/Stará poznámka.md' }], 'one rename back');
  const files = await filesNow(core);
  assert.equal(files['Quick Notes/Stará poznámka.md'], original(TM.t1), 'bytes untouched');
  assert.ok(!(await rowsWhen(page, (r) => !r.includes(TM.t1))).includes(TM.t1), 'the row leaves');
  assert.ok(await liveSays(page, 'Restored "Stará poznámka"'), 'the live region');
  await goToQuery(page, 'Stará'); // D-1345: the Search page's results (D-1340; before it the Go to list, D-760)
  assert.ok(await seen(searchResultsList(page).getByRole('link', { name: /Stará poznámka/ }), 2000), 'in the Search results again');
});

test('fr_his_01_ac5_r_restores_the_focused_row', async ({ page }) => {
  const core = await startTM(page);
  await gotoTrash(page);
  await (await must(trashRow(page, TM.t5), 'row Hotovo')).focus();
  await page.keyboard.press('r');
  assert.deepEqual(await eventually(() => core.moves(), (m) => m.length > 0, 2000), [{ kind: 'restore', from: TM.t5, to: 'Tasks/Hotovo.md' }], 'R restores');
});

test('fr_his_01_ac5_restore_into_a_taken_path_gets_a_suffix', async ({ page }) => {
  const core = await startTM(page);
  await gotoTrash(page);
  await click(restoreBtn(page, 'Zahrada'), 'Restore "Zahrada"');
  assert.deepEqual(await eventually(() => core.moves(), (m) => m.length > 0, 2000), [{ kind: 'restore', from: TM.t2, to: 'Pages/Zahrada (2).md' }], 'restored with ` (2)`');
  assert.ok(await liveSays(page, 'Restored "Zahrada" as "Pages/Zahrada (2).md"'), 'the message names the new path');
  assert.equal((await filesNow(core))[TM.zahrada], original(TM.zahrada), 'the live Zahrada is untouched');
});

test('fr_his_01_ac5_restore_a_folder_row', async ({ page }) => {
  const core = await startTM(page);
  await gotoTrash(page);
  await click(restoreBtn(page, 'Recepty'), 'Restore "Recepty"');
  const files = await eventually(() => filesNow(core), (f) => f['Recepty/Bábovka.md'] !== undefined, 2000);
  assert.equal(files['Recepty/Bábovka.md'], original(TM.babovka), 'the folder is back with its files');
  assert.equal(files[nfc(TM.babovka)], undefined, 'nothing left in .trash/Recepty');
  assert.ok(!(await rowsWhen(page, (r) => !r.includes(TM.folder))).includes(TM.folder), 'the row leaves');
});

// ------------------------------------------------------------------------------------------------ AC-6

test('fr_his_01_ac6_open_from_the_trash_read_only', async ({ page }) => {
  const core = await startTM(page);
  await gotoTrash(page);
  await click(trashRow(page, TM.t1).getByRole('button', { name: 'Stará poznámka', exact: true }), 'the title');
  await must(page.getByText('This object is in the trash. Restore it to edit it.'), 'the banner', 3000);
  await must(main(page).getByRole('button', { name: 'Restore', exact: true }), 'the banner\'s Restore');
  assert.ok(await seen(main(page).getByText('Dávno smazané.'), 2000), 'the read view shows the body');
  assert.equal(await editorBody(page).count(), 0, 'no editor');
  assert.equal(await page.getByRole('textbox', { name: 'Title', exact: true }).count(), 0, 'the title is not editable');
  assert.deepEqual(await vaultWrites6a(core), [], 'nothing written');
  await page.keyboard.press('Meta+BracketLeft'); // the app's Back (FR-NAV-03); the browser's history isn't the app's (D-632)
  await gotoTrash(page);
  await click(trashRow(page, TM.t3).getByRole('button', { name: 'Smazaný obrázek', exact: true }), 'the image row');
  await must(main(page).getByRole('img', { name: 'Smazaný obrázek', exact: true }), 'the image shows (R76)', 3000);
});

// ------------------------------------------------------------------------------------------------ AC-7

test('fr_his_01_ac7_delete_permanently_asks_then_moves_to_the_system_trash', async ({ page }) => {
  const core = await startTM(page);
  await gotoTrash(page);
  await click(deleteBtn(page, 'Hotovo'), 'Delete "Hotovo" permanently…');
  const d = await must(dialogNamed(page, 'Delete permanently?'), 'the dialog');
  assert.ok(flat(await d.innerText()).includes('"Hotovo" will be moved to the macOS Trash.'), 'the dialog text');
  const focusedName = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim());
  assert.equal(focusedName, 'Cancel', 'Cancel is the default');
  await page.keyboard.press('Escape');
  await sleep(200);
  assert.equal((await callsOf(core, 'trash_delete')).length, 0, 'Esc does nothing');
  await click(deleteBtn(page, 'Hotovo'), 'Delete "Hotovo" permanently… (again)');
  await click(dialogNamed(page, 'Delete permanently?').getByRole('button', { name: 'Cancel', exact: true }), 'Cancel');
  assert.equal((await callsOf(core, 'trash_delete')).length, 0, 'Cancel does nothing');
  await click(deleteBtn(page, 'Hotovo'), 'Delete "Hotovo" permanently… (third)');
  await click(dialogNamed(page, 'Delete permanently?').getByRole('button', { name: 'Delete', exact: true }), 'Delete');
  const calls = await eventually(() => callsOf(core, 'trash_delete'), (c) => c.length > 0, 2000);
  assert.deepEqual((calls[0]?.args as any)?.paths?.map(nfc), [TM.t5], 'trash_delete of the row');
  assert.deepEqual(await core.systemTrash(), [TM.t5], 'moved to the system trash, not unlinked');
  assert.equal((await filesNow(core))[TM.t5], undefined, 'it left the vault');
  assert.ok(!(await rowsWhen(page, (r) => !r.includes(TM.t5))).includes(TM.t5), 'the row leaves');
});

test('fr_his_01_ac7_a_pair_goes_together_and_cmd_backspace_asks', async ({ page }) => {
  const core = await startTM(page);
  await gotoTrash(page);
  await (await must(trashRow(page, TM.t3), 'row Smazaný obrázek')).focus();
  await page.keyboard.press('Meta+Backspace');
  await click(dialogNamed(page, 'Delete permanently?').getByRole('button', { name: 'Delete', exact: true }), 'Delete');
  assert.deepEqual((await eventually(() => core.systemTrash(), (s) => s.length >= 2, 2000)).sort(), [TM.t3, TM.t3file].map(nfc).sort(), 'both files of the pair');
  const bin = await core.binary();
  assert.equal(bin[nfc(TM.t3file)], undefined, 'the image file left the vault');
});

// ------------------------------------------------------------------------------------------------ AC-8

test('fr_his_01_ac8_empty_trash', async ({ page }) => {
  const core = await startTM(page);
  await gotoTrash(page);
  await click(emptyBtn(page), 'Empty trash…');
  const d = await must(dialogNamed(page, 'Empty the trash?'), 'the dialog');
  assert.ok(flat(await d.innerText()).includes('6 items will be moved to the macOS Trash. You can still get them back from there.'), 'the count of rows');
  await click(d.getByRole('button', { name: 'Empty trash', exact: true }), 'Empty trash');
  await must(zeroRegion(page), 'the empty state', 3000);
  assert.ok(await seen(page.getByText('Objects you delete stay here until you empty the trash.'), 1000), 'the hint');
  assert.equal((await callsOf(core, 'trash_empty')).length, 1, 'trash_empty');
  const left = [...Object.keys(await core.files()), ...Object.keys(await core.binary())].filter((p) => p.startsWith('.trash/'));
  assert.deepEqual(left, [], 'nothing left under .trash/');
  assert.equal(await emptyBtn(page).count(), 0, 'no Empty trash… on an empty trash');
});

test('fr_his_01_ac8_a_file_that_cant_be_moved_is_reported', async ({ page }) => {
  const core = await startTM(page);
  await gotoTrash(page);
  await core.writeControl({ fail: 'Io', path: '.trash/Tasks' });
  await click(emptyBtn(page), 'Empty trash…');
  await click(dialogNamed(page, 'Empty the trash?').getByRole('button', { name: 'Empty trash', exact: true }), 'Empty trash');
  await must(page.getByRole('alert').filter({ hasText: /^1 item couldn.t be removed\.$/ }), 'the alert counts what wasn\'t removed', 3000);
  assert.deepEqual(await rowsWhen(page, (r) => r.length === 1), [TM.t5], 'the entry that couldn\'t be moved stays');
});

// ------------------------------------------------------------------------------------------------ AC-9

test('fr_his_01_ac9_keyboard', async ({ page }) => {
  const core = await startTM(page);
  await gotoTrash(page);
  await (await must(trashRow(page, ROW_ORDER[0]), 'first row')).focus();
  await page.keyboard.press('ArrowDown');
  const focusedPath = () => page.evaluate(() => document.activeElement?.closest('[data-path]')?.getAttribute('data-path')?.normalize('NFC') ?? null);
  assert.equal(await focusedPath(), ROW_ORDER[1], '↓ moves to the next row');
  await page.keyboard.press('ArrowUp');
  assert.equal(await focusedPath(), ROW_ORDER[0], '↑ moves back');
  assert.ok(await seen(main(page).getByText('↑↓ move · ↩ open · ⌘⌫ delete permanently · R restore', { exact: true }), 1000), 'the key hint');
  // Tab reaches Empty trash… and each row's buttons.
  await (await must(emptyBtn(page), 'Empty trash…')).focus();
  const names: string[] = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    names.push(await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim().normalize('NFC')));
  }
  for (const n of ['Restore "Zahrada"', 'Delete "Zahrada" permanently…', 'Restore "Stará poznámka"']) assert.ok(names.includes(n), `Tab reaches ${n}`);
  await (await must(trashRow(page, TM.t1), 'row T1')).focus();
  await page.keyboard.press('Enter');
  await must(page.getByText('This object is in the trash. Restore it to edit it.'), '↩ opens it', 3000);
  assert.deepEqual(await vaultWrites6a(core), [], 'nothing written');
});

test('fr_his_01_ac9_strings_and_contrast', async ({ page }) => {
  await startTM(page, { prelude: pseudoLocale });
  await gotoTrash(page);
  await must(trashList(page), 'the list', 3000);
  const plain = await main(page).evaluate((m) => {
    let all = '';
    const walk = (n: Node) => {
      if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).hasAttribute('data-user-content')) { all += ' '; return; }
      if (n.nodeType === Node.TEXT_NODE) { all += n.textContent; return; }
      for (const c of n.childNodes) walk(c);
    };
    walk(m);
    return all.replace(/⟦[^⟦⟧]*⟧/g, ' ');
  });
  const words = (plain.match(/[A-Za-z][A-Za-z'’]+/g) ?? []).filter((w) => !['Smazaný', 'Zahrada', 'Hotovo', 'Recepty', 'Images', 'Pages', 'Tasks', 'Quick', 'Notes', 'attachments', 'jpg'].includes(w));
  assert.deepEqual(words, [], 'every R70 text is an R78 key (pseudo-locale)');
});

for (const theme of ['light', 'dark'] as const) {
  test(`fr_his_01_ac9_contrast_${theme}`, async ({ page }) => {
    const core = await startTM(page, { theme });
    await gotoTrash(page);
    await must(trashList(page), 'rows', 3000);
    assert.deepEqual(await axeContrast(page), [], `${theme}: with rows`);
    await click(deleteBtn(page, 'Hotovo'), 'Delete…');
    await must(dialogNamed(page, 'Delete permanently?'), 'dialog');
    assert.deepEqual(await axeContrast(page), [], `${theme}: with a dialog open`);
    await page.keyboard.press('Escape');
    await core.writeControl({ fail: null });
    await click(emptyBtn(page), 'Empty trash…');
    await click(dialogNamed(page, 'Empty the trash?').getByRole('button', { name: 'Empty trash', exact: true }), 'Empty trash');
    await must(zeroRegion(page), 'empty state', 3000);
    assert.deepEqual(await axeContrast(page), [], `${theme}: empty`);
  });
}
