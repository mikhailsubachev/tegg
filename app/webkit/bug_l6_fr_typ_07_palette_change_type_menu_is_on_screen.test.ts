// Regression for the real-app run of 2026-11-11 (fr_sto_04_ac4): with the caret in the note, `Change type…` from the
// palette opened its menu under the editor's bottom edge, outside the window, because the menu was placed at the
// element that had the focus (the whole note body). The menu opens at the note header's More button, wherever the
// focus was; Esc still returns the focus to where it was (FR-TYP-07 AC-4, AC-12).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { P, changeTypeMenu, eventually, openTypes, runCommand } from './types-helpers';

test('bug_l6_fr_typ_07_palette_change_type_menu_opens_at_more_inside_the_window', async ({ page }) => {
  await openTypes(page, P.obycejna);
  await page.locator('[aria-label="Note body"]').first().click();
  await runCommand(page, 'Change type…');
  assert.ok(await eventually(() => changeTypeMenu(page).count(), (n) => n === 1, 2000) === 1, 'the menu opens');
  const box = await changeTypeMenu(page).boundingBox();
  const more = await page.locator('button[data-command="note.more"]').boundingBox();
  const view = page.viewportSize()!;
  assert.ok(box && more, 'the menu and More have boxes');
  assert.ok(box!.y >= 0 && box!.y + box!.height <= view.height, `the menu is inside the window (y ${box!.y}, height ${box!.height}, window ${view.height})`);
  assert.ok(Math.abs(box!.y - (more!.y + more!.height + 4)) <= 1 && Math.abs(box!.x - more!.x) <= 1, `the menu is under More (menu ${box!.x},${box!.y}; More ${more!.x},${more!.y + more!.height})`);
});
