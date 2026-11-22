// 5B preview feedback F3 (docs/feedback/ms5-5b.md): Back (`<`, ⌘[) returns to the Tasks view the user left, with its
// grouping and filters (tasks.md FR-TSK-04 AC-9, AC-15; D-481). Not reproduced in WebKit: these pass on the 5B build and
// guard the behaviour until the owner's steps are known.
//
// Slice Q2-T (AC-Test-Change, D-1912; views.md part three, row FR-TSK-04 AC-9, AC-15…AC-17): one route `type/task`; tabs
// add no history entry (D-1790); the remembered tab (D-1765) keeps "Back returns to the same view"; the Kanban by tag is
// the view `Podle štítků` (AP-1542) and the kept filter is its tag selection (no date filter, D-1779).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { addTag, attr, card, gotoKanban, heading, main, mainName, must, mustBeOn, sleep, startTasksPage as startTasks, tagChips, ui as tasksUi, viewTab, eventually } from './tasks-helpers';
import { setPreviewMode } from '../ui/test/fake-core';

// D-949: these steps open with a single click, so they run under preview.mode = off (click to preview is the default).
const OFF = () => setPreviewMode('off', { uiState: tasksUi() });

test.use({ timezoneId: 'Europe/Prague' });

const selected = async (page: Parameters<typeof viewTab>[0], name: 'Schedule' | 'Kanban' | 'All Tasks' | 'Podle štítků') => attr(viewTab(page, name), 'aria-selected');

test('bug_ms5b_fr_tsk_04_back_keeps_the_kanban', async ({ page }) => {
  await startTasks(page, OFF());
  await gotoKanban(page, 'Tag');
  await addTag(page, 'doma');
  await page.keyboard.press('Escape');
  await (await must(card(page, 'Zalít květiny').first().getByRole('link', { name: 'Zalít květiny', exact: true }), 'title link')).click();
  await mustBeOn(page, 'Zalít květiny', 'the card opens its note', 5000);
  await (await must(page.getByRole('button', { name: 'Back', exact: true }), 'button Back')).click();
  await must(heading(page), 'Back to the Tasks page', 5000);
  await sleep(200);
  assert.equal(await selected(page, 'Podle štítků'), 'true', 'Back returns to the board by tag');
  assert.deepEqual(await tagChips(page), ['doma'], 'its tag selection kept');
});

test('bug_ms5b_fr_tsk_04_back_keeps_all_tasks', async ({ page }) => {
  await startTasks(page, OFF());
  await gotoKanban(page, 'Status');
  await (await must(viewTab(page, 'All Tasks'), 'tab All Tasks')).click();
  await sleep(200);
  await (await must(main(page).locator('tr.type-row').filter({ hasText: 'Zalít květiny' }).first(), 'row Zalít květiny')).click();
  await mustBeOn(page, 'Zalít květiny', 'the row opens its note', 5000);
  await page.keyboard.press('Meta+BracketLeft');
  await must(heading(page), 'Back to the Tasks page', 5000);
  await sleep(200);
  assert.equal(await selected(page, 'All Tasks'), 'true', 'Back returns to All Tasks');
  await page.keyboard.press('Meta+BracketLeft');
  assert.notEqual(await eventually(() => mainName(page), (n) => n !== 'Tasks', 3000), 'Tasks', 'Back again leaves the Tasks page: tabs add no history entry (D-1790)');
});
