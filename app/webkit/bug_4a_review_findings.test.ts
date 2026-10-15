// QA review of MS4 slice 4A (PR #35): the Create offer is non-modal, so the note can change while it is open; Create
// must still rewrite the clicked link (FR-LNK-04 AC-7, D-287; docs/contracts/ms4-links.md §5.3).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { B, chips, createOffer, editorBody, eventually, fileText, must, mustBeOn, openLinks } from './links-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('bug_4a_fr_lnk_04_create_rewrites_the_link_after_typing_before_it', async ({ page }) => {
  const core = await openLinks(page, B.rozbite);
  const body = editorBody(page);
  await (await must(chips(body, 'Q3: plán?').and(page.locator('[data-link-kind="unresolved"]')), 'chip Q3: plán?', 5000)).click();
  const offer = await must(createOffer(page), 'dialog "Create note"');
  await must(offer.getByText('The file will be named "Q3 plán" and this link changed to point to it.', { exact: true }), 'the rewrite note', 2000);
  // The offer stays open while the user types at the start of the note (keyboard focus, no click outside).
  await body.focus();
  await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.type('Úvod. ');
  await (await must(offer.getByRole('button', { name: 'Create "Q3: plán?"', exact: true }), 'button Create')).click();
  assert.ok((await eventually(() => core.writesTo(), (w) => w.includes('Quick Notes/Q3 plán.md'))).includes('Quick Notes/Q3 plán.md'), 'Quick Notes/Q3 plán.md');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Rozbité odkazy', 'Back to the source', 5000);
  const t = (await eventually(() => fileText(core, B.rozbite), (x) => (x ?? '').includes('[[Q3 plán|Q3: plán?]]'), 4000)) ?? '';
  assert.ok(t.includes('[[Q3 plán|Q3: plán?]]'), 'the clicked link is rewritten');
  assert.ok(t.includes('Úvod. [[Neexistuje]]'), 'the typed text is kept');
});
