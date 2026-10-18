// PR #47 QA review, major 1 (FR-TSK-01 AC-4, D-472): setting Status in the properties panel of a task wrote only
// `status`, so Done had no `completed` and leaving Done kept a stale one. The panel follows the task rules too.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { NOW, T, click, fileWhen, mustBeOn, original, startTasks, swap, touched } from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const props = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Properties', exact: true });

test('bug_47_fr_tsk_01_panel_status_done_sets_completed_and_back_removes_it', async ({ page }) => {
  const core = await startTasks(page, { at: T.t03 });
  await mustBeOn(page, 'Zalít květiny', 'T03', 5000);
  await click(props(page).getByRole('combobox', { name: 'Status', exact: true }), 'Status');
  await click(page.getByRole('option', { name: 'Done', exact: true }), 'Done');
  const done = swap(swap(original(T.t03), 'status: To do', 'status: Done'), 'modified: 2026-10-01T09:00:00+02:00\n', `modified: ${NOW}\ncompleted: ${NOW}\n`);
  assert.equal(await fileWhen(core, T.t03, (x) => !!x?.includes('status: Done'), 3000), done, 'Done sets completed (D-472)');
  await click(props(page).getByRole('combobox', { name: 'Status', exact: true }), 'Status again');
  await click(page.getByRole('option', { name: 'To do', exact: true }), 'To do');
  assert.equal(await fileWhen(core, T.t03, (x) => !!x?.includes('status: To do'), 3000), touched(original(T.t03)), 'leaving Done removes completed');
});
