// MS5 slice 5A-1, L1: the one bucketing function of docs/contracts/ms5-tasks.md §4 (`app/ui/src/tasks/views.ts`) on
// the fixture's task rows (tasks-data.ts, R44). R41 Schedule sections, R42 Kanban columns, R44 overdue and labels:
// FR-TSK-01 AC-1 (the fake core's TS twin, §7), AC-5 (dates never shift), FR-TSK-02 AC-1, AC-3 (state logic), FR-TSK-03 AC-1, FR-TSK-04 AC-2 (TZ, W),
// AC-4 (W), AC-5, FR-TSK-05 AC-1, AC-3, AC-9, FR-TSK-09 AC-1 (TZ). Region `cs` (week from Monday) and `en-US` (from
// Sunday), Europe/Prague and America/Los_Angeles. Written from docs/acceptance/tasks.md and the contract only (D-61).
// Modules load inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { P, SPELLING, STATUS_OPTIONS, defs, fixtureRows, row, type Key } from './tasks-data';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function views(): Promise<Mod> {
  const m = await load('../ui/src/tasks/views.ts');
  assert.ok(m && typeof m.schedule === 'function' && typeof m.kanban === 'function', 'ui/src/tasks/views.ts exports schedule and kanban (§4)');
  return m!;
}
async function doc(): Promise<Mod> {
  const m = await load('@tegg/doc');
  assert.ok(m, '@tegg/doc loads');
  return m!;
}

const TODAY = '2026-10-14';
const ps = (...k: Key[]) => k.map((x) => P[x]);
const paths = (rows: { path: string }[]) => rows.map((r) => r.path.normalize('NFC'));
function input(o: Partial<{ tasks: unknown[]; today: string; region: string; firstWeekday: number; dateFilter: 'all' | 'today' | 'week'; tagFilter: string[]; timeZone: string; defs: unknown }> = {}) {
  const region = o.region ?? 'cs';
  return {
    tasks: o.tasks ?? fixtureRows(), defs: o.defs ?? defs(), today: o.today ?? TODAY, firstWeekday: o.firstWeekday ?? (region === 'en-US' ? 7 : 1),
    collator: new Intl.Collator(region), dateFilter: o.dateFilter ?? 'all', tagFilter: o.tagFilter ?? [], timeZone: o.timeZone ?? 'Europe/Prague',
  };
}
function sched(s: any) {
  return {
    overdue: paths(s.today.overdue), today: paths(s.today.today),
    week: s.week.map((g: any) => [g.date, paths(g.tasks)]), later: paths(s.later), none: paths(s.none), done: paths(s.done),
  };
}
function short(date: string, region: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(region, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-2 (R41)

test('fr_tsk_04_ac2_sections_on_the_fixture_cs', async () => {
  const v = await views();
  for (const timeZone of ['Europe/Prague', 'America/Los_Angeles']) {
    const s = v.schedule(input({ timeZone }));
    assert.deepEqual(sched(s), {
      overdue: ps('T01', 'T02'), today: ps('T03', 'T14'),
      week: [['2026-10-15', ps('T04', 'T19')], ['2026-10-16', ps('T15')], ['2026-10-18', ps('T05')]],
      later: ps('T06', 'T07'), none: ps('T08', 'T09', 'T17', 'T16', 'T18'), done: ps('T10', 'T12', 'T11'),
    }, `R41 in ${timeZone}, region cs (no group for Sat 17)`);
    assert.deepEqual(s.weekRange, { from: '2026-10-15', to: '2026-10-18' }, 'This week: Thu 15 – Sun 18');
  }
});

test('fr_tsk_04_ac2_sections_on_the_fixture_en_us', async () => {
  const v = await views();
  const s = v.schedule(input({ region: 'en-US' }));
  assert.deepEqual(sched(s).week, [['2026-10-15', ps('T04', 'T19')], ['2026-10-16', ps('T15')]], 'week Sunday–Saturday: Thu 15, Fri 16');
  assert.deepEqual(sched(s).later, ps('T05', 'T06', 'T07'), 'Later: T05 (Sun 18), T06, T07');
  assert.deepEqual(s.weekRange, { from: '2026-10-15', to: '2026-10-17' }, 'This week ends Saturday 17');
});

test('fr_tsk_04_ac2_on_sunday_this_week_is_empty', async () => {
  const v = await views();
  const s = v.schedule(input({ today: '2026-10-18' }));
  assert.deepEqual(sched(s).week, [], 'This week is empty on the last day of the week');
  assert.deepEqual(sched(s).today, ps('T05'), 'T05 is due today');
  assert.deepEqual(sched(s).later, ps('T06', 'T07'), 'T06 (19 Oct) is in Later');
  assert.deepEqual(sched(s).overdue, ps('T01', 'T02', 'T03', 'T14', 'T04', 'T19', 'T15'), 'overdue by priority, then due, then title');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-03 AC-1

test('fr_tsk_03_ac1_priority_order_and_missing_priority_last', async () => {
  const v = await views();
  for (const region of ['cs', 'en']) {
    const s = sched(v.schedule(input({ region })));
    assert.deepEqual(s.overdue, ps('T01', 'T02'), `${region}: High before Medium`);
    assert.deepEqual(s.none, ps('T08', 'T09', 'T17', 'T16', 'T18'), `${region}: Medium, then no priority by title (D-122)`);
  }
  const extra = [
    row({ path: 'Tasks/A úkol.md', status: 'To do' }),
    row({ path: 'Tasks/B úkol.md', status: 'To do', priority: 'None' }),
    row({ path: 'Tasks/C úkol.md', status: 'To do', priority: 'Low' }),
    row({ path: 'Tasks/D úkol.md', status: 'To do', priority: 'Urgentní' }),
  ];
  const s = sched(v.schedule(input({ tasks: extra })));
  assert.deepEqual(s.none, ['Tasks/C úkol.md', 'Tasks/B úkol.md', 'Tasks/A úkol.md', 'Tasks/D úkol.md'], 'Low, then None, then missing / unknown (AP-407)');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-4, AC-5

test('fr_tsk_04_ac4_date_filters_cs', async () => {
  const v = await views();
  const today = sched(v.schedule(input({ dateFilter: 'today' })));
  assert.deepEqual(today, { overdue: ps('T01', 'T02'), today: ps('T03', 'T14'), week: [], later: [], none: [], done: ps('T10') }, 'Today: Today & overdue, Done completed today');
  const week = sched(v.schedule(input({ dateFilter: 'week' })));
  assert.deepEqual(week.later, [], 'This week: no Later');
  assert.deepEqual(week.none, [], 'tasks without a valid due drop out');
  assert.equal(week.week.flatMap((g: any) => g[1]).length + week.overdue.length + week.today.length, 8, '8 cards in cs');
  assert.deepEqual(week.done, ps('T10'), 'Done from Monday 12 Oct to today');
  const c = v.counts(input());
  assert.deepEqual([c.all, c.today, c.week], [15, 4, 8], 'All 15, Today 4, This week 8');
  assert.deepEqual([c.open, c.overdue, c.dueToday], [15, 2, 2], 'the summary counts (AP-411)');
});

test('fr_tsk_04_ac4_date_filters_en_us', async () => {
  const v = await views();
  const c = v.counts(input({ region: 'en-US' }));
  assert.deepEqual([c.all, c.today, c.week], [15, 4, 7], 'This week 7 with en-US');
  const week = sched(v.schedule(input({ region: 'en-US', dateFilter: 'week' })));
  assert.equal(week.week.flatMap((g: any) => g[1]).length + week.overdue.length + week.today.length, 7);
});

test('fr_tsk_04_ac5_tag_filter_lists_and_restricts', async () => {
  // D-518 (AC-5 rewritten, contract §4): most tasks first, ties in D-122 order; several tags must all match.
  const v = await views();
  const c = v.counts(input());
  assert.deepEqual(c.tags.map((t: any) => [t.key, t.label, t.count]), [['doma', 'doma', 4], ['práce', 'práce', 4], ['čtení', 'čtení', 1], ['finance', 'finance', 1], ['rodina', 'rodina', 1]],
    'count descending, ties by collation (D-122); Doma and NFD doma count as doma; inline #rodina counts; T10 (Done) not for finance');
  const doma = sched(v.schedule(input({ tagFilter: ['doma'] })));
  assert.deepEqual([...doma.overdue, ...doma.today, ...doma.week.flatMap((g: any) => g[1]), ...doma.later, ...doma.none], ps('T03', 'T04', 'T19', 'T05'), '#doma: T03, T04, T19, T05');
  const today = v.counts(input({ dateFilter: 'today' }));
  assert.deepEqual(today.tags.map((t: any) => [t.key, t.count]), [['práce', 2], ['doma', 1], ['finance', 1]], 'counts within the date filter, most first');
});

test('fr_tsk_04_ac5_selected_tags_must_all_match', async () => {
  const v = await views();
  const open = (s: ReturnType<typeof sched>) => [...s.overdue, ...s.today, ...s.week.flatMap((g: any) => g[1]), ...s.later, ...s.none];
  const prace = sched(v.schedule(input({ tagFilter: ['práce'] })));
  assert.deepEqual(open(prace), ps('T01', 'T02', 'T06', 'T18'), '#práce: T01, T02 (Overdue), T06 (Later), T18 (Not scheduled)');
  assert.deepEqual(prace.done, [], 'Done: no Done task has #práce');
  const both = sched(v.schedule(input({ tagFilter: ['práce', 'finance'] })));
  assert.deepEqual(open(both), ps('T02'), '#práce and #finance: only T02 (all of them, D-518)');
  assert.deepEqual(both.done, [], 'T10 has #finance but not #práce');
  const none = sched(v.schedule(input({ tagFilter: ['doma', 'finance'] })));
  assert.deepEqual([...open(none), ...none.done], [], 'no task has both #doma and #finance (was any of them, D-476)');
});

test('fr_tsk_04_ac5_counts_tell_what_each_tag_would_leave', async () => {
  // Contract §4 (D-518): each listed tag counts the open tasks within the date filter that have it and every selected
  // key; selected keys are listed even at 0; order count descending, then collator, then key bytes.
  const v = await views();
  const one = v.counts(input({ tagFilter: ['práce'] }));
  assert.deepEqual(one.tags.map((t: any) => [t.key, t.count]), [['práce', 4], ['finance', 1], ['rodina', 1], ['čtení', 0], ['doma', 0]],
    'with #práce: práce 4, finance 1, rodina 1, čtení 0, doma 0');
  const two = v.counts(input({ tagFilter: ['práce', 'finance'] }));
  assert.deepEqual(two.tags.map((t: any) => [t.key, t.count]), [['finance', 1], ['práce', 1], ['čtení', 0], ['doma', 0], ['rodina', 0]],
    'with #práce and #finance: only T02 is left for either');
  const gone = v.counts(input({ tagFilter: ['zahrádka'] }));
  assert.deepEqual(gone.tags.map((t: any) => [t.key, t.count]), [['čtení', 0], ['doma', 0], ['finance', 0], ['práce', 0], ['rodina', 0], ['zahrádka', 0]],
    'a selected key no task has is listed with 0; nothing else is left either');
  const todayPrace = v.counts(input({ dateFilter: 'today', tagFilter: ['práce'] }));
  assert.deepEqual(todayPrace.tags.map((t: any) => [t.key, t.count]), [['práce', 2], ['finance', 1], ['doma', 0]], 'within the date filter (Today: T01, T02, T03, T14)');
  assert.deepEqual([one.all, one.today, one.week], [4, 2, 2], 'the date filter counts under the tag filter (AC-4): All 4, Today 2, This week 2 (T01, T02)');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-05 (R42)

test('fr_tsk_05_ac1_kanban_by_status', async () => {
  const v = await views();
  const k = v.kanban(input(), 'status', SPELLING);
  assert.deepEqual(k.columns.map((c: any) => c.id), ['To do', 'In progress', 'Waiting', 'Done', 'no-status'], 'one column per status except Cancelled, then No status');
  const by = Object.fromEntries(k.columns.map((c: any) => [c.id, paths(c.tasks)]));
  assert.deepEqual(by, {
    'To do': ps('T01', 'T03', 'T19', 'T05', 'T06', 'T07', 'T08', 'T17', 'T16', 'T18'), 'In progress': ps('T02', 'T09'), Waiting: ps('T04'),
    Done: ps('T10', 'T12'), 'no-status': ps('T14', 'T15'),
  }, 'R42 cards in R42 order (Done: the last 7 days)');
  const col = (id: string) => k.columns.find((c: any) => c.id === id);
  assert.deepEqual([col('To do').color, col('Waiting').color, col('Done').state], ['gray', 'yellow', 'done'], 'colour and state per column');
  assert.deepEqual(k.columns.map((c: any) => c.dropTarget), [true, true, true, true, false], 'No status is not a drop target (D-471)');
});

test('fr_tsk_05_ac3_kanban_by_tag', async () => {
  const v = await views();
  const k = v.kanban(input(), 'tag', SPELLING);
  assert.deepEqual(k.columns.map((c: any) => c.id), ['#čtení', '#doma', '#finance', '#práce', '#rodina', 'no-tag'], 'tag columns in D-122 order, then No tag');
  const by = Object.fromEntries(k.columns.map((c: any) => [c.id, paths(c.tasks)]));
  assert.deepEqual(by, {
    '#čtení': ps('T08'), '#doma': ps('T03', 'T04', 'T19', 'T05'), '#finance': ps('T02'), '#práce': ps('T01', 'T02', 'T06', 'T18'), '#rodina': ps('T18'),
    'no-tag': ps('T14', 'T15', 'T07', 'T09', 'T17', 'T16'),
  }, 'R42 tag columns; Done and Cancelled not shown');
  assert.equal(k.columns.find((c: any) => c.id === 'no-tag').dropTarget, false, 'No tag is not a drop target (D-478)');
  const only = v.kanban(input({ tagFilter: ['doma'] }), 'tag', SPELLING);
  assert.deepEqual(only.columns.map((c: any) => c.id), ['#doma'], 'with #doma pressed: only doma, no No tag');
});

test('fr_tsk_05_ac9_filters_restrict_every_column', async () => {
  const v = await views();
  const k = v.kanban(input({ dateFilter: 'today' }), 'status', SPELLING);
  const by = Object.fromEntries(k.columns.map((c: any) => [c.id, paths(c.tasks)]));
  assert.deepEqual(by, { 'To do': ps('T01', 'T03'), 'In progress': ps('T02'), Waiting: [], Done: ps('T10'), 'no-status': ps('T14') }, 'Today filter per column (D-476)');
});

test('fr_tsk_05_ac9_all_selected_tags_restrict_every_column', async () => {
  // D-518: the tag filter of AC-5 (every selected key) restricts every column, by status and by tag.
  const v = await views();
  const flatCols = (k: any) => Object.fromEntries(k.columns.map((c: any) => [c.id, paths(c.tasks)]));
  const prace = flatCols(v.kanban(input({ tagFilter: ['práce'] }), 'status', SPELLING));
  assert.deepEqual([prace['To do'], prace['In progress'], prace.Waiting, prace.Done], [ps('T01', 'T06', 'T18'), ps('T02'), [], []], '#práce by status');
  assert.deepEqual(prace['no-status'] ?? [], [], 'No status: no #práce task');
  const both = v.kanban(input({ tagFilter: ['práce', 'finance'] }), 'status', SPELLING);
  assert.deepEqual(both.columns.flatMap((c: any) => paths(c.tasks)), ps('T02'), '#práce and #finance by status: only T02, in In progress');
  assert.deepEqual(flatCols(both)['In progress'], ps('T02'));
  const byTag = v.kanban(input({ tagFilter: ['práce', 'finance'] }), 'tag', SPELLING);
  assert.deepEqual(byTag.columns.map((c: any) => c.id).sort(), ['#finance', '#práce'], 'one column per selected key, no No tag (contract §4)');
  for (const c of byTag.columns) assert.deepEqual(paths(c.tasks), ps('T02'), `${c.id}: only T02`);
});

// ------------------------------------------------------------------------------------------------ FR-TSK-09 AC-1, FR-TSK-01 AC-5

test('fr_tsk_09_ac1_exactly_t01_and_t02_are_overdue', async () => {
  const v = await views();
  const over = fixtureRows().filter((t) => v.isOverdue(t, TODAY)).map((t) => t.path);
  assert.deepEqual(over, ps('T01', 'T02'), 'not T03, T14 (today), T10, T11 (Done), T13 (Cancelled), T16, T17 (invalid due)');
});

test('fr_tsk_09_ac1_late_evening_utc_is_overdue_in_prague_only', async () => {
  const v = await views();
  const d = await doc();
  const at = Date.parse('2026-10-14T22:30:00Z');
  const prague = d.localDate(at, 'Europe/Prague');
  const la = d.localDate(at, 'America/Los_Angeles');
  assert.deepEqual([prague, la], ['2026-10-15', '2026-10-14'], 'today in each zone');
  const over = (today: string) => fixtureRows().filter((t) => v.isOverdue(t, today)).map((t) => t.path);
  assert.deepEqual(over(prague), ps('T01', 'T02', 'T03', 'T14'), 'Prague (00:30 on 15 Oct): T03 and T14 overdue');
  assert.deepEqual(over(la), ps('T01', 'T02'), 'Los Angeles (15:30 on 14 Oct): not');
});

test('fr_tsk_01_ac5_due_labels_never_shift_with_the_zone', async () => {
  const v = await views();
  const d = await doc();
  const t03 = fixtureRows().find((t) => t.path === P.T03)!;
  for (const [tz, start, end] of [['Europe/Prague', '2026-10-13T22:00:00Z', '2026-10-14T21:59:59Z'], ['America/Los_Angeles', '2026-10-14T07:00:00Z', '2026-10-15T06:59:59Z']] as const) {
    for (const at of [start, end]) {
      const today = d.localDate(Date.parse(at), tz);
      assert.equal(today, '2026-10-14', `${tz} ${at}: local 14 Oct`);
      assert.deepEqual(v.dueLabel(t03, today, 'cs'), { text: 'Today', tone: 'today' }, `${tz} ${at}: T03 due today`);
    }
  }
  const late = Date.parse('2026-10-14T22:30:00Z');
  assert.deepEqual(v.dueLabel(t03, d.localDate(late, 'Europe/Prague'), 'cs'), { text: `${short('2026-10-14', 'cs')} · Yesterday`, tone: 'overdue' }, 'Prague: one day overdue');
  assert.deepEqual(v.dueLabel(t03, d.localDate(late, 'America/Los_Angeles'), 'cs'), { text: 'Today', tone: 'today' }, 'Los Angeles: today');
  assert.equal(t03.due, '2026-10-14', 'the due date itself is never shifted');
});

test('fr_tsk_09_ac2_due_label_texts_and_tones', async () => {
  const v = await views();
  const r = Object.fromEntries(fixtureRows().map((t) => [t.path, t]));
  for (const region of ['cs', 'en-US']) {
    assert.deepEqual(v.dueLabel(r[P.T01], TODAY, region), { text: `${short('2026-10-09', region)} · 5 days overdue`, tone: 'overdue' }, `${region} T01`);
    assert.deepEqual(v.dueLabel(r[P.T02], TODAY, region), { text: `${short('2026-10-13', region)} · Yesterday`, tone: 'overdue' }, `${region} T02`);
    assert.deepEqual(v.dueLabel(r[P.T04], TODAY, region), { text: 'Tomorrow', tone: 'plain' }, `${region} T04`);
    assert.deepEqual(v.dueLabel(r[P.T05], TODAY, region), { text: short('2026-10-18', region), tone: 'plain' }, `${region} T05`);
    assert.deepEqual(v.dueLabel(r[P.T16], TODAY, region), { text: 'Invalid due date', tone: 'invalid' }, `${region} T16`);
    assert.deepEqual(v.dueLabel(r[P.T10], TODAY, region), { text: 'Completed today', tone: 'done' }, `${region} T10`);
    assert.deepEqual(v.dueLabel(r[P.T11], TODAY, region), { text: `Completed ${short('2026-10-05', region)}`, tone: 'done' }, `${region} T11`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-TSK-02 AC-1, AC-3 (state logic)

test('fr_tsk_02_ac1_states_of_the_shipped_statuses', async () => {
  const s = await load('@tegg/schema');
  assert.ok(s && typeof s.taskState === 'function', '@tegg/schema exports taskState (§2.2)');
  assert.deepEqual(STATUS_OPTIONS.map((o) => s!.taskState({ label: o.label, color: o.color, state: o.state })), ['open', 'in-progress', 'open', 'done', 'cancelled']);
  assert.equal(s!.taskState({ label: 'Blokováno', color: 'red', state: null }), 'open', 'absent state: Open (D-471)');
  assert.equal(s!.taskState({ label: 'Pozastaveno', color: 'red', state: 'blocked' }), 'open', 'unknown state: Open');
  const v = await views();
  const waiting = row({ path: 'Tasks/Čeká dlouho.md', status: 'Waiting', due: '2026-10-01' });
  assert.equal(v.isOverdue(waiting, TODAY), true, 'a Waiting task due 1 Oct is overdue');
  assert.deepEqual(sched(v.schedule(input())).week[0], ['2026-10-15', ps('T04', 'T19')], 'T04 (Waiting) is open, in This week');
});

test('fr_tsk_02_ac3_a_done_state_status_counts_as_done', async () => {
  const s = await load('@tegg/schema');
  assert.ok(s && typeof s.checkStatusOptions === 'function', '@tegg/schema exports checkStatusOptions (§2.2)');
  const opts = [...STATUS_OPTIONS, { label: 'Delegováno', color: 'teal', state: 'done' as const }];
  assert.equal(s!.taskState({ label: 'Delegováno', color: 'teal', state: 'done' }), 'done');
  assert.equal(s!.checkStatusOptions(opts.map((o) => ({ label: o.label, color: o.color, state: o.state }))), null, 'Open and Done remain');
  assert.equal(s!.checkStatusOptions(opts.filter((o) => o.state !== 'done').map((o) => ({ label: o.label, color: o.color, state: o.state })))?.reason, 'needDone');
  assert.equal(s!.checkStatusOptions(opts.filter((o) => o.state !== 'open').map((o) => ({ label: o.label, color: o.color, state: o.state })))?.reason, 'needOpen');
  const v = await views();
  const d2 = defs(opts);
  const deleg = row({ path: 'Tasks/Předáno.md', status: 'Delegováno', completed: '2026-10-14T10:00:00+02:00' }, opts);
  const tasks = [...fixtureRows(), deleg];
  assert.ok(sched(v.schedule(input({ tasks, defs: d2 }))).done.includes('Tasks/Předáno.md'), 'in Done');
  const k = v.kanban(input({ tasks, defs: d2 }), 'status', SPELLING);
  assert.deepEqual(k.columns.map((c: any) => c.id), ['To do', 'In progress', 'Waiting', 'Done', 'Delegováno', 'no-status'], 'a Delegováno column after Done');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-01 AC-1 (TS twin)

test('fr_tsk_01_ac1_the_fake_core_twin_returns_t01_to_t19', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join, relative, resolve } = await import('node:path');
  const files: Record<string, string> = {};
  for (const [dir, prefix] of [['../../tests/fixtures/vaults/tasks', ''], ['../../tests/fixtures/vaults/new-empty/.tegg', '.tegg/']] as const) {
    const abs = resolve(import.meta.dirname, dir);
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files[(prefix + relative(abs, p)).normalize('NFC')] = readFileSync(p, 'utf8'); } };
    walk(abs);
  }
  delete files['README.md'];
  const twin = await load('../ui/test/fake-tasks.ts');
  assert.ok(twin && typeof twin.taskList === 'function', 'app/ui/test/fake-tasks.ts exports taskList (ms5-tasks §7)');
  const got = twin!.taskList(files);
  const want = fixtureRows();
  assert.deepEqual(got.tasks.map((t: any) => t.path).sort(), want.map((t) => t.path).sort(), 'exactly T01…T19, the same rule as the core (R44)');
  const pick = (t: any) => [t.path, t.status, t.state, t.statusKnown, t.priority, t.priorityRank, t.dueRaw, t.due, t.completed, t.tags];
  const byPath = new Map(got.tasks.map((t: any) => [t.path, t]));
  for (const w of want) assert.deepEqual(pick(byPath.get(w.path)), pick(w), `${w.path}: R44 fields`);
  assert.deepEqual(got.defs.statuses.map((s: any) => [s.label, s.state]), STATUS_OPTIONS.map((s) => [s.label, s.state]), 'the shipped statuses and states');
});
