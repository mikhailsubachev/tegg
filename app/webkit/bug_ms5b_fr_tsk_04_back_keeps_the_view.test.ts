// 5B preview feedback F3 (docs/feedback/ms5-5b.md): Back (`<`, ⌘[) returns to the Tasks view the user left, with its
// grouping and filters (tasks.md FR-TSK-04 AC-9, AC-15; D-481). Not reproduced in WebKit: these pass on the 5B build and
// guard the behaviour until the owner's steps are known.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { attr, card, click, filterBtn, gotoKanban, groupBy, heading, main, must, mustBeOn, pressed, sleep, startTasks, viewTab } from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const selected = async (page: Parameters<typeof viewTab>[0], name: 'Schedule' | 'Kanban' | 'All tasks') => attr(viewTab(page, name), 'aria-selected');

test('bug_ms5b_fr_tsk_04_back_keeps_the_kanban', async ({ page }) => {
  await startTasks(page);
  await gotoKanban(page, 'Tag');
  await click(filterBtn(page, 'This week'), 'button This week');
  await (await must(card(page, 'Zalít květiny').first().getByRole('link', { name: 'Zalít květiny', exact: true }), 'title link')).click();
  await mustBeOn(page, 'Zalít květiny', 'the card opens its note', 5000);
  await (await must(page.getByRole('button', { name: 'Back', exact: true }), 'button Back')).click();
  await must(heading(page), 'Back to the Tasks page', 5000);
  await sleep(200);
  assert.equal(await selected(page, 'Kanban'), 'true', 'Back returns to the Kanban');
  assert.equal(await attr(groupBy(page).getByRole('tab', { name: 'Tag', exact: true }), 'aria-selected'), 'true', 'grouped by tag');
  assert.equal(await pressed(filterBtn(page, 'This week')), 'true', 'filter kept');
});

test('bug_ms5b_fr_tsk_04_back_keeps_all_tasks', async ({ page }) => {
  await startTasks(page);
  await gotoKanban(page, 'Status');
  await (await must(viewTab(page, 'All tasks'), 'tab All tasks')).click();
  await sleep(200);
  await (await must(main(page).locator('tr.type-row').filter({ hasText: 'Zalít květiny' }).first(), 'row Zalít květiny')).click();
  await mustBeOn(page, 'Zalít květiny', 'the row opens its note', 5000);
  await page.keyboard.press('Meta+BracketLeft');
  await must(heading(page), 'Back to the Tasks page', 5000);
  await sleep(200);
  assert.equal(await selected(page, 'All tasks'), 'true', 'Back returns to All tasks');
  await page.keyboard.press('Meta+BracketLeft');
  await sleep(300);
  assert.equal(await selected(page, 'Kanban'), 'true', 'Back again returns to the Kanban');
});

