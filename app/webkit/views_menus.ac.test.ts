// Slice Q2.1, L5 (WebKit + fake core): menus and popovers of views stay inside the window. docs/acceptance/views.md
// FR-QRY-07 AC-19 (F1, D-1848; the matrix of window sizes 800 × 500, 1,024 × 768, 1,440 × 900, 2,560 × 1,440 with the
// sidebar open and collapsed) and the regression test of the reported bug, `bug_q21_fr_qry_07_view_menu_stays_in_the_window`
// (the toolbar `⋯` on `Přečtené 2026` opened past the window's right edge), written first and committed red. "Inside":
// the popup's box within 8 px of every edge (± 0.5 px), each item hit by `elementFromPoint` at its centre after being
// scrolled into view inside the popup, no page scroll. Interface docs/contracts/v1-views.md §19.1 (`data-popup`,
// `data-placement`), §20. Written from the ACs and the contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  CTENI, Q, addMenu, addView, block, board, bookWithViews, card, click, editor, lane, menuItem, misfit, must, runCommand, openNote, popup, popupFit, rx, selectTab, sleep,
  sortButton, sortDialog, startViews, tab, toolbar, toolbarMenuButton, typeRoute, viewMenu, viewsVault, BOOK_YML, B,
} from './views-usage-helpers';

test.use({ timezoneId: 'Europe/Prague' });
const SIZES = [{ width: 800, height: 500 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 2560, height: 1440 }];
const columnsMenu = (page: Page) => page.getByRole('menu', { name: rx('Columns') });
const header = (scope: Locator) => scope.locator('.query-header');
/** Čtení with 80 lines of text before its blocks (runtime), so its first block can be scrolled near the bottom. */
const longCteni = (t: string) => t.replace('\n```query\nsaved: Přečtené 2026\n```\n', `\n${Array.from({ length: 80 }, (_, i) => `Řádek ${i + 1} s textem o knihách.`).join('\n\n')}\n\n\`\`\`query\nsaved: Přečtené 2026\n\`\`\`\n`);

// ------------------------------------------------------------------------------------------------ the reported bug

test('bug_q21_fr_qry_07_view_menu_stays_in_the_window', async ({ page }) => {
  await startViews(page, { route: typeRoute('book') });
  await must(tab(page, Q.p26), 'tab Přečtené 2026', 8000);
  await selectTab(page, Q.p26);
  const fails: string[] = [];
  for (const size of [{ width: 1440, height: 900 }, { width: 800, height: 500 }]) {
    await page.setViewportSize(size);
    await sleep(200);
    await click(toolbarMenuButton(page), 'the toolbar ⋯ `View actions`');
    const menu = await must(viewMenu(page), 'menu `View actions`');
    const f = await popupFit(menu);
    if (!f || f.box.right > size.width - 8 + 0.5) fails.push(`${size.width}×${size.height}: its right edge ${f?.box.right} > ${size.width - 8}`);
    const edit = await must(menuItem(menu, 'Edit view'), '`Edit view`');
    const hit = await edit.evaluate((el) => { const b = el.getBoundingClientRect(); const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!h && (h === el || el.contains(h)); });
    if (!hit) fails.push(`${size.width}×${size.height}: \`Edit view\` isn't the element at its centre`);
    await page.keyboard.press('Escape');
    await sleep(150);
  }
  assert.deepEqual(fails, [], 'the toolbar ⋯ menu ends ≤ width − 8 and `Edit view` is hit at its centre');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-19

for (const size of SIZES) {
  for (const sidebarOpen of [true, false]) {
    test(`fr_qry_07_ac19_view_menus_stay_in_the_window_${size.width}x${size.height}_sidebar_${sidebarOpen ? 'open' : 'collapsed'}`, async ({ page }) => {
      const vault = viewsVault((f) => { f[BOOK_YML] = bookWithViews('views: [Rozečtené, Přečtené 2026, Výborné knihy, Podle autora]\n'); });
      await startViews(page, { route: typeRoute('book'), vault, ui: { sidebarOpen }, ...(sidebarOpen ? {} : { frame: 'none' as const }) });
      await page.setViewportSize(size);
      await must(tab(page, Q.p26), 'the tabs', 8000);
      const fails: string[] = [];
      const check = async (what: string, open: () => Promise<void>, loc: () => Locator, id: string) => {
        await open();
        const l = loc();
        await must(l, what, 3000).catch(() => undefined);
        fails.push(...(await misfit(l, what)));
        const tagged = await popup(page, id).count();
        if (tagged === 0) fails.push(`${what}: no [data-popup="${id}"]`);
        await page.keyboard.press('Escape');
        await sleep(100);
      };
      await selectTab(page, Q.p26);
      await check('toolbar ⋯ on Přečtené 2026', () => click(toolbarMenuButton(page), '⋯'), () => viewMenu(page), 'views.menu');
      await check('sort popover (toolbar)', () => click(sortButton(toolbar(page)), 'sort'), () => sortDialog(page), 'sort');
      await check('Columns menu (tab)', () => click(toolbar(page).locator('button[data-command="view.columns"]'), 'Columns'), () => columnsMenu(page), 'columns');
      await check('Edit view (tab)', async () => { await click(toolbarMenuButton(page), '⋯'); await click(menuItem(await must(viewMenu(page), 'menu'), 'Edit view'), 'Edit view'); }, () => editor(page), 'query.editor');
      await selectTab(page, Q.roz);
      await check('toolbar ⋯ on Rozečtené (Reset lane order)', () => click(toolbarMenuButton(page), '⋯'), () => viewMenu(page), 'views.menu');
      await selectTab(page, Q.autor);
      await check('tab menu (chevron of the last tab)', () => click(tab(page, Q.autor).locator('[data-view-chevron]'), 'chevron'), () => viewMenu(page), 'views.tabMenu');
      await check('tab menu (right-click)', async () => { await (await must(tab(page, Q.autor), 'last tab')).click({ button: 'right' }); }, () => viewMenu(page), 'views.tabMenu');
      await check('tab menu (⇧F10)', async () => { await (await must(tab(page, Q.autor), 'last tab')).focus(); await page.keyboard.press('Shift+F10'); }, () => viewMenu(page), 'views.tabMenu');
      await check('Add view menu', () => click(addView(page), 'Add view'), () => addMenu(page), 'views.addMenu');
      // The last card of the rightmost lane of Podle autora: More actions and its Move to submenu.
      const b = await must(board(page, Q.autor), 'Podle autora', 5000);
      const last = card(b, B('Ostrov bez jména'), 'none');
      await check('card menu', () => click(last.getByRole('button', { name: /^⟦?More actions for/ }), 'More actions'), () => popup(page, 'card.menu'), 'card.menu');
      await click(last.getByRole('button', { name: /^⟦?More actions for/ }), 'More actions');
      const moveTo = page.getByRole('menu').getByRole('menuitem', { name: rx('Move to') }).last();
      if (await moveTo.isVisible().catch(() => false)) {
        await moveTo.hover();
        await sleep(300);
        fails.push(...(await misfit(popup(page, 'card.moveTo'), 'Move to submenu')));
      } else fails.push('card menu: no `Move to` item');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      void lane;
      // Čtení's block: sort popover, Columns, Edit query.
      await openNote(page, 'Čtení 2026');
      const blk = block(page, Q.p26);
      await must(blk, 'Čtení\'s block', 8000);
      await check('sort popover (block)', () => click(sortButton(blk), 'block sort'), () => sortDialog(page), 'sort');
      await check('Columns menu (block)', () => click(header(blk).getByRole('button', { name: rx('Columns') }), 'Columns'), () => columnsMenu(page), 'columns');
      await check('Edit query (block)', () => click(header(blk).getByRole('button', { name: rx('Edit query') }), 'Edit query'), () => editor(page), 'query.editor');
      assert.deepEqual(fails, [], `${size.width}×${size.height}, sidebar ${sidebarOpen ? 'open' : 'collapsed'}: every popup inside the window`);
    });
  }
}

test('fr_qry_07_ac19_view_menus_stay_in_the_window_upwards_and_resize', async ({ page }) => {
  const vault = viewsVault((f) => { f[CTENI] = longCteni(f[CTENI]); });
  await startViews(page, { route: `note/${CTENI}`, vault });
  const blk = block(page, Q.p26);
  await must(blk, 'Čtení\'s block', 8000);
  // Scroll so the block header is 40 px above the window's bottom: the sort popover opens upwards.
  const vh = 900;
  await header(blk).evaluate((h, target) => {
    let s: HTMLElement | null = h.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    const top = h.getBoundingClientRect().top;
    (s ?? document.scrollingElement as HTMLElement).scrollTop += top - target;
  }, vh - 40);
  const hb = (await header(blk).boundingBox())!;
  assert.ok(Math.abs(hb.y - (vh - 40)) <= 4, `setup: the header at ${hb.y}`);
  await click(sortButton(blk), 'the block\'s sort button');
  const dlg = await must(sortDialog(page), 'Sort');
  const placement = await popup(page, 'sort').getAttribute('data-placement').catch(() => null);
  assert.match(placement ?? '', /^above-/, 'data-placement above-*');
  const f = await popupFit(dlg);
  assert.ok(f && f.box.bottom <= hb.y + 0.5 && f.box.top >= 8 - 0.5, `the popover opens upwards, above the header: ${JSON.stringify(f?.box)}`);
  await page.keyboard.press('Escape');
  // Resizing the window while a menu is open leaves no part outside once the resize ends.
  await runToolbarMenu(page);
  await page.setViewportSize({ width: 800, height: 500 });
  await sleep(300);
  const still = await viewMenu(page).count();
  if (still > 0) assert.deepEqual(await misfit(viewMenu(page), 'after the resize'), [], 'placed again inside 800 × 500');
});

async function runToolbarMenu(page: Page) {
  await runCommand(page, 'Go to type: Books');
  await must(tab(page, Q.p26), 'the tabs', 8000);
  await selectTab(page, Q.p26);
  await click(toolbarMenuButton(page), '⋯');
  await must(viewMenu(page), 'menu `View actions`');
}
