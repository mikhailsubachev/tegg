// Preview v0.94 feedback, L5 (WebKit + fake core): the date picker's three quick picks on every surface of R89.
// docs/acceptance/date-picker.md R89 row `Quick picks`, FR-TYP-02 AC-9 (exactly `Today`, `Tomorrow`, `This week`; the
// first Friday on or after today; description and tooltip of its long date), AC-10 (one line); AP-1185…AP-1187 →
// D-1285…D-1287. Interface docs/contracts/ms5-tasks.md §13 (`This week` has `aria-description` and `title` =
// `longDate(thisWeek(today))`), ms5-capture.md §16.3. Surfaces: the attribute panel (types fixture, Porada), a task
// card's menu on the Schedule and the Kanban (tasks fixture), the `@` list's `Pick a date…` (daily fixture, Zmínky), the
// Daily Notes `Calendar`, the capture's `Pick a due date`. Clock 2026-10-14 (Wednesday), Europe/Prague, region `cs`
// unless stated. Written from the ACs and the contracts only (D-61); every lookup goes through `must`/node:assert (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { T, card, click, gotoKanban, gotoTasks, moreBtn, shortDate, startTasks, titleOf } from './tasks-helpers';
import { D, caretAtEnd, cmdD, linkSuggestions, mustBeOn, pickDate, startDaily } from './daily-helpers';
import { dueBtn, startCapture } from './capture-helpers';
import { P, callsOf, eventually, lastWrite, noModified, openTypes, original, props, swap, type FakeCoreHandle } from './types-helpers';
import { calendarDialog, closed, dateName, dueDialog, pickDialog } from './v068-helpers';
import { must, sleep } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });

const NOW10 = '2026-10-14T10:00:00+02:00';
const PICKS = ['Today', 'Tomorrow', 'This week'];
const OLD = ['Next week', 'Fri'];
const ui = (theme: 'light' | 'dark') => ({ version: 1 as const, theme, sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' as const } });

type Surface = 'panel' | 'schedule' | 'kanban' | 'at' | 'daily' | 'capture';
/** Opens the picker of a surface at the test clock and returns its dialog. */
async function openSurface(page: Page, s: Surface, o: { theme?: 'light' | 'dark'; region?: string } = {}): Promise<Locator> {
  const theme = o.theme ?? 'light';
  const region = o.region ?? 'cs';
  if (s === 'panel') {
    await page.clock.setFixedTime(new Date(NOW10));
    await openTypes(page, P.porada, { region, uiState: ui(theme) });
    await click(props(page).getByRole('button', { name: dateName('Datum: ', '2026-10-07', region) }), 'the Datum opener');
    return must(pickDialog(page), 'dialog "Pick date" (attribute panel)');
  }
  if (s === 'schedule' || s === 'kanban') {
    await startTasks(page, { now: NOW10, theme, region });
    if (s === 'schedule') await gotoTasks(page);
    else await gotoKanban(page, 'Status');
    const title = titleOf(T.t03);
    await click(moreBtn(card(page, title), title), `More actions for "${title}"`);
    await click(page.getByRole('menuitem', { name: 'Due date…', exact: true }), 'Due date…');
    return must(pickDialog(page), `dialog "Pick date" (${s} card)`);
  }
  if (s === 'at') {
    await startDaily(page, { at: D.zminky, region, uiState: ui(theme) });
    await mustBeOn(page, 'Zmínky', 'landing on Zmínky', 5000);
    await caretAtEnd(page);
    await page.keyboard.type(' @Ko');
    await must(linkSuggestions(page), 'the @ list');
    await click(linkSuggestions(page).getByRole('option', { name: 'Pick a date…', exact: true }), 'Pick a date…');
    return must(pickDialog(page), 'dialog "Pick date" (@ list)');
  }
  if (s === 'daily') {
    await startDaily(page, { region, uiState: ui(theme) });
    await cmdD(page, '2026-10-14');
    await click(pickDate(page), 'button "Pick date" (daily header)');
    return must(calendarDialog(page), 'dialog "Calendar"');
  }
  await startCapture(page, { kind: 'task', region, theme });
  await click(dueBtn(page), 'button "Due: …"');
  return must(dueDialog(page), 'dialog "Pick a due date"');
}
/** The dialog's quick-pick buttons (named `Today`, `Tomorrow`, `This week`, `Next week` or `Fri`), in DOM order. */
async function quickPicks(dlg: Locator): Promise<string[]> {
  const names = await dlg.getByRole('button').evaluateAll((es) => es.map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').replace(/\s+/g, ' ').trim()));
  return names.filter((n) => ['Today', 'Tomorrow', 'This week', 'Next week', 'Fri'].includes(n));
}
const tip = (b: Locator) => b.evaluate((e) => {
  const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return {
    description: (e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim(),
    title: e.getAttribute('title') ?? '',
  };
});

// ------------------------------------------------------------------------------------------------ FR-TYP-02 AC-9 (every surface)

for (const s of ['panel', 'schedule', 'kanban', 'at', 'daily', 'capture'] as const) {
  test(`fr_typ_02_ac9_three_quick_picks_${s}`, async ({ page }) => {
    const dlg = await openSurface(page, s);
    assert.deepEqual(await quickPicks(dlg), PICKS, `${s}: exactly Today, Tomorrow, This week, in this order`);
    for (const n of OLD) assert.equal(await dlg.getByRole('button', { name: n, exact: true }).count(), 0, `${s}: no button ${n}`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-TYP-02 AC-9 (the date and the tooltip)

async function porada(page: Page, now: string): Promise<{ core: FakeCoreHandle; dlg: Locator }> {
  await page.clock.setFixedTime(new Date(now));
  const core = await openTypes(page, P.porada, { region: 'cs' });
  await click(props(page).getByRole('button', { name: dateName('Datum: ', '2026-10-07') }), 'the Datum opener');
  return { core, dlg: await must(pickDialog(page), 'dialog "Pick date"') };
}
const writes = async (core: FakeCoreHandle) => (await callsOf(core, 'note_write')).filter((c) => String((c.args as any)?.path ?? '').normalize('NFC') === P.porada.normalize('NFC')).length;

test('fr_typ_02_ac9_this_week_writes_friday_once', async ({ page }) => {
  const { core, dlg } = await porada(page, NOW10);
  await click(dlg.getByRole('button', { name: 'This week', exact: true }), 'This week');
  assert.ok(await closed(pickDialog(page)), 'the dialog closes');
  const t = await eventually(() => lastWrite(core, P.porada), (x) => x !== null && x.includes('datum: 2026-10-16'), 2500);
  assert.equal(noModified(t ?? ''), noModified(swap(original(P.porada), 'datum: 2026-10-07\n', 'datum: 2026-10-16\n')), 'datum: 2026-10-16, every other byte unchanged (AC-7 rules)');
  await sleep(400);
  assert.equal(await writes(core), 1, 'one note_write');
});

for (const [tz, want] of [['Europe/Prague', '2026-10-23'], ['America/Los_Angeles', '2026-10-16']] as const) {
  test.describe(`This week at 2026-10-16T22:30:00Z in ${tz}`, () => {
    test.use({ timezoneId: tz });
    test(`fr_typ_02_ac9_this_week_follows_the_local_date_${tz.replace(/\W/g, '_')}`, async ({ page }) => {
      const { core, dlg } = await porada(page, '2026-10-16T22:30:00Z');
      await click(dlg.getByRole('button', { name: 'This week', exact: true }), 'This week');
      const t = await eventually(() => lastWrite(core, P.porada), (x) => x !== null && /datum: 2026-10-(16|23)\n/.test(x), 2500);
      assert.equal(/^datum: (.*)$/m.exec(t ?? '')?.[1] ?? null, want, `${tz}: This week gives ${want} (today ${tz === 'Europe/Prague' ? 'Sat 17' : 'Fri 16'})`);
    });
  });
}

for (const [region, long] of [['cs', 'pátek 16. října 2026'], ['en-US', 'Friday, October 16, 2026']] as const) {
  test(`fr_typ_02_ac9_this_week_has_its_long_date_${region.replace(/\W/g, '_')}`, async ({ page }) => {
    const dlg = await openSurface(page, 'panel', { region });
    const thisWeek = await must(dlg.getByRole('button', { name: 'This week', exact: true }), 'This week');
    assert.deepEqual(await tip(thisWeek), { description: long, title: long }, `This week: description and tooltip ${long}`);
    for (const n of ['Today', 'Tomorrow']) {
      assert.deepEqual(await tip(await must(dlg.getByRole('button', { name: n, exact: true }), n)), { description: '', title: '' }, `${n}: no description, no tooltip`);
    }
  });
}

test('fr_typ_02_ac9_this_week_on_the_capture_and_the_task_card', async ({ page, browser }) => {
  // The other surfaces use the same rule: the capture chip and the card's due both get Fri 16 Oct.
  const dlg = await openSurface(page, 'capture', { region: 'en-US' });
  await click(dlg.getByRole('button', { name: 'This week', exact: true }), 'This week (capture)');
  assert.ok(await closed(dueDialog(page)), 'the capture dialog closes');
  const chip = (await (await must(dueBtn(page), 'Due chip')).innerText()).replace(/\s+/g, ' ').trim();
  assert.equal(chip, `Due: ${shortDate('2026-10-16', 'en-US')}`, 'the capture due is Fri 16 Oct (R55 due label)');
  const p2 = await browser.newPage({ timezoneId: 'Europe/Prague' });
  const core = await startTasks(p2, { now: NOW10 });
  await gotoTasks(p2);
  const title = titleOf(T.t03);
  await click(moreBtn(card(p2, title), title), `More actions for "${title}"`);
  await click(p2.getByRole('menuitem', { name: 'Due date…', exact: true }), 'Due date…');
  const d2 = await must(pickDialog(p2), 'Pick date (card)');
  await click(d2.getByRole('button', { name: 'This week', exact: true }), 'This week (card)');
  const t = await eventually(async () => (await core.files())[T.t03], (x) => !!x?.includes('due: 2026-10-16'), 2500);
  assert.match(t ?? '', /^due: 2026-10-16$/m, 'T03: due: 2026-10-16');
  await p2.close();
});

// ------------------------------------------------------------------------------------------------ FR-TYP-02 AC-10 (one line)

/** The tops of the three quick picks and the heights of one of them and of their nearest common container. */
async function line(dlg: Locator) {
  return dlg.evaluate((d, names) => {
    const all = [...d.querySelectorAll('button, [role="button"]')] as HTMLElement[];
    const name = (e: HTMLElement) => (e.getAttribute('aria-label') ?? e.textContent ?? '').replace(/\s+/g, ' ').trim();
    const bs = names.map((n) => all.find((e) => name(e) === n) ?? null);
    if (bs.some((b) => !b)) return null;
    let c: HTMLElement | null = bs[0]!.parentElement;
    while (c && !bs.every((b) => c!.contains(b))) c = c.parentElement;
    return {
      tops: bs.map((b) => b!.getBoundingClientRect().top),
      button: bs[0]!.getBoundingClientRect().height,
      container: c ? c.getBoundingClientRect().height : -1,
    };
  }, PICKS);
}

for (const theme of ['light', 'dark'] as const) {
  for (const s of ['panel', 'schedule', 'at', 'daily', 'capture'] as const) {
    test(`fr_typ_02_ac10_quick_picks_on_one_line_${s}_${theme}`, async ({ page }) => {
      if (s === 'panel') await page.setViewportSize({ width: 1280, height: 800 });
      if (s === 'capture') await page.setViewportSize({ width: 420, height: 560 });
      const dlg = await openSurface(page, s, { theme });
      const r = await line(dlg);
      assert.ok(r, `${s} ${theme}: the three buttons Today, Tomorrow, This week exist`);
      const [a, b, c] = r!.tops;
      assert.ok(Math.abs(a - b) <= 1 && Math.abs(a - c) <= 1, `${s} ${theme}: the same top ± 1 px (${r!.tops.join(', ')})`);
      assert.ok(Math.abs(r!.container - r!.button) <= 1, `${s} ${theme}: the container is one button high ± 1 px (${r!.container} vs ${r!.button})`);
    });
  }
}
