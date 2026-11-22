// MS5 slice 5A-1, L1: the one bucketing function of docs/contracts/ms5-tasks.md §4 (`app/ui/src/tasks/views.ts`) on
// the fixture's task rows (tasks-data.ts, R44). R41 Schedule sections, R42 Kanban columns, R44 overdue and labels:
// FR-TSK-01 AC-1 (the fake core's TS twin, §7), AC-5 (dates never shift), FR-TSK-02 AC-1, AC-3 (state logic), FR-TSK-03 AC-1, FR-TSK-04 AC-2 (TZ, W),
// AC-4 (W), AC-5, FR-TSK-05 AC-1, AC-3, AC-9, FR-TSK-09 AC-1 (TZ). Region `cs` (week from Monday) and `en-US` (from
// Sunday), Europe/Prague and America/Los_Angeles. Written from docs/acceptance/tasks.md and the contract only (D-61).
// Modules load inside the tests (TS-I1).
//
// Slice Q2-T (AC-Test-Change, D-1912; docs/acceptance/views.md part three, rows FR-TSK-04 AC-2, AC-8 …, AC-4, AC-5,
// FR-TSK-05 AC-1, AC-3, AC-9): `views.ts` loses `schedule`, `kanban` and `counts` (v1-views §28.2); the core's `group`
// draws Schedule and Kanban (§24.4, L4 and L5). The R41 sections become R203's period lanes, bucketed in TS by
// `queries/board/period.ts` (§28.1); the tag filter's options are `views/tagFilter.ts`'s `tagOptions` over the tab's shown
// cards, the done lane included (AP-1545). The date-filter tests (FR-TSK-04 AC-4, FR-TSK-05 AC-9's date part) are
// superseded (D-1779) and removed; so are the L1 tests of the removed Kanban and order functions (FR-TSK-03 AC-1,
// FR-TSK-05 AC-1, AC-3, AC-9): the order is the view's sort and the lanes the core's (`ac_views_tasks.rs`, L5).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { P, STATUS_OPTIONS, defs, fixtureRows, row, type Key } from './tasks-data';

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
  assert.ok(m && typeof m.isOverdue === 'function' && typeof m.dueLabel === 'function', 'ui/src/tasks/views.ts exports isOverdue and dueLabel (kept, v1-views §23.3)');
  return m!;
}
async function period(): Promise<Mod> {
  const m = await load('../ui/src/queries/board/period.ts');
  assert.ok(m && typeof m.bounds === 'function' && typeof m.periodOf === 'function', 'ui/src/queries/board/period.ts exports bounds and periodOf (v1-views §28.1)');
  return m!;
}
async function tagFilter(): Promise<Mod> {
  const m = await load('../ui/src/views/tagFilter.ts');
  assert.ok(m && typeof m.tagOptions === 'function' && typeof m.keepRow === 'function', 'ui/src/views/tagFilter.ts exports tagOptions and keepRow (v1-views §28.1)');
  return m!;
}
async function doc(): Promise<Mod> {
  const m = await load('@tegg/doc');
  assert.ok(m, '@tegg/doc loads');
  return m!;
}

const TODAY = '2026-10-14';
const ps = (...k: Key[]) => k.map((x) => P[x]);
const sorted = (xs: string[]) => [...xs].map((x) => x.normalize('NFC')).sort();
function short(date: string, region: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(region, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}
/** R203 over the open fixture rows (Done-state rows go to the done lane, Cancelled ones are filtered out). */
async function lanes(today: string, weekStart: number) {
  const pm = await period();
  const b = pm.bounds({ today, weekStart });
  const out: Record<string, string[]> = { today: [], week: [], later: [], none: [] };
  const days: Record<string, string[]> = Object.fromEntries((b.days as string[]).map((d) => [d, [] as string[]]));
  for (const r of fixtureRows().filter((t: any) => t.state !== 'done' && t.state !== 'cancelled')) {
    const at = pm.periodOf((r as any).dueRaw ?? (r as any).due ?? null, 'date', b);
    out[at.lane].push(r.path);
    if (at.day) (days[at.day] ??= []).push(r.path);
  }
  return { b, lanes: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, sorted(v)])), days: Object.fromEntries(Object.entries(days).map(([k, v]) => [k, sorted(v)])) };
}
/** The rows the Schedule tab shows (open ones and the done lane's T10, T12), as `{ path, tags }`. */
const scheduleRows = () => fixtureRows().filter((t: any) => t.state !== 'cancelled' && t.path !== P.T11).map((t: any) => ({ path: t.path, tags: t.tags as string[] }));

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-2 (R203)

test('fr_tsk_04_ac2_sections_on_the_fixture_cs', async () => {
  const { b, lanes: l, days } = await lanes(TODAY, 1);
  assert.deepEqual(b.days, ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'], 'This week: every day Thu 15 – Sun 18 (AP-1536)');
  assert.deepEqual(l, {
    today: sorted(ps('T01', 'T02', 'T03', 'T14')), week: sorted(ps('T04', 'T19', 'T15', 'T05')), later: sorted(ps('T06', 'T07')), none: sorted(ps('T08', 'T09', 'T17', 'T16', 'T18')),
  }, 'R203 lanes, region cs');
  assert.deepEqual(days, { '2026-10-15': sorted(ps('T04', 'T19')), '2026-10-16': sorted(ps('T15')), '2026-10-17': [], '2026-10-18': sorted(ps('T05')) }, 'day groups (Sat 17 empty)');
});

test('fr_tsk_04_ac2_sections_on_the_fixture_en_us', async () => {
  const { b, lanes: l } = await lanes(TODAY, 7);
  assert.deepEqual(b.days, ['2026-10-15', '2026-10-16', '2026-10-17'], 'week Sunday–Saturday: Thu 15 – Sat 17');
  assert.deepEqual(l.later, sorted(ps('T05', 'T06', 'T07')), 'Later: T05 (Sun 18), T06, T07');
});

test('fr_tsk_04_ac2_on_sunday_this_week_is_empty', async () => {
  const { b, lanes: l } = await lanes('2026-10-18', 1);
  assert.deepEqual(b.days, [], 'no day of This week on the last day of the week');
  assert.deepEqual(l.week, [], 'This week is empty');
  assert.deepEqual(l.today, sorted(ps('T01', 'T02', 'T03', 'T14', 'T04', 'T19', 'T15', 'T05')), 'Today & overdue: T05 due today and the earlier ones');
  assert.deepEqual(l.later, sorted(ps('T06', 'T07')), 'T06 (19 Oct) is in Later');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-5 (AP-1545)

test('fr_tsk_04_ac5_tag_filter_lists_and_restricts', async () => {
  const tf = await tagFilter();
  const opts = tf.tagOptions(scheduleRows(), [], (k: string) => k, new Intl.Collator('cs'));
  assert.deepEqual(opts.map((t: any) => [t.key, t.count]), [['doma', 4], ['práce', 4], ['finance', 2], ['čtení', 1], ['rodina', 1]],
    'count descending, ties by collation (D-122); Doma and NFD doma are doma; inline #rodina counts; T10 in the done lane counts for finance');
  const doma = scheduleRows().filter((r) => tf.keepRow(r, ['doma'])).map((r) => r.path);
  assert.deepEqual(sorted(doma), sorted(ps('T03', 'T04', 'T19', 'T05')), '#doma: T03, T04, T19, T05');
});

test('fr_tsk_04_ac5_selected_tags_must_all_match', async () => {
  const tf = await tagFilter();
  const keep = (sel: string[]) => sorted(scheduleRows().filter((r) => tf.keepRow(r, sel)).map((r) => r.path));
  assert.deepEqual(keep(['práce']), sorted(ps('T01', 'T02', 'T06', 'T18')), '#práce: T01, T02, T06, T18');
  assert.deepEqual(keep(['práce', 'finance']), sorted(ps('T02')), '#práce and #finance: only T02 (all of them, D-518)');
  assert.deepEqual(keep(['doma', 'finance']), [], 'no task has both #doma and #finance');
});

test('fr_tsk_04_ac5_counts_tell_what_each_tag_would_leave', async () => {
  const tf = await tagFilter();
  const c = (sel: string[]) => tf.tagOptions(scheduleRows(), sel, (k: string) => k, new Intl.Collator('cs')).map((t: any) => [t.key, t.count]);
  assert.deepEqual(c(['práce']), [['práce', 4], ['finance', 1], ['rodina', 1], ['čtení', 0], ['doma', 0]], 'with #práce: práce 4, finance 1, rodina 1, čtení 0, doma 0');
  assert.deepEqual(c(['práce', 'finance']), [['finance', 1], ['práce', 1], ['čtení', 0], ['doma', 0], ['rodina', 0]], 'with #práce and #finance: only T02 is left for either');
  assert.deepEqual(c(['zahrádka']), [['čtení', 0], ['doma', 0], ['finance', 0], ['práce', 0], ['rodina', 0], ['zahrádka', 0]], 'a selected key no task has is listed with 0');
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
  const { days } = await lanes(TODAY, 1);
  assert.deepEqual(days['2026-10-15'], sorted(ps('T04', 'T19')), 'T04 (Waiting) is open, in This week (R203)');
});

test('fr_tsk_02_ac3_a_done_state_status_counts_as_done', async () => {
  const s = await load('@tegg/schema');
  assert.ok(s && typeof s.checkStatusOptions === 'function', '@tegg/schema exports checkStatusOptions (§2.2)');
  const opts = [...STATUS_OPTIONS, { label: 'Delegováno', color: 'teal', state: 'done' as const }];
  assert.equal(s!.taskState({ label: 'Delegováno', color: 'teal', state: 'done' }), 'done');
  assert.equal(s!.checkStatusOptions(opts.map((o) => ({ label: o.label, color: o.color, state: o.state }))), null, 'Open and Done remain');
  assert.equal(s!.checkStatusOptions(opts.filter((o) => o.state !== 'done').map((o) => ({ label: o.label, color: o.color, state: o.state })))?.reason, 'needDone');
  assert.equal(s!.checkStatusOptions(opts.filter((o) => o.state !== 'open').map((o) => ({ label: o.label, color: o.color, state: o.state })))?.reason, 'needOpen');
  // Slice Q2-T: the done lane and the Kanban lanes are the core's (v1-views §24.4); a Done-state option is Done for R44.
  const deleg = row({ path: 'Tasks/Předáno.md', status: 'Delegováno', completed: '2026-10-14T10:00:00+02:00' }, opts);
  assert.equal((deleg as any).state, 'done', 'Předáno counts as Done (R44)');
  void defs;
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
