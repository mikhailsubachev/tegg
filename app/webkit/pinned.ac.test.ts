// Slice PIN, L5 (WebKit + fake core): the Pinned section, opening, pinning and unpinning from menus and the palette,
// keyboard reorder, the empty and collapsed states, daily notes and media: docs/acceptance/pinned.md FR-HOM-02 AC-1…AC-9,
// AC-11, AC-14, AC-15, AC-19 (R131…R137). Interface docs/contracts/v1-pinned.md §2…§5 (D-1370…D-1392). Written from the
// ACs, the fixtures and the contract only (D-61). Every lookup goes through `must`, so a missing section is an
// AssertionError (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  EMPTY_TEXT, ID, NOT_SAVED, P, PINS, VALID_ROWS, VAULT_PATH, anyPreview, box, click, contextMenu, description, drag,
  emptyArea, eventually, flat, focusName, header, inboxEntry, labels, list, liveSays, main, menuItem, menuNamed, moreBtn, moreMenu, must, mustBeOn,
  nfc, openPinned, otherWrites, paletteDialog, paletteOptions, pinnedVault, pinsFx, pinsText, pinsWrites, retitle, rowAt, rowMenu, rowNamed, rows,
  rowsAre, runCommand, searchRow, seen, sidebar, sleep, tagRow, tokenColor, typeEntryMenu, typeRow, typesEntry,
  typesList, ui, unpinBtn,
} from './pinned-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const PIN = 'Pin to sidebar';
const UNPIN = 'Unpin from sidebar';
const item = (nn: string, path: string) => `  - id: ${ID(nn)}\n    path: ${path}\n`;

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-1

test('fr_hom_02_ac1_section_place_and_rows', async ({ page }) => {
  await openPinned(page, { pins: 'valid.yml', route: 'inbox' });
  const h = header(page);
  assert.equal(await h.getAttribute('aria-expanded'), 'true', 'header aria-expanded="true"');
  assert.match(flat(await h.innerText()), /^pinned\s*5$/i, 'visible text PINNED and the count 5');
  assert.equal(await description(h), '5 pinned items', 'description `5 pinned items`');
  assert.deepEqual(await rowsAre(page, VALID_ROWS), VALID_ROWS, 'five rows in file order');
  assert.equal(await list(page).getByRole('listitem').count(), 5, 'one listitem per row');
  const sb = sidebar(page);
  const parts: [string, ReturnType<typeof sb.getByRole>][] = [
    ['New object', sb.getByRole('button', { name: /^New object/ })], ['Search', sb.getByRole('button', { name: 'Search', exact: true })],
    ['Inbox', sb.getByText('Inbox', { exact: true })], ['Today', sb.getByText('Today', { exact: true })], ['Tasks', sb.getByText('Tasks', { exact: true }).first()],
    ['Pinned header', h], ['Pinned list', list(page)], ['Types', typesList(page)],
  ];
  const ys: number[] = [];
  for (const [name, loc] of parts) { const b = await box(loc); assert.ok(b, `${name} shown`); ys.push(b!.y); }
  assert.ok(Math.abs(ys[0] - ys[1]) <= 1, 'New object and Search share a row');
  for (let i = 2; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1], `${parts[i][0]} below ${parts[i - 1][0]}`);
  assert.equal(await sb.getByText('Otevřené úkoly tento týden').count(), 0, 'the query: item is neither drawn nor counted (AP-1233)');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-2

test('fr_hom_02_ac2_rows_keep_type_icon_and_colour', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: 'inbox' });
  await rowsAre(page, VALID_ROWS);
  const r = await rows(page);
  const orange = await tokenColor(page, '--type-orange');
  const teal = await tokenColor(page, '--type-teal');
  assert.deepEqual(r.map((x) => [x.label, x.icon, x.color, x.description]), [
    ['Rozpočet 2027', 'folder', orange, 'Projekt'], ['Výjezd Lisabon 2026', 'folder', orange, 'Projekt'],
    ['2026-10-07 Týdenní porada', 'users', teal, 'Schůzka'], ['#offsite', r[3]?.icon, teal, 'Tag'], ['Projekty', 'folder', orange, 'Type page'],
  ], 'icons, colours and descriptions per R133');
  assert.ok(['hash', 'tag'].includes(String(r[3]?.icon)), `#offsite has the tag icon (data-icon ${r[3]?.icon})`);
  for (const x of r) assert.ok(!/\d+$/.test(x.text.replace(x.label, '').trim()), `${x.label}: no count (${x.text})`);
  assert.equal(r[0].tooltip, 'Rozpočet 2027\nProjekty/Rozpočet 2027.md', 'tooltip: label, then the path');
  const ell = await rowAt(page, 0).evaluate((a) => { const l = (a.querySelector('[data-label], .label') ?? a) as HTMLElement; const s = getComputedStyle(l); return [s.textOverflow, s.whiteSpace, s.overflow]; });
  assert.deepEqual(ell, ['ellipsis', 'nowrap', 'hidden'], 'a long label is cut with an ellipsis');
  const before = await core.writes();
  await core.setFile('.tegg/types/projekt.yml', (await core.files())['.tegg/types/projekt.yml'].replace('color: orange', 'color: blue'));
  const blue = await tokenColor(page, '--type-blue');
  const got = await eventually(async () => (await rows(page)).filter((x) => x.description === 'Projekt' || x.description === 'Type page').map((x) => x.color), (c) => c.length === 3 && c.every((v) => v === blue), 2000);
  assert.deepEqual(got, [blue, blue, blue], 'the three projekt rows recolour within 2 s');
  assert.equal(await pinsWrites(core), 0, 'no pins write');
  assert.equal(await core.writes(), before, 'no write call');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-3

test('fr_hom_02_ac3_rows_open_their_targets', async ({ page }) => {
  await openPinned(page, { pins: 'valid.yml', route: 'inbox' });
  await rowsAre(page, VALID_ROWS);
  const names = ['Rozpočet 2027', 'Výjezd Lisabon 2026', '2026-10-07 Týdenní porada', '#offsite', 'Projekty'];
  for (const [i, how] of [[0, 'click'], [1, 'enter'], [2, 'click'], [3, 'enter'], [4, 'click']] as const) {
    if (how === 'click') await click(rowAt(page, i), `row ${i}`);
    else { await (await must(rowAt(page, i), `row ${i}`)).focus(); await page.keyboard.press('Enter'); }
    await mustBeOn(page, names[i], `row ${i} (${how})`);
    // D-1423: the heading takes the focus a frame after the page name changes; wait up to 1 s.
    const f = await eventually(() => page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return !!a && (/^h1$/i.test(a.tagName) || a.getAttribute('aria-level') === '1'); }), (x) => x, 1000);
    assert.ok(f, `row ${i}: the focus moves to the page heading (D-130)`);
    assert.equal(await rowAt(page, i).getAttribute('aria-current'), 'page', `row ${i}: aria-current="page"`);
    assert.deepEqual((await rows(page)).filter((r) => r.current === 'page').map((r) => r.index), [i], 'only the shown row is current');
    await page.keyboard.press('Meta+BracketLeft');
    await mustBeOn(page, i === 0 ? 'Inbox' : names[i - 1], `row ${i}: Back returns (one history entry)`);
    await (await must(rowAt(page, i), `row ${i}`)).click();
    await mustBeOn(page, names[i], `row ${i} again`);
  }
  await (await must(rowAt(page, 0), 'row 0')).click({ modifiers: ['Meta'] });
  await mustBeOn(page, 'Rozpočet 2027', '⌘-click opens in the current view (D-925)');
});

test('fr_hom_02_ac3_daily_image_and_no_preview', async ({ page }) => {
  const text = `${pinsFx('valid.yml')}${item('06', P.den)}${item('07', P.graf)}`;
  await openPinned(page, { pins: { text }, route: 'inbox', uiState: ui({ extra: { preview: { mode: 'hover', hoverDelay: 400 } } }) });
  await rowsAre(page, [...VALID_ROWS, '2026-10-07', 'Graf']);
  await click(rowNamed(page, '2026-10-07'), 'row Den');
  await mustBeOn(page, '2026-10-07', 'pinned Den opens daily/2026-10-07');
  await click(rowNamed(page, 'Graf'), 'row Graf');
  await mustBeOn(page, 'Graf', 'pinned Graf opens its Image object page');
  await (await must(rowAt(page, 1), 'row Lisabon')).hover();
  await sleep(1000);
  assert.equal(await seen(anyPreview(page), 300), false, 'hovering a row for 1,000 ms shows no preview (AP-1246)');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-4

test('fr_hom_02_ac4_duplicate_titles_resolve_by_id', async ({ page }) => {
  const text = `${pinsFx('expected/created.yml').split('  - id:')[0]}${item('10', P.plan)}${item('11', P.plan2)}`;
  await openPinned(page, { pins: { text }, route: 'inbox' });
  assert.deepEqual(await rowsAre(page, ['Plán', 'Plán']), ['Plán', 'Plán'], 'both rows read Plán');
  assert.deepEqual((await rows(page)).map((r) => r.tooltip), ['Plán\nPages/Plán.md', 'Plán\nPages/Plán (2).md'], 'tooltips name the paths');
  await click(rowAt(page, 0), 'row 1');
  assert.ok(await seen(main(page).getByText('První plán.'), 3000), 'row 1 opens Pages/Plán.md');
  await click(rowAt(page, 1), 'row 2');
  assert.ok(await seen(main(page).getByText('Druhý plán.'), 3000), 'row 2 opens Pages/Plán (2).md');
  await retitle(page, 'Plán B');
  assert.deepEqual(await rowsAre(page, ['Plán', 'Plán B'], 5000), ['Plán', 'Plán B'], 'only the second row is relabelled');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-5

test('fr_hom_02_ac5_pin_from_more_creates_the_file_once', async ({ page }) => {
  const core = await openPinned(page, { route: `note/${P.rozpocet}` });
  assert.equal(await pinsText(core), null, 'no pins file before the first pin');
  assert.ok(await seen(emptyArea(page)), 'the empty area');
  await click(moreBtn(page), 'More');
  await must(moreMenu(page), 'menu More');
  assert.equal(flat(await moreMenu(page).getByRole('menuitem').first().innerText()), PIN, '`Pin to sidebar` first');
  await page.keyboard.press('Escape');
  await sleep(200);
  assert.equal(await core.writes(), 0, 'opening More and Esc writes nothing');
  await click(moreBtn(page), 'More');
  await click(menuItem(moreMenu(page), PIN), PIN);
  assert.equal(await eventually(() => pinsText(core), (t) => t !== null), pinsFx('expected/created.yml'), 'created byte-identical to expected/created.yml');
  const calls = await core.pinCalls();
  assert.deepEqual(calls.map((c) => [c.op, c.base]), [[{ op: 'pin', target: { kind: 'object', path: nfc(P.rozpocet) }, at: null }, null]], 'one pins_apply, base none (exclusive create)');
  assert.deepEqual(await rowsAre(page, ['Rozpočet 2027']), ['Rozpočet 2027'], 'the row replaces the empty area');
  assert.equal(await seen(emptyArea(page), 300), false, 'no empty area');
  assert.ok(await liveSays(page, 'Pinned Rozpočet 2027'), 'VoiceOver hears `Pinned Rozpočet 2027`');
  await click(moreBtn(page), 'More');
  assert.ok(await seen(menuItem(moreMenu(page), UNPIN)), 'More now lists `Unpin from sidebar`');
  assert.equal(await menuItem(moreMenu(page), PIN).count(), 0, 'and not `Pin to sidebar`');
  await page.keyboard.press('Escape');
  const bez = (await core.files())[P.bez];
  await runCommand(page, 'Search');
  await page.getByRole('searchbox', { name: 'Search query' }).fill('Jen text');
  await click(searchRow(page, 'Bez hlavičky'), 'Search result Bez hlavičky');
  await mustBeOn(page, 'Bez hlavičky', 'open Bez hlavičky');
  await click(moreBtn(page), 'More');
  await click(menuItem(moreMenu(page), PIN), PIN);
  assert.equal(await eventually(() => pinsText(core), (t) => t === pinsFx('expected/created-idless.yml')), pinsFx('expected/created-idless.yml'), 'expected/created-idless.yml');
  assert.equal((await core.files())[P.bez], bez, 'Bez hlavičky untouched: no id, no type (AP-4, AP-1229)');
  assert.deepEqual(await otherWrites(core), [], 'no other file written');
});

test('fr_hom_02_ac5_nothing_is_created_before_the_first_pin', async ({ page }) => {
  const core = await openPinned(page, { route: `note/${P.rozpocet}` });
  await click(header(page), 'header');
  await click(header(page), 'header again');
  await page.reload();
  await must(header(page), 'header after a reload');
  await sleep(300);
  assert.equal(await pinsText(core), null, 'no .tegg/pinned.yml after launching, opening notes, collapsing and relaunching');
  assert.deepEqual(await core.pinCalls(), [], 'no pins_apply');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-6

test('fr_hom_02_ac6_pin_from_context_menus', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: 'inbox' });
  await rowsAre(page, VALID_ROWS);
  let text = pinsFx('valid.yml');
  const expectAppend = async (lines: string, what: string) => {
    text += lines;
    assert.equal(await eventually(() => pinsText(core), (t) => t === text), text, `${what}: one item appended at the end`);
  };
  // Types entry Schůzky.
  await contextMenu(typesEntry(page, 'Schůzky'), 'Types entry Schůzky');
  const tm = await must(typeEntryMenu(page, 'Schůzka'), 'menu `Schůzka actions` (D-1392)');
  assert.deepEqual((await tm.getByRole('menuitem').allInnerTexts()).map(flat), ['Open', PIN], 'Open, Pin to sidebar');
  await click(menuItem(tm, PIN), PIN);
  await expectAppend('  - type: schůzka\n', 'Types entry');
  await contextMenu(typesEntry(page, 'Schůzky'), 'Types entry Schůzky (pinned)');
  assert.ok(await seen(menuItem(typeEntryMenu(page, 'Schůzka'), UNPIN)), 'pinned: `Unpin from sidebar` instead');
  await page.keyboard.press('Escape');
  // ⇧F10 on a focused source opens the same menu.
  await (await must(typesEntry(page, 'Schůzky'), 'Types entry')).focus();
  await page.keyboard.press('Shift+F10');
  assert.ok(await seen(typeEntryMenu(page, 'Schůzka')), '⇧F10 opens the same menu');
  await page.keyboard.press('Escape');
  // All tags row #účty.
  await runCommand(page, 'Go to Tags');
  await contextMenu(tagRow(page, 'účty'), 'All tags row účty');
  const tg = await must(menuNamed(page, 'Tag'), 'menu `Tag`');
  await click(menuItem(tg, PIN), PIN);
  await expectAppend('  - tag: účty\n', 'All tags row');
  // Search result Čajovna (NFC path).
  await page.keyboard.press('Meta+Shift+f');
  await page.getByRole('searchbox', { name: 'Search query' }).fill('Čajovna');
  await contextMenu(searchRow(page, 'Čajovna'), 'Search result Čajovna');
  const sr = await must(menuNamed(page, 'Search result'), 'menu `Search result`');
  assert.deepEqual((await sr.getByRole('menuitem').allInnerTexts()).map(flat), ['Open', PIN], 'Open, Pin to sidebar');
  await click(menuItem(sr, PIN), PIN);
  await expectAppend(item('04', 'Pages/Čajovna.md'), 'Search result');
  // Type-page row Úkol on type/task.
  await runCommand(page, 'Go to type: Tasks');
  await contextMenu(typeRow(page, 'Poslat návrh rozpočtu'), 'type-page row Úkol');
  const om = page.getByRole('menu').last();
  const items = (await om.getByRole('menuitem').allInnerTexts()).map(flat);
  assert.deepEqual([items[0], items[1], items[items.length - 1]], ['Open', PIN, 'Move to trash'], 'Open, Pin to sidebar, …, Move to trash');
  assert.equal(await om.getByRole('separator').count(), 1, 'a separator before Move to trash');
  await click(menuItem(om, PIN), PIN);
  await expectAppend(item('05', P.ukol), 'type-page row');
  assert.equal((await core.pinCalls()).length, 4, 'one pins_apply per pin');
  assert.deepEqual(await otherWrites(core), [], 'no other write');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-7

test('fr_hom_02_ac7_pin_and_unpin_from_the_palette', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: `note/${P.rozpocet}` });
  await rowsAre(page, VALID_ROWS);
  const listed = async (q: string) => {
    await page.keyboard.press('Meta+k');
    await must(paletteDialog(page), 'palette');
    await page.getByRole('combobox', { name: 'Command query' }).fill(q);
    await sleep(150);
    const o = await paletteOptions(page);
    await page.keyboard.press('Escape');
    return o;
  };
  let o = await listed('sidebar');
  assert.ok(o.some((x) => x.startsWith(UNPIN)) && !o.some((x) => x.startsWith(PIN)), `Rozpočet: Unpin only (${o.join(' | ')})`);
  await (await must(main(page).getByRole('heading', { level: 1 }), 'heading')).focus();
  await runCommand(page, UNPIN);
  assert.equal(await eventually(() => pinsText(core), (t) => t === pinsFx('valid.yml').replace(`${item('01', P.rozpocet)}`, '')), pinsFx('valid.yml').replace(item('01', P.rozpocet), ''), 'Unpin from sidebar removes Rozpočet\'s lines');
  assert.equal(await paletteDialog(page).isVisible(), false, 'the palette closes');
  assert.equal((await focusName(page)).role !== 'body', true, 'the focus returns where it was');
  await page.keyboard.press('Meta+Shift+f');
  await page.getByRole('searchbox', { name: 'Search query' }).fill('Čajovna');
  await click(searchRow(page, 'Čajovna'), 'open Čajovna');
  await mustBeOn(page, 'Čajovna', 'Čajovna');
  o = await listed('sidebar');
  assert.ok(o.some((x) => x.startsWith(PIN)) && !o.some((x) => x.startsWith(UNPIN)), `Čajovna: Pin only (${o.join(' | ')})`);
  await runCommand(page, PIN);
  await eventually(() => pinsText(core), (t) => !!t && t.includes('Pages/Čajovna.md'));
  assert.match(String(await pinsText(core)), /path: Pages\/Čajovna\.md\n$/, 'Pin to sidebar appends Čajovna at the end');
  for (const route of ['Go to Tags']) await runCommand(page, route);
  await click(tagRow(page, 'účty'), 'tag účty');
  await page.keyboard.press('Enter');
  assert.ok((await listed('sidebar')).some((x) => x.startsWith(PIN)), 'listed on tag/účty');
  await runCommand(page, 'Go to type: Schůzky');
  assert.ok((await listed('sidebar')).some((x) => x.startsWith(PIN)), 'listed on type/schůzka');
  for (const cmd of ['Go to Inbox', 'Go to Tasks', 'Go to Search', 'Go to Tags', 'Go to Trash', 'Go to Settings: Appearance']) {
    await runCommand(page, cmd);
    await sleep(200);
    const l = await listed('sidebar');
    assert.ok(!l.some((x) => x.startsWith(PIN) || x.startsWith(UNPIN)), `${cmd}: neither command listed`);
  }
});

test('fr_hom_02_ac7_unsaved_objects_are_disabled', async ({ page }) => {
  for (const route of ['new/page', 'daily/2026-11-07']) {
    const core = await openPinned(page, { pins: 'valid.yml', route });
    await page.keyboard.press('Meta+k');
    await page.getByRole('combobox', { name: 'Command query' }).fill(PIN);
    await sleep(150);
    const opt = await must(page.getByRole('option').filter({ hasText: PIN }).first(), `${route}: \`Pin to sidebar\` listed`);
    assert.equal(await opt.getAttribute('aria-disabled'), 'true', `${route}: aria-disabled`);
    assert.match(flat(await opt.innerText()) + (await description(opt)), new RegExp(NOT_SAVED.replace(/\./g, '\\.')), `${route}: \`${NOT_SAVED}\``);
    await page.keyboard.press('Enter');
    await sleep(300);
    assert.deepEqual(await core.pinCalls(), [], `${route}: doesn't run`);
    assert.equal(await pinsText(core), pinsFx('valid.yml'), `${route}: writes nothing`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-8

test('fr_hom_02_ac8_unpin_removes_only_the_entry', async ({ page }) => {
  const want = pinsFx('expected/valid-after-unpin-porada.yml');
  const ways: [string, (p: typeof page) => Promise<void>][] = [
    ['Unpin button', async (p) => { await (await must(rowAt(p, 2), 'row Porada')).hover(); await click(unpinBtn(p, '2026-10-07 Týdenní porada'), 'Unpin 2026-10-07 Týdenní porada'); }],
    ['row menu', async (p) => { await contextMenu(rowAt(p, 2), 'row Porada'); await click(menuItem(rowMenu(p), UNPIN), UNPIN); }],
    ['More', async (p) => { await click(rowAt(p, 2), 'row Porada'); await mustBeOn(p, '2026-10-07 Týdenní porada', 'Porada'); await click(moreBtn(p), 'More'); await click(menuItem(moreMenu(p), UNPIN), UNPIN); }],
    ['palette', async (p) => { await click(rowAt(p, 2), 'row Porada'); await mustBeOn(p, '2026-10-07 Týdenní porada', 'Porada'); await runCommand(p, UNPIN); }],
  ];
  for (const [how, act] of ways) {
    const ctx = await page.context().browser()!.newContext({ timezoneId: 'Europe/Prague' });
    const p = await ctx.newPage();
    const core = await openPinned(p, { pins: 'valid.yml', route: 'inbox' });
    await rowsAre(p, VALID_ROWS);
    const before = await core.files();
    await act(p);
    assert.equal(await eventually(() => pinsText(core), (t) => t === want), want, `${how}: expected/valid-after-unpin-porada.yml`);
    const after = await core.files();
    for (const k of Object.keys(before)) if (k !== PINS) assert.equal(after[k], before[k], `${how}: ${k} untouched`);
    assert.deepEqual(await otherWrites(core), [], `${how}: nothing else written`);
    assert.ok(await liveSays(p, 'Unpinned 2026-10-07 Týdenní porada'), `${how}: VoiceOver hears the unpin`);
    await ctx.close();
  }
});

test('fr_hom_02_ac8_focus_after_unpin_and_unpin_all', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: 'inbox' });
  await rowsAre(page, VALID_ROWS);
  await (await must(rowAt(page, 1), 'row Lisabon')).focus();
  await page.keyboard.press('Tab');
  assert.equal((await focusName(page)).name, 'Unpin Výjezd Lisabon 2026', 'Tab reaches the row\'s Unpin');
  await page.keyboard.press('Space');
  await rowsAre(page, ['Rozpočet 2027', '2026-10-07 Týdenní porada', '#offsite', 'Projekty']);
  assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.getAttribute('title')?.split('\n')[0]), '2026-10-07 Týdenní porada', 'focus on the next row\'s link');
  await (await must(rowAt(page, 3), 'last row')).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await rowsAre(page, ['Rozpočet 2027', '2026-10-07 Týdenní porada', '#offsite']);
  assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.getAttribute('title')?.split('\n')[0]), '#offsite', 'last row: focus on the previous row');
  for (let n = 3; n > 0; n--) {
    await (await must(rowAt(page, 0), 'first row')).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await eventually(() => labels(page), (l) => l.length === n - 1);
  }
  assert.equal((await focusName(page)).name.replace(/[⟦⟧]/g, ''), 'Pinned', 'none left: focus on the header');
  assert.equal(await eventually(() => pinsText(core), (t) => t === pinsFx('expected/valid-after-unpin-all.yml')), pinsFx('expected/valid-after-unpin-all.yml'), 'expected/valid-after-unpin-all.yml; the file isn\'t deleted');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-9

test('fr_hom_02_ac9_grip_and_unpin_on_hover_and_focus', async ({ page }) => {
  await openPinned(page, { pins: 'valid.yml', route: 'inbox' });
  await rowsAre(page, VALID_ROWS);
  const visibleParts = () => page.evaluate(() => ([...document.querySelectorAll('.sidebar-pinned li')] as HTMLElement[]).map((li) => {
    const vis = (e: Element | null) => !!e && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).opacity !== '0' && (e as HTMLElement).getClientRects().length > 0;
    return [vis(li.querySelector('.pin-grip')), vis(li.querySelector('button'))];
  }));
  await (await must(rowAt(page, 1), 'row Lisabon')).hover();
  await sleep(150);
  assert.deepEqual(await visibleParts(), [[false, false], [true, true], [false, false], [false, false], [false, false]], 'only the hovered row shows grip and Unpin');
  const grip = page.locator('.sidebar-pinned li').nth(1).locator('.pin-grip');
  assert.equal(await grip.getAttribute('title'), 'Drag to reorder', 'grip tooltip');
  assert.equal(await grip.getAttribute('aria-hidden'), 'true', 'grip aria-hidden');
  assert.ok(await seen(unpinBtn(page, 'Výjezd Lisabon 2026')), 'button `Unpin Výjezd Lisabon 2026`');
  const bg = await rowAt(page, 1).evaluate((a) => getComputedStyle(a.closest('li') ?? a).backgroundColor !== 'rgba(0, 0, 0, 0)' || getComputedStyle(a).backgroundColor !== 'rgba(0, 0, 0, 0)');
  assert.ok(bg, 'the hovered row gets --hover');
  await page.mouse.move(1000, 800);
  await (await must(header(page), 'header')).focus();
  const seq: string[] = [];
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => { const a = document.activeElement as HTMLElement; return a.getAttribute('aria-label') ?? a.getAttribute('title')?.split('\n')[0] ?? ''; });
    seq.push(nfc(f));
  }
  assert.deepEqual(seq, VALID_ROWS.flatMap((l) => [l, `Unpin ${l}`]), 'Tab: each row\'s link, then its Unpin, then the next row');
  await (await must(rowAt(page, 2), 'row Porada')).focus();
  await sleep(100);
  assert.deepEqual((await visibleParts())[2], [true, true], 'grip and button show while the row has the focus');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-11

test('fr_hom_02_ac11_reorder_by_keyboard', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: 'inbox' });
  await rowsAre(page, VALID_ROWS);
  await (await must(rowAt(page, 1), 'row Lisabon')).focus();
  await page.keyboard.press('Alt+Meta+ArrowDown');
  await rowsAre(page, ['Rozpočet 2027', '2026-10-07 Týdenní porada', 'Výjezd Lisabon 2026', '#offsite', 'Projekty']);
  assert.ok(await liveSays(page, 'Moved to position 3 of 5'), '`Moved to position 3 of 5`');
  assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.getAttribute('title')?.split('\n')[0]), 'Výjezd Lisabon 2026', 'the focus stays on the moved row');
  await page.keyboard.press('Alt+Meta+ArrowDown');
  assert.equal(await eventually(() => pinsText(core), (t) => t === pinsFx('expected/valid-after-move.yml')), pinsFx('expected/valid-after-move.yml'), 'second press: expected/valid-after-move.yml');
  assert.ok(await liveSays(page, 'Moved to position 4 of 5'), '`Moved to position 4 of 5`');
  assert.equal((await core.pinCalls()).length, 2, 'each press writes once');
  await (await must(rowAt(page, 0), 'first row')).focus();
  await page.keyboard.press('Alt+Meta+ArrowUp');
  await (await must(rowAt(page, 4), 'last row')).focus();
  await page.keyboard.press('Alt+Meta+ArrowDown');
  await sleep(300);
  assert.equal((await core.pinCalls()).length, 2, '⌥⌘↑ on the first and ⌥⌘↓ on the last write nothing');
  await contextMenu(rowAt(page, 0), 'first row');
  assert.equal(await menuItem(rowMenu(page), 'Move up').getAttribute('aria-disabled'), 'true', 'Move up aria-disabled on the first row');
  await click(menuItem(rowMenu(page), 'Move down'), 'Move down');
  await rowsAre(page, ['2026-10-07 Týdenní porada', 'Rozpočet 2027', '#offsite', 'Výjezd Lisabon 2026', 'Projekty']);
  await contextMenu(rowAt(page, 4), 'last row');
  assert.equal(await menuItem(rowMenu(page), 'Move down').getAttribute('aria-disabled'), 'true', 'Move down aria-disabled on the last row');
  await page.keyboard.press('Escape');
  const n = (await core.pinCalls()).length;
  // AP-1264 (D-1407): a focusable element outside the section, the sidebar's Inbox link.
  await (await must(inboxEntry(page), 'the Inbox link (outside the section)')).focus();
  assert.equal(await page.evaluate(() => !!document.activeElement && !document.activeElement.closest('.sidebar-pinned') && document.activeElement !== document.body), true, 'the focus is outside the section');
  await page.keyboard.press('Alt+Meta+ArrowUp');
  await page.keyboard.press('Alt+Meta+ArrowDown');
  await sleep(300);
  assert.equal((await core.pinCalls()).length, n, 'focus outside the section: ⌥⌘↑/↓ do nothing');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-14

test('fr_hom_02_ac14_empty_area_until_something_is_pinned', async ({ page }) => {
  for (const pins of [null, 'expected/valid-after-unpin-all.yml', { text: `${pinsFx('expected/created.yml').split('  - id:')[0]}  - query: Jen dotaz\n  - x-route: inbox\n` }] as const) {
    const ctx = await page.context().browser()!.newContext({ timezoneId: 'Europe/Prague' });
    const p = await ctx.newPage();
    await openPinned(p, { pins, route: 'inbox' });
    const h = header(p);
    assert.match(flat(await h.innerText()), /^pinned$/i, `${JSON.stringify(pins)}: header without a count`);
    assert.equal(await description(h), '', 'no description at 0');
    const area = await must(emptyArea(p), 'the dashed empty area');
    assert.equal(flat(await area.innerText()), EMPTY_TEXT, 'its text');
    assert.deepEqual(await area.evaluate((e) => [e.getAttribute('role'), e.tabIndex, getComputedStyle(e).borderTopStyle]), [null, -1, 'dashed'], 'no role, not focusable, dashed');
    await ctx.close();
  }
  const core = await openPinned(page, { route: 'inbox' });
  await page.keyboard.press('Meta+Shift+f');
  await page.getByRole('searchbox', { name: 'Search query' }).fill('Čajovna');
  await drag(page, searchRow(page, 'Čajovna'), emptyArea(page), { what: 'Search result Čajovna' });
  assert.deepEqual(await rowsAre(page, ['Čajovna']), ['Čajovna'], 'dropping on the area pins at position 1');
  assert.equal(await seen(emptyArea(page), 300), false, 'the row replaces the area');
  await (await must(rowAt(page, 0), 'row')).hover();
  await click(unpinBtn(page, 'Čajovna'), 'Unpin Čajovna');
  assert.ok(await seen(emptyArea(page)), 'unpinning the last row brings the area back');
  assert.match(String(await pinsText(core)), /^pins: \[\]$/m, 'pins: []');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-15

test('fr_hom_02_ac15_collapse_is_remembered_per_vault', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: `note/${P.cajovna}` });
  await rowsAre(page, VALID_ROWS);
  const n0 = (await core.calls()).filter((c) => c.cmd === 'ui_state_set').length;
  await click(header(page), 'header');
  assert.equal(await header(page).getAttribute('aria-expanded'), 'false', 'aria-expanded="false"');
  assert.match(flat(await header(page).innerText()), /5$/, 'the count 5 stays');
  assert.equal(await list(page).count(), 0, 'the rows are gone');
  const sets = (await core.calls()).filter((c) => c.cmd === 'ui_state_set').slice(n0);
  assert.equal(sets.length, 1, 'one ui_state_set');
  assert.equal((await core.uiState() as any)?.vaults?.[nfc(VAULT_PATH)]?.sidebar?.pinnedCollapsed, true, 'vaults[<vault>].sidebar.pinnedCollapsed: true');
  assert.deepEqual(await core.writesTo(), [], 'no vault file written');
  await click(moreBtn(page), 'More');
  await click(menuItem(moreMenu(page), PIN), PIN);
  assert.match(flat(await eventually(() => header(page).innerText(), (t) => /6$/.test(flat(t)))), /6$/, 'pinning while collapsed updates the count to 6');
  assert.equal(await header(page).getAttribute('aria-expanded'), 'false', 'still collapsed');
  await page.keyboard.press('Control+Meta+s');
  await page.keyboard.press('Control+Meta+s');
  assert.equal((await core.uiState() as any)?.vaults?.[nfc(VAULT_PATH)]?.sidebar?.pinnedCollapsed, true, '⌃⌘S doesn\'t change it');
  for (const key of ['Enter', 'Space']) {
    await (await must(header(page), 'header')).focus();
    await page.keyboard.press(key);
    await sleep(150);
  }
  assert.equal(await header(page).getAttribute('aria-expanded'), 'false', '⏎ expands and Space collapses again');
  const ctx = await page.context().browser()!.newContext({ timezoneId: 'Europe/Prague' });
  const p2 = await ctx.newPage();
  await openPinned(p2, { vault: { ...pinnedVault({ pins: 'valid.yml' }), name: 'Jiný' }, uiState: ui({ collapsed: true }), vaultPath: '/fake/Jiný' });
  assert.equal(await header(p2).getAttribute('aria-expanded'), 'true', 'another vault starts expanded');
  await ctx.close();
  const p3 = await page.context().browser()!.newContext({ timezoneId: 'Europe/Prague' }).then((c) => c.newPage());
  await openPinned(p3, { pins: 'valid.yml', uiState: ui({ collapsed: true }) });
  assert.equal(await header(p3).getAttribute('aria-expanded'), 'false', 'the stored value collapses it after a relaunch');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-19

test('fr_hom_02_ac19_daily_notes_and_media', async ({ page }) => {
  const core = await openPinned(page, { route: 'daily/2026-10-07' });
  await click(moreBtn(page), 'More on daily/2026-10-07');
  await click(menuItem(moreMenu(page), PIN), PIN);
  assert.equal(await eventually(() => pinsText(core), (t) => t !== null), `${pinsFx('expected/created.yml').split('  - id:')[0]}${item('06', P.den)}`, 'Den pinned as id + path');
  await rowsAre(page, ['2026-10-07']);
  assert.equal((await rows(page))[0].icon, 'calendar', 'the Daily Note icon');
  await page.keyboard.press('Meta+d');
  await mustBeOn(page, '2026-11-07', 'today\'s virtual note');
  await click(moreBtn(page), 'More on the virtual note');
  const pin = await must(menuItem(moreMenu(page), PIN), PIN);
  assert.equal(await pin.getAttribute('aria-disabled'), 'true', 'aria-disabled on the virtual note');
  assert.match(await description(pin).catch(() => '') + flat(await pin.innerText()), /Available once the object is saved\./, `\`${NOT_SAVED}\``);
  await page.keyboard.press('Escape');
  await (await must(page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }), 'Note body')).click();
  await page.keyboard.type('Dnešní poznámka');
  await eventually(async () => (await core.files())['Daily/2026-11-07.md'] !== undefined, (v) => v, 3000);
  await sleep(1000);
  await click(moreBtn(page), 'More after the first keystroke');
  assert.notEqual(await menuItem(moreMenu(page), PIN).getAttribute('aria-disabled'), 'true', 'enabled within 1 s of the file being written');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Shift+f');
  await page.getByRole('searchbox', { name: 'Search query' }).fill('Graf');
  await click(searchRow(page, 'Graf'), 'Graf');
  await mustBeOn(page, 'Graf', 'Graf\'s Image page');
  await click(moreBtn(page), 'More on Graf');
  await click(menuItem(moreMenu(page), PIN), PIN);
  await rowsAre(page, ['2026-10-07', 'Graf']);
  await runCommand(page, 'Go to Inbox');
  await click(rowNamed(page, 'Graf'), 'row Graf');
  await mustBeOn(page, 'Graf', 'the Graf row opens its Image page');
});
