// Slice I2, L5 (WebKit + fake core): importing and done of docs/acceptance/import-capacities.md: FR-UX-07 AC-14 (the
// phase list, Cancel before the first write, failures), AC-15 (Hide and Esc, the status element, saves meanwhile, reopen,
// Dismiss, the quit question; the 100 ms save latency is L6's, contract §9.3 (1)), AC-16 (a vault switch during an import
// into This vault), FR-IMP-19 AC-11 (step 7, Open report, Open vault), AC-12 (no Undo, said plainly; the step part).
// Interface docs/contracts/v1-import-window.md §3.10, §3.11, §4.2, §6, §7.2, §7.3. Written from the ACs and the contract
// only (D-61). Lookups go through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  BOARD, C0507, C09, DECISIONS, OSOBNI_PATH, REPORT_DATE, alertBox, canned, click, cmd, closeBtn, continueBtn, description, dialog, emit, enabledSoon,
  eventually, flat, goTo, heading, hideBtn, importCallsOf, importFail, importHold, importPace, importRelease, isDisabled, main, must, mustBeClosed,
  mustStep, newVaultPath, next, num, osobniVault, phaseItem, phases, planNumbers, quitDialog, radioStarting, seen, shownText, startImport,
  paletteRun, startImportRun, statusElement, statusOpen, textOf, vaultOpens, type FakeImportOptions,
} from './import-helpers';
import { newEmptyVault } from '../ui/test/fake-core';
import { mainName, openNote } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });

const RUNNING = /^⟦?Importing (\d[\d  ]*) of (\d[\d  ]*)⟧?$/;
async function toPreview(page: Page) {
  await enabledSoon(continueBtn(page), 'Continue on 4a');
  await click(continueBtn(page), 'Continue on 4a');
  const s = await eventually(async () => (await dialog(page).getAttribute('data-import-step').catch(() => null)) ?? '', (x) => x === '5' || x === '4c', 5000);
  if (s === '4c') await next(page, '5', '4c');
  await mustStep(page, '5', 'the preview');
}
/** The Trezor vault, `source` read, `destination`, on step 5. */
async function preview(page: Page, imports: FakeImportOptions, destination: 'new' | 'current' = 'new') {
  const core = await startImport(page, { imports });
  await goTo(page, '3', { how: 'folder' });
  if (destination === 'current') await click(radioStarting(page, 'Destination', 'This vault'), '`This vault`');
  await next(page, '4a', 'step 3');
  await toPreview(page);
  return core;
}
async function statusText(page: Page): Promise<string> {
  return flat(await statusOpen(page).innerText({ timeout: 500 }).catch(() => ''));
}
/** Records the phase list's states until step 7 (or `ms`). */
async function watch(page: Page, ms = 20_000) {
  const seenStates: { phase: string; state: string; text: string }[][] = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const p = await phases(page);
    if (p.length) seenStates.push(p);
    if ((await dialog(page).getAttribute('data-import-step', { timeout: 200 }).catch(() => null)) !== '6') break;
    await page.waitForTimeout(40);
  }
  return seenStates;
}

// ------------------------------------------------------------------------------------------------ FR-UX-07 AC-14

test('fr_ux_07_ac14_importing_step', async ({ page }) => {
  const plan = canned('plan-c05+c07-PKM-new.json');
  const n = planNumbers(plan);
  const writtenObjects = (plan.objects as any[]).filter((o) => o.outcome === 'imported').length; // imported objects plus made media objects
  const core = await preview(page, C0507());
  await importHold(core, 'planning');
  await startImportRun(page);
  const list = await must(dialog(page).getByRole('list', { name: 'Import steps' }), 'the list `Import steps`');
  assert.deepEqual((await phases(page)).map((p) => p.phase), ['read', 'create', 'objects', 'attachments', 'report'], 'five phases in the board\'s order (new vault: create)');
  assert.deepEqual((await phases(page)).map((p) => p.state), ['pending', 'pending', 'pending', 'pending', 'pending'], 'all pending before the job\'s planning');
  const texts = (await list.locator('li').allInnerTexts()).map(flat);
  for (const [i, label] of ['Reading the export', 'Creating the vault', 'Writing objects', 'Copying attachments', 'Writing the report'].entries()) assert.ok(texts[i]?.includes(label), `phase ${i + 1}: \`${label}\`: ${texts[i]}`);
  assert.ok(texts[0].includes(`${num(plan.source.files)} files`), `read: \`<n> files\` (ScanInfo.files ${plan.source.files}): ${texts[0]}`);
  assert.ok(texts[2].includes(`0 of ${num(writtenObjects)}`), `objects before its step: \`0 of ${writtenObjects}\`: ${texts[2]}`);
  await must(dialog(page).getByText('Writing can’t be stopped half-way. You can keep working in Tegg; this window can be closed and the progress stays in the status bar.', { exact: true }), 'the note under the list');
  assert.equal(await isDisabled(cmd(page, 'import.cancel')), false, 'Cancel is enabled before the first write');
  assert.equal(await isDisabled(hideBtn(page)), false, 'Hide is enabled');
  // planning → read running; then held before writing.
  await importHold(core, 'writing');
  await importRelease(core);
  assert.equal(await eventually(async () => (await phases(page))[0]?.state, (s) => s === 'running', 3000), 'running', 'read is running during the job\'s planning');
  assert.equal(await isDisabled(cmd(page, 'import.cancel')), false, 'Cancel is still enabled in planning');
  // writing: watch every state, slowly.
  await importPace(core, 150);
  await importHold(core, null);
  await importRelease(core);
  const states = await watch(page);
  const ever = (phase: string, state: string) => states.some((s) => s.find((p) => p.phase === phase)?.state === state);
  for (const phase of ['read', 'create', 'objects', 'attachments', 'report']) assert.ok(ever(phase, 'running') || phase === 'read', `${phase} was running at some point`);
  const objectsRunning = states.map((s) => s.find((p) => p.phase === 'objects')).find((p) => p?.state === 'running' && /\d+ of \d+/.test(p.text));
  assert.ok(objectsRunning, 'objects running shows `<k> of <n>`');
  assert.match(objectsRunning!.text, new RegExp(`\\d+ of ${num(writtenObjects)}`), `\`<k> of ${writtenObjects}\``);
  const attRunning = states.map((s) => s.find((p) => p.phase === 'attachments')).find((p) => p?.state === 'running');
  if (n.attachments > 0) assert.match(attRunning?.text ?? '', new RegExp(`\\d+ of ${num(n.attachments)}`), 'attachments running: `<k> of <n>`');
  // Cancel: aria-disabled from the first write on, with its reason (observed during the run).
  await mustStep(page, '7', 'the run ends on step 7', 20_000);
  assert.ok(states.length > 3, 'the list followed the events');
});

test('fr_ux_07_ac14_importing_step: Cancel until the first write, then aria-disabled with its reason; done rows; Hide always', async ({ page }) => {
  const core = await preview(page, C0507());
  await importHold(core, 'writing');
  await startImportRun(page);
  await importPace(core, 300);
  await importRelease(core);
  // The first writing event: Cancel aria-disabled and described.
  await eventually(async () => (await phases(page)).some((p) => p.phase === 'create' && p.state !== 'pending'), (v) => v, 5000);
  const cancel = await must(cmd(page, 'import.cancel'), 'Cancel');
  assert.equal(await eventually(() => cancel.getAttribute('aria-disabled'), (v) => v === 'true', 3000), 'true', 'Cancel is aria-disabled from the first write');
  assert.equal(await description(cancel), 'Writing can’t be stopped half-way.', 'its description');
  await cancel.click({ force: true });
  await page.waitForTimeout(300);
  assert.ok(await seen(dialog(page)), 'pressing it does nothing');
  assert.equal(await isDisabled(hideBtn(page)), false, 'Hide is enabled while writing');
  // Done rows carry a check mark whose text alternative is `done`.
  await eventually(async () => (await phases(page)).filter((p) => p.state === 'done').length, (k) => k >= 2, 10_000);
  const doneRow = dialog(page).locator('li[data-phase][data-state="done"]').first();
  assert.equal(await doneRow.locator('[aria-label="done"], img[alt="done"]').count(), 1, 'a done row has a check mark with the text alternative `done`');
  await mustStep(page, '7', 'done', 20_000);
});

test('fr_ux_07_ac14_importing_step: a cancelled import closes the window and shows nothing else', async ({ page }) => {
  const core = await preview(page, C0507());
  await importHold(core, 'writing');
  await startImportRun(page);
  await click(cmd(page, 'import.cancel'), 'Cancel before the first write');
  await mustBeClosed(page, 'a cancelled import');
  assert.ok((await importCallsOf(core, 'import_cancel')).length >= 1, 'import_cancel');
  assert.ok((await eventually(() => importCallsOf(core, 'import_discard'), (c) => c.length > 0, 3000)).length > 0, 'import_discard');
  await page.waitForTimeout(500);
  assert.equal(await statusElement(page).count(), 0, 'no status element');
  assert.equal(await page.getByRole('alert').count(), 0, 'no alert');
});

test('fr_ux_07_ac14_importing_step: a failure shows R153\'s alert in place of the note', async ({ page }) => {
  const core = await preview(page, C0507());
  await importFail(core, { at: 'writing', error: { code: 'write', path: 'Pages/Trip notes.md', reason: 'No space left on device' } });
  await startImportRun(page);
  const alert = await must(alertBox(page), 'role="alert" on step 6', 10_000);
  assert.equal(flat(await alert.innerText()), 'The import stopped: Pages/Trip notes.md couldn’t be written. Nothing was added.', 'R153 "A write fails" with the reason `{path} couldn’t be written`');
  assert.equal(await dialog(page).getByText(/^Writing can’t be stopped half-way\. You can keep working/).count(), 0, 'the alert replaces the note');
  await must(closeBtn(page), 'the footer `Close`');
  assert.equal(await textOf(closeBtn(page)), 'Close', '`Close`');
  await click(closeBtn(page), 'Close');
  await mustBeClosed(page, 'Close');
  assert.ok((await importCallsOf(core, 'import_discard')).length > 0, 'Close calls import_discard');
});

// ------------------------------------------------------------------------------------------------ FR-UX-07 AC-15

test('fr_ux_07_ac15_hidden_import_continues', async ({ page }) => {
  const core = await preview(page, DECISIONS());
  await importHold(core, 'writing');
  await startImportRun(page);
  await importPace(core, 400);
  await importRelease(core);
  await eventually(async () => (await phases(page)).some((p) => p.state === 'running' && p.phase !== 'read'), (v) => v, 5000);
  // Hide: the window closes, the import goes on, the status element counts it.
  await click(hideBtn(page), 'Hide');
  await mustBeClosed(page, 'Hide');
  const st = await must(statusElement(page), 'the status element (span.import-status, role="status")', 3000);
  assert.equal(await st.getAttribute('role'), 'status', 'role="status"');
  const first = await eventually(() => statusText(page), (t) => RUNNING.test(t), 3000);
  assert.match(first, RUNNING, `\`Importing <done> of <total>\`: ${first}`);
  // Saves in the open vault are sent and answered meanwhile (the 100 ms is L6's, §9.3 (1)).
  await openNote(page, 'Úvodní stránka');
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type(' Doplněno během importu.');
  const saved = await eventually(async () => (await core.calls()).filter((c) => c.cmd === 'note_write' && c.ok === true), (c) => c.length > 0, 5000);
  assert.ok(saved.length > 0, 'a save is sent and answered while the import runs');
  assert.ok(await seen(statusElement(page)), 'the status element stays');
  // Reopen during the run: step 6.
  await click(statusOpen(page), 'the status element');
  await mustStep(page, '6', 'the status element reopens step 6');
  // Esc on step 6 hides too.
  await page.keyboard.press('Escape');
  await mustBeClosed(page, 'Esc on step 6');
  // The end, hidden: `Import finished` until opened.
  await importPace(core, 0);
  assert.equal(await eventually(() => statusText(page), (t) => /Import finished/.test(t), 20_000), 'Import finished', '`Import finished` at the end');
  await page.waitForTimeout(300);
  assert.equal(await statusText(page), 'Import finished', 'it stays');
  await (await must(statusOpen(page), 'the status button')).focus();
  await page.keyboard.press('Enter');
  await mustStep(page, '7', '⏎ on the status reopens step 7');
  assert.equal(await textOf(heading(page)), 'Import finished', 'step 7');
  await page.keyboard.press('Escape');
  await mustBeClosed(page, 'Esc on step 7');
  assert.equal(await statusElement(page).count(), 0, 'no status once the finished import was shown');
});

test('fr_ux_07_ac15_hidden_import_continues: Dismiss, a new Import…, the quit question', async ({ page }) => {
  const core = await preview(page, DECISIONS());
  await startImportRun(page);
  await click(hideBtn(page), 'Hide');
  assert.equal(await eventually(() => statusText(page), (t) => t === 'Import finished', 20_000), 'Import finished', 'finished while hidden');
  const dismiss = await must(statusElement(page).getByRole('button', { name: 'Dismiss', exact: true }), 'the status element\'s `Dismiss`');
  const discards = (await importCallsOf(core, 'import_discard')).length;
  await dismiss.click();
  assert.ok(!(await seen(statusElement(page), 500)), '`Dismiss` removes the status');
  assert.ok((await importCallsOf(core, 'import_discard')).length > discards, '`Dismiss` calls import_discard');
  // D-1579: Import… with no run starts at step 0 (and clears a finished status).
  await goTo(page, '3', { how: 'folder' });
  await next(page, '4a', 'step 3');
  await toPreview(page);
  await startImportRun(page);
  await click(hideBtn(page), 'Hide');
  await eventually(() => statusText(page), (t) => t === 'Import finished', 20_000);
  await paletteRun(page, 'Import…');
  await mustStep(page, '0', 'Import… after a finished hidden import starts anew (D-1579)');
  assert.equal(await statusElement(page).count(), 0, 'and clears the finished status');
  await page.keyboard.press('Escape');
  // The quit question during writing: shown, `Keep importing` is the default, Esc keeps importing.
  await goTo(page, '3', { how: 'folder' });
  await next(page, '4a', 'step 3');
  await toPreview(page);
  await importHold(core, 'writing');
  await startImportRun(page);
  await importPace(core, 400);
  await importRelease(core);
  await eventually(async () => (await phases(page)).some((p) => p.phase === 'create' && p.state !== 'pending'), (v) => v, 5000);
  await click(hideBtn(page), 'Hide');
  await emit(core, 'app:quit-requested');
  const q = await must(quitDialog(page), 'the dialog `An import is running. Quit anyway?`', 3000);
  assert.equal(await q.getAttribute('aria-modal'), 'true', 'modal');
  assert.equal(await q.locator('p').count(), 0, 'no body for a new vault (D-1584)');
  assert.equal(await eventually(() => page.evaluate(() => (document.activeElement?.textContent ?? '').trim()), (t) => t === 'Keep importing'), 'Keep importing', '`Keep importing` has the focus (the default)');
  assert.equal(await q.getByRole('button', { name: 'Quit anyway', exact: true }).count(), 1, '`Quit anyway`');
  await page.keyboard.press('Escape');
  assert.ok(!(await seen(q, 500)), 'Esc chooses `Keep importing`');
  assert.equal((await core.calls()).filter((c) => c.cmd === 'app_quit').length, 0, 'the app keeps running');
  assert.match(await statusText(page), RUNNING, 'the import goes on');
});

// ------------------------------------------------------------------------------------------------ FR-UX-07 AC-16

test('fr_ux_07_ac16_switching_vaults_during_an_import', async ({ page }) => {
  const KNIHOVNA = '/fake/home/Documents/Knihovna';
  const core = await startImport(page, {
    vault: osobniVault(), vaultPath: OSOBNI_PATH, imports: BOARD(),
    recent: [{ name: 'Osobní', path: OSOBNI_PATH, exists: true }, { name: 'Knihovna', path: KNIHOVNA, exists: true }],
    dirs: { [KNIHOVNA]: newEmptyVault('Knihovna'), [OSOBNI_PATH]: osobniVault() },
  });
  await goTo(page, '3');
  await click(radioStarting(page, 'Destination', 'This vault'), '`This vault · Osobní`');
  await next(page, '4a', 'step 3');
  await next(page, '5', '4a');
  await importHold(core, 'writing');
  await startImportRun(page);
  await importPace(core, 200);
  await importRelease(core);
  await eventually(async () => (await phases(page)).some((p) => p.phase === 'objects' && p.state === 'running'), (v) => v, 10_000);
  await click(hideBtn(page), 'Hide');
  // The switch from the title bar: not blocked, no question.
  await click(page.getByRole('button', { name: 'Vault: Osobní. Switch vault', exact: true }), 'the title-bar vault switcher');
  await click(page.getByRole('menu', { name: 'Vaults' }).getByRole('menuitemradio', { name: /^Knihovna/ }), '`Knihovna`');
  assert.ok((await eventually(() => vaultOpens(core), (v) => v.includes(KNIHOVNA), 3000)).includes(KNIHOVNA), 'vault_open(Knihovna)');
  assert.equal(await page.getByRole('dialog').count(), 0, 'the switch asks nothing');
  await must(page.getByRole('button', { name: 'Vault: Knihovna. Switch vault', exact: true }), 'Knihovna is open', 5000);
  // The status in the newly opened vault.
  assert.match(await eventually(() => statusText(page), (t) => RUNNING.test(t), 3000), RUNNING, 'Knihovna shows `Importing <done> of <total>`');
  assert.equal(await eventually(() => statusText(page), (t) => t === 'Import finished', 30_000), 'Import finished', 'then `Import finished`');
  // Step 7: Open vault (the target isn't the open vault); Open report switches back first.
  await click(statusOpen(page), 'the status');
  await mustStep(page, '7', 'step 7');
  assert.ok(await seen(cmd(page, 'import.openVault')), '`Open vault` is offered: Osobní isn\'t open');
  const opens = (await vaultOpens(core)).length;
  await click(cmd(page, 'import.openReport'), '`Open report`');
  const after = await eventually(() => vaultOpens(core), (v) => v.length > opens, 3000);
  assert.equal(after[opens], OSOBNI_PATH, '`Open report` opens Osobní first');
  await mustBeClosed(page, 'Open report');
  await must(page.getByRole('button', { name: 'Vault: Osobní. Switch vault', exact: true }), 'Osobní is open again', 5000);
  const calls = (await core.calls()).map((c) => c.cmd);
  assert.ok(calls.lastIndexOf('import_discard') > calls.lastIndexOf('vault_open'), 'import_discard after the vault_open');
});

// ------------------------------------------------------------------------------------------------ FR-IMP-19 AC-11

async function doneAfterC09(page: Page) {
  const plan = canned('plan-c09-unresolved-links-PKM-new.json');
  const core = await preview(page, C09());
  await startImportRun(page);
  await mustStep(page, '7', 'the run ends', 20_000);
  return { core, plan };
}

test('fr_imp_19_ac11_done_step: the step and Open report', async ({ page }) => {
  const { core, plan } = await doneAfterC09(page);
  const n = planNumbers(plan);
  assert.equal(await textOf(heading(page)), 'Import finished', 'the heading `Import finished`');
  const body = await shownText(dialog(page));
  assert.ok(body.includes(`${num(n.objects)} objects imported`), `\`${n.objects} objects imported\`: ${body}`);
  assert.ok(body.includes(`${num(n.attachments)} attachments · ${num(n.links)} links · into Capacities · PKM`), `the summary with the vault's name: ${body}`);
  const card = await must(dialog(page).getByRole('region', { name: `Import report · ${REPORT_DATE}` }).or(dialog(page).locator('section').filter({ hasText: `Import report · ${REPORT_DATE}` })).first(), `the card \`Import report · ${REPORT_DATE}\``);
  const cardText = await shownText(card);
  const rows: [string, number][] = [['Unresolved links', n.unresolved], ['Query stubs to rebuild', n.stubs], ['Ambiguous links', n.ambiguous], ['Merged values', n.merged], ['Dropped files', n.missing]];
  for (const [label, count] of rows) {
    if (count > 0) assert.ok(cardText.includes(label) && cardText.includes(num(count)), `the card shows \`${label} ${count}\`: ${cardText}`);
    else assert.ok(!cardText.includes(label), `a row with 0 is not shown: ${label}`);
  }
  if (n.unresolved > 0) assert.ok(cardText.includes('with their location'), 'Unresolved links: `with their location`');
  assert.equal(await dialog(page).getByText(/This import can’t be undone/).count(), 0, 'no `can’t be undone` for a new vault');
  assert.equal(await textOf(cmd(page, 'import.openReport')), 'Open report', '`Open report`');
  assert.equal(await textOf(cmd(page, 'import.openVault')), 'Open vault', '`Open vault`');
  assert.match((await cmd(page, 'import.openVault').getAttribute('class')) ?? '', /\bprimary\b/, '`Open vault` is the primary');
  // Open report: the new vault first, then its report Page.
  const target = await newVaultPath(core);
  assert.ok(target, 'the plan named the new vault');
  await click(cmd(page, 'import.openReport'), '`Open report`');
  assert.ok((await eventually(() => vaultOpens(core), (v) => v.includes(target!), 3000)).includes(target!), `vault_open(${target})`);
  await mustBeClosed(page, 'Open report');
  assert.equal(await eventually(() => mainName(page), (m) => m === `Import report ${REPORT_DATE} PKM`, 5000), `Import report ${REPORT_DATE} PKM`, 'the report Page is open');
});

test('fr_imp_19_ac11_done_step: Open vault', async ({ page }) => {
  const { core } = await doneAfterC09(page);
  const target = await newVaultPath(core);
  await click(cmd(page, 'import.openVault'), '`Open vault`');
  assert.ok((await eventually(() => vaultOpens(core), (v) => v.includes(target!), 3000)).includes(target!), `vault_open(${target})`);
  await mustBeClosed(page, 'Open vault');
  await must(page.getByRole('button', { name: 'Vault: Capacities · PKM. Switch vault', exact: true }), 'the new vault is open', 5000);
  assert.ok(await seen(main(page)), 'with its landing page (FR-UX-02 AC-16)');
});

// ------------------------------------------------------------------------------------------------ FR-IMP-19 AC-12

const NO_UNDO = 'This import can’t be undone. A backup from before it is in Settings › Backups. Restoring it brings back your earlier files and leaves the imported ones in place.';

test('fr_imp_19_ac12_no_undo_is_said_plainly', async ({ page }) => {
  const core = await startImport(page, { vault: osobniVault(), vaultPath: OSOBNI_PATH, imports: BOARD() });
  await goTo(page, '3');
  await click(radioStarting(page, 'Destination', 'This vault'), '`This vault · Osobní`');
  await next(page, '4a', 'step 3');
  await next(page, '5', '4a');
  await startImportRun(page);
  await mustStep(page, '7', 'done', 30_000);
  const body = await shownText(dialog(page));
  assert.ok(body.includes(NO_UNDO), `step 7 says \`${NO_UNDO}\``);
  const counts = body.indexOf('objects imported');
  assert.ok(counts >= 0 && body.indexOf(NO_UNDO) > counts, 'under the counts');
  assert.equal(await page.getByRole('button', { name: /^⟦?Undo⟧?$/ }).count(), 0, 'no `Undo` anywhere');
  assert.equal(await cmd(page, 'import.openVault').count(), 0, '`Open vault` is absent: the target is the open vault');
  await page.keyboard.press('Escape');
  await mustBeClosed(page, 'Esc on step 7');
  assert.equal(await page.getByRole('button', { name: /^⟦?Undo⟧?$/ }).count(), 0, 'no `Undo` after closing either');
  assert.deepEqual((await core.calls()).filter((c) => c.cmd === 'job_undo'), [], 'nothing is undone');
});

test('fr_imp_19_ac12_no_undo_is_said_plainly: not for a new vault', async ({ page }) => {
  await preview(page, DECISIONS());
  await startImportRun(page);
  await mustStep(page, '7', 'done', 20_000);
  assert.equal(await dialog(page).getByText(/This import can’t be undone/).count(), 0, 'no sentence for a new vault');
});
