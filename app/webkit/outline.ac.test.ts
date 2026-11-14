// Slice OL, L5 (WebKit + fake core): the note's outline (docs/acceptance/outline.md R171), observed through the test hook
// `__TEGG_TEST__.outline` and the rail's card, since there is no Outline tab (D-1675): FR-EDT-11 AC-2 (what counts),
// AC-3 (plain text, no link), AC-4 (the tree by depth, no guide lines), AC-5 (row type, current and hover), AC-7 (live
// while typing, IME, no rebuild), AC-8 (external changes), AC-17 (each route), AC-18 (what the outline follows) and
// FR-FMT-12 AC-10 (one heading in NFC and NFD). Interface docs/contracts/v1-outline.md §3.3, §3.7, §10; helpers
// outline-helpers.ts. Playwright's clock drives the 250 ms limits (paused, then advanced). Written from the ACs and the
// contract only (D-61). Every lookup goes through `must` and node:assert (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  ARCH_ROWS, OKRAJE_ROWS, P, PLAN_ROWS, ZONE, another, atxTexts, callsSince, card, cardRowAt, cardRowFor, cardRows, cardTree, count, ctxPanel, editorBody,
  editorState, eventually, headingEl, hoverRail, must, mustBeOn, nfc, noteRoute, openCardByHover, original, outlineRows, outlineVault, pauseClock, placeCaret,
  rail, rowsAre, runFor, scrollHeadingTo, selectText, sleep, startOutline, tokenColor,
} from './outline-helpers';

test.use({ timezoneId: ZONE, locale: 'cs-CZ' });

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-2

test('fr_edt_11_ac2_what_counts_as_a_heading', async ({ page }) => {
  await startOutline(page, noteRoute(P.okraje));
  const got = await eventually(() => outlineRows(page), (r) => r.length === 11);
  assert.deepEqual(got.map((x) => [x.label, Number(x.level)]), OKRAJE_ROWS, 'Okraje: the same 11 headings as outlineHeadings, with their depths');
  await openCardByHover(page);
  const c = await eventually(() => cardRows(page), (r) => r.length === 11);
  assert.deepEqual(c.map((x) => [x.label, Number(x.level)]), OKRAJE_ROWS, 'the card lists the same 11 rows');
  for (const no of ['Komentář v hlavičce není nadpis', 'Kořen mapy', 'Nadpis v komentáři', 'HTML nadpis', 'Komentář v kódu', 'Cíle']) {
    assert.ok(!got.some((x) => x.label.includes(no)), `"${no}" is not a heading`);
    assert.ok(!c.some((x) => x.label.includes(no)), `"${no}" is not a row`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-3

test('fr_edt_11_ac3_heading_text_is_plain', async ({ page }) => {
  await startOutline(page, noteRoute(P.okraje));
  await openCardByHover(page);
  const r = await eventually(() => cardRows(page), (x) => x.length === 11);
  assert.equal(r[2]?.label, 'Tučný začátek, odkaz a kód', 'the third row\'s name');
  assert.equal(r[2]?.text, 'Tučný začátek, odkaz a kód', 'the third row reads exactly the plain text (no `**`, `[[`, `|`, backticks or `##`)');
  const third = cardTree(page).getByRole('treeitem').nth(2);
  assert.equal(await third.getByRole('link').count(), 0, 'it contains no `link` element');
  assert.equal(await third.locator('a').count(), 0, 'no anchor');
  assert.equal(r[3]?.text, 'Oddíl s blokem', 'the fourth row has no `^oddil1`');
  assert.equal(r[3]?.label, 'Oddíl s blokem', 'its name too');
  assert.equal((await outlineRows(page))[2]?.label, 'Tučný začátek, odkaz a kód', 'the hook lists the same plain text');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-4

test('fr_edt_11_ac4_tree_by_depth', async ({ page }) => {
  await startOutline(page, noteRoute(P.presk));
  await openCardByHover(page);
  const r = await eventually(() => cardRows(page), (x) => x.length === 5);
  assert.deepEqual(r.map((x) => [x.label, Number(x.level)]), [['Začátek ve třetí', 1], ['Hlavní', 1], ['Přeskok', 2], ['Zpět na dvojku', 2], ['Hluboko', 3]], 'Přeskočené: aria-level = depth');
  assert.deepEqual(r.map((x) => Math.round(x.pad * 2) / 2), [0, 0, 14, 14, 28], 'padding-left 14 × (depth − 1)');
  assert.deepEqual(r.filter((x) => x.expanded !== null).map((x) => x.label), ['Hlavní', 'Zpět na dvojku'], 'only Hlavní and Zpět na dvojku have aria-expanded');
  const { p } = await another(page, noteRoute(P.arch));
  await openCardByHover(p);
  const a = await eventually(() => cardRows(p), (x) => x.length === 18);
  assert.deepEqual(a.map((x) => [x.label, Number(x.level)]), ARCH_ROWS, 'Architektura: depth = level');
  for (const x of a) assert.ok(Math.abs(x.pad - 14 * (Number(x.level) - 1)) <= 0.5, `${x.label}: padding-left ${x.pad} = 14 × (${x.level} − 1) ± 0.5`);
  const lines = await cardTree(p).evaluate((t) => ([t, ...t.querySelectorAll('*')] as HTMLElement[])
    .filter((e) => (parseFloat(getComputedStyle(e).borderLeftWidth) || 0) > 0 && getComputedStyle(e).borderLeftStyle !== 'none').map((e) => e.className || e.tagName));
  assert.deepEqual(lines, [], 'no element inside the tree draws a vertical line (no left border)');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-5

test('fr_edt_11_ac5_row_type_current_and_hover', async ({ page }) => {
  await startOutline(page, noteRoute(P.arch));
  await scrollHeadingTo(page, 'Názvy souborů', 4);
  await eventually(() => outlineRows(page), (r) => r.length === 18);
  await openCardByHover(page);
  await eventually(() => cardRows(page), (r) => r.some((x) => x.label === 'Názvy souborů' && x.current === 'location'));
  const [text, muted, hover] = [await tokenColor(page, '--text'), await tokenColor(page, '--muted'), await tokenColor(page, '--hover')];
  const r = await cardRows(page);
  assert.equal(r.length, 18, '18 rows');
  for (const x of r) assert.ok(Math.abs(x.height - 26) <= 0.5, `${x.label}: height ${x.height} = 26 ± 0.5`);
  const by = (t: string) => r.find((x) => x.label === t)!;
  // The card marks the current section's ancestors with weight 600 (V8): Úložiště … Denní poznámky.
  const ANC = ['Úložiště', 'Rozvržení trezoru', 'Složky podle typu', 'Denní poznámky'];
  assert.deepEqual(by('Úložiště').font, '13px', 'Úložiště (top level): 13 px');
  assert.deepEqual([by('Synchronizace').font, by('Synchronizace').weight], ['13px', '500'], 'Synchronizace: 13 px, weight 500');
  for (const t of ANC) assert.equal(by(t).weight, '600', `${t} (an ancestor of the current section): weight 600`);
  for (const x of r.filter((y) => ![...ANC, 'Synchronizace', 'Názvy souborů'].includes(y.label))) assert.deepEqual([x.font, x.weight], ['12.5px', '400'], `${x.label}: 12.5 px, weight 400`);
  for (const t of ['Časová pásma', 'Přejmenování']) assert.equal(by(t).color, muted, `${t} (level 6): --muted`);
  const cur = by('Názvy souborů');
  assert.deepEqual([cur.current, cur.weight, cur.color, cur.bar], ['location', '600', text, true], 'Názvy souborů (level 5) is current: weight 600, --text, the bar');
  const curIdx = cur.index;
  const barColor = await cardRowAt(page, curIdx).evaluate((e) => { const b = getComputedStyle(e, '::before'); return [b.backgroundColor, b.top, b.bottom, b.left]; });
  assert.deepEqual(barColor, [text, '7px', '7px', '0px'], 'the bar is --text, inset 7 px top and bottom, at the left edge');
  assert.equal(cur.bg, 'rgba(0, 0, 0, 0)', 'the current row\'s background stays transparent');
  for (const x of r.filter((y) => !['Časová pásma', 'Přejmenování'].includes(y.label))) assert.equal(x.color, text, `${x.label}: --text`);
  // Hover.
  const pril = r.find((x) => x.label === 'Přílohy')!.index;
  await cardRowAt(page, pril).hover();
  await sleep(150);
  const h = (await cardRows(page)).find((x) => x.label === 'Přílohy')!;
  assert.deepEqual([h.bg, h.bar], [hover, false], 'hovering Přílohy: --hover background, no bar');
  const c2 = (await cardRows(page)).find((x) => x.label === 'Názvy souborů')!;
  assert.deepEqual([c2.bar, c2.bg], [true, 'rgba(0, 0, 0, 0)'], 'the current row keeps its bar and transparent background');
  assert.ok(h.bg !== c2.bg || h.bar !== c2.bar, 'the current and the hovered row differ');
  // Keyboard: ⌘J focuses the current row; ↓ ×3 reaches Přílohy.
  await page.mouse.move(5, 5);
  assert.ok(await eventually(async () => (await card(page).count()) === 0, (x) => x, 1500), 'setup: the hover card closes');
  await placeCaret(await must(editorBody(page).locator('p').first(), 'the intro'), 2);
  await scrollHeadingTo(page, 'Názvy souborů', 4);
  await page.keyboard.press('Meta+j');
  await must(card(page), '⌘J opens the card');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await sleep(150);
  const k = (await cardRows(page)).find((x) => x.label === 'Přílohy')!;
  assert.equal(await cardRowAt(page, pril).evaluate((e) => e === document.activeElement), true, '↓ reaches Přílohy');
  assert.deepEqual([k.bg, k.bar], [hover, false], 'reaching Přílohy with ↓: --hover background, no bar');
  const c3 = (await cardRows(page)).find((x) => x.label === 'Názvy souborů')!;
  assert.deepEqual([c3.bar, c3.bg], [true, 'rgba(0, 0, 0, 0)'], 'meanwhile the current row keeps its bar');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-7

test('fr_edt_11_ac7_live_updates_while_typing', async ({ page }) => {
  const core = await startOutline(page, noteRoute(P.bez));
  assert.deepEqual(await outlineRows(page), [], 'Bez nadpisů: no headings');
  const calls0 = (await core.calls()).length;
  const last = editorBody(page).locator('p').last();
  await placeCaret(last, 'end');
  await page.keyboard.press('Enter');
  await pauseClock(page);
  await page.keyboard.type('## ');
  await runFor(page, 250);
  assert.deepEqual(await outlineRows(page), [], '`##` and a space: still no headings (an empty heading isn\'t listed)');
  await page.keyboard.type('Nový oddíl');
  await runFor(page, 250);
  const r = await outlineRows(page);
  assert.deepEqual(r.map((x) => [x.label, x.level]), [['Nový oddíl', '1']], 'within 250 ms of the last keystroke: the heading Nový oddíl at depth 1');
  assert.equal(await count(core, 'note_write'), 0, 'no note_write yet (the page\'s Saved hasn\'t happened)');
  // Turn into Heading 3: still one heading.
  await page.clock.resume();
  await page.keyboard.press('Meta+/');
  const menu = page.getByRole('menu', { name: 'Block actions', exact: true });
  await (await must(menu.getByRole('menuitem', { name: 'Turn into', exact: true }), 'Block actions › Turn into')).click();
  await (await must(page.getByRole('menuitem', { name: 'Heading 3', exact: true }), 'Turn into › Heading 3')).click();
  const h3 = await eventually(() => outlineRows(page), (x) => x.length === 1 && x[0].label === 'Nový oddíl', 1000);
  assert.deepEqual(h3.map((x) => x.label), ['Nový oddíl'], 'Heading 3 keeps one heading');
  // ⌘Z until the heading is gone.
  await pauseClock(page);
  for (let i = 0; i < 40 && (await editorState(page)).text?.includes('Nový'); i++) { await page.keyboard.press('Meta+z'); await page.clock.runFor(5); }
  assert.ok(!(await editorState(page)).text?.includes('Nový'), 'setup: ⌘Z removed the heading');
  await runFor(page, 250);
  assert.deepEqual(await outlineRows(page), [], '⌘Z empties the outline within 250 ms');
  await page.clock.resume();
  assert.deepEqual((await callsSince(core, calls0)).filter((c) => c === 'note_read' || c.startsWith('index_')), [], 'no IPC call for the outline');

  // Plán: relabel one row of the card without rebuilding the others (the card stays open while the pointer rests on the rail).
  const { p, core: c2 } = await another(page, noteRoute(P.plan));
  await openCardByHover(p);
  await eventually(() => cardRows(p), (x) => x.length === 11);
  await cardTree(p).getByRole('treeitem').evaluateAll((els) => els.forEach((e, i) => { (e as any).__olMark = i; }));
  await hoverRail(p);
  const den1 = await must(headingEl(p, 'Den 1'), 'heading Den 1');
  await selectText(den1, '1');
  await pauseClock(p);
  await p.keyboard.type('první');
  await runFor(p, 250);
  const after = await cardTree(p).getByRole('treeitem').evaluateAll((els) => els.map((e) => [(e.getAttribute('aria-label') ?? '').normalize('NFC'), (e as any).__olMark ?? null]));
  assert.equal(after[4]?.[0], 'Den první', 'within 250 ms the row reads Den první');
  assert.deepEqual(after.filter((_, i) => i !== 4).map((x) => x[1]), [0, 1, 2, 3, 5, 6, 7, 8, 9, 10], 'the other rows keep their DOM nodes (no rebuild)');
  // IME composition: the heading doesn't change until compositionend.
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
  assert.equal((await outlineRows(p))[9]?.label, 'Cesta', 'during the composition the heading doesn\'t change');
  await editorBody(p).first().evaluate((e) => {
    const sel = window.getSelection()!;
    sel.modify('extend', 'backward', 'character');
    e.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'č', bubbles: true }));
    document.execCommand('insertText', false, 'č');
    e.dispatchEvent(new CompositionEvent('compositionend', { data: 'č', bubbles: true }));
  });
  await runFor(p, 250);
  assert.equal((await outlineRows(p))[9]?.label, 'Cestač', 'within 250 ms after compositionend: the composed text');
  await p.clock.resume();
  const sinceStart = (await c2.calls()).map((c) => c.cmd);
  assert.equal(sinceStart.filter((c) => c === 'note_read').length <= 1, true, 'no extra note_read for the outline');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-8

test('fr_edt_11_ac8_external_change_updates_the_outline', async ({ page }) => {
  const core = await startOutline(page, noteRoute(P.plan));
  await eventually(() => outlineRows(page), (r) => r.length === 11);
  await core.setFile(P.plan, `${original(P.plan)}\n## Rezervy\n\nText.\n`);
  const r = await eventually(() => outlineRows(page), (x) => x.some((y) => y.label === 'Rezervy'), 2000);
  const names = r.map((x) => x.label);
  assert.ok(names.includes('Rezervy'), 'within 2 s the outline has Rezervy');
  assert.equal(names[names.indexOf('Rozpočet') + 1], 'Rezervy', 'after Rozpočet');
  assert.equal(r.find((x) => x.label === 'Rezervy')?.level, '2', 'at depth 2 (under Logistika)');
  assert.equal(r.length, 12, '12 headings');
  // With unsaved edits the editor's merge flow decides; the outline lists the headings of the text then shown.
  const cesta = await must(headingEl(page, 'Cesta'), 'heading Cesta');
  await placeCaret(cesta, 'end');
  await page.keyboard.type(' vlakem');
  await core.setFile(P.plan, `${(await core.files())[P.plan]}\n## Pojištění\n\nText.\n`);
  await sleep(1500);
  const shown = (await editorState(page)).text ?? '';
  const want = atxTexts(shown);
  const got = await eventually(() => outlineRows(page).then((x) => x.map((y) => y.label)), (l) => JSON.stringify(l) === JSON.stringify(want), 2000);
  assert.deepEqual(got, want, 'the outline lists the headings of the text the editor shows after the merge flow');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-17

test('fr_edt_11_ac17_outline_on_each_route', async ({ page }) => {
  await startOutline(page, 'daily/2026-11-12');
  assert.deepEqual(await rowsAre(page, ['Čtvrtek', 'Ráno', 'Večer']), ['Čtvrtek', 'Ráno', 'Večer'], 'daily/2026-11-12: Čtvrtek, Ráno, Večer');
  await openCardByHover(page);
  assert.deepEqual((await eventually(() => cardRows(page), (r) => r.length === 3)).map((x) => x.label), ['Čtvrtek', 'Ráno', 'Večer'], 'and its card');
  const { p: v, core: cv } = await another(page, 'daily/2026-11-13');
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
    assert.equal(await ctxPanel(p).count(), 0, `${route}: no Context panel`);
    assert.equal(await rail(p).count(), 0, `${route}: no rail`);
    await p.keyboard.press('Meta+Backslash');
    await sleep(300);
    assert.equal(await ctxPanel(p).count(), 0, `${route}: ⌘\\ does nothing`);
    await p.keyboard.press('Meta+j');
    await sleep(300);
    assert.equal(await card(p).count(), 0, `${route}: ⌘J opens no outline`);
    await p.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-18

test('fr_edt_11_ac18_outline_follows_the_shown_text', async ({ page }) => {
  await startOutline(page, noteRoute(P.plan));
  await eventually(() => outlineRows(page), (r) => r.length === 11);
  // The 4C rename job: the headings stay.
  const t = await must(page.getByRole('textbox', { name: 'Title', exact: true }), 'textbox Title');
  await t.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Plán výjezdu');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Plán výjezdu', 'the rename job renamed Plán', 8000);
  const after = await eventually(() => outlineRows(page), (r) => r.length === 11);
  assert.deepEqual(after.map((x) => [x.label, Number(x.level)]), PLAN_ROWS, 'the same headings after the rename');

  // Moved to .trash/ by another program while open without edits.
  const { p, core: c2 } = await another(page, noteRoute(P.plan));
  await eventually(() => outlineRows(p), (r) => r.length === 11);
  await c2.renameFile(P.plan, `.trash/${P.plan}`);
  await sleep(1500);
  const shown = (await editorState(p)).text;
  const rowsNow = (await outlineRows(p)).map((x) => x.label);
  if (shown !== null) assert.deepEqual(rowsNow, atxTexts(shown), 'the headings are those of the text the editor shows');
  else assert.deepEqual(rowsNow, [], 'no text shown: no headings');
  const writes0 = (await c2.writesTo()).length;
  if (rowsNow.includes('Cesta') && (await rail(p).count())) await (await cardRowFor(p, 'Cesta')).click();
  await sleep(500);
  assert.equal((await c2.writesTo()).length, writes0, 'jumping to a heading then writes nothing');

  // No note text: no outline, no rail, ⌘J opens nothing.
  const { p: g } = await another(page, noteRoute('Pages/Neexistuje.md'), { wait: false });
  await sleep(1500);
  assert.deepEqual(await outlineRows(g), [], 'a page without note text: no headings');
  assert.equal(await rail(g).count(), 0, 'no rail');
  await g.keyboard.press('Meta+j');
  await sleep(300);
  assert.equal(await card(g).count(), 0, 'no card');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-10

test('fr_fmt_12_ac10_nfd_heading_same_fold_key', async ({ page }) => {
  const NFC = 'Složky podle typu';
  const vault = outlineVault((f) => { f[P.arch] = f[P.arch].replace(`### ${NFC}`, `### ${NFC.normalize('NFD')}`); });
  assert.notEqual(vault.files[P.arch], original(P.arch), 'setup: the line is NFD at runtime');
  const core = await startOutline(page, noteRoute(P.arch), { vault });
  const r = await eventually(() => outlineRows(page), (x) => x.length === 18);
  assert.equal(r[2]?.label, nfc(NFC), 'the heading\'s text is NFC-equal to Složky podle typu');
  await openCardByHover(page);
  const c = await eventually(() => cardRows(page), (x) => x.length === 18);
  assert.equal(c[2]?.label, NFC, 'the card row\'s accessible name is NFC-equal to Složky podle typu');
  assert.equal(c[2]?.text, NFC, 'it reads the same as before');
  await core.setFile(P.arch, original(P.arch));
  await sleep(1500);
  const r2 = await eventually(() => outlineRows(page), (x) => x.length === 18 && x[2]?.label === NFC);
  assert.equal(r2[2]?.label, NFC, 'rewritten back to NFC by another program: the same heading');
});
