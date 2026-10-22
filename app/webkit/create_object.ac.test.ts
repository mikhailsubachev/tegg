// MS3 slice 3D, L5 (WebKit + fake core): one creation path for every entry point (D-232, D-245). FR-TYP-03 AC-12 per
// entry point (⌘N New object, the switcher's create item, `[[` create, the type page's `New <Name>`, a relation's
// `Create`); FR-TYP-12 AC-3; FR-TYP-01 AC-5 (new objects follow the folder). Each entry point must call `type_get`,
// `type_template` and `note_create(type, title, text)` with the bytes of @tegg/doc `newObject` (ms3-shell §14.7.1).
// D-520 (ms5-tasks §12.2): ⌘N and `New <Name>` open an unsaved draft; the title is typed there and committed with ↩.
// Clock 2026-10-14T10:00:00+02:00 (Playwright clock, zone Europe/Prague). Written from the ACs and contract (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { createFromDraft, mainName, switcherDialog } from './helpers';
import {
  P, callsOf, eventually, gotoTypePage, main, must, openTypes, props, runCommand, sleep, typeFile, typesVault, swap, dialog,
} from './types-helpers';

const NOW = '2026-10-14T10:00:00+02:00';
test.use({ timezoneId: 'Europe/Prague' });

type Core = Awaited<ReturnType<typeof openTypes>>;
async function clock(page: Page) {
  // A fixed time: `created:` is exactly NOW however long the steps take; timers still run.
  await page.clock.setFixedTime(new Date(NOW));
}
async function created(core: Core): Promise<{ type: string; title: string; text: string; path: string }> {
  const c = await eventually(() => callsOf(core, 'note_create'), (x) => x.length > 0 && x[x.length - 1].ok !== undefined, 3000);
  assert.ok(c.length > 0, 'note_create was called');
  const last = c[c.length - 1];
  const a = last.args as any;
  assert.equal(typeof a.type, 'string', 'note_create(type, title, text) (§14.3)');
  return { type: a.type, title: a.title, text: a.text, path: String(last.result ?? '') };
}
const mask = (t: string) => t.replace(/^id: \S+$/m, 'id: <id>');
const head = (key: string, title: string) => `---\nid: <id>\ntype: ${key}\ntitle: ${title}\n`;
const tail = `created: ${NOW}\nmodified: ${NOW}\n---\n`;
async function onePathCalls(core: Core, key: string) {
  const names = (await core.calls()).map((c) => c.cmd);
  const iGet = names.lastIndexOf('type_get'), iTpl = names.lastIndexOf('type_template'), iCreate = names.lastIndexOf('note_create');
  assert.ok(iGet >= 0 && iTpl > iGet && iCreate > iTpl, `type_get → type_template → note_create (${names.slice(-8).join(', ')})`);
  const tpl = (await callsOf(core, 'type_template')).pop();
  assert.equal((tpl?.args as any)?.key, key, 'the template of that type');
}

test('fr_typ_03_ac12_type_page_new_napad_writes_template_values_review_and_body', async ({ page }) => {
  await clock(page);
  const core = await openTypes(page);
  await gotoTypePage(page, 'Nápady');
  await main(page).getByRole('button', { name: 'New Nápad', exact: true }).click();
  await createFromDraft(page, 'Nový nápad', 'draft');
  const c = await created(core);
  await onePathCalls(core, 'nápad');
  assert.equal(c.type, 'nápad');
  assert.equal(mask(c.text), `${head('nápad', 'Nový nápad')}hodnocení: 3\nzdroj-nápadu: kniha\nreview: unreviewed\n${tail}## Proč na tom záleží\n`);
  assert.equal(c.path, 'Nápady/Nový nápad.md');
});

test('fr_typ_03_ac12_type_page_new_projekt_and_schuzka', async ({ page }) => {
  await clock(page);
  const core = await openTypes(page);
  await gotoTypePage(page, 'Projekty');
  await main(page).getByRole('button', { name: 'New Projekt', exact: true }).click();
  await createFromDraft(page, 'Nový projekt', 'draft');
  assert.equal(mask((await created(core)).text), `${head('projekt', 'Nový projekt')}stav: Plánovaný\n${tail}`);
  await gotoTypePage(page, 'Schůzky');
  await main(page).getByRole('button', { name: 'New Schůzka', exact: true }).click();
  await createFromDraft(page, 'Plánování', 'draft');
  const s = await created(core);
  assert.equal(mask(s.text), `${head('schůzka', 'Plánování')}${tail}`, 'only identity keys, empty body, no review (FR-TYP-12 AC-3)');
});

test('fr_typ_03_ac12_cmd_n_creates_the_default_type_quick_note_unreviewed', async ({ page }) => {
  await clock(page);
  const core = await openTypes(page);
  await page.keyboard.press('Meta+n');
  await createFromDraft(page, 'Rychlý nápad', 'draft');
  const c = await created(core);
  await onePathCalls(core, 'quick-note');
  assert.equal(mask(c.text), `${head('quick-note', 'Rychlý nápad')}review: unreviewed\n${tail}`, 'locked → review: unreviewed');
  assert.equal(c.path, 'Quick Notes/Rychlý nápad.md');
});

test('fr_typ_03_ac12_switcher_create_item_uses_the_same_path', async ({ page }) => {
  await clock(page);
  const core = await openTypes(page);
  await page.keyboard.press('Meta+o');
  await must(switcherDialog(page), 'switcher');
  await page.getByRole('textbox', { name: 'Switcher query' }).or(page.getByRole('combobox', { name: 'Switcher query' })).first().fill('Úplně nový');
  await sleep(150);
  await switcherDialog(page).getByRole('option', { name: /^Create "[^"]*"$/ }).click(); // 5B: `Create "…" as…` follows the create row (FR-VLT-05 AC-3)
  const c = await created(core);
  await onePathCalls(core, 'quick-note');
  assert.equal(mask(c.text), `${head('quick-note', 'Úplně nový')}review: unreviewed\n${tail}`);
});

test('fr_typ_03_ac12_link_create_in_the_editor_uses_the_same_path', async ({ page }) => {
  await clock(page);
  const core = await openTypes(page, P.obycejna);
  await page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' [[Odkazovaná');
  const lb = await must(page.getByRole('listbox', { name: 'Link suggestions' }), 'Link suggestions');
  await lb.getByRole('option', { name: 'Create "Odkazovaná"', exact: true }).click();
  const c = await created(core);
  await onePathCalls(core, 'quick-note');
  assert.equal(mask(c.text), `${head('quick-note', 'Odkazovaná')}review: unreviewed\n${tail}`);
  assert.equal(await mainName(page), 'Obyčejná stránka', 'no navigation');
});

test('fr_typ_03_ac12_relation_create_uses_the_first_allowed_type', async ({ page }) => {
  await clock(page);
  const core = await openTypes(page, P.prazdna);
  await (await must(props(page).getByRole('button', { name: 'Add Projekt', exact: true }), 'Add Projekt')).click();
  const pick = await must(dialog(page, 'Choose Projekt'), 'picker');
  await pick.getByRole('combobox', { name: 'Search' }).fill('Nová stavba');
  await sleep(150);
  await pick.getByRole('option', { name: 'Create "Nová stavba"', exact: true }).click();
  const c = await created(core);
  await onePathCalls(core, 'projekt');
  assert.equal(mask(c.text), `${head('projekt', 'Nová stavba')}stav: Plánovaný\n${tail}`);
  assert.equal(c.path, 'Projekty/Nová stavba.md');
});

test('fr_typ_03_ac12_defaults_are_written_in_schema_order', async ({ page }) => {
  await clock(page);
  const vault = typesVault((f) => {
    f[typeFile('projekt')] = swap(f[typeFile('projekt')], '    name: Web\n    type: url\n', '    name: Web\n    type: url\n    default: https://example.com\n');
  });
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, 'Projekty');
  await main(page).getByRole('button', { name: 'New Projekt', exact: true }).click();
  await createFromDraft(page, 'Pořadí', 'draft');
  assert.equal(mask((await created(core)).text), `${head('projekt', 'Pořadí')}stav: Plánovaný\nweb: https://example.com\n${tail}`);
});

test('fr_typ_12_ac3_turning_review_on_applies_to_new_objects_only', async ({ page }) => {
  await clock(page);
  const vault = typesVault((f) => { f[typeFile('schůzka')] = swap(f[typeFile('schůzka')], 'review: false\n', 'review: true\n'); });
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, 'Schůzky');
  await main(page).getByRole('button', { name: 'New Schůzka', exact: true }).click();
  await createFromDraft(page, 'Se schválením', 'draft');
  assert.equal(mask((await created(core)).text), `${head('schůzka', 'Se schválením')}review: unreviewed\n${tail}`);
  assert.ok(!(await core.files())[P.porada].includes('review:'), 'Porada stays without it');
});

test('fr_typ_01_ac5_the_next_object_goes_to_the_new_folder', async ({ page }) => {
  await clock(page);
  const vault = typesVault((f) => { f[typeFile('schůzka')] = swap(f[typeFile('schůzka')], 'folder: Schůzky\n', 'folder: Práce/Porady\n'); });
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, 'Schůzky');
  await main(page).getByRole('button', { name: 'New Schůzka', exact: true }).click();
  await createFromDraft(page, 'Plánování', 'draft');
  const c = await created(core);
  assert.equal(c.path, 'Práce/Porady/Plánování.md', 'folders created then (data-safety FR-STO-01 AC-2)');
  await runCommand(page, 'Go to type: Schůzky');
});
