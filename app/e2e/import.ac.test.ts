// Slice I2 real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/import-capacities.md, the
// window's criteria whose layers name L6 (contract docs/contracts/v1-import-window.md §9.1): FR-IMP-07 AC-10 (once,
// `c01-spaces` zipped, `TEGG_TEST_PICK_FILE`), FR-HIS-04 AC-14 (once, `Change…` with `TEGG_TEST_PICK_DIR`, a taken
// folder), FR-IMP-05 AC-10 (steps 3 and 5 with a copy of `target-existing-vault`: Cancel, Esc and quitting; snapshots of
// the vault and the new-vault place), FR-SYN-06 AC-45 (snapshots of the vault and its Application Support folders through
// every step up to the preview, then after an import into a new vault), FR-UX-03 AC-43 (the menu `File › Import…`),
// AC-44 (keyboard only, `c01-spaces` zipped, `Work`, the written vault as FR-IMP-22 AC-1 expects) and FR-UX-08 AC-19
// (once: the macOS accessibility tree has the names of steps 0, 3, 4a and 6). The importing, hiding, switching and done
// criteria are in import_run.ac.test.ts. Always TEGG_TEST=1 with the import test clock, a temporary Application Support
// and temporary copies of the fixtures (D-62). Keys go only to Tegg (D-799). Written from the ACs and the contract only
// (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  appiumDown, changedPaths, end as endSession, firstShown, marks, need, needMenuItem, osa, palette, press, ready, shown, sleep, textContains, tree, waitFor, type Driver,
} from './helpers/capture.ts';
import { cleanupImport, doneAfter, ensureDir, exportCopy, focusedLabel, freshImport, launchImport, markCount, placeEntries, stepAfter, supportTree, vaultTree, zipOf, type ImportCtx } from './helpers/import.ts';

after(appiumDown);
process.on('exit', appiumDown);

const TEGG = 'app.tegg.desktop';
async function enabled(d: Driver, label: string, ms = 5000): Promise<boolean> {
  return waitFor(async () => {
    const e = await firstShown(d, label);
    return !!e && String(await e.getAttribute('enabled').catch(() => 'false')) === 'true';
  }, ms);
}
async function textShown(d: Driver, text: string, ms = 3000): Promise<boolean> {
  return waitFor(async () => {
    for (const e of await d.$$(`-ios predicate string:${textContains(text)}`).catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) return true;
    return false;
  }, ms);
}
async function openImport(c: ImportCtx): Promise<void> {
  const from = markCount(c);
  palette('Import…');
  assert.ok(await stepAfter(c, '0', from), 'Import… from the palette opens step 0 (import-step:0)');
}
async function clickTo(c: ImportCtx, label: string, step: string, ms = 10_000): Promise<void> {
  assert.ok(await enabled(c.d!, label, ms), `\`${label}\` is enabled`);
  const from = markCount(c);
  await (await need(c.d!, label, 3000)).click();
  assert.ok(await stepAfter(c, step, from, ms), `\`${label}\` goes to step ${step}`);
}
/** Step 0 → 3 with c01 zipped (`Choose zip…`) and the space `space`. */
async function toWhere(c: ImportCtx, space = 'PKM'): Promise<void> {
  await openImport(c);
  await clickTo(c, 'Continue', '1');
  await (await need(c.d!, 'Choose zip…')).click();
  await clickTo(c, 'Continue', '2');
  await (await need(c.d!, space)).click();
  await clickTo(c, 'Continue', '3');
}
/** Steps 3 → 5 with `destination` (`A new vault` is the default). */
async function toPreview(c: ImportCtx, destination: 'new' | 'current' = 'new'): Promise<void> {
  if (destination === 'current') await (await need(c.d!, 'This vault · Osobní', 5000)).click();
  await clickTo(c, 'Continue', '4a');
  const from = markCount(c);
  await (await need(c.d!, 'Continue')).click();
  assert.ok(await waitFor(() => marks(c.log).slice(from).some((m) => m === 'import-step:5' || m === 'import-step:4c'), 10_000), '4a → 4c or 5');
  if (marks(c.log).slice(from).includes('import-step:4c')) await clickTo(c, 'Continue', '5');
}
function c01Zip(c: ImportCtx): string {
  return zipOf(exportCopy(c.base, 'c01-spaces'));
}

// ------------------------------------------------------------------------------------------------ FR-IMP-07 AC-10 (once)

test('fr_imp_07_ac10_source_step_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = freshImport('src');
  try {
    const zip = c01Zip(c);
    const d = await launchImport(c, { TEGG_TEST_PICK_FILE: zip, TEGG_TEST_IMPORT_PACE: '150' });
    await openImport(c);
    await clickTo(c, 'Continue', '1');
    assert.ok(await shown(d, 'Drop a Capacities export here', 3000), 'the drop area');
    assert.ok(!(await enabled(d, 'Continue', 500)), 'Continue is disabled before reading');
    await (await need(d, 'Choose zip…')).click();
    assert.ok(await shown(d, 'Reading the export', 3000), 'the progress bar `Reading the export`');
    assert.ok(await textShown(d, ' files…', 3000), 'its text `Reading <done> of <total> files…`');
    assert.ok(await enabled(d, 'Continue', 15_000), 'Continue is enabled once reading ended');
    assert.ok(await textShown(d, 'c01-spaces.zip', 2000), 'the row names the zip');
    assert.ok(await textShown(d, 'MB', 2000), 'with its size');
    // Stop: a second read, stopped; the empty drop area within 1 s.
    await (await need(d, 'Choose zip…')).click();
    assert.ok(await shown(d, 'Stop', 3000), '`Stop` while reading');
    const stop = await need(d, 'Stop');
    const t0 = Date.now();
    await stop.click();
    assert.ok(await waitFor(async () => !(await shown(d, 'Reading the export', 100)), 1500), 'Stop ends reading');
    assert.ok(Date.now() - t0 <= 1500, `within 1 s (${Date.now() - t0} ms)`);
    assert.ok(!(await enabled(d, 'Continue', 300)), 'Continue is disabled again (the empty drop area)');
    // Read again and go on with ⏎ on Continue.
    await (await need(d, 'Choose zip…')).click();
    assert.ok(await enabled(d, 'Continue', 15_000), 'Continue enabled');
    const from = markCount(c);
    await (await need(d, 'Continue')).click();
    assert.ok(await stepAfter(c, '2', from), 'step 2 (three spaces)');
  } finally {
    await cleanupImport(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-HIS-04 AC-14 (once)

test('fr_his_04_ac14_where_step_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = freshImport('where');
  try {
    const zip = c01Zip(c);
    const taken = ensureDir(join(c.base, 'Projekty'));
    mkdirSync(join(taken, 'Capacities · PKM'));
    const d = await launchImport(c, { TEGG_TEST_PICK_FILE: zip, TEGG_TEST_PICK_DIR: taken });
    await toWhere(c, 'PKM');
    assert.ok(await shown(d, 'Destination', 3000), 'radiogroup `Destination`');
    assert.ok(await textShown(d, 'Recommended', 3000), 'the badge `Recommended`');
    assert.ok(await textShown(d, 'Capacities · PKM', 3000), 'the name `Capacities · PKM`');
    assert.ok(await textShown(d, 'This vault · Osobní', 3000), '`This vault · Osobní`');
    const before = placeEntries(c);
    await (await need(d, 'Change…')).click();
    assert.ok(await textShown(d, 'Projekty/Capacities · PKM', 5000), 'the path follows the picked folder');
    assert.ok(await textShown(d, 'A folder named “Capacities · PKM” already exists there.', 5000), 'the TargetExists text');
    assert.ok(!(await enabled(d, 'Continue', 500)), 'Continue is disabled');
    assert.deepEqual(placeEntries(c), before, 'nothing created at the place');
    assert.deepEqual(readdirSync(taken), ['Capacities · PKM'], 'nothing created in the picked folder');
  } finally {
    await cleanupImport(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-IMP-05 AC-10

test('fr_imp_05_ac10_cancel_writes_nothing_real_app', { timeout: 900_000 }, async () => {
  await ready();
  const c = freshImport('cancel');
  try {
    const zip = c01Zip(c);
    const env = { TEGG_TEST_PICK_FILE: zip };
    const v0 = vaultTree(c);
    const s0 = supportTree(c);
    const p0 = placeEntries(c);
    const unchanged = (what: string) => {
      assert.deepEqual(changedPaths(v0, vaultTree(c)), [], `${what}: every vault file untouched (bytes, mtime, inode), nothing created`);
      assert.deepEqual(changedPaths(s0, supportTree(c)), [], `${what}: no backup zip, no journal`);
      assert.deepEqual(placeEntries(c), p0, `${what}: no folder at the new vault's place`);
    };
    for (const step of ['3', '5'] as const) {
      for (const how of ['Cancel', 'Esc', 'quit'] as const) {
        const d = await launchImport(c, env);
        await toWhere(c, 'PKM');
        await (await need(d, 'This vault · Osobní', 5000)).click();
        if (step === '5') await toPreview(c, 'current');
        if (how === 'Cancel') await (await need(d, 'Cancel')).click();
        else if (how === 'Esc') press('escape');
        else {
          osa(`tell application id "${TEGG}" to activate`);
          press('q', ['command']);
          assert.ok(await waitFor(async () => !(await shown(d, 'Cancel', 100)), 10_000), `${step}, quit: the app quits`);
        }
        if (how !== 'quit') assert.ok(await waitFor(async () => !(await shown(d, 'Destination', 100)) && !(await shown(d, 'Will be imported', 100)), 3000), `${step}, ${how}: the window closes`);
        await sleep(1000);
        unchanged(`step ${step}, ${how}`);
        await endSession(c.d);
        c.d = undefined;
      }
    }
  } finally {
    await cleanupImport(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-45

test('fr_syn_06_ac45_import_window_writes_nothing_real_app', { timeout: 600_000 }, async () => {
  await ready();
  const c = freshImport('syn45');
  try {
    const zip = c01Zip(c);
    const d = await launchImport(c, { TEGG_TEST_PICK_FILE: zip });
    const v0 = vaultTree(c);
    const s0 = supportTree(c);
    const p0 = placeEntries(c);
    const check = (what: string) => {
      assert.deepEqual(changedPaths(v0, vaultTree(c)), [], `${what}: the vault is untouched`);
      assert.deepEqual(changedPaths(s0, supportTree(c)), [], `${what}: its Application Support folders are untouched`);
      assert.deepEqual(placeEntries(c), p0, `${what}: nothing at the new vault's place`);
    };
    await toWhere(c, 'PKM');
    check('steps 0–3');
    await (await need(d, 'This vault · Osobní', 5000)).click();
    await toPreview(c, 'current');
    check('This vault up to the preview');
    const back = markCount(c);
    await (await need(d, 'Back')).click();
    assert.ok(await waitFor(() => marks(c.log).slice(back).some((m) => /^import-step:(4a|4c)$/.test(m)), 5000), 'Back');
    await (await need(d, 'Cancel')).click();
    check('Back and Cancel');
    await toWhere(c, 'PKM');
    await toPreview(c, 'new');
    check('A new vault up to the preview');
    const from = markCount(c);
    await (await need(d, 'Import 3 objects', 5000)).click();
    assert.ok(await doneAfter(c, from, 60_000), 'the import into a new vault ends (import-done)');
    assert.deepEqual(changedPaths(v0, vaultTree(c)), [], 'after Import into a new vault the open vault is still untouched');
    assert.deepEqual(placeEntries(c), ['Capacities · PKM'], 'the new vault is the only new folder at the place');
  } finally {
    await cleanupImport(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-43 (the menu)

test('fr_ux_03_ac43_import_entry_points_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = freshImport('menu');
  try {
    const d = await launchImport(c);
    const from = markCount(c);
    const file = await d.$('-ios predicate string:elementType == 56 AND (title == "File" OR label == "File")');
    assert.ok(await file.isExisting().catch(() => false), 'the app menu has `File`');
    await file.click();
    await (await needMenuItem(d, 'Import…', 3000)).click();
    assert.ok(await stepAfter(c, '0', from), '`File › Import…` opens step 0');
    assert.ok(await shown(d, 'Import', 3000), 'the window `Import`');
    // With the window open, the menu brings it forward (no second window).
    await file.click();
    await (await needMenuItem(d, 'Import…', 3000)).click();
    await sleep(500);
    assert.equal(marks(c.log).slice(from).filter((m) => m === 'import-step:0').length, 1, 'no second window (no new step 0)');
  } finally {
    await cleanupImport(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-44

/** Tab until the focused element's label is `label` (keys only). */
async function tabTo(d: Driver, label: string, max = 30): Promise<void> {
  for (let i = 0; i < max && (await focusedLabel(d)) !== label; i++) press('tab');
  assert.equal(await focusedLabel(d), label, `\`${label}\` is reached with Tab`);
}

test('fr_ux_03_ac44_import_without_the_pointer_real_app', { timeout: 600_000 }, async () => {
  await ready();
  const c = freshImport('keys');
  try {
    const zip = c01Zip(c);
    const d = await launchImport(c, { TEGG_TEST_PICK_FILE: zip });
    await openImport(c);
    let from = markCount(c);
    await tabTo(d, 'Continue');
    press('enter');
    assert.ok(await stepAfter(c, '1', from), 'step 1');
    await tabTo(d, 'Choose zip…');
    press('enter');
    assert.ok(await enabled(d, 'Continue', 15_000), 'read');
    from = markCount(c);
    await tabTo(d, 'Continue');
    press('enter');
    assert.ok(await stepAfter(c, '2', from), 'step 2');
    await tabTo(d, 'PKM');
    press('down');
    from = markCount(c);
    await tabTo(d, 'Continue');
    press('enter');
    assert.ok(await stepAfter(c, '3', from), 'step 3');
    assert.ok(await enabled(d, 'Continue', 10_000), 'the plan is there');
    from = markCount(c);
    await tabTo(d, 'Continue');
    press('enter');
    assert.ok(await stepAfter(c, '4a', from), '4a');
    // A `becomes` menu (the Tasks row keeps Task, so the vault is FR-IMP-22 AC-1's) and 4b, by keys.
    await tabTo(d, 'Task');
    press('enter');
    assert.ok(await shown(d, 'Tasks becomes', 3000), 'menu `Tasks becomes`');
    press('escape');
    press('enter');
    for (let i = 0; i < 6 && (await focusedLabel(d)) !== 'Task'; i++) press('down');
    press('enter');
    from = markCount(c);
    for (let i = 0; i < 30 && !(await focusedLabel(d)).startsWith('Map attributes'); i++) press('tab');
    press('enter');
    assert.ok(await stepAfter(c, '4b', from), '4b');
    from = markCount(c);
    press('escape');
    assert.ok(await stepAfter(c, '4a', from), 'back on 4a');
    from = markCount(c);
    await tabTo(d, 'Continue');
    press('enter');
    assert.ok(await waitFor(() => marks(c.log).slice(from).some((m) => m === 'import-step:5' || m === 'import-step:4c'), 5000), '4c or 5');
    if (marks(c.log).slice(from).includes('import-step:4c')) { from = markCount(c); await tabTo(d, 'Continue'); press('enter'); assert.ok(await stepAfter(c, '5', from), '5'); }
    from = markCount(c);
    await tabTo(d, 'Import 3 objects');
    press('enter');
    assert.ok(await doneAfter(c, from, 60_000), 'the import ends');
    await tabTo(d, 'Open vault');
    press('enter');
    // The written vault is FR-IMP-22 AC-1's: Work's objects only (and the report).
    const root = join(c.place, 'Capacities · Work');
    assert.ok(await waitFor(() => existsSync(join(root, '.tegg/vault.yml')), 10_000), 'the new vault `Capacities · Work`');
    const notes = Object.keys(tree(root)).filter((p) => p.endsWith('.md') && !p.startsWith('.tegg/')).sort();
    assert.deepEqual(notes, ['Pages/Import report 2026-11-12 Work.md', 'Pages/Quarterly plan.md', 'Pages/Work home.md', 'Tasks/Work task.md'], 'Work\'s objects only, and the report');
    for (const p of notes.filter((x) => !x.includes('Import report'))) {
      assert.match(readFileSync(join(root, p), 'utf8'), /^import-id: "?capacities:Work\//m, `${p}: imported from Work`);
    }
  } finally {
    await cleanupImport(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-19 (once)

test('fr_ux_08_ac19_import_for_voiceover_real_app', { timeout: 600_000 }, async () => {
  await ready();
  const c = freshImport('ax');
  try {
    const zip = c01Zip(c);
    const d = await launchImport(c, { TEGG_TEST_PICK_FILE: zip, TEGG_TEST_IMPORT_PACE: '300' });
    await openImport(c);
    for (const name of ['Import', 'Source', 'Capacities export']) assert.ok(await shown(d, name, 3000), `step 0: the tree has \`${name}\``);
    await clickTo(c, 'Continue', '1');
    await (await need(d, 'Choose zip…')).click();
    await clickTo(c, 'Continue', '2', 15_000);
    await clickTo(c, 'Continue', '3');
    for (const name of ['Import from Capacities', 'Step 3 of 6', 'Destination']) assert.ok(await shown(d, name, 3000), `step 3: the tree has \`${name}\``);
    assert.ok(await textShown(d, 'A new vault', 3000), 'step 3: `A new vault`');
    await clickTo(c, 'Continue', '4a');
    for (const name of ['Step 4 of 6', 'In Capacities', 'Becomes in Tegg', 'Attributes']) assert.ok(await shown(d, name, 3000), `4a: the tree has \`${name}\``);
    assert.ok(await textShown(d, 'Map attributes, ', 3000), '4a: a status button `Map attributes, <k> of <n> mapped`');
    await toPreviewFrom4a(c);
    const from = markCount(c);
    await (await need(d, 'Import 3 objects', 5000)).click();
    assert.ok(await stepAfter(c, '6', from), 'step 6');
    for (const name of ['Step 6 of 6', 'Import steps']) assert.ok(await shown(d, name, 5000), `step 6: the tree has \`${name}\``);
    assert.ok(await textShown(d, 'Writing objects', 5000), 'step 6: `Writing objects`');
  } finally {
    await cleanupImport(c);
  }
});
async function toPreviewFrom4a(c: ImportCtx) {
  const from = markCount(c);
  await (await need(c.d!, 'Continue')).click();
  assert.ok(await waitFor(() => marks(c.log).slice(from).some((m) => m === 'import-step:5' || m === 'import-step:4c'), 10_000), '4a → 4c or 5');
  if (marks(c.log).slice(from).includes('import-step:4c')) await clickTo(c, 'Continue', '5');
}
