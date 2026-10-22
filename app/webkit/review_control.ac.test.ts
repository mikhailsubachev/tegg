// v0.52 feedback, L5 (WebKit + fake core): the review control on an object. docs/acceptance/inbox.md FR-INB-02 AC-16
// (D-607; design board `MainUnreviewed`; restyles D-591). Interface docs/contracts/ms3-shell.md §16.5 (the D-591 button
// becomes `role=checkbox` `aria-checked`, class `review-check`, in `.note-type-row` with the type chip and the object
// menu; `DailyHeader` renders the same component), §16.1 (tokens `--unrev`, `--unrev-ring`, `--unrev-bg`). Written from
// the AC and the contract only (D-61). Every lookup goes through `must`/node:assert (TS-I1). Clock 2026-10-14T12:00
// Europe/Prague, inbox fixture.
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { I, NOW, eventually, fileWhen, main, must, nfc, original, reviewedText, sleep, startMain, swap, vaultWrites } from './capture-helpers';
import { amber, cssVarColour, styleOf, transparent } from './v052-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const reviewBox = (page: Page) => main(page).getByRole('checkbox', { name: /^(Mark reviewed|Reviewed)$/ });

/** Opens `route` (`note/<path>` or `daily/<date>`) in the inbox vault. */
async function openRoute(page: Page, route: string, at?: string) {
  await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, route);
  const core = await startMain(page, { at });
  await sleep(400);
  return core;
}
/** The box inside the control: a square 8…24 px descendant; its background (filled or not). */
async function boxFill(c: Locator): Promise<string | null> {
  return c.evaluate((el) => {
    const own = getComputedStyle(el).backgroundColor;
    const box = ([...el.querySelectorAll('*')] as HTMLElement[]).find((e) => { const r = e.getBoundingClientRect(); return r.width >= 8 && r.width <= 24 && Math.abs(r.width - r.height) <= 2 && e.tagName.toLowerCase() !== 'path'; });
    if (!box) return null;
    const b = getComputedStyle(box).backgroundColor;
    return b === own ? 'rgba(0, 0, 0, 0)' : b;
  });
}

test('fr_inb_02_ac16_the_review_checkbox_in_the_type_row', async ({ page }) => {
  const core = await openRoute(page, `note/${nfc(I.Q1)}`, I.Q1);
  const box = await must(main(page).getByRole('checkbox', { name: 'Mark reviewed', exact: true }), 'checkbox "Mark reviewed" (D-607)', 3000);
  assert.equal(await box.getAttribute('aria-checked'), 'false', 'unchecked');
  // In the type row, right of the type chip and the object menu, not in the title row.
  const pos = await box.evaluate((b) => {
    const row = b.closest('.note-type-row');
    const title = document.querySelector('[aria-label="Title"]');
    const chip = row?.querySelector('a[aria-label^="Type: "], [role="link"][aria-label^="Type: "]');
    const more = row?.querySelector('button[aria-label="More"]');
    const r = b.getBoundingClientRect();
    const end = (e: Element | null | undefined) => (e ? e.getBoundingClientRect().right : Infinity);
    const tr = title?.getBoundingClientRect();
    return { inRow: !!row, chip: !!chip, more: !!more, right: r.left >= end(chip) && r.left >= end(more), aboveTitle: !!tr && r.bottom <= tr.top + 2 };
  });
  assert.deepEqual(pos, { inRow: true, chip: true, more: true, right: true, aboveTitle: true }, 'in .note-type-row, right of the type chip and the object menu, above the title row');
  // Unchecked: amber text and border, an empty box.
  const unrev = await cssVarColour(page, '--unrev');
  const s0 = await styleOf(box);
  assert.ok(amber(s0.color) && (s0.color === unrev || unrev === null), `amber text (${s0.color}, --unrev ${unrev})`);
  assert.ok(amber(s0.borderColor), `an amber border (${s0.borderColor})`);
  assert.ok(transparent(await boxFill(box)), 'an empty box');
  // Clicking writes review: reviewed (D-562) and checks it.
  await box.click();
  assert.equal(await fileWhen(core, I.Q1, (t) => t !== original(I.Q1)), reviewedText(I.Q1), 'review: reviewed and modified');
  const on = await must(main(page).getByRole('checkbox', { name: 'Reviewed', exact: true }), 'checkbox "Reviewed"', 2000);
  assert.equal(await eventually(() => on.getAttribute('aria-checked'), (x) => x === 'true', 1000), 'true', 'checked');
  const s1 = await styleOf(on);
  const fill = await boxFill(on);
  assert.ok(!transparent(fill) && !amber(fill), `a filled box (${fill})`);
  assert.ok(!amber(s1.borderColor), `a neutral border (${s1.borderColor})`);
  // Clicking again writes review: unreviewed.
  await on.click();
  const back = swap(original(I.Q1), 'modified: 2026-10-14T08:15:00+02:00', `modified: ${NOW}`);
  assert.equal(await fileWhen(core, I.Q1, (t) => !!t?.includes('review: unreviewed')), back, 'clicking again writes review: unreviewed');
});

test('fr_inb_02_ac16_the_daily_header_uses_the_same_control', async ({ page }) => {
  await openRoute(page, 'daily/2026-10-13');
  const box = await must(main(page).getByRole('checkbox', { name: 'Mark reviewed', exact: true }), 'Daily Note header: checkbox "Mark reviewed" (D-607)', 3000);
  assert.equal(await box.getAttribute('aria-checked'), 'false', 'unchecked (D1 is unreviewed)');
  assert.equal(await box.evaluate((b) => b.classList.contains('review-check')), true, 'the same component (class review-check)');
  assert.equal(await main(page).getByRole('button', { name: /^(Mark reviewed|Reviewed)$/ }).count(), 0, 'no toggle button any more');
});

test('fr_inb_02_ac16_shown_where_d591_says_and_nowhere_else', async ({ page }) => {
  // Red guard first: Q1 (unreviewed Quick Note) has the checkbox.
  await openRoute(page, `note/${nfc(I.Q1)}`, I.Q1);
  assert.equal(await reviewBox(page).count(), 1, 'guard: Q1 has the review checkbox');
  for (const p of [I.P2, I.Holy]) {
    const pg = await page.context().newPage();
    const core = await openRoute(pg, `note/${nfc(p)}`, p);
    assert.equal(await reviewBox(pg).count() + (await main(pg).getByRole('button', { name: /^(Mark reviewed|Reviewed)$/ }).count()), 0, `${p}: no review control`);
    assert.deepEqual(await vaultWrites(core), [], `${p}: opening writes nothing`);
    await pg.close();
  }
});
