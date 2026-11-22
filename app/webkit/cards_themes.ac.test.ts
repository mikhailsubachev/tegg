// Slice OC, L5: themes and strings (docs/acceptance/cards.md FR-UX-05 AC-26: FR-UX-05 AC-4, AC-5 and axe
// `color-contrast` in light and dark on the cards, the Card section with `Add property` open, the picker and every
// `settings/*` route; NFR-OTH-02 AC-24: with the pseudo-locale every visible text, tooltip and accessible name of the
// cards, the Card section, the picker and Settings is inside ⟦ ⟧ except user content and data; types.md FR-TYP-01 AC-28:
// type settings in both themes and by keyboard). Through the fake core with the cards fixture (docs/contracts/
// v1-cards.md §8, §9). Written from the ACs and the contract only (D-61).
import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, SEVEN, STAV_Q, addPopover, addProperty, another, board, cardWhen, cardsVault, editProperty, focusName, main, must, nfc, noteRoute, objectCard, picker, pickerSearch, propertyIcon,
  queryRoute, sevenTypes, settingsNav, settingsRoute, sleep, startCards, swap, viewsList,
} from './cards-helpers';
import { axeContrast, colourLeaks } from './read-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const SETTINGS = ['settings/appearance', 'settings/date-time', 'settings/vault', 'settings/shortcuts', 'settings/menu-bar', 'settings/backups', 'settings/trash-history', 'settings/previews'];

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-26

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac26_cards_and_settings_in_both_themes: ${theme}`, async ({ page }) => {
    const bad: string[] = [];
    const check = async (p: Page, what: string) => {
      for (const v of await axeContrast(p)) bad.push(`${theme}, ${what}: ${v}`);
      for (const v of await colourLeaks(p, theme)) bad.push(`${theme}, ${what}: colour outside the tokens ${v}`);
    };
    const core = await startCards(page, { vault: cardsVault((f) => sevenTypes(f)), route: queryRoute(STAV_Q), ui: { theme } });
    await must(objectCard(board(page), P.snezka), 'Výlety podle stavu', 8000);
    await check(page, 'Výlety podle stavu');
    for (const [r, what] of [[noteRoute(P.karty), 'Karty'], [queryRoute(SEVEN), 'the seven-type board']] as const) {
      const x = await another(page, { vault: cardsVault((f) => sevenTypes(f)), route: r, ui: { theme } });
      await must(objectCard(main(x.page), P.snezka), what, 8000);
      await check(x.page, what);
    }
    const s = await another(page, { route: settingsRoute('výlet'), ui: { theme } });
    await (await must(addProperty(s.page), 'Add property', 8000)).click();
    await must(addPopover(s.page), 'Add property open');
    await check(s.page, 'type-settings/výlet with Add property open');
    await s.page.keyboard.press('Escape');
    await propertyIcon(s.page, 'Kraj').click();
    await must(pickerSearch(s.page), 'the picker');
    await check(s.page, 'the picker on All icons');
    await pickerSearch(s.page).fill('pin');
    await sleep(300);
    await check(s.page, 'the picker with bold parts');
    for (const r of SETTINGS) {
      const x = await another(page, { route: r, ui: { theme } });
      await must(settingsNav(x.page), `${r}: the section list`, 8000);
      await check(x.page, r);
    }
    // Option dots use --type-<colour>; +N more uses --muted. D-2043: R187 hides the grouping property's pill, so the
    // board is regrouped by náročnost (as cards_parts ac10 does) before the stav dot is read.
    await core.setFile(`.tegg/queries/${STAV_Q}.yml`, swap((await core.files())[nfc(`.tegg/queries/${STAV_Q}.yml`)], 'group_by: stav', 'group_by: náročnost'));
    await cardWhen(objectCard(board(page), P.snezka), (c) => !!c?.items.some((i) => i.attribute === 'stav'), 3000);
    const tokens = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { green: cs.getPropertyValue('--type-green').trim(), muted: cs.getPropertyValue('--muted').trim() }; });
    const colours = await objectCard(board(page), P.snezka).evaluate((c) => ({ dot: getComputedStyle(c.querySelector('.card-pill[data-attribute="stav"] .card-dot')!).backgroundColor, more: getComputedStyle(c.querySelector('.card-more')!).color })).catch(() => null);
    const resolve = (v: string) => page.evaluate((x) => { const d = document.createElement('div'); d.style.color = x; document.body.append(d); const r = getComputedStyle(d).color; d.remove(); return r; }, v);
    assert.deepEqual(colours, { dot: await resolve(tokens.green), more: await resolve(tokens.muted) }, `${theme}: dots from --type-<colour>, +N more from --muted`);
    assert.deepEqual(bad, [], `${theme}: no contrast violation, colours from tokens only`);
  });
}

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-24

/** Visible texts, tooltips and accessible names under `root` that aren't inside ⟦ ⟧ and aren't user content or data. */
async function leaks(page: Page, root: string, allowed: string[]): Promise<string[]> {
  return page.evaluate(([sel, ok]) => {
    const allow = new Set((ok as string[]).map((s) => s.normalize('NFC')));
    const isData = (t: string) => allow.has(t) || /^[\d\s.,:+#·—–-]*$/.test(t) || /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t) || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(t) || /^#\S+$/.test(t) || /^\S+\.\S+(\/\S*)?$/.test(t);
    // D-2034: pseudo brackets nest (`⟦Remove ⟦Tags⟧ from the card⟧`): drop the innermost pairs until none is left.
    const rest = (t: string) => {
      let x = t, y = '';
      while (x !== y) { y = x; x = x.replace(/⟦[^⟦⟧]*⟧/g, ' '); }
      return x.replace(/\s+/g, ' ').trim();
    };
    const out: string[] = [];
    for (const r of document.querySelectorAll(sel as string)) {
      const walk = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest('[data-user-content]') || el.getClientRects().length === 0) continue;
        const t = rest(n.textContent ?? '');
        if (t && !isData(t.normalize('NFC'))) out.push(`text: ${t}`);
      }
      for (const el of r.querySelectorAll('[title], [aria-label], [aria-description]')) {
        for (const a of ['title', 'aria-label', 'aria-description']) {
          const v = el.getAttribute(a);
          if (!v) continue;
          // D-2034: a pill's `title` is its property's Name from the type file (user data, not a UI string), and a
          // title on user content (a local item's path) is data.
          if (a === 'title' && (v === el.getAttribute('data-name-title') || el.matches('[data-user-content]'))) continue;
          const t = rest(v).replace(/(^|\s)[^\s⟦⟧]*:\s*/g, ' ').trim();
          if (t && !isData(t.normalize('NFC')) && !t.split(/[,\s]+/).every((w) => !w || isData(w.normalize('NFC')))) out.push(`${a}: ${v}`);
        }
      }
    }
    return [...new Set(out)];
  }, [root, allowed] as const);
}
const USER = ['Sněžka z Pece', 'Okolo Máchova jezera', 'Pálava na kole', 'Krkonošská magistrála', 'Horské chaty', 'Podklady k výletům', 'Bez zdroje', 'Textový zdroj', 'Odkaz na výlet',
  'Kontrola kola', 'Nápad na výlet', 'Vyhlídka na Pálavě', 'Pravidla tábora', 'Účetní ze Žižkova', 'Výlet', 'Výlety', 'Článek', 'Články', 'Kontrola', 'Kontroly', 'Book', 'Books',
  'Stav', 'Náročnost', 'Kraj', 'Vybavení', 'Délka v km', 'Termín', 'Odkaz', 'Průvodce', 'Poznámka', 'Rubrika', 'Hotový', 'Plánovaný', 'Rozpracovaný', 'Střední', 'Lehká', 'Těžká',
  'Královéhradecký', 'Jihomoravský', 'Mapa', 'Čelovka', 'Pláštěnka', 'Termoska', 'Lékárnička', 'Hůlky', 'Rukavice', 'Čepice', 'Svačina', 'Nabíječka', 'Cestování', 'Příroda',
  'Eva Lindová', 'Jana Brázdová', 'Neexistující průvodce', 'Zimní výstup s rodinou, vrchol v mlze.', 'Kniha Krkonoše a Jizerky', 'Reading', 'Výlety podle stavu', 'neznámý-klíč'];

test('nfr_oth_02_ac24_card_and_picker_strings', async ({ page }) => {
  await startCards(page, { vault: cardsVault((f) => sevenTypes(f)), route: queryRoute(SEVEN), pseudo: true });
  await must(objectCard(board(page), P.snezka), 'the seven-type board', 8000);
  const bad = await leaks(page, 'article[data-object-card]', USER);
  const s = await another(page, { route: settingsRoute('výlet'), pseudo: true });
  await (await must(addProperty(s.page), 'Add property', 8000)).click();
  await must(addPopover(s.page), 'Add property open');
  bad.push(...(await leaks(s.page, 'section#ts-card, [role="dialog"]', USER)));
  await s.page.keyboard.press('Escape');
  await propertyIcon(s.page, 'Kraj').click();
  await must(picker(s.page), 'the picker');
  bad.push(...(await leaks(s.page, '[data-icon-picker]', USER)));
  for (const r of ['settings/appearance', 'settings/vault', 'settings/previews']) {
    const x = await another(page, { route: r, pseudo: true });
    await must(settingsNav(x.page), `${r}`, 8000);
    bad.push(...(await leaks(x.page, 'div.settings-layout', USER)));
  }
  assert.deepEqual(bad, [], 'every visible text, tooltip and accessible name is inside ⟦ ⟧ except user content and data');
});

// ------------------------------------------------------------------------------------------------ types.md FR-TYP-01 AC-28

for (const theme of ['light', 'dark'] as const) {
  test(`fr_typ_01_ac28_type_settings_strings_themes_keyboard: ${theme}`, async ({ page }) => {
    await startCards(page, { route: settingsRoute('výlet'), ui: { theme } });
    await (await must(editProperty(page, 'Kraj'), 'Edit Kraj', 8000)).click();
    const bad = [...(await axeContrast(page)), ...(await colourLeaks(page, theme))];
    const b = await another(page, { route: settingsRoute('book'), ui: { theme } });
    const list = await must(viewsList(b.page, 'Books'), 'Views of Books', 8000);
    const h = list.getByRole('button', { name: /Drag to reorder Výborné knihy/ });
    const box = await h.boundingBox();
    if (box) { await b.page.mouse.move(box.x + 4, box.y + 4); await b.page.mouse.down(); await b.page.mouse.move(box.x + 4, box.y - 30, { steps: 5 }); }
    bad.push(...(await axeContrast(b.page)), ...(await colourLeaks(b.page, theme)));
    await b.page.mouse.up();
    assert.deepEqual(bad, [], `${theme}: FR-UX-05 AC-4, AC-5 with Kraj expanded and a view being dragged`);
    // A keyboard-only pass reaches every section link, Icon for, Edit, the Card list and the Views rows.
    const k = await another(page, { route: settingsRoute('výlet') });
    await must(settingsNav(k.page), 'the section list', 8000);
    const reached = new Set<string>();
    for (let i = 0; i < 200; i++) {
      await k.page.keyboard.press('Tab');
      reached.add((await focusName(k.page)).name.replace(/[⟦⟧]/g, ''));
    }
    const need = ['General', 'Card', 'Views', 'Icon for Stav', 'Icon for Kraj', 'Edit Stav', 'Edit Kraj', 'Drag to reorder Kraj', 'Remove Kraj from the card', 'Add property'];
    assert.deepEqual(need.filter((n) => !reached.has(n)), [], 'the keyboard reaches every section link, icon and edit button, the Card list and the Views section');
  });
}
