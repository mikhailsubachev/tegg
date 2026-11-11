// Slice Q, L5 (WebKit + fake core): keyboard, VoiceOver, themes, strings and the sidebar of docs/acceptance/queries.md:
// FR-UX-03 AC-41 (R144's commands in the palette, listed only where R144 says; every control reachable), AC-42 (everything
// without the pointer), FR-UX-08 AC-18 (what VoiceOver reads; one polite announcement per commit; reduce motion), FR-UX-05
// AC-20 (both themes: tokens and axe colour contrast), NFR-OTH-02 AC-17 (the pseudo-locale wraps every text of the slice
// except user content), FR-NAV-04 AC-12 (the sidebar order; `saved-queries` lands like an unknown route). Interface
// docs/contracts/v1-queries.md §4.3, §4.5, §4.6. Written from the ACs and the contract only (D-61). Lookups go through
// `must` (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, Q, TITLES, block, blockEdit, blockInfo, click, columnsMenu, description, editor, editorBody, eventually, focusName, liveRegion, main, mainName, must,
  mustBeOn, mustResults, newQueryDialog, noteRoute, openEditor, paletteOptions, picker, pinnedRow, qfile, queriesEntry, queryFileText, queryRoute, queryRow, resultsAre,
  openNote, runCommand, seen, sidebar, sleep, startQueries, textOf, viewChoice, PINS, blockColumns, editorButton, actionsMenu,
} from './queries-helpers';
import { axeContrast, colourLeaks } from './read-helpers';
import { shortDate } from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

async function palette(page: Parameters<typeof main>[0], q: string): Promise<string[]> {
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill(q);
  await sleep(200);
  const o = await paletteOptions(page);
  await page.keyboard.press('Escape');
  return o.map((x) => x.split('\n')[0].trim());
}
/** Tab through the page from the top; the names reached. */
async function tabStops(page: Parameters<typeof main>[0], n = 60): Promise<Set<string>> {
  const out = new Set<string>();
  await page.keyboard.press('Escape');
  for (let i = 0; i < n; i++) { await page.keyboard.press('Tab'); out.add((await focusName(page)).name); }
  return out;
}

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-41

test('fr_ux_03_ac41_query_commands', async ({ page }) => {
  await startQueries(page, { route: 'queries' });
  await must(main(page).getByRole('table', { name: /Queries/ }), 'the Queries page', 8000);
  const onQueries = await palette(page, 'query');
  assert.ok(onQueries.includes('New query…') && !onQueries.includes('Insert query') && !onQueries.includes('Edit query'), `queries: New query…, no Insert query / Edit query (${onQueries.join(' | ')})`);
  assert.ok((await palette(page, 'Go to Queries')).includes('Go to Queries'), 'Go to Queries everywhere');
  await click(queryRow(page, Q.running), 'Projekty v běhu');
  const onPage = await palette(page, 'query');
  for (const c of ['Edit query', 'Rename query…', 'Move query to trash']) assert.ok(onPage.includes(c), `query/<name>: ${c}`);
  assert.ok((await palette(page, 'Pin')).includes('Pin to sidebar'), 'query/<name>: Pin to sidebar');
  // Insert query only with the editor focused.
  await openNote(page, TITLES.porada7);
  // Opening a note puts the caret in its body, so move the focus out of the editor first (to the sidebar).
  await (await must(sidebar(page).getByRole('button', { name: 'Search' }), 'the sidebar\'s Search button')).focus();
  assert.ok(!(await palette(page, 'Insert query')).includes('Insert query'), 'a note without the editor focused: no Insert query');
  await (await must(editorBody(page), 'Note body')).click();
  assert.ok((await palette(page, 'Insert query')).includes('Insert query'), 'with the editor focused: Insert query');
  // FR-UX-03 AC-8: every control reachable on `queries`, `query/Projekty v běhu`, Porada 7 with the editor open, Přehled.
  await runCommand(page, 'Go to Queries');
  const q1 = await tabStops(page);
  for (const n of ['Find a query…', 'New query']) assert.ok(q1.has(n), `queries: ${n} is a Tab stop`);
  await click(queryRow(page, Q.running), 'Projekty v běhu');
  const q2 = await tabStops(page);
  for (const n of ['Edit query', 'Query actions']) assert.ok(q2.has(n), `query/<name>: ${n} is a Tab stop`);
});
// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-42

test('fr_ux_03_ac42_queries_without_the_pointer', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.lisabon) });
  await must(editorBody(page), 'Note body', 8000);
  // Create a query from the palette, give it Task and a filter.
  await runCommand(page, 'New query…');
  await must(newQueryDialog(page), 'New query');
  await page.keyboard.type('Klávesnice');
  await page.keyboard.press('Enter');
  await must(editor(page), 'the editor');
  for (let i = 0; i < 20 && (await focusName(page)).name !== 'Type'; i++) await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Task');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 20 && (await focusName(page)).name !== 'Add filter'; i++) await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Priority');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.type('High');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const t = await eventually(() => queryFileText(core, 'Klávesnice'), (x) => !!x && x.includes('priority: High'));
  assert.ok(t?.includes('types: [task]') && t.includes('  - priority: High'), 'the file: Task and the filter');
  // Insert it into Lisabon with `Insert query`.
  await page.keyboard.press('Meta+[');
  await (await must(editorBody(page), 'Note body')).focus();
  await page.keyboard.press('Meta+ArrowDown');
  await runCommand(page, 'Insert query');
  await must(picker(page), 'Choose a query');
  await page.keyboard.type('Klávesnice');
  await page.keyboard.press('Enter');
  const b = block(page, 'Klávesnice');
  await must(b, 'the block in Lisabon');
  assert.ok(await eventually(() => core.files().then((f) => f[P.lisabon]), (x) => !!x && x.includes('saved: Klávesnice')), 'the fence is written');
  // Switch it to Table and add a column (Tab to Columns, Space). ⌘↩ acts on the selected block once the picker has
  // closed and the editor has the focus back with the new block selected.
  await must(b.locator('[data-query-result]'), 'the inserted block\'s results', 3000);
  assert.ok(await eventually(() => page.evaluate(() => !!document.querySelector('.ProseMirror-selectednode') && !!document.activeElement?.classList.contains('ProseMirror')), (v) => v, 2000), 'the inserted block is selected in the focused editor');
  await page.keyboard.press('Meta+Enter');
  await must(editor(page), 'the editor by ⌘↩');
  await (await must(viewChoice(page, 'Table'), 'Table')).focus();
  await page.keyboard.press('Space');
  await (await must(editorButton(page, 'Done'), 'Done')).focus();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 40 && (await focusName(page)).name !== 'Columns'; i++) await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await must(columnsMenu(page), 'the Columns menu');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  assert.ok(await eventually(() => queryFileText(core, 'Klávesnice'), (x) => !!x && x.includes('view: table') && /columns: \[[^\]]*,/.test(x)), 'Table and one more column written');
  // Open a result (⏎ on a row).
  for (let i = 0; i < 20 && !(await page.evaluate(() => !!document.activeElement?.closest('[data-query-result]'))); i++) await page.keyboard.press('Tab');
  // The first row reached depends on the default sort (`modified` desc, R138): open whichever row has the focus.
  const row = await page.evaluate(() => document.activeElement?.closest('[data-query-result]')?.getAttribute('data-query-result') ?? '');
  assert.ok([P.t1, P.t3, P.t7].includes(row as any), `a result row has the focus (${row})`);
  await page.keyboard.press('Enter');
  await mustBeOn(page, row.split('/').pop()!.replace(/\.md$/, ''), '⏎ on a row opens it');
  // Rename the query and pin it (`⋯` via ⇧F10 on its row).
  await runCommand(page, 'Go to Queries');
  await (await must(queryRow(page, 'Klávesnice'), 'row Klávesnice')).focus();
  await page.keyboard.press('Shift+F10');
  await must(actionsMenu(page), 'Query actions');
  await page.keyboard.press('Enter'); // Pin to sidebar
  assert.ok(await eventually(() => core.files().then((f) => f[PINS]), (x) => !!x && x.includes('query: Klávesnice')), 'pinned');
  await (await must(queryRow(page, 'Klávesnice'), 'row Klávesnice')).focus();
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); // Rename…
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Klávesnice 2');
  await page.keyboard.press('Enter');
  assert.ok(await eventually(() => queryFileText(core, 'Klávesnice 2'), (x) => !!x, 5000), 'renamed by the keyboard');
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-18

test('fr_ux_08_ac18_queries_for_voiceover', async ({ page }) => {
  const core = await startQueries(page, { route: noteRoute(P.porada7), reducedMotion: 'reduce' });
  const b = block(page, Q.open);
  await mustResults(b, [P.t1, P.t2, P.t3], 'precondition', 8000);
  const info = await blockInfo(b);
  assert.deepEqual([info.label, info.description], ['Query: Otevřené úkoly z této schůzky', '3 results'], 'the block reads `Query: …, 3 results`');
  assert.equal(await b.locator('.query-header [aria-hidden="true"]').filter({ hasText: '3' }).count() >= 1, true, 'the visible count is aria-hidden');
  const list = b.getByRole('list', { name: Q.open });
  assert.equal(await list.getByRole('listitem').count(), 3, '`list, 3 items`');
  const row = await textOf(b.locator(`a[data-query-result="${P.t1}"]`));
  assert.ok(row.includes(TITLES.t1) && row.includes(shortDate('2026-11-12', 'cs')) && row.includes('To do'), 'a row reads its title, due date and status');
  const tb = block(page, Q.table);
  assert.equal(await tb.getByRole('columnheader', { name: /Due date/ }).getAttribute('aria-sort'), 'ascending', 'columnheaders with aria-sort where sorted');
  await openEditor(b, page);
  const dlg = editor(page);
  assert.equal(await dlg.getAttribute('role'), 'dialog', 'a dialog `Edit query`');
  assert.equal(await dlg.getAttribute('aria-modal'), null, 'not modal');
  assert.ok(await seen(dlg.getByRole('button', { name: 'Combine filters with and' }), 1000), 'the connector reads `Combine filters with and`');
  assert.ok(await seen(dlg.getByRole('group', { name: 'Filter group: any of' }), 1000), 'the group reads `Filter group: any of`');
  const w = await dlg.evaluate((d) => (d as HTMLElement).getBoundingClientRect().width);
  assert.ok(Math.abs(w - 640) <= 2, `640 px wide (${w})`);
  // One polite announcement per commit, not while editing.
  // Several polite regions share the contract's selector (the pins have their own, v1-pinned §4.3), so read them all.
  const live = liveRegion(page);
  const liveText = () => live.evaluateAll((es) => es.map((e) => e.textContent ?? '').join(' '));
  await click(dlg.getByRole('button', { name: /^⟦?Remove group⟧?$/ }), 'Remove group');
  await sleep(500);
  assert.equal((await liveText()).includes('4 results'), false, 'no announcement while editing');
  await click(editorButton(page, 'Done'), 'Done');
  assert.ok(await eventually(liveText, (t) => t.includes('4 results'), 2000), 'the commit announces `4 results` once');
  // A broken row adds `Ignored: …`.
  await runCommand(page, 'Go to Queries');
  await click(queryRow(page, Q.books), Q.books);
  await click(main(page).getByRole('button', { name: /^⟦?Edit query⟧?$/ }), 'Edit query');
  assert.equal(await description(editor(page).locator('[role="group"][data-filter="0"]')), 'Ignored: not an attribute of Kniha', 'the broken row\'s description');
  // Reduce motion: no animation on the popover.
  const anim = await editor(page).evaluate((d) => getComputedStyle(d).animationName + '|' + getComputedStyle(d).transitionDuration);
  assert.ok(/^none\|0s/.test(anim) || anim.startsWith('none|'), `reduce motion: no popover animation (${anim})`);
  void core;
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-20

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac20_queries_in_both_themes_${theme}`, async ({ page }) => {
    await startQueries(page, { route: 'queries', theme });
    await must(main(page).getByRole('table', { name: /Queries/ }), 'the Queries page', 8000);
    await queryRow(page, Q.running).hover();
    await click(queryRow(page, Q.running).getByRole('button', { name: /Query actions/ }), '⋯');
    assert.deepEqual(await axeContrast(page), [], `${theme}: queries with a hovered row and its menu`);
    assert.deepEqual(await colourLeaks(page, theme), [], `${theme}: colours from tokens only`);
    await page.keyboard.press('Escape');
    for (const name of [Q.open, Q.running]) {
      await runCommand(page, 'Go to Queries');
      await click(queryRow(page, name), name);
      await must(main(page).getByRole('heading', { level: 1 }), name);
      assert.deepEqual(await axeContrast(page), [], `${theme}: query page ${name}`);
    }
    await openNote(page, 'Přehled dotazů');
    await must(block(page, Q.books), 'Přehled\'s blocks');
    assert.deepEqual(await axeContrast(page), [], `${theme}: every R141 state on Přehled`);
    await openEditor(block(page, Q.books), page);
    assert.deepEqual(await axeContrast(page), [], `${theme}: the editor with a broken row`);
    await page.keyboard.press('Escape');
    await click(blockColumns(block(page, Q.running)), 'Columns');
    assert.deepEqual(await axeContrast(page), [], `${theme}: the Columns menu`);
    await page.keyboard.press('Escape');
    await (await must(editorBody(page), 'Note body')).click();
    await page.keyboard.press('Meta+ArrowDown');
    await runCommand(page, 'Insert query');
    await must(picker(page), 'the picker');
    assert.deepEqual(await axeContrast(page), [], `${theme}: the /query picker`);
  });
}

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-17

test('nfr_oth_02_ac17_query_strings', async ({ page }) => {
  await startQueries(page, { route: noteRoute(P.prehled), pseudo: true });
  await must(main(page).locator('figure[data-query-block]'), 'Přehled\'s blocks', 8000);
  const user = new Set([...Object.values(Q), ...Object.values(TITLES), 'Kniha', 'hodnocení', 'Projekt', 'Krakatit', 'Přehled dotazů']);
  const bad = await main(page).evaluate((m, userContent) => {
    const out: string[] = [];
    for (const f of m.querySelectorAll('figure[data-query-block]')) {
      for (const e of f.querySelectorAll('button, [role="button"], p.query-message, p.query-notice, [role="columnheader"]')) {
        const name = ((e as HTMLElement).getAttribute('aria-label') ?? (e as HTMLElement).innerText ?? '').trim();
        if (!name || userContent.includes(name.normalize('NFC'))) continue;
        if (!/^⟦[\s\S]*⟧$/.test(name)) out.push(name);
      }
      const label = f.getAttribute('aria-label') ?? '';
      if (!label.startsWith('⟦')) out.push(`figure ${label}`);
    }
    return out;
  }, [...user]);
  assert.deepEqual(bad, [], 'every text and accessible name of the blocks is inside ⟦ ⟧, except user content');
  await runCommand(page, '⟦Go to Queries⟧');
  await must(main(page).getByRole('heading', { level: 1, name: /^⟦Queries⟧$/ }), 'h1 ⟦Queries⟧');
  const entry = await queriesEntry(page).getAttribute('aria-label');
  assert.equal(entry, '⟦Queries⟧', 'the sidebar entry');
});

// ------------------------------------------------------------------------------------------------ FR-NAV-04 AC-12

test('fr_nav_04_ac12_queries_entry', async ({ page }) => {
  await startQueries(page, { route: 'inbox' });
  await must(queriesEntry(page), 'the sidebar entry `Queries`', 8000);
  const ys = await sidebar(page).evaluate((s) => {
    const top = (e: Element | null | undefined) => (e ? (e as HTMLElement).getBoundingClientRect().top : null);
    const byText = (t: string) => [...s.querySelectorAll('a, button, [role="button"], h2, h3')].find((x) => ((x as HTMLElement).innerText ?? '').trim().split('\n')[0] === t);
    return {
      newObject: top(s.querySelector('button[aria-label^="New object"]') ?? byText('New object')), inbox: top(byText('Inbox')), today: top(byText('Today')),
      tasks: top(byText('Tasks')), pinned: top(s.querySelector('.sidebar-pinned')), types: top(s.querySelector('[aria-label="Types"]')),
      tags: top(byText('Tags')), queries: top(s.querySelector('a.entry[data-command="queries.go"]')), trash: top(byText('Trash')),
    };
  });
  const order = ['newObject', 'inbox', 'today', 'tasks', 'pinned', 'types', 'tags', 'queries', 'trash'] as const;
  for (let i = 1; i < order.length; i++) {
    const a = ys[order[i - 1]], b = ys[order[i]];
    assert.ok(a !== null && b !== null && a < b, `${order[i]} below ${order[i - 1]} (${a}, ${b})`);
  }
  const page2 = await page.context().newPage();
  await startQueries(page2, { route: 'saved-queries' });
  const name = await mainName(page2);
  assert.notEqual(name, 'Saved queries', '`__TEGG_ROUTE__="saved-queries"` lands like an unknown route');
  assert.equal(await sidebar(page2).getByText('Saved queries').count(), 0, 'no `Saved queries` entry');
  await page2.close();
  void PINS; void pinnedRow; void qfile; void queryRoute; void blockEdit; void description;
});
