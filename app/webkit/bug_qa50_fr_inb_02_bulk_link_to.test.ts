// QA review of PR #50 (FR-INB-02 AC-8, AC-12; D-573): a bulk `Link to…` over items in different folders is one
// `inbox` job carrying the target's path; each file gets the D-184 text of the target from its own folder.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { CARD, I, callsOf, cardNamed, click, eventually, fileText, main, must, nfc, sleep, startInbox } from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague' });

async function select(page: Page, keys: (keyof typeof CARD)[]) {
  for (const k of keys) {
    await (await must(cardNamed(page, CARD[k]), CARD[k])).focus();
    await page.keyboard.press('Space');
  }
}

test('bug_qa50_fr_inb_02_bulk_link_to_across_folders_is_one_job', async ({ page }) => {
  const core = await startInbox(page);
  await select(page, ['Q1', 'P1']);
  const bar = main(page).getByRole('toolbar', { name: '2 selected', exact: true });
  await click(bar.getByRole('button', { name: 'Link to…', exact: true }), 'Link to…');
  const d = await must(page.getByRole('dialog').filter({ has: page.getByRole('combobox', { name: 'Find an object' }) }), 'picker');
  await (await must(d.getByRole('combobox', { name: 'Find an object' }), 'field')).fill('Dvojník');
  await sleep(200);
  const options = await d.getByRole('option').allInnerTexts();
  const i = options.findIndex((o) => /Dvojník/.test(o) && /\bPage\b/.test(o));
  assert.ok(i >= 0, `DP among ${options.join(' | ')}`);
  await d.getByRole('option').nth(i).click();
  const q1 = await eventually(() => fileText(core, I.Q1), (t) => !!t?.endsWith('\n[[Pages/Dvojník|Dvojník]]\n'), 3000);
  assert.ok(q1?.endsWith('\n[[Pages/Dvojník|Dvojník]]\n'), `Q1 from Quick Notes/: the path form\n${q1}`);
  const p1 = await eventually(() => fileText(core, I.P1), (t) => !!t?.endsWith('\n[[Dvojník]]\n'), 3000);
  assert.ok(p1?.endsWith('\n[[Dvojník]]\n'), `P1 from Pages/: the stem\n${p1}`);
  const bulk = await callsOf(core, 'inbox_bulk');
  assert.equal(bulk.length, 1, 'one inbox job');
  assert.deepEqual(((bulk[0].args as any).paths as string[]).map(nfc).sort(), [nfc(I.Q1), nfc(I.P1)].sort(), 'over both items');
  assert.equal((bulk[0].args as any).change?.op, 'append-link-to', 'the target travels as a path (D-573)');
  assert.deepEqual(await callsOf(core, 'note_write'), [], 'no single writes');
});
