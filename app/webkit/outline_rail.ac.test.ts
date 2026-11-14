// Slice OL, L5 (WebKit + fake core): the edge rail and its card (docs/acceptance/outline.md R173; FR-EDT-16 as D-1600 made
// it): AC-1 (when it shows), AC-2 (narrow windows, the separator drag), AC-3 (place and line sizes, the text clearance),
// AC-4 (line states, the same current section as the hook), AC-5 (the rows in a long note), AC-7 (hover timings), AC-8
// (the card's rows, chevrons and geometry), AC-9 (jumps from the rail and the card), AC-10 (beside the panel, the fade-in;
// no fade-out, D-1675), AC-11 (the card by keyboard), AC-12 (live updates), AC-13 (many top-level headings).
// Interface docs/contracts/v1-outline.md §3.6, §3.7, §3.8, §6.1, §10; helpers outline-helpers.ts. Playwright's clock
// drives the 150, 250 and 300 ms timings. Written from the ACs and the contract only (D-61). Every lookup goes through
// `must` and node:assert (TS-I1).
//
// Red-test point (reported, not decided): whether `i[data-outline-line]` is the drawn stroke or its 8.5 px pointer slot
// isn't fixed by §3.7; `railLines` measures the element when it is ≤ 3 px high, else its `::before`.
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  CTEN_H1, ID, P, ZONE, animationsOf, another, backlinksTab, box, card, cardRow, cardRows, cardTree, caret, ctxPanel, editorBody, editorState, eventually, flat,
  graphTab, headingEl, headingTop, hook, hoverRail, liveRegion, mainScroll, must, noteRoute, openCardByHover, pauseClock, placeCaret, pointerToNote, rail,
  railLines, runFor, scrollHeadingTo, seen, separator, setScroll, sleep, startOutline, tokenColor,
} from './outline-helpers';

test.use({ timezoneId: ZONE, locale: 'cs-CZ' });

const shown = async (page: Page, ms = 1500) => seen(rail(page), ms);
const none = async (page: Page, ms = 600) => { await sleep(ms); return (await rail(page).count()) === 0; };
const near = (a: number | null | undefined, b: number, tol: number) => typeof a === 'number' && Math.abs(a - b) <= tol;
async function rects(page: Page) {
  return page.evaluate(() => {
    const r = (s: string) => { const e = document.querySelector(s) as HTMLElement | null; if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
    return { centre: r('div.centre'), main: r('main'), rail: r('[data-outline-rail]:not(.centre)'), card: r('[data-outline-card]'), sep: r('[role="separator"]') };
  });
}
/** The note column's computed width and paddings. */
async function column(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector('.note-column') as HTMLElement | null;
    if (!c) return null;
    const s = getComputedStyle(c);
    return { w: c.getBoundingClientRect().width, pl: s.paddingLeft, pr: s.paddingRight };
  });
}

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-1

test('fr_edt_16_ac1_when_the_rail_shows', async ({ page }) => {
  await startOutline(page, noteRoute(P.plan), { panel: null });
  const r = await must(rail(page), 'Plán, panel closed: the rail ([data-outline-rail])');
  assert.equal(await r.getAttribute('aria-hidden'), 'true', 'aria-hidden="true"');
  const { p: dva } = await another(page, noteRoute(P.dva), { panel: null });
  assert.ok(await shown(dva), 'Dva nadpisy (2 headings) shows the rail');
  for (const note of [P.jeden, P.bez]) {
    const { p: on } = await another(page, noteRoute(note), { panel: null });
    assert.ok(await none(on), `${note}: no rail`);
    const { p: offP } = await another(page, noteRoute(note), { panel: null, rail: false });
    await sleep(300);
    assert.deepEqual(await column(on), await column(offP), `${note}: the note column's width and padding equal those with the rail switched off (no space reserved)`);
    assert.notEqual(await column(on), null, `${note}: a .note-column exists`);
  }
  const { p: bl } = await another(page, noteRoute(P.plan), { panel: 'backlinks' });
  assert.ok(await shown(bl), 'panel on Backlinks: the rail shows');
  const { p: gr } = await another(page, noteRoute(P.plan), { panel: 'graph' });
  assert.ok(await shown(gr), 'panel on Graph: the rail shows');
  // D-1675: a remembered `outline` tab (the removed Outline tab) shows Backlinks, and the rail.
  const { p: ol } = await another(page, noteRoute(P.plan), { extra: { rightPanel: { open: true, tab: 'outline', width: 288 } } });
  assert.ok(await shown(ol), 'a remembered outline tab: the rail shows');
  const sel = await ctxPanel(ol).getByRole('tab', { selected: true }).allInnerTexts();
  assert.deepEqual(sel.map((t) => flat(t).replace(/\s*\d+$/, '')), ['Backlinks'], 'and the panel shows Backlinks');
  await page.keyboard.press('Meta+Shift+Backslash');
  assert.ok(await none(page), 'focus mode (⌘⇧\\): no rail');
  await page.keyboard.press('Meta+Shift+Backslash');
  assert.ok(await shown(page), 'leaving focus mode brings it back');
  const { p: offR } = await another(page, noteRoute(P.plan), { panel: null, rail: false });
  assert.ok(await none(offR), '`Show outline rail` off: no rail');
  const { p: day } = await another(page, 'daily/2026-11-12', { panel: null });
  assert.ok(await shown(day), 'daily/2026-11-12 shows the rail');
  const { p: draft } = await another(page, 'new/page', { panel: null });
  await (await must(editorBody(draft), 'new/page: the body')).click();
  await draft.keyboard.type('## Jedna');
  await draft.keyboard.press('Enter');
  await draft.keyboard.type('## Dvě');
  assert.ok(await shown(draft, 2000), 'a new/page draft with 2 headings shows the rail');
  for (const route of ['search', 'tasks', 'type/page', 'tag/štítek', 'inbox', `graph/${P.plan}`]) {
    const { p } = await another(page, route, { panel: null, wait: false });
    assert.ok(await none(p, 900), `${route}: no rail`);
    await p.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-2

test('fr_edt_16_ac2_rail_hides_below_640_px', async ({ page }) => {
  await startOutline(page, noteRoute(P.plan), { panel: 'backlinks', viewport: { width: 1160, height: 900 } });
  assert.ok(near((await rects(page)).centre?.w, 640, 1), `setup: the centre pane is 640 px (${(await rects(page)).centre?.w})`);
  assert.ok(await shown(page), '1,160 × 900 with the panel at 288 px (640 px): the rail shows');
  await page.setViewportSize({ width: 1159, height: 900 });
  assert.ok(await none(page), '1,159 (639 px): no rail');
  await page.setViewportSize({ width: 1000, height: 900 });
  assert.ok(await none(page), '1,000 × 900 with the panel open (480 px): no rail');
  await page.keyboard.press('Meta+Backslash');
  assert.ok(await shown(page), '1,000 × 900 with the panel closed (768 px): the rail shows');
  // The separator drag at 1,200: hidden once the panel passes 328 px.
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.keyboard.press('Meta+Backslash');
  const sep = await must(separator(page), 'separator "Resize panel"');
  const s = (await sep.boundingBox())!;
  const x0 = s.x + s.width / 2, y0 = s.y + s.height / 2;
  const width0 = (await box(page.getByRole('complementary', { name: 'Context panel' })))!.width;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 - (240 - width0) - 0, y0, { steps: 4 });
  await page.mouse.move(x0 - (320 - width0), y0, { steps: 6 });
  assert.ok(await shown(page, 800), 'dragging: at 320 px (centre 648) the rail shows');
  await page.mouse.move(x0 - (340 - width0), y0, { steps: 4 });
  assert.ok(await none(page, 400), 'past 328 px (centre < 640): the rail hides while dragging');
  await page.mouse.move(x0 - (480 - width0), y0, { steps: 8 });
  await page.mouse.move(x0 - (300 - width0), y0, { steps: 8 });
  assert.ok(await shown(page, 800), 'back below 328 px: it shows again');
  await page.mouse.up();
  // A card open when the rail hides closes; ⌘J still opens the card while the rail is hidden (AC-11).
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCardByHover(page);
  await page.setViewportSize({ width: 1000, height: 900 });
  assert.ok(await none(page, 400), 'setup: the rail hides at 1,000 with the panel open');
  assert.equal(await card(page).count(), 0, 'the open card closes when the rail hides');
  await placeCaret(await must(headingEl(page, 'Cíle'), 'heading Cíle'), 'end');
  await page.keyboard.press('Meta+j');
  assert.ok(await seen(card(page), 1500), '`Outline: jump to heading…` (⌘J) still opens the card while the rail is hidden');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-3

const ARCH_W = [18, 13, 9, 7, 5, 4, 4, 7, 9, 7, 7, 13, 9, 9, 18, 13, 9, 13];

test('fr_edt_16_ac3_rail_place_and_line_sizes', async ({ page }) => {
  await startOutline(page, noteRoute(P.arch), { panel: null });
  await must(rail(page), 'Architektura: the rail');
  for (const at of [0, 'mid', 'end'] as const) {
    if (at === 'mid') { const s = await mainScroll(page); await setScroll(page, Math.round((s.height - s.client) / 2)); } else await setScroll(page, at);
    const g = await rects(page);
    assert.ok(g.rail && g.centre && g.main, 'the rail, div.centre and main have boxes');
    assert.ok(near(g.rail!.r, g.centre!.r - 14, 1), `${at}: the rail box's right edge is 14 ± 1 px left of the centre pane's right edge (${g.rail!.r} vs ${g.centre!.r})`);
    assert.ok(near((g.rail!.t + g.rail!.b) / 2, (g.main!.t + g.main!.b) / 2, 1), `${at}: its vertical centre is the viewport's centre ± 1`);
  }
  const l = await railLines(page);
  assert.equal(l.length, 18, '18 lines');
  l.forEach((x, i) => assert.ok(near(x.w, ARCH_W[i], 0.5), `line ${i + 1}: width ${x.w} = ${ARCH_W[i]} ± 0.5`));
  const right = l[0].right;
  for (const x of l) assert.ok(near(x.right, right, 0.5), 'right-aligned');
  for (let i = 1; i < l.length; i++) assert.ok(near(l[i].top - l[i - 1].bottom, 7, 0.5), `7 ± 0.5 px between lines ${i} and ${i + 1} (${(l[i].top - l[i - 1].bottom).toFixed(2)})`);
  // With the panel open on Backlinks: 14 px left of the separator.
  const { p } = await another(page, noteRoute(P.arch), { panel: 'backlinks' });
  await must(rail(p), 'the rail beside the panel');
  const g = await rects(p);
  assert.ok(g.sep && g.rail && near(g.rail.r, g.sep.l - 14, 1.5), `panel open: the box's right edge is 14 px left of the panel's separator (${g.rail?.r} vs ${g.sep?.l})`);
  // The clearance at centre widths 640, 700, 920 and 1,208, in Normal and Wide.
  for (const width of ['normal', 'wide'] as const) {
    const { p: q } = await another(page, noteRoute(P.arch), { panel: null, noteWidth: width === 'wide' ? { [ID('02')]: 'wide' } : undefined });
    for (const cw of [640, 700, 920, 1208]) {
      await q.setViewportSize({ width: cw + 232, height: 900 });
      await sleep(250);
      const gg = await rects(q);
      assert.ok(near(gg.centre?.w, cw, 1), `setup: centre pane ${cw} (${gg.centre?.w})`);
      assert.ok(await seen(rail(q), 1000), `${width} ${cw}: the rail shows`);
      const textRight = await editorBody(q).evaluate((b) => Math.max(...([...b.children] as HTMLElement[]).map((c) => c.getBoundingClientRect().right)));
      assert.ok(gg.centre!.r - textRight >= 44 - 0.5, `${width} ${cw}: the Note body text's right edge is ≥ 44 px left of the centre pane's right edge (${(gg.centre!.r - textRight).toFixed(1)})`);
    }
    await q.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-4

test('fr_edt_16_ac4_rail_line_states', async ({ page }) => {
  await startOutline(page, noteRoute(P.plan), { panel: null });
  await must(rail(page), 'Plán: the rail');
  const [text, muted, faint] = [await tokenColor(page, '--text'), await tokenColor(page, '--muted'), await tokenColor(page, '--faint')];
  await setScroll(page, 0);
  const l0 = await railLines(page);
  assert.equal(l0.length, 11, '11 lines');
  for (const x of l0) assert.deepEqual([near(x.h, 1.5, 0.1), x.color], [true, faint], `scrollTop 0: line ${x.index} is 1.5 px --faint`);
  await scrollHeadingTo(page, 'Ráno: strategie', 4);
  const l1 = await eventually(() => railLines(page), (l) => l.some((x) => x.state === 'current'));
  const NAMES = ['Cíle', 'Co od toho chceme', 'Kdo jede', 'Program', 'Den 1', 'Ráno: strategie', 'Odpoledne: plán', 'Den 2', 'Logistika', 'Cesta', 'Rozpočet'];
  l1.forEach((x, i) => {
    const want = NAMES[i] === 'Ráno: strategie' ? [2, text, 'current'] : ['Program', 'Den 1'].includes(NAMES[i]) ? [2, muted, 'ancestor'] : [1.5, faint, 'rest'];
    assert.deepEqual([near(x.h, want[0] as number, 0.1), x.color, x.state], [true, want[1], want[2]], `Ráno: strategie current: ${NAMES[i]} is ${want[0]} px ${want[2]}`);
  });
  await setScroll(page, 'end');
  const l2 = await eventually(() => railLines(page), (l) => l[10]?.state === 'current');
  assert.deepEqual([near(l2[10]?.h, 2, 0.1), l2[10]?.color], [true, text], 'at the end Rozpočet\'s line is 2 px --text');
  // The same current section as the outline's (`__TEGG_TEST__.outline.current()`), at 10 positions, beside Backlinks.
  const { p } = await another(page, noteRoute(P.plan), { panel: 'backlinks' });
  await must(rail(p), 'Plán beside Backlinks: the rail');
  const s = await mainScroll(p);
  const bad: string[] = [];
  for (let k = 0; k < 10; k++) {
    await setScroll(p, Math.round(((s.height - s.client) * k) / 9));
    await sleep(150);
    const railCur = (await railLines(p)).find((x) => x.state === 'current')?.index ?? null;
    const hookCur = await hook<number | null>(p, 'current');
    if (railCur !== hookCur) bad.push(`position ${k}: rail ${railCur}, outline ${hookCur}`);
  }
  assert.deepEqual(bad, [], 'at every scroll position the rail\'s current line is the outline\'s current section');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-5

test('fr_edt_16_ac5_rail_rows_in_a_long_note', async ({ page }) => {
  await startOutline(page, noteRoute(P.cten), { panel: null });
  await must(rail(page), 'Čtenářské: the rail');
  const heads = await hook<{ text: string }[]>(page, 'headings');
  assert.ok(heads && heads.length === 51, '__TEGG_TEST__.outline.headings() lists 51 headings');
  const lineNames = async () => (await railLines(page)).map((x) => heads![x.index]?.text ?? `#${x.index}`);
  const REP = ['Vedoucí a následovníci', 'Zpoždění replikace', 'Bez vedoucího'];
  const withAfter = (anchor: string, extra: string[]) => { const out = [...CTEN_H1]; out.splice(out.indexOf(anchor) + 1, 0, ...extra); return out; };
  const cases: [string, number | 'end', number, string[]][] = [
    ['nothing current', 0, 12, CTEN_H1],
    ['Replikace', 0, 15, withAfter('Replikace', REP)],
    ['Zpoždění replikace', 0, 16, withAfter('Replikace', ['Vedoucí a následovníci', 'Zpoždění replikace', 'Příklady', 'Bez vedoucího'])],
    ['Kompromisy', 0, 17, withAfter('Replikace', ['Vedoucí a následovníci', 'Příklady', 'Kompromisy', 'Zpoždění replikace', 'Bez vedoucího'])],
    ['Další čtení', 'end', 15, withAfter('Závěr', ['Shrnutí', 'Otevřené otázky', 'Další čtení'])],
  ];
  for (const [cur, at, n, want] of cases) {
    if (cur === 'nothing current') await setScroll(page, 0);
    else if (at === 'end') await setScroll(page, 'end');
    else await scrollHeadingTo(page, cur, 4);
    const got = await eventually(lineNames, (x) => x.length === n);
    assert.equal(got.length, n, `${cur}: ${n} lines`);
    assert.deepEqual(got, want, `${cur}: the README's rows in note order`);
    const idx = (await railLines(page)).map((x) => x.index);
    assert.deepEqual(await hook<number[]>(page, 'railRows'), idx, `${cur}: __TEGG_TEST__.outline.railRows() equals the DOM`);
  }
  await scrollHeadingTo(page, 'Replikace', 4);
  await eventually(lineNames, (x) => x.length === 15);
  await scrollHeadingTo(page, 'Transakce', 4);
  const tr = await eventually(lineNames, (x) => x.includes('ACID'));
  assert.ok(!REP.some((t) => tr.includes(t)), 'scrolling into Transakce removes Replikace\'s 3 H2 lines');
  assert.deepEqual(tr, withAfter('Transakce', ['ACID', 'Slabá izolace', 'Serializovatelnost']), 'and adds Transakce\'s');
  for (const [note, n] of [[P.arch, 18], [P.plan, 11]] as const) {
    const { p } = await another(page, noteRoute(note), { panel: null });
    await must(rail(p), `${note}: the rail`);
    for (const at of [0, 'end'] as const) {
      await setScroll(p, at);
      assert.equal((await railLines(p)).length, n, `${note} at ${at}: every heading (${n})`);
    }
  }
});

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-7

test('fr_edt_16_ac7_hover_opens_and_closes_the_card', async ({ page }) => {
  await startOutline(page, noteRoute(P.plan), { panel: null });
  await must(rail(page), 'Plán: the rail');
  await placeCaret(await must(editorBody(page).locator('p').nth(2), 'a paragraph'), 7);
  const c0 = await caret(page);
  await pauseClock(page);
  await hoverRail(page);
  await runFor(page, 140);
  assert.equal(await card(page).count(), 0, 'no card at 140 ms');
  await runFor(page, 26);
  assert.equal(await card(page).count(), 1, 'the dialog Outline is there at 150 ms (± 1 frame)');
  assert.deepEqual(await caret(page), c0, 'a card opened by hover leaves the focus and the selection in the editor unchanged');
  await pointerToNote(page);
  await runFor(page, 290);
  assert.equal(await card(page).count(), 1, 'leaving for the note: open at 290 ms');
  await runFor(page, 20);
  assert.equal(await card(page).count(), 0, 'gone at 310 ms');
  // Leaving and coming back onto the card at 200 ms keeps it open.
  await hoverRail(page);
  await runFor(page, 170);
  const cb = (await box(await must(card(page), 'the card')))!;
  await pointerToNote(page);
  await runFor(page, 200);
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2, { steps: 2 });
  await runFor(page, 400);
  assert.equal(await card(page).count(), 1, 'coming back onto the card at 200 ms keeps it open');
  // Moving from the rail onto the card keeps it open.
  await hoverRail(page);
  await runFor(page, 50);
  const rb = (await box(rail(page)))!;
  for (let x = rb.x; x > cb.x + cb.width / 2; x -= 6) { await page.mouse.move(x, rb.y + rb.height / 2); await page.clock.runFor(16); }
  await runFor(page, 400);
  assert.equal(await card(page).count(), 1, 'moving from the rail onto the card keeps it open');
  await pointerToNote(page);
  await runFor(page, 400);
  assert.equal(await card(page).count(), 0, 'setup: closed');
  // A pass shorter than 150 ms opens nothing.
  await page.mouse.move(rb.x + rb.width + 30, rb.y + rb.height / 2);
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 2 });
  await runFor(page, 100);
  await page.mouse.move(rb.x - 60, rb.y + rb.height / 2, { steps: 2 });
  await runFor(page, 400);
  assert.equal(await card(page).count(), 0, 'a pointer crossing the rail in 100 ms opens nothing');
  // The pointer on a line and on a card row light each other.
  const den = (await railLines(page))[4];
  await page.mouse.move(den.left + 2, (den.top + den.bottom) / 2, { steps: 2 });
  await runFor(page, 200);
  const hover = await tokenColor(page, '--hover'), text = await tokenColor(page, '--text');
  const lit = (await railLines(page))[4];
  assert.deepEqual([near(lit.h, 2, 0.1), lit.color], [true, text], 'the pointer on Den 1\'s line makes it 2 px --text');
  assert.equal((await cardRows(page)).find((x) => x.label === 'Den 1')?.bg, hover, 'and the card\'s Den 1 row --hover');
  await cardRow(page, 'Cesta').hover();
  await runFor(page, 50);
  const cesta = (await railLines(page))[9];
  assert.deepEqual([near(cesta.h, 2, 0.1), cesta.color, cesta.hover], [true, text, true], 'the pointer on the card\'s Cesta row lights Cesta\'s line');
  await page.clock.resume();
});

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-8

test('fr_edt_16_ac8_card_rows_and_chevrons', async ({ page }) => {
  await startOutline(page, noteRoute(P.arch), { panel: null });
  await must(rail(page), 'Architektura: the rail');
  await scrollHeadingTo(page, 'Názvy souborů', 4);
  await openCardByHover(page);
  const a = await eventually(() => cardRows(page), (r) => r.length === 18);
  assert.equal(a.length, 18, 'Architektura: 18 rows');
  assert.equal(a.filter((x) => x.chevron).length, 0, 'no chevron (V5)');
  assert.ok(a.find((x) => x.label === 'Názvy souborů')?.bar, 'the current row (Názvy souborů) has the bar');
  for (const t of ['Úložiště', 'Rozvržení trezoru', 'Složky podle typu', 'Denní poznámky']) assert.equal(a.find((x) => x.label === t)?.weight, '600', `its ancestor ${t} is weight 600`);
  assert.equal(a.filter((x) => x.hidden !== null).length, 0, 'no row shows a hidden count');
  // Čtenářské with Zpoždění replikace current.
  const { p } = await another(page, noteRoute(P.cten), { panel: null });
  await scrollHeadingTo(p, 'Zpoždění replikace', 4);
  await openCardByHover(p);
  const c = await eventually(() => cardRows(p), (r) => r.length === 16);
  assert.equal(c.length, 16, 'the 16 rows of the rail');
  const mid = await cardTree(p).evaluate((t) => {
    const sc = (function find(e: HTMLElement | null): HTMLElement | null { while (e && !(e.scrollHeight > e.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))) e = e.parentElement; return e; })(t as HTMLElement);
    const box = (sc ?? (t.closest('[data-outline-card]') as HTMLElement)).getBoundingClientRect();
    const r = t.querySelector('[aria-current="location"]') as HTMLElement | null;
    const rb = r?.getBoundingClientRect();
    return {
      off: rb ? Math.abs(rb.top + rb.height / 2 - (box.top + box.height / 2)) : Infinity, scrolls: !!sc, atLimit: !!sc && (sc.scrollTop <= 0 || sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 1),
      visible: !!rb && rb.top >= box.top - 0.5 && rb.bottom <= box.bottom + 0.5,
    };
  });
  assert.ok(mid.visible, `the current row is visible in the card: ${JSON.stringify(mid)}`);
  // Only a card that scrolls centres the current row; one that doesn't only shows it (D-1645, D-1654).
  if (mid.scrolls) assert.ok(mid.off <= 13 || mid.atLimit, `the card scrolls: the current row is scrolled to its middle (± 13 px) or the card is at its limit: ${JSON.stringify(mid)}`);
  const chev = c.filter((x) => x.chevron).map((x) => x.label);
  assert.deepEqual(chev, [...CTEN_H1.slice(0, 5), 'Vedoucí a následovníci', ...CTEN_H1.slice(6)], 'chevrons on the 11 H1 other than Replikace and on Vedoucí a následovníci: 12');
  await cardRow(p, 'Transakce').locator('[data-outline-chevron]').click();
  assert.equal((await eventually(() => cardRows(p), (r) => r.length === 19)).length, 19, 'Transakce\'s chevron adds its 3 H2 to the card (19 rows)');
  assert.equal((await eventually(() => railLines(p), (l) => l.length === 19)).length, 19, 'and to the rail (19 lines)');
  await pointerToNote(p);
  await sleep(500);
  assert.equal(await card(p).count(), 0, 'setup: the card closed');
  await openCardByHover(p);
  assert.equal((await eventually(() => cardRows(p), (r) => r.length === 16)).length, 16, 'reopened: 16 again');
  // Geometry.
  const g = await rects(p);
  assert.ok(g.card && g.centre && g.main, 'the card has a box');
  assert.ok(near(g.card!.w, 256, 0.5), `the card is 256 px wide (${g.card!.w})`);
  assert.ok(near(g.card!.r, g.centre!.r - 52, 1), `its right edge is 52 ± 1 px left of the centre pane's right edge (${g.card!.r} vs ${g.centre!.r})`);
  assert.ok(near((g.card!.t + g.card!.b) / 2, (g.main!.t + g.main!.b) / 2, 1), 'it is centred on the viewport');
  assert.ok(g.card!.h <= Math.min(520, 0.8 * g.main!.h) + 0.5, `its height ≤ min(520, 0.8 × viewport) (${g.card!.h})`);
  const ov = await card(p).evaluate((d) => [d, ...d.querySelectorAll('*')].some((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY)));
  assert.ok(ov, 'it scrolls inside');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-9

test('fr_edt_16_ac9_rail_and_card_jump', async ({ page }) => {
  const core = await startOutline(page, noteRoute(P.plan), { panel: null });
  await must(rail(page), 'Plán: the rail');
  await openCardByHover(page);
  await (await must(cardRow(page, 'Kdo jede'), 'the card\'s Kdo jede row')).click();
  assert.equal(await card(page).count(), 0, 'the jump closes the card at once');
  const top = await eventually(() => headingTop(page, 'Kdo jede'), (t) => near(t, 24, 2));
  assert.ok(near(top, 24, 2), `the card's row jumps as FR-EDT-11 AC-10: Kdo jede at 24 ± 2 px (${top})`);
  const c = await caret(page);
  assert.ok(c && c.block === 'Kdo jede' && c.offset === c.len && c.focused, `the caret at its end: ${JSON.stringify(c)}`);
  assert.ok(await headingEl(page, 'Kdo jede').evaluate((e) => e.hasAttribute('data-outline-flash')), 'the highlight');
  // A line click before the 150 ms hover delay also jumps.
  await setScroll(page, 0);
  await pointerToNote(page);
  await sleep(400);
  const kdo = (await railLines(page))[2];
  await page.mouse.click(kdo.left + 2, (kdo.top + kdo.bottom) / 2);
  const top2 = await eventually(() => headingTop(page, 'Kdo jede'), (t) => near(t, 24, 2));
  assert.ok(near(top2, 24, 2), `a click on Kdo jede's line jumps (${top2})`);
  assert.equal(await card(page).count(), 0, 'no card after the line jump');
  // A click in the note closes the card and places the caret where clicked.
  await openCardByHover(page);
  // A paragraph that is in the viewport after the line jump (D-1655).
  const inView = await editorBody(page).locator('p').evaluateAll((ps) => {
    const m = (document.querySelector('main') as HTMLElement).getBoundingClientRect();
    return ps.findIndex((e) => { const r = e.getBoundingClientRect(); return (e.textContent ?? '').trim().length > 0 && r.top >= m.top + 40 && r.bottom <= m.bottom - 10; });
  });
  assert.ok(inView >= 0, 'setup: a non-empty paragraph is in the viewport');
  const para = await must(editorBody(page).locator('p').nth(inView), 'a paragraph in the viewport');
  const pb = (await para.boundingBox())!;
  await page.mouse.click(pb.x + 30, pb.y + pb.height / 2);
  assert.ok(await eventually(async () => (await card(page).count()) === 0, (x) => x, 1000), 'a click in the note closes the card');
  const c2 = await caret(page);
  assert.ok(c2 && c2.focused && c2.block === flat(await para.innerText()), `and places the caret where clicked: ${JSON.stringify(c2)}`);
  assert.deepEqual(await core.writesTo(), [], 'no jump or close writes anything');
  assert.equal((await editorState(page)).dirty, false, 'the editor stays clean');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-10

/** The opacity transition an element declares (computed transition-property / transition-duration), or null. */
async function fadeOf(loc: Locator): Promise<{ ms: number } | null> {
  if ((await loc.count()) === 0) return null;
  return loc.first().evaluate((e) => {
    const cs = getComputedStyle(e);
    const props = cs.transitionProperty.split(',').map((x) => x.trim());
    const durs = cs.transitionDuration.split(',').map((x) => x.trim());
    const i = props.findIndex((x) => x === 'opacity' || x === 'all');
    if (i < 0) return null;
    const d = durs[i % durs.length] ?? '0s';
    const ms = d.endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000;
    return ms > 0 ? { ms: Math.round(ms) } : null;
  });
}
async function opacityOf(loc: Locator): Promise<number> {
  return loc.first().evaluate((e) => Number(getComputedStyle(e).opacity));
}

test('fr_edt_16_ac10_rail_beside_the_panel', async ({ page }) => {
  await startOutline(page, noteRoute(P.plan), { panel: 'backlinks' });
  await must(rail(page), 'the rail beside Backlinks');
  const g = await rects(page);
  assert.ok(g.rail && g.centre && g.rail.r <= g.centre.r && g.rail.l >= g.centre.l, 'the rail is inside the centre pane');
  await openCardByHover(page);
  const g2 = await rects(page);
  assert.ok(g2.card && g2.sep && near(g2.card.r, g2.sep.l - 52, 1.5), `the card's right edge is 52 ± 1 px left of the panel's separator (${g2.card?.r} vs ${g2.sep?.l})`);
  await pointerToNote(page);
  await sleep(500);
  // The fades are checked as declared (an opacity transition of 150 ms) plus their end state, not caught mid-way in real
  // time (D-1656).
  assert.deepEqual(await fadeOf(rail(page)), { ms: 150 }, 'the rail declares a 150 ms opacity transition');
  // D-1675: no panel tab hides the rail.
  await (await must(graphTab(page), 'tab Graph')).click();
  await sleep(300);
  assert.equal(await rail(page).count(), 1, 'choosing Graph keeps the rail');
  assert.equal(await opacityOf(rail(page)), 1, 'at opacity 1');
  await (await must(backlinksTab(page), 'tab Backlinks')).click();
  await page.keyboard.press('Meta+Backslash');
  await sleep(300);
  assert.equal(await rail(page).count(), 1, 'closing the panel with ⌘\\ keeps the rail');
  // Shown again (leaving focus mode): the fade-in; hidden (focus mode): removed at once, no fade-out.
  await page.keyboard.press('Meta+Shift+Backslash');
  assert.ok(await eventually(async () => (await rail(page).count()) === 0, (x) => x, 300), 'focus mode removes the rail at once (no fade-out)');
  await page.keyboard.press('Meta+Shift+Backslash');
  await must(rail(page), 'leaving focus mode shows the rail');
  assert.deepEqual(await fadeOf(rail(page)), { ms: 150 }, 'it fades in with the 150 ms opacity transition');
  assert.equal(await eventually(() => opacityOf(rail(page)), (o) => o === 1, 1000), 1, 'and ends at opacity 1');
  // Reduce motion: no transition.
  const { p } = await another(page, noteRoute(P.plan), { panel: 'backlinks', reducedMotion: 'reduce' });
  await must(rail(p), 'Reduce motion: the rail');
  await p.keyboard.press('Meta+Shift+Backslash');
  assert.ok(await eventually(async () => (await rail(p).count()) === 0, (x) => x, 300), 'Reduce motion: hiding removes it at once');
  await p.keyboard.press('Meta+Shift+Backslash');
  await must(rail(p), 'the rail again');
  assert.deepEqual(await animationsOf(rail(p)), [], 'showing runs no transition');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-11

const focusedRow = (page: Page) => page.evaluate(() => {
  const a = document.activeElement;
  return a?.getAttribute('role') === 'treeitem' ? { label: (a.getAttribute('aria-label') ?? '').normalize('NFC'), inCard: !!a.closest('[data-outline-card]') } : null;
});

test('fr_edt_16_ac11_card_by_keyboard', async ({ page }) => {
  await startOutline(page, noteRoute(P.plan), { panel: null });
  await must(rail(page), 'Plán: the rail');
  await placeCaret(await must(editorBody(page).locator('p').nth(1), 'the Cíle paragraph'), 4);
  await scrollHeadingTo(page, 'Den 1', 4);
  await eventually(() => railLines(page), (l) => l[4]?.state === 'current');
  const before = { c: await caret(page), s: (await mainScroll(page)).top };
  await page.keyboard.press('Meta+j');
  await must(card(page), '⌘J opens the card');
  assert.deepEqual(await focusedRow(page), { label: 'Den 1', inCard: true }, 'the focus on the treeitem Den 1');
  const den = (await cardRows(page)).find((x) => x.label === 'Den 1');
  assert.deepEqual([den?.bg, den?.bar], [await tokenColor(page, '--hover'), true], 'Den 1: --hover and the bar');
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await focusedRow(page), { label: 'Ráno: strategie', inCard: true }, '↓: Ráno: strategie');
  assert.equal((await mainScroll(page)).top, before.s, 'the note doesn\'t move');
  await page.keyboard.press('Enter');
  assert.equal(await card(page).count(), 0, '⏎ closes the card');
  assert.ok(near(await eventually(() => headingTop(page, 'Ráno: strategie'), (t) => near(t, 24, 2)), 24, 2), '⏎ jumps there');
  // Esc restores the selection and the scroll; ⌘J while open does the same.
  for (const key of ['Escape', 'Meta+j']) {
    await placeCaret(await must(editorBody(page).locator('p').nth(1), 'the Cíle paragraph'), 4);
    await scrollHeadingTo(page, 'Den 1', 4);
    const b = { c: await caret(page), s: (await mainScroll(page)).top };
    await page.keyboard.press('Meta+j');
    await must(card(page), '⌘J');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(key);
    assert.equal(await card(page).count(), 0, `${key} closes the card`);
    const a = { c: await caret(page), s: (await mainScroll(page)).top };
    assert.deepEqual(a.c, b.c, `${key}: the focus back in the Note body with the same selection`);
    assert.ok(a.c?.focused, `${key}: the Note body has the focus`);
    assert.ok(near(a.s, b.s, 1), `${key}: the same scrollTop (± 1)`);
  }
  // No current row: the first.
  await setScroll(page, 0);
  await sleep(150);
  await page.keyboard.press('Meta+j');
  await must(card(page), '⌘J at scrollTop 0');
  assert.deepEqual(await focusedRow(page), { label: 'Cíle', inCard: true }, 'no current row: ⌘J focuses the first row');
  await page.keyboard.press('Escape');
  // Čtenářské, Zpoždění replikace current.
  const { p } = await another(page, noteRoute(P.cten), { panel: null });
  await scrollHeadingTo(p, 'Zpoždění replikace', 4);
  await placeCaret(await must(headingEl(p, 'Zpoždění replikace'), 'heading'), 'end');
  await scrollHeadingTo(p, 'Zpoždění replikace', 4);
  await p.keyboard.press('Meta+j');
  await must(card(p), 'Čtenářské: ⌘J');
  for (let i = 0; i < 4; i++) await p.keyboard.press('ArrowDown');
  assert.deepEqual(await focusedRow(p), { label: 'Transakce', inCard: true }, '↓ ×4 reaches Transakce');
  await p.keyboard.press('ArrowRight');
  assert.equal((await eventually(() => cardRows(p), (r) => r.length === 19)).length, 19, '→ shows its 3 H2 (19 rows)');
  await p.keyboard.press('ArrowLeft');
  assert.equal((await eventually(() => cardRows(p), (r) => r.length === 16)).length, 16, '← hides them');
  await p.keyboard.press('ArrowLeft');
  assert.deepEqual(await focusedRow(p), { label: 'Transakce', inCard: true }, '← again stays (depth 1)');
  await p.keyboard.press('ArrowUp');
  await p.keyboard.press('ArrowUp');
  assert.deepEqual(await focusedRow(p), { label: 'Bez vedoucího', inCard: true }, 'setup: on Bez vedoucího');
  await p.keyboard.press('ArrowLeft');
  assert.deepEqual(await focusedRow(p), { label: 'Replikace', inCard: true }, 'on Bez vedoucího, ← goes to Replikace');
  // The panel open (D-1675: on any tab): ⌘J opens the card on the current row.
  const { p: o } = await another(page, noteRoute(P.plan), { panel: 'graph' });
  await scrollHeadingTo(o, 'Den 1', 4);
  await eventually(() => hook<number | null>(o, 'current'), (c) => c === 4);
  await placeCaret(await must(editorBody(o).locator('p').nth(1), 'paragraph'), 2);
  await scrollHeadingTo(o, 'Den 1', 4);
  await o.keyboard.press('Meta+j');
  await must(card(o), 'the panel on Graph: ⌘J opens the card');
  assert.deepEqual(await focusedRow(o), { label: 'Den 1', inCard: true }, 'the card\'s current row gets the focus');
  // Rail hidden: focus mode, and 1,000 px with the panel on Backlinks.
  const { p: f } = await another(page, noteRoute(P.plan), { panel: null });
  await f.keyboard.press('Meta+Shift+Backslash');
  await sleep(300);
  assert.equal(await rail(f).count(), 0, 'setup: focus mode hides the rail');
  await placeCaret(await must(editorBody(f).locator('p').nth(1), 'paragraph'), 2);
  await f.keyboard.press('Meta+j');
  assert.ok(await seen(card(f), 1500), 'focus mode: ⌘J opens the card');
  const fr = await rects(f);
  assert.ok(fr.card && fr.centre && near(fr.card.r, fr.centre.r - 52, 1), 'at its usual place');
  const { p: n } = await another(page, noteRoute(P.plan), { panel: 'backlinks', viewport: { width: 1000, height: 900 } });
  assert.equal(await rail(n).count(), 0, 'setup: 1,000 px with Backlinks hides the rail');
  await placeCaret(await must(editorBody(n).locator('p').nth(1), 'paragraph'), 2);
  await n.keyboard.press('Meta+j');
  assert.ok(await seen(card(n), 1500), '1,000 px with Backlinks: ⌘J opens the card');
  // No headings: the live region.
  const { p: b } = await another(page, noteRoute(P.bez), { panel: null });
  await placeCaret(await must(editorBody(b).locator('p').last(), 'paragraph'), 2);
  await b.keyboard.press('Meta+j');
  await sleep(300);
  assert.equal(await card(b).count(), 0, 'Bez nadpisů: ⌘J opens nothing');
  assert.equal(flat(await liveRegion(b).first().textContent({ timeout: 1000 }).catch(() => '')), 'No headings yet', 'the polite live region says `No headings yet`');
  assert.equal(await liveRegion(b).first().getAttribute('aria-live'), 'polite', 'aria-live="polite"');
  // Other routes.
  const { p: s } = await another(page, 'search', { panel: null, wait: false });
  await sleep(500);
  await s.keyboard.press('Meta+j');
  await sleep(300);
  assert.equal(await card(s).count(), 0, 'search: ⌘J does nothing');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-12

test('fr_edt_16_ac12_rail_follows_typing', async ({ page }) => {
  await startOutline(page, noteRoute(P.jeden), { panel: null });
  assert.equal(await rail(page).count(), 0, 'setup: Jeden has no rail');
  await placeCaret(await must(editorBody(page).locator('p').last(), 'the last paragraph'), 'end');
  await page.keyboard.press('Enter');
  await pauseClock(page);
  await page.keyboard.type('## Termíny');
  await runFor(page, 250);
  assert.equal((await railLines(page)).length, 2, 'typing a second heading: the rail appears with 2 lines within 250 ms');
  for (let i = 0; i < 30 && ((await editorState(page)).text ?? '').includes('Termíny'); i++) { await page.keyboard.press('Meta+z'); await page.clock.runFor(5); }
  await runFor(page, 250);
  assert.equal(await rail(page).count(), 0, '⌘Z removes it within 250 ms');
  await page.clock.resume();
  // The card open on Plán while typing at the end.
  const { p } = await another(page, noteRoute(P.plan), { panel: null });
  await placeCaret(await must(editorBody(p).locator('p').last(), 'Plán\'s last paragraph'), 'end');
  await openCardByHover(p);
  const cb = (await box(card(p)))!;
  await p.mouse.move(cb.x + cb.width / 2, cb.y + 10);
  await pauseClock(p);
  await p.keyboard.press('Enter');
  await p.keyboard.type('## Rezervy');
  await runFor(p, 250);
  assert.ok((await cardRows(p)).some((x) => x.label === 'Rezervy'), 'with the card open, `## Rezervy` adds its row within 250 ms');
  assert.equal((await railLines(p)).length, 12, 'and its line');
  await p.clock.resume();
});

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-13

test('fr_edt_16_ac13_many_top_level_headings', async ({ page }) => {
  await startOutline(page, noteRoute(P.sedesat), { panel: null });
  await must(rail(page), 'Šedesát kapitol: the rail');
  const l = await railLines(page);
  assert.equal(l.length, 60, '60 lines');
  for (let i = 1; i < l.length; i++) assert.ok(l[i].top - l[i - 1].bottom >= 2 - 0.05, `a gap of at least 2 px (${i}: ${(l[i].top - l[i - 1].bottom).toFixed(2)})`);
  const s = await mainScroll(page);
  assert.ok(l[l.length - 1].bottom - l[0].top <= s.client - 48 + 0.5, `the whole rail within the viewport's height − 48 (${(l[l.length - 1].bottom - l[0].top).toFixed(1)} ≤ ${s.client - 48})`);
  const { p } = await another(page, noteRoute(P.triSta), { panel: null });
  await sleep(600);
  assert.equal(await rail(p).count(), 0, 'Tři sta kapitol (300 H1): no rail');
  await placeCaret(await must(editorBody(p).locator('p').first(), 'a paragraph'), 2);
  await p.keyboard.press('Meta+j');
  await must(card(p), '⌘J opens the card');
  assert.equal((await eventually(() => cardRows(p), (r) => r.length === 300)).length, 300, 'it lists 300 rows');
  const scrolls = await card(p).evaluate((d) => [d, ...d.querySelectorAll('*')].some((e) => e.scrollHeight > e.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)));
  assert.ok(scrolls, 'and scrolls');
});

