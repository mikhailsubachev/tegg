// QA review of v0.94 (AP-1030 = D-1235): reaching the Kanban when `tasks.view = kanban` is already stored rewrote the
// same `ui_state` (one `ui_state_set` with nothing changed). Under FR-SYN-06 a stored view reached again writes
// nothing. Click mode stored (D-1164's test rule).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { main, need, sleep, startPreviews, ui } from './previews-helpers';

test('bug_v094gp_fr_syn_06_tasks_view_unchanged_writes_nothing', async ({ page }) => {
  const tasks = { view: 'kanban', groupBy: 'status', dateFilter: 'all', tags: [], doneExpanded: false };
  const core = await startPreviews(page, { route: 'tasks/kanban', uiState: { ...ui({ preview: { mode: 'click' } }), tasks } as ReturnType<typeof ui> });
  await need(main(page).locator('[data-column]').first(), 'the Kanban board', 8000);
  await sleep(1500);
  const sets = (await core.calls()).filter((c) => c.cmd === 'ui_state_set');
  assert.deepEqual(sets.map((c) => (c.args as any)?.state?.tasks ?? null), [], 'reaching the stored Kanban view sends no ui_state_set');
});
