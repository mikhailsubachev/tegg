// Issue #103: the Create offer focused `Create` only after `link_create_plan` answered. Until then the focus stayed
// in the editor, so Esc right after opening left the offer open (FR-LNK-04 AC-4: `Create` focused, Esc closes it).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { B, chips, createOffer, editorBody, must, openLinks, seen } from './links-helpers';

const PLAN_MS = 800;

test.use({ timezoneId: 'Europe/Prague' });

test('bug_103_fr_lnk_04_create_is_focused_when_the_offer_opens_and_esc_closes_it', async ({ page }) => {
  const core = await openLinks(page, B.rozbite);
  await core.delayCommand('link_create_plan', PLAN_MS);
  await (await must(chips(editorBody(page), 'Neexistuje').and(page.locator('[data-link-kind="unresolved"]')), 'chip Neexistuje', 5000)).click();
  const offer = await must(createOffer(page), 'dialog "Create note"');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-command') ?? document.activeElement?.tagName ?? null);
  assert.equal(focused, 'createLink.create', 'Create is focused as soon as the offer opens');
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(offer, 300)), 'Esc closes the offer before its plan arrives');
});
