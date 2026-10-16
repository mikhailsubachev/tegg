// MS4 slice 4A, L5 (WebKit + fake core): FR-LNK-04 AC-13 (D-312), the note changes while the Create offer is open.
// docs/acceptance/backlinks.md; interface docs/contracts/ms4-links.md §5.3. Written from the AC and the contract (D-61).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  B, chips, createOffer, editorBody, eventually, fileText, linksVault, must, mustBeOn, openLinks, seen, sleep, writeCalls, type FakeCoreHandle,
} from './links-helpers';

test.use({ timezoneId: 'Europe/Prague' });

async function createButton(offer: Locator, label: string): Promise<Locator> {
  return must(offer.getByRole('button', { name: `Create "${label}"`, exact: true }), `button Create "${label}"`);
}

// ------------------------------------------------------------------------------------------------ AC-13 (D-312)

const Q3_FAILED = 'The link couldn’t be changed to point to "Q3 plán". Edit it, then try again.';
/** Rozbité odkazy with an extra `[[Q3: plán?]] první` as the first body line. */
const withQ3First = () => linksVault((f) => { f[B.rozbite] = f[B.rozbite].replace('---\n[[Neexistuje]]', '---\n[[Q3: plán?]] první\n\n[[Neexistuje]]'); });

async function openOriginalQ3(page: Page, vault: ReturnType<typeof linksVault>, index: number) {
  const core = await openLinks(page, B.rozbite, { vault });
  const body = editorBody(page);
  const q3 = chips(body, 'Q3: plán?').and(page.locator('[data-link-kind="unresolved"]'));
  await must(q3.nth(index), `chip Q3: plán? #${index}`, 5000);
  await q3.nth(index).click();
  const offer = await must(createOffer(page), 'dialog "Create note"');
  await must(offer.getByText('The file will be named "Q3 plán" and this link changed to point to it.', { exact: true }), 'the rewrite note', 2000);
  await body.focus();
  await page.keyboard.press('Meta+ArrowUp');
  return { core, offer };
}
async function rozbiteAfterCreate(page: Page, core: FakeCoreHandle): Promise<string> {
  const w = await eventually(() => core.writesTo(), (x) => x.includes('Quick Notes/Q3 plán.md'));
  assert.ok(w.includes('Quick Notes/Q3 plán.md'), 'Quick Notes/Q3 plán.md is written');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Rozbité odkazy', 'Back to the source', 5000);
  return (await eventually(() => fileText(core, B.rozbite), (x) => (x ?? '').includes('[[Q3 plán|Q3: plán?]]'), 4000)) ?? '';
}

test('fr_lnk_04_ac13_typing_before_an_earlier_chip_keeps_the_clicked_link', async ({ page }) => {
  const { core, offer } = await openOriginalQ3(page, withQ3First(), 1);
  await page.keyboard.type('Úvod. ');
  await (await createButton(offer, 'Q3: plán?')).click();
  const t = await rozbiteAfterCreate(page, core);
  assert.ok(t.includes('Úvod. [[Q3: plán?]] první'), 'the typed text stays and the first link is unchanged');
  assert.ok(t.includes('\n[[Q3 plán|Q3: plán?]]\n'), 'exactly the clicked link is rewritten');
  assert.equal(t.split('[[Q3 plán|Q3: plán?]]').length - 1, 1, 'one rewrite');
});

test('fr_lnk_04_ac13_deleting_an_earlier_same_target_chip_keeps_the_clicked_link', async ({ page }) => {
  const { core, offer } = await openOriginalQ3(page, withQ3First(), 1);
  await page.keyboard.press('Delete');
  await (await createButton(offer, 'Q3: plán?')).click();
  const t = await rozbiteAfterCreate(page, core);
  assert.ok(t.includes('\n[[Q3 plán|Q3: plán?]]\n'), 'the clicked link (its own line) is rewritten');
  assert.ok(!t.includes('první [['), 'the deleted chip stays deleted');
  assert.equal(t.split('[[Q3 plán|Q3: plán?]]').length - 1, 1, 'one rewrite');
});

test('fr_lnk_04_ac13_deleting_the_clicked_chip_writes_nothing_and_alerts', async ({ page }) => {
  const v = withQ3First();
  v.files[B.rozbite] = v.files[B.rozbite].replace('\n[[Q3: plán?]]\n', '\n');
  const { core, offer } = await openOriginalQ3(page, v, 0);
  await page.keyboard.press('Delete');
  await (await createButton(offer, 'Q3: plán?')).click();
  assert.ok(await seen(offer.getByRole('alert').filter({ hasText: Q3_FAILED }), 2000), 'createLink.rewriteFailed alert, offer stays open');
  await sleep(300);
  assert.deepEqual((await writeCalls(core)).filter((c) => JSON.stringify(c).includes('link_create')), [], 'no note is created');
  assert.ok(!(await core.writesTo()).includes('Quick Notes/Q3 plán.md'), 'Quick Notes/Q3 plán.md not written');
});
