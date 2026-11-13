// Slice OL, L5 (WebKit + fake core): collapsing in the Outline tab and its machine-local fold state (docs/acceptance/
// outline.md R170, R176): FR-EDT-11 AC-13 (one row, a branch with ⌥, all; the note isn't folded; label versus chevron;
// current in a collapsed branch; chevron visibility), AC-14 (fold state per note; the rail and the card are separate; new
// and renamed headings), AC-16 (the tree scrolls on its own and keeps the current row in view), FR-STO-07 AC-7 (stored in
// `ui-state.json`, keyed by note and heading; prune, cap, re-key) and FR-FMT-12 AC-10 (one heading in NFC and NFD).
// Interface docs/contracts/v1-outline.md §3.7, §3.8, §5, §10; helpers outline-helpers.ts. Written from the ACs and the
// contract only (D-61). Every lookup goes through `must` and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  ID, P, TITLE, VAULT_PATH, ZONE, another, box, card, cardRows, editorBody, editorState, eventually, foldsStored, goToQuery, headingEl, headingTop,
  mainScroll, must, mustBeOn, nfc, noteRoute, original, outlineTab, outlineTree, outlineUi, outlineVault, placeCaret, railLines, row, rows, scrollBox,
  scrollHeadingTo, selectText, sleep, startOutline, tabRows, uiSets, vaultWrites, collapseAllBtn, expandAllBtn, countText, currentRows, backlinksTab, openCardByHover,
  outlinePanel, type FakeCoreHandle,
} from './outline-helpers';

test.use({ timezoneId: ZONE, locale: 'cs-CZ' });

const chevron = (page: Page, text: string, n = 0) => row(page, text, n).locator('[data-outline-chevron]');
async function clickChevron(page: Page, text: string, o: { alt?: boolean; n?: number } = {}) {
  const r = await must(row(page, text, o.n ?? 0), `row ${text}`);
  await r.hover();
  const c = await must(chevron(page, text, o.n ?? 0), `the chevron of ${text}`);
  await c.click({ modifiers: o.alt ? ['Alt'] : [] });
  await sleep(120);
}
const rowOf = async (page: Page, text: string) => (await tabRows(page)).find((x) => x.label === nfc(text));

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-13

test('fr_edt_11_ac13_collapse_and_expand', async ({ page }) => {
  const core = await startOutline(page, noteRoute(P.arch));
  await must(outlineTree(page), 'Architektura: tree');
  await eventually(() => tabRows(page), (r) => r.length === 18);
  // One row.
  await clickChevron(page, 'Hlavička');
  let h = await rowOf(page, 'Hlavička');
  assert.deepEqual([h?.expanded, h?.hidden, h?.desc], ['false', '2', '2 hidden headings'], 'Hlavička collapsed: aria-expanded false, count 2, `2 hidden headings`');
  assert.equal((await tabRows(page)).length, 16, 'its 2 children are hidden');
  assert.equal(await countText(page), '18 headings', 'the header still reads `18 headings`');
  assert.deepEqual([await expandAllBtn(page).count(), await collapseAllBtn(page).count()], [1, 1], 'both Expand all and Collapse all');
  await clickChevron(page, 'Hlavička');
  h = await rowOf(page, 'Hlavička');
  assert.deepEqual([h?.expanded, (await tabRows(page)).length], ['true', 18], 'a second click restores it');
  // A whole branch.
  await clickChevron(page, 'Úložiště', { alt: true });
  const BR = ['Úložiště', 'Rozvržení trezoru', 'Složky podle typu', 'Denní poznámky', 'Názvy souborů', 'Hlavička', 'Indexování'];
  await clickChevron(page, 'Úložiště');
  const seven = await tabRows(page);
  assert.deepEqual(seven.map((x) => [x.label, x.expanded, x.hidden]), [
    ['Úložiště', 'true', null], ['Rozvržení trezoru', 'false', '9'], ['Indexování', 'false', '2'], ['Synchronizace', 'true', null], ['Konflikty', 'true', null],
    ['Stejný řádek upraven', null, null], ['Složky iCloudu', null, null],
  ], '⌥-click collapsed the branch; a plain click on Úložiště then shows 7 rows');
  await clickChevron(page, 'Rozvržení trezoru', { alt: true });
  const re = await tabRows(page);
  for (const t of BR.slice(1, 6)) assert.equal(re.find((x) => x.label === t)?.expanded, 'true', `⌥-click on the collapsed Rozvržení trezoru expands ${t} too`);
  // All.
  await (await must(collapseAllBtn(page), 'Collapse all')).click();
  await sleep(120);
  assert.deepEqual((await tabRows(page)).map((x) => [x.label, x.hidden]), [['Úložiště', '13'], ['Synchronizace', '3']], 'Collapse all: Úložiště 13, Synchronizace 3');
  assert.deepEqual([await expandAllBtn(page).count(), await collapseAllBtn(page).count()], [1, 0], 'only Expand all');
  await (await must(expandAllBtn(page), 'Expand all')).click();
  await sleep(120);
  assert.equal((await tabRows(page)).length, 18, 'Expand all restores 18 rows');
  assert.deepEqual([await expandAllBtn(page).count(), await collapseAllBtn(page).count()], [0, 1], 'only Collapse all');
  // The note isn't folded.
  await (await must(collapseAllBtn(page), 'Collapse all')).click();
  await sleep(120);
  const shown = await editorBody(page).evaluate((b) => ([...b.querySelectorAll('h1,h2,h3,h4,h5,h6,p')] as HTMLElement[]).filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden').length);
  assert.equal(shown, 18 + 19, 'the editor still renders all 18 headings and their 18 paragraphs plus the intro');
  assert.equal((await editorState(page)).dirty, false, 'the editor isn\'t dirty');
  assert.deepEqual(await core.writesTo(), [], 'nothing is written');
  await (await must(expandAllBtn(page), 'Expand all')).click();
  // Label versus chevron.
  await (await must(row(page, 'Konflikty').locator('.outline-text'), 'Konflikty\'s text')).click();
  await sleep(200);
  assert.equal((await rowOf(page, 'Konflikty'))?.expanded, 'true', 'a click on the text doesn\'t toggle');
  const top = await headingTop(page, 'Konflikty');
  const ms = await mainScroll(page);
  assert.ok((top !== null && Math.abs(top - 24) <= 2) || ms.top >= ms.height - ms.client - 1, `it jumps: Konflikty at 24 px or the note at its end (${top})`);
  // Current in a collapsed branch.
  await clickChevron(page, 'Úložiště');
  await scrollHeadingTo(page, 'Časová pásma', 4);
  const cur = await eventually(() => currentRows(page), (c) => c[0] === 'Úložiště');
  assert.deepEqual(cur, ['Úložiště'], 'Úložiště carries aria-current');
  assert.ok((await rowOf(page, 'Úložiště'))?.bar, 'and the bar');
  assert.equal((await rowOf(page, 'Úložiště'))?.expanded, 'false', 'nothing expands');
  // Chevron visibility.
  await page.mouse.move(2, 2);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await sleep(200);
  const vis = await tabRows(page);
  assert.equal(vis.find((x) => x.label === 'Úložiště')?.chevronShown, true, 'a collapsed row always shows its chevron');
  assert.equal(vis.find((x) => x.label === 'Synchronizace')?.chevronShown, false, 'an expanded row hides its chevron without hover or focus');
  await row(page, 'Synchronizace').hover();
  await sleep(200);
  assert.equal((await rowOf(page, 'Synchronizace'))?.chevronShown, true, 'shown on hover');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-14

test('fr_edt_11_ac14_fold_state_per_note', async ({ page }) => {
  await startOutline(page, noteRoute(P.arch));
  await must(outlineTree(page), 'Architektura: tree');
  await eventually(() => tabRows(page), (r) => r.length === 18);
  await clickChevron(page, 'Hlavička');
  await goToQuery(page, TITLE[P.plan]);
  await page.keyboard.press('Enter');
  await mustBeOn(page, TITLE[P.plan], 'open Plán');
  const plan = await eventually(() => tabRows(page), (r) => r.length === 11);
  assert.ok(plan.every((x) => x.expanded !== 'false'), 'Plán shows every row expanded');
  await page.keyboard.press('Meta+BracketLeft');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, TITLE[P.arch], 'Back (⌘[) to Architektura (over the Search entry)');
  assert.equal((await eventually(() => rowOf(page, 'Hlavička'), (x) => x?.expanded === 'false'))?.expanded, 'false', 'Hlavička still collapsed');
  // The rail ignores the tab's collapsing.
  await (await must(backlinksTab(page), 'tab Backlinks')).click();
  assert.equal((await eventually(() => railLines(page), (l) => l.length === 18)).length, 18, 'with Hlavička collapsed in the tab, the rail draws 18 lines');
  await (await must(outlineTab(page), 'tab Outline')).click();
  // Renaming the collapsed Hlavička in the editor: the key no longer matches.
  const hl = await must(headingEl(page, 'Hlavička'), 'heading Hlavička');
  await selectText(hl, 'Hlavička');
  await page.keyboard.type('Záhlaví');
  assert.equal((await eventually(() => rowOf(page, 'Záhlaví'), (x) => !!x))?.expanded, 'true', 'Záhlaví shows expanded');
  // A typed heading appears expanded.
  const para = editorBody(page).locator('p').filter({ hasText: 'Text oddílu.' }).nth(8);
  await placeCaret(await must(para, 'the paragraph under Záhlaví'), 'end');
  await page.keyboard.press('Enter');
  await page.keyboard.type('### Nový oddíl');
  const nr = await eventually(() => rowOf(page, 'Nový oddíl'), (x) => !!x);
  assert.equal(nr?.expanded, 'true', 'a heading typed into Architektura (with Povinné klíče and Neznámé klíče under it) appears expanded');
  // The card's temporary opens don't change the tab (Čtenářské, panel on Backlinks).
  const { p, core } = await another(page, noteRoute(P.cten), { panel: 'backlinks' });
  await scrollHeadingTo(p, 'Zpoždění replikace', 4);
  await openCardByHover(p);
  const sets0 = await uiSets(core);
  const tr = (await cardRows(p)).find((x) => x.label === 'Transakce');
  assert.ok(tr?.chevron, 'the card shows Transakce\'s chevron');
  await card(p).getByRole('treeitem', { name: 'Transakce', exact: true }).locator('[data-outline-chevron]').click();
  assert.equal((await eventually(() => cardRows(p), (r) => r.length === 19)).length, 19, 'the card opens Transakce for a look');
  assert.equal(await uiSets(core), sets0, 'the card\'s temporary open stores nothing');
  await p.keyboard.press('Escape');
  await (await must(outlineTab(p), 'tab Outline')).click();
  const t = await eventually(() => tabRows(p), (r) => r.length === 51);
  assert.equal(t.length, 51, 'the tab shows all 51 rows');
  assert.ok(t.every((x) => x.expanded !== 'false'), 'and none collapsed: the card\'s opens didn\'t change the tab');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-16

test('fr_edt_11_ac16_tree_keeps_the_current_row_in_view', async ({ page }) => {
  await startOutline(page, noteRoute(P.cten));
  await must(outlineTree(page), 'Čtenářské: tree');
  await eventually(() => tabRows(page), (r) => r.length === 51);
  const sc = await must(scrollBox(page), 'the tree\'s scroll container ([data-outline-scroll])');
  const dims = await sc.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
  assert.ok(dims.sh > dims.ch, `the tree is taller than the tab panel (${dims.sh} > ${dims.ch})`);
  const header = outlinePanel(page).locator('.outline-header');
  const y0 = (await box(await must(header, 'the header (.outline-header)')))!.y;
  const note0 = (await mainScroll(page)).top;
  await sc.evaluate((e) => { e.scrollTop = 300; });
  await sleep(100);
  assert.equal((await box(header))!.y, y0, 'the tree scrolls while the header stays in place');
  assert.equal((await mainScroll(page)).top, note0, 'scrolling the tree never scrolls the note');
  const b = (await box(sc))!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, 400);
  await sleep(200);
  assert.equal((await mainScroll(page)).top, note0, 'a wheel over the tree never scrolls the note');
  // The current row is centred when it changes.
  await page.mouse.move(2, 2);
  await scrollHeadingTo(page, 'Zpracování', 4);
  await eventually(() => currentRows(page), (c) => c[0] === 'Zpracování');
  const centred = async () => sc.evaluate((e) => {
    const r = e.querySelector('[aria-current="location"]') as HTMLElement | null;
    if (!r) return { off: Infinity, atEnd: false };
    const eb = e.getBoundingClientRect(), rb = r.getBoundingClientRect();
    return { off: Math.abs((rb.top + rb.height / 2) - (eb.top + eb.height / 2)), atEnd: e.scrollTop >= e.scrollHeight - e.clientHeight - 1 };
  });
  const c1 = await eventually(centred, (x) => x.off <= 13 || x.atEnd);
  assert.ok(c1.off <= 13 || c1.atEnd, `Zpracování's row is centred in the tree (± 13 px) or the tree is at its end: ${JSON.stringify(c1)}`);
  // Not while the pointer is over the tree.
  await sc.evaluate((e) => { e.scrollTop = 0; });
  await page.mouse.move(b.x + b.width / 2, b.y + 10);
  await scrollHeadingTo(page, 'Konzistence', 4);
  await eventually(() => currentRows(page), (c) => c[0] === 'Konzistence');
  await sleep(300);
  assert.equal(await sc.evaluate((e) => e.scrollTop), 0, 'while the pointer is over the tree, it doesn\'t scroll by itself');
  // Nor while the focus is in it.
  await page.mouse.move(2, 2);
  await (await must(rows(page).first(), 'the first row')).focus();
  await scrollHeadingTo(page, 'Dávkové zpracování', 4);
  await sleep(300);
  assert.equal(await sc.evaluate((e) => e.scrollTop), 0, 'while the focus is in it, it doesn\'t scroll by itself');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await scrollHeadingTo(page, 'Závěr', 4);
  const c2 = await eventually(centred, (x) => x.off <= 13 || x.atEnd);
  assert.ok(c2.off <= 13 || c2.atEnd, `at the next change after both have left, it follows again: ${JSON.stringify(c2)}`);
});

// ------------------------------------------------------------------------------------------------ FR-STO-07 AC-7

async function stored(core: FakeCoreHandle) {
  return (await core.uiState()) as any;
}

test('fr_sto_07_ac7_fold_state_in_ui_state', async ({ page }) => {
  // The seed holds every field the UI writes back, so "every other field is as the UI read it" compares like with like
  // (typeSort, otherPropertiesOpen: AP-764; D-1653).
  const core = await startOutline(page, noteRoute(P.plan), { extra: { typeSort: {}, otherPropertiesOpen: false } });
  await must(outlineTree(page), 'Plán: tree');
  await eventually(() => tabRows(page), (r) => r.length === 11);
  await sleep(300);
  const s0 = await uiSets(core);
  const before = (await stored(core)) ?? outlineUi();
  await clickChevron(page, 'Program');
  await sleep(300);
  assert.equal(await uiSets(core), s0 + 1, 'collapsing Program sends exactly one ui_state_set');
  const s1 = await stored(core);
  assert.deepEqual(s1?.vaults?.[nfc(VAULT_PATH)]?.outline?.collapsed, { [ID('01')]: ['1:Program#1'] }, 'vaults[<vault>].outline.collapsed["01JC5N…01"] = ["1:Program#1"]');
  const strip = (s: any) => { const c = structuredClone(s ?? {}); delete c?.vaults?.[nfc(VAULT_PATH)]?.outline; if (c.vaults && !Object.keys(c.vaults[nfc(VAULT_PATH)] ?? {}).length) delete c.vaults[nfc(VAULT_PATH)]; if (c.vaults && !Object.keys(c.vaults).length) delete c.vaults; return c; };
  assert.deepEqual(strip(s1), strip(before), 'every other field is as the UI read it');
  await clickChevron(page, 'Program');
  await sleep(300);
  assert.equal(await uiSets(core), s0 + 2, 'expanding sends one more ui_state_set');
  assert.equal((await foldsStored(core))?.[ID('01')], undefined, 'which removes the note\'s entry');
  // Stale keys: rename Program in the editor, then the next fold write drops `1:Program#1`.
  await clickChevron(page, 'Program');
  await selectText(await must(headingEl(page, 'Program'), 'heading Program'), 'Program');
  await page.keyboard.type('Pořad');
  await eventually(() => rowOf(page, 'Pořad'), (x) => !!x);
  await clickChevron(page, 'Cíle');
  await sleep(300);
  assert.deepEqual((await foldsStored(core))?.[ID('01')], ['1:Cíle#1'], 'the next fold write for Plán drops `1:Program#1`');
  assert.deepEqual(await vaultWrites(core).then((w) => w.filter((x) => x !== 'note_write')), [], 'no fold change sends a vault write command (the note_writes are the rename\'s autosave)');

  // Collapse all on Čtenářské: the 14 keys in note order, one write.
  const { p: c, core: cc } = await another(page, noteRoute(P.cten));
  await must(outlineTree(c), 'Čtenářské: tree');
  await sleep(300);
  const cs0 = await uiSets(cc);
  await (await must(collapseAllBtn(c), 'Collapse all')).click();
  await sleep(300);
  assert.equal(await uiSets(cc), cs0 + 1, 'Collapse all: one write');
  const H1 = ['Úvod', 'Spolehlivé systémy', 'Datové modely', 'Ukládání a vyhledávání', 'Kódování', 'Replikace'];
  const H1b = ['Dělení dat', 'Transakce', 'Konzistence', 'Dávkové zpracování', 'Proudy', 'Závěr'];
  assert.deepEqual((await foldsStored(cc))?.[ID('03')], [...H1.map((t) => `1:${t}#1`), '2:Vedoucí a následovníci#1', '2:Zpoždění replikace#1', ...H1b.map((t) => `1:${t}#1`)], 'the 14 keys in note order');
  // Duplicate texts on Okraje.
  const { p: o, core: oc } = await another(page, noteRoute(P.okraje));
  await must(outlineTree(o), 'Okraje: tree');
  await eventually(() => tabRows(o), (r) => r.length === 11);
  await clickChevron(o, 'Poznámky', { n: 0 });
  await sleep(300);
  assert.deepEqual((await foldsStored(oc))?.[ID('04')], ['2:Poznámky#1'], 'the first Poznámky stores ["2:Poznámky#1"]');
  const lastP = (await tabRows(o)).filter((x) => x.label === 'Poznámky');
  assert.equal(lastP[lastP.length - 1]?.chevron, false, 'the last Poznámky (2:Poznámky#2) has no chevron');
  // No id: the NFD route stores under the NFC path, then moves to the new id after the first Saved.
  const { p: b, core: bc } = await another(page, `note/${P.bezHlavicky.normalize('NFD')}`);
  await must(outlineTree(b), 'Bez hlavičky: tree');
  await eventually(() => tabRows(b), (r) => r.length === 3);
  await clickChevron(b, 'Jedna');
  await sleep(300);
  assert.deepEqual(await foldsStored(bc), { [nfc(P.bezHlavicky)]: ['1:Jedna#1'] }, 'stored under `Pages/Bez hlavičky.md` in NFC');
  const sets = await uiSets(bc);
  await placeCaret(await must(editorBody(b).locator('p').first(), 'a paragraph'), 'end');
  await b.keyboard.type(' a dál');
  const text = await eventually(async () => (await bc.files())[nfc(P.bezHlavicky)] ?? '', (t) => /^id: /m.test(t), 6000);
  const id = /^id: (\S+)$/m.exec(text)?.[1];
  assert.ok(id, 'setup: the first edit writes an id (FR-FMT-02 AC-5)');
  const moved = await eventually(() => foldsStored(bc), (f) => !!f && !!f[id!], 3000);
  assert.deepEqual(moved, { [id!]: ['1:Jedna#1'] }, 'the entry moves to the new id key');
  assert.equal(await uiSets(bc), sets + 1, 'in one ui_state_set after the Saved');
  // The 200 cap.
  const seeded: Record<string, string[]> = {};
  for (let i = 0; i < 200; i++) seeded[`01JC5Z${String(i).padStart(20, '0')}`] = ['1:Kapitola#1'];
  const { p: q, core: qc } = await another(page, noteRoute(P.plan), { folds: seeded });
  await must(outlineTree(q), 'Plán with 200 seeded entries: tree');
  await clickChevron(q, 'Program');
  await sleep(300);
  const all = await foldsStored(qc);
  const keys = Object.keys(all ?? {});
  assert.equal(keys.length, 200, '200 entries after the write');
  assert.ok(!keys.includes(Object.keys(seeded)[0]), 'the oldest is dropped');
  assert.equal(keys[keys.length - 1], ID('01'), 'Plán\'s entry is last');
  // Separate vaults: an entry of another vault folds nothing here.
  const other = '/fake/Jiný trezor';
  const { p: v } = await another(page, noteRoute(P.plan), { folds: { [ID('01')]: ['1:Program#1'] }, vaultKey: other });
  await must(outlineTree(v), 'Plán with another vault\'s fold: tree');
  assert.ok((await eventually(() => tabRows(v), (r) => r.length === 11)).every((x) => x.expanded !== 'false'), 'a second vault starts with nothing collapsed');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-10

test('fr_fmt_12_ac10_nfd_heading_same_fold_key', async ({ page }) => {
  const NFC = 'Složky podle typu';
  const vault = outlineVault((f) => { f[P.arch] = f[P.arch].replace(`### ${NFC}`, `### ${NFC.normalize('NFD')}`); });
  assert.notEqual(vault.files[P.arch], original(P.arch), 'setup: the line is NFD at runtime');
  const core = await startOutline(page, noteRoute(P.arch), { vault });
  await must(outlineTree(page), 'Architektura: tree');
  const r = await eventually(() => tabRows(page), (x) => x.length === 18);
  assert.equal(r[2]?.label, NFC, 'the row\'s accessible name is NFC-equal to Složky podle typu');
  assert.equal(r[2]?.text, NFC, 'it reads the same as before');
  await clickChevron(page, NFC);
  await sleep(300);
  assert.deepEqual((await foldsStored(core))?.[ID('02')], ['3:Složky podle typu#1'], 'collapsing stores `3:Složky podle typu#1` in NFC');
  await core.setFile(P.arch, original(P.arch));
  await sleep(1500);
  assert.equal((await eventually(() => rowOf(page, NFC), (x) => x?.expanded === 'false'))?.expanded, 'false', 'rewritten back to NFC by another program: still collapsed');
});

