// Slice P (v1.0, object previews) L5: how the popover behaves. docs/acceptance/previews.md FR-LNK-11 AC-1 (the L5
// frame count), AC-2…AC-10, AC-12…AC-16 (AC-11 live updates: previews_live.ac.test.ts), FR-SYN-06 AC-37 (L5 write
// counts), FR-UX-05 AC-14 (the popover parts), NFR-OTH-02 AC-11 (the popover in the pseudo-locale); contract
// docs/contracts/v1-previews.md §1, §3.3, §8. Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  PV, ZONE, anyBack, anyContent, back, backBtn, backlinksPanel, callsSince, chipNamed, clickToPreview, closeBtn, content, createOffer, description,
  editorBody, embedLoadsSince, eventually, fileText, flat, focusInfo, focusInside, frame, header, isDisabled, linkEmbed, main, mainName, mainScrollTop,
  mark, mustBeOn, navsSince, need, needAnyPreview, needClosed, needNoPreview, needOdkazyLink, needPreview, nfc, noModified, openBtn, placementOf,
  previewCount, previewPath, previews, previewsVault, readArticle, resizeHandle, runCommand, scrollState, searchFor, sidebar, sleep, snapshot,
  startPreviews, swap, tagRoute, taskCard, tokenColour, topEmbed, typeTable, writesSince, type FakeCoreHandle,
} from './previews-helpers';
import { openNote, pseudoLocale } from './helpers';
import { axeContrast, colourLeaks } from './read-helpers';

test.use({ timezoneId: ZONE });

const rozpocetChip = (page: Page) => needOdkazyLink(page, 'Hlavní', 0, 'the chip Rozpočet 2027 in "Hlavní Rozpočet 2027."');
async function openRozpocet(page: Page, o: Parameters<typeof startPreviews>[1] = {}) {
  const core = await startPreviews(page, { at: PV.odkazy, ...o });
  const chip = await rozpocetChip(page);
  const dlg = await clickToPreview(page, chip, 'Rozpočet 2027', 'a click on Rozpočet 2027');
  return { core, chip, dlg };
}

/** Puts the editor caret directly after the chip of the paragraph `start` (paragraphs `<words> [[chip]].`). */
async function caretAfterChip(page: Page, start: string) {
  const p = await need(editorBody(page).locator('p').filter({ hasText: new RegExp(`^\\s*${start}`) }), `paragraph "${start}…"`);
  const b = (await p.boundingBox())!;
  await page.mouse.click(b.x + b.width - 1, b.y + b.height / 2);
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
}

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_lnk_11_ac1_preview_ready_within_two_animation_frames_of_the_click', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy });
  const chip = await rozpocetChip(page);
  await page.evaluate(() => {
    const w = window as any;
    w.__pvFrames = 0; w.__pvUp = -1; w.__pvReady = -1;
    const tick = () => { w.__pvFrames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    document.addEventListener('pointerup', () => { if (w.__pvUp < 0) w.__pvUp = w.__pvFrames; }, true);
    const inv = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any, o: unknown) => {
      if (cmd === 'perf_mark' && args?.mark === 'preview-ready' && w.__pvReady < 0) w.__pvReady = w.__pvFrames;
      return inv(cmd, args, o);
    };
  });
  const n0 = await mark(core);
  await chip.click();
  await needPreview(page, 'Rozpočet 2027', 'the click');
  const marks = await eventually(async () => (await callsSince(core, n0, 'perf_mark')).map((c) => (c.args as any)?.mark), (m) => m.includes('preview-ready'), 2000);
  assert.ok(marks.includes('preview-click'), `perf_mark preview-click on pointerup (v1-previews §8): ${JSON.stringify(marks)}`);
  assert.ok(marks.includes('preview-ready'), 'perf_mark preview-ready');
  const f = await page.evaluate(() => ({ up: (window as any).__pvUp, ready: (window as any).__pvReady }));
  assert.ok(f.up >= 0 && f.ready >= 0 && f.ready - f.up <= 2, `preview-ready within 2 animation frames of the click (frames ${JSON.stringify(f)})`);
});

// ------------------------------------------------------------------------------------------------ AC-2

test('fr_lnk_11_ac2_stays_open_until_a_click_outside_or_esc', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy });
  // An edit just before the click, so the note behind the popover autosaves while it is open.
  const p = await need(editorBody(page).locator('p').filter({ hasText: /^\s*Mapa/ }), 'paragraph "Mapa …"');
  const pb = (await p.boundingBox())!;
  await page.mouse.click(pb.x + pb.width - 2, pb.y + pb.height / 2);
  await page.keyboard.press('End');
  await page.keyboard.type(' Y');
  const dlg = await clickToPreview(page, await rozpocetChip(page), 'Rozpočet 2027', 'a click on Rozpočet 2027');
  await page.mouse.move(1300, 850);
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  const saved = await fileWhen(core, PV.odkazy, (t) => !!t && t.includes('Mapa [[Mapa]]. Y'), 4000);
  assert.ok(saved?.includes('Mapa [[Mapa]]. Y'), 'the note behind it autosaved');
  assert.equal(await previewCount(page), 1, 'pointer away, blur/focus and the autosave keep it open');
  const art = await need(content(dlg, 'Rozpočet 2027'), 'the body');
  const para = await need(art.getByText('Návrh rozpočtu na rok 2027 pro celý tým.'), 'the first paragraph');
  const b = (await para.boundingBox())!;
  await page.mouse.move(b.x + 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 80, b.y + b.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.mouse.click(b.x + 30, b.y + b.height / 2);
  const ab = (await art.boundingBox())!;
  await page.mouse.click(ab.x + ab.width - 3, ab.y + 20);
  assert.equal(await previewCount(page), 1, 'selecting text and clicks inside (text, scrollbar) keep it open');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  assert.equal((await focusInfo(page)).inBody, true, 'Esc returns the focus to the editor (the caret after the chip)');
  const d2 = await clickToPreview(page, await rozpocetChip(page), 'Rozpočet 2027', 'again');
  await (await need(closeBtn(d2), 'button "Close preview"')).click();
  await needClosed(page, 'Close preview');
  assert.equal((await focusInfo(page)).inBody, true, 'Close preview does the same as Esc (AP-806)');
  await clickToPreview(page, await rozpocetChip(page), 'Rozpočet 2027', 'again');
  await page.mouse.click(700, 860);
  await needClosed(page, 'a click outside closes it');
});

async function fileWhen(core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean, ms: number) {
  return eventually(() => fileText(core, path), ok, ms);
}

// ------------------------------------------------------------------------------------------------ AC-3

test('fr_lnk_11_ac3_the_body_is_the_only_scroll_container_and_scrolls_by_wheel_and_keys', async ({ page }) => {
  const vault = previewsVault((f) => { f[nfc(PV.odkazy)] += '\nDlouhá [[Dlouhá]].\n'; });
  const { dlg } = await openRozpocet(page, { vault });
  const scrollers = await dlg.evaluate((d) => [...d.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY)).map((e) => e.closest('article') ? 'article' : e.tagName.toLowerCase()));
  assert.deepEqual(scrollers, ['article'], 'the body is the popover\'s only scroll container');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  const d = await clickToPreview(page, await needOdkazyLink(page, 'Dlouhá'), 'Dlouhá', 'Dlouhá (a body taller than the popover)');
  const art = await need(anyContent(d), 'the body');
  const noteTop = await mainScrollTop(page);
  const ab = (await art.boundingBox())!;
  await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2);
  await page.mouse.wheel(0, 300);
  await sleep(200);
  const s1 = (await scrollState(art))!;
  assert.ok(s1 && s1.top > 0, `the wheel over the body scrolls it (${JSON.stringify(s1)})`);
  assert.equal(await mainScrollTop(page), noteTop, 'and not the note behind it');
  await d.focus();
  const at = async () => (await scrollState(art))!.top;
  await page.keyboard.press('Home'); await sleep(100);
  assert.equal(await at(), 0, 'Home: the top');
  await page.keyboard.press('ArrowDown'); await sleep(100);
  const line = await at();
  assert.ok(line > 0 && line < s1.client / 2, `↓ scrolls by a line (${line})`);
  await page.keyboard.press('ArrowUp'); await sleep(100);
  assert.equal(await at(), 0, '↑ back');
  await page.keyboard.press('Space'); await sleep(150);
  const pg = await at();
  assert.ok(pg >= s1.client * 0.7, `Space scrolls by a page (${pg} of ${s1.client})`);
  await page.keyboard.press('Shift+Space'); await sleep(150);
  assert.ok((await at()) < pg / 4, '⇧Space back by a page');
  await page.keyboard.press('PageDown'); await sleep(150);
  assert.ok((await at()) >= s1.client * 0.7, 'Page Down by a page');
  await page.keyboard.press('PageUp'); await sleep(150);
  assert.ok((await at()) < s1.client * 0.3, 'Page Up by a page');
  await page.keyboard.press('End'); await sleep(300);
  const e = (await scrollState(art))!;
  assert.ok(e.top + e.client >= e.height - 2, 'End: the end');
  const db = (await d.boundingBox())!;
  const hb = await header(d).boundingBox();
  const ob = await openBtn(d, 'Dlouhá').boundingBox();
  assert.ok(hb && hb.y >= db.y - 1 && ob && ob.y + ob.height <= db.y + db.height + 1, 'the header and footer stay in view');
});

// ------------------------------------------------------------------------------------------------ AC-4

test('fr_lnk_11_ac4_default_size_resize_by_drag_and_keys_and_the_remembered_size', async ({ page }) => {
  const { core, dlg } = await openRozpocet(page);
  let b = (await dlg.boundingBox())!;
  assert.ok(Math.abs(b.width - 380) <= 1, `default width 380 px (${b.width})`);
  assert.ok(b.height <= 480 + 1, `as tall as its content up to 480 px (${b.height})`);
  const h = await need(resizeHandle(dlg), 'the resize handle [data-preview-resize]');
  assert.equal(await h.getAttribute('role'), 'button', 'role="button"');
  assert.equal(await h.getAttribute('aria-label'), 'Resize preview', 'name Resize preview');
  assert.equal(await description(h), 'Use the arrow keys to resize.', 'description');
  const drag = async (dx: number, dy: number) => {
    const hb = (await h.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + dx, hb.y + hb.height / 2 + dy, { steps: 5 });
    await page.mouse.up();
    await sleep(100);
    return (await dlg.boundingBox())!;
  };
  b = await drag(100, 0);
  assert.ok(Math.abs(b.width - 480) <= 1, `drag +100 px: 480 wide (${b.width})`);
  b = await drag(-1000, -1000);
  assert.deepEqual([Math.round(b.width), Math.round(b.height)], [300, 200], 'the minimum 300 × 200');
  b = await drag(2000, 2000);
  assert.ok(b.width <= 720 + 1 && b.height <= 800 + 1 && b.height <= 900 - 16 + 1, `the maximum 720 × 800 and the window minus 16 px (${b.width} × ${b.height})`);
  await drag(-1000, -1000);
  await drag(100, 100);
  const sized = (await dlg.boundingBox())!;
  const st = await eventually(async () => (await core.uiState())?.preview, (p) => !!p && Math.abs((p.width ?? 0) - sized.width) <= 1, 2000);
  assert.ok(st && Math.abs((st.width ?? 0) - sized.width) <= 1 && Math.abs((st.height ?? 0) - sized.height) <= 1, `ui-state.json preview.width/height (${JSON.stringify(st)})`);
  await h.focus();
  await page.keyboard.press('ArrowRight'); await sleep(80);
  assert.ok(Math.abs((await dlg.boundingBox())!.width - (sized.width + 16)) <= 1, '→ +16 px width');
  await page.keyboard.press('ArrowLeft'); await sleep(80);
  await page.keyboard.press('ArrowDown'); await sleep(80);
  assert.ok(Math.abs((await dlg.boundingBox())!.height - (sized.height + 16)) <= 1, '↓ +16 px height');
  await page.keyboard.press('ArrowUp'); await sleep(80);
  const kept = (await dlg.boundingBox())!;
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  const d2 = await clickToPreview(page, await needOdkazyLink(page, 'Osoby', 1), 'Petr Dvořák', 'a later preview');
  const b2 = (await d2.boundingBox())!;
  assert.ok(Math.abs(b2.width - kept.width) <= 1 && Math.abs(b2.height - kept.height) <= 1, `every later preview uses the last size (${b2.width} × ${b2.height})`);
  await (await need(resizeHandle(d2), 'handle')).dblclick();
  await sleep(150);
  assert.ok(Math.abs((await d2.boundingBox())!.width - 380) <= 1, 'a double-click on the handle resets the default');
  const st2 = await eventually(async () => (await core.uiState())?.preview, (p) => !!p && p.width === undefined && p.height === undefined, 2000);
  assert.ok(st2 && st2.width === undefined && st2.height === undefined, `the reset removes width and height (${JSON.stringify(st2)})`);
  assert.deepEqual(await writesSince(core, 0), [], 'resizing writes nothing to the vault');
});

// ------------------------------------------------------------------------------------------------ AC-5

test('fr_lnk_11_ac5_below_left_aligned_above_when_no_room_attached_while_scrolling', async ({ page }) => {
  const { core, chip, dlg } = await openRozpocet(page);
  const pl = await placementOf(page, dlg, chip);
  assert.ok(pl.below, `8 px below the reference (${pl.why})`);
  assert.ok(Math.abs(pl.d!.x - pl.r!.x) <= 2, `left-aligned with it (${pl.why})`);
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  await page.setViewportSize({ width: 1440, height: 700 });
  const low = await needOdkazyLink(page, 'Mapa');
  await low.evaluate((e) => e.scrollIntoView({ block: 'end' }));
  await sleep(200);
  const d2 = await clickToPreview(page, low, 'Mapa', 'a chip near the bottom of the window');
  const p2 = await placementOf(page, d2, low);
  assert.ok(p2.above && !p2.overlap && p2.inside, `above it when there is less room below (${p2.why})`);
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  await page.setViewportSize({ width: 1440, height: 900 });
  const mid = await needOdkazyLink(page, 'Projekt');
  const d3 = await clickToPreview(page, mid, 'Projekt Alfa', 'Projekt Alfa');
  const gap0 = (await d3.boundingBox())!.y - (await mid.boundingBox())!.y;
  await page.evaluate(() => {
    const m = document.querySelector('main')!;
    const s = [m, ...m.querySelectorAll('*')].find((e) => (e as HTMLElement).scrollHeight > (e as HTMLElement).clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)) as HTMLElement | undefined;
    if (s) s.scrollTop += 30;
  });
  await sleep(200);
  if ((await previewCount(page)) === 1) {
    const gap1 = (await d3.boundingBox())!.y - (await mid.boundingBox())!.y;
    assert.ok(Math.abs(gap1 - gap0) <= 1, `it stays attached while the page scrolls (${gap0} → ${gap1})`);
  } else assert.fail('the popover closed although its reference is still visible');
  await page.evaluate(() => {
    const m = document.querySelector('main')!;
    const s = [m, ...m.querySelectorAll('*')].find((e) => (e as HTMLElement).scrollHeight > (e as HTMLElement).clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)) as HTMLElement | undefined;
    if (s) s.scrollTop += 5000;
  });
  await needClosed(page, 'the reference left the visible area');
  await page.evaluate(() => {
    const m = document.querySelector('main')!;
    const s = [m, ...m.querySelectorAll('*')].find((e) => (e as HTMLElement).scrollHeight > (e as HTMLElement).clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)) as HTMLElement | undefined;
    if (s) s.scrollTop = 0;
  });
  await sleep(200);
  await clickToPreview(page, await rozpocetChip(page), 'Rozpočet 2027', 'again');
  await core.setFile(PV.odkazy, swap((await fileText(core, PV.odkazy))!, 'Hlavní [[Rozpočet 2027]].', 'Hlavní bez odkazu.'));
  await needClosed(page, 'the chip deleted by an external change', 3000);
});

test('fr_lnk_11_ac5_in_the_minimum_window_the_popover_shrinks_and_stays_visible', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  const { chip, dlg } = await openRozpocet(page);
  const pl = await placementOf(page, dlg, chip);
  assert.ok(pl.inside && !pl.overlap, `fully visible in 800 × 500 and not covering the reference (${pl.why})`);
});

// ------------------------------------------------------------------------------------------------ AC-6

for (const view of ['editor', 'read'] as const) {
  test(`fr_lnk_11_ac6_double_click_opens_once_and_back_restores_odkazy_${view}`, async ({ page }) => {
    const core = await startPreviews(page, { at: PV.odkazy, readView: view === 'read' });
    if (view === 'read') await need(readArticle(page, 'Odkazy'), 'read view');
    // Control: a single click previews in this build, so the double-click below isn't only today's click.
    await (await rozpocetChip(page)).click();
    await needPreview(page, 'Rozpočet 2027', 'control: a single click previews');
    await page.keyboard.press('Escape');
    await needClosed(page, 'Esc');
    await page.evaluate(() => {
      const m = document.querySelector('main')!;
      const s = [m, ...m.querySelectorAll('*')].find((e) => (e as HTMLElement).scrollHeight > (e as HTMLElement).clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)) as HTMLElement | undefined;
      if (s) s.scrollTop = 24;
    });
    await sleep(100);
    const scroll0 = await mainScrollTop(page);
    const before = await page.evaluate(() => ((window as any).__TEGG_TEST__?.editor?.text?.() as string | undefined) ?? null);
    const n0 = await mark(core);
    await (await rozpocetChip(page)).dblclick();
    await mustBeOn(page, 'Rozpočet 2027', 'a double-click opens note/Pages/Rozpočet 2027.md', 5000);
    assert.deepEqual(await navsSince(core, n0), [nfc(PV.rozpocet)], 'nav_opened exactly once, for Rozpočet');
    assert.equal(await previewCount(page), 0, 'no popover left');
    assert.equal((await callsSince(core, n0, 'note_write')).filter((c) => nfc(String((c.args as any)?.path)) === nfc(PV.odkazy)).length, 0, 'Odkazy is not written');
    await back(page, 'Odkazy');
    const scroll1 = await eventually(() => mainScrollTop(page), (t) => Math.abs(t - scroll0) <= 2, 2000);
    assert.ok(Math.abs(scroll1 - scroll0) <= 2, `Back returns to Odkazy at its scroll position (${scroll0} → ${scroll1})`);
    if (view === 'editor') {
      const after = await page.evaluate(() => ((window as any).__TEGG_TEST__?.editor?.text?.() as string | undefined) ?? null);
      assert.equal(after, before, 'the editor of Odkazy has no text change');
    }
  });
}

// ------------------------------------------------------------------------------------------------ AC-7

test('fr_lnk_11_ac7_open_enter_and_cmd_enter_in_the_popover_open_the_previewed_object', async ({ page }) => {
  const { core } = await openRozpocet(page);
  const n0 = await mark(core);
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Rozpočet 2027', '⏎ with the focus in the popover opens it', 5000);
  assert.equal(await previewCount(page), 0, 'and closes the popover');
  assert.deepEqual(await navsSince(core, n0), [nfc(PV.rozpocet)], 'nav_opened once');
  await back(page, 'Odkazy');
  await clickToPreview(page, await rozpocetChip(page), 'Rozpočet 2027', 'again');
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, 'Rozpočet 2027', '⌘↩ in the popover opens it', 5000);
  await back(page, 'Odkazy');
  const d = await clickToPreview(page, await rozpocetChip(page), 'Rozpočet 2027', 'again');
  let reached = false;
  for (let i = 0; i < 12 && !reached; i++) { await page.keyboard.press('Tab'); reached = (await focusInfo(page)).name === 'Open Rozpočet 2027'; }
  assert.ok(reached, 'Open Rozpočet 2027 is reachable by Tab');
  await (await need(openBtn(d, 'Rozpočet 2027'), 'button "Open Rozpočet 2027"')).click();
  await mustBeOn(page, 'Rozpočet 2027', 'Open opens it', 5000);
});

test('fr_lnk_11_ac7_enter_on_a_link_inside_follows_it_and_cmd_enter_opens_it', async ({ page }) => {
  const { dlg } = await openRozpocet(page);
  const jana = await need(chipNamed(content(dlg, 'Rozpočet 2027'), 'Jana Nováková'), 'the chip Jana Nováková inside');
  await jana.focus();
  await page.keyboard.press('Enter');
  const dj = await needPreview(page, 'Jana Nováková', '⏎ on a link inside follows AP-814');
  await (await need(backBtn(dj, 'Rozpočet 2027'), 'Back to Rozpočet 2027')).click();
  const dr = await needPreview(page, 'Rozpočet 2027', 'Back');
  await (await need(chipNamed(content(dr, 'Rozpočet 2027'), 'Jana Nováková'), 'Jana chip again')).focus();
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, 'Jana Nováková', '⌘↩ on a link inside opens that link\'s target', 5000);
});

// ------------------------------------------------------------------------------------------------ AC-8

for (const mode of ['click', 'hover', 'off'] as const) {
  test(`fr_lnk_11_ac8_cmd_click_and_cmd_double_click_open_in_the_current_view_${mode}`, async ({ page }) => {
    await startPreviews(page, { at: PV.odkazy, mode });
    const chip = await rozpocetChip(page);
    await chip.click({ modifiers: ['Meta'] });
    await mustBeOn(page, 'Rozpočet 2027', `${mode}: ⌘-click opens in the current view`, 5000);
    assert.equal(await previewCount(page), 0, `${mode}: no preview`);
    assert.equal(page.context().pages().length, 1, 'no new window');
    await back(page, 'Odkazy');
    await (await rozpocetChip(page)).dblclick({ modifiers: ['Meta'] });
    await mustBeOn(page, 'Rozpočet 2027', `${mode}: ⌘-double-click opens`, 5000);
    assert.equal(await previewCount(page), 0, 'no preview');
    const tab = await need(page.getByRole('button', { name: 'New tab', exact: true }), 'title bar button "New tab"');
    assert.equal(await tab.getAttribute('aria-disabled'), 'true', 'New tab stays aria-disabled');
    assert.equal(await description(tab), 'Coming in v1.0', 'Coming in v1.0');
    await back(page, 'Odkazy');
    // Control: ⌥Space with the caret after the chip previews in every mode (AP-810), so the opens above aren't
    // only today's behaviour.
    await caretAfterChip(page, 'Hlavní');
    await page.keyboard.press('Alt+Space');
    await needPreview(page, 'Rozpočet 2027', `${mode}: ⌥Space with the caret after the chip previews`);
  });
}

// ------------------------------------------------------------------------------------------------ AC-9

test('fr_lnk_11_ac9_nothing_in_the_popover_is_editable_and_text_can_be_copied', async ({ page }) => {
  const vault = previewsVault((f) => {
    f['Pages/Seznam.md'] = '---\nid: 01JBPV0000000000000000P041\ntype: page\ntitle: Seznam\n---\nÚkoly na čtvrtek.\n\n- [ ] Koupit mléko\n- [x] Zaplatit nájem\n';
    f[nfc(PV.odkazy)] += '\nSeznam [[Seznam]].\n';
  });
  const core = await startPreviews(page, { at: PV.odkazy, vault });
  const files0 = await snapshot(core);
  const d = await clickToPreview(page, await needOdkazyLink(page, 'Seznam'), 'Seznam', 'Seznam');
  const editable = await d.evaluate((x) => x.querySelectorAll('[contenteditable="true"], [contenteditable=""], input:not([type="checkbox"]), textarea, select').length);
  assert.equal(editable, 0, 'no contenteditable and no text input');
  const boxes = d.getByRole('checkbox');
  assert.equal(await boxes.count(), 2, 'the two checklist boxes are shown');
  for (let i = 0; i < 2; i++) assert.equal(await boxes.nth(i).getAttribute('aria-readonly'), 'true', `checkbox ${i + 1} aria-readonly="true"`);
  const was = await boxes.first().getAttribute('aria-checked');
  await boxes.first().click();
  assert.equal(await boxes.first().getAttribute('aria-checked'), was, 'clicking a checkbox changes nothing');
  const n0 = await mark(core);
  await d.focus();
  await page.keyboard.type('abc');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Meta+v');
  await page.keyboard.press('Meta+z');
  await sleep(1200);
  assert.deepEqual(await writesSince(core, n0), [], 'typing, paste, ⌫ and ⌘Z in the popover send no write command');
  assert.deepEqual(await snapshot(core), files0, 'and change no note');
  await page.evaluate(() => { (window as any).__pvCopied = null; document.addEventListener('copy', () => { (window as any).__pvCopied = String(getSelection()); }, true); });
  const ok = await d.evaluate((x) => {
    const p = [...x.querySelectorAll('article p')].find((e) => (e.textContent ?? '').startsWith('Úkoly na čtvrtek'));
    const t = p?.firstChild;
    if (!t || t.nodeType !== 3) return false;
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 'Úkoly na'.length);
    const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    return true;
  });
  assert.ok(ok, 'text in the body can be selected');
  await page.keyboard.press('Meta+c');
  assert.equal(await page.evaluate(() => (window as any).__pvCopied), 'Úkoly na', '⌘C copies the selected text');
});

// ------------------------------------------------------------------------------------------------ AC-10

test('fr_lnk_11_ac10_a_link_inside_replaces_the_content_and_back_restores_it', async ({ page }) => {
  const { core, dlg } = await openRozpocet(page);
  const b0 = (await dlg.boundingBox())!;
  const art = await need(content(dlg, 'Rozpočet 2027'), 'content');
  await art.evaluate((a) => { let s: HTMLElement | null = a as HTMLElement; while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement; if (s) s.scrollTop = 40; });
  const top0 = (await scrollState(art))?.top ?? 0;
  await (await need(chipNamed(art, 'Jana Nováková'), 'Jana chip inside')).click();
  const dj = await needPreview(page, 'Jana Nováková', 'a click on a chip inside');
  const b1 = (await dj.boundingBox())!;
  assert.ok(Math.abs(b1.x - b0.x) <= 1 && Math.abs(b1.y - b0.y) <= 1 && Math.abs(b1.width - b0.width) <= 1, `same position and width (${JSON.stringify([b0, b1])})`);
  await (await need(backBtn(dj, 'Rozpočet 2027'), 'button "Back to Rozpočet 2027"')).click();
  const dr = await needPreview(page, 'Rozpočet 2027', 'Back');
  assert.equal(await anyBack(dr).count(), 0, 'no Back on the first preview');
  const top1 = (await scrollState(content(dr, 'Rozpočet 2027')))?.top ?? -1;
  assert.ok(Math.abs(top1 - top0) <= 1, `Back restores the scroll position (${top0} → ${top1})`);
  const card = await need(content(dr, 'Rozpočet 2027').locator('[data-embed-mode]').filter({ hasText: 'Projekt Alfa' }), 'the card Projekt Alfa inside');
  await card.click();
  const da = await needPreview(page, 'Projekt Alfa', 'the card inside behaves as a chip');
  await need(backBtn(da, 'Rozpočet 2027'), 'Back to Rozpočet 2027 after the card');
  await (await need(backBtn(da, 'Rozpočet 2027'), 'Back')).click();
  const n0 = await mark(core);
  await (await need(chipNamed(content(await needPreview(page, 'Rozpočet 2027', 'back again'), 'Rozpočet 2027'), 'Jana Nováková'), 'Jana chip')).dblclick();
  await mustBeOn(page, 'Jana Nováková', 'a double-click on a chip inside opens that target', 5000);
  assert.deepEqual(await navsSince(core, n0), [nfc(PV.jana)], 'nav_opened once for Jana');
});

test('fr_lnk_11_ac10_a_broken_link_inside_opens_the_create_offer_instead', async ({ page }) => {
  const vault = previewsVault((f) => { f[nfc(PV.petr)] = swap(f[nfc(PV.petr)], 'Vede tým nákupu.', 'Vede tým nákupu. Viz [[Neexistuje]].'); });
  await startPreviews(page, { at: PV.odkazy, vault });
  const d = await clickToPreview(page, await needOdkazyLink(page, 'Osoby', 1), 'Petr Dvořák', 'Petr');
  await (await need(chipNamed(anyContent(d), 'Neexistuje'), 'the broken chip inside')).click();
  await need(createOffer(page), 'the Create offer');
  assert.equal(await previewCount(page), 0, 'the Create offer replaces the popover (one popup at a time)');
});

// ------------------------------------------------------------------------------------------------ AC-12

test('fr_lnk_11_ac12_showing_previews_never_opens_and_loads_through_embed_load', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy });
  const n0 = await mark(core);
  const links: [string, number, string][] = [
    ['Hlavní', 0, PV.rozpocet], ['S popisem', 0, PV.rozpocet], ['Osoby', 0, PV.jana], ['Osoby', 1, PV.petr], ['Projekt', 0, PV.alfa], ['Úkol', 0, PV.ukol],
    ['Dny', 0, PV.denni], ['Média', 0, PV.graf], ['Média', 2, PV.smlouva], ['Dvojníci', 0, PV.planP], ['Dvojníci', 1, PV.planQ], ['Prázdná', 0, PV.prazdna],
    ['Prázdná', 1, PV.neplatna], ['Kruh', 0, PV.kruhA], ['Markdown', 0, PV.rozpocet], ['Nápad', 0, PV.napad], ['Mapa', 0, PV.mapa],
  ];
  for (const [start, n, path] of links) {
    const m0 = await mark(core);
    await (await needOdkazyLink(page, start, n)).click();
    const d = await needAnyPreview(page, `"${start}…" link ${n + 1}`);
    assert.equal(await previewPath(d), nfc(path), `${path}: the preview`);
    await sleep(150);
    const loads = await embedLoadsSince(core, m0);
    assert.ok(loads.length >= 1 && loads.length <= 2 && loads[0].includes(nfc(path)), `${path}: at most one embed_load for the file plus one for its cards (${JSON.stringify(loads)})`);
    await page.keyboard.press('Escape');
    await needClosed(page, `${path}: Esc`);
  }
  await runCommand(page, 'Go to type: Osoby');
  const t = await need(typeTable(page, 'Osoby'), 'table Osoby');
  for (const name of ['Jana Nováková', 'Petr Dvořák']) {
    await (await need(t.getByRole('row').filter({ hasText: name }), `row ${name}`)).click();
    await needPreview(page, name, `type/osoba row ${name}`);
    await page.keyboard.press('Escape');
    await needClosed(page, 'Esc');
  }
  assert.deepEqual(await navsSince(core, n0), [], 'nav_opened is called zero times');
  assert.equal((await callsSince(core, n0, 'note_read')).length, 0, 'note_read is called zero times');
});

test('fr_lnk_11_ac12_embeds_in_vlozeni_preview_without_nav_opened_or_note_read', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.vlozeni });
  await need(frame(editorBody(page), 'Jana Nováková'), 'card Jana');
  const n0 = await mark(core);
  const card = await need(frame(editorBody(page), 'Jana Nováková'), 'card Jana');
  const cb = (await card.boundingBox())!;
  await page.mouse.click(cb.x + cb.width - 12, cb.y + 12);
  await needPreview(page, 'Jana Nováková', 'card');
  await page.keyboard.press('Escape');
  await clickToPreview(page, await need(linkEmbed(editorBody(page), 'Petr Dvořák'), 'link-mode Petr'), 'Petr Dvořák', 'link mode');
  await page.keyboard.press('Escape');
  const full = await need(topEmbed(editorBody(page), 0), 'full embed');
  await clickToPreview(page, await need(full.locator(':scope > *').first().getByText('Rozpočet 2027', { exact: true }), 'full header title'), 'Rozpočet 2027', 'full embed header');
  await page.keyboard.press('Escape');
  assert.deepEqual(await navsSince(core, n0), [], 'nav_opened zero times');
  assert.equal((await callsSince(core, n0, 'note_read')).length, 0, 'note_read zero times');
});

// ------------------------------------------------------------------------------------------------ AC-13

test('fr_lnk_11_ac13_focus_moves_to_the_dialog_and_tab_walks_its_controls_then_leaves', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy, readView: true });
  await need(readArticle(page, 'Odkazy'), 'read view');
  const chip = await rozpocetChip(page);
  const d = await clickToPreview(page, chip, 'Rozpočet 2027', 'click');
  assert.equal(await d.evaluate((e) => e === document.activeElement), true, 'the focus is on the dialog element');
  assert.equal(await d.getAttribute('tabindex'), '-1', 'tabindex="-1"');
  assert.ok((await description(d)).includes('Page'), `the dialog's description is the type name: ${await description(d)}`);
  const names: string[] = [];
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    const f = await focusInfo(page);
    if (!f.inPreview) break;
    names.push(f.name);
  }
  assert.equal(names[0], 'Close preview', `first Close (${names.join(' | ')})`);
  assert.deepEqual(names.slice(-2), ['Open Rozpočet 2027', 'Resize preview'], `then the links, Open and Resize (${names.join(' | ')})`);
  assert.ok(names.includes('Jana Nováková'), 'the links in the body are in the order');
  await needClosed(page, 'the next Tab leaves the popover and closes it');
  assert.equal((await focusInfo(page)).name, 'rozpočet', 'the focus goes to the element after the reference');
});

test('fr_lnk_11_ac13_references_carry_the_mode_description', async ({ page }) => {
  for (const [mode, want] of [['click', 'Click to preview, double-click to open'], ['hover', 'Hover to preview, click to open'], ['off', '']] as const) {
    const p = await page.context().newPage();
    await startPreviews(p, { at: PV.odkazy, readView: true, mode });
    await need(readArticle(p, 'Odkazy'), `${mode}: read view`);
    assert.equal(await description(await rozpocetChip(p)), want, `${mode}: the chip's description`);
    const napad = await description(await needOdkazyLink(p, 'Nápad'));
    assert.ok(napad.includes('Unreviewed') && (want === '' ? !/preview/i.test(napad) : napad.includes(want)), `${mode}: added to an existing description (Unreviewed): ${napad}`);
    await p.close();
  }
});

// ------------------------------------------------------------------------------------------------ AC-14

test('fr_lnk_11_ac14_reduce_motion_shows_and_hides_without_transition', async ({ page }) => {
  const { dlg } = await openRozpocet(page, { reducedMotion: 'reduce' });
  const m = await dlg.evaluate((d) => { const s = getComputedStyle(d); return { t: s.transitionDuration, a: s.animationName, ad: s.animationDuration }; });
  assert.ok(m.t.split(',').every((x) => parseFloat(x) === 0) && (m.a === 'none' || m.ad.split(',').every((x) => parseFloat(x) === 0)), `no transition or animation: ${JSON.stringify(m)}`);
});

test('fr_lnk_11_ac14_without_reduce_motion_it_fades_in_within_150_ms', async ({ page }) => {
  const { dlg } = await openRozpocet(page, { reducedMotion: 'no-preference' });
  const m = await dlg.evaluate((d) => { const s = getComputedStyle(d); return { t: s.transitionDuration, tp: s.transitionProperty, a: s.animationName, ad: s.animationDuration }; });
  const durs = [...m.t.split(','), ...(m.a !== 'none' ? m.ad.split(',') : [])].map((x) => parseFloat(x)).filter((x) => x > 0);
  assert.ok(durs.length > 0 && durs.every((x) => x <= 0.15), `a fade of at most 150 ms: ${JSON.stringify(m)}`);
  await (await need(chipNamed(content(dlg, 'Rozpočet 2027'), 'Jana Nováková'), 'Jana inside')).click();
  const d2 = await needPreview(page, 'Jana Nováková', 'content replacement');
  const art = await d2.locator('article').first().evaluate((a) => getComputedStyle(a).animationName).catch(() => 'none');
  assert.equal(art, 'none', 'content replacement never animates');
});

// ------------------------------------------------------------------------------------------------ AC-15

test('fr_lnk_11_ac15_fifty_previews_and_resizes_never_reach_the_vault', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy });
  const files0 = await snapshot(core);
  const n0 = await mark(core);
  const refs: [string, number, string][] = [['Hlavní', 0, 'Rozpočet 2027'], ['Osoby', 0, 'Jana Nováková'], ['Osoby', 1, 'Petr Dvořák'], ['Projekt', 0, 'Projekt Alfa'], ['Úkol', 0, 'Zavolat Janě']];
  let resizes = 0;
  for (let i = 0; i < 50; i++) {
    const [start, n, title] = refs[i % refs.length];
    const d = await clickToPreview(page, await needOdkazyLink(page, start, n), title, `round ${i + 1}`);
    if (i % 10 === 0) {
      await (await need(resizeHandle(d), 'the resize handle')).focus();
      await page.keyboard.press(i % 20 === 0 ? 'ArrowRight' : 'ArrowLeft');
      resizes++;
    }
    await page.keyboard.press('Escape');
    await needClosed(page, `round ${i + 1}: Esc`);
  }
  await sleep(300);
  assert.deepEqual(await snapshot(core), files0, 'no vault file changes and none is created');
  assert.deepEqual(await writesSince(core, n0), [], 'no write command');
  const sets = await callsSince(core, n0, 'ui_state_set');
  assert.equal(sets.length, resizes, `ui_state_set is sent only for a size change (${sets.length} for ${resizes} resizes)`);
});

// ------------------------------------------------------------------------------------------------ AC-16, FR-UX-05 AC-14

async function themeCheck(page: Page, th: 'light' | 'dark', cases: [string, number, string][], focusOutline: boolean) {
  await page.emulateMedia({ colorScheme: th });
  await startPreviews(page, { at: PV.odkazy, theme: th });
  const pop = await tokenColour(page, th, 'pop');
  for (const [start, n, title] of cases) {
    const d = await clickToPreview(page, await needOdkazyLink(page, start, n), title, `${th}: ${title}`);
    await sleep(250);
    assert.equal(await d.evaluate((e) => getComputedStyle(e).backgroundColor), pop, `${th} ${title}: the --pop background`);
    assert.deepEqual(await axeContrast(page), [], `${th} ${title}: axe color-contrast reports no violation`);
    assert.deepEqual(await colourLeaks(page, th), [], `${th} ${title}: only theme tokens (FR-UX-05 AC-5)`);
    if (focusOutline) {
      let ok = false;
      for (let i = 0; i < 12 && !ok; i++) { await page.keyboard.press('Tab'); ok = (await focusInfo(page)).name === `Open ${title}`; }
      assert.ok(ok, `${th}: Open ${title} reached by Tab`);
      const o = await openBtn(d, title).evaluate((e) => { const s = getComputedStyle(e); return { style: s.outlineStyle, colour: s.outlineColor, width: parseFloat(s.outlineWidth) }; });
      assert.ok(o.style !== 'none' && o.width > 0 && o.colour === (await tokenColour(page, th, 'focus')), `${th}: the focused Open shows the focus outline (D-594): ${JSON.stringify(o)}`);
    }
    await page.keyboard.press('Escape');
    await needClosed(page, `${th} ${title}: Esc`);
  }
}

for (const th of ['light', 'dark'] as const) {
  test(`fr_lnk_11_ac16_previews_use_theme_tokens_and_pass_contrast_${th}`, async ({ page }) => {
    await themeCheck(page, th, [['Hlavní', 0, 'Rozpočet 2027'], ['Projekt', 0, 'Projekt Alfa'], ['Úkol', 0, 'Zavolat Janě'], ['Osoby', 0, 'Jana Nováková'], ['Štítky', 0, '#Účty'], ['Média', 0, 'Graf']], false);
  });
  // FR-UX-05 AC-14's popover part; the Link menu and the Edit link dialog are in previews_editor.ac.test.ts.
  test(`fr_ux_05_ac14_the_popover_passes_axe_and_the_focused_open_shows_the_focus_outline_${th}`, async ({ page }) => {
    await themeCheck(page, th, [['Hlavní', 0, 'Rozpočet 2027']], true);
  });
}

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-11

test('nfr_oth_02_ac11_popover_strings_are_catalog_strings_in_the_pseudo_locale', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy, prelude: pseudoLocale });
  await (await rozpocetChip(page)).click();
  const d = await needAnyPreview(page, 'the pseudo-locale preview');
  const r = await d.evaluate((dlg) => {
    const bad: string[] = [];
    const name = dlg.getAttribute('aria-label') ?? '';
    if (!/^⟦.*⟧$/.test(name.trim())) bad.push(`dialog name ${name}`);
    const user = (e: Element) => !!e.closest('header h2, article, [role="region"][aria-label*="Preview properties"]');
    for (const b of dlg.querySelectorAll('button, [role="button"]')) {
      const l = b.getAttribute('aria-label');
      if (l && !/^⟦.*⟧$/.test(l.trim()) && !user(b)) bad.push(`name ${l}`);
    }
    const walker = document.createTreeWalker(dlg, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const s = (t.textContent ?? '').trim();
      const el = t.parentElement!;
      if (!s || !/\p{L}/u.test(s) || user(el) || el.getClientRects().length === 0) continue;
      const hd = el.closest('header');
      if (hd && !el.closest('button')) continue; // the type name and the details line are user content (type names)
      const wrapped = /^⟦[\s\S]*⟧$/.test(s) || /^⟦[\s\S]*⟧$/.test((el.textContent ?? '').trim()) || /^⟦[\s\S]*⟧$/.test((el.parentElement?.textContent ?? '').trim());
      if (!wrapped) bad.push(`text ${s}`);
    }
    return bad;
  });
  assert.deepEqual(r, [], 'every visible text and accessible name of the popover is inside ⟦ ⟧ except user content');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-37

test('fr_syn_06_ac37_a_preview_tour_writes_nothing_then_remove_link_writes_one_note', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, panel: true });
  const files0 = await snapshot(core);
  for (const [start, n] of [['Hlavní', 0], ['S popisem', 0], ['Sekce', 0], ['Blok', 0], ['Osoby', 0], ['Osoby', 1], ['Projekt', 0], ['Úkol', 0], ['Dny', 0], ['Dny', 1], ['Štítky', 0], ['Štítky', 1], ['Štítky', 2], ['Média', 0], ['Média', 1], ['Média', 2], ['Dvojníci', 0], ['Dvojníci', 1], ['Prázdná', 0], ['Prázdná', 1], ['Kruh', 0], ['Markdown', 0], ['Nápad', 0], ['Mapa', 0]] as const) {
    await (await needOdkazyLink(page, start, n)).click();
    const d = await needAnyPreview(page, `tour: "${start}…" ${n + 1}`);
    await anyContent(d).first().evaluate((a) => { let s: HTMLElement | null = a as HTMLElement; while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement; if (s) s.scrollTop = s.scrollHeight; }).catch(() => {});
    await page.keyboard.press('Escape');
    await needClosed(page, 'tour Esc');
  }
  const chip = await rozpocetChip(page);
  await chip.click();
  const d = await needPreview(page, 'Rozpočet 2027', 'tour: Rozpočet');
  await (await need(chipNamed(content(d, 'Rozpočet 2027'), 'Jana Nováková'), 'Jana inside')).click();
  await (await need(backBtn(await needPreview(page, 'Jana Nováková', 'followed'), 'Rozpočet 2027'), 'Back')).click();
  const d2 = await needPreview(page, 'Rozpočet 2027', 'after Back');
  await (await need(resizeHandle(d2), 'resize handle')).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await needClosed(page, 'Esc');
  await (await needOdkazyLink(page, 'Dny', 1)).click();
  const day = await needPreview(page, '2026-10-30', 'the virtual day');
  await (await need(openBtn(day, '2026-10-30'), 'Open 2026-10-30')).click();
  await need(page.getByRole('textbox', { name: 'Title', exact: true }), 'daily/2026-10-30', 5000);
  await back(page, 'Odkazy');
  for (const m of ['Object preview: Hover to preview', 'Object preview: Off', 'Object preview: Click to preview']) await runCommand(page, m);
  await runCommand(page, 'Go to Tasks');
  await (await need(taskCard(page, 'Zavolat Janě').locator('[data-link-kind]').filter({ hasText: 'Porada 2026-10-27' }), 'source chip')).click();
  await needPreview(page, 'Porada 2026-10-27', 'the source chip');
  await page.keyboard.press('Escape');
  await searchFor(page, 'rozpočet', 'Rozpočet 2027').then((r) => r.click());
  await needPreview(page, 'Rozpočet 2027', 'a search result');
  await page.keyboard.press('Escape');
  await runCommand(page, 'Go to type: Osoby');
  await (await need(typeTable(page, 'Osoby').getByRole('row').filter({ hasText: 'Petr Dvořák' }), 'type row')).click();
  await needPreview(page, 'Petr Dvořák', 'a type-page row');
  await page.keyboard.press('Escape');
  await sleep(300);
  assert.deepEqual(await writesSince(core, 0), [], 'the tour sends 0 write commands');
  assert.deepEqual(await snapshot(core), files0, 'every vault file unchanged, none created (no Daily/2026-10-30.md, no Tags/nápad.md)');
  await openNote(page, 'Odkazy');
  const n0 = await mark(core);
  const alfa = await needOdkazyLink(page, 'Projekt');
  await alfa.click();
  await needPreview(page, 'Projekt Alfa', 'the chip previews, the caret goes after it');
  await page.keyboard.press('Escape');
  await runCommand(page, 'Remove link');
  const t = await eventually(() => fileText(core, PV.odkazy), (x) => !!x && x.includes('Projekt Projekt Alfa.'), 4000);
  assert.equal(noModified(t), noModified(swap(previewsVault().files[nfc(PV.odkazy)], 'Projekt [[Projekt Alfa]].', 'Projekt Projekt Alfa.')), 'only that line and modified change');
  const w = await callsSince(core, n0, 'note_write');
  assert.equal(w.length, 1, 'then exactly 1 note_write');
  assert.deepEqual(await writesSince(core, n0), ['note_write'], 'and no other write command');
});
