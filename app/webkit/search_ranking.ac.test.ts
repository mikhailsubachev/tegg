// MS3 3D follow-up, L5 (WebKit + fake core): file-name hits and the rendered tier order in the `search` route.
// FR-SRC-01 AC-14, AC-15 (rendered order, once). docs/acceptance/search-navigation.md; interface
// docs/contracts/ms3-shell.md §15.1 (`file_name` snippet, label `search.fileName` = `File name: {stem}`), §15.8 (fake
// core). Written from the ACs and the contract only (D-61). Missing elements fail through `must`/node:assert (TS-I1).
// Highlights are expected as `<mark>` elements (the HTML element for highlighted text; see the report's gaps).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault, type FakeVault } from '../ui/test/fake-core';
import { must, mustBeOn, sleep, start } from './helpers';

function rankingVault(): FakeVault {
  return { ...loadFixtureVault('tests/fixtures/vaults/search-ranking', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Hledání' };
}
const results = (page: Page) => page.getByRole('list', { name: 'Search results', exact: true });
async function search(page: Page, text: string) {
  await start(page, { vault: rankingVault() });
  await page.keyboard.press('Meta+Shift+f');
  await mustBeOn(page, 'Search', 'search route', 5000);
  const input = await must(page.getByRole('searchbox', { name: 'Search query' }).or(page.getByRole('textbox', { name: 'Search query' })).first(), 'Search query');
  await input.fill(text);
  await sleep(500);
}
const rowTexts = async (page: Page) => (await results(page).getByRole('listitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());

test('fr_src_01_ac14_file_name_line_with_highlight', async ({ page }) => {
  await search(page, 'lipno');
  const row = await must(results(page).getByRole('listitem').filter({ hasText: 'Dům u vody' }), 'result "Dům u vody"');
  assert.equal(await results(page).getByRole('listitem').count(), 1, `one result: ${(await rowTexts(page)).join(' | ')}`);
  const line = await must(row.getByText('File name: Lipno víkend', { exact: true }), 'line "File name: Lipno víkend"');
  const marks = (await line.locator('mark').allInnerTexts()).map((t) => t.trim());
  assert.deepEqual(marks, ['Lipno'], '`Lipno` highlighted by offsets');
  const snippet = await must(row.getByText(/^Vzít s sebou deky\./), 'snippet: the start of the body');
  assert.equal(await snippet.locator('mark').count(), 0, 'no highlight in the snippet');
});

test('fr_src_01_ac14_title_match_shows_no_file_name_line', async ({ page }) => {
  await search(page, 'účet');
  const row = await must(results(page).getByRole('listitem').filter({ hasText: 'Účet chaty' }), 'result "Účet chaty"');
  assert.equal(await row.getByText(/^File name:/).count(), 0, 'a title match shows no file-name line');
  // Red guard: file names are searched in this route (AC-12, AC-14).
  await page.getByRole('searchbox', { name: 'Search query' }).or(page.getByRole('textbox', { name: 'Search query' })).first().fill('lipno');
  await sleep(500);
  assert.ok((await rowTexts(page)).some((t) => t.includes('File name: Lipno víkend')), `lipno shows the file-name line: ${(await rowTexts(page)).join(' | ')}`);
});

test('fr_src_01_ac15_rendered_order_follows_the_tiers', async ({ page }) => {
  await search(page, 'účet chaty');
  await must(results(page), 'Search results');
  const titles = await results(page).getByRole('listitem').evaluateAll((els) => els.map((e) => ((e.querySelector('.title') ?? e) as HTMLElement).innerText.split('\n')[0].replace(/^[^\p{L}]+/u, '').trim()));
  assert.equal(titles.length, 5, `five results: ${titles.join(' | ')}`);
  assert.deepEqual(titles.slice(0, 3), ['Účet chaty', 'Přesná fráze', 'Obě slova'], 'tier 1 (title, body), tier 2');
  assert.deepEqual(titles.slice(3).sort(), ['Druhé slovo', 'Jedno slovo'], 'tier 3');
});
