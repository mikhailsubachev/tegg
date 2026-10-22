// MS6 slice 6A, L5 (WebKit + fake core): links and embeds whose target is in the trash, docs/acceptance/trash-media.md
// R74, FR-HIS-01 AC-11 (trashed chips in the editor, the read view and a relation value; a click opens the Trash with
// the row focused; restore and trash follow within 2 s; nothing written), AC-12 (the D-27 placeholder with Restore for
// a note embed and a media pair) and conversion.md FR-CNV-08 AC-6 ([MS6]: a trashed converted task in Bloky).
// Interface docs/contracts/ms6-trash-media.md §2 (`trashed` kind), §6.2 (`links/chip.ts` `data-link-state="trashed"`,
// `trash.inTrash`; `embeds/Embed.tsx` placeholder), §9.2 (fake core `link_resolve`, `embed_load` state `trashed`).
// Written from the ACs and the contracts only (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  TM, callsOf, click, description, eventually, imgNamed, main, must, nfc, openTM, original, seen, sleep, tmVault, trashHeading,
  trashedPlaceholder, vaultWrites6a,
} from './trash-media-helpers';
import { C, ZAVOLAT, ZAVOLAT_PARA, ZAVOLAT_TASK, convertVault, openConvert, original as convertOriginal, swap } from './convert-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const chip = (scope: Locator, title: string) => scope.locator('[data-link-state]').filter({ hasText: title }).first();
async function chipState(scope: Locator, title: string): Promise<string | null> {
  if (!(await seen(chip(scope, title), 500))) return null;
  return chip(scope, title).getAttribute('data-link-state');
}
async function struck(loc: Locator): Promise<boolean> {
  return loc.evaluate((e) => {
    const all = [e, ...e.querySelectorAll('*')] as HTMLElement[];
    return all.some((x) => getComputedStyle(x).textDecorationLine.includes('line-through'));
  });
}
const focusedRow = (page: Page) => page.evaluate(() => document.activeElement?.closest('[data-path]')?.getAttribute('data-path')?.normalize('NFC') ?? null);

// ------------------------------------------------------------------------------------------------ AC-11

test('fr_his_01_ac11_trashed_chip_in_the_editor', async ({ page }) => {
  const core = await openTM(page, TM.odkazy, 'Odkazy');
  const body = main(page);
  const c = await must(body.locator('[data-link-state="trashed"]').filter({ hasText: 'Stará poznámka' }), 'the trashed chip of [[Stará poznámka]]', 3000);
  assert.equal(await description(c), 'In trash', 'description In trash');
  assert.equal(await struck(c), true, 'struck through');
  await c.click();
  await must(trashHeading(page), 'the click opens the Trash', 3000);
  assert.equal(await eventually(() => focusedRow(page), (p) => p === nfc(TM.t1), 2000), nfc(TM.t1), "T1's row is focused");
  assert.deepEqual(await vaultWrites6a(core), [], 'no file is written (AP-531)');
});

test('fr_his_01_ac11_chips_follow_restore_and_trash_within_2_s', async ({ page }) => {
  const core = await openTM(page, TM.odkazy, 'Odkazy');
  const body = main(page);
  assert.equal(await eventually(() => chipState(body, 'Stará poznámka'), (s) => s === 'trashed', 3000), 'trashed', 'trashed at first');
  await core.renameFile(TM.t1, 'Quick Notes/Stará poznámka.md');
  assert.notEqual(await eventually(() => chipState(body, 'Stará poznámka'), (s) => s !== null && s !== 'trashed', 2000), 'trashed', 'a normal chip within 2 s of the restore');
  await core.renameFile(TM.ukol, `.trash/${TM.ukol}`);
  assert.equal(await eventually(() => chipState(body, 'Koupit semínka'), (s) => s === 'trashed', 2000), 'trashed', '[[Koupit semínka]] becomes trashed within 2 s');
  assert.deepEqual(await core.writesTo(), [], 'no file is written');
});

test('fr_his_01_ac11_read_view_and_relation_value', async ({ page }) => {
  const vault = tmVault((f) => {
    f[TM.ukol] = f[TM.ukol].replace('due: 2026-10-24\n', 'due: 2026-10-24\nsource: "[[Stará poznámka]]"\n');
  });
  const core = await openTM(page, TM.odkazy, 'Odkazy', { vault, readView: true });
  assert.equal(await eventually(() => chipState(main(page), 'Stará poznámka'), (s) => s === 'trashed', 3000), 'trashed', 'the read view marks it too');
  await page.keyboard.press('Meta+o');
  await page.getByRole('combobox', { name: 'Switcher query' }).or(page.getByRole('textbox', { name: 'Switcher query' })).first().fill('Koupit semínka');
  await sleep(150);
  await page.keyboard.press('Enter');
  const panel = page.getByRole('list', { name: 'Properties' }).or(page.getByRole('region', { name: 'Properties' })).first();
  assert.equal(await eventually(() => chipState(panel, 'Stará poznámka'), (s) => s === 'trashed', 3000), 'trashed', 'a relation value (source) is a trashed chip');
  assert.deepEqual(await vaultWrites6a(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ AC-12

test('fr_his_01_ac12_trashed_note_embed_shows_the_placeholder', async ({ page }) => {
  const core = await openTM(page, TM.odkazy, 'Odkazy');
  const ph = await must(trashedPlaceholder(main(page), 'Stará poznámka'), '"Stará poznámka" was moved to the trash', 3000);
  await click(ph.getByRole('button', { name: 'Restore', exact: true }), 'Restore');
  const moves = await eventually(() => core.moves(), (m) => m.length > 0, 2000);
  assert.deepEqual(moves, [{ kind: 'restore', from: nfc(TM.t1), to: 'Quick Notes/Stará poznámka.md' }], 'the restore renames T1 back');
  assert.deepEqual(await core.writesTo(), [], 'nothing but the rename');
  assert.equal((await core.files())['Quick Notes/Stará poznámka.md'], original(TM.t1), 'bytes untouched');
});

test('fr_his_01_ac12_trashed_media_pair_shows_the_placeholder_and_restores_both', async ({ page }) => {
  const core = await openTM(page, TM.odkazy, 'Odkazy');
  const ph = await must(trashedPlaceholder(main(page), 'Smazaný obrázek'), '"Smazaný obrázek" was moved to the trash', 3000);
  await click(ph.getByRole('button', { name: 'Restore', exact: true }), 'Restore');
  const moves = await eventually(() => core.moves(), (m) => m.length >= 2, 2000);
  assert.deepEqual(moves.map((m) => [m.from, m.to]), [[nfc(TM.t3), 'Images/Smazaný obrázek.md'], [nfc(TM.t3file), '_attachments/Smazaný obrázek.png']], 'both files of the pair, the object first');
  await must(imgNamed(main(page), 'Smazaný obrázek'), 'then the image shows', 3000);
  assert.deepEqual(await core.writesTo(), [], 'nothing but the renames');
  assert.equal((await callsOf(core, 'note_write')).length, 0, 'Odkazy is not written');
});

// ------------------------------------------------------------------------------------------------ conversion.md FR-CNV-08 AC-6

test('fr_cnv_08_ac6_a_trashed_converted_task_shows_restore', async ({ page }) => {
  const EMBED = `![[${ZAVOLAT}]]\n`;
  const PRE = swap(convertOriginal(C.bloky), ZAVOLAT_PARA, EMBED);
  const TASK = `---\nid: 01JB5A0000000000000000W401\ntype: task\ntitle: ${ZAVOLAT}\nstatus: To do\nsource: "[[Bloky]]"\ncreated: 2026-10-14T12:00:00+02:00\nmodified: 2026-10-14T12:00:00+02:00\n---\na domluvit termín.\n`;
  const core = await openConvert(page, C.bloky, { vault: convertVault((f) => { f[C.bloky] = PRE; f[ZAVOLAT_TASK] = TASK; }), ...({ trashedLinks: true } as object) });
  await must(main(page).getByRole('button', { name: `Open ${ZAVOLAT}`, exact: true }), 'the Task card first', 5000);
  await core.renameFile(ZAVOLAT_TASK, `.trash/${ZAVOLAT_TASK}`);
  const ph = await must(trashedPlaceholder(main(page), ZAVOLAT), `"${ZAVOLAT}" was moved to the trash`, 3000);
  await click(ph.getByRole('button', { name: 'Restore', exact: true }), 'Restore');
  const restores = await eventually(() => callsOf(core, 'trash_restore'), (c) => c.length > 0, 2000);
  assert.equal(nfc(String((restores[0]?.args as any)?.path)), nfc(`.trash/${ZAVOLAT_TASK}`), 'trash_restore of the task');
  assert.equal((await core.files())[nfc(ZAVOLAT_TASK)], TASK, 'back at its original path, same bytes');
  await must(main(page).getByRole('button', { name: `Open ${ZAVOLAT}`, exact: true }), 'the card shows again', 3000);
});
