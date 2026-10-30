// Preview v0.94 feedback, L1: the title search on the Schedule and the Kanban (docs/acceptance/tasks.md FR-TSK-04
// AC-19, AC-20, AC-21, FR-TSK-05 AC-16; AP-1180…AP-1184 → D-1280…D-1284). Interface docs/contracts/ms5-tasks.md §13:
// `ViewInput.search` in `app/ui/src/tasks/views.ts`; `schedule()` and `kanban()` keep only rows whose title, folded as
// the type page's filter (NFC, lower case, marks removed), contains the folded trimmed text; `counts()` ignores it;
// `kanban()` keeps its columns; `schedule()` leaves out sections and day groups with no row; catalog
// `cmd.tasks.search` `Filter tasks`. Fixture rows from tasks-data.ts (R44), clock 2026-10-14, region `cs`.
// Written from the ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { P, SPELLING, defs, fixtureRows, type Key } from './tasks-data';

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
  assert.ok(m && typeof m.schedule === 'function' && typeof m.kanban === 'function' && typeof m.counts === 'function', 'ui/src/tasks/views.ts exports schedule, kanban, counts (§4)');
  return m!;
}

const TODAY = '2026-10-14';
const ps = (...k: Key[]) => k.map((x) => P[x]);
const paths = (rows: { path: string }[]) => rows.map((r) => r.path.normalize('NFC'));
type In = { tasks?: unknown[]; dateFilter?: 'all' | 'today' | 'week'; tagFilter?: string[]; search?: string };
/** A `ViewInput` (§4) with the v0.94 `search` (§13); `search` is left out when not given. */
function input(o: In = {}) {
  return {
    tasks: o.tasks ?? fixtureRows(), defs: defs(), today: TODAY, firstWeekday: 1, collator: new Intl.Collator('cs'),
    dateFilter: o.dateFilter ?? 'all', tagFilter: o.tagFilter ?? [], timeZone: 'Europe/Prague',
    ...(o.search !== undefined ? { search: o.search } : {}),
  };
}
function sched(s: any) {
  return {
    overdue: paths(s.today.overdue), today: paths(s.today.today),
    week: s.week.map((g: any) => [g.date, paths(g.tasks)]), later: paths(s.later), none: paths(s.none), done: paths(s.done),
  };
}
const EMPTY = { overdue: [], today: [], week: [], later: [], none: [], done: [] };
const byColumn = (k: any) => Object.fromEntries(k.columns.map((c: any) => [c.id, paths(c.tasks)]));

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-19

test('fr_tsk_04_ac19_za_keeps_t01_t03_and_done_t10', async () => {
  const v = await views();
  assert.deepEqual(sched(v.schedule(input({ search: 'za' }))), { ...EMPTY, overdue: ps('T01'), today: ps('T03'), done: ps('T10') },
    '`za`: Overdue T01, Today T03, Done T10; no day group of This week is left (§13: groups with no row are left out)');
});

test('fr_tsk_04_ac19_case_and_diacritics_are_folded', async () => {
  const v = await views();
  for (const q of ['ZALIT', 'zalít', 'kvetiny', 'KVĚTINY', 'zalít'.normalize('NFD')]) {
    assert.deepEqual(sched(v.schedule(input({ search: q }))), { ...EMPTY, today: ps('T03') }, `${JSON.stringify(q)} leaves only T03`);
  }
});

test('fr_tsk_04_ac19_nfd_text_and_nfd_title_match', async () => {
  const v = await views();
  const want = { ...EMPTY, week: [['2026-10-15', ps('T19')]] };
  for (const q of ['nakup', 'nákup', 'nákup'.normalize('NFD')]) {
    assert.deepEqual(sched(v.schedule(input({ search: q }))), want, `${JSON.stringify(q)} leaves only T19 (Thu 15)`);
  }
  // T19's title is NFD bytes in the file (fixture README); the row may carry it as written.
  const rows = fixtureRows().map((r: any) => (r.path === P.T19 ? { ...r, title: 'Nákup'.normalize('NFD') } : r));
  for (const q of ['nakup', 'nákup', 'nákup'.normalize('NFD')]) {
    assert.deepEqual(sched(v.schedule(input({ tasks: rows, search: q }))), want, `${JSON.stringify(q)} matches an NFD title (folded after NFC)`);
  }
});

test('fr_tsk_04_ac19_body_tags_and_status_labels_are_not_matched', async () => {
  const v = await views();
  for (const q of ['schuzku', 'schůzku', 'doma', 'práce', 'rodina', 'Waiting', 'In progress', 'Rozpracováno', 'Porada']) {
    assert.deepEqual(sched(v.schedule(input({ search: q }))), EMPTY, `${JSON.stringify(q)} (body, tag, status label or source) leaves nothing`);
  }
});

test('fr_tsk_04_ac19_combines_with_the_date_and_tag_filters', async () => {
  const v = await views();
  assert.deepEqual(sched(v.schedule(input({ tagFilter: ['práce'], search: 'za' }))), { ...EMPTY, overdue: ps('T01') }, '#práce + `za` leaves T01');
  assert.deepEqual(sched(v.schedule(input({ dateFilter: 'today', search: 'kvetiny' }))), { ...EMPTY, today: ps('T03') }, 'Today + `kvetiny` leaves T03');
  assert.deepEqual(sched(v.schedule(input({ dateFilter: 'week', search: 'nakup' }))), { ...EMPTY, week: [['2026-10-15', ps('T19')]] }, 'This week + `nakup` leaves T19');
  assert.deepEqual(sched(v.schedule(input({ dateFilter: 'today', search: 'nakup' }))), EMPTY, 'Today + `nakup`: T19 is due tomorrow');
});

test('fr_tsk_04_ac19_only_hidden_tasks_match_cesta', async () => {
  const v = await views();
  assert.deepEqual(sched(v.schedule(input({ search: 'cesta' }))), EMPTY, '`cesta` matches only T13 (Cancelled): every section is empty');
});

test('fr_tsk_04_ac19_empty_or_blank_text_filters_nothing_and_text_is_trimmed', async () => {
  const v = await views();
  const all = sched(v.schedule(input()));
  for (const q of ['', '   ', '\t']) assert.deepEqual(sched(v.schedule(input({ search: q }))), all, `${JSON.stringify(q)} filters nothing`);
  assert.deepEqual(sched(v.schedule(input({ search: '  za  ' }))), sched(v.schedule(input({ search: 'za' }))), 'the text is trimmed');
  assert.deepEqual(sched(v.schedule(input({ search: 'q' }))), EMPTY, 'a text no title contains leaves nothing (control: the search is applied)');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-20 (the counts ignore the search)

test('fr_tsk_04_ac20_counts_ignore_the_search', async () => {
  const v = await views();
  const pick = (c: any) => ({ open: c.open, overdue: c.overdue, dueToday: c.dueToday, all: c.all, today: c.today, week: c.week, tags: c.tags.map((t: any) => [t.key, t.count]) });
  const plain = pick(v.counts(input()));
  for (const q of ['za', 'cesta', 'kvetiny']) assert.deepEqual(pick(v.counts(input({ search: q }))), plain, `counts() with ${JSON.stringify(q)} = without (D-1281)`);
  assert.deepEqual([plain.open, plain.overdue, plain.dueToday, plain.all, plain.today, plain.week], [15, 2, 2, 15, 4, 8], 'the fixture counts (control)');
  const za = sched(v.schedule(input({ search: 'za' })));
  assert.equal(za.overdue.length + za.today.length, 2, 'the section count follows the search: Today & overdue 2');
  assert.equal(za.done.length, 1, 'Done 1');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-05 AC-16

test('fr_tsk_05_ac16_by_status_keeps_its_columns', async () => {
  const v = await views();
  const plain = v.kanban(input(), 'status', SPELLING);
  const za = v.kanban(input({ search: 'za' }), 'status', SPELLING);
  assert.deepEqual(za.columns.map((c: any) => c.id), plain.columns.map((c: any) => c.id), 'the same columns with and without the search');
  assert.deepEqual(za.columns.map((c: any) => c.id), ['To do', 'In progress', 'Waiting', 'Done', 'no-status'], 'R42 columns (control)');
  assert.deepEqual(byColumn(za), { 'To do': ps('T01', 'T03'), 'In progress': [], Waiting: [], Done: ps('T10'), 'no-status': [] },
    '`za`: To do T01, T03; Done T10; In progress, Waiting, No status empty');
});

test('fr_tsk_05_ac16_by_tag_keeps_its_columns', async () => {
  const v = await views();
  const za = v.kanban(input({ search: 'za' }), 'tag', SPELLING);
  assert.deepEqual(za.columns.map((c: any) => c.id), ['#čtení', '#doma', '#finance', '#práce', '#rodina', 'no-tag'], 'the same tag columns and No tag');
  assert.deepEqual(byColumn(za), { '#čtení': [], '#doma': ps('T03'), '#finance': [], '#práce': ps('T01'), '#rodina': [], 'no-tag': [] },
    '`za`: doma T03, práce T01; the others empty');
});

test('fr_tsk_05_ac16_cesta_empties_every_column', async () => {
  const v = await views();
  for (const g of ['status', 'tag'] as const) {
    const plain = v.kanban(input(), g, SPELLING);
    const k = v.kanban(input({ search: 'cesta' }), g, SPELLING);
    assert.deepEqual(k.columns.map((c: any) => c.id), plain.columns.map((c: any) => c.id), `${g}: no column appears or disappears`);
    assert.deepEqual(k.columns.flatMap((c: any) => paths(c.tasks)), [], `${g}: every column empty`);
  }
});

test('fr_tsk_05_ac16_search_and_tag_filter_together', async () => {
  const v = await views();
  const k = v.kanban(input({ tagFilter: ['práce'], search: 'za' }), 'status', SPELLING);
  assert.deepEqual(k.columns.flatMap((c: any) => paths(c.tasks)), ps('T01'), '#práce + `za` on the Kanban: only T01');
  assert.deepEqual(byColumn(k)['To do'], ps('T01'), 'in To do');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-21 (strings, §13)

test('fr_tsk_04_ac21_catalog_has_the_filter_tasks_command', async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat && cat.en, 'ui/src/i18n/catalog.ts exports en');
  assert.ok('cmd.tasks.search' in cat!.en, 'catalog key cmd.tasks.search (§13)');
  assert.equal(cat!.t('cmd.tasks.search'), 'Filter tasks', 'cmd.tasks.search `Filter tasks` (D-1284)');
});
