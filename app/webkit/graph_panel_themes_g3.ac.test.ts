// Slice "G3 in the panel", L5 (WebKit + fake core): the panel's G3 parts in both themes and in the pseudo-locale
// (docs/acceptance/graph-panel-g3.md R125, R128; boards GraphPanel / GraphPanelDark A, B, B8, GraphDetails /
// GraphDetailsDark B, C, D): FR-UX-05 AC-18 (the preset row in each state with the popover open, the menu, the Save
// dialog with a message, the rename field, the delete confirm, the alert, the `View` switch with each button pressed,
// the List of Plán at depth 2, the focus ring and the hover ring at 50 % and full: axe `color-contrast` with zero
// violations after slice P's fade-in (D-1055), only theme tokens (FR-UX-05 AC-5), `· modified` in --type-orange, the
// rings --hl and --focus, `Delete` --danger, the pressed switch button --bg on --hover) and NFR-OTH-02 AC-15 (L5: every
// visible text, accessible name and description of the panel's switch, preset row and layers, tree, node descriptions
// and footer in each mode inside ⟦ ⟧ except user content). Written from the ACs and the contracts only (D-61); every
// lookup goes through `must`/`seen` and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast, colourLeaks } from './read-helpers';
import { pseudoLocale } from './helpers';
import {
  GRAPH_YML, P, click, deleteConfirm, menuItem, must, nameField, openPresetMenu, presetAlert, presetsText, renameField, runCommand, saveAs, sleep,
  tokenColour,
} from './graph-helpers';
import {
  GP, VIEWPORT, closePopover, graphPanel, openPanel, openPopover, pCanvas, pFocusNode, pFocused, pHoverRing, pListTree, pPointAt, pTypeBox, pViewBtn,
  pViewGroup, popover,
} from './graph-panel-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US', viewport: VIEWPORT });

const BEZ = { hiddenTypes: ['tag', 'kniha'], hiddenKinds: [] as string[], preset: 'Bez štítků' };

async function check(page: Page, theme: 'light' | 'dark', what: string) {
  // D-1055: after slice P's fade-in and any other transition, except the hover ring's own fill (it runs over the delay).
  await page.waitForFunction(() => document.getAnimations().every((x) => x.playState !== 'running' || !!((x.effect as KeyframeEffect | null)?.target as Element | null)?.closest?.('[data-hover-ring]')), undefined, { timeout: 3000 });
  assert.deepEqual(await axeContrast(page), [], `${theme}, ${what}: axe color-contrast`);
  assert.deepEqual(await colourLeaks(page, theme), [], `${theme}, ${what}: only theme tokens (FR-UX-05 AC-5)`);
}
/** The colour of the element whose own text is exactly `text`. */
async function colourOf(page: Page, text: string): Promise<string | null> {
  return page.evaluate((t) => {
    for (const e of document.querySelectorAll('body *')) {
      if ([...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() === t)) return getComputedStyle(e).color;
    }
    return null;
  }, text);
}
const presetRow = async (page: Page) => { await openPopover(page); return must(popover(page).getByRole('button', { name: /^Preset: / }), 'the popover\'s preset row (R125)'); };

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac18_panel_presets_list_and_rings_in_both_themes_${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    const core = await openPanel(page, P.plan, { theme, presets: presetsText('valid'), panel: { ...BEZ } });
    await presetRow(page);
    await check(page, theme, 'the popover with a preset');
    await click(pTypeBox(page, 'Tags'), 'tick Tags');
    await sleep(300);
    assert.equal(await colourOf(page, '· modified'), await tokenColour(page, 'type-orange'), '`· modified` in --type-orange');
    await check(page, theme, 'modified');
    await openPresetMenu(page);
    await check(page, theme, 'the open menu');
    await click(menuItem(page, 'Save as new preset…'), 'Save as new preset…');
    await (await must(nameField(page), 'Name')).fill('Default');
    await sleep(200);
    await check(page, theme, 'the Save dialog with a message');
    await page.keyboard.press('Escape');
    await openPresetMenu(page);
    await click(menuItem(page, 'Rename “Bez štítků”…'), 'Rename');
    await must(renameField(page), 'the rename field');
    await check(page, theme, 'the rename field');
    await page.keyboard.press('Escape');
    await openPresetMenu(page);
    await click(menuItem(page, 'Delete “Bez štítků”…'), 'Delete');
    const dlg = await must(deleteConfirm(page, 'Bez štítků'), 'the delete confirm');
    const danger = await tokenColour(page, 'danger');
    const paint = await dlg.getByRole('button', { name: 'Delete', exact: true }).evaluate((e) => { const s = getComputedStyle(e); return [s.backgroundColor, s.color, s.borderColor]; });
    assert.ok(paint.includes(danger), `\`Delete\` uses --danger (${paint.join(', ')})`);
    await check(page, theme, 'the delete confirm');
    await page.keyboard.press('Escape');
    await core.setFile(GRAPH_YML, `${presetsText('valid')}  - name: Cizí\n    hidden-types: []\n    hidden-kinds: []\n`, { silent: true });
    await saveAs(page, 'Moje');
    await must(presetAlert(page), 'the alert');
    await check(page, theme, 'the alert');
    await page.keyboard.press('Escape');
    await closePopover(page);
    const bg = await tokenColour(page, 'bg'), hover = await tokenColour(page, 'hover');
    for (const v of ['Graph', 'List'] as const) {
      await click(pViewBtn(page, v), v);
      const btn = await must(pViewBtn(page, v), v);
      assert.equal(await btn.getAttribute('aria-pressed'), 'true', `${v} pressed`);
      const [b, g] = await btn.evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e.closest('[role="group"]') as Element).backgroundColor]);
      assert.deepEqual([b, g], [bg, hover], `${theme}: the pressed \`${v}\` is --bg on --hover (board B8)`);
      await check(page, theme, `the switch with \`${v}\` pressed`);
    }
    await click(pViewBtn(page, 'Graph'), 'Graph');
    await must(pCanvas(page), 'the canvas');
    await pFocusNode(page, P.plan);
    await page.keyboard.press('ArrowRight');
    assert.ok((await pFocused(page)).key, 'a panel node has the keyboard focus');
    await check(page, theme, 'the focus ring');
  });

  test(`fr_ux_05_ac18_panel_presets_list_and_rings_in_both_themes_${theme}_list_unreadable_and_hover`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openPanel(page, P.plan, { theme, presets: presetsText('invalid-yaml'), previewMode: 'hover', hoverDelay: 800, realTime: true, panel: { depth: 2 } });
    await presetRow(page);
    await openPresetMenu(page);
    await check(page, theme, 'the unreadable state');
    await page.keyboard.press('Escape');
    await closePopover(page);
    await pPointAt(page, P.rozpocet);
    const ring = await must(pHoverRing(page), 'the panel\'s hover ring', 1000);
    await sleep(400);
    assert.equal(await ring.evaluate((e) => getComputedStyle(e.matches('circle, rect, path') ? e : (e.querySelector('circle, rect, path') ?? e)).stroke), await tokenColour(page, 'hl'), 'the ring in --hl');
    await check(page, theme, 'the hover ring at 50 %');
    await sleep(500);
    await check(page, theme, 'the hover ring full');
    await page.mouse.move(5, 5);
    await click(pViewBtn(page, 'List'), 'List');
    await must(pListTree(page), 'the List of Plán at depth 2');
    await check(page, theme, 'the List');
  });
}

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-15 (L5)

async function leaks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const user = (e: Element | null) => !!e?.closest('[data-user-content]');
    const out: string[] = [];
    const roots = [...document.querySelectorAll('[role="tabpanel"], [role="menu"], [role="dialog"], [role="alertdialog"], [role="tree"]')];
    if (roots.length === 0) return ['no tab panel'];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = (n.textContent ?? '').trim();
        if (!t || user(n.parentElement) || /^[\d\s.,·:#%×↩]+$/.test(t)) continue;
        if (!/^⟦[\s\S]*⟧$/.test(t)) out.push(t);
      }
      for (const e of root.querySelectorAll('[aria-label], [aria-description]')) {
        for (const a of ['aria-label', 'aria-description']) {
          const l = e.getAttribute(a) ?? '';
          if (l && !user(e) && !l.includes('⟦')) out.push(`${a}: ${l}`);
        }
      }
    }
    return [...new Set(out)];
  });
}
const ps = (t: string) => new RegExp(`^⟦?${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}⟧?$`);
// D-1161: each mode's own footer, `graph.panel.footerHover` / `graph.panel.footerOff` in the pseudo-locale.
const FOOTER = { 'Hover to preview': /^⟦\d+ objects? · hover to preview⟧$/, Off: /^⟦\d+ objects? · click to open⟧$/ } as const;
const footer = (page: Page, mode: keyof typeof FOOTER) => graphPanel(page).getByText(FOOTER[mode]);

test('nfr_oth_02_ac15_panel_g3_strings_in_the_catalog', async ({ page }) => {
  await openPanel(page, P.plan, { prelude: pseudoLocale, presets: presetsText('valid'), panel: { ...BEZ, hiddenTypes: ['kniha'] } });
  await must(pViewGroup(page), 'the panel\'s `View` switch (in ⟦ ⟧)');
  await must(pCanvas(page), 'the canvas');
  assert.deepEqual(await leaks(page), [], 'the Graph tab: the switch, the node descriptions, the canvas help and the footer');
  await click(GP(page).getByRole('button', { name: ps('Depth and filters') }), 'the trigger');
  await must(page.getByRole('dialog', { name: ps('Depth and filters') }), 'the popover');
  await click(page.getByRole('button', { name: /^⟦?Preset: / }), 'the preset button');
  const menu = await must(page.getByRole('menu', { name: ps('Presets') }), 'the menu');
  assert.deepEqual(await leaks(page), [], 'the preset row (modified) and the menu');
  await click(menu.getByRole('menuitem', { name: ps('Save as new preset…') }), 'Save as new preset…');
  await (await must(page.getByRole('textbox', { name: ps('Name') }), 'Name')).fill('');
  await page.keyboard.press('Enter');
  assert.deepEqual(await leaks(page), [], 'the Save dialog with its message');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await click(pViewBtn(page, 'List'), 'List');
  await must(pListTree(page), 'the panel\'s tree');
  assert.deepEqual(await leaks(page), [], 'the tree, its rows and descriptions');
  for (const mode of ['Hover to preview', 'Off'] as const) {
    await runCommand(page, `Object preview: ${mode}`);
    await sleep(400);
    await must(footer(page, mode), `the footer of ${mode} (D-1161)`);
    assert.deepEqual(await leaks(page), [], `the footer in ${mode}`);
  }
});
