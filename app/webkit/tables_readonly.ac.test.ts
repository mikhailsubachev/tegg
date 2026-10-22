// v0.52 feedback, L5 (WebKit + fake core): tables the editor can't edit losslessly. docs/acceptance/editor.md FR-EDT-02
// AC-22 (D-606, AP-528): a rendered, read-only `table` instead of the monospace source block, in the editor and the
// read view; `[[…|…]]` with a bare `|` in a cell is one link; a short row gets empty cells and a long row extends the
// header. Interface docs/contracts/ms3-shell.md §16.4 (`data-table-readonly=""`, `aria-description`
// `Edit in the source view`), §13.5 (editor labels; `Source block` group), ms4-embeds R30 (D-428 block selection,
// `data-block-selected`). Written from the AC and the contracts only (D-61). Every lookup goes through `must`/node:assert
// (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { editorBody, editorVault, eventually, must, openEditor, sleep, sourceBlocks, writes, type FakeCoreHandle } from './editor-helpers';
import { start, mustBeOn } from './helpers';

const TABULKA = 'Pages/Tabulka.md';
const TABLE = [
  '| # | Projekt | Skóre |',
  '| --- | --- | --- |',
  '| 1 | [[Projekty/Alfa|Alfa]] · [ALF-7](https://example.com/ALF-7) | 74 |',
  '| 2 | Beta | 58 | navíc |',
  '| 3 | Gama |',
].join('\n');
const TEXT = `---\nid: 01JB0E0000000000000000T052\ntype: page\ntitle: Tabulka\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\nPřed tabulkou.\n\n${TABLE}\n\nPo tabulce.\n`;
const ALFA = '---\nid: 01JB0E0000000000000000T053\ntype: page\ntitle: Alfa\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\nProjekt Alfa.\n';

function tableVault(withAlfa = true) {
  const v = editorVault();
  v.files[TABULKA] = TEXT;
  if (withAlfa) v.files['Projekty/Alfa.md'] = ALFA;
  return v;
}
async function openTabulka(page: Page, o: { readView?: boolean; withAlfa?: boolean } = {}): Promise<FakeCoreHandle> {
  if (o.readView) {
    await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; });
    const core = await start(page, { vault: tableVault(o.withAlfa ?? true), last: { path: TABULKA, id: '01JB0E0000000000000000T052' } });
    await mustBeOn(page, 'Tabulka', 'landing on Tabulka', 5000);
    return core;
  }
  return openEditor(page, TABULKA, { vault: tableVault(o.withAlfa ?? true) });
}

type Cell = { text: string; chip: { kind: string | null; text: string } | null; external: string | null };
/** The rendered table's header and body rows (cells as text, link chip and external link). */
async function tableOf(scope: Locator): Promise<{ header: Cell[]; rows: Cell[][]; readonly: boolean; description: string } | null> {
  return scope.first().evaluate((root) => {
    const t = root.querySelector('table');
    if (!t) return null;
    const cell = (c: Element) => {
      const chip = c.querySelector('[data-link-kind]:not([data-link-kind="external"])');
      // The read view's external link (FR-EDT-02, ms3-shell §11.1): `data-link-kind="external"`, the URL in `title`;
      // it never navigates itself (owner-approved change, v0.52).
      const a = c.querySelector('a[data-link-kind="external"]');
      return {
        text: ((c as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC'),
        chip: chip ? { kind: chip.getAttribute('data-link-kind'), text: ((chip as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC') } : null,
        external: a ? `${((a as HTMLElement).innerText ?? '').trim()}|${a.getAttribute('title')}` : null,
      };
    };
    const trs = [...t.querySelectorAll('tr')];
    const header = trs.length ? [...trs[0].querySelectorAll('th, td')].map(cell) : [];
    const rows = trs.slice(1).map((r) => [...r.querySelectorAll('th, td')].map(cell));
    const holder = t.closest('[data-table-readonly]') as HTMLElement | null;
    const ids = (holder?.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const description = (holder?.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).trim();
    return { header, rows, readonly: !!holder, description };
  });
}
function assertTable(tb: Awaited<ReturnType<typeof tableOf>>, how: string, alfaKind = 'note') {
  assert.ok(tb, `${how}: a table element is shown, not the source block`);
  assert.deepEqual(tb!.header.map((c) => c.text), ['#', 'Projekt', 'Skóre', ''], `${how}: 3 header cells plus one empty header cell`);
  assert.equal(tb!.rows.length, 3, `${how}: three body rows`);
  const [r1, r2, r3] = tb!.rows;
  assert.equal(r1.length, 4, `${how}: row 1 has 4 cells (the header's width)`);
  assert.equal(r1[0].text, '1', `${how}: row 1 cell 1`);
  assert.deepEqual(r1[1].chip, { kind: alfaKind, text: 'Alfa' }, `${how}: [[Projekty/Alfa|Alfa]] is one link chip "Alfa" (${alfaKind})`);
  assert.equal(r1[1].external, 'ALF-7|https://example.com/ALF-7', `${how}: ALF-7 is an external link`);
  assert.equal(r1[2].text, '74', `${how}: 74 in the third cell`);
  assert.deepEqual(r2.map((c) => c.text), ['2', 'Beta', '58', 'navíc'], `${how}: row 2 with 4 cells`);
  assert.deepEqual(r3.map((c) => c.text), ['3', 'Gama', '', ''], `${how}: row 3 with Gama and two empty cells`);
  assert.equal(tb!.readonly, true, `${how}: data-table-readonly`);
  assert.equal(tb!.description, 'Edit in the source view', `${how}: description "Edit in the source view"`);
}

test('fr_edt_02_ac22_an_unequal_row_table_renders_as_a_read_only_table', async ({ page }) => {
  await openTabulka(page);
  const body = await must(editorBody(page), 'the editor');
  await eventually(() => tableOf(body), (t) => !!t, 3000);
  assert.equal(await sourceBlocks(page).filter({ hasText: '| # | Projekt' }).count(), 0, 'no monospace source block for the table');
  assertTable(await tableOf(body), 'editor');
});

test('fr_edt_02_ac22_a_missing_target_is_a_broken_chip', async ({ page }) => {
  await openTabulka(page, { withAlfa: false });
  const body = await must(editorBody(page), 'the editor');
  await eventually(() => tableOf(body), (t) => !!t, 3000);
  assertTable(await tableOf(body), 'editor without Projekty/Alfa.md', 'unresolved');
});

test('fr_edt_02_ac22_the_read_only_table_is_a_block_and_writes_nothing', async ({ page }) => {
  const core = await openTabulka(page);
  const body = await must(editorBody(page), 'the editor');
  assert.ok(await eventually(() => tableOf(body).then((t) => !!t?.readonly), (x) => x, 3000), 'the read-only table is shown');
  const blk = body.locator(':scope > *').nth(1);
  const html0 = await blk.innerText();
  const beta = await must(blk.getByText('Beta', { exact: true }), 'cell Beta');
  await beta.click();
  const selected = await eventually(() => body.evaluate((b) => [...b.children].map((e, i) => (e.hasAttribute('data-block-selected') ? i + 1 : 0)).filter(Boolean)), (x) => x.length > 0, 1000);
  assert.deepEqual(selected, [2], 'a click selects the table as a block (D-428)');
  await page.keyboard.type('xyz');
  await sleep(1500);
  assert.equal(await blk.innerText(), html0, 'typing into it changes nothing');
  assert.deepEqual((await writes(core)).map((w) => (w.args as any)?.path), [], 'opening, clicking and typing write nothing (FR-FMT-07)');
  assert.equal((await core.files())[TABULKA], TEXT, 'the file is unchanged');
});

test('fr_edt_02_ac22_the_read_view_renders_the_same_table', async ({ page }) => {
  await openTabulka(page, { readView: true });
  const art = await must(page.getByRole('article', { name: 'Tabulka', exact: true }).or(page.getByRole('main')), 'the read view');
  await eventually(() => tableOf(art), (t) => !!t, 3000);
  assertTable(await tableOf(art), 'read view');
});

test('fr_edt_02_ac22_a_lossless_table_stays_editable', async ({ page }) => {
  // Red guard first: the unequal table is rendered read-only.
  await openTabulka(page);
  assert.equal((await tableOf(await must(editorBody(page), 'the editor')))?.readonly ?? false, true, 'guard: the unequal table is read-only');
  const p2 = await page.context().newPage();
  await openEditor(p2, 'Pages/Deset bloků.md');
  const tbl = await must(editorBody(p2).locator('table'), 'Deset bloků\'s table');
  assert.equal(await tbl.evaluate((t) => !!t.closest('[data-table-readonly]')), false, 'a lossless table is not read-only (AC-16)');
  await p2.close();
});
