// Preview v0.68 feedback, L5 (WebKit + fake core): the one date picker in the attribute panel (D-763;
// docs/feedback/ms6-v068.md F10, boards `MainProperties`). docs/acceptance/date-picker.md R89, FR-TYP-02 AC-6 (the
// opener), AC-7 (choosing writes once; the same bytes in three zones), AC-8 (Date-time and Date range). Names (R89 as
// corrected by the coordinator, 2026-10-25): a Date opener `<Name>: <date>`, the Date-time date opener
// `<Name> date: <date>` (`panel.dateField`) beside the textbox `<Name> time`, the Date range halves `<Name> start: …`
// and `<Name> end: …` (`panel.rangeStart`, `panel.rangeEnd`), `No date` when empty; the picker's typed field `Date`.
// Fixture `tests/fixtures/vaults/types/`, clock 2026-10-14T10:00:00+02:00, region `cs`. Written from the ACs only
// (D-61); every lookup goes through `must`/node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, append, callsOf, eventually, lastWrite, must, noModified, openTypes, original, props, sleep, swap, type FakeCoreHandle,
} from './types-helpers';
import { tokenColour } from './read-helpers';
import { closed, dateField, dateName, dayIn, focusLabel, monthIs, monthText, pickDialog, showMonth } from './v068-helpers';

const NOW = '2026-10-14T10:00:00+02:00';
const REGION = 'cs';

async function openAt(page: Page, at: string): Promise<FakeCoreHandle> {
  await page.clock.setFixedTime(new Date(NOW));
  return openTypes(page, at, { region: REGION });
}
const writesTo = async (core: FakeCoreHandle, path: string) => (await callsOf(core, 'note_write')).filter((c) => String((c.args as any)?.path ?? '').normalize('NFC') === path.normalize('NFC')).length;
const written = (core: FakeCoreHandle, path: string, ok: (t: string) => boolean, ms = 2500) => eventually(() => lastWrite(core, path), (t) => t !== null && ok(t), ms);
async function openPicker(page: Page, name: RegExp | string, what: string) {
  const opener = props(page).getByRole('button', { name: typeof name === 'string' ? name : name, exact: typeof name === 'string' });
  await (await must(opener, what)).click();
  return must(pickDialog(page), `dialog "Pick date" from ${what}`, 1500);
}

// ------------------------------------------------------------------------------------------------ AC-6

test('fr_typ_02_ac6_date_openers_not_textboxes', async ({ page }) => {
  await openAt(page, P.porada);
  const datum = await must(props(page).getByRole('button', { name: dateName('Datum: ', '2026-10-07') }), 'button "Datum: 7. 10. 2026"');
  assert.equal(await datum.locator('[data-icon="calendar"]').count(), 1, 'the calendar icon');
  assert.equal(await datum.getAttribute('aria-haspopup'), 'dialog', 'aria-haspopup="dialog"');
  assert.equal(await datum.getAttribute('aria-expanded'), 'false', 'aria-expanded="false" while closed');
  const zacatek = props(page).getByRole('group', { name: 'Začátek' });
  await must(zacatek.getByRole('button', { name: dateName('Začátek date: ', '2026-10-07') }), 'button "Začátek date: 7. 10. 2026"');
  await must(zacatek.getByRole('textbox', { name: 'Začátek time', exact: true }), 'textbox "Začátek time"');
  const boxes = await props(page).getByRole('textbox').evaluateAll((es) => es.map((e) => e.getAttribute('aria-label') ?? ''));
  assert.deepEqual(boxes.filter((n) => /^(Datum|Začátek date)/.test(n)), [], `no textbox for a date part on Porada: ${boxes.join(' | ')}`);
  const p2 = await page.context().newPage();
  await openAt(p2, P.velka);
  const g = props(p2).getByRole('group', { name: 'Období' });
  const start = await must(g.getByRole('button', { name: 'Období start: No date', exact: true }), 'button "Období start: No date"');
  await must(g.getByRole('button', { name: 'Období end: No date', exact: true }), 'button "Období end: No date"');
  assert.equal(await g.getByRole('textbox').count(), 0, 'the Date range row has no textbox');
  const faint = await tokenColour(p2, 'faint');
  const colour = await start.evaluate((e) => {
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if ((n.textContent ?? '').includes('No date')) return getComputedStyle(n.parentElement!).color;
    return null;
  });
  assert.equal(colour, faint, '`No date` is faint');
  await p2.close();
});

// ------------------------------------------------------------------------------------------------ AC-7

for (const tz of ['Europe/Prague', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
  test.describe(`picker in ${tz}`, () => {
    test.use({ timezoneId: tz });
    test(`fr_typ_02_ac7_choosing_a_date_writes_once_${tz.replace(/\W/g, '_')}`, async ({ page }) => {
      const core = await openAt(page, P.porada);
      const base = original(P.porada);
      let dlg = await openPicker(page, dateName('Datum: ', '2026-10-07'), 'Datum');
      assert.equal(await props(page).getByRole('button', { name: /^Datum: / }).getAttribute('aria-expanded'), 'true', 'aria-expanded="true" while open');
      assert.ok(monthIs(await monthText(dlg), '2026-10-07', REGION), `October 2026 is shown (${await monthText(dlg)})`);
      const d7 = await must(dayIn(dlg, '2026-10-07', REGION), 'day 7');
      const d14 = await must(dayIn(dlg, '2026-10-14', REGION), 'day 14');
      const attr = (l: typeof d7, a: string) => l.evaluate((e, x) => e.getAttribute(x) ?? e.closest('[role="gridcell"]')?.getAttribute(x) ?? null, a);
      assert.equal(await attr(d7, 'aria-selected'), 'true', '7 is selected');
      assert.equal(await attr(d14, 'aria-current'), 'date', '14 is ringed as today');
      const box = await dlg.boundingBox();
      const ob = await props(page).getByRole('button', { name: /^Datum: / }).boundingBox();
      assert.ok(box && ob && box.y >= ob.y + ob.height - 1 && box.x + box.width <= 1440 && box.y + box.height <= 900, `anchored below its opener, inside the window (${JSON.stringify({ box, ob })})`);
      await (await must(dayIn(dlg, '2026-10-20', REGION), 'day 20')).click();
      assert.ok(await closed(pickDialog(page)), 'choosing a day closes the dialog');
      let t = await written(core, P.porada, (x) => x.includes('datum: 2026-10-20'));
      assert.equal(noModified(t ?? ''), noModified(swap(base, 'datum: 2026-10-07\n', 'datum: 2026-10-20\n')), '20 → datum: 2026-10-20, every other byte unchanged');
      assert.notEqual(/^modified: (.*)$/m.exec(t ?? '')?.[1], /^modified: (.*)$/m.exec(base)?.[1], 'modified updated');
      await sleep(400);
      assert.equal(await writesTo(core, P.porada), 1, 'one note_write');
      dlg = await openPicker(page, dateName('Datum: ', '2026-10-20'), 'Datum');
      await (await must(dlg.getByRole('button', { name: 'Tomorrow', exact: true }), 'Tomorrow')).click();
      t = await written(core, P.porada, (x) => x.includes('datum: 2026-10-15'));
      assert.equal(noModified(t ?? ''), noModified(swap(base, 'datum: 2026-10-07\n', 'datum: 2026-10-15\n')), 'Tomorrow → 2026-10-15');
      dlg = await openPicker(page, dateName('Datum: ', '2026-10-15'), 'Datum');
      const field = await must(dateField(dlg), 'textbox "Date"');
      const n = await writesTo(core, P.porada);
      await field.fill('xyz');
      await field.press('Enter');
      await must(dlg.getByText('Not a date', { exact: true }), 'the field error "Not a date"');
      await sleep(400);
      assert.equal(await writesTo(core, P.porada), n, 'an unreadable text writes nothing');
      await field.fill('2026-10-08');
      await field.press('Enter');
      t = await written(core, P.porada, (x) => x.includes('datum: 2026-10-08'));
      assert.equal(noModified(t ?? ''), noModified(swap(base, 'datum: 2026-10-07\n', 'datum: 2026-10-08\n')), 'typed 2026-10-08 → 2026-10-08');
      dlg = await openPicker(page, dateName('Datum: ', '2026-10-08'), 'Datum');
      await (await must(dlg.getByRole('button', { name: 'No date', exact: true }), 'No date')).click();
      t = await written(core, P.porada, (x) => !/^datum:/m.test(x));
      assert.equal(noModified(t ?? ''), noModified(base.replace('datum: 2026-10-07\n', '')), 'No date removes the datum: line (FR-TYP-03 AC-9)');
      await must(props(page).getByRole('button', { name: 'Datum: No date', exact: true }), 'button "Datum: No date"');
      const m = await writesTo(core, P.porada);
      dlg = await openPicker(page, 'Datum: No date', 'Datum');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      assert.ok(await closed(pickDialog(page)), 'Esc closes the dialog');
      assert.match(await focusLabel(page), /^Datum: No date/, 'the focus returns to the opener');
      await sleep(400);
      assert.equal(await writesTo(core, P.porada), m, 'Esc after moving the focused day writes nothing');
    });
  });
}

// ------------------------------------------------------------------------------------------------ AC-8

test.describe('Date-time and Date range', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_typ_02_ac8_date_time_keeps_its_time', async ({ page }) => {
    const core = await openAt(page, P.porada);
    const g = props(page).getByRole('group', { name: 'Začátek' });
    const time = await must(g.getByRole('textbox', { name: 'Začátek time', exact: true }), 'textbox "Začátek time"');
    const before = await time.inputValue();
    const opener = await must(g.getByRole('button', { name: dateName('Začátek date: ', '2026-10-07') }), 'button "Začátek date: 7. 10. 2026"');
    await opener.click();
    const dlg = await must(pickDialog(page), 'dialog "Pick date"');
    await (await must(dayIn(dlg, '2026-10-09', REGION), 'day 9')).click();
    const t = await written(core, P.porada, (x) => x.includes('začátek: 2026-10-09'));
    assert.equal(noModified(t ?? ''), noModified(swap(original(P.porada), 'začátek: 2026-10-07T09:30:00+02:00', 'začátek: 2026-10-09T09:30:00+02:00')), 'začátek: 2026-10-09T09:30:00+02:00, the rest unchanged');
    assert.equal(await time.inputValue(), before, 'the time textbox is unchanged');
  });

  test('fr_typ_02_ac8_date_range_is_written_once_after_the_second_end', async ({ page }) => {
    const core = await openAt(page, P.velka);
    const g = props(page).getByRole('group', { name: 'Období' });
    await (await must(g.getByRole('button', { name: 'Období start: No date', exact: true }), 'Období start: No date')).click();
    let dlg = await must(pickDialog(page), 'Pick date (start)');
    await showMonth(dlg, '2027-01-01', REGION);
    await (await must(dayIn(dlg, '2027-01-01', REGION), '1 Jan 2027')).click();
    await sleep(500);
    assert.equal(await writesTo(core, P.velka), 0, 'nothing written after the start alone (D-230: committed together)');
    await (await must(g.getByRole('button', { name: 'Období end: No date', exact: true }), 'Období end: No date')).click();
    dlg = await must(pickDialog(page), 'Pick date (end)');
    await showMonth(dlg, '2027-12-31', REGION);
    await (await must(dayIn(dlg, '2027-12-31', REGION), '31 Dec 2027')).click();
    const t = await written(core, P.velka, (x) => x.includes('období-end'));
    assert.equal(noModified(t ?? ''), noModified(append(original(P.velka), 'období-start: 2027-01-01\nobdobí-end: 2027-12-31\n')), 'both lines, written together');
    await sleep(400);
    assert.equal(await writesTo(core, P.velka), 1, 'one write');
  });

  test('fr_typ_02_ac8_an_end_before_the_start_writes_nothing', async ({ page }) => {
    const core = await openAt(page, P.velka);
    const g = props(page).getByRole('group', { name: 'Období' });
    await (await must(g.getByRole('button', { name: 'Období start: No date', exact: true }), 'Období start: No date')).click();
    let dlg = await must(pickDialog(page), 'Pick date (start)');
    await showMonth(dlg, '2027-01-01', REGION);
    await (await must(dayIn(dlg, '2027-01-01', REGION), '1 Jan 2027')).click();
    await (await must(g.getByRole('button', { name: 'Období end: No date', exact: true }), 'Období end: No date')).click();
    dlg = await must(pickDialog(page), 'Pick date (end)');
    const f = await must(dateField(dlg), 'textbox "Date"');
    await f.fill('2026-12-31');
    await f.press('Enter');
    await must(page.getByText('The end is before the start', { exact: true }), 'the field error of types.md AC-3');
    await sleep(800);
    assert.equal(await writesTo(core, P.velka), 0, 'nothing written');
  });
});
