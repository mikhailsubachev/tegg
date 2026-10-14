// Owner feedback on the 3C preview (2026-10-13): checkboxes didn't toggle in the editor (FR-EDT-02 AC-18) and the
// block menu's Turn into stayed open when nothing was chosen (FR-EDT-01 AC-6).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  E, blockMenu, block, caretIn, editorBody, fileText, must, mustBeSaved, noModified, openEditor, original, sleep,
} from './editor-helpers';
import { absent } from './helpers';

test('bug_3c_fr_edt_02_checkbox_toggles_with_a_real_mouse_click_and_back', async ({ page }) => {
  const core = await openEditor(page, E.ukoly);
  const box = await must(editorBody(page).getByRole('checkbox').first(), 'checkbox of Koupit mléko');
  const b = (await box.boundingBox())!;
  for (const want of ['- [x] Koupit mléko', '- [ ] Koupit mléko']) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(150);
    await mustBeSaved(page);
    assert.ok((await fileText(core, E.ukoly))!.includes(want), `after a click: ${want}`);
    const shownChecked = await box.evaluate((el) => (el as HTMLInputElement).checked ?? el.getAttribute('aria-checked') === 'true');
    const ariaChecked = await box.evaluate((el) => (el instanceof HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true'));
    assert.equal(ariaChecked, want.includes('[x]'), `the box shows the state: ${want}`);
    void shownChecked;
  }
  assert.equal(noModified((await fileText(core, E.ukoly))!), noModified(original(E.ukoly)), 'checked and unchecked again: the original bytes');
});

test('bug_3c_fr_edt_01_turn_into_closes_on_click_outside_and_escape', async ({ page }) => {
  await openEditor(page, E.deset);
  await caretIn(page, 5);
  await page.keyboard.press('Meta+/');
  await (await must(blockMenu(page).getByRole('menuitem', { name: 'Turn into', exact: true }), 'Turn into')).click();
  await must(page.getByRole('menuitem', { name: 'Heading 2', exact: true }), 'submenu');
  const r = (await block(page, 2).boundingBox())!;
  await page.mouse.click(r.x + r.width - 10, r.y + 5);
  assert.ok(await absent(blockMenu(page), 1000), 'a click outside closes the menu');
  await caretIn(page, 5);
  await page.keyboard.press('Meta+/');
  await (await must(blockMenu(page).getByRole('menuitem', { name: 'Turn into', exact: true }), 'Turn into')).click();
  await must(page.getByRole('menuitem', { name: 'Heading 2', exact: true }), 'submenu');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.ok(await absent(blockMenu(page), 1000), 'Esc closes the submenu, then the menu');
});
