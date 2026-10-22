// MS4 slice 4D-lite L5 (WebKit, fake core): tag autocomplete with colours and display names (docs/acceptance/tags.md
// FR-EDT-15 AC-5: `#úč` lists `#Účty` (blue, R79's display name), `#účty/archiv`, `#účty-2026` (neutral); AC-6: count-0
// tags are offered, choosing `#prázdný` saves it and the count becomes 1; `Create tag "…"` still writes no Tag file).
// Interface docs/contracts/ms4-tags.md §1.2 (`Core::tags` = `tag_rows` mapped), §3 (`index_tags`), §6.2 (`useTags`,
// `tagChipStyle`). Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { tagSuggestions } from './editor-helpers';
import { P, chipColours, editorBody, eventually, fileWhen, flat, must, openNote, runCommand, sleep, tagRowsText, vypln } from './tags-helpers';

async function typeInBody(page: Page, text: string) {
  const body = await must(editorBody(page), 'the editor');
  await body.click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}
const options = (page: Page) => tagSuggestions(page).getByRole('option');

test('fr_edt_15_ac5_suggestions_with_colours_and_display_names', async ({ page }) => {
  await openNote(page, vypln(7), 'Výplň 07');
  await typeInBody(page, ' #úč');
  await must(tagSuggestions(page), 'listbox "Tag suggestions"');
  const texts = (await options(page).allInnerTexts()).map((t) => flat(t));
  for (const want of ['#Účty', '#účty/archiv', '#účty-2026']) assert.ok(texts.some((t) => t.startsWith(want)), `${want} listed: ${texts.join(' | ')}`);
  assert.ok(!texts.some((t) => t.startsWith('#účty ') || t === '#účty'), 'the display name Účty, not the most frequent spelling (R79, D-657)');
  const ucty = options(page).filter({ hasText: /^#Účty/ }).first();
  const c = await chipColours(ucty.locator('[data-tag], mark, span').first().or(ucty), 'blue');
  assert.deepEqual([c.fg], [c.wantFg], '#Účty is blue (FR-TAG-05 AC-6)');
  const n = await chipColours(options(page).filter({ hasText: /^#účty-2026/ }).first(), null);
  assert.notEqual(n.fg, c.fg, '#účty-2026 is neutral');
});

test('fr_edt_15_ac6_count_zero_tags_are_offered', async ({ page }) => {
  const core = await openNote(page, vypln(8), 'Výplň 08');
  await typeInBody(page, ' #prá');
  await must(tagSuggestions(page), 'suggestions');
  const row = options(page).filter({ hasText: /^#prázdný/ }).first();
  await must(row, '#prázdný (count 0) is offered');
  const c = await chipColours(row, 'teal');
  assert.equal(c.fg, c.wantFg, 'teal');
  await row.click();
  const t = await fileWhen(core, vypln(8), (x) => !!x?.includes('#prázdný'), 3000);
  assert.ok(t?.includes('#prázdný'), 'saved #prázdný');
  await runCommand(page, 'Go to Tags');
  const rows = await eventually(() => tagRowsText(page), (r) => r.some((x) => x[0] === '#prázdný' && x[1] === '1'), 2500);
  assert.ok(rows.some((x) => x[0] === '#prázdný' && x[1] === '1'), 'the count becomes 1 within 2 s');
  await openNote(page, vypln(9), 'Výplň 09');
  await typeInBody(page, ' #nový-štítek');
  await must(tagSuggestions(page), 'suggestions');
  const create = options(page).filter({ hasText: /^Create tag/ });
  if (await create.count()) await create.first().click();
  await sleep(1300);
  assert.deepEqual((await core.writesTo()).filter((p) => p.startsWith('Tags/')), [], 'Create tag "…" still writes no Tag file (editor.md AC-4)');
  void P;
});
