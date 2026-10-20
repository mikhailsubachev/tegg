// 5B preview feedback round 2, G3 (docs/feedback/ms5-5b2.md): a user type's icon (D-236, D-519) is shown in the
// capture window's type pill and menu and in the `[[` / `@` link suggestions, not the generic `type` glyph.
import { test, type Locator } from '@playwright/test';
import assert from 'node:assert/strict';
import { chooseType, must, startCapture, typeBtn, typeItem, typeMenu } from './capture-helpers';
import { B, openLinks } from './links-helpers';
import { editorBody } from './editor-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const icons = async (loc: Locator, what: string) =>
  (await must(loc, what)).evaluate((e) => [...e.querySelectorAll('svg[data-icon]')].map((s) => s.getAttribute('data-icon')));

test('bug_ms5b2_fr_typ_06_capture_type_menu_and_pill', async ({ page }) => {
  await startCapture(page);
  await (await must(typeBtn(page), 'button "Type: …"')).click();
  await must(typeMenu(page), 'menu "Type"');
  assert.deepEqual(await icons(typeItem(page, 'Schůzka'), 'menuitemradio Schůzka'), ['users'], 'Schůzka (icon: users) in the type menu');
  await page.keyboard.press('Escape');
  await chooseType(page, 'Schůzka');
  assert.ok((await icons(typeBtn(page), 'the type pill')).includes('users'), 'the type pill shows Schůzka\'s icon');
});

for (const trigger of ['[[', '@'] as const) {
  test(`bug_ms5b2_fr_typ_06_link_suggestions_${trigger === '[[' ? 'brackets' : 'at'}`, async ({ page }) => {
    await openLinks(page, B.osamela, { panel: false });
    const body = await must(editorBody(page), 'textbox "Note body"');
    await body.click();
    await page.keyboard.press('Meta+ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.type(`${trigger}Jana`);
    const option = page.getByRole('listbox', { name: 'Link suggestions', exact: true }).getByRole('option').filter({ hasText: 'Jana Nováková' }).first();
    assert.deepEqual(await icons(option, 'option Jana Nováková'), ['user'], 'Jana Nováková (Osoba, icon: user) in the suggestions');
  });
}
