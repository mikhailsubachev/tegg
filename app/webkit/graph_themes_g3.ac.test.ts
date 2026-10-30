// Slice G3, L5 (WebKit + fake core): G3's parts in both themes and in the pseudo-locale (docs/acceptance/graph.md part
// two; boards GraphDetails / GraphDetailsDark B, C, D): FR-UX-05 AC-17 (the preset control in each state, the open
// menu, the Save dialog with a message, the rename field, the delete confirm, the alert, the focus ring, the hover
// ring and the List view, light and dark: axe `color-contrast` with zero violations, only theme tokens (FR-UX-05 AC-5),
// `· modified` in --type-orange, the hover ring --hl, the focus ring --focus, `Delete` --danger) and NFR-OTH-02 AC-14
// (every visible text and accessible name or description of R119, R121, R122, R123 inside ⟦ ⟧ except user content).
// Written from the ACs and the contracts only (D-61); every lookup goes through `must`/`seen` and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast, colourLeaks } from './read-helpers';
import { pseudoLocale } from './helpers';
import {
  GRAPH_YML, P, click, deleteConfirm, focused, hoverRing, listTree, menuItem, must, nameField, nodeOf, openGraph, openPresetMenu, pointAt, presetAlert,
  presetBtn, presetsText, presetsVault, renameField, saveAs, sleep, tokenColour, typeBox, uiG3, viewBtn,
} from './graph-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

const BEZ = { hiddenTypes: ['tag', 'kniha'], hiddenKinds: [] as string[], preset: 'Bez štítků' };

async function check(page: Page, theme: 'light' | 'dark', what: string) {
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

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac17_presets_list_and_rings_in_both_themes_${theme}`, async ({ page }) => {
    const core = await openGraph(page, P.plan, { theme, vault: presetsVault(presetsText('valid')), uiState: uiG3({ theme, full: BEZ }) });
    await must(presetBtn(page), 'the preset control');
    await check(page, theme, 'a preset');
    await click(typeBox(page, 'Tags'), 'tick Tags');
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
    const del = dlg.getByRole('button', { name: 'Delete', exact: true });
    const danger = await tokenColour(page, 'danger');
    const paint = await del.evaluate((e) => { const s = getComputedStyle(e); return [s.backgroundColor, s.color, s.borderColor]; });
    assert.ok(paint.includes(danger), `\`Delete\` uses --danger (${paint.join(', ')})`);
    await check(page, theme, 'the delete confirm');
    await page.keyboard.press('Escape');
    await core.setFile(GRAPH_YML, `${presetsText('valid')}  - name: Cizí\n    hidden-types: []\n    hidden-kinds: []\n`, { silent: true });
    await saveAs(page, 'Moje');
    await must(presetAlert(page), 'the alert');
    await check(page, theme, 'the alert');
    await page.keyboard.press('Escape');
    await nodeOf(page, P.plan).first().evaluate((e) => ((e.getAttribute('tabindex') !== null ? e : e.querySelector('[tabindex]')) as SVGElement | null)?.focus());
    await page.keyboard.press('ArrowRight');
    assert.ok((await focused(page)).key, 'a node has the keyboard focus');
    await check(page, theme, 'the focus ring');
    await click(viewBtn(page, 'List'), 'List');
    await must(listTree(page), 'the List view');
    await check(page, theme, 'the List view');
  });

  test(`fr_ux_05_ac17_presets_list_and_rings_in_both_themes_${theme}_unreadable_and_hover`, async ({ page }) => {
    await openGraph(page, P.plan, { theme, vault: presetsVault(presetsText('invalid-yaml')), previewMode: 'hover', hoverDelay: 800, realTime: true });
    await openPresetMenu(page);
    await check(page, theme, 'the unreadable state');
    await page.keyboard.press('Escape');
    await pointAt(page, P.rozpocet);
    const ring = await must(hoverRing(page), 'the hover ring', 1000);
    await sleep(400);
    assert.equal(await ring.evaluate((e) => getComputedStyle(e.matches('circle, rect, path') ? e : (e.querySelector('circle, rect, path') ?? e)).stroke), await tokenColour(page, 'hl'), 'the ring in --hl');
    await check(page, theme, 'the hover ring at 50 %');
    await sleep(500);
    await check(page, theme, 'the hover ring full');
  });
}

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-14 (L5)

async function leaks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const user = (e: Element | null) => !!e?.closest('[data-user-content]');
    const out: string[] = [];
    const roots = [...document.querySelectorAll('main, [role="menu"], [role="dialog"], [role="alertdialog"], [role="tree"]')];
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

test('nfr_oth_02_ac14_g3_strings_in_the_catalog', async ({ page }) => {
  await openGraph(page, P.plan, { prelude: pseudoLocale, vault: presetsVault(presetsText('valid')), uiState: uiG3({ full: { ...BEZ, hiddenTypes: ['kniha'] } }) });
  await must(presetBtn(page), 'the preset control');
  assert.deepEqual(await leaks(page), [], 'the graph with a modified preset: every text, name and description in ⟦ ⟧ except user content');
  await click(presetBtn(page), 'the preset button');
  const menu = await must(page.getByRole('menu', { name: ps('Presets') }), 'the menu');
  assert.deepEqual(await leaks(page), [], 'the menu');
  await click(menu.getByRole('menuitem', { name: ps('Save as new preset…') }), 'Save as new preset…');
  await (await must(page.getByRole('textbox', { name: ps('Name') }), 'Name')).fill('');
  await page.keyboard.press('Enter');
  assert.deepEqual(await leaks(page), [], 'the Save dialog with its message');
  await page.keyboard.press('Escape');
  await click(page.getByRole('main').getByRole('group', { name: ps('View') }).getByRole('button', { name: ps('List') }), 'List');
  await must(page.getByRole('tree', { name: ps('Local graph as a list') }), 'the List');
  assert.deepEqual(await leaks(page), [], 'the List rows (R122) and descriptions (R121)');
});
