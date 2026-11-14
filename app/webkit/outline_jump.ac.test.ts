// Slice OL, L5 (WebKit + fake core): the current section and the jump (docs/acceptance/outline.md R172): FR-EDT-11 AC-9
// (the current section follows scrolling), AC-10 (a click jumps: 24 px, instant, caret at the end, the 2,000 ms highlight,
// nothing written), AC-11 (targets by position, the folded callout, a stale row with the refresh held), AC-12 (the source
// view and read-only files), AC-19 (a heading link lands where the outline jumps), FR-NAV-03 AC-15 and AC-16 (a jump is a
// Back entry; Back after edits). Interface docs/contracts/v1-outline.md §2, §3.4, §3.5, §4, §10 (`__TEGG_TEST__.outline`);
// helpers outline-helpers.ts. D-1675: no Outline tab; the jumps are made from the rail's card (`cardRowFor`, opening an
// ancestor's chevron when the row isn't shown) and the current section is read from the hook. Playwright's clock drives the 100, 250 and 2,000 ms timings. Written from the ACs and the
// contract only (D-61). Every lookup goes through `must` and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, TITLE, ZONE, another, callsSince, caret, cardRowFor, count, currentRows, editorBody, editorState, eventually, frames, goToQuery, headingEl, headingTop, hold, hook,
  introPara, jumpVia, mainScroll, must, mustBeOn, noteRoute, original, outlineRows, pauseClock, placeCaret, railLines, recordFrames, runFor, scrollHeadingTo, seen,
  selectText, setScroll, sleep, sourceLine, sourceView, startOutline, tokenColor, topIn, type FakeCoreHandle,
} from './outline-helpers';

test.use({ timezoneId: ZONE, locale: 'cs-CZ' });

const backBtn = (page: Page) => page.getByRole('button', { name: 'Back', exact: true });
const fwdBtn = (page: Page) => page.getByRole('button', { name: 'Forward', exact: true });
async function enabled(page: Page, which: 'Back' | 'Forward'): Promise<boolean> {
  const b = which === 'Back' ? backBtn(page) : fwdBtn(page);
  await must(b, `title-bar button ${which}`);
  return !(await b.first().evaluate((e) => (e as HTMLButtonElement).disabled || e.getAttribute('aria-disabled') === 'true'));
}
const near = (a: number | null | undefined, b: number, tol: number) => typeof a === 'number' && Math.abs(a - b) <= tol;

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-9

test('fr_edt_11_ac9_current_section_follows_scrolling', async ({ page }) => {
  await startOutline(page, noteRoute(P.plan));
  await eventually(() => outlineRows(page), (r) => r.length === 11);
  const one = async (what: string) => { const c = await currentRows(page); assert.ok(c.length <= 1, `${what}: at most one current section (${c.join(', ')})`); return c; };
  await setScroll(page, 0);
  assert.deepEqual(await one('scrollTop 0'), [], 'at scrollTop 0 nothing is current');
  await scrollHeadingTo(page, 'Den 1', 20);
  const den = await eventually(() => currentRows(page), (c) => c.length === 1 && c[0] === 'Den 1');
  assert.deepEqual(den, ['Den 1'], 'Den 1\'s top 10 px above the 30 px line: Den 1 is current');
  assert.deepEqual(await one('Den 1'), den);
  assert.equal((await eventually(() => railLines(page), (l) => l[4]?.state === 'current'))[4]?.state, 'current', 'Den 1\'s rail line is current');
  await scrollHeadingTo(page, 'Den 1', 31);
  assert.deepEqual(await eventually(() => currentRows(page), (c) => c[0] === 'Program'), ['Program'], 'Den 1\'s top 31 px below the viewport\'s top: Program');
  await setScroll(page, 'end');
  const s = await mainScroll(page);
  assert.ok(s.height > s.client, 'setup: Plán scrolls');
  assert.deepEqual(await eventually(() => currentRows(page), (c) => c[0] === 'Rozpočet'), ['Rozpočet'], 'at the end Rozpočet is current');
  await pauseClock(page);
  await page.evaluate(() => { const m = document.querySelector('main') as HTMLElement; m.scrollTop = 0; m.dispatchEvent(new Event('scroll')); });
  await runFor(page, 100);
  assert.deepEqual(await one('back to 0'), [], 'scrolling back to 0: no current row within 100 ms of the last scroll event');
  await page.clock.resume();
  const { p } = await another(page, noteRoute(P.jeden));
  await eventually(() => outlineRows(p), (r) => r.length === 1);
  // With the scroll-past-end space (D-140) Jeden scrolls too; at its end Další kroky passes the line (D-1651).
  for (const t of [0, 200]) {
    await setScroll(p, t);
    assert.deepEqual(await currentRows(p), [], `Jeden: nothing is current (scroll ${t})`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-10

/** Čtenářské at scrollTop 0 with the caret at offset 5 of the intro paragraph. */
async function ctenAtIntro(page: Page, route = noteRoute(P.cten)): Promise<FakeCoreHandle> {
  const core = await startOutline(page, route);
  await eventually(() => outlineRows(page), (r) => r.length > 0);
  await setScroll(page, 0);
  await placeCaret(await must(introPara(page), 'the intro paragraph'), 5);
  return core;
}

test('fr_edt_11_ac10_click_jumps_to_the_heading', async ({ page }) => {
  const core = await ctenAtIntro(page);
  const name0 = await page.getByRole('main').getAttribute('aria-label');
  const depth0 = (await editorState(page)).depth;
  const calls0 = (await core.calls()).length;
  const target = await cardRowFor(page, 'Zpoždění replikace');
  await recordFrames(page);
  await pauseClock(page);
  await target.click();
  await runFor(page, 20);
  const top = await headingTop(page, 'Zpoždění replikace');
  assert.ok(near(top, 24, 2), `on the next frame the heading's top is 24 ± 2 px below the viewport's top (${top})`);
  const end = (await mainScroll(page)).top;
  const f = await frames(page);
  assert.ok(f.every((x) => Math.abs(x) <= 1 || Math.abs(x - end) <= 1), `no frame shows an intermediate scrollTop (instant): ${f.join(', ')}`);
  const c = await caret(page);
  assert.ok(c && c.collapsed && c.block === 'Zpoždění replikace' && c.offset === c.len, `the selection is collapsed at the end of Zpoždění replikace: ${JSON.stringify(c)}`);
  assert.ok(c?.focused, 'document.activeElement is the Note body');
  const hd = headingEl(page, 'Zpoždění replikace');
  const linkBg = await tokenColor(page, '--link-bg');
  assert.equal(await hd.getAttribute('data-outline-flash'), '', 'the heading has data-outline-flash');
  assert.equal(await hd.evaluate((e) => getComputedStyle(e).backgroundColor), linkBg, 'its background is --link-bg');
  await runFor(page, 1880);
  assert.ok(await hd.evaluate((e) => e.hasAttribute('data-outline-flash')), 'at 1,900 ms it still has data-outline-flash');
  await runFor(page, 200);
  assert.ok(!(await hd.evaluate((e) => e.hasAttribute('data-outline-flash'))), 'at 2,100 ms it doesn\'t');
  await runFor(page, 300);
  const bg = await eventually(() => hd.evaluate((e) => getComputedStyle(e).backgroundColor), (b) => b === 'rgba(0, 0, 0, 0)', 1000);
  assert.equal(bg, 'rgba(0, 0, 0, 0)', 'the background reaches transparent by 2,400 ms');
  await page.clock.resume();
  assert.deepEqual(await currentRows(page), ['Zpoždění replikace'], 'Zpoždění replikace is current');
  const st = await editorState(page);
  assert.equal(st.dirty, false, 'dirty() is false');
  assert.equal(st.depth, depth0, 'historyDepth() is unchanged');
  assert.equal(await page.getByRole('main').getAttribute('aria-label'), name0, 'the route is unchanged');
  const since = await callsSince(core, calls0);
  assert.ok(!since.includes('nav_opened') && !since.some((x) => /^note_(write|create)/.test(x)), `no write or nav_opened: ${since.join(', ')}`);
  await page.keyboard.type('X');
  assert.ok((await eventually(async () => (await editorState(page)).text ?? '', (t) => t.includes('## Zpoždění replikaceX'))).includes('## Zpoždění replikaceX'), 'typing X gives `Zpoždění replikaceX`');
  await jumpVia(page, 'Další čtení');
  // With the scroll-past-end space (D-140) the last heading also reaches the landing line (D-1651).
  const lt = await eventually(() => headingTop(page, 'Další čtení'), (t) => near(t, 24, 8));
  assert.ok(near(lt, 24, 8), `a click on Další čtení lands its top 24 ± 8 px below the viewport's top (${lt})`);
  assert.deepEqual(await eventually(() => currentRows(page), (x) => x[0] === 'Další čtení'), ['Další čtení'], 'and makes it current');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-11

test('fr_edt_11_ac11_jump_targets_by_position', async ({ page }) => {
  const core = await startOutline(page, noteRoute(P.okraje));
  await eventually(() => outlineRows(page), (r) => r.length === 11);
  const jump = async (text: string, n = 0) => { await jumpVia(page, text, n); await sleep(150); return caret(page); };
  let c = await jump('Poznámky', 2);
  assert.ok(c && c.block === 'Poznámky' && c.tag === 'h2' && c.nth === 1 && c.offset === c.len, `the third Poznámky row: the caret at the end of the last \`## Poznámky\`: ${JSON.stringify(c)}`);
  c = await jump('Poznámky', 1);
  assert.ok(c && c.block === 'Poznámky' && c.tag === 'h3' && c.offset === c.len, `the second (level 3) lands in \`### Poznámky\`: ${JSON.stringify(c)}`);
  c = await jump('Skrytý nadpis');
  const fold = page.getByRole('button', { name: 'Collapse Sbalený callout', exact: true });
  assert.ok(await seen(fold, 1000), 'Skrytý nadpis expands the folded callout: its button reads `Collapse Sbalený callout`');
  assert.equal(await fold.first().getAttribute('aria-expanded'), 'true', 'aria-expanded="true" (D-159)');
  assert.ok(c && c.block === 'Skrytý nadpis' && c.offset === c.len, `the caret at the end of Skrytý nadpis: ${JSON.stringify(c)}`);
  // A heading inside a list item is a read-only raw block in the editor: the jump scrolls to it, the caret stays (D-1629, D-1652).
  const c0 = await caret(page);
  c = await jump('Nadpis v seznamu');
  // The read-only block is flashed and scrolled as a heading would be (contract CP-2); find it by its flash.
  const rawBlk = page.locator('main [data-outline-flash]').filter({ hasText: 'Nadpis v seznamu' });
  const lst = await topIn(rawBlk);
  assert.ok(near(lst, 24, 8), `Nadpis v seznamu: the note scrolls its block to 24 ± 8 px below the viewport's top (${lst})`);
  assert.deepEqual(c, c0, 'Nadpis v seznamu: the caret is unchanged');
  c = await jump('Nadpis v calloutu');
  assert.ok(c && c.block === 'Nadpis v calloutu' && c.offset === c.len && c.inCallout, `Nadpis v calloutu: inside the callout: ${JSON.stringify(c)}`);
  c = await jump('Nadpis podtržený');
  assert.ok(c && c.block === 'Nadpis podtržený' && c.offset === c.len, `the setext heading: the end of its text line: ${JSON.stringify(c)}`);
  assert.equal((await editorState(page)).dirty, false, 'the jumps leave the editor clean');
  // Leaving the note: the file is untouched, the callout still folded in the file.
  await goToQuery(page, TITLE[P.plan]);
  await page.keyboard.press('Enter');
  await mustBeOn(page, TITLE[P.plan], 'leave Okraje');
  await sleep(500);
  assert.equal((await core.files())[P.okraje], original(P.okraje), 'Okraje is untouched');
  assert.ok((await core.files())[P.okraje]?.includes('> [!tip]- Sbalený callout'), 'it still contains `> [!tip]- Sbalený callout`');
  assert.deepEqual(await core.writesTo(), [], 'nothing was written');

  // A stale row with the outline refresh held (D-1640).
  const { p } = await another(page, noteRoute(P.okraje));
  await eventually(() => outlineRows(p), (r) => r.length === 11);
  const stale = await cardRowFor(p, 'Poznámky', 2);
  await hold(p, true);
  const last = await must(headingEl(p, 'Poznámky', 2), 'the last ## Poznámky');
  await selectText(last, 'Poznámky');
  await p.keyboard.press('Backspace');
  await p.keyboard.press('Backspace');
  await sleep(100);
  assert.equal(await headingEl(p, 'Poznámky', 2).count(), 0, 'setup: the last Poznámky heading is gone from the editor');
  assert.equal((await outlineRows(p)).length, 11, 'setup: the held outline still lists the heading');
  assert.ok(await seen(stale, 300), 'setup: the card still shows its row');
  const before = { c: await caret(p), s: (await mainScroll(p)).top };
  await pauseClock(p);
  await stale.click();
  await runFor(p, 20);
  assert.deepEqual({ c: await caret(p), s: (await mainScroll(p)).top }, before, 'a click on the stale row does nothing (caret and scroll unchanged)');
  await runFor(p, 250);
  const r = await outlineRows(p);
  assert.equal(r.filter((x) => x.label === 'Poznámky').length, 2, 'the outline is refreshed within 250 ms (two Poznámky left)');
  await p.clock.resume();
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-12

test('fr_edt_11_ac12_outline_in_the_source_view', async ({ page }) => {
  await startOutline(page, noteRoute(P.plan));
  await eventually(() => outlineRows(page), (r) => r.length === 11);
  await page.keyboard.press('Alt+Meta+u');
  const src = await must(sourceView(page), 'the source view (⌥⌘U)');
  await sleep(300);
  assert.deepEqual((await eventually(() => outlineRows(page), (r) => r.length === 11)).map((x) => [x.label, Number(x.level)]),
    [['Cíle', 1], ['Co od toho chceme', 2], ['Kdo jede', 2], ['Program', 1], ['Den 1', 2], ['Ráno: strategie', 3], ['Odpoledne: plán', 3], ['Den 2', 2], ['Logistika', 1], ['Cesta', 2], ['Rozpočet', 2]],
    'the source view lists the same 11 rows');
  await src.focus().catch(() => {});
  const sel0 = await page.evaluate(() => { const s = window.getSelection(); return s && s.rangeCount ? `${s.anchorNode?.textContent?.slice(0, 20)}|${s.anchorOffset}|${s.toString()}` : null; });
  const focus0 = await page.evaluate(() => !!document.activeElement?.closest('[aria-label="Markdown source"]') || document.activeElement?.getAttribute('aria-label') === 'Markdown source');
  const den = await cardRowFor(page, 'Den 1');
  await pauseClock(page);
  await den.click();
  await runFor(page, 20);
  const line = sourceLine(page, '## Den 1');
  const top = await topIn(line);
  assert.ok(near(top, 24, 2), `the source line \`## Den 1\` is 24 ± 2 px below the viewport's top (${top})`);
  assert.ok(await line.evaluate((e) => e.hasAttribute('data-outline-flash')), 'the line has data-outline-flash');
  await runFor(page, 1880);
  assert.ok(await line.evaluate((e) => e.hasAttribute('data-outline-flash')), 'still at 1,900 ms');
  await runFor(page, 200);
  assert.ok(!(await line.evaluate((e) => e.hasAttribute('data-outline-flash'))), 'gone at 2,100 ms');
  await page.clock.resume();
  const sel1 = await page.evaluate(() => { const s = window.getSelection(); return s && s.rangeCount ? `${s.anchorNode?.textContent?.slice(0, 20)}|${s.anchorOffset}|${s.toString()}` : null; });
  assert.equal(sel1, sel0, 'no caret placed and no selection changed');
  const focus1 = await page.evaluate(() => !!document.activeElement?.closest('[aria-label="Markdown source"]') || document.activeElement?.getAttribute('aria-label') === 'Markdown source');
  assert.equal(focus1, focus0, 'the focus stays in the source view');
  assert.deepEqual(await currentRows(page), ['Den 1'], 'the current section follows the line tops');
  await page.keyboard.press('Alt+Meta+u');
  await must(editorBody(page), 'back in the editor');
  await sleep(300);
  assert.deepEqual(await eventually(() => currentRows(page), (c) => c[0] === 'Den 1'), ['Den 1'], 'toggling back keeps the reading position (D-146)');
  const { p } = await another(page, noteRoute(P.rozbita));
  await must(sourceView(p), 'Rozbitá opens in the source view (NFR-REL-03)');
  const r = await eventually(() => outlineRows(p), (x) => x.length === 2);
  assert.deepEqual(r.map((x) => [x.label, Number(x.level)]), [['První v rozbité', 1], ['Druhý v rozbité', 2]], 'Rozbitá lists První v rozbité and Druhý v rozbité, nothing from its broken frontmatter');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-19

test('fr_edt_11_ac19_heading_link_lands_where_the_outline_jumps', async ({ page }) => {
  await startOutline(page, noteRoute(P.odkazy), { panel: null });
  const link = await must(editorBody(page).getByRole('link').first(), 'the link [[Čtenářské poznámky#Zpoždění replikace]]');
  await link.click();
  await mustBeOn(page, TITLE[P.cten], 'following the heading link opens Čtenářské');
  const top = await eventually(() => headingTop(page, 'Zpoždění replikace'), (t) => near(t, 24, 2), 3000);
  assert.ok(near(top, 24, 2), `the heading's top is 24 ± 2 px below the viewport's top, as the outline's jump (${top})`);
  const h = await hook<{ text: string; from: number }[]>(page, 'headings');
  assert.ok(h, '__TEGG_TEST__.outline.headings() exists (v1-outline §10)');
  const z = h!.find((x) => x.text === 'Zpoždění replikace');
  assert.equal(z?.from, original(P.cten).indexOf('## Zpoždění replikace'), 'the outline resolves Zpoždění replikace to the same `from` offset');
  assert.equal(await headingEl(page, 'Zpoždění replikace').evaluate((e) => e.hasAttribute('data-outline-flash')), false, 'a link follow doesn\'t flash (D-1625)');
});

// ------------------------------------------------------------------------------------------------ FR-NAV-03 AC-15

async function introCaretAt5(page: Page, what: string) {
  const c = await eventually(() => caret(page), (x) => !!x && x.block.startsWith('Poznámky z dlouhé knihy') && x.offset === 5);
  assert.ok(c && c.block.startsWith('Poznámky z dlouhé knihy') && c.offset === 5 && c.collapsed, `${what}: the caret at offset 5 of the intro: ${JSON.stringify(c)}`);
  assert.ok(c?.focused, `${what}: the focus in the Note body`);
}
async function atHeading(page: Page, text: string, what: string, shown = text) {
  const top = await eventually(() => headingTop(page, shown), (t) => near(t, 24, 2));
  assert.ok(near(top, 24, 2), `${what}: ${shown} at 24 ± 2 px (${top})`);
  const c = await caret(page);
  assert.ok(c && c.block === shown && c.offset === c.len, `${what}: the caret at the end of ${shown}: ${JSON.stringify(c)}`);
}

test('fr_nav_03_ac15_outline_jump_is_a_back_entry', async ({ page }) => {
  const core = await startOutline(page, 'search', { wait: false });
  await goToQuery(page, TITLE[P.cten]);
  await page.keyboard.press('Enter');
  await mustBeOn(page, TITLE[P.cten], 'Čtenářské opened from search');
  await eventually(() => outlineRows(page), (r) => r.length > 0);
  await setScroll(page, 0);
  await placeCaret(await must(introPara(page), 'intro'), 5);
  const nav0 = await count(core, 'nav_opened');
  const reads0 = await count(core, 'note_read');
  await jumpVia(page, 'Zpoždění replikace');
  await atHeading(page, 'Zpoždění replikace', 'the jump');
  assert.ok(await enabled(page, 'Back'), 'the jump enables the title-bar Back');
  assert.equal(await count(core, 'nav_opened'), nav0, 'nav_opened isn\'t called');
  await page.keyboard.press('Meta+BracketLeft');
  await sleep(200);
  assert.ok(near((await mainScroll(page)).top, 0, 1), '⌘[ restores scrollTop 0 (± 1 px)');
  await introCaretAt5(page, '⌘[');
  await mustBeOn(page, TITLE[P.cten], '⌘[ stays on Čtenářské (no route change)');
  assert.equal(await count(core, 'note_read'), reads0, 'no note_read');
  await page.keyboard.press('Meta+BracketRight');
  await atHeading(page, 'Zpoždění replikace', '⌘]');
  await page.keyboard.press('Meta+BracketLeft');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Search', '⌘[ twice from there shows search');
  await page.keyboard.press('Meta+BracketRight');
  await mustBeOn(page, TITLE[P.cten], '⌘] back to Čtenářské');
  await sleep(300);
  const orig = (await mainScroll(page)).top;
  // Two jumps.
  await jumpVia(page, 'Transakce');
  await atHeading(page, 'Transakce', 'jump to Transakce');
  await jumpVia(page, 'Proudy');
  await atHeading(page, 'Proudy', 'jump to Proudy');
  // A jump to where the caret already is, the heading already at 24 px: no entry.
  await jumpVia(page, 'Proudy');
  await sleep(200);
  await page.keyboard.press('Meta+BracketLeft');
  await atHeading(page, 'Transakce', '⌘[ after two jumps (the repeated Proudy jump added no entry)');
  await page.keyboard.press('Meta+BracketLeft');
  await sleep(200);
  assert.ok(near((await mainScroll(page)).top, orig, 1), '⌘[ again: the original place');
  // A jump after ⌘[ drops the forward entries.
  await jumpVia(page, 'Závěr');
  await atHeading(page, 'Závěr', 'jump after ⌘[');
  assert.equal(await enabled(page, 'Forward'), false, 'the forward entries are dropped');
  // By ⌘J ⏎.
  await page.keyboard.press('Meta+j');
  await must(page.getByRole('dialog', { name: 'Outline', exact: true }), 'the card (⌘J)');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(300);
  const placeAfterCard = (await mainScroll(page)).top;
  await page.keyboard.press('Meta+BracketLeft');
  await atHeading(page, 'Závěr', '⌘J ⏎ is a Back entry like a click in the card');
  assert.notEqual(placeAfterCard, (await mainScroll(page)).top, 'the card jump had moved the note');
});

// ------------------------------------------------------------------------------------------------ FR-NAV-03 AC-16

test('fr_nav_03_ac16_back_after_edits', async ({ page }) => {
  const core = await ctenAtIntro(page);
  await jumpVia(page, 'Zpoždění replikace');
  await atHeading(page, 'Zpoždění replikace', 'the jump');
  await page.keyboard.type(' X');
  // Let the autosave of ` X` happen first, so any later write would be Back's.
  const saved = await eventually(() => core.writesTo(), (w) => w.length > 0, 5000);
  assert.ok(saved.length > 0, 'setup: the typed ` X` is saved on its own schedule');
  const writes0 = (await core.writesTo()).length;
  const depth0 = (await editorState(page)).depth;
  await page.keyboard.press('Meta+BracketLeft');
  await introCaretAt5(page, 'typing ` X` into the heading, then ⌘[ (the edit is below it)');
  assert.equal((await editorState(page)).depth, depth0, 'Back adds no undo step');
  await page.keyboard.press('Meta+BracketRight');
  await atHeading(page, 'Zpoždění replikace', '⌘] to the jump\'s entry', 'Zpoždění replikace X');
  // Čtenářské → Plán → ⌘[: the scroll of the jump's entry, the caret at the heading's end.
  await goToQuery(page, TITLE[P.plan]);
  await page.keyboard.press('Enter');
  await mustBeOn(page, TITLE[P.plan], 'Plán from Search');
  await page.keyboard.press('Meta+BracketLeft');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, TITLE[P.cten], '⌘[ back to Čtenářské (over the Search entry, D-1348)');
  await atHeading(page, 'Zpoždění replikace', 'Čtenářské shown again at the jump\'s entry (app-shell AC-4)', 'Zpoždění replikace X');
  await sleep(500);
  assert.equal((await core.writesTo()).length, writes0, 'Back never writes');
  assert.equal((await editorState(page)).dirty, false, 'nothing unsaved after the steps');

  // A fresh window: the intro is deleted after the jump.
  const { p } = await another(page, noteRoute(P.cten));
  await eventually(() => outlineRows(p), (r) => r.length > 0);
  await setScroll(p, 0);
  await placeCaret(await must(introPara(p), 'intro'), 5);
  await jumpVia(p, 'Zpoždění replikace');
  await atHeading(p, 'Zpoždění replikace', 'second window: the jump');
  const intro = await must(introPara(p), 'intro');
  await selectText(intro, 'Poznámky z dlouhé knihy o datových systémech.');
  await p.keyboard.press('Backspace');
  await p.keyboard.press('Delete');
  await sleep(150);
  assert.ok(!((await editorState(p)).text ?? '').includes('Poznámky z dlouhé knihy'), 'setup: the intro paragraph is deleted');
  const d1 = (await editorState(p)).depth;
  await p.keyboard.press('Meta+BracketLeft');
  await sleep(300);
  const c = await caret(p);
  const first = await editorBody(p).evaluate((b) => (b.firstElementChild?.textContent ?? '').normalize('NFC').trim());
  assert.ok(c && c.offset === 0 && c.focused && c.block === first, `nothing precedes the deleted intro: the caret at the start of the body (${first}): ${JSON.stringify(c)}`);
  assert.equal((await editorState(p)).depth, d1, 'Back adds no undo step');
});
