// MS4 slice 4D-lite L5 (WebKit, fake core): Settings › Backups (docs/acceptance/tags.md R85; D-396, D-651):
// FR-HIS-04 AC-7 (the list after a rename and a removal, newest first, labels, D-160 date-times **(TZ)**, Show in Finder,
// the open vault only, opening writes nothing), AC-8 (the Restore dialog, Cancel, Restore: the pre-restore zip, the
// files back, the status), AC-10 (restore is a job, cancellable before writing). Interface docs/contracts/ms4-tags.md
// §5 (manifest, `backups_list`, `backup_reveal`, `backup_restore`), §6.1 (`settings/backups`), §8.1 (zips in memory).
// Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  NOW, P, ZONES, backupRows, backupsHeading, backupsList, click, deleteDialog, eventually, jobStatus, jobsWhen, main, must, openTagPage, original,
  renameDialog, runCommand, snapshot, startTags, tagAction, tagHeading, vaultWrites, type BackupRecord,
} from './tags-helpers';

/** R85: the D-160 medium date and short time in the region locale and the machine's zone. */
const when = (iso: string, zone: string) => new Intl.DateTimeFormat('cs', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(iso)).replace(/[\s  ]+/g, ' ');

/** The two zips of FR-TAG-04 AC-4's rename and FR-TAG-08 AC-4's removal, as the fake would have made them. */
function seeded(): BackupRecord[] {
  const entries = Object.fromEntries(Object.entries((/* the fixture */ {} as Record<string, string>)));
  const z = (name: string, kind: string, time: string, label: BackupRecord['label']): BackupRecord =>
    ({ name, kind, time, label, files: 52, manifest: { version: 1, kind, label: label!, vault: 'Štítky', time, job: 1, planned: { renames: [], creates: [], trashes: [] }, done: null }, entries });
  return [
    z('20261022-070000-tag-rename.zip', 'tag-rename', '2026-10-22T09:00:00+02:00', { key: 'backups.label.tagRename', args: { from: 'Účty', to: 'Výdaje' } }),
    z('20261022-071500-tag-delete.zip', 'tag-delete', '2026-10-22T09:15:00+02:00', { key: 'backups.label.tagDelete', args: { tag: 'finance', count: 2 } }),
  ];
}
async function gotoBackups(page: Page) {
  await runCommand(page, 'Go to Settings: Backups');
  await must(backupsHeading(page), 'heading "Backups" (R85)', 3000);
}

for (const tz of ZONES) {
  test.describe(`(TZ ${tz})`, () => {
    test.use({ timezoneId: tz });
    test(`fr_his_04_ac7_the_list_newest_first (${tz})`, async ({ page }) => {
      const core = await startTags(page, { route: 'tags', backups: seeded() });
      await gotoBackups(page);
      await must(main(page).getByText('Tegg makes a backup before every change to many notes. The newest 10 are kept.', { exact: true }), 'the intro line');
      await must(backupsList(page), 'list "Backups"');
      const rows = await backupRows(page);
      assert.equal(rows.length, 2, `two rows: ${rows.join(' | ')}`);
      assert.ok(rows[0].includes('Remove #finance from 2 objects') && rows[0].includes(when('2026-10-22T09:15:00+02:00', tz)), `newest first with its D-160 date-time: ${rows[0]}`);
      assert.ok(rows[1].includes('Rename #Účty to #Výdaje') && rows[1].includes(when('2026-10-22T09:00:00+02:00', tz)), `then the rename: ${rows[1]}`);
      await must(main(page).getByRole('button', { name: 'Restore "Rename #Účty to #Výdaje"…', exact: true }), 'Restore "<label>"…');
      await click(main(page).getByRole('button', { name: 'Show in Finder', exact: true }).first(), 'Show in Finder');
      assert.equal((await eventually(() => core.reveals(), (r) => r.length > 0, 1000)).length, 1, 'backup_reveal');
      assert.deepEqual(await vaultWrites(core), [], 'opening the page writes nothing');
    });
  });
}

test('fr_his_04_ac7_jobs_list_their_zips_with_labels', async ({ page }) => {
  await openTagPage(page, 'účty');
  await tagAction(page, 'Rename tag…');
  const d = await must(renameDialog(page, 'Účty'), 'Rename #Účty');
  await d.getByRole('textbox', { name: 'New name', exact: true }).fill('Výdaje');
  await d.getByRole('button', { name: 'Rename', exact: true }).click();
  await must(tagHeading(page, 'Výdaje'), 'renamed');
  await runCommand(page, 'Go to Tags');
  await click(main(page).getByRole('table', { name: 'Tags', exact: true }).locator('[data-tag="finance"]'), 'finance');
  await tagAction(page, 'Delete tag…');
  await click(deleteDialog(page, 'finance').getByRole('button', { name: 'Remove from 2 objects', exact: true }), 'Remove from 2 objects');
  await gotoBackups(page);
  const rows = await eventually(() => backupRows(page), (r) => r.length === 2, 3000);
  assert.ok(rows[0]?.includes('Remove #finance from 2 objects') && rows[1]?.includes('Rename #Účty to #Výdaje'), `the two jobs' zips: ${rows.join(' | ')}`);
});

test('fr_his_04_ac8_restore_dialog_and_restore', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  await tagAction(page, 'Rename tag…');
  const d = await must(renameDialog(page, 'Účty'), 'Rename #Účty');
  await d.getByRole('textbox', { name: 'New name', exact: true }).fill('Výdaje');
  await d.getByRole('button', { name: 'Rename', exact: true }).click();
  await must(tagHeading(page, 'Výdaje'), 'renamed');
  await gotoBackups(page);
  await click(main(page).getByRole('button', { name: 'Restore "Rename #Účty to #Výdaje"…', exact: true }), 'Restore…');
  const dlg = await must(page.getByRole('alertdialog', { name: 'Restore this backup?', exact: true }), 'alertdialog Restore this backup?');
  await must(dlg.getByText('Notes saved in this backup get their saved text back. Tegg backs up the current state first.', { exact: true }), 'its text');
  const cancel = dlg.getByRole('button', { name: 'Cancel', exact: true });
  assert.ok(await cancel.evaluate((e) => e === document.activeElement), 'Cancel is the default');
  const before = await snapshot(core);
  await cancel.click();
  assert.deepEqual(await snapshot(core), before, 'Cancel writes nothing');
  await click(main(page).getByRole('button', { name: 'Restore "Rename #Účty to #Výdaje"…', exact: true }), 'Restore… again');
  await click(page.getByRole('alertdialog', { name: 'Restore this backup?', exact: true }).getByRole('button', { name: 'Restore', exact: true }), 'Restore');
  await must(jobStatus(page, /^Restored \d+ notes? from the backup$/), 'Restored <n> notes from the backup', 5000);
  const files = await core.files();
  assert.equal(files[P.fUcty], original(P.fUcty), 'Tags/Výdaje.md is Tags/Účty.md again (AP-601)');
  assert.equal(files['Tags/Výdaje.md'], undefined, 'no Tags/Výdaje.md');
  assert.equal(files[P.rozpocet], original(P.rozpocet), 'files get their zipped bytes');
  const rows = await eventually(() => backupRows(page), (r) => r.some((x) => x.includes('Before restoring')), 3000);
  assert.ok(rows[0]?.includes('Before restoring'), `the pre-restore zip is listed first: ${rows.join(' | ')}`);
  void NOW;
});

test('fr_his_04_ac10_restore_is_a_job_cancellable_before_writing', async ({ page }) => {
  const core = await startTags(page, { route: 'tags', backups: seeded() });
  await gotoBackups(page);
  const release = await core.holdJob('planning');
  const before = await snapshot(core);
  await click(main(page).getByRole('button', { name: 'Restore "Rename #Účty to #Výdaje"…', exact: true }), 'Restore…');
  await click(page.getByRole('alertdialog', { name: 'Restore this backup?', exact: true }).getByRole('button', { name: 'Restore', exact: true }), 'Restore');
  await click(page.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel in the status');
  await release();
  const jobs = await jobsWhen(core, 1, 3000);
  assert.deepEqual([jobs[0]?.kind, jobs[0]?.phase], ['restore', 'cancelled'], 'a restore job, cancelled');
  assert.deepEqual(await snapshot(core), before, 'byte-identical');
});
