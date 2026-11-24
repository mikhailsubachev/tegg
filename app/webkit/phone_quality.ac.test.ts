// Slice AND-2, L5p (projects `phone-webkit`, `phone-chromium`): docs/acceptance/android-phone.md
// - FR-UX-05 AC-27 (contrast on every phone surface, light and dark);
// - NFR-OTH-02 AC-25 (L5p: the pseudo-locale wraps every phone text);
// - FR-UX-03 AC-56 (every control is a registered command, no palette);
// - AR-03 AC-13 (L5p: no excluded action offered; not-offered routes land as an unknown route);
// - FR-SYN-06 AC-54 (L5p: a reading tour writes nothing; T1).
// Contract docs/contracts/android-phone.md §2.3 (WRITE_COMMANDS), §7 (PHONE_NOT_OFFERED), §10 (PHONE_HIDDEN_COMMANDS),
// §12.2, §14.1.
// Red-test readings (reported): user content in the pseudo-locale check is what carries `data-user-content` (or sits in
// a note body, a code block or a map), as in the desktop's pseudo-locale tests; the registered commands are
// `__TEGG_TEST__.commands()` (ms3-shell §3.7); RA2's excluded commands are the AND-1 table (android-shell.md RA2).
// FR-UX-03 AC-56's third part (D-2447, AC-Test-Change): `__TEGG_TEST__.run(id)` (§12.2) runs a registered command by
// id as a phone control does; for each control's command, a fresh page tapped and a fresh page run by id end with the
// same route, the same open dialogs and menus, and the same IPC commands (perf marks aside). `run` rejects for an id the
// phone doesn't list.
// Written from the ACs and the contract only (D-61).
import { test, type Browser, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast, colourLeaks } from './read-helpers';
import { pseudoLocale } from './helpers';
import {
  B, NOT_OFFERED, PH, RA9_ROUTES, assertZeroWrites, barButton, bottomBar, controls, drawer, drawerEntry, eventually, fileStateOf, flat, main, mainName, moreButton,
  moreMenu, must, nfc, openDrawer, phonePage, rect, seen, sheet, sleep, startPhone, systemBack, touchDrag, ui, unwrappedTexts, writesSeen,
} from './phone-helpers';

test.use({ timezoneId: 'Europe/Prague' });

/** RA2's groups P1…P5, J, V, O (docs/acceptance/android-shell.md; contract android-shell.md §2.1). */
const RA2_EXCLUDED = [
  'capture_context', 'capture_create', 'capture_ready', 'capture_hide', 'capture_resize', 'capture_open_main', 'capture_draft_get', 'capture_draft_set', 'capture_saved_show', 'capture_saved_hover', 'capture_suggest', 'capture_open', 'capture_media_add',
  'hotkeys', 'hotkeys_retry', 'shell_settings', 'shell_settings_set',
  'import_pick_source', 'import_scan', 'import_cancel', 'import_where', 'import_check_target', 'import_plan', 'import_start', 'import_status', 'import_discard', 'import_transform_result',
  'vault_pick_dir', 'media_pick', 'vault_reveal', 'media_reveal', 'backup_reveal', 'media_open', 'open_external', 'app_about', 'app_quit',
  'note_rename', 'tag_rename', 'tag_delete', 'merge_start', 'type_move_plan', 'type_move', 'folder_move_preview', 'tidy_now', 'value_remove_start', 'type_delete_start', 'inbox_bulk', 'starter_add', 'backup_restore', 'job_undo', 'job_redo', 'type_create', 'type_patch', 'type_delete',
  'query_apply', 'query_revert', 'query_create', 'query_duplicate', 'query_rename', 'query_trash', 'query_restore', 'task_views_restore',
  'graph_neighbourhood', 'graph_presets_get', 'graph_presets_apply', 'index_related', 'trash_restore', 'trash_delete', 'trash_empty',
];
/** §10's PHONE_HIDDEN_COMMANDS (exact ids; `*` ends a prefix). `board.*` except folds and `inbox.*` except `inbox.open`. */
const HIDDEN = [
  'app.palette', 'help.shortcuts', 'nav.forward', 'view.toggleSidebar', 'view.toggleRightPanel', 'view.toggleFocus', 'note.toggleProperties', 'note.width.*', 'edit.*',
  'editor.insertQuery', 'mindmap.layoutRight', 'mindmap.layoutSpider', 'preview.*', 'link.edit', 'link.remove', 'outline.*', 'panel.*', 'related.toggleLinked', 'graph.*',
  'sidebar.pin', 'sidebar.unpin', 'sidebar.pinned.moveUp', 'sidebar.pinned.moveDown', 'tags.new', 'tag.*', 'queries.new', 'query.edit', 'query.rename', 'query.trash',
  'query.saveAs', 'query.columns', 'views.new', 'views.menu', 'views.remove', 'views.edit', 'views.moveLeft', 'views.moveRight', 'board.*', 'sort.*', 'columns.*',
  'typePage.*', 'type.*', 'task.*', 'tasks.schedule', 'tasks.kanban', 'tasks.search', 'types.restoreDefaultViews', 'note.markReviewed', 'note.markUnreviewed',
  'daily.markReviewed', 'daily.markUnreviewed', 'note.changeType', 'note.editProperties', 'object.trash', 'media.add', 'trash.*', 'goto.trash', 'goto.brokenLinks',
  'goto.duplicateTitles', 'goto.settings/shortcuts', 'goto.settings/menu-bar', 'goto.settings/trash-history', 'goto.settings/previews', 'settings.backups', 'job.*',
  'capture.*', 'import.open', 'inbox.*', 'duplicates.merge', 'vault.open', 'vault.addStarterTypes', 'app.about', 'nav.newTab', 'edit.copyBlockLink', 'typeSettings.*',
  'panel.editRecurrence', 'settings.font', 'settings.fontSize', 'settings.accentColor', 'settings.changeShortcut',
  // D-2480: slice OC's card.edit (AC-Test-Change, approved by the owner).
  'card.edit',
];
const isFold = (id: string) => /^board\..*(fold|collapse|expand)/i.test(id);
function hiddenCommand(id: string): boolean {
  // D-2475: a board card's board.openCard:<path> and board.openSource:<path> are exceptions inside board.* (AC-Test-Change,
  // approved by the owner).
  if (id === 'inbox.open' || isFold(id) || id.startsWith('board.openCard:') || id.startsWith('board.openSource:')) return false;
  return HIDDEN.some((h) => (h.endsWith('*') ? id.startsWith(h.slice(0, -1)) : id === h));
}
const NOT_OFFERED_COMMANDS = ['goto.home', 'goto.graph', 'goto.trash', 'goto.help/shortcuts', 'goto.settings/shortcuts', 'goto.settings/menu-bar', 'goto.settings/trash-history', 'goto.settings/previews', 'goto.settings/backups', 'goto.broken-links', 'goto.duplicate-titles', 'object.newIn', 'graph.open'];

/** Opens each RA9 route and runs `fn` with the page in each state: plain, drawer open, note menu and sheet open. */
async function eachSurface(browser: Browser, fn: (page: Page, how: string) => Promise<void>, o: Parameters<typeof startPhone>[1] = {}) {
  for (const route of RA9_ROUTES) {
    const page = await phonePage(browser);
    try {
      await startPhone(page, { ...o, route });
      await eventually(() => mainName(page), (n) => !!n, 5000);
      await fn(page, route);
      await openDrawer(page);
      await fn(page, `${route}, drawer open`);
      await page.keyboard.press('Escape');
      if (route.startsWith('note/')) {
        await (await must(moreButton(page), 'More actions')).click();
        await must(moreMenu(page), 'menu More actions');
        await fn(page, `${route}, More actions open`);
        await moreMenu(page).getByRole('menuitem').first().click();
        await must(sheet(page, 'Properties').or(sheet(page, '⟦Properties⟧')), 'the Properties sheet');
        await fn(page, `${route}, Properties sheet open`);
        await page.keyboard.press('Escape');
        const fig = main(page).getByRole('figure').filter({ has: page.locator('[data-map-area]') }).first();
        if (await seen(fig, 500)) {
          await fig.locator('[data-command="mindmap.fullScreen"]').click();
          await must(page.getByRole('dialog', { name: /Mindmap: / }), 'the full-screen map');
          await fn(page, `${route}, full-screen map`);
          await page.keyboard.press('Escape');
        }
      }
    } finally {
      await page.close();
    }
  }
}

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-27

test('fr_ux_05_ac27_contrast_on_phone_surfaces', async ({ browser }) => {
  test.setTimeout(300_000);
  for (const theme of ['light', 'dark'] as const) {
    await eachSurface(browser, async (page, how) => {
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme, `${how}: the ${theme} theme`);
      assert.deepEqual(await axeContrast(page), [], `${theme}, ${how}: axe color-contrast reports no violation`);
      if (theme === 'dark') assert.deepEqual(await colourLeaks(page, 'dark'), [], `dark, ${how}: no light colour (FR-UX-05 AC-5)`);
    }, { uiState: ui({ theme }) });
  }
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-25 (L5p)

test('nfr_oth_02_ac25_phone_strings', async ({ browser }) => {
  test.setTimeout(240_000);
  await eachSurface(browser, async (page, how) => {
    for (const [what, loc] of [['the app bar', page.getByRole('banner')], ['the bottom bar', bottomBar(page)], ['main', main(page)], ['the drawer', drawer(page)], ['a sheet', page.getByRole('dialog')], ['a menu', page.getByRole('menu')]] as const) {
      if (!(await seen(loc, 100))) continue;
      assert.deepEqual(await unwrappedTexts(loc), [], `${how}, ${what}: every visible text is inside ⟦ ⟧ (user content aside)`);
    }
  }, { prelude: pseudoLocale });
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-56

test('fr_ux_03_ac56_commands_without_a_palette', async ({ browser }) => {
  test.setTimeout(1_800_000);
  await eachSurface(browser, async (page, how) => {
    for (const keys of ['Meta+k', 'Control+k', 'Meta+Shift+p']) {
      await page.keyboard.press(keys);
      await sleep(150);
      assert.equal(await page.getByRole('dialog', { name: 'Command palette' }).count(), 0, `${how}: ${keys} opens no Command palette`);
    }
    const registered = new Set(await page.evaluate(() => ((window as any).__TEGG_TEST__?.commands?.() ?? []) as string[]));
    assert.ok(registered.size > 0, `${how}: __TEGG_TEST__.commands() lists the registry`);
    const scope = (await seen(drawer(page), 100)) ? drawer(page) : (await seen(sheet(page, 'Properties'), 100)) ? sheet(page, 'Properties') : (await seen(moreMenu(page), 100)) ? moreMenu(page) : undefined;
    // D-2458, D-2461: links and read-only task checkboxes in a note's text are content, not controls.
    const ctl = (await controls(page, scope)).filter((c) => !c.inert && !c.text && !c.row && !((c.role === 'link' || c.role === 'checkbox') && c.exempt) && ['button', 'link', 'tab', 'menuitem', 'menuitemradio', 'checkbox', 'radio', 'switch'].includes(c.role));
    const missing = ctl.filter((c) => !c.command || !registered.has(c.command.split(':')[0]) && !registered.has(c.command)).map((c) => `${c.role} "${c.name.slice(0, 30)}" → ${c.command ?? '(none)'}`);
    assert.deepEqual(missing, [], `${how}: every control carries the data-command of a registered command`);
  });

  // every command a phone control carries runs from the registry with the same effect as the tap (D-2447)
  type Effect = { route: string | null; open: string[]; ipc: string[] };
  const effect = async (page: Page, core: Awaited<ReturnType<typeof startPhone>>, from: number): Promise<Effect> => {
    await sleep(500);
    const open = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="menu"]')].filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute('aria-label') ?? '').sort());
    const ipc = [...new Set((await core.calls()).slice(from).map((c) => c.cmd).filter((c) => c !== 'perf_mark' && !c.startsWith('plugin:')))].sort();
    return { route: await mainName(page), open, ipc };
  };
  const done = new Set<string>();
  for (const route of RA9_ROUTES) {
    for (const inDrawer of [false, true]) {
      const probe = await phonePage(browser);
      await startPhone(probe, { route });
      await eventually(() => mainName(probe), (n) => !!n, 5000);
      if (inDrawer) await openDrawer(probe);
      const scope = inDrawer ? drawer(probe) : undefined;
      const cmds = [...new Set((await controls(probe, scope)).filter((c) => !c.inert && !c.text && !c.row && !((c.role === 'link' || c.role === 'checkbox') && c.exempt) && c.command && c.command !== 'phone.menu').map((c) => c.command!))];
      await probe.close();
      for (const id of cmds) {
        const key = `${inDrawer ? 'drawer' : 'page'}|${id}`;
        if (done.has(key)) continue;
        done.add(key);
        const how = `${route}${inDrawer ? ', drawer' : ''}: ${id}`;
        // the tap
        const tapPage = await phonePage(browser);
        const c1 = await startPhone(tapPage, { route });
        await eventually(() => mainName(tapPage), (n) => !!n, 5000);
        if (inDrawer) await drawerSettled(tapPage); // D-2462
        const n1 = (await c1.calls()).length;
        await (inDrawer ? drawer(tapPage) : tapPage.locator('body')).locator(`[data-command="${id.replace(/"/g, '\\"')}"]`).first().click({ force: true });
        const byTap = await effect(tapPage, c1, n1);
        await tapPage.close();
        // the command by id
        const runPage = await phonePage(browser);
        const c2 = await startPhone(runPage, { route });
        await eventually(() => mainName(runPage), (n) => !!n, 5000);
        if (inDrawer) await drawerSettled(runPage); // D-2462
        const hasRun = await runPage.evaluate(() => typeof (window as any).__TEGG_TEST__?.run === 'function');
        assert.ok(hasRun, `${how}: window.__TEGG_TEST__.run(id) exists (contract §12.2, D-2447)`);
        const n2 = (await c2.calls()).length;
        const ran = await runPage.evaluate((cmd) => (window as any).__TEGG_TEST__.run(cmd).then(() => 'ok', (e: unknown) => `rejected: ${String((e as Error)?.message ?? e)}`), id);
        assert.equal(ran, 'ok', `${how}: run(id) resolves for a command a phone control carries`);
        const byRun = await effect(runPage, c2, n2);
        await runPage.close();
        assert.deepEqual(byRun, byTap, `${how}: running the command by id has the tap's effect (route, open dialogs and menus, IPC calls)`);
      }
    }
  }
  assert.ok(done.size > 0, 'the phone controls carry commands');
  const page = await phonePage(browser);
  await startPhone(page, { route: 'inbox' });
  const hidden = await page.evaluate(() => Promise.resolve((window as any).__TEGG_TEST__?.run?.('app.palette')).then(() => 'resolved', () => 'rejected'));
  assert.equal(hidden, 'rejected', 'run rejects for an id the phone doesn\'t list (app.palette)');
  await page.close();
});

// ------------------------------------------------------------------------------------------------ AR-03 AC-13 (L5p)

test('ar_03_ac13_phone_offers_no_excluded_action', async ({ browser }) => {
  test.setTimeout(240_000);
  await eachSurface(browser, async (page, how) => {
    const cmds = [...new Set((await controls(page)).filter((c) => !c.inert && c.command).map((c) => c.command!))];
    assert.deepEqual(cmds.filter(hiddenCommand), [], `${how}: no control carries a PHONE_HIDDEN_COMMANDS command`);
    assert.deepEqual(cmds.filter((c) => NOT_OFFERED_COMMANDS.includes(c)), [], `${how}: no control leads to a not-offered route`);
    const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    assert.deepEqual(hrefs.filter((h) => /#\/?(trash|home|graph|help\/shortcuts|settings\/(shortcuts|menu-bar|trash-history|previews|backups)|new\/|type-settings\/)/.test(h)), [], `${how}: no link to a not-offered route`);
    assert.equal(await page.getByText('This isn’t available yet.').count(), 0, `${how}: error.unsupported is never shown`);
  });
  // a not-offered route lands as an unknown route does
  const unknown = await phonePage(browser);
  await startPhone(unknown, { route: 'tohle-neexistuje' });
  const want = await eventually(() => mainName(unknown), (n) => !!n, 5000);
  await unknown.close();
  for (const route of NOT_OFFERED) {
    const page = await phonePage(browser);
    const core = await startPhone(page, { route });
    assert.equal(await eventually(() => mainName(page), (n) => n === want, 5000), want, `${route} lands as an unknown route (${want})`);
    assert.deepEqual((await core.calls()).map((c) => c.cmd).filter((c) => RA2_EXCLUDED.includes(c)), [], `${route}: no RA2-excluded invoke`);
    await page.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-54 (L5p)

test('fr_syn_06_ac54_reading_on_the_phone_writes_nothing', async ({ page }) => {
  test.setTimeout(300_000);
  const core = await startPhone(page, { route: 'inbox', uiState: ui({ extra: { dateTime: { date: 'iso', time: '24', week: 'region' } } }) });
  const before = await fileStateOf(core);
  const step = async (what: string, f: () => Promise<unknown>) => {
    await f();
    await sleep(150);
    assert.deepEqual(await writesSeen(core), [], `after ${what}: no write command`);
  };
  const h1 = async () => flat(await page.getByRole('banner').getByRole('heading', { level: 1 }).first().innerText().catch(() => ''));
  const go = async (entry: string, title: string) => { await drawerEntry(page, entry); await eventually(h1, (t) => t === title, 3000); };
  // every route through the drawer and the bottom bar
  for (const [entry, title] of [['Inbox', 'Inbox'], ['Tasks', 'Tasks'], ['Books', 'Books'], ['Autoři', 'Autoři'], ['Tags', 'Tags'], ['Queries', 'Queries'], ['Settings', 'Settings']] as const) await step(`drawer ${entry}`, () => go(entry, title));
  await step('bottom bar Search', () => barButton(page, 'Search').click());
  await step('bottom bar Today', () => barButton(page, 'Today').click());
  await step('the pinned query', async () => { await openDrawer(page); await drawer(page).locator('.sidebar-pinned [data-pinned-row]').nth(1).click(); });
  await step('a tag page', async () => { await go('Tags', 'Tags'); await main(page).locator('[data-tag]').first().click(); });
  await step('Back', async () => { await systemBack(page); });
  // every view tab, lanes to their end, Podle žánru folded and unfolded
  await go('Books', 'Books');
  for (const t of ['Rozečtené', 'Přečtené 2026', 'Výborné knihy', '']) await step(`the tab ${t || 'All Books'}`, () => main(page).locator(`[role="tab"][data-view-tab="${t}"]`).click());
  await step('Rozečtené lanes to their end', async () => {
    await main(page).locator('[role="tab"][data-view-tab="Rozečtené"]').click();
    await main(page).locator('[data-board]').first().evaluate((b) => { for (const e of [b, ...b.querySelectorAll('*')] as HTMLElement[]) if (e.scrollWidth > e.clientWidth + 1) e.scrollLeft = e.scrollWidth; });
  });
  await go('Queries', 'Queries');
  await step('Podle žánru folded and unfolded', async () => {
    await main(page).locator('[data-query-row="Podle žánru"]').first().click();
    const t = main(page).getByRole('button', { name: /^(Collapse|Expand) Poezie$/ });
    await t.click();
    await t.click();
  });
  // five notes, their sheets and source views
  for (const p of [PH.mapa, PH.siroky, PH.ven, PH.dlouha, B('Mapa bez severu')]) {
    await step(`the note ${p}`, async () => {
      if (p.startsWith('Books/')) { await go('Books', 'Books'); await main(page).locator('[role="tab"][data-view-tab=""]').click(); /* D-2456: All Books */ await main(page).locator(`[data-query-result="${nfc(p)}"]`).first().click(); }
      else { await barButton(page, 'Search').click(); await page.getByRole('search').getByRole('searchbox').or(page.getByRole('search').getByRole('textbox')).first().fill(p.split('/').pop()!.replace(/\.md$/, '')); await page.keyboard.press('Enter'); }
      await eventually(h1, (t) => t === nfc(p.split('/').pop()!.replace(/\.md$/, '')), 3000);
      await moreButton(page).click();
      await moreMenu(page).getByRole('menuitem', { name: 'Properties' }).click();
      await sheet(page, 'Properties').getByRole('button', { name: 'Close' }).click();
      await moreButton(page).click();
      await moreMenu(page).getByRole('menuitem', { name: 'Show Markdown source' }).click();
      await moreButton(page).click();
      await moreMenu(page).getByRole('menuitem', { name: 'Show formatted note' }).click();
    });
  }
  // Mapa výletu: zoom, pan, full screen, List
  await step('Mapa výletu\'s map', async () => {
    await barButton(page, 'Search').click();
    await page.getByRole('search').getByRole('searchbox').or(page.getByRole('search').getByRole('textbox')).first().fill('Mapa výletu');
    await page.keyboard.press('Enter');
    const fig = main(page).getByRole('figure', { name: 'Mindmap: Výlet' });
    await fig.getByRole('button', { name: 'Zoom in' }).click();
    const r = await rect(fig.locator('[data-map-area]'));
    await touchDrag(page, { x: r!.x + r!.width / 2, y: r!.y + r!.height / 2 }, -100, 0);
    await fig.getByRole('button', { name: 'Open full screen' }).click();
    await page.getByRole('dialog', { name: 'Mindmap: Výlet' }).getByRole('button', { name: 'Close full screen' }).click();
    await fig.getByRole('button', { name: 'List', exact: true }).click();
    // taps on New, on the Pasy checkbox, and the gestures of FR-NAV-03 AC-18
    await barButton(page, 'New').click({ force: true });
    await main(page).getByRole('checkbox').first().click({ force: true }).catch(() => undefined);
    await touchDrag(page, { x: 4, y: 400 }, 200, 0);
    await touchDrag(page, { x: 200, y: 400 }, -200, 0);
  });
  // three searches with a type and a tag filter
  for (const q of ['mapa', 'kniha', 'cesta']) {
    await step(`the search ${q}`, async () => {
      await barButton(page, 'Search').click();
      await page.getByRole('search').getByRole('searchbox').or(page.getByRole('search').getByRole('textbox')).first().fill(q);
      const filters = main(page).getByRole('group', { name: 'Filters' });
      await filters.getByRole('button', { name: /^Type: / }).click();
      await page.getByRole('menu', { name: 'Type' }).getByRole('menuitemradio').nth(1).click();
      const tag = filters.getByRole('combobox', { name: 'Filter by tag' });
      await tag.click();
      await page.keyboard.type('dop');
      await page.keyboard.press('Enter');
    });
  }
  // Today, previous and next day, the calendar
  await step('Today and the days around it', async () => {
    await barButton(page, 'Today').click();
    await main(page).getByRole('button', { name: 'Previous day', exact: true }).click();
    await main(page).getByRole('button', { name: 'Next day', exact: true }).click();
    await main(page).getByRole('button', { name: 'Pick date', exact: true }).click();
    await page.keyboard.press('Escape');
  });
  // [[Neexistuje]] in Odkazy ven
  await step('[[Neexistuje]]', async () => {
    await barButton(page, 'Search').click();
    await page.getByRole('search').getByRole('searchbox').or(page.getByRole('search').getByRole('textbox')).first().fill('Odkazy ven');
    await page.keyboard.press('Enter');
    await page.getByRole('article', { name: 'Odkazy ven' }).getByRole('link', { name: 'Neexistuje' }).click();
  });
  // Settings: theme and date format
  await step('the theme and the date format', async () => {
    await go('Settings', 'Settings');
    await main(page).getByRole('link', { name: 'Appearance', exact: true }).click();
    await main(page).getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }).click();
    await systemBack(page);
    await main(page).getByRole('link', { name: 'Date & time', exact: true }).click();
    await main(page).getByRole('combobox', { name: 'Date format' }).selectOption('long'); // D-2459: the native select
  });
  await assertZeroWrites(core, before, 'the reading tour');
  const calls = (await core.calls()).map((c) => c.cmd);
  assert.deepEqual(calls.filter((c) => RA2_EXCLUDED.includes(c)), [], 'no invoke of an RA2-excluded command during the tour (AR-03 AC-13)');
  assert.equal(await page.getByText('This isn’t available yet.').count(), 0, 'error.unsupported is never shown');
});

/** D-2462: opens the drawer and waits until its 200 ms slide (contract §8) has ended: its left edge stays put. */
async function drawerSettled(page: Page): Promise<void> {
  const d = await openDrawer(page);
  let last = NaN;
  for (let i = 0; i < 40; i++) {
    const x = (await rect(d))?.x ?? NaN;
    if (x === last && x >= -0.5) return;
    last = x;
    await sleep(50);
  }
}
