// Slice OC, L5: the card list as the UI reads it from the type file (docs/acceptance/cards.md FR-TYP-11 AC-5, AC-6,
// AC-26, FR-FMT-12 AC-15; R209, R210), through the fake core with the cards fixture (docs/contracts/v1-cards.md §4.2
// `TypeDto.cardList` / `cardDefault` / `cardKeys` / `cardUnreadable`, §8, §13). Test clock `2026-11-19T10:00:00+01:00`,
// Europe/Prague, `en-US`. Written from the ACs and the contract only (D-61).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, SEVEN, STAV_Q, VYLET_YML, addProperty, another, board, callsOf, cardInfo, cardRowKeys, cardWhen, cardsVault, description, isDisabled, must, nfc, noteRoute, objectCard,
  queryRoute, resetButton, sevenTypes, settingsRoute, sleep, startCards, swap, tsSection, typeRoute, vyletWith, writtenPaths,
} from './cards-helpers';

test.use({ timezoneId: 'Europe/Prague' });

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-5

test('fr_typ_11_ac5_default_card_lists', async ({ page }) => {
  const core = await startCards(page, { vault: cardsVault((f) => sevenTypes(f)), route: queryRoute(SEVEN) });
  const b = await must(board(page), 'the seven-type board', 8000);
  const u = await cardWhen(objectCard(b, P.ucetni), (c) => !!c?.date);
  assert.deepEqual([u?.text, u?.items.map((i) => i.attribute), u?.footerLink, u?.date], ['Kriminálka z kanceláře nad hospodou.', ['status'], 'Jana Brázdová', 'Edited Mon'], 'Book: R210\'s default tags, body, author, status, modified');
  const k = await cardInfo(objectCard(b, P.kontrola));
  assert.deepEqual([k?.tags, k?.text, k?.items, k?.date], [['#kolo'], 'Brzdy seřízené, řetěz namazaný.', [], 'Edited Tue'], 'Kontrola: tags, body, modified');
  // Runtime variants of book.yml.
  const book = (await core.files())['.tegg/types/book.yml'];
  for (const [line, want] of [['preview: [tags, modified, neznámý, author]', ['author']], ['preview: []', []]] as [string, string[]][]) {
    await core.setFile('.tegg/types/book.yml', swap(book, 'preview: [author, status]', line));
    const c = await cardWhen(objectCard(b, P.ucetni), (x) => JSON.stringify(x?.items.map((i) => i.attribute)) === JSON.stringify(want) && (want.length ? !!x?.footerLink : !x?.footerLink), 2000);
    assert.deepEqual([c?.items.map((i) => i.attribute), c?.footerLink ?? null, c?.date], [[], want.length ? 'Jana Brázdová' : null, 'Edited Mon'], `${line}: the card follows R210`);
  }
  await core.setFile('.tegg/types/book.yml', book);
  // An undefined type (D-121): tags, body, modified.
  const o = await another(page, { vault: cardsVault((f) => { sevenTypes(f); f['Pages/Recept na bábovku.md'] = '---\ntype: recept\ntitle: Recept na bábovku\ntags: [pečení]\nmodified: 2026-11-18T10:00:00+01:00\n---\nMouka a vejce.\n'; f[`.tegg/queries/${SEVEN}.yml`] = f[`.tegg/queries/${SEVEN}.yml`].replace('types: [výlet', 'types: [recept, výlet'); }), route: queryRoute(SEVEN) });
  const r = await cardWhen(objectCard(board(o.page), 'Pages/Recept na bábovku.md'), (c) => !!c, 8000);
  assert.deepEqual([r?.tags, r?.text, r?.date], [['#pečení'], 'Mouka a vejce.', 'Edited yesterday'], 'an undefined type: tags, body, modified');
  // Opening and drawing write no type file.
  for (const route of [typeRoute('výlet'), settingsRoute('výlet'), settingsRoute('book'), noteRoute(P.karty)]) {
    const x = await another(page, { route });
    await sleep(800);
    assert.deepEqual((await writtenPaths(x.core)).filter((p) => p.startsWith('.tegg/types/')), [], `${route} writes no type file`);
  }
  assert.deepEqual((await writtenPaths(core)).filter((p) => p.startsWith('.tegg/types/')), [], 'the board writes no type file');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-6

test('fr_typ_11_ac6_card_key_is_read', async ({ page }) => {
  const core = await startCards(page, { route: queryRoute(STAV_Q) });
  const b = await must(board(page), 'Výlety podle stavu', 8000);
  const before = await cardWhen(objectCard(b, P.snezka), (c) => (c?.items.length ?? 0) > 0);
  assert.ok(before && !before.items.some((i) => i.attribute === 'neznámý-klíč' || i.attribute === 'poznámka'), 'Výlet\'s card: neznámý-klíč and poznámka never drawn');
  await core.setFile(VYLET_YML, swap(vyletWith('card: [tags, description, stav, náročnost, kraj, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]\n'), 'preview: [stav, kraj]', 'preview: []'));
  await sleep(800);
  assert.deepEqual(await cardInfo(objectCard(b, P.snezka)), before, 'a runtime preview: [] gives the same card');
  await core.setFile(VYLET_YML, vyletWith('card: []\n'));
  const empty = await cardWhen(objectCard(b, P.snezka), (c) => !!c && c.items.length === 0 && !c.date, 2000);
  assert.deepEqual([empty?.items, empty?.tags, empty?.text, empty?.footerLink, empty?.date], [[], [], null, null, null], 'card: []: only the lead, the title and ⋯');
  await core.setFile(VYLET_YML, vyletWith('card: [title, kraj]\n'));
  const tk = await cardWhen(objectCard(b, P.snezka), (c) => c?.items.length === 1, 2000);
  assert.deepEqual(tk?.items.map((i) => i.attribute), ['kraj'], 'card: [title, kraj]: the title once and the Kraj pill');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-26

test('fr_typ_11_ac26_hand_written_card', async ({ page }) => {
  const vault = (line: string) => cardsVault((f) => { f[nfc(VYLET_YML)] = swap(f[nfc(VYLET_YML)], 'card: [tags, description, stav, náročnost, kraj, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]\n', line); });
  // (a) repeats.
  await startCards(page, { vault: vault('card: [tags, tags, title, kraj]\n'), route: queryRoute(STAV_Q) });
  const a = await cardWhen(objectCard(board(page), P.snezka), (c) => !!c, 8000);
  assert.deepEqual([a?.tags, a?.items.map((i) => i.attribute)], [['#hory', '#zima', '#rodina', '+1'], ['kraj']], '(a) tags once, Kraj once');
  // (b) NFD kraj matches.
  const b2 = await another(page, { vault: vault(`card: [${'kraj'.normalize('NFD')}, ${'náročnost'.normalize('NFD')}]\n`), route: queryRoute(STAV_Q) });
  const bb = await cardWhen(objectCard(board(b2.page), P.snezka), (c) => !!c, 8000);
  assert.deepEqual(bb?.items.map((i) => i.attribute), ['kraj', 'náročnost'], '(b) NFD entries match');
  // (c) block list.
  const c3 = await another(page, { vault: vault('card:\n  - tags\n  - kraj\n'), route: queryRoute(STAV_Q) });
  const cc = await cardWhen(objectCard(board(c3.page), P.snezka), (c) => !!c, 8000);
  assert.deepEqual([cc?.tags.length, cc?.items.map((i) => i.attribute)], [4, ['kraj']], '(c) a block list reads like a flow list');
  // (d) scalar / mapping: the default for Výlet; the section read-only with the reason.
  for (const line of ['card: tags\n', 'card: { a: b }\n']) {
    const d = await another(page, { vault: vault(line), route: queryRoute(STAV_Q) });
    const dd = await cardWhen(objectCard(board(d.page), P.snezka), (c) => !!c, 8000);
    assert.deepEqual([dd?.textFrom, dd?.items.map((i) => i.attribute)], ['body', ['kraj']], `${line.trim()}: R210's default tags, body, stav, kraj, modified (stav groups)`);
    const s = await another(page, { vault: vault(line), route: settingsRoute('výlet') });
    const add = await must(addProperty(s.page), `${line.trim()}: Add property`, 8000);
    assert.equal(await isDisabled(add), true, `${line.trim()}: the controls are aria-disabled`);
    assert.equal(await description(add), 'The card setting in .tegg/types/výlet.yml can\'t be read. Fix it in the file to change the card.', 'the reason');
    assert.equal(await isDisabled(resetButton(s.page)), true, 'Reset is disabled too');
    await add.click({ force: true });
    await sleep(300);
    assert.deepEqual((await callsOf(s.core, 'type_patch')).length, 0, 'no type write is sent');
  }
  void tsSection;
  void cardRowKeys;
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-15

test('fr_fmt_12_ac15_card_keys_and_icon_names_are_nfc', async ({ page }) => {
  const vault = cardsVault((f) => {
    f[nfc(VYLET_YML)] = swap(f[nfc(VYLET_YML)], '  - key: náročnost\n', `  - key: ${'náročnost'.normalize('NFD')}\n`).replace('    icon: map-pin\n', '    icon: mapá\n');
    f[nfc(P.snezka)] = swap(f[nfc(P.snezka)], 'Z Pece', `#${'rodina'.normalize('NFD')} Z Pece`);
  });
  await startCards(page, { vault, route: queryRoute(STAV_Q) });
  const c = await cardWhen(objectCard(board(page), P.snezka), (x) => !!x, 8000);
  assert.ok(c?.items.some((i) => i.attribute?.normalize('NFC') === 'náročnost' && i.text.includes('Střední')), 'an NFD attribute key with its NFC value draws the pill');
  assert.deepEqual(c?.tags, ['#hory', '#zima', '#rodina', '+1'], 'an NFD #rodina in the body counts as rodina, once');
  const kraj = c?.items.find((i) => i.attribute === 'kraj');
  assert.deepEqual([kraj?.icon ?? null, kraj?.text], [null, 'Kraj Královéhradecký'], 'an icon name with a non-ASCII character is unknown: no icon, the Name');
});
