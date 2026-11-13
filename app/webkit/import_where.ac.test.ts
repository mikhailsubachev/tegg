// Slice I2, L5 (WebKit + fake core): the Where step of docs/acceptance/import-capacities.md: FR-HIS-04 AC-14 (the
// proposal, `Change…`, a taken folder, ` (2)`, no vault open), FR-HIS-04 AC-1 (a new vault is the recommended default,
// the I2 half) and FR-IMP-20 AC-3 (the repeat warning on steps 3 and 5). Interface docs/contracts/v1-import-window.md
// §2.3, §3.4, §3.9, §7 (where-osobni.json with plan-board.json: alreadyImported 38). Written from the ACs and the contract
// only (D-61). Lookups go through `must` (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  BOARD, OSOBNI_PATH, alertBox, backBtn, box, canned, click, cmd, continueBtn, description, dialog, enabledSoon, eventually, footer, goTo, importBtn,
  importCallsOf, isDisabled, must, mustStep, nameField, next, radioStarting, radiogroup, radios, seen, shownText, startImport, startOsobni, textOf,
  type WhereDto,
} from './import-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const NEW_HELP = 'Keeps the import apart from your current notes.';
const CURRENT_HELP = 'Adds the objects next to your 1 180 notes. A backup zip of the vault is made first.';
const REPEAT = '38 objects were already imported into this vault. Importing again creates duplicates, so a new vault is recommended.';
const PROJEKTY = '/fake/home/Projekty';
const osobniWhere = (o: Partial<WhereDto['newVault']> = {}, current: WhereDto['current'] | undefined = undefined): WhereDto => {
  const w = canned<WhereDto>('where-osobni.json');
  return { newVault: { ...w.newVault, ...o }, current: current === undefined ? w.current : current };
};
const radioNames = (page: Parameters<typeof radiogroup>[0]) =>
  radios(page, 'Destination').evaluateAll((rs) => rs.map((r) => (r.getAttribute('aria-label') ?? '').trim() || ((r as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim()));

// ------------------------------------------------------------------------------------------------ FR-HIS-04 AC-14

test('fr_his_04_ac14_where_step: the proposal, Change… to a taken folder, then a free name', async ({ page }) => {
  const core = await startOsobni(page, { pickDir: PROJEKTY, imports: BOARD({ taken: [`${PROJEKTY}/Capacities · PKM`] }) });
  await goTo(page, '3');
  await must(radiogroup(page, 'Destination'), 'radiogroup `Destination`');
  const fresh = radioStarting(page, 'Destination', 'A new vault');
  const current = radioStarting(page, 'Destination', 'This vault');
  await enabledSoon(continueBtn(page), 'Continue once the plan of the checked destination is there');
  // A new vault: checked, badge, help, name, path.
  assert.equal(await (await must(fresh, 'radio `A new vault`')).getAttribute('aria-checked'), 'true', '`A new vault` is checked by default (FR-HIS-04 AC-1)');
  assert.ok(await seen(dialog(page).getByText('Recommended', { exact: true })), 'the badge `Recommended`');
  assert.ok(await seen(dialog(page).getByText(NEW_HELP, { exact: true })), `\`${NEW_HELP}\``);
  const field = await must(nameField(page), 'the new vault\'s name field');
  assert.equal(await field.inputValue(), 'Capacities · PKM', 'the name `Capacities · PKM` (WhereDto.newVault.name)');
  const labelledBy = await field.getAttribute('aria-labelledby');
  assert.ok(labelledBy && labelledBy === (await fresh.getAttribute('id')), 'the field is labelled by the radio (aria-labelledby)');
  assert.ok(await seen(dialog(page).getByText('~/Documents/Capacities · PKM', { exact: true })), 'the proposed path `~/Documents/Capacities · PKM` (display)');
  // This vault · Osobní: its help with the region's number (cs: `1 180`).
  assert.equal(await current.getAttribute('aria-checked'), 'false', '`This vault · Osobní` is not checked');
  const names = await radioNames(page);
  assert.equal(names.length, 2, 'two destinations');
  assert.ok(names[1].startsWith('This vault · Osobní'), `the second radio is \`This vault · Osobní\`: ${names[1]}`);
  const shown = await shownText(radiogroup(page, 'Destination'));
  assert.ok(shown.includes(CURRENT_HELP), `\`${CURRENT_HELP}\` (cs: 1 180): ${shown}`);
  // Change…: the folder dialog (vault_pick_dir), then import_check_target; the path follows; the folder exists there.
  await click(cmd(page, 'import.changePlace'), '`Change…`');
  const checks = await eventually(() => importCallsOf(core, 'import_check_target'), (c) => c.length > 0, 3000);
  assert.deepEqual(checks.at(-1), { parent: PROJEKTY, name: 'Capacities · PKM' }, 'import_check_target(picked folder, the field\'s name)');
  assert.ok((await core.calls()).some((c) => c.cmd === 'vault_pick_dir'), 'Change… opens the folder dialog (vault_pick_dir)');
  await must(dialog(page).getByText('~/Projekty/Capacities · PKM', { exact: true }), 'the path follows the picked folder', 3000);
  await must(dialog(page).getByText('A folder named “Capacities · PKM” already exists there.', { exact: true }), 'the TargetExists text under the name', 3000);
  assert.equal(await isDisabled(continueBtn(page)), true, 'Continue is aria-disabled while the folder exists');
  // A free name: the text goes, Continue is enabled again.
  await field.fill('Capacities · PKM 2026');
  const freed = await eventually(() => importCallsOf(core, 'import_check_target'), (c) => c.at(-1)?.name === 'Capacities · PKM 2026', 3000);
  assert.deepEqual(freed.at(-1), { parent: PROJEKTY, name: 'Capacities · PKM 2026' }, 'editing the name checks it again (debounced)');
  assert.equal(await eventually(() => dialog(page).getByText(/already exists there/).count(), (n) => n === 0, 2000), 0, 'the TargetExists text goes');
  await enabledSoon(continueBtn(page), 'Continue with a free name');
  await next(page, '4a', 'Continue with the free name');
  const plan = (await importCallsOf(core, 'import_plan')).at(-1);
  assert.deepEqual(plan?.target, { kind: 'newVault', parent: PROJEKTY, name: 'Capacities · PKM 2026' }, 'the plan is for the edited name and place');
});

test('fr_his_04_ac14_where_step: a taken default is proposed with (2)', async ({ page }) => {
  const core = await startOsobni(page, { imports: BOARD({ where: osobniWhere({ name: 'Capacities · PKM (2)', path: '/fake/home/Documents/Capacities · PKM (2)', display: '~/Documents/Capacities · PKM (2)' }) }) });
  await goTo(page, '3');
  const field = await must(nameField(page), 'the name field');
  assert.equal(await field.inputValue(), 'Capacities · PKM (2)', 'the name is proposed with ` (2)`');
  assert.ok(await seen(dialog(page).getByText('~/Documents/Capacities · PKM (2)', { exact: true })), 'its path');
  await enabledSoon(continueBtn(page), 'Continue');
  const t = (await importCallsOf(core, 'import_plan')).find((a) => a.target?.kind === 'newVault')?.target;
  assert.deepEqual(t, { kind: 'newVault', parent: '/fake/home/Documents', name: 'Capacities · PKM (2)' }, 'the window plans the proposed name (one source of the name, §2.3)');
});

test('fr_his_04_ac14_where_step: with no vault open only `A new vault` is offered', async ({ page }) => {
  await startImport(page, { vault: null, frame: 'chooser', imports: BOARD({ where: osobniWhere({}, null) }) });
  const button = await must(page.getByRole('main', { name: 'Choose a vault' }).locator('button[data-command="import.open"]'), 'the chooser\'s `Import…` button');
  assert.equal(await textOf(button), 'Import…', 'the chooser button reads `Import…`');
  await button.click();
  await mustStep(page, '0', 'the chooser\'s Import…');
  await next(page, '1', 'step 0');
  await click(cmd(page, 'import.chooseZip'), 'Choose zip…');
  await next(page, '3', 'step 1 (one space)');
  await must(radiogroup(page, 'Destination'), 'radiogroup `Destination`');
  assert.deepEqual((await radioNames(page)).length, 1, 'one destination');
  assert.equal(await radioStarting(page, 'Destination', 'This vault').count(), 0, 'no `This vault`');
  assert.equal(await radioStarting(page, 'Destination', 'A new vault').getAttribute('aria-checked'), 'true', '`A new vault` checked');
});

// ------------------------------------------------------------------------------------------------ FR-HIS-04 AC-1 (the I2 half)

test('fr_his_04_ac1_a_new_vault_is_the_recommended_default', async ({ page }) => {
  const core = await startOsobni(page);
  await goTo(page, '3');
  const fresh = await must(radioStarting(page, 'Destination', 'A new vault'), '`A new vault`');
  assert.equal(await fresh.getAttribute('aria-checked'), 'true', '`A new vault` is checked');
  assert.equal(await radiogroup(page, 'Destination').getByRole('radio', { name: 'A new vault, Recommended', exact: true }).count(), 1, 'named with its badge: `A new vault, Recommended` (FR-UX-08 AC-19)');
  await enabledSoon(continueBtn(page), 'Continue');
  const first = (await importCallsOf(core, 'import_plan'))[0];
  assert.equal(first?.target?.kind, 'newVault', 'the first plan is for a new vault');
});

// ------------------------------------------------------------------------------------------------ FR-IMP-20 AC-3

test('fr_imp_20_ac3_repeat_warning: on step 3 whatever is checked, again on step 5 for This vault', async ({ page }) => {
  await startOsobni(page);
  await goTo(page, '3');
  const fresh = radioStarting(page, 'Destination', 'A new vault');
  const current = radioStarting(page, 'Destination', 'This vault');
  await must(dialog(page).getByText(REPEAT, { exact: true }), 'the repeat warning under `This vault · Osobní`', 5000);
  assert.equal(await fresh.getAttribute('aria-checked'), 'true', '`A new vault` stays the default');
  assert.ok((await description(current)).includes(REPEAT), 'the warning is part of `This vault`\'s description');
  const order = await page.evaluate((t) => {
    const r = [...document.querySelectorAll('[data-import-step] [role="radio"]')].find((e) => (e.textContent ?? '').includes('This vault'))?.getBoundingClientRect();
    const w = [...document.querySelectorAll('[data-import-step] *')].find((e) => e.children.length === 0 && (e.textContent ?? '').trim() === t)?.getBoundingClientRect();
    return r && w ? w.top >= r.top : null;
  }, REPEAT);
  assert.equal(order, true, 'the warning is under `This vault · Osobní`');
  // Choosing This vault is still possible; the warning stays.
  await click(current, '`This vault · Osobní`');
  assert.equal(await eventually(() => current.getAttribute('aria-checked'), (v) => v === 'true'), 'true', '`This vault` can be chosen');
  assert.ok(await seen(dialog(page).getByText(REPEAT, { exact: true })), 'the warning is still shown when This vault is checked');
  await next(page, '4a', 'step 3 with This vault');
  await next(page, '5', 'step 4a (plan-board has no 4c row)');
  const warn = await must(dialog(page).getByText(REPEAT, { exact: true }), 'step 5 repeats the warning', 3000);
  const w = await box(warn);
  const f = await box(footer(page));
  assert.ok(w && f && w.y + w.height <= f.y + 1, 'the warning is above the footer\'s primary button');
  assert.ok(await seen(importBtn(page)), 'the primary `Import <n> objects`');
  // A new vault: no warning on step 5.
  await click(backBtn(page), 'Back');
  await mustStep(page, '4a', 'Back from 5');
  await click(backBtn(page), 'Back');
  await mustStep(page, '3', 'Back from 4a');
  await click(fresh, '`A new vault`');
  await next(page, '4a', 'step 3 with A new vault');
  await click(continueBtn(page), 'Continue');
  await eventually(async () => (await dialog(page).getAttribute('data-import-step')) ?? '', (s) => s === '5' || s === '4c', 3000);
  if ((await dialog(page).getAttribute('data-import-step')) === '4c') await next(page, '5', 'step 4c');
  await mustStep(page, '5', 'step 5 for a new vault');
  assert.equal(await dialog(page).getByText(REPEAT, { exact: true }).count(), 0, 'no warning on step 5 for a new vault');
});

test('fr_imp_20_ac3_repeat_warning: with 0 neither place shows it', async ({ page }) => {
  const existing = canned('plan-c05+c07-PKM-existing.json');
  assert.equal(existing.alreadyImported, 0, 'setup: the canned plan has alreadyImported 0');
  await startOsobni(page, {
    imports: BOARD({ where: osobniWhere({}, { name: 'Osobní', path: OSOBNI_PATH, notes: 1180, alreadyImported: 0 }), plans: { 'PKM|existing': 'plan-c05+c07-PKM-existing.json', 'PKM|newVault': 'plan-c05+c07-PKM-new.json' } }),
  });
  await goTo(page, '3');
  await enabledSoon(continueBtn(page), 'Continue');
  assert.equal(await dialog(page).getByText(/were already imported into this vault/).count(), 0, 'step 3: no warning at 0');
  await click(radioStarting(page, 'Destination', 'This vault'), '`This vault`');
  await next(page, '4a', 'step 3');
  await click(continueBtn(page), 'Continue');
  await eventually(async () => (await dialog(page).getAttribute('data-import-step')) ?? '', (s) => s === '5' || s === '4c', 3000);
  if ((await dialog(page).getAttribute('data-import-step')) === '4c') await next(page, '5', 'step 4c');
  await mustStep(page, '5', 'step 5');
  assert.equal(await dialog(page).getByText(/were already imported into this vault/).count(), 0, 'step 5: no warning at 0');
  assert.equal(await alertBox(page).count(), 0, 'no alert');
});
