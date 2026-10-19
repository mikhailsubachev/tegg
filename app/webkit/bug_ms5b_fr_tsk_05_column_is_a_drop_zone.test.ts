// 5B preview feedback F5 (docs/feedback/ms5-5b.md): a Kanban column is a drop target over its whole height, also
// below its last card (tasks.md R42, FR-TSK-05 AC-2).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { T, column, eventually, gotoKanban, main, must, original, sleep, startTasks, swap, touched, writesOf } from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('bug_ms5b_fr_tsk_05_drop_below_the_last_card', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  const board = await must(main(page).locator('[data-column]').first().locator('xpath=..'), 'the board');
  const boardBox = (await board.boundingBox())!;
  const target = (await (await must(column(page, 'In progress'), 'column In progress')).boundingBox())!;
  const from = await must(column(page, 'To do').getByRole('article', { name: 'Task: Zalít květiny', exact: true }), 'T03 in To do');
  const a = (await from.boundingBox())!;
  // Low in the window, under In progress's few cards: inside the column's lane, below its last card.
  const cards = column(page, 'In progress').getByRole('article');
  const last = (await cards.nth((await cards.count()) - 1).boundingBox())!;
  const y = Math.min(boardBox.y + boardBox.height, page.viewportSize()!.height) - 30;
  assert.ok(y > last.y + last.height + 20, `the drop point (${y}) is below the column's last card (${last.y + last.height})`);
  await page.mouse.move(a.x + a.width / 2, a.y + 15);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + 40, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, y, { steps: 12 });
  await page.mouse.up();
  await sleep(150);
  const w = await eventually(() => writesOf(core, T.t03), (x) => x.length >= 1, 2000);
  assert.equal(w.length, 1, 'dropping below the last card of In progress writes T03 once');
  assert.equal(String((w[0].args as any).text), touched(swap(original(T.t03), 'status: To do', 'status: In progress')), 'status set to In progress');
});
