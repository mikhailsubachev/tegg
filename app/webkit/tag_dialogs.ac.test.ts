// MS4 slice 4D-lite L5 (WebKit, fake core): the tag dialogs (docs/acceptance/tags.md R84, R86): FR-TAG-03 AC-1 (New
// tag writes one Tag file, **(TZ)**), AC-2 (an existing key opens it, no write), AC-3 (refused names), AC-4 (a free stem;
// the file appearing meanwhile), AC-6 (no other path writes a Tag file); FR-TAG-04 AC-6 (rename refused onto an
// existing key), AC-7 (the dialog, confirm, Cancel, cancel while planning), AC-8 (status, the not-updated list, Retry,
// an open note through its editor), AC-9 (after the rename); FR-TAG-08 AC-1 (the delete dialogs), AC-3 (Delete only
// the tag, D-732), AC-5 (status, list, cancel). Interface docs/contracts/ms4-tags.md §2 (R86 bytes through
// `note_create_exact`), §3, §4.4 (`tag_rename`, `tag_delete`, `job_plan`, `job_confirm`), §6.2, §8.1. Written from the
// ACs and the contract only (D-61).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  NFD, NOW_IN, P, ZONES, callsOf, click, deleteDialog, description, eventually, fileWhen, flat, jobStatus, jobsWhen, main, must, newTagDialog, openAllTags,
  openNote, openTagPage, original, renameDialog, runCommand, seen, sidebarTagLinks, sleep, snapshot, startTags, tagAction, tagHeading, tagNameBox,
  tagRowEl, vaultWrites,
} from './tags-helpers';
import { goToQuery } from './helpers'; // D-760: the Search page's Go to list replaces ⌘O

const R86 = (title: string, now: string) => new RegExp(`^---\\nid: [0-9A-HJKMNP-TV-Z]{26}\\ntype: tag\\ntitle: ${title}\\ncreated: ${now.replace(/[+]/g, '\\+')}\\nmodified: ${now.replace(/[+]/g, '\\+')}\\n---\\n$`);
const createBtn = (page: import('@playwright/test').Page) => newTagDialog(page).getByRole('button', { name: 'Create', exact: true });

// ------------------------------------------------------------------------------------------------ FR-TAG-03

for (const tz of ZONES) {
  test.describe(`(TZ ${tz})`, () => {
    test.use({ timezoneId: tz });
    test(`fr_tag_03_ac1_new_tag_writes_one_tag_file (${tz})`, async ({ page }) => {
      const core = await openAllTags(page, { now: NOW_IN[tz] });
      await click(main(page).getByRole('button', { name: 'New tag', exact: true }), 'New tag');
      await must(newTagDialog(page), 'dialog New tag');
      const box = await must(tagNameBox(page), 'textbox Tag name (focused)');
      assert.ok(await box.evaluate((e) => e === document.activeElement), 'focused');
      assert.ok((await description(box)).includes('Letters, digits, - _ /. No spaces.') || (await seen(newTagDialog(page).getByText('Letters, digits, - _ /. No spaces.'), 300)), 'the hint');
      assert.equal(await createBtn(page).getAttribute('aria-disabled'), 'true', 'Create disabled while empty');
      const before = await snapshot(core);
      await box.fill('#Účetnictví');
      await click(createBtn(page), 'Create');
      await must(tagHeading(page, 'Účetnictví'), 'tag/účetnictví opens', 3000);
      await must(main(page).getByText('0 objects of 0 types', { exact: true }), '0 objects of 0 types');
      await must(main(page).getByText('No objects have #Účetnictví yet.', { exact: true }), 'the empty text');
      const after = await snapshot(core);
      assert.deepEqual(Object.keys(after).filter((k) => after[k] !== before[k]), ['Tags/Účetnictví.md'], 'exactly one file written');
      assert.match(after['Tags/Účetnictví.md'], R86('Účetnictví', NOW_IN[tz]), 'R86 bytes with the zone\'s offset');
      assert.equal((await callsOf(core, 'note_create_exact')).length, 1, 'one create-exclusive write (FR-SYN-02)');
    });
  });
}

test('fr_tag_03_ac1_palette_new_tag_opens_the_dialog', async ({ page }) => {
  await openAllTags(page);
  await runCommand(page, 'New tag…');
  await must(newTagDialog(page), 'the palette opens New tag');
});

test('fr_tag_03_ac2_an_existing_key_opens_that_tag', async ({ page }) => {
  const core = await openAllTags(page);
  for (const [typed, heading] of [['účty', 'Účty'], ['ÚČTY', 'Účty'], ['#Účty', 'Účty'], [NFD('účty'), 'Účty'], ['finance', 'finance'], ['PRÁZDNÝ', 'prázdný']]) {
    await runCommand(page, 'New tag…');
    await must(newTagDialog(page), `New tag (${typed})`);
    await tagNameBox(page).fill(typed);
    await page.keyboard.press('Enter');
    await must(tagHeading(page, heading), `${JSON.stringify(typed)} opens tag/${heading}`);
  }
  assert.deepEqual(await vaultWrites(core), [], 'zero write calls');
});

test('fr_tag_03_ac3_refused_names_show_the_r88_message', async ({ page }) => {
  const core = await openAllTags(page);
  await runCommand(page, 'New tag…');
  await must(newTagDialog(page), 'New tag');
  const cases: [string, string][] = [
    ['#', 'Enter a tag name.'], ['moje štítky', 'Tag names can\'t contain spaces.'], ['a\tb', 'Tag names can\'t contain spaces.'], ['a b', 'Tag names can\'t contain spaces.'],
    ['2026', 'A tag needs at least one letter.'], ['C++', '"+" can\'t be part of a tag.'], ['a:b', '":" can\'t be part of a tag.'], ['[[x]]', '"[" can\'t be part of a tag.'],
    ['##x', '"#" can\'t be part of a tag.'],
  ];
  for (const [name, msg] of cases) {
    await tagNameBox(page).fill(name);
    await createBtn(page).click();
    await must(newTagDialog(page).getByText(msg, { exact: true }), `${JSON.stringify(name)}: ${msg}`);
  }
  assert.deepEqual(await vaultWrites(core), [], 'Create writes nothing');
});

test('fr_tag_03_ac4_a_taken_stem_and_a_file_that_appears_meanwhile', async ({ page }) => {
  const core = await openAllTags(page);
  await runCommand(page, 'New tag…');
  await must(newTagDialog(page), 'New tag');
  await tagNameBox(page).fill('Rozpočet');
  await page.keyboard.press('Enter');
  await must(tagHeading(page, 'Rozpočet'), 'tag/rozpočet');
  const t = (await core.files())['Tags/Rozpočet (2).md'];
  assert.ok(t?.includes('\ntitle: Rozpočet\n'), 'Tags/Rozpočet (2).md with title Rozpočet (free vault-wide)');
  await runCommand(page, 'New tag…');
  await must(newTagDialog(page), 'New tag again');
  await core.setFile('Tags/Účetnictví.md', '---\ntype: tag\ntitle: Účetnictví\n---\n', { silent: true });
  await tagNameBox(page).fill('Účetnictví');
  await page.keyboard.press('Enter');
  await must(tagHeading(page, 'Účetnictví'), 'the dialog says the tag exists now and tag/účetnictví opens');
  assert.equal((await core.files())['Tags/Účetnictví.md'], '---\ntype: tag\ntitle: Účetnictví\n---\n', 'nothing overwritten');
});

test('fr_tag_03_ac6_no_other_path_writes_a_tag_file', async ({ page }) => {
  const core = await openNote(page, P.rozpocet, 'Rozpočet');
  const body = page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
  await must(body, 'the editor');
  await body.click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type(' #nový-štítek');
  const sug = page.getByRole('listbox', { name: 'Tag suggestions', exact: true });
  if (await seen(sug, 1000)) {
    const create = sug.getByRole('option', { name: /^Create tag/ });
    if (await seen(create, 500)) await create.click();
  }
  await sleep(1500);
  await runCommand(page, 'Go to Tags');
  await must(tagRowEl(page, 'nový-štítek'), 'the new virtual tag is listed');
  assert.deepEqual((await core.writesTo()).filter((p) => p.startsWith('Tags/')), [], 'no Tags/*.md written (FR-TAG-03 note)');
});

// ------------------------------------------------------------------------------------------------ FR-TAG-04

async function renameTo(page: import('@playwright/test').Page, from: string, to: string) {
  await tagAction(page, 'Rename tag…');
  const d = await must(renameDialog(page, from), `dialog Rename #${from}`);
  const box = d.getByRole('textbox', { name: 'New name', exact: true });
  await box.fill(to);
  await click(d.getByRole('button', { name: 'Rename', exact: true }), 'Rename');
  return d;
}

test('fr_tag_04_ac6_rename_refused_onto_an_existing_key', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  for (const to of ['finance', 'FINANCE', 'prázdný', 'a/b', NFD('čtení')]) {
    const d = await renameTo(page, 'Účty', to);
    await must(d.getByText(/already exists\. Merging tags comes in v1\.0\.$/), `${JSON.stringify(to)}: #<name> already exists…`);
    await page.keyboard.press('Escape');
  }
  const d = await renameTo(page, 'Účty', 'C++');
  await must(d.getByText('"+" can\'t be part of a tag.', { exact: true }), 'FR-TAG-03 AC-3 names are refused the same way');
  assert.deepEqual((await core.jobs()).length, 0, 'no job');
  assert.deepEqual(await vaultWrites(core).then((w) => w.filter((c) => c !== 'tag_rename')), [], 'nothing written');
});

test('fr_tag_04_ac7_the_dialog_confirms_and_cancel_writes_nothing', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  await tagAction(page, 'Rename tag…');
  const d = await must(renameDialog(page, 'Účty'), 'dialog Rename #Účty');
  const box = d.getByRole('textbox', { name: 'New name', exact: true });
  assert.equal(await box.inputValue(), 'Účty', 'prefilled with the display name');
  assert.deepEqual(await box.evaluate((e) => [(e as HTMLInputElement).selectionStart, (e as HTMLInputElement).selectionEnd]), [0, 4], 'all selected');
  await must(d.getByText(/^Updates 6 notes( and 1 template)?\. A backup is made first\.$/), 'Updates 6 notes… (D-714 adds the template)');
  await click(d.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel');
  assert.deepEqual(await core.backups(), [], 'Cancel makes no zip');
  assert.deepEqual(await vaultWrites(core), [], 'and writes nothing');
  await renameTo(page, 'Účty', 'Výdaje');
  const jobs = await jobsWhen(core, 1);
  assert.equal(jobs[0]?.kind, 'tag-rename', 'one tag-rename job');
  assert.equal((await callsOf(core, 'job_confirm')).length, 1, 'Rename is the confirmation (job_confirm)');
  assert.equal((await core.backups()).filter((b) => b.kind === 'tag-rename').length, 1, 'one zip');
});

test('fr_tag_04_ac7_cancel_while_planning_leaves_the_vault_identical', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  const release = await core.holdJob('planning');
  const before = await snapshot(core);
  await renameTo(page, 'Účty', 'Výdaje');
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await must(cancel, 'the status offers Cancel while planning');
  await cancel.click();
  await release();
  const jobs = await jobsWhen(core, 1, 2000);
  assert.equal(jobs[0]?.phase, 'cancelled', 'stops within 1 s');
  assert.deepEqual(await snapshot(core), before, 'byte-identical');
});

test('fr_tag_04_ac7_backup_failed_alert', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  await core.failBackups(true);
  const before = await snapshot(core);
  await renameTo(page, 'Účty', 'Výdaje');
  await must(page.getByRole('alert').filter({ hasText: /backup/i }), 'the alert names the failed backup');
  assert.deepEqual(await snapshot(core), before, 'the vault is byte-identical');
});

test('fr_tag_04_ac8_status_list_and_retry', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  await core.skipOnWrite(P.rozpocet, 'changed');
  await renameTo(page, 'Účty', 'Výdaje');
  await must(jobStatus(page, 'Renamed #Účty to #Výdaje in 6 notes').or(jobStatus(page, /^Renamed #Účty to #Výdaje in \d+ notes/)), 'the status Renamed #Účty to #Výdaje in … notes', 5000);
  assert.equal(await page.getByRole('status').getByRole('button', { name: 'Undo', exact: true }).count(), 0, 'no Undo (D-395)');
  assert.equal(await page.locator('[aria-modal="true"]').count(), 0, 'non-modal');
  const entry = page.getByRole('button', { name: /^1 note not updated$/ }).or(page.getByRole('link', { name: /^1 note not updated$/ }));
  await click(entry, '1 note not updated (plural forms)');
  // The list's name: ms4-jobs §10 `Links not updated`; D-731 renames only the status entry (red-test point AP-675).
  const nm = /^(Links|Notes) not updated$/;
  const list = page.getByRole('list', { name: nm }).or(page.getByRole('region', { name: nm })).or(page.getByRole('dialog', { name: nm }));
  await must(list, 'the not-updated list');
  await must(list.getByRole('button', { name: 'Retry Rozpočet', exact: true }), 'Retry Rozpočet');
  await must(list.getByRole('button', { name: /^Open/ }), 'Open');
  await list.getByRole('button', { name: 'Retry Rozpočet', exact: true }).click();
  const t = await fileWhen(core, P.rozpocet, (x) => !!x?.includes('Výdaje'));
  assert.equal(t, original(P.rozpocet).replace('tags: [účty, finance]', 'tags: [Výdaje, finance]'), 'Retry rewrites only the tag bytes');
});

test('fr_tag_04_ac8_progress_text_while_running', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  const release = await core.holdJob('writing');
  await renameTo(page, 'Účty', 'Výdaje');
  await must(jobStatus(page, 'Updating #Účty in 6 notes'), 'Updating #Účty in 6 notes', 3000);
  await release();
});

test('fr_tag_04_ac9_after_the_rename', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  await renameTo(page, 'Účty', 'Výdaje');
  await must(tagHeading(page, 'Výdaje'), 'the route becomes tag/výdaje within 2 s', 2500);
  await page.keyboard.press('Meta+BracketLeft');
  await sleep(300);
  assert.equal(await tagHeading(page, 'Účty').count(), 0, 'replaced, not pushed: Back does not return to a dead tag/účty');
  // D-761: the sidebar lists no tags any more (one `Tags` entry), so the sidebar check is gone.
  await runCommand(page, 'Go to Tags');
  await must(tagRowEl(page, 'výdaje'), 'All tags lists Výdaje');
  assert.equal(await tagRowEl(page, 'účty').count(), 0, 'and no účty');
  assert.equal((await core.files())[P.odkaz], original(P.odkaz).replace('[[Účty]]', '[[Výdaje]]'), 'links to the Tag file follow it (D-714)');
});

// ------------------------------------------------------------------------------------------------ FR-TAG-08

test('fr_tag_08_ac1_delete_dialogs', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  await tagAction(page, 'Delete tag…');
  const d = await must(deleteDialog(page, 'Účty'), 'alertdialog Delete #Účty?');
  await must(d.getByText('#Účty is used by 6 objects.', { exact: true }), 'used by 6');
  const remove = await must(d.getByRole('button', { name: 'Remove from 6 objects', exact: true }), 'Remove from 6 objects');
  assert.equal(await description(remove), 'Removes the tag from every note. A backup is made first.', 'its description');
  const only = await must(d.getByRole('button', { name: 'Delete only the tag', exact: true }), 'Delete only the tag');
  assert.equal(await description(only), 'The tag stays in your notes, without colour.', 'its description');
  const cancel = await must(d.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel');
  assert.ok(await cancel.evaluate((e) => e === document.activeElement), 'Cancel is focused (default)');
  await page.keyboard.press('Escape');
  await runCommand(page, 'Delete tag…');
  await must(deleteDialog(page, 'Účty'), 'the palette opens it too');
  await deleteDialog(page, 'Účty').getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(await vaultWrites(core), [], 'Cancel and Esc write nothing');
  assert.deepEqual(await core.backups(), [], 'and make no zip');
  const p2 = await page.context().newPage();
  await openTagPage(p2, 'finance');
  await tagAction(p2, 'Delete tag…');
  const v = await must(deleteDialog(p2, 'finance'), 'Delete #finance?');
  await must(v.getByRole('button', { name: 'Remove from 2 objects', exact: true }), 'Remove from 2 objects');
  assert.equal(await v.getByRole('button', { name: 'Delete only the tag', exact: true }).count(), 0, 'virtual: no Delete only the tag');
  await p2.close();
});

test('fr_tag_08_ac3_delete_only_the_tag', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  await tagAction(page, 'Delete tag…');
  await click(deleteDialog(page, 'Účty').getByRole('button', { name: 'Delete only the tag', exact: true }), 'Delete only the tag');
  assert.deepEqual(await eventually(() => core.moves(), (m) => m.length > 0, 2000), [{ kind: 'trash', from: P.fUcty, to: `.trash/${P.fUcty}` }], 'one trash move');
  assert.deepEqual(await core.backups(), [], 'no zip');
  await must(page.getByRole('status').filter({ hasText: 'Moved "Účty" to the trash' }).getByRole('button', { name: 'Undo', exact: true }), 'the D-620 toast with Undo (D-732; trash.moved, AP-681, D-743)');
  await must(tagHeading(page, 'účty'), 'the tag stays, virtual: display name účty within 2 s', 2500);
  assert.equal(await main(page).getByRole('button', { name: 'Tag colour', exact: true }).getAttribute('data-color'), 'none', 'colour None');
  await page.getByRole('status').getByRole('button', { name: 'Undo', exact: true }).click();
  await must(tagHeading(page, 'Účty'), 'Undo (trash_restore) brings back the file');
  assert.equal(await main(page).getByRole('button', { name: 'Tag colour', exact: true }).getAttribute('data-color'), 'blue', 'and the blue colour');
});

test('fr_tag_08_ac5_removal_status_and_cancel', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  await core.skipOnWrite(P.banka, 'missing');
  await tagAction(page, 'Delete tag…');
  await click(deleteDialog(page, 'Účty').getByRole('button', { name: 'Remove from 6 objects', exact: true }), 'Remove from 6 objects');
  await must(jobStatus(page, /^Removed #Účty from \d+ notes/), 'Removed #Účty from … notes', 5000);
  const jobs = await jobsWhen(core, 1);
  assert.equal(jobs[0]?.kind, 'tag-delete', 'kind tag-delete');
  await must(page.getByRole('button', { name: /^1 note not updated$/ }).or(page.getByRole('link', { name: /^1 note not updated$/ })), 'the not-updated entry');
  await must(page.getByRole('heading', { level: 1, name: /^⟦?Tags⟧?$/ }), 'the app goes to tags (AP-659)');
  const p2 = await page.context().newPage();
  const c2 = await openTagPage(p2, 'finance');
  const release = await c2.holdJob('planning');
  const before = await snapshot(c2);
  await tagAction(p2, 'Delete tag…');
  await click(deleteDialog(p2, 'finance').getByRole('button', { name: 'Remove from 2 objects', exact: true }), 'Remove');
  await click(p2.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel before writing');
  await release();
  assert.equal((await jobsWhen(c2, 1, 2000))[0]?.phase, 'cancelled', 'cancelled');
  assert.deepEqual(await snapshot(c2), before, 'byte-identical');
  await p2.close();
});

test('fr_tag_04_ac8_an_open_note_is_rewritten_through_its_editor', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  const release = await core.holdJob('writing');
  await renameTo(page, 'Účty', 'Výdaje');
  await must(jobStatus(page, 'Updating #Účty in 6 notes'), 'the job runs, non-modal', 3000);
  await goToQuery(page, 'Rozpočet');
  await sleep(200);
  await page.keyboard.press('Enter');
  const body = page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
  await must(body, 'the user opens Rozpočet and keeps typing');
  await body.click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type(' Moje úprava.');
  await release();
  const t = await fileWhen(core, P.rozpocet, (x) => !!x?.includes('Výdaje') && !!x?.includes('Moje úprava.'), 5000);
  assert.ok(t?.includes('tags: [Výdaje, finance]') && t?.includes('Moje úprava.'), `the open note is rewritten through its editor and keeps the user's edit (D-386): ${t}`);
  void flat;
  void startTags;
});
