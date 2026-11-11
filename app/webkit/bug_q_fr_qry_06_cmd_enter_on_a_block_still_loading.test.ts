// Slice Q triage P4 (qa/reviews/slice-q-test-triage.md; FR-QRY-06, R144, FR-UX-03 AC-42): ⌘↩ on a query block selected in
// the focused editor opens its editor in any state. A block just inserted with `Insert query` was ignored until it had
// drawn its first rows: until then the block knew no query name (only the result carried it), so the editor refused to open.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { P, editor, editorBody, eventually, must, noteRoute, picker, runCommand, startQueries } from './queries-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('bug_q_fr_qry_06_cmd_enter_opens_the_editor_before_the_first_rows', async ({ page }) => {
  await startQueries(page, { route: noteRoute(P.lisabon) });
  const body = await must(editorBody(page), 'Note body', 8000);
  // Every later `query_run` answers after 4 s, so the new block is still loading when ⌘↩ is pressed.
  await page.evaluate(() => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: unknown, options: unknown) =>
      cmd === 'query_run' ? new Promise((r) => setTimeout(r, 4000)).then(() => invoke(cmd, args, options)) : invoke(cmd, args, options);
  });
  await body.focus();
  await page.keyboard.press('Meta+ArrowDown');
  await runCommand(page, 'Insert query');
  await must(picker(page), 'Choose a query');
  await page.keyboard.type('Otevřené úkoly z této schůzky');
  await page.keyboard.press('Enter');
  await must(editorBody(page).locator('[data-query-block][data-query-state="loading"]'), 'the inserted block, still loading');
  assert.ok(await eventually(() => page.evaluate(() => !!document.querySelector('.ProseMirror-selectednode [data-query-state="loading"]') && !!document.activeElement?.classList.contains('ProseMirror')), (v) => v, 2000), 'the loading block is selected in the focused editor');
  await page.keyboard.press('Meta+Enter');
  await must(editor(page), 'the query editor by ⌘↩, before the block\'s first rows', 1000);
});
