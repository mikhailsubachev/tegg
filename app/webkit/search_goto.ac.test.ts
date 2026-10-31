// Preview v0.68 feedback, L5 (WebKit + fake core): ⌘O and the Quick switcher are gone (D-760; docs/feedback/ms6-v068.md
// F9). docs/acceptance/search-navigation.md FR-NAV-01 AC-18 (no ⌘O; the L1 part for R4 is
// app/test/v068_registry.ac.test.ts). The `Go to` list's criteria AC-15…AC-17 are superseded by D-1340, D-1343 (v0.109;
// their tests are now app/webkit/search_no_goto.ac.test.ts, FR-NAV-01 AC-20…AC-23). The fixture `search/` in the fake
// core, plus runtime objects (12 `Poznámka NN` pages, a Daily Note and a Tag file). Written from the ACs only (D-61);
// every lookup goes through `must`/node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { R1 } from '../test/shell-tables';
import { loadFixtureVault, type FakeVault } from '../ui/test/fake-core';
import {
  eventually, mainName, must, mustBeOn, nonReadCalls, paletteDialog, paletteOptions, runCommand, sidebar, sleep, start,
  type FakeCoreHandle,
} from './helpers';
import { flat, openSearch, searchBtn } from './v068-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const DAILY = 'Daily/2026-10-12.md';
const TAG = 'Tags/Knihy.md';
function searchVault(): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/search', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Hledání' };
  for (let i = 1; i <= 12; i++) {
    const n = String(i).padStart(2, '0');
    v.files[`Pages/Poznámka ${n}.md`] = `---\nid: 01JA0S0000000000000000P0${n}\ntype: page\ntitle: Poznámka ${n}\ncreated: 2026-09-01T09:00:00+02:00\nmodified: 2026-09-01T09:00:00+02:00\n---\nText.\n`;
  }
  v.files[DAILY] = '---\nid: 01JA0S0000000000000000S0D1\ntype: daily-note\ntitle: "2026-10-12"\ndate: 2026-10-12\n---\nPondělí.\n';
  v.files[TAG] = '---\nid: 01JA0S0000000000000000S0T1\ntype: tag\ntitle: Knihy\n---\n';
  return v;
}
async function startSearch(page: Page): Promise<FakeCoreHandle> {
  await page.clock.setFixedTime(new Date('2026-10-14T10:00:00+02:00'));
  return start(page, { vault: searchVault() });
}

// ------------------------------------------------------------------------------------------------ AC-18

test('fr_nav_01_ac18_cmd_o_does_nothing_on_every_built_route', async ({ page }) => {
  test.setTimeout(120_000);
  const core = await startSearch(page);
  const bad: string[] = [];
  for (const row of R1.filter((r) => r.goto && r.built)) {
    await runCommand(page, row.goto!);
    await sleep(250);
    const before = await mainName(page);
    const calls = (await nonReadCalls(core)).length;
    await page.keyboard.press('Meta+o');
    await sleep(300);
    if (await page.getByRole('dialog').count()) bad.push(`${row.id}: a dialog opened`);
    if ((await mainName(page)) !== before) bad.push(`${row.id}: the route changed`);
    if ((await nonReadCalls(core)).length !== calls) bad.push(`${row.id}: a write command was sent`);
    if (await page.getByRole('dialog', { name: 'Quick switcher' }).count() + await page.getByLabel('Switcher query').count()) bad.push(`${row.id}: Quick switcher / Switcher query exists`);
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(bad, [], '⌘O opens no dialog, changes no route and writes nothing');
  assert.deepEqual(await core.writesTo(), [], 'no file written');
});

test('fr_nav_01_ac18_no_switcher_command_and_cmd_shift_f_selects_the_query', async ({ page }) => {
  await startSearch(page);
  for (const q of ['switcher', 'jump', 'Quick']) {
    await page.keyboard.press('Meta+k');
    await must(paletteDialog(page), 'Command palette');
    await page.getByRole('combobox', { name: 'Command query' }).fill(q);
    await sleep(300);
    const opts = (await paletteOptions(page)).map(flat);
    assert.deepEqual(opts.filter((o) => /Search or jump to|Quick switcher|Open quick switcher/i.test(o)), [], `the palette lists no switcher command for "${q}": ${opts.join(' | ')}`);
    await page.keyboard.press('Escape');
  }
  const field = await openSearch(page);
  await field.fill('rozpočet');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Meta+Shift+f');
  await mustBeOn(page, 'Search', '⇧⌘F on search', 3000);
  const sel = await eventually(() => page.evaluate(() => {
    const a = document.activeElement as HTMLInputElement | null;
    return { label: a?.getAttribute('aria-label') ?? '', value: a?.value ?? '', start: a?.selectionStart ?? -1, end: a?.selectionEnd ?? -1 };
  }), (x) => x.label === 'Search query' && x.start === 0 && x.end === x.value.length && x.value.length > 0, 2000);
  assert.deepEqual(sel, { label: 'Search query', value: 'rozpočet', start: 0, end: 'rozpočet'.length }, '⇧⌘F: the caret in Search query with its text selected');
  await runCommand(page, 'Go to Inbox');
  await (await must(searchBtn(page), 'sidebar button "Search" (app-shell FR-NAV-01 AC-14)')).click();
  await mustBeOn(page, 'Search', 'the sidebar Search button opens search', 3000);
  const viaBtn = await eventually(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''), (l) => l === 'Search query', 2000);
  assert.equal(viaBtn, 'Search query', 'the caret is in Search query');
  assert.equal(await sidebar(page).getByText('Search or jump to…').count(), 0, 'no Search or jump to… in the sidebar');
});
