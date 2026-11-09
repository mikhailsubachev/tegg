// Preview v0.68 feedback, L5 (WebKit + fake core): the sidebar. docs/acceptance/app-shell.md FR-NAV-01 AC-14 (the top
// row: a filled `New object` button and the `Search` icon button, D-759), docs/acceptance/tags.md FR-TAG-07 AC-6 and
// R83 (one `Tags` entry with the tags icon and the number of tags, D-761) and FR-NAV-04 AC-8 (the sidebar order, D-759,
// D-761). docs/feedback/ms6-v068.md F3, F7, F8. Written from the ACs only (D-61); every lookup goes through
// `must`/node:assert, so a missing element fails an assertion (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { absent, box, mustBeDraft, mustBeOn, runCommand, sidebar, sleep, start } from './helpers';
import { pickNewObjectType } from './helpers'; // D-1431: New object opens the type picker first
import { axeContrast, tokenColour } from './read-helpers';
import { setPreviewMode } from '../ui/test/fake-core';
import { ui as tagsUi } from './tags-helpers';
import {
  allTagsHeading, click, eventually, must, newTagDialog, openAllTags, seen, startTags, tagHeading, tagNameBox, tagRowEl, tagsVault,
} from './tags-helpers';
import { description, flat, focusLabel, newObjectBtn, rectOf, searchBtn, tagsEntry, tooltip } from './v068-helpers';

const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
const ui = (theme: 'light' | 'dark') => ({ version: 1 as const, theme, sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' as const } });
async function caretInSearch(page: Page): Promise<boolean> {
  return eventually(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Search query'), (v) => v, 2000);
}

// ------------------------------------------------------------------------------------------------ app-shell FR-NAV-01 AC-14

for (const theme of ['light', 'dark'] as const) {
  test(`fr_nav_01_ac14_sidebar_top_row_new_object_and_search_${theme}`, async ({ page }) => {
    await start(page, { uiState: ui(theme) });
    const nb = await rectOf(newObjectBtn(page), 'sidebar button "New object" (D-759)');
    const sb = await rectOf(searchBtn(page), 'sidebar button "Search" (D-759)');
    const look = await searchBtn(page).first().evaluate((e) => {
      const s = getComputedStyle(e);
      return {
        text: ((e as HTMLElement).innerText ?? '').trim(), icon: e.querySelector('svg[data-icon]')?.getAttribute('data-icon') ?? null,
        borders: (['Top', 'Right', 'Bottom', 'Left'] as const).map((k) => `${(s as any)[`border${k}Width`]} ${(s as any)[`border${k}Style`]}`),
      };
    });
    assert.equal(look.text, '', 'Search is an icon-only button');
    assert.equal(look.icon, 'search', 'the search icon (data-icon="search")');
    assert.deepEqual(look.borders, ['1px solid', '1px solid', '1px solid', '1px solid'], 'Search has a 1 px border');
    assert.equal(await tooltip(searchBtn(page)), 'Search · ⇧⌘F', 'tooltip "Search · ⇧⌘F"');
    assert.ok(near(sb.width, 34) && near(sb.height, 34), `Search is 34 × 34 px (${sb.width} × ${sb.height})`);
    assert.ok(near(nb.height, 34), `New object is 34 px high, one line (${nb.height})`);
    assert.ok(near(nb.top, sb.top, 1) && sb.left >= nb.right - 0.5, `one row: New object, then Search to its right (${JSON.stringify({ nb, sb })})`);
    const nText = flat(await newObjectBtn(page).first().innerText());
    assert.ok(nText.includes('New object') && nText.includes('⌘N'), `New object shows its label and ⌘N: ${nText}`);
    const plus = await newObjectBtn(page).first().evaluate((e) => [...e.querySelectorAll('svg[data-icon]')].map((s) => s.getAttribute('data-icon') ?? ''));
    assert.ok(plus.some((i) => /plus|add/.test(i)) || nText.startsWith('+'), `the + icon: ${plus.join(', ')}`);
    assert.equal(await sidebar(page).getByText('Search or jump to…').count() + await page.getByRole('button', { name: 'Search or jump to…' }).count(), 0, 'no "Search or jump to…" element');
    const colours = await newObjectBtn(page).first().evaluate((e) => { const s = getComputedStyle(e); return { bg: s.backgroundColor, fg: s.color }; });
    assert.deepEqual(colours, { bg: await tokenColour(page, 'text'), fg: await tokenColour(page, 'bg') }, `${theme}: New object is filled with --text and written in --bg`);
    assert.deepEqual(await axeContrast(page), [], `${theme}: axe color-contrast passes`);
  });
}

test('fr_nav_01_ac14_new_object_and_search_by_click_and_enter_and_tab_order', async ({ page }) => {
  await start(page);
  await click(newObjectBtn(page), 'New object');
  await pickNewObjectType(page, 'a click on New object'); // D-1431: the type picker, ⏎ takes the default
  await mustBeDraft(page, 'a click on New object (AC-13)');
  await runCommand(page, 'Go to Inbox');
  await (await must(newObjectBtn(page), 'New object')).focus();
  await page.keyboard.press('Enter');
  await pickNewObjectType(page, '⏎ on New object'); // D-1431
  await mustBeDraft(page, '⏎ on New object (AC-13)');
  await runCommand(page, 'Go to Inbox');
  await click(searchBtn(page), 'Search');
  await mustBeOn(page, 'Search', 'a click on Search opens search', 3000);
  assert.ok(await caretInSearch(page), 'the caret is in Search query');
  await runCommand(page, 'Go to Inbox');
  await (await must(searchBtn(page), 'Search')).focus();
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Search', '⏎ on Search opens search', 3000);
  assert.ok(await caretInSearch(page), 'the caret is in Search query after ⏎');
  await runCommand(page, 'Go to Inbox');
  await (await must(newObjectBtn(page), 'New object')).focus();
  await page.keyboard.press('Tab');
  assert.equal(await focusLabel(page), 'Search', 'Tab: New object, then Search');
  await page.keyboard.press('Tab');
  assert.match(await focusLabel(page), /^Inbox\b/, 'then the entries (Inbox first)');
});

// ------------------------------------------------------------------------------------------------ tags.md FR-TAG-07 AC-6

const current = (page: Page) => tagsEntry(page).first().evaluate((e) => e.getAttribute('aria-current'));

test('fr_tag_07_ac6_one_tags_entry_with_icon_and_count', async ({ page }) => {
  // D-949: the All tags rows are opened with a single click, so the steps run under preview.mode = off.
  await startTags(page, { ...setPreviewMode('off', { uiState: tagsUi() }), route: 'inbox' });
  const entry = await must(tagsEntry(page), 'sidebar link "Tags" (R83, D-761)', 5000);
  assert.equal(await entry.locator('svg[data-icon="tags"]').count(), 1, 'the tags icon (data-icon="tags")');
  assert.equal(flat(await entry.innerText()).replace(/^Tags/, '').trim(), '10', 'the count 10 (R81 rows)');
  assert.equal(await description(tagsEntry(page)), '10 tags', 'description "10 tags"');
  assert.equal(await entry.getAttribute('data-command'), 'tags.go', 'data-command="tags.go"');
  const types = await rectOf(sidebar(page).getByRole('list', { name: 'Types', exact: true }), 'Types list');
  const tags = await rectOf(tagsEntry(page), 'Tags');
  // Slice PIN (pinned.md FR-NAV-04 AC-9, D-1375): the Pinned section moved above the Types section.
  const saved = await rectOf(sidebar(page).getByText('Saved queries', { exact: true }), 'Saved queries');
  assert.ok(tags.top >= types.bottom - 0.5 && tags.bottom <= saved.top + 0.5, 'between the Types list and Saved queries');
  assert.equal(await sidebar(page).getByRole('link', { name: /^#/ }).count(), 0, 'no #<tag> link in the sidebar');
  assert.equal(await sidebar(page).getByText(/All \d+ ›/).count(), 0, 'no "All 10 ›" text');
  assert.equal(await sidebar(page).getByRole('button', { name: /^Tags, all \d+$/ }).count(), 0, 'no D-700 section header');
  assert.notEqual(await current(page), 'page', 'not current on inbox');
  await entry.click();
  await must(allTagsHeading(page), 'a click opens tags', 3000);
  assert.equal(await current(page), 'page', 'current on tags');
  await click(tagRowEl(page, 'účty'), 'All tags row účty');
  await must(tagHeading(page, 'Účty'), 'tag/účty', 3000);
  assert.equal(await current(page), 'page', 'current on tag/účty');
  await runCommand(page, 'Go to Tags');
  await click(tagRowEl(page, 'a/b'), 'All tags row a/b');
  await must(tagHeading(page, 'a/b'), 'tag/a%2Fb', 3000);
  assert.equal(await current(page), 'page', 'current on tag/a%2Fb');
  await runCommand(page, 'Go to Inbox');
  await sleep(200);
  assert.notEqual(await current(page), 'page', 'not current on inbox again');
  await (await must(tagsEntry(page), 'Tags')).focus();
  await page.keyboard.press('Enter');
  await must(allTagsHeading(page), '⏎ opens tags', 3000);
  await runCommand(page, 'Go to Inbox');
  await runCommand(page, 'Go to Tags');
  await must(allTagsHeading(page), 'palette › Go to Tags still opens tags', 3000);
});

test('fr_tag_07_ac6_new_tag_updates_the_count', async ({ page }) => {
  await openAllTags(page);
  await must(tagsEntry(page), 'sidebar link "Tags"', 3000);
  await click(page.getByRole('main').getByRole('button', { name: 'New tag', exact: true }), 'New tag');
  await must(newTagDialog(page), 'dialog New tag');
  await tagNameBox(page).fill('Účetnictví');
  await click(newTagDialog(page).getByRole('button', { name: 'Create', exact: true }), 'Create');
  const n = await eventually(async () => flat(await tagsEntry(page).first().innerText()).replace(/^Tags/, '').trim(), (t) => t === '11', 2500);
  assert.equal(n, '11', 'the count reads 11 within 2 s');
  assert.equal(await description(tagsEntry(page)), '11 tags', 'description "11 tags"');
});

// ------------------------------------------------------------------------------------------------ tags.md FR-NAV-04 AC-8

test('fr_nav_04_ac8_sidebar_order_new_object_search_and_the_tags_entry', async ({ page }) => {
  await startTags(page, { route: 'inbox', vault: tagsVault() });
  const sb = sidebar(page);
  const parts: [string, ReturnType<typeof sb.getByRole>][] = [
    ['New object', newObjectBtn(page)],
    ['Search', searchBtn(page)],
    ['Inbox', sb.getByText('Inbox', { exact: true })],
    ['Today', sb.getByText('Today', { exact: true })],
    ['Tasks', sb.getByText('Tasks', { exact: true }).first()],
    // Slice PIN (pinned.md FR-NAV-04 AC-9, AP-1232 = D-1375): the Pinned section between Tasks and the Types section.
    ['Pinned', sb.getByRole('button', { name: 'Pinned', exact: true })],
    ['Types', sb.getByRole('list', { name: 'Types', exact: true })],
    ['Tags', tagsEntry(page)],
    ['Saved queries', sb.getByText('Saved queries', { exact: true })],
    ['Trash', sb.getByText('Trash', { exact: true })],
  ];
  const tops: number[] = [];
  for (const [name, loc] of parts) {
    const b = await box(loc);
    assert.ok(b, `sidebar: ${name} is not shown`);
    tops.push(b.y);
  }
  assert.ok(Math.abs(tops[0] - tops[1]) <= 1, 'New object and Search share the first row');
  for (let i = 2; i < tops.length; i++) assert.ok(tops[i] > tops[i - 1], `order: ${parts[i][0]} below ${parts[i - 1][0]}`);
  assert.equal(await sb.getByText('Search or jump to…').count(), 0, 'no "Search or jump to…" row');
  assert.equal(await sb.getByRole('link', { name: /^#/ }).count(), 0, 'no tag links');
  assert.equal(await sb.getByText('Tags', { exact: true }).count(), 1, 'one Tags entry, no separate bottom entry');
  const types = await sb.getByRole('list', { name: 'Types', exact: true }).innerText();
  assert.ok(!/\bTags\b/.test(types), 'the Tag type is not in the Types list (D-121)');
  assert.ok(!/Účty|Cizí štítek/.test(types), 'no Tag file in the Types list');
  assert.ok(await absent(page.getByRole('dialog'), 300), 'nothing opened');
  assert.ok(!(await seen(sb.getByRole('button', { name: /^Tags, all/ }), 200)), 'no Tags section header');
});
