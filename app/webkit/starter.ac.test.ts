// MS3 slice 3D, L5 (WebKit + fake core): starter vault and Add starter types (D-238, D-244). FR-VLT-02 AC-6, AC-8, AC-9.
// Written from docs/acceptance/types.md (R11) and docs/contracts/ms3-shell.md §14.2.5, §14.3, §14.7.3 only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault } from '../ui/test/fake-core';
import { R11 } from '../test/shell-tables';
import { createFromDraft, typeEntries } from './helpers';
import {
  callsOf, description, dialog, fixture, isDisabled, main, must, nonReadCalls, runCommand, seen, sleep, typeFile, typesVault,
} from './types-helpers';
import { start } from './helpers';

const PARENT = '/Users/test/Trezory';
const form = (page: Page) => page.getByRole('form', { name: 'New vault' });

async function createStarter(page: Page) {
  const core = await start(page, { vault: null, pickDir: PARENT });
  await page.getByRole('main', { name: 'Choose a vault' }).getByRole('button', { name: 'Create new vault' }).click();
  await must(form(page), 'New vault form');
  const group = await must(form(page).getByRole('radiogroup', { name: 'Vault contents' }), 'radiogroup Vault contents');
  const starter = group.getByRole('radio', { name: 'Starter vault' });
  assert.equal(await starter.getAttribute('aria-disabled') === 'true' || (await isDisabled(starter)), false, 'Starter vault enabled (R3)');
  await starter.click();
  await form(page).getByRole('textbox', { name: 'Vault name' }).fill('Startovní');
  await form(page).getByRole('button', { name: 'Choose…' }).click();
  await sleep(100);
  await form(page).getByRole('button', { name: 'Create', exact: true }).click();
  return core;
}

test('fr_vlt_02_ac6_vault_contents_choice', async ({ page }) => {
  await start(page, { vault: null, pickDir: PARENT });
  await page.getByRole('main', { name: 'Choose a vault' }).getByRole('button', { name: 'Create new vault' }).click();
  const group = await must(form(page).getByRole('radiogroup', { name: 'Vault contents' }), 'radiogroup Vault contents');
  const [empty, starter] = [group.getByRole('radio', { name: 'Empty vault' }), group.getByRole('radio', { name: 'Starter vault' })];
  assert.equal(await empty.isChecked(), true, 'Empty vault by default');
  assert.equal(await starter.getAttribute('aria-disabled'), null, 'Starter vault enabled');
  assert.notEqual(await description(empty), '', 'one-line description');
  assert.notEqual(await description(starter), '', 'one-line description');
});

test('fr_vlt_02_ac6_create_starter_vault_sends_kind_starter', async ({ page }) => {
  const core = await createStarter(page);
  const c = await callsOf(core, 'vault_create');
  assert.equal(c.length, 1);
  assert.equal((c[0].args as any).kind, 'starter');
  assert.equal(c[0].ok, true, 'no longer Unsupported');
});

test('fr_vlt_02_ac8_starter_types_listed_and_usable', async ({ page }) => {
  const core = await createStarter(page);
  await must(page.getByRole('navigation', { name: 'Sidebar' }), 'frame', 5000);
  const entries = await typeEntries(page);
  for (const pl of ['Books', 'Ideas', 'Meetings', 'People', 'Projects', 'Reading Notes', 'Trips']) {
    const e = entries.find(([l]) => l === pl);
    assert.deepEqual(e, [pl, 0], `${pl} with 0 objects`);
  }
  const order = entries.map(([l]) => l).filter((l) => R11.some((r) => r.plural === l));
  assert.deepEqual(order, ['Books', 'Ideas', 'Meetings', 'People', 'Projects', 'Reading Notes', 'Trips'], 'D-121 order');
  await runCommand(page, 'Go to type: Meetings');
  await main(page).getByRole('button', { name: 'New Meeting', exact: true }).click();
  await createFromDraft(page, 'Kick-off', 'New Meeting'); // D-520: an unsaved draft, ↩ creates it
  await sleep(300);
  const files = await core.files();
  const m = files['Meetings/Kick-off.md'] ?? '';
  assert.match(m, /^---\nid: \S+\ntype: meeting\ntitle: Kick-off\ncreated: \S+\nmodified: \S+\n---\n## Agenda\n\n## Notes\n\n## Decisions\n$/);
  await runCommand(page, 'Go to type: Books');
  await main(page).getByRole('button', { name: 'New Book', exact: true }).click();
  await createFromDraft(page, 'Řeka', 'New Book');
  await sleep(300);
  assert.ok(((await core.files())['Books/Řeka.md'] ?? '').includes('\nstatus: To read\n'), 'a new Book gets status: To read');
});

test('fr_vlt_02_ac9_add_starter_types_skips_name_and_folder', async ({ page }) => {
  const tpl = fixture('types/expected/čajovna.yml');
  const vault = typesVault((f) => {
    f[typeFile('person')] = tpl.replace('Čajovna', 'Person').replaceAll('Čajovny', 'Persons');
    f[typeFile('kniha')] = tpl.replace('Čajovna', 'Kniha').replace('folder: Čajovny', 'folder: Books').replaceAll('Čajovny', 'Knihy');
    f['_templates/Meeting/Meeting.md'] = '## Moje agenda\n';
  });
  const core = await start(page, { vault });
  const before = await core.files();
  await runCommand(page, 'Add starter types…');
  const d = await must(dialog(page, 'Add starter types'), 'dialog');
  const add = (await d.getByRole('list', { name: 'Will be added' }).getByRole('listitem').allInnerTexts()).map((t) => t.trim());
  assert.deepEqual(add.map((t) => t.split('\n')[0]), ['Reading Note', 'Idea', 'Meeting', 'Project', 'Trip']);
  const skipped = (await d.getByRole('list', { name: 'Skipped' }).getByRole('listitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  assert.ok(skipped.some((t) => t.includes('Person') && t.includes('a type with this name exists')), `Person skipped: ${skipped}`);
  assert.ok(skipped.some((t) => t.includes('Book') && t.includes('the folder Books is used')), `Book skipped: ${skipped}`);
  assert.ok((await d.innerText()).includes('_templates/Meeting/Meeting.md'), 'the kept template is listed');
  assert.deepEqual(await nonReadCalls(core), [], 'the dialog writes nothing');
  await d.getByRole('button', { name: 'Add', exact: true }).click();
  await sleep(300);
  const after = await core.files();
  const added = Object.keys(after).filter((p) => !(p in before)).sort();
  assert.deepEqual(added, ['.tegg/types/idea.yml', '.tegg/types/meeting.yml', '.tegg/types/project.yml', '.tegg/types/reading-note.yml', '.tegg/types/trip.yml', '_templates/Idea/Idea.md', '_templates/Project/Project.md', '_templates/Reading Note/Reading Note.md', '_templates/Trip/Trip.md'].sort());
  for (const p of Object.keys(before)) assert.equal(after[p], before[p], `${p} unchanged`);
  assert.equal(after['.tegg/types/idea.yml'], fixture('vaults/new-starter/.tegg/types/idea.yml'));
});

test('fr_vlt_02_ac9_nothing_to_add', async ({ page }) => {
  const starter = loadFixtureVault('tests/fixtures/vaults/new-starter');
  const vault = typesVault((f) => Object.assign(f, starter.files));
  const core = await start(page, { vault });
  await runCommand(page, 'Add starter types…');
  const d = await must(dialog(page, 'Add starter types'), 'dialog');
  await must(d.getByRole('status').filter({ hasText: 'All starter types are already in this vault.' }), 'status');
  await d.getByRole('button', { name: 'Close', exact: true }).click();
  assert.ok(!(await seen(d, 300)), 'closed');
  assert.deepEqual(await nonReadCalls(core), [], 'writes nothing');
});
