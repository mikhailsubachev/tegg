// Regression test for the owner's report on preview v0.117: on a type page, a Text property's `[[Test note]]` showed as
// raw text, not as a link chip. A cell shows its value out of edit mode, so each `[[…]]` inside a Text, Long text or
// `source` value is a link chip there, as in the panel (D-249, D-257; types.md FR-EDT-07 AC-18, FR-TYP-08 AC-14):
// the title as text, a click opens the note (D-140), an unresolved target has the broken style (D-142). FR-TYP-09.
// The core part is crates/tegg-core/tests/bug_v0117_fr_typ_09_links_in_text_cells.rs.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { mainName } from './helpers';
import { P, eventually, gotoTypePage, must, nonReadCalls, openTypes, swap, typeFile, typeTable, typesVault } from './types-helpers';

const S = 'Schůzky';

test('bug_v0117_fr_typ_09_links_inside_text_and_source_cells_are_chips', async ({ page }) => {
  const vault = typesVault((f) => {
    f[typeFile('schůzka')] = swap(f[typeFile('schůzka')], 'preview: [datum, účastníci]\n', 'preview: [datum, účastníci]\ncolumns: [místo, source]\n');
    const porada = Object.keys(f).find((k) => k.normalize('NFC') === P.porada.normalize('NFC'))!;
    f[porada] = swap(f[porada], 'místo:\n', 'místo: "u [[Jana Nováková]] doma"\nsource: "Viz [[Rozpočet 2027]] a [[Neexistuje]]"\n');
    // The owner's case: a Text value that is one whole link.
    const prazdna = Object.keys(f).find((k) => k.normalize('NFC') === P.prazdna.normalize('NFC'))!;
    f[prazdna] = f[prazdna].replace(/^---\n/, '---\nmísto: "[[Petr Dvořák]]"\n');
  });
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, S);
  const row = typeTable(page, S).getByRole('row').filter({ hasText: '2026-10-07 Porada' });
  const jana = await must(row.getByRole('link', { name: 'Jana Nováková', exact: true }), 'a link chip Jana Nováková in the Místo cell');
  await must(row.getByRole('link', { name: 'Rozpočet 2027', exact: true }), 'a link chip Rozpočet 2027 in the Source cell');
  const broken = await must(row.getByRole('link', { name: 'Neexistuje', exact: true }), 'a chip Neexistuje in the Source cell');
  assert.equal(await broken.getAttribute('data-link-kind'), 'unresolved', 'an unresolved target has the broken style (D-142)');
  const whole = typeTable(page, S).getByRole('row').filter({ hasText: 'Prázdná schůzka' });
  await must(whole.getByRole('link', { name: 'Petr Dvořák', exact: true }), 'a whole-value [[Petr Dvořák]] in Místo is a chip');
  assert.ok(!(await whole.innerText()).includes('[['), 'no raw [[…]] in the whole-value row');
  const text = (await row.innerText()).replace(/\s+/g, ' ');
  assert.ok(text.includes('u Jana Nováková doma'), `the text around the chip stays: ${text}`);
  assert.ok(text.includes('Viz Rozpočet 2027 a Neexistuje'), `the source text around the chips stays: ${text}`);
  assert.ok(!text.includes('[['), `no raw [[…]] in the row: ${text}`);
  await jana.click();
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Jana Nováková', 3000), 'Jana Nováková', 'the chip opens the note (D-140)');
  assert.deepEqual(await nonReadCalls(core), [], 'nothing written');
});
