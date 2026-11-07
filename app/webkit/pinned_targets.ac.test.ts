// Slice PIN, L5 (WebKit + fake core): targets that change. External renames, trash and restore, deleted and gone
// targets, the pending state while the index loads, tag and type pins, Tegg's renames patching pins:
// docs/acceptance/pinned.md FR-HOM-02 AC-16…AC-18, AC-20, AC-21, FR-LNK-03 AC-22 (R131 resolution, R133; AP-1229…AP-1231
// = D-1372…D-1374). Interface docs/contracts/v1-pinned.md §1.3, §1.6, §2 (re-read on `vault:changed`), §5
// (`pinsNotReady`, `renameFile`, `setFile`). Written from the ACs and the contract only (D-61). Lookups go through `must`
// (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  ID, P, PINS, VALID_ROWS, alertBox, click, description, eventually, flat, menuItem, moreBtn, moreMenu, must, mustBeOn, openPinned, pinnedVault,
  pinsFx, pinsText, retitle, rowAt, rows, rowsAre, runCommand, sleep, tagActionsBtn, tagActionsMenu, tagRow, textOf,
} from './pinned-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const stateOf = async (page: Parameters<typeof rows>[0]) => (await rows(page)).map((r) => [r.label, r.state, r.description]);

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-16

test('fr_hom_02_ac16_external_renames_resolve_by_id_never_by_reused_path', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: 'inbox' });
  await rowsAre(page, VALID_ROWS);
  const text = (await core.files())[P.rozpocet];
  await core.renameFile(P.rozpocet, 'Projekty/Rozpočet 2028.md');
  await core.setFile('Projekty/Rozpočet 2028.md', text.replace('title: Rozpočet 2027', 'title: Rozpočet 2028'));
  assert.equal((await rowsAre(page, ['Rozpočet 2028', ...VALID_ROWS.slice(1)], 2000))[0], 'Rozpočet 2028', 'the row reads Rozpočet 2028 within 2 s');
  await click(rowAt(page, 0), 'row Rozpočet 2028');
  await mustBeOn(page, 'Rozpočet 2028', 'opens the new path');
  assert.equal(await pinsText(core), pinsFx('valid.yml'), 'pinned.yml untouched: the stale path stays (AP-1230)');
  assert.deepEqual(await core.pinCalls(), [], 'no pins write');
});

test('fr_hom_02_ac16_stale_file_rows', async ({ page }) => {
  const core = await openPinned(page, { pins: 'stale.yml', route: 'inbox' });
  const want = [
    ['Rozpočet 2027', 'ok', 'Projekt'], ['Bez hlavičky', 'ok', 'Page'], ['Starý plán', 'trashed', 'Page, In the trash'], ['Smazaný', 'missing', 'Not found'],
    ['Plán', 'missing', 'Not found'], ['#zrušený', 'noObjects', 'Tag, No objects'], ['kniha', 'missing', 'Type page, Not found'],
  ];
  assert.deepEqual(await eventually(() => stateOf(page), (s) => JSON.stringify(s) === JSON.stringify(want)), want, 'R131 resolution of stale.yml');
  assert.equal((await rows(page))[4].tooltip, 'Plán\nPages/Plán.md', 'the …ZY row shows the stored path, not Plán\'s object');
  await click(rowAt(page, 4), 'row …ZY');
  assert.match(await textOf(alertBox(page)), /“Plán” can't be found\. It was deleted, or moved outside Tegg\./, 'a path held by another id is never adopted');
  await core.renameFile(P.bez, 'Pages/Jen text.md');
  assert.equal((await eventually(() => stateOf(page), (s) => s[1]?.[1] === 'missing', 2000))[1][1], 'missing', 'Bez hlavičky renamed away: missing within 2 s');
  await core.renameFile('Pages/Jen text.md', P.bez);
  assert.equal((await eventually(() => stateOf(page), (s) => s[1]?.[1] === 'ok', 2000))[1][1], 'ok', 'renamed back: restored');
  assert.deepEqual(await core.pinCalls(), [], 'no write');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-17

test('fr_hom_02_ac17_trashed_targets_stay_pinned', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: 'inbox' });
  await rowsAre(page, VALID_ROWS);
  await click(rowAt(page, 1), 'row Lisabon');
  await mustBeOn(page, 'Výjezd Lisabon 2026', 'Lisabon');
  await click(moreBtn(page), 'More');
  await click(menuItem(moreMenu(page), 'Move to trash'), 'Move to trash');
  const r = await eventually(() => rows(page), (x) => x[1]?.state === 'trashed', 2000);
  assert.deepEqual([r[1]?.label, r[1]?.state, await description(rowAt(page, 1))], ['Výjezd Lisabon 2026', 'trashed', 'Projekt, In the trash'], 'the row stays, muted, `In the trash`');
  const muted = await page.evaluate(() => { const e = document.createElement('span'); e.style.color = 'var(--muted)'; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; });
  assert.equal(await rowAt(page, 1).evaluate((a) => getComputedStyle(a).color), muted, 'the label in --muted');
  await click(rowAt(page, 1), 'trashed row');
  await mustBeOn(page, 'Trash', 'a click opens trash');
  const restore = page.getByRole('main').getByRole('row').filter({ hasText: 'Výjezd Lisabon 2026' }).first();
  await (await must(restore, 'Trash row Lisabon')).click({ button: 'right' });
  await click(page.getByRole('menu').last().getByRole('menuitem', { name: 'Restore', exact: true }), 'Restore');
  assert.equal((await eventually(() => rows(page), (x) => x[1]?.state === 'ok', 1000))[1]?.state, 'ok', 'restored: normal within 1 s');
  await core.renameFile(P.porada, `.trash/${P.porada}`);
  assert.equal((await eventually(() => rows(page), (x) => x[2]?.state === 'trashed', 2000))[2]?.state, 'trashed', 'a helper\'s move to .trash/ gives trashed within 2 s');
  assert.equal(await pinsText(core), pinsFx('valid.yml'), 'pinned.yml never written');
  assert.deepEqual(await core.pinCalls(), [], 'no pins_apply');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-18

test('fr_hom_02_ac18_missing_targets_are_never_unpinned_silently', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: 'inbox', vault: pinnedVault({ pins: 'valid.yml', edit: (f) => { f[`.trash/${P.lisabon}`] = f[P.lisabon]; delete f[P.lisabon]; } }) });
  assert.equal((await eventually(() => rows(page), (x) => x[1]?.state === 'trashed'))[1]?.state, 'trashed', 'Lisabon in the trash');
  await core.setFile(`.trash/${P.lisabon}`, null);
  const r = await eventually(() => rows(page), (x) => x[1]?.state === 'missing', 2000);
  assert.deepEqual([r[1]?.label, r[1]?.state], ['Výjezd Lisabon 2026', 'missing'], '`Not found`, labelled with the stored stem');
  assert.equal(await description(rowAt(page, 1)), 'Not found', 'description `Not found`');
  const before = await page.evaluate(() => location.href);
  await click(rowAt(page, 1), 'missing row');
  const alert = await must(alertBox(page), 'the alert');
  assert.equal(flat(await alert.innerText()).replace(/\s*Unpin$/, ''), '“Výjezd Lisabon 2026” can\'t be found. It was deleted, or moved outside Tegg.', 'the alert text');
  assert.equal(await page.evaluate(() => location.href), before, 'no navigation');
  await core.setFile(P.porada, null);
  assert.equal((await eventually(() => rows(page), (x) => x[2]?.state === 'missing', 2000))[2]?.state, 'missing', 'Porada deleted by a helper: missing');
  await sleep(1000);
  assert.deepEqual(await core.pinCalls(), [], 'Tegg never removes an item on its own');
  await core.setFile(P.porada, pinnedVault().files[P.porada]);
  assert.equal((await eventually(() => rows(page), (x) => x[2]?.state === 'ok', 2000))[2]?.state, 'ok', 'the file comes back: the row is restored within 2 s');
  await click(rowAt(page, 1), 'missing row again');
  await click(alertBox(page).getByRole('button', { name: 'Unpin', exact: true }), 'alert Unpin');
  assert.equal(await eventually(() => pinsText(core), (t) => t === pinsFx('valid.yml').replace(`  - id: ${ID('02')}\n    path: ${P.lisabon}\n`, '')), pinsFx('valid.yml').replace(`  - id: ${ID('02')}\n    path: ${P.lisabon}\n`, ''), 'the alert\'s Unpin removes the item\'s lines in one write');
  assert.equal((await core.pinCalls()).length, 1, 'one write');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-20

test('fr_hom_02_ac20_pending_never_shows_missing', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: 'inbox', notReady: true });
  const seenStates = new Set<string>();
  const watch = setInterval(() => { void rows(page).then((r) => r.forEach((x) => seenStates.add(String(x.state)))); }, 50);
  try {
    const pend = await eventually(() => rows(page), (x) => x.length === 5);
    assert.deepEqual(pend.slice(0, 4).map((x) => [x.label, x.state, x.description.replace(/^.*, /, '')]), [
      ['Rozpočet 2027', 'pending', 'Loading'], ['Výjezd Lisabon 2026', 'pending', 'Loading'], ['2026-10-07 Týdenní porada', 'pending', 'Loading'], ['#offsite', 'pending', 'Loading'],
    ], 'stored-path stems, `Loading`');
    const href = await page.evaluate(() => location.href);
    await click(rowAt(page, 0), 'a pending row');
    await sleep(300);
    assert.equal(await page.evaluate(() => location.href), href, 'a click on a pending row does nothing');
    assert.equal(await alertBox(page).count(), 0, 'and shows no alert');
    await sleep(3000);
    await core.pinsNotReady(false);
    assert.deepEqual(await rowsAre(page, VALID_ROWS, 3000), VALID_ROWS, 'titles once the first scan ends');
  } finally { clearInterval(watch); }
  assert.ok(!seenStates.has('missing'), `no row showed Not found at any time (${[...seenStates].join(', ')})`);
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-21

test('fr_hom_02_ac21_tag_rename_patches_the_pin_inside_the_job', async ({ page }) => {
  const start = `${pinsFx('valid.yml')}  - tag: účty\n`;
  const core = await openPinned(page, { pins: { text: start }, route: 'inbox' });
  await rowsAre(page, [...VALID_ROWS, '#účty']);
  await runCommand(page, 'Go to Tags');
  await click(tagRow(page, 'účty'), 'tag účty');
  await page.keyboard.press('Enter');
  await click(tagActionsBtn(page), 'Tag actions');
  const ti = (await tagActionsMenu(page).getByRole('menuitem').allInnerTexts()).map(flat);
  assert.deepEqual(ti.slice(0, 3), ['Unpin from sidebar', 'Rename tag…', 'Colour…'], 'Tag actions: the pin item first (R134)');
  await click(menuItem(tagActionsMenu(page), 'Rename tag…'), 'Rename tag…');
  const dlg = page.getByRole('dialog').last();
  await (await must(dlg.getByRole('textbox').first(), 'new name')).fill('finance');
  await click(dlg.getByRole('button', { name: /^Rename/ }).first(), 'Rename');
  const conf = page.getByRole('dialog').last().getByRole('button', { name: /^(Rename|Continue|Confirm)/ });
  if (await conf.count()) await conf.first().click().catch(() => {});
  assert.equal(await eventually(() => pinsText(core), (t) => t === pinsFx('expected/valid-after-tag-rename.yml'), 5000), pinsFx('expected/valid-after-tag-rename.yml'), 'expected/valid-after-tag-rename.yml');
  const job = (await core.jobs()).find((j) => j.kind === 'tag-rename');
  assert.ok(job?.written.includes(PINS), 'inside the rename job (a written row)');
  const zip = (await core.backups()).find((b) => b.kind === 'tag-rename');
  assert.equal(zip?.entries[PINS], start, 'the job\'s backup zip includes pinned.yml');
  assert.deepEqual(await core.pinCalls(), [], 'no pins_apply of its own');
  assert.ok((await rowsAre(page, [...VALID_ROWS, '#finance'])).includes('#finance'), 'the row reads #finance');
});

test('fr_hom_02_ac21_tag_delete_and_type_changes_keep_the_rows', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: 'inbox' });
  await rowsAre(page, VALID_ROWS);
  await click(rowAt(page, 3), 'row #offsite');
  await click(tagActionsBtn(page), 'Tag actions');
  await click(menuItem(tagActionsMenu(page), 'Delete tag…'), 'Delete tag…');
  await click(page.getByRole('dialog').last().getByRole('button', { name: /^Delete/ }).first(), 'Delete');
  const r = await eventually(() => rows(page), (x) => x[3]?.state === 'noObjects', 5000);
  assert.deepEqual([r[3]?.label, r[3]?.state], ['#offsite', 'noObjects'], '#offsite stays with `No objects`');
  await click(rowAt(page, 3), 'row #offsite');
  await mustBeOn(page, '#offsite', 'opens the empty tag page (D-720)');
  assert.equal(await pinsText(core), pinsFx('valid.yml'), 'pins file untouched by the delete');
  const typeFile = (await core.files())['.tegg/types/projekt.yml'];
  await core.setFile('.tegg/types/projekt.yml', typeFile.replace('plural: Projekty', 'plural: Projektíky'));
  assert.equal((await eventually(() => rows(page), (x) => x[4]?.label === 'Projektíky', 2000))[4]?.label, 'Projektíky', 'the plural relabels the type row within 2 s');
  await core.setFile('.tegg/types/projekt.yml', null);
  await sleep(800);
  assert.equal((await rows(page))[4]?.state, 'ok', 'no definition, objects remain: still ok (D-121)');
  await core.setFile(P.rozpocet, null);
  await core.setFile(P.lisabon, null);
  assert.equal((await eventually(() => rows(page), (x) => x[4]?.state === 'missing', 2000))[4]?.state, 'missing', 'objects gone too: `Not found`');
  assert.deepEqual(await core.pinCalls(), [], 'no pins write');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-22

test('fr_lnk_03_ac22_renames_patch_pins', async ({ page }) => {
  const core = await openPinned(page, { pins: 'valid.yml', route: `note/${P.rozpocet}` });
  await rowsAre(page, VALID_ROWS);
  await retitle(page, 'Rozpočet 2028');
  assert.equal(await eventually(() => pinsText(core), (t) => t === pinsFx('expected/valid-after-rename.yml'), 5000), pinsFx('expected/valid-after-rename.yml'), 'only line 5 changes');
  assert.equal((await core.writesTo()).filter((p) => p === PINS).length, 1, 'once');
  const job = (await core.jobs()).find((j) => j.kind === 'note-rename');
  assert.ok(job?.written.includes(PINS), 'inside the rename job');
  await runCommand(page, 'Undo rename');
  assert.equal(await eventually(() => pinsText(core), (t) => t === pinsFx('valid.yml'), 5000), pinsFx('valid.yml'), 'Undo restores the pins file\'s bytes');
  // A note that isn't pinned.
  const n = (await core.writesTo()).filter((p) => p === PINS).length;
  await click(rowAt(page, 1), 'Lisabon');
  await page.keyboard.press('Meta+Shift+f');
  await page.getByRole('textbox', { name: 'Search query' }).fill('Výplň 01');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Výplň 01', 'Výplň 01');
  await retitle(page, 'Výplň 01 nová');
  await eventually(async () => (await core.jobs()).length, (k) => k >= 3, 5000);
  assert.equal((await core.writesTo()).filter((p) => p === PINS).length, n, 'a rename of an unpinned object leaves pinned.yml untouched');
});

test('fr_lnk_03_ac22_idless_rename_adds_the_id', async ({ page }) => {
  const core = await openPinned(page, { pins: 'stale.yml', route: `note/${P.bez}` });
  await mustBeOn(page, 'Bez hlavičky', 'Bez hlavičky');
  await retitle(page, 'Bez hlavičky 2');
  const note = await eventually(async () => (await core.files())['Pages/Bez hlavičky 2.md'], (t) => !!t && /^id: /m.test(t), 5000);
  const id = /^id: (\S+)$/m.exec(note ?? '')?.[1];
  assert.ok(id, 'the rename wrote an id into the note (AP-4)');
  const want = pinsFx('expected/stale-after-rename-bez-hlavicky.yml').replace('<ID>', id!);
  assert.equal(await eventually(() => pinsText(core), (t) => t === want, 5000), want, 'expected/stale-after-rename-bez-hlavicky.yml');
});

test('fr_lnk_03_ac22_unreadable_pins_are_skipped_by_the_job', async ({ page }) => {
  const core = await openPinned(page, { pins: 'newer-version.yml', route: `note/${P.rozpocet}` });
  await rowsAre(page, VALID_ROWS);
  await retitle(page, 'Rozpočet 2028');
  const job = await eventually(async () => (await core.jobs()).find((j) => j.kind === 'note-rename'), (j) => !!j && j.phase === 'done', 5000);
  assert.equal(job?.phase, 'done', 'the job still succeeds');
  assert.equal(await pinsText(core), pinsFx('newer-version.yml'), 'a newer pins file is skipped');
  assert.equal((await rowsAre(page, ['Rozpočet 2028', ...VALID_ROWS.slice(1)]))[0], 'Rozpočet 2028', 'the pin still resolves by id');
});
