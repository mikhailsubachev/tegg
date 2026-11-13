// MS5 slice 5B, L5 (WebKit + fake core): the final MVP sidebar, the palette sweep and the right panel's tabs,
// docs/acceptance/inbox.md FR-NAV-04 AC-1…AC-5, FR-NAV-02 AC-1, FR-NAV-05 AC-1 (R62). Interface
// docs/contracts/ms5-capture.md §7.1 (`inbox_count`, `inbox:count`), §10 (registry). Written from the ACs and the
// contract only (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  CARD, cardNamed, click, description, eventually, flat, focusName, inboxEntry, inboxHeading, main, must, reviewedBox, runCommand, seen,
  sidebar, sidebarCount, sleep, startCapture, startMain, inboxVault, typeInCapture,
} from './capture-helpers';
import { box, paletteDialog, paletteOptions } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });

const entry = (page: Page, text: string) => sidebar(page).locator('a, button, [role="link"], [role="button"]').filter({ has: page.getByText(text, { exact: true }) }).first();

test('fr_nav_04_ac1_entries_and_order', async ({ page }) => {
  await startMain(page);
  const sb = sidebar(page);
  const parts: [string, ReturnType<typeof entry>][] = [
    // 6A (trash-media.md FR-NAV-04 AC-6, D-613): no Home entry; `Trash` follows Saved queries (AP-534).
    // D-759 (tags.md FR-NAV-04 AC-8): the first row is `New object` + `Search`; no `Search or jump to…`.
    ['New object', sb.getByRole('button', { name: /^New object/ })], ['Search', sb.getByRole('button', { name: 'Search', exact: true })],
    ['Inbox', entry(page, 'Inbox')], ['Today', entry(page, 'Today')], ['Tasks', entry(page, 'Tasks')],
    // Slice PIN (pinned.md FR-NAV-04 AC-9, D-1375): the Pinned section's header between Tasks and the Types section.
    ['Pinned', sb.getByRole('button', { name: 'Pinned', exact: true })],
    ['Types', sb.getByRole('list', { name: 'Types' })], ['Tags', sb.getByRole('link', { name: 'Tags', exact: true })],
    // Slice Q (queries.md FR-NAV-04 AC-12, AP-1304 = D-1447): `Saved queries` became the built `Queries` entry.
    ['Queries', sb.getByRole('link', { name: 'Queries', exact: true })], ['Trash', entry(page, 'Trash')], ['logo', sb.getByRole('button', { name: 'Tegg: About and Settings', exact: true })],
  ];
  let last = -1;
  for (const [name, loc] of parts) {
    const b = await box(loc);
    assert.ok(b, `${name} is shown`);
    assert.ok(b!.y >= last, `${name} below the previous entry`);
    last = b!.y;
  }
  assert.equal(await sidebarCount(page), '13', 'Inbox with its count');
  assert.equal(await sb.getByText('Home', { exact: true }).count(), 0, 'no Home entry (D-613)');
  // Slice PIN (D-1375): Pinned is built. Slice Q (D-1447): Queries is built too, no longer TBD v1.0.
  assert.doesNotMatch(await description(sb.getByRole('link', { name: 'Queries', exact: true })), /Coming in v1\.0/, 'Queries: not Coming in v1.0');
  const types = (await sb.getByRole('list', { name: 'Types' }).getByRole('listitem').allInnerTexts()).map(flat);
  assert.ok(!types.some((t) => /^Tasks\b/.test(t)), 'no Task in the Types section (D-516)');
});

test('fr_nav_04_ac2_the_inbox_count_follows_the_query', async ({ browser }) => {
  const ctx = await browser.newContext({ timezoneId: 'Europe/Prague' });
  const page = await ctx.newPage();
  const v = inboxVault();
  const core = await startMain(page, { vault: v });
  assert.equal(await sidebarCount(page), '13', '13');
  assert.equal(await description(inboxEntry(page)), '13 items to review', 'the description (plural forms)');
  await runCommand(page, 'Go to Inbox');
  await click(main(page).getByRole('button', { name: 'Quick Notes' }).first(), 'filter Quick Notes');
  assert.equal(await sidebarCount(page), '13', 'not the page filter');
  await click(reviewedBox(await must(cardNamed(page, CARD.Q1), 'Q1')), 'Reviewed');
  assert.equal(await eventually(() => sidebarCount(page), (c) => c === '12', 1000), '12', 'within 1 s of an action in Tegg');
  await core.setFile('Quick Notes/Odjinud.md', '---\nid: 01JB5B0000000000000000R201\ntype: quick-note\ntitle: Odjinud\nreview: unreviewed\ncreated: 2026-10-14T11:30:00+02:00\nmodified: 2026-10-14T11:30:00+02:00\n---\n');
  assert.equal(await eventually(() => sidebarCount(page), (c) => c === '13', 2000), '13', 'within 2 s of an external change');
  const cap = await ctx.newPage();
  await startCapture(cap, { vault: v });
  await typeInCapture(cap, 'Zachyceno');
  await cap.keyboard.press('Meta+Enter');
  assert.equal(await eventually(() => sidebarCount(page), (c) => c === '14', 2000), '14', 'within 2 s of a capture');
  await ctx.close();
});

test('fr_nav_04_ac2_no_count_at_zero', async ({ page }) => {
  const v = inboxVault((f) => {
    for (const [p, t] of Object.entries(f)) {
      if (!p.endsWith('.md') || p.startsWith('_templates/') || p.startsWith('.trash/') || !/^---\r?\n/.test(t)) continue; // CRLF notes (Q5) too
      f[p] = /^review: /m.test(t) ? t.replace(/^review: .*$/m, 'review: reviewed') : t.replace(/^title: (.*)$/m, (l) => `${l}\nreview: reviewed`);
    }
  });
  await startMain(page, { vault: v });
  await must(inboxEntry(page), 'the Inbox entry');
  assert.equal(await sidebarCount(page), '', 'none at 0');
  await click(inboxEntry(page), 'Inbox');
  await must(page.getByRole('region', { name: 'Inbox zero', exact: true }), 'the built Inbox at zero (not a placeholder)');
});

test('fr_nav_04_ac3_reaching_the_inbox', async ({ page }) => {
  await startMain(page);
  await click(inboxEntry(page), 'sidebar Inbox');
  await must(inboxHeading(page), 'the entry opens inbox');
  assert.equal(await inboxEntry(page).getAttribute('aria-current'), 'page', 'aria-current="page" on inbox');
  await page.keyboard.press('Meta+d');
  await sleep(200);
  await page.keyboard.press('Meta+Shift+i');
  await must(inboxHeading(page), '⇧⌘I opens inbox');
  await page.keyboard.press('Meta+d');
  await runCommand(page, 'Go to Inbox');
  await must(inboxHeading(page), 'Go to Inbox opens inbox');
  await must(main(page).locator('[data-group]').first(), 'the Inbox page itself (not a placeholder)');
});

test('fr_nav_04_ac4_keyboard_and_collapse', async ({ page }) => {
  await startMain(page);
  await (await must(sidebar(page).getByRole('button', { name: 'New object' }), 'New object')).focus();
  const seenNames: string[] = [];
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); seenNames.push((await focusName(page)).name); }
  // 6A (trash-media.md FR-NAV-04 AC-6, D-613): no Home entry; Tab reaches Inbox, then Today.
  const iInbox = seenNames.findIndex((n) => /^Inbox/.test(n));
  const iToday = seenNames.findIndex((n) => /^Today/.test(n));
  assert.ok(!seenNames.some((n) => /^Home/.test(n)) && iInbox >= 0 && iToday === iInbox + 1, `Tab reaches Inbox, then Today: ${seenNames.join(' | ')}`);
  await (await must(inboxEntry(page), 'Inbox')).focus();
  await page.keyboard.press('Enter');
  await must(inboxHeading(page), '⏎ opens it');
  await must(main(page).locator('[data-group]').first(), 'the Inbox page');
  await page.keyboard.press('Control+Meta+s');
  assert.equal(await seen(sidebar(page), 500) && await sidebar(page).isVisible(), false, '⌃⌘S collapses');
  await page.keyboard.press('Control+Meta+s');
  await must(sidebar(page), '⌃⌘S restores');
});

test('fr_nav_04_ac5_registry_in_the_ui', async ({ page }) => {
  await startMain(page);
  for (const [cmd, ok] of [['Go to Settings: Vault', /Vault/], ['Go to Settings: Menu bar and startup', /Menu bar/], ['Go to Settings: Shortcuts', /Shortcuts/], ['Go to Settings: Date & time', /Date/]] as const) {
    await runCommand(page, cmd);
    await must(main(page).getByRole('heading', { name: ok }), `${cmd}: a built page`);
    assert.equal(await main(page).getByText(/Coming in MS\d/).count(), 0, `${cmd}: no Coming in MS…`);
  }
  // 6A (D-613): `Go to Home` is removed. Slice PIN (pinned.md FR-NAV-04 AC-10, D-1375): `Go to Pinned` too; Saved queries
  // became the built `Queries` page in slice Q (AP-1304 = D-1447).
  await runCommand(page, 'Go to Queries');
  await must(main(page).getByRole('heading', { name: 'Queries', exact: true }), 'Go to Queries: the built page');
  assert.equal(await main(page).getByText(/Coming in v1\.0/).count(), 0, 'Queries: no Coming in v1.0');
});

test('fr_nav_02_ac1_every_5b_command_is_listed_found_and_runs', async ({ page }) => {
  const core = await startMain(page);
  await runCommand(page, 'Go to Inbox');
  for (const name of ['Quick Capture', 'Capture a task', 'Go to Inbox', 'Mark reviewed', 'Mark unreviewed', 'Convert to…', 'Append to…', 'Link to…', 'Add tags…', 'Select all items', 'Clear selection', 'Mark all reviewed', 'Show all in Inbox', 'Go to Settings: Vault', 'Go to Settings: Menu bar and startup', 'Go to Settings: Shortcuts']) {
    await page.keyboard.press('Meta+Shift+p');
    await must(paletteDialog(page), 'palette (⇧⌘P)');
    const word = name.split(/\s+/).find((w) => w.length > 3) ?? name;
    await page.getByRole('combobox', { name: 'Command query' }).fill(word);
    await sleep(100);
    const opts = (await paletteOptions(page)).map(flat);
    assert.ok(opts.some((o) => o.startsWith(name)), `"${name}" is found by "${word}": ${opts.join(' | ')}`);
    assert.ok(!opts.some((o) => o.startsWith(name) && /Coming in/.test(o)), `"${name}" is not a placeholder`);
    await page.keyboard.press('Escape');
  }
  await runCommand(page, 'Quick Capture');
  assert.deepEqual((await core.captureLog()).opens, ['default'], 'Quick Capture runs');
});

test('fr_nav_05_ac1_right_panel_tabs', async ({ page }) => {
  const core = await startMain(page, { at: 'Pages/Plán webu.md' });
  await page.keyboard.press('Meta+Backslash');
  const panel = await must(page.getByRole('complementary', { name: 'Context panel' }), 'the right panel');
  const tabs = (await panel.getByRole('tab').allInnerTexts()).map(flat);
  assert.deepEqual(tabs.map((t) => t.replace(/\s*\d+$/, '')), ['Backlinks', 'Outline', 'Graph'], 'R2 tabs; no Attributes tab (D-127)');
  // D-1624 (outline.md, slice OL): the Outline tab is built; selecting it shows the outline of R170.
  const outline = panel.getByRole('tab', { name: /^Outline/ });
  assert.doesNotMatch(await description(outline), /Coming in/, 'Outline: built, no `Coming in v1.0` description (D-1624)');
  await click(outline, 'tab "Outline"');
  await must(panel.getByRole('tabpanel', { name: 'Outline', exact: true }), 'selecting it shows the outline (outline.md R170)');
  // D-920 (graph-panel.md, slice G2): the Graph tab is built; selecting it shows the local graph of R114.
  const graph = panel.getByRole('tab', { name: /^Graph/ });
  assert.doesNotMatch(await description(graph), /Coming in/, 'Graph: built, no `Coming in v1.0` description (D-920)');
  await click(graph, 'tab "Graph"');
  assert.equal(await graph.getAttribute('aria-selected'), 'true', 'Graph selected');
  await must(panel.getByRole('tabpanel', { name: 'Graph', exact: true }).getByRole('group', { name: /^Local graph: Plán webu/ }), 'selecting it shows the local graph (graph-panel.md R114)');
  assert.equal((await eventually(() => core.uiState(), (s) => s?.rightPanel.tab === 'graph', 2000))?.rightPanel.tab, 'graph', 'the tab is kept per machine (FR-UX-02 AC-10)');
  await page.keyboard.press('Meta+Backslash');
  assert.equal((await core.uiState())?.rightPanel.open, false, 'the open state is kept per machine (FR-UX-02 AC-7)');
});
