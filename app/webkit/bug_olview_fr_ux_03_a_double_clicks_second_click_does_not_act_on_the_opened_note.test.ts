// Regression (D-1674; found by FR-SYN-06 AC-42 after D-1673 moved heading landings below the toolbar): a double-click
// whose first click opens a note (an embed's header title, D-1166) also delivered its second click to the note just
// opened, so a link that happened to be under the pointer opened as well. The second click of a multi-click that began
// before the route changed acts on nothing; the next single click works as usual.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { PV, ZONE, chipNamed, editorBody, mark, mustBeOn, navsSince, need, nfc, startPreviews, topEmbed } from './previews-helpers';

test.use({ timezoneId: ZONE });

test('bug_olview_fr_ux_03_a_double_clicks_second_click_does_not_act_on_the_opened_note', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.vlozeni, mode: 'off' });
  const sec = await need(topEmbed(editorBody(page), 3), 'the section embed ![[Rozpočet 2027#Rozsah]]');
  await sec.scrollIntoViewIfNeeded();
  const title = await need(sec.locator(':scope > *').first().getByText(/Rozpočet 2027/), 'the section embed\'s header title');
  const n0 = await mark(core);
  const b = (await title.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); // the first click of the double-click
  await mustBeOn(page, 'Rozpočet 2027', 'the first click opens Rozpočet 2027', 5000);
  // The second click of the same double-click lands on the Jana Nováková link in the opened note.
  const jana = await need(chipNamed(editorBody(page), 'Jana Nováková'), 'the Jana Nováková link in Rozpočet 2027');
  const jb = (await jana.boundingBox())!;
  await page.mouse.move(jb.x + 4, jb.y + jb.height / 2);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  await page.waitForTimeout(500);
  await mustBeOn(page, 'Rozpočet 2027', 'the second click opens nothing');
  assert.deepEqual(await navsSince(core, n0), [nfc(PV.rozpocet)], 'one nav_opened');
  // A new single click on the link opens it as usual.
  await page.mouse.click(jb.x + 4, jb.y + jb.height / 2);
  await mustBeOn(page, 'Jana Nováková', 'a single click afterwards opens the link', 5000);
});
