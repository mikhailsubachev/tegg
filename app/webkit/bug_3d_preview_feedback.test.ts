// Owner feedback on the 3D build (2026-10-14, docs/feedback/ms3-3d.md F3, F5–F7, F12).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { P, gotoSettings, main, must, openNoteByTitle, openTypes, props, seen, settingsHeading, sleep } from './types-helpers';

const badge = (page: Page) => main(page).locator('.ts-header .type-badge');
const badgeIcon = (page: Page) => badge(page).locator('svg').getAttribute('data-icon');
const general = (page: Page) => main(page).getByRole('region', { name: 'General', exact: true });

test('bug_3d_fr_typ_01_icon_picker_shows_pictures', async ({ page }) => {
  await openTypes(page);
  await gotoSettings(page, 'Schůzky', 'Schůzka');
  await (await must(general(page).getByRole('button', { name: 'Change icon', exact: true }), 'Change icon')).click();
  const options = page.getByRole('listbox', { name: 'Icon' }).getByRole('option');
  assert.equal(await options.count(), 24);
  for (let i = 0; i < 24; i++) assert.equal(await options.nth(i).locator('svg[data-icon]').count(), 1, `option ${i} shows its icon`);
});

test('bug_3d_fr_typ_06_system_type_icon_and_colour_change_shows', async ({ page }) => {
  await openTypes(page);
  await gotoSettings(page, 'Pages', 'Page');
  await (await must(general(page).getByRole('button', { name: 'Change icon', exact: true }), 'Change icon')).click();
  await (await must(page.getByRole('listbox', { name: 'Icon' }).getByRole('option').nth(17), 'briefcase')).click();
  await sleep(500);
  assert.equal(await badgeIcon(page), 'briefcase', 'the header shows the new icon');
  assert.equal(await general(page).getByRole('button', { name: 'Change icon' }).locator('svg').getAttribute('data-icon'), 'briefcase');
  await (await must(general(page).getByRole('radio', { name: 'Orange', exact: true }), 'Orange')).click();
  await sleep(500);
  assert.match((await badge(page).getAttribute('style')) ?? '', /--type-orange/, 'the header shows the new colour');
});

test('bug_3d_fr_typ_01_custom_type_icon_and_colour_change_shows', async ({ page }) => {
  await openTypes(page);
  await gotoSettings(page, 'Schůzky', 'Schůzka');
  await (await must(general(page).getByRole('radio', { name: 'Orange', exact: true }), 'Orange')).click();
  await sleep(500);
  assert.match((await badge(page).getAttribute('style')) ?? '', /--type-orange/);
  await (await must(general(page).getByRole('button', { name: 'Change icon', exact: true }), 'Change icon')).click();
  await (await must(page.getByRole('listbox', { name: 'Icon' }).getByRole('option').nth(17), 'briefcase')).click();
  await sleep(500);
  assert.equal(await badgeIcon(page), 'briefcase');
});

test('bug_3d_fr_edt_07_custom_type_object_properties_are_editable', async ({ page }) => {
  await openTypes(page);
  await openNoteByTitle(page, 'Prázdná schůzka');
  const region = await must(props(page), 'Properties');
  const editable = region.locator('input:not([disabled]), button:not([disabled]):not([aria-disabled="true"]), [contenteditable="true"], [role="textbox"], [role="combobox"]');
  assert.ok(await seen(editable.first(), 2000), 'at least one editable property control');
  void settingsHeading; void P;
});

test('bug_3d_fr_src_01_search_opens_with_the_field_focused', async ({ page }) => {
  await openTypes(page);
  await page.keyboard.press('Meta+Shift+f');
  await must(page.getByRole('heading', { level: 1, name: 'Search', exact: true }), 'Search page', 5000);
  await sleep(300);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Search query', 'the search field has the focus');
  await page.keyboard.type('Porada');
  assert.equal(await page.getByRole('searchbox', { name: 'Search query' }).inputValue(), 'Porada');
});
