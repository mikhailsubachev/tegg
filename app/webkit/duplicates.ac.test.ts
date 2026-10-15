// MS4 slice 4A, L5 (WebKit + fake core): duplicate titles. FR-LNK-14 AC-6 (details line in the switcher, `[[` and `@`
// suggestions and a relation picker without `to`, region en-US, zones Europe/Prague and America/Los_Angeles), AC-8 (the
// Duplicate titles page), AC-9 (`Merge…` disabled), AC-10 (one entry point: New object). docs/acceptance/backlinks.md
// (R16); interface docs/contracts/ms4-links.md §4 (`index_switcher` gains `duplicate`), §5.2, §5.4, §6. Written from
// the ACs and the contract only (D-61). Every lookup goes through `must`/node:assert (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { B, description, editorBody, eventually, fileText, flat, gotoNote, isDisabled, main, must, mustBeOn, openLinks, props, runCommand, seen, sleep, swap, writeCalls } from './links-helpers';

const DETAILS_PRAGUE: [RegExp, string][] = [
  [/^Senior Product Manager\b/, 'Page · Sep 1, 2026'],
  [/^Senior Product Manager\b/, 'Page · Oct 2, 2026 · Senior Product Manager (2)'],
  [/^Senior Product Manager\b/, 'Osoba · Oct 3, 2026 · Alfa s.r.o. · Nábor · SPM Alfa'],
  [/^SENIOR PRODUCT MANAGER\b/, 'Quick Note · SPM velkými'],
];

/** Option texts without a leading icon glyph. */
async function optionTexts(list: Locator): Promise<string[]> {
  return (await list.getByRole('option').allInnerTexts()).map((t) => flat(t).replace(/^[^\p{L}\p{N}]+/u, ''));
}
function checkDetails(opts: string[], details: string[], where: string) {
  const spm = opts.filter((o) => /^senior product manager/i.test(o));
  assert.equal(spm.length, 4, `${where}: the four objects titled Senior Product Manager (any case): ${opts.join(' | ')}`);
  for (const d of details) assert.equal(spm.filter((o) => o.includes(d)).length, 1, `${where}: one row with the details "${d}": ${spm.join(' | ')}`);
}
const prague = DETAILS_PRAGUE.map(([, d]) => d);

for (const tz of ['Europe/Prague', 'America/Los_Angeles'] as const) {
  test.describe(`details in ${tz}`, () => {
    test.use({ timezoneId: tz });
    test(`fr_lnk_14_ac6_switcher_details_line_${tz.replace(/\W/g, '_')}`, async ({ page }) => {
      const core = await openLinks(page, B.osamela, { region: 'en-US' });
      await page.keyboard.press('Meta+o');
      await page.getByRole('textbox', { name: 'Switcher query' }).or(page.getByRole('combobox', { name: 'Switcher query' })).first().fill('senior');
      await sleep(250);
      const list = await must(page.getByRole('dialog', { name: 'Quick switcher' }).getByRole('listbox'), 'switcher results');
      const want = tz === 'Europe/Prague' ? prague : prague.map((d) => d.replace('Oct 2, 2026', 'Oct 1, 2026'));
      checkDetails(await optionTexts(list), want, 'switcher');
      assert.equal((await core.calls()).filter((c) => c.cmd === 'note_read').length, 0, 'details come with the results (no note_read)');
      await page.getByRole('textbox', { name: 'Switcher query' }).or(page.getByRole('combobox', { name: 'Switcher query' })).first().fill('Odkaz na SPM');
      await sleep(250);
      const row = (await optionTexts(list)).find((o) => o.startsWith('Odkaz na SPM'));
      assert.ok(row && !row.includes(' · '), `a title nobody shares has no details line: ${row}`);
    });
  });
}

test.describe('details in the editor and the relation picker', () => {
  test.use({ timezoneId: 'Europe/Prague' });
  for (const trigger of ['[[', '@'] as const) {
    test(`fr_lnk_14_ac6_suggestions_details_line_${trigger === '[[' ? 'brackets' : 'at'}`, async ({ page }) => {
      await openLinks(page, B.osamela, { region: 'en-US' });
      await (await must(editorBody(page), 'Note body')).click();
      await page.keyboard.press('End');
      await page.keyboard.type(` ${trigger}senior`);
      const list = await must(page.getByRole('listbox', { name: 'Link suggestions', exact: true }), 'Link suggestions');
      checkDetails((await optionTexts(list)).filter((o) => !o.startsWith('Create')), prague, `${trigger} suggestions`);
    });
  }

  test('fr_lnk_14_ac6_relation_picker_without_to_details_line', async ({ page }) => {
    await openLinks(page, B.porada, { region: 'en-US' });
    await (await must(props(page).getByRole('button', { name: 'Add Téma', exact: true }), 'Add Téma')).click();
    const dlg = await must(page.getByRole('dialog', { name: 'Choose Téma' }), 'dialog Choose Téma');
    await dlg.getByRole('combobox', { name: 'Search' }).fill('senior');
    await sleep(250);
    checkDetails((await optionTexts(dlg.getByRole('listbox', { name: 'Results' }))).filter((o) => !o.startsWith('Create')), prague, 'relation picker');
  });
});

// ------------------------------------------------------------------------------------------------ AC-8, AC-9

async function gotoDuplicates(page: Page) {
  await runCommand(page, 'Go to Duplicate titles');
  await must(main(page).getByRole('heading', { name: 'Duplicate titles', exact: true }), 'heading Duplicate titles', 5000);
}
const group = (page: Page, name: RegExp) => main(page).getByRole('group', { name });

test.describe('Duplicate titles page', () => {
  test.use({ timezoneId: 'Europe/Prague' });
  test('fr_lnk_14_ac8_page_groups_rows_and_counts', async ({ page }) => {
    const core = await openLinks(page, B.osamela, { region: 'en-US' });
    await gotoDuplicates(page);
    assert.ok(await seen(main(page).getByText('2 titles shared by 6 objects', { exact: true }), 1000), 'summary');
    const names = (await main(page).getByRole('group').evaluateAll((gs) => gs.map((g) => {
      const ids = (g.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
      return (g.getAttribute('aria-label') ?? ids.map((i) => document.getElementById(i)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
    }))).map((n) => n.normalize('NFC'));
    assert.deepEqual(names, ['Senior Product Manager, 4', 'Čtení, 2'], 'size descending, then label');
    const spm = await must(group(page, /^Senior Product Manager, 4$/), 'group Senior Product Manager');
    const rows = (await spm.getByRole('link').allInnerTexts()).map(flat);
    assert.equal(rows.length, 4, `four rows: ${rows.join(' | ')}`);
    const want: [string, string, string][] = [
      ['Page · Sep 1, 2026', 'Pages', '1 backlink'],
      ['Page · Oct 2, 2026 · Senior Product Manager (2)', 'Pages', '1 backlink'],
      ['Osoba · Oct 3, 2026 · Alfa s.r.o. · Nábor · SPM Alfa', 'Osoby', '0 backlinks'],
      ['Quick Note · SPM velkými', 'Quick Notes', '0 backlinks'],
    ];
    want.forEach(([d, folder, bl], i) => {
      assert.ok(rows[i].includes(d) && rows[i].includes(folder) && rows[i].includes(bl), `row ${i + 1} (created ascending, missing last): ${rows[i]} should show ${d}, ${folder}, ${bl}`);
    });
    assert.equal(await spm.getByRole('link').first().locator('[data-icon]').count() > 0, true, 'type icon');
    const cteni = (await (await must(group(page, /^Čtení, 2$/), 'group Čtení')).getByRole('link').allInnerTexts()).map(flat);
    assert.ok(cteni[0]?.includes('Aug 1, 2026'), `Čtení (created) first: ${cteni.join(' | ')}`);
    await spm.getByRole('link').first().focus();
    await page.keyboard.press('Enter');
    await mustBeOn(page, 'Senior Product Manager', '⏎ opens the object', 5000);
    assert.deepEqual(await writeCalls(core), [], 'opening and browsing write nothing');
  });

  test('fr_lnk_14_ac8_external_title_change_updates_the_group', async ({ page }) => {
    const core = await openLinks(page, B.osamela, { region: 'en-US' });
    await gotoDuplicates(page);
    await must(group(page, /^Senior Product Manager, 4$/), 'group of 4');
    await core.setFile(B.spmVelkymi, swap(await fileText(core, B.spmVelkymi), 'title: SENIOR PRODUCT MANAGER', 'title: Velký nábor'));
    assert.ok(await eventually(() => seen(group(page, /^Senior Product Manager, 3$/), 100), (x) => x, 2000), 'the group shows 3 within 2 s');
  });

  test('fr_lnk_14_ac9_merge_is_disabled_until_4c', async ({ page }) => {
    const core = await openLinks(page, B.osamela, { region: 'en-US' });
    await gotoDuplicates(page);
    const g = await must(group(page, /^Senior Product Manager, 4$/), 'group');
    const merge = await must(g.getByRole('button', { name: 'Merge…', exact: true }), 'button Merge…');
    assert.equal(await isDisabled(merge), true, 'aria-disabled');
    assert.equal(await description(merge), 'Coming in MS4 (4C)');
    await merge.click({ force: true });
    await sleep(300);
    assert.ok(await seen(group(page, /^Senior Product Manager, 4$/), 500), 'nothing happens');
    assert.deepEqual(await writeCalls(core), [], 'nothing written');
  });
});

// ------------------------------------------------------------------------------------------------ AC-10

test('fr_lnk_14_ac10_new_object_never_takes_a_stem_in_use', async ({ page }) => {
  const core = await openLinks(page, B.osamela);
  await page.keyboard.press('Meta+n');
  const dlg = await must(page.getByRole('dialog', { name: 'New object' }), 'New object');
  await dlg.getByRole('textbox', { name: 'Title' }).fill('Jana Nováková');
  await page.keyboard.press('Enter');
  const w = await eventually(() => core.writesTo(), (x) => x.length > 0, 3000);
  assert.deepEqual(w, ['Quick Notes/Jana Nováková (2).md'], 'a stem used in Osoby/ is not taken (D-291)');
  assert.match((await fileText(core, 'Quick Notes/Jana Nováková (2).md')) ?? '', /^title: Jana Nováková$/m, 'title unchanged');
  await gotoNote(page, 'Cíl');
  const chip = editorBody(page).locator('[data-link-kind="note"]').filter({ hasText: 'Jana Nováková' });
  assert.ok(await seen(chip, 2000), "Cíl's [[Jana Nováková]] still resolves");
  await chip.first().click();
  await mustBeOn(page, 'Jana Nováková', 'the chip opens Jana Nováková', 5000);
  const opened = (await core.calls()).filter((c) => c.cmd === 'nav_opened').map((c) => (c.args as any)?.path);
  assert.equal(opened[opened.length - 1], 'Osoby/Jana Nováková.md', 'to Osoby/Jana Nováková.md, not the new Quick Note');
});
