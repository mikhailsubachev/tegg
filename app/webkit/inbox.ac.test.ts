// MS5 slice 5B, L5 (WebKit + fake core): the Inbox page, docs/acceptance/inbox.md R60, R61 — FR-INB-01 AC-2 (order and
// groups; `en-US` (W); Los Angeles (TZ); midnight), AC-3 (cards), AC-4 (type filter), AC-5 (live), AC-6 (open and
// back), AC-7 (Inbox zero), AC-8 (identical after a reload), AC-9 (read-only), AC-11 (strings and themes); FR-INB-03
// AC-1, AC-2 (every Quick Note path writes `review: unreviewed`), AC-3, AC-4, AC-5, AC-6; FR-INB-04 AC-1 (L5);
// FR-DLY-05 AC-5; FR-SYN-06 AC-26 (L5: a browsing tour sends no write command). Interface docs/contracts/ms5-capture.md
// §7 (`inbox_list`, `inbox_count`, `inbox:count`, `inbox/bucket.ts`, route `inbox`, `route-ready:inbox`), §11.2.
// Written from the ACs and the contract only (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  CARD, I, MEMBERS, NOW, cardAt, cardNamed, cardPaths, click, eventually, filterBtn, filterGroup, flat, gotoInbox, groupsWhen, inboxGroups,
  inboxHeading, inboxVault, ip, isDisabled, main, markAllBtn, must, mustBeOn, nfc, openTriage, reviewedBox, runCommand, seen,
  sidebarCount, sleep, startInbox, startMain, swap, vaultWrites, zero,
} from './capture-helpers';
import { pseudoLocale } from './helpers';
import { axeContrast } from './read-helpers';
import { editorBody } from './editor-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const PRAGUE_CS = { today: ip('Q6', 'N1', 'Q1', 'T1', 'Q7'), yesterday: ip('Q2', 'D1'), week: ip('S1'), older: ip('P1', 'Q4', 'Q5', 'D3', 'Q8') };

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-2

test('fr_inb_01_ac2_groups_and_order_prague_cs', async ({ page }) => {
  await startInbox(page);
  assert.deepEqual(await groupsWhen(page, PRAGUE_CS), PRAGUE_CS, 'R61 on the fixture');
  for (const [id, name] of [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Earlier this week'], ['older', 'Older']] as const) {
    await must(main(page).getByRole('region', { name, exact: true }).and(page.locator(`[data-group="${id}"]`)), `region ${name}`);
  }
  assert.ok(await seen(main(page).getByText('Newest first', { exact: true }), 1000), 'Newest first (a label)');
  assert.ok(await seen(main(page).getByText('13 to review', { exact: true }), 1000), 'the summary');
});

test('fr_inb_01_ac2_week_from_sunday_in_en_us', async ({ page }) => {
  await startInbox(page, { region: 'en-US' });
  const want = { today: ip('Q6', 'N1', 'Q1', 'T1', 'Q7'), yesterday: ip('Q2', 'D1'), week: ip('S1', 'P1'), older: ip('Q4', 'Q5', 'D3', 'Q8') };
  assert.deepEqual(await groupsWhen(page, want), want, '(W)');
});

test.describe('Los Angeles', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('fr_inb_01_ac2_groups_in_los_angeles', async ({ page }) => {
    await startInbox(page);
    const want = { today: ip('Q7', 'Q6', 'N1'), yesterday: ip('Q1', 'T1', 'Q2'), week: ip('D1', 'S1'), older: ip('P1', 'Q4', 'Q5', 'D3', 'Q8') };
    assert.deepEqual(await groupsWhen(page, want), want, '(TZ)');
  });
});

test('fr_inb_01_ac2_q6_moves_to_yesterday_after_midnight_without_a_reload', async ({ page }) => {
  await startInbox(page, { now: '2026-10-15T00:04:00+02:00', install: true });
  await page.clock.runFor(1000);
  await must(main(page).locator('[data-group="yesterday"]'), 'the groups', 5000);
  await page.clock.runFor(61_000);
  const g = await inboxGroups(page);
  assert.ok((g.yesterday ?? []).includes(nfc(I.Q6)), `Q6 is in Yesterday within 60 s: ${JSON.stringify(g)}`);
});

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-3

test('fr_inb_01_ac3_cards', async ({ page }) => {
  await startInbox(page);
  const q1 = await must(cardNamed(page, CARD.Q1), `article ${CARD.Q1}`);
  const fmt = new Intl.DateTimeFormat('cs', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Prague' }).format(new Date('2026-10-14T08:15:00+02:00'));
  const t = flat(await q1.innerText());
  for (const part of ['Quick Note', 'Koupit mléko', '#nákup', 'Polotučné, 2 litry.', `Captured ${fmt}`]) assert.ok(t.includes(nfc(part)), `Q1 card shows ${part}: ${t}`);
  assert.equal(await reviewedBox(q1).getAttribute('aria-checked') ?? String(await reviewedBox(q1).isChecked()), 'false', 'Reviewed unchecked');
  assert.equal(await q1.getAttribute('data-review'), 'unreviewed', 'data-review');
  assert.ok(flat(await (await must(cardNamed(page, CARD.Q2), 'Q2')).innerText()).includes('Created '), 'Q2: Created …');
  assert.ok(flat(await (await must(cardNamed(page, CARD.Q2), 'Q2')).innerText()).includes('Viz Plán webu.'), 'no link brackets');
  assert.ok(!/Captured|Created/.test(flat(await (await must(cardNamed(page, CARD.Q8), 'Q8')).innerText())), 'Q8: no footer');
  await must(cardNamed(page, CARD.Q6), 'Q6 with its NFC title');
  await must(cardNamed(page, CARD.D1), 'D1 titled 2026-10-13');
  await must(main(page).getByRole('link', { name: 'Koupit mléko', exact: true }), 'the title is a link');
});

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-4

test('fr_inb_01_ac4_the_type_filter', async ({ page }) => {
  const core = await startInbox(page);
  await must(filterGroup(page), 'group Filter by type');
  const labels = await filterGroup(page).getByRole('button').evaluateAll((bs) => bs.map((b) => [b.getAttribute('data-type'), (b.textContent ?? '').replace(/\s+/g, ' ').trim()]));
  assert.deepEqual(labels.map(([k]) => k), ['all', 'page', 'task', 'quick-note', 'daily-note', 'nápad', 'schůzka'], 'All, then the types with items (D-121 order, Task after Page)');
  assert.deepEqual(labels.map(([, t]) => (t ?? '').replace(/\D+/g, ' ').trim()), ['13', '1', '1', '7', '2', '1', '1'], 'the counts');
  await click(filterBtn(page, 'quick-note'), 'Quick Notes');
  assert.equal(await filterBtn(page, 'quick-note').getAttribute('aria-pressed'), 'true', 'pressed');
  assert.deepEqual((await cardPaths(page)).sort(), ip('Q1', 'Q2', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8').sort(), 'only the 7 Quick Notes');
  assert.ok(await seen(main(page).getByText('7 of 13 to review', { exact: true }), 1000), '7 of 13 to review');
  assert.equal((await core.uiState())?.inbox?.filter, 'quick-note', 'remembered per machine (ui-state)');
  await click(filterBtn(page, 'all'), 'All');
  assert.equal((await cardPaths(page)).length, 13, 'All shows all');
  assert.deepEqual(await vaultWrites(core), [], 'filtering writes nothing');
  // Restored after a relaunch.
  const p2 = await page.context().newPage();
  await startInbox(p2, { inboxUi: { filter: 'quick-note' } });
  assert.equal(await filterBtn(p2, 'quick-note').getAttribute('aria-pressed'), 'true', 'restored');
});

test('fr_inb_01_ac4_a_filter_whose_type_has_no_items_left', async ({ page }) => {
  await startInbox(page, { inboxUi: { filter: 'quick-note' }, vault: inboxVault((f) => {
    for (const p of [I.Q1, I.Q2, I.Q6, I.Q7, I.Q8]) f[nfc(p)] = f[nfc(p)].replace('review: unreviewed', 'review: reviewed');
    f[nfc(I.Q4)] = f[nfc(I.Q4)].replace('title: Bez stavu\n', 'title: Bez stavu\nreview: reviewed\n');
    f[nfc(I.Q5)] = f[nfc(I.Q5)].replace('review: maybe', 'review: reviewed');
  }) });
  assert.ok(await seen(main(page).getByText('No Quick Notes to review.', { exact: true }), 3000), 'No Quick Notes to review.');
  await click(main(page).getByRole('button', { name: 'Show all', exact: true }), 'Show all');
  assert.equal((await cardPaths(page)).length, 6, 'all six remaining items');
});

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-5

test('fr_inb_01_ac5_the_page_follows_external_changes', async ({ page }) => {
  const core = await startInbox(page);
  await must(cardAt(page, I.Q1), 'Q1');
  await core.setFile('Quick Notes/Odjinud.md', '---\nid: 01JB5B0000000000000000R201\ntype: quick-note\ntitle: Odjinud\nreview: unreviewed\ncreated: 2026-10-14T11:30:00+02:00\nmodified: 2026-10-14T11:30:00+02:00\n---\n');
  assert.ok(await seen(cardAt(page, 'Quick Notes/Odjinud.md'), 2000), 'a new card');
  assert.equal((await inboxGroups(page)).today?.[0], 'Quick Notes/Odjinud.md', 'at the right place (first of Today)');
  await core.setFile(I.Q1, swap((await core.files())[nfc(I.Q1)], 'review: unreviewed', 'review: reviewed'));
  assert.ok(await eventually(async () => (await cardAt(page, I.Q1).count()) === 0, (x) => x, 2000), 'Q1 leaves');
  await core.renameFile(I.Q2, `.trash/${I.Q2}`);
  assert.ok(await eventually(async () => (await cardAt(page, I.Q2).count()) === 0, (x) => x, 2000), 'Q2 moved into .trash/ leaves');
  await core.setFile(I.Q4, null);
  assert.ok(await eventually(async () => (await cardAt(page, I.Q4).count()) === 0, (x) => x, 2000), 'Q4 deleted leaves');
  await core.setFile(I.S1, swap((await core.files())[nfc(I.S1)], 'type: schůzka', 'type: page'));
  assert.ok(await seen(cardNamed(page, 'Page: Porada týmu'), 2000), 'S1 stays with the type Page');
  assert.equal(await eventually(() => sidebarCount(page), (c) => c === '11', 2000), '11', 'the sidebar count follows (13 + 1 − 3)');
});

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-6

test('fr_inb_01_ac6_open_an_item_and_come_back', async ({ page }) => {
  const core = await startInbox(page);
  await click(filterBtn(page, 'quick-note'), 'Quick Notes');
  await click(main(page).getByRole('link', { name: 'Koupit mléko', exact: true }), 'title link');
  await mustBeOn(page, 'Koupit mléko', 'note/Quick Notes/Koupit mléko.md', 3000);
  await page.keyboard.press('Meta+BracketLeft');
  await must(inboxHeading(page), 'back on inbox');
  assert.equal(await filterBtn(page, 'quick-note').getAttribute('aria-pressed'), 'true', 'the same filter');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-path]')?.getAttribute('data-path')?.normalize('NFC') ?? null), nfc(I.Q1), 'the focus on that card');
  await click(filterBtn(page, 'all'), 'All');
  await (await must(cardAt(page, I.D1), 'D1')).focus();
  await page.keyboard.press('Enter');
  await must(main(page).getByRole('button', { name: /^(Reviewed|Mark reviewed)$/ }), 'daily/2026-10-13 (D-321)', 3000);
  assert.deepEqual(await vaultWrites(core), [], 'opening writes nothing and marks nothing reviewed');
});

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-7

test('fr_inb_01_ac7_inbox_zero', async ({ page }) => {
  const v = inboxVault((f) => {
    for (const k of MEMBERS) {
      const p = nfc(I[k]);
      f[p] = /^review: /m.test(f[p]) ? f[p].replace(/^review: .*$/m, 'review: reviewed') : f[p].replace(/^title: (.*)$/m, (l) => `${l}\nreview: reviewed`);
    }
  });
  const core = await startInbox(page, { vault: v });
  const z = await must(zero(page), 'region Inbox zero');
  assert.ok(flat(await z.innerText()).includes('Everything you captured has been reviewed. New Quick Notes and daily notes land here until you mark them reviewed.'), 'the text');
  assert.equal(await filterGroup(page).count() + await markAllBtn(page).count(), 0, 'no filter, no Mark all reviewed');
  await click(z.getByRole('button', { name: 'Quick Capture', exact: true }), 'Quick Capture');
  assert.deepEqual((await core.captureLog()).opens, ['default'], 'opens the capture window with the default type');
  await click(z.getByRole('button', { name: "Open today's note", exact: true }), "Open today's note");
  // Today's note is virtual here, and a virtual Daily Note shows no review control (FR-DLY-05 AC-1): its header's
  // `Pick date` shows the daily route.
  await must(main(page).getByRole('button', { name: 'Pick date', exact: true }), 'daily/2026-10-14', 3000);
});

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-8

test('fr_inb_01_ac8_identical_after_reopening', async ({ page }) => {
  await startInbox(page);
  const first = await groupsWhen(page, PRAGUE_CS);
  const count = await sidebarCount(page);
  await page.reload();
  await must(main(page), 'main', 5000);
  await gotoInbox(page);
  assert.deepEqual(await groupsWhen(page, first), first, 'same groups');
  assert.equal(await sidebarCount(page), count, 'same count');
  assert.equal(count, '13', 'thirteen');
});

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-9

test('fr_inb_01_ac9_a_read_only_card', async ({ page }) => {
  const core = await startMain(page);
  const bytes = new TextEncoder().encode((await core.files())[nfc(I.Q1)].replace('Polotučné', 'XPolotučné'));
  bytes[bytes.indexOf(0x58)] = 0xff;
  await core.setFile('Quick Notes/Koupit mléko kopie.md', bytes);
  await gotoInbox(page);
  const card = await must(cardAt(page, 'Quick Notes/Koupit mléko kopie.md'), 'the read-only copy is listed');
  const box = reviewedBox(card);
  assert.equal(await isDisabled(box), true, 'Reviewed aria-disabled');
  assert.ok(flat(await box.evaluate((e) => e.getAttribute('aria-description') ?? '')).includes("This note can't be edited here.") || await seen(card.getByText("This note can't be edited here."), 500), 'the reason');
  await box.click({ force: true });
  await sleep(300);
  assert.deepEqual(await core.writesTo(), [], 'never written');
});

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-11

test('fr_inb_01_ac11_pseudo_locale', async ({ page }) => {
  await startMain(page, { prelude: pseudoLocale });
  await runCommand(page, '⟦Go to Inbox⟧');
  await must(main(page).getByRole('heading', { level: 1, name: '⟦Inbox⟧' }), 'heading ⟦Inbox⟧');
  await must(main(page).getByRole('group', { name: '⟦Filter by type⟧', exact: true }), 'group ⟦Filter by type⟧ (R60)');
  await must(main(page).locator('[data-path]').first(), 'the cards');
  assert.ok(await seen(main(page).getByText('⟦13 to review⟧', { exact: true }), 1000), 'the summary through the catalog');
  const leaks = await main(page).evaluate((m) => {
    const out: string[] = [];
    const walk = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = (n.textContent ?? '').trim();
      if (t && !t.includes('⟦') && !n.parentElement?.closest('[data-user-content]') && !/^[\d#+…·\s]+$/.test(t)) out.push(t);
    }
    return out;
  });
  assert.deepEqual(leaks, [], 'only titles, type names, tags and body text (data-user-content) outside ⟦ ⟧');
});

for (const theme of ['light', 'dark'] as const) {
  test(`fr_inb_01_ac11_contrast_${theme}`, async ({ page }) => {
    await startInbox(page, { theme });
    await must(cardAt(page, I.Q1), 'cards');
    assert.deepEqual(await axeContrast(page), [], `${theme}: with items`);
    await (await must(cardAt(page, I.Q1), 'Q1')).focus();
    await page.keyboard.press('Space');
    assert.deepEqual(await axeContrast(page), [], `${theme}: with a selection`);
    await page.keyboard.press('Escape');
    await openTriage(page, 'Koupit mléko');
    assert.deepEqual(await axeContrast(page), [], `${theme}: with a menu open`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-INB-03

test('fr_inb_03_ac1_the_review_row_matches_the_card', async ({ page }) => {
  await startInbox(page);
  await click(main(page).getByRole('link', { name: 'Divná hodnota', exact: true }), 'Q5');
  const row = await must(main(page).getByRole('region', { name: 'Properties' }).getByText(/Review/).first(), 'the Review row');
  assert.ok(flat(await row.evaluate((e) => e.closest('[role="row"], li, div')?.textContent ?? '')).includes('maybe'), 'Q5 shows the raw value as invalid');
  await page.keyboard.press('Meta+BracketLeft'); // the app's Back (⌘[), not the browser's
  await click(main(page).getByRole('link', { name: 'Koupit mléko', exact: true }), 'Q1');
  const control = await must(main(page).getByRole('region', { name: 'Properties' }).getByRole('checkbox', { name: /Review/ }).or(main(page).getByRole('button', { name: /^(Reviewed|Unreviewed|Mark reviewed)$/ })), 'Q1 Review control');
  assert.equal(await control.getAttribute('aria-checked') ?? await control.getAttribute('aria-pressed'), 'false', 'same state as the card (unreviewed)');
  assert.equal(await main(page).getByRole('region', { name: 'Properties' }).getByRole('button', { name: /Remove/ }).filter({ hasText: /review/i }).count(), 0, 'no way to remove the key on a Quick Note');
});

test('fr_inb_03_ac2_every_quick_note_path_writes_unreviewed', async ({ page }) => {
  const core = await startMain(page);
  // ⌘N draft's first write.
  await page.keyboard.press('Meta+n');
  await must(page.getByRole('textbox', { name: 'Title', exact: true }), 'draft title', 5000);
  await page.keyboard.insertText('Z kláves');
  await page.keyboard.press('Enter');
  // The switcher's create row.
  await page.keyboard.press('Meta+o');
  await (await must(page.getByRole('combobox', { name: 'Switcher query' }).or(page.getByRole('textbox', { name: 'Switcher query' })), 'switcher')).fill('Z přepínače');
  await sleep(200);
  await click(page.getByRole('option', { name: 'Create "Z přepínače"', exact: true }), 'Create row');
  const texts = await eventually(async () => {
    const f = await core.files();
    return ['Quick Notes/Z kláves.md', 'Quick Notes/Z přepínače.md'].map((p) => f[p] ?? '');
  }, (x) => x.every(Boolean), 3000);
  for (const t of texts) assert.ok(/\nreview: unreviewed\n/.test(t), `review: unreviewed in ${t.split('\n')[3]}`);
  await gotoInbox(page);
  for (const p of ['Quick Notes/Z kláves.md', 'Quick Notes/Z přepínače.md']) assert.ok(await seen(cardAt(page, p), 2000), `${p} is in the Inbox within 2 s`);
});

test('fr_inb_03_ac3_turning_the_workflow_on_lists_no_old_object_without_the_key', async ({ page }) => {
  const v = inboxVault((f) => { f['Schůzky/Bez klíče.md'] = '---\nid: 01JB5B0000000000000000R501\ntype: schůzka\ntitle: Bez klíče\ncreated: 2026-10-14T09:00:00+02:00\nmodified: 2026-10-14T09:00:00+02:00\n---\n'; });
  const core = await startInbox(page, { vault: v });
  await must(cardAt(page, I.S1), 'S1 listed (explicit unreviewed)');
  const yml = (await core.files())['.tegg/types/schůzka.yml'];
  await core.setFile('.tegg/types/schůzka.yml', yml.replace('review: false', 'review: true'));
  await sleep(500);
  assert.equal(await cardAt(page, 'Schůzky/Bez klíče.md').count(), 0, 'a Schůzka without the key stays unlisted');
  assert.ok(await seen(cardAt(page, I.S1), 1000), 'S1 still listed');
});

test('fr_inb_03_ac4_reading_never_writes', async ({ page }) => {
  const core = await startInbox(page);
  for (const key of ['page', 'quick-note', 'daily-note', 'all']) await click(filterBtn(page, key), `filter ${key}`);
  await openTriage(page, 'Koupit mléko');
  await page.keyboard.press('Escape');
  for (const t of ['Bez stavu', 'Divná hodnota', 'Bez data']) {
    await click(main(page).getByRole('link', { name: t, exact: true }), t);
    await sleep(300);
    await page.keyboard.press('Meta+BracketLeft'); // the app's Back (⌘[), not the browser's
    await must(inboxHeading(page), 'back');
  }
  assert.deepEqual(await vaultWrites(core), [], 'no write command (a missing or unknown value is never fixed by reading, D-330)');
  assert.deepEqual(await core.writesTo(), [], 'no file written');
});

test('fr_inb_03_ac5_review_commands_on_a_note', async ({ page }) => {
  const core = await startMain(page, { at: I.Q1 });
  await runCommand(page, 'Mark reviewed');
  const t = await eventually(() => core.files().then((f) => f[nfc(I.Q1)]), (x) => !!x?.includes('review: reviewed'), 2000);
  assert.ok(t?.includes('review: reviewed') && t.includes(`modified: ${NOW}`), 'FR-INB-02 AC-1 change');
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Mark unreviewed');
  await sleep(200);
  assert.ok((await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts()).some((x) => x.includes('Mark unreviewed')), 'then Mark unreviewed');
  await page.keyboard.press('Escape');
  const p2 = await page.context().newPage();
  await startMain(p2, { at: I.P2 });
  await p2.keyboard.press('Meta+k');
  await p2.getByRole('combobox', { name: 'Command query' }).fill('Mark');
  await sleep(200);
  const opts = await p2.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts();
  assert.ok(!opts.some((x) => /Mark (un)?reviewed/.test(x)), 'not on P2 (Page, workflow off, no key)');
});

test('fr_inb_03_ac6_one_state_everywhere', async ({ page }) => {
  await startInbox(page);
  const d1 = await must(cardAt(page, I.D1), 'D1');
  await click(reviewedBox(d1), 'D1 Reviewed');
  assert.equal(await eventually(() => sidebarCount(page), (c) => c === '12', 1000), '12', 'the count follows');
  await (await must(main(page).getByRole('link', { name: '2026-10-13', exact: true }), 'D1 title')).click();
  const toggle = await must(main(page).getByRole('button', { name: /^(Reviewed|Mark reviewed)$/ }), 'the daily header toggle');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'Reviewed (pressed) in daily/2026-10-13');
  await toggle.click();
  assert.equal(await eventually(() => sidebarCount(page), (c) => c === '13', 1000), '13', 'unreviewed from the header lists it again within 1 s');
});

// ------------------------------------------------------------------------------------------------ FR-INB-04 AC-1 (L5), FR-DLY-05 AC-5

test('fr_inb_04_ac1_converting_q2_changes_three_lines', async ({ page }) => {
  const core = await startInbox(page);
  const menu = await openTriage(page, 'Nápad na článek');
  await click(menu.getByRole('menuitem', { name: /Nápad/ }), 'Convert to Nápad');
  const want = swap(swap(inboxVault().files[nfc(I.Q2)], 'type: quick-note', 'type: nápad'), 'review: unreviewed', 'review: reviewed').replace(/^modified: .*$/m, `modified: ${NOW}`);
  assert.equal(await eventually(() => core.files().then((f) => f[nfc(I.Q2)]), (x) => x === want, 2000), want, 'only type, review and modified; id and body unchanged');
  assert.deepEqual(await core.writesTo(), [nfc(I.Q2)], 'the path is unchanged');
});

test('fr_dly_05_ac5_daily_notes_in_the_inbox', async ({ page }) => {
  const core = await startInbox(page);
  await must(cardAt(page, I.D1), 'D1 listed');
  await must(cardAt(page, I.D3), 'D3 listed');
  assert.equal(await cardAt(page, I.D2).count(), 0, 'D2 not listed');
  assert.equal(await cardAt(page, 'Daily/2026-10-14.md').count(), 0, 'the virtual today is never listed');
  await page.keyboard.press('Meta+d');
  await (await must(editorBody(page), 'Note body of the virtual Daily Note', 5000)).click();
  await page.keyboard.type('X');
  await eventually(() => core.files().then((f) => f['Daily/2026-10-14.md']), (x) => x !== undefined, 3000);
  await gotoInbox(page);
  assert.ok(await seen(main(page).locator('[data-group="today"] [data-path="Daily/2026-10-14.md"]'), 2000), 'its first write lists it in Today within 2 s');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-26 (L5)

test('fr_syn_06_ac26_a_browsing_tour_sends_no_write_command', async ({ page }) => {
  const core = await startInbox(page);
  for (const key of ['all', 'page', 'task', 'quick-note', 'daily-note', 'nápad', 'schůzka', 'all']) await click(filterBtn(page, key), `filter ${key}`);
  for (const title of ['Koupit mléko', 'Nápad na článek']) {
    await openTriage(page, title);
    await page.keyboard.press('Escape');
  }
  await (await must(cardAt(page, I.Q1), 'Q1')).focus();
  await page.keyboard.press('a');
  await must(page.getByRole('dialog', { name: 'Append "Koupit mléko" to…' }), 'Append picker');
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  await must(page.getByRole('dialog', { name: 'Link "Koupit mléko" to…' }), 'Link picker');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  await click(markAllBtn(page), 'Mark all reviewed');
  await click(page.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel');
  for (const s of ['Go to Settings: Vault', 'Go to Settings: Menu bar and startup', 'Go to Settings: Shortcuts']) await runCommand(page, s);
  assert.deepEqual(await vaultWrites(core), [], 'zero write commands');
  assert.deepEqual(await core.writesTo(), [], 'no file written');
});
