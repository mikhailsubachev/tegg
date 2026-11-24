// Slice Q2-T, L1: the pure models of the Tasks views (docs/contracts/v1-views.md §28.1, §28.2, §30.3):
// `queries/board/period.ts` (bounds, R203's bucketing table in both regions and zones, the done lane's window, drop
// dates, keyboard targets, pre-fills; CP-22, D-1914), `views/tagFilter.ts` (options, counts, keys, all-of), `views/
// allSort.ts` (multi-level sort on `All <plural>`), `views/model.ts` (period choices, states, done-lane offer),
// `views/uiState.ts` (`adoptTasksUi`), `tasks/views.ts` (`summaryWeek`). Criteria: FR-TSK-04 AC-22 (the summary),
// AC-23 (the bucketing table, L1 part, tied to the L3 corpus tests/fixtures/queries-files/expected-views-tasks.json),
// AC-24, AC-25 (drop dates), AC-28 (option list), FR-TSK-05 AC-22 (keyboard targets), FR-QRY-07 AC-30, FR-QRY-01 AC-17
// (period choices), AC-20 (`All` sort model), FR-QRY-02 AC-9 (the editor's state operators), FR-QRY-08 AC-3
// (pre-fills), FR-STO-07 AC-12 (`adoptTasksUi`), FR-FMT-12 AC-14 (NFC keys). Data: app/test/tasks-data.ts (the tasks
// fixture's rows, R44), app/test/views-data.ts (Book). Written from the ACs and the contract only (D-61). Modules load
// inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { P, fixtureRows } from './tasks-data';
import { BOOK } from './views-data';

type Mod = Record<string, any>;
async function load(path: string, what: string): Promise<Mod> {
  let m: Mod | null = null;
  try { m = (await import(/* @vite-ignore */ path)) as Mod; } catch { m = null; }
  assert.ok(m, `${what} loads (v1-views §28)`);
  return m!;
}
/** Asserts that the module exports every named function (a missing one is an assertion failure, TS-I1). */
function has(m: Mod, names: string[], what: string): Mod {
  for (const n of names) assert.equal(typeof m[n], 'function', `${what} exports ${n} (v1-views §28)`);
  return m;
}
const period = () => load('../ui/src/queries/board/period.ts', 'ui/src/queries/board/period.ts');
const tagFilter = () => load('../ui/src/views/tagFilter.ts', 'ui/src/views/tagFilter.ts');
const allSort = () => load('../ui/src/views/allSort.ts', 'ui/src/views/allSort.ts');
const model = () => load('../ui/src/views/model.ts', 'ui/src/views/model.ts');
const uiState = () => load('../ui/src/views/uiState.ts', 'ui/src/views/uiState.ts');
const taskViews = () => load('../ui/src/tasks/views.ts', 'ui/src/tasks/views.ts');

const REPO = resolve(import.meta.dirname, '../..');
const CORPUS = JSON.parse(readFileSync(resolve(REPO, 'tests/fixtures/queries-files/expected-views-tasks.json'), 'utf8'));
const NFD = (s: string) => s.normalize('NFD');
const B = (today: string, weekStart: number) => ({ today, weekStart });

// The Task and Projekt types as TypeDto (new-empty's task.yml, the tasks fixture's projekt.yml).
const attr = (key: string, name: string, type: string, options: { label: string; color: string; state: string | null }[] = []) => ({
  key, name, type, supported: true, readOnlyReason: null, default: null, required: false, options, to: null, multiple: false, description: null, builtIn: false,
});
const typeOf = (o: Record<string, unknown>): any => ({
  system: false, invalid: false, exists: true, version: { mtimeNs: '1', size: 1, hash: 'h' }, state: 'ok', error: null, declaredVersion: 1n, description: null, review: 'off',
  previewIgnored: [], hidden: [], columns: null, columnsIgnored: [], columnsUnreadable: false, embed: 'full', embedRaw: null, template: null, views: null, viewsUnreadable: false, ...o,
});
const TASK = typeOf({
  key: 'task', name: 'Task', plural: 'Tasks', folder: 'Tasks', icon: 'check-square', color: 'blue', system: true, preview: ['status', 'priority', 'due'], views: ['Schedule', 'Kanban', 'Čeká na ostatní'],
  attributes: [
    attr('status', 'Status', 'select', [
      { label: 'To do', color: 'gray', state: 'open' }, { label: 'In progress', color: 'blue', state: 'in-progress' }, { label: 'Waiting', color: 'yellow', state: 'open' },
      { label: 'Done', color: 'green', state: 'done' }, { label: 'Cancelled', color: 'red', state: 'cancelled' },
    ]),
    attr('priority', 'Priority', 'select', [{ label: 'High', color: 'red', state: null }, { label: 'Medium', color: 'orange', state: null }, { label: 'Low', color: 'blue', state: null }, { label: 'None', color: 'gray', state: null }]),
    attr('due', 'Due date', 'date'), attr('completed', 'Completed', 'date-time'), attr('recurrence', 'Recurrence', 'recurrence'),
  ],
});
const PROJEKT = typeOf({
  key: 'projekt', name: 'Projekt', plural: 'Projekty', folder: 'Projekty', icon: 'folder', color: 'orange', preview: ['status', 'due'],
  attributes: [attr('status', 'Status', 'select', [{ label: 'To do', color: 'gray', state: null }, { label: 'Done', color: 'green', state: null }]), attr('due', 'Due date', 'date')],
});

/** Lane id → periodOf's lane name. */
const LANE: Record<string, string> = { 'period:today': 'today', 'period:week': 'week', 'period:later': 'later', none: 'none' };

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-23

test('fr_tsk_04_ac23_schedule_lanes', async () => {
  const p = has(await period(), ['bounds', 'periodOf', 'dayHeading'], 'queries/board/period.ts');
  assert.deepEqual(p.bounds(B('2026-10-14', 1)), { today: '2026-10-14', weekFirst: '2026-10-12', weekLast: '2026-10-18', afterWeek: '2026-10-19', days: ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'] },
    'cs (week Monday–Sunday): tomorrow … Sunday 18; Later from Monday 19');
  assert.deepEqual(p.bounds(B('2026-10-14', 0)), { today: '2026-10-14', weekFirst: '2026-10-11', weekLast: '2026-10-17', afterWeek: '2026-10-18', days: ['2026-10-15', '2026-10-16', '2026-10-17'] },
    '(W) en-US (week Sunday–Saturday): Thursday 15 … Saturday 17; Later from Sunday 18');
  assert.deepEqual(p.bounds(B('2026-10-18', 1)), { today: '2026-10-18', weekFirst: '2026-10-12', weekLast: '2026-10-18', afterWeek: '2026-10-19', days: [] },
    'on the week\'s last day: no day groups (no This week lane)');
  // The bucketing table against the L3 corpus: every Schedule run's period lanes (the done lane is the core's).
  const due = new Map<string, string | null>(fixtureRows().map((r: any) => [r.path, r.dueRaw]));
  const bad: string[] = [];
  for (const g of CORPUS.groups.filter((x: any) => x.query === 'Schedule')) {
    const b = p.bounds(B(g.env.today, g.env.weekStart));
    for (const lane of g.lanes.filter((l: any) => l.id !== 'done')) {
      const days = new Map<string, string>();
      for (const d of lane.days) for (const path of d.paths) days.set(path, d.date);
      for (const path of lane.paths) {
        const got = p.periodOf(due.get(path) ?? null, 'date', b, g.env.zone);
        const want = { lane: LANE[lane.id], day: days.get(path) ?? null };
        if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${g.note}: ${path} ${JSON.stringify(due.get(path))} → ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      }
    }
  }
  assert.deepEqual(bad, [], 'periodOf gives R208\'s lanes and day groups (corpus groups of Schedule: cs, en-US, LA, Sunday, after midnight)');
  // Odd values are no date (tasks.md AP-414): an impossible date, a date-time on a Date attribute, text, empty, null.
  const b = p.bounds(B('2026-10-14', 1));
  for (const v of ['2026-02-30', '2026-10-15T09:00:00+02:00', 'zítra', '', null, 20261015, ['2026-10-15']]) {
    assert.deepEqual(p.periodOf(v, 'date', b), { lane: 'none', day: null }, `${JSON.stringify(v)}: Not scheduled`);
  }
  // Date-time keys: the local date in the zone (D-104).
  assert.deepEqual(p.periodOf('2026-10-14T23:30:00+02:00', 'dateTime', b, 'Europe/Prague'), { lane: 'today', day: null }, 'late on the 14th in Prague: today');
  assert.deepEqual(p.periodOf('2026-10-15T01:30:00+02:00', 'dateTime', b, 'Europe/Prague'), { lane: 'week', day: '2026-10-15' }, 'early on the 15th in Prague: čtvrtek 15.');
  assert.deepEqual(p.periodOf('2026-10-15T01:30:00+02:00', 'dateTime', b, 'America/Los_Angeles'), { lane: 'today', day: null }, 'the same instant in Los Angeles is the 14th');
  assert.deepEqual(p.periodOf('2026-10-19T08:00:00Z', 'dateTime', b, 'Europe/Prague'), { lane: 'later', day: null }, 'Monday 19: Later');
  assert.deepEqual(p.periodOf('nikdy', 'dateTime', b, 'Europe/Prague'), { lane: 'none', day: null }, 'an unreadable instant: no value');
  // Day headings: region-formatted, never from the catalog.
  assert.equal(p.dayHeading('2026-10-15', 'cs'), 'čtvrtek 15.', 'cs heading');
  assert.equal(p.dayHeading('2026-10-15', 'en-US'), 'Thursday 15', 'en-US heading');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-24

test('fr_tsk_04_ac24_the_done_lane', async () => {
  const p = await period();
  const T10 = { completed: '2026-10-14T09:30:00+02:00', modified: '2026-10-14T09:30:00+02:00' };
  const T11 = { completed: '2026-10-05T18:00:00+02:00', modified: '2026-10-01T09:00:00+02:00' };
  const T12 = { completed: null, modified: '2026-10-10T08:00:00+02:00' };
  assert.deepEqual([p.completedWithin(T10, '2026-10-14', 7, 'Europe/Prague'), p.completedWithin(T11, '2026-10-14', 7, 'Europe/Prague'), p.completedWithin(T12, '2026-10-14', 7, 'Europe/Prague')],
    [true, false, true], 'on 14 Oct (8…14 Oct): T10 and T12 (by modified), not T11');
  assert.equal(p.completedWithin(T12, '2026-10-16', 7, 'Europe/Prague'), true, '16 Oct: T12 (10 Oct) still within');
  assert.equal(p.completedWithin(T12, '2026-10-17', 7, 'Europe/Prague'), false, '17 Oct: 11 Oct is the first day; T12 leaves');
  assert.equal(p.completedWithin(T11, '2026-10-14', 30, 'Europe/Prague'), true, 'within_days 30: T11 back');
  const edge = { completed: '2026-10-08T05:00:00+02:00', modified: '2026-10-08T05:00:00+02:00' };
  assert.deepEqual([p.completedWithin(edge, '2026-10-14', 7, 'Europe/Prague'), p.completedWithin(edge, '2026-10-14', 7, 'America/Los_Angeles')], [true, false],
    'the completed day is the local date in the zone (8 Oct in Prague, 7 Oct in Los Angeles)');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-25

test('fr_tsk_04_ac25_period_drags_write_due_once', async () => {
  const p = await period();
  const cs = p.bounds(B('2026-10-14', 1));
  const us = p.bounds(B('2026-10-14', 0));
  assert.equal(p.dropFor('period:today', null, cs), '2026-10-14', 'Today & overdue: today');
  assert.equal(p.dropFor('period:week', '2026-10-16', cs), '2026-10-16', 'a day group: its date (pátek 16.)');
  assert.equal(p.dropFor('period:week', '2026-10-15', cs), '2026-10-15', 'čtvrtek 15.');
  assert.equal(p.dropFor('period:later', null, cs), '2026-10-19', 'Later in cs: Monday 19');
  assert.equal(p.dropFor('period:later', null, us), '2026-10-18', 'Later in en-US: Sunday 18');
  assert.equal(p.dropFor('none', null, cs), null, 'Not scheduled: clears the key');
  // A drop on the week lane outside its day groups targets the first day group (§29.3).
  assert.equal(p.dropFor('period:week', null, cs), '2026-10-15', 'the week lane\'s heading: its first day');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-05 AC-22 (targets)

test('fr_tsk_05_ac22_keyboard', async () => {
  const p = await period();
  const g = CORPUS.groups.find((x: any) => x.query === 'Schedule' && x.env.locale === 'cs' && x.env.today === '2026-10-14' && x.env.zone === 'Europe/Prague');
  const group = { key: 'due', kind: 'period', dateTime: false, name: 'Due date', lanes: g.lanes.map((l: any) => ({ ...l, kind: l.id.startsWith('period:') ? 'period' : l.id, value: null, label: '', color: null, target: null, excluded: false, cards: [] })) };
  const flat = (t: any) => [t.lane, t.day ?? null];
  assert.deepEqual(p.targets(group).map(flat), [['period:today', null], ['period:week', '2026-10-15'], ['period:week', '2026-10-16'], ['period:week', '2026-10-17'], ['period:week', '2026-10-18'], ['period:later', null], ['none', null], ['done', null]],
    'keyboard order: today, each day group, later, none, done');
  assert.deepEqual(flat(p.neighbourTarget(group, { lane: 'period:today', day: null }, 1)), ['period:week', '2026-10-15'], 'Move card to next lane from Today & overdue: čtvrtek 15.');
  assert.deepEqual(flat(p.neighbourTarget(group, { lane: 'period:week', day: '2026-10-18' }, 1)), ['period:later', null], 'from neděle 18.: Later');
  assert.deepEqual(flat(p.neighbourTarget(group, { lane: 'period:later', day: null }, -1)), ['period:week', '2026-10-18'], 'previous from Later: neděle 18.');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-28

/** Schedule's rows on the overlay at the clock (17: T13 cancelled and T11 outside the done lane's 7 days are not rows). */
function scheduleRows(): { path: string; tags: string[] }[] {
  const out = fixtureRows().filter((r: any) => r.path !== P.T13 && r.path !== P.T11).map((r: any) => ({ path: r.path, tags: r.tags }));
  assert.equal(out.length, 17, 'setup check: 17 rows');
  return out;
}
const opts = (list: { key: string; label: string; count: number }[]) => list.map((o) => `#${o.label} ${o.count}`);

test('fr_tsk_04_ac28_text_and_tag_filters', async () => {
  const tf = await tagFilter();
  const col = new Intl.Collator('cs');
  const rows = scheduleRows();
  assert.deepEqual(opts(tf.tagOptions(rows, [], (k: string) => k, col)), ['#doma 4', '#práce 4', '#finance 2', '#čtení 1', '#rodina 1'],
    'R208\'s options (T05 `Doma` and T19 NFD `doma` are `doma`; T18\'s inline tag; T10 in the done lane counts for finance): most first, then collation');
  const withPrace = tf.tagOptions(rows, ['práce'], (k: string) => k, col) as { key: string; count: number }[];
  const c = (k: string) => withPrace.find((o) => o.key === k)?.count;
  assert.deepEqual([c('práce'), c('finance'), c('rodina')], [4, 1, 1], 'counts are the rows left with the tag added to the selection');
  assert.deepEqual(rows.filter((r) => tf.keepRow(r, ['práce'])).map((r) => r.path), [P.T01, P.T02, P.T06, P.T18], '#práce leaves four rows');
  assert.deepEqual(rows.filter((r) => tf.keepRow(r, ['práce', 'finance'])).map((r) => r.path), [P.T02], 'all of #práce and #finance: Poslat rozpočet');
  const gone = tf.tagOptions(rows, ['zahrada'], (k: string) => k, col) as { key: string; count: number }[];
  assert.deepEqual(gone.find((o) => o.key === 'zahrada')?.count, 0, 'a selected tag no longer on any row stays with 0');
  assert.equal(tf.tagFilterKey({ kind: 'tab', typeKey: 'task', name: 'Schedule' }), 'tab:task/schedule', 'stored as tagFilter["tab:task/schedule"]');
  assert.equal(tf.tagFilterKey({ kind: 'all', typeKey: 'task' }), 'all:task', 'All Tasks');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-30

test('fr_qry_07_ac30_tag_filter_on_every_tab', async () => {
  const tf = await tagFilter();
  const col = new Intl.Collator('cs');
  const book = (title: string, tags: string[] = []) => ({ path: `Books/${title}.md`, tags });
  const all = [
    book('Dům u řeky', ['doporučené']), book('Mapa bez severu', ['doporučené']), book('Ostrov bez jména', ['odloženo']), book('Světla přístavu', ['večerní']),
    book('Kniha o horách'), book('Noční vlak'), book('Účetní ze Žižkova'), book('Cizí přístavy'), book('Čarovná mapa'), book('Čtvrtá zima'), book('Kniha o čaji'),
    book('Sto zimních dní'), book('Šest cest k moři'), book('Tiché město'), book('Zahrada v dešti'), book('Zápisník z Tater'), book('Písně z dálky'),
  ];
  assert.deepEqual(opts(tf.tagOptions(all, [], (k: string) => k, col)), ['#doporučené 2', '#odloženo 1', '#večerní 1'], 'All Books: R208\'s options');
  assert.deepEqual(all.filter((r) => tf.keepRow(r, ['doporučené'])).map((r) => r.path), ['Books/Dům u řeky.md', 'Books/Mapa bez severu.md'], '#doporučené leaves two rows');
  const roz = all.filter((r) => ['Noční vlak', 'Účetní ze Žižkova', 'Světla přístavu', 'Dům u řeky', 'Kniha o horách'].some((t) => r.path === `Books/${t}.md`));
  assert.deepEqual(opts(tf.tagOptions(roz, [], (k: string) => k, col)), ['#doporučené 1', '#večerní 1'], 'Rozečtené: the tags of its 5 cards (no #odloženo)');
  assert.equal(tf.tagFilterKey({ kind: 'all', typeKey: 'book' }), 'all:book', 'tagFilter["all:book"]');
  assert.equal(tf.tagFilterKey({ kind: 'tab', typeKey: 'book', name: 'Rozečtené' }), 'tab:book/rozečtené', 'tagFilter["tab:book/rozečtené"]');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-14

test('fr_fmt_12_ac14_q2t_names_and_tags_are_nfc', async () => {
  const tf = await tagFilter();
  assert.equal(tf.tagFilterKey({ kind: 'tab', typeKey: 'book', name: NFD('Rozečtené') }), 'tab:book/rozečtené', 'an NFD name gives the NFC key');
  assert.equal(tf.tagFilterKey({ kind: 'tab', typeKey: 'task', name: NFD('Čeká na ostatní') }), 'tab:task/čeká na ostatní', 'lower case, NFC');
  const rows = scheduleRows();
  const nfdOpts = tf.tagOptions(rows, [NFD('práce')], (k: string) => k, new Intl.Collator('cs')) as { key: string; count: number }[];
  assert.equal(nfdOpts.filter((o) => o.key.normalize('NFC') === 'práce').length, 1, 'práce typed in NFD is the same option (one chip)');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-17

test('fr_qry_01_ac17_period_grouping_for_any_date', async () => {
  const m = has(await model(), ['periodChoices', 'doneLaneOffered', 'newViewDef', 'hasViews'], 'views/model.ts');
  assert.deepEqual(m.periodChoices(PROJEKT), ['due', 'created', 'modified'], 'Projekt: Due date, Created, Modified · by period');
  assert.deepEqual(m.periodChoices(TASK), ['due', 'completed', 'created', 'modified'], 'Task: Date and Date-time attributes in schema order, then created, modified');
  assert.equal(m.doneLaneOffered([PROJEKT]), false, 'no done lane for Projekt (no states)');
  assert.equal(m.doneLaneOffered([TASK]), true, 'Task: status carries states with a Done option');
  assert.equal(m.doneLaneOffered([TASK, PROJEKT]), false, 'every type must qualify');
  // New view › Wall: no columns, no period, no done lane (D-1910). Slice Q3 (AC-Test-Change, D-2196; D-2172): Wall
  // replaces Board.
  const board = m.newViewDef(BOOK, 'wall', [BOOK]);
  assert.deepEqual([board.view, board.columns, board.groupPeriod, board.doneLane], ['wall', [], false, null], 'a new Wall writes no columns');
  assert.equal(m.hasViews('task', TASK), true, 'Task has views (D-1787\'s exception ends)');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-02 AC-9

test('fr_qry_02_ac9_state_operators', async () => {
  const m = has(await model(), ['stateOps', 'carriesStates'], 'views/model.ts');
  assert.deepEqual(m.stateOps(TASK, 'status'), ['state_is', 'state_is_not'], 'Task status carries states');
  assert.deepEqual(m.stateOps(TASK, 'priority'), [], 'priority: no states');
  assert.deepEqual(m.stateOps(PROJEKT, 'status'), [], 'Projekt status has no states');
  assert.deepEqual(m.stateOps(BOOK, 'status'), [], 'Book status has no states');
  assert.deepEqual([m.carriesStates(TASK, 'status'), m.carriesStates(PROJEKT, 'status'), m.carriesStates(TASK, 'due')], [true, false, false], 'carriesStates');
  const renamed = { ...TASK, attributes: TASK.attributes.map((a: any) => a.key !== 'status' ? a : { ...a, options: a.options.map((o: any) => o.label === 'Cancelled' ? { ...o, label: 'Zrušeno' } : o) }) };
  assert.deepEqual(m.stateOps(renamed, 'status'), ['state_is', 'state_is_not'], 'a renamed option keeps its state');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-20

test('fr_qry_01_ac20_multi_level_sort_on_all_tab', async () => {
  const s = await allSort();
  const row = (title: string, status: string | null) => ({ path: `Books/${title}.md`, id: null, title, created: '2026-11-01T09:00:00+01:00', modified: '2026-11-01T09:00:00+01:00', values: status === null ? {} : { status }, links: [], typeSingle: true, tags: [] });
  const want = [
    ['Dům u řeky', 'To read'], ['Kniha o horách', 'To read'], ['Ostrov bez jména', 'To read'],
    ['Noční vlak', 'Reading'], ['Světla přístavu', 'Reading'], ['Účetní ze Žižkova', 'Reading'],
    ['Cizí přístavy', 'Read'], ['Čarovná mapa', 'Read'], ['Čtvrtá zima', 'Read'], ['Kniha o čaji', 'Read'], ['Mapa bez severu', 'Read'], ['Sto zimních dní', 'Read'],
    ['Šest cest k moři', 'Read'], ['Tiché město', 'Read'], ['Zahrada v dešti', 'Read'],
    ['Zápisník z Tater', 'Rozečteno'], ['Písně z dálky', null],
  ] as [string, string | null][];
  const shuffled = [...want].reverse().map(([t, st]) => row(t, st));
  const out = s.sortTypeRows(shuffled, [{ by: 'status', order: 'asc' }, { by: 'title', order: 'asc' }], BOOK, new Intl.Collator('cs')) as { title: string }[];
  assert.deepEqual(out.map((r) => r.title), want.map(([t]) => t), 'R208: Status ↑ (option order, then unknown values, then empty), then Title ↑ (cs)');
  assert.deepEqual(s.levelsOf({ column: 'status', dir: 'asc' }), [{ by: 'status', order: 'asc' }], 'a 0.4.x typeSort value reads as one level');
  assert.deepEqual(s.levelsOf([{ by: 'status', order: 'asc' }, { by: 'title', order: 'desc' }]), [{ by: 'status', order: 'asc' }, { by: 'title', order: 'desc' }], 'a list is the levels');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-08 AC-3

test('fr_qry_08_ac3_period_lanes_pre_fill_dates', async () => {
  const p = await period();
  const cs = p.bounds(B('2026-10-14', 1));
  const us = p.bounds(B('2026-10-14', 0));
  assert.deepEqual(['period:today', 'period:week', 'period:later', 'none'].map((l) => p.prefillFor(l, cs)), ['2026-10-14', '2026-10-18', '2026-10-19', null], 'cs: today, the week\'s last day, the first day after, nothing');
  assert.deepEqual(['period:week', 'period:later'].map((l) => p.prefillFor(l, us)), ['2026-10-17', '2026-10-18'], 'en-US: 17 Oct, 18 Oct');
  assert.equal(p.prefillFor('done', cs) ?? null, null, 'the done lane has no tile');
});

// ------------------------------------------------------------------------------------------------ FR-STO-07 AC-12

test('fr_sto_07_ac12_tag_filters_and_sorts_are_machine_local', async () => {
  const u = has(await uiState(), ['adoptTasksUi'], 'views/uiState.ts');
  const old = { view: 'kanban', groupBy: 'tag', dateFilter: 'today', tags: ['práce'], doneExpanded: true };
  const ui = { version: 1, theme: 'system', sidebarOpen: true, propertiesOpen: true, otherPropertiesOpen: false, typeSort: {}, tasks: old };
  const out = u.adoptTasksUi(structuredClone(ui));
  assert.equal(out.typeViews?.lastTab?.task, 'Kanban', 'last view kanban → typeViews.lastTab.task = Kanban');
  assert.ok((out.usageFolded?.['tab:task/schedule'] ?? []).includes('!done'), 'Done expanded → the Schedule tab\'s done lane unfolded (`!done`)');
  assert.deepEqual(out.tasks, old, 'the old keys stay in the file unchanged');
  assert.equal(out.tagFilter?.['tab:task/kanban'] ?? null, null, 'the tag selection is dropped');
  assert.equal(u.adoptTasksUi(structuredClone({ ...ui, tasks: { ...old, view: 'all', doneExpanded: false } })).typeViews?.lastTab?.task, null, 'all → null (All Tasks)');
  assert.equal(u.adoptTasksUi(structuredClone({ ...ui, tasks: { ...old, view: 'schedule' } })).typeViews?.lastTab?.task, 'Schedule', 'schedule → Schedule');
  const already = { ...ui, typeViews: { lastTab: { task: 'Čeká na ostatní' } } };
  assert.equal(u.adoptTasksUi(structuredClone(already)).typeViews.lastTab.task, 'Čeká na ostatní', 'a lastTab.task already there is kept (applied once)');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-22 (summary)

test('fr_tsk_04_ac22_header_tabs_and_toolbar', async () => {
  const v = await taskViews();
  assert.equal(typeof v.summaryWeek, 'function', 'tasks/views.ts exports summaryWeek (§28.2)');
  assert.deepEqual(v.summaryWeek(fixtureRows(), '2026-10-14', 1, 'Europe/Prague'), { open: 15, overdue: 2, doneWeek: 1 }, 'R208: 15 open · 2 overdue · 1 done this week (T10 only)');
  assert.deepEqual(v.summaryWeek(fixtureRows(), '2026-10-12', 1, 'Europe/Prague').doneWeek, 1, 'the week Monday 12 – Sunday 18 (cs)');
  for (const gone of ['schedule', 'kanban', 'counts']) assert.equal(v[gone], undefined, `tasks/views.ts no longer exports ${gone} (§23.3)`);
});
