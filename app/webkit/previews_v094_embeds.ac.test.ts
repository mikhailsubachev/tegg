// v0.94 feedback (D-1166, D-1175), L5 (WebKit + fake core): embeds don't preview. docs/acceptance/previews.md part three,
// R130, FR-LNK-09 AC-8 (a card opens on a click in every mode), AC-9 (a link-mode embed opens), AC-10 (a full or section
// embed's header opens; its buttons and body keep their jobs), AC-11 (hover does nothing on an embed; a link inside a
// full embed still previews), AC-12 (⌥Space and the `Link` menu still preview on request), AC-13 (no mode description on
// embeds, D-1175). D-1164's test rule: each test names the mode it stores; "nothing stored" leaves the UI state without a
// `preview` key (the new default, hover with 1,000 ms). Interface docs/contracts/v1-previews.md §3 (as previews.md part
// three changes it), ms4-embeds §4 (`embed_load`). Written from the ACs and the contracts only (D-61); every lookup goes
// through `need`/`must` and node:assert (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mustCaret } from './embeds-helpers';
import { linkMenu, rightClick } from './previews-editor-helpers';
import {
  PV, ZONE, anyContent, back, chipNamed, description, editorBody, embedLoadsSince, eventually, fileWhen, focusSettled, frame, linkEmbed, main, mainName,
  mainScrollTop, mark, mustBeOn, navsSince, need, needClosed, needPreview, nfc, previewCount, previewNames, readArticle, selectedBlocks, sleep,
  startPreviews, topEmbed, topInScroller, writesSince, type FakeCoreHandle, type PreviewMode,
} from './previews-helpers';

test.use({ timezoneId: ZONE });

type M = { tag: string; mode: PreviewMode | null; hoverDelay?: number };
/** AC-8's modes: nothing stored (hover, the new default), then `click` and `off` stored. */
const AC8_MODES: M[] = [{ tag: 'nothing_stored', mode: null }, { tag: 'click', mode: 'click' }, { tag: 'off', mode: 'off' }];
/** "Every mode" with hover stored too. */
const ALL_MODES: M[] = [...AC8_MODES, { tag: 'hover', mode: 'hover', hoverDelay: 400 }];
const opts = (m: M) => ({ ...(m.mode ? { mode: m.mode } : {}), ...(m.hoverDelay ? { hoverDelay: m.hoverDelay } : {}) });

/** Records every `Preview: …` dialog that appears in the document from now on (the press-to-open window of AC-8). */
async function watchPreviews(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__pvSeen = [] as string[];
    const nameOf = (d: Element) => {
      const l = d.getAttribute('aria-label');
      if (l) return l;
      return (d.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    };
    const scan = () => {
      for (const d of document.querySelectorAll('[role="dialog"]')) {
        const n = nameOf(d).replace(/\s+/g, ' ').trim();
        if (/^⟦?Preview: /.test(n) && !w.__pvSeen.includes(n)) w.__pvSeen.push(n);
      }
    };
    w.__pvObs?.disconnect();
    w.__pvObs = new MutationObserver(scan);
    w.__pvObs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'role'] });
    scan();
  });
}
const seenPreviews = (page: Page): Promise<string[]> => page.evaluate(() => [...((window as any).__pvSeen ?? [])]);

const janaCard = (page: Page) => need(frame(editorBody(page), 'Jana Nováková'), 'the card embed "Embedded: Jana Nováková"');
const petrChip = (page: Page, scope?: Locator) => need(linkEmbed(scope ?? editorBody(page), 'Petr Dvořák'), 'the link-mode embed ![[Petr Dvořák|link]]');
const fullEmbed = (page: Page) => need(topEmbed(editorBody(page), 0), 'the full embed ![[Rozpočet 2027]]');
const sectionEmbed = (page: Page) => need(topEmbed(editorBody(page), 3), 'the section embed ![[Rozpočet 2027#Rozsah]]');
const headerOf = (embed: Locator) => embed.locator(':scope > *').first();

/** A point on the card outside its strip values (its top-right corner area, as slice P's card tests), relative to the
 *  card. Issue 112: the clicks go through the locator with this position, so Playwright takes the card's place at the
 *  moment of the click; a point measured earlier was stale once Back's scroll restore or an embed above moved the card. */
async function cardPoint(card: Locator) {
  await card.scrollIntoViewIfNeeded();
  const b = (await card.boundingBox())!;
  return { x: b.width - 12, y: 12 };
}
/** Asserts the open of `title` (`path`): the centre pane, exactly one `nav_opened` since `n0`, no preview seen. */
async function opened(page: Page, core: FakeCoreHandle, n0: number, title: string, path: string, how: string) {
  await mustBeOn(page, nfc(title), `${how}: opens ${path}`, 5000);
  assert.deepEqual(await navsSince(core, n0), [nfc(path)], `${how}: exactly one nav_opened (${title})`);
  assert.deepEqual(await seenPreviews(page), [], `${how}: no dialog "Preview: …" at any time from the press to the open (D-1166)`);
  assert.equal(await previewCount(page), 0, `${how}: no popover after the open`);
}

/** Puts the editor caret at the end of the first host paragraph and walks ↓ until host block `n` is selected as a block
 *  (embeds.md FR-EMB-02 AC-14's keyboard selection, as slice P's FR-LNK-09 AC-7 test). */
async function selectBlock(page: Page, n: number, what: string) {
  const first = editorBody(page).locator(':scope > *').first();
  await focusSettled(page); // issue 112: after Esc gave the focus back to the editor, the click below keeps its caret
  await first.scrollIntoViewIfNeeded();
  const fb = (await first.boundingBox())!;
  await page.mouse.click(fb.x + fb.width - 4, fb.y + fb.height / 2);
  await page.keyboard.press('End');
  await mustCaret(first, 'Před vloženími.', `${what}: the end of "Před vloženími."`);
  await sleep(100);
  // ↓ walks the blocks; inside a full embed's editable body (FR-EMB-03) Esc selects the embed as a block, as slice P's
  // FR-LNK-09 AC-7 test does when ↓ selected nothing.
  for (let i = 0; i < 12 && !(await selectedBlocks(page)).includes(n); i++) {
    await page.keyboard.press('ArrowDown');
    await sleep(100);
    if ((await selectedBlocks(page)).length === 0) { await page.keyboard.press('Escape'); await sleep(100); }
  }
  assert.deepEqual(await selectedBlocks(page), [n], `${what}: host block ${n} is selected as a block`);
}

/** Every accessible description inside `loc` (itself included) that names a preview mode (`link.hint.*`). */
async function modeDescriptions(loc: Locator): Promise<string[]> {
  return loc.first().evaluate((root) => {
    const out: string[] = [];
    for (const e of [root, ...root.querySelectorAll('*')] as HTMLElement[]) {
      const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      const d = (e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
      if (/to preview|to open/i.test(d)) out.push(d);
    }
    return out;
  });
}

// ------------------------------------------------------------------------------------------------ FR-LNK-09 AC-8

for (const m of AC8_MODES) {
  test(`fr_lnk_09_ac8_a_card_opens_on_a_click_in_every_mode_${m.tag}`, async ({ page }) => {
    const core = await startPreviews(page, { at: PV.vlozeni, ...opts(m) });
    const tag = `${m.tag}: Jana's card`;
    let card = await janaCard(page);
    let p = await cardPoint(card);
    const top0 = await mainScrollTop(page);
    await watchPreviews(page);
    let n0 = await mark(core);
    await card.click({ position: p });
    await opened(page, core, n0, 'Jana Nováková', PV.jana, `${tag}: a click`);
    await back(page, 'Vložení', `${tag}: Back after the click (one history entry)`);
    const top1 = await eventually(() => mainScrollTop(page), (t) => Math.abs(t - top0) <= 24, 2000);
    assert.ok(Math.abs(top1 - top0) <= 24, `${tag}: Back returns to Vložení at its scroll position ± one line (${top0} → ${top1})`);

    card = await janaCard(page);
    p = await cardPoint(card);
    await watchPreviews(page);
    n0 = await mark(core);
    await card.dblclick({ position: p });
    await opened(page, core, n0, 'Jana Nováková', PV.jana, `${tag}: a double-click (one open)`);
    await back(page, 'Vložení', `${tag}: Back after the double-click`);

    card = await janaCard(page);
    await card.focus();
    await watchPreviews(page);
    n0 = await mark(core);
    await page.keyboard.press('Enter');
    await opened(page, core, n0, 'Jana Nováková', PV.jana, `${tag}: ⏎ on the focused card`);
    await back(page, 'Vložení', `${tag}: Back after ⏎`);

    card = await janaCard(page);
    p = await cardPoint(card);
    await watchPreviews(page);
    n0 = await mark(core);
    await card.click({ position: p, modifiers: ['Meta'] });
    await opened(page, core, n0, 'Jana Nováková', PV.jana, `${tag}: ⌘-click`);
    assert.deepEqual(await writesSince(core, 0), [], `${tag}: nothing is written`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-LNK-09 AC-9

for (const m of AC8_MODES) {
  test(`fr_lnk_09_ac9_a_link_mode_embed_opens_on_a_click_and_cmd_enter_${m.tag}`, async ({ page }) => {
    const core = await startPreviews(page, { at: PV.vlozeni, ...opts(m) });
    const tag = `${m.tag}: Petr's link-mode embed`;
    await watchPreviews(page);
    let n0 = await mark(core);
    await (await petrChip(page)).click();
    await opened(page, core, n0, 'Petr Dvořák', PV.petr, `${tag}: a click`);
    await back(page, 'Vložení', `${tag}: Back`);
    const chip = await petrChip(page);
    await chip.focus();
    await watchPreviews(page);
    n0 = await mark(core);
    await page.keyboard.press('Meta+Enter');
    await opened(page, core, n0, 'Petr Dvořák', PV.petr, `${tag}: ⌘↩ with the focus on it`);
    assert.deepEqual(await writesSince(core, 0), [], `${tag}: nothing is written`);
  });

  test(`fr_lnk_09_ac9_a_link_mode_embed_opens_on_enter_in_the_read_view_${m.tag}`, async ({ page }) => {
    const core = await startPreviews(page, { at: PV.vlozeni, readView: true, ...opts(m) });
    const tag = `${m.tag}: Petr's link-mode embed in the read view`;
    const chip = await petrChip(page, readArticle(page, 'Vložení'));
    await chip.focus();
    await watchPreviews(page);
    const n0 = await mark(core);
    await page.keyboard.press('Enter');
    await opened(page, core, n0, 'Petr Dvořák', PV.petr, `${tag}: ⏎ with the focus on it`);
    await back(page, 'Vložení', `${tag}: Back`);
    await watchPreviews(page);
    const n1 = await mark(core);
    await (await petrChip(page, readArticle(page, 'Vložení'))).click();
    await opened(page, core, n1, 'Petr Dvořák', PV.petr, `${tag}: a click`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-LNK-09 AC-10

for (const m of AC8_MODES) {
  test(`fr_lnk_09_ac10_a_full_or_section_embeds_header_opens_${m.tag}`, async ({ page }) => {
    const core = await startPreviews(page, { at: PV.vlozeni, ...opts(m) });
    const tag = `${m.tag}: the full embed of Rozpočet`;
    // The header title.
    await watchPreviews(page);
    let n0 = await mark(core);
    await (await need(headerOf(await fullEmbed(page)).getByText('Rozpočet 2027', { exact: true }), `${tag}: its header title`)).click();
    await opened(page, core, n0, 'Rozpočet 2027', PV.rozpocet, `${tag}: a click on the header title`);
    await back(page, 'Vložení', `${tag}: Back`);
    // Its type icon.
    await watchPreviews(page);
    n0 = await mark(core);
    await (await need(headerOf(await fullEmbed(page)).locator('[data-icon]'), `${tag}: its type icon`)).click();
    await opened(page, core, n0, 'Rozpočet 2027', PV.rozpocet, `${tag}: a click on the type icon`);
    await back(page, 'Vložení', `${tag}: Back`);
    // The section embed's header title opens #Rozsah scrolled.
    await watchPreviews(page);
    n0 = await mark(core);
    await (await need(headerOf(await sectionEmbed(page)).getByText(/Rozpočet 2027/), `${m.tag}: the section embed's header title`)).click();
    await opened(page, core, n0, 'Rozpočet 2027', PV.rozpocet, `${m.tag}: a click on the section embed's header title`);
    const hd = await need(main(page).locator('h2, h3, h4').filter({ hasText: /^\s*Rozsah\s*$/ }), `${m.tag}: the heading Rozsah`);
    const top = await eventually(() => topInScroller(hd), (t) => t !== null && Math.abs(t - 24) <= 8, 2000);
    assert.ok(top !== null && Math.abs(top - 24) <= 8, `${m.tag}: note/Pages/Rozpočet 2027.md#Rozsah with Rozsah 24 px below the top of the centre pane (± 8 px, D-1625, D-1659): ${top}`);
    await back(page, 'Vložení', `${m.tag}: Back`);
    // Display as and the body keep their jobs; Open opens.
    const f = await fullEmbed(page);
    await (await need(f.getByRole('button', { name: 'Display as', exact: true }), `${tag}: button "Display as"`)).click();
    await need(page.getByRole('menu', { name: 'Display as', exact: true }), `${tag}: the Display as menu opens`);
    await page.keyboard.press('Escape');
    await watchPreviews(page);
    const n1 = await mark(core);
    const body = await need(f.getByText('Návrh rozpočtu na rok 2027 pro celý tým.'), `${tag}: the body text`);
    await body.click();
    await sleep(500);
    assert.equal(await mainName(page), 'Vložení', `${tag}: a click in the body doesn't navigate (FR-EMB-03)`);
    assert.deepEqual(await navsSince(core, n1), [], `${tag}: no nav_opened for the body click`);
    assert.deepEqual(await seenPreviews(page), [], `${tag}: and no preview`);
    const inEmbed = await f.evaluate((e) => { const s = getSelection(); return !!s && !!s.anchorNode && e.contains(s.anchorNode); });
    assert.ok(inEmbed, `${tag}: the click places the caret in the embed's body`);
    const n2 = await mark(core);
    await (await need(f.getByRole('button', { name: 'Open Rozpočet 2027', exact: true }), `${tag}: button "Open Rozpočet 2027"`)).click();
    await mustBeOn(page, 'Rozpočet 2027', `${tag}: Open Rozpočet 2027 opens the note (embeds.md FR-EMB-02 AC-9)`, 5000);
    assert.deepEqual(await navsSince(core, n2), [nfc(PV.rozpocet)], `${tag}: one nav_opened for Open`);
    assert.deepEqual(await writesSince(core, 0), [], `${m.tag}: nothing is written`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-LNK-09 AC-11

const AC11_MODES: M[] = [{ tag: 'nothing_stored', mode: null }, { tag: 'hover_400', mode: 'hover', hoverDelay: 400 }];

/** Rests the pointer on `loc`'s centre for `ms`, then moves it to the window's bottom-right corner. */
async function rest(page: Page, loc: Locator, ms: number) {
  await loc.scrollIntoViewIfNeeded();
  const b = (await loc.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 });
  await sleep(ms);
}
async function away(page: Page) {
  await page.mouse.move(1430, 890);
  await sleep(450);
}

for (const m of AC11_MODES) {
  test(`fr_lnk_09_ac11_hover_does_nothing_on_an_embed_${m.tag}`, async ({ page }) => {
    const core = await startPreviews(page, { at: PV.vlozeni, ...opts(m) });
    await need(frame(editorBody(page), 'Jana Nováková'), 'the card (the page\'s own embeds loaded)');
    await sleep(600);
    const targets: [string, () => Promise<Locator>][] = [
      ['Jana\'s card', async () => janaCard(page)],
      ['Petr\'s link-mode chip', async () => petrChip(page)],
      ['the full embed\'s header title', async () => need(headerOf(await fullEmbed(page)).getByText('Rozpočet 2027', { exact: true }), 'the full embed\'s header title')],
      ['the section embed\'s header title', async () => need(headerOf(await sectionEmbed(page)).getByText(/Rozpočet 2027/), 'the section embed\'s header title')],
    ];
    for (const [what, get] of targets) {
      const loc = await get();
      await watchPreviews(page);
      const e0 = await mark(core);
      await rest(page, loc, 2000);
      assert.deepEqual(await seenPreviews(page), [], `${m.tag}: resting 2 s on ${what} shows no popover`);
      assert.equal(await page.locator('[data-hover-ring]').count(), 0, `${m.tag}: and no hover ring`);
      assert.deepEqual(await embedLoadsSince(core, e0), [], `${m.tag}: and sends no embed_load`);
      assert.equal(await mainName(page), 'Vložení', `${m.tag}: and opens nothing`);
      await away(page);
    }
    // A link inside the full embed's body is a link, not an embed (FR-LNK-13 AC-8).
    const jana = await need(chipNamed(await fullEmbed(page), 'Jana Nováková'), 'the chip Jana Nováková inside the full embed\'s body');
    await jana.scrollIntoViewIfNeeded();
    const b = (await jana.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 });
    await needPreview(page, 'Jana Nováková', `${m.tag}: resting on the Jana Nováková chip inside the full embed still previews after the delay`, 2500);
  });

  test(`fr_lnk_09_ac11_a_task_cards_title_rest_does_nothing_and_a_click_opens_${m.tag}`, async ({ page }) => {
    const core = await startPreviews(page, { at: PV.porada, ...opts(m) });
    const card = await need(main(page).locator('[data-embed-mode]').filter({ hasText: 'Zavolat Janě' }), 'the task card ![[Zavolat Janě]] in Porada');
    const title = () => need(card.getByRole('link', { name: 'Zavolat Janě', exact: true }).or(card.getByText('Zavolat Janě', { exact: true })), 'the task card\'s title');
    await sleep(600);
    await watchPreviews(page);
    const e0 = await mark(core);
    await rest(page, await title(), 2000);
    assert.deepEqual(await seenPreviews(page), [], `${m.tag}: resting on the task card's title shows nothing`);
    assert.deepEqual(await embedLoadsSince(core, e0), [], `${m.tag}: no embed_load`);
    await away(page);
    await watchPreviews(page);
    const n0 = await mark(core);
    await (await title()).click();
    await opened(page, core, n0, 'Zavolat Janě', PV.ukol, `${m.tag}: a click on the task card's title`);
    await back(page, 'Porada 2026-10-27', `${m.tag}: Back`);
    const box = await need(main(page).locator('[data-embed-mode]').filter({ hasText: 'Zavolat Janě' }).getByRole('checkbox').first(), 'the task card\'s checkbox');
    const n1 = await mark(core);
    await box.click();
    const t = await fileWhen(core, PV.ukol, (x) => !!x && !x.includes('status: To do'), 3000);
    assert.ok(t && !t.includes('status: To do'), `${m.tag}: the checkbox keeps its job (conversion.md FR-CNV-05)`);
    assert.equal(await mainName(page), 'Porada 2026-10-27', `${m.tag}: and opens nothing`);
    assert.deepEqual(await navsSince(core, n1), [], `${m.tag}: no nav_opened`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-LNK-09 AC-12

for (const m of ALL_MODES) {
  test(`fr_lnk_09_ac12_still_previewed_on_request_${m.tag}`, async ({ page }) => {
    const core = await startPreviews(page, { at: PV.vlozeni, ...opts(m) });
    // Jana's card selected as a block: ⌥Space previews it with the focus in it; Esc selects the card again (AC-7).
    await janaCard(page);
    await selectBlock(page, 3, `${m.tag}: Jana's card`);
    await page.keyboard.press('Alt+Space');
    const dj = await needPreview(page, 'Jana Nováková', `${m.tag}: ⌥Space on the selected card`);
    assert.equal(await dj.evaluate((d) => d.contains(document.activeElement)), true, `${m.tag}: the focus is in the preview`);
    await need(dj.getByRole('region', { name: 'Properties', exact: true }), `${m.tag}: Jana's R105 content (all attributes; empty body)`);
    await page.keyboard.press('Escape');
    await needClosed(page, `${m.tag}: Esc`);
    assert.deepEqual(await selectedBlocks(page), [3], `${m.tag}: Esc selects the card again`);
    // Petr's link-mode chip focused: ⌥Space; the right-click menu's Show preview.
    const chip = await petrChip(page);
    await chip.focus();
    await page.keyboard.press('Alt+Space');
    const dp = await needPreview(page, 'Petr Dvořák', `${m.tag}: ⌥Space with the focus on Petr's link-mode chip`);
    assert.equal((await anyContent(dp).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim(), 'Vede tým nákupu.', `${m.tag}: Petr's body`);
    await page.keyboard.press('Escape');
    await needClosed(page, `${m.tag}: Esc`);
    // The full embed and the section embed selected as blocks.
    await selectBlock(page, 2, `${m.tag}: the full embed`);
    await page.keyboard.press('Alt+Space');
    await needPreview(page, 'Rozpočet 2027', `${m.tag}: ⌥Space on the selected full embed`);
    await page.keyboard.press('Escape');
    await needClosed(page, `${m.tag}: Esc`);
    await selectBlock(page, 5, `${m.tag}: the section embed`);
    await page.keyboard.press('Alt+Space');
    // The dialog's name may carry the heading (R102: the header title is `<title> › <heading>`, as slice P's section tests).
    const ds = await need(page.getByRole('dialog', { name: /^Preview: Rozpočet 2027( › Rozsah)?$/ }), `${m.tag}: ⌥Space on the selected section embed previews the section`);
    assert.equal((await ds.locator('header h2').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim(), 'Rozpočet 2027 › Rozsah', `${m.tag}: the section preview's title Rozpočet 2027 › Rozsah`);
    await page.keyboard.press('Escape');
    await needClosed(page, `${m.tag}: Esc`);
    // A click inside such a preview follows R129: it opens the previewed object.
    await selectBlock(page, 3, `${m.tag}: Jana's card again`);
    await page.keyboard.press('Alt+Space');
    const dj2 = await needPreview(page, 'Jana Nováková', `${m.tag}: ⌥Space again`);
    const n0 = await mark(core);
    await (await need(dj2.getByText('Analytička', { exact: true }), `${m.tag}: the Properties row value Analytička`)).click();
    await mustBeOn(page, 'Jana Nováková', `${m.tag}: a click inside the ⌥Space preview opens Jana (R129)`, 5000);
    assert.deepEqual(await navsSince(core, n0), [nfc(PV.jana)], `${m.tag}: one nav_opened`);
    await back(page, 'Vložení', `${m.tag}: Back`);
    // A right-click on Petr's chip in the editor: the Link menu, whose Show preview previews (FR-LNK-13 AC-5).
    await rightClick(page, await petrChip(page));
    const menu = await need(linkMenu(page), `${m.tag}: the Link menu on a right-click on Petr's chip`, 2000);
    await (await need(menu.getByRole('menuitem', { name: 'Show preview', exact: true }), `${m.tag}: menu item Show preview`)).click();
    await needPreview(page, 'Petr Dvořák', `${m.tag}: the Link menu's Show preview`);
    await page.keyboard.press('Escape');
  });
}

// ------------------------------------------------------------------------------------------------ FR-LNK-09 AC-13

for (const m of ALL_MODES) {
  test(`fr_lnk_09_ac13_what_an_embed_says_${m.tag}`, async ({ page }) => {
    await startPreviews(page, { at: PV.vlozeni, ...opts(m) });
    assert.deepEqual(await modeDescriptions(await janaCard(page)), [], `${m.tag}: Jana's card (and its title) carry no preview-mode description (D-1175)`);
    assert.equal(await description(await petrChip(page)), 'Embedded note', `${m.tag}: Petr's link-mode chip is described exactly "Embedded note"`);
    assert.deepEqual(await modeDescriptions(headerOf(await fullEmbed(page))), [], `${m.tag}: the full embed's header carries no preview-mode description`);
    const jana = await need(chipNamed(await fullEmbed(page), 'Jana Nováková'), 'the link chip Jana Nováková in the same note (inside the full embed\'s body)');
    const want = m.mode === 'off' ? '' : m.mode === 'click' ? 'Click to preview, double-click to open' : 'Hover to preview, click to open';
    assert.equal(await description(jana), want, `${m.tag}: a link chip in the same note keeps its mode description`);
  });
}

void previewNames;
