// Slice OC, L5: the parts of a card (docs/acceptance/cards.md FR-TYP-11 AC-7…AC-13, AC-16; R211, R212, R218) on
// `Výlety podle stavu`, in Karty's card embeds and on the runtime seven-type board, through the fake core with the cards
// fixture (docs/contracts/v1-cards.md §8.1 DOM, §13). Test clock `2026-11-19T10:00:00+01:00`, Europe/Prague, `en-US`,
// Date & time `Region`, preview mode `click`. Written from the ACs and the contract only (D-61).
import { expect, test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  NOW, P, SEVEN, another, mainName, STAV_Q, VYLET_YML, board, cardInfo, cardWhen, cardsVault, click, embedFrame, eventually, main, must, networkLog, nfc, noteRoute, objectCard, objectCards,
  queryRoute, rowsOf, sevenTypes, sleep, startCards, swap, typeRoute, type CardInfo, type FakeCoreHandle,
} from './cards-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const VYB = ['Mapa', 'Čelovka', 'Pláštěnka', 'Termoska', 'Lékárnička', 'Hůlky', 'Rukavice', 'Čepice', 'Svačina', 'Nabíječka'];
/** R218 as the DOM shows it: [path, label, lead, tags, text, item attributes (in order), footer link, date]. */
const R218: [string, string, string, string[], string | null, (string | null)[], string | null, string][] = [
  [P.snezka, 'Výlet: Sněžka z Pece', 'map', ['#hory', '#zima', '#rodina', '+1'], 'Zimní výstup s rodinou, vrchol v mlze.', ['stav', 'náročnost', 'kraj', ...VYB.map(() => 'vybavení'), 'délka', 'termín', 'odkaz'], 'Eva Lindová', 'Edited today'],
  [P.machovo, 'Výlet: Okolo Máchova jezera', 'map', [], null, [], null, 'Edited Nov 12, 2026'],
  [P.palava, 'Výlet: Pálava na kole', 'map', ['#kolo'], null, ['stav', 'náročnost', 'kraj', 'odkaz'], 'Neexistující průvodce', 'Edited yesterday'],
  [P.magistrala, 'Výlet: Krkonošská magistrála', 'map', ['#hory'], null, ['stav', 'náročnost', 'termín'], null, 'Edited Mon'],
  [P.chaty, 'Článek: Horské chaty', 'newspaper', [], 'Přehled chat na hřebenech, kde se dá přespat i v zimě.', [null, 'rubrika'], 'example.org/horske-chaty', 'Created yesterday'],
  [P.podklady, 'Článek: Podklady k výletům', 'newspaper', [], null, ['rubrika'], '↗ Podklady k výletům', 'Created Fri'],
  [P.bez, 'Článek: Bez zdroje', 'newspaper', [], null, [null], null, 'Created today'],
  [P.textovy, 'Článek: Textový zdroj', 'newspaper', [], 'první bod seznamu Odstavec za seznamem.', ['rubrika', 'source'], null, 'Created Nov 10, 2026'],
  [P.odkaz, 'Článek: Odkaz na výlet', 'newspaper', [], 'Trasa je popsaná v samostatné poznámce.', [], 'Sněžka z Pece', 'Created Tue'],
  [P.kontrola, 'Kontrola: Kontrola kola', 'check-square', ['#kolo'], 'Brzdy seřízené, řetěz namazaný.', [], null, 'Edited Tue'],
  [P.napad, 'Quick Note: Nápad na výlet', 'zap', [], 'Zkusit Jizerky na běžkách, až napadne sníh.', [null], null, 'Created today'],
  [P.vyhlidka, 'Image: Vyhlídka na Pálavě', 'image', [], null, ['width', 'height', 'size'], null, 'Added Mon'],
  [P.pravidla, 'PDF: Pravidla tábora', 'file', ['#tábor'], null, ['pages', 'size'], null, 'Added Nov 2, 2026'],
  [P.ucetni, 'Book: Účetní ze Žižkova', 'book', [], 'Kriminálka z kanceláře nad hospodou.', ['status'], 'Jana Brázdová', 'Edited Mon'],
];
const shape = (c: CardInfo | null) => c && { label: c.label, lead: c.lead, tags: c.tags, text: c.text, items: c.items.map((i) => (i.kind === 'unreviewed' ? null : i.attribute)), link: c.footerLink, date: c.date };
const wantShape = (r: (typeof R218)[number], drop?: string) => ({ label: r[1], lead: r[2], tags: r[3], text: r[4], items: r[5].filter((a) => a !== drop), link: r[6], date: r[7] });

/** A fresh page on the board `name` (no in-app navigation hook, contract §13). */
async function openBoard(page: import('@playwright/test').Page, name: string, vault = cardsVault((f) => sevenTypes(f))) {
  const o = await another(page, { vault, route: queryRoute(name) });
  return must(board(o.page), `the board ${name}`, 8000);
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-7

test('fr_typ_11_ac7_the_parts_of_a_card', async ({ page }) => {
  await startCards(page, { vault: cardsVault((f) => sevenTypes(f)), route: queryRoute(SEVEN) });
  const b = await must(board(page), 'the seven-type board', 8000);
  const bad: string[] = [];
  for (const r of R218) {
    const c = await cardInfo(objectCard(b, r[0]));
    if (JSON.stringify(shape(c)) !== JSON.stringify(wantShape(r))) bad.push(`${r[0]}:\n got  ${JSON.stringify(shape(c))}\n want ${JSON.stringify(wantShape(r))}`);
  }
  assert.deepEqual(bad, [], 'each card of R218 on the seven-type board (grouped by tags)');
  const sn = await cardInfo(objectCard(b, P.snezka));
  assert.deepEqual(sn?.children.filter((x) => x !== 'card-strip'), ['card-lead', 'card-title', 'card-tags', 'card-text', 'card-pills', 'card-footer'].filter(Boolean), 'parts in R211\'s order');
  const html = await main(page).innerHTML();
  for (const absentText of ['neznámý-klíč', 'Celý hřeben za tři dny.', 'Výsledek']) assert.ok(!html.includes(absentText), `${absentText} appears nowhere`);
  const mach = objectCard(b, P.machovo);
  assert.equal(await mach.locator('.card-tags, p.card-text, [data-attribute]').count(), 0, 'Máchovo: no element for a part with nothing to show');
  // Výlety podle stavu: the same cards without stav; Karty: the same cards in the embeds.
  const s = await openBoard(page, STAV_Q);
  assert.deepEqual(shape(await cardInfo(objectCard(s, P.snezka))), wantShape(R218[0], 'stav'), 'Výlety podle stavu: Sněžka without the stav pill');
  const k = await another(page, { route: noteRoute(P.karty) });
  const frame = await must(embedFrame(k.page, 'Sněžka z Pece'), 'Karty: the Sněžka embed', 8000);
  const ek = await cardInfo(objectCard(frame, P.snezka));
  assert.deepEqual([ek?.items.map((i) => i.attribute), ek?.footerLink, ek?.date], [wantShape(R218[0]).items, 'Eva Lindová', 'Edited today'], 'Karty: Sněžka\'s card embed');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-8

test('fr_typ_11_ac8_empty_values_draw_nothing', async ({ page }) => {
  const core = await startCards(page, { vault: cardsVault((f) => sevenTypes(f)), route: queryRoute(SEVEN) });
  const b = await must(board(page), 'the seven-type board', 8000);
  const mach = await must(objectCard(b, P.machovo), 'Máchovo\'s card');
  const m = await cardInfo(mach);
  assert.deepEqual([m?.items, m?.tags, m?.text, m?.date], [[], [], null, 'Edited Nov 12, 2026'], 'Máchovo: lead, title, ⋯ and the date only');
  const bez = await cardInfo(objectCard(b, P.bez));
  assert.deepEqual([bez?.items.map((i) => i.kind), bez?.date], [['unreviewed'], 'Created today'], 'Bez zdroje: Unreviewed and Created today');
  const h0 = (await mach.boundingBox())?.height ?? 0;
  const variant = async (line: string, val: string) => {
    await core.setFile(P.machovo, swap((await core.files())[nfc(P.machovo)], line, val));
    return cardWhen(objectCard(b, P.machovo), (c) => !!c && c.date === 'Edited Nov 12, 2026', 2000);
  };
  const kraj = 'kraj: "—"\n';
  assert.deepEqual((await variant(kraj, 'kraj: " — "\n'))?.items, [], '" — " draws nothing');
  let c = await variant('kraj: " — "\n', 'kraj: "–"\n');
  // Kraj has the icon map-pin, so the pill shows the icon and – with no visible name (D-2015).
  assert.deepEqual(await cardWhen(objectCard(b, P.machovo), (x) => (x?.items.length ?? 0) === 1).then((x) => x?.items.map((i) => [i.icon, i.text, i.label])), [['map-pin', '–', 'Kraj: –']], 'the en dash draws a Kraj pill: map-pin and –, named Kraj: –, no visible Kraj');
  c = await variant('kraj: "–"\n', 'kraj: "— nic"\n');
  assert.ok((await cardWhen(objectCard(b, P.machovo), (x) => !!x?.items[0]?.text.includes('— nic')))?.items[0]?.text.includes('— nic'), '"— nic" draws');
  await variant('kraj: "— nic"\n', 'kraj: "—"\n');
  await variant('vybavení: []\n', 'vybavení: [Mapa, —]\n');
  const one = await cardWhen(objectCard(b, P.machovo), (x) => (x?.items.length ?? 0) === 1);
  assert.deepEqual(one?.items.map((i) => [i.attribute, i.label]), [['vybavení', 'Vybavení: Mapa']], '[Mapa, —]: one pill Mapa');
  void c;
  // Height equals a card with card: [modified] (± 1 px).
  await core.setFile(VYLET_YML, swap(original(VYLET_YML), 'card: [tags, description, stav, náročnost, kraj, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]', 'card: [modified]'));
  await sleep(800);
  const h1 = (await objectCard(b, P.snezka).boundingBox())?.height ?? -1;
  assert.ok(Math.abs(h0 - h1) <= 1, `Máchovo's height ${h0} equals a card with card: [modified] ${h1}`);
  assert.deepEqual((await core.writesTo()).filter((p) => p.endsWith('.md')), [], 'no note is rewritten');
  // — stays a value for queries: Máchovo in a — lane.
  const s = await openBoard(page, STAV_Q);
  assert.ok(await s.locator('section[data-lane] article[data-object-card]').filter({ hasText: 'Okolo Máchova jezera' }).count(), 'Máchovo is on the board in a lane');
});
const original = (rel: string) => cardsVault().files[nfc(rel)];

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-9

test('fr_typ_11_ac9_the_card_text', async ({ page }) => {
  const core = await startCards(page, { route: queryRoute(STAV_Q) });
  const b = await must(board(page), 'Výlety podle stavu', 8000);
  const sn = await must(objectCard(b, P.snezka), 'Sněžka\'s card');
  assert.deepEqual([(await cardInfo(sn))?.text, (await cardInfo(sn))?.textFrom], ['Zimní výstup s rodinou, vrchol v mlze.', 'description'], 'Sněžka shows its description');
  const long = 'Dlouhý popis výletu přes hřebeny a údolí. '.repeat(15).slice(0, 600);
  await core.setFile(P.snezka, swap(original(P.snezka), 'description: Zimní výstup s rodinou, vrchol v mlze.', `description: ${long}`));
  await cardWhen(sn, (c) => !!c?.text?.startsWith('Dlouhý'));
  const clamp = await sn.locator('p.card-text').evaluate((p) => ({ h: p.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(p).lineHeight), over: p.scrollHeight > p.clientHeight }));
  assert.ok(Math.abs(clamp.h - 2 * clamp.lh) <= 1 && clamp.over, `the text is clamped to 2 lines (${JSON.stringify(clamp)})`);
  await core.setFile(VYLET_YML, swap(original(VYLET_YML), 'card: [tags, description, stav, náročnost, kraj, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]', 'card: [description, body, stav]'));
  await core.setFile(P.snezka, original(P.snezka));
  const mg = await cardWhen(objectCard(b, P.magistrala), (c) => c?.text === 'Celý hřeben za tři dny.', 2000);
  assert.deepEqual([mg?.text, mg?.textFrom], ['Celý hřeben za tři dny.', 'body'], 'Magistrála (no description) shows its body');
  await core.setFile(VYLET_YML, swap(original(VYLET_YML), 'card: [tags, description, stav, náročnost, kraj, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]', 'card: [body, description]'));
  const s2 = await cardWhen(sn, (c) => c?.textFrom === 'body', 2000);
  assert.equal(s2?.text, 'Z Pece přes Obří důl na vrchol a zpět lanovkou.', '[body, description]: Sněžka its body');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-10

test('fr_typ_11_ac10_pills', async ({ page }) => {
  const core = await startCards(page, { route: queryRoute(STAV_Q) });
  const b = await must(board(page), 'Výlety podle stavu', 8000);
  await core.setFile(`.tegg/queries/${STAV_Q}.yml`, swap((await core.files())[nfc(`.tegg/queries/${STAV_Q}.yml`)], 'group_by: stav', 'group_by: náročnost'));
  const sn = await must(objectCard(b, P.snezka), 'Sněžka\'s card');
  await cardWhen(sn, (c) => !!c?.items.some((i) => i.attribute === 'stav'), 3000);
  const stav = sn.locator('.card-pill[data-attribute="stav"]');
  await must(stav, 'the stav pill');
  const s = await stav.evaluate((e) => ({
    icon: e.querySelector('svg[data-icon]')?.getAttribute('data-icon'), iconHidden: e.querySelector('svg')?.getAttribute('aria-hidden'), name: !!e.querySelector('.card-pill-name'),
    dot: getComputedStyle(e.querySelector('.card-dot')!).backgroundColor, green: getComputedStyle(document.documentElement).getPropertyValue('--type-green').trim(),
    value: e.querySelector('.card-pill-value')?.textContent, title: e.getAttribute('title'), label: e.getAttribute('aria-label'), ws: getComputedStyle(e).whiteSpace, edit: (e as HTMLElement).isContentEditable,
  }));
  const green = await page.evaluate((c) => { const d = document.createElement('div'); d.style.color = c; document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; }, s.green);
  assert.deepEqual([s.icon, s.iconHidden, s.name, s.dot, s.value, s.title, s.label, s.ws, s.edit], ['circle-dot', 'true', false, green, 'Hotový', 'Stav', 'Stav: Hotový', 'nowrap', false], 'stav: icon, no Name, green dot, value, tooltip, accessible name');
  const nar = await cardInfo(sn).then((c) => c?.items.filter((i) => i.attribute === 'náročnost'));
  assert.ok(nar === undefined || nar.length === 0, 'náročnost groups here (hidden)');
  const items = (await cardInfo(sn))?.items ?? [];
  assert.deepEqual(items.filter((i) => i.attribute === 'vybavení').map((i) => [i.icon, i.label]), VYB.map((v) => ['backpack', `Vybavení: ${v}`]), 'ten vybavení pills, each with backpack');
  const del = items.find((i) => i.attribute === 'délka');
  assert.deepEqual([del?.icon, del?.text], [null, 'Délka v km 12'], 'the unknown icon: the Name');
  assert.equal(items.find((i) => i.attribute === 'termín')?.text, 'Feb 14, 2026', 'the termín pill');
  const pal = objectCard(b, P.palava).locator('.card-pill[data-attribute="stav"]');
  const p = await pal.evaluate((e) => ({ dot: !!e.querySelector('.card-dot'), invalid: e.hasAttribute('data-invalid'), warn: e.innerHTML.includes('Not an option') || !!e.querySelector('[title="Not an option"], [aria-label="Not an option"]') })).catch(() => null);
  assert.deepEqual(p, { dot: false, invalid: true, warn: true }, 'Rozpracovaný: no dot, the warning icon with Not an option');
  // A 200-character kraj stays one line, cut, its tooltip the whole value.
  const k200 = 'Královéhradecký kraj a okolí '.repeat(8).slice(0, 200);
  await core.setFile(P.snezka, swap(original(P.snezka), 'kraj: Královéhradecký', `kraj: ${k200}`));
  const kp = sn.locator('.card-pill[data-attribute="kraj"]');
  await expect(kp).toHaveAttribute('title', `Kraj: ${k200}`, { timeout: 2000 }).catch(() => undefined);
  const kb = await kp.evaluate((e) => ({ title: e.getAttribute('title'), lines: Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight || '16')), cut: e.scrollWidth > e.clientWidth })).catch(() => null);
  assert.deepEqual([kb?.title, kb?.cut], [`Kraj: ${k200}`, true], 'cut with …, tooltip Kraj: <the whole value>');
});

test.describe('region cs and the ISO date setting', () => {
  test('fr_typ_11_ac10_pills_dates_follow_the_region_and_setting', async ({ page }) => {
    await startCards(page, { route: queryRoute(STAV_Q), region: 'cs' });
    const b = await must(board(page), 'Výlety podle stavu', 8000);
    const cs = await cardWhen(objectCard(b, P.snezka), (c) => !!c?.items.some((i) => i.attribute === 'termín'));
    const want = new Intl.DateTimeFormat('cs', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date('2026-02-14T00:00:00Z'));
    assert.equal(cs?.items.find((i) => i.attribute === 'termín')?.text, `Termín ${want}`.replace(/^Termín /, ''), 'cs: the region\'s medium date (D-160)');
  });
  test('fr_typ_11_ac10_pills_iso_setting', async ({ page }) => {
    await startCards(page, { route: queryRoute(STAV_Q), ui: { dateTime: { date: 'iso', time: '24', week: 'region' } } });
    const b = await must(board(page), 'Výlety podle stavu', 8000);
    const c = await cardWhen(objectCard(b, P.snezka), (x) => !!x?.items.some((i) => i.attribute === 'termín'));
    assert.equal(c?.items.find((i) => i.attribute === 'termín')?.text, '2026-02-14', 'Date & time ISO: 2026-02-14 (D-781)');
  });
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-11

test('fr_typ_11_ac11_two_rows_then_more', async ({ page }) => {
  const core = await startCards(page, { route: queryRoute(STAV_Q) });
  const b = await must(board(page), 'Výlety podle stavu', 8000);
  const sn = await must(objectCard(b, P.snezka), 'Sněžka\'s card');
  const r = await rowsOf(sn);
  const c = await cardInfo(sn);
  assert.ok(r.tops.length <= 2, `at most 2 rows (${r.tops})`);
  assert.ok(c?.more && /^\+\d+ more$/.test(c.more.text), `+N more shown: ${JSON.stringify(c?.more)}`);
  const n = Number(/\d+/.exec(c?.more?.text ?? '')?.[0] ?? -1);
  assert.equal(n, 15 - r.visible, `N = 15 − visible (${r.visible})`);
  assert.ok(n >= 1 && /card-more/.test(r.last ?? ''), '+N more is the last item of row 2');
  assert.ok(c?.more?.title?.startsWith('Not shown: ') && c.more.description === c.more.title, 'its title and description list the hidden items');
  assert.equal(await sn.locator('.card-more').evaluate((e) => (e as HTMLElement).tabIndex < 0 && e.tagName !== 'BUTTON'), true, '+N more isn\'t a button');
  assert.equal((await cardInfo(objectCard(b, P.palava)))?.more ?? null, null, 'Pálava: no +N more');
  // Resizing recomputes N.
  await page.setViewportSize({ width: 1024, height: 900 });
  await sleep(100);
  const r2 = await rowsOf(objectCard(b, P.snezka));
  const c2 = await cardInfo(objectCard(b, P.snezka));
  assert.equal(Number(/\d+/.exec(c2?.more?.text ?? '')?.[0] ?? -1) + r2.visible, 15, 'after a resize the sum is still 15');
  // A click on +N more acts as a click on the card: it opens Sněžka and never expands the card.
  await objectCard(b, P.snezka).locator('.card-more').click();
  assert.ok((await eventually(() => mainName(page), (x) => (x ?? '').includes('Sněžka z Pece'), 3000) ?? '').includes('Sněžka z Pece'), 'a click on +N more opens Sněžka');
  void core;
  // Chaty: Unreviewed first, never counted, with 12 aliases (a fresh start on Karty).
  const v = cardsVault((f) => {
    f['.tegg/types/článek.yml'] = swap(f['.tegg/types/článek.yml'], 'card: [body, rubrika, source, created]', 'card: [rubrika, aliases, source, created]');
    f[nfc(P.chaty)] = swap(f[nfc(P.chaty)], 'rubrika: Cestování\n', `rubrika: Cestování\naliases: [${Array.from({ length: 12 }, (_, i) => `Chata ${i + 1}`).join(', ')}]\n`);
  });
  const kp = await another(page, { vault: v, route: noteRoute(P.karty) });
  const ch = await must(objectCard(main(kp.page), P.chaty), 'Karty: Chaty', 8000);
  const cc = await cardWhen(ch, (x) => (x?.items.filter((i) => i.attribute === 'aliases').length ?? 0) === 12, 3000);
  assert.deepEqual([cc?.items[0]?.kind, cc?.items[0]?.hidden], ['unreviewed', false], 'Unreviewed is first and never hidden');
  const rc = await rowsOf(ch);
  assert.equal(Number(/\d+/.exec(cc?.more?.text ?? '')?.[0] ?? -1) + rc.visible, 13, 'Unreviewed isn\'t counted in N (rubrika and 12 aliases; the source chip is in the footer)');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-12

test('fr_typ_11_ac12_the_footer', async ({ page }) => {
  const core = await startCards(page, { vault: cardsVault((f) => sevenTypes(f)), route: queryRoute(SEVEN) });
  const b = await must(board(page), 'the seven-type board', 8000);
  const sn = await must(objectCard(b, P.snezka), 'Sněžka\'s card');
  const geo = await sn.evaluate((c) => {
    const cb = c.getBoundingClientRect(); const cs = getComputedStyle(c);
    const left = cb.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth); const right = cb.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    const l = c.querySelector('footer.card-footer a.chip')?.getBoundingClientRect(); const d = c.querySelector('footer.card-footer time.card-date')?.getBoundingClientRect();
    return { link: l ? Math.abs(l.left - left) : null, date: d ? Math.abs(d.right - right) : null };
  }).catch(() => null);
  assert.ok(geo && geo.link !== null && geo.link <= 1 && geo.date !== null && geo.date <= 1, `the chip at the left edge, the date at the right (${JSON.stringify(geo)})`);
  const pal = await cardInfo(objectCard(b, P.palava));
  assert.equal(pal?.footerLinkKind, 'broken', 'Pálava\'s Neexistující průvodce is the broken chip');
  const dates = await Promise.all([P.snezka, P.palava, P.magistrala, P.machovo, P.chaty, P.podklady, P.vyhlidka, P.pravidla].map(async (p) => (await cardInfo(objectCard(b, p)))?.date));
  assert.deepEqual(dates, ['Edited today', 'Edited yesterday', 'Edited Mon', 'Edited Nov 12, 2026', 'Created yesterday', 'Created Fri', 'Added Mon', 'Added Nov 2, 2026'], 'the footer dates at the test clock');
  const tx = await cardInfo(objectCard(b, P.textovy));
  assert.deepEqual([tx?.footerLink, tx?.items.find((i) => i.attribute === 'source')?.text], [null, 'Source Kniha Krkonoše a Jizerky'], 'Textový\'s plain-text source is a Source pill, not a chip');
  // A multi-value relation: Eva Lindová and +1 naming Marek Sova.
  await core.setFile(VYLET_YML, swap(original(VYLET_YML), '    type: relation\n    to: [autor]\n', '    type: relation\n    to: [autor]\n    multiple: true\n'));
  await core.setFile(P.snezka, swap(original(P.snezka), 'průvodce: "[[Eva Lindová]]"', 'průvodce: ["[[Eva Lindová]]", "[[Marek Sova]]"]'));
  const m = await cardWhen(objectCard(b, P.snezka), (c) => !!c?.footerLink?.includes('+1'), 2000);
  assert.ok(m?.footerLink?.startsWith('Eva Lindová') && m.footerLink.includes('+1'), `Eva Lindová +1: ${m?.footerLink}`);
  assert.equal(await objectCard(b, P.snezka).locator('.card-link-more').getAttribute('title').catch(() => null), 'Marek Sova', 'the +1 tooltip lists Marek Sova');
  // Odkaz's Sněžka z Pece chip opens Sněžka (double-click opens in click mode).
  await objectCard(b, P.odkaz).locator('footer a.chip').dblclick();
  assert.ok(await eventually(async () => (await main(page).getAttribute('aria-label')) ?? '', (n) => n.includes('Sněžka z Pece'), 3000), 'the chip opens Sněžka');
});

test.describe('(TZ) Los Angeles', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('fr_typ_11_ac12_the_footer_day_in_the_machines_zone', async ({ page }) => {
    const core = await startCards(page, { route: queryRoute(STAV_Q), vault: cardsVault((f) => { f[nfc(P.snezka)] = swap(f[nfc(P.snezka)], 'modified: 2026-11-19T08:30:00+01:00', 'modified: 2026-11-18T23:30:00Z'); }) });
    const b = await must(board(page), 'Výlety podle stavu', 8000);
    assert.equal((await cardWhen(objectCard(b, P.snezka), (c) => !!c?.date))?.date, 'Edited yesterday', 'Los Angeles: Edited yesterday');
    assert.deepEqual(await core.writesTo(), [], 'the file isn\'t touched');
  });
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-13

test('fr_typ_11_ac13_url_values', async ({ page }) => {
  const net = networkLog(page);
  const core = await startCards(page, { vault: cardsVault((f) => sevenTypes(f)), route: queryRoute(SEVEN) });
  const b = await must(board(page), 'the seven-type board', 8000);
  const chip = objectCard(b, P.snezka).locator('a.chip[data-attribute="odkaz"]');
  // Sněžka's odkaz chip is item 16: the two-row rule (AC-11) hides it, so it is listed in the "not shown" hint (D-2016).
  assert.equal(await chip.count(), 1, 'Sněžka\'s odkaz chip is in the DOM');
  const sm = await cardInfo(objectCard(b, P.snezka));
  assert.ok(sm?.more?.title?.startsWith('Not shown: ') && sm.more.title.includes('example.com/snezka-z-pece'), `the odkaz chip is listed in the not-shown hint: ${sm?.more?.title}`);
  assert.deepEqual([await chip.getAttribute('data-link-kind'), (await chip.textContent())?.trim()], ['external', 'example.com/snezka-z-pece'], 'the URL chip');
  await chip.evaluate((e) => (e as HTMLElement).click());
  assert.deepEqual(await eventually(() => core.externalOpened(), (x) => x.length > 0, 2000), ['https://www.example.com/trasy/snezka-z-pece?zdroj=rss#mapa'], 'open_external with the value as written, once');
  assert.equal((await cardInfo(objectCard(b, P.palava)))?.items.find((i) => i.attribute === 'odkaz')?.text, 'example.org', 'host only');
  assert.equal((await cardInfo(objectCard(b, P.chaty)))?.footerLink, 'example.org/horske-chaty', 'Chaty\'s source');
  const pod = objectCard(b, P.podklady).locator('.card-local');
  assert.deepEqual([(await pod.textContent().catch(() => ''))?.trim(), await pod.getAttribute('title').catch(() => null)], ['↗ Podklady k výletům', '/Users/test/Dokumenty/Podklady k výletům/'], 'the file:// folder');
  await pod.click().catch(() => undefined);
  assert.ok(!(await core.externalOpened()).some((u) => u.startsWith('file:')), 'a file:// value is never passed to open_external');
  await core.setFile(P.chaty, swap(original(P.chaty), 'source: "https://www.example.org/clanky/horske-chaty?ref=rss#uvod"', 'source: "javascript:alert(1)"'));
  const js = await cardWhen(objectCard(b, P.chaty), (c) => !!c?.items.some((i) => i.attribute === 'source'), 2000);
  assert.deepEqual([js?.footerLink, js?.items.find((i) => i.attribute === 'source')?.kind], [null, 'pill'], 'javascript: is a Source pill, never a link');
  await core.setFile(P.snezka, swap(original(P.snezka), 'odkaz: "https://www.example.com/trasy/snezka-z-pece?zdroj=rss#mapa"', 'odkaz: example.org'));
  await sleep(500);
  assert.equal(await objectCard(b, P.snezka).locator('[data-attribute="odkaz"][data-invalid]').count(), 1, 'a URL without a scheme: a pill with the invalid-value icon');
  assert.deepEqual(net, [], 'no request to a non-local host');
  assert.deepEqual((await core.calls()).filter((c) => /metadata|fetch|unfurl/i.test(c.cmd)).map((c) => c.cmd), [], 'no link-metadata call');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-16

test('fr_typ_11_ac16_the_type_icon', async ({ page }) => {
  const core = await startCards(page, { vault: cardsVault((f) => sevenTypes(f)), route: queryRoute(STAV_Q) });
  const b = await must(board(page), 'Výlety podle stavu', 8000);
  await must(objectCard(b, P.snezka), 'Sněžka\'s card');
  const leads = await objectCards(b).evaluateAll((cs) => cs.map((c) => c.querySelector('.card-lead svg[data-icon]')?.getAttribute('data-icon')));
  assert.ok(leads.length === 4 && leads.every((l) => l === 'map'), `every Výlet card's lead is map (${leads})`);
  const o7 = await another(page, { vault: cardsVault((f) => sevenTypes(f)), route: queryRoute(SEVEN) });
  const s7 = await must(board(o7.page), 'the seven-type board', 8000);
  const core7 = o7.core;
  const k = objectCard(s7, P.kontrola).locator('.card-lead svg[data-icon]');
  await must(k, 'Kontrola\'s lead');
  assert.equal(await k.getAttribute('data-icon'), 'check-square', 'data-icon keeps the name as written');
  const data = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(new URL('../../packages/schema/data/lucide-0.460.0.json', import.meta.url), 'utf8')).catch(() => '{}'));
  const want = (data?.icons?.['square-check-big']?.n ?? []).map((e: any) => e[1]?.d).filter(Boolean);
  const got = await k.evaluate((s) => [...s.querySelectorAll('path')].map((p) => p.getAttribute('d')));
  assert.ok(want.length > 0 && JSON.stringify(got) === JSON.stringify(want), 'Kontrola draws Lucide square-check-big\'s paths');
  void core;
  await core7.setFile(KONTROLA, swap(cardsVault().files[KONTROLA], 'icon: check-square', 'icon: neexistuje'));
  await sleep(800);
  assert.equal(await objectCard(s7, P.kontrola).locator('.card-lead svg[data-icon="neexistuje"]').count(), 1, 'an unknown type icon keeps its data-icon (drawn as R14\'s generic icon)');
  await core7.setFile(P.snezka, swap(original(P.snezka), 'title: Sněžka z Pece\n', 'title: Sněžka z Pece\nicon: rocket\ncover: "[[vyhlidka.png]]"\n'));
  await sleep(800);
  assert.equal(await objectCard(s7, P.snezka).locator('svg[data-icon="rocket"], img').count(), 0, 'the object\'s own icon and cover are never drawn (D-217)');
});
const KONTROLA = '.tegg/types/kontrola.yml';
void NOW;
void typeRoute;
void click;
void ({} as FakeCoreHandle);
