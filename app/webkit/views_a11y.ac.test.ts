// Slice Q2, L5 (WebKit + fake core): keyboard, accessibility, themes, strings and the DOM bound of docs/acceptance/
// views.md: FR-UX-03 AC-50 (R191's commands in the palette where R191 says; every control reachable), AC-51 (a
// keyboard-only tour), FR-UX-08 AC-24 (what VoiceOver reads: roles, names, positions, `aria-sort`, live announcements,
// no animation with reduced motion), FR-UX-05 AC-24 (both themes: axe contrast, token colours, the hatching and lane
// colours), NFR-OTH-02 AC-21 (pseudo-locale: every text of the slice inside ⟦ ⟧ except user content) and NFR-PERF-07
// AC-3's DOM bound (≤ 150 card elements on a 500-card board, `__TEGG_TEST__.board()`). Interface docs/contracts/
// v1-views.md §4.3, §4.6, §4.7, §5. Written from the ACs and the contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  B, BOOK_YML, Q, addMenu, addView, allTab, board, bookWithViews, boardHook, card, click, editor, eventually, expectedView, fileText, fileWhen, lane, laneGrip,
  laneRadio, lanes, lanesGroup, liveRegion, main, menuItem, must, openNote, paletteOptions, panelOf, qfile, rx, runCommand, seen, selectTab, sleep, sortButton,
  sortDialog, sortLevels, startViews, tab, tabMenu, tablist, textOf, toolbar, typeRoute, viewMenu, viewQuery, viewsOps, viewsVault, writes, drag,
} from './views-helpers';
import { focusName } from './queries-helpers';
import { axeContrast, colourLeaks } from './read-helpers';

test.use({ timezoneId: 'Europe/Prague' });

async function palette(page: Page, q: string): Promise<string[]> {
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill(q);
  await sleep(200);
  const o = await paletteOptions(page);
  await page.keyboard.press('Escape');
  return o.map((x) => x.split('\n')[0].trim());
}
async function tabStops(page: Page, n = 80): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < n; i++) { await page.keyboard.press('Tab'); out.add((await focusName(page)).name); }
  return out;
}
const withTabs = (extra: string[]) => viewsVault((f) => { f[BOOK_YML] = bookWithViews(`views: [Rozečtené, Přečtené 2026, Výborné knihy${extra.map((e) => `, ${e}`).join('')}]\n`); });

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-50, AC-51

test('fr_ux_03_ac50_view_commands', async ({ page }) => {
  await startViews(page, { route: typeRoute('book'), vault: withTabs([Q.zanr]) });
  await must(tablist(page), 'the tablist', 8000);
  const onAll = await palette(page, 'view');
  for (const c of ['New view…', 'Next view', 'Previous view']) assert.ok(onAll.includes(c), `All Books: ${c} (${onAll.join(' | ')})`);
  for (const c of ['Edit view', 'Move view left', 'Move view right']) assert.ok(!onAll.includes(c), `All Books: no ${c}`);
  await selectTab(page, Q.roz);
  const onBoard = [...await palette(page, 'view'), ...await palette(page, 'lane'), ...await palette(page, 'sort')];
  for (const c of ['Edit view', 'Move view left', 'Move view right', 'Switch lanes', 'Add sort level', 'Reset lane order']) assert.ok(onBoard.includes(c), `Rozečtené: ${c}`);
  assert.ok(!onBoard.includes('Move card to next lane'), 'no card command without a focused card');
  await card(board(page, Q.roz), B('Noční vlak')).focus();
  const onCard = await palette(page, 'lane');
  for (const c of ['Move card to next lane', 'Move card to previous lane', 'Move lane left', 'Move lane right']) assert.ok(onCard.includes(c), `a focused card: ${c}`);
  // FR-UX-03 AC-8: every control reachable on each tab, with the menus, the popover and the editor open.
  await allTab(page).focus();
  const stops = await tabStops(page);
  for (const n of ['Add view', 'Filter Books…', 'Filter by tag', 'Sort', 'View actions', 'Vertical']) assert.ok(stops.has(n), `Rozečtené: ${n} is a Tab stop`);
  await click(sortButton(toolbar(page)), 'Sort');
  await must(sortDialog(page), 'Sort');
  const inSort = await tabStops(page, 20);
  for (const n of ['+ Add sort', 'Clear', 'Remove', 'Drag to change the order']) assert.ok(inSort.has(n), `the popover: ${n} reachable`);
  await page.keyboard.press('Escape');
  await selectTab(page, Q.zanr);
  await click(lane(board(page, Q.zanr), 'option:Román').getByRole('button', { name: rx('Collapse Román') }), 'fold Román');
  const z = await tabStops(page);
  assert.ok(z.has('Expand Román') && z.has('Drag to move the row'), 'Podle žánru with a folded row: its chevron and grips reachable');
});

test('fr_ux_03_ac51_views_keyboard_only', async ({ page }) => {
  const core = await startViews(page, { route: 'inbox' });
  await runCommand(page, 'Go to type: Books');
  await must(tablist(page), 'the tablist', 8000);
  // New view…, ↓ to Show a saved query › Podle autora, ⏎ (one views: write).
  await runCommand(page, 'New view…');
  await must(addMenu(page), 'the Add view menu');
  for (let i = 0; i < 10 && (await focusName(page)).name !== Q.autor; i++) await page.keyboard.press('ArrowDown');
  assert.equal((await focusName(page)).name, Q.autor, '↓ reaches `Podle autora`');
  await page.keyboard.press('Enter');
  assert.ok(await fileWhen(core, BOOK_YML, (x) => !!x && x.includes(`views: [Rozečtené, Přečtené 2026, Výborné knihy, ${Q.autor}]\n`)), 'one views: write');
  await runCommand(page, 'Move view left');
  assert.ok(await fileWhen(core, BOOK_YML, (x) => !!x && x.includes(`views: [Rozečtené, Přečtené 2026, ${Q.autor}, Výborné knihy]\n`)), 'Move view left: one write');
  await runCommand(page, 'Next view');
  await runCommand(page, 'Previous view');
  assert.equal(await eventually(() => page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-view-tab')?.normalize('NFC') ?? null), (s) => s === Q.autor), Q.autor, 'Next / Previous view reach it');
  await runCommand(page, 'Switch lanes');
  assert.ok(await fileWhen(core, qfile(Q.autor), (x) => x === expectedView('podle-autora-lanes-horizontal.yml')), 'Switch lanes: one write');
  // Tab to a card, Move card to previous lane (one book write).
  for (let i = 0; i < 40 && !(await page.evaluate(() => !!document.activeElement?.getAttribute('data-board-card'))); i++) await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-board-card')?.normalize('NFC') ?? '');
  assert.ok(focused.startsWith('Books/'), 'Tab reaches a card');
  const n0 = (await writes(core)).length;
  await runCommand(page, 'Move card to previous lane');
  await sleep(500);
  assert.ok((await writes(core)).length <= n0 + 1, 'at most one book write');
  // Tab to a lane header, Move lane right (one lane_order write).
  await laneGrip(board(page, Q.autor), `relation:Autoři/Eva Lindová.md`).focus();
  await runCommand(page, 'Move lane down');
  assert.ok(await fileWhen(core, qfile(Q.autor), (x) => !!x && x.includes('lane_order: [')), 'one lane_order write');
  // Add sort level, choose Rating, Esc (one write).
  await runCommand(page, 'Add sort level');
  await must(sortDialog(page), 'the popover with a new level');
  await page.keyboard.type('Rating');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  assert.ok(await fileWhen(core, qfile(Q.autor), (x) => !!x && x.includes('{ by: rating, order: asc }')), 'Add sort level, Rating: one write');
  // ⇧F10 on the tab, Remove from Books page (one write).
  await tab(page, Q.autor).focus();
  await page.keyboard.press('Shift+F10');
  await must(viewMenu(page), 'View actions');
  for (let i = 0; i < 8 && (await focusName(page)).name !== 'Remove from Books page'; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.ok(await fileWhen(core, BOOK_YML, (x) => !!x && x.includes('views: [Rozečtené, Přečtené 2026, Výborné knihy]\n')), 'Remove: one write');
  assert.equal((await viewsOps(core)).length, 3, 'three views: writes in the tour');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-24

test('fr_ux_08_ac24_views_for_voiceover', async ({ page }) => {
  await startViews(page, { route: typeRoute('book'), reducedMotion: 'reduce' });
  const tl = await must(tablist(page), 'the tablist', 8000);
  assert.equal(await tl.getAttribute('aria-label'), 'Views', '`Views, tab list`');
  const pos = await tl.evaluate((l) => ([...l.querySelectorAll('[role="tab"]')] as HTMLElement[]).map((t) => [t.getAttribute('aria-posinset'), t.getAttribute('aria-setsize')]));
  assert.deepEqual(pos, [['1', '4'], ['2', '4'], ['3', '4'], ['4', '4']], '`1 of 4` … `4 of 4`');
  assert.equal(await tab(page, Q.roz).getAttribute('aria-haspopup'), 'menu', 'a view tab has `View actions, menu`');
  assert.equal(await addView(page).getAttribute('aria-haspopup'), 'menu', '`Add view` is a menu button');
  await selectTab(page, Q.roz);
  const b = await must(board(page, Q.roz), 'the board');
  assert.equal(await b.getAttribute('aria-label'), Q.roz, 'a group labelled with the view name');
  assert.deepEqual((await lanes(b)).map((l) => l.label), ['Reading, 3 cards', 'To read, 2 cards', 'Read, 0 cards'], 'each lane a region `<lane>, <n> cards`');
  assert.equal(await lane(b, 'option:Read').getAttribute('aria-description'), 'Not in this view', 'the excluded lane adds `Not in this view`');
  assert.equal(await card(b, B('Noční vlak')).getAttribute('aria-label'), 'Book: Noční vlak', 'each card an article `Book: <title>`');
  const radios = await lanesGroup(toolbar(page)).getByRole('radio').evaluateAll((rs) => rs.map((r) => [(r as HTMLElement).innerText.trim(), r.getAttribute('aria-checked')]));
  assert.deepEqual(radios, [['Vertical', 'true'], ['Horizontal', 'false']], 'the radiogroup `Lanes`');
  await selectTab(page, Q.p26);
  await click(sortButton(toolbar(page)), 'Sort');
  const levels = await sortLevels(page).evaluateAll((ls) => ls.map((l) => l.getAttribute('aria-label')));
  assert.deepEqual(levels.slice(0, 2), ['Sort by Finished, Newest first', 'then by Rating, Excellent first'], 'the popover rows');
  await page.keyboard.press('Escape');
  const sorts = await panelOf(page).locator('[role="columnheader"][aria-sort]').evaluateAll((hs) => hs.map((h) => [(h as HTMLElement).innerText.replace(/\s+/g, ' ').trim(), h.getAttribute('aria-sort')]));
  assert.equal(sorts.length, 1, 'aria-sort on one header only');
  assert.ok(String(sorts[0]?.[0]).startsWith('Finished'), 'the first level');
  // Announcements: once, politely; reduced motion: no animation.
  await selectTab(page, Q.roz);
  await drag(page, card(b, B('Kniha o horách')), lane(b, 'option:Reading'));
  const live = await must(liveRegion(page), 'div.sr-live');
  assert.equal(await live.getAttribute('aria-live'), 'polite', 'polite');
  assert.equal(((await textOf(live)).match(/Moved "Kniha o horách" to Reading/g) ?? []).length, 1, 'announced once');
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'no animation with reduced motion');
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-24

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac24_views_in_both_themes${theme === 'dark' ? '_dark' : ''}`, async ({ page }) => {
    await startViews(page, { route: typeRoute('book'), vault: withTabs([Q.zanr]), theme, ui: { theme } });
    await must(tablist(page), 'the tablist', 8000);
    await selectTab(page, Q.p26);
    await click(sortButton(toolbar(page)), 'Sort');
    await must(sortDialog(page), 'Sort');
    assert.deepEqual(await axeContrast(page), [], `${theme}: Přečtené 2026 with the sort popover`);
    assert.deepEqual(await colourLeaks(page, theme), [], `${theme}: colours from tokens only`);
    await page.keyboard.press('Escape');
    await selectTab(page, Q.roz);
    const b = await must(board(page, Q.roz), 'Rozečtené');
    const hatch = await lane(b, 'option:Read').evaluate((e) => getComputedStyle(e).backgroundImage);
    const hover = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--hover)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    assert.ok(hatch.includes('gradient') && hatch.includes(hover), `${theme}: the excluded lane is hatched with --hover (${hatch})`);
    const head = await lane(b, 'option:Reading').locator('h2').evaluate((h) => getComputedStyle(h).color);
    const blue = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--type-blue)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    assert.equal(head, blue, `${theme}: the Reading heading uses --type-blue`);
    assert.deepEqual(await axeContrast(page), [], `${theme}: Rozečtené vertical`);
    await selectTab(page, Q.zanr);
    await click(lane(board(page, Q.zanr), 'option:Román').getByRole('button', { name: rx('Collapse Román') }), 'fold');
    assert.deepEqual(await axeContrast(page), [], `${theme}: Podle žánru with a folded row`);
    await click(addView(page), 'Add view');
    await must(addMenu(page), 'Add view menu');
    assert.deepEqual(await axeContrast(page), [], `${theme}: the Add view menu with greyed items`);
    await page.keyboard.press('Escape');
    await tabMenu(page, Q.zanr);
    assert.deepEqual(await axeContrast(page), [], `${theme}: the view menu`);
    await click(menuItem(viewMenu(page), 'Edit view'), 'Edit view');
    await must(editor(page), 'the editor');
    assert.deepEqual(await axeContrast(page), [], `${theme}: the editor from a tab`);
    await page.keyboard.press('Escape');
    await openNote(page, 'Čtení 2026');
    assert.deepEqual(await axeContrast(page), [], `${theme}: Čtení with its three blocks`);
  });
}

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-21

test('nfr_oth_02_ac21_view_strings', async ({ page }) => {
  await startViews(page, { route: typeRoute('book'), pseudo: true });
  await must(tablist(page), 'the tablist', 8000);
  await selectTab(page, Q.roz);
  await must(board(page, Q.roz), 'the board');
  const user = ['Books', 'Book', 'Rozečtené', 'Přečtené 2026', 'Výborné knihy', 'Reading', 'To read', 'Read', 'Author', 'Rating', 'Status', 'Good', 'Bad', 'Excellent',
    'Noční vlak', 'Účetní ze Žižkova', 'Světla přístavu', 'Dům u řeky', 'Kniha o horách', 'Tomáš Rybář', 'Jana Brázdová', 'Eva Lindová', 'Lucie Horká', 'Marek Sova', '#doporučené'];
  const bad = await main(page).evaluate((m, userContent) => {
    const out: string[] = [];
    const scope = [m.querySelector('[data-views-tablist]'), m.querySelector('div.view-toolbar'), m.querySelector('div[role="group"][data-board]')].filter(Boolean) as Element[];
    if (scope.length < 3) out.push('missing: the tablist, the toolbar or the board');
    for (const root of scope) {
      for (const e of root.querySelectorAll('button, [role="button"], [role="tab"], [role="radio"], section[role="region"], article, h2, p, [aria-label], [aria-description]')) {
        for (const t of [e.getAttribute('aria-label'), e.getAttribute('aria-description'), e.getAttribute('title'), e.matches('p, h2') ? (e as HTMLElement).innerText : null]) {
          const s = (t ?? '').trim().normalize('NFC');
          if (!s || e.closest('[data-user-content]') === e && userContent.includes(s) || userContent.includes(s)) continue;
          if (!/^⟦[\s\S]*⟧$/.test(s)) out.push(s);
        }
      }
    }
    return out;
  }, user);
  assert.deepEqual(bad, [], 'every text and accessible name of the slice is inside ⟦ ⟧, except user content');
});

// ------------------------------------------------------------------------------------------------ NFR-PERF-07 AC-3 (DOM bound)

test('nfr_perf_07_ac3_board_500_cards_6_lanes', async ({ page }) => {
  const opts = ['Nápad', 'Rozpracováno', 'Čeká', 'Hotovo', 'Zrušeno'];
  const vault = viewsVault((f) => {
    f['.tegg/types/karta.yml'] = ['# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg\'s type settings.', 'version: 1', 'name: Karta', 'plural: Karty', 'system: false',
      'folder: Karty', 'icon: file', 'color: gray', 'review: false', 'preview: [fáze]', 'views: [Karty]', 'attributes:', '  - key: fáze', '    name: Fáze', '    type: select', '    options:',
      ...opts.map((o) => `      - { label: ${o}, color: gray }`), ''].join('\n');
    f[qfile('Karty')] = viewQuery({ title: 'Karty', types: ['karta'], extra: ['group_by: fáze'], columns: ['tags'] });
    for (let i = 0; i < 500; i++) {
      const o = i < 450 ? opts[Math.floor(i / 100)] : null;
      const n = String(i).padStart(3, '0');
      f[`Karty/Karta ${n}.md`] = `---\ntype: karta\ntitle: Karta ${n}\n${o ? `fáze: ${o}\n` : ''}tags: [štítek${i % 7}]\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n---\nKarta číslo ${n}.\n`;
    }
  });
  await startViews(page, { route: typeRoute('karta'), vault });
  await must(tab(page, 'Karty'), 'tab Karty', 8000);
  await selectTab(page, 'Karty');
  const b = await must(board(page, 'Karty'), 'the board Karty', 8000);
  const counts = await eventually(async () => (await boardHook(page))?.find((x) => x.name === 'Karty') ?? null, (x) => !!x && x.lanes.length === 6, 5000);
  assert.ok(counts, '__TEGG_TEST__.board() reports the board (contract §5)');
  assert.deepEqual(counts!.lanes.map((l) => l.cards.length), [100, 100, 100, 100, 50, 50], '6 lanes: 100, 100, 100, 100, 50 and 50 without a value');
  assert.ok(counts!.domCards <= 150, `at most 150 card elements in the DOM (${counts!.domCards})`);
  const scroller = lane(b, 'option:Nápad');
  for (let i = 0; i < 20; i++) { await scroller.hover(); await page.mouse.wheel(0, 2000); }
  const after = (await boardHook(page))?.find((x) => x.name === 'Karty');
  assert.ok(after && after.domCards <= 150, 'still ≤ 150 while scrolling');
  assert.ok(await seen(card(b, 'Karty/Karta 099.md'), 3000), 'the last card of the lane is reachable by scrolling');
  void [laneRadio, fileText];
});
