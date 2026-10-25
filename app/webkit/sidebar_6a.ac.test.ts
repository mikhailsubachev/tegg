// MS6 slice 6A, L5 (WebKit + fake core): the sidebar without Home, docs/acceptance/trash-media.md FR-NAV-04 AC-6
// (entries top to bottom ending with `Trash`; no Home entry, no `Go to Home`, `home` lands like an unknown route) and
// AC-7's UI branch (D-614, AP-530: with no note opened, a deleted or trashed last note, and a new vault, the launch
// shows `inbox`; no error dialog, no write). Interface docs/contracts/ms6-trash-media.md §6.2 (registry: `home` removed,
// `BOTTOM` gains `trash` last, `land()` falls back to `{ id: 'inbox' }`). Written from the ACs and the contract only
// (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { box, mainName, mustBeOn, paletteDialog, paletteOptions, sidebar, sleep, start } from './helpers';
import { TM, idOf, startTM, tmVault, vaultWrites6a } from './trash-media-helpers';
import { newEmptyVault } from '../ui/test/fake-core';

test.use({ timezoneId: 'Europe/Prague' });

const entry = (page: Page, text: string) => sidebar(page).locator('a, button, [role="link"], [role="button"]').filter({ has: page.getByText(text, { exact: true }) }).first();

test('fr_nav_04_ac6_sidebar_without_home', async ({ page }) => {
  const core = await startTM(page);
  const sb = sidebar(page);
  const parts: [string, ReturnType<typeof entry>][] = [
    // D-759 (tags.md FR-NAV-04 AC-8): the first row is `New object` + `Search`; no `Search or jump to…`.
    ['New object', sb.getByRole('button', { name: /^New object/ })], ['Search', sb.getByRole('button', { name: 'Search', exact: true })],
    ['Inbox', entry(page, 'Inbox')], ['Today', entry(page, 'Today')], ['Tasks', entry(page, 'Tasks')], ['Types', sb.getByRole('list', { name: 'Types' })],
    // D-761 (tags.md FR-NAV-04 AC-8, R83): one `Tags` entry after the Types list.
    ['Tags', sb.getByRole('link', { name: 'Tags', exact: true })], ['Pinned', entry(page, 'Pinned')], ['Saved queries', entry(page, 'Saved queries')], ['Trash', entry(page, 'Trash')],
  ];
  let last = -1;
  for (const [name, loc] of parts) {
    const b = await box(loc);
    assert.ok(b, `${name} is shown`);
    assert.ok(b!.y >= last, `${name} below the previous entry`);
    last = b!.y;
  }
  assert.equal(await sb.getByText('Home', { exact: true }).count(), 0, 'no Home entry (D-613)');
  const trash = (await sb.locator('a, button, [role="link"], [role="button"]').filter({ has: page.getByText('Trash', { exact: true }) }).first().innerText()).replace(/\s+/g, ' ').trim();
  assert.equal(trash, 'Trash', 'Trash without a count (AP-534)');
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Home');
  await sleep(100);
  const opts = (await paletteDialog(page).isVisible()) ? await paletteOptions(page) : [];
  assert.ok(!opts.some((o) => o.startsWith('Go to Home')), `no Go to Home command: ${opts.join(' | ')}`);
  await page.keyboard.press('Escape');
  assert.deepEqual(await vaultWrites6a(core), [], 'nothing written');
});

test('fr_nav_04_ac6_home_lands_like_an_unknown_route', async ({ browser }) => {
  const names: (string | null)[] = [];
  for (const route of ['home', 'no-such-route-6a']) {
    const ctx = await browser.newContext({ timezoneId: 'Europe/Prague' });
    const p = await ctx.newPage();
    await p.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, route);
    await startTM(p);
    await sleep(800);
    names.push(await mainName(p));
    await ctx.close();
  }
  assert.notEqual(names[0], 'Home', 'no home route');
  assert.equal(names[0], names[1], `home lands like an unknown route: ${JSON.stringify(names)}`);
});

test('fr_nav_04_ac7_launch_landing_is_the_inbox', async ({ browser }) => {
  const cases: { what: string; last: { path: string; id: string | null } | null; edit?: (f: Record<string, string>) => void }[] = [
    { what: 'no note ever opened', last: null },
    { what: 'the last note deleted', last: { path: TM.ukol, id: idOf(tmVault().files[TM.ukol]) }, edit: (f) => { delete f[TM.ukol]; } },
    { what: 'the last note in .trash/', last: { path: TM.ukol, id: idOf(tmVault().files[TM.ukol]) }, edit: (f) => { f[`.trash/${TM.ukol}`] = f[TM.ukol]; delete f[TM.ukol]; } },
  ];
  for (const c of cases) {
    const ctx = await browser.newContext({ timezoneId: 'Europe/Prague' });
    const p = await ctx.newPage();
    const vault = tmVault(c.edit ? (f) => c.edit!(f) : undefined);
    const core = await start(p, { vault, last: c.last });
    await mustBeOn(p, 'Inbox', `${c.what}: launch shows inbox (D-614)`, 5000);
    assert.equal(await p.getByRole('alertdialog').count() + await p.getByRole('dialog').count(), 0, `${c.what}: no error dialog`);
    assert.deepEqual(await vaultWrites6a(core), [], `${c.what}: no write`);
    await ctx.close();
  }
});

test('fr_nav_04_ac7_a_new_vault_opens_on_the_inbox', async ({ page }) => {
  await start(page, { vault: newEmptyVault('Nový trezor') });
  await mustBeOn(page, 'Inbox', 'a new vault opens on inbox (AP-530)', 5000);
});
