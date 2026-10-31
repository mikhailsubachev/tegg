// v0.94 build (AP-1026 = D-1197): opening `[[Rozpočet 2027#^otazka1]]` in the editor left the note at the top: the block
// stayed about 706 px down and the caret went to the first block. The editor must, as the read view does (read-view
// FR-EDT-02 AC-7), bring the block to the top of the centre pane as far as the pane can scroll and put the caret in it.
// Object preview Off, so a click on the link opens it (D-1164's test rule: the test names the mode it stores).
import { test, type Locator } from '@playwright/test';
import assert from 'node:assert/strict';
import { PV, ZONE, eventually, main, mark, mustBeOn, navsSince, need, needOdkazyLink, nfc, startPreviews } from './previews-helpers';

test.use({ timezoneId: ZONE });

/** The block's top relative to its scroller, and whether that is the top as far as the scroller can go. */
const atBlock = (bl: Locator) => bl.first().evaluate((e) => {
  let sc: HTMLElement | null = e.parentElement;
  while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
  const box = sc ?? document.documentElement;
  const top = e.getBoundingClientRect().top - box.getBoundingClientRect().top;
  const atEnd = box.scrollTop >= box.scrollHeight - box.clientHeight - 1;
  return { top, ok: Math.abs(top) <= 8 || (atEnd && top > 0 && top < box.clientHeight) };
}).catch(() => ({ top: NaN, ok: false }));

test('bug_v094gp_fr_lnk_11_editor_block_open_scrolls_to_the_block', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, mode: 'off' });
  const n0 = await mark(core);
  await (await needOdkazyLink(page, 'Blok', 0)).click();
  await mustBeOn(page, 'Rozpočet 2027', 'a click on [[Rozpočet 2027#^otazka1]] (Off) opens Rozpočet', 5000);
  assert.deepEqual(await navsSince(core, n0), [nfc(PV.rozpocet)], 'one nav_opened');
  const bl = await need(main(page).getByRole('textbox', { name: 'Note body' }).locator('p, li').filter({ hasText: /^\s*Kdo schvaluje nákup licencí\?/ }), 'the block in the editor');
  const st = await eventually(() => atBlock(bl), (x) => x.ok, 2500);
  assert.ok(st.ok, `the block ^otazka1 is at the top of the centre pane as far as it scrolls (got ${st.top})`);
  const caretIn = await bl.first().evaluate((e) => { const s = getSelection(); return !!s && !!s.anchorNode && e.contains(s.anchorNode); });
  assert.ok(caretIn, 'the caret is in the block');
});
