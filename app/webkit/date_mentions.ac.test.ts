// MS4 slice 4B, L5 (WebKit + fake core): `@` date mentions and date links. FR-DLY-08 AC-1…AC-8 (verifies links.md
// FR-DLY-08 AC-1…AC-3 as reworded by D-333, and FR-LNK-04 AC-3). docs/acceptance/daily-notes.md; interface
// docs/contracts/ms4-daily.md §6.4 (`dateRows`, row order), §7.2 (date-link activation replaces D-142), ms3-shell §15.5
// (`@` trigger, listbox `Link suggestions`), ms4-links §5.2 (chips with `data-link-kind`). Clock, zone and region
// injected; (TZ) criteria run in Europe/Prague and America/Los_Angeles. Written from the ACs and the contract only
// (D-61). Missing elements fail an assertion (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  D, ZONES, absent, backlinksPanel, backlinksTab, calendar, caretAtEnd, chips, cmdD, dailyVault, dayButton, editorBody, eventually, fileWhen,
  flat, gotoDaily, isDisabled, linkSuggestions, longDate, main, must, mustBeOn, mustDaily, runCommand, seen, startDaily, stateIs, titleField, tzTag,
  virtualMarker, writeCalls,
} from './daily-helpers';

const LOCAL: Record<string, string> = { 'Europe/Prague': '+02:00', 'America/Los_Angeles': '-07:00' };
/** D-368: a backlinks panel entry is a `link` chip with `data-link-kind="note"` named by the source title. */
const noteChip = (scope: Locator, title: string) => scope.getByRole('link', { name: title, exact: true }).and(scope.page().locator('[data-link-kind="note"]'));

async function options(page: Page): Promise<string[]> {
  const l = await must(linkSuggestions(page), 'listbox "Link suggestions"');
  return (await l.getByRole('option').allInnerTexts()).map(flat);
}
async function optionsWhen(page: Page, ok: (o: string[]) => boolean, ms = 1500) {
  return eventually(() => options(page), ok, ms);
}
/** In Zmínky's body, at the end of the last paragraph, types ` @<query>` and returns the shown options. */
async function mention(page: Page, query: string, insert = false): Promise<string[]> {
  await caretAtEnd(page);
  if (insert) await page.keyboard.insertText(` @${query}`);
  else await page.keyboard.type(` @${query}`);
  return optionsWhen(page, (o) => o.length > 0);
}
async function savedZminky(core: Awaited<ReturnType<typeof startDaily>>, has: string) {
  return fileWhen(core, D.zminky, (t) => !!t?.includes(has), 3000);
}

// ------------------------------------------------------------------------------------------------ AC-1, AC-2

for (const tz of ZONES) {
  test.describe(`@ date rows in ${tz}`, () => {
    test.use({ timezoneId: tz });

    test(`fr_dly_08_ac1_at_today_inserts_todays_date_link_${tzTag(tz)}`, async ({ page }) => {
      const core = await startDaily(page, { at: D.zminky, region: 'en' });
      await mustBeOn(page, 'Zmínky', 'landing', 5000);
      const o = await mention(page, 'today');
      assert.equal(o[0], 'Today, 2026-10-14', `the first row is Today, 2026-10-14: ${o.join(' | ')}`);
      assert.ok(await seen(linkSuggestions(page).getByRole('option').first().locator('[data-icon="calendar"], [data-icon="date"], svg'), 500), 'with the date icon');
      await page.keyboard.press('Enter');
      const t = await savedZminky(core, 'Kolize [[2026-10-16]]. [[2026-10-14]]');
      assert.ok(t?.includes('Kolize [[2026-10-16]]. [[2026-10-14]]'), '@today is replaced with [[2026-10-14]] and saved');
      assert.ok(!t?.includes('@today'), 'the @ text is gone');
    });

    for (const [q, want] of [['tomorrow', '2026-10-15'], ['yesterday', '2026-10-13'], ['tod', '2026-10-14'], ['tom', '2026-10-15']] as const) {
      test(`fr_dly_08_ac1_at_${q}_${tzTag(tz)}`, async ({ page }) => {
        const core = await startDaily(page, { at: D.zminky, region: 'en' });
        await mustBeOn(page, 'Zmínky', 'landing', 5000);
        const o = await mention(page, q);
        assert.ok(o[0]?.endsWith(want), `@${q}: the first row is for ${want}: ${o.join(' | ')}`);
        await page.keyboard.press('Enter');
        assert.ok((await savedZminky(core, `. [[${want}]]`))?.includes(`. [[${want}]]`), `[[${want}]] inserted`); // Zmínky already holds [[2026-10-14]]: wait for the new one
      });
    }

    test(`fr_dly_08_ac1_rows_follow_local_midnight_${tzTag(tz)}`, async ({ page }) => {
      await startDaily(page, { at: D.zminky, region: 'en', now: `2026-10-14T23:59:59${LOCAL[tz]}` });
      await mustBeOn(page, 'Zmínky', 'landing', 5000);
      assert.equal((await mention(page, 'today'))[0], 'Today, 2026-10-14', 'at 23:59:59 local');
      await page.keyboard.press('Escape');
      await page.clock.setFixedTime(new Date(`2026-10-15T00:00:00${LOCAL[tz]}`));
      assert.equal((await mention(page, 'today'))[0], 'Today, 2026-10-15', 'at 00:00:00 local');
    });
  });
}

test.describe('@ in Czech and dates', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_dly_08_ac1_czech_keywords_nfc_nfd_and_without_diacritics', async ({ page }) => {
    await startDaily(page, { at: D.zminky, region: 'cs' });
    await mustBeOn(page, 'Zmínky', 'landing', 5000);
    for (const [q, want, nfd] of [['dnes', '2026-10-14', false], ['zítra', '2026-10-15', false], ['zítra', '2026-10-15', true], ['zitra', '2026-10-15', false], ['včera', '2026-10-13', false], ['včera', '2026-10-13', true]] as const) {
      const o = await mention(page, q, nfd);
      assert.ok(o[0]?.endsWith(want), `@${q.normalize('NFC')}${nfd ? ' (NFD)' : ''}: the first row is for ${want}: ${o.join(' | ')}`);
      await page.keyboard.press('Escape');
    }
  });

  test('fr_dly_08_ac2_typed_dates_and_row_order', async ({ page }) => {
    await startDaily(page, { at: D.zminky, region: 'en' });
    await mustBeOn(page, 'Zmínky', 'landing', 5000);
    const o = await mention(page, '2026-10-20');
    assert.equal(o[0], '2026-10-20', 'the date row first');
    assert.equal(o[o.length - 1].startsWith('Create'), true, 'Create is last');
    assert.equal(o[o.length - 2], 'Pick a date…', 'Pick a date… before Create');
    await page.keyboard.press('Escape');
    const z = await mention(page, 'Zm');
    const iz = z.findIndex((x) => x.startsWith('Zmínky')), ip = z.indexOf('Pick a date…'), ic = z.findIndex((x) => x.startsWith('Create'));
    assert.ok(iz >= 0 && iz < ip && ip < ic, `note rows, then Pick a date…, then Create: ${z.join(' | ')}`);
    await page.keyboard.press('Escape');
    for (const bad of ['2026-02-30', '2026-13-01']) {
      const b = await mention(page, bad);
      assert.ok(!b.some((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)), `@${bad}: no date row: ${b.join(' | ')}`);
      await page.keyboard.press('Escape');
    }
  });

  for (const [region, typed] of [['cs', '20.10.2026'], ['en-US', '10/20/2026']] as const) {
    test(`fr_dly_08_ac2_region_short_date_${region.replace('-', '_')}`, async ({ page }) => {
      const core = await startDaily(page, { at: D.zminky, region });
      await mustBeOn(page, 'Zmínky', 'landing', 5000);
      const o = await mention(page, typed);
      assert.equal(o[0], '2026-10-20', `@${typed} gives the row 2026-10-20`);
      await page.keyboard.press('Enter');
      assert.ok((await savedZminky(core, '. [[2026-10-20]]'))?.includes('Kolize [[2026-10-16]]. [[2026-10-20]]'), '[[2026-10-20]]');
    });
  }

  test('fr_dly_08_ac3_pick_a_date_row', async ({ page }) => {
    const core = await startDaily(page, { at: D.zminky, region: 'en' });
    await mustBeOn(page, 'Zmínky', 'landing', 5000);
    await mention(page, 'Ko');
    await (await must(linkSuggestions(page).getByRole('option', { name: 'Pick a date…', exact: true }), 'row Pick a date…')).click();
    await must(calendar(page), 'dialog "Calendar" at the caret');
    await page.keyboard.press('Escape');
    const back = await optionsWhen(page, (o) => o.length > 0);
    assert.ok(back.length > 0 && (await editorBody(page).innerText()).includes('@Ko'), 'Esc returns to the list with the query intact');
    await (await must(linkSuggestions(page).getByRole('option', { name: 'Pick a date…', exact: true }), 'row Pick a date…')).click();
    await (await must(dayButton(page, longDate('2026-10-20', 'en')), 'day 20')).click();
    const t = await savedZminky(core, '. [[2026-10-20]]');
    assert.ok(t?.includes('Kolize [[2026-10-16]]. [[2026-10-20]]'), '[[2026-10-20]] at the @ position');
    assert.ok(!t?.includes('@Ko'), 'the query is replaced');
  });

  test('fr_dly_08_ac4_where_the_trigger_works_space_and_undo', async ({ page }) => {
    const core = await startDaily(page, { at: D.zminky, region: 'en' });
    await mustBeOn(page, 'Zmínky', 'landing', 5000);
    await (await must(titleField(page), 'title field')).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' @today');
    assert.ok(await absent(linkSuggestions(page), 500), 'no @ list in the title');
    await page.keyboard.press('Meta+z');
    await caretAtEnd(page);
    await page.keyboard.type(' `@today');
    assert.ok(await absent(linkSuggestions(page), 500), 'no @ list in code');
    await page.keyboard.type('` ');
    const o = await mention(page, 'today');
    assert.equal(o[0], 'Today, 2026-10-14', 'the list opens in body text');
    await page.keyboard.type(' ');
    assert.ok(await seen(linkSuggestions(page), 300), 'a space keeps the list open while a date row matches (D-263)');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await savedZminky(core, '[[2026-10-14]]');
    await page.keyboard.press('Meta+z');
    assert.ok(await eventually(async () => (await editorBody(page).innerText()).includes('@today'), (v) => v, 1000), '⌘Z restores @today as text');
  });
});

// ------------------------------------------------------------------------------------------------ AC-5…AC-8

const KINDS: [string, string][] = [
  ['2026-10-14', 'date-missing'], ['2026-10-20', 'date-missing'], ['2026-10-07', 'daily'], ['pátek', 'daily'], ['2026-10-16', 'date-missing'], ['2026-10-12', 'daily'],
];

test.describe('date links', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  for (const readView of [false, true]) {
    test(`fr_dly_08_ac5_date_links_are_never_broken_${readView ? 'read_view' : 'editor'}`, async ({ page }) => {
      if (readView) await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; });
      await startDaily(page, { at: D.zminky });
      await mustBeOn(page, 'Zmínky', 'landing', 5000);
      const scope = main(page);
      for (const [text, kind] of KINDS) {
        const c = await must(chips(scope, text), `chip ${text}`);
        assert.equal(await c.getAttribute('data-link-kind'), kind, `${text}: data-link-kind ${kind}`);
        assert.equal(await isDisabled(c), false, `${text}: not a disabled control (D-142 ended)`);
        const style = await c.evaluate((e) => getComputedStyle(e).textDecorationStyle);
        assert.notEqual(style, 'dashed', `${text}: not the broken style`);
      }
      const bad = await must(chips(scope, '2026-02-30'), 'chip 2026-02-30');
      assert.equal(await bad.getAttribute('data-link-kind'), 'unresolved', '[[2026-02-30]] is not a date (D-332)');
      assert.equal(await bad.evaluate((e) => getComputedStyle(e).textDecorationStyle), 'dashed', 'it has the broken style');
    });
  }

  test('fr_dly_08_ac5_broken_links_page_lists_only_the_invalid_date', async ({ page }) => {
    await startDaily(page, { at: D.zminky });
    await mustBeOn(page, 'Zmínky', 'landing', 5000);
    const kind = await (await must(chips(main(page), '2026-02-30'), 'chip 2026-02-30')).getAttribute('data-link-kind');
    assert.equal(kind, 'unresolved', 'red guard: [[2026-02-30]] is unresolved (D-332)');
    await runCommand(page, 'Go to Broken links');
    await mustBeOn(page, 'Broken links', 'Broken links', 5000);
    const groups = (await main(page).getByRole('group').evaluateAll((gs) => gs.map((g) => g.getAttribute('aria-label') ?? ''))).map(flat);
    assert.ok(groups.some((g) => g.startsWith('2026-02-30')), `2026-02-30 is listed: ${groups.join(' | ')}`);
    for (const d of ['2026-10-14', '2026-10-20', '2026-10-16', '2026-10-07']) assert.ok(!groups.some((g) => g.startsWith(d)), `${d} is never broken`);
  });

  test('fr_dly_08_ac6_activating_a_date_link_opens_the_note', async ({ page }) => {
    const v = dailyVault((f) => { f[D.zminky] = f[D.zminky].replace('Kolize [[2026-10-16]].', 'Kolize [[2026-10-16]].\n\nRáno [[2026-10-14#Ráno]].'); });
    const core = await startDaily(page, { vault: v, at: D.zminky });
    await mustBeOn(page, 'Zmínky', 'landing', 5000);
    const open = async (what: string, chip: ReturnType<typeof main>, date: string) => {
      const c = await must(chip, `chip ${what}`);
      assert.equal(await isDisabled(c), false, `${what}: enabled (the Coming in MS4 state is gone)`);
      await c.click();
      await mustDaily(page, date, `[[${what}]]`);
      await page.keyboard.press('Meta+BracketLeft');
      await mustBeOn(page, 'Zmínky', 'Back');
    };
    await open('2026-10-20', chips(main(page), '2026-10-20'), '2026-10-20');
    await open('2026-10-07', chips(main(page), '2026-10-07'), '2026-10-07');
    await open('2026-10-12', chips(main(page), '2026-10-12'), '2026-10-12');
    // A subpath chip reads `2026-10-14 › Ráno` (D-156) or `2026-10-14#Ráno`; it opens 14 Oct at the top (D-332).
    await open('2026-10-14#Ráno', main(page).locator('[data-link-kind]').filter({ hasText: /^\s*2026-10-14( › |#)Ráno\s*$/ }), '2026-10-14');
    assert.ok(await absent(page.getByRole('dialog', { name: 'Create note' }), 300), 'no Create dialog');
    assert.deepEqual(await writeCalls(core), [], 'opening date links writes nothing');
  });

  test('fr_dly_08_ac6_twelfth_opens_the_newest_and_twentieth_is_virtual', async ({ page }) => {
    await startDaily(page, { at: D.zminky });
    await mustBeOn(page, 'Zmínky', 'landing', 5000);
    const c12 = await must(chips(main(page), '2026-10-12'), 'chip 2026-10-12');
    assert.equal(await isDisabled(c12), false, 'enabled');
    await c12.click();
    await mustDaily(page, '2026-10-12', '[[2026-10-12]]');
    assert.ok(await seen(editorBody(page).getByText('Novější zápis z druhého zařízení.'), 2000), '12 Oct (2) (D-319)');
    await page.keyboard.press('Meta+BracketLeft');
    await mustBeOn(page, 'Zmínky', 'Back');
    await (await must(chips(main(page), '2026-10-20'), 'chip 2026-10-20')).click();
    await mustDaily(page, '2026-10-20', '[[2026-10-20]]');
    assert.ok(await seen(virtualMarker(page), 1000), 'virtual');
  });

  test('fr_dly_08_ac6_read_view_enter_on_a_focused_chip', async ({ page }) => {
    await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; });
    const core = await startDaily(page, { at: D.zminky });
    await mustBeOn(page, 'Zmínky', 'landing', 5000);
    const c = await must(chips(main(page), '2026-10-20'), 'chip 2026-10-20 in the read view');
    assert.equal(await isDisabled(c), false, 'enabled');
    await c.focus();
    await page.keyboard.press('Enter');
    await mustDaily(page, '2026-10-20', '⏎ on the focused chip');
    assert.deepEqual(await writeCalls(core), [], 'nothing written');
  });

  test('fr_dly_08_ac7_backlinks_of_a_virtual_note', async ({ page }) => {
    const core = await startDaily(page, { panel: true });
    await gotoDaily(page, '2026-10-20');
    const q = await eventually(async () => (await core.calls()).filter((c) => c.cmd === 'daily_backlinks'), (x) => x.length > 0, 2000);
    assert.ok(q.some((c) => (c.args as any)?.date === '2026-10-20'), 'the panel of a virtual date comes from daily_backlinks(date) (D-348)');
    const tab = await must(backlinksTab(page), 'tab "Backlinks"');
    assert.equal(flat(await tab.innerText()).replace(/^Backlinks\s*/, ''), '1', 'badge 1');
    const p = await must(backlinksPanel(page), 'tabpanel "Backlinks"');
    // D-368: the panel shows one chip per source, no excerpts.
    assert.ok(await seen(noteChip(p, 'Zmínky'), 1000), 'chip Zmínky');
    await gotoDaily(page, '2026-10-12'); // ⌘D always opens today (14 Oct)
    assert.ok(await seen(noteChip(backlinksPanel(page), 'Zmínky'), 1000), '12 Oct (2): Zmínky listed');
    await gotoDaily(page, '2026-10-09'); // ⌘D always opens today (14 Oct)
    assert.ok(await seen(noteChip(backlinksPanel(page), 'Zmínky'), 1000), '9 Oct: Zmínky listed for the alias link');
    await cmdD(page, '2026-10-14');
    await gotoDaily(page, '2026-10-20');
    await caretAtEnd(page);
    await page.keyboard.type('Budoucnost');
    assert.ok(await stateIs(page, 'Saved', 3000), 'first write of 20 Oct');
    assert.equal(flat(await backlinksTab(page).innerText()).replace(/^Backlinks\s*/, ''), '1', 'the panel is unchanged after the first write');
  });

  test('fr_dly_08_ac7_the_older_twelfth_has_no_backlink_and_nfd_counts', async ({ page }) => {
    const v = dailyVault((f) => { f['Pages/Zítra.md'] = '---\nid: 01JB4B0000000000000000W030\ntype: page\ntitle: Zítra\n---\nZítra [[2026-10-15]].\n'; });
    await startDaily(page, { vault: v, panel: true });
    await gotoDaily(page, '2026-10-15');
    assert.ok(await seen(noteChip(backlinksPanel(page), 'Zítra'), 1000), 'NFD text counts the same');
    await gotoDaily(page, '2026-10-12'); // ⌘D always opens today (14 Oct)
    const notice = page.getByRole('region', { name: 'Other notes for this date', exact: true });
    await (await must(notice.getByRole('link', { name: D.d12, exact: true }), `link ${D.d12}`)).click();
    await mustBeOn(page, '2026-10-12', 'the older 12 Oct');
    assert.ok(await absent(noteChip(backlinksPanel(page), 'Zmínky'), 1000), 'Zmínky is not listed on the older 12 Oct');
  });

  test('fr_dly_08_ac8_date_links_in_text_and_relation_values', async ({ page }) => {
    const v = dailyVault((f) => {
      f['.tegg/types/událost.yml'] = '# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg\'s type settings.\nversion: 1\nname: Událost\nplural: Události\nsystem: false\nfolder: Události\nicon: calendar\ncolor: teal\nreview: false\npreview: [poznámka]\nattributes:\n  - key: poznámka\n    name: Poznámka\n    type: text\n  - key: den\n    name: Den\n    type: relation\n';
      f['Události/Výlet.md'] = '---\nid: 01JB4B0000000000000000W031\ntype: událost\ntitle: Výlet\npoznámka: "[[2026-10-20]]"\nden: "[[2026-10-20]]"\ncreated: 2026-10-02T10:00:00+02:00\nmodified: 2026-10-02T10:00:00+02:00\n---\nNa hory.\n';
    });
    const core = await startDaily(page, { vault: v, at: 'Události/Výlet.md', panel: true });
    await mustBeOn(page, 'Výlet', 'landing', 5000);
    const props = page.getByRole('region', { name: 'Properties', exact: true });
    const cs = props.locator('[data-link-kind]').filter({ hasText: /^\s*2026-10-20\s*$/ });
    assert.equal(await eventually(() => cs.count(), (n) => n >= 2, 2000), 2, 'a chip in the Text and in the Relation value');
    for (let i = 0; i < 2; i++) {
      const c = cs.nth(i);
      assert.equal(await c.getAttribute('data-link-kind'), 'date-missing', `value ${i}: date-missing`);
      assert.equal(await isDisabled(c), false, `value ${i}: enabled`);
    }
    await cs.nth(0).click();
    await mustDaily(page, '2026-10-20', 'the Text value opens the virtual note');
    // D-368: no attribute labels; links from two properties make the source one chip.
    assert.ok(await seen(noteChip(backlinksPanel(page), 'Výlet'), 1000), 'chip Výlet');
    assert.equal(await noteChip(backlinksPanel(page), 'Výlet').count(), 1, 'one chip for both property links');
    assert.deepEqual(await writeCalls(core), [], 'nothing written');
  });
});

