// Slice OL, L5 (WebKit + fake core): the Outline tab (docs/acceptance/outline.md R170, R171): FR-EDT-11 AC-1 (the tab on
// Plán, no extra IPC), AC-2 (what counts), AC-3 (plain text, no link), AC-4 (the tree by depth, no guide lines), AC-5 (row
// type, current and hover), AC-6 (empty state, one heading), AC-7 (live while typing, IME, no rebuild), AC-8 (external
// changes), AC-15 (long titles, narrow panel), AC-17 (each route), AC-18 (what the outline follows). Interface
// docs/contracts/v1-outline.md §3.3, §3.7, §10; helpers outline-helpers.ts. Playwright's clock drives the 250 ms limits
// (paused, then advanced). Written from the ACs and the contract only (D-61). Every lookup goes through `must` and
// node:assert (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  ARCH_ROWS, ID, tabIntoTree, OKRAJE_ROWS, P, PLAN_ROWS, TITLE, ZONE, another, atxTexts, box, callsSince, caret, collapseAllBtn, count, countEl, countText, ctxPanel, editorBody,
  editorState, emptyState, eventually, expandAllBtn, flat, headingEl, introPara, main, must, mustBeOn, noteRoute, original, outlinePanel, outlineTab, outlineTree,
  pauseClock, placeCaret, rail, row, rows, rowsAre, rowsOf, runCommand, runFor, scrollBox, scrollHeadingTo, seen, selectText, separator, sleep, startOutline, tabRows,
  tokenColor, vaultWrites,
} from './outline-helpers';

test.use({ timezoneId: ZONE, locale: 'cs-CZ' });

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-1

test('fr_edt_11_ac1_outline_tab_lists_the_headings', async ({ page }) => {
  // Start with the panel closed but remembering the Outline tab, so showing it is one ⌘\ and its calls can be isolated.
  const core = await startOutline(page, noteRoute(P.plan), { uiState: undefined, panel: null, extra: { rightPanel: { open: false, tab: 'outline', width: 288 } } });
  await mustBeOn(page, TITLE[P.plan], 'Plán is open');
  await sleep(600);
  const before = (await core.calls()).length;
  const navBefore = await count(core, 'nav_opened');
  await page.keyboard.press('Meta+Backslash');
  const tab = await must(outlineTab(page), 'tab "Outline" in the Context panel');
  assert.equal(await tab.getAttribute('aria-selected'), 'true', 'the Outline tab is selected');
  assert.ok(!/Coming in v1\.0/.test(`${await tab.getAttribute('aria-description') ?? ''} ${await tab.getAttribute('title') ?? ''}`), 'no `Coming in v1.0` description');
  assert.equal(await tab.getAttribute('data-command'), 'panel.outline', 'data-command="panel.outline"');
  await must(outlineTree(page), 'tree "Outline" in the tab panel');
  assert.equal(await eventually(() => countText(page), (t) => t === '11 headings'), '11 headings', 'the header reads `11 headings`');
  assert.equal(await collapseAllBtn(page).count(), 1, 'Collapse all is shown');
  assert.equal(await expandAllBtn(page).count(), 0, 'no Expand all');
  const r = await tabRows(page);
  assert.deepEqual(r.map((x) => [x.label, Number(x.level)]), PLAN_ROWS, 'exactly 11 treeitems in order with these aria-levels');
  assert.deepEqual(r.filter((x) => x.expanded !== null).map((x) => [x.label, x.expanded]), [['Cíle', 'true'], ['Program', 'true'], ['Den 1', 'true'], ['Logistika', 'true']],
    'aria-expanded="true" on Cíle, Program, Den 1 and Logistika only');
  assert.ok(!r.some((x) => x.label === 'Plán offsitu 2026' || x.label.startsWith('Úvod před prvním')), 'neither the title nor the intro is a row');
  await sleep(400);
  const extra = (await callsSince(core, before)).filter((c) => c !== 'ui_state_set' && c !== 'perf_mark');
  assert.deepEqual(extra, [], 'showing the tab sends no IPC call besides storing the panel (no note_read, no index_*, no write)');
  assert.equal(await count(core, 'nav_opened'), navBefore, 'nav_opened is called no extra time');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-2

test('fr_edt_11_ac2_what_counts_as_a_heading', async ({ page }) => {
  await startOutline(page, noteRoute(P.okraje));
  await must(outlineTree(page), 'Okraje: tree "Outline"');
  const got = await eventually(() => tabRows(page), (r) => r.length === 11);
  assert.deepEqual(got.map((x) => [x.label, Number(x.level)]), OKRAJE_ROWS, 'Okraje: the same 11 rows as outlineHeadings, with their depths');
  assert.equal(await countText(page), '11 headings', '`11 headings`');
  for (const no of ['Komentář v hlavičce není nadpis', 'Kořen mapy', 'Nadpis v komentáři', 'HTML nadpis', 'Komentář v kódu', 'Cíle']) {
    assert.ok(!got.some((x) => x.label.includes(no)), `"${no}" is not a row`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-3

test('fr_edt_11_ac3_heading_text_is_plain', async ({ page }) => {
  await startOutline(page, noteRoute(P.okraje));
  await must(outlineTree(page), 'Okraje: tree "Outline"');
  await eventually(() => tabRows(page), (r) => r.length === 11);
  const r = await tabRows(page);
  assert.equal(r[2]?.label, 'Tučný začátek, odkaz a kód', 'the third row\'s name');
  assert.equal(r[2]?.text, 'Tučný začátek, odkaz a kód', 'the third row reads exactly the plain text (no `**`, `[[`, `|`, backticks or `##`)');
  const third = rows(page).nth(2);
  assert.equal(await third.getByRole('link').count(), 0, 'it contains no `link` element');
  assert.equal(await third.locator('a').count(), 0, 'no anchor');
  assert.equal(r[3]?.text, 'Oddíl s blokem', 'the fourth row has no `^oddil1`');
  assert.equal(r[3]?.label, 'Oddíl s blokem', 'its name too');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-4

test('fr_edt_11_ac4_tree_by_depth', async ({ page }) => {
  await startOutline(page, noteRoute(P.presk));
  await must(outlineTree(page), 'Přeskočené: tree "Outline"');
  const r = await eventually(() => tabRows(page), (x) => x.length === 5);
  assert.deepEqual(r.map((x) => [x.label, Number(x.level)]), [['Začátek ve třetí', 1], ['Hlavní', 1], ['Přeskok', 2], ['Zpět na dvojku', 2], ['Hluboko', 3]], 'Přeskočené: aria-level = depth');
  assert.deepEqual(r.map((x) => Math.round(x.pad * 2) / 2), [0, 0, 14, 14, 28], 'padding-left 14 × (depth − 1)');
  assert.deepEqual(r.filter((x) => x.expanded !== null).map((x) => x.label), ['Hlavní', 'Zpět na dvojku'], 'only Hlavní and Zpět na dvojku have aria-expanded');
  const { p } = await another(page, noteRoute(P.arch));
  await must(outlineTree(p), 'Architektura: tree "Outline"');
  const a = await eventually(() => tabRows(p), (x) => x.length === 18);
  assert.deepEqual(a.map((x) => [x.label, Number(x.level)]), ARCH_ROWS, 'Architektura: depth = level');
  for (const x of a) assert.ok(Math.abs(x.pad - 14 * (Number(x.level) - 1)) <= 0.5, `${x.label}: padding-left ${x.pad} = 14 × (${x.level} − 1) ± 0.5`);
  const lines = await outlineTree(p).evaluate((t) => ([t, ...t.querySelectorAll('*')] as HTMLElement[])
    .filter((e) => (parseFloat(getComputedStyle(e).borderLeftWidth) || 0) > 0 && getComputedStyle(e).borderLeftStyle !== 'none').map((e) => e.className || e.tagName));
  assert.deepEqual(lines, [], 'no element inside the tree draws a vertical line (no left border)');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-5

test('fr_edt_11_ac5_row_type_current_and_hover', async ({ page }) => {
  await startOutline(page, noteRoute(P.arch));
  await must(outlineTree(page), 'Architektura: tree "Outline"');
  await scrollHeadingTo(page, 'Názvy souborů', 4);
  await eventually(() => tabRows(page), (r) => r.some((x) => x.label === 'Názvy souborů' && x.current === 'location'));
  const [text, muted, hover] = [await tokenColor(page, '--text'), await tokenColor(page, '--muted'), await tokenColor(page, '--hover')];
  const r = await tabRows(page);
  assert.equal(r.length, 18, '18 rows');
  for (const x of r) assert.ok(Math.abs(x.height - 26) <= 0.5, `${x.label}: height ${x.height} = 26 ± 0.5`);
  const by = (t: string) => r.find((x) => x.label === t)!;
  for (const t of ['Úložiště', 'Synchronizace']) assert.deepEqual([by(t).font, by(t).weight], ['13px', '500'], `${t}: 13 px, weight 500`);
  for (const x of r.filter((y) => !['Úložiště', 'Synchronizace', 'Názvy souborů'].includes(y.label))) assert.deepEqual([x.font, x.weight], ['12.5px', '400'], `${x.label}: 12.5 px, weight 400`);
  for (const t of ['Časová pásma', 'Přejmenování']) assert.equal(by(t).color, muted, `${t} (level 6): --muted`);
  const cur = by('Názvy souborů');
  assert.deepEqual([cur.current, cur.weight, cur.color, cur.bar], ['location', '600', text, true], 'Názvy souborů (level 5) is current: weight 600, --text, the bar');
  const barColor = await row(page, 'Názvy souborů').evaluate((e) => { const b = getComputedStyle(e, '::before'); return [b.backgroundColor, b.top, b.bottom, b.left]; });
  assert.deepEqual(barColor, [text, '7px', '7px', '0px'], 'the bar is --text, inset 7 px top and bottom, at the left edge');
  assert.equal(cur.bg, 'rgba(0, 0, 0, 0)', 'the current row\'s background stays transparent');
  for (const x of r.filter((y) => !['Časová pásma', 'Přejmenování'].includes(y.label))) assert.equal(x.color, text, `${x.label}: --text`);
  // Hover.
  await row(page, 'Přílohy').hover();
  await sleep(150);
  const h = (await tabRows(page)).find((x) => x.label === 'Přílohy')!;
  assert.deepEqual([h.bg, h.bar], [hover, false], 'hovering Přílohy: --hover background, no bar');
  const c2 = (await tabRows(page)).find((x) => x.label === 'Názvy souborů')!;
  assert.deepEqual([c2.bar, c2.bg], [true, 'rgba(0, 0, 0, 0)'], 'the current row keeps its bar and transparent background');
  assert.ok(h.bg !== c2.bg || h.bar !== c2.bar, 'the current and the hovered row differ');
  // Keyboard: Tab into the tree lands on the current row; ↓ ×3 reaches Přílohy.
  await page.mouse.move(5, 5);
  await tabIntoTree(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await sleep(150);
  const k = (await tabRows(page)).find((x) => x.label === 'Přílohy')!;
  assert.equal(await row(page, 'Přílohy').evaluate((e) => e === document.activeElement), true, '↓ reaches Přílohy');
  assert.deepEqual([k.bg, k.bar], [hover, false], 'reaching Přílohy with ↓: --hover background, no bar');
  const c3 = (await tabRows(page)).find((x) => x.label === 'Názvy souborů')!;
  assert.deepEqual([c3.bar, c3.bg], [true, 'rgba(0, 0, 0, 0)'], 'meanwhile the current row keeps its bar');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-6

test('fr_edt_11_ac6_empty_state_and_one_heading', async ({ page }) => {
  async function empty(p: typeof page, what: string) {
    const tab = await must(outlineTab(p), `${what}: tab Outline`);
    assert.notEqual(await tab.getAttribute('aria-disabled'), 'true', `${what}: the tab stays enabled`);
    const e = await must(emptyState(p), `${what}: the empty state (.outline-empty)`);
    const text = flat(await e.innerText());
    assert.equal(text, 'No headings yet Start a line with # to add one.', `${what}: the empty state's two lines`);
    assert.equal(flat(await e.locator('code').first().innerText().catch(() => '')), '#', `${what}: \`#\` in a code element`);
    assert.equal(await countEl(p).count(), 0, `${what}: no count`);
    assert.equal(await expandAllBtn(p).count() + await collapseAllBtn(p).count(), 0, `${what}: no Expand all or Collapse all`);
    assert.equal(await outlinePanel(p).getByRole('tree').count(), 0, `${what}: no tree`);
  }
  await startOutline(page, noteRoute(P.bez));
  await empty(page, 'Bez nadpisů');
  const { p } = await another(page, noteRoute(P.prazdne));
  await empty(p, 'Prázdné nadpisy (`#` and `##` only)');
  const { p: j } = await another(page, noteRoute(P.jeden));
  await must(outlineTree(j), 'Jeden: tree "Outline"');
  assert.equal(await eventually(() => countText(j), (t) => t === '1 heading'), '1 heading', 'Jeden: `1 heading`');
  const r = await tabRows(j);
  assert.deepEqual(r.map((x) => [x.label, x.expanded]), [['Další kroky', null]], 'one row Další kroky without aria-expanded');
  assert.equal(await expandAllBtn(j).count() + await collapseAllBtn(j).count(), 0, 'neither button');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-7

test('fr_edt_11_ac7_live_updates_while_typing', async ({ page }) => {
  const core = await startOutline(page, noteRoute(P.bez));
  await must(emptyState(page), 'Bez nadpisů: the empty state');
  const calls0 = (await core.calls()).length;
  const last = editorBody(page).locator('p').last();
  await placeCaret(last, 'end');
  await page.keyboard.press('Enter');
  await pauseClock(page);
  await page.keyboard.type('## ');
  await runFor(page, 250);
  assert.ok(await seen(emptyState(page), 300), '`##` and a space: still the empty state (an empty heading isn\'t listed)');
  await page.keyboard.type('Nový oddíl');
  await runFor(page, 250);
  const r = await tabRows(page);
  assert.deepEqual(r.map((x) => [x.label, x.level]), [['Nový oddíl', '1']], 'within 250 ms of the last keystroke: the row Nový oddíl, aria-level 1');
  assert.equal(await countText(page), '1 heading', '`1 heading`');
  assert.equal(await count(core, 'note_write'), 0, 'no note_write yet (the page\'s Saved hasn\'t happened)');
  // Turn into Heading 3: still one row.
  await page.clock.resume();
  await page.keyboard.press('Meta+/');
  const menu = page.getByRole('menu', { name: 'Block actions', exact: true });
  await (await must(menu.getByRole('menuitem', { name: 'Turn into', exact: true }), 'Block actions › Turn into')).click();
  await (await must(page.getByRole('menuitem', { name: 'Heading 3', exact: true }), 'Turn into › Heading 3')).click();
  const h3 = await eventually(() => tabRows(page), (x) => x.length === 1 && x[0].label === 'Nový oddíl', 1000);
  assert.deepEqual(h3.map((x) => x.label), ['Nový oddíl'], 'Heading 3 keeps one row');
  // ⌘Z until the heading is gone.
  await pauseClock(page);
  for (let i = 0; i < 40 && (await editorState(page)).text?.includes('Nový'); i++) { await page.keyboard.press('Meta+z'); await page.clock.runFor(5); }
  assert.ok(!(await editorState(page)).text?.includes('Nový'), 'setup: ⌘Z removed the heading');
  await runFor(page, 250);
  assert.ok(await seen(emptyState(page), 300), '⌘Z brings the empty state back within 250 ms');
  await page.clock.resume();
  assert.deepEqual((await callsSince(core, calls0)).filter((c) => c === 'note_read' || c.startsWith('index_')), [], 'no IPC call for the outline');

  // Plán: relabel one row without rebuilding the others.
  const { p, core: c2 } = await another(page, noteRoute(P.plan));
  await must(outlineTree(p), 'Plán: tree');
  await eventually(() => tabRows(p), (x) => x.length === 11);
  await rows(p).evaluateAll((els) => els.forEach((e, i) => { (e as any).__olMark = i; }));
  const den1 = await must(headingEl(p, 'Den 1'), 'heading Den 1');
  await selectText(den1, '1');
  await pauseClock(p);
  await p.keyboard.type('první');
  await runFor(p, 250);
  const after = await rows(p).evaluateAll((els) => els.map((e) => [(e.getAttribute('aria-label') ?? '').normalize('NFC'), (e as any).__olMark ?? null]));
  assert.equal(after[4]?.[0], 'Den první', 'within 250 ms the row reads Den první');
  assert.deepEqual(after.filter((_, i) => i !== 4).map((x) => x[1]), [0, 1, 2, 3, 5, 6, 7, 8, 9, 10], 'the other rows keep their DOM nodes (no rebuild)');
  // IME composition: the row doesn't change until compositionend.
  await p.clock.resume();
  const cesta = await must(headingEl(p, 'Cesta'), 'heading Cesta');
  await placeCaret(cesta, 'end');
  await pauseClock(p);
  await editorBody(p).first().evaluate((e) => {
    e.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
    e.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ˇ', bubbles: true }));
    document.execCommand('insertText', false, 'ˇ');
  });
  await runFor(p, 250);
  assert.equal((await tabRows(p))[9]?.label, 'Cesta', 'during the composition the row doesn\'t change');
  await editorBody(p).first().evaluate((e) => {
    const sel = window.getSelection()!;
    sel.modify('extend', 'backward', 'character');
    e.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'č', bubbles: true }));
    document.execCommand('insertText', false, 'č');
    e.dispatchEvent(new CompositionEvent('compositionend', { data: 'č', bubbles: true }));
  });
  await runFor(p, 250);
  assert.equal((await tabRows(p))[9]?.label, 'Cestač', 'within 250 ms after compositionend: the composed text');
  await p.clock.resume();
  const sinceStart = (await c2.calls()).map((c) => c.cmd);
  assert.equal(sinceStart.filter((c) => c === 'note_read').length <= 1, true, 'no extra note_read for the outline');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-8

test('fr_edt_11_ac8_external_change_updates_the_outline', async ({ page }) => {
  const core = await startOutline(page, noteRoute(P.plan), { folds: { [ID('01')]: ['1:Program#1'] } });
  await must(outlineTree(page), 'Plán: tree');
  const prog = await eventually(() => tabRows(page), (r) => r.some((x) => x.label === 'Program' && x.expanded === 'false'));
  assert.ok(prog.some((x) => x.label === 'Program' && x.expanded === 'false'), 'setup: Program is collapsed (stored fold)');
  await core.setFile(P.plan, `${original(P.plan)}\n## Rezervy\n\nText.\n`);
  const r = await eventually(() => tabRows(page), (x) => x.some((y) => y.label === 'Rezervy'), 2000);
  const names = r.map((x) => x.label);
  assert.ok(names.includes('Rezervy'), 'within 2 s there is a row Rezervy');
  assert.equal(names[names.indexOf('Rozpočet') + 1], 'Rezervy', 'after Rozpočet');
  assert.equal(r.find((x) => x.label === 'Rezervy')?.level, '2', 'at depth 2 (under Logistika)');
  assert.equal(await countText(page), '12 headings', '`12 headings`');
  assert.equal(r.find((x) => x.label === 'Program')?.expanded, 'false', 'Program is still collapsed');
  // With unsaved edits the editor's merge flow decides; the outline lists the headings of the text then shown.
  const cesta = await must(headingEl(page, 'Cesta'), 'heading Cesta');
  await placeCaret(cesta, 'end');
  await page.keyboard.type(' vlakem');
  await core.setFile(P.plan, `${(await core.files())[P.plan]}\n## Pojištění\n\nText.\n`);
  await sleep(1500);
  const shown = (await editorState(page)).text ?? '';
  const want = atxTexts(shown);
  const got = await eventually(() => tabRows(page).then((x) => x.map((y) => y.label)), (l) => JSON.stringify(l) === JSON.stringify(want), 2000);
  assert.deepEqual(got, want, 'the outline lists the headings of the text the editor shows after the merge flow');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-15

test('fr_edt_11_ac15_long_titles_and_narrow_panel', async ({ page }) => {
  await startOutline(page, noteRoute(P.dlouhe), { width: 240 });
  await must(outlineTree(page), 'Dlouhé: tree');
  const H1 = 'Velmi dlouhý nadpis první úrovně, který se do úzkého panelu nikdy nevejde a musí skončit třemi tečkami';
  const H6 = 'Šestá úroveň s delším textem, který se do panelu nevejde';
  const h1 = await must(row(page, H1), 'the H1 row, named by its full text');
  const cut = await h1.locator('.outline-text').evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, to: getComputedStyle(e).textOverflow, ws: getComputedStyle(e).whiteSpace }));
  assert.ok(cut.sw > cut.cw, `the H1 text is cut (scrollWidth ${cut.sw} > clientWidth ${cut.cw})`);
  assert.equal(cut.to, 'ellipsis', 'it ends with `…` (text-overflow: ellipsis)');
  assert.equal(await h1.getAttribute('title'), H1, 'hover: the tooltip (`title`) holds the full text (CP-6)');
  await h1.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  const tip = page.getByRole('tooltip').filter({ hasText: H1 });
  assert.ok(await seen(tip, 1500), 'keyboard focus on the cut row: a `role=tooltip` with the full text (CP-6)');
  const h6 = await must(row(page, H6), 'the H6 row');
  assert.equal(await h6.getAttribute('aria-level'), '6', 'the level-6 row has depth 6');
  const w6 = await h6.locator('.outline-text').evaluate((e) => e.getBoundingClientRect().width);
  assert.ok(w6 >= 140, `the H6 text box is at least 140 px wide (${w6})`);
  const hs = await outlinePanel(page).evaluate((e) => [e, ...e.querySelectorAll('*')].filter((x) => x.scrollWidth > x.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(x).overflowX)).length);
  assert.equal(hs, 0, 'the tab panel has no horizontal scrollbar');
  // 480 px: drag the separator 240 px to the left.
  const sep = await must(separator(page), 'separator "Resize panel"');
  const b = (await sep.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 - 240, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  const pw = await eventually(() => box(ctxPanel(page)).then((x) => x?.width ?? 0), (w) => Math.abs(w - 480) <= 2);
  assert.ok(Math.abs(pw - 480) <= 2, `setup: the panel is 480 px (${pw})`);
  const full6 = await row(page, H6).locator('.outline-text').evaluate((e) => e.scrollWidth <= e.clientWidth);
  assert.ok(full6, 'at 480 px the H6 text isn\'t cut');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-17

test('fr_edt_11_ac17_outline_on_each_route', async ({ page }) => {
  await startOutline(page, 'daily/2026-11-12');
  await must(outlineTree(page), 'daily/2026-11-12: tree');
  assert.deepEqual(await rowsAre(page, ['Čtvrtek', 'Ráno', 'Večer']), ['Čtvrtek', 'Ráno', 'Večer'], 'daily/2026-11-12: Čtvrtek, Ráno, Večer');
  const { p: v, core: cv } = await another(page, 'daily/2026-11-13');
  await must(outlineTree(v), 'virtual daily/2026-11-13: tree');
  assert.deepEqual(await rowsAre(v, ['Deník 13. 11. 2026', 'Úkoly', 'Poznámky']), ['Deník 13. 11. 2026', 'Úkoly', 'Poznámky'], 'the virtual day lists its expanded template\'s headings');
  await sleep(800);
  assert.deepEqual(await cv.writesTo(), [], 'the virtual day writes nothing');
  const { p: n, core: cn } = await another(page, 'new/page');
  const body = await must(editorBody(n), 'new/page: the body');
  await body.click();
  await n.keyboard.type('# Koncept');
  assert.deepEqual(await rowsAre(n, ['Koncept'], 2000), ['Koncept'], 'new/page: typing `# Koncept` lists Koncept');
  await sleep(300);
  const w = await cn.writesTo();
  assert.ok(w.every((x) => x.startsWith('Pages/')) && new Set(w).size <= 1, `the outline itself writes nothing (only the draft's own create, D-520): ${JSON.stringify(w)}`);
  for (const route of ['tag/štítek', 'type/page', 'search', 'tasks', `graph/${P.plan}`]) {
    const { p } = await another(page, route, { wait: false });
    await sleep(800);
    assert.equal(await ctxPanel(p).count(), 0, `${route}: no Context panel (so no Outline tab)`);
    assert.equal(await rail(p).count(), 0, `${route}: no rail`);
    await p.keyboard.press('Meta+Backslash');
    await sleep(300);
    assert.equal(await ctxPanel(p).count(), 0, `${route}: ⌘\\ does nothing`);
    await p.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-18

test('fr_edt_11_ac18_outline_follows_the_shown_text', async ({ page }) => {
  const core = await startOutline(page, noteRoute(P.plan), { folds: { [ID('01')]: ['1:Program#1'] } });
  await must(outlineTree(page), 'Plán: tree');
  await eventually(() => tabRows(page), (r) => r.some((x) => x.label === 'Program' && x.expanded === 'false'));
  // The 4C rename job: the rows and their fold state stay (id key).
  const t = await must(page.getByRole('textbox', { name: 'Title', exact: true }), 'textbox Title');
  await t.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Plán výjezdu');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Plán výjezdu', 'the rename job renamed Plán', 8000);
  const after = await eventually(() => tabRows(page), (r) => r.length === 7);
  assert.deepEqual(after.map((x) => x.label), PLAN_ROWS.map(([x]) => x).filter((x) => !['Den 1', 'Ráno: strategie', 'Odpoledne: plán', 'Den 2'].includes(x)), 'the same rows, Program still collapsed');
  assert.equal(after.find((x) => x.label === 'Program')?.expanded, 'false', 'Program keeps its fold (stored under the id)');

  // Moved to .trash/ by another program while open without edits.
  const { p, core: c2 } = await another(page, noteRoute(P.plan));
  await must(outlineTree(p), 'Plán (second window): tree');
  await eventually(() => tabRows(p), (r) => r.length === 11);
  await c2.renameFile(P.plan, `.trash/${P.plan}`);
  await sleep(1500);
  const shown = (await editorState(p)).text;
  const rowsNow = (await tabRows(p)).map((x) => x.label);
  if (shown !== null) assert.deepEqual(rowsNow, atxTexts(shown), 'the rows are the headings of the text the editor shows');
  else assert.equal(await outlineTree(p).count(), 0, 'no text shown: no tree');
  const writes0 = (await c2.writesTo()).length;
  if (rowsNow.includes('Cesta')) await row(p, 'Cesta').click();
  await sleep(500);
  assert.equal((await c2.writesTo()).length, writes0, 'clicking a row then writes nothing');

  // No note text: no tree, no count, no hint.
  const { p: g } = await another(page, noteRoute('Pages/Neexistuje.md'), { wait: false });
  await sleep(1500);
  assert.equal(await outlineTree(g).count(), 0, 'a page without note text: no tree');
  assert.equal(await countEl(g).count(), 0, 'no count');
  assert.equal(await outlinePanel(g).getByText('Start a line with').count(), 0, 'no hint');
});
