// Bug #61 (FR-CNV-03, FR-CNV-06, D-689): a conversion whose embed lands after the user moved on.
// The object file is created first; the source's blocks are replaced once the embed target is resolved
// (app/ui/src/convert/flow.ts). These tests hold that `link_resolve` call to make the late landing certain.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { C, alertWith, caretAfter, confirm, eventually, fileText, newPaths, openConvert, popoverAt } from './convert-helpers';

test.use({ timezoneId: 'Europe/Prague' });

/** Holds the `link_resolve` for the new object's embed target (targets [`stem`]) until `release()`. */
async function holdEmbedTarget(page: Page, stem: string) {
  await page.evaluate((s) => {
    const w = window as any;
    const inv = w.__TAURI_INTERNALS__.invoke;
    w.__held = new Promise<void>((r) => { w.__release = r; });
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, a: any, o: unknown) => {
      if (cmd === 'link_resolve' && Array.isArray(a?.targets) && a.targets.some((t: string) => t.normalize('NFC') === s)) await w.__held;
      return inv(cmd, a, o);
    };
  }, stem.normalize('NFC'));
  return { release: () => page.evaluate(() => (window as any).__release()) };
}
const scrollTop = (page: Page) => page.evaluate(() => document.querySelector('main')?.scrollTop ?? -1);

test('bug_61_fr_cnv_03_a_late_conversion_keeps_the_caret_and_the_scroll', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  const hold = await holdEmbedTarget(page, 'Závěrečný odstavec.');
  await popoverAt(page, 'Závěrečný odstavec.', 'Meta+Shift+o');
  await confirm(page, { type: 'Quick Note' });
  assert.equal((await eventually(() => newPaths(core), (p) => p.length === 1, 5000)).length, 1, 'the Quick Note is created');
  // The user moves on before the embed lands.
  await caretAfter(page, 'Úvodní odstavec.');
  const before = await scrollTop(page);
  await hold.release();
  const src = await eventually(() => fileText(core, C.bloky), (t) => !!t?.includes('Závěrečný odstavec.]]'), 5000);
  assert.ok(src?.includes('Závěrečný odstavec.]]'), 'the embed replaces the converted paragraph');
  assert.ok(Math.abs((await scrollTop(page)) - before) <= 2, `the note doesn't scroll to the embed (${before} → ${await scrollTop(page)})`);
  await page.keyboard.type('X');
  const after = await eventually(() => fileText(core, C.bloky), (t) => !!t?.includes('Úvodní odstavec.X'), 5000);
  assert.ok(after?.includes('Úvodní odstavec.X'), 'typing goes where the caret was, not to the embed');
});

test('bug_61_fr_cnv_06_a_conversion_whose_blocks_changed_discards_its_file', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  const hold = await holdEmbedTarget(page, 'Závěrečný odstavec.');
  await popoverAt(page, 'Závěrečný odstavec.', 'Meta+Shift+o');
  await confirm(page, { type: 'Quick Note' });
  assert.equal((await eventually(() => newPaths(core), (p) => p.length === 1, 5000)).length, 1, 'the Quick Note is created');
  // The user edits the paragraph being converted before the embed lands: the conversion can't replace it any more.
  await caretAfter(page, 'Závěrečný odstavec.');
  await page.keyboard.type(' Y');
  await hold.release();
  assert.ok((await eventually(() => alertWith(page, 'Couldn’t create').count(), (n) => n > 0, 5000)) > 0, 'the convert.failed alert');
  assert.deepEqual(await eventually(() => newPaths(core), (p) => p.length === 0, 5000), [], 'the new file is discarded');
  const src = await eventually(() => fileText(core, C.bloky), (t) => !!t?.includes('Závěrečný odstavec. Y'), 5000);
  assert.ok(src?.includes('Závěrečný odstavec. Y') && !src.includes('Závěrečný odstavec.]]'), 'the edited paragraph stays, no embed');
});
