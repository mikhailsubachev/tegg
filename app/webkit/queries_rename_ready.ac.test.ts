// Slice Q, L5 (WebKit + fake core): docs/acceptance/queries.md FR-QRY-06 AC-22 (D-1510): until the index has finished its
// first scan, `query_rename` is refused with `IndexNotReady`; the rename dialog shows `Queries can be renamed once the
// vault has finished loading.`, keeps the typed name, and nothing is written (no job, no backup). After the scan ends
// (`queriesNotReady(false)`, which emits `index:progress` done) the same rename runs as AC-6. Interface
// docs/contracts/v1-queries.md §2, §2.1, §5 (`queriesNotReady`, `queryCalls`, `writesTo`, `jobs`, `backups`) and §11.
// Written from the AC and the contract only (D-61). Lookups go through `must` (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, Q, click, eventually, expectedFile, menuItem, must, qfile, renameDialog, rowMenu, seen, startQueries,
} from './queries-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const NEW_NAME = 'Otevřené úkoly porady';
const NOT_READY = 'Queries can be renamed once the vault has finished loading.';

test('fr_qry_06_ac22_no_rename_while_the_index_loads', async ({ page }) => {
  const core = await startQueries(page, { route: 'queries' });
  await core.queriesNotReady(true);
  const before = await core.files();
  const writesBefore = (await core.writesTo()).length;
  const backupsBefore = (await core.backups()).length;

  const menu = await rowMenu(page, Q.open);
  await click(menuItem(menu, 'Rename…'), 'Rename…');
  const dlg = await must(renameDialog(page), 'dialog `Rename query`');
  const field = dlg.getByRole('textbox');
  await field.fill(NEW_NAME);
  const submit = dlg.getByRole('button', { name: /^⟦?(Rename|Create)⟧?$/ }).first();
  await click(submit, '`Rename`');

  assert.ok(await seen(dlg.getByText(NOT_READY), 2000), `the dialog shows ${JSON.stringify(NOT_READY)}`);
  assert.ok(await seen(renameDialog(page), 500), 'the dialog stays open');
  assert.equal((await field.inputValue().catch(() => '')).normalize('NFC'), NEW_NAME, 'the typed name is kept');
  const renames = (await core.queryCalls()).filter((c) => c.cmd === 'query_rename');
  assert.equal(renames.length, 1, 'the rename was asked of the core once');
  assert.equal(renames[0]?.ok, false, 'and refused (IndexNotReady)');
  assert.equal((await core.jobs()).length, 0, 'no job ran');
  assert.equal((await core.writesTo()).length - writesBefore, 0, 'zero writes');
  assert.equal((await core.backups()).length - backupsBefore, 0, 'no backup');
  const still = await core.files();
  assert.deepEqual(Object.keys(still).filter((p) => still[p] !== before[p]).sort(), [], 'every vault file unchanged');

  // The first scan ends: the same rename now runs as AC-6.
  await core.queriesNotReady(false);
  await click(submit, '`Rename` again');
  const jobs = await eventually(() => core.jobs(), (j) => j.length === 1 && j[0].phase === 'done', 5000);
  assert.equal(jobs[0]?.kind, 'query-rename', 'one `query-rename` job, done');
  const after = await core.files();
  assert.equal(after[qfile(Q.open)], undefined, 'the old file is gone');
  assert.equal(after[qfile(NEW_NAME)], expectedFile('renamed-otevrene-ukoly-porady.yml'), 'renamed, only `title:` patched');
  for (const p of [P.porada7, P.porada14, P.sablona]) {
    assert.equal(after[p], before[p].replace(`saved: ${Q.open}`, `saved: ${NEW_NAME}`), `${p}: only its \`saved:\` line`);
  }
  assert.ok((await core.backups()).some((b) => b.kind === 'query-rename'), 'the job made its backup (FR-HIS-04)');
});
