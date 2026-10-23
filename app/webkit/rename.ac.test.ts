// MS4 slice 4C, L5 (WebKit + fake core over mocked IPC, real @tegg/doc): note rename in the UI.
// docs/acceptance/rename.md FR-FMT-08 AC-5 (the three commit gestures, typing alone never renames, the route and
// history follow), AC-7 (no-op commits send no write), AC-9 (never renamed); FR-LNK-03 AC-14 (the undo gestures),
// AC-15 (the list and Retry), AC-16, AC-18; FR-UX-07 AC-9. Interface: docs/contracts/ms4-jobs.md §4 (IPC), §7, §9,
// §10 (UI), §11 (fake core: `holdJob`, `skipOnWrite`, `jobs`). Written from the ACs and the contract only (D-61).
// Every lookup goes through `must`/node:assert, so a missing element fails an assertion (TS-I1).
//
// Where an AC holds already before 4C (the no-op and never-renamed cases write no rename today), the test also
// commits a real rename on an ordinary note as its control, so it is red until the rename path exists.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  GAMA_OTHERS, R, anyModal, args, callsOf, commit, editorBody, eventually, fileEventually, fileText, gotoNote, jobStatus, must, mustBeOn, needButton, nfc,
  notUpdatedEntry, notUpdatedList, odkazyAfterGama, oneRename, openRename, original, runCommand, seen, sleep, titleField, typeTitle,
  type FakeCoreHandle,
} from './rename-helpers';
import { absent, nonReadCalls, settled } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });

/** Renames Alfa → Gama with ↩ and waits for the fake's files; returns the job id from `note_rename`. */
async function renameAlfa(page: Page, core: FakeCoreHandle, how: 'enter' | 'tab' | 'body' = 'enter'): Promise<number> {
  await typeTitle(page, 'Gama');
  await commit(page, how);
  const call = await oneRename(core);
  assert.deepEqual(args(call), { path: R.alfa, title: 'Gama', fromTitle: 'Alfa' }, 'note_rename(path, title, fromTitle)');
  const g = await fileEventually(core, R.gama, (t) => t !== undefined);
  assert.ok(g !== undefined, 'Pages/Gama.md exists in the fake vault');
  const id = (call.result as { jobId?: number } | undefined)?.jobId;
  assert.equal(typeof id, 'number', `note_rename returns { jobId, toPath }: ${JSON.stringify(call.result)}`);
  return id!;
}

// ------------------------------------------------------------------------------------------------ FR-FMT-08 AC-5

test('fr_fmt_08_ac5_typing_alone_never_renames_enter_commits', async ({ page }) => {
  const core = await openRename(page, R.alfa);
  await typeTitle(page, 'Gama', 450); // ≈ 2 s of typing
  await sleep(1200);
  assert.deepEqual(await callsOf(core, 'note_rename'), [], 'typing never starts a rename');
  assert.ok((await core.files())[R.alfa] !== undefined && (await core.files())[R.gama] === undefined, 'Pages/Alfa.md keeps its path while typing');
  const writesWhileTyping = (await core.writesTo()).filter((p) => p !== R.alfa);
  assert.deepEqual(writesWhileTyping, [], 'no other file is written while typing (the autosave may write title: only, D-394)');
  await commit(page, 'enter');
  const call = await oneRename(core);
  assert.deepEqual(args(call), { path: R.alfa, title: 'Gama', fromTitle: 'Alfa' }, 'fromTitle is the title when the edit started (D-394)');
  const g = await fileEventually(core, R.gama, (t) => t !== undefined);
  assert.match(g ?? '', /^title: Gama$/m, 'title: Gama');
  assert.equal((await core.files())[R.alfa], undefined, 'Pages/Alfa.md is gone');
  await mustBeOn(page, 'Gama', 'the note stays open as Gama');
  const nav = await eventually(() => callsOf(core, 'nav_opened'), (c) => c.some((x) => nfc(String(args(x).path ?? '')) === R.gama), 2000);
  assert.ok(nav.some((x) => nfc(String(args(x).path ?? '')) === R.gama), 'the route becomes note/Pages/Gama.md');
});

for (const how of ['tab', 'body'] as const) {
  test(`fr_fmt_08_ac5_${how}_commits_the_rename`, async ({ page }) => {
    const core = await openRename(page, R.alfa);
    await renameAlfa(page, core, how);
    await mustBeOn(page, 'Gama', `after ${how}`);
  });
}

test('fr_fmt_08_ac5_back_returns_to_the_renamed_note_not_a_dead_entry', async ({ page }) => {
  const core = await openRename(page, R.alfa);
  await renameAlfa(page, core);
  await gotoNote(page, 'Beta');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Gama', 'Back lands on Gama (the history entry was rewritten)');
  assert.equal(await seen(page.getByRole('alert'), 500), false, 'no "missing note" alert');
  const reads = (await callsOf(core, 'note_read')).map((c) => nfc(String(args(c).path)));
  assert.ok(!reads.slice(-3).includes(R.alfa), 'Back never asks for the dead Pages/Alfa.md');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-08 AC-7

test('fr_fmt_08_ac7_no_op_commits_send_no_write', async ({ page }) => {
  const core = await openRename(page, R.caj);
  const before = await nonReadCalls(core);
  for (const t of ['Čaj o páté', '  Čaj o páté  ', 'Čaj o páté'.normalize('NFD')]) {
    await typeTitle(page, t);
    await commit(page, 'enter');
    await sleep(300);
  }
  await typeTitle(page, '   ');
  await commit(page, 'body');
  await sleep(1500);
  assert.deepEqual((await nonReadCalls(core)).slice(before.length), [], 'equal, NFC/trim-equal and spaces-only commits send zero write calls');
  const shown = ((await titleField(page).first().innerText().catch(() => '')) || (await titleField(page).first().inputValue().catch(() => ''))).trim();
  assert.equal(shown.normalize('NFC'), 'Čaj o páté', 'the saved title is restored');
  // Control: a real commit sends exactly one rename.
  await typeTitle(page, 'Čaj o šesté');
  await commit(page, 'enter');
  assert.deepEqual(args(await oneRename(core)), { path: R.caj, title: 'Čaj o šesté', fromTitle: 'Čaj o páté' }, 'control: a changed title renames');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-08 AC-9

async function triesToRename(page: Page, core: FakeCoreHandle, what: string) {
  const t = titleField(page);
  if (await seen(t, 1000)) {
    const ro = await t.first().evaluate((e) => e.getAttribute('aria-readonly') === 'true' || (e as HTMLInputElement).readOnly === true || e.getAttribute('contenteditable') === 'false');
    if (!ro) {
      await typeTitle(page, `${what} nový`);
      await commit(page, 'enter');
    }
  }
  await sleep(800);
  assert.deepEqual(await callsOf(core, 'note_rename'), [], `${what}: no rename job starts`);
}

test('fr_fmt_08_ac9_daily_note_title_never_renames', async ({ page }) => {
  const core = await openRename(page, R.den);
  await must(editorBody(page), 'the Daily Note in the editor', 5000);
  await triesToRename(page, core, 'Daily Note');
  await gotoNote(page, 'Beta');
  await typeTitle(page, 'Beta nová');
  await commit(page, 'enter');
  await oneRename(core); // control
});

test('fr_fmt_08_ac9_template_and_trash_title_edits_write_title_only', async ({ page }) => {
  for (const [path, title] of [[R.sablona, 'Page']] as const) {
    const p = await page.context().newPage();
    const core = await openRename(p, path, { route: `note/${path}` });
    await mustBeOn(p, title, `${path} open`, 5000);
    await typeTitle(p, `${title} nový`);
    await commit(p, 'enter');
    await sleep(1500);
    assert.deepEqual(await callsOf(core, 'note_rename'), [], `${path}: no rename (D-391)`);
    const files = await core.files();
    assert.ok(files[path] !== undefined, `${path}: the file keeps its path`);
    await p.close();
  }
  // 6A (trash-media.md FR-HIS-01 AC-6, D-618, D-632): a note in `.trash/` opens read-only: no editable title, no write.
  {
    const p = await page.context().newPage();
    const core = await openRename(p, R.kos, { route: `note/${R.kos}` });
    await mustBeOn(p, 'Starý', `${R.kos} open`, 5000);
    await must(p.getByText('This object is in the trash. Restore it to edit it.'), `${R.kos}: the read-only banner`, 3000);
    assert.equal(await p.getByRole('textbox', { name: 'Title', exact: true }).count(), 0, `${R.kos}: no editable title`);
    await sleep(500);
    assert.deepEqual(await callsOf(core, 'note_rename'), [], `${R.kos}: no rename`);
    assert.ok((await core.files())[R.kos] !== undefined, `${R.kos}: the file keeps its path`);
    await p.close();
  }
  const core = await openRename(page, R.beta);
  await typeTitle(page, 'Beta nová');
  await commit(page, 'enter');
  await oneRename(core); // control
});

test('fr_fmt_08_ac9_read_only_files_offer_no_rename', async ({ page }) => {
  const core = await openRename(page, R.beta);
  await core.setFile('Pages/Rozbitý.md', Uint8Array.from([0x2d, 0x2d, 0x2d, 0x0a, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x3a, 0x20, 0x52, 0x0a, 0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe, 0x0a]));
  await page.keyboard.press('Meta+o');
  await page.getByRole('textbox', { name: 'Switcher query' }).or(page.getByRole('combobox', { name: 'Switcher query' })).first().fill('Rozbitý');
  await settled(page, 'Switcher results', 'Rozbitý');
  await page.keyboard.press('Enter');
  await must(page.getByRole('alert').filter({ hasText: "This file isn't valid UTF-8" }), 'the read-only warning (NFR-REL-03 AC-7)', 5000);
  await triesToRename(page, core, 'read-only file');
  await gotoNote(page, 'Beta');
  await typeTitle(page, 'Beta nová');
  await commit(page, 'enter');
  await oneRename(core); // control
});

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-14

async function undone(core: FakeCoreHandle, what: string) {
  const alfa = await fileEventually(core, R.alfa, (t) => t === original(R.alfa));
  assert.equal(alfa, original(R.alfa), `${what}: Pages/Alfa.md is back with its pre-rename bytes`);
  assert.equal(await fileText(core, R.gama), undefined, `${what}: Pages/Gama.md is gone`);
  for (const p of GAMA_OTHERS) assert.equal(await fileText(core, p), original(p), `${what}: ${p} has its pre-rename bytes`);
}

test('fr_lnk_03_ac14_cmd_z_in_the_title_undoes_and_shift_cmd_z_redoes', async ({ page }) => {
  const core = await openRename(page, R.alfa);
  const job = await renameAlfa(page, core);
  await (await must(titleField(page), 'title')).click();
  await page.keyboard.press('Meta+z');
  const u = await eventually(() => callsOf(core, 'job_undo'), (c) => c.length > 0, 2000);
  assert.deepEqual(u.map(args), [{ jobId: job }], 'one job_undo for the rename (one history entry)');
  await undone(core, '⌘Z in the title');
  await page.keyboard.press('Meta+Shift+z');
  const r = await eventually(() => callsOf(core, 'job_redo'), (c) => c.length > 0, 2000);
  assert.deepEqual(r.map(args), [{ jobId: job }], 'job_redo for the same rename');
  assert.equal(await fileEventually(core, R.odkazy, (t) => t === odkazyAfterGama()), odkazyAfterGama(), 'redo re-applies the same bytes');
});

test('fr_lnk_03_ac14_undo_from_the_editor_the_palette_and_the_toast', async ({ page }) => {
  for (const how of ['editor', 'palette', 'toast'] as const) {
    const p = await page.context().newPage();
    const core = await openRename(p, R.alfa);
    const job = await renameAlfa(p, core);
    if (how === 'editor') {
      await (await must(editorBody(p), 'editor')).click();
      await p.keyboard.press('Meta+z');
    } else if (how === 'palette') {
      await runCommand(p, 'Undo rename');
    } else {
      // 4.5 s: the status shows when the job's report arrives and stays 5 s (ms4-jobs §10); under the push gate the
      // report can come later than 3 s after Pages/Gama.md exists.
      const toast = await must(jobStatus(p, /^Updated links in 5 notes/), 'the done status with Undo', 4500);
      await (await needButton(toast, 'Undo')).click();
    }
    const u = await eventually(() => callsOf(core, 'job_undo'), (c) => c.length > 0, 2000);
    assert.deepEqual(u.map(args), [{ jobId: job }], `${how}: job_undo(jobId)`);
    await undone(core, how);
    await p.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-15, AC-16

test('fr_lnk_03_ac15_skipped_file_listed_with_its_reason_and_retry_keeps_the_external_edit', async ({ page }) => {
  const core = await openRename(page, R.alfa);
  await core.skipOnWrite(R.odkazy, 'changed');
  const job = await renameAlfa(page, core);
  assert.equal(await fileText(core, R.odkazy), original(R.odkazy), 'Odkazy is not written');
  const entry = await must(notUpdatedEntry(page), 'status entry "1 note not updated" (D-731)', 5000);
  assert.equal((await entry.innerText()).trim(), '1 note not updated');
  await entry.click();
  const list = await must(notUpdatedList(page), '"Notes not updated" list (D-737)');
  assert.equal(await anyModal(page).count(), 0, 'the list is non-modal');
  const row = list.getByRole('listitem').filter({ hasText: 'Odkazy' });
  await must(row, 'row Odkazy');
  const text = (await row.first().innerText()).replace(/\s+/g, ' ');
  for (const part of ['Odkazy', R.odkazy, 'changed by another app']) assert.ok(text.includes(part), `row shows ${part}: ${text}`);
  await needButton(row.first(), 'Open');
  // The other program's edit, then Retry: only the link bytes change.
  const external = `${original(R.odkazy)}Externí změna.\n`;
  await core.setFile(R.odkazy, external);
  await (await needButton(row.first(), 'Retry Odkazy')).click();
  const r = await eventually(() => callsOf(core, 'job_retry'), (c) => c.length > 0, 2000);
  assert.deepEqual(r.map(args), [{ jobId: job, path: R.odkazy }], 'job_retry(jobId, path)');
  assert.equal(await fileEventually(core, R.odkazy, (t) => t !== external), `${odkazyAfterGama()}Externí změna.\n`, 'retry rewrites only the links; the external edit is kept');
  assert.ok(await absent(row, 2000), 'a successful retry removes the row');
});

test('fr_lnk_03_ac15_missing_and_not_downloaded_reasons_retry_disabled_for_missing', async ({ page }) => {
  const core = await openRename(page, R.alfa);
  await core.skipOnWrite(R.odkazy, 'missing');
  await core.skipOnWrite(R.windows, 'placeholder');
  await renameAlfa(page, core);
  const entry = await must(notUpdatedEntry(page), 'status entry "2 notes not updated" (D-731)', 5000);
  assert.equal((await entry.innerText()).trim(), '2 notes not updated');
  await entry.click();
  const list = await must(notUpdatedList(page), '"Notes not updated" list (D-737)');
  const odk = list.getByRole('listitem').filter({ hasText: 'Odkazy' });
  const win = list.getByRole('listitem').filter({ hasText: 'Windows' });
  assert.ok((await odk.first().innerText()).includes('missing'), 'Odkazy: reason missing');
  assert.ok((await win.first().innerText()).includes('not downloaded'), 'Windows: reason not downloaded');
  const retry = await needButton(odk.first(), 'Retry Odkazy');
  const disabled = await retry.evaluate((e) => (e as HTMLButtonElement).disabled || e.getAttribute('aria-disabled') === 'true');
  assert.equal(disabled, true, 'Retry is disabled for a missing file');
});

test('fr_lnk_03_ac16_list_survives_navigation_retry_all_and_palette', async ({ page }) => {
  const core = await openRename(page, R.alfa);
  await core.skipOnWrite(R.odkazy, 'changed');
  await core.skipOnWrite(R.windows, 'changed');
  const job = await renameAlfa(page, core);
  const entry = await must(notUpdatedEntry(page), 'status entry', 5000);
  assert.equal((await entry.innerText()).trim(), '2 notes not updated', 'plural catalog key (D-731)');
  await gotoNote(page, 'Beta');
  await gotoNote(page, 'Kód');
  await must(notUpdatedEntry(page), 'the entry survives navigation', 2000);
  await runCommand(page, 'Show notes not updated');
  const list = await must(notUpdatedList(page), 'the palette opens the list');
  assert.equal(await list.getByRole('listitem').count(), 2, 'one row per file');
  const row = list.getByRole('listitem').filter({ hasText: 'Windows' }).first();
  await (await needButton(row, 'Open')).click();
  await mustBeOn(page, 'Windows', 'Open goes to the file');
  await runCommand(page, 'Show notes not updated');
  const list2 = await must(notUpdatedList(page), 'the list again');
  await (await needButton(list2, 'Retry all')).click();
  const r = await eventually(() => callsOf(core, 'job_retry'), (c) => c.length >= 2, 2000);
  assert.deepEqual(r.map(args).map((a) => nfc(String(a.path))).sort(), [R.odkazy, R.windows].sort(), 'Retry all retries every row');
  assert.ok(r.every((c) => args(c).jobId === job), 'with the job id');
  assert.ok(await absent(notUpdatedEntry(page), 2000), 'the entry goes away when every row succeeded');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-18

test('fr_lnk_03_ac18_unsaved_body_edit_and_the_self_link_both_land', async ({ page }) => {
  const core = await openRename(page, R.alfa);
  await core.writeControl({ hold: true });
  const body = await must(editorBody(page), 'editor');
  await body.click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type(' Neuložený dodatek');
  await typeTitle(page, 'Gama');
  await commit(page, 'enter');
  await oneRename(core);
  await core.release();
  await core.writeControl({ hold: false });
  const g = await fileEventually(core, R.gama, (t) => (t ?? '').includes('Neuložený dodatek') && (t ?? '').includes('[[Gama#Úvod]]'), 5000);
  assert.ok((g ?? '').includes('Neuložený dodatek'), `the user's edit is saved: ${g}`);
  assert.ok((g ?? '').includes('[[Gama#Úvod]]') && !(g ?? '').includes('[[Alfa#Úvod]]'), 'and the self-link follows the rename');
  assert.equal(await seen(page.getByRole('dialog', { name: 'Note changed outside Tegg' }), 500), false, 'no merge dialog: the change went through the editor');
});

test('fr_lnk_03_ac18_open_linking_note_rewritten_through_its_editor_on_undo', async ({ page }) => {
  const core = await openRename(page, R.alfa);
  await renameAlfa(page, core);
  await gotoNote(page, 'Odkazy');
  await core.writeControl({ hold: true });
  const body = await must(editorBody(page), 'editor');
  await body.click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type(' Neuložený text');
  await runCommand(page, 'Undo rename');
  await sleep(300);
  await core.release();
  await core.writeControl({ hold: false });
  const o = await fileEventually(core, R.odkazy, (t) => (t ?? '').includes('Neuložený text') && (t ?? '').includes('\n[[Alfa]]\n'), 5000);
  assert.ok((o ?? '').includes('Neuložený text'), `the unsaved text is kept: ${o}`);
  assert.ok((o ?? '').includes('\n[[Alfa]]\n') && !(o ?? '').includes('[[Gama'), 'and the links are the undone ones');
  assert.equal(await seen(page.getByRole('dialog', { name: 'Note changed outside Tegg' }), 500), false, 'no merge dialog');
});

// ------------------------------------------------------------------------------------------------ FR-UX-07 AC-9

test('fr_ux_07_ac9_non_blocking_status_then_done_with_undo_for_5s', async ({ page }) => {
  const core = await openRename(page, R.alfa);
  const release = await core.holdJob('writing');
  await typeTitle(page, 'Gama');
  await commit(page, 'enter');
  await oneRename(core);
  await must(jobStatus(page, 'Updating links in 5 notes'), 'status "Updating links in 5 notes"', 3000);
  assert.equal(await anyModal(page).count(), 0, 'no dialog, no aria-modal');
  const body = await must(editorBody(page), 'editor');
  await body.click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type(' Psaní během úlohy');
  await release();
  const done = await must(jobStatus(page, /^Updated links in 5 notes/), 'status "Updated links in 5 notes"', 5000);
  await needButton(done, 'Undo');
  const g = await fileEventually(core, R.gama, (t) => (t ?? '').includes('Psaní během úlohy'), 5000);
  assert.ok((g ?? '').includes('Psaní během úlohy'), 'typing during the job is saved');
  assert.ok(await absent(jobStatus(page, /^Updated links in 5 notes/), 7000), 'the done status goes away after 5 s');
});

test('fr_ux_07_ac9_rename_without_other_files_shows_nothing', async ({ page }) => {
  const core = await openRename(page, R.kod);
  await typeTitle(page, 'Kódy');
  await commit(page, 'enter');
  await oneRename(core);
  await fileEventually(core, 'Pages/Kódy.md', (t) => t !== undefined);
  assert.equal(await seen(jobStatus(page, /links in \d+ notes?/), 1500), false, 'no status for a rename that rewrites no other file');
  const files = await core.files();
  assert.ok(files['Pages/Kódy.md'] !== undefined, 'the rename happened');
});
