// MS4 slice 4D-lite L5 (WebKit, fake core): the tag filter in Search (docs/acceptance/tags.md FR-SRC-02 AC-10 (the
// D-518 control: options with count ≥ 1, most used first, coloured chips), AC-11 (all selected tags must match, with
// text), AC-12 (a `#tag` chip in a Search result adds it to the filter; elsewhere it opens `tag/<key>`; `search/tag:<x>`
// is no longer produced). Interface docs/contracts/ms4-tags.md §1.5, §6.4 (`tasks/TagFilter.tsx`, `search({ tags })`).
// Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, callsOf, chipColours, click, eventually, flat, main, must, openNote, runCommand, seen, sleep, startTags, tagHeading, vaultWrites,
} from './tags-helpers';
import { ui as tagsUi } from './tags-helpers';
import { escPreview, mustNoPreview, mustPreview, switchPreviewMode } from './helpers';
import { setPreviewMode } from '../ui/test/fake-core';

const combo = (page: Page) => main(page).getByRole('combobox', { name: 'Filter by tag', exact: true });
const input = (page: Page) => combo(page).locator('xpath=self::input | .//input').first();
const list = (page: Page) => page.getByRole('listbox', { name: 'Tags', exact: true });
async function searchCalls(page: Page, core: Awaited<ReturnType<typeof startTags>>) {
  void page;
  return (await callsOf(core, 'index_search')).map((c) => (c.args as any)?.query ?? {});
}
async function addTag(page: Page, typed: string) {
  await click(input(page), 'the tag filter');
  await page.keyboard.type(typed);
  await sleep(100);
  await page.keyboard.press('Enter');
}

test('fr_src_02_ac10_the_tag_filter_control', async ({ page }) => {
  const core = await startTags(page, { route: 'search' });
  await must(combo(page), 'combobox "Filter by tag" (D-518)', 5000);
  await click(input(page), 'the filter');
  await must(list(page), 'listbox Tags');
  const opts = (await list(page).getByRole('option').allInnerTexts()).map((o) => flat(o));
  assert.equal(opts.length, 8, `every tag with count ≥ 1 (no prázdný, no cizí): ${opts.join(' | ')}`);
  assert.match(opts[0], /^#Účty\b.*6/, 'most used first, with its count');
  assert.ok(!opts.some((o) => /prázdný|cizí/.test(o)), 'count-0 tags are not offered (AP-661 (f))');
  await page.keyboard.type('ucty');
  await sleep(100);
  await page.keyboard.press('Enter');
  const chipBtn = await must(main(page).getByRole('button', { name: 'Remove #Účty', exact: true }), 'chip #Účty with Remove #Účty');
  const c = await chipColours(chipBtn.locator('xpath=..'), 'blue');
  assert.deepEqual([c.bg, c.fg], [c.wantBg, c.wantFg], 'the chip is coloured (FR-TAG-05 AC-6)');
  await must(main(page).getByRole('button', { name: 'Clear tags', exact: true }), 'Clear tags');
  assert.deepEqual(await vaultWrites(core), [], 'the filter is written nowhere in the vault');
});

test('fr_src_02_ac11_all_selected_tags_must_match', async ({ page }) => {
  // D-943: the steps run with Object preview Off; click mode (AP-819) follows on the read-view page.
  const core = await startTags(page, { ...setPreviewMode('off', { uiState: tagsUi() }), route: 'search' });
  await must(combo(page), 'the tag filter', 5000);
  await addTag(page, 'Účty');
  const q1 = await eventually(() => searchCalls(page, core), (q) => q.some((x: any) => JSON.stringify(x.tags) === JSON.stringify(['účty'])), 2000);
  assert.ok(q1.some((x: any) => JSON.stringify(x.tags) === JSON.stringify(['účty'])), 'search({ tags: [účty] }) with an empty query');
  const results = main(page).getByRole('list', { name: /results/i }).or(main(page).getByRole('listbox', { name: /results/i }));
  await must(results.getByText('Faktura', { exact: true }), 'the six objects of R80');
  await addTag(page, 'finance');
  await must(main(page).getByText('Objects with all selected tags', { exact: true }), 'the hint');
  const q2 = await eventually(() => searchCalls(page, core), (q) => q.some((x: any) => (x.tags ?? []).length === 2), 2000);
  assert.ok(q2.some((x: any) => JSON.stringify([...(x.tags ?? [])].sort()) === JSON.stringify(['finance', 'účty'])), 'both tags');
  await must(results.getByText('Rozpočet', { exact: true }), 'only Rozpočet');
  assert.equal(await results.getByText('Faktura', { exact: true }).count(), 0, 'Faktura no longer');
});

test('fr_src_02_ac12_a_tag_chip_in_a_result_adds_it_and_elsewhere_opens_the_tag_page', async ({ page }) => {
  // D-943: the steps run with Object preview Off; click mode (AP-819) follows on the read-view page.
  const core = await startTags(page, { ...setPreviewMode('off', { uiState: tagsUi() }), route: 'search' });
  await must(combo(page), 'the tag filter', 5000);
  await page.getByRole('searchbox').or(page.getByRole('textbox', { name: /search/i })).first().fill('poslat');
  const hit = main(page).getByRole('link', { name: /^#účty$/i }).or(main(page).getByRole('button', { name: /^#účty$/i }));
  if (await seen(hit, 2000)) {
    await hit.first().click();
    await must(main(page).getByRole('button', { name: 'Remove #Účty', exact: true }), 'activating #účty in a result adds it to the filter (D-706)');
  } // else: Search shows no #tag chip in this result (the AC's "when Search shows one").
  const p2 = await page.context().newPage();
  const c2 = await openNote(p2, P.faktura, 'Faktura', { ...setPreviewMode('off', { uiState: tagsUi() }), readView: true });
  await click(p2.getByRole('main').getByRole('link', { name: /^#účty$/i }), '#účty in the read view');
  await must(tagHeading(p2, 'Účty'), 'elsewhere it opens tag/účty, never Search (D-143 retired)');
  const marks = (await callsOf(c2, 'perf_mark')).map((c) => String((c.args as any)?.mark ?? ''));
  assert.ok(!marks.some((m) => m.startsWith('route-ready:search/tag:')), 'no search/tag:<x> route is produced');

  // Click to preview (D-943, AP-819): outside a result a click on the tag chip previews the Tag, a double-click opens
  // tag/účty; inside a result the chip still adds the filter (checked above, mode-independent).
  await p2.keyboard.press('Meta+BracketLeft');
  await must(p2.getByRole('main').getByRole('link', { name: /^#účty$/i }), 'Back on Faktura', 5000);
  await switchPreviewMode(p2, c2, 'click');
  await click(p2.getByRole('main').getByRole('link', { name: /^#účty$/i }), '#účty in the read view (click mode)');
  await mustPreview(p2, '#Účty', 'click mode: a click on the tag chip previews the Tag');
  await escPreview(p2, 'click mode: the Tag preview');
  await (await must(p2.getByRole('main').getByRole('link', { name: /^#účty$/i }), '#účty (double-click)')).dblclick();
  await must(tagHeading(p2, 'Účty'), 'click mode: a double-click opens tag/účty, never Search');
  const marks2 = (await callsOf(c2, 'perf_mark')).map((c) => String((c.args as any)?.mark ?? ''));
  assert.ok(!marks2.some((m) => m.startsWith('route-ready:search/tag:')), 'click mode: no search/tag:<x> route is produced');
  await p2.close();
  assert.deepEqual(await vaultWrites(core), [], 'nothing written');
});

test('fr_src_02_ac12_an_old_search_tag_route_opens_search_with_the_filter', async ({ page }) => {
  await startTags(page, { route: 'search/tag:účty' });
  await must(main(page).getByRole('button', { name: 'Remove #Účty', exact: true }), 'search/tag:účty opens Search with #Účty in the filter (ms4-tags §1.5)', 5000);
  void runCommand;
});
