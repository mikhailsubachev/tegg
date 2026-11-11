// MS5 slice 5B feedback round 2, L5 (WebKit + fake core): the version label instead of the in-app logo (FR-UX-01 AC-5,
// D-597, D-1512; AC-test change D-1513) and the capture Saved panel without a logo (FR-CAP-01 AC-13, L5 part; R55 "Saved panel").
// Written from docs/acceptance/app-shell.md (FR-UX-01 AC-5), docs/acceptance/capture.md (FR-CAP-01 AC-13, R55) and
// docs/contracts/ms3-shell.md §1 "Release build", §12.3, §12.5 only (D-61). Every lookup goes through `must`/`seen` and node:assert, so a
// missing element is an AssertionError (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eventually, focused, must, mustBeOn, onPage, runCommand, sidebar, start, theme } from './helpers';
import { ui, watchNetwork } from './read-helpers';
import { click, seen, sleep, startCapture } from './capture-helpers';

const LABEL = 'Tegg: About and Settings';
const PATTERN = /^(v\d+\.\d+\.\d+|dev)$/;
const versionButton = (page: Page) => sidebar(page).getByRole('button', { name: LABEL, exact: true });
const aboutMenu = (page: Page) => page.getByRole('menu', { name: 'About and Settings' });

/** What the button contains: images, inline SVGs, visible text nodes, its visible text and accessible name parts. */
async function buttonInfo(page: Page) {
  const btn = await must(versionButton(page), `sidebar button "${LABEL}"`);
  return btn.evaluate((b) => {
    const visible = (e: Element | null) => {
      for (let x = e; x; x = x.parentElement) {
        const s = getComputedStyle(x);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      }
      return true;
    };
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    const texts: string[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? '').trim();
      if (t && visible(n.parentElement)) texts.push(t);
    }
    return {
      imgs: b.querySelectorAll('img, picture, image').length,
      svgs: b.querySelectorAll('svg').length,
      bgImage: [b, ...b.querySelectorAll('*')].some((e) => getComputedStyle(e).backgroundImage !== 'none'),
      texts,
      inner: (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
      ariaLabel: b.getAttribute('aria-label'),
    };
  });
}

/** The label the build should show: `versionLabel(process.env.TEGG_VERSION)`, the version the test build was built with
 * (ms3-shell §12.3; `dev` when it has none). */
async function expectedLabel(): Promise<string> {
  let m: Record<string, any> | null = null;
  try { m = await import(pathToFileURL(resolve(import.meta.dirname, '../ui/src/version.ts')).href); } catch { m = null; }
  assert.ok(m && typeof m.versionLabel === 'function', 'app/ui/src/version.ts exports versionLabel (ms3-shell §12.3)');
  return m!.versionLabel(process.env.TEGG_VERSION);
}

// ------------------------------------------------------------------------------------------------ FR-UX-01 AC-5

test('fr_ux_01_ac5_button_shows_the_version_and_no_image_in_light_and_dark', async ({ page }) => {
  const hits = watchNetwork(page);
  await start(page, { uiState: ui('light') });
  assert.equal(await theme(page), 'light', 'setup: light theme');
  const light = await buttonInfo(page);
  assert.equal(light.imgs, 0, 'no img in the button (D-597)');
  assert.equal(light.svgs, 0, 'no svg in the button (D-597)');
  assert.equal(light.bgImage, false, 'no background image in the button (D-597)');
  assert.equal(light.texts.length, 1, `one visible text, got ${JSON.stringify(light.texts)}`);
  assert.match(light.texts[0], PATTERN, 'the visible text is v<MAJOR.MINOR.PATCH> or dev');
  assert.equal(light.inner, light.texts[0], 'the button shows only the version');
  assert.equal(light.ariaLabel, LABEL, 'the accessible name stays "Tegg: About and Settings"');

  await page.evaluate(() => { (window as any).__noReload = true; });
  await runCommand(page, 'Theme: Dark');
  assert.equal(await eventually(() => theme(page), (v) => v === 'dark', 1500), 'dark', 'dark theme');
  const dark = await buttonInfo(page);
  assert.deepEqual(dark, light, 'the same button content in dark');
  assert.equal(await page.evaluate(() => (window as any).__noReload === true), true, 'switched without a reload');
  assert.deepEqual(hits, [], 'no network request (NFR-SEC-01)');
});

test('fr_ux_01_ac5_button_starting_in_dark_shows_the_version', async ({ page }) => {
  await start(page, { uiState: ui('dark') });
  assert.equal(await theme(page), 'dark', 'setup: dark theme');
  const info = await buttonInfo(page);
  assert.equal(info.imgs + info.svgs, 0, 'no img or svg in the button in dark (D-597)');
  assert.equal(info.texts.length, 1, `one visible text, got ${JSON.stringify(info.texts)}`);
  assert.match(info.texts[0], PATTERN, 'the visible text is v<MAJOR.MINOR.PATCH> or dev');
});

test('fr_ux_01_ac5_version_is_the_builds_version_label', async ({ page }) => {
  await start(page, { uiState: ui('light') });
  const info = await buttonInfo(page);
  assert.equal(info.texts.length, 1, `one visible text, got ${JSON.stringify(info.texts)}`);
  assert.equal(info.texts[0], await expectedLabel(), 'the button shows versionLabel(TEGG_VERSION) (ms3-shell §12.3)');
});

test('fr_ux_01_ac5_version_button_keeps_its_name_and_menu', async ({ page }) => {
  const core = await start(page, { uiState: ui('light') });
  const btn = await must(versionButton(page), `sidebar button "${LABEL}"`);
  assert.match((await buttonInfo(page)).texts.join(' '), PATTERN, 'setup: the button shows the version');
  assert.equal(await btn.getAttribute('aria-haspopup'), 'menu', 'aria-haspopup="menu"');
  assert.equal(await btn.getAttribute('aria-expanded'), 'false', 'aria-expanded="false" while closed');
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'setup');
  await btn.click();
  const m = await must(aboutMenu(page), 'menu "About and Settings"');
  assert.equal(await btn.getAttribute('aria-expanded'), 'true', 'aria-expanded="true" while open');
  const items = (await m.getByRole('menuitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().replace(/\s*⌘.*$/, ''));
  assert.deepEqual(items, ['About Tegg', 'Settings…'], 'menu items');
  await page.keyboard.press('Escape');
  assert.equal(await eventually(() => aboutMenu(page).count(), (n) => n === 0, 1500), 0, 'Esc closes the menu');
  const f = await eventually(() => focused(page), (x) => x.label === LABEL, 1500);
  assert.equal(f.label, LABEL, 'focus returns to the button');
  await btn.click();
  await (await must(aboutMenu(page).getByRole('menuitem', { name: 'About Tegg' }), 'About Tegg')).click();
  const about = await eventually(() => core.calls(), (c) => c.some((x) => x.cmd === 'app_about'), 1500);
  assert.equal(about.filter((x) => x.cmd === 'app_about').length, 1, 'About Tegg calls app_about once');
  assert.equal(await onPage(page, 'Inbox', 300), true, 'About Tegg leaves the route unchanged');
  await btn.click();
  await (await must(aboutMenu(page).getByRole('menuitem', { name: 'Settings…' }), 'Settings…')).click();
  await mustBeOn(page, 'Settings: Appearance', 'Settings… → settings/appearance');
  assert.equal(await core.writes(), 0);
});

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-13 (L5)

/** Rendered `svg`/`img` elements of the page outside the button `Open` (outermost ones only). */
async function logos(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const open = [...document.querySelectorAll('button, [role="button"]')].filter((b) => (b.getAttribute('aria-label') ?? (b as HTMLElement).innerText ?? '').trim() === 'Open');
    const out: string[] = [];
    for (const e of document.querySelectorAll('svg, img, picture, image')) {
      if (open.some((b) => b.contains(e))) continue;
      if (e.parentElement?.closest('svg')) continue;
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      if (r.width === 0 || r.height === 0 || s.display === 'none' || s.visibility === 'hidden') continue;
      out.push(`${e.tagName.toLowerCase()}${e.getAttribute('aria-label') ? `[${e.getAttribute('aria-label')}]` : ''}${e.getAttribute('src') ? `[src=${e.getAttribute('src')}]` : ''}`);
    }
    return out;
  });
}

for (const th of ['light', 'dark'] as const) {
  test(`fr_cap_01_ac13_saved_panel_shows_no_logo_${th}`, async ({ page }) => {
    const core = await startCapture(page, { hash: '#saved', theme: th });
    await sleep(300);
    await core.showSaved({ typeName: 'Quick Note', title: 'Koupit dárek pro Janu', path: 'Quick Notes/Koupit dárek pro Janu.md' });
    assert.ok(await seen(page.getByText('Saved to Inbox', { exact: true }), 2000), 'Saved to Inbox');
    assert.ok(await seen(page.getByText('Quick Note · Koupit dárek pro Janu', { exact: true }), 1000), '<Type name> · <title>');
    await must(page.getByRole('button', { name: 'Open', exact: true }), 'button "Open"');
    await sleep(200);
    assert.deepEqual(await logos(page), [], `no logo svg/img outside "Open" in the Saved panel (${th}, D-597)`);
    // The panel still works.
    await click(page.getByRole('button', { name: 'Open', exact: true }), 'Open');
    assert.deepEqual((await core.captureLog()).openMain, ['Quick Notes/Koupit dárek pro Janu.md'], 'Open asks the shell to show the note');
  });
}
