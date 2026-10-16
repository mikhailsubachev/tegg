// QA review of MS4 slice 4A (PR #35): the Create offer is non-modal, so the note can change while it is open; Create
// must still rewrite the clicked link (FR-LNK-04 AC-7, D-287; docs/contracts/ms4-links.md §5.3).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { B, chips, createOffer, editorBody, eventually, fileText, linksVault, must, mustBeOn, openLinks, seen, sleep, writeCalls } from './links-helpers';

const REWRITE = 'The file will be named "Q3 plán" and this link changed to point to it.';
const FAILED = 'The link couldn’t be changed to point to "Q3 plán". Edit it, then try again.';
/** Rozbité odkazy with `first` as the first body line. */
const withFirst = (first: string) => linksVault((f) => { f[B.rozbite] = f[B.rozbite].replace('---\n[[Neexistuje]]', `---\n${first}\n\n[[Neexistuje]]`); });

test.use({ timezoneId: 'Europe/Prague' });

test('bug_36_fr_lnk_04_create_rewrites_the_link_after_typing_before_it', async ({ page }) => {
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

test('bug_36_fr_lnk_04_create_rewrites_the_clicked_link_after_an_earlier_same_target_link_is_deleted', async ({ page }) => {
  const core = await openLinks(page, B.rozbite, { vault: withFirst('[[Q3: plán?]] první') });
  const body = editorBody(page);
  const q3 = chips(body, 'Q3: plán?').and(page.locator('[data-link-kind="unresolved"]'));
  await must(q3.nth(1), 'the second chip Q3: plán?', 5000);
  await q3.nth(1).click();
  const offer = await must(createOffer(page), 'dialog "Create note"');
  await must(offer.getByText(REWRITE, { exact: true }), 'the rewrite note', 2000);
  await body.focus();
  await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.press('Delete'); // the first Q3 chip
  await (await must(offer.getByRole('button', { name: 'Create "Q3: plán?"', exact: true }), 'button Create')).click();
  assert.ok((await eventually(() => core.writesTo(), (w) => w.includes('Quick Notes/Q3 plán.md'))).includes('Quick Notes/Q3 plán.md'), 'Quick Notes/Q3 plán.md');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Rozbité odkazy', 'Back to the source', 5000);
  const t = (await eventually(() => fileText(core, B.rozbite), (x) => (x ?? '').includes('[[Q3 plán|Q3: plán?]]'), 4000)) ?? '';
  assert.ok(t.includes('\n[[Q3 plán|Q3: plán?]]\n'), 'the clicked link (its own line) is rewritten');
  assert.ok(!t.includes('první [['), 'the deleted link stays deleted');
});

test('bug_36_fr_lnk_04_create_reports_a_clicked_link_that_was_deleted', async ({ page }) => {
  const v = withFirst('[[Q3: plán?]] první');
  v.files[B.rozbite] = v.files[B.rozbite].replace('\n[[Q3: plán?]]\n', '\n');
  const core = await openLinks(page, B.rozbite, { vault: v });
  const body = editorBody(page);
  await (await must(chips(body, 'Q3: plán?').and(page.locator('[data-link-kind="unresolved"]')), 'chip Q3: plán?', 5000)).click();
  const offer = await must(createOffer(page), 'dialog "Create note"');
  await must(offer.getByText(REWRITE, { exact: true }), 'the rewrite note', 2000);
  await body.focus();
  await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.press('Delete'); // the clicked chip
  await (await must(offer.getByRole('button', { name: 'Create "Q3: plán?"', exact: true }), 'button Create')).click();
  assert.ok(await seen(offer.getByRole('alert').filter({ hasText: FAILED }), 2000), 'the offer says the link could not be changed');
  await sleep(300);
  assert.deepEqual((await writeCalls(core)).filter((c) => JSON.stringify(c).includes('link_create')), [], 'no note is created');
});
