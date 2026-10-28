// Slice 4E-2, L5 (WebKit + fake core over mocked IPC, real @tegg/doc): deleting a property, deleting a type and the
// widen-only Type menu in the UI. docs/acceptance/type-moves.md FR-TYP-04 AC-6 (the dialog counts what the core
// planned; `isbn` without values: no job), AC-7 (the job, `Deleting Poznámka · <done> of <n>` with Cancel, `Deleted
// Poznámka · removed values from 1 note` with Undo, the zip's label), AC-8 (Undo in the status and the palette), AC-9
// (a skipped Kniha listed with Retry; its value under Other properties); FR-TYP-05 AC-6 (the Delete type section and
// dialog), AC-7 (the job, trashed chips, the deleted-type route with Undo and Open Trash), AC-8 (Undo, Cancel while
// deleting, the palette), AC-9 (`1 object was not changed, so the type was kept.` with Show), AC-10 (restoring from the
// Trash view brings the type back); FR-TYP-03 AC-14 (the widen-only Type menu); types.md FR-TYP-05 AC-4 (D-809, D-842)
// on the types fixture; and of "Both parts" FR-HIS-04 AC-11, FR-UX-03 AC-18, NFR-OTH-02 AC-10 and FR-UX-05 AC-13 for
// the 4E-2 dialogs and statuses (R99 D, E, F; R100).
// Interface docs/contracts/ms4-jobs.md §14.9.6 (IPC `value_remove_start(type, key)`, `type_delete_start(type)`, both
// stopping in `confirm`; `job_plan`, `job_confirm`, `job_cancel`, `job_undo`, `job_retry`; `JobReportDto.keptType`),
// §14.9.7 (the menu), §14.9.8 (UI and fake core), §10, §11 (`holdJob`, `skipOnWrite`, `jobs`, `backups`,
// `failBackups`). FR-TYP-04 AC-10 is L4 only (D-841). Written from the ACs and the contract only (D-61). Every lookup
// goes through `must`/node:assert, so a missing element fails an assertion (TS-I1).
//
// The core runs without the tidy job (`tidy: false`), so Schůzka jinde stays in Pages/ and the three Schůzky are where
// the fixture has them.
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  M, args, callsOf, editorBody, eventually, fileText, fileWhen, flat, jobStatus, main, movesVault, must, mustBeOn, nfc, notUpdatedList, openMoves,
  original, runCommand, seen, sleep, type FakeCoreHandle,
} from './type-moves-helpers';
import { axeContrast, colourLeaks } from './read-helpers';
import { focused, goToQuery, pseudoLocale, typesList } from './helpers';
import { gotoSettings, isDisabled, openTypes, otherProps, property, section, typesVault } from './types-helpers';
import { backupRows } from './tags-helpers';
import { gotoTrash, restoreBtn, rowPaths } from './trash-media-helpers';
import type { FakeVault } from '../ui/test/fake-core';

test.use({ timezoneId: 'Europe/Prague' });

const D = {
  porada: 'Schůzky/Porada.md',
  retro: 'Schůzky/Retro.md',
  schJinde: 'Pages/Schůzka jinde.md',
  tSchuzka: '_templates/Schůzka/Schůzka.md',
  schuzkaYml: '.tegg/types/schůzka.yml',
  tKniha: '_templates/Kniha/Kniha.md',
  tRecenze: '_templates/Kniha/Recenze.md',
} as const;
const TRASHED: Record<string, string> = {
  [D.porada]: '.trash/Schůzky/Porada.md',
  [D.retro]: '.trash/Schůzky/Retro.md',
  [D.schJinde]: '.trash/Pages/Schůzka jinde.md',
  [D.tSchuzka]: '.trash/_templates/Schůzka/Schůzka.md',
  [D.schuzkaYml]: '.trash/.tegg/types/schůzka.yml',
};
const POZNAMKA_ITEM = '  - key: poznámka\n    name: Poznámka\n    type: text\n';
const ISBN_ITEM = '  - key: isbn\n    name: ISBN\n    type: text\n';
const DUNA_LINE = 'poznámka: Půjčená od Petra\n';
const without = (text: string | undefined, part: string) => {
  if (text === undefined || text.split(part).length !== 2) throw new Error(`setup: ${JSON.stringify(part)} must occur once`);
  return text.replace(part, '');
};
const dunaAfter = () => without(original(M.duna), DUNA_LINE);
const knihaAfter = () => without(original(M.knihaYml), POZNAMKA_ITEM);
/** Starý zápis with a poznámka value, so a job has two files (cancel between them). */
const withStary = (f: Record<string, string>) => { f['Knihy/2025/Starý zápis.md'] = f['Knihy/2025/Starý zápis.md'].replace('autor: Neznámý\n', 'autor: Neznámý\npoznámka: Z půdy\n'); };

/** The R99 dialogs (role dialog or alertdialog; the pseudo-locale wraps the name). */
const dlg = (page: Page, name: string) =>
  page.getByRole('dialog', { name: new RegExp(`^⟦?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}⟧?$`) })
    .or(page.getByRole('alertdialog', { name: new RegExp(`^⟦?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}⟧?$`) }));
const propDialog = (page: Page, name: string) => dlg(page, `Delete property "${name}"?`);
const typeDialog = (page: Page, name: string) => dlg(page, `Delete type "${name}"?`);
const text = async (loc: Locator) => flat(await loc.innerText());

async function open(page: Page, o: { vault?: FakeVault; at?: string; prelude?: string } = {}): Promise<FakeCoreHandle> {
  return openMoves(page, { at: M.odkazy, tidy: false, ...o });
}
/** The property group `name` in Type settings › Properties, expanded. */
async function expand(page: Page, name: string): Promise<Locator> {
  const g = await must(property(page, name), `property group "${name}"`);
  const edit = g.getByRole('button', { name: `Edit ${name}`, exact: true });
  if (await seen(edit, 500)) await edit.click();
  return g;
}
/** Type settings of Kniha › `name` › `Delete property…`; returns the dialog. */
async function deleteProperty(page: Page, name: string): Promise<Locator> {
  await gotoSettings(page, 'Knihy', 'Kniha');
  const g = await expand(page, name);
  await (await must(g.getByRole('button', { name: 'Delete property…', exact: true }), `${name}: Delete property…`)).click();
  return must(propDialog(page, name), `dialog "Delete property "${name}"?"`);
}
/** Type settings of Schůzka › `Delete Schůzka type…`; returns the dialog. */
async function deleteType(page: Page): Promise<Locator> {
  await gotoSettings(page, 'Schůzky', 'Schůzka');
  await (await must(section(page, 'Delete type').getByRole('button', { name: 'Delete Schůzka type…', exact: true }), 'Delete Schůzka type…')).click();
  return must(typeDialog(page, 'Schůzka'), 'dialog "Delete type "Schůzka"?"');
}
async function confirmProperty(page: Page, n = 1) {
  const d = await deleteProperty(page, 'Poznámka');
  const label = `Delete from ${n} note${n === 1 ? '' : 's'}`;
  await (await must(d.getByRole('button', { name: label, exact: true }), label)).click();
}
async function confirmType(page: Page) {
  const d = await deleteType(page);
  await (await must(d.getByRole('button', { name: 'Delete type and trash 3 schůzky', exact: true }), 'Delete type and trash 3 schůzky')).click();
}
async function gotoBackups(page: Page) {
  await runCommand(page, 'Go to Settings: Backups');
  await must(main(page).getByRole('heading', { level: 1, name: 'Backups', exact: true }), 'heading "Backups"', 3000);
}
/** Presses Tab up to `max` times; true when `target` got the focus. */
async function reachable(page: Page, target: Locator, max = 40): Promise<boolean> {
  const h = await target.first().elementHandle({ timeout: 1000 }).catch(() => null);
  if (!h) return false;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((e) => e === document.activeElement, h)) return true;
  }
  return false;
}
/** Visible text nodes of `el` outside every ⟦ ⟧ wrapper. */
async function loose(el: Locator): Promise<string[]> {
  return el.evaluate((root) => {
    const out: string[] = [];
    const walk = (n: Node, inside: boolean) => {
      if (n.nodeType === 3) {
        const t = (n.textContent ?? '').trim();
        if (t && !inside && !t.includes('⟦')) out.push(t);
        return;
      }
      for (const c of [...n.childNodes]) walk(c, inside || (n.textContent ?? '').trim().startsWith('⟦'));
    };
    walk(root, false);
    return out;
  });
}
const unchanged = async (core: FakeCoreHandle, vault: FakeVault) => {
  const files = await core.files();
  return Object.keys({ ...files, ...vault.files }).filter((p) => files[p] !== vault.files[p]).sort();
};

// ------------------------------------------------------------------------------------------------ FR-TYP-04 AC-6

test('fr_typ_04_ac6_the_dialog_counts_what_the_core_planned', async ({ page }) => {
  const vault = movesVault();
  const core = await open(page, { vault });
  const d = await deleteProperty(page, 'Poznámka');
  assert.deepEqual(args((await callsOf(core, 'value_remove_start'))[0]), { type: 'kniha', key: 'poznámka' }, 'value_remove_start(type, key) (ms4-jobs §14.9.6)');
  const t = await text(d);
  assert.ok(t.includes('Removes the poznámka line from 1 kniha; 1 has no value and is not touched.'), `R99 D1 with the planned counts (Duna; Bez autora's empty line, AP-769): ${t}`);
  assert.ok(t.includes('A backup of the vault is made first (Settings › Backups). Undo restores the values and the property.'), 'the backup line');
  await must(d.getByRole('button', { name: 'Delete from 1 note', exact: true }), 'button "Delete from 1 note"');
  assert.equal((await focused(page)).label, 'Cancel', 'Cancel is the default');
  await (await must(d.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel')).click();
  assert.equal(await seen(propDialog(page, 'Poznámka'), 300), false, 'closed');
  assert.ok((await callsOf(core, 'job_cancel')).length >= 1, 'Cancel cancels the job waiting in confirm');
  assert.deepEqual(await unchanged(core, vault), [], 'nothing written');
  assert.deepEqual(await core.backups(), [], 'no zip');
});

test('fr_typ_04_ac6_isbn_without_values_changes_only_the_type_file', async ({ page }) => {
  const core = await open(page);
  const d = await deleteProperty(page, 'ISBN');
  assert.ok((await text(d)).includes('No kniha has a value. Only the type definition changes.'), 'R99 D2');
  const del = await must(d.getByRole('button', { name: 'Delete property', exact: true }), 'button "Delete property"');
  assert.equal((await focused(page)).label, 'Cancel', 'Cancel is the default');
  await del.click();
  assert.equal(await fileWhen(core, M.knihaYml, (x) => !x?.includes('key: isbn')), without(original(M.knihaYml), ISBN_ITEM), 'the isbn item is removed');
  assert.deepEqual(await callsOf(core, 'value_remove_start'), [], 'no job (ms4-jobs §14.9.2)');
  assert.deepEqual(await core.backups(), [], 'no zip');
  assert.deepEqual((await core.writesTo()).map(nfc), [M.knihaYml], 'only kniha.yml is written');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-04 AC-7

test('fr_typ_04_ac7_delete_from_1_note_runs_the_job_and_says_so', async ({ page }) => {
  const core = await open(page);
  await confirmProperty(page);
  assert.ok((await callsOf(core, 'job_confirm')).length === 1, 'the dialog confirms the job (job_confirm)');
  const st = await must(jobStatus(page, 'Deleted Poznámka · removed values from 1 note'), 'status "Deleted Poznámka · removed values from 1 note"', 5000);
  await must(st.getByRole('button', { name: 'Undo', exact: true }), 'with Undo');
  assert.equal(await fileText(core, M.duna), dunaAfter(), 'Duna loses its line; `# od koho` stays');
  assert.equal(await fileText(core, M.knihaYml), knihaAfter(), 'kniha.yml loses the item');
  for (const p of [M.bez, M.clanek, D.tKniha, D.tRecenze]) assert.equal(await fileText(core, p), original(p), `${p} untouched`);
  assert.deepEqual((await core.backups()).map((b) => b.kind), ['value-remove'], 'one zip, before the writes (FR-HIS-04 AC-11)');
  await gotoBackups(page);
  assert.ok((await backupRows(page)).some((r) => r.includes('Delete property Poznámka')), 'Settings › Backups label `Delete property Poznámka` (R99)');
});

test('fr_typ_04_ac7_the_running_status_counts_and_cancel_writes_nothing_in_the_end', async ({ page }) => {
  const vault = movesVault(withStary);
  const core = await open(page, { vault });
  const release = await core.holdJob('writing');
  await confirmProperty(page, 2);
  const st = await must(jobStatus(page, /^Deleting Poznámka · \d of 2/), 'status "Deleting Poznámka · <done> of 2" (R99 D3)', 5000);
  await (await must(st.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel in the status')).click();
  await release();
  const j = await eventually(() => core.jobs(), (x) => x.some((r) => r.kind === 'value-remove'), 5000);
  assert.equal(j.find((r) => r.kind === 'value-remove')?.phase, 'cancelled', 'the job is cancelled');
  assert.deepEqual(await eventually(() => unchanged(core, vault), (x) => x.length === 0, 3000), [], 'the rows written so far are reversed; the type file is never written');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-04 AC-8

test('fr_typ_04_ac8_status_undo_restores_the_values_and_the_property', async ({ page }) => {
  const core = await open(page);
  await confirmProperty(page);
  const st = await must(jobStatus(page, 'Deleted Poznámka · removed values from 1 note'), 'status', 5000);
  await (await must(st.getByRole('button', { name: 'Undo', exact: true }), 'Undo')).click();
  assert.equal(await fileWhen(core, M.duna, (x) => x === original(M.duna)), original(M.duna), 'Duna has its exact bytes again');
  assert.equal(await fileWhen(core, M.knihaYml, (x) => x === original(M.knihaYml)), original(M.knihaYml), 'kniha.yml has its exact bytes again');
  assert.ok(await seen(property(page, 'Poznámka'), 3000), 'the Poznámka property is back in Type settings');
});

test('fr_typ_04_ac8_the_palette_undo_delete_property', async ({ page }) => {
  const core = await open(page);
  await confirmProperty(page);
  await must(jobStatus(page, 'Deleted Poznámka · removed values from 1 note'), 'status', 5000);
  await runCommand(page, 'Undo delete property');
  assert.equal(await fileWhen(core, M.duna, (x) => x === original(M.duna)), original(M.duna), '`Undo delete property` (R100) restores Duna');
  assert.equal(await fileWhen(core, M.knihaYml, (x) => x === original(M.knihaYml)), original(M.knihaYml), 'and kniha.yml');
  assert.ok((await callsOf(core, 'job_undo')).length === 1, 'one job_undo');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-04 AC-9

test('fr_typ_04_ac9_a_changed_kniha_is_listed_with_retry', async ({ page }) => {
  const core = await open(page);
  await core.skipOnWrite(M.duna, 'changed');
  await confirmProperty(page);
  const j = await eventually(() => core.jobs(), (x) => x.some((r) => r.kind === 'value-remove'), 5000);
  assert.deepEqual(j.find((r) => r.kind === 'value-remove')?.skipped, [{ path: M.duna, reason: 'changed' }], 'Duna is skipped `changed`');
  assert.equal(await fileText(core, M.duna), original(M.duna), 'Duna keeps its line');
  assert.equal(await fileText(core, M.knihaYml), knihaAfter(), 'the type file is still changed');
  await (await must(page.getByRole('status').getByRole('button', { name: 'Show', exact: true }), 'status `Show` (the skipped list, red-test point AP-792)', 5000)).click();
  const list = await must(notUpdatedList(page).or(page.getByRole('list', { name: 'Links not updated', exact: true })), 'the not-updated list');
  assert.ok((await text(list)).includes('Duna'), 'Duna is listed');
  await (await must(list.getByRole('button', { name: 'Retry Duna', exact: true }), 'Retry Duna')).click();
  assert.equal(await fileWhen(core, M.duna, (x) => x === dunaAfter()), dunaAfter(), 'Retry removes the line');
});

test('fr_typ_04_ac9_the_skipped_note_shows_the_value_under_other_properties', async ({ page }) => {
  const core = await open(page);
  await core.skipOnWrite(M.duna, 'changed');
  await confirmProperty(page);
  await eventually(() => core.jobs(), (x) => x.some((r) => r.kind === 'value-remove' && r.phase === 'done'), 5000);
  await goToQuery(page, 'Duna');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Duna', 'open Duna', 5000);
  await (await must(otherProps(page), 'Other properties (n)')).click();
  const other = await must(page.getByRole('list', { name: 'Other properties' }), 'list Other properties');
  assert.ok((await text(other)).includes('poznámka'), 'the value shows under Other properties until a retry removes it');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-05 AC-6

test('fr_typ_05_ac6_the_delete_type_section_and_dialog', async ({ page }) => {
  const vault = movesVault();
  const core = await open(page, { vault });
  await gotoSettings(page, 'Schůzky', 'Schůzka');
  const sec = await must(section(page, 'Delete type'), 'section "Delete type"');
  assert.ok((await text(sec)).includes('Deleting Schůzka moves its 3 schůzky to the trash. To keep them, change their type first. A backup is made first.'), 'R99 F3');
  await (await must(sec.getByRole('button', { name: 'Delete Schůzka type…', exact: true }), 'Delete Schůzka type…')).click();
  const d = await must(typeDialog(page, 'Schůzka'), 'dialog "Delete type "Schůzka"?"');
  assert.deepEqual(args((await callsOf(core, 'type_delete_start'))[0]), { type: 'schůzka' }, 'type_delete_start(type) (ms4-jobs §14.9.6)');
  const t = await text(d);
  assert.ok(t.includes('3 schůzky go to the trash with the type, and the Schůzka template. Notes that link to them show moved to trash.'), `R99 F1 (D-842): ${t}`);
  assert.ok(t.includes('A backup of the vault is made first (Settings › Backups). Undo brings the schůzky and the type back.'), 'the backup line');
  await must(d.getByRole('button', { name: 'Delete type and trash 3 schůzky', exact: true }), 'Delete type and trash 3 schůzky');
  assert.equal((await focused(page)).label, 'Cancel', 'Cancel is the default');
  await (await must(d.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel')).click();
  assert.deepEqual(await unchanged(core, vault), [], 'Cancel writes nothing');
  assert.deepEqual(await core.backups(), [], 'no zip');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-05 AC-7

test('fr_typ_05_ac7_confirming_trashes_the_schuzky_and_shows_the_deleted_type', async ({ page }) => {
  const core = await open(page);
  await confirmType(page);
  const st = await must(jobStatus(page, 'Deleted Schůzka · 3 schůzky in the trash'), 'status "Deleted Schůzka · 3 schůzky in the trash"', 5000);
  await must(st.getByRole('button', { name: 'Undo', exact: true }), 'with Undo');
  const files = await core.files();
  const bad = Object.entries(TRASHED).filter(([from, to]) => files[from] !== undefined || files[to] !== original(from)).map(([f]) => f);
  assert.deepEqual(bad, [], 'the three objects, the template and the type file are in .trash/ at their relative paths with their bytes');
  assert.equal(files[M.odkazy], original(M.odkazy), 'Odkazy is not written');
  assert.ok(await seen(main(page).getByText('This type no longer exists.', { exact: true }), 3000), 'type-settings/schůzka: `This type no longer exists.`');
  assert.ok(await seen(main(page).getByText('Schůzka was deleted. Its 3 objects are in the trash.', { exact: true })), '`Schůzka was deleted. Its 3 objects are in the trash.`');
  await must(main(page).getByRole('button', { name: 'Undo', exact: true }), 'the route offers Undo');
  await must(main(page).getByRole('button', { name: 'Open Trash', exact: true }), 'and Open Trash');
  assert.ok(!(await seen(typesList(page).getByRole('listitem').filter({ hasText: 'Schůzky' }), 500)), 'the sidebar no longer lists Schůzky');
  assert.deepEqual((await core.backups()).map((b) => b.kind), ['type-delete'], 'one zip (FR-HIS-04 AC-11)');
  await gotoBackups(page);
  assert.ok((await backupRows(page)).some((r) => r.includes('Delete type Schůzka')), 'Settings › Backups label `Delete type Schůzka` (R99)');
});

test('fr_typ_05_ac7_links_to_the_trashed_schuzky_show_the_trashed_chip', async ({ page }) => {
  const core = await open(page);
  await confirmType(page);
  await must(jobStatus(page, 'Deleted Schůzka · 3 schůzky in the trash'), 'status', 5000);
  await goToQuery(page, 'Odkazy');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Odkazy', 'open Odkazy', 5000);
  const body = await must(editorBody(page), 'Note body');
  for (const n of ['Porada', 'Retro']) await must(body.locator('[data-link-state="trashed"]').filter({ hasText: n }), `[[${n}]] shows the trashed chip (6A)`, 3000);
  assert.equal(await fileText(core, M.odkazy), original(M.odkazy), 'without a write to Odkazy');
});

test('fr_typ_05_ac7_the_running_status_and_open_trash', async ({ page }) => {
  const core = await open(page);
  const release = await core.holdJob('writing');
  await confirmType(page);
  await must(jobStatus(page, /^Deleting Schůzka · \d of 3/), 'status "Deleting Schůzka · <done> of 3" with Cancel (R99 F2)', 5000);
  await release();
  await must(jobStatus(page, 'Deleted Schůzka · 3 schůzky in the trash'), 'done', 5000);
  await (await must(main(page).getByRole('button', { name: 'Open Trash', exact: true }), 'Open Trash')).click();
  // One row per Schůzka (not a `Schůzky` folder row: red-test point AP-800).
  const rows = await eventually(() => rowPaths(page), (r) => r.length >= 3, 3000);
  for (const p of [TRASHED[D.porada], TRASHED[D.retro], TRASHED[D.schJinde]]) assert.ok(rows.includes(p), `${p} is in the Trash view: ${rows.join(', ')}`);
});

// ------------------------------------------------------------------------------------------------ FR-TYP-05 AC-8

test('fr_typ_05_ac8_undo_brings_the_schuzky_and_the_type_back', async ({ page }) => {
  const vault = movesVault();
  const core = await open(page, { vault });
  await confirmType(page);
  const st = await must(jobStatus(page, 'Deleted Schůzka · 3 schůzky in the trash'), 'status', 5000);
  await (await must(st.getByRole('button', { name: 'Undo', exact: true }), 'status Undo')).click();
  assert.deepEqual(await eventually(() => unchanged(core, vault), (x) => x.length === 0, 3000), [], 'every file back at its path with its bytes; nothing left in .trash/');
  assert.ok(await seen(typesList(page).getByRole('listitem').filter({ hasText: 'Schůzky' }), 3000), 'the sidebar lists Schůzky again');
});

test('fr_typ_05_ac8_undo_from_the_deleted_type_route_and_the_palette', async ({ page }) => {
  const vault = movesVault();
  const core = await open(page, { vault });
  await confirmType(page);
  await must(jobStatus(page, 'Deleted Schůzka · 3 schůzky in the trash'), 'status', 5000);
  await (await must(main(page).getByRole('button', { name: 'Undo', exact: true }), 'the route\'s Undo')).click();
  assert.deepEqual(await eventually(() => unchanged(core, vault), (x) => x.length === 0, 3000), [], 'the route\'s Undo restores everything');
  await confirmType(page);
  await must(jobStatus(page, 'Deleted Schůzka · 3 schůzky in the trash'), 'status (again)', 5000);
  await runCommand(page, 'Undo delete type');
  assert.deepEqual(await eventually(() => unchanged(core, vault), (x) => x.length === 0, 3000), [], '`Undo delete type` (R100) restores everything');
});

test('fr_typ_05_ac8_cancel_while_deleting_restores_the_trashed_objects_and_keeps_the_type', async ({ page }) => {
  const vault = movesVault();
  const core = await open(page, { vault });
  const release = await core.holdJob('writing');
  await confirmType(page);
  const st = await must(jobStatus(page, /^Deleting Schůzka · \d of 3/), 'status "Deleting Schůzka · <done> of 3"', 5000);
  await (await must(st.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel')).click();
  await release();
  const j = await eventually(() => core.jobs(), (x) => x.some((r) => r.kind === 'type-delete'), 5000);
  assert.equal(j.find((r) => r.kind === 'type-delete')?.phase, 'cancelled', 'cancelled');
  assert.deepEqual(await eventually(() => unchanged(core, vault), (x) => x.length === 0, 3000), [], 'the objects already trashed are restored; the type stays');
});

test('fr_typ_05_ac8_a_failed_zip_leaves_the_type_in_place', async ({ page }) => {
  const vault = movesVault();
  const core = await open(page, { vault });
  await core.failBackups(true);
  await confirmType(page);
  const j = await eventually(() => core.jobs(), (x) => x.some((r) => r.kind === 'type-delete'), 5000);
  assert.equal(j.find((r) => r.kind === 'type-delete')?.phase, 'failed', 'the job ends failed (BackupFailed, FR-HIS-04 AC-11)');
  assert.deepEqual(await unchanged(core, vault), [], 'the vault is unchanged (data-safety AC-1)');
  assert.deepEqual(await core.backups(), [], 'no zip listed');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-05 AC-9

test('fr_typ_05_ac9_a_skipped_object_keeps_the_type_and_says_so', async ({ page }) => {
  const core = await open(page);
  await core.skipOnWrite(D.retro, 'changed');
  await confirmType(page);
  const st = await must(jobStatus(page, '1 object was not changed, so the type was kept.'), 'status `1 object was not changed, so the type was kept.`', 5000);
  const j = await eventually(() => core.jobs(), (x) => x.some((r) => r.kind === 'type-delete'), 3000);
  assert.equal(j.find((r) => r.kind === 'type-delete')?.keptType, true, 'the report says keptType (ms4-jobs §14.9.6)');
  const files = await core.files();
  assert.equal(files[D.retro], original(D.retro), 'Retro stays');
  assert.equal(files[TRASHED[D.porada]], original(D.porada), 'Porada is trashed');
  assert.equal(files[TRASHED[D.schJinde]], original(D.schJinde), 'Schůzka jinde is trashed');
  assert.equal(files[D.schuzkaYml], original(D.schuzkaYml), 'the definition is kept');
  assert.equal(files[D.tSchuzka], original(D.tSchuzka), 'the template is kept');
  await (await must(st.getByRole('button', { name: 'Show', exact: true }), 'Show')).click();
  const list = await must(notUpdatedList(page).or(page.getByRole('list', { name: 'Links not updated', exact: true })), 'the list of skipped files');
  assert.ok((await text(list)).includes('Retro'), 'Retro is listed');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-05 AC-10

/** The type-moves vault as FR-TYP-05 AC-7 leaves it (built directly, so this checks the restore only). With Schůzka's
 *  definition in the trash, ms6-trash-media §1.2 would show `.trash/Schůzky/` as one folder row (its folder is no live
 *  type's folder); this test expects a row `Porada` as the AC says (red-test point AP-800). */
function deletedVault(edit?: (f: Record<string, string>) => void): FakeVault {
  return movesVault((f) => {
    for (const [from, to] of Object.entries(TRASHED)) { f[to] = f[from]; delete f[from]; }
    edit?.(f);
  });
}

/** AC-10's second case: with a type of the key `schůzka` defined again, only the object is restored. Run first by the
 *  test below, so this already-working case never makes the file green on its own (check-red, CONTRACT §5.2). */
async function typeDefinedAgainOnlyTheObject(page: Page) {
  const fresh = original(D.schuzkaYml).replace('color: teal\n', 'color: gray\n');
  const core = await open(page, { vault: deletedVault((f) => { f[D.schuzkaYml] = fresh; }) });
  await gotoTrash(page);
  await (await must(restoreBtn(page, 'Porada'), 'Restore "Porada"')).click();
  assert.equal(await fileWhen(core, D.porada, (x) => x !== undefined), original(D.porada), 'Porada is restored');
  await sleep(300);
  const files = await core.files();
  assert.equal(files[D.schuzkaYml], fresh, 'the existing definition is untouched');
  assert.equal(files[TRASHED[D.schuzkaYml]], original(D.schuzkaYml), 'the trashed definition stays in the trash');
}

test('fr_typ_05_ac10_restoring_porada_brings_the_type_back_unless_the_type_exists_again', async ({ page }) => {
  await typeDefinedAgainOnlyTheObject(page);
  const core = await open(page, { vault: deletedVault() });
  await gotoTrash(page);
  await (await must(restoreBtn(page, 'Porada'), 'Restore "Porada"')).click();
  assert.equal(await fileWhen(core, D.porada, (x) => x !== undefined), original(D.porada), 'Schůzky/Porada.md is restored');
  assert.equal(await fileWhen(core, D.schuzkaYml, (x) => x !== undefined), original(D.schuzkaYml), '.tegg/types/schůzka.yml is restored with it (AP-770)');
  const files = await core.files();
  assert.equal(files[TRASHED[D.schuzkaYml]], undefined, 'the type file left the trash');
  assert.equal(files[TRASHED[D.tSchuzka]], original(D.tSchuzka), 'the template stays in the trash');
  assert.equal(files[D.tSchuzka], undefined, 'and is not restored');
  assert.ok(await seen(typesList(page).getByRole('listitem').filter({ hasText: 'Schůzky' }), 3000), 'Schůzky is a type again');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-03 AC-14

async function typeMenu(page: Page, name: string): Promise<string[]> {
  const g = await expand(page, name);
  await (await must(g.getByRole('combobox', { name: 'Type', exact: true }), `${name}: combobox Type`)).click();
  const list = await must(page.getByRole('listbox'), `${name}: the Type menu`);
  const got = (await list.getByRole('option').allInnerTexts()).map(flat);
  await page.keyboard.press('Escape');
  return got;
}

test('fr_typ_03_ac14_hodnoceni_offers_text_long_text_and_number_and_text_writes_one_line', async ({ page }) => {
  const core = await open(page);
  await gotoSettings(page, 'Knihy', 'Kniha');
  const g = await expand(page, 'Hodnocení');
  await (await must(g.getByRole('combobox', { name: 'Type', exact: true }), 'combobox Type')).click();
  const list = await must(page.getByRole('listbox'), 'the Type menu');
  assert.deepEqual((await list.getByRole('option').allInnerTexts()).map(flat), ['Text', 'Long text', 'Number'], 'only wider types and the current one, in R10 order (board E1)');
  assert.ok(await seen(page.getByText('Only a more general type; values stay as written.', { exact: true })), 'the footer (R99 E)');
  await (await must(page.getByRole('option', { name: 'Text', exact: true }), 'option Text')).click();
  const want = original(M.knihaYml).replace('    name: Hodnocení\n    type: number\n', '    name: Hodnocení\n    type: text\n');
  assert.equal(await fileWhen(core, M.knihaYml, (x) => x === want), want, 'only the item\'s `type:` line of kniha.yml');
  assert.equal(await seen(page.locator('[role="dialog"], [role="alertdialog"]'), 300), false, 'no dialog');
  assert.deepEqual(await callsOf(core, 'type_misfits'), [], 'no type_misfits call (D-808)');
  assert.deepEqual((await core.writesTo()).map(nfc), [M.knihaYml], 'no note is written');
  assert.deepEqual(await core.backups(), [], 'no zip');
});

test('fr_typ_03_ac14_each_type_offers_board_e2s_targets', async ({ page }) => {
  await open(page);
  await gotoSettings(page, 'Knihy', 'Kniha');
  const got: Record<string, string[]> = {};
  for (const n of ['Autor', 'Vydáno', 'Stav', 'Související']) got[n] = await typeMenu(page, n);
  assert.deepEqual(got, {
    Autor: ['Text', 'Long text'],
    Vydáno: ['Text', 'Long text', 'Date', 'Date-time'],
    Stav: ['Text', 'Long text', 'Select', 'Multi-select'],
    Související: ['Text', 'Long text', 'Relation'],
  }, 'board E2 targets plus the current type, in R10 order');
});

// ------------------------------------------------------------------------------------------------ types.md FR-TYP-05 AC-4

test('fr_typ_05_ac4_a_type_with_objects_is_deleted_as_one_job_and_undone', async ({ page }) => {
  const vault = typesVault();
  const core = await openTypes(page, undefined, { vault });
  await gotoSettings(page, 'Schůzky', 'Schůzka');
  await (await must(section(page, 'Delete type').getByRole('button', { name: 'Delete Schůzka type…', exact: true }), 'Delete Schůzka type…')).click();
  const d = await must(typeDialog(page, 'Schůzka'), 'dialog');
  assert.ok((await text(d)).includes('3 schůzky go to the trash with the type'), 'the plural count (D-842)');
  await (await must(d.getByRole('button', { name: 'Delete type and trash 3 schůzky', exact: true }), 'Delete type and trash 3 schůzky')).click();
  const st = await must(jobStatus(page, 'Deleted Schůzka · 3 schůzky in the trash'), 'the status element', 5000);
  const files = await core.files();
  for (const p of ['Schůzky/2026-10-07 Porada.md', 'Schůzky/Prázdná schůzka.md', 'Pages/Schůzka ve stránkách.md', '.tegg/types/schůzka.yml']) {
    assert.equal(files[`.trash/${p}`], vault.files[p], `${p} → .trash/${p} (relative path kept)`);
    assert.equal(files[p], undefined, `${p} left its path`);
  }
  assert.deepEqual((await core.backups()).map((b) => b.kind), ['type-delete'], 'the backup zip first (D-57)');
  await (await must(st.getByRole('button', { name: 'Undo', exact: true }), 'Undo')).click();
  assert.deepEqual(await eventually(() => unchanged(core, vault), (x) => x.length === 0, 3000), [], 'Undo restores the files and the definition');
});

// ------------------------------------------------------------------------------------------------ FR-HIS-04 AC-11

test('fr_his_04_ac11_a_failed_zip_ends_the_value_remove_with_nothing_written', async ({ page }) => {
  const vault = movesVault();
  const core = await open(page, { vault });
  await core.failBackups(true);
  await confirmProperty(page);
  const j = await eventually(() => core.jobs(), (x) => x.some((r) => r.kind === 'value-remove'), 5000);
  assert.equal(j.find((r) => r.kind === 'value-remove')?.phase, 'failed', 'the job ends failed (BackupFailed)');
  assert.deepEqual(await unchanged(core, vault), [], 'the vault is unchanged (data-safety AC-1)');
  assert.deepEqual(await core.backups(), [], 'no zip listed');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-18

test('fr_ux_03_ac18_the_delete_property_dialog_by_keyboard', async ({ page }) => {
  const core = await open(page);
  await gotoSettings(page, 'Knihy', 'Kniha');
  const g = await expand(page, 'Poznámka');
  const opener = await must(g.getByRole('button', { name: 'Delete property…', exact: true }), 'Delete property…');
  await opener.focus();
  await page.keyboard.press('Enter');
  const d = await must(propDialog(page, 'Poznámka'), 'the dialog by ⏎');
  assert.equal((await focused(page)).label, 'Cancel', 'the focus starts on Cancel');
  assert.ok(await reachable(page, d.getByRole('button', { name: 'Delete from 1 note', exact: true }), 6), '`Delete from 1 note` is reachable by Tab');
  await page.keyboard.press('Escape');
  assert.equal(await seen(propDialog(page, 'Poznámka'), 300), false, 'Esc closes the dialog');
  assert.equal(await opener.evaluate((e) => e === document.activeElement), true, 'the focus is back on `Delete property…`');
  assert.deepEqual(await callsOf(core, 'job_confirm'), [], 'Esc confirms nothing');
  await page.keyboard.press('Enter');
  const d2 = await must(propDialog(page, 'Poznámka'), 'the dialog again');
  assert.ok(await reachable(page, d2.getByRole('button', { name: 'Delete from 1 note', exact: true }), 6), 'Tab to `Delete from 1 note`');
  await page.keyboard.press('Enter');
  const st = await must(jobStatus(page, 'Deleted Poznámka · removed values from 1 note'), '⏎ runs the job', 5000);
  assert.ok(await reachable(page, st.getByRole('button', { name: 'Undo', exact: true })), 'the status `Undo` is reachable by Tab');
});

test('fr_ux_03_ac18_the_delete_type_dialog_and_the_route_by_keyboard', async ({ page }) => {
  const core = await open(page);
  await gotoSettings(page, 'Schůzky', 'Schůzka');
  const opener = await must(section(page, 'Delete type').getByRole('button', { name: 'Delete Schůzka type…', exact: true }), 'Delete Schůzka type…');
  await opener.focus();
  await page.keyboard.press('Enter');
  const d = await must(typeDialog(page, 'Schůzka'), 'the dialog by ⏎');
  assert.equal((await focused(page)).label, 'Cancel', 'the focus starts on Cancel');
  await page.keyboard.press('Escape');
  assert.equal(await seen(d, 300), false, 'Esc closes it');
  assert.equal(await opener.evaluate((e) => e === document.activeElement), true, 'the focus is back on `Delete Schůzka type…`');
  await page.keyboard.press('Enter');
  const d2 = await must(typeDialog(page, 'Schůzka'), 'again');
  assert.ok(await reachable(page, d2.getByRole('button', { name: 'Delete type and trash 3 schůzky', exact: true }), 6), 'Tab to the confirm button');
  await page.keyboard.press('Enter');
  await must(jobStatus(page, 'Deleted Schůzka · 3 schůzky in the trash'), '⏎ runs the job', 5000);
  for (const n of ['Undo', 'Open Trash']) assert.ok(await reachable(page, main(page).getByRole('button', { name: n, exact: true })), `the route's ${n} is reachable by Tab`);
  assert.ok((await callsOf(core, 'job_confirm')).length === 1, 'one job_confirm');
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-10

/** Type settings under the pseudo-locale (every catalog text wrapped in ⟦ ⟧; type names are data). */
async function gotoSettingsPseudo(page: Page, plural: string, name: string) {
  await runCommand(page, `Go to type: ${plural}`);
  await mustBeOn(page, plural, `type page ${plural}`, 5000);
  await (await must(main(page).getByRole('button', { name: /^⟦Type settings⟧$/ }), 'button "⟦Type settings⟧"')).click();
  await must(page.getByRole('heading', { level: 1, name: `⟦${name} type settings⟧`, exact: true }), `heading "⟦${name} type settings⟧"`, 5000);
}

test('nfr_oth_02_ac10_pseudo_locale_wraps_the_delete_property_dialog', async ({ page }) => {
  await open(page, { prelude: pseudoLocale });
  await gotoSettingsPseudo(page, 'Knihy', 'Kniha');
  // Under the pseudo-locale the Properties section is named `⟦Properties⟧` (`property()` looks for `Properties`).
  const g = await must(main(page).getByRole('region', { name: '⟦Properties⟧', exact: true }).getByRole('group', { name: 'Poznámka', exact: true }), 'property group Poznámka');
  const edit = g.getByRole('button', { name: '⟦Edit Poznámka⟧', exact: true });
  if (await seen(edit, 500)) await edit.click();
  await (await must(g.getByRole('button', { name: '⟦Delete property…⟧', exact: true }), '⟦Delete property…⟧')).click();
  const d = await must(page.getByRole('dialog', { name: '⟦Delete property "Poznámka"?⟧', exact: true }).or(page.getByRole('alertdialog', { name: '⟦Delete property "Poznámka"?⟧', exact: true })), 'dialog name wrapped');
  await must(d.getByRole('button', { name: '⟦Delete from 1 note⟧', exact: true }), 'the counted button wrapped');
  assert.deepEqual((await loose(d)).filter((t) => !['Poznámka', 'poznámka', 'kniha', 'Kniha', '1'].includes(t)), [], 'only names, keys and counts outside ⟦ ⟧');
});

test('nfr_oth_02_ac10_pseudo_locale_wraps_the_delete_type_dialog_and_statuses', async ({ page }) => {
  await open(page, { prelude: pseudoLocale });
  await gotoSettingsPseudo(page, 'Schůzky', 'Schůzka');
  const sec = await must(main(page).getByRole('region', { name: '⟦Delete type⟧', exact: true }), 'section wrapped');
  assert.deepEqual((await loose(sec)).filter((t) => !['Schůzka', 'schůzky', '3'].includes(t)), [], 'F3 text wrapped');
  await (await must(sec.getByRole('button', { name: '⟦Delete Schůzka type…⟧', exact: true }), '⟦Delete Schůzka type…⟧')).click();
  const d = await must(page.getByRole('dialog', { name: '⟦Delete type "Schůzka"?⟧', exact: true }).or(page.getByRole('alertdialog', { name: '⟦Delete type "Schůzka"?⟧', exact: true })), 'dialog name wrapped');
  assert.deepEqual((await loose(d)).filter((t) => !['Schůzka', 'schůzky', '3'].includes(t)), [], 'only type names and counts outside ⟦ ⟧');
  await (await must(d.getByRole('button', { name: '⟦Delete type and trash 3 schůzky⟧', exact: true }), 'the confirm button wrapped')).click();
  const st = await must(page.getByRole('status').filter({ hasText: '⟦Deleted Schůzka · 3 schůzky in the trash⟧' }), 'the done status wrapped', 5000);
  await must(st.getByRole('button', { name: '⟦Undo⟧', exact: true }), '⟦Undo⟧');
  await must(main(page).getByText('⟦This type no longer exists.⟧', { exact: true }), 'the route text wrapped');
  await must(main(page).getByText('⟦Schůzka was deleted. Its 3 objects are in the trash.⟧', { exact: true }), 'and its second line');
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-13

test('fr_ux_05_ac13_the_4e2_dialogs_and_statuses_in_light_and_dark', async ({ page }) => {
  await open(page);
  for (const [cmd, theme] of [['Theme: Light', 'light'], ['Theme: Dark', 'dark']] as const) {
    await runCommand(page, cmd);
    await deleteProperty(page, 'Poznámka');
    assert.deepEqual(await axeContrast(page), [], `color-contrast with Delete property open (${theme})`);
    assert.deepEqual(await colourLeaks(page, theme), [], `only theme tokens (FR-UX-05 AC-5, ${theme})`);
    await page.keyboard.press('Escape');
    await deleteType(page);
    assert.deepEqual(await axeContrast(page), [], `color-contrast with Delete type open (${theme})`);
    assert.deepEqual(await colourLeaks(page, theme), [], `only theme tokens (${theme})`);
    await page.keyboard.press('Escape');
  }
  await confirmType(page);
  await must(jobStatus(page, 'Deleted Schůzka · 3 schůzky in the trash'), 'the status strip', 5000);
  for (const [cmd, theme] of [['Theme: Light', 'light'], ['Theme: Dark', 'dark']] as const) {
    await runCommand(page, cmd);
    assert.deepEqual(await axeContrast(page), [], `color-contrast on the status strip and the deleted-type route (${theme})`);
    assert.deepEqual(await colourLeaks(page, theme), [], `only theme tokens (${theme})`);
  }
});
