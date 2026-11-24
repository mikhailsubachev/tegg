// Slice OC, L5: property icons and the icon picker (docs/acceptance/cards.md FR-TYP-01 AC-12, AC-14…AC-20 (b),
// FR-STO-07 AC-15, FR-SYN-03 AC-35; R215, R216) on `type-settings/výlet` and `type-settings/kontrola`, through the fake
// core with the cards fixture (docs/contracts/v1-cards.md §7.7, §7.8, §8.3, §10, §13; the request log of serve-built.ts
// through Playwright's request events). Written from the ACs and the contract only (D-61).
import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  KONTROLA_YML, P, STAV_Q, VYLET_YML, another, board, callsOf, cardList, cardsVault, click, description, eventually, fileText, fileWhen, focusName, main, must, nfc, objectCard,
  picker, pickerGroups, pickerNone, pickerOption, pickerOptions, pickerSearch, pickerStatus, propertyIcon, queryRoute, requestLog, selectedOption, settingsRoute, sleep,
  startCards, swap, typePatches, uiState, changeIcon, cardRow, networkLog, typeRoute, noteRoute,
} from './cards-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const original = (rel: string) => cardsVault().files[nfc(rel)];
const NARO = '    name: Náročnost\n    type: select\n';
const withMountain = () => swap(original(VYLET_YML), NARO, `${NARO}    icon: mountain\n`);
async function openVylet(page: Page, o: Parameters<typeof startCards>[1] = {}) {
  const core = await startCards(page, { route: settingsRoute('výlet'), ...o });
  await must(propertyIcon(page, 'Náročnost'), 'Icon for Náročnost', 8000);
  return core;
}
async function openPicker(page: Page, name: string) {
  await click(propertyIcon(page, name), `Icon for ${name}`);
  await must(pickerSearch(page), `the picker for ${name}`, 5000);
}
const focusText = async (page: Page) => (await focusName(page)).name.replace(/[⟦⟧]/g, '');

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-12

test('fr_typ_01_ac12_icon_on_an_attribute', async ({ page }) => {
  const core = await openVylet(page);
  await openPicker(page, 'Náročnost');
  await pickerSearch(page).fill('mountain');
  await click(pickerOption(page, 'mountain'), 'mountain');
  assert.equal(await fileWhen(core, VYLET_YML, (t) => t !== original(VYLET_YML)), withMountain(), 'one line after the item\'s type line');
  assert.deepEqual((await typePatches(core)).map((x) => x.ops), [[{ op: 'attributeIcon', key: 'náročnost', icon: 'mountain' }]], 'the attributeIcon op');
  await openPicker(page, 'Kraj');
  await click(pickerNone(page), 'None (show the name)');
  assert.equal(await fileWhen(core, VYLET_YML, (t) => !t?.includes('icon: map-pin')), swap(withMountain(), '    type: text\n    icon: map-pin\n', '    type: text\n'), 'None removes only Kraj\'s icon line');
  await openPicker(page, 'Stav');
  await click(pickerOption(page, 'circle-dot'), 'circle-dot (current)');
  await sleep(400);
  assert.equal((await typePatches(core)).length, 2, 'the current icon writes nothing');
  assert.ok((await fileText(core, VYLET_YML))?.includes('    icon: ikona-ktera-neexistuje\n'), 'délka\'s unknown name stays');
  const t = await another(page, { route: settingsRoute('task') });
  await click(propertyIcon(t.page, 'Status'), 'Task: Icon for Status', 8000);
  await pickerSearch(t.page).fill('circle-dot');
  await click(pickerOption(t.page, 'circle-dot'), 'circle-dot');
  const task = await fileWhen(t.core, '.tegg/types/task.yml', (x) => !!x?.includes('icon: circle-dot'));
  assert.ok(task?.includes('  - key: status\n    name: Status\n    type: select\n    icon: circle-dot\n'), 'a built-in attribute gets its icon line (AP-1594)');
  assert.equal(await main(t.page).getByRole('button', { name: /^⟦?Icon for Tags⟧?$/ }).count(), 0, 'universal keys have no icon button');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-14

test('fr_typ_01_ac14_the_picker', async ({ page }) => {
  await openVylet(page);
  const opener = await propertyIcon(page, 'Náročnost').boundingBox();
  await openPicker(page, 'Náročnost');
  const dlg = await must(picker(page, 'Náročnost'), 'the dialog Icon for Náročnost');
  assert.equal(await dlg.getAttribute('aria-modal'), 'false', 'aria-modal false');
  const box = await dlg.boundingBox();
  assert.ok(opener && box && Math.abs(box.y - (opener.y + opener.height)) <= 12, 'anchored to its button');
  assert.equal(await focusText(page), 'Search icons…', 'Search icons… focused');
  assert.deepEqual((await pickerGroups(page)).map((g) => g.group), ['all'], 'no Suggested for Náročnost, no Recent, then All icons');
  // Scroll All icons end to end: at most 200 option elements, every name met once.
  const seen = new Set<string>();
  let maxDom = 0;
  const grid = picker(page).getByRole('listbox');
  for (let i = 0; i < 400; i++) {
    const names = await pickerOptions(page, 'all');
    maxDom = Math.max(maxDom, await picker(page).getByRole('option').count());
    names.forEach((n) => seen.add(n));
    const done = await grid.evaluate((g) => { g.scrollTop += g.clientHeight; return g.scrollTop + g.clientHeight >= g.scrollHeight - 1; });
    if (done) { (await pickerOptions(page, 'all')).forEach((n) => seen.add(n)); break; }
  }
  assert.ok(maxDom <= 200, `at most 200 option elements (${maxDom})`);
  assert.equal(seen.size, 1539, 'every one of the 1,539 names is met');
  assert.deepEqual(await pickerNone(page).count(), 1, 'None at the end for properties');
  assert.ok(!/\b1[,.]?539\b|\(\d+\)/.test(await dlg.innerText()), 'no counts');
  await page.keyboard.press('Escape');
  await click(changeIcon(page), 'Change icon');
  await must(picker(page, 'Výlet'), 'the dialog Icon for Výlet');
  assert.equal(await pickerNone(page).count(), 0, 'no None for the type icon');
  // A property named Map: Suggested lists map and map-pin among at most 12.
  const m = await another(page, { vault: cardsVault((f) => { f[nfc(VYLET_YML)] = f[nfc(VYLET_YML)].replace('    name: Kraj\n', '    name: Map\n'); }), route: settingsRoute('výlet') });
  await click(propertyIcon(m.page, 'Map'), 'Icon for Map', 8000);
  const sug = await eventually(() => pickerOptions(m.page, 'suggested'), (x) => x.length > 0, 3000);
  assert.ok(sug.includes('map') && sug.includes('map-pin') && sug.length <= 12, `Suggested for “Map”: ${sug}`);
  assert.equal((await pickerGroups(m.page))[0]?.label?.replace(/[⟦⟧]/g, ''), 'Suggested for “Map”', 'the group\'s name');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-15

test('fr_typ_01_ac15_search', async ({ page }) => {
  await openVylet(page);
  await openPicker(page, 'Náročnost');
  await page.keyboard.type('pin');
  const res = await eventually(() => pickerOptions(page), (x) => x.includes('map-pin'), 2000);
  assert.ok(res.includes('map-pin'), 'pin shows map-pin');
  assert.equal(await pickerOption(page, res[0]).getAttribute('aria-selected'), 'true', 'the first result is selected');
  assert.equal(await selectedOption(page), res[0], 'and is the combobox\'s aria-activedescendant');
  assert.equal(await pickerOption(page, 'map-pin').locator('.icon-name').innerHTML(), 'map-<b>pin</b>', 'map-<b>pin</b>');
  await pickerSearch(page).fill('kanbanx');
  await must(pickerStatus(page).filter({ hasText: 'No icons for “kanbanx”. Try another word.' }), 'the no-match status');
  await page.keyboard.press('Enter');
  assert.equal(await picker(page).count(), 1, '⏎ does nothing');
  await pickerSearch(page).fill('');
  assert.deepEqual((await eventually(() => pickerGroups(page), (g) => g.some((x) => x.group === 'all'))).map((g) => g.group), ['all'], 'clearing brings back the groups');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-16

test('fr_typ_01_ac16_picker_keyboard', async ({ page }) => {
  const core = await openVylet(page);
  await openPicker(page, 'Náročnost');
  await page.keyboard.type('arrow');
  const opts = await eventually(() => pickerOptions(page), (x) => x.length > 13, 2000);
  assert.equal(await picker(page).getByRole('listbox').getAttribute('data-columns'), '6', 'six columns');
  await page.keyboard.press('ArrowRight');
  assert.equal(await selectedOption(page), opts[1], '→ one option');
  await page.keyboard.press('ArrowDown');
  assert.equal(await selectedOption(page), opts[7], '↓ six options');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  assert.equal(await selectedOption(page), opts[0], '← and ↑ back');
  for (let i = 0; i < 400; i++) await page.keyboard.press('ArrowDown');
  assert.equal(await selectedOption(page), (await pickerOptions(page)).at(-1) ?? opts.at(-1), 'clamped to the last option');
  await page.keyboard.press('Tab');
  assert.ok(['None (show the name)', 'Search icons…'].includes(await focusText(page)), 'Tab reaches None and stays inside the dialog');
  await page.keyboard.press('Tab');
  assert.ok(['None (show the name)', 'Search icons…'].includes(await focusText(page)), 'Tab cycles inside the dialog');
  await page.keyboard.press('Escape');
  assert.deepEqual([await picker(page).count(), await focusText(page), (await typePatches(core)).length], [0, 'Icon for Náročnost', 0], 'Esc closes, writes nothing, the focus on the opener');
  await openPicker(page, 'Náročnost');
  await page.keyboard.type('mountain');
  await eventually(() => selectedOption(page), (s) => s === 'mountain', 2000);
  await page.keyboard.press('Enter');
  assert.equal(await fileWhen(core, VYLET_YML, (t) => t !== original(VYLET_YML)), withMountain(), '⏎ chooses the selected icon');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-17

test('fr_typ_01_ac17_choosing_writes_one_line', async ({ page }) => {
  const core = await openVylet(page);
  await openPicker(page, 'Náročnost');
  await pickerSearch(page).fill('mountain');
  await click(pickerOption(page, 'mountain'), 'mountain');
  assert.equal(await fileWhen(core, VYLET_YML, (t) => t !== original(VYLET_YML)), withMountain(), 'AC-12\'s bytes once');
  assert.deepEqual([await picker(page).count(), await focusText(page)], [0, 'Icon for Náročnost'], 'closes, the focus on the opener');
  assert.equal(await eventually(() => cardRow(page, 'náročnost').locator('svg[data-icon]').getAttribute('data-icon').catch(() => null), (x) => x === 'mountain', 1000), 'mountain', 'the Card list\'s row shows mountain within 1 s');
  await click(changeIcon(page), 'Change icon');
  await pickerSearch(page).fill('tent');
  await click(pickerOption(page, 'tent'), 'tent');
  assert.equal(await fileWhen(core, VYLET_YML, (t) => !!t?.includes('icon: tent')), swap(withMountain(), 'icon: map\n', 'icon: tent\n'), 'General: only icon: map → icon: tent');
  const entry = page.getByRole('navigation', { name: 'Sidebar' }).locator('[data-type="výlet"] svg[data-icon], a[href*="výlet"] svg[data-icon]').first();
  assert.equal(await eventually(() => entry.getAttribute('data-icon').catch(() => null), (x) => x === 'tent', 1000), 'tent', 'the sidebar entry follows within 1 s');
  // Changed on disk since it was read: refused with Conflict, the alert names Icon.
  await core.setFile(VYLET_YML, swap((await fileText(core, VYLET_YML))!, 'color: teal', 'color: red'), { silent: true });
  await openPicker(page, 'Kraj');
  await pickerSearch(page).fill('flag');
  await click(pickerOption(page, 'flag'), 'flag');
  await must(page.getByRole('alert').filter({ hasText: /Icon/ }), 'the alert names Icon');
  assert.ok(!(await fileText(core, VYLET_YML))?.includes('icon: flag'), 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-18, FR-STO-07 AC-15

async function choose(page: Page, prop: string, name: string) {
  await openPicker(page, prop);
  await pickerSearch(page).fill(name);
  await click(pickerOption(page, name), name);
  await sleep(150);
}

test('fr_typ_01_ac18_recent_icons', async ({ page }) => {
  const core = await openVylet(page);
  for (const n of ['mountain', 'tent', 'mountain']) await choose(page, 'Náročnost', n);
  await openPicker(page, 'Náročnost');
  assert.deepEqual(await pickerOptions(page, 'recent'), ['mountain', 'tent'], 'Recent: mountain, tent');
  await page.keyboard.press('Escape');
  const thirteen = ['star', 'flag', 'heart', 'sun', 'moon', 'cloud', 'leaf', 'fish', 'bike', 'car', 'anchor', 'camera', 'coffee'];
  for (const n of thirteen) await choose(page, 'Náročnost', n);
  await openPicker(page, 'Náročnost');
  assert.deepEqual(await pickerOptions(page, 'recent'), [...thirteen].reverse().slice(0, 12), 'the last 12, newest first');
  await page.keyboard.press('Escape');
  const st = await uiState(core);
  assert.deepEqual(st?.recentIcons, [...thirteen].reverse().slice(0, 12), 'ui-state.json recentIcons');
  const sets = (await callsOf(core, 'ui_state_set')).length;
  await choose(page, 'Náročnost', 'star');
  assert.equal((await callsOf(core, 'ui_state_set')).length, sets + 1, 'once per choice');
  await openPicker(page, 'Kraj');
  await click(pickerNone(page), 'None');
  await sleep(200);
  assert.equal((await uiState(core))?.recentIcons?.[0], 'star', 'None adds nothing');
  assert.equal(Object.keys(await core.files()).filter((p) => p.startsWith('.tegg/') && !p.startsWith('.tegg/types/') && !(cardsVault().files[p])).length, 0, 'nothing under the vault besides the type file');
  // A second vault on the same Application Support shows the same list; a fresh one none.
  const second = await another(page, { uiState: { ...(await uiState(core)) }, route: settingsRoute('kontrola') });
  await click(changeIcon(second.page), 'kontrola: Change icon', 8000);
  assert.deepEqual((await pickerOptions(second.page, 'recent')).slice(0, 2), ['star', 'coffee'], 'the same Recent in another vault');
  const fresh = await another(page, { route: settingsRoute('kontrola') });
  await click(changeIcon(fresh.page), 'fresh: Change icon', 8000);
  assert.deepEqual((await pickerGroups(fresh.page)).map((g) => g.group).includes('recent'), false, 'a fresh Application Support: no Recent group');
});

test('fr_sto_07_ac15_recent_icons_are_machine_local', async ({ page }) => {
  const old = { version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, propertiesOpen: true, preview: { mode: 'click' }, dateTime: { date: 'region', time: 'region', week: 'region' }, typeViews: { lastTab: { book: 'Rozečtené' } } } as any;
  const core = await openVylet(page, { uiState: old });
  await openPicker(page, 'Náročnost');
  assert.equal((await pickerGroups(page)).some((g) => g.group === 'recent'), false, 'a 0.5.x ui-state.json: no Recent group');
  await pickerSearch(page).fill('mountain');
  await click(pickerOption(page, 'mountain'), 'mountain');
  const st = await eventually(() => uiState(core), (s) => Array.isArray(s?.recentIcons), 2000);
  const { recentIcons, ...rest } = st ?? {};
  assert.deepEqual([recentIcons, rest.typeViews], [['mountain'], old.typeViews], 'recentIcons added; the other keys kept');
  const vaultFiles = Object.keys(await core.files()).filter((p) => !(p in cardsVault().files));
  assert.deepEqual(vaultFiles, [], 'nothing new under the vault');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-19

test('fr_typ_01_ac19_old_names_keep_drawing', async ({ page }) => {
  const core = await startCards(page, { route: settingsRoute('kontrola') });
  await click(changeIcon(page), 'Change icon', 8000);
  assert.equal(await description(pickerOption(page, 'square-check-big')), 'Current', 'square-check-big is Current');
  await click(pickerOption(page, 'square-check-big'), 'square-check-big');
  await sleep(400);
  assert.equal((await typePatches(core)).length, 0, 'choosing it writes nothing');
  await click(changeIcon(page), 'Change icon');
  await pickerSearch(page).fill('check-square');
  assert.equal((await eventually(() => pickerOptions(page), (x) => x.length > 0, 2000))[0], 'square-check-big', 'searching check-square lists square-check-big first');
  await page.keyboard.press('Escape');
  assert.equal(await fileText(core, KONTROLA_YML), original(KONTROLA_YML), 'kontrola.yml keeps icon: check-square byte for byte');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-20 (b), (c)

test('fr_typ_01_ac20_bundled_offline_credited', async ({ page }) => {
  const reqs = requestLog(page);
  const net = networkLog(page);
  const chunk = () => reqs.filter((u) => /\/assets\/lucide-icons-[^/]*\.js/.test(u));
  await startCards(page, { route: queryRoute(STAV_Q) });
  await must(objectCard(board(page), P.snezka), 'the board\'s cards with their icons', 8000);
  for (const r of [typeRoute('výlet'), noteRoute(P.snezka), noteRoute(P.karty), settingsRoute('výlet')]) {
    const x = await another(page, { route: r });
    x.page.on('request', (q) => reqs.push(q.url()));
    await sleep(800);
    if (r === settingsRoute('výlet')) {
      await must(propertyIcon(x.page, 'Náročnost'), 'type settings', 8000);
      assert.deepEqual(chunk(), [], 'the icon chunk isn\'t requested before a picker opens');
      await openPicker(x.page, 'Náročnost');
      await eventually(async () => chunk().length, (n) => n > 0, 3000);
      assert.equal(chunk().length, 1, 'the first open requests it once');
      await x.page.keyboard.press('Escape');
      await openPicker(x.page, 'Kraj');
      await x.page.keyboard.press('Escape');
      assert.equal(chunk().length, 1, 'later opens don\'t request it again');
    } else {
      assert.deepEqual(chunk(), [], `${r}: no icon chunk while drawing cards, headers and panels`);
    }
  }
  assert.deepEqual(net, [], 'no request to a non-local host');
  assert.deepEqual(reqs.filter((u) => /lucide-0\.460\.0\.json/.test(u)), [], 'no JSON fetch of the data');
  void cardList;
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-35

test('fr_syn_03_ac35_card_and_icon_writes_check_the_base', async ({ page }) => {
  const changed = swap(original(VYLET_YML), 'color: teal', 'color: red');
  const actions: [string, (p: Page) => Promise<void>, RegExp][] = [
    ['a Card remove', async (p) => { await click(p.getByRole('button', { name: /^⟦?Remove Kraj from the card⟧?$/ }), 'Remove Kraj'); }, /Card/],
    ['Reset', async (p) => { await click(p.locator('button[data-command="card.reset"]'), 'Reset'); }, /Card/],
    ['a property icon', async (p) => { await openPicker(p, 'Náročnost'); await pickerSearch(p).fill('mountain'); await click(pickerOption(p, 'mountain'), 'mountain'); }, /Icon/],
    ['None', async (p) => { await openPicker(p, 'Kraj'); await click(pickerNone(p), 'None'); }, /Icon/],
    ['a type icon', async (p) => { await click(changeIcon(p), 'Change icon'); await pickerSearch(p).fill('tent'); await click(pickerOption(p, 'tent'), 'tent'); }, /Icon/],
  ];
  for (const [what, act, alert] of actions) {
    const x = await another(page, { route: settingsRoute('výlet') });
    await must(propertyIcon(x.page, 'Náročnost'), `${what}: type settings`, 8000);
    await x.core.setFile(VYLET_YML, changed, { silent: true });
    await act(x.page);
    await must(x.page.getByRole('alert').filter({ hasText: alert }), `${what}: the alert names ${alert.source}`, 3000);
    assert.equal(await fileText(x.core, VYLET_YML), changed, `${what}: nothing written`);
    assert.ok((await typePatches(x.core)).every((t) => !t.ok), `${what}: refused with Conflict`);
  }
  // Same bytes with only a new mtime: no conflict (D-175).
  const y = await another(page, { route: settingsRoute('výlet') });
  await must(propertyIcon(y.page, 'Náročnost'), 'type settings', 8000);
  await y.core.setFile(VYLET_YML, original(VYLET_YML), { silent: true, sameBytesTouch: true });
  await openPicker(y.page, 'Náročnost');
  await pickerSearch(y.page).fill('mountain');
  await click(pickerOption(y.page, 'mountain'), 'mountain');
  assert.equal(await fileWhen(y.core, VYLET_YML, (t) => !!t?.includes('icon: mountain')), withMountain(), 'a touched file is no conflict');
});
