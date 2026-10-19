// MS5 slice 5B, L5 (WebKit + fake core): Settings: Vault, docs/acceptance/capture.md R58 and FR-SET-01 AC-1…AC-10;
// FR-SYN-06 AC-25 (L5 part: one write per committed change, none for opening). Interface docs/contracts/ms5-capture.md
// §5.1 (`vault_settings`, `vault_settings_patch` with the file's version as base, `vault_reveal`), the daily notes
// folder through `type_patch('daily-note', base, [SetFolder])`, §11.2 (the fake's line rules in fake-settings.ts).
// Written from the ACs and the contract only (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  callsOf, click, eventually, fileText, flat, focusName, inboxVault, main, must, runCommand, seen, sleep, startMain, vaultWrites, type FakeCoreHandle,
} from './capture-helpers';
import { pseudoLocale } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });

const YML = '.tegg/vault.yml';
/** The vault folder (given to the fake in NFD, shown in NFC). */
const VAULT_PATH = '/Users/test/Dokumenty/Doručené';
const DAILY_YML = '.tegg/types/daily-note.yml';
async function openPage(page: Page, o: Parameters<typeof startMain>[1] = {}): Promise<FakeCoreHandle> {
  const core = await startMain(page, { vaultPath: VAULT_PATH.normalize('NFD'), ...o });
  await runCommand(page, 'Go to Settings: Vault');
  await must(main(page).getByRole('heading', { name: /Vault/ }), 'the Settings: Vault page', 5000);
  return core;
}
const field = (page: Page, name: string) => main(page).getByRole('textbox', { name, exact: true });
const combo = (page: Page) => main(page).getByRole('combobox', { name: 'Default type for new notes', exact: true });
async function value(page: Page, name: string): Promise<string> {
  const f = await must(field(page, name), `textbox ${name}`);
  return f.evaluate((e) => ((e as HTMLInputElement).value ?? '').normalize('NFC'));
}
async function commit(page: Page, name: string, text: string, how: 'enter' | 'blur' = 'enter') {
  const f = await must(field(page, name), `textbox ${name}`);
  await f.fill(text);
  if (how === 'enter') await f.press('Enter');
  else await f.evaluate((e) => (e as HTMLElement).blur());
  await sleep(200);
}
async function chooseDefault(page: Page, option: string) {
  const c = await must(combo(page), 'combobox Default type for new notes');
  if (await c.evaluate((e) => e.tagName === 'SELECT')) await c.selectOption({ label: option });
  else {
    await c.click();
    await click(page.getByRole('option', { name: option, exact: true }), `option ${option}`);
  }
  await sleep(200);
}
async function comboText(page: Page): Promise<string> {
  const c = await must(combo(page), 'combobox Default type for new notes');
  return flat(await c.evaluate((e) => (e as HTMLSelectElement).selectedOptions?.[0]?.text ?? (e as HTMLInputElement).value ?? e.textContent ?? ''));
}

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_set_01_ac1_the_page_shows_the_stored_values', async ({ page }) => {
  const core = await openPage(page);
  assert.ok(await seen(main(page).getByText(VAULT_PATH.normalize('NFC'), { exact: true }), 2000), 'the vault path as NFC text');
  for (const b of ['Reveal in Finder', 'Open another vault…', 'Add starter types…']) await must(main(page).getByRole('button', { name: b, exact: true }), `button ${b}`);
  assert.equal(await comboText(page), 'Quick Note', 'Default type: Quick Note');
  assert.equal(await value(page, 'Daily notes folder'), 'Daily', 'Daily notes folder');
  assert.equal(await value(page, 'Daily note file name'), 'YYYY-MM-DD', 'Daily note file name');
  assert.ok(await seen(main(page).getByText('Daily/2026-10-14.md', { exact: true }), 1000), 'the example for today');
  assert.equal(await value(page, 'Attachments folder'), '_attachments', 'Attachments folder');
  assert.ok(await seen(main(page).getByText('Applies to new daily notes. Existing ones stay where they are.', { exact: true }), 1000), 'daily folder note');
  assert.ok(await seen(main(page).getByText("Applies to new attachments. Existing files aren't moved.", { exact: true }), 1000), 'attachments note');
  assert.deepEqual(await vaultWrites(core), [], 'opening writes nothing');
  // Also reached from the Settings section list and the vault menu's `Vault settings…` (D-219).
  await runCommand(page, 'Go to Settings: Appearance');
  await click(main(page).getByRole('link', { name: 'Vault', exact: true }).or(main(page).getByRole('tab', { name: 'Vault', exact: true })), 'the Settings section Vault');
  assert.equal(await comboText(page), 'Quick Note', 'the same page from the section list');
});

// ------------------------------------------------------------------------------------------------ AC-2

test('fr_set_01_ac2_choosing_napad_writes_one_line', async ({ page }) => {
  const core = await openPage(page);
  const before = await fileText(core, YML);
  const v0 = await core.version(YML);
  await chooseDefault(page, 'Nápad');
  const calls = await callsOf(core, 'vault_settings_patch');
  assert.equal(calls.length, 1, 'one vault_settings_patch');
  assert.deepEqual(calls[0].args, { base: v0, key: 'default-type', value: 'nápad' }, 'the key, the type key and the version as base');
  assert.equal(await fileText(core, YML), before!.replace('default-type: Quick Note\n', 'default-type: nápad\n'), 'only that line');
  assert.deepEqual(await core.writesTo(), [YML], 'no other file');
  await chooseDefault(page, 'Nápad');
  assert.equal((await callsOf(core, 'vault_settings_patch')).length, 1, 'choosing the current value writes nothing');
});

// ------------------------------------------------------------------------------------------------ AC-3

test('fr_set_01_ac3_an_external_change_is_never_overwritten', async ({ page }) => {
  const core = await openPage(page);
  const theirs = (await fileText(core, YML))!.replace('attachments: _attachments', 'attachments: Soubory');
  await core.setFile(YML, theirs, { silent: true });
  await chooseDefault(page, 'Nápad');
  assert.ok(await seen(page.getByRole('alert').filter({ hasText: "Changed outside Tegg. Your change to Default type for new notes wasn't saved." }), 2000), 'the alert names the field');
  assert.equal(await fileText(core, YML), theirs, 'the file keeps the external bytes');
  assert.equal(await eventually(() => value(page, 'Attachments folder'), (v) => v === 'Soubory', 2000), 'Soubory', 'the page reloads the file within 2 s');
  await core.setFile(YML, theirs.replace('attachments: Soubory', 'attachments: Přílohy'));
  assert.equal(await eventually(() => value(page, 'Attachments folder'), (v) => v === 'Přílohy', 2000), 'Přílohy', 'with vault:changed, the external values within 2 s');
});

// ------------------------------------------------------------------------------------------------ AC-4

test('fr_set_01_ac4_daily_note_file_name', async ({ page }) => {
  const core = await openPage(page);
  const before = await fileText(core, YML);
  const f = await must(field(page, 'Daily note file name'), 'textbox Daily note file name');
  await f.fill('DD.MM.YYYY');
  assert.ok(await seen(main(page).getByText('Daily/14.10.2026.md', { exact: true }), 1000), 'the live example');
  await f.press('Enter');
  await sleep(200);
  assert.equal(await fileText(core, YML), before!.replace('daily-format: YYYY-MM-DD\n', 'daily-format: DD.MM.YYYY\n'), 'only the daily-format line');
  const writes = (await core.writesTo()).length;
  for (const bad of ['YYYY/MM/DD', 'YYYY:MM:DD', 'MM-YYYY', '']) {
    await commit(page, 'Daily note file name', bad);
    const reason = await f.evaluate((e) => {
      const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
    });
    assert.notEqual(reason, '', `${JSON.stringify(bad)}: a reason under the field`);
    assert.equal(await f.getAttribute('aria-invalid'), 'true', `${JSON.stringify(bad)}: invalid`);
  }
  assert.equal((await core.writesTo()).length, writes, 'nothing written for a rejected format');
});

// ------------------------------------------------------------------------------------------------ AC-5

test('fr_set_01_ac5_daily_notes_folder', async ({ page }) => {
  const core = await openPage(page);
  const before = await fileText(core, DAILY_YML);
  await commit(page, 'Daily notes folder', 'Deník');
  const calls = await callsOf(core, 'type_patch');
  assert.equal(calls.length, 1, 'one type_patch');
  assert.equal((calls[0].args as any)?.key ?? (calls[0].args as any)?.type, 'daily-note', 'the Daily Note type');
  assert.equal(await fileText(core, DAILY_YML), before!.replace('folder: Daily\n', 'folder: Deník\n'), 'only the folder: line');
  assert.deepEqual(await core.writesTo(), [DAILY_YML], 'one file');
  const n = (await core.writesTo()).length;
  for (const bad of ['.trash', '../Jinde', '_templates/X']) {
    await commit(page, 'Daily notes folder', bad);
    assert.equal(await (await must(field(page, 'Daily notes folder'), 'field')).getAttribute('aria-invalid'), 'true', `${bad}: refused with its reason`);
  }
  assert.equal((await core.writesTo()).length, n, 'nothing written for a forbidden folder');
});

test('fr_set_01_ac5_without_the_type_file_the_default_file_is_written', async ({ page }) => {
  const core = await openPage(page, { vault: inboxVault((f) => { delete f[DAILY_YML]; }) });
  await commit(page, 'Daily notes folder', 'Deník', 'blur');
  const t = await eventually(() => fileText(core, DAILY_YML), (x) => x !== undefined, 2000);
  assert.ok(t?.includes('\nfolder: Deník\n') && t.includes('\nname: Daily Note\n'), 'the whole default file with folder: Deník (D-90)');
});

// ------------------------------------------------------------------------------------------------ AC-6

test('fr_set_01_ac6_attachments_folder', async ({ page }) => {
  const core = await openPage(page);
  const before = await fileText(core, YML);
  await commit(page, 'Attachments folder', 'Přílohy');
  assert.equal(await fileText(core, YML), before!.replace('attachments: _attachments\n', 'attachments: Přílohy\n'), 'only the attachments line');
  assert.deepEqual(await core.writesTo(), [YML], 'nothing moved or created');
  for (const bad of ['.trash', '../Jinde', '_templates/X']) {
    await commit(page, 'Attachments folder', bad);
    assert.equal(await (await must(field(page, 'Attachments folder'), 'field')).getAttribute('aria-invalid'), 'true', `${bad}: refused`);
  }
  assert.deepEqual(await core.writesTo(), [YML], 'nothing written for a forbidden folder');
});

// ------------------------------------------------------------------------------------------------ AC-7, AC-8

test('fr_set_01_ac7_vault_location_reveal_and_open_another', async ({ page }) => {
  const core = await openPage(page, { pickDir: null });
  await click(main(page).getByRole('button', { name: 'Reveal in Finder', exact: true }), 'Reveal in Finder');
  assert.deepEqual((await core.reveals()).map((p) => p.normalize('NFC')), [VAULT_PATH.normalize('NFC')], 'the shell is asked to reveal the vault folder (recorded)');
  await click(main(page).getByRole('button', { name: 'Open another vault…', exact: true }), 'Open another vault…');
  assert.equal((await callsOf(core, 'vault_pick_dir')).length, 1, 'the D-219 folder picker');
  assert.deepEqual(await vaultWrites(core), [], 'nothing moves the vault');
});

test('fr_set_01_ac8_add_starter_types_opens_the_same_dialog', async ({ page }) => {
  await openPage(page);
  await click(main(page).getByRole('button', { name: 'Add starter types…', exact: true }), 'Add starter types…');
  await must(page.getByRole('dialog', { name: /starter types/i }), 'the D-244 dialog');
});

// ------------------------------------------------------------------------------------------------ AC-9

test('fr_set_01_ac9_missing_keys', async ({ page }) => {
  const stripped = inboxVault((f) => { f[YML] = f[YML].split('\n').filter((l) => !/^(default-type|daily-format|attachments):/.test(l)).join('\n'); });
  const core = await openPage(page, { vault: stripped });
  assert.equal(await comboText(page), 'Quick Note', 'Quick Note');
  assert.equal(await value(page, 'Daily note file name'), 'YYYY-MM-DD');
  assert.equal(await value(page, 'Attachments folder'), '_attachments');
  assert.deepEqual(await vaultWrites(core), [], 'opening writes nothing');
  const before = (await fileText(core, YML))!;
  await commit(page, 'Attachments folder', 'Přílohy');
  assert.equal(await fileText(core, YML), `${before}${before.endsWith('\n') ? '' : '\n'}attachments: Přílohy\n`, 'only that key, appended after the last entry');
});

// ------------------------------------------------------------------------------------------------ AC-10

test('fr_set_01_ac10_keyboard_order_and_escape', async ({ page }) => {
  const core = await openPage(page);
  await (await must(main(page).getByRole('button', { name: 'Reveal in Finder', exact: true }), 'Reveal in Finder')).focus();
  const order: string[] = [];
  for (let i = 0; i < 7; i++) { order.push((await focusName(page)).name); await page.keyboard.press('Tab'); }
  assert.deepEqual(order, ['Reveal in Finder', 'Open another vault…', 'Default type for new notes', 'Daily notes folder', 'Daily note file name', 'Attachments folder', 'Add starter types…'], 'R58 order');
  const f = await must(field(page, 'Attachments folder'), 'Attachments folder');
  await f.fill('Jinam');
  await f.press('Escape');
  assert.equal(await value(page, 'Attachments folder'), '_attachments', 'Esc restores the stored value');
  assert.deepEqual(await vaultWrites(core), [], 'nothing written');
});

test('fr_set_01_ac10_pseudo_locale', async ({ page }) => {
  await openPage(page, { prelude: pseudoLocale });
  const leaks = await main(page).evaluate((m) => {
    const out: string[] = [];
    const walk = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = (n.textContent ?? '').trim();
      if (t && !t.includes('⟦') && !n.parentElement?.closest('[data-user-content]')) out.push(t);
    }
    return out;
  });
  const allowed = /^(\/.*|Quick Note|Page|Task|Nápad|Schůzka|Daily|_attachments|YYYY-MM-DD|Daily\/2026-10-14\.md)$/;
  assert.deepEqual(leaks.filter((t) => !allowed.test(t.normalize('NFC'))), [], 'only paths, type names and folder names outside ⟦ ⟧');
  await must(main(page).getByRole('combobox', { name: '⟦Default type for new notes⟧' }), 'the pseudo-localized combobox');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-25 (L5)

test('fr_syn_06_ac25_one_file_per_committed_change', async ({ page }) => {
  const core = await openPage(page);
  await runCommand(page, 'Go to Settings: Menu bar and startup');
  await runCommand(page, 'Go to Settings: Shortcuts');
  await runCommand(page, 'Go to Settings: Vault');
  assert.deepEqual(await vaultWrites(core), [], 'opening the Settings pages writes nothing');
  await chooseDefault(page, 'Nápad');
  assert.deepEqual(await core.writesTo(), [YML], 'the default type: vault.yml once');
  await commit(page, 'Daily notes folder', 'Deník');
  assert.deepEqual(await core.writesTo(), [YML, DAILY_YML], 'the daily folder: daily-note.yml once');
  await commit(page, 'Attachments folder', 'Přílohy');
  assert.deepEqual(await core.writesTo(), [YML, DAILY_YML, YML], 'the attachments folder: vault.yml once');
});
