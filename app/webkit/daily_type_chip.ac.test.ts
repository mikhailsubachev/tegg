// MS4 slice 4B preview feedback (D-369), L5 (WebKit + fake core): a Daily Note's type chip is the link
// `Type: Daily Note` to `type/daily-note`; the fixed-type reason moves to `Change type…` in the `More` menu.
// daily-notes.md FR-DLY-01 AC-9 (as annotated by D-369), types.md FR-TYP-07 AC-11, AC-12. Interface: the `More` menu
// agreed for this slice (button `More`, menu `More`, menuitem `Change type…`). Written from the ACs only (D-61).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { D, callsOf, cmdD, description, eventually, main, must, mustBeOn, runCommand, sleep, startDaily, writeCalls } from './daily-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('fr_dly_01_ac9_the_daily_type_chip_links_to_type_daily_note', async ({ page }) => {
  const core = await startDaily(page, { now: '2026-10-07T12:00:00+02:00', at: D.zminky });
  await cmdD(page, '2026-10-07');
  const chip = await must(main(page).getByRole('link', { name: 'Type: Daily Note', exact: true }), 'link "Type: Daily Note"');
  assert.notEqual(await chip.getAttribute('aria-disabled'), 'true', 'not aria-disabled');
  const more = await must(main(page).getByRole('button', { name: 'More', exact: true }), 'button "More"');
  await more.click();
  const item = await must(page.getByRole('menu', { name: 'More', exact: true }).getByRole('menuitem', { name: 'Change type…', exact: true }), 'menuitem "Change type…"');
  assert.equal(await item.getAttribute('aria-disabled'), 'true', 'Change type… is aria-disabled');
  assert.equal(await description(item), "The type of a Daily Note can't be changed");
  await page.keyboard.press('Escape');
  await runCommand(page, 'Change type…');
  await sleep(300);
  assert.equal(await page.getByRole('menu', { name: 'Change type', exact: true }).count(), 0, 'the palette command is not run');
  await page.keyboard.press('Escape');
  const n0 = (await callsOf(core, 'nav_opened')).length;
  await chip.click();
  await mustBeOn(page, 'Daily Notes', 'the chip opens the Daily Notes type page', 5000);
  const routes = await eventually(async () => (await callsOf(core, 'nav_opened')).slice(n0).map((c) => (c.args as any)?.route), (r) => r.length > 0);
  assert.deepEqual(routes, ['type/daily-note'], 'nav_opened type/daily-note');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});
