// v0.52 feedback H9, H10 (docs/feedback/ms5-v052.md; editor.md FR-SYN-03 AC-21, NFR-REL-02): the watcher reports
// Tegg's own saves; an own save seen while it was on its way (or before the next render) was taken as an external
// change: with edits typed since, the merge dialog opened (H9); without, the editor reloaded and the caret jumped (H10).
// L5 with the fake core reporting each write as a change, during and after the write (ms3-shell §16.8). Written from the
// AC and the contract only (D-61); every lookup goes through `must`/node:assert (TS-I1).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { M, bodyOf, eventually, fileText, mustBeSaved, original } from './embeds-helpers';
import { typeInBursts } from './own-save-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('bug_v052_fr_syn_03_own_save_is_not_an_external_change', async ({ page }) => {
  test.setTimeout(60_000);
  const run = await typeInBursts(page, { bursts: 5, perBurst: 12 });
  assert.deepEqual(run.dialogSeen, [], 'no merge dialog for the note\'s own saves (H9)');
  assert.equal(run.rebuilt, false, 'no reload of the editor (H10)');
  assert.deepEqual(run.depths.filter((d, i) => i > 0 && d < run.depths[i - 1]), [], `the undo history isn't emptied by a reload (H10): ${run.depths.join(',')}`);
  assert.ok(run.caret.inBlock && run.caret.before.endsWith(run.typed.slice(-12)), 'the caret doesn\'t move (H10)');
  await mustBeSaved(page, 5000);
  const t = await eventually(() => fileText(run.core, M.upravy), (x) => bodyOf(x).startsWith(`Hostitel před.${run.typed}\n`), 3000);
  assert.equal(bodyOf(t), bodyOf(original(M.upravy)).replace('Hostitel před.\n', `Hostitel před.${run.typed}\n`), 'every typed character is saved');
});
