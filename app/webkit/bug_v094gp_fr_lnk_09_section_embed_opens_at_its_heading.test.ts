// v0.94 red tests (AP-1018 b = D-1189 b): opening Vložení's section embed `![[Rozpočet 2027#Rozsah]]` by its own
// `Open Rozpočet 2027` button showed the note scrolled about 293 px away from the heading. The open must land with
// `Rozsah` 24 px below the toolbar (± 8 px, D-1625, D-1673), as FR-EMB-02 AC-9 and FR-LNK-09 AC-10 say. The bug was there before
// the v0.94 build: with Object preview Off a click on the section embed's header title opens it too (D-423), and so does
// the button in every mode (R130); the test stores each mode in turn (D-1164's test rule).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { PV, ZONE, back, editorBody, eventually, main, mark, mustBeOn, navsSince, need, nfc, startPreviews, topBelowToolbar, topEmbed } from './previews-helpers';

test.use({ timezoneId: ZONE });

for (const mode of ['off', 'click'] as const) {
  test(`bug_v094gp_fr_lnk_09_section_embed_opens_at_its_heading_${mode}`, async ({ page }) => {
    const core = await startPreviews(page, { at: PV.vlozeni, mode });
    const ways = mode === 'off' ? ['the header title', 'the button'] : ['the button'];
    for (const way of ways) {
      const sec = await need(topEmbed(editorBody(page), 3), `${way}: the section embed ![[Rozpočet 2027#Rozsah]]`);
      await sec.scrollIntoViewIfNeeded();
      const n0 = await mark(core);
      const el = way === 'the button' ? sec.getByRole('button', { name: 'Open Rozpočet 2027', exact: true }) : sec.locator(':scope > *').first().getByText(/Rozpočet 2027/);
      await (await need(el, `${way} of the section embed`)).click();
      await mustBeOn(page, 'Rozpočet 2027', `${mode}, ${way}: opens the note`, 5000);
      assert.deepEqual(await navsSince(core, n0), [nfc(PV.rozpocet)], `${mode}, ${way}: one nav_opened`);
      const hd = await need(main(page).locator('h2, h3, h4').filter({ hasText: /^\s*Rozsah\s*$/ }), `${way}: the heading Rozsah`);
      const top = await eventually(() => topBelowToolbar(hd), (t) => t !== null && Math.abs(t - 24) <= 8, 2500);
      assert.ok(top !== null && Math.abs(top - 24) <= 8, `${mode}, ${way}: note/Pages/Rozpočet 2027.md#Rozsah with Rozsah 24 px below the toolbar (± 8 px, D-1625, D-1673), got ${top}`);
      await back(page, 'Vložení', `${way}: Back`);
    }
  });
}
