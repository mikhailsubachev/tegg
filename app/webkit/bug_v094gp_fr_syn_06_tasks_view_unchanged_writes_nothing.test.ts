// QA review of v0.94 (AP-1030 = D-1235): reaching the Kanban when `tasks.view = kanban` is already stored rewrote the
// same `ui_state` (one `ui_state_set` with nothing changed). Under FR-SYN-06 a stored view reached again writes
// nothing. Click mode stored (D-1164's test rule).
//
// Slice Q2-T (AC-Test-Change, D-1912; views.md part three, row FR-TSK-04 AC-13, FR-SYN-06 AC-20, AC-21): the stored view
// is `typeViews.lastTab.task` (R206); the alias `tasks/kanban` leads to `type/task` on `Kanban` (AP-1540).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { main, must, sleep, startTasksPage, ui } from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('bug_v094gp_fr_syn_06_tasks_view_unchanged_writes_nothing', async ({ page }) => {
  await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, 'tasks/kanban');
  const uiState = { ...ui(), preview: { mode: 'click' }, typeViews: { lastTab: { task: 'Kanban' } } } as ReturnType<typeof ui>;
  const core = await startTasksPage(page, { uiState });
  await must(main(page).locator('div[role="group"][data-board][data-board-name="Kanban"]'), 'the Kanban board', 8000);
  await sleep(1500);
  const sets = (await core.calls()).filter((c) => c.cmd === 'ui_state_set');
  assert.deepEqual(sets.map((c) => (c.args as any)?.state?.typeViews ?? null), [], 'reaching the stored Kanban tab sends no ui_state_set');
});
