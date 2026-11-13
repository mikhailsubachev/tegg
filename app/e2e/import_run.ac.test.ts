// Slice I2 real-app tests (L6, Appium mac2 on the built test app, D-382): importing and done of
// docs/acceptance/import-capacities.md (contract docs/contracts/v1-import-window.md §9.1, "once" tests): FR-UX-07 AC-14
// (`c05-media-objects` into a new vault with `TEGG_TEST_IMPORT_PACE`: the phase list, Cancel disabled while writing),
// AC-15 (`Hide`, the status element, an edit saved meanwhile with its delay measured against a save without an import,
// reopen; the quit question during `writing` and `Keep importing`), AC-16 (an import into the open vault, a switch to
// another vault from the title-bar switcher during `writing`, the status there, `Open report` back), FR-IMP-19 AC-11
// (`c09-unresolved-links` into a new vault, `Open report`, and in a second run `Open vault`). Always TEGG_TEST=1 with the
// import test clock, a temporary Application Support and temporary copies of the fixtures (D-62). Keys go only to Tegg
// (D-799). Written from the ACs and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  appiumDown, end, firstShown, marks, need, needMenuItem, osa, palette, press, ready, shown, sleep, textContains, typeAscii, waitFile, waitFor, type Driver,
} from './helpers/capture.ts';
import { cleanupImport, doneAfter, ensureDir, existingVault, exportCopy, freshImport, launchImport, markCount, stepAfter, type ImportCtx } from './helpers/import.ts';

after(appiumDown);
process.on('exit', appiumDown);

const TEGG = 'app.tegg.desktop';
const RUNNING = /^Importing \d[\d  ]* of \d[\d  ]*$/;
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
/** The status element's button text (`Importing <done> of <total>`, `Import finished`). */
async function statusSays(d: Driver, ok: (t: string) => boolean, ms: number): Promise<string> {
  let last = '';
  await waitFor(async () => {
    for (const e of await d.$$('-ios predicate string:label BEGINSWITH "Import" OR title BEGINSWITH "Import"').catch(() => [] as any[])) {
      const l = String((await e.getAttribute('label').catch(() => '')) || (await e.getAttribute('title').catch(() => '')));
      if (ok(l) && (await e.isDisplayed().catch(() => false))) { last = l; return true; }
    }
    return false;
  }, ms);
  return last;
}
async function clickTo(c: ImportCtx, label: string, step: string, ms = 10_000): Promise<void> {
  assert.ok(await enabled(c.d!, label, ms), `\`${label}\` is enabled`);
  const from = markCount(c);
  await (await need(c.d!, label, 3000)).click();
  assert.ok(await stepAfter(c, step, from, ms), `\`${label}\` goes to step ${step}`);
}
/** Import… → `Choose folder…` (the hook's folder, one space PKM) → step 3 → destination → step 5. */
async function toPreview(c: ImportCtx, destination: 'new' | 'current'): Promise<void> {
  const from0 = markCount(c);
  palette('Import…');
  assert.ok(await stepAfter(c, '0', from0), 'step 0');
  await clickTo(c, 'Continue', '1');
  await (await need(c.d!, 'Choose folder…')).click();
  await clickTo(c, 'Continue', '3', 20_000);
  if (destination === 'current') await (await need(c.d!, 'This vault · Osobní', 5000)).click();
  await clickTo(c, 'Continue', '4a');
  const from = markCount(c);
  await (await need(c.d!, 'Continue')).click();
  assert.ok(await waitFor(() => marks(c.log).slice(from).some((m) => m === 'import-step:5' || m === 'import-step:4c'), 10_000), '4a → 4c or 5');
  if (marks(c.log).slice(from).includes('import-step:4c')) await clickTo(c, 'Continue', '5');
}
/** Step 5's `Import <n> objects`. */
async function pressImport(c: ImportCtx): Promise<number> {
  const e = await c.d!.$('-ios predicate string:elementType == 9 AND title BEGINSWITH "Import " AND title ENDSWITH " objects"');
  assert.ok(await e.isExisting().catch(() => false), '`Import <n> objects`');
  const from = markCount(c);
  await e.click();
  assert.ok(await stepAfter(c, '6', from), 'step 6');
  return from;
}

// ------------------------------------------------------------------------------------------------ FR-UX-07 AC-14 (once)

test('fr_ux_07_ac14_importing_step_real_app', { timeout: 600_000 }, async () => {
  await ready();
  const c = freshImport('run14');
  try {
    const src = exportCopy(c.base, 'c05-media-objects');
    const d = await launchImport(c, { TEGG_TEST_PICK_SOURCE_DIR: src, TEGG_TEST_IMPORT_PACE: '250' });
    await toPreview(c, 'new');
    const from = await pressImport(c);
    for (const label of ['Reading the export', 'Creating the vault', 'Writing objects', 'Copying attachments', 'Writing the report']) {
      assert.ok(await textShown(d, label, 5000), `the phase \`${label}\``);
    }
    // The first write: Cancel disabled, with its reason; Hide enabled.
    assert.ok(await waitFor(async () => !(await enabled(d, 'Cancel', 100)), 15_000), 'Cancel is disabled from the first write');
    const cancel = await firstShown(d, 'Cancel');
    assert.ok(String(await cancel?.getAttribute('help').catch(() => '') ?? '').includes('Writing can’t be stopped half-way.') || (await textShown(d, 'Writing can’t be stopped half-way.', 1000)), 'its reason is read');
    assert.ok(await enabled(d, 'Hide', 1000), 'Hide is enabled');
    assert.ok(await textShown(d, ' of ', 5000), 'a running phase shows `<k> of <n>`');
    assert.ok(await doneAfter(c, from, 120_000), 'the import ends (import-done)');
    assert.ok(await shown(d, 'Import finished', 5000), 'step 7 `Import finished`');
    assert.ok(existsSync(join(c.place, 'Capacities · PKM', '.tegg/vault.yml')), 'the new vault exists');
  } finally {
    await cleanupImport(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-07 AC-15 (once)

/** Types `text` at the end of the open note, ⌘S, and the time until the file on disk holds it (ms). */
async function saveDelay(c: ImportCtx, rel: string, text: string): Promise<number> {
  press('down', ['command']);
  typeAscii(text);
  const t0 = Date.now();
  press('s', ['command']);
  const got = await waitFile(join(c.vault, rel), (t) => (t ?? '').includes(text), 10_000);
  assert.ok((got ?? '').includes(text), `the edit \`${text}\` is saved`);
  return Date.now() - t0;
}

test('fr_ux_07_ac15_hidden_import_continues_real_app', { timeout: 900_000 }, async () => {
  await ready();
  const c = freshImport('run15');
  try {
    const src = exportCopy(c.base, 'c05-media-objects');
    const NOTE = 'Pages/Týden.md';
    const d = await launchImport(c, { TEGG_TEST_PICK_SOURCE_DIR: src, TEGG_TEST_IMPORT_PACE: '600' }, `note/${NOTE}`);
    assert.ok(await waitFor(() => marks(c.log).includes(`route-ready:note/${NOTE}`), 20_000), 'the note is open');
    // A save without an import: the baseline.
    const baseline = await saveDelay(c, NOTE, ' zakladni ulozeni');
    // An import into the open vault, hidden while it writes.
    await toPreview(c, 'current');
    const from = await pressImport(c);
    assert.ok(await waitFor(async () => !(await enabled(d, 'Cancel', 100)), 30_000), 'writing has begun');
    await (await need(d, 'Hide')).click();
    assert.ok(await waitFor(async () => !(await shown(d, 'Import steps', 100)), 3000), 'Hide closes the window');
    const running = await statusSays(d, (t) => RUNNING.test(t), 5000);
    assert.match(running, RUNNING, 'the status element `Importing <done> of <total>`');
    // An edit saved meanwhile: no more than 100 ms later than without an import.
    const during = await saveDelay(c, NOTE, ' ulozeno behem importu');
    assert.ok(marks(c.log).slice(from).includes('import-done') === false, 'the import was still running during the save');
    assert.ok(during - baseline <= 100, `the save is delayed by at most 100 ms (baseline ${baseline} ms, during the import ${during} ms)`);
    // Reopen while running: step 6.
    const f6 = markCount(c);
    await (await d.$('-ios predicate string:elementType == 9 AND title BEGINSWITH "Importing "')).click();
    assert.ok(await stepAfter(c, '6', f6, 5000), 'the status reopens step 6');
    press('escape');
    assert.ok(await waitFor(async () => !(await shown(d, 'Import steps', 100)), 3000), 'Esc on step 6 hides it');
    // The quit question during writing: shown, `Keep importing` keeps the app running.
    osa(`tell application id "${TEGG}" to activate`);
    press('q', ['command']);
    assert.ok(await shown(d, 'An import is running. Quit anyway?', 5000), 'the question `An import is running. Quit anyway?`');
    assert.ok(await shown(d, 'Tegg will offer to undo the unfinished import the next time you open the vault.', 2000) || (await textShown(d, 'offer to undo', 2000)), 'its body for an existing vault (D-1584)');
    await (await need(d, 'Keep importing')).click();
    await sleep(1000);
    assert.ok(await shown(d, 'Pages', 3000) || (await statusSays(d, () => true, 3000)) !== '', 'the app keeps running');
    // The end, hidden: `Import finished` until opened; it reopens step 7.
    assert.ok(await doneAfter(c, from, 300_000), 'the import ends');
    assert.equal(await statusSays(d, (t) => t === 'Import finished', 5000), 'Import finished', '`Import finished`');
    const f7 = markCount(c);
    await (await need(d, 'Import finished', 3000)).click();
    assert.ok(await stepAfter(c, '7', f7, 5000), 'the status reopens step 7');
  } finally {
    await cleanupImport(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-07 AC-16 (once)

test('fr_ux_07_ac16_switching_vaults_during_an_import_real_app', { timeout: 900_000 }, async () => {
  await ready();
  const c = freshImport('run16');
  try {
    const src = exportCopy(c.base, 'c05-media-objects');
    const other = existingVault(ensureDir(join(c.base, 'jinde')), 'Knihovna');
    const d = await launchImport(c, { TEGG_TEST_PICK_SOURCE_DIR: src, TEGG_TEST_PICK_DIR: other, TEGG_TEST_IMPORT_PACE: '600' });
    await toPreview(c, 'current');
    const from = await pressImport(c);
    assert.ok(await waitFor(async () => !(await enabled(d, 'Cancel', 100)), 30_000), 'writing has begun');
    await (await need(d, 'Hide')).click();
    // The switch from the title bar: not blocked, nothing asked.
    await (await need(d, 'Vault: Osobní. Switch vault', 5000)).click();
    await (await needMenuItem(d, 'Open folder as vault…', 3000)).click();
    assert.ok(await shown(d, 'Vault: Knihovna. Switch vault', 10_000), 'Knihovna is open');
    assert.ok(!(await shown(d, 'Quit anyway', 300)) && !(await shown(d, 'Keep importing', 300)), 'the switch asks nothing');
    assert.match(await statusSays(d, (t) => RUNNING.test(t), 5000), RUNNING, 'Knihovna shows `Importing <done> of <total>`');
    assert.ok(await doneAfter(c, from, 300_000), 'the import ends');
    assert.equal(await statusSays(d, (t) => t === 'Import finished', 10_000), 'Import finished', 'then `Import finished`');
    const f7 = markCount(c);
    await (await need(d, 'Import finished', 3000)).click();
    assert.ok(await stepAfter(c, '7', f7, 5000), 'step 7');
    assert.ok(await shown(d, 'Open vault', 3000), '`Open vault` (the target isn\'t the open vault)');
    await (await need(d, 'Open report')).click();
    assert.ok(await shown(d, 'Vault: Osobní. Switch vault', 10_000), '`Open report` switches back to Osobní first');
    assert.ok(await waitFor(() => marks(c.log).some((m) => m === 'route-ready:note/Pages/Import report 2026-11-12 PKM.md'), 10_000), 'and opens the report Page');
  } finally {
    await cleanupImport(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-IMP-19 AC-11 (once)

test('fr_imp_19_ac11_done_step_real_app', { timeout: 900_000 }, async () => {
  await ready();
  const c = freshImport('done');
  try {
    const src = exportCopy(c.base, 'c09-unresolved-links');
    let d = await launchImport(c, { TEGG_TEST_PICK_SOURCE_DIR: src });
    await toPreview(c, 'new');
    let from = await pressImport(c);
    assert.ok(await doneAfter(c, from, 120_000), 'the import ends');
    assert.ok(await shown(d, 'Import finished', 5000), '`Import finished`');
    assert.ok(await textShown(d, 'objects imported', 3000), '`<n> objects imported`');
    assert.ok(await textShown(d, 'into Capacities · PKM', 3000), '`… · into Capacities · PKM`');
    assert.ok(await textShown(d, 'Import report · 2026-11-12', 3000), 'the card `Import report · 2026-11-12`');
    assert.ok(await textShown(d, 'Unresolved links', 3000), 'its `Unresolved links` row');
    await (await need(d, 'Open report')).click();
    assert.ok(await shown(d, 'Vault: Capacities · PKM. Switch vault', 10_000), '`Open report` switches to the new vault');
    assert.ok(await waitFor(() => marks(c.log).some((m) => m === 'route-ready:note/Pages/Import report 2026-11-12 PKM.md'), 10_000), 'and opens the report Page');
    const report = join(c.place, 'Capacities · PKM', 'Pages/Import report 2026-11-12 PKM.md');
    assert.ok(existsSync(report) && statSync(report).size > 0, 'the report Page is in the new vault');
    // A second run, `Open vault`.
    await end(c.d);
    c.d = undefined;
    d = await launchImport(c, { TEGG_TEST_PICK_SOURCE_DIR: src });
    await toPreview(c, 'new');
    from = await pressImport(c);
    assert.ok(await doneAfter(c, from, 120_000), 'the second import ends');
    await (await need(d, 'Open vault')).click();
    assert.ok(await shown(d, 'Vault: Capacities · PKM (2). Switch vault', 10_000), '`Open vault` opens the new vault `Capacities · PKM (2)` (the name proposed with ` (2)`)');
    assert.ok(!(await shown(d, 'Import finished', 1000)), 'the window closes');
  } finally {
    await cleanupImport(c);
  }
});
