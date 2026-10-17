// Regression for the PR #40 QA review (FR-TYP-07 AC-12): `Change type…` from the palette opens the menu after the
// palette has given the focus back; Esc must leave the focus on a control of the note, never on <body>.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { P, changeTypeMenu, eventually, openTypes, runCommand } from './types-helpers';

test('bug_40_fr_typ_07_palette_change_type_esc_keeps_the_focus_in_the_note', async ({ page }) => {
  await openTypes(page, P.obycejna);
  // The palette was opened with nothing focused (after a click on empty space), so it gives the focus back to <body>.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await runCommand(page, 'Change type…');
  assert.ok(await eventually(() => changeTypeMenu(page).count(), (n) => n === 1, 2000) === 1, 'the menu opens');
  await page.keyboard.press('Escape');
  await eventually(() => changeTypeMenu(page).count(), (n) => n === 0, 1000);
  const where = await page.evaluate(() => {
    const a = document.activeElement;
    return !a || a === document.body ? 'body' : a.getAttribute('aria-label') ?? a.tagName;
  });
  assert.ok(where === 'More' || /Note body/.test(where), `the focus is on the note body or More, not ${where}`);
});
