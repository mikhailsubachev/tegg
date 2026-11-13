// v0.94 feedback (D-1165, D-1170, D-1173, D-1176), L5 (WebKit + fake core): input inside an open preview, R129.
// docs/acceptance/previews.md part three, FR-LNK-11 AC-17 (a click on the header, strip or body opens the previewed
// object; T2), AC-18 (every kind of preview of R105), AC-19 (what keeps its own job; D-1173's clicks), AC-20 (every mode
// and surface; the keyboard unchanged), AC-21 (links inside in hover mode, D-1170), AC-22 (links inside in click mode
// unchanged, D-932; Off and ⏎ / ⌥Space per D-1176). D-1164's test rule: every test stores the mode it names. Interface
// docs/contracts/v1-previews.md §3 (R102's parts, the popover's history), ms3-shell §6 (`route-ready:<route>`). Written
// from the ACs and the contracts only (D-61); every lookup goes through `need` and node:assert (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { wordPoint } from './previews-editor-helpers';
import {
  PV, ZONE, anyBack, anyContent, back, backBtn, backlinksPanel, chipNamed, closeBtn, content, createOffer, editorBody, embedLoadsSince, eventually,
  focusInfo, header, main, mainName, mainScrollTop, mark, mustBeOn, navsSince, need, needAnyPreview, needClosed, needOdkazyLink, needPreview,
  nfc, openBtn, previewCount, previewPath, previews, previewsVault, props, resizeHandle, runCommand, scrollState, searchFor, selectedBlocks, sleep,
  snapshot, startPreviews, strip, swap, tagRoute, taskCard, topInScroller, typeTable, writesSince, type FakeCoreHandle, type PreviewsStart,
} from './previews-helpers';

test.use({ timezoneId: ZONE });

const rozpocetChip = (page: Page) => needOdkazyLink(page, 'Hlavní', 0, 'the chip Rozpočet 2027 in "Hlavní Rozpočet 2027."');
/** A fresh `Preview: Rozpočet 2027` from Odkazy's chip, by a click (click mode). */
async function clickPreview(page: Page, start = 'Hlavní', n = 0, title = 'Rozpočet 2027', name = title): Promise<Locator> {
  await (await needOdkazyLink(page, start, n)).click();
  return needPreview(page, name, `a click on the link ${n + 1} of "${start}…" (click mode)`);
}
/** Route-ready marks (`perf_mark`, ms3-shell §6) of `route` so far. */
async function readyCount(core: FakeCoreHandle, route: string): Promise<number> {
  const want = `route-ready:${nfc(route)}`;
  return (await core.calls()).filter((c) => c.cmd === 'perf_mark' && nfc(String((c.args as any)?.mark ?? (c.args as any)?.name ?? '')) === want).length;
}
/** Waits until one more `route-ready:<route>` than `before` was sent (either spelling of a tag route). */
async function routeShown(core: FakeCoreHandle, routes: string[], before: number[], ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (let i = 0; i < routes.length; i++) if ((await readyCount(core, routes[i])) > before[i]) return true;
    await sleep(50);
  }
  return false;
}
async function clickAtWord(page: Page, loc: Locator, word: string, what: string, o: { meta?: boolean; double?: boolean } = {}) {
  const p = await wordPoint(loc, word);
  assert.ok(p, `${what}: the word "${word}" is shown`);
  if (o.meta) await page.keyboard.down('Meta');
  if (o.double) await page.mouse.dblclick(p!.x, p!.y); else await page.mouse.click(p!.x, p!.y);
  if (o.meta) await page.keyboard.up('Meta');
}
/** The open of Rozpočet as `Open` does it: the centre pane, one `nav_opened`, no popover, the editor. */
async function openedRozpocet(page: Page, core: FakeCoreHandle, n0: number, how: string) {
  await mustBeOn(page, 'Rozpočet 2027', `${how}: opens note/Pages/Rozpočet 2027.md`, 5000);
  assert.deepEqual(await navsSince(core, n0), [nfc(PV.rozpocet)], `${how}: exactly one nav_opened (Rozpočet)`);
  assert.equal(await previewCount(page), 0, `${how}: no popover left`);
}

// ------------------------------------------------------------------------------------------------ FR-LNK-11 AC-17

for (const view of ['editor', 'read'] as const) {
  test(`fr_lnk_11_ac17_a_click_on_the_header_strip_or_body_opens_the_previewed_object_${view}`, async ({ page }) => {
    const core = await startPreviews(page, { at: PV.odkazy, mode: 'click', readView: view === 'read' });
    const scroll0 = await mainScrollTop(page);
    // The comparison: `Open` on the same preview.
    let d = await clickPreview(page);
    let n0 = await mark(core);
    await (await need(openBtn(d, 'Rozpočet 2027'), 'button "Open Rozpočet 2027"')).click();
    await openedRozpocet(page, core, n0, `${view}: Open (the comparison)`);
    await back(page, 'Odkazy', `${view}: Back after Open`);
    const targets: [string, (d: Locator) => Promise<void>][] = [
      ['the title', async (x) => { await (await need(header(x).locator('h2'), 'the header title h2')).click(); }],
      ['the type icon', async (x) => { await (await need(header(x).locator('[data-icon]'), 'the header type icon')).click(); }],
      ['the type name Page', async (x) => { await (await need(header(x).getByText('Page', { exact: true }), 'the type name "Page"')).click(); }],
      ['the paragraph', async (x) => { await (await need(content(x, 'Rozpočet 2027').getByText('Návrh rozpočtu na rok 2027 pro celý tým.', { exact: true }), 'the first paragraph')).click(); }],
      ['the heading Rozsah', async (x) => { await (await need(content(x, 'Rozpočet 2027').locator('h1, h2, h3, h4, h5, h6').filter({ hasText: /^\s*Rozsah\s*$/ }), 'the heading Rozsah')).click(); }],
      ['the image', async (x) => { await (await need(content(x, 'Rozpočet 2027').locator('img'), 'the image in the body')).click(); }],
      ['"Odpovídá" next to the Jana Nováková chip', async (x) => { await clickAtWord(page, content(x, 'Rozpočet 2027'), 'Odpovídá', 'the Rozsah paragraph'); }],
      ['the last paragraph after scrolling to the end', async (x) => {
        const art = await need(content(x, 'Rozpočet 2027'), 'the body');
        await art.evaluate((a) => { let s: HTMLElement | null = a as HTMLElement; while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement; if (s) s.scrollTop = s.scrollHeight; });
        await sleep(200);
        await (await need(art.getByText('Poslední odstavec rozpočtu.', { exact: true }), 'the last paragraph')).click();
      }],
    ];
    for (const [what, act] of targets) {
      d = await clickPreview(page);
      n0 = await mark(core);
      await act(d);
      await openedRozpocet(page, core, n0, `${view}: a click on ${what}`);
      await back(page, 'Odkazy', `${view}: Back after ${what}`);
      const s = await eventually(() => mainScrollTop(page), (t) => Math.abs(t - scroll0) <= 24, 2000);
      assert.ok(Math.abs(s - scroll0) <= 24, `${view}: Back returns to Odkazy at its scroll position (${scroll0} → ${s})`);
    }
    // The section and the block keep their fragment.
    // D-1185: a section preview's dialog is named `Preview: Rozpočet 2027 › Rozsah` or `Preview: Rozpočet 2027`; its
    // header title is exactly `Rozpočet 2027 › Rozsah`.
    await (await needOdkazyLink(page, 'Sekce', 0)).click();
    d = await need(page.getByRole('dialog', { name: /^Preview: Rozpočet 2027( › Rozsah)?$/ }), `${view}: a click on the section link (click mode)`);
    assert.equal((await d.locator('header h2').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim(), 'Rozpočet 2027 › Rozsah', `${view}: the section preview's title`);
    n0 = await mark(core);
    await clickAtWord(page, anyContent(d), 'Personál', `${view}: the section body`);
    await openedRozpocet(page, core, n0, `${view}: a click on the section body`);
    const hd = await need(main(page).locator('h2, h3, h4').filter({ hasText: /^\s*Rozsah\s*$/ }), 'the heading Rozsah');
    // The editor lands a heading link 24 px below the pane's top (D-1625, D-1659); the read view keeps its top landing (D-215).
    const want = view === 'editor' ? 24 : 0;
    const top = await eventually(() => topInScroller(hd), (t) => t !== null && Math.abs(t - want) <= 8, 2000);
    assert.ok(top !== null && Math.abs(top - want) <= 8, `${view}: note/Pages/Rozpočet 2027.md#Rozsah with Rozsah ${want} px below the top (± 8 px): ${top}`);
    await back(page, 'Odkazy', `${view}: Back`);
    d = await clickPreview(page, 'Blok', 0);
    n0 = await mark(core);
    await (await need(anyContent(d).getByText('Kdo schvaluje nákup licencí?', { exact: true }), 'the block')).click();
    await openedRozpocet(page, core, n0, `${view}: a click on the block`);
    // D-1195: the block is matched by its text start (the editor shows its id), and it is at the top as far as the pane
    // can scroll (it is near the note's end).
    const bl = await need(main(page).locator('p, li').filter({ hasText: /^\s*Kdo schvaluje nákup licencí\?/ }), 'the block in the note');
    const atBlock = () => bl.first().evaluate((e) => {
      let sc: HTMLElement | null = e.parentElement;
      while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
      const box = sc ?? document.documentElement;
      const top = e.getBoundingClientRect().top - box.getBoundingClientRect().top;
      const atEnd = box.scrollTop >= box.scrollHeight - box.clientHeight - 1;
      return { top, ok: Math.abs(top) <= 8 || (atEnd && top > 0 && top < box.clientHeight) };
    }).catch(() => ({ top: NaN, ok: false }));
    const bst = await eventually(atBlock, (x) => x.ok, 2000);
    assert.ok(bst.ok, `${view}: the note scrolled to ^otazka1, at the top as far as the pane scrolls (read-view FR-EDT-02 AC-7): ${bst.top}`);
    await back(page, 'Odkazy', `${view}: Back`);
    // The strip of Projekt Alfa.
    d = await clickPreview(page, 'Projekt', 0, 'Projekt Alfa');
    n0 = await mark(core);
    await clickAtWord(page, strip(d), 'Aktivní', `${view}: the strip's Stav Aktivní`);
    await mustBeOn(page, 'Projekt Alfa', `${view}: a click on the strip's Stav Aktivní opens note/Projekty/Projekt Alfa.md`, 5000);
    assert.deepEqual(await navsSince(core, n0), [nfc(PV.alfa)], `${view}: one nav_opened (Alfa)`);
    assert.deepEqual(await writesSince(core, 0), [], `${view}: nothing is written`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-LNK-11 AC-18

type Kind = { name: string; link: [string, number]; title: string; click: (d: Locator, page: Page) => Promise<void>; opens: { title?: string; path?: string; routes?: string[] } };
const KINDS: Kind[] = [
  { name: 'jana_properties_row', link: ['Osoby', 0], title: 'Jana Nováková', click: async (d, page) => { await clickAtWord(page, d, 'Analytička', 'the Properties row Role Analytička'); }, opens: { title: 'Jana Nováková', path: PV.jana } },
  { name: 'prazdna_empty_note', link: ['Prázdná', 0], title: 'Prázdná', click: async (d) => { await (await need(anyContent(d).getByText('Empty note', { exact: true }), '"Empty note"')).click(); }, opens: { title: 'Prázdná', path: PV.prazdna } },
  { name: 'ukol_strip_priority', link: ['Úkol', 0], title: 'Zavolat Janě', click: async (d, page) => { await clickAtWord(page, strip(d), 'High', 'the strip\'s Priority High'); }, opens: { title: 'Zavolat Janě', path: PV.ukol } },
  { name: 'daily_2026_10_07', link: ['Dny', 0], title: '2026-10-07', click: async (d, page) => { await clickAtWord(page, anyContent(d), 'Zápis', 'the body "Zápis dne."'); }, opens: { routes: ['daily/2026-10-07'] } },
  { name: 'daily_2026_10_30_virtual', link: ['Dny', 1], title: '2026-10-30', click: async (d) => { await (await need(anyContent(d).getByText('No note for this day yet.', { exact: true }), '"No note for this day yet."')).click(); }, opens: { routes: ['daily/2026-10-30'] } },
  { name: 'tag_ucty', link: ['Štítky', 0], title: '#Účty', click: async (d) => { await (await need(anyContent(d).getByText('2 objects', { exact: true }), '"2 objects"')).click(); }, opens: { routes: [tagRoute('účty'), 'tag/účty'] } },
  { name: 'tag_napad_virtual', link: ['Štítky', 1], title: '#nápad', click: async (d) => { await (await need(anyContent(d).getByText(/^\d+ objects?$/), 'the count "<n> objects"')).click(); }, opens: { routes: [tagRoute('nápad'), 'tag/nápad'] } },
  { name: 'graf_image', link: ['Média', 0], title: 'Graf', click: async (d) => { await (await need(anyContent(d).locator('img'), 'the image')).click(); }, opens: { title: 'Graf', path: PV.graf } },
  { name: 'neplatna_notice', link: ['Prázdná', 1], title: 'Neplatná hlavička', click: async (d) => { await (await need(d.getByText('This note\'s properties can\'t be read.', { exact: true }), 'the notice')).click(); }, opens: { title: 'Neplatná hlavička', path: PV.neplatna } },
];

for (const k of KINDS) {
  test(`fr_lnk_11_ac18_every_kind_of_preview_${k.name}`, async ({ page }) => {
    const core = await startPreviews(page, { at: PV.odkazy, mode: 'click' });
    const files0 = await snapshot(core);
    const d = await clickPreview(page, k.link[0], k.link[1], k.title);
    const before = await Promise.all((k.opens.routes ?? []).map((r) => readyCount(core, r)));
    const n0 = await mark(core);
    await k.click(d, page);
    if (k.opens.title) {
      await mustBeOn(page, nfc(k.opens.title), `${k.name}: a click on the body opens ${k.opens.path}`, 5000);
      assert.deepEqual(await navsSince(core, n0), [nfc(k.opens.path!)], `${k.name}: one nav_opened`);
    } else {
      assert.ok(await routeShown(core, k.opens.routes!, before), `${k.name}: a click on the body opens ${k.opens.routes![0]}`);
    }
    assert.equal(await previewCount(page), 0, `${k.name}: no popover left`);
    await sleep(300);
    assert.deepEqual(await writesSince(core, 0), [], `${k.name}: nothing is written`);
    const files1 = await snapshot(core);
    assert.deepEqual(Object.keys(files1).sort(), Object.keys(files0).sort(), `${k.name}: no file created (no Daily/2026-10-30.md, no Tags/nápad.md)`);
  });
}

test('fr_lnk_11_ac18_the_email_link_in_janas_preview_opens_mail_only', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, mode: 'click' });
  const d = await clickPreview(page, 'Osoby', 0, 'Jana Nováková');
  const n0 = await mark(core);
  await (await need(d.getByRole('link', { name: 'jana@example.com', exact: true }), 'the link jana@example.com in Jana\'s Properties')).click();
  const ext = await eventually(() => core.externalOpened(), (u) => u.some((x) => x.includes('jana@example.com')), 2000);
  assert.ok(ext.some((x) => /^mailto:jana@example\.com$/.test(x)), `it asks open_external for mailto:jana@example.com (${JSON.stringify(ext)})`);
  await sleep(300);
  assert.equal(await mainName(page), 'Odkazy', 'and opens nothing else');
  assert.deepEqual(await navsSince(core, n0), [], 'no nav_opened');
});

test('fr_lnk_11_ac18_a_click_on_the_gone_notice_opens_nothing', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, mode: 'click' });
  const d = await clickPreview(page);
  await core.renameFile(PV.rozpocet, '.trash/Pages/Rozpočet 2027.md');
  const gone = await need(d.getByText('This object was moved or deleted.', { exact: true }), 'the notice "This object was moved or deleted." (FR-LNK-11 AC-11)', 5000);
  // Control: Open is aria-disabled now.
  assert.equal(await openBtn(d, 'Rozpočet 2027').getAttribute('aria-disabled'), 'true', 'Open is aria-disabled (FR-LNK-11 AC-11)');
  const n0 = await mark(core);
  await gone.click();
  await sleep(500);
  assert.equal(await mainName(page), 'Odkazy', 'a click on the notice opens nothing');
  assert.deepEqual(await navsSince(core, n0), [], 'no nav_opened');
  assert.equal(await previewCount(page), 1, 'the popover stays');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-11 AC-19

test('fr_lnk_11_ac19_close_back_and_the_resize_handle_keep_their_jobs', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, mode: 'click' });
  let d = await clickPreview(page);
  await (await need(closeBtn(d), 'button "Close preview"')).click();
  await needClosed(page, 'Close preview closes it');
  assert.equal((await focusInfo(page)).inBody, true, 'the focus is back after the chip (in the Note body)');
  d = await clickPreview(page);
  await (await need(chipNamed(content(d, 'Rozpočet 2027'), 'Jana Nováková'), 'the chip Jana Nováková inside')).click();
  const dj = await needPreview(page, 'Jana Nováková', 'following Jana inside (click mode, D-932)');
  await (await need(backBtn(dj, 'Rozpočet 2027'), 'button "Back to Rozpočet 2027"')).click();
  d = await needPreview(page, 'Rozpočet 2027', 'Back to Rozpočet 2027 restores Rozpočet');
  const n0 = await mark(core);
  const h = await need(resizeHandle(d), 'the handle "Resize preview"');
  await h.click();
  await sleep(300);
  assert.equal(await mainName(page), 'Odkazy', 'a click on Resize preview opens nothing');
  const w0 = (await d.boundingBox())!.width;
  const hb = (await h.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await sleep(200);
  const w1 = (await d.boundingBox())!.width;
  assert.ok(w1 > w0 + 20, `a drag of the handle changes the size (${w0} → ${w1})`);
  assert.equal(await mainName(page), 'Odkazy', 'the drag opens nothing');
  const hb2 = (await h.boundingBox())!;
  await page.mouse.dblclick(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
  await sleep(300);
  // The size resets: the stored size goes (FR-LNK-11 AC-4), and the popover, if still shown, is 380 px wide.
  const st = await eventually(async () => (await core.uiState())?.preview, (p) => !!p && !('width' in p), 2000);
  assert.ok(st && !('width' in st) && !('height' in st), `a double-click on the handle resets the size (stored preview ${JSON.stringify(st)})`);
  if ((await previewCount(page)) === 1) {
    const w2 = (await (await needPreview(page, 'Rozpočet 2027', 'after the double-click')).boundingBox())!.width;
    assert.ok(Math.abs(w2 - 380) <= 1, `the popover is 380 px wide again (got ${w2})`);
  }
  assert.equal(await mainName(page), 'Odkazy', 'the double-click on the handle opens nothing');
  assert.deepEqual(await navsSince(core, n0), [], 'no nav_opened from the handle');
});

test('fr_lnk_11_ac19_the_scrollbar_a_selecting_drag_and_the_footer_hint_open_nothing', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, mode: 'click' });
  // WebKit draws overlay scrollbars: the test gives the body a 12 px classic scrollbar.
  await page.addStyleTag({ content: '[role="dialog"][data-preview-path] *::-webkit-scrollbar { width: 12px; height: 12px; } [role="dialog"][data-preview-path] *::-webkit-scrollbar-thumb { background: #888; min-height: 40px; }' });
  const d = await clickPreview(page);
  const art = await need(content(d, 'Rozpočet 2027'), 'the body');
  const n0 = await mark(core);
  // A press and drag on the body's scrollbar.
  const sc = await art.evaluate((a) => {
    let s: HTMLElement | null = a as HTMLElement;
    while (s && !(/(auto|scroll)/.test(getComputedStyle(s).overflowY) && s.scrollHeight > s.clientHeight)) s = s.parentElement;
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { right: r.right, top: r.top, bar: s.offsetWidth - s.clientWidth, scrollTop: s.scrollTop };
  });
  assert.ok(sc && sc.bar >= 8, `the body has a classic scrollbar (${JSON.stringify(sc)})`);
  await page.mouse.move(sc!.right - 5, sc!.top + 15);
  await page.mouse.down();
  await page.mouse.move(sc!.right - 5, sc!.top + 90, { steps: 6 });
  await page.mouse.up();
  await sleep(200);
  const st = await scrollState(art);
  assert.ok(st && st.top > sc!.scrollTop, `the press and drag on the scrollbar scrolls the body (${sc!.scrollTop} → ${st?.top})`);
  assert.equal(await mainName(page), 'Odkazy', 'and opens nothing');
  await art.evaluate((a) => { let s: HTMLElement | null = a as HTMLElement; while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement; if (s) s.scrollTop = 0; });
  await sleep(150);
  // A drag from "Návrh" 80 px to the right selects text and opens nothing; ⌘C copies it.
  const p = await art.evaluate((a) => {
    const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      const i = (t as Text).data.normalize('NFC').indexOf('Návrh');
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1);
      const b = r.getBoundingClientRect();
      return { x: b.left + 0.5, y: b.top + b.height / 2 };
    }
    return null;
  });
  assert.ok(p, 'the word Návrh');
  await page.mouse.move(p!.x, p!.y);
  await page.mouse.down();
  await page.mouse.move(p!.x + 80, p!.y, { steps: 6 });
  await page.mouse.up();
  await sleep(300);
  const sel = await page.evaluate(() => String(getSelection() ?? ''));
  const para0 = 'Návrh rozpočtu na rok 2027 pro celý tým.';
  assert.ok(sel.normalize('NFC').startsWith('Návrh roz') && para0.startsWith(sel.normalize('NFC')), `the selection "Návrh rozpo…" (from Návrh, 80 px) stays in the body (got ${JSON.stringify(sel)})`);
  assert.equal(await mainName(page), 'Odkazy', 'a selecting drag opens nothing');
  assert.equal(await previewCount(page), 1, 'and keeps the popover');
  await page.evaluate(() => { (window as any).__pvCopied = null; document.addEventListener('copy', () => { (window as any).__pvCopied = String(getSelection()); }, true); });
  await page.keyboard.press('Meta+c');
  assert.equal((await page.evaluate(() => (window as any).__pvCopied as string | null))?.normalize('NFC'), sel.normalize('NFC'), '⌘C copies the selected text');
  // The footer's hint.
  await (await need(d.getByText('Double-click or ⌘↩ to open', { exact: true }), 'the footer hint')).click();
  await sleep(300);
  assert.equal(await mainName(page), 'Odkazy', 'a click on the footer hint opens nothing');
  assert.equal(await previewCount(page), 1, 'and keeps the popover');
  assert.deepEqual(await navsSince(core, n0), [], 'no nav_opened');
});

test('fr_lnk_11_ac19_cmd_click_broken_and_external_links_inside', async ({ page }) => {
  const vault = previewsVault((f) => { f[nfc(PV.petr)] = swap(f[nfc(PV.petr)], 'Vede tým nákupu.', 'Vede tým nákupu. Viz [[Neexistuje]]. Také [web](https://example.com/x).'); });
  const core = await startPreviews(page, { at: PV.odkazy, mode: 'click', vault });
  let d = await clickPreview(page);
  let n0 = await mark(core);
  const jana = await need(chipNamed(content(d, 'Rozpočet 2027'), 'Jana Nováková'), 'the chip Jana Nováková inside');
  await jana.click({ modifiers: ['Meta'] });
  await mustBeOn(page, 'Jana Nováková', '⌘-click on the chip inside opens note/Osoby/Jana Nováková.md (D-925)', 5000);
  assert.deepEqual(await navsSince(core, n0), [nfc(PV.jana)], 'one nav_opened');
  await back(page, 'Odkazy');
  d = await clickPreview(page, 'Osoby', 1, 'Petr Dvořák');
  n0 = await mark(core);
  await (await need(d.getByRole('link', { name: 'web', exact: true }), 'the external link "web" inside')).click();
  const ext = await eventually(() => core.externalOpened(), (u) => u.includes('https://example.com/x'), 2000);
  assert.ok(ext.includes('https://example.com/x'), `the external link asks open_external with https://example.com/x (${JSON.stringify(ext)})`);
  await sleep(300);
  assert.equal(await mainName(page), 'Odkazy', 'and opens nothing else');
  assert.deepEqual(await navsSince(core, n0), [], 'no nav_opened');
  // The broken link: from the preview if it is still open, else from a fresh one.
  if ((await previewCount(page)) === 0) d = await clickPreview(page, 'Osoby', 1, 'Petr Dvořák');
  else d = await needAnyPreview(page, 'the preview after the external link');
  await (await need(chipNamed(anyContent(d), 'Neexistuje'), 'the broken chip inside')).click();
  await need(createOffer(page), 'a click on a broken link inside opens the Create offer');
  assert.equal(await previewCount(page), 0, 'the Create offer replaces the popover');
});

test('fr_lnk_11_ac19_cmd_click_on_text_a_collapsing_click_and_a_double_click_per_d_1173', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, mode: 'click' });
  const d = await clickPreview(page);
  const art = content(d, 'Rozpočet 2027');
  let n0 = await mark(core);
  await clickAtWord(page, art, 'rozpočtu', '⌘-click on body text', { meta: true });
  await sleep(400);
  assert.equal(await mainName(page), 'Odkazy', '⌘-click on body text outside a link does nothing (D-1173)');
  assert.equal(await previewCount(page), 1, 'the popover stays');
  // A selection, then a click that only collapses it: it clears the selection only.
  const ok = await art.evaluate((a) => {
    const p = [...a.querySelectorAll('p')].find((e) => (e.textContent ?? '').startsWith('Návrh'));
    const t = p?.firstChild;
    if (!t || t.nodeType !== 3) return false;
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 5);
    const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    return true;
  });
  assert.ok(ok, 'a selection in the body');
  await clickAtWord(page, art, 'celý', 'the collapsing click');
  await sleep(400);
  assert.equal(await page.evaluate(() => String(getSelection() ?? '')), '', 'the click clears the selection');
  assert.equal(await mainName(page), 'Odkazy', 'and opens nothing (D-1173)');
  assert.deepEqual(await navsSince(core, n0), [], 'no nav_opened so far');
  // A double-click on body text: the first click opens (D-1173). D-1195: a body word away from figures (in the preview
  // and, for the second click, in the opened note), which opens nothing new.
  n0 = await mark(core);
  await clickAtWord(page, art, 'Personál', 'the double-click on body text', { double: true });
  await openedRozpocet(page, core, n0, 'a double-click on body text (the first click opens, D-1173)');
  await sleep(400);
  assert.deepEqual(await navsSince(core, n0), [nfc(PV.rozpocet)], 'the second click opens nothing new');
  assert.equal(await mainName(page), 'Rozpočet 2027', 'and Rozpočet stays shown');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-11 AC-20

test('fr_lnk_11_ac20_hover_mode_a_click_on_the_body_opens', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, mode: 'hover', hoverDelay: 400 });
  const chip = await rozpocetChip(page);
  const b = (await chip.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 });
  const d = await needPreview(page, 'Rozpočet 2027', 'hover (400 ms stored)', 2500);
  const p = await wordPoint(content(d, 'Rozpočet 2027'), 'Návrh');
  assert.ok(p, 'the body text');
  await page.mouse.move(p!.x, p!.y, { steps: 8 });
  await sleep(150);
  assert.equal(await previewCount(page), 1, 'moving onto the preview keeps it');
  const n0 = await mark(core);
  await page.mouse.click(p!.x, p!.y);
  await openedRozpocet(page, core, n0, 'hover mode: a click on the body');
});

test('fr_lnk_11_ac20_off_the_alt_space_preview_clicked_on_its_body_opens', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, mode: 'off', readView: true });
  await (await rozpocetChip(page)).focus();
  await page.keyboard.press('Alt+Space');
  const d = await needPreview(page, 'Rozpočet 2027', 'Off: ⌥Space');
  const n0 = await mark(core);
  await clickAtWord(page, content(d, 'Rozpočet 2027'), 'Návrh', 'Off: the body');
  await openedRozpocet(page, core, n0, 'Off: a click on the body of the ⌥Space preview');
});

type Surface = { name: string; start: PreviewsStart; go?: (page: Page) => Promise<void>; ref: (page: Page) => Promise<Locator>; title: string; word: string; opens: string; path: string };
const SURFACES: Surface[] = [
  { name: 'attribute_relation_chip', start: { at: PV.alfa }, ref: (p) => need(chipNamed(props(p), 'Jana Nováková'), 'the Vlastník chip Jana Nováková'), title: 'Jana Nováková', word: 'Analytička', opens: 'Jana Nováková', path: PV.jana },
  { name: 'backlinks_chip', start: { at: PV.rozpocet, panel: true }, ref: (p) => need(chipNamed(backlinksPanel(p), 'Odkazy'), 'the Backlinks chip Odkazy'), title: 'Odkazy', word: 'Hlavní', opens: 'Odkazy', path: PV.odkazy },
  { name: 'search_result_row', start: { at: PV.odkazy }, go: async (p) => { await searchFor(p, 'rozpočet', 'Rozpočet 2027'); }, ref: (p) => need(p.getByRole('list', { name: 'Search results', exact: true }).getByRole('listitem').filter({ hasText: 'Rozpočet 2027' }), 'the result row Rozpočet 2027'), title: 'Rozpočet 2027', word: 'Návrh', opens: 'Rozpočet 2027', path: PV.rozpocet },
  { name: 'type_page_row', start: { route: 'type/osoba' }, ref: (p) => need(typeTable(p, 'Osoby').getByRole('row').filter({ hasText: 'Petr Dvořák' }), 'the type/osoba row Petr Dvořák'), title: 'Petr Dvořák', word: 'Vede', opens: 'Petr Dvořák', path: PV.petr },
  { name: 'task_card_title', start: { route: 'tasks' }, ref: (p) => need(taskCard(p, 'Zavolat Janě').getByRole('link', { name: 'Zavolat Janě', exact: true }), 'the task card title'), title: 'Zavolat Janě', word: 'Domluvit', opens: 'Zavolat Janě', path: PV.ukol },
];

for (const s of SURFACES) {
  test(`fr_lnk_11_ac20_click_mode_a_click_on_the_body_opens_from_${s.name}`, async ({ page }) => {
    const core = await startPreviews(page, { ...s.start, mode: 'click' });
    if (s.go) await s.go(page);
    await (await s.ref(page)).click();
    const d = await needPreview(page, s.title, `${s.name}: a click previews`);
    const n0 = await mark(core);
    await clickAtWord(page, anyContent(d).or(d.getByRole('region', { name: 'Properties', exact: true })), s.word, `${s.name}: the body`);
    await mustBeOn(page, nfc(s.opens), `${s.name}: a click on the body opens ${s.path}`, 5000);
    assert.deepEqual(await navsSince(core, n0), [nfc(s.path)], `${s.name}: one nav_opened`);
    assert.equal(await previewCount(page), 0, `${s.name}: no popover left`);
  });
}

test('fr_lnk_11_ac20_click_mode_a_click_on_the_source_previews_body_opens_porada_at_the_embed', async ({ page }) => {
  const core = await startPreviews(page, { route: 'tasks', mode: 'click' });
  const src = () => need(taskCard(page, 'Zavolat Janě').locator('[data-link-kind]').filter({ hasText: 'Porada 2026-10-27' }), 'the source chip Porada 2026-10-27');
  // The comparison: Open on the source preview (FR-TSK-08 AC-5).
  await (await src()).click();
  let d = await needPreview(page, 'Porada 2026-10-27', 'the source preview');
  await (await need(openBtn(d, 'Porada 2026-10-27'), 'button "Open Porada 2026-10-27"')).click();
  await mustBeOn(page, 'Porada 2026-10-27', 'Open opens Porada', 5000);
  const selOpen = await eventually(() => selectedBlocks(page), (x) => x.length > 0, 2000);
  await back(page, 'Tasks');
  await (await src()).click();
  d = await needPreview(page, 'Porada 2026-10-27', 'the source preview again');
  const n0 = await mark(core);
  // D-1195: a word that is in view (the source preview starts at the task's embed, D-939).
  await clickAtWord(page, anyContent(d), 'Konec', 'the source preview\'s body');
  await mustBeOn(page, 'Porada 2026-10-27', 'a click on the body opens note/Pages/Porada 2026-10-27.md', 5000);
  assert.deepEqual(await navsSince(core, n0), [nfc(PV.porada)], 'one nav_opened');
  const sel = await eventually(() => selectedBlocks(page), (x) => x.length > 0, 2000);
  assert.ok(selOpen.length === 1, `Open selects the embed (${JSON.stringify(selOpen)})`);
  assert.deepEqual(sel, selOpen, '![[Zavolat Janě]] is selected, as its Open does (FR-TSK-08 AC-5)');
  const emb = await need(editorBody(page).locator(':scope > *').nth(sel[0] - 1), 'the selected embed');
  const top = await eventually(() => topInScroller(emb), (t) => t !== null && Math.abs(t) <= 8, 2000);
  assert.ok(top !== null && Math.abs(top) <= 8, `![[Zavolat Janě]] at the top (± 8 px): ${top}`);
});

test('fr_lnk_11_ac20_the_keyboard_in_the_popover_is_unchanged', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, mode: 'click' });
  let d = await clickPreview(page);
  assert.equal((await focusInfo(page)).inPreview, true, 'a click-mode preview takes the focus');
  const art = content(d, 'Rozpočet 2027');
  const s0 = (await scrollState(art))?.top ?? -1;
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('PageDown');
  await sleep(200);
  const s1 = (await scrollState(art))?.top ?? -1;
  assert.ok(s1 > s0, `↓ and Page Down scroll the body (${s0} → ${s1})`);
  const n0 = await mark(core);
  for (let i = 0; i < 4 && (await previewCount(page)) === 1; i++) { await page.keyboard.press('Tab'); await sleep(80); }
  assert.equal(await mainName(page), 'Odkazy', 'Tab walks the controls and focusing the body with Tab opens nothing');
  assert.deepEqual(await navsSince(core, n0), [], 'no nav_opened from Tab');
  if ((await previewCount(page)) === 0) d = await clickPreview(page);
  await d.focus();
  await page.keyboard.press('Enter');
  await openedRozpocet(page, core, n0, '⏎ with the focus in the popover');
  await back(page, 'Odkazy');
  d = await clickPreview(page);
  const n1 = await mark(core);
  await page.keyboard.press('Meta+Enter');
  await openedRozpocet(page, core, n1, '⌘↩ with the focus in the popover');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-11 AC-21

/** Pauses the installed clock 1 s ahead, so the page's timers advance only by `page.clock.runFor` (slice P's rule). */
async function pauseClock(page: Page) {
  const t = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(t + 1000));
}
async function tick(page: Page, ms: number) {
  await page.clock.runFor(ms);
  await sleep(120);
}
async function hoverRozpocet(page: Page): Promise<Locator> {
  const b = (await (await rozpocetChip(page)).boundingBox())!;
  await page.mouse.move(b.x + 4, b.y + b.height / 2);
  await page.mouse.move(b.x + 6, b.y + b.height / 2);
  await tick(page, 450);
  return needPreview(page, 'Rozpočet 2027', 'hover on Rozpočet 2027 (400 ms stored)');
}

test('fr_lnk_11_ac21_links_inside_a_preview_in_hover_mode', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, mode: 'hover', hoverDelay: 400, install: true });
  await pauseClock(page);
  const f0 = await focusInfo(page);
  let d = await hoverRozpocet(page);
  const b0 = (await d.boundingBox())!;
  const art = content(d, 'Rozpočet 2027');
  const t = await wordPoint(art, 'Návrh');
  assert.ok(t, 'the body text');
  await page.mouse.move(t!.x, t!.y, { steps: 8 });
  await tick(page, 2000);
  assert.equal(await previewCount(page), 1, 'resting on body text keeps the preview');
  assert.equal(await anyBack(d).count(), 0, 'resting on body text outside links replaces nothing');
  // Leaving the chip before the delay keeps Rozpočet.
  const jana = await need(chipNamed(art, 'Jana Nováková'), 'the chip Jana Nováková inside');
  let jb = (await jana.boundingBox())!;
  await page.mouse.move(jb.x + 4, jb.y + jb.height / 2);
  await tick(page, 200);
  await page.mouse.move(t!.x, t!.y);
  await tick(page, 600);
  assert.equal(await anyBack(d).count(), 0, 'leaving the chip before the delay keeps Rozpočet');
  // Resting on it replaces the content 400 ms after the pointer stopped, not before.
  const e0 = await mark(core);
  jb = (await jana.boundingBox())!;
  await page.mouse.move(jb.x + 4, jb.y + jb.height / 2);
  await page.mouse.move(jb.x + 6, jb.y + jb.height / 2);
  await tick(page, 340);
  assert.ok(await previews(page).first().getByRole('button', { name: /^Back to / }).count() === 0, 'not replaced before the delay (350 ms)');
  assert.ok(!(await embedLoadsSince(core, e0)).some((p) => p.includes(nfc(PV.jana))), 'no embed_load for Jana before the delay ends');
  await tick(page, 110);
  const dj = await needPreview(page, 'Jana Nováková', 'resting on the chip inside replaces the content 400 ms (± 50 ms) after the pointer stopped (D-1170)');
  const b1 = (await dj.boundingBox())!;
  assert.ok(Math.abs(b1.x - b0.x) <= 1 && Math.abs(b1.y - b0.y) <= 1 && Math.abs(b1.width - b0.width) <= 1, `the same dialog place and width (${JSON.stringify([b0, b1])})`);
  const backB = await need(backBtn(dj, 'Rozpočet 2027'), 'button "Back to Rozpočet 2027"');
  assert.deepEqual(await focusInfo(page), f0, 'the focus never moves (FR-LNK-12 AC-2)');
  // Resting on Back does nothing; a click restores Rozpočet.
  const bb = (await backB.boundingBox())!;
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 3 });
  await tick(page, 1000);
  await needPreview(page, 'Jana Nováková', 'resting on Back to Rozpočet 2027 does nothing');
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await sleep(100);
  d = await needPreview(page, 'Rozpočet 2027', 'a click on Back restores Rozpočet');
  // It hides 300 ms after the pointer left it and the reference, whatever its history.
  await page.mouse.move(1430, 890);
  await tick(page, 230);
  assert.equal(await previewCount(page), 1, 'still shown 230 ms after leaving');
  await tick(page, 120);
  assert.equal(await previewCount(page), 0, 'hidden 300 ms (± 50 ms) after the pointer left the popover and the reference (D-917)');
  // A click on the chip inside opens Jana, with no replacement first.
  d = await hoverRozpocet(page);
  const jana2 = await need(chipNamed(content(d, 'Rozpočet 2027'), 'Jana Nováková'), 'the chip Jana Nováková inside again');
  const j2 = (await jana2.boundingBox())!;
  await page.mouse.move(j2.x + 4, j2.y + j2.height / 2, { steps: 6 });
  const n0 = await mark(core);
  await page.mouse.click(j2.x + 4, j2.y + j2.height / 2);
  await page.clock.resume(); // the open runs on the page's own timers and frames
  await mustBeOn(page, 'Jana Nováková', 'a click on the chip inside opens note/Osoby/Jana Nováková.md (D-1170)', 5000);
  assert.deepEqual(await navsSince(core, n0), [nfc(PV.jana)], 'one nav_opened');
  assert.equal(await previewCount(page), 0, 'no popover (no replacement first)');
});

test('fr_lnk_11_ac21_a_broken_link_inside_in_hover_mode', async ({ page }) => {
  const vault = previewsVault((f) => { f[nfc(PV.petr)] = swap(f[nfc(PV.petr)], 'Vede tým nákupu.', 'Vede tým nákupu. Viz [[Neexistuje]].'); });
  await startPreviews(page, { at: PV.odkazy, mode: 'hover', hoverDelay: 400, vault });
  const b = (await (await needOdkazyLink(page, 'Osoby', 1)).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 });
  const d = await needPreview(page, 'Petr Dvořák', 'hover on Petr Dvořák', 2500);
  const broken = await need(chipNamed(anyContent(d), 'Neexistuje'), 'the broken chip inside');
  const kb = (await broken.boundingBox())!;
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2, { steps: 8 });
  await sleep(1200);
  assert.equal(await createOffer(page).count(), 0, 'resting on a broken link inside offers nothing');
  await needPreview(page, 'Petr Dvořák', 'and replaces nothing');
  await page.mouse.click(kb.x + kb.width / 2, kb.y + kb.height / 2);
  await need(createOffer(page), 'a click on it opens the Create offer');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-11 AC-22

test('fr_lnk_11_ac22_links_inside_in_click_mode_are_unchanged', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, mode: 'click' });
  let d = await clickPreview(page);
  const jana = await need(chipNamed(content(d, 'Rozpočet 2027'), 'Jana Nováková'), 'the chip Jana Nováková inside');
  const jb = (await jana.boundingBox())!;
  const e0 = await mark(core);
  await page.mouse.move(jb.x + jb.width / 2, jb.y + jb.height / 2, { steps: 6 });
  await sleep(2000);
  assert.equal(await anyBack(d).count(), 0, 'resting 2 s on the chip inside replaces nothing');
  assert.ok(!(await embedLoadsSince(core, e0)).some((p) => p.includes(nfc(PV.jana))), 'and sends no embed_load for Jana');
  await jana.click();
  const dj = await needPreview(page, 'Jana Nováková', 'a click replaces the content (FR-LNK-11 AC-10)');
  await (await need(backBtn(dj, 'Rozpočet 2027'), 'Back to Rozpočet 2027')).click();
  d = await needPreview(page, 'Rozpočet 2027', 'Back');
  const n0 = await mark(core);
  await (await need(chipNamed(content(d, 'Rozpočet 2027'), 'Jana Nováková'), 'the chip again')).dblclick();
  await mustBeOn(page, 'Jana Nováková', 'a double-click opens Jana', 5000);
  assert.deepEqual(await navsSince(core, n0), [nfc(PV.jana)], 'one nav_opened');
});

test('fr_lnk_11_ac22_off_a_click_on_a_link_inside_opens_resting_does_nothing', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, mode: 'off', readView: true });
  await (await rozpocetChip(page)).focus();
  await page.keyboard.press('Alt+Space');
  const d = await needPreview(page, 'Rozpočet 2027', 'Off: ⌥Space');
  const jana = await need(chipNamed(content(d, 'Rozpočet 2027'), 'Jana Nováková'), 'the chip Jana Nováková inside');
  const jb = (await jana.boundingBox())!;
  await page.mouse.move(jb.x + jb.width / 2, jb.y + jb.height / 2, { steps: 6 });
  await sleep(1500);
  assert.equal(await anyBack(d).count(), 0, 'Off: resting on a link inside does nothing (D-1176)');
  const n0 = await mark(core);
  await jana.click();
  await mustBeOn(page, 'Jana Nováková', 'Off: a click on a link inside opens its target (D-1176)', 5000);
  assert.deepEqual(await navsSince(core, n0), [nfc(PV.jana)], 'one nav_opened');
});

for (const mode of ['click', 'hover', 'off'] as const) {
  test(`fr_lnk_11_ac22_enter_and_alt_space_on_a_focused_link_inside_${mode}`, async ({ page }) => {
    const core = await startPreviews(page, { at: PV.odkazy, mode, hoverDelay: mode === 'hover' ? 400 : undefined, readView: true });
    const show = async () => {
      const chip = await rozpocetChip(page);
      // D-1184: a hover preview never takes the focus, so in hover mode the keyboard reaches its links after ⌥Space on
      // the reference (a focused preview, D-942), as in Off.
      if (mode === 'click') { await chip.click(); }
      else { await chip.focus(); await page.keyboard.press('Alt+Space'); }
      const d = await needPreview(page, 'Rozpočet 2027', `${mode}: the preview of Rozpočet`, 2500);
      const jana = await need(chipNamed(content(d, 'Rozpočet 2027'), 'Jana Nováková'), `${mode}: the chip Jana Nováková inside`);
      await jana.focus();
      return d;
    };
    await show();
    await page.keyboard.press('Alt+Space');
    const dj = await needPreview(page, 'Jana Nováková', `${mode}: ⌥Space on the focused link inside replaces in place (D-1176)`);
    await need(backBtn(dj, 'Rozpočet 2027'), `${mode}: with Back to Rozpočet 2027`);
    await page.keyboard.press('Escape');
    await needClosed(page, `${mode}: Esc`);
    await show();
    const n0 = await mark(core);
    await page.keyboard.press('Enter');
    if (mode === 'click') {
      const d2 = await needPreview(page, 'Jana Nováková', 'click: ⏎ on a focused link inside replaces (FR-LNK-11 AC-7)');
      await need(backBtn(d2, 'Rozpočet 2027'), 'click: with Back to Rozpočet 2027');
      assert.deepEqual(await navsSince(core, n0), [], 'click: no nav_opened');
    } else {
      await mustBeOn(page, 'Jana Nováková', `${mode}: ⏎ on a focused link inside opens its target (D-1176)`, 5000);
      assert.deepEqual(await navsSince(core, n0), [nfc(PV.jana)], `${mode}: one nav_opened`);
    }
  });
}

void previewPath; void tagRoute;
