// v0.52 feedback H1b (docs/feedback/ms5-v052.md; embeds.md FR-EMB-02 AC-16, D-598, D-428): choosing `Link` in an embed's
// `Display as` turned it into a chip without a `Display as` button, and `Display embed as…` on the selected block did
// nothing, so the mode couldn't be changed back except in the source view. Written from the AC and the contract only
// (D-61); every lookup goes through `must`/node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  M, bodyOf, displayAsButton, displayAsMenu, editorBody, eventually, fileWhen, main, modeItem, must, mustBeSaved, needEmbeds, needTop,
  openEmbeds, original, runCommand, seen, sleep, topEmbeds, type EmbedInfo,
} from './embeds-helpers';
import { selectTop } from './convert-helpers';

test.use({ timezoneId: 'Europe/Prague' });

/** Host block 3 of Režimy is `![[Jana Nováková]]` (Osoba's default: card). */
const JANA_BLOCK = 3;
const block = (page: Page, n: number) => editorBody(page).locator(':scope > *').nth(n - 1);

test('bug_v052_fr_emb_02_link_mode_block_embed_keeps_display_as', async ({ page }) => {
  const core = await openEmbeds(page, M.rezimy);
  await needEmbeds(main(page), 12, 'Režimy');
  const jana = await needTop(main(page), 1, "Jana's card");
  await (await must(displayAsButton(jana), "Jana's Display as")).click();
  await must(displayAsMenu(page), 'menu "Display as"');
  await (await must(modeItem(page, 'Link'), 'menuitemradio Link')).click();
  await sleep(150);
  await mustBeSaved(page);
  const t1 = await fileWhen(core, M.rezimy, (x) => (x ?? '').includes('![[Jana Nováková|link]]'));
  assert.equal(bodyOf(t1), bodyOf(original(M.rezimy)).replace('![[Jana Nováková]]\n', '![[Jana Nováková|link]]\n'), 'Link writes ![[Jana Nováková|link]]');
  const l = await eventually(() => topEmbeds(main(page)).catch(() => [] as EmbedInfo[]), (x) => x[1]?.mode === 'link', 2000);
  assert.equal(l[1]?.mode, 'link', 'the embed is now a link-mode chip');
  // The chip keeps its Display as button (D-598) …
  assert.ok(await seen(displayAsButton(block(page, JANA_BLOCK)), 1500), 'the link-mode block embed still shows "Display as"');
  // … and Display embed as… on the selected block opens the menu (D-428), so Card can be chosen again.
  assert.deepEqual(await selectTop(page, JANA_BLOCK), [JANA_BLOCK], "Jana's block is selected");
  await runCommand(page, 'Display embed as…');
  assert.ok(await seen(displayAsMenu(page), 1500), 'Display embed as… opens the menu');
  await (await must(modeItem(page, 'Card'), 'menuitemradio Card')).click();
  await sleep(150);
  await mustBeSaved(page);
  const t2 = await fileWhen(core, M.rezimy, (x) => !(x ?? '').includes('![[Jana Nováková|link]]'));
  assert.equal(bodyOf(t2), bodyOf(original(M.rezimy)), "Card (Osoba's default) writes ![[Jana Nováková]] again");
});
