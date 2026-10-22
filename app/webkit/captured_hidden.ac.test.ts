// 5B preview feedback round 2, L5 (WebKit + fake core): FR-TYP-08 AC-15 (D-595, AP-523 (b)): an existing `captured`
// value is never shown in the attribute panel (neither among the properties nor under `Other properties (<n>)`) nor in
// the read view's properties; the source view shows the line; opening and closing the note writes nothing.
// docs/acceptance/types.md; fixture tests/fixtures/vaults/inbox Q1 (`Quick Notes/Koupit mléko.md`,
// `captured: 2026-10-14T08:15:00+02:00`). Interface: ms3-shell §14 (region `Properties`, button `Other properties (<n>)`
// with the list `Other properties`), §11 (source view region `Markdown source`, toggle `Show Markdown source`), D-215
// (`window.__TEGG_TEST__.readView`). Written from the AC and the contracts only (D-61); every lookup goes through `must`
// (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { I, flat, main, mustBeOn, must, runCommand, seen, sleep, startMain, vaultWrites } from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const props = (page: Page) => page.getByRole('region', { name: 'Properties', exact: true });
const otherProps = (page: Page) => props(page).getByRole('button', { name: /^Other properties \(\d+\)$/ });
const otherList = (page: Page) => page.getByRole('list', { name: 'Other properties' });
const sourceRegion = (page: Page) => page.getByRole('region', { name: 'Markdown source', exact: true });
const toSource = (page: Page) => page.getByRole('button', { name: 'Show Markdown source', exact: true });
const CAPTURED_LINE = 'captured: 2026-10-14T08:15:00+02:00';

/** Every visible text of the Properties region, with the Other properties list expanded when there is one. */
async function panelText(page: Page): Promise<string> {
  const region = await must(props(page), 'region "Properties"', 5000);
  if (await seen(otherProps(page), 500)) {
    const btn = otherProps(page).first();
    if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
    await must(otherList(page), 'list "Other properties" (expanded)');
  }
  return region.evaluate((r) => {
    const out: string[] = [];
    const walk = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (!el || el.getClientRects().length === 0) continue;
      const t = (n.textContent ?? '').trim();
      if (t) out.push(t);
    }
    // Labels given only as accessible names (e.g. a field's aria-label) count too.
    for (const e of r.querySelectorAll('[aria-label]')) if ((e as HTMLElement).getClientRects().length) out.push(e.getAttribute('aria-label') ?? '');
    return out.join('\n');
  });
}

test('fr_typ_08_ac15_captured_is_not_shown_in_the_attribute_panel', async ({ page }) => {
  const core = await startMain(page, { at: I.Q1 });
  await mustBeOn(page, 'Koupit mléko', 'landing on Q1', 5000);
  const text = await panelText(page);
  assert.ok(/(^|\n)Created(\n|$)/.test(text), `the panel shows its rows (Created): ${JSON.stringify(flat(text))}`);
  assert.ok(!/captured/i.test(text), `no captured row in the attribute panel (properties or Other properties): ${JSON.stringify(flat(text))}`);
  // The source view (FR-EDT-10) shows the line.
  await (await must(toSource(page), 'toggle "Show Markdown source"')).click();
  const src = await must(sourceRegion(page), 'region "Markdown source"');
  assert.ok((await src.innerText()).includes(CAPTURED_LINE), `the source view shows "${CAPTURED_LINE}"`);
  // Closing the note (another route) writes nothing.
  await runCommand(page, 'Go to Inbox'); // 6A: Go to Home is removed (D-609)
  await sleep(300);
  assert.deepEqual(await vaultWrites(core), [], 'opening and closing the note writes nothing');
  void main;
});

test('fr_typ_08_ac15_captured_is_not_shown_in_the_read_view_properties', async ({ page }) => {
  await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; });
  const core = await startMain(page, { at: I.Q1 });
  await mustBeOn(page, 'Koupit mléko', 'landing on Q1 (read view)', 5000);
  const text = await panelText(page);
  assert.ok(/(^|\n)Created(\n|$)/.test(text), `the read view shows its properties (Created): ${JSON.stringify(flat(text))}`);
  assert.ok(!/captured/i.test(text), `no captured row in the read view's properties: ${JSON.stringify(flat(text))}`);
  await (await must(toSource(page), 'toggle "Show Markdown source"')).click();
  const src = await must(sourceRegion(page), 'region "Markdown source"');
  assert.ok((await src.innerText()).includes(CAPTURED_LINE), `the source view shows "${CAPTURED_LINE}"`);
  await runCommand(page, 'Go to Inbox'); // 6A: Go to Home is removed (D-609)
  await sleep(300);
  assert.deepEqual(await vaultWrites(core), [], 'opening and closing the note writes nothing');
});
