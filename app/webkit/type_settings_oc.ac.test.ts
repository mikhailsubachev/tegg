// Slice OC, L5: type settings after OC (docs/acceptance/cards.md FR-TYP-11 AC-20…AC-25, AC-27, AC-28: the `Card`
// section, R214; types.md FR-TYP-01 AC-22…AC-27: ten sections in the shared layout, General's icon, Properties one open
// at a time, the `Views` section), through the fake core with the cards fixture and, for Task, the views-tasks overlay
// (docs/contracts/v1-cards.md §7.5, §7.6, §7.9, §8.2, §13). Type-file bytes are checked against the fixtures with one
// line changed. Written from the ACs and the contract only (D-61).
import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  BOOK_YML, KONTROLA_YML, P, STAV_Q, VYLET_CARD, VYLET_YML, addFind, addOptions, addPopover, addProperty, another, board, callsOf, cardHandle, cardInfo, cardList, cardRemove,
  cardRowKeys, cardWarning, cardWhen, cardsVault, changeIcon, click, description, editProperty, eventually, exampleRegion, fileText, fileWhen, focusName, isDisabled, main, must,
  nfc, objectCard, picker, pickerNone, pickerOption, propertyIcon, queryRoute, resetButton, runCommand, settingsNav, settingsRoute, sleep, startCards, swap, tsSection, typePatches,
  typeRoute, viewsList, vyletWith, writtenPaths,
} from './cards-helpers';
import { overlayVault, startTasksViews } from './views-tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const original = (rel: string) => cardsVault().files[nfc(rel)];
const BOOK_PREVIEW = 'preview: [author, status]\n';
const bookWith = (line: string) => swap(original(BOOK_YML), BOOK_PREVIEW, `${BOOK_PREVIEW}${line}`);
async function openSettings(page: Page, key: string, o: Parameters<typeof startCards>[1] = {}) {
  const core = await startCards(page, { route: settingsRoute(key), ...o });
  await must(main(page).getByRole('heading', { level: 1 }), `type-settings/${key}`, 8000);
  return core;
}
async function sectionNames(page: Page): Promise<string[]> {
  return main(page).locator('section[id^="ts-"] > h2, section[id^="ts-"] h2').evaluateAll((hs) => hs.map((h) => (h.textContent ?? '').trim()));
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-20

test('fr_typ_11_ac20_the_card_section', async ({ page }) => {
  const core = await openSettings(page, 'výlet');
  const names = await sectionNames(page);
  assert.equal(names[names.indexOf('Built in on every type') + 1], 'Card', 'Card follows Built in on every type');
  assert.ok(!names.includes('Preview properties') && !(await main(page).innerText()).includes('Up to 4'), 'no Preview properties section, no Up to 4');
  await must(cardList(page), 'the list Card properties');
  const rows: [string, string | null, string | null][] = await cardList(page).locator('li').evaluateAll((ls) => ls.map((l) => [
    (l.querySelector('.card-name, [data-name]')?.textContent ?? (l.textContent ?? '')).replace(/\s+/g, ' ').trim(), l.querySelector('.card-kind')?.textContent?.trim() ?? null, l.querySelector('svg[data-icon]')?.getAttribute('data-icon') ?? null,
  ] as [string, string | null, string | null]));
  const want = [['Tags', '#chips', null], ['Description', 'text · 2 lines', null], ['Stav', 'pill', 'circle-dot'], ['Náročnost', 'pill', null], ['Kraj', 'pill', 'map-pin'], ['Vybavení', 'pill', 'backpack'],
    ['Délka v km', 'pill', null], ['Termín', 'pill', 'calendar'], ['Odkaz', 'link chip', 'link'], ['Průvodce', 'link chip', null], ['Modified', 'date, bottom right', null]];
  assert.ok(rows[0]?.[0].startsWith('Title') && rows[0][0].includes('Always shown'), 'Title (Always shown) first');
  assert.deepEqual(rows.slice(1).map(([n, k, i]) => [n.split(' ')[0] === 'Délka' ? 'Délka v km' : n.replace(/ (#chips|text · 2 lines|pill|link chip|date, bottom right).*$/, ''), k, i]), want, 'then each effective key with its kind and icon');
  assert.equal((await cardWarning(page).textContent())?.trim(), 'Not a property of Výlet, kept in the file: neznámý-klíč', 'the unknown-key status');
  assert.equal(await isDisabled(resetButton(page)), false, 'Reset to default enabled');
  await must(exampleRegion(page), 'the region Example card');
  assert.ok((await tsSection(page, 'card').innerText()).includes('Fixed by Tegg: the type icon (Task: its checkbox), the file preview of Images and PDFs, and Unreviewed while the review workflow is on.'), 'the fixed note');
  const b = await another(page, { route: settingsRoute('book') });
  await must(cardList(b.page), 'book: the Card list', 8000);
  assert.deepEqual(await cardRowKeys(b.page), ['title', 'tags', 'body', 'author', 'status', 'modified'], 'Book: R210\'s default');
  assert.deepEqual([await isDisabled(resetButton(b.page)), await description(resetButton(b.page))], [true, 'Already the default'], 'Reset aria-disabled Already the default');
  const t = await another(page, { route: settingsRoute('tag') });
  await must(main(t.page).getByRole('heading', { level: 1 }), 'type-settings/tag', 8000);
  assert.equal(await tsSection(t.page, 'card').count(), 0, 'Tag has no Card section');
  await main(page).evaluate((m) => m.scrollTo?.(0, 99999));
  await sleep(300);
  assert.deepEqual(await writtenPaths(core), [], 'opening and scrolling write nothing');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-21

test('fr_typ_11_ac21_changing_the_card_writes_only_card', async ({ page }) => {
  const core = await openSettings(page, 'book');
  await click(cardRemove(page, 'Tags'), 'Remove Tags from the card', 5000);
  assert.equal(await fileWhen(core, BOOK_YML, (t) => t !== original(BOOK_YML)), bookWith('card: [body, author, status, modified]\n'), '(a) one line after preview');
  assert.deepEqual((await typePatches(core)).map((x) => [x.key, x.ops]), [['book', [{ op: 'card', keys: ['body', 'author', 'status', 'modified'] }]]], 'one type_patch with the card op');
  await click(cardRemove(page, 'Body'), 'Remove Body from the card');
  assert.equal(await fileWhen(core, BOOK_YML, (t) => !!t?.includes('card: [author, status, modified]')), bookWith('card: [author, status, modified]\n'), '(b) only that line changes');
  // (e) five quick changes: five serialized writes, no Conflict.
  const s = await another(page, { route: settingsRoute('výlet') });
  await must(cardList(s.page), 'výlet: the Card list', 8000);
  for (const n of ['Tags', 'Description', 'Náročnost', 'Délka v km', 'Termín']) await cardRemove(s.page, n).click();
  const last = await fileWhen(s.core, VYLET_YML, (t) => !!t?.includes('card: [stav, kraj, vybavení, odkaz, průvodce, neznámý-klíč, modified]'), 3000);
  assert.equal(last, vyletWith('card: [stav, kraj, vybavení, odkaz, průvodce, neznámý-klíč, modified]\n'), '(e) the same final bytes as the slow sequence');
  const tp = await typePatches(s.core);
  assert.deepEqual([tp.length, tp.every((x) => x.ok)], [5, true], '(e) five writes, none refused');
  // (d) kontrola: after review.
  const k = await another(page, { route: settingsRoute('kontrola') });
  await click(cardRemove(k.page, 'Tags'), 'kontrola: Remove Tags', 8000);
  assert.equal(await fileWhen(k.core, KONTROLA_YML, (t) => !!t?.includes('card:')), swap(original(KONTROLA_YML), 'review: false\n', 'review: false\ncard: [body, modified]\n'), '(d) after review: false');
  // D-2141: type-file writes under .tegg/types/ are allowed; no note file is written.
  const notes = [...(await core.writesTo()), ...(await s.core.writesTo()), ...(await k.core.writesTo())].filter((p) => !nfc(p).startsWith('.tegg/types/'));
  assert.deepEqual(notes, [], 'no note file is written');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-22

test('fr_typ_11_ac22_add_property', async ({ page }) => {
  const core = await openSettings(page, 'výlet');
  await click(addProperty(page), 'Add property', 5000);
  await must(addPopover(page), 'the popover');
  assert.equal((await focusName(page)).name.replace(/[⟦⟧]/g, ''), 'Find a property…', 'Find a property… is focused');
  assert.deepEqual(await addPopover(page).getByRole('group').evaluateAll((gs) => gs.map((g) => g.getAttribute('aria-label'))), ['Výlet properties', 'Built in'], 'the two groups');
  assert.deepEqual(await addOptions(page), ['poznámka', 'body', 'source', 'aliases', 'created'], 'Poznámka; Body, Source, Aliases, Created');
  for (const q of ['poz', 'POZNAMKA', 'poznámka'.normalize('NFD')]) {
    await addFind(page).fill(q);
    assert.deepEqual(await eventually(() => addOptions(page), (o) => o.length === 1), ['poznámka'], `${JSON.stringify(q)} leaves Poznámka`);
  }
  await addFind(page).fill('sou');
  assert.deepEqual(await eventually(() => addOptions(page), (o) => o.length === 1), ['source'], 'sou leaves Source');
  await addFind(page).fill('xyz');
  await must(addPopover(page).getByRole('status').filter({ hasText: 'No properties match “xyz”.' }), 'No properties match “xyz”.');
  await page.keyboard.press('Enter');
  await sleep(300);
  assert.equal((await callsOf(core, 'type_patch')).length, 0, '⏎ on no match writes nothing');
  await addFind(page).fill('poz');
  await page.keyboard.press('Enter');
  assert.equal(await fileWhen(core, VYLET_YML, (t) => !!t?.includes('poznámka]')), vyletWith('card: [tags, description, stav, náročnost, kraj, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified, poznámka]\n'), '⏎ on Poznámka appends it');
  assert.equal(await addPopover(page).count(), 0, 'the popover closes');
  assert.equal((await focusName(page)).name.replace(/[⟦⟧]/g, ''), 'Add property', 'the focus returns to Add property');
  await click(addProperty(page), 'Add property again');
  await page.keyboard.press('Escape');
  assert.equal((await callsOf(core, 'type_patch')).length, 1, 'Esc writes nothing');
  const img = await another(page, { route: settingsRoute('image') });
  await click(addProperty(img.page), 'image: Add property', 8000);
  const io = await addOptions(img.page);
  assert.ok(!io.includes('file') && io.includes('media-type') && !io.includes('review'), `Image: File isn't offered, Media type is, Review never (${io})`);
  // Every choice listed: aria-disabled.
  const full = await another(page, { vault: cardsVault((f) => { f[nfc(VYLET_YML)] = swap(f[nfc(VYLET_YML)], VYLET_CARD, 'card: [tags, description, stav, náročnost, kraj, vybavení, délka, termín, odkaz, průvodce, poznámka, body, source, aliases, created, modified]\n'); }), route: settingsRoute('výlet') });
  const add = await must(addProperty(full.page), 'Add property', 8000);
  assert.deepEqual([await isDisabled(add), await description(add)], [true, 'Every property is on the card'], 'all listed: aria-disabled');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-23

test('fr_typ_11_ac23_reordering', async ({ page }) => {
  const core = await openSettings(page, 'výlet');
  await must(cardHandle(page, 'Kraj'), 'Drag to reorder Kraj');
  // D-2142: the handles are scrolled into view before the mouse drag.
  await cardHandle(page, 'Stav').scrollIntoViewIfNeeded();
  await cardHandle(page, 'Kraj').scrollIntoViewIfNeeded();
  const from = (await cardHandle(page, 'Kraj').boundingBox())!;
  const to = (await cardHandle(page, 'Stav').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + from.width / 2, from.y + ((to.y - 4 - from.y) * i) / 10);
  await page.mouse.up();
  assert.equal(await fileWhen(core, VYLET_YML, (t) => t !== original(VYLET_YML)), vyletWith('card: [tags, description, kraj, stav, náročnost, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]\n'), 'Kraj above Stav: one write');
  await cardHandle(page, 'Kraj').focus();
  await page.keyboard.press('Alt+ArrowDown');
  assert.equal(await fileWhen(core, VYLET_YML, (t) => !!t?.includes('stav, kraj, náročnost')), vyletWith('card: [tags, description, stav, kraj, náročnost, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]\n'), '⌥↓ moves one place down (D-2159)');
  assert.equal((await focusName(page)).name.replace(/[⟦⟧]/g, ''), 'Drag to reorder Kraj', 'the focus stays on the handle');
  const n = (await callsOf(core, 'type_patch')).length;
  await cardHandle(page, 'Tags').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await cardHandle(page, 'Modified').focus();
  await page.keyboard.press('Alt+ArrowDown');
  await sleep(400);
  assert.equal((await callsOf(core, 'type_patch')).length, n, '⌥↑ on the first row and ⌥↓ on the last write nothing');
  const ex = objectCard(exampleRegion(page), P.snezka);
  await cardWhen(ex, (c) => (c?.items[0]?.attribute ?? null) === 'stav', 1000);
  assert.equal((await cardInfo(ex))?.items[0]?.attribute, 'stav', 'the example card follows');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-24

test('fr_typ_11_ac24_remove_and_reset', async ({ page }) => {
  const core = await openSettings(page, 'výlet');
  await click(resetButton(page), 'Reset to default', 5000);
  assert.equal(await fileWhen(core, VYLET_YML, (t) => t !== original(VYLET_YML)), vyletWith(''), 'Reset removes the card line in one write');
  assert.deepEqual(await eventually(() => cardRowKeys(page), (k) => k.length === 6, 1000), ['title', 'tags', 'body', 'stav', 'kraj', 'modified'], 'the list shows the default from preview');
  assert.equal(await isDisabled(resetButton(page)), true, 'Reset is then aria-disabled');
  const p = await another(page, { route: settingsRoute('výlet') });
  await must(cardList(p.page), 'the Card list', 8000);
  await runCommand(p.page, 'Reset card to default');
  assert.equal(await fileWhen(p.core, VYLET_YML, (t) => t !== original(VYLET_YML)), vyletWith(''), 'the palette command does the same');
  const r = await another(page, { route: settingsRoute('výlet') });
  await must(cardList(r.page), 'the Card list', 8000);
  for (const name of ['Tags', 'Description', 'Stav', 'Náročnost', 'Kraj', 'Vybavení', 'Délka v km', 'Termín', 'Odkaz', 'Průvodce', 'Modified']) await click(cardRemove(r.page, name), `Remove ${name}`);
  // RT-2 (proposal): unknown entries keep their place (R209, D-2076), so the last write is `card: [neznámý-klíč]`.
  assert.equal(await fileWhen(r.core, VYLET_YML, (t) => !!t?.includes('card: [neznámý-klíč]') || !!t?.includes('card: []')), vyletWith('card: [neznámý-klíč]\n'), 'removing every row keeps only the unknown key (RT-2)');
  const sn = await another(page, { vault: cardsVault((f) => { f[nfc(VYLET_YML)] = vyletWith('card: [neznámý-klíč]\n'); }), route: queryRoute(STAV_Q) });
  const c = await cardWhen(objectCard(board(sn.page), P.snezka), (x) => !!x, 8000);
  assert.deepEqual([c?.items, c?.tags, c?.text, c?.date], [[], [], null, null], 'the cards show the lead, the title and ⋯ only');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-25

test('fr_typ_11_ac25_the_example_card', async ({ page }) => {
  const core = await openSettings(page, 'výlet');
  const ex = await must(exampleRegion(page).locator('article[data-object-card][data-example]'), 'the example card', 5000);
  assert.deepEqual([await ex.getAttribute('data-path'), await ex.getAttribute('inert')], [nfc(P.snezka), ''], 'Sněžka, inert');
  assert.equal(await ex.locator('a[href], button').count(), 0, 'no link, no ⋯');
  await ex.click({ force: true });
  await sleep(300);
  assert.ok((await main(page).getByRole('heading', { level: 1 }).textContent())?.includes('Výlet'), 'a click does nothing');
  const reads = (await callsOf(core, 'type_card_example')).length;
  assert.equal(reads, 1, 'one index read when the section opens');
  await click(cardRemove(page, 'Kraj'), 'Remove Kraj');
  const c = await cardWhen(ex, (x) => !!x && !x.items.some((i) => i.attribute === 'kraj'), 1000);
  assert.ok(c && !c.items.some((i) => i.attribute === 'kraj'), 'the example follows within 1 s');
  assert.equal((await callsOf(core, 'type_card_example')).length, reads, 'and costs no read per change');
  const cl = await another(page, { route: settingsRoute('článek') });
  assert.equal(await must(exampleRegion(cl.page).locator('article[data-object-card]'), 'článek: the example', 8000).then((x) => x.getAttribute('data-path')), nfc(P.bez), 'Článek: Bez zdroje');
  const pr = await another(page, { vault: cardsVault((f) => { f['.tegg/types/prázdný.yml'] = '# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg\'s type settings.\nversion: 1\nname: Prázdný\nplural: Prázdné\nsystem: false\nfolder: Prázdné\nicon: file-text\ncolor: gray\nreview: false\nattributes: []\n'; }), route: settingsRoute('prázdný') });
  const pe = await must(exampleRegion(pr.page).locator('article[data-object-card]'), 'prázdný: the example', 8000);
  assert.deepEqual([(await pe.getAttribute('aria-label'))?.replace(/[⟦⟧]/g, ''), (await pe.innerText()).includes('No Prázdné yet')], ['Prázdný: Prázdný', true], 'a card titled Prázdný with No Prázdné yet');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-27

test('fr_typ_11_ac27_failures_and_system_types', async ({ page }) => {
  // (a) Conflict.
  const core = await openSettings(page, 'výlet');
  await must(cardList(page), 'the Card list');
  await core.setFile(VYLET_YML, swap(original(VYLET_YML), 'color: teal', 'color: blue'), { silent: true });
  await click(cardRemove(page, 'Kraj'), 'Remove Kraj');
  await must(page.getByRole('alert').filter({ hasText: /Card/ }), 'FR-TYP-01 AC-7\'s alert names Card', 3000);
  assert.equal(await fileText(core, VYLET_YML), swap(original(VYLET_YML), 'color: teal', 'color: blue'), '(a) nothing written');
  assert.ok((await eventually(() => cardRowKeys(page), (k) => k.includes('kraj'))).includes('kraj'), '(a) the section shows the disk state');
  // (b) Missing system file.
  const nt = await another(page, { vault: cardsVault((f) => { delete f['.tegg/types/task.yml']; }), route: settingsRoute('task') });
  await click(cardRemove(nt.page, 'Recurrence'), 'Task: Remove Recurrence', 8000);
  const ne = cardsVault().files['.tegg/types/task.yml'];
  assert.equal(await fileWhen(nt.core, '.tegg/types/task.yml', (t) => !!t), swap(ne, 'preview: [status, priority, due]\n', 'preview: [status, priority, due]\ncard: [tags, body, status, due, priority, source]\n'), '(b) created with the line');
  // (c) System types: each has the section with R210's list.
  const lists: Record<string, string[]> = { page: ['tags', 'body', 'modified'], 'quick-note': ['body', 'created'], 'daily-note': ['body', 'modified'], image: ['width', 'height', 'size', 'created'], pdf: ['tags', 'pages', 'size', 'created'] };
  for (const [k, want] of Object.entries(lists)) {
    const x = await another(page, { route: settingsRoute(k) });
    await must(cardList(x.page), `${k}: the Card list`, 8000);
    assert.deepEqual(await cardRowKeys(x.page), ['title', ...want], `${k}: R210`);
  }
  // (d) Newer version: read-only with AR-07 AC-3's reason; (e) invalid: AR-07 AC-4's error.
  const nv = await another(page, { vault: cardsVault((f) => { f[nfc(VYLET_YML)] = swap(f[nfc(VYLET_YML)], 'version: 1', 'version: 2'); }), route: settingsRoute('výlet') });
  const add = await must(addProperty(nv.page), 'newer: Add property', 8000);
  assert.equal(await isDisabled(add), true, '(d) read-only');
  await add.click({ force: true });
  assert.equal((await callsOf(nv.core, 'type_patch')).length, 0, '(d) no type write');
  // (f) Tag: no Card section.
  const tg = await another(page, { route: settingsRoute('tag') });
  await must(main(tg.page).getByRole('heading', { level: 1 }), 'tag', 8000);
  assert.equal(await cardList(tg.page).count(), 0, '(f) Tag: no Card section');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-28

test('fr_typ_11_ac28_kept_consistent_with_schema_changes', async ({ page }) => {
  const v = cardsVault((f) => {
    for (const p of [P.snezka, P.palava]) f[nfc(p)] = f[nfc(p)].replace(/^kraj: .*\n/m, '');
  });
  const core = await openSettings(page, 'výlet', { vault: v });
  await click(editProperty(page, 'Kraj'), 'Edit Kraj', 5000);
  await click(main(page).getByRole('button', { name: /^⟦?Delete property…⟧?$/ }), 'Delete property…');
  const d = await must(page.getByRole('dialog', { name: /^⟦?Delete property "Kraj"\?⟧?$/ }), 'the delete dialog');
  // D-2143: Máchovo keeps `kraj: "—"`, a value for the delete job (D-2124), so the dialog is the job's, as for an
  // attribute that still has values (type-moves.md FR-TYP-04 AC-6, AC-7).
  await click(d.getByRole('button', { name: /^⟦?Delete from 1 note⟧?$/ }), 'Delete from 1 note');
  const t = await fileWhen(core, VYLET_YML, (x) => !x?.includes('key: kraj'), 5000);
  assert.ok(t?.includes('card: [tags, description, stav, náročnost, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]\n') && t.includes('preview: [stav]\n'), 'the delete job removes kraj from card: and preview in the same write');
  assert.equal((await core.writesTo()).filter((p) => nfc(p) === nfc(VYLET_YML)).length, 1, 'one type-file change');
  // Renaming, the type's Name and colour never write card:.
  const r = await another(page, { route: settingsRoute('výlet') });
  await click(editProperty(r.page, 'Kraj'), 'Edit Kraj', 8000);
  const name = r.page.getByRole('textbox', { name: /^⟦?Name⟧?$/ }).last();
  await name.fill('Region');
  await name.press('Enter');
  const after = await fileWhen(r.core, VYLET_YML, (x) => !!x?.includes('name: Region'), 3000);
  assert.ok(after?.includes(VYLET_CARD), 'renaming Kraj never writes card:');
});

// ------------------------------------------------------------------------------------------------ types.md FR-TYP-01 AC-22

const TEN = ['General', 'Properties', 'Built in on every type', 'Card', 'Hidden properties', 'Embeds', 'Review workflow', 'Templates', 'Views', 'Delete type'];

test('fr_typ_01_ac22_ten_sections_in_the_shared_layout', async ({ page }) => {
  const core = await openSettings(page, 'výlet');
  const nav = await must(settingsNav(page), 'the nav Settings sections');
  assert.deepEqual(await nav.getByRole('link').allTextContents().then((x) => x.map((t) => t.trim())), TEN, 'the ten links in order');
  assert.deepEqual(await sectionNames(page), TEN, 'the ten sections');
  const cols = async (p: Page) => p.locator('div.settings-row').evaluateAll((rs) => rs.map((r) => [Math.round(r.querySelector('.settings-label')?.getBoundingClientRect().left ?? -1), Math.round(r.querySelector('.settings-control')?.getBoundingClientRect().left ?? -1)]));
  const mine = await cols(page);
  const vs = await another(page, { route: 'settings/vault' });
  await must(settingsNav(vs.page), 'settings/vault: the section list', 8000);
  const ref = (await cols(vs.page))[0];
  assert.ok(mine.length > 0 && ref && mine.every(([l, c]) => Math.abs(l - ref[0]) <= 1 && Math.abs(c - ref[1]) <= 1), `every labelled control sits in R219's columns (${JSON.stringify(mine.slice(0, 3))} vs ${ref})`);
  await nav.getByRole('link', { name: /^⟦?Views⟧?$/ }).click();
  await sleep(500);
  // RT-10 (proposal): "the top of the pane" is the top of the scrolling area that holds the sections.
  const gap = await tsSection(page, 'views').locator('h2').evaluate((h) => {
    let s: HTMLElement | null = h.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    return s ? h.getBoundingClientRect().top - s.getBoundingClientRect().top : null;
  }).catch(() => null);
  assert.ok(gap !== null && Math.abs(gap) <= 8, `Views scrolls its h2 to the top of the pane (± 8 px): ${gap}`);
  assert.equal(await nav.getByRole('link', { name: /^⟦?Views⟧?$/ }).getAttribute('aria-current'), 'location', 'aria-current="location"');
  const tag = await another(page, { route: settingsRoute('tag') });
  await must(settingsNav(tag.page), 'tag: the section list', 8000);
  assert.deepEqual(await sectionNames(tag.page), ['General', 'Properties', 'Built in on every type', 'Embeds', 'Review workflow', 'Templates', 'Delete type'], 'Tag: seven sections');
  assert.deepEqual(await writtenPaths(core), [], 'opening and scrolling write nothing');
});

// ------------------------------------------------------------------------------------------------ types.md FR-TYP-01 AC-23

test('fr_typ_01_ac23_general_icon_opens_the_picker', async ({ page }) => {
  const core = await openSettings(page, 'výlet');
  const btn = await must(changeIcon(page), 'Change icon');
  assert.equal(await btn.locator('svg[data-icon]').getAttribute('data-icon'), 'map', 'Change icon shows the type\'s icon');
  await btn.click();
  await must(picker(page, 'Výlet'), 'the picker Icon for Výlet');
  assert.equal(await description(pickerOption(page, 'map')), 'Current', 'map is Current');
  assert.equal(await pickerNone(page).count(), 0, 'no None for the type icon');
  await page.keyboard.press('Escape');
  assert.deepEqual([await picker(page).count(), (await focusName(page)).name.replace(/[⟦⟧]/g, ''), (await callsOf(core, 'type_patch')).length], [0, 'Change icon', 0], 'Esc writes nothing, the focus on Change icon');
  await btn.click();
  await page.keyboard.type('tent');
  await click(pickerOption(page, 'tent'), 'tent');
  assert.equal(await fileWhen(core, VYLET_YML, (t) => !!t?.includes('icon: tent')), swap(original(VYLET_YML), 'icon: map\n', 'icon: tent\n'), 'choosing tent writes only the icon line');
  const k = await another(page, { route: settingsRoute('kontrola') });
  await click(changeIcon(k.page), 'kontrola: Change icon', 8000);
  assert.equal(await description(pickerOption(k.page, 'square-check-big')), 'Current', 'Kontrola: square-check-big is Current');
});

// ------------------------------------------------------------------------------------------------ types.md FR-TYP-01 AC-24

test('fr_typ_01_ac24_properties_one_open_icon_button', async ({ page }) => {
  await openSettings(page, 'výlet');
  const stav = await must(propertyIcon(page, 'Stav'), 'Icon for Stav');
  assert.equal(await stav.locator('svg[data-icon]').getAttribute('data-icon'), 'circle-dot', 'Stav shows circle-dot');
  for (const n of ['Náročnost', 'Délka v km']) assert.equal(await description(propertyIcon(page, n)), 'No icon', `${n}: the placeholder with No icon`);
  const rowFirst = await main(page).locator('div.ts-prop[data-attribute="stav"]').evaluate((r) => (r.querySelector('button')?.getAttribute('aria-label') ?? r.querySelector('button')?.textContent ?? '').trim()).catch(() => '');
  assert.ok(rowFirst.includes('Icon for Stav'), 'each row starts with its icon button');
  await click(editProperty(page, 'Stav'), 'Edit Stav');
  assert.equal(await editProperty(page, 'Stav').getAttribute('aria-expanded'), 'true', 'Stav expands');
  await click(editProperty(page, 'Kraj'), 'Edit Kraj');
  const expanded = await main(page).locator('div.ts-prop [aria-expanded="true"]').count();
  assert.deepEqual([await editProperty(page, 'Stav').getAttribute('aria-expanded'), expanded], ['false', 1], 'opening Kraj collapses Stav: at most one row');
  await page.keyboard.press('Escape');
  assert.equal((await focusName(page)).name.replace(/[⟦⟧]/g, ''), 'Edit Kraj', 'Esc collapses and keeps the focus on Edit Kraj');
  await click(propertyIcon(page, 'Kraj'), 'Icon for Kraj');
  await must(picker(page, 'Kraj'), 'the picker Icon for Kraj');
  assert.deepEqual([await description(pickerOption(page, 'map-pin')), await pickerNone(page).count()], ['Current', 1], 'map-pin Current; None (show the name)');
  const t = await another(page, { route: settingsRoute('task') });
  await must(propertyIcon(t.page, 'Status'), 'Task: Icon for Status (built in)', 8000);
});

// ------------------------------------------------------------------------------------------------ types.md FR-TYP-01 AC-25, AC-26, AC-27

test('fr_typ_01_ac25_views_lists_the_real_views', async ({ page }) => {
  const core = await openSettings(page, 'book');
  const list = await must(viewsList(page, 'Books'), 'the list Views of Books');
  const rows = await list.locator('li[data-view-row]').evaluateAll((ls) => ls.map((l) => [l.getAttribute('data-view-row'), (l.textContent ?? '').replace(/\s+/g, ' ').trim()]));
  assert.deepEqual(rows.map(([n]) => n), ['', 'Rozečtené', 'Přečtené 2026', 'Výborné knihy'], 'All Books, then views: in order');
  assert.ok(rows[0][1]?.includes('All Books') && rows[0][1].includes('Default · always first'), 'All Books: Default · always first');
  // Slice Q3 (AC-Test-Change, D-2196; FR-TYP-01 AC-29, R227): `Wall · by Status` (`typeSettings.viewKindBy`).
  assert.ok(rows[1][1]?.includes('Wall · by Status') && rows[2][1]?.includes('Table') && rows[3][1]?.includes('Table'), 'kinds');
  assert.equal(await list.locator('li[data-view-row=""]').getByRole('button').count(), 0, 'All has no handle, Edit or remove');
  for (const n of ['Rozečtené', 'Přečtené 2026', 'Výborné knihy']) {
    const r = list.locator(`li[data-view-row="${n}"]`);
    assert.ok((await r.getByRole('button', { name: new RegExp(`Drag to reorder ${n}`) }).count()) && (await r.getByRole('button', { name: /^⟦?Edit⟧?$/ }).count()) && (await r.getByRole('button', { name: /Remove from Books page/ }).count()), `${n}: handle, Edit, Remove from Books page`);
  }
  assert.ok(await tsSection(page, 'views').locator('button[data-command="views.new"]').count(), 'Add view');
  assert.ok(!(await tsSection(page, 'views').innerText()).includes('Coming in'), 'nothing says Coming in');
  const k = await another(page, { route: settingsRoute('kontrola') });
  const kl = await must(viewsList(k.page, 'Kontroly'), 'kontrola: Views of Kontroly', 8000);
  assert.deepEqual(await kl.locator('li[data-view-row]').evaluateAll((ls) => ls.map((l) => l.getAttribute('data-view-row'))), [''], 'only All Kontroly');
  assert.deepEqual(await writtenPaths(core), [], 'opening writes nothing');
});

test('fr_typ_01_ac26_views_actions_write_as_on_the_type_page', async ({ page }) => {
  const core = await openSettings(page, 'book');
  const list = await must(viewsList(page, 'Books'), 'Views of Books');
  await list.getByRole('button', { name: /^⟦?Drag to reorder Výborné knihy⟧?$/ }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await page.keyboard.press('Alt+ArrowUp');
  const t = await fileWhen(core, BOOK_YML, (x) => !!x?.includes('views: [Výborné knihy, Rozečtené, Přečtené 2026]'), 3000);
  assert.equal(t, swap(original(BOOK_YML), 'views: [Rozečtené, Přečtené 2026, Výborné knihy]', 'views: [Výborné knihy, Rozečtené, Přečtené 2026]'), 'two ⌥↑: line 13 written once per move');
  assert.equal((await typePatches(core)).length, 2, 'one write per move');
  await click(list.locator('li[data-view-row="Rozečtené"]').getByRole('button', { name: /^⟦?Edit⟧?$/ }), 'Edit on Rozečtené');
  await must(page.getByRole('dialog', { name: /^⟦?Edit (view|query)/ }), 'the views editor (R189)');
  await page.keyboard.press('Escape');
  await click(list.locator('li[data-view-row="Přečtené 2026"]').getByRole('button', { name: /Remove from Books page/ }), 'Remove from Books page');
  assert.ok((await fileWhen(core, BOOK_YML, (x) => !!x?.includes('views: [Výborné knihy, Rozečtené]'), 3000))?.includes('views: [Výborné knihy, Rozečtené]'), 'the views line as FR-QRY-07 AC-20');
  assert.ok((await core.files())['.tegg/queries/Přečtené 2026.yml'], 'the query file is kept');
  const inv = await another(page, { vault: cardsVault((f) => { f[nfc(BOOK_YML)] = f[nfc(BOOK_YML)].replace('version: 1', 'version: 2'); }), route: settingsRoute('book') });
  const il = await must(viewsList(inv.page, 'Books'), 'newer: Views', 8000);
  assert.ok(await isDisabled(il.getByRole('button', { name: /Drag to reorder Rozečtené/ })), 'a newer file: the section is read-only');
});

test('fr_typ_01_ac27_restore_default_views_inside_views', async ({ page }) => {
  await startTasksViews(page, { vault: overlayVault(), route: settingsRoute('task') });
  await must(main(page).getByRole('heading', { level: 1 }), 'type-settings/task', 8000);
  assert.ok(!(await sectionNames(page)).includes('Default views'), 'no Default views section');
  const list = await must(viewsList(page, 'Tasks'), 'Views of Tasks');
  const rows = await list.locator('li[data-view-row]').evaluateAll((ls) => ls.map((l) => [l.getAttribute('data-view-row'), (l.textContent ?? '').replace(/\s+/g, ' ').trim()]));
  assert.deepEqual(rows.map(([n]) => n), ['', 'Schedule', 'Kanban', 'Čeká na ostatní'], 'All Tasks, Schedule, Kanban, Čeká na ostatní');
  // Slice Q3 (AC-Test-Change, D-2196; FR-TYP-01 AC-29, R227): `Wall · by Due date`, `Wall · by Status`.
  assert.ok(rows[1][1]?.includes('Wall · by Due date') && rows[2][1]?.includes('Wall · by Status') && rows[3][1]?.includes('Table'), 'their kinds');
  const btns = await tsSection(page, 'views').getByRole('button').evaluateAll((bs) => bs.map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim()));
  assert.equal(btns.at(-1)?.replace(/[⟦⟧]/g, ''), 'Restore default views', 'Restore default views last in the Views section');
  void STAV_Q; void queryRoute; void board; void typeRoute;
});
