// 5B preview feedback round 2, G6 (docs/feedback/ms5-5b2.md): the editor shows a GFM table like the read view
// (editor.md FR-EDT-02 AC-16, read-view.md FR-EDT-02 AC-4): the column alignments of the delimiter row, header cells
// left aligned unless aligned, and a table wider than the page keeps its width and scrolls sideways (no mid-word breaks).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { editorBody, editorVault, must, openEditor, writes } from './editor-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const P = 'Pages/Tabulky.md';
const TEXT = '---\nid: 01JB5B2TAB000000000000T001\ntype: page\ntitle: Tabulky\n---\n\n| Název | Stav | Částka |\n| --- | :---: | ---: |\n| Alfa | hotovo | 120 |\n\n'
  + `| ${Array.from({ length: 10 }, (_, i) => `sloupec${i + 1}`).join(' | ')} |\n|${' --- |'.repeat(10)}\n| ${Array.from({ length: 10 }, (_, i) => `hodnota${i + 1}dlouhá`).join(' | ')} |\n`;

test('bug_ms5b2_fr_edt_02_table_alignment_and_width', async ({ page }) => {
  const v = editorVault();
  v.files[P] = TEXT;
  const core = await openEditor(page, P, { vault: v });
  const body = await must(editorBody(page), 'textbox "Note body"');
  const tables = body.locator('table');
  await must(tables.nth(1), 'the second table');
  const align = await tables.nth(0).evaluate((t) => [...t.querySelectorAll('tr')].map((r) => [...r.children].map((c) => getComputedStyle(c).textAlign)));
  const norm = (a: string) => (a === 'start' ? 'left' : a === 'end' ? 'right' : a);
  for (const [i, row] of align.entries()) assert.deepEqual(row.map(norm), ['left', 'center', 'right'], `row ${i + 1}: alignments of | --- | :---: | ---: |`);
  const wide = await tables.nth(1).evaluate((t) => {
    const cells = [...t.querySelectorAll('th, td')] as HTMLElement[];
    const lineH = parseFloat(getComputedStyle(cells[0]).lineHeight) || 22;
    let scroller: HTMLElement | null = t.parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
    return { wrapped: cells.filter((c) => c.getBoundingClientRect().height > lineH * 1.6 + 10).map((c) => c.innerText), tableW: t.getBoundingClientRect().width, scrollerCls: scroller?.className ?? null, scrollerW: scroller?.clientWidth ?? 0, scrollW: scroller?.scrollWidth ?? 0 };
  });
  assert.deepEqual(wide.wrapped, [], 'no cell of the wide table wraps');
  assert.ok(wide.scrollerCls !== null && !/ProseMirror|editor-host/.test(String(wide.scrollerCls)) && wide.scrollW > wide.scrollerW, `the wide table scrolls sideways in its own scroller (${JSON.stringify(wide)})`);
  assert.equal((await writes(core, P)).length, 0, 'opening the note writes nothing');
});
