// Nightly run 2026-10-27 on main (FR-CNV-04 AC-2, `fr_cnv_04_ac2_the_source_chip_opens_bloky_at_the_embed` under the
// gate's load, 4 of 24 and 1 of 24 repeats): two races with the embed cards, which render after `embed_load` answers.
// (1) ⌘↩ on the selected new embed did nothing: it clicks the card's Open button, and the card hadn't rendered yet.
// (2) Opening Bloky at the embed aligned the block at the top, then WebKit's scroll anchoring moved the pane by half a
// viewport when the cards rendered below it (`overflow-anchor`); the app keeps its own scroll (D-456), so the scroller
// opts out. Both tests hold `embed_load` to make the late cards certain; each failed before its fix.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { C, ZAVOLAT, click, convertAt, eventually, main, must, mustBeOn, openConvert, original, saved } from './convert-helpers';

test.use({ timezoneId: 'Europe/Prague' });
const B0 = original(C.bloky);

/** Holds every `embed_load` (the embed cards' content) from now until `release()`. */
async function holdEmbedLoad(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    const inv = w.__TAURI_INTERNALS__.invoke;
    w.__heldLoad = new Promise<void>((r) => { w.__releaseLoad = r; });
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, a: any, o: unknown) => {
      if (cmd === 'embed_load') await w.__heldLoad;
      return inv(cmd, a, o);
    };
  });
  return { release: () => page.evaluate(() => (window as any).__releaseLoad()) };
}
const blockTop = (page: Page) => main(page).locator('[data-block-selected]').first().evaluate((e) => e.getBoundingClientRect().top - e.closest('main')!.getBoundingClientRect().top);

test('bug_nightly_fr_cnv_04_ac2_cmd_enter_opens_the_new_task_before_its_card_renders', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  const hold = await holdEmbedLoad(page);
  await convertAt(page, ZAVOLAT);
  await saved(page, core, C.bloky, (x) => x !== B0);
  // An unrendered card has no height, so the selected block is looked up as attached, not as visible.
  const sel = main(page).locator('[data-block-selected]').first();
  await sel.waitFor({ state: 'attached', timeout: 3000 });
  assert.ok((await sel.getAttribute('data-embed-source'))?.includes(ZAVOLAT), 'the new embed is selected');
  assert.equal(await sel.locator('.embed-header').count(), 0, 'its card has not rendered (embed_load held)');
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, ZAVOLAT, '⌘↩ on the selected new embed opens the task', 5000);
  await hold.release();
});

test('bug_nightly_fr_cnv_04_ac2_the_block_stays_at_the_top_while_the_cards_render_below_it', async ({ page }) => {
  const core = await openConvert(page, C.bloky);
  await convertAt(page, ZAVOLAT);
  await saved(page, core, C.bloky, (x) => x !== B0);
  await page.keyboard.press('Meta+Enter');
  await mustBeOn(page, ZAVOLAT, '⌘↩ on the selected new embed', 5000);
  const hold = await holdEmbedLoad(page);
  const props = page.getByRole('region', { name: 'Properties', exact: true });
  await click(props.locator('[data-link-kind]').filter({ hasText: 'Bloky' }), 'the Source chip in the attribute panel');
  await mustBeOn(page, 'Bloky', 'Bloky', 5000);
  const sel = main(page).locator('[data-block-selected]').first();
  await sel.waitFor({ state: 'attached', timeout: 3000 });
  assert.ok((await sel.getAttribute('data-embed-source'))?.includes(ZAVOLAT), 'the embed of the new task is selected');
  const before = await eventually(() => blockTop(page), (t) => Math.abs(t) <= 8, 3000);
  assert.ok(Math.abs(before) <= 8, `aligned at the top before the cards render (± 8 px): ${before}`);
  await hold.release();
  await must(sel.locator('.embed-header'), 'the Task card renders', 5000);
  await page.waitForTimeout(300); // the browser's scroll anchoring, when it runs, runs right after the layout change
  const after = await blockTop(page);
  assert.ok(Math.abs(after) <= 8, `still at the top of the centre pane once the cards rendered (± 8 px): ${after}`);
});
