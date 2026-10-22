// MS4 slice 4A, L5 (WebKit + fake core): broken links. FR-LNK-04 AC-4 (the Create offer), AC-5 (Create), AC-6 (two
// title cases), AC-7 (rewrite, read view), AC-8 (folder targets), AC-10 (Broken links page), AC-11 (UI part), AC-12
// (the offer writes nothing); FR-SYN-06 AC-9 (L5 part: 0 write commands, then 1). docs/acceptance/backlinks.md (R16);
// interface docs/contracts/ms4-links.md §4, §5.2, §5.3, §6. Written from the ACs and the contract only (D-61). Every
// lookup goes through `must`/node:assert, so a missing offer fails an assertion (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  B, SUBPATH_CHIP, chipNames, chips, createOffer, description, editorBody, eventually, fileText, flat, focus, gotoNote, isDisabled, linksVault, main, must,
  mustBeOn, mustPanel, nfc, openLinks, props, runCommand, seen, sleep, swap, writeCalls, type FakeCoreHandle,
} from './links-helpers';
import { absent } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });

const saved = (page: Page) => page.getByRole('status', { name: 'Save state' }).filter({ hasText: 'Saved' });

async function chip(scope: Locator, text: string | RegExp, kind = 'unresolved'): Promise<Locator> {
  return must(chips(scope, text).and(scope.page().locator(`[data-link-kind="${kind}"]`)), `${kind} chip "${text}"`, 5000);
}
async function offerFor(page: Page, scope: Locator, text: string | RegExp): Promise<Locator> {
  await (await chip(scope, text)).click();
  return must(createOffer(page), `dialog "Create note" for ${text}`);
}
async function createButton(offer: Locator, label: string): Promise<Locator> {
  return must(offer.getByRole('button', { name: `Create "${label}"`, exact: true }), `button Create "${label}"`);
}
async function filesNow(core: FakeCoreHandle) {
  return JSON.stringify(await core.files());
}

// ------------------------------------------------------------------------------------------------ AC-4

test('fr_lnk_04_ac4_the_offer_from_an_editor_chip', async ({ page }) => {
  const core = await openLinks(page, B.rozbite);
  const offer = await offerFor(page, editorBody(page), 'Neexistuje');
  assert.notEqual(await offer.getAttribute('aria-modal'), 'true', 'non-modal');
  assert.ok(await seen(offer.getByText('No note named "Neexistuje"', { exact: true }), 1000), 'No note named "Neexistuje"');
  assert.ok(await seen(offer.getByText('Type: Quick Note', { exact: true }), 1000), 'Type: Quick Note');
  // 5B (FR-VLT-05 AC-3, D-550): the type picker is enabled, a `combobox` `Type` (no longer `Coming in MS5`).
  const picker = await must(offer.getByRole('combobox', { name: 'Type', exact: true }), 'combobox "Type"');
  assert.equal(await isDisabled(picker), false, 'the type picker is enabled');
  assert.notEqual(await description(picker), 'Coming in MS5', 'no Coming in MS5');
  const create = await createButton(offer, 'Neexistuje');
  assert.equal((await focus(page)).name, flat(await create.innerText()), 'Create is focused');
  await must(offer.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel');
  await page.keyboard.press('Escape');
  assert.ok(await absent(createOffer(page), 1000), 'Esc closes');
  assert.equal(flat((await focus(page)).name), 'Neexistuje', 'focus back on the chip');
  // Cancel and a click outside close it too.
  await offerFor(page, editorBody(page), 'Neexistuje');
  await createOffer(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.ok(await absent(createOffer(page), 1000), 'Cancel closes');
  await offerFor(page, editorBody(page), 'Neexistuje');
  await page.mouse.click(5, 450);
  assert.ok(await absent(createOffer(page), 1000), 'a click outside closes');
  assert.deepEqual(await writeCalls(core), [], 'opening and closing send no write command');
});

test('fr_lnk_04_ac4_cmd_enter_at_the_link_and_enter_on_a_read_view_chip', async ({ page }) => {
  await openLinks(page, B.rozbite);
  await (await chip(editorBody(page), 'Neexistuje')).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Enter');
  await must(createOffer(page), '⌘↩ with the caret at the link opens the offer');
  await page.keyboard.press('Escape');
  const p2 = await page.context().newPage();
  await openLinks(p2, B.rozbite, { readView: true });
  const c = await chip(main(p2), 'Neexistuje');
  await c.focus();
  await p2.keyboard.press('Enter');
  await must(createOffer(p2), '⏎ on a focused chip in the read view');
});

test('fr_lnk_04_ac4_relation_chip_offers_the_first_allowed_type', async ({ page }) => {
  await openLinks(page, B.sChybou);
  const offer = await offerFor(page, props(page), 'Chybějící osoba');
  assert.ok(await seen(offer.getByText('Type: Osoba', { exact: true }), 1000), 'Type: Osoba (D-243)');
  assert.ok(await seen(offer.getByText('No note named "Chybějící osoba"', { exact: true }), 1000));
});

test('fr_lnk_04_ac4_text_value_chip_opens_the_same_offer', async ({ page }) => {
  const v = linksVault((f) => { f[B.sChybou] = swap(f[B.sChybou], 'title: Porada s chybou\n', 'title: Porada s chybou\npoznámka: "Viz [[Neexistuje]]"\n'); });
  await openLinks(page, B.sChybou, { vault: v });
  const offer = await offerFor(page, props(page), 'Neexistuje');
  assert.ok(await seen(offer.getByText('Type: Quick Note', { exact: true }), 1000), 'a text value is not a relation: default type');
});

// ------------------------------------------------------------------------------------------------ AC-5, AC-6

test('fr_lnk_04_ac5_create_writes_one_file_and_links_resolve', async ({ page }) => {
  const core = await openLinks(page, B.rozbite);
  const before = await core.files();
  const offer = await offerFor(page, editorBody(page), 'Neexistuje');
  await (await createButton(offer, 'Neexistuje')).click();
  await mustBeOn(page, 'Neexistuje', 'the route becomes the new note', 5000);
  assert.deepEqual(await core.writesTo(), ['Quick Notes/Neexistuje.md'], 'exactly one file written');
  assert.equal((await writeCalls(core)).length, 1, 'one write command');
  const after = await core.files();
  for (const p of [B.rozbite, B.dalsi]) assert.equal(after[nfc(p)], before[nfc(p)], `${p} keeps its bytes`);
  const t = await fileText(core, 'Quick Notes/Neexistuje.md');
  assert.match(t ?? '', /^type: quick-note$/m);
  assert.match(t ?? '', /^title: Neexistuje$/m);
  // D-367 changed AP-214: the caret is at the end of the title (editor.md FR-EDT-01 AC-13).
  assert.equal(await page.evaluate(() => document.querySelector('[data-focus-target]')?.getAttribute('data-focus-target')), 'title', 'caret at the end of the title (D-367)');
  await mustPanel(page);
  // D-368: the panel's entries are chips.
  assert.deepEqual([...(await eventually(() => chipNames(page), (x) => x.length === 2, 2000))].sort(), ['Další rozbitý', 'Rozbité odkazy'], "the new note's panel");
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Rozbité odkazy', 'Back', 5000);
  const kinds = await eventually(
    () => editorBody(page).locator('[data-link-kind]').evaluateAll((cs) => cs.filter((c) => /neexistuje|jiný popis/i.test(c.textContent ?? '')).map((c) => c.getAttribute('data-link-kind'))),
    (k) => k.length === 4 && k.every((x) => x === 'note'), 2000);
  assert.deepEqual(kinds, ['note', 'note', 'note', 'note'], 'every link to neexistuje resolves within 2 s');
  await (await must(editorBody(page), 'Note body')).click();
  await page.keyboard.press('Meta+z');
  await sleep(300);
  assert.ok((await core.files())['Quick Notes/Neexistuje.md'] !== undefined, '⌘Z does not delete the new file (D-178)');
});

test('fr_lnk_04_ac5_create_the_osoba_of_a_relation', async ({ page }) => {
  const core = await openLinks(page, B.sChybou);
  const offer = await offerFor(page, props(page), 'Chybějící osoba');
  await (await createButton(offer, 'Chybějící osoba')).click();
  assert.deepEqual(await eventually(() => core.writesTo(), (w) => w.length > 0), ['Osoby/Chybějící osoba.md']);
  assert.match((await fileText(core, 'Osoby/Chybějící osoba.md')) ?? '', /^type: osoba$/m);
});

for (const [n, text, file, title] of [[1, 'Kapitola', 'Quick Notes/Neexistuje.md', 'Neexistuje'], [2, 'neexistuje', 'Quick Notes/neexistuje.md', 'neexistuje']] as const) {
  test(`fr_lnk_04_ac6_title_from_the_clicked_link_${n}`, async ({ page }) => {
    const core = await openLinks(page, B.rozbite);
    // [[Neexistuje#Kapitola]] shows as `Neexistuje › Kapitola` (D-156) or as written; [[neexistuje]] as written.
    const label = text === 'Kapitola' ? SUBPATH_CHIP : 'neexistuje';
    const offer = await offerFor(page, editorBody(page), label);
    await (await createButton(offer, title)).click();
    assert.deepEqual(await eventually(() => core.writesTo(), (w) => w.length > 0), [file]);
    assert.match((await fileText(core, file)) ?? '', new RegExp(`^title: ${title}$`, 'm'), 'title from the target, without subpath');
    assert.ok(!((await fileText(core, file)) ?? '').includes('Kapitola'), 'no heading created');
  });
}

// ------------------------------------------------------------------------------------------------ AC-7

test('fr_lnk_04_ac7_a_target_that_is_not_a_file_name_rewrites_that_one_link', async ({ page }) => {
  const core = await openLinks(page, B.rozbite);
  const offer = await offerFor(page, editorBody(page), 'Q3: plán?');
  assert.ok(await seen(offer.getByText('The file will be named "Q3 plán" and this link changed to point to it.', { exact: true }), 1000), 'the offer says so beforehand');
  await (await createButton(offer, 'Q3: plán?')).click();
  assert.ok((await eventually(() => core.writesTo(), (w) => w.includes('Quick Notes/Q3 plán.md'))).includes('Quick Notes/Q3 plán.md'), 'Quick Notes/Q3 plán.md');
  assert.match((await fileText(core, 'Quick Notes/Q3 plán.md')) ?? '', /^title: "Q3: plán\?"$/m);
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Rozbité odkazy', 'Back to the source', 5000);
  const t = await eventually(() => fileText(core, B.rozbite), (x) => (x ?? '').includes('[[Q3 plán|Q3: plán?]]'), 4000);
  const want = swap(linksVault().files[B.rozbite], '[[Q3: plán?]]', '[[Q3 plán|Q3: plán?]]');
  assert.equal((t ?? '').replace(/^modified: .*$/m, ''), want.replace(/^modified: .*$/m, ''), 'only that line and modified change');
});

test('fr_lnk_04_ac7_read_view_disables_create_for_a_rewrite', async ({ page }) => {
  const core = await openLinks(page, B.rozbite, { readView: true });
  const offer = await offerFor(page, main(page), 'Q3: plán?');
  const create = await createButton(offer, 'Q3: plán?');
  assert.equal(await isDisabled(create), true, 'Create aria-disabled');
  assert.ok(await seen(offer.getByText("This link can't point to a file name. Edit the link first.", { exact: true }), 1000));
  await create.click({ force: true });
  await sleep(300);
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ AC-8

test('fr_lnk_04_ac8_folder_targets', async ({ page }) => {
  const core = await openLinks(page, B.rozbite);
  let offer = await offerFor(page, editorBody(page), 'Projekty/Alfa');
  await (await createButton(offer, 'Projekty/Alfa')).click();
  assert.deepEqual(await eventually(() => core.writesTo(), (w) => w.length > 0), ['Projekty/Alfa.md'], 'exact path, folder created');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Rozbité odkazy', 'Back', 5000);
  offer = await offerFor(page, editorBody(page), 'Osoby/Eva Malá');
  assert.ok(await seen(offer.getByText('Type: Osoba', { exact: true }), 1000), "Osoby is Osoba's folder");
  await (await createButton(offer, 'Osoby/Eva Malá')).click();
  assert.ok((await eventually(() => core.writesTo(), (w) => w.length === 2)).includes('Osoby/Eva Malá.md'));
  assert.match((await fileText(core, 'Osoby/Eva Malá.md')) ?? '', /^type: osoba$/m);
});

test('fr_lnk_04_ac8_forbidden_folders_disable_create', async ({ page }) => {
  const v = linksVault((f) => { f[B.rozbite] = `${f[B.rozbite]}\n[[.trash/X]] a [[_templates/X]] a [[../X]]\n`; });
  const core = await openLinks(page, B.rozbite, { vault: v });
  for (const t of ['.trash/X', '_templates/X', '../X']) {
    const offer = await offerFor(page, editorBody(page), t);
    const create = await createButton(offer, t);
    assert.equal(await isDisabled(create), true, `${t}: Create aria-disabled`);
    assert.ok(await seen(offer.getByText("Notes can't be created in this folder.", { exact: true }), 1000), `${t}: reason`);
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ AC-10

/** Broken-links groups as `[label, count]`, from each group's accessible name (`<label>, <n>` or `<label> <n>`). */
async function brokenGroups(page: Page): Promise<[string, number][]> {
  const names = await main(page).getByRole('group').evaluateAll((gs) => gs.map((g) => {
    const ids = (g.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
    return (g.getAttribute('aria-label') ?? ids.map((i) => document.getElementById(i)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
  }));
  return names.map((n) => /^(.*?),? (\d+)$/.exec(n.normalize('NFC'))).filter(Boolean).map((m) => [m![1], Number(m![2])] as [string, number]);
}

// D-628 (6A, D-615): `[[Smazaná]]` resolves to the trash, so it is no longer a broken-links group (11 links).
for (const [region, order] of [
  ['cs', ['Neexistuje', 'Chybějící osoba', 'Chybí', 'Osoby/Eva Malá', 'Projekty/Alfa', 'Q3: plán?', 'Šablona']],
  ['en', ['Neexistuje', 'Chybějící osoba', 'Chybí', 'Osoby/Eva Malá', 'Projekty/Alfa', 'Q3: plán?', 'Šablona']],
] as const) {
  test(`fr_lnk_04_ac10_broken_links_page_${region}`, async ({ page }) => {
    const core = await openLinks(page, B.osamela, { region });
    await runCommand(page, 'Go to Broken links');
    await must(main(page).getByRole('heading', { name: 'Broken links', exact: true }), 'heading Broken links', 5000);
    assert.ok(await seen(main(page).getByText('11 broken links in 3 objects', { exact: true }), 1000), 'summary');
    const g = await brokenGroups(page);
    assert.deepEqual(g.map((x) => x[0]), [...order], `${region} order`);
    assert.equal(g[0][1], 5, 'Neexistuje 5');
    assert.ok(g.slice(1).every((x) => x[1] === 1), 'six groups of 1');
    assert.deepEqual(await writeCalls(core), [], 'opening and browsing write nothing');
  });
}

test('fr_lnk_04_ac10_group_sources_create_button_and_live_update', async ({ page }) => {
  const core = await openLinks(page, B.osamela);
  await runCommand(page, 'Go to Broken links');
  const group = await must(main(page).getByRole('group', { name: /^Neexistuje,? 5$/ }), 'group Neexistuje', 5000);
  assert.deepEqual([...(await group.getByRole('article').evaluateAll((as) => as.map((a) => a.getAttribute('aria-label') ?? '')))].sort(), ['Další rozbitý', 'Rozbité odkazy'], 'sources with excerpts');
  assert.ok((await group.locator('[data-occurrence]').count()) >= 2, 'backlinks-style excerpts');
  const chybejici = await must(main(page).getByRole('group', { name: /^Chybějící osoba,? 1$/ }), 'group Chybějící osoba');
  await (await must(chybejici.getByRole('button', { name: 'Create "Chybějící osoba"', exact: true }), 'Create "Chybějící osoba"')).click();
  const offer = await must(createOffer(page), 'the AC-4 offer');
  assert.ok(await seen(offer.getByText('Type: Osoba', { exact: true }), 1000), 'every occurrence a relation value with to: the first allowed type');
  await page.keyboard.press('Escape');
  await core.setFile(B.dalsi, swap(linksVault().files[B.dalsi], '[[Neexistuje]]', 'Bez odkazu.'));
  assert.ok((await eventually(() => brokenGroups(page), (x) => x.some(([l, n]) => l === 'Neexistuje' && n === 4), 2000)).some(([l, n]) => l === 'Neexistuje' && n === 4), 'an external edit updates the page within 2 s');
  const now = await must(main(page).getByRole('group', { name: /^Neexistuje,? 4$/ }), 'group Neexistuje after the edit');
  await (await must(now.locator('[data-occurrence]'), 'an excerpt of the group')).click();
  await mustBeOn(page, 'Rozbité odkazy', 'activating an excerpt opens the source at the link', 5000);
});

// ------------------------------------------------------------------------------------------------ AC-11, AC-12

test('fr_lnk_04_ac11_a_file_created_meanwhile_opens_with_a_message', async ({ page }) => {
  const core = await openLinks(page, B.rozbite);
  const offer = await offerFor(page, editorBody(page), 'Neexistuje');
  const theirs = '---\ntitle: Neexistuje\n---\nNapsal jiný program.\n';
  await core.setFile('Quick Notes/Neexistuje.md', theirs, { silent: true }); // the race: the UI hasn't heard of it yet
  await (await createButton(offer, 'Neexistuje')).click();
  assert.ok(await seen(page.getByText('"Neexistuje" exists now.', { exact: true }), 2000), 'non-modal message');
  await mustBeOn(page, 'Neexistuje', 'the existing note opens', 5000);
  assert.equal(await fileText(core, 'Quick Notes/Neexistuje.md'), theirs, "the other program's bytes are kept");
  assert.deepEqual(await core.writesTo(), [], 'nothing written');
});

test('fr_lnk_04_ac11_an_io_failure_keeps_the_offer_open', async ({ page }) => {
  const core = await openLinks(page, B.rozbite);
  await core.writeControl({ fail: 'Io' });
  const offer = await offerFor(page, editorBody(page), 'Neexistuje');
  await (await createButton(offer, 'Neexistuje')).click();
  await sleep(300);
  assert.ok(await seen(createOffer(page), 1000), 'the offer stays open');
  assert.ok(await seen(createOffer(page).getByRole('alert'), 1000), 'with the catalog error');
  assert.deepEqual(await core.writesTo(), [], 'nothing else written');
});

test('fr_lnk_04_ac12_opening_every_offer_writes_nothing', async ({ page }) => {
  // D-628 (6A): `Smazaná` is a trashed chip, not a broken one, so it offers no Create.
  const broken: (string | RegExp)[] = ['Neexistuje', 'neexistuje', SUBPATH_CHIP, 'jiný popis', 'Q3: plán?', 'Projekty/Alfa', 'Osoby/Eva Malá', 'Šablona'];
  for (const readView of [false, true]) {
    const p = readView ? await page.context().newPage() : page;
    const core = await openLinks(p, B.rozbite, { readView });
    const before = await filesNow(core);
    const scope = readView ? main(p) : editorBody(p);
    for (const t of broken) {
      await offerFor(p, scope, t);
      await p.keyboard.press('Escape');
      assert.ok(await absent(createOffer(p), 1000), `${t}: closed`);
    }
    assert.deepEqual(await writeCalls(core), [], `${readView ? 'read view' : 'editor'}: no write command`);
    assert.equal(await filesNow(core), before, 'every vault file unchanged');
  }
});

test('fr_syn_06_ac9_l5_zero_writes_then_one_create', async ({ page }) => {
  const core = await openLinks(page, B.cil);
  await mustPanel(page);
  await runCommand(page, 'Go to Broken links');
  await must(main(page).getByRole('heading', { name: 'Broken links', exact: true }), 'Broken links', 5000);
  await runCommand(page, 'Go to Duplicate titles');
  await must(main(page).getByRole('heading', { name: 'Duplicate titles', exact: true }), 'Duplicate titles', 5000);
  await gotoNote(page, 'Rozbité odkazy');
  await offerFor(page, editorBody(page), 'Neexistuje');
  await page.keyboard.press('Escape');
  assert.deepEqual(await writeCalls(core), [], 'the tour writes nothing');
  await (await createButton(await offerFor(page, editorBody(page), 'Neexistuje'), 'Neexistuje')).click();
  await mustBeOn(page, 'Neexistuje', 'created', 5000);
  assert.equal((await writeCalls(core)).length, 1, 'then exactly one write command');
  assert.deepEqual(await core.writesTo(), ['Quick Notes/Neexistuje.md']);
});
