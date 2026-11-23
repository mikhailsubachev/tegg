// Slice AND-2, L5p (projects `phone-webkit`, `phone-chromium`): docs/acceptance/android-phone.md, reading a note:
// - FR-EDT-10 AC-10 (a note is the read view), AC-11 (links by tap);
// - FR-EDT-02 AC-26 (wide blocks scroll in their own box), FR-EDT-07 AC-22 (the Properties strip and sheet);
// - FR-ATT-01 AC-17 (L5p: media), FR-NAV-08 AC-3 (L5p: no previews), FR-SYN-03 AC-36 (L5p: a partly synced vault).
// Contract docs/contracts/android-phone.md §4.5 (stripRows), §9.1…§9.3, §9.8, §14.1. Fixtures: views/ + phone/,
// read-view/, trash-media/.
// Red-test readings (reported): "the desktop's read view of Bloky" is a `macos` page with `__TEGG_TEST__.readView`
// (D-215), compared block by block (tag and text); the Properties sheet is compared with the desktop panel's text by
// label order (CP-14: labels, order, visible values); a broken link's style is "the same computed style as
// `[[Neexistuje]]`", and resolved once it differs.
// Written from the ACs and the contract only (D-61).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  B, PH, SMALL, appBar, assertZeroWrites, desktopPage, drawer, eventually, fileStateOf, flat, loadVault, longPress, main, mainName, moreButton, moreMenu, must, nfc,
  notice, openDrawer, phonePage, phoneVault, rect, seen, sheet, sleep, startDesktop, startPhone, systemBack, barButton, firstVisibleBlock, ui,
} from './phone-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const RV_NOW = '2026-10-14T12:00:00+02:00';
const readVault = () => loadVault('Čtení', ['read-view', 'new-empty/.tegg']);
const article = (page: Page, title: string) => page.getByRole('article', { name: nfc(title), exact: true });
/** The read view's blocks: tag and text of each direct child of the article. */
async function blocks(loc: Locator): Promise<string[]> {
  return loc.first().evaluate((a) => ([...a.children] as HTMLElement[]).map((c) => `${c.tagName.toLowerCase()}: ${(c.innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC')}`));
}
async function openMore(page: Page): Promise<Locator> {
  await (await must(moreButton(page), 'the app bar\'s More actions')).click();
  return must(moreMenu(page), 'menu "More actions"');
}

// ------------------------------------------------------------------------------------------------ FR-EDT-10 AC-10

test('fr_edt_10_ac10_note_is_the_read_view_on_the_phone', async ({ page, browser }) => {
  const core = await startPhone(page, { vault: readVault(), route: 'note/Pages/Bloky.md', now: RV_NOW });
  const before = await fileStateOf(core);
  const art = await must(article(page, 'Bloky'), 'Bloky in the read view (article "Bloky")', 5000);
  assert.equal(await page.locator('[contenteditable]').count(), 0, 'no element with contenteditable');
  assert.equal(await page.locator('.ProseMirror').count(), 0, 'no .ProseMirror element');
  const { page: desk, context } = await desktopPage(browser);
  await desk.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; });
  await startDesktop(desk, { vault: readVault(), route: 'note/Pages/Bloky.md', now: RV_NOW });
  const want = await blocks(await must(article(desk, 'Bloky'), 'desktop: Bloky in the read view', 5000));
  await context.close();
  assert.deepEqual(await blocks(art), want, 'Bloky\'s body has the desktop read view\'s text and block structure');
  const menu = await openMore(page);
  assert.deepEqual((await menu.getByRole('menuitem').allInnerTexts()).map(flat), ['Properties', 'Show Markdown source'], 'More actions lists exactly Properties and Show Markdown source');
  await menu.getByRole('menuitem', { name: 'Show Markdown source' }).click();
  const src = await must(page.getByRole('region', { name: 'Markdown source' }), 'the source view');
  assert.equal((await src.innerText()).replace(/\s+$/, ''), before.files['Pages/Bloky.md'].replace(/\s+$/, ''), 'the source view shows the file\'s bytes');
  const back = await openMore(page);
  await (await must(back.getByRole('menuitem', { name: 'Show formatted note' }), 'Show formatted note')).click();
  await must(article(page, 'Bloky'), 'Show formatted note returns to the read view');
  assert.deepEqual((await core.calls()).filter((c) => c.cmd === 'editor_open').length, 0, 'no editor_open');
  await assertZeroWrites(core, before, 'reading Bloky');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-10 AC-11

test('fr_edt_10_ac11_links_by_tap', async ({ page }) => {
  const core = await startPhone(page, { vault: readVault(), route: 'note/Pages/Odkazy.md', now: RV_NOW });
  const before = await fileStateOf(core);
  const odkazy = await must(article(page, 'Odkazy'), 'Odkazy');
  const linkIn = (prefix: string) => odkazy.locator('li').filter({ hasText: new RegExp(`^${prefix}`) }).getByRole('link').first();
  await (await must(linkIn('NFD:'), 'the NFD-target [[Cíl]]')).click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Cíl', 3000), 'Cíl', 'the NFD target opens Cíl');
  await systemBack(page);
  await must(article(page, 'Odkazy'), 'back on Odkazy');
  await (await must(linkIn('Nadpis:'), 'the heading link [[Cíl#Druhá kapitola]]')).click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Cíl', 3000), 'Cíl', 'the heading link opens Cíl');
  await sleep(300);
  assert.match(await firstVisibleBlock(page), /^Druhá kapitola/, 'scrolled to the heading');
  await systemBack(page);
  await (await must(article(page, 'Odkazy').getByRole('link', { name: /^#?projekt$/ }).first(), 'the tag #projekt')).click();
  assert.equal(await eventually(async () => flat(await appBar(page).getByRole('heading', { level: 1 }).innerText()), (t) => t === '#projekt', 3000), '#projekt', 'a tag opens tag/<key>');
  await systemBack(page);
  await (await must(article(page, 'Odkazy').getByRole('link', { name: '2026-10-08' }).first(), 'the date link [[2026-10-08]]')).click();
  assert.equal(await eventually(async () => flat(await appBar(page).getByRole('heading', { level: 1 }).innerText()), (t) => t === '2026-10-08', 3000), '2026-10-08', 'a date link without a note opens the virtual day');
  assert.ok(!Object.keys(await core.files()).some((p) => p.includes('2026-10-08')), 'no daily note is written');
  await systemBack(page);
  // [[Neexistuje]]: the notice for 4 s, no Create offer, no route change, no write
  const n0 = (await core.calls()).length;
  await (await must(article(page, 'Odkazy').getByRole('link', { name: 'Neexistuje' }).first(), '[[Neexistuje]]')).click();
  const t0 = Date.now();
  const note = await must(notice(page).filter({ hasText: 'No note named “Neexistuje” in this vault yet.' }), 'the notice "No note named “Neexistuje” in this vault yet." (RA13)', 1000);
  assert.equal(await note.getAttribute('aria-live'), 'polite', 'a polite status');
  assert.equal(await mainName(page), 'Odkazy', 'no route change');
  assert.equal(await page.getByRole('dialog').count(), 0, 'no Create offer (no dialog)');
  assert.equal(await page.getByRole('button', { name: /^Create/ }).count(), 0, 'no Create button');
  assert.deepEqual((await core.calls()).slice(n0).filter((c) => c.cmd === 'link_create_plan').length, 0, 'no link_create_plan');
  await sleep(Math.max(0, 3500 - (Date.now() - t0)));
  assert.ok(await seen(note, 100), 'still shown after 3.5 s');
  const gone = await eventually(() => notice(page).filter({ hasText: 'Neexistuje' }).count(), (c) => c === 0, 1500);
  assert.equal(gone, 0, 'gone after 4 s');
  await assertZeroWrites(core, before, 'links');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-02 AC-26

async function wide(page: Page, title: string, how: string) {
  const art = await must(article(page, title), `${how}: the read view`, 5000);
  const boxes = await art.evaluate((a) => [...a.querySelectorAll('table, pre')].map((e) => {
    let s = e as HTMLElement;
    while (s !== a && !(/(auto|scroll)/.test(getComputedStyle(s).overflowX))) s = s.parentElement as HTMLElement;
    return { tag: e.tagName.toLowerCase(), overflowX: getComputedStyle(s).overflowX, scroll: s.scrollWidth, client: s.clientWidth, right: s.getBoundingClientRect().right };
  }));
  assert.ok(boxes.length > 0, `${how}: tables and code blocks`);
  for (const b of boxes) {
    assert.equal(b.overflowX, 'auto', `${how}: a ${b.tag} scrolls in its own box (overflow-x: auto)`);
    assert.ok(b.right <= SMALL.width + 0.5, `${how}: the ${b.tag}'s box stays in the viewport`);
  }
  assert.ok(boxes.some((b) => b.scroll > b.client), `${how}: wider than the column, so scrollWidth > clientWidth`);
  const page2 = await page.evaluate(() => ({ sw: (document.scrollingElement as HTMLElement).scrollWidth, iw: innerWidth }));
  assert.equal(page2.sw, page2.iw, `${how}: the page has no sideways scroll`);
}

test('fr_edt_02_ac26_wide_blocks_on_the_phone', async ({ browser }) => {
  let page = await phonePage(browser);
  await startPhone(page, { route: `note/${PH.siroky}`, viewport: SMALL });
  await wide(page, 'Široký obsah', 'Široký obsah');
  const art = article(page, 'Široký obsah');
  const paras = await art.locator('p').evaluateAll((ps) => ps.map((p) => ({ t: (p as HTMLElement).innerText.slice(0, 40), sw: p.scrollWidth, cw: p.clientWidth })));
  for (const pick of ['nejneobhospodařovávatelnějšímu', 'Odkaz na trasu']) {
    const p = paras.find((x) => x.t.startsWith(pick));
    assert.ok(p, `the paragraph "${pick}…"`);
    assert.ok(p!.sw <= p!.cw, `"${pick}…" wraps (scrollWidth ${p!.sw} ≤ clientWidth ${p!.cw})`);
  }
  const img = await must(art.getByRole('img').first(), 'široký.png');
  await img.evaluate((i) => (i as HTMLImageElement).decode?.().catch(() => undefined));
  const ir = await rect(img);
  const col = await art.evaluate((a) => { const p = a.querySelector('p') as HTMLElement; return p.getBoundingClientRect().width; });
  assert.ok(ir && Math.abs(ir.width - col) <= 1, `široký.png is drawn at the column's width (${ir?.width} vs ${col})`);
  assert.ok(Math.abs(ir!.width / ir!.height - 5) <= 0.05, `with its 5 : 1 ratio (${ir!.width} × ${ir!.height})`);
  const callout = await rect(art.getByRole('note').first());
  assert.ok(callout && callout.right <= SMALL.width - 16 + 1 && callout.left >= 16 - 1, `the callout stays within the column (${callout?.left}…${callout?.right})`);
  const lines = await art.getByRole('note').first().evaluate((n) => { const p = [...n.querySelectorAll('p, div')].pop() as HTMLElement; return Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight || '24')); });
  assert.ok(lines >= 3, `the 300-character callout line wraps (${lines} lines)`);
  await page.close();
  page = await phonePage(browser);
  await startPhone(page, { vault: readVault(), route: 'note/Pages/Bloky.md', viewport: SMALL, now: RV_NOW });
  await wide(page, 'Bloky', 'Bloky');
  const embeds = await article(page, 'Bloky').evaluate((a) => [...a.querySelectorAll('[role="note"], figure, blockquote')].map((e) => e.getBoundingClientRect().right));
  assert.ok(embeds.every((r) => r <= SMALL.width - 16 + 1), `callouts and note embeds stay within the column (${embeds})`);
  await page.close();
});

// ------------------------------------------------------------------------------------------------ FR-EDT-07 AC-22

const strip = (page: Page) => main(page).locator('div.phone-strip[role="group"][aria-label="Properties"]');
async function sheetRows(page: Page): Promise<{ label: string; value: string }[]> {
  return sheet(page, 'Properties').locator('div[role="group"][aria-label]').evaluateAll((gs) => gs.map((g) => ({
    label: (g.getAttribute('aria-label') ?? '').normalize('NFC'),
    value: (g as HTMLElement).innerText.replace(/\s+/g, ' ').trim().normalize('NFC').replace((g.getAttribute('aria-label') ?? '').normalize('NFC'), '').trim(),
  })));
}
async function deskPanelText(browser: import('@playwright/test').Browser, o: Parameters<typeof startDesktop>[1]): Promise<string> {
  const { page: desk, context } = await desktopPage(browser);
  // D-2109: the attribute panel of the editor page (AC-22, contract CP-14), with the values shown in its fields.
  await startDesktop(desk, o);
  const region = await must(desk.getByRole('region', { name: 'Properties', exact: true }), 'desktop: the attribute panel (region Properties)', 5000);
  const text = flat(await region.evaluate((r) => {
    const out: string[] = [];
    const walk = (n: Node) => {
      if (n.nodeType === 3) { out.push(n.textContent ?? ''); return; }
      const e = n as HTMLElement;
      if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) { out.push(` ${e.value} `); return; }
      if (e instanceof HTMLSelectElement) { out.push(` ${e.selectedOptions[0]?.text ?? ''} `); return; }
      if (e.nodeType === 1 && getComputedStyle(e).display === 'none') return;
      const block = e.nodeType === 1 && /^(block|flex|grid|list-item|table-row)/.test(getComputedStyle(e).display);
      if (block) out.push(' ');
      for (const c of e.childNodes) walk(c);
      if (block) out.push(' ');
    };
    walk(r);
    return out.join('');
  }));
  await context.close();
  return text;
}
async function checkSheet(page: Page, deskText: string, how: string) {
  const rows = await eventually(() => sheetRows(page), (r) => r.length > 0, 3000);
  const labels = rows.map((r) => r.label);
  for (const l of ['Created', 'Modified']) assert.ok(labels.includes(l), `${how}: the sheet lists ${l}`);
  let at = -1;
  for (const r of rows) {
    const i = deskText.indexOf(r.label, at + 1);
    assert.ok(i > at, `${how}: "${r.label}" is a desktop panel row, in the same order`);
    at = i;
    if (r.value) assert.ok(deskText.includes(r.value), `${how}: "${r.label}" shows the desktop's value "${r.value}"`);
  }
  const s = sheet(page, 'Properties');
  assert.equal(await s.locator('input, textarea, select, [contenteditable], [role="listbox"], [role="option"]').count(), 0, `${how}: no input, contenteditable or option list in the sheet`);
  return rows;
}

test('fr_edt_07_ac22_properties_strip_and_sheet', async ({ browser }) => {
  const page = await phonePage(browser);
  const core = await startPhone(page, { route: `note/${B('Mapa bez severu')}` });
  const before = await fileStateOf(core);
  const st = await must(strip(page), 'the Properties strip below the title');
  const sr = await rect(st);
  const ar = await rect(appBar(page));
  assert.ok(sr && ar && sr.top >= ar.bottom - 1, 'below the app bar\'s title');
  await must(st.getByRole('link', { name: /Eva Lindová/ }), 'the author chip Eva Lindová');
  await must(st.getByText('Read', { exact: true }), 'the Status value Read');
  const deskText = await deskPanelText(browser, { route: `note/${B('Mapa bez severu')}` });
  const more = await must(st.getByRole('button', { name: /^\+\d+ propert(y|ies)$/ }), 'the button +<n> properties');
  await more.click();
  const rows = await checkSheet(page, deskText, 'Mapa bez severu');
  const n = rows.length - 2;
  await page.keyboard.press('Escape');
  await eventually(() => sheet(page, 'Properties').count(), (c) => c === 0, 1000);
  assert.equal(flat(await more.innerText()), n === 1 ? '+1 property' : `+${n} properties`, `the button counts the panel's rows not in the strip (${n}), with plural forms`);
  // closing: Close, the scrim, Back; a relation chip opens its target and closes the sheet
  for (const how of ['Close', 'the scrim', 'Back'] as const) {
    await more.click();
    const s = await must(sheet(page, 'Properties'), `${how}: the sheet`);
    if (how === 'Close') await s.getByRole('button', { name: 'Close' }).click();
    if (how === 'the scrim') await page.mouse.click(200, 60);
    if (how === 'Back') assert.equal(await systemBack(page), 'handled', 'Back closes the sheet');
    assert.equal(await eventually(() => sheet(page, 'Properties').count(), (c) => c === 0, 1500), 0, `${how} closes the sheet`);
    assert.equal(await mainName(page), 'Mapa bez severu', `${how}: the route stays`);
  }
  await more.click();
  await (await must(sheet(page, 'Properties').getByRole('link', { name: /Eva Lindová/ }), 'the relation chip in the sheet')).click();
  assert.equal(await eventually(() => mainName(page), (x) => x === 'Eva Lindová', 3000), 'Eva Lindová', 'a relation chip opens its target');
  assert.equal(await sheet(page, 'Properties').count(), 0, 'and closes the sheet');
  await assertZeroWrites(core, before, 'the strip and the sheet');
  await page.close();

  // read-view's Vlastnosti (every universal attribute)
  const p2 = await phonePage(browser);
  const c2 = await startPhone(p2, { vault: readVault(), route: 'note/Pages/Vlastnosti.md', now: RV_NOW });
  const b2 = await fileStateOf(c2);
  const dt2 = await deskPanelText(browser, { vault: readVault(), route: 'note/Pages/Vlastnosti.md', now: RV_NOW });
  await (await must(strip(p2).getByRole('button', { name: /^\+\d+ propert(y|ies)$/ }), 'Vlastnosti: +<n> properties')).click();
  await checkSheet(p2, dt2, 'Vlastnosti');
  await assertZeroWrites(c2, b2, 'Vlastnosti');
  await p2.close();
});

// ------------------------------------------------------------------------------------------------ FR-ATT-01 AC-17 (L5p)

const tmVault = () => loadVault('Zahrada', ['trash-media', 'new-empty/.tegg'], (f) => { f['Pages/Chybějící.md'] = '---\nid: 01JBAN2000000000000000N201\ntype: page\ntitle: Chybějící\n---\n![[missing.png]]\n'; });
const TM_NOW = '2026-10-22T10:00:00+02:00';

test('fr_att_01_ac17_media_on_the_phone', async ({ browser }) => {
  let page = await phonePage(browser);
  const core = await startPhone(page, { vault: tmVault(), route: 'note/Pages/Plán zahrady.md', now: TM_NOW });
  const before = await fileStateOf(core);
  const img = await must(main(page).getByRole('img', { name: 'Záhon', exact: true }), 'záhon.png (img alt Záhon)');
  const nw = await eventually(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth), (w) => w > 0, 3000);
  assert.ok(nw > 0, 'the image loads (naturalWidth > 0)');
  const r = await rect(img);
  assert.ok(r && r.width <= 412 - 32 + 1, `drawn at most at the column's width (${r?.width})`);
  await img.click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Záhon', 3000), 'Záhon', 'a tap on the image opens note/Images/Záhon.md (R76)');
  await must(main(page).getByRole('img', { name: 'Záhon' }), 'the object page shows the image');
  await must(main(page).getByText('Media type'), 'and its attribute rows');
  for (const name of ['Open in Preview', 'Reveal in Finder']) assert.equal(await page.getByRole('button', { name }).count(), 0, `no ${name}`);
  await systemBack(page);
  const card = main(page).locator('a, button, [role="link"], [role="button"]').filter({ hasText: 'Rozpočet' }).filter({ hasText: /\d+ pages?/ });
  await (await must(card, 'the Rozpočet.pdf card')).click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Rozpočet', 3000), 'Rozpočet', 'the card opens its PDF object page');
  for (const name of ['Open in Preview', 'Reveal in Finder']) assert.equal(await page.getByRole('button', { name }).count(), 0, `PDF page: no ${name}`);
  assert.deepEqual((await core.calls()).filter((c) => ['media_open', 'media_reveal', 'open_external', 'android_open_url'].includes(c.cmd)).map((c) => c.cmd), [], 'no way to open the file in another app');
  await assertZeroWrites(core, before, 'media');
  await page.close();
  page = await phonePage(browser);
  await startPhone(page, { vault: tmVault(), route: 'note/Pages/Chybějící.md', now: TM_NOW });
  await must(main(page).getByText('Can\'t find "missing.png"'), '![[missing.png]] shows R77\'s broken-media placeholder');
  await page.close();
});

// ------------------------------------------------------------------------------------------------ FR-NAV-08 AC-3 (L5p)

test('fr_nav_08_ac3_no_previews_on_the_phone', async ({ browser }) => {
  for (const mode of ['click', 'hover', 'off'] as const) {
    const uiState = ui({ extra: { preview: { mode, hoverDelay: 1000 } } });
    const anyPreview = (p: Page) => p.getByRole('dialog', { name: /^⟦?Preview: / });
    // a link in Odkazy
    let page = await phonePage(browser);
    await startPhone(page, { vault: readVault(), route: 'note/Pages/Odkazy.md', now: RV_NOW, uiState });
    const link = article(page, 'Odkazy').locator('li').filter({ hasText: /^Prostý:/ }).getByRole('link').first();
    const lr = await rect(await must(link, `${mode}: the link to Cíl`));
    const prevented = await longPress(page, { x: lr!.x + lr!.width / 2, y: lr!.y + lr!.height / 2 }, 800);
    await sleep(1200);
    assert.equal(await anyPreview(page).count(), 0, `${mode}: a long press shows no preview`);
    assert.equal(prevented, true, `${mode}: and no WebView context menu`);
    await link.click();
    assert.equal(await eventually(() => mainName(page), (n) => n === 'Cíl', 1000), 'Cíl', `${mode}: a tap on a link opens it at once`);
    assert.equal(await anyPreview(page).count(), 0, `${mode}: no preview`);
    await page.close();
    // a search result, a card, a pinned item
    page = await phonePage(browser);
    await startPhone(page, { route: 'search', uiState });
    const q = page.getByRole('search').getByRole('searchbox', { name: 'Search query' }).or(page.getByRole('search').getByRole('textbox', { name: 'Search query' }));
    await (await must(q, 'Search query')).fill('Mapa výletu');
    const res = main(page).getByRole('list', { name: 'Search results' }).getByRole('link').first();
    await (await must(res, `${mode}: a search result`, 3000)).click();
    assert.equal(await eventually(() => mainName(page), (n) => n === 'Mapa výletu', 1000), 'Mapa výletu', `${mode}: a search result opens at once`);
    assert.equal(await anyPreview(page).count(), 0, `${mode}: no preview`);
    await openDrawer(page);
    await drawer(page).locator('.sidebar-pinned [data-pinned-row]').nth(1).click();
    assert.equal(await eventually(() => mainName(page), (n) => n === 'Rozečtené', 1000), 'Rozečtené', `${mode}: a pinned item opens at once`);
    const c = main(page).locator(`article[data-board-card="${nfc(B('Noční vlak'))}"]`).first();
    await (await must(c, `${mode}: a card`)).click();
    assert.equal(await eventually(() => mainName(page), (n) => n === 'Noční vlak', 1000), 'Noční vlak', `${mode}: a card opens at once`);
    assert.equal(await anyPreview(page).count(), 0, `${mode}: no preview`);
    await page.close();
  }
  const page = await phonePage(browser);
  await startPhone(page, { route: 'settings' });
  assert.equal(await main(page).getByRole('link', { name: 'Previews' }).count(), 0, 'Settings on the phone has no Previews section');
  await page.close();
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-36 (L5p)

const POZDEJI = '---\nid: 01JBAN2000000000000000N301\ntype: page\ntitle: Později\ncreated: 2026-11-19T09:30:00+01:00\nmodified: 2026-11-19T09:30:00+01:00\n---\nDorazilo později ze synchronizace.\n';
const CHYBI = '# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Chybí.\nversion: 1\ntitle: Chybí\ntypes: [book]\nmatch: all\nfilters: []\nsort: { by: title, order: asc }\nlimit: 50\nview: list\ncreated: 2026-11-19T09:00:00+01:00\nmodified: 2026-11-19T09:00:00+01:00\n';

test('fr_syn_03_ac36_partly_synced_vault_on_the_phone', async ({ browser }) => {
  // [[Později]]: broken, then resolved when it arrives
  let page = await phonePage(browser);
  let core = await startPhone(page, { route: `note/${PH.ven}` });
  let before = await fileStateOf(core);
  const art = await must(article(page, 'Odkazy ven'), 'Odkazy ven');
  const styleOf = (name: string) => art.getByRole('link', { name }).first().evaluate((a) => { const s = getComputedStyle(a); return `${s.color}|${s.textDecorationLine}|${s.textDecorationStyle}|${a.getAttribute('data-link-kind') ?? ''}`; });
  const broken = await styleOf('Neexistuje');
  assert.equal(await styleOf('Později'), broken, '[[Později]] shows the broken-link style');
  await art.getByRole('link', { name: 'Později' }).first().click();
  await must(notice(page).filter({ hasText: 'No note named “Později” in this vault yet.' }), 'a tap shows AC-11\'s notice', 1000);
  await core.setFile('Pages/Později.md', POZDEJI);
  assert.notEqual(await eventually(() => styleOf('Později'), (s) => s !== broken, 2000), broken, 'the link resolves within 2 s');
  await art.getByRole('link', { name: 'Později' }).first().click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Později', 2000), 'Později', 'and opens it');
  await assertZeroWrites(core, { files: { ...before.files, 'Pages/Později.md': POZDEJI }, bin: before.bin }, '[[Později]]');
  await page.close();

  // a view whose query file isn't there yet
  const vault = phoneVault((f) => {
    f[PH.book] = f[PH.book].replace('views: [Rozečtené, Přečtené 2026, Výborné knihy]', 'views: [Rozečtené, Přečtené 2026, Výborné knihy, Chybí]');
    f[PH.pins] += '  - id: 01JBAN2000000000000000N301\n    path: Pages/Později.md\n';
  });
  page = await phonePage(browser);
  core = await startPhone(page, { vault, route: 'type/book' });
  before = await fileStateOf(core);
  await main(page).locator('[role="tab"][data-view-tab="Chybí"]').click();
  const panel = main(page).locator('div[role="tabpanel"]');
  await must(panel.getByText(/Chybí/), 'the not-found state');
  assert.equal(await main(page).getByRole('button', { name: 'Remove from Books page' }).count(), 0, 'without Remove from Books page');
  await core.setFile('.tegg/queries/Chybí.yml', CHYBI);
  const n = await eventually(() => panel.locator('[data-query-result]').count(), (c) => c === 17, 2000);
  assert.equal(n, 17, 'its results within 2 s of the file\'s arrival');
  // a pin whose target hasn't arrived
  await openDrawer(page);
  const rows = drawer(page).locator('.sidebar-pinned [data-pinned-row]');
  assert.equal(await rows.nth(2).getAttribute('data-pin-state'), 'missing', 'a pin whose target hasn\'t arrived shows the missing state');
  await core.setFile('Pages/Později.md', POZDEJI);
  assert.notEqual(await eventually(() => rows.nth(2).getAttribute('data-pin-state'), (s) => s !== 'missing', 2000), 'missing', 'and resolves when it arrives');
  await assertZeroWrites(core, { files: { ...before.files, '.tegg/queries/Chybí.yml': CHYBI, 'Pages/Později.md': POZDEJI }, bin: before.bin }, 'no file created or rewritten to "fix" anything');
  await page.close();
});
