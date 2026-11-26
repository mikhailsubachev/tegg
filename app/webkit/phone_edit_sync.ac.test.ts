// Slice AND-3, L5p (projects `phone-webkit`, `phone-chromium`): docs/acceptance/android-edit.md, external changes and
// conflicts on the phone:
// - FR-SYN-03 AC-40 (a clean note reloads in place), AC-41 (both changed: the banner), AC-42 (every phone write checks
//   its base), AC-43 (deleted or renamed while open with unsaved edits), AC-44 (new files on a partly synced vault);
// - FR-SYN-04 AC-14 (keep one, or give the copy a new id), AC-15 (merge on the phone);
// - FR-SYN-06 AC-56 (L5p: an editing tour, writes counted per path), AC-57 (L5p: no bulk job and no file move).
// Contract docs/contracts/android-edit.md §2.4 (the write list and its refusals), §10.6 (`MergeBanner`, `Compare
// versions`, the deleted alert, Back held), §10.8 (`ConflictResolve`), §17.1. Changes "from another device" are the fake
// core's `setFile` (with `silent` where the AC says "without vault:changed").
// Red-test readings (reported): "that surface's desktop alert" is checked as an `alert` on that surface with the file
// keeping the external bytes (its exact text is the desktop criterion's); FR-SYN-06 AC-57's "every L5p test of this
// file" is `noBulk(core)` at the end of each test here.
// Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  EDIT_NOW, PE, appBar, assertZeroWrites, backButton, bodyFocused, caretInfo, desktopPage, editVault, editorText, eventually, fileStateOf, flat,
  formatBar, formatButton, goNote, h1Text, keyboard, loadVault, mainScroll, mergeBanner, must, needBody, nfc, noteBody, openDrawer, panel, phonePage, runById,
  savedText, seen, setCaret, sleep, startDesktop, startPhone, systemBack, tap, tapToEdit, titleField, typeSheet, writeCalls, writesPerPath, main,
  type PhoneHandle,
} from './phone-helpers';
import { ime } from './phone-ime';

test.use({ timezoneId: 'Europe/Prague' });

const PSANI = nfc(PE.psani);
/** FR-SYN-06 AC-57's list: never sent by a phone surface. */
const NEVER = ['note_rename', 'type_move', 'type_move_plan', 'folder_move_preview', 'tidy_now', 'merge_start', 'tag_rename', 'tag_delete', 'inbox_bulk', 'type_patch', 'vault_settings_patch', 'media_add', 'media_add_paths', 'trash_delete', 'trash_empty'];
async function noBulk(core: PhoneHandle, what: string) {
  const bad = (await core.calls()).map((c) => c.cmd).filter((c) => NEVER.includes(c) || c.startsWith('job_') || /^query_(apply|revert|create|duplicate|rename|trash|restore)$/.test(c));
  assert.deepEqual(bad, [], `${what}: no bulk job, no move and no excluded write (FR-SYN-06 AC-57)`);
}
async function open(page: Page, path: string = PE.psani, o: Record<string, unknown> = {}): Promise<PhoneHandle> {
  const core = await startPhone(page, { vault: editVault(), route: `note/${path}`, now: EDIT_NOW, ...o });
  await needBody(page, path);
  return core;
}
const writesOf = async (core: PhoneHandle, cmd: string) => (await core.calls()).filter((c) => c.cmd === cmd);
/** Psaní with an unsaved X in Konec.: writes held by the fake core (the AC's "the fake core holds writes"). */
async function unsavedX(page: Page, core: PhoneHandle) {
  await core.writeControl({ hold: true });
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: 'X' }]);
}

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-40

test('fr_syn_03_ac40_clean_note_reloads_in_place_on_the_phone', async ({ page }) => {
  const core = await open(page);
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 3);
  const scroll = await mainScroll(page);
  const before = await fileStateOf(core);
  const next = before.files[PSANI].replace('Text s [[Cíl]] a #projekt.', 'Text s [[Cíl]].');
  await core.setFile(PE.psani, next);
  assert.ok(await eventually(async () => ((await editorText(page)) ?? '').includes('Text s [[Cíl]].\n'), (v) => v, 2000), 'within 2 s the editor shows the new text');
  const c = await caretInfo(page);
  assert.deepEqual([c.block, c.offset], ['Konec.', 3], 'the caret is still in Konec. at offset 3');
  assert.ok(await bodyFocused(page), 'the keyboard is still shown (the body keeps the focus)');
  assert.deepEqual((await core.imeCalls()).filter((s) => !s), [], 'nothing hides the keyboard');
  assert.ok(Math.abs((await mainScroll(page)) - scroll) <= 24, 'the scroll position holds (± one line)');
  assert.equal(await mergeBanner(page).count(), 0, 'no banner');
  assert.equal(await formatButton(page, 'Undo').getAttribute('aria-disabled'), 'true', 'Undo is aria-disabled (editor FR-EDT-09 AC-5)');
  await assertZeroWrites(core, { files: { ...before.files, [PSANI]: next }, bin: before.bin }, 'the reload');
  await noBulk(core, 'AC-40');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-41

test('fr_syn_03_ac41_both_changed_banner_on_the_phone', async ({ browser }) => {
  test.setTimeout(120_000);
  for (const choice of ['Keep theirs', 'Keep mine', 'Keep both'] as const) {
    const page = await phonePage(browser);
    const core = await open(page);
    await unsavedX(page, core);
    const theirs = editVault().files[PSANI].replace('Konec.', 'Konec z jiného zařízení.');
    await core.setFile(PE.psani, theirs);
    await core.release();
    const banner = await must(mergeBanner(page), 'the alert "Changed outside Tegg"', 2000);
    const bb = await banner.boundingBox();
    const ab = await appBar(page).boundingBox();
    assert.ok(bb && ab && bb.y >= ab.y + ab.height - 1 && bb.y <= ab.y + ab.height + 8, 'directly below the app bar');
    for (const name of ['Compare', 'Keep mine', 'Keep theirs', 'Keep both']) await must(banner.getByRole('button', { name, exact: true }), `the banner's ${name}`);
    assert.ok((await core.writesTo()).every((p) => p !== PSANI), 'no note_write of the editor\'s version succeeds');
    assert.equal(await noteBody(page).getAttribute('contenteditable'), 'false', 'the body stops accepting input');
    assert.ok((await core.imeCalls()).includes(false), 'the keyboard hides (android_ime(false))');
    assert.doesNotMatch(flat(await banner.innerText()), /\b(Mac|iPhone|Android|Pixel|ago|min|minutes?|\d{1,2}:\d{2})\b/i, 'no text names a device or a time');
    // Back and the app bar's Back don't leave; they move the focus to the banner
    assert.equal(await systemBack(page), 'handled', 'system Back is handled');
    assert.equal(await h1Text(page), 'Psaní', 'system Back doesn\'t leave the note');
    assert.ok(await banner.evaluate((b) => b.contains(document.activeElement)), 'the focus moves to the banner');
    if (await seen(backButton(page), 300)) { await backButton(page).click(); assert.equal(await h1Text(page), 'Psaní', 'nor does the app bar\'s Back'); }
    await sleep(choice === 'Keep theirs' ? 10_000 : 0);
    assert.equal((await core.files())[PSANI], theirs, 'the file keeps the external bytes while the banner is shown');
    // Compare
    await banner.getByRole('button', { name: 'Compare' }).click();
    const cmp = await must(page.getByRole('dialog', { name: 'Compare versions' }), 'Compare versions');
    assert.equal(await cmp.getAttribute('aria-modal'), 'true', 'a modal dialog');
    const mine = cmp.getByText('Your version', { exact: true });
    const disk = cmp.getByText('Version on disk', { exact: true });
    const [mb, db] = [await mine.boundingBox(), await disk.boundingBox()];
    assert.ok(mb && db && mb.y < db.y, 'Your version above Version on disk');
    assert.ok((await cmp.locator('[data-diff="changed"]').count()) > 0, 'the differing lines are marked');
    for (const name of ['Keep mine', 'Keep theirs', 'Keep both']) await must(cmp.getByRole('button', { name, exact: true }), `Compare's ${name}`);
    const diskV = await core.version(PE.psani);
    const n = (await core.calls()).length;
    await cmp.getByRole('button', { name: choice, exact: true }).click();
    if (choice === 'Keep theirs') {
      assert.ok(await eventually(async () => ((await editorText(page)) ?? '').includes('Konec z jiného zařízení.'), (v) => v, 2000), 'Keep theirs shows the disk version');
      await sleep(1200);
      assert.deepEqual(await writeCalls(core, n), [], 'and writes nothing');
    } else if (choice === 'Keep mine') {
      const all = await eventually(() => writeCalls(core, n), (x) => x.length >= 1, 2000);
      await sleep(500);
      assert.deepEqual(await writeCalls(core, n), [{ cmd: 'note_write', path: PSANI }], 'Keep mine sends one note_write');
      const call = (await core.calls()).slice(n).find((c) => c.cmd === 'note_write');
      assert.deepEqual((call?.args as any)?.base, diskV, 'with the disk version as base');
      void all;
    } else {
      const w = await eventually(() => writeCalls(core, n), (x) => x.length >= 1, 2000);
      assert.deepEqual(w, [{ cmd: 'note_create_exact', path: 'Pages/Psaní (conflict 2026-10-14 12-00).md' }], 'Keep both creates the conflict copy beside it');
      assert.match((await core.files())['Pages/Psaní (conflict 2026-10-14 12-00).md'] ?? '', /^id: 01JBAN3000000000000000E001$/m, 'with the same id');
      assert.ok(await eventually(async () => ((await editorText(page)) ?? '').includes('Konec z jiného zařízení.'), (v) => v, 2000), 'the note shows the disk version');
      const d = await openDrawer(page);
      assert.ok(await seen(d.locator('[data-command="goto.conflicts"]'), 2000), 'the drawer shows Conflicts within 2 s');
    }
    await noBulk(core, `AC-41 ${choice}`);
    await page.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-42

test('fr_syn_03_ac42_every_phone_write_checks_its_base', async ({ browser }) => {
  test.setTimeout(150_000);
  const silent = async (core: PhoneHandle, path: string, from: string, to: string) => {
    const t = (await core.files())[nfc(path)];
    assert.ok(t?.includes(from), `setup: ${path} holds ${from}`);
    const next = t!.replace(from, to);
    await core.setFile(path, next, { silent: true });
    return next;
  };
  // row 1: the body; row 3: a checklist item; both show the merge banner
  for (const row of ['body', 'checklist'] as const) {
    const page = await phonePage(browser);
    const path = row === 'body' ? PE.psani : PE.ukoly;
    const core = await open(page, path);
    const ext = await silent(core, path, row === 'body' ? 'Konec.' : 'Velké X', row === 'body' ? 'Konec venku.' : 'Velké X venku');
    if (row === 'body') { await tapToEdit(page, 'Nákup'); await setCaret(page, 'Nákup', 'end'); await ime(page, [{ text: 'Y' }]); }
    else await tap(page, noteBody(page).getByRole('checkbox').first(), 'Koupit mléko\'s checkbox');
    await must(mergeBanner(page), `row ${row}: the merge banner (D-2528)`, 2500);
    assert.equal((await core.files())[nfc(path)], ext, `row ${row}: the file keeps the external bytes`);
    await page.close();
  }
  // row 4: a task checkbox (tasks/ + views-tasks/ at the tasks clock)
  {
    const page = await phonePage(browser);
    const core = await startPhone(page, { vault: loadVault('Úkoly', ['tasks', 'new-empty/.tegg', 'views-tasks']), route: 'type/task', now: '2026-10-14T12:00:00+02:00' });
    const box = page.locator('[data-command="task.complete:Tasks/Zalít květiny.md"]').first();
    await must(box, 'T03\'s checkbox');
    const ext = await silent(core, 'Tasks/Zalít květiny.md', 'title: Zalít květiny', 'title: Zalít květiny');
    await core.setFile('Tasks/Zalít květiny.md', `${ext}Venku.\n`, { silent: true });
    await tap(page, box, 'T03\'s checkbox');
    await must(page.getByRole('alert'), 'row 4: the task\'s changed-outside alert', 2500);
    assert.equal((await core.files())['Tasks/Zalít květiny.md'], `${ext}Venku.\n`, 'row 4: the external bytes stay');
    await page.close();
  }
  // row 5: Reviewed in an Inbox row
  {
    const page = await phonePage(browser);
    const core = await startPhone(page, { vault: (await import('./capture-helpers')).inboxVault(), route: 'inbox', now: '2026-10-14T12:00:00+02:00' });
    const ext = await silent(core, 'Quick Notes/Koupit mléko.md', 'Koupit mléko', 'Koupit mléko a chleba');
    await tap(page, main(page).locator('[data-command="note.markReviewed:Quick Notes/Koupit mléko.md"]').first(), 'Q1\'s Reviewed');
    await must(page.getByRole('alert'), 'row 5: inbox.md AC-3\'s alert', 2500);
    assert.equal((await core.files())['Quick Notes/Koupit mléko.md'], ext, 'row 5: the external bytes stay');
    await page.close();
  }
  // row 14: Pin with pinned.yml changed on disk; row 15: Move to trash with the note changed on disk
  {
    const page = await phonePage(browser);
    const core = await open(page, PE.psani);
    await core.pinsFail('Conflict');
    assert.equal(await runById(page, 'sidebar.pin'), 'ok', 'sidebar.pin');
    await must(page.getByRole('alert'), 'row 14: pinned.md\'s alert', 2500);
    const ext = await silent(core, PE.psani, 'Konec.', 'Konec jinde.');
    assert.equal(await runById(page, 'object.trash'), 'ok', 'object.trash');
    await must(page.getByRole('alert').filter({ hasNotText: /^$/ }), 'row 15: trash.conflict', 2500);
    assert.equal((await core.files())[PSANI], ext, 'row 15: nothing moves');
    assert.ok(!Object.keys(await core.files()).some((p) => p.startsWith('.trash/Pages/Psaní')), 'row 15: nothing in .trash/');
    await noBulk(core, 'AC-42');
    await page.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-43

test('fr_syn_03_ac43_deleted_or_renamed_while_editing_on_the_phone', async ({ browser }) => {
  test.setTimeout(120_000);
  for (const how of ['delete', 'trash'] as const) {
    const page = await phonePage(browser);
    const core = await open(page);
    await unsavedX(page, core);
    if (how === 'delete') await core.setFile(PE.psani, null);
    else await core.renameFile(PE.psani, '.trash/Pages/Psaní.md');
    await core.release();
    const alert = await must(page.getByRole('alert').filter({ hasText: 'This note was deleted outside Tegg' }), `${how}: the deleted alert`, 2500);
    assert.ok(((await editorText(page)) ?? '').includes('Konec.X'), `${how}: the editor keeps the content`);
    await must(alert.getByRole('button', { name: 'Restore file' }), 'Restore file');
    await must(alert.getByRole('button', { name: 'Discard' }), 'Discard');
    assert.equal(await systemBack(page), 'handled', `${how}: Back is held by the deleted alert (CP-10)`);
    assert.equal(await h1Text(page), 'Psaní', `${how}: still on the note`);
    const n = (await core.calls()).length;
    if (how === 'delete') {
      await alert.getByRole('button', { name: 'Restore file' }).click();
      const w = await eventually(() => writeCalls(core, n), (x) => x.length >= 1, 2000);
      assert.deepEqual(w, [{ cmd: 'note_create_exact', path: PSANI }], 'Restore file creates Pages/Psaní.md exclusively');
      assert.ok((await core.files())[PSANI]?.includes('Konec.X'), 'with the editor\'s content');
    } else {
      await alert.getByRole('button', { name: 'Discard' }).click();
      await sleep(1200);
      assert.deepEqual(await writeCalls(core, n), [], 'Discard writes nothing');
    }
    await page.close();
  }
  // a file appears at the path meanwhile: Restore file shows AC-41's banner instead
  {
    const page = await phonePage(browser);
    const core = await open(page);
    await unsavedX(page, core);
    await core.setFile(PE.psani, null);
    await core.release();
    const alert = await must(page.getByRole('alert').filter({ hasText: 'This note was deleted outside Tegg' }), 'the deleted alert', 2500);
    await core.setFile(PE.psani, '---\nid: 01JBAN3000000000000000E901\ntype: page\ntitle: Psaní\n---\nJiný soubor.\n', { silent: true });
    await alert.getByRole('button', { name: 'Restore file' }).click();
    await must(mergeBanner(page), 'a file appeared: the merge banner instead', 2500);
    assert.equal((await core.files())[PSANI], '---\nid: 01JBAN3000000000000000E901\ntype: page\ntitle: Psaní\n---\nJiný soubor.\n', 'the appeared file is kept');
    await page.close();
  }
  // the sync app renames it (same id): the next save goes to the new path
  {
    const page = await phonePage(browser);
    const core = await open(page);
    await unsavedX(page, core);
    await core.renameFile(PE.psani, 'Pages/Psaní nové.md');
    await core.release();
    await ime(page, [{ text: 'Z' }]);
    assert.ok(await eventually(async () => ((await core.files())['Pages/Psaní nové.md'] ?? '').includes('Konec.XZ'), (v) => v, 3000), 'the next save goes to Pages/Psaní nové.md');
    assert.equal((await core.files())[PSANI], undefined, 'no file appears at the old path');
    await page.close();
  }
  // without unsaved edits a delete shows `This note was moved or deleted` at once
  {
    const page = await phonePage(browser);
    const core = await open(page);
    await core.setFile(PE.psani, null);
    await must(page.getByText('This note was moved or deleted', { exact: false }), 'android-phone.md FR-SYN-03 AC-38\'s message', 2000);
    await noBulk(core, 'AC-43');
    await page.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-44

test('fr_syn_03_ac44_new_files_on_a_partly_synced_vault', async ({ page, browser }) => {
  // (a) the other device's Daily Note arrives before the phone's first write
  const core = await startPhone(page, { vault: editVault(), route: 'daily/2026-10-14', now: EDIT_NOW });
  const body = await needBody(page, 'the virtual day');
  const theirs = '---\nid: 01JBAN3000000000000000D901\ntype: daily-note\ntitle: 2026-10-14\ndate: 2026-10-14\ncreated: 2026-10-14T08:00:00+02:00\nmodified: 2026-10-14T08:00:00+02:00\n---\nZ Macu.\n';
  await body.tap();
  await keyboard(page, true);
  await core.setFile('Daily/2026-10-14.md', theirs, { silent: true });
  await ime(page, [{ text: 'Dnes' }]);
  const w = await eventually(() => writeCalls(core), (x) => x.length >= 1, 3000);
  assert.equal(w[0]?.cmd, 'daily_create', '(a) daily_create');
  assert.ok(await eventually(async () => Object.keys(await core.files()).includes('Daily/2026-10-14 (2).md'), (v) => v, 2000), '(a) the phone\'s note is Daily/2026-10-14 (2).md');
  assert.equal((await core.files())['Daily/2026-10-14.md'], theirs, '(a) the pushed file keeps its bytes');
  const dup = await must(page.getByRole('status').or(page.getByRole('alert')).filter({ hasText: /2026-10-14/ }).first(), '(a) the duplicate notice (D-319)', 2500);
  assert.equal(await dup.getByRole('link', { name: 'Duplicate titles' }).count() + await dup.getByRole('button', { name: 'Duplicate titles' }).count(), 0, '(a) without the Duplicate titles link (D-2437)');
  // (b) a [[Lisabon create, then another device's Pages/Lisabon.md
  const p2 = await phonePage(browser);
  const c2 = await startPhone(p2, { vault: editVault(), route: `note/${PE.psani}`, now: EDIT_NOW });
  await needBody(p2, 'Psaní');
  await tapToEdit(p2, 'Konec');
  await setCaret(p2, 'Konec.', 'end');
  await ime(p2, [{ text: ' [[Lisabon' }]);
  await tap(p2, panel(p2, 'Link suggestions').getByRole('option').filter({ hasText: 'Create "Lisabon"' }).first(), 'Create "Lisabon"');
  assert.ok(await eventually(async () => Object.keys(await c2.files()).includes('Quick Notes/Lisabon.md'), (v) => v, 3000), 'Quick Notes/Lisabon.md is made');
  const page2 = '---\nid: 01JBAN3000000000000000L002\ntype: page\ntitle: Lisabon\ncreated: 2026-10-13T09:00:00+02:00\nmodified: 2026-10-13T09:00:00+02:00\n---\nZ Macu.\n';
  await sleep(1200);
  const before = await fileStateOf(c2);
  await c2.setFile('Pages/Lisabon.md', page2);
  await keyboard(p2, false);
  await sleep(800);
  const chip = noteBody(p2).locator('[data-wikilink], .chip').filter({ hasText: 'Lisabon' }).first();
  await tap(p2, chip, 'the [[Lisabon]] chip');
  await needBody(p2, 'the Lisabon the chip opens');
  const phoneOpened = ((await editorText(p2)) ?? '').includes('Z Macu.') ? 'Pages/Lisabon.md' : 'Quick Notes/Lisabon.md';
  const { page: desk, context } = await desktopPage(browser);
  const files = await c2.files();
  await startDesktop(desk, { vault: { name: 'Editor', files }, route: `note/${PE.psani}`, now: EDIT_NOW });
  await (await must(desk.getByRole('textbox', { name: 'Note body' }).locator('[data-wikilink], .chip').filter({ hasText: 'Lisabon' }).first(), 'desktop: the chip')).click({ modifiers: ['Meta'] }).catch(async () => desk.getByRole('textbox', { name: 'Note body' }).locator('[data-wikilink], .chip').filter({ hasText: 'Lisabon' }).first().click());
  await sleep(800);
  const deskOpened = ((await editorText(desk)) ?? '').includes('Z Macu.') ? 'Pages/Lisabon.md' : 'Quick Notes/Lisabon.md';
  await context.close();
  assert.equal(phoneOpened, deskOpened, '(b) [[Lisabon]] resolves to the file the desktop\'s resolution gives');
  const now = await fileStateOf(c2);
  assert.deepEqual(Object.keys(now.files).sort(), [...new Set([...Object.keys(before.files), 'Pages/Lisabon.md'])].sort(), '(b) no file renamed or merged');
  // the [[ panel lists both Lisabon objects with their details
  await systemBack(p2);
  await needBody(p2, 'Psaní');
  await tapToEdit(p2, 'Nákup');
  await setCaret(p2, 'Nákup', 'end');
  await ime(p2, [{ text: ' [[Lisabon' }]);
  const rows = await eventually(async () => (await panel(p2, 'Link suggestions').getByRole('option').allInnerTexts()).map(flat).filter((t) => t.startsWith('Lisabon')), (r) => r.length >= 2, 2000);
  assert.equal(rows.length, 2, '(b) the [[ panel lists both Lisabon objects');
  assert.notEqual(rows[0], rows[1], '(b) with their details');
  await noBulk(c2, 'AC-44');
  await p2.close();
});

// ------------------------------------------------------------------------------------------------ FR-SYN-04 AC-14, AC-15

const conflictsVault = () => loadVault('Konflikty', ['conflicts', 'new-empty/.tegg']);
const PLAN = 'Pages/Plán.md';
const COPY = 'Pages/Plán (conflicted copy 2026-10-07).md';
async function openPair(page: Page, copy: string) {
  const d = await openDrawer(page);
  await (await must(d.locator('[data-command="goto.conflicts"]'), 'the drawer\'s Conflicts')).click();
  const list = await must(main(page).getByRole('list', { name: 'Conflicts' }), 'list "Conflicts"');
  await list.getByRole('link').filter({ hasText: copy.split('/').pop()! }).first().click();
  return must(page.getByRole('region', { name: 'Compare versions' }), 'the stacked compare');
}

test('fr_syn_04_ac14_keep_one_on_the_phone', async ({ browser }) => {
  test.setTimeout(120_000);
  for (const keep of ['primary', 'copy'] as const) {
    const page = await phonePage(browser);
    const core = await startPhone(page, { vault: conflictsVault(), route: 'inbox', now: EDIT_NOW });
    await openPair(page, COPY);
    const keeps = page.getByRole('button', { name: 'Keep this version' });
    assert.equal(await keeps.count(), 2, '`Keep this version` under each version');
    assert.deepEqual(await keeps.evaluateAll((bs) => bs.map((b) => (b.getAttribute('aria-description') ?? '').normalize('NFC'))), [PLAN, nfc(COPY)], 'each with its path as the description');
    await must(page.getByRole('button', { name: 'Merge…' }), 'Merge…');
    // Cancel writes nothing
    await keeps.nth(keep === 'primary' ? 0 : 1).click();
    let confirm = await must(page.getByRole('dialog', { name: 'Move to trash?' }), 'the confirmation sheet');
    const other = keep === 'primary' ? COPY : PLAN;
    await must(confirm.getByText(`Move “${other.split('/').pop()}” to the trash?`, { exact: true }).or(confirm.getByText(`Move “${other.split('/').pop()!.replace(/\.md$/, '')}” to the trash?`, { exact: true })), 'phone.trashCopy naming the other file');
    const n = (await core.calls()).length;
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await sleep(500);
    assert.deepEqual(await writeCalls(core, n), [], 'Cancel writes nothing');
    await keeps.nth(keep === 'primary' ? 0 : 1).click();
    confirm = await must(page.getByRole('dialog', { name: 'Move to trash?' }), 'the confirmation sheet');
    await confirm.getByRole('button', { name: 'Move to trash' }).click();
    const w = await eventually(() => writeCalls(core, n), (x) => x.some((y) => y.cmd === 'note_trash'), 2500);
    assert.deepEqual(w, keep === 'primary' ? [{ cmd: 'note_trash', path: nfc(COPY) }] : [{ cmd: 'note_write', path: PLAN }, { cmd: 'note_trash', path: nfc(COPY) }],
      keep === 'primary' ? 'keeping Plán.md trashes the copy only' : 'keeping the copy writes its bytes into Plán.md, then trashes the copy (D-177)');
    const files = await core.files();
    assert.match(files[PLAN] ?? '', /^id: 01JB0K0000000000000000K001$/m, 'Plán.md keeps the id');
    if (keep === 'copy') assert.ok(files[PLAN]?.includes('Řádek 3 změněný na druhém Macu.'), 'with the copy\'s text');
    const d = await openDrawer(page);
    const count = async () => flat(await d.locator('[data-command="goto.conflicts"]').innerText().catch(() => ''));
    assert.ok(await eventually(count, (t) => /2$/.test(t), 2000), 'the drawer\'s count drops within 2 s');
    await noBulk(core, `AC-14 keep ${keep}`);
    await page.close();
  }
  // Rozpočet + Rozpočet kopie: Give the copy a new id writes only the copy's id line
  const page = await phonePage(browser);
  const core = await startPhone(page, { vault: conflictsVault(), route: 'inbox', now: EDIT_NOW });
  await openPair(page, 'Pages/Rozpočet kopie.md');
  const n = (await core.calls()).length;
  await (await must(page.getByRole('button', { name: 'Give the copy a new id' }), 'Give the copy a new id')).click();
  const w = await eventually(() => writeCalls(core, n), (x) => x.length >= 1, 2500);
  assert.deepEqual(w, [{ cmd: 'note_write', path: 'Pages/Rozpočet kopie.md' }], 'one write of the copy');
  const was = conflictsVault().files['Pages/Rozpočet kopie.md'].split('\n');
  const now = ((await core.files())['Pages/Rozpočet kopie.md'] ?? '').split('\n');
  assert.deepEqual(now.map((l, i) => (l === was[i] ? null : i)).filter((x) => x !== null), [1], 'only the id line changes');
  // a version changed on disk meanwhile is refused (editor FR-SYN-04 AC-11)
  const p3 = await phonePage(browser);
  const c3 = await startPhone(p3, { vault: conflictsVault(), route: 'inbox', now: EDIT_NOW });
  await openPair(p3, COPY);
  const ext = `${(await c3.files())[nfc(COPY)]}Další řádek.\n`;
  await c3.setFile(COPY, ext, { silent: true });
  await p3.getByRole('button', { name: 'Keep this version' }).first().click();
  await (await must(p3.getByRole('dialog', { name: 'Move to trash?' }).getByRole('button', { name: 'Move to trash' }), 'confirm')).click();
  await sleep(1500);
  assert.equal((await c3.files())[nfc(COPY)], ext, 'a copy changed meanwhile isn\'t trashed');
  await p3.close();
});

test('fr_syn_04_ac15_merge_on_the_phone', async ({ browser }) => {
  for (const end of ['Cancel', 'Back', 'Done'] as const) {
    const page = await phonePage(browser);
    const core = await startPhone(page, { vault: conflictsVault(), route: 'inbox', now: EDIT_NOW });
    await openPair(page, COPY);
    const before = await fileStateOf(core);
    await (await must(page.getByRole('button', { name: 'Merge…' }), 'Merge…')).click();
    const dlg = await must(page.getByRole('dialog', { name: 'Merge versions' }), 'dialog "Merge versions"');
    assert.equal(await dlg.getAttribute('aria-modal'), 'true', 'a full-screen modal dialog');
    const draft = await must(dlg.getByRole('textbox', { name: 'Note body' }), 'the editable draft (the phone editor)');
    const ro = dlg.getByText('Řádek 3 změněný na druhém Macu.').first();
    const [drb, rob] = [await draft.boundingBox(), await ro.boundingBox()];
    assert.ok(drb && rob && drb.y < rob.y, 'the draft is above the other version, read-only');
    await tapToEdit(page, 'Řádek 1 plánu.');
    await must(formatBar(page), 'RA15\'s bar in the draft', 800);
    await setCaret(page, 'Řádek 1 plánu.', 'end');
    await ime(page, [{ text: ' Sloučeno.' }]);
    await sleep(1200);
    if (end !== 'Done') {
      if (end === 'Cancel') await dlg.getByRole('button', { name: 'Cancel' }).click(); else await systemBack(page);
      await sleep(800);
      await assertZeroWrites(core, before, `Merge versions, ${end}`);
    } else {
      const n = (await core.calls()).length;
      await dlg.getByRole('button', { name: 'Done' }).click();
      const w = await eventually(() => writeCalls(core, n), (x) => x.length >= 2, 2500);
      assert.deepEqual(w, [{ cmd: 'note_write', path: PLAN }, { cmd: 'note_trash', path: nfc(COPY) }], 'Done writes the draft into Plán.md and moves the other to .trash/');
      assert.ok((await core.files())[PLAN]?.includes('Řádek 1 plánu. Sloučeno.'), 'the draft\'s text');
    }
    await noBulk(core, `AC-15 ${end}`);
    await page.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-56, AC-57

test('fr_syn_06_ac56_editing_tour_on_the_phone', async ({ page }) => {
  test.setTimeout(180_000);
  const core = await open(page);
  const before = await fileStateOf(core);
  // (a) the tour that writes nothing
  for (const title of ['Psaní', 'Mapa v textu', 'Tabulka', 'Deset bloků', 'Úkoly', 'Seznamy']) {
    await goNote(page, title);
    const body = await needBody(page, title);
    const blocks = await body.locator(':scope > *').count();
    // a tap at the block's end (its last character), not its left edge, which hits a checkbox (D-2555); empty blocks
    // are skipped, so the caret ends after text and the typed leading space is never at a block start
    for (const k of [...new Set([0, Math.floor(blocks / 2), blocks - 1])]) {
      const end = await body.locator(':scope > *').nth(Math.max(0, k)).evaluate((el) => {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let last: Text | null = null;
        for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) if ((t.textContent ?? '').trim()) last = t;
        if (!last) return null;
        const len = (last.textContent ?? '').replace(/\s+$/, '').length;
        const r = document.createRange();
        r.setStart(last, Math.max(0, len - 1));
        r.setEnd(last, len);
        const b = r.getBoundingClientRect();
        return b.width || b.height ? { x: b.right - 1, y: b.top + b.height / 2 } : null;
      });
      if (end) await page.touchscreen.tap(end.x, end.y);
      await sleep(400);
    }
    await keyboard(page, true);
    for (const [t, name] of [[' [[', 'Link suggestions'], [' #a', 'Tag suggestions']] as const) {
      await ime(page, [{ text: t }]);
      await page.keyboard.press('Escape');
      // deleteSurroundingText over what was typed; a typed `#a` is one tag atom, so ` #a` is two units (D-2555, D-2556)
      await ime(page, [{ deleteSurrounding: { before: t === ' #a' ? 2 : t.length, after: 0 } }]);
      void name;
    }
    await keyboard(page, false);
  }
  await sleep(1500);
  await assertZeroWrites(core, before, '(a) opening, tapping, the keyboard, panels without a choice');
  await goNote(page, 'Psaní');
  assert.equal(await runById(page, 'phone.properties'), 'ok', 'the Properties sheet');
  await systemBack(page);
  assert.equal(await runById(page, 'object.new'), 'ok', 'the type sheet');
  await must(typeSheet(page), 'the type sheet');
  await systemBack(page);
  assert.equal(await runById(page, 'note.toggleSource'), 'ok', 'Show Markdown source');
  assert.equal(await runById(page, 'note.toggleSource'), 'ok', 'and back');
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await tap(page, formatButton(page, 'Bold'), 'Bold');
  await tap(page, formatButton(page, 'Bold'), 'Bold again');
  await ime(page, [{ text: 'x' }]);
  await tap(page, formatButton(page, 'Undo'), 'Undo within 500 ms');
  await keyboard(page, false);
  await page.setViewportSize({ width: 915, height: 412 });
  await page.setViewportSize({ width: 412, height: 915 });
  await core.visibility('hidden');
  await core.visibility('visible');
  await sleep(1500);
  await assertZeroWrites(core, before, '(a) the whole tour');
  // (b) each action writes exactly its RA17 files, once
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  const t0 = Date.now();
  while (Date.now() - t0 < 10_000) { await ime(page, [{ text: 'a' }]); await sleep(150); }
  await sleep(1500);
  let per = await writesPerPath(core);
  assert.deepEqual(Object.keys(per), [PSANI], '(b) typing for 10 s writes Psaní only');
  assert.ok(per[PSANI] <= 10, `(b) at most 10 writes (${per[PSANI]})`);
  const n = per[PSANI];
  await keyboard(page, false);
  await goNote(page, 'Úkoly');
  await tap(page, noteBody(page).getByRole('checkbox').first(), 'Koupit mléko');
  await sleep(1500);
  per = await writesPerPath(core);
  assert.equal(per[nfc(PE.ukoly)], 1, '(b) a checklist toggle writes Úkoly once');
  await goNote(page, 'Psaní');
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: ' [[Nový cíl' }]);
  await tap(page, panel(page, 'Link suggestions').getByRole('option').filter({ hasText: 'Create "Nový cíl"' }).first(), 'Create "Nový cíl"');
  await sleep(1500);
  per = await writesPerPath(core);
  assert.equal(per['Quick Notes/Nový cíl.md'], 1, '(b) a [[ create writes the new file once');
  assert.equal(per[PSANI], n + 1, '(b) and Psaní once');
  await keyboard(page, false);
  assert.equal(await runById(page, 'object.new'), 'ok', 'object.new');
  await tap(page, typeSheet(page).getByRole('option', { name: /^Page\b/ }).first(), 'Page');
  const title = await must(titleField(page), 'the draft\'s Title');
  assert.ok(await eventually(() => title.evaluate((e) => e === document.activeElement || e.contains(document.activeElement)), (v) => v, 1500), 'the draft\'s Title has focus');
  await ime(page, [{ text: 'Koncept' }, { enter: true }]);
  await sleep(1500);
  per = await writesPerPath(core);
  assert.equal(per['Pages/Koncept.md'], 1, '(b) a draft\'s first write: one file');
  await noBulk(core, 'AC-56');
});

test('fr_syn_06_ac57_still_no_bulk_job_or_move_on_the_phone', async ({ page }) => {
  const core = await startPhone(page, { vault: loadVault('Knihovna', ['type-moves', 'new-empty/.tegg']), route: 'note/Pages/Kniha jinde.md', now: EDIT_NOW });
  await needBody(page, 'Kniha jinde');
  await tapToEdit(page, 'Válka');
  await setCaret(page, 'Válka s mloky.', 'end');
  await ime(page, [{ text: ' Doplněno.' }]);
  const saved = await savedText(core, 'Pages/Kniha jinde.md', 3000);
  assert.ok(saved?.includes('Válka s mloky. Doplněno.'), 'Kniha jinde is saved at its path');
  await sleep(1500);
  assert.ok(!Object.keys(await core.files()).some((p) => p.startsWith('Knihy/Kniha jinde')), 'and not moved to Knihy/');
  await noBulk(core, 'AC-57');
});
