// MS3 slice 3A, L5 (WebKit + fake core): FR-VLT-01 AC-9, -10, -12, -14, -15 (chooser), FR-VLT-03 AC-4 (banner),
// FR-UX-07 AC-7 (progress), FR-NAV-01 AC-12, AC-13 (switcher field, New object), FR-SYN-06 AC-5 (zero writes, L5 part).
// Written from docs/acceptance/app-shell.md and docs/contracts/ms3-shell.md only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { R1, TYPES_CS } from '../test/shell-tables';
import { loadFixtureVault, newEmptyVault } from '../ui/test/fake-core';
import {
  P, absent, eventually, focused, isDraft, mainName, must, mustBeDraft, mustBeOn, newObjectDialog, nonReadCalls, onPage, openNote,
  paletteDialog, runCommand, seen, shellVault, sidebar, sleep, start, switcherDialog, titleState, typeEntries, typesList,
} from './helpers';

const chooser = (page: Page) => page.getByRole('main', { name: 'Choose a vault' });
const form = (page: Page) => page.getByRole('form', { name: 'New vault' });
const createBtn = (page: Page) => form(page).getByRole('button', { name: 'Create' });
const isDisabled = (page: Page, name: string) =>
  form(page).getByRole('button', { name }).evaluate((b) => (b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true');
const PARENT = '/Users/test/Trezory';

async function fillForm(page: Page, name: string) {
  await form(page).getByRole('textbox', { name: 'Vault name' }).fill(name);
  await form(page).getByRole('button', { name: 'Choose…' }).click();
}

test('fr_vlt_01_ac9_chooser_alone_with_focus_on_create', async ({ page }) => {
  await start(page, { vault: null });
  await must(chooser(page).getByRole('button', { name: 'Create new vault' }), 'Create new vault');
  await must(chooser(page).getByRole('button', { name: 'Open existing folder' }), 'Open existing folder');
  assert.equal(await page.getByRole('navigation', { name: 'Sidebar' }).count(), 0, 'no sidebar');
  const f = await eventually(() => focused(page), (x) => x.label === 'Create new vault');
  assert.equal(f.label, 'Create new vault', 'focus on the first button');
  await page.keyboard.press('Enter');
  assert.ok(await seen(form(page)), '⏎ opens the New vault form');
});

test('fr_vlt_01_ac10_new_vault_form_and_create', async ({ page }) => {
  const core = await start(page, { vault: null, pickDir: PARENT });
  await (await must(chooser(page).getByRole('button', { name: 'Create new vault' }), 'Create new vault')).click();
  await must(form(page), 'New vault form');
  await must(form(page).getByRole('textbox', { name: 'Vault name' }), 'Vault name');
  assert.ok(await seen(form(page).getByText('Location', { exact: false })), 'Location row');
  assert.equal(await form(page).getByRole('radio', { name: 'Empty vault' }).isChecked(), true, 'Empty vault selected');
  assert.notEqual(await form(page).getByRole('radio', { name: 'Starter vault' }).getAttribute('aria-disabled'), 'true', 'Starter vault enabled (types.md R3 changes, FR-VLT-02 AC-6)');
  assert.equal(await isDisabled(page, 'Create'), true, 'Create disabled at start');
  await form(page).getByRole('textbox', { name: 'Vault name' }).fill('   ');
  assert.equal(await isDisabled(page, 'Create'), true, 'Create disabled with a whitespace name');
  await form(page).getByRole('textbox', { name: 'Vault name' }).fill('Můj trezor');
  assert.equal(await isDisabled(page, 'Create'), true, 'Create disabled without a location');
  await form(page).getByRole('button', { name: 'Choose…' }).click();
  assert.ok((await core.calls()).some((c) => c.cmd === 'vault_pick_dir'), 'Choose… opens the folder dialog');
  assert.ok(await seen(form(page).getByText(PARENT)), 'the chosen parent is shown');
  assert.equal(await isDisabled(page, 'Create'), false, 'Create enabled');
  await createBtn(page).click();
  const creates = (await core.calls()).filter((c) => c.cmd === 'vault_create');
  assert.deepEqual(creates.map((c) => c.args), [{ parent: PARENT, name: 'Můj trezor', kind: 'empty' }], 'one create command, kind empty');
  await mustBeOn(page, 'Inbox', 'new vault lands on the Inbox (D-610, was the home placeholder)');
  // D-516 (amends D-121, FR-UX-02 AC-4): Task is no longer in the Types list.
  const want = TYPES_CS.filter(([l]) => ['Pages', 'Quick Notes', 'Daily Notes', 'Images', 'PDFs'].includes(l)).map(([l]) => [l, 0]);
  assert.deepEqual(await eventually(() => typeEntries(page), (v) => v.length === 5), want, 'Types list of a new vault');
});

test('fr_vlt_01_ac12_create_errors_stay_in_the_form', async ({ browser }) => {
  // Target folder exists and isn't empty.
  let page = await browser.newPage();
  let core = await start(page, { vault: null, pickDir: PARENT, nonEmpty: [`${PARENT}/Můj trezor`] });
  await chooser(page).getByRole('button', { name: 'Create new vault' }).click();
  await must(form(page), 'New vault form');
  await fillForm(page, 'Můj trezor');
  await createBtn(page).click();
  await must(form(page).getByRole('button', { name: 'Open it instead' }), 'Open it instead action');
  assert.match(await form(page).innerText(), /Můj trezor/, 'the message names the folder');
  assert.equal(await page.getByRole('navigation', { name: 'Sidebar' }).count(), 0, 'nothing else happens');
  assert.equal((await core.calls()).filter((c) => c.cmd === 'vault_create').length, 1);
  await page.close();
  // Any other core error: its catalog message, never the core's message text; input kept.
  page = await browser.newPage();
  core = await start(page, { vault: null, pickDir: PARENT, createError: { kind: 'Io', message: 'RAW-CORE-DETAIL permission denied' } });
  await chooser(page).getByRole('button', { name: 'Create new vault' }).click();
  await must(form(page), 'New vault form');
  const before = await form(page).innerText();
  await fillForm(page, 'Můj trezor');
  await createBtn(page).click();
  await sleep(300);
  const after = await form(page).innerText();
  assert.ok(!(await page.locator('body').innerText()).includes('RAW-CORE-DETAIL'), 'the core message is never shown');
  assert.notEqual(after.replace(PARENT, ''), before, 'an error message is shown');
  assert.equal(await form(page).getByRole('textbox', { name: 'Vault name' }).inputValue(), 'Můj trezor', 'the form keeps its input');
  await page.close();
});

test('fr_vlt_01_ac14_open_existing_folder', async ({ browser }) => {
  let page = await browser.newPage();
  const other = { ...loadFixtureVault('tests/fixtures/vaults/new-empty/.tegg'), name: 'Jiný trezor' };
  let core = await start(page, { vault: null, pickDir: '/Users/test/Jiný trezor', dirs: { '/Users/test/Jiný trezor': other } });
  await chooser(page).getByRole('button', { name: 'Open existing folder' }).click();
  await mustBeOn(page, 'Inbox', 'a Tegg vault opens with the launch landing');
  assert.ok(await seen(sidebar(page)), 'frame shown');
  await page.close();
  page = await browser.newPage();
  core = await start(page, { vault: null, pickDir: '/Users/test/Poznámky', dirs: { '/Users/test/Poznámky': null } });
  await chooser(page).getByRole('button', { name: 'Open existing folder' }).click();
  await must(page.getByText("Import isn't available yet"), '"Import isn\'t available yet"');
  assert.ok(await seen(chooser(page)), 'stays in the chooser');
  assert.equal(await core.writes(), 0);
  await page.close();
});

test('fr_vlt_01_ac15_changing_vault_from_the_frame', async ({ page }) => {
  const other = newEmptyVault('Knihovna');
  other.files['.tegg/types/kniha.yml'] = 'version: 1\nname: Kniha\nplural: Knihy\nsystem: false\nfolder: Knihy\nicon: book\ncolor: purple\nreview: false\npreview: []\nattributes: []\n';
  const core = await start(page, { pickDir: '/Users/test/Knihovna', dirs: { '/Users/test/Knihovna': other } });
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'Go to Inbox');
  for (const [cmd, leave] of [['Open vault…', 'Escape'], ['Create new vault…', 'Escape'], ['Create new vault…', 'Cancel']] as const) {
    await runCommand(page, cmd);
    assert.ok((await seen(chooser(page), 1500)) || (await seen(form(page), 300)), `${cmd} shows the chooser`);
    if (leave === 'Cancel') await form(page).getByRole('button', { name: 'Cancel' }).click();
    else await page.keyboard.press('Escape');
    await mustBeOn(page, 'Inbox', `${cmd} then ${leave} returns to the previous route`);
  }
  await runCommand(page, 'Open vault…');
  await chooser(page).getByRole('button', { name: 'Open existing folder' }).click();
  await mustBeOn(page, 'Inbox', 'the other vault lands per FR-UX-02 AC-16');
  const labels = (await eventually(() => typeEntries(page), (v) => v.some(([l]) => l === 'Knihy'))).map(([l]) => l);
  assert.ok(labels.includes('Knihy') && !labels.includes('Schůzky'), `Types list replaced: ${labels.join(', ')}`);
  assert.equal(await core.writes(), 0);
});

test('fr_vlt_03_ac4_placeholder_banner_non_modal', async ({ browser }) => {
  for (const [n, re] of [[3, /\b3 files\b/], [1, /\b1 file\b/]] as const) {
    const page = await browser.newPage();
    await start(page, { placeholders: n });
    const banner = page.getByText(re);
    await must(banner, `banner naming ${n} file(s)`);
    assert.match(await banner.first().evaluate((e) => (e.closest('[role="status"], [role="alert"], [role="region"], section, div') as HTMLElement).innerText), /offline|available/i, 'tells how to make the folder available offline');
    assert.equal(await page.locator('[role="dialog"], [aria-modal="true"]').count(), 0, 'non-modal');
    await page.keyboard.press('Meta+k');
    assert.ok(await seen(paletteDialog(page)), 'palette works with the banner');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+o');
    assert.ok(await seen(switcherDialog(page)), 'switcher works with the banner');
    await page.keyboard.press('Escape');
    for (const e of ['Inbox', 'Today', 'Tasks', 'Pinned', 'Saved queries']) { // 6A: no Home entry (D-609)
      await sidebar(page).getByText(e, { exact: true }).click();
      await mustBeOn(page, e === 'Today' ? new Date().toLocaleDateString('sv') : e, `sidebar ${e} with the banner`); // 4B: named by its date
    }
    await page.close();
  }
  const page = await browser.newPage();
  await start(page, { placeholders: 0 });
  assert.equal(await page.getByText(/\b\d+ files?\b/).count(), 0, 'no banner with 0');
  await page.close();
});

test('fr_ux_07_ac7_indexing_progress_without_modal', async ({ page }) => {
  const core = await start(page);
  await core.emit('index:progress', { done: 120, total: 500, state: 'running' });
  const status = page.getByRole('status', { name: 'Indexing progress' });
  await must(status, 'status "Indexing progress"');
  assert.match(await status.innerText(), /Indexing 120 of 500/);
  assert.equal(await page.locator('[role="dialog"], [aria-modal="true"]').count(), 0, 'no modal');
  await page.keyboard.press('Meta+k');
  assert.ok(await seen(paletteDialog(page)), 'palette works while indexing');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+o');
  assert.ok(await seen(switcherDialog(page)), 'switcher works while indexing');
  await page.keyboard.press('Escape');
  await sidebar(page).getByText('Inbox', { exact: true }).click();
  await mustBeOn(page, 'Inbox', 'sidebar works while indexing');
  await sidebar(page).getByRole('button', { name: 'New object' }).click();
  assert.ok(await isDraft(page), 'New object works while indexing (D-520: it opens an unsaved draft)');
  await sidebar(page).getByText('Inbox', { exact: true }).click();
  await core.emit('index:progress', { done: 500, total: 500, state: 'done' });
  assert.ok(await absent(status, 1000), 'indicator disappears within 1 s after done');
  await core.emit('index:progress', { done: 200, total: 500, state: 'cancelled' });
  await must(page.getByText('Indexing paused'), '"Indexing paused"');
});

test('fr_nav_01_ac12_sidebar_search_field_opens_the_switcher', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  const field = sidebar(page).getByRole('button', { name: 'Search or jump to…' });
  await (await must(field, 'Search or jump to…')).click();
  await must(switcherDialog(page), 'Quick switcher from click');
  assert.equal((await focused(page)).label, 'Switcher query', 'cursor in Switcher query');
  await page.keyboard.press('Escape');
  assert.ok(await absent(switcherDialog(page)), 'Esc closes');
  assert.equal((await focused(page)).label, 'Search or jump to…', 'focus returns to the field');
  await page.keyboard.press('Enter');
  await must(switcherDialog(page), 'Quick switcher from ⏎ on the field');
  await page.keyboard.press('Escape');
  for (const row of R1.filter((r) => r.goto)) {
    await runCommand(page, row.goto!);
    await page.keyboard.press('Meta+o');
    assert.ok(await seen(switcherDialog(page), 1500), `⌘O on ${row.id}`);
    await page.keyboard.press('Escape');
  }
  await openNote(page, '2026-10-07 Porada');
});

const mask = (s: string) => s.replace(/^(id|created|modified):.*$/gm, '$1: *');

// FR-NAV-01 AC-13 (changed by D-520…D-523): ⌘N and the sidebar's `New object` open the unsaved draft `new/quick-note`.
const QN_NEW = 'Quick Notes/Nový nápad.md';
/** Writes are checked twice: no `note_create`/`note_write` reached the fake vault, and no non-read command was sent. */
async function noWrites(core: Awaited<ReturnType<typeof start>>, how: string) {
  assert.deepEqual(await core.writesTo(), [], `${how}: no file written`);
  assert.deepEqual(await nonReadCalls(core), [], `${how}: no write command sent`);
}
async function caretInBody(page: Page): Promise<boolean> {
  return page.evaluate(() => !!document.activeElement?.closest('[aria-label="Note body"]'));
}

test('fr_nav_01_ac13_cmd_n_and_sidebar_open_an_unsaved_draft_and_leaving_it_writes_nothing', async ({ page }) => {
  const core = await start(page);
  for (const open of ['shortcut', 'button'] as const) {
    if (open === 'shortcut') await page.keyboard.press('Meta+n');
    else await sidebar(page).getByRole('button', { name: 'New object' }).click();
    await mustBeDraft(page, `${open}`);
    assert.ok(await absent(newObjectDialog(page), 300), `${open}: no New object dialog`);
    await sleep(500);
    await noWrites(core, `${open}: opening the draft`);
    // (c) Leaving the draft unchanged through the sidebar's Inbox writes nothing.
    await sidebar(page).getByText('Inbox', { exact: true }).click();
    await mustBeOn(page, 'Inbox', `${open}: (c) the sidebar's Inbox leaves the draft`);
    await sleep(1500);
    await noWrites(core, `${open}: (c) leaving an unchanged draft`);
  }
});

test('fr_nav_01_ac13_d_typing_a_title_deleting_it_and_leaving_writes_nothing', async ({ page }) => {
  const core = await start(page);
  await page.keyboard.press('Meta+n');
  await mustBeDraft(page, '⌘N');
  await page.keyboard.type('Smazaný nápad');
  await sleep(300);
  for (let i = 0; i < 'Smazaný nápad'.length; i++) await page.keyboard.press('Backspace');
  assert.equal((await eventually(() => titleState(page), (v) => v.text === '', 1000)).text, '', 'setup: the title is empty again');
  await sidebar(page).getByText('Inbox', { exact: true }).click();
  await mustBeOn(page, 'Inbox', '(d) leave');
  await sleep(1500);
  await noWrites(core, '(d) a title typed, deleted and left');
});

test('fr_nav_01_ac13_a_nfd_title_writes_nothing_until_enter_then_one_nfc_file_like_the_switcher', async ({ page, browser }) => {
  const core = await start(page);
  const before = await core.files();
  await page.keyboard.press('Meta+n');
  await mustBeDraft(page, '⌘N');
  await page.evaluate(() => { (window as any).__teggSamePage = 'kept'; });
  await page.keyboard.insertText('Nový nápad'.normalize('NFD'));
  await sleep(2000);
  await noWrites(core, '(a) 2 s after typing the title');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Nový nápad', '(a) the note after ↩', 5000);
  const after = await eventually(() => core.files(), (f) => QN_NEW in f, 2000);
  const added = Object.keys(after).filter((p) => !(p in before));
  assert.deepEqual(added, [QN_NEW], '(a) exactly one NFC file');
  assert.deepEqual(await core.writesTo(), [QN_NEW], '(a) one write: the creation');
  const nav = await eventually(async () => (await core.calls()).filter((c) => c.cmd === 'nav_opened').map((c) => String((c.args as any)?.path ?? '').normalize('NFC')), (x) => x.includes(QN_NEW), 2000);
  assert.ok(nav.includes(QN_NEW), `(a) the route becomes note/${QN_NEW}: ${JSON.stringify(nav)}`);
  assert.equal(await page.evaluate(() => (window as any).__teggSamePage ?? null), 'kept', '(a) without reloading the page');
  assert.ok(await eventually(() => caretInBody(page), (x) => x, 1000), '(a) the caret is in the body');
  // The switcher's create item for the same title and type, on a second app (FR-NAV-01 AC-7).
  const p2 = await browser.newPage();
  const core2 = await start(p2);
  await p2.keyboard.press('Meta+o');
  await p2.getByRole('textbox', { name: 'Switcher query' }).or(p2.getByRole('combobox', { name: 'Switcher query' })).first().fill('Nový nápad');
  await sleep(150);
  // No object matches, so the Create item is the only one (D-106).
  await p2.keyboard.press('Enter');
  const viaSwitcher = (await eventually(() => core2.files(), (f) => QN_NEW in f, 3000))[QN_NEW];
  assert.ok(viaSwitcher !== undefined, 'switcher create wrote the reference file');
  assert.equal(mask(after[QN_NEW]), mask(viaSwitcher), '(a) same bytes as the switcher apart from id and timestamps');
  await p2.close();
});

test('fr_nav_01_ac13_b_a_title_in_use_gets_a_suffix_and_leaves_ctvrtek_untouched', async ({ page }) => {
  const core = await start(page);
  await page.keyboard.press('Meta+n');
  await mustBeDraft(page, '⌘N');
  await page.keyboard.type('Nápad na čtvrtek');
  await page.keyboard.press('Enter');
  const after = await eventually(() => core.files(), (f) => 'Quick Notes/Nápad na čtvrtek (2).md' in f, 3000);
  assert.ok('Quick Notes/Nápad na čtvrtek (2).md' in after, '(b) creates "Nápad na čtvrtek (2).md"');
  assert.equal(after[P.ctvrtek], shellVault().files[P.ctvrtek], '(b) Čtvrtek byte-identical');
  assert.deepEqual(await core.writesTo(), ['Quick Notes/Nápad na čtvrtek (2).md'], 'exactly one create');
});

test('fr_syn_06_ac5_frame_tour_sends_no_write_commands', async ({ page }) => {
  test.setTimeout(240_000);
  const core = await start(page);
  for (const row of R1.filter((r) => r.goto)) { await runCommand(page, row.goto!); await onPage(page, row.page, 1000); }
  await runCommand(page, 'Open vault…'); await page.keyboard.press('Escape');
  for (const [l] of TYPES_CS) { await typesList(page).getByRole('listitem').filter({ hasText: l }).first().click().catch(() => {}); }
  for (const t of ['2026-10-07 Porada', 'Zavolat Evě', 'Bez hlavičky']) await openNote(page, t);
  await page.keyboard.press('Control+Meta+s'); await page.keyboard.press('Control+Meta+s');
  await page.keyboard.press('Meta+Backslash'); await page.keyboard.press('Meta+Backslash');
  await page.keyboard.press('Meta+Shift+Backslash'); await page.keyboard.press('Escape');
  for (const t of ['Theme: Dark', 'Theme: Light', 'Theme: System']) await runCommand(page, t);
  for (const q of ['porada', 'nápad']) {
    await page.keyboard.press('Meta+Shift+f');
    await must(page.getByRole('textbox', { name: 'Search query' }).or(page.getByRole('searchbox', { name: 'Search query' })), 'Search query');
    await page.getByRole('textbox', { name: 'Search query' }).or(page.getByRole('searchbox', { name: 'Search query' })).first().fill(q);
    await sleep(300);
  }
  assert.equal(await mainName(page), 'Search');
  assert.deepEqual(await nonReadCalls(core), [], 'only read commands during the tour');
  assert.equal(await core.writes(), 0, 'zero write or create commands');
});

