// MS5 slice 5B, L5 (WebKit + fake core, capture page): the capture window's tag field, docs/acceptance/capture.md
// FR-CAP-01 AC-6 (R55 Tags: suggestions from the index tags, ⏎ / space / comma add a chip, a typed # isn't doubled,
// ⌫ removes the last chip, `Remove #<tag>`, no duplicate by case or NFC, NFD written NFC, no `Tags/` file).
// Interface docs/contracts/ms5-capture.md §2.2 (`capture_context.tags`), §4 (`TagField.tsx`). Written from the AC and
// the contract only (D-61). Every lookup goes through `must` (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { NOW, chips, click, creates, eventually, must, removeChip, sleep, startCapture, tagInput, tagsList, typeInCapture } from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const masked = (t: string) => t.replace(/^id: .*$/m, 'id: <ULID>');

test('fr_cap_01_ac6_the_tag_field', async ({ page }) => {
  const core = await startCapture(page);
  await typeInCapture(page, 'Výlet na Sněžku');
  const field = await must(tagInput(page), 'the tag field (combobox Add tag…)');
  await field.focus();
  await page.keyboard.insertText('nák');
  const list = await must(tagsList(page), 'listbox Tags');
  const options = (await list.getByRole('option').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  assert.equal(options[0], '#nákup', `#nákup first: ${options.join(', ')}`);
  await page.keyboard.press('Enter');
  assert.deepEqual(await chips(page), ['nákup'], '⏎ adds #nákup');
  await page.keyboard.insertText('výlet ');
  assert.deepEqual(await chips(page), ['nákup', 'výlet'], 'a space adds #výlet');
  await page.keyboard.insertText('#doma,');
  assert.deepEqual(await chips(page), ['nákup', 'výlet', 'doma'], 'a comma adds; the typed # is not doubled');
  await page.keyboard.press('Backspace');
  assert.deepEqual(await chips(page), ['nákup', 'výlet'], '⌫ in the empty field removes the last chip');
  await page.keyboard.insertText('Nákup');
  await page.keyboard.press('Enter');
  assert.deepEqual(await chips(page), ['nákup', 'výlet'], 'Nákup is not added again (case-insensitive)');
  await page.keyboard.insertText('výlet'.normalize('NFD'));
  await page.keyboard.press('Enter');
  assert.deepEqual(await chips(page), ['nákup', 'výlet'], 'an NFD duplicate is not added');
  await click(removeChip(page, 'nákup'), 'Remove #nákup');
  assert.deepEqual(await chips(page), ['výlet'], 'Remove #nákup removes that chip');
  await page.keyboard.insertText('nákup');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Meta+Enter');
  await sleep(300);
  const c = await creates(core);
  assert.equal(c.length, 1, 'one capture');
  assert.equal(masked(c[0].text), `---\nid: <ULID>\ntype: quick-note\ntitle: Výlet na Sněžku\ntags: [výlet, nákup]\nreview: unreviewed\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`, 'tags in chip order');
  assert.ok(!(await core.writesTo()).some((p) => p.startsWith('Tags/')), 'no Tags/ file (D-185)');
});

test('fr_cap_01_ac6_an_nfd_tag_is_written_nfc', async ({ page }) => {
  const core = await startCapture(page);
  await typeInCapture(page, 'Poznámka');
  await (await must(tagInput(page), 'tag field')).focus();
  await page.keyboard.insertText('výlet'.normalize('NFD'));
  await page.keyboard.press('Enter');
  assert.deepEqual(await chips(page), ['výlet'.normalize('NFC')], 'the chip is NFC');
  await page.keyboard.press('Meta+Enter');
  const c = await eventually(() => creates(core), (x) => x.length === 1, 1000);
  assert.ok(c[0]?.text.includes(`tags: [${'výlet'.normalize('NFC')}]`), 'written NFC');
  assert.ok(!c[0]?.text.includes('výlet'.normalize('NFD')), 'no NFD bytes');
});
