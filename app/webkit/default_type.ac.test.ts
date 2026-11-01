// MS5 slice 5B, L5 (WebKit + fake core): the vault's default type in every create path, docs/acceptance/capture.md
// FR-VLT-05 AC-1 (the Settings warning), AC-2 (preselected everywhere; `default-type: nápad` creates Nápady), AC-3 (the
// Create offer's `Type` combobox, `Create "<q>" as…` and ⌥⏎ in the switcher, `[[`, `Change type…` on a draft),
// AC-4 (changing a draft's type writes nothing), AC-5 (changes apply at once, also to the pre-warmed capture window),
// AC-6 (New Task ignores it), AC-7 (a deleted default type). Interface docs/contracts/ms5-capture.md §5.1, §6
// (`defaultTypeKey`, `create-as` rows, the shared `TypeMenu`), §11.2 (`vault_settings`, `vault_settings_patch`).
// The inbox fixture plus a runtime note with a broken link (`Pages/Rozbitá.md`). Written from the ACs and the contract
// only (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  callsOf, click, eventually, fileText, flat, inboxVault, main, must, runCommand, seen, sleep, startCapture, startMain, swap, typeBtn,
  vaultWrites, type FakeCoreHandle,
} from './capture-helpers';
import { mustBeDraft, searchQueryField, settledFirstResult } from './helpers';
import { editorBody, linkSuggestions } from './editor-helpers';
import { createOffer } from './links-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const ROZBITA = 'Pages/Rozbitá.md';
const rozbita = '---\nid: 01JB5B0000000000000000R301\ntype: page\ntitle: Rozbitá\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\nViz [[Neexistuje]].\n';
function vault(defaultType?: string, edit?: (f: Record<string, string>) => void) {
  return inboxVault((f) => {
    f[ROZBITA] = rozbita;
    if (defaultType) f['.tegg/vault.yml'] = swap(f['.tegg/vault.yml'], 'default-type: Quick Note', `default-type: ${defaultType}`);
    edit?.(f);
  });
}
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
async function newDraft(page: Page) {
  await page.keyboard.press('Meta+n');
  await mustBeDraft(page, '⌘N', 5000);
}
async function creates(core: FakeCoreHandle) {
  return (await callsOf(core, 'note_create')).map((c) => c.args as { type?: string; title: string; text: string });
}
/** The Search page's create buttons for `q`, in order (D-1343, D-1345; before them the `Go to` list's create rows,
 *  D-760, and the ⌘O switcher's). */
async function switcherRows(page: Page, q: string): Promise<string[]> {
  await page.keyboard.press('Meta+Shift+f');
  await (await must(searchQueryField(page), 'Search query', 5000)).fill(q);
  await settledFirstResult(page, q);
  await must(createButton(page, q), `button Create “${q}”`, 3000);
  return (await page.getByRole('main').getByRole('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '')))).map(flat)
    .filter((t) => /^Create “/.test(t) || t === 'as…');
}
const createButton = (page: Page, q: string) => page.getByRole('main').getByRole('button', { name: `Create “${q}”`, exact: true });
const createAsButton = (page: Page) => page.getByRole('main').getByRole('button', { name: 'as…', exact: true });
async function chooseOption(page: Page, combo: string, option: string) {
  const c = await must(page.getByRole('combobox', { name: combo, exact: true }), `combobox ${combo}`);
  if (await c.evaluate((e) => e.tagName === 'SELECT')) await c.selectOption({ label: option });
  else {
    await c.click();
    await click(page.getByRole('option', { name: option, exact: true }), `option ${option}`);
  }
}
async function openOffer(page: Page) {
  const chip = await must(editorBody(page).locator('[data-link-kind="unresolved"]').filter({ hasText: 'Neexistuje' }), 'the unresolved chip Neexistuje', 5000);
  await chip.click();
  return must(createOffer(page), 'dialog "Create note"');
}

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_vlt_05_ac1_an_unusable_value_shows_the_warning', async ({ page }) => {
  for (const [line, value] of [['Neexistuje', 'Neexistuje'], ['""', '']] as const) {
    const p = await page.context().newPage();
    const core = await startMain(p, { vault: vault(line) });
    await runCommand(p, 'Go to Settings: Vault');
    assert.ok(await seen(p.getByText(`The default type "${value}" doesn't exist. Using Quick Note.`, { exact: true }), 3000), `${line}: the warning`);
    const combo = await must(p.getByRole('combobox', { name: 'Default type for new notes', exact: true }), 'combobox Default type for new notes');
    assert.match(flat(await combo.evaluate((e) => (e as HTMLSelectElement).selectedOptions?.[0]?.text ?? e.textContent ?? '')), /Quick Note/, 'shows Quick Note');
    assert.deepEqual(await vaultWrites(core), [], 'reading writes nothing');
  }
});

// ------------------------------------------------------------------------------------------------ AC-2

test('fr_vlt_05_ac2_quick_note_is_preselected_everywhere', async ({ page }) => {
  const core = await startMain(page, { vault: vault(), at: ROZBITA });
  await newDraft(page);
  assert.ok(await seen(tab(page, 'New Quick Note'), 2000), '⌘N opens new/quick-note (D-520)');
  await page.keyboard.press('Meta+BracketLeft'); // Back to Rozbitá (Esc doesn't leave a draft)
  const offer = await openOffer(page);
  assert.ok(await seen(offer.getByText('Type: Quick Note', { exact: true }).or(offer.getByRole('combobox', { name: 'Type', exact: true }).filter({ hasText: 'Quick Note' })), 1000), 'the Create offer: Type Quick Note');
  await page.keyboard.press('Escape');
  const rows = await switcherRows(page, 'Výlet do Tater');
  assert.ok(rows.some((r) => r === 'Create “Výlet do Tater”'), `the Search page's create button (D-1343): ${rows.join(' | ')}`);
  await page.keyboard.press('Escape');
  // The capture window opened from the palette starts with the default type (capture.md FR-CAP-05 AC-1 for the hotkey).
  await runCommand(page, 'Quick Capture');
  assert.deepEqual((await core.captureLog()).opens, ['default'], 'palette Quick Capture opens the capture window with the default type');
});

test('fr_vlt_05_ac2_with_default_napad_every_path_creates_a_napad', async ({ page }) => {
  const core = await startMain(page, { vault: vault('nápad'), at: ROZBITA });
  // The Search page's create button (D-1343; before it the switcher's create row).
  await switcherRows(page, 'Nový nápad');
  await click(createButton(page, 'Nový nápad'), 'Create “Nový nápad”');
  const c = await eventually(() => creates(core), (x) => x.length === 1, 3000);
  assert.equal(c[0]?.type, 'nápad', 'note_create with the type nápad');
  const t = c[0]?.text ?? '';
  for (const line of ['type: nápad', 'hodnocení: 3', 'oblast: osobní', 'review: unreviewed']) assert.ok(t.includes(`\n${line}\n`), `${line} (FR-TYP-12, D-232)`);
  assert.ok((await core.writesTo()).includes('Nápady/Nový nápad.md'), 'written in Nápady/');
  // `[[` in the editor.
  await page.keyboard.press('Meta+BracketLeft'); // the app's Back (⌘[), not the browser's: to Search (D-1217)
  await page.keyboard.press('Meta+BracketLeft'); // and on to the note Search was opened from
  await (await must(editorBody(page), 'Note body', 5000)).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' [[Druhý nápad');
  await click(linkSuggestions(page).getByRole('option', { name: 'Create "Druhý nápad"', exact: true }), 'Create "Druhý nápad"');
  const c2 = await eventually(() => creates(core), (x) => x.length === 2, 3000);
  assert.equal(c2[1]?.type, 'nápad', '[[ creates a nápad too');
});

// ------------------------------------------------------------------------------------------------ AC-3

test('fr_vlt_05_ac3_the_create_offer_type_combobox', async ({ page }) => {
  const core = await startMain(page, { vault: vault(), at: ROZBITA });
  const offer = await openOffer(page);
  const combo = await must(offer.getByRole('combobox', { name: 'Type', exact: true }), 'combobox Type (enabled, no Coming in MS5)');
  assert.equal(await combo.evaluate((e) => e.getAttribute('aria-disabled') === 'true' || (e as HTMLSelectElement).disabled), false, 'enabled');
  if (await combo.evaluate((e) => e.tagName === 'SELECT')) await combo.selectOption({ label: 'Schůzka' });
  else { await combo.click(); await click(page.getByRole('option', { name: 'Schůzka', exact: true }), 'option Schůzka'); }
  await click(offer.getByRole('button', { name: 'Create "Neexistuje"', exact: true }), 'Create "Neexistuje"');
  const t = await eventually(() => fileText(core, 'Schůzky/Neexistuje.md'), (x) => x !== undefined, 3000);
  assert.ok(t?.includes('\ntype: schůzka\n'), 'Schůzky/Neexistuje.md with type: schůzka');
});

test('fr_vlt_05_ac3_create_as_in_the_switcher', async ({ page }) => {
  const core = await startMain(page, { vault: vault() });
  const rows = await switcherRows(page, 'Výlet');
  const at = rows.findIndex((r) => r === 'Create “Výlet”');
  assert.ok(at >= 0 && rows[at + 1] === 'as…', `as… after Create “Výlet” (D-1343): ${rows.join(' | ')}`);
  await click(createAsButton(page), 'as…');
  const menu = await must(page.getByRole('menu', { name: 'Type', exact: true }), 'menu Type (the shared TypeMenu)');
  await click(menu.getByRole('menuitemradio', { name: 'Page', exact: true }), 'Page');
  const t = await eventually(() => fileText(core, 'Pages/Výlet.md'), (x) => x !== undefined, 3000);
  assert.ok(t?.includes('\ntype: page\n'), 'Pages/Výlet.md');
  // From the keyboard, ⏎ on `as…` opens the same menu (D-1343: ⌥⏎ in the field now creates with the default type,
  // FR-NAV-01 AC-22; before it ⌥⏎ on the create row opened this menu).
  await switcherRows(page, 'Další');
  await (await must(createAsButton(page), 'as…')).focus();
  await page.keyboard.press('Enter');
  await must(page.getByRole('menu', { name: 'Type', exact: true }), '⏎ on as… opens the Type menu');
});

test('fr_vlt_05_ac3_create_as_in_link_autocomplete', async ({ page }) => {
  const core = await startMain(page, { vault: vault(), at: ROZBITA });
  await (await must(editorBody(page), 'Note body', 5000)).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' [[Stránka nová');
  await click(linkSuggestions(page).getByRole('option', { name: 'Create "Stránka nová" as…', exact: true }), 'Create "Stránka nová" as…');
  await click(page.getByRole('menu', { name: 'Type', exact: true }).getByRole('menuitemradio', { name: 'Page', exact: true }), 'Page');
  const t = await eventually(() => fileText(core, 'Pages/Stránka nová.md'), (x) => x !== undefined, 3000);
  assert.ok(t?.includes('\ntype: page\n'), 'created as a Page');
  const host = await eventually(() => fileText(core, ROZBITA), (x) => !!x?.includes('[[Stránka nová]]'), 3000);
  assert.ok(host?.includes('[[Stránka nová]]'), 'the link is inserted (D-184)');
});

// ------------------------------------------------------------------------------------------------ AC-4

test('fr_vlt_05_ac4_changing_a_drafts_type_writes_nothing', async ({ page }) => {
  const core = await startMain(page, { vault: vault() });
  await newDraft(page);
  await page.keyboard.insertText('Plán výletu');
  await runCommand(page, 'Change type…');
  await click(page.getByRole('menu', { name: 'Type' }).getByRole('menuitemradio', { name: 'Nápad', exact: true }).or(page.getByRole('menuitem', { name: 'Nápad', exact: true })), 'Nápad');
  assert.ok(await seen(tab(page, 'New Nápad'), 2000), 'the tab New Nápad (new/nápad)');
  const title = await must(page.getByRole('textbox', { name: 'Title', exact: true }), 'Title');
  assert.equal(await title.evaluate((e) => ((e as HTMLInputElement).value ?? e.textContent ?? '').normalize('NFC')), 'Plán výletu', 'the title is kept');
  assert.ok(await seen(main(page).getByText('Hodnocení', { exact: true }), 1000), 'the panel shows Hodnocení');
  assert.deepEqual(await vaultWrites(core), [], 'nothing written');
  await (await must(page.getByRole('textbox', { name: 'Title', exact: true }), 'Title')).press('Enter');
  const t = await eventually(() => fileText(core, 'Nápady/Plán výletu.md'), (x) => x !== undefined, 3000);
  assert.ok(t?.includes('\nhodnocení: 3\n'), 'the first write creates Nápady/Plán výletu.md');
});

// ------------------------------------------------------------------------------------------------ AC-5

test('fr_vlt_05_ac5_a_new_default_applies_at_once', async ({ browser }) => {
  const ctx = await browser.newContext({ timezoneId: 'Europe/Prague' });
  const mainPage = await ctx.newPage();
  const capPage = await ctx.newPage();
  const v = vault();
  const core = await startMain(mainPage, { vault: v });
  await startCapture(capPage, { vault: v });
  await runCommand(mainPage, 'Go to Settings: Vault');
  await chooseOption(mainPage, 'Default type for new notes', 'Nápad');
  assert.ok((await callsOf(core, 'vault_settings_patch')).length >= 1, 'vault_settings_patch');
  await newDraft(mainPage);
  assert.ok(await seen(tab(mainPage, 'New Nápad'), 2000), 'the next ⌘N opens new/nápad');
  const shown = await eventually(async () => flat(await typeBtn(capPage).getAttribute('aria-label').catch(() => '')), (x) => x === 'Type: Nápad', 2000);
  assert.equal(shown, 'Type: Nápad', 'the pre-warmed capture window updates within 2 s');
  // Another program edits default-type.
  const yml = (await core.files())['.tegg/vault.yml'];
  await core.setFile('.tegg/vault.yml', yml.replace(/^default-type: .*$/m, 'default-type: page'));
  await mainPage.keyboard.press('Escape');
  await sleep(300);
  await newDraft(mainPage);
  assert.ok(await seen(tab(mainPage, 'New Page'), 2000), 'an external edit applies too');
  await ctx.close();
});

// ------------------------------------------------------------------------------------------------ AC-6

test('fr_vlt_05_ac6_new_task_and_capture_a_task_ignore_the_default', async ({ page }) => {
  const core = await startMain(page, { vault: vault('nápad') });
  await runCommand(page, 'Capture a task');
  assert.deepEqual((await core.captureLog()).opens, ['task'], 'Capture a task opens the capture window as New Task');
  await runCommand(page, 'Quick Capture');
  assert.deepEqual((await core.captureLog()).opens, ['task', 'default'], 'Quick Capture opens it with the default type');
  await runCommand(page, 'New Task');
  await must(main(page).getByRole('textbox', { name: 'Add a task…', exact: true }), 'New Task focuses the quick-add row (FR-TSK-04 AC-17)');
});

// ------------------------------------------------------------------------------------------------ AC-7

test('fr_vlt_05_ac7_a_deleted_default_type_gives_quick_note', async ({ page }) => {
  const core = await startMain(page, { vault: vault('nápad') });
  await core.setFile('.tegg/types/nápad.yml', null);
  await sleep(300);
  await newDraft(page);
  assert.ok(await seen(tab(page, 'New Quick Note'), 2000), '⌘N uses Quick Note');
  await page.keyboard.press('Escape');
  await runCommand(page, 'Go to Settings: Vault');
  assert.ok(await seen(page.getByText('The default type "nápad" doesn\'t exist. Using Quick Note.', { exact: true }), 3000), 'the warning');
  assert.deepEqual((await callsOf(core, 'vault_settings_patch')).length, 0, 'vault.yml is not rewritten');
});
