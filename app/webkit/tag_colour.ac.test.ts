// MS4 slice 4D-lite L5 (WebKit, fake core): tag colours (docs/acceptance/tags.md R84 Colour, D-707…D-710):
// FR-TAG-05 AC-1 (the three ways to the popover; arrows and ⏎, a click; one write with the last-read version as base;
// the checked colour and Esc write nothing), AC-2 (None removes the key), AC-3 (a virtual tag gets its file), AC-4
// (unknown `magenta`: nothing checked, `Unknown colour "magenta"`, D-723), AC-5 (an external change wins), AC-6 (every
// surface shows the colour through `tagChipStyle`, light and dark), AC-7 (axe `color-contrast` with each colour).
// Interface docs/contracts/ms4-tags.md §2 (`setTagColor`, `tagFile`), §3 (`note_read` / `note_write` /
// `note_create_exact`), §6.2 (`tagChipStyle`, `useTags`). Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast } from './read-helpers';
import {
  NOW, P, callsOf, checkedSwatches, chip, chipColours, click, colourPopover, colourTile, description, eventually, fileWhen, main, must, openNote,
  openTagPage, original, runCommand, seen, sidebar, sleep, swap, swatch, tagAction, tagHeading, tagRowEl, vaultWrites,
} from './tags-helpers';

const LABELS = ['None', 'Gray', 'Blue', 'Green', 'Orange', 'Purple', 'Red', 'Teal', 'Yellow'];
const colourWrites = async (core: Awaited<ReturnType<typeof openTagPage>>) =>
  (await core.calls()).filter((c) => (c.cmd === 'note_write' || c.cmd === 'note_create_exact') && c.ok !== false);

test('fr_tag_05_ac1_choose_a_colour_three_ways', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  await click(colourTile(page), 'the Tag colour tile');
  await must(colourPopover(page), 'dialog "Tag colour" (R84)');
  const labels = await page.getByRole('radiogroup', { name: 'Tag colour', exact: true }).getByRole('radio').evaluateAll((rs) => rs.map((r) => r.getAttribute('aria-label') ?? r.textContent?.trim() ?? ''));
  assert.deepEqual(labels, LABELS, 'None and the eight R14 labels');
  assert.deepEqual(await checkedSwatches(page), ['Blue'], 'Blue checked');
  await page.keyboard.press('Escape');
  assert.equal(await colourPopover(page).count(), 0, 'Esc closes');
  await tagAction(page, 'Colour…');
  await must(colourPopover(page), 'Tag actions › Colour… opens it');
  await page.keyboard.press('Escape');
  await runCommand(page, 'Change tag colour…');
  await must(colourPopover(page), 'the palette opens it');
  await click(swatch(page, 'Blue'), 'the checked colour');
  await sleep(300);
  assert.deepEqual(await colourWrites(core), [], 'the checked colour again and Esc write nothing');
  await runCommand(page, 'Change tag colour…');
  await must(colourPopover(page), 'again');
  await swatch(page, 'Blue').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const t = await fileWhen(core, P.fUcty, (x) => !!x?.includes('color: green'));
  assert.equal(t, swap(swap(original(P.fUcty), 'color: blue', 'color: green'), 'modified: 2026-09-01T09:00:00+02:00', `modified: ${NOW}`), 'only color: and modified: change');
  const w = await colourWrites(core);
  assert.equal(w.length, 1, 'one write');
  const read = (await callsOf(core, 'note_read')).filter((c) => (c.args as any)?.path === P.fUcty);
  assert.ok(read.length >= 1 && (w[0].args as any)?.base, 'the file\'s last-read version as base');
  assert.equal(await eventually(() => colourTile(page).getAttribute('data-color'), (c) => c === 'green', 1000), 'green', 'the tile shows green within 1 s');
  const side = await chipColours(sidebar(page).getByRole('link', { name: /^#Účty/ }), 'green');
  assert.equal(side.fg, side.wantFg, 'the sidebar # shows green');
});

test('fr_tag_05_ac2_none_removes_the_key', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  await click(colourTile(page), 'tile');
  await click(swatch(page, 'None'), 'None');
  const t = await fileWhen(core, P.fUcty, (x) => !!x && !x.includes('color:'));
  assert.equal(t, swap(original(P.fUcty).replace('color: blue\n', ''), 'modified: 2026-09-01T09:00:00+02:00', `modified: ${NOW}`), 'the color: line goes, the file stays');
  assert.equal(await eventually(() => colourTile(page).getAttribute('data-color'), (c) => c === 'none', 1000), 'none', 'neutral');
  const p2 = await page.context().newPage();
  const c2 = await openTagPage(p2, 'a/b');
  await click(colourTile(p2), 'a/b tile');
  assert.deepEqual(await checkedSwatches(p2), ['None'], 'F-ab: None checked');
  await click(swatch(p2, 'None'), 'None');
  await sleep(300);
  assert.deepEqual(await vaultWrites(c2), [], 'choosing it writes nothing');
  await p2.close();
});

test('fr_tag_05_ac3_a_colour_for_a_virtual_tag_creates_its_file', async ({ page }) => {
  const core = await openTagPage(page, 'finance');
  await click(colourTile(page), 'tile');
  await click(swatch(page, 'Orange'), 'Orange');
  const t = await fileWhen(core, 'Tags/finance.md', (x) => !!x);
  assert.match(t ?? '', /^---\nid: [0-9A-HJKMNP-TV-Z]{26}\ntype: tag\ntitle: finance\ncolor: orange\ncreated: 2026-10-22T10:00:00\+02:00\nmodified: 2026-10-22T10:00:00\+02:00\n---\n$/, 'R86 with color: orange');
  assert.deepEqual((await core.writesTo()), ['Tags/finance.md'], 'exactly one file, no object file');
  await must(main(page).getByText('2 objects of 2 types', { exact: true }), 'the tag keeps count 2');
});

test('fr_tag_05_ac4_unknown_colour_shows_neutral', async ({ page }) => {
  const core = await openTagPage(page, 'neznámá');
  assert.equal(await (await must(colourTile(page), 'tile')).getAttribute('data-color'), 'none', 'neutral everywhere');
  await colourTile(page).click();
  await must(colourPopover(page), 'popover');
  assert.deepEqual(await checkedSwatches(page), [], 'no radio checked (AP-662)');
  assert.ok((await description(colourPopover(page))).includes('Unknown colour "magenta"') || (await seen(colourPopover(page).getByText('Unknown colour "magenta"'), 300)), 'Unknown colour "magenta" (D-723)');
  await page.keyboard.press('Escape');
  assert.deepEqual(await vaultWrites(core), [], 'opening and closing writes nothing');
  await click(colourTile(page), 'tile');
  await click(swatch(page, 'Purple'), 'Purple');
  const t = await fileWhen(core, P.fNeznama, (x) => !!x?.includes('purple'));
  assert.ok(t?.includes('color: purple\ndescription: Stará poznámka.\nx-extra: 1\n'), 'purple replaces magenta (one write), the rest kept');
});

test('fr_tag_05_ac5_an_external_change_wins', async ({ page }) => {
  const core = await openTagPage(page, 'účty');
  await must(colourTile(page), 'tile');
  await core.setFile(P.fUcty, swap(original(P.fUcty), 'color: blue', 'color: red'), { silent: true });
  await click(colourTile(page), 'tile');
  await click(swatch(page, 'Green'), 'Green');
  await must(page.getByText('"Účty" changed outside Tegg. The colour wasn\'t changed.', { exact: true }), 'tag.changedOutside');
  assert.equal((await core.files())[P.fUcty], swap(original(P.fUcty), 'color: blue', 'color: red'), 'nothing written');
  assert.deepEqual(await eventually(() => checkedSwatches(page), (c) => c[0] === 'Red', 1500), ['Red'], 'the popover shows the disk state and stays open (AP-662)');
});

const SURFACES = async (page: Page, colour: string, name: string): Promise<string[]> => {
  const bad: string[] = [];
  const check = async (what: string, loc: ReturnType<Page['locator']>) => {
    if (!(await seen(loc, 1500))) { bad.push(`${what}: not shown`); return; }
    const c = await chipColours(loc, colour);
    if (c.bg !== c.wantBg || c.fg !== c.wantFg) bad.push(`${what}: ${c.fg} on ${c.bg}, want ${c.wantFg} on ${c.wantBg}`);
  };
  await check('the sidebar link', sidebar(page).getByRole('link', { name: new RegExp(`^#${name}`) }).first());
  return bad;
};

for (const theme of ['light', 'dark'] as const) {
  test(`fr_tag_05_ac6_every_surface_shows_the_colour (${theme})`, async ({ page }) => {
    await openNote(page, P.rozpocet, 'Rozpočet', { theme });
    const bad: string[] = [];
    const want = async (what: string, loc: ReturnType<Page['locator']>, colour: string | null) => {
      if (!(await seen(loc, 1500))) { bad.push(`${what}: not shown`); return; }
      const c = await chipColours(loc, colour);
      if (c.bg !== c.wantBg || c.fg !== c.wantFg) bad.push(`${what}: ${c.fg} on ${c.bg}, want ${c.wantFg} on ${c.wantBg}`);
    };
    const panel = page.getByRole('region', { name: 'Properties', exact: true });
    await want('attribute panel #Účty', chip(panel, 'Účty').first(), 'blue');
    await want('attribute panel #finance (virtual, neutral)', chip(panel, 'finance').first(), null);
    bad.push(...(await SURFACES(page, 'blue', 'Účty')));
    await runCommand(page, 'Go to Tags');
    await want('All tags chip #Účty', chip(tagRowEl(page, 'účty'), 'Účty').first(), 'blue');
    await want('All tags chip #dvojí', chip(tagRowEl(page, 'dvojí'), 'dvojí').first(), 'red');
    await want('All tags chip #a/b', chip(tagRowEl(page, 'a/b'), 'a/b').first(), null);
    assert.equal(await tagRowEl(page, 'účty').getByRole('button', { name: /colour/i }).count(), 0, 'no colour control on All tags');
    await click(tagRowEl(page, 'finance'), 'finance');
    await must(tagHeading(page, 'finance'), 'tag/finance');
    await want('tag page Other tags #Účty', chip(main(page).getByRole('table'), 'Účty').first(), 'blue');
    await want('tag page Other tags #dvojí', chip(main(page).getByRole('table'), 'dvojí').first(), 'red');
    await runCommand(page, 'Go to Inbox');
    await want('Inbox card of Faktura #účty', chip(main(page).getByRole('article').filter({ hasText: 'Faktura' }), 'Účty').or(chip(main(page).getByRole('article').filter({ hasText: 'Faktura' }), 'účty')).first(), 'blue');
    await runCommand(page, 'Go to Tasks');
    await want('task card #Účty (Zavolat bance)', chip(main(page).getByRole('article', { name: 'Task: Zavolat bance', exact: true }), 'Účty').or(chip(main(page).getByRole('article', { name: 'Task: Zavolat bance', exact: true }), 'účty')).first(), 'blue');
    assert.deepEqual(bad, [], 'every surface: blue-bg / blue for účty, red for dvojí, the neutral chip for a/b and virtual tags (D-709)');
  });
}

test('fr_tag_05_ac6_inline_tag_in_the_read_view_and_the_editor', async ({ page }) => {
  await openNote(page, P.faktura, 'Faktura', { readView: true });
  const inline = main(page).getByRole('link', { name: /^#účty$/i }).first();
  const c = await chipColours(inline, 'blue');
  assert.deepEqual([c.fg, c.bg], [c.wantFg, c.wantBg], 'the read view\'s inline #účty is blue');
  const p2 = await page.context().newPage();
  await openNote(p2, P.faktura, 'Faktura');
  const mark = p2.locator('[data-tag-key="účty"]').first();
  const e = await chipColours(mark, 'blue');
  assert.deepEqual([e.fg, e.bg], [e.wantFg, e.wantBg], 'the editor\'s inline tag mark (data-tag-key, a CSS custom property) is blue');
  await p2.close();
});

for (const colour of ['gray', 'blue', 'green', 'orange', 'purple', 'red', 'teal', 'yellow']) {
  test(`fr_tag_05_ac7_axe_contrast_on_the_tag_page_with_${colour}`, async ({ page }) => {
    await openTagPage(page, 'účty', {
      vault: (await import('./tags-helpers')).tagsVault((f) => { f[P.fUcty] = f[P.fUcty].replace('color: blue', `color: ${colour}`); }),
    });
    await must(colourTile(page), 'tile');
    assert.equal(await colourTile(page).getAttribute('data-color'), colour, `the tile is ${colour}`);
    assert.deepEqual(await axeContrast(page), [], `axe color-contrast with ${colour}`);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`fr_tag_05_ac7_axe_contrast_on_all_tags_and_a_note (${theme})`, async ({ page }) => {
    await openNote(page, P.rozpocet, 'Rozpočet', { theme });
    await must(chip(page.getByRole('region', { name: 'Properties', exact: true }), 'Účty'), 'coloured chips on the note');
    assert.deepEqual(await axeContrast(page), [], 'a note with coloured chips');
    await runCommand(page, 'Go to Tags');
    await must(tagRowEl(page, 'účty'), 'All tags');
    assert.deepEqual(await axeContrast(page), [], 'tags');
  });
}
