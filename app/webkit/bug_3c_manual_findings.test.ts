// Owner's manual test of the 3C preview (2026-10-13): link chips and tags in the editor look like the read view's
// (type icon, highlight; FR-EDT-02 AC-16), a checked box shows a checkmark (FR-EDT-02 AC-18), search results are left
// aligned with the field (FR-SRC-01), and the mouse's back button works through the shell's native event (FR-NAV-03).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { E, editorBody, must, openEditor, sleep } from './editor-helpers';
import { mustBeOn, openNote } from './helpers';

test('bug_3c_fr_edt_02_editor_link_chip_has_type_icon_and_highlight', async ({ page }) => {
  await openEditor(page, E.deset);
  const chip = await must(editorBody(page).getByRole('link', { name: 'Cíl' }), 'chip Cíl');
  await sleep(300);
  assert.equal(await chip.locator('svg[data-icon]').count(), 1, 'the type icon');
  const bg = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.notEqual(bg, 'rgba(0, 0, 0, 0)', 'highlighted like the read view chip');
});

test('bug_3c_fr_edt_02_editor_tag_is_highlighted', async ({ page }) => {
  await openEditor(page, E.deset);
  const tag = await must(editorBody(page).getByRole('link', { name: '#projekt' }), 'tag #projekt');
  const bg = await tag.evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.notEqual(bg, 'rgba(0, 0, 0, 0)', 'tag highlight as in the properties');
});

test('bug_3c_fr_edt_02_checked_box_shows_a_checkmark', async ({ page }) => {
  await openEditor(page, E.ukoly);
  const box = editorBody(page).getByRole('checkbox', { checked: true }).first();
  await must(box, 'a checked box');
  const mark = await box.evaluate((el) => getComputedStyle(el, '::after').content);
  assert.ok(mark !== 'none' && mark !== '', 'a checkmark is drawn');
});

test('bug_3c_fr_src_01_results_left_aligned_with_the_field', async ({ page }) => {
  await openEditor(page, E.deset);
  await page.keyboard.press('Meta+Shift+f');
  const input = page.getByRole('searchbox').or(page.getByRole('textbox', { name: 'Search query' })).first();
  await input.fill('blok');
  const row = await must(page.getByRole('list', { name: 'Search results' }).getByRole('link').first(), 'a result row');
  assert.equal(await row.evaluate((el) => el.tagName), 'A', 'a link row, not a button (WebKit centres button content)');
  const [ib, tb] = [await input.boundingBox(), await row.locator('.title').boundingBox()];
  assert.ok(Math.abs(ib!.x + 12 - tb!.x) <= 30, `title starts under the field's text (${ib!.x} / ${tb!.x})`);
});

test('bug_3c_fr_nav_03_native_mouse_back_button', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await openNote(page, 'Cíl');
  await core.emit('nav:mouse' as any, 'back');
  await mustBeOn(page, 'Search', 'native back button: the Search entry Cíl was opened from (D-1348)');
  await core.emit('nav:mouse' as any, 'back');
  await mustBeOn(page, 'Deset bloků', 'native back button');
});
