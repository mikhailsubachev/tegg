// MS3 slice 3D, L5 (WebKit + fake core): written values per R10 type through the panel's controls (FR-EDT-07 AC-5),
// one key-style case (FR-EDT-07 AC-8) and dates across time zones (FR-EDT-07 AC-15, verifies file-format FR-FMT-11
// AC-1, AC-2). Zone (Playwright `timezoneId`) and region (`__TEGG_REGION__ = 'cs'`) are injected (D-61, §14.4).
// Written from docs/acceptance/types.md and docs/contracts/ms3-shell.md §14.4, §14.7.3 only.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, append, callsOf, control, eventually, lastWrite, must, noModified, openTypes, original, props, sleep, swap, typesVault,
} from './types-helpers';
import { settled } from './helpers';

type Core = Awaited<ReturnType<typeof openTypes>>;
const written = (core: Core, path: string, ok: (t: string) => boolean, ms = 2000) => eventually(() => lastWrite(core, path), (t) => t !== null && ok(t), ms);
async function commitText(page: Page, name: string, value: string) {
  const f = await must(control(page, 'textbox', name), `panel textbox "${name}"`);
  await f.fill(value);
  await f.press('Enter');
}
/** The line `key: …` (and block lines) the last write has for `key`. */
function entry(text: string | null, key: string): string {
  const lines = (text ?? '').split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i < 0) return '';
  let j = i + 1;
  while (j < lines.length && /^\s+/.test(lines[j]) && lines[j].trim() !== '') j++;
  return lines.slice(i, j).join('\n');
}

test.use({ timezoneId: 'Europe/Prague' });

test('fr_edt_07_ac5_a_text_values_are_quoted_when_needed', async ({ page }) => {
  const core = await openTypes(page, P.porada, { region: 'cs' });
  const cases: [string, string][] = [
    ['Praha 1', 'místo: Praha 1'], ['ano: ne', 'místo: "ano: ne"'], ['123', 'místo: "123"'], ['true', 'místo: "true"'],
    ['2026-10-07', 'místo: "2026-10-07"'], ['[[Cíl]]', 'místo: "[[Cíl]]"'], ['#doma', 'místo: "#doma"'], ['Plzeň', 'místo: Plzeň'],
  ];
  for (const [input, line] of cases) {
    // Clear first: a cleared value removes the key (D-230), so each case is written fresh, not in the previous style.
    await commitText(page, 'Místo', '');
    await written(core, P.porada, (x) => entry(x, 'místo') === undefined || entry(x, 'místo') === null || entry(x, 'místo') === '');
    await commitText(page, 'Místo', input);
    const t = await written(core, P.porada, (x) => entry(x, 'místo') === line);
    assert.equal(entry(t, 'místo'), line, JSON.stringify(input));
  }
});

test('fr_edt_07_ac5_b_long_text_is_a_block', async ({ page }) => {
  const core = await openTypes(page, P.rozpocet, { region: 'cs' });
  const f = await must(props(page).getByRole('textbox', { name: 'Poznámka', exact: true }), 'Poznámka');
  assert.equal(await f.getAttribute('aria-multiline'), 'true');
  await f.fill('');
  await f.type('Řádek 1');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Řádek 2');
  await page.keyboard.press('Meta+Enter');
  const t = await written(core, P.rozpocet, (x) => x.includes('Řádek 2'));
  assert.equal(entry(t, 'poznámka'), 'poznámka: |-\n  Řádek 1\n  Řádek 2');
});

test('fr_edt_07_ac5_c_numbers_accept_the_region_separators', async ({ page }) => {
  const core = await openTypes(page, P.rozpocet, { region: 'cs' });
  for (const [input, line] of [['3,5', 'rozpočet: 3.5'], ['3.5', 'rozpočet: 3.5'], ['250 000', 'rozpočet: 250000'], ['250 000', 'rozpočet: 250000']] as const) {
    await commitText(page, 'Rozpočet', '1');
    await written(core, P.rozpocet, (x) => entry(x, 'rozpočet') === 'rozpočet: 1');
    await commitText(page, 'Rozpočet', input);
    assert.equal(entry(await written(core, P.rozpocet, (x) => entry(x, 'rozpočet') === line), 'rozpočet'), line, JSON.stringify(input));
  }
  const n = (await callsOf(core, 'note_write')).length;
  await commitText(page, 'Rozpočet', 'abc');
  await must(props(page).getByRole('alert').filter({ hasText: 'Not a number' }), 'refused with Not a number');
  await sleep(1300);
  assert.equal((await callsOf(core, 'note_write')).length, n, 'nothing written');
});

test('fr_edt_07_ac5_d_checkbox_writes_false', async ({ page }) => {
  const core = await openTypes(page, P.rozpocet, { region: 'cs' });
  await (await must(control(page, 'checkbox', 'Aktivní'), 'Aktivní')).click();
  const t = await written(core, P.rozpocet, (x) => x.includes('aktivní: false'));
  assert.equal(noModified(t ?? ''), noModified(swap(original(P.rozpocet), 'aktivní: true\n', 'aktivní: false\n')));
});

for (const tz of ['Europe/Prague', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
  test.describe(`date in ${tz}`, () => {
    test.use({ timezoneId: tz });
    test(`fr_edt_07_ac5_e_date_same_bytes_in_${tz.replace(/\W/g, '_')}`, async ({ page }) => {
      const core = await openTypes(page, P.prazdna, { region: 'cs' });
      for (const input of ['8. 10. 2026', '2026-10-08']) {
        await commitText(page, 'Datum', input);
        const t = await written(core, P.prazdna, (x) => x.includes('datum: 2026-10-08'));
        assert.equal(noModified(t ?? ''), noModified(append(original(P.prazdna), 'datum: 2026-10-08\n')), `${input} in ${tz}`);
      }
      await (await must(props(page).getByRole('button', { name: 'Choose date for Datum', exact: true }), 'date picker')).click();
      const cal = await must(page.getByRole('dialog', { name: 'Choose date' }), 'Choose date');
      await cal.getByRole('gridcell', { name: /^8\b/ }).first().click();
      assert.ok((await written(core, P.prazdna, (x) => x.includes('datum: 2026-10-08')))?.includes('datum: 2026-10-08\n'), 'from the picker');
      const n = (await callsOf(core, 'note_write')).length;
      await commitText(page, 'Datum', '31. 2. 2026');
      await sleep(1300);
      assert.equal((await callsOf(core, 'note_write')).length, n, '31. 2. 2026 refused');
    });
  });
}

test('fr_edt_07_ac5_f_date_time_gets_the_offset_of_that_moment', async ({ page }) => {
  const core = await openTypes(page, P.prazdna, { region: 'cs' });
  const g = await must(props(page).getByRole('group', { name: 'Začátek' }), 'group Začátek');
  const [d, t] = [g.getByRole('textbox', { name: 'Začátek date' }), g.getByRole('textbox', { name: 'Začátek time' })];
  for (const [day, time, want] of [['1. 12. 2026', '14:30', '2026-12-01T14:30:00+01:00'], ['1. 7. 2026', '14:30', '2026-07-01T14:30:00+02:00'], ['25. 10. 2026', '02:30', '2026-10-25T02:30:00+02:00']]) {
    await d.fill(day);
    await t.fill(time);
    await t.press('Enter');
    assert.equal(entry(await written(core, P.prazdna, (x) => x.includes(want)), 'začátek'), `začátek: ${want}`, `${day} ${time}`);
  }
  const n = (await callsOf(core, 'note_write')).length;
  await d.fill('28. 3. 2027');
  await t.fill('02:30');
  await t.press('Enter');
  await must(g.getByRole('alert').filter({ hasText: "This time doesn't exist in your time zone" }), 'refused');
  await sleep(1300);
  assert.equal((await callsOf(core, 'note_write')).length, n, 'nothing written');
});

test('fr_edt_07_ac5_g_select_and_multi_select', async ({ page }) => {
  const core = await openTypes(page, P.rozpocet, { region: 'cs' });
  await (await must(control(page, 'combobox', 'Stav'), 'Stav')).click();
  const opts = (await page.getByRole('listbox', { name: 'Stav options' }).getByRole('option').allInnerTexts()).map((x) => x.trim());
  assert.deepEqual(opts, ['Plánovaný', 'Běží', 'Hotovo', 'Clear'], 'options + Clear');
  await page.getByRole('option', { name: 'Hotovo', exact: true }).click();
  assert.equal(entry(await written(core, P.rozpocet, (x) => x.includes('stav: Hotovo')), 'stav'), 'stav: Hotovo');
  await (await must(props(page).getByRole('group', { name: 'Oblasti' }).getByRole('button', { name: 'Add Oblasti', exact: true }), 'Add Oblasti')).click();
  await page.getByRole('option', { name: 'Rodina', exact: true }).click();
  assert.equal(entry(await written(core, P.rozpocet, (x) => x.includes('- Rodina')), 'oblasti'), 'oblasti:\n  - Práce\n  - Rodina');
});

test('fr_edt_07_ac5_h_url', async ({ page }) => {
  const core = await openTypes(page, P.rozpocet, { region: 'cs' });
  await commitText(page, 'Web', 'https://example.com/a?b=c');
  assert.equal(entry(await written(core, P.rozpocet, (x) => x.includes('a?b=c')), 'web'), 'web: https://example.com/a?b=c');
  for (const bad of ['example.com', 'javascript:alert(1)']) {
    const n = (await callsOf(core, 'note_write')).length;
    await commitText(page, 'Web', bad);
    await must(props(page).getByRole('alert').filter({ hasText: 'Enter a web address starting with https:// or http://' }), `${bad} refused`);
    await sleep(1300);
    assert.equal((await callsOf(core, 'note_write')).length, n, `${bad}: nothing written`);
  }
});

test('fr_edt_07_ac5_i_email', async ({ page }) => {
  const core = await openTypes(page, P.petr, { region: 'cs' });
  await commitText(page, 'E-mail', 'eva@example.com');
  assert.equal(entry(await written(core, P.petr, (x) => x.includes('eva@example.com')), 'e-mail'), 'e-mail: eva@example.com');
  const n = (await callsOf(core, 'note_write')).length;
  await commitText(page, 'E-mail', 'eva@');
  await sleep(1300);
  assert.equal((await callsOf(core, 'note_write')).length, n, 'eva@ refused');
});

test('fr_edt_07_ac8_key_text_and_flow_style_are_kept_through_the_panel', async ({ page }) => {
  // The one L5 case: Styl hodnot is a Page, so its universal `aliases` row is edited (flow list, D-230).
  const core = await openTypes(page, P.styl, { region: 'cs' });
  const al = await must(props(page).getByRole('textbox', { name: 'Aliases', exact: true }), 'textbox Aliases (D-312)');
  await al.click();
  await al.fill('Styl, Hodnoty, Třetí');
  await al.press('Enter');
  const t = await written(core, P.styl, (x) => x.includes('Třetí'));
  assert.equal(noModified(t ?? ''), noModified(swap(original(P.styl), 'aliases: [Styl, Hodnoty]\n', 'aliases: [Styl, Hodnoty, Třetí]\n')), '"klíč s mezerou", stav and účastníci untouched');
});

for (const [tz, start] of [['America/Los_Angeles', '0:30'], ['Europe/Prague', '9:30'], ['Asia/Tokyo', '16:30']] as const) {
  test.describe(`dates shown in ${tz}`, () => {
    test.use({ timezoneId: tz });
    test(`fr_edt_07_ac15_dates_never_shift_${tz.replace(/\W/g, '_')}`, async ({ page }) => {
      const vault = typesVault();
      await openTypes(page, P.porada, { vault, region: 'cs' });
      const datum = await must(props(page).getByRole('textbox', { name: 'Datum', exact: true }), 'Datum');
      assert.equal(await datum.inputValue(), '7. 10. 2026', '7 Oct 2026 in every zone');
      const g = await must(props(page).getByRole('group', { name: 'Začátek' }), 'Začátek');
      assert.ok((await g.getByRole('textbox', { name: 'Začátek time' }).inputValue()).replace(/^0(?=\d:)/, '') === start, `začátek shows the instant in ${tz}`);
      await page.keyboard.press('Meta+o');
      await page.getByRole('textbox', { name: 'Switcher query' }).or(page.getByRole('combobox', { name: 'Switcher query' })).first().fill('Zavolat Janě');
      await settled(page, 'Switcher results', 'Zavolat Janě');
      await page.keyboard.press('Enter');
      const due = await must(props(page).getByRole('textbox', { name: 'Due date', exact: true }), 'Due date');
      assert.equal(await due.inputValue(), '9. 10. 2026', '9 Oct 2026');
    });
  });
}
