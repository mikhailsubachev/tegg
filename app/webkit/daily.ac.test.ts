// MS4 slice 4B, L5 (WebKit + fake core): the Daily Note page. FR-DLY-01 AC-1…AC-3, AC-4, AC-5…AC-9, AC-10, AC-11;
// FR-DLY-02 AC-1…AC-4, AC-6…AC-9; FR-DLY-05 AC-1…AC-4; FR-DLY-06 AC-4, AC-5; FR-FMT-09 AC-4 (the `@`-free part).
// docs/acceptance/daily-notes.md (R17, R19); interface docs/contracts/ms4-daily.md §4, §4.1, §7, §8. Clock (Playwright
// `clock`), zone (`timezoneId`) and region (`__TEGG_REGION__`) are injected; (TZ) criteria run in Europe/Prague and
// America/Los_Angeles. Written from the ACs and the contract only (D-61). Every lookup goes through `must` /
// node:assert with short timeouts, so a missing daily page fails an assertion (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  D, NOW, NOW_IN, ZONES, absent, bodyOf, btn, callsOf, caretAtEnd, cmdD, dailyVault, description, duplicateNotice, editorBody, eventually,
  fileText, fileWhen, flat, gotoDaily, gotoNote, isDisabled, keysOf, main, mainName, must, mustBeOn, mustDaily, nextDay, original, pickDate,
  prevDay, reviewToggle, runCommand, saveState, seen, sidebarToday, sleep, startDaily, stateIs, swap, templateBody, titleField, titleText,
  changeTypeItem, linkSuggestions, moreButton, todayBtn, typeChip, tzTag, virtualMarker, writeCalls,
} from './daily-helpers';
import { ui as dailyUi } from './daily-helpers';
import { setPreviewMode } from '../ui/test/fake-core';
import { goToQuery, searchResultsList } from './helpers'; // D-1345: the Search page's results (D-1340)
import { pickNewObjectType } from './helpers'; // D-1431: ⌘N / New object open the type picker first

const LONG_14: Record<string, string> = { cs: 'středa 14. října 2026', en: 'Wednesday, October 14, 2026' };
const LONG_15_EN = 'Thursday, October 15, 2026';
const LOCAL: Record<string, string> = { 'Europe/Prague': '+02:00', 'America/Los_Angeles': '-07:00' };

async function created(core: Awaited<ReturnType<typeof startDaily>>) {
  const c = await eventually(() => callsOf(core, 'daily_create'), (x) => x.some((y) => y.ok === true), 3000);
  return c;
}

// ------------------------------------------------------------------------------------------------ FR-DLY-01

for (const tz of ZONES) {
  test.describe(`today in ${tz}`, () => {
    test.use({ timezoneId: tz });

    for (const region of ['cs', 'en'] as const) {
      test(`fr_dly_01_ac1_cmd_d_sidebar_and_palette_open_today_${region}_${tzTag(tz)}`, async ({ page }) => {
        const core = await startDaily(page, { region, at: D.zminky });
        await mustBeOn(page, 'Zmínky', 'landing on Zmínky', 5000);
        // ⌘D with the focus in the body.
        await (await must(editorBody(page), 'textbox "Note body"')).click();
        const n0 = (await callsOf(core, 'nav_opened')).length;
        await cmdD(page, '2026-10-14', '⌘D from the body');
        assert.ok(await seen(main(page).getByText(LONG_14[region], { exact: true }), 1000), `subtitle ${LONG_14[region]} (D-337)`);
        const opened = (await callsOf(core, 'nav_opened')).slice(n0).map((c) => c.args as any);
        assert.ok(opened.some((a) => a?.route === 'daily/2026-10-14' && (a?.path ?? null) === null), `nav_opened({ route: 'daily/2026-10-14', path: null }) (D-138, D-349): ${JSON.stringify(opened)}`);
        await page.keyboard.press('Meta+BracketLeft');
        await mustBeOn(page, 'Zmínky', 'Back returns to the previous route');
        // ⌘D from the title field and from the sidebar.
        await (await must(titleField(page), 'title field')).click();
        await cmdD(page, '2026-10-14', '⌘D from the title');
        await page.keyboard.press('Meta+BracketLeft');
        await mustBeOn(page, 'Zmínky', 'Back');
        const entry = await must(sidebarToday(page), 'sidebar link "Today"');
        await entry.focus();
        await cmdD(page, '2026-10-14', '⌘D from the sidebar');
        assert.equal(await sidebarToday(page).getAttribute('aria-current'), 'page', 'Today is the current route');
        await page.keyboard.press('Meta+BracketLeft');
        await mustBeOn(page, 'Zmínky', 'Back');
        await (await must(sidebarToday(page), 'sidebar link "Today"')).click();
        await mustDaily(page, '2026-10-14', 'sidebar Today');
        assert.equal(await description(sidebarToday(page)), LONG_14[region], 'the sidebar description is the long date');
        await page.keyboard.press('Meta+BracketLeft');
        await mustBeOn(page, 'Zmínky', 'Back');
        await runCommand(page, 'Go to Today');
        await mustDaily(page, '2026-10-14', 'palette Go to Today');
        assert.deepEqual(await writeCalls(core), [], 'none of them sends a write command');
      });
    }

    test(`fr_dly_01_ac2_midnight_is_local_${tzTag(tz)}`, async ({ page }) => {
      const core = await startDaily(page, { now: `2026-10-14T23:59:59${LOCAL[tz]}` });
      await cmdD(page, '2026-10-14', 'local 23:59:59');
      await page.clock.setFixedTime(new Date(`2026-10-15T00:00:00${LOCAL[tz]}`));
      await cmdD(page, '2026-10-15', 'local 00:00:00');
      await page.clock.setFixedTime(new Date('2026-10-14T22:30:00Z'));
      await cmdD(page, tz === 'Europe/Prague' ? '2026-10-15' : '2026-10-14', '22:30Z');
      assert.deepEqual(await writeCalls(core), [], 'no writes');
    });

    test(`fr_dly_01_ac3_midnight_while_a_note_is_open_${tzTag(tz)}`, async ({ page }) => {
      const core = await startDaily(page, { install: true, now: `2026-10-14T23:59:58${LOCAL[tz]}`, region: 'en' });
      await cmdD(page, '2026-10-14', 'before midnight');
      await page.clock.runFor(5_000);
      assert.equal(await titleText(page), '2026-10-14', 'no automatic switch (D-327)');
      await caretAtEnd(page);
      await page.keyboard.type('Po půlnoci');
      await page.clock.runFor(3_000);
      const c = await created(core);
      const a = c.find((x) => x.ok)?.args as any;
      assert.equal(a?.date, '2026-10-14', 'typing still goes into 14 Oct');
      assert.match(String(a?.text ?? ''), /^date: 2026-10-14$/m, 'its first write has date: 2026-10-14');
      await page.clock.runFor(60_000);
      assert.equal(await description(sidebarToday(page)), LONG_15_EN, 'the sidebar Today description becomes 15 Oct within 60 s');
      await cmdD(page, '2026-10-15', 'the next ⌘D');
    });
  });
}

/** D-607 (v0.52): the review control is a checkbox (`aria-checked`). */
const rev = (page: Page, name: string) => main(page).getByRole('checkbox', { name, exact: true });

test.describe('which note a date opens', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_dly_01_ac4_an_existing_note_opens_never_a_second_one', async ({ page }) => {
    const core = await startDaily(page, { now: '2026-10-07T12:00:00+02:00' });
    await cmdD(page, '2026-10-07', '⌘D on 7 Oct');
    assert.ok(await seen(editorBody(page).getByText('Ráno porada, příliš žluťoučký kůň úpěl ďábelské ódy.'), 2000), "Daily/2026-10-07.md's body");
    assert.ok(await absent(virtualMarker(page), 500), 'not virtual');
    await step3(page, 3);
    await mustDaily(page, '2026-10-10', 'Archiv by date');
    assert.ok(await seen(editorBody(page).getByText('Starý formát názvu.'), 2000), "Archiv's body for 10 Oct (FR-FMT-09 AC-2)");
    assert.deepEqual(await writeCalls(core), [], 'no writes');
  });

  test('fr_dly_01_ac5_create_entry_points_open_todays_note_and_write_nothing', async ({ page }) => {
    const core = await startDaily(page);
    await runCommand(page, 'Go to type: Daily Notes');
    await mustBeOn(page, 'Daily Notes', 'Daily Notes type page', 5000);
    await (await must(main(page).getByRole('button', { name: 'New Daily Note', exact: true }), 'button "New Daily Note"')).click();
    await mustDaily(page, '2026-10-14', 'New on the Daily Notes type page');
    assert.ok(await seen(virtualMarker(page), 1000), 'virtual');
    assert.deepEqual(await writeCalls(core), [], 'nothing written');
    assert.equal((await callsOf(core, 'note_create')).length, 0, 'note_create is never sent for a Daily Note');
  });

  test('fr_dly_01_ac5_new_object_with_default_type_daily_note_opens_today', async ({ page }) => {
    // D-353: every create path whose type is Daily Note opens today's Daily Note instead of a dialog.
    const v = dailyVault((f) => { f['.tegg/vault.yml'] = swap(f['.tegg/vault.yml'], 'default-type: Quick Note', 'default-type: Daily Note'); });
    const core = await startDaily(page, { vault: v });
    // D-1431, D-1432: ⌘N and the palette's `New object…` open the type picker with Daily Note selected; ⏎ opens today.
    await page.keyboard.press('Meta+n');
    await pickNewObjectType(page, '⌘N (New object) with default-type Daily Note');
    await mustDaily(page, '2026-10-14', '⌘N (New object) with default-type Daily Note');
    assert.ok(await absent(page.getByRole('dialog', { name: 'New object' }), 300), 'no New object dialog');
    await runCommand(page, 'New object…');
    await pickNewObjectType(page, 'palette New object…');
    await mustDaily(page, '2026-10-14', 'palette New object…');
    assert.deepEqual(await writeCalls(core), [], 'nothing written');
  });

  test('fr_dly_01_ac5_on_7_october_create_opens_the_existing_note', async ({ page }) => {
    const core = await startDaily(page, { now: '2026-10-07T09:00:00+02:00' });
    await runCommand(page, 'Go to type: Daily Notes');
    await mustBeOn(page, 'Daily Notes', 'Daily Notes type page', 5000);
    await (await must(main(page).getByRole('button', { name: 'New Daily Note', exact: true }), 'button "New Daily Note"')).click();
    await mustDaily(page, '2026-10-07', 'New on 7 Oct');
    assert.ok(await seen(editorBody(page).getByText('Ráno porada', { exact: false }), 2000), 'the existing 7 Oct note');
    assert.deepEqual(await writeCalls(core), [], 'nothing written');
  });

  test('fr_dly_01_ac5_fake_core_refuses_note_create_of_a_daily_note', async ({ page }) => {
    await startDaily(page);
    const r = await page.evaluate(async () => {
      try {
        await (window as any).__TAURI_INTERNALS__.invoke('note_create', { type: 'daily-note', title: '2026-10-14', text: '---\ntype: daily-note\ntitle: "2026-10-14"\ndate: 2026-10-14\n---\n' });
        return 'ok';
      } catch (e: any) {
        return String(e?.kind ?? e);
      }
    });
    assert.equal(r, 'UseDailyNote', 'note_create(daily-note) → UseDailyNote in the fake as in the core (D-318)');
  });

  for (const tz of ZONES) {
    test.describe(`newest in ${tz}`, () => {
      test.use({ timezoneId: tz });
      test(`fr_dly_01_ac6_two_notes_for_one_date_the_newest_opens_${tzTag(tz)}`, async ({ page }) => {
        const core = await startDaily(page);
        await gotoDaily(page, '2026-10-12');
        assert.ok(await seen(editorBody(page).getByText('Novější zápis z druhého zařízení.'), 2000), '12 Oct (2) opens (latest created)');
        // 21:30+03:00 = 18:30Z, older than (2): (2) still opens.
        await core.setFile(D.d12, swap(original(D.d12), 'created: 2026-10-12T08:00:00+02:00', 'created: 2026-10-12T21:30:00+03:00'));
        await sleep(500);
        assert.ok(await seen(editorBody(page).getByText('Novější zápis z druhého zařízení.'), 1000), 'ordering is by instant');
        await core.setFile(D.d12, swap(original(D.d12), 'created: 2026-10-12T08:00:00+02:00', 'created: 2026-10-12T22:00:00+02:00'));
        assert.ok(await seen(editorBody(page).getByText('Starší zápis.'), 2000), '12 Oct opens within 2 s once it is the newest');
      });
    });
  }

  test('fr_dly_01_ac7_duplicate_notice_and_its_links', async ({ page }) => {
    const core = await startDaily(page);
    const before = await core.files();
    await gotoDaily(page, '2026-10-12');
    const notice = await must(duplicateNotice(page), 'region "Other notes for this date"');
    assert.ok(flat(await notice.innerText()).startsWith('1 other note has this date:'), `notice text: ${flat(await notice.innerText())}`);
    const other = await must(notice.getByRole('link', { name: D.d12, exact: true }), `link ${D.d12}`);
    assert.ok(await seen(notice.getByRole('link', { name: 'Duplicate titles', exact: true }), 500), 'link Duplicate titles');
    await other.click();
    await mustBeOn(page, '2026-10-12', 'note/Daily/2026-10-12.md', 3000);
    assert.ok(await seen(editorBody(page).getByText('Starší zápis.'), 2000), 'the older note is shown');
    const n2 = await must(duplicateNotice(page), 'the notice on the duplicate');
    assert.ok(await seen(n2.getByRole('link', { name: D.d12b, exact: true }), 1000), `it names ${D.d12b}`);
    await (await must(n2.getByRole('link', { name: 'Duplicate titles', exact: true }), 'link Duplicate titles')).click();
    await mustBeOn(page, 'Duplicate titles', 'route duplicate-titles', 3000);
    assert.deepEqual(await writeCalls(core), [], 'opening, reading and following the notice write nothing');
    assert.deepEqual(await core.files(), before, 'nothing merged, renamed or deleted');
  });

  test('fr_dly_01_ac7_no_notice_without_duplicates', async ({ page }) => {
    await startDaily(page, { now: '2026-10-07T12:00:00+02:00' });
    await cmdD(page, '2026-10-07');
    assert.ok(await absent(duplicateNotice(page), 1000), 'no notice on 7 Oct');
  });

  test('fr_dly_01_ac8_duplicate_titles_page_and_live_changes', async ({ page }) => {
    const core = await startDaily(page);
    await runCommand(page, 'Go to Duplicate titles');
    await mustBeOn(page, 'Duplicate titles', 'Duplicate titles', 5000);
    const g = await must(main(page).getByRole('group', { name: '2026-10-12, 2', exact: true }), 'group "2026-10-12, 2"');
    assert.equal(await g.getByRole('link').count(), 2, 'both 12 Oct notes');
    assert.ok(await absent(main(page).getByRole('group', { name: /^Pátek|^2026-10-09/ }), 500), 'Pátek is not a duplicate');
    await core.setFile('Jinde/třetí.md', '---\nid: 01JB4B0000000000000000W001\ntype: daily-note\ntitle: "2026-10-12"\ndate: 2026-10-12\ncreated: 2026-10-12T23:00:00+02:00\n---\nTřetí.\n');
    await must(main(page).getByRole('group', { name: '2026-10-12, 3', exact: true }), 'group grows to 3', 2000);
    await gotoDaily(page, '2026-10-12');
    assert.ok(await seen(editorBody(page).getByText('Třetí.'), 2000), 'the newest created opens');
    assert.ok(flat(await (await must(duplicateNotice(page), 'notice')).innerText()).startsWith('2 other notes have this date:'), 'plural notice');
    await core.setFile('Jinde/třetí.md', null);
    await core.setFile(D.d12b, null);
    assert.ok(await seen(editorBody(page).getByText('Starší zápis.'), 2000), '12 Oct opens the remaining note within 2 s');
    assert.ok(await absent(duplicateNotice(page), 2000), 'the notice is gone');
  });

  test('fr_dly_01_ac9_the_type_chip_is_locked_on_daily_notes', async ({ page }) => {
    await startDaily(page, { now: '2026-10-07T12:00:00+02:00', at: D.zminky });
    await cmdD(page, '2026-10-07');
    // D-369: the chip is the link `Type: Daily Note`; the reason moves to `Change type…` in the `More` menu.
    const chip = await must(typeChip(page), 'the type chip');
    assert.equal(await chip.getAttribute('aria-label'), 'Type: Daily Note', 'the link Type: Daily Note (accessible name)');
    await (await must(moreButton(page), 'button "More"')).click();
    const item = await must(changeTypeItem(page), 'menuitem "Change type…"');
    assert.equal(await isDisabled(item), true, 'aria-disabled');
    assert.equal(await description(item), "The type of Daily Note objects can't be changed");
    await page.keyboard.press('Escape');
    await runCommand(page, 'Change type');
    await sleep(300);
    assert.ok(await absent(page.getByRole('menu', { name: 'Change type', exact: true }), 500), '`Change type` is not run');
    await gotoNote(page, 'Zmínky');
    await (await must(moreButton(page), 'More on Zmínky')).click();
    await (await must(changeTypeItem(page), 'Change type… on Zmínky')).click();
    const menu = await must(page.getByRole('menu', { name: 'Change type', exact: true }), 'menu "Change type"');
    assert.equal(await menu.getByRole('menuitem', { name: /^Daily Note\b/ }).count(), 0, 'Daily Note is not offered');
  });

  test('fr_dly_01_ac10_the_title_is_read_only', async ({ page }) => {
    const core = await startDaily(page);
    for (const date of ['2026-10-14', '2026-10-07']) {
      if (date === '2026-10-14') await cmdD(page, date);
      else await gotoDaily(page, date);
      const t = await must(titleField(page), 'title field');
      assert.equal(await t.getAttribute('aria-readonly'), 'true', `${date}: aria-readonly`);
      assert.equal(await description(t), "A Daily Note's title is its date", `${date}: R19 description`);
      await t.click();
      await page.keyboard.type('Přepsáno');
      assert.equal(await titleText(page), date, `${date}: typing in it changes nothing`);
      await page.keyboard.press('Enter');
      assert.ok(await page.evaluate(() => !!document.activeElement?.closest('[aria-label="Note body"], [role="textbox"][aria-multiline="true"]')), `${date}: Enter moves the caret to the body`);
    }
    await runCommand(page, 'Rename');
    await sleep(300);
    assert.equal(await titleText(page), '2026-10-07', 'the palette Rename does not apply');
    assert.deepEqual(await writeCalls(core), [], 'nothing written');
  });

  test('fr_dly_01_ac11_a_mismatched_title_is_shown_as_the_date', async ({ page }) => {
    const core = await startDaily(page);
    await gotoDaily(page, '2026-10-09');
    assert.equal(await titleText(page), '2026-10-09', 'title field shows the date, not Pátek');
    await goToQuery(page, 'Pátek');
    const sw = searchResultsList(page); // D-1345: the Search page's results (D-1340; before it the Go to list, D-760)
    assert.ok(await seen(sw.getByRole('link', { name: /^2026-10-09\b/ }), 2000), 'Search finds Pátek and lists it as 2026-10-09 (D-334)');
    await page.keyboard.press('Escape');
    assert.deepEqual(await writeCalls(core), [], 'opening and reading write nothing');
    await caretAtEnd(page);
    await page.keyboard.type(' Doplněno.');
    assert.ok(await stateIs(page, 'Saved', 3000), 'Saved');
    const t = await fileText(core, D.patek);
    const was = original(D.patek)!.split('\n');
    const now = (t ?? '').split('\n');
    const diff = was.map((l, i) => (l === now[i] ? null : [l, now[i]])).filter(Boolean) as [string, string][];
    assert.equal(diff.length, 3, `the edited line, modified and title change, no other line: ${JSON.stringify(diff)}`);
    assert.ok(now.includes('title: "2026-10-09"'), 'title: "2026-10-09" (D-334)');
  });

  test('fr_dly_01_ac11_an_external_date_change_moves_the_note', async ({ page }) => {
    const core = await startDaily(page);
    await gotoDaily(page, '2026-10-09');
    await core.setFile(D.patek, swap(original(D.patek), 'date: 2026-10-09', 'date: 2026-10-08'));
    await (await must(prevDay(page), 'Previous day')).click();
    await mustDaily(page, '2026-10-08', 'previous day');
    assert.ok(await seen(editorBody(page).getByText('Název se liší od data.'), 2000), 'the note now opens for 8 Oct and shows 2026-10-08 as title');
  });
});

async function step3(page: Page, n: number) {
  for (let i = 0; i < n; i++) await (await must(nextDay(page), 'Next day')).click();
}

// ------------------------------------------------------------------------------------------------ FR-DLY-02

test.describe('virtual note', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_dly_02_ac1_opening_and_leaving_writes_nothing', async ({ page }) => {
    // D-949: the date chips are opened with a single click, so the steps run under preview.mode = off.
    const core = await startDaily(page, { at: D.zminky, panel: true, ...setPreviewMode('off', { uiState: dailyUi({ open: true }) }) });
    const before = await core.files();
    await mustBeOn(page, 'Zmínky', 'landing', 5000);
    for (const t of ['2026-10-14', '2026-10-20', '2026-10-16']) {
      const chip = await must(main(page).locator('[data-link-kind]').filter({ hasText: new RegExp(`^\\s*${t}\\s*$`) }), `chip ${t}`);
      assert.equal(await isDisabled(chip), false, `${t}: the date chip is not a disabled control any more (D-142 ended)`);
      await chip.click();
      await mustDaily(page, t, `Zmínky's [[${t}]]`);
      assert.ok(await seen(virtualMarker(page), 1000), `${t}: virtual marker`);
      await caretAtEnd(page);
      await page.mouse.wheel(0, 400);
      await page.keyboard.press('Meta+BracketLeft');
      await mustBeOn(page, 'Zmínky', 'Back');
    }
    await cmdD(page, '2026-10-14');
    await step3(page, 1);
    await (await must(pickDate(page), 'Pick date')).click();
    await page.keyboard.press('Escape');
    await runCommand(page, 'Go to Search');
    await cmdD(page, '2026-10-14');
    assert.ok(await seen(virtualMarker(page), 1000), 'reopening shows the same virtual note');
    assert.deepEqual(await writeCalls(core), [], 'no write command');
    assert.deepEqual(await core.files(), before, 'no file added (no Daily/2026-10-14.md)');
  });

  for (const tz of ZONES) {
    test.describe(`first write in ${tz}`, () => {
      test.use({ timezoneId: tz });
      test(`fr_dly_02_ac2_the_first_keystroke_creates_one_file_${tzTag(tz)}`, async ({ page }) => {
        const core = await startDaily(page);
        await cmdD(page, '2026-10-14');
        assert.ok(await seen(virtualMarker(page), 1000), 'virtual');
        assert.ok(await seen(editorBody(page).getByText('Deník 14. 10. 2026'), 1000), 'the virtual note shows the expanded template (D-322)');
        await page.keyboard.type('Dnes');
        assert.ok(await stateIs(page, 'Saved', 3000), 'Saved');
        const c = (await created(core)).filter((x) => x.ok);
        assert.equal(c.length, 1, 'one daily_create');
        assert.equal((c[0].args as any).date, '2026-10-14');
        assert.equal(await writeCalls(core).then((w) => w.filter((x) => x !== 'note_write').join(',')), 'daily_create', 'no other write command');
        const t = await fileText(core, D.new14);
        assert.ok(t, 'Daily/2026-10-14.md written');
        assert.deepEqual(keysOf(t), ['id', 'type', 'title', 'date', 'tags', 'review', 'created', 'modified'], 'D-324 order');
        assert.match(t!, /^type: daily-note$/m);
        assert.match(t!, /^title: "2026-10-14"$/m);
        assert.match(t!, /^date: 2026-10-14$/m);
        assert.match(t!, /^tags: \[deník\]$/m);
        assert.match(t!, /^review: unreviewed$/m);
        assert.ok(t!.includes(`created: ${NOW_IN[tz]}\nmodified: ${NOW_IN[tz]}\n`), `the instants with the zone's offset: ${NOW_IN[tz]}`);
        const body = bodyOf(t);
        assert.ok(body.startsWith('# Deník 14. 10. 2026\n\nVčera: [[2026-10-13]] · Zítra: [[2026-10-15]] · Dnes: 2026-10-14 · {{time}}\n\n## Poznámky'), `the expanded template body: ${JSON.stringify(body)}`);
        assert.ok(body.includes('Dnes'), 'with the typed text');
        assert.ok(await absent(virtualMarker(page), 1000), 'the virtual marker disappears');
        await page.keyboard.type(' a zítra');
        assert.ok(await stateIs(page, 'Saved', 3000), 'Saved again');
        assert.equal((await callsOf(core, 'daily_create')).length, 1, 'further typing autosaves into the same file');
        assert.ok((await fileText(core, D.new14))!.includes('Dnes a zítra'), 'note_write into Daily/2026-10-14.md');
      });
    });
  }

  test('fr_dly_02_ac3_what_counts_as_a_keystroke', async ({ page }) => {
    const core = await startDaily(page);
    await cmdD(page, '2026-10-14');
    await caretAtEnd(page);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Meta+c');
    await page.keyboard.press('Meta+z');
    // Collapse the selection (typing over it would be an edit) at the line start, where `@` and `[[` open their lists
    // (D-258); elsewhere Esc would select the block (D-183) and Backspace delete it.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Meta+ArrowLeft');
    // Esc must reach the open list: with no list open it selects the block (D-183), and Backspace then deletes it.
    await page.keyboard.type('@');
    await must(linkSuggestions(page), 'the @ list');
    await page.keyboard.press('Escape');
    assert.ok(await absent(linkSuggestions(page)), 'Esc closes the @ list');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('[[');
    await must(linkSuggestions(page), 'the [[ list');
    await page.keyboard.press('Escape');
    assert.ok(await absent(linkSuggestions(page)), 'Esc closes the [[ list');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await sleep(1500);
    assert.deepEqual(await writeCalls(core), [], 'caret moves, selection, copy, ⌘Z with nothing to undo, menus opened and typed-then-removed: nothing written');
    await page.keyboard.type('x');
    await page.keyboard.press('Meta+z');
    await sleep(1500);
    assert.deepEqual(await writeCalls(core), [], 'every change undone before the autosave: nothing written (D-323)');
    await caretAtEnd(page);
    await page.keyboard.press('Enter');
    const c = await created(core);
    assert.equal(c.filter((x) => x.ok).length, 1, 'Enter changes the document and creates the file');
  });

  test('fr_dly_02_ac4_leaving_within_50_ms_flushes_the_first_write', async ({ page }) => {
    const core = await startDaily(page);
    await cmdD(page, '2026-10-14');
    await caretAtEnd(page);
    await page.keyboard.type('a');
    await page.keyboard.press('Meta+BracketLeft');
    const c = await created(core);
    assert.equal(c.filter((x) => x.ok).length, 1, 'Back within 50 ms flushes the pending save once');
    assert.ok((await fileText(core, D.new14))?.includes('a'), 'the AC-2 file');
    await cmdD(page, '2026-10-14');
    await caretAtEnd(page);
    await page.keyboard.type('b');
    await page.keyboard.press('Meta+d');
    await sleep(300);
    assert.equal((await callsOf(core, 'daily_create')).length, 1, 'the next save is a note_write, not a second create');
    assert.ok(await fileWhen(core, D.new14, (t) => !!t?.includes('ab')), 'the second keystroke is saved too');
  });

  test('fr_dly_02_ac6_a_taken_name_gets_a_suffix', async ({ page }) => {
    const core = await startDaily(page);
    await gotoDaily(page, '2026-10-16');
    assert.ok(await seen(virtualMarker(page), 1000), 'Kolize is a page: 16 Oct is virtual');
    await caretAtEnd(page);
    await page.keyboard.type('Kolize');
    assert.ok(await fileWhen(core, 'Daily/2026-10-16 (2).md', (t) => !!t), 'Daily/2026-10-16 (2).md');
    assert.equal(await fileText(core, D.kolize), original(D.kolize), 'Kolize keeps its bytes');
  });

  test('fr_dly_02_ac7_a_note_that_arrives_before_the_first_keystroke_is_shown', async ({ page }) => {
    const core = await startDaily(page);
    await cmdD(page, '2026-10-14');
    assert.ok(await seen(virtualMarker(page), 1000), 'virtual');
    await core.setFile('Jinde/z telefonu.md', '---\nid: 01JB4B0000000000000000W002\ntype: daily-note\ntitle: "2026-10-14"\ndate: 2026-10-14\ncreated: 2026-10-14T11:00:00+02:00\n---\nZ telefonu.\n');
    assert.ok(await seen(editorBody(page).getByText('Z telefonu.'), 2000), 'the arrived file is shown within 2 s');
    assert.ok(await absent(virtualMarker(page), 500), 'no longer virtual');
    assert.deepEqual(await writeCalls(core), [], 'no write by Tegg');
  });

  test('fr_dly_02_ac7_after_the_first_keystroke_the_users_note_is_its_own_file', async ({ page }) => {
    const core = await startDaily(page);
    await cmdD(page, '2026-10-14');
    await core.writeControl({ hold: true });
    await caretAtEnd(page);
    await page.keyboard.type('Moje');
    await sleep(1200);
    const other = '---\nid: 01JB4B0000000000000000W003\ntype: daily-note\ntitle: "2026-10-14"\ndate: 2026-10-14\ncreated: 2026-10-14T11:00:00+02:00\n---\nZ telefonu.\n';
    await core.setFile(D.new14, other);
    await core.release();
    const c = await created(core);
    assert.ok(c.some((x) => x.ok), 'daily_create sent');
    assert.equal(await fileText(core, D.new14), other, 'the other file keeps its bytes');
    assert.ok((await fileWhen(core, 'Daily/2026-10-14 (2).md', (t) => !!t?.includes('Moje')))?.includes('Moje'), "the user's note is written as (2)");
    assert.ok(await seen(duplicateNotice(page), 2000), 'the D-319 notice appears');
  });

  test('fr_dly_02_ac8_a_failed_first_write_keeps_the_text_and_retries', async ({ page }) => {
    const core = await startDaily(page);
    await cmdD(page, '2026-10-14');
    await core.writeControl({ fail: 'Io' });
    await caretAtEnd(page);
    await page.keyboard.type('Neuloženo');
    await eventually(() => callsOf(core, 'daily_create'), (c) => c.length > 0, 3000);
    assert.ok(await seen(editorBody(page).getByText('Neuloženo', { exact: false }), 1000), 'the typed text stays');
    assert.ok(await seen(virtualMarker(page), 1000), 'still virtual');
    assert.notEqual(flat(await saveState(page).first().innerText().catch(() => '')), 'Saved', 'the save state shows the error');
    assert.equal(await fileText(core, D.new14), undefined, 'nothing partial');
    await core.writeControl({ fail: null });
    await page.keyboard.type('!');
    assert.ok(await fileWhen(core, D.new14, (t) => !!t?.includes('Neuloženo!')), 'the next keystroke retries');
  });

  test('fr_dly_02_ac9_emptying_a_written_note_never_deletes_it', async ({ page }) => {
    const core = await startDaily(page, { now: '2026-10-07T12:00:00+02:00' });
    await cmdD(page, '2026-10-07');
    await (await must(editorBody(page), 'body')).click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Backspace');
    assert.ok(await stateIs(page, 'Saved', 3000), 'Saved');
    const t = await fileText(core, D.d07);
    assert.ok(t !== undefined, 'the file stays');
    assert.equal(bodyOf(t).trim(), '', 'an empty body is saved');
    assert.ok(keysOf(t).includes('date'), 'with its frontmatter');
    await (await must(pickDate(page), 'Pick date')).click();
    const cell = await must(page.getByRole('dialog', { name: 'Calendar' }).getByRole('button', { name: 'Wednesday, October 7, 2026', exact: true }), 'calendar day 7');
    assert.equal(await cell.getAttribute('data-has-note'), 'true', 'still marked in the calendar');
    assert.equal((await callsOf(core, 'note_trash')).length, 0, 'never trashed');
  });
});

// ------------------------------------------------------------------------------------------------ FR-DLY-05

test.describe('review', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_dly_05_ac1_a_virtual_note_has_no_review_control', async ({ page }) => {
    const core = await startDaily(page);
    await cmdD(page, '2026-10-14');
    assert.ok(await seen(virtualMarker(page), 1000), 'virtual');
    assert.ok(await absent(reviewToggle(page), 500), 'no review control while virtual');
    await caretAtEnd(page);
    await page.keyboard.type('Dnes');
    assert.ok(await fileWhen(core, D.new14, (t) => !!t?.includes('review: unreviewed')), 'the first write is unreviewed');
    assert.ok(await seen(rev(page, 'Mark reviewed'), 2000), 'then the control appears as Mark reviewed');
  });

  test('fr_dly_05_ac2_the_review_toggle', async ({ page }) => {
    const core = await startDaily(page, { now: '2026-10-07T12:00:00+02:00' });
    await cmdD(page, '2026-10-07');
    const b = await must(rev(page, 'Mark reviewed'), 'checkbox "Mark reviewed"');
    assert.equal(await b.getAttribute('aria-checked'), 'false', 'not checked');
    await b.click();
    const t = await fileWhen(core, D.d07, (x) => !!x?.includes('review: reviewed'));
    const was = original(D.d07)!.split('\n'), now = (t ?? '').split('\n');
    const diff = was.map((l, i) => (l === now[i] ? null : l.split(':')[0])).filter(Boolean);
    assert.deepEqual(diff, ['review', 'modified'], 'only review and modified change (FR-FMT-07 AC-5)');
    assert.equal(await (await must(rev(page, 'Reviewed'), 'checkbox "Reviewed"')).getAttribute('aria-checked'), 'true', 'checked');
    await runCommand(page, 'Mark unreviewed');
    assert.ok(await fileWhen(core, D.d07, (x) => !!x?.includes('review: unreviewed')), 'Mark unreviewed reverts it');
    await core.setFile(D.d07, swap(await fileText(core, D.d07), 'review: unreviewed', 'review: reviewed'));
    assert.ok(await seen(rev(page, 'Reviewed'), 2000), 'an external change updates the control within 2 s');
  });

  test('fr_dly_05_ac2_1_october_starts_reviewed', async ({ page }) => {
    await startDaily(page, { now: '2026-10-01T12:00:00+02:00' });
    await cmdD(page, '2026-10-01');
    const b = await must(rev(page, 'Reviewed'), 'checkbox "Reviewed"');
    assert.equal(await b.getAttribute('aria-checked'), 'true');
  });

  // FR-DLY-05 AC-3 (no Inbox yet) is retired by 5B: inbox.md FR-DLY-05 AC-5 replaces it (D-272, D-515).

  test('fr_dly_05_ac4_missing_or_unknown_review_value', async ({ page }) => {
    const v = dailyVault((f) => { f[D.d01] = swap(f[D.d01], 'review: reviewed', 'review: maybe'); f[D.archiv] = swap(f[D.archiv], 'review: reviewed\n', ''); });
    const core = await startDaily(page, { vault: v });
    for (const date of ['2026-10-10', '2026-10-01']) {
      await gotoDaily(page, date);
      const b = await must(rev(page, 'Mark reviewed'), `${date}: Mark reviewed`);
      assert.equal(await b.getAttribute('aria-checked'), 'false');
    }
    assert.deepEqual(await writeCalls(core), [], 'opening writes nothing');
    await (await must(rev(page, 'Mark reviewed'), 'Mark reviewed')).click();
    assert.ok(await fileWhen(core, D.d01, (t) => !!t?.includes('review: reviewed')), 'only activating writes review: reviewed');
  });
});

// ------------------------------------------------------------------------------------------------ FR-DLY-06, FR-FMT-09

test.describe('template and format', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_dly_06_ac4_an_edited_template_changes_the_next_new_note', async ({ page }) => {
    const core = await startDaily(page);
    await cmdD(page, '2026-10-14');
    await core.setFile(D.template, swap(original(D.template), '## Poznámky', '## Úkoly'));
    assert.ok(await seen(editorBody(page).getByText('Úkoly'), 2000), 'the untouched virtual note follows the template within 2 s');
    await caretAtEnd(page);
    await page.keyboard.type('Dnes');
    assert.ok(await fileWhen(core, D.new14, (t) => !!t?.includes('## Úkoly')), 'written with the edited template');
  });

  test('fr_dly_06_ac5_without_a_template_the_body_is_the_typed_text', async ({ page }) => {
    const v = dailyVault((f) => { delete f[D.template]; });
    const core = await startDaily(page, { vault: v });
    await cmdD(page, '2026-10-14');
    await (await must(editorBody(page), 'body')).click();
    await page.keyboard.type('Jen text');
    const t = await fileWhen(core, D.new14, (x) => !!x);
    assert.deepEqual(keysOf(t), ['id', 'type', 'title', 'date', 'review', 'created', 'modified'], 'no tags');
    assert.equal(bodyOf(t), 'Jen text\n', 'the body is exactly the typed text');
  });

  test('fr_dly_06_ac5_an_invalid_template_is_body_only_with_a_message', async ({ page }) => {
    const v = dailyVault((f) => { f[D.template] = '---\ntags: [deník\n---\nText {{date}}.\n'; });
    await startDaily(page, { vault: v });
    await cmdD(page, '2026-10-14');
    assert.ok(await seen(editorBody(page).getByText('Text 2026-10-14.'), 1000), 'body-only');
    assert.ok(await seen(page.getByRole('status').or(page.getByRole('alert')).filter({ hasText: 'Daily Note.md' }), 1000), 'a non-modal message names the template');
  });

  test('fr_fmt_09_ac4_another_format_names_the_first_write', async ({ page }) => {
    const v = dailyVault((f) => { f['.tegg/vault.yml'] = swap(f['.tegg/vault.yml'], 'daily-format: YYYY-MM-DD', 'daily-format: DD.MM.YYYY'); });
    const core = await startDaily(page, { vault: v });
    await cmdD(page, '2026-10-14');
    await caretAtEnd(page);
    await page.keyboard.type('Dnes');
    const t = await fileWhen(core, 'Daily/14.10.2026.md', (x) => !!x);
    assert.ok(t, 'Daily/14.10.2026.md');
    assert.match(t!, /^title: "2026-10-14"$/m);
    assert.match(t!, /^date: 2026-10-14$/m);
  });

  test('fr_fmt_09_ac5_an_invalid_format_shows_one_message', async ({ page }) => {
    const v = dailyVault((f) => { f['.tegg/vault.yml'] = swap(f['.tegg/vault.yml'], 'daily-format: YYYY-MM-DD', 'daily-format: YYYY/MM/DD'); });
    await startDaily(page, { vault: v });
    await cmdD(page, '2026-10-14');
    const msg = page.getByText("The daily-note format in vault.yml isn't valid; using YYYY-MM-DD.", { exact: true });
    assert.ok(await seen(msg, 2000), 'the D-336 message');
    await step3(page, 1);
    await (await must(todayBtn(page), 'Today')).click();
    assert.ok((await msg.count()) <= 1, 'once per session');
  });
});

