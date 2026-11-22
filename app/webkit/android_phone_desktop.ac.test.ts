// Slice AND-2, L5 (the `webkit` project: WebKit, the fake core, `__TEGG_PLATFORM__ = 'macos'`, desktop viewports):
// docs/acceptance/android-phone.md
// - FR-UX-04 AC-1, the macOS part: at 1440 × 900 `data-layout="desktop"` and FR-UX-02 AC-1's frame (sidebar, centre
//   pane, title bar);
// - AR-03 AC-14, the L5 part: with `'macos'`, no element with `data-layout="phone"` and no `phone.*` catalog text is
//   rendered at 800 × 500 or 1440 × 900 (the existing L5 suites passing unchanged is the gate itself).
// Contract docs/contracts/android-phone.md §4.1, §8.1, §11. Red-test reading (reported): "a `phone.*` catalog key is
// rendered" is checked as "no visible text equals or contains the English text of a `phone.*` key that the desktop
// doesn't also use" (the keys whose texts are shared words, `Menu`, `Search`, `Back`, `Settings`, `Close`, `On`, `Off`,
// `Properties`, `More actions`, `New`, `Today`, `Main`, `Navigation`, the map buttons and the source toggles, are
// left out), plus no `.phone-*` element.
// Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { startAndroid } from './android-helpers';
import { must, sidebar } from './helpers';
import { phoneVault, PH, VAULT_PATH } from './phone-helpers';

const PHONE_ONLY_TEXTS = [
  'Creating objects comes with editing on the phone.', 'View only on the phone', ' · Android', 'Storage access', 'Switch vault…',
  'Open or close navigation', 'Close sheet', 'Show properties', 'Zoom in on the mindmap', 'Open the mindmap full screen',
];
async function startMac(page: Page, route: string) {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = 'cs'; (window as any).__TEGG_ROUTE__ = r; }, route);
  await page.clock.setFixedTime(new Date('2026-11-19T10:00:00+01:00'));
  return startAndroid(page, { vault: phoneVault(), vaultPath: VAULT_PATH, platform: 'macos', layout: null });
}

test('fr_ux_04_ac1_phone_layout_on_android', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startMac(page, 'inbox');
  await must(sidebar(page), 'macOS: the sidebar (FR-UX-02 AC-1)', 10_000);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-layout')), 'desktop', 'macOS at 1440 × 900: <html data-layout="desktop">');
  await must(page.getByRole('main'), 'the centre pane');
  assert.equal(await page.getByRole('navigation', { name: 'Main' }).count(), 0, 'no phone bottom bar');
  assert.equal(await page.locator('.titlebar').count(), 1, 'the title bar');
});

test('ar_03_ac14_desktop_unchanged_by_the_phone_layout', async ({ page }) => {
  for (const size of [{ width: 800, height: 500 }, { width: 1440, height: 900 }]) {
    for (const route of ['inbox', 'type/book', 'search', `note/${PH.mapa}`, 'settings/appearance']) {
      const p = await page.context().newPage();
      await p.setViewportSize(size);
      await startMac(p, route);
      await must(sidebar(p), `${route} at ${size.width}: the desktop frame`, 10_000);
      const how = `${route} at ${size.width} × ${size.height}`;
      assert.equal(await p.locator('[data-layout="phone"]').count(), 0, `${how}: no element with data-layout="phone"`);
      assert.equal(await p.evaluate(() => document.documentElement.getAttribute('data-layout')), 'desktop', `${how}: data-layout="desktop"`);
      assert.equal(await p.locator('[class*="phone-"]').count(), 0, `${how}: no phone frame element`);
      const text = await p.evaluate(() => document.body.innerText);
      for (const t of PHONE_ONLY_TEXTS) assert.ok(!text.includes(t), `${how}: no phone.* text "${t}"`);
      await p.close();
    }
  }
});
