// Slice OC build, cards_keyboard FR-UX-03 AC-55: `Change type icon…`, type `tent`, ⏎ wrote nothing and left the picker
// open with `tent` in its search. The first open of a window awaits the icon set (v1-cards §7.7); a ⏎ pressed before
// the set had loaded found no results and was dropped. ⏎ chooses the first result (FR-TYP-01 AC-14, §7.7 Keys), also
// when the results arrive after it.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { VYLET_YML, fileWhen, picker, pickerSearch, must, runCommand, sleep, startCards } from './cards-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('bug_oc55_fr_typ_01_enter_typed_while_the_icon_set_loads_chooses_the_first_result', async ({ page }) => {
  // The icon set's chunk arrives 1.5 s late, so the keys below land before it has loaded.
  await page.route('**/*lucide-icons*', async (r) => { await sleep(1500); await r.continue(); });
  const core = await startCards(page, { route: `type-settings/${'výlet'.normalize('NFC')}` });
  await runCommand(page, 'Change type icon…');
  await must(pickerSearch(page), 'the picker', 5000);
  await page.keyboard.type('tent');
  await page.keyboard.press('Enter');
  const t = await fileWhen(core, VYLET_YML, (x) => !!x?.includes('\nicon: tent\n'), 5000);
  assert.ok(t?.includes('\nicon: tent\n'), 'the type icon is tent');
  assert.equal(await picker(page).count(), 0, 'the picker closed');
});
