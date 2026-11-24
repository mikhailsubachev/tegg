// Keeps the fake core's slice Q2-T behaviour (app/ui/test/fake-queries.ts, fake-taskviews.ts, fake-schema.ts;
// docs/contracts/v1-views.md §24, §25, §31.1) honest against the shared Q2-T corpus:
// tests/fixtures/queries-files/expected-views-tasks.json (reads, groups, filters; L3, §31.3, read by
// crates/tegg-core/tests/ac_views_tasks.rs too) and the expected bytes of
// tests/fixtures/queries-files/expected/views-tasks/ (§31.4). The WebKit tests (L5) run against this twin, so it must
// agree with the core. Not an AC test: the AC tests (app/test/views_tasks_*.ac.test.ts, packages/doc/test/
// task_period_move.ac.test.ts, crates/tegg-core/tests/ac_views_tasks*.rs) check the product.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { columnsDefault, handle, queryCreateText, queryPatch, queryRead, queryRun, type QueryDefDto } from '../ui/test/fake-queries';
import { handle as handleSchema, listTypes } from '../ui/test/fake-schema';
import { defaultTaskView, defaultTaskViewText, migrate, restore } from '../ui/test/fake-taskviews';

const REPO = resolve(import.meta.dirname, '../..');
const QFX = resolve(REPO, 'tests/fixtures/queries-files');
const ex = JSON.parse(readFileSync(join(QFX, 'expected-views-tasks.json'), 'utf8'));
const NOW: string = ex.clock;
const expected = (rel: string) => readFileSync(join(QFX, 'expected/views-tasks', rel), 'utf8');
const qfile = (name: string) => `.tegg/queries/${name.normalize('NFC')}.yml`;
const TASK_YML = '.tegg/types/task.yml';
const crlf = (t: string) => t.replace(/\n/g, '\r\n');
const noNewline = (t: string) => t.replace(/\n$/, '');

function load(...dirs: string[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const dir of dirs) {
    const abs = resolve(REPO, dir);
    const prefix = dir.endsWith('/.tegg') ? '.tegg/' : '';
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        const rel = (prefix + relative(abs, p)).normalize('NFC');
        if (rel === 'README.md') continue;
        files[rel] = readFileSync(p, 'utf8');
      }
    };
    walk(abs);
  }
  return files;
}
const base = () => load('tests/fixtures/vaults/tasks', 'tests/fixtures/vaults/new-empty/.tegg');
const overlay = () => load('tests/fixtures/vaults/tasks', 'tests/fixtures/vaults/new-empty/.tegg', 'tests/fixtures/vaults/views-tasks');
const V = { mtimeNs: '1', size: 1, hash: 'h' };
const versOf = (files: Record<string, string>) => Object.fromEntries(Object.keys(files).filter((p) => p.startsWith('.tegg/types/')).map((p) => [p, V]));

/** One commit of `change` on `text` (a query file): the written text. */
function commit(files: Record<string, string>, text: string, name: string, change: (d: QueryDefDto) => QueryDefDto): string {
  const cols = columnsDefault(listTypes(files, {}));
  const read = queryRead(text, true, name, cols);
  const r = queryPatch(text, read, change(read.def), NOW);
  assert.ok('text' in r && r.text !== null, `${name}: the commit writes (${'error' in r ? r.error.kind : 'no change'})`);
  return (r as { text: string }).text;
}

// ------------------------------------------------------------------------------------------------ L3

test('the twin reads every query file as expected-views-tasks.json', () => {
  const files = overlay();
  const cols = columnsDefault(listTypes(files, {}));
  const bad: string[] = [];
  for (const r of ex.reads as any[]) {
    const got = queryRead(r.text, true, r.name, cols);
    const def = Object.fromEntries(Object.keys(r.def).map((k) => [k, (got.def as any)[k]]));
    if (JSON.stringify(def) !== JSON.stringify(r.def) || JSON.stringify(got.broken) !== JSON.stringify(r.broken)) {
      bad.push(`${r.name}\n  want ${JSON.stringify({ def: r.def, broken: r.broken })}\n  got  ${JSON.stringify({ def, broken: got.broken })}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the twin groups every expected-views-tasks.json board', async () => {
  const texts = new Map((ex.reads as any[]).map((r) => [r.name, r.text]));
  const bad: string[] = [];
  for (const g of ex.groups as any[]) {
    const files = overlay();
    if (texts.has(g.query)) files[qfile(g.query)] = texts.get(g.query);
    const r = await queryRun({ kind: 'saved', name: g.query }, null, g.env, files);
    const path = (c: { row: number }) => r.rows[c.row].path;
    const got: any = { broken: r.broken.map((b) => b.key), kind: r.group?.kind ?? null, key: r.group?.key ?? null, dateTime: r.group?.dateTime ?? false };
    const want: any = { broken: g.broken, kind: g.kind, key: g.key ?? null, dateTime: g.dateTime ?? false };
    if (g.lanes) {
      got.lanes = (r.group?.lanes ?? []).map((l) => ({ id: l.id, dropTarget: l.dropTarget, doneWithin: l.doneWithin, paths: l.cards.map(path), days: l.days.map((d) => ({ date: d.date, paths: d.cards.map(path) })) }));
      want.lanes = g.lanes;
    } else { got.paths = r.rows.map((x) => x.path); want.paths = g.paths; }
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${g.note}\n  want ${JSON.stringify(want)}\n  got  ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, []);
});

test('the twin runs every expected-views-tasks.json filter', async () => {
  const bad: string[] = [];
  for (const f of ex.filters as any[]) {
    const files = { ...base(), [qfile(f.name)]: f.text };
    const r = await queryRun({ kind: 'saved', name: f.name }, null, { today: '2026-10-14', zone: 'Europe/Prague', weekStart: 1, locale: 'cs' }, files);
    const broken = r.broken.map((b) => ({ reason: b.reason, key: b.key }));
    const paths = f.paths === null ? null : r.rows.map((x) => x.path).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    if (JSON.stringify({ broken, paths }) !== JSON.stringify({ broken: f.broken, paths: f.paths })) bad.push(`${f.name}\n  want ${JSON.stringify({ broken: f.broken, paths: f.paths })}\n  got  ${JSON.stringify({ broken, paths })}`);
  }
  assert.deepEqual(bad, []);
});

test('the twin fills the Q2-T fields of rows and results', async () => {
  const files = overlay();
  const r = await queryRun({ kind: 'saved', name: 'Schedule' }, null, { today: '2026-10-14', zone: 'Europe/Prague', weekStart: 1, locale: 'cs' }, files);
  assert.ok(r.taskDefs, 'taskDefs on a Task result');
  assert.ok(r.rows.every((x) => x.taskRow && x.taskRow.path === x.path), 'every Task row has its taskRow');
  assert.deepEqual(r.rows.find((x) => x.path === 'Tasks/Štítek v textu.md')?.tags, ['práce', 'rodina'], 'tags: frontmatter and inline');
  assert.equal(r.usesRelative, true, 'a period board re-runs with the date');
  const rows = (await handleSchema('index_type_rows', { type: 'task' }, files, {})).result as any[];
  assert.deepEqual(rows.find((x) => x.path === 'Tasks/Úklid garáže.md')?.tags, ['doma'], 'index_type_rows: tags (case-folded)');
});

// ------------------------------------------------------------------------------------------------ query-file bytes (§31.4)

test('the default task views give R202\'s bytes', () => {
  // D-1936: no `created` / `modified`, the same bytes on every Mac.
  assert.equal(defaultTaskViewText('Schedule'), expected('queries/schedule-default.yml'));
  assert.equal(defaultTaskViewText('Kanban'), expected('queries/kanban-default.yml'));
  assert.equal(defaultTaskView('Other'), null);
});

test('query writes give expected/views-tasks/queries/*.yml', () => {
  const files = overlay();
  const sched = files[qfile('Schedule')];
  const off = commit(files, sched, 'Schedule', (d) => ({ ...d, doneLane: null }));
  assert.equal(off, expected('queries/schedule-no-done-lane.yml'));
  assert.equal(commit(files, off, 'Schedule', (d) => ({ ...d, doneLane: { withinDays: 7, folded: true } })), expected('queries/schedule-done-lane-again.yml'));
  for (const [v, f] of [['', (t: string) => t], ['-crlf', crlf], ['-no-newline', noNewline]] as const) {
    // Slice Q3 (D-2179): the writer emits `lanes: columns` (expected/views-display/queries/schedule-lanes-columns*.yml).
    assert.equal(commit(files, f(sched), 'Schedule', (d) => ({ ...d, lanes: 'vertical' })), readFileSync(join(QFX, `expected/views-display/queries/schedule-lanes-columns${v}.yml`), 'utf8'), `lanes-columns${v}`);
  }
  const kan = files[qfile('Kanban')];
  const wait = commit(files, kan, 'Kanban', (d) => ({ ...d, laneOrder: ['Waiting', 'To do', 'In progress', 'Done', 'Rozpracováno'] }));
  assert.equal(wait, expected('queries/kanban-lane-order-waiting.yml'));
  assert.equal(commit(files, wait, 'Kanban', (d) => ({ ...d, laneOrder: null })), expected('queries/kanban-lane-order-reset.yml'));
  const pr = files[qfile('Projekty podle termínu')];
  assert.equal(commit(files, pr, 'Projekty podle termínu', (d) => ({ ...d, groupBy: 'created', groupPeriod: true })), expected('queries/projekty-group-created.yml'));
  const same = queryRead(sched, true, 'Schedule', columnsDefault(listTypes(files, {})));
  assert.deepEqual(queryPatch(sched, same, { ...same.def, groupBy: null }, NOW), { text: null }, '`group_by: null` is unchanged: no write');
});

// ------------------------------------------------------------------------------------------------ migration, restore (§25)

test('the migration gives task-migrated.yml and the default files once', async () => {
  const files = base();
  const r = await migrate(files, versOf(files), NOW);
  assert.equal((r.result as any).kind, 'Done');
  assert.deepEqual(Object.keys(r.writes ?? {}).sort(), [qfile('Kanban'), qfile('Schedule'), TASK_YML].sort());
  assert.equal(r.writes![qfile('Schedule')], expected('queries/schedule-default.yml'));
  assert.equal(r.writes![qfile('Kanban')], expected('queries/kanban-default.yml'));
  assert.equal(r.writes![TASK_YML], expected('types/task-migrated.yml'));
  const after = { ...files, ...(r.writes as Record<string, string>) };
  assert.equal(((await migrate(after, versOf(after), NOW)).result as any).kind, 'NotNeeded', 'a second open writes nothing');
  const noYml = base();
  delete noYml[TASK_YML];
  const b = await migrate(noYml, versOf(noYml), NOW);
  assert.deepEqual([(b.result as any).kind, b.writes ?? {}], ['Skipped', {}], 'without task.yml: nothing written (D-1936)');
  const ph = await migrate(base(), versOf(base()), NOW, { placeholders: 2 });
  assert.deepEqual([(ph.result as any).kind, ph.writes ?? {}], ['Skipped', {}], 'online-only placeholders: nothing written (D-1936)');
  const user = { ...base(), '.tegg/queries/schedule.yml': 'version: 1\ntitle: schedule\ntypes: [page]\nview: table\n' };
  const u = await migrate(user, versOf(user), NOW);
  assert.deepEqual(Object.keys(u.writes ?? {}).sort(), [qfile('Kanban'), TASK_YML].sort(), 'a live `schedule` is taken (name key)');
  for (const edit of [(t: string) => t.replace('version: 1\n', 'version: 2\n'), (t: string) => t.replace('preview: [status, priority, due]\n', 'preview: [status, priority, due]\nviews: Schedule\n')]) {
    const f = base();
    f[TASK_YML] = edit(f[TASK_YML]);
    const s = await migrate(f, versOf(f), NOW);
    assert.equal((s.result as any).kind, 'Skipped');
    assert.equal(s.writes, undefined);
  }
});

test('restore gives the overlay\'s task.yml back and Undo removes the key', async () => {
  const files = overlay();
  delete files[qfile('Kanban')];
  files[TASK_YML] = expected('types/task-overlay-without-kanban.yml');
  const r = await restore(files, versOf(files), V, NOW);
  assert.equal(r.error, undefined);
  assert.equal(r.writes![qfile('Kanban')], expected('queries/kanban-default.yml'));
  assert.equal(r.writes![TASK_YML], overlay()[TASK_YML]);
  assert.deepEqual([(r.result as any).created, (r.result as any).names, (r.result as any).before], [[qfile('Kanban')], ['Schedule', 'Kanban', 'Čeká na ostatní'], 'views: [Schedule, Čeká na ostatní]\n']);
  const nothing = await restore(overlay(), versOf(overlay()), V, NOW);
  assert.equal((nothing.error as any)?.kind, 'NothingToDo');
  const conflict = await restore(files, versOf(files), { ...V, hash: 'other' }, NOW);
  assert.equal((conflict.error as any)?.kind, 'Conflict');
  assert.deepEqual(Object.keys(conflict.writes ?? {}), [qfile('Kanban')], 'the created file stays');
  // Undo of a restore on a type file without `views`: an empty source removes the key.
  const m = base();
  const withViews = expected('types/task-migrated.yml');
  const undo = await handleSchema('type_patch', { key: 'task', base: V, ops: [{ op: 'viewsSource', source: '' }] }, { ...m, [TASK_YML]: withViews }, { [TASK_YML]: V });
  assert.equal((undo.writes ?? {})[TASK_YML], m[TASK_YML], 'viewsSource "" removes the key');
  const none = await handleSchema('type_patch', { key: 'task', base: V, ops: [{ op: 'viewsSource', source: '' }] }, m, { [TASK_YML]: V });
  assert.equal(undo.error ?? none.error, undefined);
  assert.equal((none.writes ?? {})[TASK_YML], undefined, 'no key: no write');
});

test('commands answer through handle', async () => {
  const files = overlay();
  const r = await handle('query_run', { source: { kind: 'saved', name: 'Kanban' }, host: null, env: { today: '2026-10-14', zone: 'Europe/Prague', weekStart: 1, locale: 'cs' } }, files);
  assert.equal((r.result as any).group.kind, 'select');
  assert.equal((r.result as any).group.lanes.some((l: any) => l.id === 'option:Cancelled'), false, 'the Cancelled lane is hidden by `state_is_not`');
});
