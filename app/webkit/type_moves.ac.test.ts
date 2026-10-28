// Slice 4E-1, L5 (WebKit + fake core over mocked IPC, real @tegg/doc): type moves in the UI. docs/acceptance/
// type-moves.md FR-STO-04 AC-4 (no dialog: one job, route replaced, `Now a Kniha`, counts), AC-5 (the mapping dialog,
// Cancel), AC-9 (the suffix is never shown), AC-10, AC-11 (⌘Z, status Undo, palette, ⇧⌘Z); FR-INB-02 AC-17 (Inbox
// convert, the dialog first, bulk convert with one mapping, zip and Undo); FR-STO-01 AC-8 (folder save: help text,
// no confirmation, `Moved 6 knihy`), AC-9 (tidy at open, nothing shown when nothing moves), AC-10 (quiet period),
// AC-11 (skipped and listed), AC-12 (Undo and the exemption list), AC-13 (progress, cancel, restore); and of "Both
// parts" FR-HIS-04 AC-11, FR-UX-03 AC-18, NFR-OTH-02 AC-10, FR-UX-05 AC-13 (4E-1 dialogs and status).
// Interface docs/contracts/ms4-jobs.md §14.7 (IPC `type_move_plan`, `type_move`, `type_patch` + `jobId`,
// `folder_move_preview`, `tidy_now`, `job_undo`, `job_redo`), §14.8 (UI and fake core: `tidyExempt()`), §10, §11
// (`holdJob`, `skipOnWrite`, `jobs`, `backups`, `failBackups`). Written from the ACs and the contract only (D-61).
// Every lookup goes through `must`/node:assert, so a missing element fails an assertion (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  IDS, M, args, callsOf, changeTo, changeTypeMenu, choose, editorBody, eventually, fileText, fileWhen, flat, folderField, jobStatus, kniha500, main,
  mappingDialog, mappingGroup, mapsTo, moreButton, movesVault, must, mustBeOn, nfc, noModified, noStrays, notUpdatedList, openMoves, optionsOf,
  original, runCommand, seen, sleep, swap, typeCount, typeMoveCall, valueOf, type FakeCoreHandle,
} from './type-moves-helpers';
import { axeContrast, colourLeaks } from './read-helpers';
import { goToQuery, nonReadCalls, pseudoLocale } from './helpers';
import { description, gotoSettings } from './types-helpers';
import { cardNamed, gotoInbox, liveSays, openTriage } from './capture-helpers';
import { backupRows } from './tags-helpers';

test.use({ timezoneId: 'Europe/Prague' });

async function openNote(page: Page, title: string) {
  await goToQuery(page, title);
  await page.keyboard.press('Enter');
  await mustBeOn(page, title, `open "${title}"`, 5000);
}
async function gotoBackups(page: Page) {
  await runCommand(page, 'Go to Settings: Backups');
  await must(main(page).getByRole('heading', { level: 1, name: 'Backups', exact: true }), 'heading "Backups"', 3000);
}
/** Duna › Schůzka through the dialog with Vydáno → Datum (FR-STO-04 AC-6); returns the job id of `type_move`. */
async function dunaToSchuzka(page: Page, core: FakeCoreHandle): Promise<number> {
  await changeTo(page, 'Schůzka');
  await must(mappingDialog(page), 'dialog "Change type?"');
  await choose(page, mapsTo(page, 'Vydáno'), 'Datum');
  await (await must(mappingDialog(page).getByRole('button', { name: 'Change type', exact: true }), 'button "Change type"')).click();
  const call = await typeMoveCall(core);
  const id = (call?.result as { jobId?: number } | undefined)?.jobId;
  assert.equal(typeof id, 'number', `type_move returns { jobId }: ${JSON.stringify(call?.result)}`);
  await fileWhen(core, 'Schůzky/Duna.md', (t) => t !== undefined);
  return id!;
}

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-4

test('fr_sto_04_ac4_change_type_without_a_dialog_moves_and_replaces_the_route', async ({ page }) => {
  const core = await openMoves(page, { at: M.odkazy });
  await openNote(page, 'Plán');
  const [qn, kn] = [await typeCount(page, 'Quick Notes'), await typeCount(page, 'Knihy')];
  await changeTo(page, 'Kniha');
  const call = await typeMoveCall(core);
  assert.deepEqual(args(call), { paths: [M.plan], toType: 'kniha', mapping: [], review: false }, 'one type_move, no mapping (ms4-jobs §14.7)');
  assert.equal(await seen(mappingDialog(page), 300), false, 'no dialog: nothing needs mapping');
  const t = await fileWhen(core, 'Knihy/Plán.md', (x) => x !== undefined);
  assert.equal(noModified(t), noModified(original(M.plan).replace('type: quick-note', 'type: kniha').replace('Viz [[Plán cesty]].', 'Viz [[Quick Notes/Plán cesty|Plán cesty]].').replace('[Rozpis](<Plán cesty.md>)', '[Rozpis](<../Quick Notes/Plán cesty.md>)')), 'Knihy/Plán.md: type and modified, links kept (AC-8)');
  assert.equal(await fileText(core, M.plan), undefined, 'Quick Notes/Plán.md is gone');
  await mustBeOn(page, 'Plán', 'the page stays open');
  const st = await must(jobStatus(page, 'Now a Kniha'), 'status "Now a Kniha"');
  await must(st.getByRole('button', { name: 'Undo', exact: true }), 'with Undo');
  assert.ok(!/Knihy\/|Plán\.md/.test(flat(await st.innerText())), 'no path or folder is shown (D-804)');
  assert.equal(await eventually(() => typeCount(page, 'Quick Notes'), (n) => n === qn - 1, 2000), qn - 1, 'Quick Notes −1 within 2 s');
  assert.equal(await eventually(() => typeCount(page, 'Knihy'), (n) => n === kn + 1, 2000), kn + 1, 'Knihy +1 within 2 s');
  assert.deepEqual((await core.backups()).filter((b) => b.kind === 'type-move'), [], 'no zip for the move (board G; the zip of the tidy job at open is its own)');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Odkazy', 'Back goes to Odkazy: the route was replaced, not pushed');
  await sleep(6000);
  assert.equal(await seen(jobStatus(page, 'Now a Kniha'), 200), false, 'Undo is offered for 5 s');
});

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-5

test('fr_sto_04_ac5_the_mapping_dialog_shows_r101_and_cancel_writes_nothing', async ({ page }) => {
  const core = await openMoves(page, { at: M.duna });
  await changeTo(page, 'Schůzka');
  await must(mappingDialog(page), 'dialog "Change type?"');
  assert.deepEqual(args((await callsOf(core, 'type_move_plan'))[0]), { paths: [M.duna], toType: 'schůzka' }, 'built from type_move_plan');
  await must(mappingGroup(page, 'Kniha', 'Schůzka'), 'group "Property mapping Kniha → Schůzka"');
  const d = mappingDialog(page);
  assert.ok(flat(await d.innerText()).includes('Properties mapped to Content are written at the top of the note as Property: value, one line each.'), 'the help text');
  const stav = await must(mapsTo(page, 'Stav'), 'combobox "Stav maps to"');
  assert.equal(await stav.isDisabled() || (await stav.getAttribute('aria-disabled')) === 'true', true, 'Stav is fixed');
  assert.equal(await valueOf(stav), 'Stav');
  const bad: string[] = [];
  for (const [n, def, opts] of [
    ['Vydáno', 'Content', ['Content', 'Datum', 'Místo']], ['Autor', 'Content', ['Content', 'Místo']], ['Hodnocení', 'Content', ['Content', 'Místo']],
    ['Související', 'Content', ['Content', 'Místo']], ['Poznámka', 'Content', ['Content', 'Místo']],
  ] as [string, string, string[]][]) {
    const got = await optionsOf(page, mapsTo(page, n));
    if ((await valueOf(mapsTo(page, n))) !== def || JSON.stringify([...got].sort()) !== JSON.stringify([...opts].sort())) bad.push(`${n}: ${await valueOf(mapsTo(page, n))} [${got.join(', ')}]`);
  }
  assert.deepEqual(bad, [], 'R101 defaults and offers: a date and a relation widen to Text too (D-808); Účastníci is never offered: narrower');
  await choose(page, mapsTo(page, 'Autor'), 'Místo');
  assert.deepEqual(await optionsOf(page, mapsTo(page, 'Poznámka')), ['Content'], 'a target taken by one row is not offered in another');
  await (await must(d.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel')).click();
  assert.equal(await seen(mappingDialog(page), 300), false, 'closed');
  assert.deepEqual(await callsOf(core, 'type_move'), [], 'Cancel starts nothing');
  assert.deepEqual(await nonReadCalls(core), [], 'and writes nothing');
});

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-9, AC-10

test('fr_sto_04_ac9_the_suffix_is_never_shown', async ({ page }) => {
  const core = await openMoves(page, { at: M.sesitQ });
  await changeTo(page, 'Kniha');
  assert.ok(await fileWhen(core, 'Knihy/Sešit (2).md', (t) => t !== undefined), 'Knihy/Sešit (2).md');
  await mustBeOn(page, 'Sešit', 'still Sešit');
  assert.ok(!flat(await page.locator('body').innerText()).includes('Sešit (2)'), 'nothing tells the user about the suffix (D-804)');
  assert.equal(await fileText(core, M.naSesit), original(M.naSesit).replace('[[Sešit]]', '[[Sešit (2)|Sešit]]'), 'the link follows');
});

test('fr_sto_04_ac10_objects_go_to_the_root_of_the_new_types_folder', async ({ page }) => {
  const core = await openMoves(page, { at: M.stary });
  await changeTo(page, 'Osoba');
  await must(mappingDialog(page), 'the dialog (Autor has no target in Osoba)');
  await (await must(mappingDialog(page).getByRole('button', { name: 'Change type', exact: true }), 'Change type')).click();
  assert.ok(await fileWhen(core, 'Osoby/Starý zápis.md', (t) => !!t?.includes('type: osoba')), 'Osoby/Starý zápis.md (not Osoby/2025/)');
  assert.equal(await fileText(core, M.stary), undefined, 'gone from Knihy/2025/');
});

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-11

test('fr_sto_04_ac11_cmd_z_undoes_the_type_change_and_shift_cmd_z_redoes_it', async ({ page }) => {
  const core = await openMoves(page, { at: M.duna });
  const job = await dunaToSchuzka(page, core);
  await (await must(editorBody(page), 'Note body')).click();
  await page.keyboard.press('Meta+z');
  const u = await eventually(() => callsOf(core, 'job_undo'), (c) => c.length > 0, 2000);
  assert.deepEqual(args(u[0]), { jobId: job }, '⌘Z right after the change undoes the job');
  assert.equal(await fileWhen(core, M.duna, (t) => t === original(M.duna)), original(M.duna), 'Knihy/Duna.md has its exact pre-change bytes');
  assert.equal(await fileText(core, 'Schůzky/Duna.md'), undefined, 'gone from Schůzky/');
  await page.keyboard.press('Meta+Shift+z');
  const r = await eventually(() => callsOf(core, 'job_redo'), (c) => c.length > 0, 2000);
  assert.deepEqual(args(r[0]), { jobId: job }, '⇧⌘Z re-applies it');
  assert.ok(await fileWhen(core, 'Schůzky/Duna.md', (t) => !!t?.includes('type: schůzka')), 'Duna is a Schůzka again');
});

test('fr_sto_04_ac11_status_undo_and_the_palette_undo_type_change', async ({ page }) => {
  const core = await openMoves(page, { at: M.duna });
  await dunaToSchuzka(page, core);
  await (await must(jobStatus(page, 'Now a Schůzka').getByRole('button', { name: 'Undo', exact: true }), 'status Undo')).click();
  assert.equal(await fileWhen(core, M.duna, (t) => t === original(M.duna)), original(M.duna), 'the status Undo restores Duna');
  await openNote(page, 'Plán');
  await changeTo(page, 'Kniha');
  await fileWhen(core, 'Knihy/Plán.md', (t) => t !== undefined);
  await runCommand(page, 'Undo type change');
  assert.equal(await fileWhen(core, M.plan, (t) => t === original(M.plan)), original(M.plan), 'the palette `Undo type change` restores Plán');
  assert.equal(await fileText(core, M.odkazy), original(M.odkazy), 'and Odkazy');
});

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-17

test('fr_inb_02_ac17_inbox_convert_moves_the_file_in_one_job', async ({ page }) => {
  const core = await openMoves(page, { at: M.odkazy });
  await gotoInbox(page);
  const menu = await openTriage(page, 'Plán');
  await (await must(menu.getByRole('group', { name: 'Convert to', exact: true }).getByRole('menuitem', { name: /^Kniha/ }), 'Convert to › Kniha')).click();
  const call = await typeMoveCall(core);
  assert.deepEqual(args(call), { paths: [M.plan], toType: 'kniha', mapping: [], review: true }, 'the convert is a type_move with review (replaces the set-type write)');
  const t = await fileWhen(core, 'Knihy/Plán.md', (x) => x !== undefined);
  assert.ok(t?.includes('\ntype: kniha\n') && t.includes('\nreview: reviewed\n'), 'type: kniha, review: reviewed');
  assert.equal(await fileText(core, M.odkazy), original(M.odkazy).replace('viz: "[[Quick Notes/Plán]]"', 'viz: "[[Knihy/Plán]]"').replace('\n[[Quick Notes/Plán]]\n', '\n[[Knihy/Plán]]\n').replace('[text](../Quick%20Notes/Plán.md)', '[text](../Knihy/Plán.md)'), 'Odkazy as AC-7');
  assert.ok(await liveSays(page, 'Converted "Plán" to Kniha'), 'live region');
});

test('fr_inb_02_ac17_a_convert_with_different_properties_opens_the_dialog_first', async ({ page }) => {
  const vault = movesVault((f) => { f[M.duna] = swap(f[M.duna], 'tags: [čtení]\n', 'tags: [čtení]\nreview: unreviewed\n'); });
  const core = await openMoves(page, { vault, at: M.odkazy });
  await gotoInbox(page);
  const menu = await openTriage(page, 'Duna');
  await (await must(menu.getByRole('group', { name: 'Convert to', exact: true }).getByRole('menuitem', { name: /^Schůzka/ }), 'Convert to › Schůzka')).click();
  await must(mappingDialog(page), 'the mapping dialog first');
  assert.deepEqual(await callsOf(core, 'type_move'), [], 'nothing starts before the dialog is confirmed');
  await (await must(mappingDialog(page).getByRole('button', { name: 'Change type', exact: true }), 'Change type')).click();
  assert.equal(args(await typeMoveCall(core)).review, true, 'then one type_move with review');
});

test('fr_inb_02_ac17_bulk_convert_one_mapping_a_zip_and_one_undo', async ({ page }) => {
  const vault = movesVault((f) => { f[M.sesitQ] = swap(f[M.sesitQ], 'title: Sešit\n', 'title: Sešit\nreview: unreviewed\n'); });
  const core = await openMoves(page, { vault, at: M.odkazy });
  await gotoInbox(page);
  for (const n of ['Quick Note: Plán', 'Quick Note: Sešit']) {
    await (await must(cardNamed(page, n), n)).focus();
    await page.keyboard.press('Space');
  }
  await (await must(main(page).getByRole('toolbar', { name: '2 selected', exact: true }).getByRole('button', { name: 'Convert to…', exact: true }), 'Convert to…')).click();
  await (await must(page.getByRole('menuitem', { name: /^Kniha/ }).or(page.getByRole('menuitemradio', { name: /^Kniha/ })), 'Kniha')).click();
  const call = await typeMoveCall(core);
  assert.deepEqual({ ...args(call), paths: [...((args(call).paths as string[] | undefined) ?? [])].sort() }, { paths: [M.plan, M.sesitQ].sort(), toType: 'kniha', mapping: [], review: true }, 'one type_move for both items');
  await fileWhen(core, 'Knihy/Sešit (2).md', (t) => t !== undefined);
  const zips = (await core.backups()).filter((b) => b.kind !== 'folder-move'); // the tidy job at open zips first, on its own
  assert.deepEqual(zips.map((b) => b.kind), ['type-move'], 'its zip first (FR-HIS-04 AC-11)');
  assert.ok(flat(zips[0]?.label ? JSON.stringify(zips[0].label) : '').includes('Kniha'), 'labelled `Change type of 2 objects to Kniha`');
  await (await must(page.getByRole('status').getByRole('button', { name: 'Undo', exact: true }), 'Undo')).click();
  assert.equal(await fileWhen(core, M.plan, (t) => t === original(M.plan)), original(M.plan), 'Undo restores Plán');
  assert.equal(await fileWhen(core, M.sesitQ, (t) => t !== undefined), vault.files[M.sesitQ], 'and Sešit');
});

// ------------------------------------------------------------------------------------------------ FR-STO-01 AC-8

test('fr_sto_01_ac8_saving_a_new_folder_moves_the_objects', async ({ page }) => {
  const core = await openMoves(page, { at: M.odkazy });
  // The tidy job at open (AC-9) puts Kniha jinde in Knihy/ first; the six Knihy are then all under Knihy/ (red-test point AP-779).
  await must(jobStatus(page, 'Moved 1 kniha and 1 schůzka to their folders'), 'the tidy job at open', 8000);
  await gotoSettings(page, 'Knihy', 'Kniha');
  const f = await must(folderField(page), 'textbox "Folder in the vault"');
  await f.fill('Četba');
  const help = 'Saving moves 6 knihy from Knihy/ here (backup first; undo in the status strip).';
  assert.equal(await eventually(() => description(f), (d) => d === help, 2000), help, 'B1 help text from folder_move_preview');
  assert.deepEqual(args((await callsOf(core, 'folder_move_preview')).at(-1)), { type: 'kniha', folder: 'Četba' }, 'folder_move_preview(type, folder)');
  await f.press('Enter');
  assert.equal(await seen(page.locator('[aria-modal="true"]'), 500), false, 'no confirmation dialog (D-805)');
  const st = await must(jobStatus(page, /^Moved 6 knihy/), 'status "Moved 6 knihy"', 5000);
  await must(st.getByRole('button', { name: 'Undo', exact: true }), 'with Undo');
  assert.equal(flat(await st.innerText()).includes('updated links'), false, 'no link needed a change, so no `· updated links in <m> notes`');
  const files = await core.files();
  for (const p of ['Četba/Duna.md', 'Četba/Babička.md', 'Četba/Bez autora.md', 'Četba/Sešit.md', 'Četba/Starý zápis.md', 'Četba/Kniha jinde.md']) assert.ok(files[p] !== undefined, `${p}`);
  assert.equal(files['Četba/Duna.md'], original(M.duna), "a moved file's bytes don't change (no modified)");
  assert.ok(files[M.knihaYml]?.includes('\nfolder: Četba\n'), 'folder: Četba written');
  assert.deepEqual((await core.backups()).map((b) => b.kind), ['folder-move', 'folder-move'], 'the tidy zip and the folder-move zip');
  await gotoBackups(page);
  assert.ok((await backupRows(page)).some((r) => r.includes('Move knihy to Četba')), 'Settings › Backups label (R99)');
});

// ------------------------------------------------------------------------------------------------ FR-STO-01 AC-9

test('fr_sto_01_ac9_tidy_at_open_moves_the_strays_and_says_so', async ({ page }) => {
  const core = await openMoves(page, { at: M.odkazy });
  const st = await must(jobStatus(page, 'Moved 1 kniha and 1 schůzka to their folders'), 'status after the tidy job', 8000);
  await must(st.getByRole('button', { name: 'Undo', exact: true }), 'with Undo');
  const files = await core.files();
  assert.equal(files['Knihy/Kniha jinde.md'], original(M.jinde), 'Kniha jinde → Knihy/');
  assert.equal(files['Schůzky/Schůzka jinde.md'], original(M.schJinde), 'Schůzka jinde → Schůzky/');
  for (const p of ['Volné/Volná poznámka.md', 'Volné/Recept.md', M.stary, '_templates/Kniha/Kniha.md']) assert.ok(files[p] !== undefined, `${p} stays`);
  await gotoBackups(page);
  assert.ok((await backupRows(page)).some((r) => r.includes('Tidy folders')), 'Settings › Backups label `Tidy folders`');
});

test('fr_sto_01_ac9_with_nothing_to_move_nothing_is_shown', async ({ page }) => {
  const core = await openMoves(page, { at: M.odkazy, vault: movesVault(noStrays), clock: true });
  await page.clock.fastForward(2_000);
  await sleep(500);
  assert.equal(await seen(jobStatus(page, /^Moved /), 200), false, 'no status');
  assert.deepEqual(await core.backups(), [], 'no zip');
  assert.deepEqual(await core.writesTo(), [], 'no write');
  // The control: a stray written by another program is moved by the tidy job (FR-STO-01 AC-10).
  await core.setFile('Pages/Nová kniha.md', '---\nid: 01JB4E0000000000000000E098\ntype: kniha\ntitle: Nová kniha\n---\n');
  await page.clock.fastForward(31_000);
  const moved = await eventually(() => fileText(core, 'Knihy/Nová kniha.md'), (t) => t !== undefined, 3000);
  assert.ok(moved !== undefined, 'a stray is moved after the quiet period');
});

// ------------------------------------------------------------------------------------------------ FR-STO-01 AC-10

test('fr_sto_01_ac10_a_stray_moves_after_30_s_of_quiet_not_before', async ({ page }) => {
  const core = await openMoves(page, { at: M.odkazy, vault: movesVault(noStrays), clock: true });
  const nova = '---\nid: 01JB4E0000000000000000E098\ntype: kniha\ntitle: Nová kniha\n---\nZ jiného programu.\n';
  await core.setFile('Pages/Nová kniha.md', nova);
  await page.clock.fastForward(29_000);
  await sleep(300);
  assert.equal(await fileText(core, 'Knihy/Nová kniha.md'), undefined, 'not moved after 29 s');
  await page.clock.fastForward(2_000);
  assert.equal(await fileWhen(core, 'Knihy/Nová kniha.md', (t) => t !== undefined), nova, 'moved 30 s after the last event');
});

test('fr_sto_01_ac10_typing_in_a_note_holds_the_move_until_30_s_of_quiet', async ({ page }) => {
  const core = await openMoves(page, { at: M.odkazy, vault: movesVault(noStrays), clock: true });
  await core.setFile('Pages/Nová kniha.md', '---\nid: 01JB4E0000000000000000E098\ntype: kniha\ntitle: Nová kniha\n---\n');
  await (await must(editorBody(page), 'Note body')).click();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.type(' psaní');
    await page.clock.fastForward(10_000);
    await sleep(100);
  }
  assert.equal(await fileText(core, 'Knihy/Nová kniha.md'), undefined, 'not moved while the note is being typed in (50 s, never 30 s of quiet)');
  await page.clock.fastForward(31_000);
  assert.ok(await fileWhen(core, 'Knihy/Nová kniha.md', (t) => t !== undefined), 'moved after 30 s of quiet');
});

// ------------------------------------------------------------------------------------------------ FR-STO-01 AC-11

test('fr_sto_01_ac11_a_stray_changed_meanwhile_is_listed_and_tried_again_later', async ({ page }) => {
  const core = await openMoves(page, { at: M.odkazy, vault: movesVault(noStrays), clock: true });
  await core.skipOnWrite(M.schJinde, 'changed');
  await core.setFile(M.jinde, original(M.jinde));
  await core.setFile(M.schJinde, original(M.schJinde));
  await page.clock.fastForward(31_000);
  const st = await must(jobStatus(page, 'Moved 1 kniha · 1 not moved (changed meanwhile, tried again later)'), 'the skip status', 5000);
  await (await must(st.getByRole('button', { name: 'Show', exact: true }), 'Show')).click();
  const list = await must(notUpdatedList(page), 'the not-updated list');
  assert.ok(flat(await list.innerText()).includes('Schůzka jinde'), 'Schůzka jinde is listed');
  assert.equal(await fileText(core, M.schJinde), original(M.schJinde), 'not moved');
  await page.clock.fastForward(31_000);
  assert.ok(await fileWhen(core, 'Schůzky/Schůzka jinde.md', (t) => t !== undefined, 5000), 'the next quiet period moves it');
});

// ------------------------------------------------------------------------------------------------ FR-STO-01 AC-12

test('fr_sto_01_ac12_undo_moves_the_strays_back_and_exempts_them', async ({ page }) => {
  const core = await openMoves(page, { at: M.odkazy, clock: true });
  const st = await must(jobStatus(page, 'Moved 1 kniha and 1 schůzka to their folders'), 'tidy status', 8000);
  await (await must(st.getByRole('button', { name: 'Undo', exact: true }), 'Undo')).click();
  assert.equal(await fileWhen(core, M.jinde, (t) => t !== undefined), original(M.jinde), 'Kniha jinde back with its bytes');
  assert.equal(await fileWhen(core, M.schJinde, (t) => t !== undefined), original(M.schJinde), 'Schůzka jinde back with its bytes');
  assert.deepEqual((await core.tidyExempt()).sort(), [IDS.jinde, IDS.schJinde].sort(), 'both ids are exempt (ms4-jobs §14.6)');
  await core.setFile('Pages/Výplň 01.md', original('Pages/Výplň 01.md') + 'Změna.\n');
  await page.clock.fastForward(31_000);
  await sleep(500);
  assert.ok((await fileText(core, M.jinde)) !== undefined && (await fileText(core, M.schJinde)) !== undefined, 'later tidy runs leave them');
});

// ------------------------------------------------------------------------------------------------ FR-STO-01 AC-13

test('fr_sto_01_ac13_progress_of_500_objects', async ({ page }) => {
  const core = await openMoves(page, { vault: kniha500() });
  await gotoSettings(page, 'Knihy', 'Kniha');
  const release = await core.holdJob('writing');
  const f = await must(folderField(page), 'Folder in the vault');
  await f.fill('Četba');
  await f.press('Enter');
  await must(jobStatus(page, /^Moving knihy · \d+ of 500$/), 'status "Moving knihy · <done> of 500" (FR-UX-07 AC-8)', 5000);
  await release();
  await must(jobStatus(page, /^Moved 500 knihy/), 'status "Moved 500 knihy"', 15_000);
});

test('fr_sto_01_ac13_cancel_in_planning_leaves_the_vault_byte_identical', async ({ page }) => {
  const vault = kniha500();
  const core = await openMoves(page, { vault });
  await gotoSettings(page, 'Knihy', 'Kniha');
  const release = await core.holdJob('planning');
  const f = await must(folderField(page), 'Folder in the vault');
  await f.fill('Četba');
  await f.press('Enter');
  await (await must(page.getByRole('status').getByRole('button', { name: 'Cancel', exact: true }), 'Cancel in the status')).click();
  await release();
  const j = await eventually(() => core.jobs(), (x) => x.length > 0, 3000);
  assert.deepEqual([j[0]?.kind, j[0]?.phase], ['folder-move', 'cancelled'], 'the folder-move job is cancelled');
  assert.deepEqual(await core.backups(), [], 'no zip');
  // red-test point AP-777: the type file is written before the job (ms4-jobs §14.7); the AC asks for a byte-identical vault.
  assert.deepEqual(await core.files(), vault.files, 'the vault is byte-identical');
});

test('fr_sto_01_ac13_restoring_the_zip_moves_every_file_back', async ({ page }) => {
  const core = await openMoves(page, { at: M.odkazy, vault: movesVault(noStrays) });
  await gotoSettings(page, 'Knihy', 'Kniha');
  const f = await must(folderField(page), 'Folder in the vault');
  await f.fill('Četba');
  await f.press('Enter');
  await must(jobStatus(page, /^Moved 5 knihy/), 'moved', 5000);
  await gotoBackups(page);
  await (await must(main(page).getByRole('button', { name: 'Restore "Move knihy to Četba"…', exact: true }), 'Restore "Move knihy to Četba"…')).click();
  await (await must(page.getByRole('alertdialog', { name: 'Restore this backup?', exact: true }).getByRole('button', { name: 'Restore', exact: true }), 'Restore')).click();
  await must(jobStatus(page, /^Restored \d+ notes? from the backup$/), 'restored', 5000);
  const files = await core.files();
  for (const p of [M.duna, M.babicka, M.bez, M.sesitK, M.stary]) assert.equal(files[p], original(p), `${p} back with its pre-job bytes`);
  assert.ok(!Object.keys(files).some((p) => p.startsWith('Četba/')), 'nothing left in Četba/');
});

// ------------------------------------------------------------------------------------------------ FR-HIS-04 AC-11

test('fr_his_04_ac11_a_failed_zip_ends_the_folder_move_with_nothing_written', async ({ page }) => {
  const core = await openMoves(page, { at: M.odkazy, vault: movesVault(noStrays) });
  await core.failBackups(true);
  await gotoSettings(page, 'Knihy', 'Kniha');
  const f = await must(folderField(page), 'Folder in the vault');
  await f.fill('Četba');
  await f.press('Enter');
  const j = await eventually(() => core.jobs(), (x) => x.some((r) => r.kind === 'folder-move'), 5000);
  const r = j.find((x) => x.kind === 'folder-move');
  assert.equal(r?.phase, 'failed', 'the job ends failed (BackupFailed)');
  assert.ok(!Object.keys(await core.files()).some((p) => p.startsWith('Četba/')), 'no object moved (data-safety AC-1)');
  assert.deepEqual(await core.backups(), [], 'no zip listed');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-18

test('fr_ux_03_ac18_the_dialog_works_by_keyboard_and_esc_returns_the_focus', async ({ page }) => {
  const core = await openMoves(page, { at: M.duna });
  const more = await must(moreButton(page), 'More');
  await more.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // the first item, Change type…
  const menu = await must(changeTypeMenu(page), 'menu "Change type"');
  const items = (await menu.getByRole('menuitem').allInnerTexts()).map(flat);
  const at = items.indexOf('Schůzka');
  assert.ok(at >= 0, `Schůzka in the menu: ${items.join(', ')}`);
  for (let i = 0; i < at; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const d = await must(mappingDialog(page), 'dialog by keyboard');
  const want = ['Autor maps to', 'Vydáno maps to', 'Hodnocení maps to', 'Související maps to', 'Poznámka maps to', 'Cancel', 'Change type'];
  const control = (n: string) => (n.endsWith(' maps to') ? mapsTo(page, n.slice(0, -' maps to'.length)) : d.getByRole('button', { name: n, exact: true }));
  const handles = await Promise.all(want.map((n) => control(n).first().elementHandle({ timeout: 500 }).catch(() => null)));
  const reached = new Set<string>();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const on = await page.evaluate((hs) => hs.map((h) => h !== null && h === document.activeElement), handles);
    on.forEach((x, k) => { if (x) reached.add(want[k]); });
  }
  assert.deepEqual(want.filter((n) => !reached.has(n)), [], `every control is reachable by Tab: ${[...reached].join(' | ')}`);
  await (await must(mapsTo(page, 'Vydáno'), 'Vydáno maps to')).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await valueOf(mapsTo(page, 'Vydáno')), 'Datum', '↓ and ⏎ choose Datum');
  await page.keyboard.press('Escape');
  assert.equal(await seen(d, 300), false, 'Esc closes the dialog');
  assert.equal(await more.evaluate((e) => e === document.activeElement), true, 'the focus is back on the control that opened it');
  assert.deepEqual(await callsOf(core, 'type_move'), [], 'Esc writes nothing');
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-10

test('nfr_oth_02_ac10_pseudo_locale_wraps_every_4e1_text', async ({ page }) => {
  await openMoves(page, { at: M.duna, prelude: pseudoLocale });
  await (await must(moreButton(page).or(main(page).getByRole('button', { name: '⟦More⟧', exact: true })), 'More')).click();
  await (await must(page.getByRole('menuitem', { name: /Change type…/ }), 'Change type…')).click();
  await (await must(page.getByRole('menuitem', { name: 'Schůzka', exact: true }), 'Schůzka (a type name, outside ⟦ ⟧)')).click();
  const d = await must(page.getByRole('dialog', { name: '⟦Change type?⟧', exact: true }), 'dialog "⟦Change type?⟧"');
  await must(d.getByRole('group', { name: '⟦Property mapping Kniha → Schůzka⟧', exact: true }), 'group name wrapped, type names inside');
  await must(d.getByRole('combobox', { name: '⟦Vydáno maps to⟧', exact: true }), 'row label wrapped');
  const loose = await d.evaluate((el) => {
    const out: string[] = [];
    const walk = (n: Node, inside: boolean) => {
      if (n.nodeType === 3) {
        const t = (n.textContent ?? '').trim();
        if (t && !inside && !t.includes('⟦')) out.push(t);
        return;
      }
      for (const c of [...n.childNodes]) walk(c, inside || (n.textContent ?? '').trim().startsWith('⟦'));
    };
    walk(el, false);
    return out;
  });
  const allowed = new Set(['Kniha', 'Schůzka', 'Autor', 'Vydáno', 'Stav', 'Hodnocení', 'Související', 'Poznámka', 'ISBN', 'Datum', 'Místo', 'Frank Herbert', '1965-08-01', 'Dočtená', '5', '[[Babička]]', 'Půjčená od Petra', 'Duna']);
  assert.deepEqual(loose.filter((t) => !allowed.has(t)), [], 'only type names, property names and values outside ⟦ ⟧');
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-13

test('fr_ux_05_ac13_dialog_and_status_in_light_and_dark', async ({ page }) => {
  const core = await openMoves(page, { at: M.duna });
  for (const [cmd, theme] of [['Theme: Light', 'light'], ['Theme: Dark', 'dark']] as const) {
    await runCommand(page, cmd);
    await changeTo(page, 'Schůzka');
    await must(mappingDialog(page), `the dialog (${theme})`);
    assert.deepEqual(await axeContrast(page), [], `color-contrast with the dialog open (${theme})`);
    assert.deepEqual(await colourLeaks(page, theme), [], `only theme tokens (FR-UX-05 AC-5, ${theme})`);
    await page.keyboard.press('Escape');
  }
  await openNote(page, 'Plán');
  await changeTo(page, 'Kniha');
  await must(jobStatus(page, 'Now a Kniha'), 'the status strip');
  for (const cmd of ['Theme: Light', 'Theme: Dark']) {
    await runCommand(page, cmd);
    assert.deepEqual(await axeContrast(page), [], `color-contrast on the status strip (${cmd})`);
  }
  assert.ok((await callsOf(core, 'type_move')).length === 1, 'the status came from one type_move');
});
