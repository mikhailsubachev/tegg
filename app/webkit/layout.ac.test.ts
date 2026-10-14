// MS3 slice 3A, L5 (WebKit + fake core): FR-UX-02 layout and page flow, FR-UX-01 AC-1 and AC-3.
// Written from docs/acceptance/app-shell.md and docs/contracts/ms3-shell.md only (D-61). Assertions use node:assert
// so a failure is an AssertionError (TS-I1, tools/qa CONTRACT §5.2).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { R1, R2, R3, TYPES_CS, TYPE_KEYS, expandReqs, showDue } from '../test/shell-tables';
import {
  P, absent, box, catalogText, collation, eventually, focused, gotoType, mainName, must, mustBeOn, nonReadCalls,
  onPage, openNote, panel, routeDefs, runCommand, seen, shellVault, sidebar, sleep, start, typeEntries, typesList,
} from './helpers';

const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

async function regionRects(page: Page) {
  return page.evaluate(() => {
    const r = (e: Element | null) => (e ? (({ x, y, width, height }) => ({ x, y, width, height }))(e.getBoundingClientRect()) : null);
    const tab = document.querySelector('[role="tab"]');
    let bar: Element | null = tab;
    while (bar && bar.parentElement && bar.getBoundingClientRect().width < window.innerWidth * 0.9) bar = bar.parentElement;
    const visible = (e: Element | null) => (e && (e as HTMLElement).getClientRects().length > 0 ? e : null);
    return {
      titlebar: r(tab ? bar : null),
      sidebar: r(visible(document.querySelector('nav[aria-label="Sidebar"]'))),
      main: r(visible(document.querySelector('main'))),
      aside: r(visible(document.querySelector('aside[aria-label="Context panel"]'))),
    };
  });
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x + 0.5 < b.x + b.width && b.x + 0.5 < a.x + a.width && a.y + 0.5 < b.y + b.height && b.y + 0.5 < a.y + a.height;
}

test('fr_ux_02_ac1_regions_sizes_and_no_overlap', async ({ page }) => {
  await start(page);
  for (const withPanel of [false, true]) {
    if (withPanel) {
      await openNote(page, '2026-10-07 Porada');
      await page.keyboard.press('Meta+Backslash');
      await must(panel(page), 'Context panel');
    }
    const r = await regionRects(page);
    assert.ok(r.titlebar, 'title bar with the tab strip');
    assert.ok(near(r.titlebar.height, 44), `title bar height ${r.titlebar.height}`);
    assert.ok(r.sidebar && near(r.sidebar.width, 232), `sidebar width ${r.sidebar?.width}`);
    assert.ok(r.main, 'main centre pane');
    if (withPanel) assert.ok(r.aside && near(r.aside.width, 288), `context panel width ${r.aside?.width}`);
    const rs = [r.titlebar, r.sidebar, r.main, ...(withPanel ? [r.aside!] : [])];
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) assert.ok(!overlaps(rs[i]!, rs[j]!), `regions ${i} and ${j} overlap`);
  }
});

test('fr_ux_02_ac2_sidebar_content_and_order', async ({ page }) => {
  await start(page);
  const sb = sidebar(page);
  const parts = [
    sb.getByRole('link', { name: 'Tegg home', exact: true }),
    sb.getByRole('button', { name: 'Search or jump to…' }),
    sb.getByRole('button', { name: 'New object' }),
    sb.getByText('Home', { exact: true }),
    sb.getByText('Inbox', { exact: true }),
    sb.getByText('Today', { exact: true }),
    sb.getByText('Tasks', { exact: true }).first(),
    sb.getByRole('button', { name: 'New type' }),
    sb.getByRole('list', { name: 'Types' }),
    sb.getByText('Tags', { exact: true }),
    sb.getByText('Pinned', { exact: true }),
    sb.getByText('Saved queries', { exact: true }),
  ];
  const names = ['logo', 'switcher field', 'New object', 'Home', 'Inbox', 'Today', 'Tasks', 'New type', 'Types list', 'Tags', 'Pinned', 'Saved queries'];
  const tops: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const b = await box(parts[i]);
    assert.ok(b, `sidebar: ${names[i]} is not shown`);
    tops.push(b.y);
  }
  for (let i = 1; i < tops.length; i++) assert.ok(tops[i] >= tops[i - 1], `sidebar order: ${names[i]} above ${names[i - 1]}`);
  const sw = await sb.getByRole('button', { name: 'Search or jump to…' }).innerText();
  assert.match(sw, /⌘O/);
  assert.match(await sb.getByRole('button', { name: 'New object' }).innerText(), /⌘N/);
  // TBD entries show no count; Today shows ⌘D.
  for (const e of ['Home', 'Inbox', 'Today', 'Tasks', 'Pinned', 'Saved queries']) {
    const row = sb.locator('a, button, [role="link"], [role="button"]').filter({ has: page.getByText(e, { exact: true }) }).first();
    const text = (await row.innerText()).replace(e, '').replace('⌘D', '');
    assert.ok(!/\d/.test(text), `${e} shows a count: ${text}`);
  }
  assert.match(await sb.locator('a, button, [role="link"], [role="button"]').filter({ has: page.getByText('Today', { exact: true }) }).first().innerText(), /⌘D/);
  // Logo leads home; the Tags section has one entry leading to `tags`.
  await runCommand(page, 'Go to Inbox');
  await sb.getByRole('link', { name: 'Tegg home', exact: true }).click();
  await mustBeOn(page, 'Home', 'logo link');
  await sb.getByText('Tags', { exact: true }).click();
  await mustBeOn(page, 'Tags', 'Tags section entry');
});

async function typesOrder(page: Page, prelude: string | undefined) {
  await start(page, { prelude });
  await must(typesList(page), 'Types list');
  return eventually(() => typeEntries(page), (v) => v.length >= 10);
}

test('fr_ux_02_ac4_types_list_cs_order_and_counts', async ({ page }) => {
  const entries = await typesOrder(page, collation('cs'));
  assert.deepEqual(entries.map(([l, c]) => [TYPES_CS.find(([x]) => String(l).startsWith(x))?.[0] ?? l, c]), TYPES_CS);
  assert.ok(!entries.some(([l]) => /^Tags?\b/.test(l)), 'Tag is not in the Types list');
  // recept is marked as having no type definition.
  const recept = typesList(page).getByRole('listitem').filter({ hasText: 'recept' }).first();
  const mark = await recept.evaluate((e) => {
    const d = e.querySelector('[aria-description], [title], [aria-describedby]') ?? e;
    return (d.getAttribute('aria-description') ?? d.getAttribute('title') ?? (d.getAttribute('aria-describedby') ? 'described' : '')).trim();
  });
  assert.notEqual(mark, '', 'recept carries a "no type definition" mark');
  // Each entry leads to its type/<type> route.
  for (const [label] of TYPES_CS) {
    await typesList(page).getByRole('listitem').filter({ hasText: label }).first().click();
    await mustBeOn(page, label, `Types entry ${label} → type/${TYPE_KEYS[label]}`);
  }
});

test('fr_ux_02_ac4_types_list_en_and_code_point_order', async ({ page, browser }) => {
  const en = await typesOrder(page, collation('en'));
  const user = (xs: [string, number][]) => xs.map(([l]) => l).filter((l) => ['Cesty', 'Čajovny', 'Schůzky'].some((u) => l.startsWith(u)));
  assert.deepEqual(user(en), ['Čajovny', 'Cesty', 'Schůzky'], 'en');
  // "No locale gives the code-point order" (AC-4, D-122): without a region locale the UI language's collation is
  // used (WebKit here: en), never code-point order (Cesty, Schůzky, Čajovny).
  const p2 = await browser.newPage();
  const none = await typesOrder(p2, undefined);
  assert.notDeepEqual(user(none), ['Cesty', 'Schůzky', 'Čajovny'], 'no locale: never code-point order');
  assert.deepEqual(user(none), ['Čajovny', 'Cesty', 'Schůzky'], 'no locale: the UI language (en)');
  await p2.close();
});

test('fr_ux_02_ac5_counts_follow_vault_changed_events', async ({ page }) => {
  const core = await start(page, { prelude: collation('cs') });
  await must(typesList(page), 'Types list');
  const count = async (label: string) => (await typeEntries(page)).find(([l]) => l.startsWith(label))?.[1] ?? null;
  const text = '---\ntype: quick-note\ntitle: Třetí nápad\n---\nDalší nápad.\n';
  await core.setFile('Quick Notes/Třetí nápad.md', text);
  assert.equal(await eventually(() => count('Quick Notes'), (n) => n === 3, 2000), 3, 'Quick Notes after create');
  await core.setFile('Quick Notes/Třetí nápad.md', null);
  await core.setFile('.trash/Quick Notes/Třetí nápad.md', text);
  assert.equal(await eventually(() => count('Quick Notes'), (n) => n === 2, 2000), 2, 'Quick Notes after move to .trash');
  await core.setFile(P.porada, null);
  assert.equal(await eventually(() => count('Schůzky'), (n) => n === 0, 2000), 0, 'Schůzky after delete (entry stays)');
});

test('fr_ux_02_ac7_right_panel_toggle_tabs_and_placeholders', async ({ page }) => {
  await start(page);
  // Routes without an object: no toggle, ⌘\ does nothing.
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'Go to Inbox');
  assert.equal(await page.getByRole('button', { name: 'Toggle right panel' }).count(), 0, 'toggle absent on routes without an object');
  await page.keyboard.press('Meta+Backslash');
  assert.ok(await absent(panel(page), 500), '⌘\\ opened the panel on a route without an object');

  await openNote(page, '2026-10-07 Porada');
  const main = page.getByRole('main');
  for (const how of ['shortcut', 'button'] as const) {
    const before = (await main.boundingBox())!.width;
    if (how === 'shortcut') await page.keyboard.press('Meta+Backslash');
    else await (await must(page.getByRole('button', { name: 'Toggle right panel' }), 'Toggle right panel')).click();
    await must(panel(page), `Context panel opened by ${how}`);
    const pw = (await panel(page).boundingBox())!.width;
    const opened = (await main.boundingBox())!.width;
    assert.ok(near(before - opened, pw), `${how}: centre narrowed by ${before - opened}, panel ${pw}`);
    const tabs = await panel(page).getByRole('tab').allInnerTexts();
    assert.deepEqual(tabs.map((t) => t.trim()), R2.map((t) => t.tab), 'R2 tabs in order');
    for (const t of R2) {
      await panel(page).getByRole('tab', { name: t.tab }).click();
      const region = panel(page).getByRole('region', { name: t.tab });
      await must(region, `${t.tab} placeholder in the panel`);
      assert.match(await region.innerText(), new RegExp(`Coming in ${showDue(t.due).replace(/[.()]/g, '\\$&')}`));
    }
    if (how === 'shortcut') await page.keyboard.press('Meta+Backslash');
    else await page.getByRole('button', { name: 'Toggle right panel' }).click();
    assert.ok(await absent(panel(page)), `${how}: panel closes`);
    assert.ok(near((await main.boundingBox())!.width, before), `${how}: centre widens back`);
  }
});

test('fr_ux_02_ac8_collapsible_sidebar_keeps_selection_and_scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  await start(page);
  await sidebar(page).getByText('Inbox', { exact: true }).click();
  await mustBeOn(page, 'Inbox', 'sidebar Inbox');
  const scrollTop = await sidebar(page).evaluate((nav) => {
    const els = [nav, ...nav.querySelectorAll('*')] as HTMLElement[];
    const s = els.find((e) => e.scrollHeight > e.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
    if (!s) return -1;
    s.scrollTop = 37;
    return s.scrollTop;
  });
  assert.ok(scrollTop > 0, 'the sidebar scrolls at 1440 × 500');
  const main = page.getByRole('main');
  for (const how of ['shortcut', 'control'] as const) {
    const before = (await main.boundingBox())!.width;
    if (how === 'shortcut') await page.keyboard.press('Control+Meta+s');
    else await (await must(page.locator('[data-command="view.toggleSidebar"]'), 'sidebar collapse control')).click();
    assert.ok(await absent(sidebar(page)), `${how}: sidebar hidden`);
    assert.equal(await page.getByRole('navigation', { name: 'Sidebar' }).count(), 0, `${how}: sidebar left the accessibility tree`);
    assert.ok(near((await main.boundingBox())!.width - before, 232), `${how}: centre widened by 232`);
    if (how === 'shortcut') await page.keyboard.press('Control+Meta+s');
    else await page.locator('[data-command="view.toggleSidebar"]').first().click();
    await must(sidebar(page), `${how}: sidebar restored`);
    const restored = await sidebar(page).evaluate((nav) => {
      const els = [nav, ...nav.querySelectorAll('*')] as HTMLElement[];
      const s = els.find((e) => e.scrollHeight > e.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
      const cur = nav.querySelector('[aria-current="page"]');
      return { scroll: s?.scrollTop ?? -1, current: cur?.textContent?.trim() ?? null };
    });
    assert.equal(restored.scroll, scrollTop, `${how}: scroll position restored`);
    assert.match(restored.current ?? '', /^Inbox/, `${how}: selected entry restored`);
  }
});

test('fr_ux_02_ac9_focus_mode_restores_all_four_states', async ({ page }) => {
  await start(page);
  await openNote(page, '2026-10-07 Porada');
  const titleTab = page.locator('[role="tab"]').filter({ hasNot: panel(page) });
  for (const sidebarOpen of [true, false]) {
    for (const panelOpen of [false, true]) {
      for (const exit of ['shortcut', 'Escape'] as const) {
        const label = `sidebar ${sidebarOpen ? 'open' : 'collapsed'}, panel ${panelOpen ? 'open' : 'closed'}, exit by ${exit}`;
        if ((await seen(sidebar(page), 300)) !== sidebarOpen) await page.keyboard.press('Control+Meta+s');
        if ((await seen(panel(page), 300)) !== panelOpen) await page.keyboard.press('Meta+Backslash');
        assert.equal(await seen(sidebar(page), 500), sidebarOpen, `${label}: setup sidebar`);
        assert.equal(await seen(panel(page), 500), panelOpen, `${label}: setup panel`);
        await page.getByRole('main').getByRole('heading', { level: 1 }).focus();
        await page.keyboard.press('Meta+Shift+Backslash');
        assert.ok(await absent(sidebar(page)), `${label}: sidebar hidden in focus mode`);
        assert.ok(await absent(panel(page)), `${label}: panel hidden in focus mode`);
        assert.ok(await absent(titleTab), `${label}: tab strip hidden`);
        assert.ok(await absent(page.getByRole('button', { name: 'Toggle right panel' })), `${label}: note toolbar hidden`);
        assert.ok(await seen(page.getByRole('main')), `${label}: note column remains`);
        assert.ok((await focused(page)).inMain, `${label}: focus stays in the centre pane`);
        await page.keyboard.press(exit === 'shortcut' ? 'Meta+Shift+Backslash' : 'Escape');
        assert.equal(await seen(sidebar(page), 1000), sidebarOpen, `${label}: sidebar state restored`);
        assert.equal(await seen(panel(page), 1000), panelOpen, `${label}: panel state restored`);
        assert.ok((await focused(page)).inMain, `${label}: focus in the centre pane after leaving`);
      }
    }
  }
  // The toolbar button enters focus mode too.
  await (await must(page.getByRole('button', { name: 'Focus mode' }), 'Focus mode button')).click();
  assert.ok(await absent(sidebar(page)), 'Focus mode button hides the sidebar');
});

test('fr_ux_02_ac11_tbd_routes_render_placeholders_and_are_reachable', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Meta+k');
  await must(page.getByRole('dialog', { name: 'Command palette' }), 'Command palette');
  await page.keyboard.press('Escape');
  const defs = await routeDefs(page);
  const failures: string[] = [];
  const check = async (row: (typeof R1)[number], how: string) => {
    if (!(await onPage(page, row.page, 2000))) { failures.push(`${row.id}: ${how} → ${await mainName(page)}`); return; }
    if (row.built) return;
    const region = page.getByRole('main').getByRole('region', { name: row.page });
    if (!(await seen(region, 1000))) { failures.push(`${row.id}: no placeholder region`); return; }
    const text = await region.innerText();
    const def = defs.find((d) => d.id === row.id);
    const purpose = def ? await catalogText(page, def.purpose) : '';
    const want = [row.page, `Coming in ${showDue(row.due)}`, row.design ? `View design: ${row.design}` : 'No design board yet'];
    if (!purpose || purpose === def?.purpose || !text.includes(purpose)) failures.push(`${row.id}: purpose missing`);
    for (const w of want) if (!text.includes(w)) failures.push(`${row.id}: "${w}" missing`);
    const shown = expandReqs((text.match(/[A-Z]+-[A-Z]+-\d+(?:…\d+)?(?:,\s*-\d+)*/g) ?? []).join(', '));
    for (const id of expandReqs(row.reqs)) if (!shown.includes(id)) failures.push(`${row.id}: requirement ${id} missing`);
  };
  for (const row of R1) {
    if (row.goto) { await runCommand(page, row.goto); await check(row, `palette "${row.goto}"`); }
  }
  // Other means from the "Reached by" column.
  const viaSidebar: [string, string][] = [['Home', 'home'], ['Inbox', 'inbox'], ['Today', 'today'], ['Tasks', 'tasks'], ['Pinned', 'pinned'], ['Saved queries', 'saved-queries'], ['Tags', 'tags']];
  for (const [entry, id] of viaSidebar) {
    await sidebar(page).getByText(entry, { exact: true }).first().click().catch(() => failures.push(`${id}: sidebar entry ${entry} missing`));
    await check(R1.find((r) => r.id === id)!, `sidebar ${entry}`);
  }
  await sidebar(page).getByRole('link', { name: 'Tegg home' }).click().catch(() => failures.push('home: logo missing'));
  await check(R1.find((r) => r.id === 'home')!, 'logo');
  for (const [keys, id] of [['Meta+d', 'today'], ['Meta+Shift+i', 'inbox'], ['Meta+Shift+f', 'search'], ['Meta+Comma', 'settings/appearance']] as const) {
    await page.locator('body').click({ position: { x: 700, y: 600 } }).catch(() => {});
    await page.keyboard.press(keys);
    await check(R1.find((r) => r.id === id)!, keys);
  }
  // Settings section list.
  for (const row of R1.filter((r) => r.id.startsWith('settings/') && r.id !== 'settings/appearance')) {
    await page.keyboard.press('Meta+Comma');
    await page.getByRole('main').getByRole('link', { name: row.page.replace('Settings: ', ''), exact: true }).click().catch(() => failures.push(`${row.id}: settings section link missing`));
    await check(row, 'settings section list');
  }
  // Type settings from the type page; chooser from the palette.
  await gotoType(page, 'Quick Notes');
  await page.getByRole('main').getByRole('button', { name: 'Type settings' }).or(page.getByRole('main').getByRole('link', { name: 'Type settings' })).first().click().catch(() => failures.push('type-settings: control missing'));
  await check(R1.find((r) => r.id === 'type-settings/<type>')!, 'type page control');
  for (const cmd of ['Open vault…', 'Create new vault…']) {
    await runCommand(page, cmd);
    if (!(await seen(page.getByRole('main', { name: 'Choose a vault' }), 2000)) && !(await seen(page.getByRole('form', { name: 'New vault' }), 500))) failures.push(`chooser: ${cmd}`);
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(failures, []);
});

test('fr_ux_02_ac12_disabled_controls_are_inert_and_explained', async ({ page }) => {
  const core = await start(page);
  const failures: string[] = [];
  const places: Record<string, () => Promise<void>> = {
    'title bar': async () => { await runCommand(page, 'Go to Inbox'); },
    'sidebar, Types header': async () => {},
    'note toolbar': async () => { await openNote(page, '2026-10-07 Porada'); },
    'note header': async () => { await openNote(page, '2026-10-07 Porada'); },
    'type page': async () => { await gotoType(page, 'Quick Notes'); },
    'Settings: Appearance': async () => { await page.keyboard.press('Meta+Comma'); },
    'New object dialog': async () => { await page.keyboard.press('Meta+n'); },
    'chooser, New vault form': async () => { await runCommand(page, 'Create new vault…'); },
  };
  await must(sidebar(page), 'frame');
  for (const c of R3) {
    await page.keyboard.press('Escape');
    if (!places[c.where]) continue; // 3C controls inside the editor's menus are checked in editor.ac.test.ts (editor.md R3)
    await places[c.where]();
    const label = c.label === 'New <Type>' ? 'New Quick Note' : c.label;
    const el = page.locator(`[aria-disabled="true"]`).filter({ hasText: new RegExp(`^\\s*${label.replace(/[+()]/g, '\\$&')}`) })
      .or(page.locator(`[aria-disabled="true"][aria-label^="${label}"]`)).first();
    if (!(await seen(el, 1500))) { failures.push(`${c.label}: not rendered with aria-disabled="true"`); continue; }
    const info = await el.evaluate((e) => {
      const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      const desc = e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      return { tabIndex: (e as HTMLElement).tabIndex, disabledAttr: e.hasAttribute('disabled'), desc: desc.trim() };
    });
    const want = `Coming in ${showDue(c.due)}`;
    if (info.tabIndex < 0 || info.disabledAttr) failures.push(`${c.label}: not keyboard-focusable`);
    if (info.desc !== want) failures.push(`${c.label}: description "${info.desc}" ≠ "${want}"`);
    await el.hover();
    if (!(await seen(page.getByRole('tooltip').filter({ hasText: want }), 1500))) failures.push(`${c.label}: no tooltip on hover`);
    await page.mouse.move(1, 1);
    await el.focus();
    if (!(await seen(page.getByRole('tooltip').filter({ hasText: want }), 1500))) failures.push(`${c.label}: no tooltip on focus`);
    const routeBefore = await mainName(page);
    const writesBefore = (await nonReadCalls(core)).length;
    await el.click({ force: true });
    await el.focus(); await page.keyboard.press('Enter');
    await el.focus(); await page.keyboard.press('Space');
    if (c.label === 'New tab') await page.keyboard.press('Meta+t');
    if (c.label === 'Back') await page.keyboard.press('Meta+BracketLeft');
    if (c.label === 'Forward') await page.keyboard.press('Meta+BracketRight');
    await sleep(200);
    if ((await mainName(page)) !== routeBefore) failures.push(`${c.label}: activation changed the route`);
    if ((await nonReadCalls(core)).length !== writesBefore) failures.push(`${c.label}: activation sent a non-read command`);
  }
  assert.equal(await core.writes(), 0, 'nothing written');
  assert.deepEqual(failures, []);
});

test('fr_ux_02_ac14_note_page_breadcrumb_title_and_read_view', async ({ page }) => {
  await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; }); // D-215: the read view
  const core = await start(page);
  await openNote(page, '2026-10-07 Porada');
  const main = page.getByRole('main');
  assert.match((await main.innerText()).replace(/\s+/g, ' '), /Schůzky\s*\/\s*2026-10-07 Porada/, 'breadcrumb');
  assert.equal((await main.getByRole('heading', { level: 1 }).first().innerText()).trim(), '2026-10-07 Porada', 'title');
  // D-150: the note page shows the formatted read view (read-view.md), not the raw file.
  const body = main.getByRole('article', { name: '2026-10-07 Porada', exact: true });
  assert.ok(await seen(body), 'the formatted read view');
  assert.match(await body.innerText(), /Týdenní porada, rozpočet a výlet\./, 'the body text');
  assert.ok(!(await body.innerText()).includes('id: 01JA'), 'not the raw file');
  for (const [title, crumb] of [['Bez hlavičky', /Pages\s*\/\s*Bez hlavičky/], ['Svíčková', /recept\s*\/\s*Svíčková/]] as const) {
    await openNote(page, title);
    assert.match((await page.getByRole('main').innerText()).replace(/\s+/g, ' '), crumb, `${title} breadcrumb`);
  }
  await openNote(page, '2026-10-07 Porada');
  await main.getByRole('link', { name: 'Schůzky', exact: true }).click();
  await mustBeOn(page, 'Schůzky', 'breadcrumb type link → type/schůzka');
  assert.equal(await core.writes(), 0, 'opening notes wrote nothing');
  assert.deepEqual(await nonReadCalls(core), []);
});

test('fr_ux_02_ac15_single_title_bar_tab_follows_navigation', async ({ page }) => {
  await start(page);
  const steps: [() => Promise<void>, string][] = [
    [() => runCommand(page, 'Go to Inbox'), 'Inbox'],
    [() => gotoType(page, 'Quick Notes'), 'Quick Notes'],
    [() => openNote(page, 'Zavolat Evě'), 'Zavolat Evě'],
    [() => page.keyboard.press('Meta+Comma'), 'Settings: Appearance'],
    [() => runCommand(page, 'Go to Home'), 'Home'],
  ];
  for (const [go, name] of steps) {
    await go();
    const tabs = page.locator('[role="tab"]:not(aside [role="tab"])');
    const got = await eventually(async () => (await tabs.allInnerTexts()).map((t) => t.trim()), (t) => t.length === 1 && t[0] === name);
    assert.deepEqual(got, [name], `exactly one tab named "${name}"`);
    assert.ok((await tabs.first().locator('svg, img, [data-icon]').count()) > 0, `${name}: tab has an icon`);
  }
});

test('fr_ux_02_ac16_launch_landing_follows_core_answer', async ({ browser }) => {
  const cases: { what: string; last: { path: string; id: string | null } | null; edit?: (v: ReturnType<typeof shellVault>) => void; want: string }[] = [
    { what: '(a) last note Eva', last: { path: P.eva, id: '01JA0H0000000000000000H004' }, want: 'Zavolat Evě' },
    { what: '(b) no note opened', last: null, want: 'Home' },
    {
      what: '(c) renamed by another program', last: { path: P.eva, id: '01JA0H0000000000000000H004' }, want: 'Zavolat Evě',
      edit: (v) => { v.files['Tasks/Zavolat Evě a Petrovi.md'] = v.files[P.eva]; delete v.files[P.eva]; },
    },
    { what: '(d) deleted', last: { path: P.eva, id: '01JA0H0000000000000000H004' }, want: 'Home', edit: (v) => { delete v.files[P.eva]; } },
    {
      what: '(d) moved to .trash', last: { path: P.eva, id: '01JA0H0000000000000000H004' }, want: 'Home',
      edit: (v) => { v.files['.trash/Tasks/Zavolat Evě.md'] = v.files[P.eva]; delete v.files[P.eva]; },
    },
  ];
  for (const c of cases) {
    const page = await browser.newPage();
    const vault = shellVault();
    c.edit?.(vault);
    const core = await start(page, { vault, last: c.last });
    await mustBeOn(page, c.want, c.what);
    if (c.what.startsWith('(c)')) {
      const reads = (await core.calls()).filter((x) => x.cmd === 'note_read').map((x) => (x.args as { path: string }).path);
      assert.ok(reads.includes('Tasks/Zavolat Evě a Petrovi.md'), `${c.what}: the renamed file is opened`);
    }
    assert.equal(await page.getByRole('dialog').count(), 0, `${c.what}: no dialog`);
    assert.equal(await page.getByRole('alertdialog').count(), 0, `${c.what}: no error dialog`);
    assert.equal(await core.writes(), 0, `${c.what}: no writes`);
    await page.close();
  }
});

test('fr_ux_02_ac17_type_page_lists_sorted_rows_and_opens_them', async ({ page }) => {
  const core = await start(page, { prelude: collation('cs') });
  const rows = (p: Page) => p.getByRole('main').locator('[role="row"], [role="listitem"], li').filter({ has: p.locator('[data-user-content]') });
  const titles = async () => (await rows(page).allInnerTexts()).map((t) => t.split('\n')[0].trim());
  await gotoType(page, 'Quick Notes');
  assert.deepEqual(await eventually(titles, (t) => t.length === 2), ['Druhý nápad', 'Nápad na čtvrtek'], 'type/quick-note');
  await gotoType(page, 'Pages');
  assert.deepEqual(await eventually(titles, (t) => t.length === 2), ['Bez hlavičky', 'Úvodní stránka'], 'type/page');
  await gotoType(page, 'Cesty');
  assert.deepEqual(await titles(), [], 'type/cesta is empty');
  const guide = (await page.getByRole('main').innerText()).replace('Cesty', '').trim();
  assert.ok(guide.length > 0, 'type/cesta shows a guiding message');
  for (const t of ['Šablona', 'Smazaná stránka']) assert.equal(await page.getByText(t).count(), 0, `${t} is never listed`);
  // Activation by click and by ⏎.
  await gotoType(page, 'Quick Notes');
  await rows(page).filter({ hasText: 'Druhý nápad' }).first().click();
  await mustBeOn(page, 'Druhý nápad', 'row click');
  await gotoType(page, 'Quick Notes');
  await rows(page).filter({ hasText: 'Nápad na čtvrtek' }).first().focus();
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Nápad na čtvrtek', 'row ⏎');
  // R3 controls on the type page and Type settings.
  await gotoType(page, 'Quick Notes');
  for (const label of ['Filter', 'Sort', 'Views', 'New Quick Note']) {
    const c = page.getByRole('main').locator(`[aria-disabled="true"]`).filter({ hasText: label }).or(page.getByRole('main').locator(`[aria-disabled="true"][aria-label="${label}"]`));
    assert.ok(await seen(c, 1000), `${label} is a disabled control`);
  }
  await page.getByRole('main').getByRole('button', { name: 'Type settings' }).or(page.getByRole('main').getByRole('link', { name: 'Type settings' })).first().click();
  await mustBeOn(page, 'Type settings', 'Type settings control');
  assert.ok(await seen(page.getByRole('main').getByRole('region', { name: 'Type settings' })), 'type-settings placeholder');
  assert.equal(await core.writes(), 0);
});

test('fr_ux_02_ac18_reflow_at_minimum_size', async ({ page }) => {
  await start(page);
  await openNote(page, '2026-10-07 Porada');
  await page.keyboard.press('Meta+Backslash');
  await must(panel(page), 'Context panel at 1440');
  await page.setViewportSize({ width: 800, height: 500 });
  await sleep(300);
  const mainW = (await page.getByRole('main').boundingBox())?.width ?? 0;
  assert.ok(mainW >= 400, `centre pane ${mainW} px at 800 × 500`);
  assert.ok(await absent(panel(page), 1000), 'the right panel closes by itself below the width that fits');
  const labels = await sidebar(page).evaluate((nav) => {
    const out: string[] = [];
    for (const e of nav.querySelectorAll('a, button, [role="link"], [role="button"], li')) {
      const el = e as HTMLElement;
      const text = el.textContent?.trim() ?? '';
      if (!text) continue;
      const clipped = el.scrollWidth > el.clientWidth + 1;
      const ellipsis = getComputedStyle(el).textOverflow === 'ellipsis' || [...el.querySelectorAll('*')].some((c) => getComputedStyle(c).textOverflow === 'ellipsis');
      const tip = el.getAttribute('title') ?? el.querySelector('[title]')?.getAttribute('title') ?? '';
      if (clipped && !(ellipsis && tip.length > 0)) out.push(text);
    }
    return out;
  });
  assert.deepEqual(labels, [], 'sidebar labels clipped without ellipsis and tooltip');
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.ok(await seen(panel(page), 1500), 'the right panel reopens when the window is widened');
});

test('fr_ux_01_ac1_note_column_max_760_and_centred', async ({ page }) => {
  await start(page);
  await openNote(page, '2026-10-07 Porada');
  const failures: string[] = [];
  for (const width of [1024, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    for (const panelOpen of [false, true]) {
      if ((await seen(panel(page), 300)) !== panelOpen) await page.keyboard.press('Meta+Backslash');
      await sleep(150);
      const g = await page.getByRole('main').evaluate((m) => {
        const h = m.querySelector('h1');
        const mb = m.getBoundingClientRect();
        let col: Element | null = h;
        let best: DOMRect | null = null;
        while (col && col !== m) {
          const r = col.getBoundingClientRect();
          if (r.width < mb.width - 2) best = r;
          col = col.parentElement;
        }
        return best ? { main: { x: mb.x, w: mb.width }, col: { x: best.x, w: best.width } } : null;
      });
      if (!g) { failures.push(`${width}/${panelOpen}: no note column narrower than the centre pane`); continue; }
      const left = g.col.x - g.main.x;
      const right = g.main.x + g.main.w - (g.col.x + g.col.w);
      if (g.col.w > 760) failures.push(`${width}/${panelOpen}: column ${g.col.w} px`);
      if (Math.abs(left - right) > 1) failures.push(`${width}/${panelOpen}: margins ${left} / ${right}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('fr_ux_01_ac3_typography', async ({ page }) => {
  await start(page);
  const style = async (sel: string) => page.locator(sel).first().evaluate((e) => {
    const s = getComputedStyle(e);
    return { family: s.fontFamily, size: s.fontSize, lineHeight: s.lineHeight };
  });
  const body = await style('body');
  assert.match(body.family, /-apple-system/, 'system font stack');
  assert.equal(body.size, '14px', 'UI body text');
  assert.equal(body.lineHeight, '21px', 'line height 1.5');
  const entry = await sidebar(page).getByText('Inbox', { exact: true }).evaluate((e) => getComputedStyle(e).fontSize);
  assert.equal(entry, '13px', 'sidebar entries');
  await runCommand(page, 'Go to Home');
  await mustBeOn(page, 'Home', 'Go to Home');
  assert.equal(await page.getByRole('main').getByRole('heading', { level: 1 }).first().evaluate((e) => getComputedStyle(e).fontSize), '30px', 'Home heading');
  await gotoType(page, 'Quick Notes');
  assert.equal(await page.getByRole('main').getByRole('heading', { level: 1 }).first().evaluate((e) => getComputedStyle(e).fontSize), '30px', 'type page heading');
  await openNote(page, '2026-10-07 Porada');
  assert.equal(await page.getByRole('main').getByRole('heading', { level: 1 }).first().evaluate((e) => getComputedStyle(e).fontSize), '34px', 'note title');
});

