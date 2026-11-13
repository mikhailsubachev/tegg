// Slice I2, L5 (WebKit + fake core): the Import window's Source and Space steps of docs/acceptance/import-capacities.md:
// FR-IMP-07 AC-10 (choose a zip or a folder, a drop, the progress bar, Stop, a drop that isn't a source), AC-11 (R153's
// source errors, unreadable entries), FR-IMP-22 AC-5 (the Space step), AC-6 (one space skips it). Interface
// docs/contracts/v1-import-window.md §2.1, §2.2, §3.2, §3.3 (steps 1, 2), §5.3, §7. Written from the ACs and the contract
// only (D-61). Lookups go through `must` (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  BROKEN_ZIP, C01, C01_DIR, C01_ZIP, C12, DL, absent, alertBox, backBtn, box, canned, click, cmd, continueBtn, description, dialog, dropArea, enabledSoon,
  eventually, flat, heading, importCallsOf, importPace, isDisabled, must, mustStep, next, openImport, progressbar, radioStarting, radiogroup, radios,
  rx, seen, shownText, sourceRow, startImport, stepperInfo, textOf,
} from './import-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const READING = /^⟦?Reading (\d[\d  ]*) of (\d[\d  ]*) files…⟧?$/;
const center = async (loc: Parameters<typeof box>[0]) => {
  const b = await box(loc);
  assert.ok(b, 'the drop area has a box');
  return { x: Math.round(b!.x + b!.width / 2), y: Math.round(b!.y + b!.height / 2) };
};
/** `dropFiles` of the fake core (6A): Tauri's drag-drop events with the paths at a window position. */
const drop = async (core: Awaited<ReturnType<typeof startImport>>, paths: string[], at: { x: number; y: number }) => core.dropFiles(paths, at);

// ------------------------------------------------------------------------------------------------ FR-IMP-07 AC-10

test('fr_imp_07_ac10_source_step: Choose zip… reads with progress, then ⏎ on Continue goes to the Space step', async ({ page }) => {
  const core = await startImport(page, { imports: C01() });
  const scan = canned('scan-c01-spaces-zip.json');
  await openImport(page);
  await next(page, '1', 'step 0');
  // The empty Source step (R152).
  const area = await must(dropArea(page), 'the drop area (div.import-drop)');
  assert.equal(await area.getAttribute('role'), 'group', 'the drop area is a group');
  assert.equal(await area.getAttribute('aria-label'), 'Drop a Capacities export here', 'named `Drop a Capacities export here`');
  const empty = await shownText(area);
  assert.ok(empty.includes('Drop a Capacities export here') && empty.includes('A .zip file or an already extracted folder'), `the drop area's texts: ${empty}`);
  for (const [c, t] of [['import.chooseZip', 'Choose zip…'], ['import.chooseFolder', 'Choose folder…']]) assert.equal(await textOf(area.locator(`button[data-command="${c}"]`)), t, `${t} inside the drop area`);
  assert.ok(await seen(dialog(page).getByText('Reading the export changes nothing in your vault.', { exact: true })), 'the line `Reading the export changes nothing in your vault.`');
  assert.equal(await isDisabled(continueBtn(page)), true, 'Continue is aria-disabled before reading');
  assert.equal(await continueBtn(page).getAttribute('aria-disabled'), 'true', 'Continue: aria-disabled="true" (D-130), not removed');

  // Reading, slowed down: the progress bar follows the events.
  await importPace(core, 120);
  await click(cmd(page, 'import.chooseZip'), 'Choose zip…');
  const bar = await must(progressbar(page), 'progressbar `Reading the export`', 3000);
  assert.equal(await bar.getAttribute('aria-valuemin'), '0', 'aria-valuemin 0');
  assert.equal(Number(await bar.getAttribute('aria-valuemax')), scan.files, `aria-valuemax = the scan's ${scan.files} files`);
  assert.ok(await seen(dialog(page).locator('button[data-command="import.stop"]')), 'the button `Stop` while reading');
  const seenTexts: string[] = [];
  const end = Date.now() + 5000;
  while (Date.now() < end && (await seen(progressbar(page), 50))) {
    const v = flat(await progressbar(page).getAttribute('aria-valuetext', { timeout: 300 }).catch(() => ''));
    const now = Number(await progressbar(page).getAttribute('aria-valuenow', { timeout: 300 }).catch(() => 'NaN'));
    if (v && !seenTexts.includes(v)) {
      seenTexts.push(v);
      const m = READING.exec(v);
      assert.ok(m, `aria-valuetext reads \`Reading <done> of <total> files…\`: ${v}`);
      assert.equal(Number(m![1].replace(/\s/g, '')), now, `the text's done equals aria-valuenow (${v})`);
      assert.equal(Number(m![2].replace(/\s/g, '')), scan.files, 'the text\'s total is the scan\'s files');
      assert.ok(await seen(dialog(page).getByText(v, { exact: true }), 300), `the same text is visible: ${v}`);
    }
    await page.waitForTimeout(40);
  }
  assert.ok(seenTexts.length >= 2, `the progress text follows the reading events: ${seenTexts.join(' | ')}`);
  // Done: the row with the zip's name and size; Continue enabled; ⏎ on it goes on (three spaces → step 2).
  await enabledSoon(continueBtn(page), 'Continue after reading');
  const row = await shownText(sourceRow(page));
  assert.ok(row.includes(scan.name), `the row names the zip (${scan.name}): ${row}`);
  assert.match(row, /\d([.,]\d)?\s?MB/, `the row shows the zip's size in MB: ${row}`);
  assert.ok(await absent(progressbar(page), 1000), 'the progress bar is gone once reading ended');
  assert.deepEqual(await importCallsOf(core, 'import_pick_source'), [{ kind: 'zip' }], 'Choose zip… asks for a zip');
  assert.deepEqual((await importCallsOf(core, 'import_scan')).map((a) => a.path), [C01_ZIP], 'then reads the picked zip');
  await (await must(continueBtn(page), 'Continue')).focus();
  await page.keyboard.press('Enter');
  await mustStep(page, '2', '⏎ on Continue with three spaces');
});

test('fr_imp_07_ac10_source_step: Choose folder… and a drop read; Stop returns to the empty drop area; other drops do nothing', async ({ page }) => {
  const core = await startImport(page, { imports: C01() });
  const folder = canned('scan-c01-spaces.json');
  await openImport(page);
  await next(page, '1', 'step 0');
  // Choose folder…: the row names the folder, no size.
  await click(cmd(page, 'import.chooseFolder'), 'Choose folder…');
  await enabledSoon(continueBtn(page), 'Continue after reading the folder');
  const row = await shownText(sourceRow(page));
  assert.ok(row.includes(folder.name), `the row names the folder (${folder.name}): ${row}`);
  assert.doesNotMatch(row, /MB|GB/, `a folder shows no size: ${row}`);
  assert.deepEqual((await importCallsOf(core, 'import_pick_source')).map((a) => a.kind), ['folder'], 'Choose folder… asks for a folder');
  assert.deepEqual((await importCallsOf(core, 'import_scan')).map((a) => a.path), [C01_DIR], 'and reads it');

  // A drop on the drop area starts reading (Tauri's drag-drop event, §3.3).
  await drop(core, [C01_ZIP], await center(dropArea(page)));
  assert.deepEqual((await eventually(() => importCallsOf(core, 'import_scan'), (c) => c.length === 2, 3000)).map((a) => a.path), [C01_DIR, C01_ZIP], 'the dropped zip is read');
  await enabledSoon(continueBtn(page), 'Continue after reading the dropped zip');
  assert.ok((await shownText(sourceRow(page))).includes('c01-spaces.zip'), 'the row names the dropped zip');

  // A drop that is neither a .zip nor a folder does nothing: no alert, the row and Continue stay.
  await drop(core, [`${DL}/Poznámky.txt`], await center(dropArea(page)));
  await page.waitForTimeout(500);
  assert.equal(await alertBox(page).count(), 0, 'no alert after dropping a .txt');
  assert.ok((await shownText(sourceRow(page))).includes('c01-spaces.zip'), 'the row still names the zip');
  assert.equal(await isDisabled(continueBtn(page)), false, 'Continue stays enabled');

  // Stop: ends reading within 1 s and returns to the empty drop area.
  await importPace(core, 400);
  await click(cmd(page, 'import.chooseZip'), 'Choose zip…');
  await must(progressbar(page), 'the progress bar', 3000);
  const t0 = Date.now();
  await click(cmd(page, 'import.stop'), 'Stop');
  assert.ok(await absent(progressbar(page), 1500), 'the progress bar goes');
  assert.ok(Date.now() - t0 <= 1500, `Stop ends reading within 1 s (${Date.now() - t0} ms)`);
  assert.ok(await absent(sourceRow(page), 1000), 'the empty drop area: no source row');
  assert.equal(await isDisabled(continueBtn(page)), true, 'Continue is aria-disabled again');
  assert.ok((await importCallsOf(core, 'import_cancel')).length >= 1, 'Stop calls import_cancel');
  await mustStep(page, '1', 'after Stop');
});

// ------------------------------------------------------------------------------------------------ FR-IMP-07 AC-11

test('fr_imp_07_ac11_source_errors', async ({ page }) => {
  const cases: [string, 'NotCapacities' | 'UnreadableArchive' | 'EncryptedArchive' | 'Empty' | 'SourceGone', string][] = [
    [`${DL}/Poznámky.zip`, 'NotCapacities', 'This doesn’t look like a Capacities export. Choose the .zip file or the folder that Capacities exported.'],
    [`${DL}/Rozbitý.zip`, 'UnreadableArchive', 'This zip file can’t be read. Export it again from Capacities, or extract it and choose the folder.'],
    [`${DL}/Zamčený.zip`, 'EncryptedArchive', 'This zip file is password-protected. Extract it first, then choose the folder.'],
    [`${DL}/Prázdný.zip`, 'Empty', 'This export has no objects.'],
    [`${DL}/Zmizelý.zip`, 'SourceGone', 'The export can’t be read any more.'],
  ];
  const sources = Object.fromEntries([...cases.map(([p, error]) => [p, { error }]), [C01_ZIP, { scan: 'scan-c01-spaces-zip.json' }], [BROKEN_ZIP, { scan: 'scan-unreadable.json' }]]);
  const core = await startImport(page, { imports: C01({ sources, pickFile: C01_ZIP }) });
  await openImport(page);
  await next(page, '1', 'step 0');
  for (const [path, kind, text] of cases) {
    await drop(core, [path], await (async () => { const b = await box(dropArea(page)); return { x: Math.round(b!.x + 20), y: Math.round(b!.y + 20) }; })());
    const alert = await must(alertBox(page), `${kind}: role="alert"`, 3000);
    assert.equal(flat(await alert.innerText()), text, `${kind}: R153's text`);
    assert.equal(await alertBox(page).count(), 1, `${kind}: one alert`);
    const below = await page.evaluate(() => {
      const a = document.querySelector('[data-import-step] [role="alert"]')?.getBoundingClientRect();
      const r = document.querySelector('[data-import-step] div.import-source')?.getBoundingClientRect();
      return a && r ? a.top >= r.top : null;
    });
    assert.equal(below, true, `${kind}: the alert is under the row`);
    assert.equal(await isDisabled(continueBtn(page)), true, `${kind}: Continue stays aria-disabled`);
  }
  // A new choice clears the alert.
  await click(cmd(page, 'import.chooseZip'), 'Choose zip…');
  assert.ok(await absent(alertBox(page), 3000), 'a new choice clears the alert');
  await enabledSoon(continueBtn(page), 'Continue after a good source');
  // Unreadable entries only: the count line (not an alert) and Continue enabled.
  await drop(core, [BROKEN_ZIP], await (async () => { const b = await box(dropArea(page)); return { x: Math.round(b!.x + 20), y: Math.round(b!.y + 20) }; })());
  await must(dialog(page).getByText('2 files couldn’t be read. They will be listed in the report.', { exact: true }), 'the line `2 files couldn’t be read. They will be listed in the report.`', 3000);
  assert.equal(await alertBox(page).count(), 0, 'unreadable entries are no alert');
  await enabledSoon(continueBtn(page), 'Continue with unreadable entries only');
});

// ------------------------------------------------------------------------------------------------ FR-IMP-22 AC-5, AC-6

test('fr_imp_22_ac5_space_step', async ({ page }) => {
  const core = await startImport(page, { imports: C01() });
  const scan = canned('scan-c01-spaces-zip.json');
  await openImport(page);
  await next(page, '1', 'step 0');
  await click(cmd(page, 'import.chooseZip'), 'Choose zip…');
  await next(page, '2', 'step 1 with three spaces');
  assert.ok(await seen(dialog(page).getByText('This export has 3 spaces. One space is imported at a time.', { exact: true })), 'the text `This export has 3 spaces. One space is imported at a time.`');
  await must(radiogroup(page, 'Space'), 'radiogroup `Space`');
  const list = radios(page, 'Space');
  const names = await list.evaluateAll((rs) => rs.map((r) => (r.getAttribute('aria-label') ?? (r as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim()));
  assert.deepEqual(names, ['PKM', 'Work', 'IDC'], 'PKM and Work (3 objects each, by name) before IDC (2)');
  const want = (scan.spaces as any[]).map((s) => `${s.objects} objects · ${s.types.length} types`);
  assert.deepEqual(want.slice(0, 2), ['3 objects · 2 types', '3 objects · 2 types'], 'setup: the canned scan has PKM and Work with 3 objects of 2 types');
  for (const [i, n] of names.entries()) assert.equal(await description(list.nth(i)), want[i], `${n}: description \`<n> objects · <m> types\``);
  assert.deepEqual(await list.evaluateAll((rs) => rs.map((r) => r.getAttribute('aria-checked'))), ['true', 'false', 'false'], 'the first is checked');
  assert.ok(await seen(dialog(page).getByText('Run the import again for the other spaces. Their types are matched to the types you already have.', { exact: true })), 'the hint');
  // ↑/↓ move the choice.
  await list.nth(0).focus();
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await eventually(() => list.evaluateAll((rs) => rs.map((r) => r.getAttribute('aria-checked'))), (c) => c[1] === 'true'), ['false', 'true', 'false'], '↓ checks Work');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  assert.deepEqual(await list.evaluateAll((rs) => rs.map((r) => r.getAttribute('aria-checked'))), ['false', 'true', 'false'], '↓ then ↑: Work again');
  // Back: step 1 with the source still read.
  await click(backBtn(page), 'Back');
  await mustStep(page, '1', 'Back on step 2');
  assert.ok((await shownText(sourceRow(page))).includes('c01-spaces.zip'), 'the source is still shown');
  assert.equal(await isDisabled(continueBtn(page)), false, 'Continue is still enabled (the scan kept)');
  assert.equal((await importCallsOf(core, 'import_scan')).length, 1, 'no second read');
  await next(page, '2', 'Continue again');
  // Continue: step 3 with the checked space.
  await click(radioStarting(page, 'Space', 'Work'), 'Work');
  await next(page, '3', 'step 2');
  const where = await eventually(() => importCallsOf(core, 'import_where'), (c) => c.length > 0);
  assert.deepEqual(where.map((a) => a.space), ['Work'], 'step 3 asks import_where for Work');
  assert.ok((await importCallsOf(core, 'import_plan')).every((a) => a.space === 'Work'), 'and plans Work');
});

test('fr_imp_22_ac6_single_space_skips', async ({ page }) => {
  const core = await startImport(page, { imports: C12() });
  await openImport(page);
  await next(page, '1', 'step 0');
  await click(cmd(page, 'import.chooseFolder'), 'Choose folder…');
  await next(page, '3', 'Continue on step 1 with one space opens step 3');
  assert.equal((await stepperInfo(page)).name, 'Step 3 of 6', 'the stepper reads `Step 3 of 6`');
  assert.equal(await textOf(heading(page)), 'Import from Capacities', 'the heading');
  assert.deepEqual((await eventually(() => importCallsOf(core, 'import_where'), (c) => c.length > 0)).map((a) => a.space), ['PKM'], 'the only space is chosen');
  await click(backBtn(page), 'Back');
  await mustStep(page, '1', 'Back on step 3 returns to step 1');
  assert.ok((await shownText(sourceRow(page))).includes('c12-task-dates'), 'with the source still read');
  assert.equal(await page.getByRole('radiogroup', { name: rx('Space') }).count(), 0, 'no Space step was shown');
});
