// Preview v0.68 feedback, L5 (WebKit + fake core): no way to add objects from the tag page (D-762, supersedes D-697;
// docs/feedback/ms6-v068.md F5). docs/acceptance/tags.md FR-TAG-06 AC-12 (the L1 catalog part is
// app/test/v068_registry.ac.test.ts). Written from the AC only (D-61); every lookup goes through `must`/node:assert
// (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { paletteDialog, paletteOptions } from './helpers';
import { main, must, objectsTable, openTagPage, rowPaths, sleep, vaultWrites } from './tags-helpers';
import { flat } from './v068-helpers';

test('fr_tag_06_ac12_no_new_with_on_the_tag_page', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  const table = await must(objectsTable(page, 'Účty'), 'table "Objects with #Účty"');
  const named = main(page).getByRole('button', { name: /^New with #/ }).or(main(page).getByRole('link', { name: /^New with #/ }))
    .or(main(page).getByText(/^New with #/));
  assert.equal(await named.count(), 0, 'no "New with #Účty" button or link, in the header or the table');
  const rows = await table.evaluate((t) => ([...t.querySelectorAll('[role="row"], tr')] as HTMLElement[])
    .filter((r) => !r.querySelector('[role="columnheader"], th')).map((r) => (r.getAttribute('data-path') ?? r.querySelector('[data-path]')?.getAttribute('data-path'))?.normalize('NFC') ?? `(no path) ${(r.textContent ?? '').trim()}`));
  const paths = await rowPaths(page, 'Účty');
  assert.equal(paths.length, 6, 'the six objects of #účty');
  assert.deepEqual(rows, paths, 'no table row after the objects (every body row is an object row)');
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'Command palette');
  await page.getByRole('combobox', { name: 'Command query' }).fill('New with');
  await sleep(300);
  const opts = (await paletteOptions(page)).map(flat);
  assert.deepEqual(opts.filter((o) => /^New with tag/.test(o)), [], `no "New with tag…" on tag/účty: ${opts.join(' | ')}`);
  await page.keyboard.press('Escape');
  assert.deepEqual(await vaultWrites(core), [], 'nothing written');
});

test('fr_tag_06_ac12_unknown_tag_shows_only_the_text', async ({ page }) => {
  await openTagPage(page, 'neexistuje');
  await must(main(page).getByText('No objects have #neexistuje yet.', { exact: true }), 'D-720 text');
  const buttons = (await main(page).getByRole('button').allInnerTexts()).map(flat).filter((t) => /New with/.test(t));
  assert.deepEqual(buttons, [], 'no New with button on an unknown tag');
  assert.equal(await main(page).getByRole('button', { name: /^New with #/ }).count(), 0, 'no button named New with #neexistuje');
});
