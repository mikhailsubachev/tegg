// MS6 slice 6A, L5 (WebKit + fake core): FR-HIS-01 AC-9's theme part (docs/acceptance/trash-media.md; D-631):
// app-shell FR-UX-05 AC-4 (axe `color-contrast`: zero violations) and AC-5 (every computed `color`,
// `background-color` and `border-color` of every visible element is a token of the theme, `transparent` or inherited)
// on `trash` with rows, with the `Delete permanently?` dialog open and empty, in light and in dark. Interface
// docs/contracts/ms6-trash-media.md §6.2 (TrashPage), §7 (`route-ready:trash`). Written from the ACs and the contract
// only (D-61). Every lookup goes through `must` (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { click, deleteBtn, dialogNamed, emptyBtn, gotoTrash, must, startTM, trashList, zeroRegion } from './trash-media-helpers';
import { axeContrast, colourLeaks } from './read-helpers';

test.use({ timezoneId: 'Europe/Prague' });

for (const theme of ['light', 'dark'] as const) {
  test(`fr_his_01_ac9_theme_tokens_and_contrast_on_trash_${theme}`, async ({ page }) => {
    await startTM(page, { theme });
    await gotoTrash(page);
    await must(trashList(page), 'the rows', 3000);
    assert.deepEqual(await axeContrast(page), [], `${theme}: axe color-contrast with rows (FR-UX-05 AC-4)`);
    assert.deepEqual(await colourLeaks(page, theme), [], `${theme}: only theme tokens with rows (FR-UX-05 AC-5)`);
    await click(deleteBtn(page, 'Hotovo'), 'Delete "Hotovo" permanently…');
    await must(dialogNamed(page, 'Delete permanently?'), 'the dialog');
    assert.deepEqual(await axeContrast(page), [], `${theme}: axe with the dialog open`);
    assert.deepEqual(await colourLeaks(page, theme), [], `${theme}: tokens with the dialog open`);
    await page.keyboard.press('Escape');
    await click(emptyBtn(page), 'Empty trash…');
    await click(dialogNamed(page, 'Empty the trash?').getByRole('button', { name: 'Empty trash', exact: true }), 'Empty trash');
    await must(zeroRegion(page), 'the empty state', 3000);
    assert.deepEqual(await axeContrast(page), [], `${theme}: axe on the empty trash`);
    assert.deepEqual(await colourLeaks(page, theme), [], `${theme}: tokens on the empty trash`);
  });
}
