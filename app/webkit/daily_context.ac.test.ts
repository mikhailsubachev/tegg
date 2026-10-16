// MS4 slice 4B, L5 (WebKit + fake core): the live context sections of a Daily Note. FR-DLY-04 AC-1…AC-7.
// docs/acceptance/daily-notes.md (R19); interface docs/contracts/ms4-daily.md §4 (`daily_context` with the UI's day
// window), §7.2 (`ContextSections`), §8 (the fake uses the given start/end, so `timezoneId` drives the window). Clock,
// zone and region injected; (TZ) criteria run in Europe/Prague and America/Los_Angeles. Written from the ACs and the
// contract only (D-61). Missing elements fail an assertion (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  D, bodyOf, callsOf, caretAtEnd, cmdD, dailyVault, editorBody, eventually, fileText, fileWhen, flat, gotoDaily, must, mustBeOn, original,
  section, sleep, startDaily, stateIs, swap, writeCalls,
} from './daily-helpers';

const NAMES = ['Quick Notes', 'Tasks due', 'Created', 'Modified'] as const;
type Name = (typeof NAMES)[number];

/** Row titles of one section, in order (each row is a link, D-255). */
async function rows(page: Page, name: Name): Promise<string[]> {
  const s = await must(section(page, name), `region "${name}"`);
  return (await s.getByRole('link').allInnerTexts()).map(flat);
}
async function rowsWhen(page: Page, name: Name, ok: (r: string[]) => boolean, ms = 2000) {
  return eventually(() => rows(page, name), ok, ms);
}
async function emptyText(page: Page, name: Name): Promise<string> {
  return flat(await (await must(section(page, name), `region "${name}"`)).innerText());
}

// ------------------------------------------------------------------------------------------------ AC-1, AC-2

test.describe('sections in Europe/Prague', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_dly_04_ac1_four_sections_after_the_body_in_order', async ({ page }) => {
    const core = await startDaily(page);
    await cmdD(page, '2026-10-14');
    for (const n of NAMES) await must(section(page, n), `region "${n}"`);
    const tops = await Promise.all(NAMES.map(async (n) => (await section(page, n).first().boundingBox())?.y ?? -1));
    const body = (await editorBody(page).first().boundingBox())?.y ?? Infinity;
    assert.ok(tops.every((y, i) => y > body && (i === 0 || y > tops[i - 1])), `after the body, in order Quick Notes, Tasks due, Created, Modified: ${tops.join(', ')}`);
    const tasks = section(page, 'Tasks due');
    assert.equal(flat(await tasks.innerText()).replace(/^Tasks due\s*/, ''), 'Coming in MS5', 'Tasks due shows only Coming in MS5');
    assert.equal(await tasks.locator('[data-placeholder="daily-tasks"]').count(), 1, 'data-placeholder="daily-tasks"');
    const link = await must(section(page, 'Quick Notes').getByRole('link', { name: /Nápad z rána/ }), 'row Nápad z rána');
    assert.ok(await link.locator('[data-icon], svg').count() > 0, 'the row has the type icon');
    await link.click();
    await mustBeOn(page, 'Nápad z rána', 'the row opens the object');
    assert.deepEqual(await writeCalls(core), [], 'nothing written');
  });

  test('fr_dly_04_ac1_sections_on_a_written_note_too', async ({ page }) => {
    const v = dailyVault((f) => { f['Pages/Starší.md'] = '---\nid: 01JB4B0000000000000000W020\ntype: page\ntitle: Starší\ncreated: 2026-10-07T09:00:00+02:00\n---\nText.\n'; });
    await startDaily(page, { vault: v, now: '2026-10-07T12:00:00+02:00' });
    await cmdD(page, '2026-10-07');
    assert.deepEqual(await rows(page, 'Created'), ['Starší'], 'Created on the written 7 Oct note');
  });

  test('fr_dly_04_ac2_contents_of_14_october', async ({ page }) => {
    const core = await startDaily(page);
    await cmdD(page, '2026-10-14');
    assert.deepEqual(await rowsWhen(page, 'Quick Notes', (r) => r.length > 0), ['Nápad z rána'], 'Quick Notes');
    assert.deepEqual(await rows(page, 'Created'), ['Nová stránka dne'], 'Created (Nápad z rána not repeated)');
    assert.deepEqual(await rows(page, 'Modified'), ['Upravená stránka'], 'Modified');
    const c = (await callsOf(core, 'daily_context')).pop()?.args as any;
    assert.equal(c?.start, '2026-10-14T00:00:00+02:00', 'the window starts at local midnight');
    assert.equal(c?.end, '2026-10-15T00:00:00+02:00', 'and ends at the next local midnight');
  });

  test('fr_dly_04_ac2_contents_of_15_and_7_october', async ({ page }) => {
    await startDaily(page);
    await gotoDaily(page, '2026-10-15');
    assert.deepEqual(await rowsWhen(page, 'Quick Notes', (r) => r.length > 0), ['Pozdní nápad'], '15 Oct: Pozdní nápad');
    await gotoDaily(page, '2026-10-07');
    for (const n of ['Quick Notes', 'Created', 'Modified'] as const) {
      assert.deepEqual(await rows(page, n), [], `7 Oct ${n}: empty (the note itself excluded)`);
      assert.ok((await emptyText(page, n)).includes('Nothing yet'), `7 Oct ${n}: Nothing yet`);
    }
  });

  test('fr_dly_04_ac2_other_daily_notes_are_listed', async ({ page }) => {
    await startDaily(page);
    await gotoDaily(page, '2026-10-12');
    assert.deepEqual(await rowsWhen(page, 'Created', (r) => r.length > 0), ['2026-10-12'], 'the older 12 Oct note is in Created, titled by its date');
  });
});

// ------------------------------------------------------------------------------------------------ AC-3

test.describe('sections in America/Los_Angeles', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('fr_dly_04_ac3_contents_of_14_and_13_october', async ({ page }) => {
    const core = await startDaily(page);
    await cmdD(page, '2026-10-14');
    assert.deepEqual(await rowsWhen(page, 'Quick Notes', (r) => r.length > 0), ['Pozdní nápad'], 'Pozdní nápad (15:30 local)');
    assert.deepEqual(await rows(page, 'Created'), ['Nová stránka dne'], 'Nová stránka dne (00:00:00 local, start inclusive)');
    assert.deepEqual(await rows(page, 'Modified'), ['Upravená stránka'], 'Upravená stránka');
    const c = (await callsOf(core, 'daily_context')).pop()?.args as any;
    assert.equal(c?.start, '2026-10-14T00:00:00-07:00', 'the window in the current zone');
    await gotoDaily(page, '2026-10-13');
    assert.deepEqual(await rowsWhen(page, 'Quick Notes', (r) => r.length > 0), ['Nápad z rána'], '13 Oct: Nápad z rána (22:30 local)');
  });

  test('fr_dly_04_ac3_an_offset_less_created_is_local_time', async ({ page }) => {
    const v = dailyVault((f) => { f['Quick Notes/Bez zóny.md'] = '---\nid: 01JB4B0000000000000000W021\ntype: quick-note\ntitle: Bez zóny\ncreated: 2026-10-14T23:30:00\n---\nText.\n'; });
    await startDaily(page, { vault: v });
    await cmdD(page, '2026-10-14');
    assert.ok((await rowsWhen(page, 'Quick Notes', (r) => r.includes('Bez zóny'))).includes('Bez zóny'), 'read as local time (D-328)');
  });
});

// ------------------------------------------------------------------------------------------------ AC-4…AC-7

test.describe('live sections', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_dly_04_ac4_sections_are_live_and_never_saved', async ({ page }) => {
    const core = await startDaily(page);
    await cmdD(page, '2026-10-14');
    await rowsWhen(page, 'Quick Notes', (r) => r.length > 0);
    await core.setFile('Quick Notes/Jedenáctá.md', '---\nid: 01JB4B0000000000000000W022\ntype: quick-note\ntitle: Jedenáctá\ncreated: 2026-10-14T11:00:00+02:00\nmodified: 2026-10-14T11:00:00+02:00\n---\nText.\n');
    assert.deepEqual(await rowsWhen(page, 'Quick Notes', (r) => r.length === 2), ['Jedenáctá', 'Nápad z rána'], 'added within 2 s, newest first');
    assert.deepEqual(await writeCalls(core), [], 'on a virtual note the sections change and nothing is written');
    await core.setFile(D.nova, swap(original(D.nova), 'modified: 2026-10-14T09:00:00+02:00', 'modified: 2026-10-14T11:30:00+02:00'));
    await sleep(500);
    assert.deepEqual(await rows(page, 'Created'), ['Nová stránka dne'], 'still in Created');
    assert.ok(!(await rows(page, 'Modified')).includes('Nová stránka dne'), 'and only there');
    await core.setFile(D.upravena, null);
    assert.deepEqual(await rowsWhen(page, 'Modified', (r) => r.length === 0), [], 'a deleted object leaves within 2 s');
    await caretAtEnd(page);
    await page.keyboard.type('Dnes');
    assert.ok(await stateIs(page, 'Saved', 3000), 'Saved');
    await page.keyboard.type(' a zítra');
    assert.ok(await stateIs(page, 'Saved', 3000), 'Saved again');
    const t = await fileText(core, D.new14);
    for (const s of ['Jedenáctá', 'Nápad z rána', 'Nová stránka dne', 'Quick Notes', 'Tasks due', 'Nothing yet']) assert.ok(!(t ?? '').includes(s), `no section text ${s} in the file`);
    const shown = await page.evaluate(() => (window as any).__TEGG_TEST__?.editor?.text?.() as string | undefined);
    if (shown !== undefined) assert.equal(bodyOf(t), bodyOf(shown), "the file's body equals the editor's body");
  });

  test('fr_dly_04_ac5_a_template_may_include_section_titles_as_text', async ({ page }) => {
    const v = dailyVault((f) => { f[D.template] = swap(f[D.template], '## Poznámky\n', '## Poznámky\n\n## Quick Notes\n'); });
    const core = await startDaily(page, { vault: v });
    await cmdD(page, '2026-10-14');
    await caretAtEnd(page);
    await page.keyboard.press('Enter'); // a new paragraph after the template's last heading, not into it
    await page.keyboard.type('Dnes');
    const t = await fileWhen(core, D.new14, (x) => !!x);
    assert.ok(bodyOf(t).includes('## Quick Notes\n'), 'the template text is written as the user content');
    assert.ok(!bodyOf(t).includes('Nápad z rána'), 'and not filled by the live section');
    await core.setFile('Quick Notes/Další.md', '---\nid: 01JB4B0000000000000000W023\ntype: quick-note\ntitle: Další\ncreated: 2026-10-14T11:00:00+02:00\n---\nText.\n');
    await sleep(1500);
    assert.equal(await fileText(core, D.new14), t, 'the live section does not update the written text');
  });

  test('fr_dly_04_ac6_fifty_rows_then_show_more', async ({ page }) => {
    const v = dailyVault((f) => {
      for (let i = 0; i < 60; i++) {
        f[`Pages/Hromada ${String(i).padStart(2, '0')}.md`] = `---\nid: 01JB4B000000000000000H${String(i).padStart(4, '0')}\ntype: page\ntitle: Hromada ${String(i).padStart(2, '0')}\ncreated: 2026-09-01T10:00:00+02:00\nmodified: 2026-10-14T08:${String(i).padStart(2, '0')}:00+02:00\n---\nText.\n`;
      }
    });
    await startDaily(page, { vault: v });
    await cmdD(page, '2026-10-14');
    const r = await rowsWhen(page, 'Modified', (x) => x.length > 0, 3000);
    assert.equal(r.length, 50, 'at most 50 rows');
    assert.equal(r[0], 'Upravená stránka', 'newest first (10:00 before 08:59)');
    const more = await must(section(page, 'Modified').getByRole('button', { name: 'Show 11 more', exact: true }), 'button "Show 11 more"');
    await more.click();
    assert.equal((await rowsWhen(page, 'Modified', (x) => x.length === 61)).length, 61, 'all shown in place');
  });

  test('fr_dly_04_ac7_tab_reaches_the_rows_and_enter_opens', async ({ page }) => {
    await startDaily(page);
    await cmdD(page, '2026-10-14');
    await rowsWhen(page, 'Modified', (r) => r.length > 0);
    await (await must(editorBody(page), 'body')).click();
    const seenOrder: string[] = [];
    for (let i = 0; i < 25 && seenOrder.length < 3; i++) {
      await page.keyboard.press('Tab');
      const t = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        const region = a?.closest('[role="region"], section[aria-label], section[aria-labelledby]');
        return a && region && a.tagName === 'A' ? (a.textContent ?? '').trim() : null;
      });
      if (t && !seenOrder.includes(t)) seenOrder.push(t);
    }
    assert.deepEqual(seenOrder, ['Nápad z rána', 'Nová stránka dne', 'Upravená stránka'], 'Tab reaches the rows after the body in visual order');
    await page.keyboard.press('Enter');
    await mustBeOn(page, 'Upravená stránka', '⏎ opens the row');
  });
});

