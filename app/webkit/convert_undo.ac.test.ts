// MS5 slice 5A-2, L5 (WebKit + fake core): a conversion is one undoable action. docs/acceptance/conversion.md FR-CNV-06
// AC-1 (⌘Z restores the blocks and discards the new file), AC-2 (⇧⌘Z recreates it, the same bytes and id, or the next
// free stem), AC-3 (a new object changed since is moved to the trash, with the alert), AC-4 (undo scope, D-178), AC-5
// (the new file is gone already). Interface docs/contracts/ms5-tasks.md §11.3 (`conversion.afterUndo` / `beforeRedo`),
// §11.4 `undo.ts` (flush the source, `note_read`, `note_discard` with the created version, else `note_trash`), §11.6
// (`note_discard`), §11.7 (fake core). Written from the ACs and the contracts only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  C, ZAVOLAT, ZAVOLAT_PARA, ZAVOLAT_TASK, absent, alertWith, bodyOf, callsOf, caretAfter, caretAt, convertAt, embedBody, eventually, fileText,
  fileWhen, idOf, main, must, mustBeOn, needCard, needFile, openConvert, original, removeDialog, runCommand, saved, seen, sleep, swap, touched,
  writeLog, writesOf, type FakeCoreHandle,
} from './convert-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const B0 = original(C.bloky);
const EMBED = `![[${ZAVOLAT}]]\n`;
const BLOKY_AC2 = touched(swap(B0, ZAVOLAT_PARA, EMBED));
const TRASHED = `.trash/${ZAVOLAT_TASK}`;

/** FR-CNV-03 AC-1/AC-2 in Bloky; returns the new task's text. */
async function converted(page: Page, core: FakeCoreHandle): Promise<string> {
  await convertAt(page, ZAVOLAT);
  const t = await needFile(core, ZAVOLAT_TASK);
  const b = await saved(page, core, C.bloky, (x) => x === BLOKY_AC2);
  assert.equal(b, BLOKY_AC2, 'the conversion is saved');
  return t;
}
/** ⌘Z (or ⇧⌘Z) with the focus in the host editor. */
async function hostKey(page: Page, key: 'Meta+z' | 'Meta+Shift+z') {
  await caretAfter(page, 'Úvodní odstavec.');
  await page.keyboard.press(key);
  await sleep(200);
}

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_cnv_06_ac1_undo_restores_the_blocks_and_deletes_the_new_file', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await converted(page, core);
  const before = (await writeLog(core)).length;
  await hostKey(page, 'Meta+z');
  assert.equal(await seen(removeDialog(page), 300), false, 'the conversion\'s own undo never asks (FR-CNV-08 AC-5)');
  const b = await fileWhen(core, C.bloky, (x) => x === touched(B0), 3000);
  assert.equal(b, touched(B0), 'one ⌘Z: Bloky\'s body is the original byte for byte (frontmatter: modified only)');
  const gone = await fileWhen(core, ZAVOLAT_TASK, (x) => x === undefined, 3000);
  assert.equal(gone, undefined, 'the new task file no longer exists');
  assert.equal(await fileText(core, TRASHED), undefined, 'nothing moved to .trash/');
  await sleep(1300);
  assert.deepEqual((await writeLog(core)).slice(before), [`note_write ${C.bloky}`, `note_discard ${ZAVOLAT_TASK}`], 'the source is saved first, then the file is discarded; nothing else written');
  const d = await callsOf(core, 'note_discard');
  assert.equal(d.length, 1, 'one note_discard');
  assert.equal(d[0].ok, true, 'with the created version as base, it succeeds');
});

test('fr_cnv_06_ac1_undo_of_a_list_cut_gives_one_list_again', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await convertAt(page, 'projektor pro');
  const path = 'Tasks/Objednat nový projektor pro Zasedačka.md';
  await needFile(core, path);
  await saved(page, core, C.bloky, (x) => x !== B0);
  await hostKey(page, 'Meta+z');
  assert.equal(await fileWhen(core, C.bloky, (x) => x === touched(B0), 3000), touched(B0), 'the list is one list again, byte-identical');
  assert.equal(await fileWhen(core, path, (x) => x === undefined, 3000), undefined, 'the new task is discarded');
});

// ------------------------------------------------------------------------------------------------ AC-2

test('fr_cnv_06_ac2_redo_recreates_the_same_bytes_and_the_embed', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  const created = await converted(page, core);
  await hostKey(page, 'Meta+z');
  await fileWhen(core, ZAVOLAT_TASK, (x) => x === undefined, 3000);
  await fileWhen(core, C.bloky, (x) => x === touched(B0), 3000);
  await hostKey(page, 'Meta+Shift+z');
  const again = await fileWhen(core, ZAVOLAT_TASK, (x) => x !== undefined, 3000);
  assert.equal(again, created, 'the same path, the same bytes (same id)');
  const ex = await callsOf(core, 'note_create_exact');
  assert.equal(ex.length, 1, 'create-exclusive through note_create_exact');
  assert.equal(await saved(page, core, C.bloky, (x) => x === BLOKY_AC2), BLOKY_AC2, 'the embed is back');
});

test('fr_cnv_06_ac2_redo_uses_the_next_free_stem_when_the_path_was_taken', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  const created = await converted(page, core);
  await hostKey(page, 'Meta+z');
  await fileWhen(core, ZAVOLAT_TASK, (x) => x === undefined, 3000);
  const other = `---\nid: 01JB5A0000000000000000W301\ntype: page\ntitle: ${ZAVOLAT}\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\nJiný soubor.\n`;
  await core.setFile(ZAVOLAT_TASK, other);
  await hostKey(page, 'Meta+Shift+z');
  const t = await fileWhen(core, `Tasks/${ZAVOLAT} (2).md`, (x) => x !== undefined, 3000);
  assert.ok(t !== undefined, 'the next free stem');
  assert.equal(idOf(t), idOf(created), 'the same id');
  assert.equal(bodyOf(t), bodyOf(created), 'the same body');
  assert.equal(await fileText(core, ZAVOLAT_TASK), other, 'the other file is untouched');
  const b = await saved(page, core, C.bloky, (x) => !!x?.includes(`![[${ZAVOLAT} (2)]]`));
  assert.equal(b, touched(swap(B0, ZAVOLAT_PARA, `![[${ZAVOLAT} (2)]]\n`)), 'the embed names the file actually created');
});

// ------------------------------------------------------------------------------------------------ AC-3

test('fr_cnv_06_ac3_a_changed_new_object_goes_to_the_trash', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  const created = await converted(page, core);
  const card = await needCard(main(page), ZAVOLAT);
  assert.ok(await caretAt(embedBody(card), 'a domluvit termín.'), 'caret in the card\'s body');
  await page.keyboard.type(' Doplněno.');
  const edited = await fileWhen(core, ZAVOLAT_TASK, (x) => !!x?.includes('Doplněno.'), 3000);
  assert.ok(edited?.includes('a domluvit termín. Doplněno.'), 'the card\'s edit is saved into the task');
  await hostKey(page, 'Meta+z');
  for (let i = 0; i < 3 && (await fileText(core, C.bloky)) !== touched(B0); i++) await hostKey(page, 'Meta+z');
  assert.equal(await fileWhen(core, C.bloky, (x) => x === touched(B0), 3000), touched(B0), 'Bloky gets its original blocks back');
  const tr = await fileWhen(core, TRASHED, (x) => x !== undefined, 3000);
  assert.equal(tr, edited, `moved to ${TRASHED} with its changed bytes (FR-STO-08)`);
  assert.equal(await fileText(core, ZAVOLAT_TASK), undefined, 'not left in Tasks/');
  assert.notEqual(tr, created, 'it had changed since its creation');
  await must(alertWith(page, `"${ZAVOLAT}" was changed after it was created, so it was moved to the trash.`), 'the convert.trashedOnUndo alert', 2000);
  assert.equal((await callsOf(core, 'note_trash')).length, 1, 'note_trash, not a discard');
});

// ------------------------------------------------------------------------------------------------ AC-4

test('fr_cnv_06_ac4_leaving_the_note_drops_the_conversion_from_undo', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await converted(page, core);
  await runCommand(page, 'Go to Tasks');
  await must(main(page).getByRole('heading', { level: 1, name: 'Tasks' }), 'Tasks page', 5000);
  await page.keyboard.press('Meta+[');
  await mustBeOn(page, 'Bloky', 'back to Bloky', 5000);
  const before = (await writeLog(core)).length;
  await hostKey(page, 'Meta+z');
  await sleep(1300);
  assert.equal(await fileText(core, ZAVOLAT_TASK) !== undefined, true, 'the new file isn\'t deleted');
  assert.equal(await fileText(core, C.bloky), BLOKY_AC2, 'Bloky keeps the embed');
  assert.deepEqual((await writeLog(core)).slice(before).filter((w) => !w.startsWith(`note_write ${C.bloky}`)), [], 'no discard, no trash');
});

test('fr_cnv_06_ac4_an_external_reload_drops_it_too', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await converted(page, core);
  const ext = `${BLOKY_AC2}Externí odstavec.\n`;
  await core.setFile(C.bloky, ext);
  await eventually(async () => (await page.evaluate(() => (window as any).__TEGG_TEST__?.editor?.text?.() as string | undefined)) ?? '', (t) => t.includes('Externí odstavec.'), 3000);
  const before = (await writeLog(core)).length;
  await hostKey(page, 'Meta+z');
  await sleep(1300);
  assert.ok((await fileText(core, ZAVOLAT_TASK)) !== undefined, 'the new file stays');
  assert.equal(await fileText(core, C.bloky), ext, 'Bloky keeps the external bytes and the embed');
  assert.deepEqual((await writeLog(core)).slice(before).filter((w) => !w.startsWith(`note_write ${C.bloky}`)), [], 'undo touches no other file');
  assert.ok((await writesOf(core, C.bloky)).every((w) => !String((w.args as any)?.text ?? '').includes(ZAVOLAT_PARA)), 'the conversion isn\'t undone');
});

// ------------------------------------------------------------------------------------------------ AC-5

test('fr_cnv_06_ac5_the_new_file_is_gone_already', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await converted(page, core);
  await core.setFile(ZAVOLAT_TASK, null);
  const before = (await writeLog(core)).length;
  await hostKey(page, 'Meta+z');
  assert.equal(await fileWhen(core, C.bloky, (x) => x === touched(B0), 3000), touched(B0), 'undo restores the blocks');
  await sleep(1300);
  assert.deepEqual((await writeLog(core)).slice(before), [`note_write ${C.bloky}`], 'writes Bloky only');
  assert.equal(await page.getByRole('alert').count(), 0, 'no error');
  assert.equal(await absent(page.getByRole('alertdialog'), 300), true, 'no dialog');
});
