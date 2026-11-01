// Issue #104: on open the capture window focused its text only after `capture_context` and `capture_draft_get`
// answered and a frame passed; a user already in `Add tag…` had the focus pulled back to the text (FR-CAP-01 AC-6).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { capText, capValue, must, sleep, startCapture, tagInput, tagsList } from './capture-helpers';

test('bug_104_fr_cap_01_the_late_open_focus_leaves_the_tag_field_alone', async ({ page }) => {
  const core = await startCapture(page, { open: false });
  // The draft read answers late, as on a busy machine (the fake core's capture commands take no delayCommand).
  await page.evaluate(() => {
    const w = window as any;
    const inv = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: unknown, o: unknown) =>
      cmd === 'capture_draft_get' ? new Promise((r) => setTimeout(r, 600)).then(() => inv(cmd, args, o)) : inv(cmd, args, o);
  });
  await core.openCapture({ trigger: 'hotkey', kind: 'default' });
  await must(capText(page), 'textbox "Capture text"', 5000);
  const field = await must(tagInput(page), 'the tag field');
  await field.focus();
  await page.keyboard.insertText('ná');
  await sleep(1000);
  await page.keyboard.insertText('k');
  assert.equal(await field.inputValue(), 'nák', 'every key went to the tag field');
  assert.equal(await capValue(page), '', 'none went to the capture text');
  assert.ok(await must(tagsList(page), 'listbox Tags'), 'the tag suggestions are open');
});
