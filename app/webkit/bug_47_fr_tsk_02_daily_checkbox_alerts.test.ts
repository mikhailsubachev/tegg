// PR #47 QA review, major 2 (FR-TSK-02 AC-10…AC-12, NFR-REL-02): the Daily Note's Tasks due checkbox ignored a refused
// or failed write: no alert, no Try again. It now tells the user, as the Tasks page does.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { T, click, fileText, fileWhen, original, seen, startTasks, swap } from './tasks-helpers';
import { cmdD, section } from './daily-helpers';

test.use({ timezoneId: 'Europe/Prague' });
const alertWith = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });

test('bug_47_fr_tsk_02_daily_checkbox_conflict_is_shown_and_never_overwrites', async ({ page }) => {
  const core = await startTasks(page);
  await cmdD(page, '2026-10-14');
  const ext = swap(original(T.t03), 'priority: Low', 'priority: High');
  await core.setFile(T.t03, ext, { silent: true });
  await click(section(page, 'Tasks due').getByRole('checkbox', { name: 'Complete "Zalít květiny"', exact: true }), 'check T03');
  assert.ok(await seen(alertWith(page, '"Zalít květiny" changed outside Tegg. Your change wasn\'t saved.'), 2000), 'the conflict alert');
  assert.equal(await fileText(core, T.t03), ext, 'the external bytes stay');
});

test('bug_47_fr_tsk_02_daily_checkbox_failure_offers_try_again', async ({ page }) => {
  const core = await startTasks(page);
  await cmdD(page, '2026-10-14');
  await core.writeControl({ fail: 'Io', path: T.t03 });
  await click(section(page, 'Tasks due').getByRole('checkbox', { name: 'Complete "Zalít květiny"', exact: true }), 'check T03');
  const alert = alertWith(page, 'Couldn’t save "Zalít květiny". Try again.');
  assert.ok(await seen(alert, 2000), 'the save alert');
  await core.writeControl({ fail: null, path: null });
  await click(alert.getByRole('button', { name: 'Try again', exact: true }), 'Try again');
  assert.ok((await fileWhen(core, T.t03, (x) => !!x?.includes('status: Done'), 3000))?.includes('status: Done'), 'Try again writes it');
});
