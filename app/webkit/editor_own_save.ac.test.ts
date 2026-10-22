// v0.52 feedback, L5 (WebKit + fake core): an own save is not an external change. docs/acceptance/editor.md FR-SYN-03
// AC-21 (NFR-REL-02; regression `bug_v052_fr_syn_03_own_save_is_not_an_external_change`). Interface
// docs/contracts/ms3-shell.md §16.7 (the saver's own writes), §16.8 (fake core `echoWrites`: every `note_write` is
// reported as `vault:changed` once while it is pending and once after it returned), §13 (merge dialog
// `Note changed outside Tegg`). Written from the AC and the contracts only (D-61). Every lookup goes through
// `must`/node:assert (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { M, bodyOf, caretAt, eventually, fileText, hostBlock, mergeDialog, must, mustBeSaved, original, sleep } from './embeds-helpers';
import { typeInBursts } from './own-save-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('fr_syn_03_ac21_typing_in_bursts_with_own_saves_reported_opens_no_dialog_and_never_reloads', async ({ page }) => {
  test.setTimeout(90_000);
  const run = await typeInBursts(page, { bursts: 10, perBurst: 20 });
  assert.deepEqual(run.dialogSeen, [], 'no merge dialog while typing 200 characters in bursts for ~10 s');
  assert.equal(run.rebuilt, false, 'the editor DOM isn\'t rebuilt (no reload)');
  assert.deepEqual(run.depths.filter((d, i) => i > 0 && d < run.depths[i - 1]), [], `the undo history is never emptied by a reload (AP-122): ${run.depths.join(',')}`);
  assert.equal(run.caret.inBlock, true, 'the caret stays in the typed paragraph');
  assert.ok(run.caret.before.endsWith(run.typed.slice(-20)), `the caret stays after the last typed character (${JSON.stringify(run.caret.before.slice(-30))})`);
  await mustBeSaved(page, 5000);
  const t = await eventually(() => fileText(run.core, M.upravy), (x) => bodyOf(x).startsWith(`Hostitel před.${run.typed}\n`), 3000);
  assert.equal(bodyOf(t), bodyOf(original(M.upravy)).replace('Hostitel před.\n', `Hostitel před.${run.typed}\n`), 'the file ends with exactly the typed text');
  // A real external write (different bytes) during the run still opens the merge dialog (AC-1).
  assert.ok(await caretAt(hostBlock(page, `Hostitel před.${run.typed}`), null), 'caret at the end of the typed paragraph');
  await page.keyboard.type(' Q');
  const theirs = (await fileText(run.core, M.upravy))!.replace('Hostitel po.', 'Hostitel po, změněno jinde.');
  await run.core.setFile(M.upravy, theirs);
  await must(mergeDialog(page), 'dialog "Note changed outside Tegg" for a real external change', 3000);
  await sleep(200);
  assert.equal(await fileText(run.core, M.upravy), theirs, 'the other program\'s bytes are kept');
});
