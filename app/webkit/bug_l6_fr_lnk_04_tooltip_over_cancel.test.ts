// Regression found by the L6 run of FR-LNK-04 AC-12 (D-382): with the pointer on the disabled type picker of the Create
// offer, its "Coming in MS5" tooltip lay over Cancel and swallowed the click, so the offer stayed open. A tooltip never
// takes pointer events (D-116 disabled controls).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { B, createOffer, editorBody, chips, must, openLinks } from './links-helpers';
import { absent } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('bug_l6_fr_lnk_04_cancel_works_while_the_type_picker_tooltip_shows', async ({ page }) => {
  await openLinks(page, B.rozbite);
  await (await must(chips(editorBody(page), 'Neexistuje').and(page.locator('[data-link-kind="unresolved"]')), 'chip', 5000)).click();
  const offer = await must(createOffer(page), 'dialog "Create note"');
  // 5B (FR-VLT-05 AC-3): the type picker is the enabled combobox `Type` now; Cancel still works with it focused.
  await (await must(offer.getByRole('combobox', { name: 'Type', exact: true }), 'type picker')).focus();
  const cancel = await must(offer.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel');
  const box = (await cancel.boundingBox())!;
  // A real pointer click at Cancel's centre (no actionability shortcut), as Appium does it.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  assert.ok(await absent(createOffer(page), 1000), 'Cancel closes the offer although the tooltip is shown');
});
