// Slice OC, L5: where the card is drawn and what else shows property icons (docs/acceptance/cards.md R213): FR-TYP-11
// AC-14 (the Task card on the views-tasks overlay), AC-15 (Image and PDF cards), AC-17 (one component everywhere),
// FR-TYP-12 AC-4 (`Unreviewed`), FR-TYP-01 AC-13 and types.md FR-EDT-07 AC-22 (header and panel icons), FR-SYN-06 AC-51
// (L5 counts: browsing writes nothing, each action one file) and FR-UX-08 AC-26 (what VoiceOver reads). Through the fake
// core (docs/contracts/v1-cards.md §8, §13). Written from the ACs and the contract only (D-61).
import type { Locator, Page } from '@playwright/test';
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  CLANEK_YML, P, SEVEN, STAV_Q, VYLET_YML, addPopover, addProperty, another, board, callsOf, cardInfo, cardWhen, cardsVault, click, embedFrame, eventually, exampleRegion, main,
  must, nfc, noteRoute, objectCard, picker, pickerSearch, queryRoute, sevenTypes, settingsRoute, sleep, startCards, swap, typePatches, typeRoute, uiState, writtenPaths,
} from './cards-helpers';
import { SCHEDULE, KANBAN, overlayVault, startTasksViews, TYPE_TASK } from './views-tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-14

test('fr_typ_11_ac14_task_card_keeps_d1904', async ({ page }) => {
  const core = await startTasksViews(page, { vault: overlayVault(), route: TYPE_TASK });
  const sched = await must(main(page).locator(`div[role="group"][data-board][data-board-name="${SCHEDULE}"]`), 'the Schedule board', 8000);
  const cards = sched.locator('article[data-object-card][data-task-card]');
  await must(cards, 'Task cards are ObjectCards with data-task-card', 5000);
  const zj = cards.filter({ hasText: 'Zavolat Janě' }).first();
  const c = await cardInfo(zj);
  assert.ok(c?.leadChecbox, 'R43\'s checkbox is the lead');
  assert.ok(await zj.getByRole('checkbox', { name: /^⟦?Complete "Zavolat Janě"⟧?$/ }).count(), 'Complete "Zavolat Janě"');
  assert.equal(c?.footerLink, 'Porada', 'the source chip Porada is in the footer');
  // A runtime card: [status, due] removes the priority chips, tags and body lines; the source chips stay.
  const yml = (await core.files())['.tegg/types/task.yml'];
  await core.setFile('.tegg/types/task.yml', swap(yml, 'preview: [status, priority, due]\n', 'preview: [status, priority, due]\ncard: [status, due]\n'));
  const after = await cardWhen(zj, (x) => !!x && !x.items.some((i) => i.attribute === 'priority') && x.text === null && x.tags.length === 0, 2000);
  assert.deepEqual([after?.items.some((i) => i.attribute === 'priority'), after?.text, after?.tags, after?.footerLink], [false, null, [], 'Porada'], 'card: [status, due] within 2 s; the source chip stays');
  const k = await another(page, { route: TYPE_TASK });
  void k;
  void KANBAN;
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-15

test('fr_typ_11_ac15_image_and_pdf_cards', async ({ page }) => {
  const net: string[] = [];
  page.on('request', (r) => { if (!/^(http:\/\/(localhost|127\.0\.0\.1)|tegg-media:|data:|blob:)/.test(r.url())) net.push(r.url()); });
  const core = await startCards(page, { vault: cardsVault((f) => sevenTypes(f)), route: queryRoute(SEVEN) });
  const b = await must(board(page), 'the seven-type board', 8000);
  const v = await must(objectCard(b, P.vyhlidka), 'Vyhlídka\'s card');
  const strip = await v.evaluate((c) => {
    const s = c.firstElementChild as HTMLElement; const img = s?.querySelector('img'); const cs = getComputedStyle(c);
    const inner = c.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    return { first: s?.getAttribute('data-strip'), alt: img?.getAttribute('alt'), src: img?.getAttribute('src'), w: img?.getBoundingClientRect().width, inner, h: img?.getBoundingClientRect().height, fit: img ? getComputedStyle(img).objectFit : null };
  });
  assert.equal(strip.first, 'image', 'the card starts with the strip');
  assert.equal(strip.alt, 'Vyhlídka na Pálavě', 'alt = the title');
  // The fake core's media base (http://localhost/__media/…) stands for tegg-media:// in WebKit (D-2017, contract §7.1).
  assert.ok(/^(tegg-media:\/\/.*|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/__media)\/_attachments\/vyhlidka\.png$/.test(decodeURIComponent(strip.src ?? '')), `src from tegg-media:// or the fake's media base (${strip.src})`);
  assert.ok(Math.abs((strip.w ?? 0) - strip.inner) <= 1 && (strip.h ?? 999) <= 120 && strip.fit === 'cover', `the card's inner width, ≤ 120 px, cover (${JSON.stringify(strip)})`);
  const vi = await cardInfo(v);
  assert.deepEqual([vi?.lead, vi?.items.map((i) => i.text), vi?.date], ['image', ['Width 64', 'Height 48', 'Size 1.2 KB'], 'Added Mon'], 'then the lead, pills and footer');
  const pr = objectCard(b, P.pravidla);
  const ps = await pr.evaluate((c) => ({ first: (c.firstElementChild as HTMLElement)?.getAttribute('data-strip'), text: (c.firstElementChild as HTMLElement)?.textContent ?? '', canvas: c.querySelectorAll('canvas, iframe, embed, object').length }));
  assert.deepEqual([ps.first, ps.text.includes('2 pages · 844 bytes'), ps.canvas], ['pdf', true, 0], 'the PDF strip: R77\'s card, no page rendered');
  await core.setFile('_attachments/vyhlidka.png', null);
  await sleep(1000);
  assert.ok(await v.locator('.card-strip[data-missing]').count(), 'a removed PNG: R77\'s missing-file state');
  assert.equal((await cardInfo(v))?.items.length, 3, 'the rest stays');
  assert.deepEqual(net, [], 'no network request');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-17

test('fr_typ_11_ac17_one_component_everywhere', async ({ page }) => {
  await startCards(page, { route: queryRoute(STAV_Q) });
  const b = await must(board(page), 'Výlety podle stavu', 8000);
  const onBoard = await cardWhen(objectCard(b, P.snezka), (c) => (c?.items.length ?? 0) > 0);
  const k = await another(page, { route: noteRoute(P.karty) });
  const inKarty = await cardWhen(objectCard(main(k.page), P.snezka), (c) => (c?.items.length ?? 0) > 0, 8000);
  const items = (c: typeof onBoard) => (c?.items ?? []).map((i) => [i.attribute, i.text]);
  assert.deepEqual(items(onBoard), items(inKarty).filter(([a]) => a !== 'stav'), 'the same items in the same order on the board (minus stav) and in Karty');
  // The preview strip of Sněžka: the pills then the link chip (D-1956).
  const pv = await another(page, { route: noteRoute(P.odkaz), ui: { preview: { mode: 'click' } } });
  await must(objectCard(main(pv.page), P.odkaz).or(main(pv.page)), 'Odkaz', 8000);
  const chip = main(pv.page).getByRole('link', { name: /Sněžka z Pece/ }).first();
  await click(chip, 'the Sněžka z Pece chip');
  const region = pv.page.getByRole('dialog', { name: /^⟦?Preview: Sněžka z Pece/ }).getByRole('region', { name: /^⟦?Preview properties⟧?$/ });
  await must(region, 'the preview\'s Preview properties region');
  const strip = await region.evaluate((r) => ([...r.querySelectorAll('[data-attribute]')] as HTMLElement[]).map((e) => [e.getAttribute('data-attribute'), (e.textContent ?? '').replace(/\s+/g, ' ').trim()]));
  assert.deepEqual(strip, [...items(inKarty), ['průvodce', 'Eva Lindová']], 'the preview strip: the same pills, then the link chip');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-12 AC-4

test('fr_typ_12_ac4_the_unreviewed_pill', async ({ page }) => {
  const core = await startCards(page, { vault: cardsVault((f) => sevenTypes(f)), route: queryRoute(SEVEN) });
  const b = await must(board(page), 'the seven-type board', 8000);
  const first = async (p: string) => (await cardInfo(objectCard(b, p)))?.items[0]?.kind ?? null;
  assert.deepEqual(await Promise.all([P.chaty, P.bez, P.napad].map(first)), ['unreviewed', 'unreviewed', 'unreviewed'], 'Chaty, Bez zdroje, Nápad: Unreviewed first');
  const unrev = objectCard(b, P.chaty).locator('.card-unreviewed[data-review="unreviewed"]');
  const tok = await unrev.evaluate((e) => ({ text: e.textContent?.trim(), color: getComputedStyle(e).color, warn: getComputedStyle(document.documentElement).getPropertyValue('--warning').trim() })).catch(() => null);
  assert.equal(tok?.text, 'Unreviewed', 'the D-600 text');
  const none = await Promise.all([P.podklady, P.textovy, P.odkaz, P.ucetni].map(async (p) => (await cardInfo(objectCard(b, p)))?.items.some((i) => i.kind === 'unreviewed')));
  assert.deepEqual(none, [false, false, false, false], 'reviewed objects and Books show none');
  await core.setFile(P.chaty, swap((await core.files())[nfc(P.chaty)], 'review: unreviewed', 'review: reviewed'));
  const gone = await cardWhen(objectCard(b, P.chaty), (c) => !!c && !c.items.some((i) => i.kind === 'unreviewed'), 2000);
  assert.ok(gone && !gone.items.some((i) => i.kind === 'unreviewed'), 'another program\'s review: reviewed removes the pill within 2 s');
  // In Karty's card embed: the pill, not the header dot.
  const k = await another(page, { route: noteRoute(P.karty) });
  const fr = await must(embedFrame(k.page, 'Horské chaty'), 'Karty: Chaty', 8000);
  assert.equal((await cardInfo(objectCard(fr, P.chaty)))?.items[0]?.kind, 'unreviewed', 'Karty\'s Chaty: the pill is the card\'s first item');
  // In the example card of type-settings/článek (Bez zdroje).
  const s = await another(page, { route: settingsRoute('článek') });
  const ex = await must(exampleRegion(s.page).locator('article[data-object-card]'), 'the example card', 8000);
  assert.equal((await cardInfo(ex))?.items[0]?.kind, 'unreviewed', 'the example card shows Unreviewed');
  // A hand-written review in card: draws nothing more.
  const h = await another(page, { vault: cardsVault((f) => { f[nfc(CLANEK_YML)] = swap(f[nfc(CLANEK_YML)], 'card: [body, rubrika, source, created]', 'card: [review, rubrika]'); }), route: noteRoute(P.karty) });
  const hc = await cardWhen(objectCard(main(h.page), P.chaty), (c) => !!c, 8000);
  assert.deepEqual(hc?.items.map((i) => i.kind), ['unreviewed', 'pill'], 'review in card: draws only the fixed pill');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-13

async function headerIcons(scope: Locator, cells = '[role="columnheader"]'): Promise<[string, string | null, string | null][]> {
  return scope.locator(cells).evaluateAll((hs) => hs.map((h) => {
    const s = h.querySelector('svg[data-icon]');
    return [(h.textContent ?? '').replace(/\s+/g, ' ').trim(), s?.getAttribute('data-icon') ?? null, s?.getAttribute('aria-hidden') ?? null] as [string, string | null, string | null];
  })).catch(() => []);
}
async function panelIcons(page: Page): Promise<Record<string, string | null>> {
  return main(page).locator('[data-attribute-panel] [data-attribute], .attribute-panel [data-attribute]').evaluateAll((rows) => Object.fromEntries(rows.map((r) => {
    const label = r.querySelector('label, .attr-label, [data-label]') as HTMLElement | null;
    return [(label?.textContent ?? '').replace(/\s+/g, ' ').trim(), label?.querySelector('svg[data-icon]')?.getAttribute('data-icon') ?? null];
  }))).catch(() => ({}));
}

test('fr_typ_01_ac13_where_property_icons_show', async ({ page }) => {
  const core = await startCards(page, { vault: cardsVault((f) => { f[nfc(VYLET_YML)] = swap(f[nfc(VYLET_YML)], 'views: [Výlety podle stavu]\n', 'columns: [stav, kraj, délka]\nviews: [Výlety podle stavu]\n'); }), route: typeRoute('výlet') });
  await must(main(page).locator('[role="columnheader"]').first(), 'the type page\'s table', 8000);
  const h = await headerIcons(main(page));
  const pick = (n: string) => h.find(([t]) => t.startsWith(n));
  assert.deepEqual([pick('Stav')?.[1], pick('Kraj')?.[1], pick('Délka v km')?.[1], pick('Stav')?.[2]], ['circle-dot', 'map-pin', null, 'true'], 'the headers Stav and Kraj hold their icons, Délka v km none, aria-hidden');
  const before = await main(page).getByRole('columnheader', { name: /^⟦?Stav/ }).first().getAttribute('aria-label').catch(() => null);
  assert.ok(before === null || before.startsWith('Stav'), 'accessible names stay the Names');
  // Another program changes kraj's icon: header, cards and panel follow within 2 s.
  await core.setFile(VYLET_YML, swap((await core.files())[nfc(VYLET_YML)], '    icon: map-pin\n', '    icon: mountain\n'));
  const h2 = await eventually(() => headerIcons(main(page)), (x) => x.some(([t, i]) => t.startsWith('Kraj') && i === 'mountain'), 2000);
  assert.ok(h2.some(([t, i]) => t.startsWith('Kraj') && i === 'mountain'), 'the Kraj header follows within 2 s');
  // The attribute panel of Sněžka.
  const n = await another(page, { route: noteRoute(P.snezka) });
  const icons = await eventually(() => panelIcons(n.page), (x) => Object.keys(x).length >= 8, 5000);
  assert.deepEqual(['Stav', 'Kraj', 'Vybavení', 'Termín', 'Odkaz', 'Náročnost', 'Délka v km', 'Průvodce'].map((l) => icons[l] ?? null), ['circle-dot', 'map-pin', 'backpack', 'calendar', 'link', null, null, null], 'icons before Stav, Kraj, Vybavení, Termín, Odkaz; none before the others');
  // A Table query over [výlet].
  const q = await another(page, { vault: cardsVault((f) => { f['.tegg/queries/Výlety tabulka.yml'] = ['# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Výlety tabulka.', 'version: 1', 'title: Výlety tabulka', 'types: [výlet]', 'match: all', 'filters: []', 'sort: { by: title, order: asc }', 'limit: 50', 'view: table', 'columns: [stav, kraj, délka]', 'created: 2026-11-01T09:00:00+01:00', 'modified: 2026-11-01T09:00:00+01:00', ''].join('\n'); }), route: queryRoute('Výlety tabulka') });
  // D-2036: a query's table draws plain header cells (no role="columnheader"); they are found by the table's class.
  const QUERY_TH = 'table.query-table thead th';
  await must(main(q.page).locator(QUERY_TH).first(), 'the query table', 8000);
  const qh = await headerIcons(main(q.page), QUERY_TH);
  assert.deepEqual([qh.find(([t]) => t.startsWith('Stav'))?.[1], qh.find(([t]) => t.startsWith('Kraj'))?.[1]], ['circle-dot', 'map-pin'], 'the same in a Table query');
});

test('fr_edt_07_ac22_icons_before_labels', async ({ page }) => {
  const core = await startCards(page, { route: noteRoute(P.snezka) });
  const icons = await eventually(() => panelIcons(page), (x) => Object.keys(x).length >= 8, 8000);
  assert.deepEqual(['Stav', 'Kraj', 'Vybavení', 'Termín', 'Odkaz', 'Náročnost', 'Délka v km', 'Průvodce'].map((l) => icons[l] ?? null), ['circle-dot', 'map-pin', 'backpack', 'calendar', 'link', null, null, null], 'Stav, Kraj, Vybavení, Termín, Odkaz start with their icon');
  const hidden = await main(page).locator('[data-attribute-panel] svg[data-icon], .attribute-panel svg[data-icon]').evaluateAll((ss) => ss.every((s) => s.getAttribute('aria-hidden') === 'true'));
  assert.ok(hidden, 'every icon is aria-hidden');
  assert.deepEqual(await writtenPaths(core), [], 'showing the panel writes nothing');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-51 (L5 counts)

test('fr_syn_06_ac51_cards_upgrade_and_browsing_write_nothing', async ({ page }) => {
  const core = await startCards(page, { vault: cardsVault((f) => sevenTypes(f)), route: queryRoute(SEVEN) });
  await must(objectCard(board(page), P.snezka), 'the seven-type board\'s cards', 8000);
  const tour: string[] = [typeRoute('výlet'), typeRoute('book'), noteRoute(P.karty), settingsRoute('výlet'), settingsRoute('článek'), settingsRoute('kontrola'), settingsRoute('book'), settingsRoute('task'), settingsRoute('tag'), 'settings/appearance', 'settings/vault', 'settings/previews'];
  for (const r of tour) {
    const x = await another(page, { route: r });
    await sleep(600);
    if (r.startsWith('type-settings/') && r !== settingsRoute('tag')) {
      await click(addProperty(x.page), `${r}: Add property`, 5000);
      await must(addPopover(x.page), `${r}: the popover`);
      await x.page.keyboard.press('Escape');
      await click(x.page.getByRole('button', { name: /^⟦?Change icon⟧?$/ }), `${r}: Change icon`);
      await must(pickerSearch(x.page), `${r}: the picker`, 5000);
      await x.page.keyboard.type('map');
      await x.page.keyboard.press('Escape');
    }
    assert.deepEqual(await writtenPaths(x.core), [], `${r}: browsing writes nothing`);
    assert.equal((await callsOf(x.core, 'type_patch')).length, 0, `${r}: no type_patch`);
  }
  assert.deepEqual(await writtenPaths(core), [], 'the board writes nothing');
  // Each action writes the one type file it names, once.
  const s = await another(page, { route: settingsRoute('výlet') });
  await click(s.page.getByRole('button', { name: /^⟦?Remove Kraj from the card⟧?$/ }), 'Remove Kraj from the card', 5000);
  await eventually(() => typePatches(s.core), (x) => x.length >= 1, 2000);
  assert.deepEqual((await typePatches(s.core)).map((x) => x.key), ['výlet'], 'a Card change: one type_patch of výlet.yml');
  // D-2029: type-file writes under .tegg/types/ are allowed; no note file is written.
  assert.deepEqual((await s.core.writesTo()).filter((p) => !nfc(p).startsWith('.tegg/types/')), [], 'no note is written');
  void uiState;
  void picker;
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-26

test('fr_ux_08_ac26_cards_and_picker_for_voiceover', async ({ page }) => {
  await startCards(page, { route: queryRoute(STAV_Q), reducedMotion: 'reduce' });
  const b = await must(board(page), 'Výlety podle stavu', 8000);
  const sn = await must(b.getByRole('article', { name: /^⟦?Výlet: Sněžka z Pece⟧?$/ }), 'the article Výlet: Sněžka z Pece');
  const pills = await sn.locator('.card-pill').evaluateAll((ps) => ps.map((p) => p.getAttribute('aria-label')));
  assert.ok(pills.includes('Vybavení: Mapa') && pills.every((l) => l && /^[^:]+: .+/.test(l)), `pills read by their accessible names: ${pills}`);
  assert.ok(await sn.locator('.card-pill svg').evaluateAll((ss) => ss.every((s) => s.getAttribute('aria-hidden') === 'true')), 'icons are hidden');
  const more = await cardInfo(sn);
  assert.ok(more?.more && /^\+\d+ more$/.test(more.more.text) && more.more.description?.startsWith('Not shown: '), '+N more reads with its description');
  const s = await another(page, { route: settingsRoute('výlet'), reducedMotion: 'reduce' });
  const list = await must(s.page.getByRole('list', { name: /^⟦?Card properties⟧?$/ }), 'the list Card properties', 8000);
  assert.equal(await list.getByRole('listitem').count(), 12, 'Card properties, list, 12 items');
  // D-2032: Properties has its own `Drag to reorder Kraj`; the handle is found within the Card section's list.
  const handle = list.getByRole('button', { name: /^⟦?Drag to reorder Kraj⟧?$/ });
  await handle.focus();
  await s.page.keyboard.press('Alt+ArrowUp');
  const live = s.page.locator('div.sr-live');
  assert.ok(await eventually(async () => (await live.allTextContents()).join(' '), (t) => /Moved Kraj to position \d+/.test(t), 2000).then((t) => (t.match(/Moved Kraj to position \d+/g) ?? []).length === 1), 'a reorder is announced once, politely (Moved Kraj to position <n>)');
  const anim = await list.evaluate((l) => [...l.querySelectorAll('*')].some((e) => { const cs = getComputedStyle(e); return parseFloat(cs.transitionDuration) > 0 || (cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0); }));
  assert.equal(anim, false, 'reduced motion: no animation');
  await click(s.page.getByRole('button', { name: /^⟦?Icon for Náročnost⟧?$/ }), 'Icon for Náročnost');
  const dlg = await must(s.page.getByRole('dialog', { name: /^⟦?Icon for Náročnost⟧?$/ }), 'the picker reads Icon for Náročnost, dialog');
  await s.page.keyboard.type('pin');
  await sleep(700);
  const said = (await live.allTextContents()).join(' ');
  assert.ok(/\d+ icons?/.test(said), `the result count is announced after a 500 ms pause: ${said}`);
  void dlg;
});
