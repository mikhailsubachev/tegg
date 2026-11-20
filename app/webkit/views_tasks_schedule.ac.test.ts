// Slice Q2-T, L5 (WebKit + fake core): the `Schedule` tab of docs/acceptance/views.md part three (R201, R203, R206, R208):
// FR-TSK-04 AC-23 (period lanes and day groups; zones, regions, Sunday), AC-24 (the done lane), AC-25 (period drags write
// `due` once), AC-27 (live and midnight), AC-28 (the text and tag filters) and FR-QRY-08 AC-3 (lanes pre-fill dates).
// Interface docs/contracts/v1-views.md §26, §29.3…§29.6, §30.1, §30.3, §31.1, expected bytes §31.4. Clock
// `2026-10-14T12:00:00+02:00`; (TZ) also America/Los_Angeles, (W) also `en-US`. Written from the ACs and the contract only
// (D-61). Lookups go through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mustBeDraft } from './helpers';
import {
  KANBAN, NOW, NOW_IN, O, PR, PROJEKTY_BOARD, SCHEDULE, SUMMARY, T, TYPE_TASK, board, changedFiles, click, dayGroup, doneLane, doneToggle, drag, dropLabel, dueChip,
  eventually, expectedTasks, fileText, fileWhen, filterTasks, flat, lane, laneCards, laneCardsWhen, laneShape, liveRegion, main, mustBeOn, must, newInLane, nfc,
  noteWrites, openTagFilter, openTasks, overlayOriginal, overlayVault, paths, periodLanes, pickTag, qfile, runCommand, scheduleBoard, scheduleCs, scheduleEnUs, seen,
  selectTab, shapeWhen, shortDate, sidebarTasks, sleep, startTasksViews, swap, tagChips, tagOptionTexts, taskCard, taskCheckbox, tasksSummary, textOf, titleOf, uiState,
  whereIs, writesTo, mutatingCalls, type FakeCoreHandle,
} from './views-tasks-helpers';

const FIRST4 = (s: { id: string }[]) => s.slice(0, 4);
const LANE_IDS = ['period:today', 'period:week', 'period:later', 'none', 'done'];
/** R203 day heading: `Intl.DateTimeFormat(region, { weekday: 'long', day: 'numeric' })`. */
const dayHeading = (date: string, region: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(region, { weekday: 'long', day: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
};
async function schedule(page: Page): Promise<Locator> {
  return openTasks(page, SCHEDULE);
}
async function expandDone(b: Locator) {
  const t = await must(doneToggle(b), '`Expand Done`');
  if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
  assert.equal(await eventually(() => t.getAttribute('aria-expanded'), (x) => x === 'true', 2000), 'true', 'the done lane is expanded');
}
/** Drags a card onto `to`, returning the drop label shown just before the release. */
async function dropOn(page: Page, from: Locator, to: Locator, o: { alt?: boolean; esc?: boolean } = {}): Promise<string> {
  let label = '';
  await drag(page, from, to, { ...o, beforeUp: async () => { label = flat(await dropLabel(page).first().innerText({ timeout: 500 }).catch(() => '')); } });
  return label;
}
const exactlyOnce = async (core: FakeCoreHandle, path: string) => (await writesTo(core)).filter((p) => p === nfc(path)).length;

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-23

for (const tz of ['Europe/Prague', 'America/Los_Angeles'] as const) {
  test.describe(`Schedule lanes in ${tz}`, () => {
    test.use({ timezoneId: tz });

    test(`fr_tsk_04_ac23_schedule_lanes_cs_${tz.replace(/\W/g, '_')}`, async ({ page }) => {
      const core = await startTasksViews(page, { route: TYPE_TASK, now: NOW_IN[tz] });
      const b = await schedule(page);
      const shape = await shapeWhen(b, scheduleCs(), 5000);
      assert.deepEqual(shape.map((l) => l.id), LANE_IDS, 'lanes `Today & overdue`, `This week`, `Later`, `Not scheduled`, `Done`, in order');
      assert.deepEqual(FIRST4(shape), FIRST4(scheduleCs()), 'R208\'s cards, order and day groups (sobota 17. empty)');
      const ls = await periodLanes(b);
      assert.deepEqual(ls.map((l) => l.label), ['Today & overdue, 4 Tasks', 'This week, 4 Tasks', 'Later, 2 Tasks', 'Not scheduled, 5 Tasks', 'Done, 2 Tasks'], 'each lane a region named by its label and count');
      const week = ls[1];
      assert.deepEqual(week.days.map((d) => d.label), [
        `${dayHeading('2026-10-15', 'cs')}, 2 Tasks`, `${dayHeading('2026-10-16', 'cs')}, 1 Task`, `${dayHeading('2026-10-17', 'cs')}, 0 Tasks`, `${dayHeading('2026-10-18', 'cs')}, 1 Task`,
      ], 'day groups named `<weekday day>, <n> Tasks` (čtvrtek 15., …)');
      assert.equal(flat(await textOf(dayGroup(b, '2026-10-17').locator('h3.day-heading'))), dayHeading('2026-10-17', 'cs'), '`sobota 17.` shown with only its heading');
      assert.equal(ls[0].tone, 'danger', '`Today & overdue` heading tone danger');
      assert.equal(ls[3].tone, 'muted', '`Not scheduled` heading tone muted');
      for (const k of ['t16', 't17'] as const) {
        assert.equal(flat(await textOf(dueChip(taskCard(b, T[k])))), 'Invalid due date', `${titleOf(T[k])}: \`Invalid due date\``);
      }
      for (const k of ['t01', 't04', 't06'] as const) assert.ok(await seen(dueChip(taskCard(b, T[k])), 1000), `${titleOf(T[k])}: the due chip stays on the card (R203 "The card")`);
      assert.equal(await dueChip(taskCard(b, T.t01)).getAttribute('data-tone'), 'overdue', 'T01: the overdue highlight (FR-TSK-09 AC-2)');
      for (const p of [T.t11, T.t13, PR.web, O.seStavem, O.bezHlavicky, O.sablona, O.smazany]) assert.equal(await whereIs(b, p), null, `${p} is on no lane`);
      assert.deepEqual(await mutatingCalls(core), [], 'drawing writes nothing');
    });
  });
}

test.describe('Schedule lanes en-US (week Sunday–Saturday)', () => {
  test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

  test('fr_tsk_04_ac23_schedule_lanes_en_us', async ({ page }) => {
    await startTasksViews(page, { route: TYPE_TASK, region: 'en-US' });
    const b = await schedule(page);
    const shape = await shapeWhen(b, scheduleEnUs(), 5000);
    assert.deepEqual(FIRST4(shape), FIRST4(scheduleEnUs()), 'This week Thu 15 – Sat 17 (3), Later T05, T06, T07');
    const ls = await periodLanes(b);
    assert.deepEqual(ls[1].days.map((d) => d.label.split(',')[0]), ['2026-10-15', '2026-10-16', '2026-10-17'].map((d) => dayHeading(d, 'en-US')), 'headings `Thursday 15`, `Friday 16`, `Saturday 17`');
    assert.equal(ls[2].label, 'Later, 3 Tasks', 'Later 3');
  });
});

test.describe('Schedule lanes on Sunday and across midnight in two zones', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac23_schedule_lanes_on_sunday', async ({ page }) => {
    await startTasksViews(page, { route: TYPE_TASK, now: '2026-10-18T12:00:00+02:00' });
    const b = await schedule(page);
    const ids = await eventually(async () => (await periodLanes(b)).map((l) => l.id), (x) => x.length >= 4, 5000);
    assert.deepEqual(ids, ['period:today', 'period:later', 'none', 'done'], 'no `This week` lane on the week\'s last day');
    assert.ok((await laneCards(b, 'period:today')).includes(T.t05), 'Úklid garáže (T05) in `Today & overdue`');
    assert.ok((await laneCards(b, 'period:later')).includes(T.t06), 'Příprava prezentace (T06) in `Later`');
  });

  test('fr_tsk_04_ac23_schedule_lanes_at_22_30_utc_in_prague', async ({ page }) => {
    const core = await startTasksViews(page, { route: TYPE_TASK, now: '2026-10-14T22:30:00Z' });
    const b = await schedule(page);
    assert.ok(await eventually(async () => (await laneCards(b, 'period:today')).includes(T.t03), (x) => x, 5000), 'T03 in `Today & overdue`');
    const chip = flat(await textOf(dueChip(taskCard(b, T.t03))));
    assert.ok(chip.includes('Yesterday'), `T03 overdue: \`${shortDate('2026-10-14', 'cs')} · Yesterday\` (${chip})`);
    assert.equal(await dueChip(taskCard(b, T.t03)).getAttribute('data-tone'), 'overdue', 'the overdue highlight');
    assert.equal(await fileText(core, T.t03), overlayOriginal(T.t03), 'its file isn\'t touched');
  });
});

test.describe('Schedule lanes at 22:30 UTC in Los Angeles', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('fr_tsk_04_ac23_schedule_lanes_at_22_30_utc_in_los_angeles', async ({ page }) => {
    await startTasksViews(page, { route: TYPE_TASK, now: '2026-10-14T22:30:00Z' });
    const b = await schedule(page);
    assert.ok(await eventually(async () => (await laneCards(b, 'period:today')).includes(T.t03), (x) => x, 5000), 'T03 in `Today & overdue`');
    const chip = flat(await textOf(dueChip(taskCard(b, T.t03))));
    assert.ok(chip.includes('Today') && !chip.includes('Yesterday'), `T03 due \`Today\` in Los Angeles (${chip})`);
  });
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-24

test.describe('the done lane (Europe/Prague)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac24_the_done_lane', async ({ page }) => {
    const core = await startTasksViews(page, { route: TYPE_TASK });
    const b = await schedule(page);
    const ls = await eventually(() => periodLanes(b), (x) => x.length === 5, 5000);
    const done = ls[4];
    assert.equal(done.id, 'done', 'the done lane is last');
    assert.equal(done.label, 'Done, 2 Tasks', 'count 2');
    assert.equal(done.hint, 'Completed in the last 7 days', 'hint `Completed in the last 7 days`');
    assert.equal(done.folded, true, 'folded');
    const toggle = await must(doneToggle(b), 'button `Expand Done`');
    assert.equal(flat(await toggle.getAttribute('aria-label')), 'Expand Done', '`Expand Done`');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'aria-expanded="false"');
    const u0 = (await callsOf(core)).length;
    await toggle.click();
    assert.deepEqual(await laneCardsWhen(b, 'done', (c) => c.length === 2), paths('t10', 't12'), 'expanding shows Zaplatit fakturu, Vrátit knihy');
    for (const k of ['t10', 't12'] as const) {
      const c = taskCard(b, T[k], 'done');
      assert.equal(await taskCheckbox(c, titleOf(T[k])).getAttribute('aria-checked'), 'true', `${k}: checked`);
      const deco = await c.locator('a[data-card-title]').or(c.getByRole('link', { name: titleOf(T[k]), exact: true })).first().evaluate((e) => getComputedStyle(e).textDecorationLine).catch(() => '');
      assert.ok(deco.includes('line-through'), `${k}: struck title (${deco})`);
    }
    assert.equal(await whereIs(b, T.t11), null, 'T11 is in no lane');
    const u = await eventually(() => uiState(core), (x) => (x?.usageFolded?.['tab:task/schedule'] ?? []).includes('!done'), 2000);
    assert.deepEqual(u?.usageFolded?.['tab:task/schedule'], ['!done'], 'the fold is the Schedule tab\'s, `!done` (R206)');
    assert.ok((await callsOf(core)).length > u0, 'a ui_state_set');
    assert.deepEqual(await writesTo(core), [], 'nothing is written to the vault');
    // Checking T03 writes tasks.md FR-TSK-02 AC-10's bytes once; the card moves to Done within 1 s.
    await click(taskCheckbox(taskCard(b, T.t03), 'Zalít květiny'), 'the checkbox of Zalít květiny');
    const want = swap(swap(overlayOriginal(T.t03), 'status: To do', 'status: Done'), 'modified: 2026-10-01T09:00:00+02:00\n', `modified: ${NOW}\ncompleted: ${NOW}\n`);
    assert.equal(await fileWhen(core, T.t03, (x) => x === want), want, 'status Done, completed appended, modified');
    assert.equal(await exactlyOnce(core, T.t03), 1, 'one write');
    assert.ok((await laneCardsWhen(b, 'done', (c) => c.includes(T.t03), 1000)).includes(T.t03), 'T03 in `Done` within 1 s');
    assert.equal((await periodLanes(b)).find((l) => l.id === 'done')?.label, 'Done, 3 Tasks', 'count 3');
    await click(taskCheckbox(taskCard(b, T.t03, 'done'), 'Zalít květiny'), 'uncheck T03 in Done');
    assert.ok((await laneCardsWhen(b, 'period:today', (c) => c.includes(T.t03), 2000)).includes(T.t03), 'unchecking moves it back to `Today & overdue`');
  });

  test('fr_tsk_04_ac24_the_done_lane_window_moves_with_the_clock', async ({ page }) => {
    await startTasksViews(page, { route: TYPE_TASK, now: '2026-10-16T12:00:00+02:00' });
    let b = await schedule(page);
    await expandDone(b);
    assert.ok((await laneCardsWhen(b, 'done', (c) => c.includes(T.t12))).includes(T.t12), '16 Oct: T12 (modified 10 Oct) still in Done');
    await startTasksViews(page, { route: TYPE_TASK, now: '2026-10-17T12:00:00+02:00' });
    b = await schedule(page);
    await expandDone(b);
    assert.ok(await eventually(async () => (await laneCards(b, 'done')).length > 0, (x) => x, 3000), 'precondition: Done shows cards');
    assert.equal(await whereIs(b, T.t12), null, '17 Oct: T12 leaves (11 Oct is the first day)');
  });

  test('fr_tsk_04_ac24_the_done_lane_runtime_within_30_and_removed', async ({ page }) => {
    const core = await startTasksViews(page, { route: TYPE_TASK });
    const b = await schedule(page);
    await must(doneLane(b), 'the done lane', 5000);
    const sched = overlayOriginal(qfile(SCHEDULE));
    await core.setFile(qfile(SCHEDULE), swap(sched, 'done_lane: { within_days: 7, folded: true }\n', 'done_lane: { within_days: 30, folded: false }\n'));
    const ls = await eventually(() => periodLanes(b), (x) => x.find((l) => l.id === 'done')?.cards.length === 3, 3000);
    const done = ls.find((l) => l.id === 'done');
    assert.deepEqual(done?.cards, paths('t11', 't10', 't12'), '`Done` 3 unfolded: T11 back (by due: T11, T10, T12)');
    assert.equal(done?.folded, false, 'unfolded');
    assert.equal(done?.hint, 'Completed in the last 30 days', 'hint 30 days');
    await core.setFile(qfile(SCHEDULE), swap(sched, 'done_lane: { within_days: 7, folded: true }\n', ''));
    const l2 = await eventually(() => periodLanes(b), (x) => !x.some((l) => l.id === 'done'), 3000);
    assert.ok(!l2.some((l) => l.id === 'done'), 'no done lane without the key');
    const today = l2.find((l) => l.id === 'period:today')?.cards ?? [];
    for (const k of ['t10', 't11'] as const) assert.ok(today.includes(T[k]), `${k} in \`Today & overdue\` by its due`);
    assert.ok((l2.find((l) => l.id === 'none')?.cards ?? []).includes(T.t12), 'T12 (no due) in `Not scheduled`');
    for (const k of ['t10', 't11', 't12'] as const) assert.equal(await taskCheckbox(taskCard(b, T[k]), titleOf(T[k])).getAttribute('aria-checked'), 'true', `${k}: checkbox checked`);
  });
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-25

test.describe('period drags (Europe/Prague, cs)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac25_period_drags_write_due_once', async ({ page }) => {
    const core = await startTasksViews(page, { route: TYPE_TASK });
    const before = overlayVault().files;
    const b = await schedule(page);
    await expandDone(b);
    const changed: string[] = [];
    const steps: [string, string, () => Locator, string, string][] = [
      ['(a) T08 onto pátek 16.', T.t08, () => dayGroup(b, '2026-10-16'), 'tasks/precist-knihu-due-16.md', `Drop to set Due date: ${shortDate('2026-10-16', 'cs')}`],
      ['(b) T07 onto Today & overdue', T.t07, () => lane(b, 'period:today'), 'tasks/obnovit-pas-due-14.md', `Drop to set Due date: ${shortDate('2026-10-14', 'cs')}`],
      ['(c) T03 onto Later', T.t03, () => lane(b, 'period:later'), 'tasks/zalit-kvetiny-due-19.md', `Drop to set Due date: ${shortDate('2026-10-19', 'cs')}`],
      ['(d) T04 onto Not scheduled', T.t04, () => lane(b, 'none'), 'tasks/koupit-darek-no-due.md', 'Drop to clear Due date'],
      ['(e) T02 onto Done', T.t02, () => lane(b, 'done'), 'tasks/poslat-rozpocet-done.md', 'Drop to mark done'],
      ['(f) T12 from Done onto Today & overdue', T.t12, () => lane(b, 'period:today'), 'tasks/vratit-knihy-reopened.md', `Drop to set Due date: ${shortDate('2026-10-14', 'cs')}`],
      ['(g) T16 onto čtvrtek 15.', T.t16, () => dayGroup(b, '2026-10-15'), 'tasks/spatne-datum-due-15.md', `Drop to set Due date: ${shortDate('2026-10-15', 'cs')}`],
    ];
    for (const [what, path, to, exp, label] of steps) {
      const shown = await dropOn(page, taskCard(b, path), to(), { alt: what.startsWith('(g)') });
      assert.equal(shown, label, `${what}: the drop label \`${label}\``);
      const want = expectedTasks(exp);
      assert.equal(await fileWhen(core, path, (x) => x === want), want, `${what}: only the named lines and \`modified: ${NOW}\``);
      assert.equal(await exactlyOnce(core, path), 1, `${what}: one write`);
      changed.push(nfc(path));
      assert.deepEqual(await changedFiles(core, before), [...changed].sort(), `${what}: no other vault file changes`);
      const title = titleOf(path);
      assert.ok(await eventually(() => textOf(liveRegion(page)), (t) => t.startsWith(`Moved "${title}" to `), 2000).then((t) => t.startsWith(`Moved "${title}" to `)), `${what}: the live region \`Moved "${title}" to …\``);
    }
    // A drop in the card's own lane or day group, outside any lane, or Esc writes nothing; the card returns.
    const n = (await writesTo(core)).length;
    await dropOn(page, taskCard(b, T.t01), lane(b, 'period:today'));
    await dropOn(page, taskCard(b, T.t19), dayGroup(b, '2026-10-15'));
    await drag(page, taskCard(b, T.t06), { dx: 0, dy: -400 });
    await dropOn(page, taskCard(b, T.t09), lane(b, 'period:later'), { esc: true });
    await sleep(300);
    assert.equal((await writesTo(core)).length, n, 'own lane, own day group, outside, Esc: nothing written');
    assert.deepEqual(await whereIs(b, T.t09), { lane: 'none', day: null }, 'the card returns');
  });

  test('fr_tsk_04_ac25_period_drags_write_due_once_alt_drag_writes_the_same', async ({ page }) => {
    const core = await startTasksViews(page, { route: TYPE_TASK });
    const b = await schedule(page);
    await dropOn(page, taskCard(b, T.t08), dayGroup(b, '2026-10-16'), { alt: true });
    const want = expectedTasks('tasks/precist-knihu-due-16.md');
    assert.equal(await fileWhen(core, T.t08, (x) => x === want), want, 'Alt-drag writes the same as a drag');
    assert.deepEqual(await whereIs(b, T.t08), { lane: 'period:week', day: '2026-10-16' }, 'the card moves, no copy');
  });
});

test.describe('period drags (America/Los_Angeles)', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('fr_tsk_04_ac25_period_drags_write_due_once_los_angeles', async ({ page }) => {
    const core = await startTasksViews(page, { route: TYPE_TASK, now: NOW_IN['America/Los_Angeles'] });
    const b = await schedule(page);
    await dropOn(page, taskCard(b, T.t07), lane(b, 'period:today'));
    const want = expectedTasks('tasks/obnovit-pas-due-14-la.md');
    assert.equal(await fileWhen(core, T.t07, (x) => x === want), want, '(b) in Los Angeles: `due: 2026-10-14` (the local date), `modified: …T03:00:00-07:00`');
  });
});

test.describe('period drags (en-US)', () => {
  test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

  test('fr_tsk_04_ac25_period_drags_write_due_once_en_us', async ({ page }) => {
    const core = await startTasksViews(page, { route: TYPE_TASK, region: 'en-US' });
    const b = await schedule(page);
    await dropOn(page, taskCard(b, T.t03), lane(b, 'period:later'));
    const want = expectedTasks('tasks/zalit-kvetiny-due-18-en-us.md');
    assert.equal(await fileWhen(core, T.t03, (x) => x === want), want, '(c) en-US: `due: 2026-10-18`');
  });
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-27

test.describe('live and midnight (Europe/Prague)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac27_live_and_midnight', async ({ page }) => {
    const core = await startTasksViews(page, { route: TYPE_TASK });
    const b = await schedule(page);
    await expandDone(b);
    await core.setFile(T.t07, swap(overlayOriginal(T.t07), 'due: 2026-12-01', 'due: 2026-10-15'));
    assert.deepEqual(await eventually(() => whereIs(b, T.t07), (w) => w?.day === '2026-10-15', 2000), { lane: 'period:week', day: '2026-10-15' }, 'Obnovit pas moves to `čtvrtek 15.` within 2 s');
    await core.setFile(T.t03, swap(swap(overlayOriginal(T.t03), 'status: To do', 'status: Done'), 'modified: 2026-10-01T09:00:00+02:00\n', 'modified: 2026-10-01T09:00:00+02:00\ncompleted: 2026-10-14T10:00:00+02:00\n'));
    assert.equal((await eventually(() => whereIs(b, T.t03), (w) => w?.lane === 'done', 2000))?.lane, 'done', 'Zalít květiny moves to `Done`');
    const novy = 'Tasks/Nový.md';
    await core.setFile(novy, '---\nid: 01JB5A0000000000000000W900\ntype: task\ntitle: Nový\nstatus: To do\ndue: 2026-10-14\ncreated: 2026-10-14T11:00:00+02:00\nmodified: 2026-10-14T11:00:00+02:00\n---\n');
    assert.equal((await eventually(() => whereIs(b, novy), (w) => w?.lane === 'period:today', 2000))?.lane, 'period:today', 'Tasks/Nový.md shows in `Today & overdue`');
    await core.setFile(qfile(SCHEDULE), swap(overlayOriginal(qfile(SCHEDULE)), 'lanes: horizontal\n', 'lanes: vertical\n'));
    assert.equal(await eventually(() => b.getAttribute('data-lanes'), (x) => x === 'vertical', 2000), 'vertical', '`lanes: vertical` redraws the lanes as columns');
    assert.deepEqual(await writesTo(core), [], 'nothing is written');
  });

  test('fr_tsk_04_ac27_live_and_midnight_after_midnight', async ({ page }) => {
    const core = await startTasksViews(page, { route: TYPE_TASK, now: '2026-10-14T23:59:58+02:00', install: true });
    const b = await schedule(page);
    await shapeWhen(b, scheduleCs(), 5000);
    await page.clock.runFor(61_000);
    const today = await laneCardsWhen(b, 'period:today', (c) => c.includes(T.t04) && c.includes(T.t19), 3000);
    assert.ok(today.includes(T.t04) && today.includes(T.t19), 'T04 and T19 move to `Today & overdue`');
    assert.ok(flat(await textOf(dueChip(taskCard(b, T.t03)))).includes('Yesterday'), 'T03 shows `… · Yesterday`');
    const days = (await periodLanes(b)).find((l) => l.id === 'period:week')?.days.map((d) => d.date);
    assert.deepEqual(days, ['2026-10-16', '2026-10-17', '2026-10-18'], '`čtvrtek 15.` leaves `This week`');
    assert.equal(flat(await textOf(tasksSummary(page))), '15 open · 4 overdue · 1 done this week', 'the summary follows');
    assert.deepEqual(await writesTo(core), [], 'nothing is written');
  });

  test('fr_tsk_04_ac27_live_and_midnight_zone_change', async ({ page }) => {
    await startTasksViews(page, { route: TYPE_TASK, now: '2026-10-15T00:30:00+02:00', install: true });
    const b = await schedule(page);
    assert.ok((await laneCardsWhen(b, 'period:today', (c) => c.includes(T.t04), 5000)).includes(T.t04), 'Prague, 15 Oct 00:30: T04 due today');
    await page.evaluate(() => { (window as any).__TEGG_TZ__ = 'America/Los_Angeles'; });
    await page.clock.runFor(61_000);
    const w = await eventually(() => whereIs(b, T.t04), (x) => x?.lane === 'period:week', 3000);
    assert.deepEqual(w, { lane: 'period:week', day: '2026-10-15' }, 'Los Angeles, 14 Oct 15:30: T04 back in `čtvrtek 15.` without a restart');
  });
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-28

test.describe('the text and tag filters (Europe/Prague)', () => {
  test.use({ timezoneId: 'Europe/Prague' });

  test('fr_tsk_04_ac28_text_and_tag_filters', async ({ page }) => {
    const core = await startTasksViews(page, { route: TYPE_TASK });
    const b = await schedule(page);
    await expandDone(b);
    const field = await must(filterTasks(page), '`Filter Tasks…`');
    await field.fill('za');
    const s = await eventually(() => periodLanes(b), (l) => l[0]?.cards.length === 2, 2000);
    assert.deepEqual(s.map((l) => [l.id, l.cards]), [
      ['period:today', paths('t01', 't03')], ['period:week', []], ['period:later', []], ['none', []], ['done', paths('t10')],
    ], '`za`: Zavolat Janě, Zalít květiny, Zaplatit fakturu; every other lane shown');
    assert.deepEqual(s.map((l) => l.label.split(', ')[1]), ['2 Tasks', '0 Tasks', '0 Tasks', '0 Tasks', '1 Task'], 'counts narrowed, empty lanes with 0');
    assert.equal(s[1].days.length, 4, 'the day groups stay');
    await field.fill('cesta');
    assert.ok(await eventually(async () => (await periodLanes(b)).every((l) => l.cards.length === 0), (x) => x, 2000), '`cesta`: every lane empty');
    assert.ok(await seen(main(page).getByRole('status').filter({ hasText: 'No Tasks match "cesta"' }), 2000), 'the status `No Tasks match "cesta"`');
    await field.fill('za');
    await selectTab(page, KANBAN);
    assert.equal(await filterTasks(page).inputValue(), '', 'Kanban has its own (empty) text');
    await selectTab(page, SCHEDULE);
    assert.equal(await filterTasks(page).inputValue(), 'za', 'back on Schedule: `za` again (D-1796)');
    await runCommand(page, 'Go to Inbox');
    await runCommand(page, 'Go to Tasks');
    await openTasks(page, SCHEDULE);
    assert.equal(await filterTasks(page).inputValue(), '', 'leaving the page clears it');
    // The tag filter.
    await openTagFilter(page);
    assert.deepEqual(await tagOptionTexts(page), ['#doma 4', '#práce 4', '#finance 2', '#čtení 1', '#rodina 1'], 'R208\'s options (done lane included)');
    await pickTag(page, 'práce');
    await page.keyboard.press('Escape');
    const p = await eventually(() => periodLanes(b), (l) => l[0]?.cards.length === 2, 2000);
    assert.deepEqual(p.map((l) => [l.id, l.cards]), [['period:today', paths('t01', 't02')], ['period:week', []], ['period:later', paths('t06')], ['none', paths('t18')], ['done', []]], '`#práce`: T01, T02, T06, T18; every lane still shown');
    await pickTag(page, 'finance');
    await page.keyboard.press('Escape');
    assert.deepEqual(await eventually(async () => (await periodLanes(b)).flatMap((l) => l.cards), (c) => c.length === 1, 2000), paths('t02'), '`#práce` `#finance`: only Poslat rozpočet');
    assert.ok(await seen(main(page).getByText('Tasks with all selected tags'), 1000), '`Tasks with all selected tags`');
    assert.equal(flat(await textOf(tasksSummary(page))), SUMMARY, 'the summary ignores the filters');
    assert.match(flat(await textOf(sidebarTasks(page))), /^Tasks 15$/, 'the sidebar count ignores them');
    const u = await eventually(() => uiState(core), (x) => (x?.tagFilter?.['tab:task/schedule'] ?? []).length === 2, 2000);
    assert.deepEqual(u?.tagFilter?.['tab:task/schedule'], ['práce', 'finance'], 'stored as tagFilter["tab:task/schedule"]');
    await selectTab(page, KANBAN);
    assert.deepEqual(await tagChips(page), [], 'Kanban shows its own (empty) selection');
    await runCommand(page, 'Go to Inbox');
    await page.goBack();
    await openTasks(page, SCHEDULE);
    assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 2, 2000), ['práce', 'finance'], 'going to another page and back: `#práce` `#finance` on Schedule again');
    assert.deepEqual(await writesTo(core), [], 'typing and selecting write nothing to the vault');
  });

  test('fr_tsk_04_ac28_text_and_tag_filters_after_a_relaunch', async ({ page }) => {
    await startTasksViews(page, { route: TYPE_TASK, ui: { tagFilter: { 'tab:task/schedule': ['práce', 'finance'] } } });
    await openTasks(page, SCHEDULE);
    assert.deepEqual(await eventually(() => tagChips(page), (c) => c.length === 2, 3000), ['práce', 'finance'], 'a relaunch shows the stored selection');
    assert.equal(await filterTasks(page).inputValue(), '', 'the text isn\'t stored');
  });
});

// ------------------------------------------------------------------------------------------------ FR-QRY-08 AC-3

for (const region of ['cs', 'en-US'] as const) {
  test.describe(`period lanes pre-fill dates (${region})`, () => {
    test.use({ timezoneId: 'Europe/Prague', locale: region === 'cs' ? 'cs-CZ' : 'en-US' });

    test(`fr_qry_08_ac3_period_lanes_pre_fill_dates_${region.replace('-', '_')}`, async ({ page }) => {
      const core = await startTasksViews(page, { route: `query/${PROJEKTY_BOARD}`, region });
      const b = await must(board(page), `query/${PROJEKTY_BOARD}: the board`, 8000);
      const tile = await must(newInLane(b, 'period:week'), 'the tile of This week');
      assert.equal(await tile.getAttribute('aria-label'), 'New Projekt in This week', '`New Projekt in This week`');
      await tile.click();
      await mustBeDraft(page, 'New Projekt in This week');
      assert.deepEqual(await writesTo(core), [], 'nothing is written before the first change');
      await page.keyboard.type('Nový projekt');
      await page.keyboard.press('Enter');
      const f = await eventually(async () => Object.keys(await core.files()).find((k) => k.startsWith('Projekty/Nový projekt')), (x) => !!x, 3000);
      const due = region === 'cs' ? '2026-10-18' : '2026-10-17';
      assert.ok(f && (await fileText(core, f))?.includes(`due: ${due}\n`), `the first change writes \`due: ${due}\` (YYYY-MM-DD)`);
      if (region === 'cs') {
        // As FR-TSK-10 AC-13 (b) for Schedule: Today & overdue 14 Oct, Later 19 Oct, Not scheduled none.
        for (const [id, want] of [['period:today', '2026-10-14'], ['period:later', '2026-10-19'], ['none', null]] as const) {
          await runCommand(page, 'Go to Tasks');
          const s = await schedule(page);
          await click(newInLane(s, id), `the tile of ${id}`);
          await mustBeDraft(page, `New Task in ${id}`);
          await page.keyboard.type(`Úkol ${id.replace(':', ' ')}`);
          await page.keyboard.press('Enter');
          const g = await eventually(async () => Object.keys(await core.files()).find((k) => k.startsWith(`Tasks/Úkol ${id.replace(':', ' ')}`)), (x) => !!x, 3000);
          const t = g ? await fileText(core, g) : undefined;
          assert.ok(t !== undefined, `${id}: created`);
          if (want) assert.ok(t!.includes(`due: ${want}\n`), `${id}: due ${want}`); else assert.ok(!/^due:/m.test(t!), `${id}: no due`);
        }
      }
    });
  });
}

/** `ui_state_set` calls so far. */
async function callsOf(core: FakeCoreHandle) { return (await core.calls()).filter((c) => c.cmd === 'ui_state_set'); }
