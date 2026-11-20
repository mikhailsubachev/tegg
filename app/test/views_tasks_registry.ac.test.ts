// Slice Q2-T, L1: the registry and catalog parts of docs/acceptance/views.md part three: FR-UX-03 AC-53 (R207's kept and
// new commands with their titles, no shortcut, `needsVault: true`, listed where R207 says, the removed ones gone; D-1771,
// D-1922) and NFR-OTH-02 AC-23 (R207's keys with their English texts, the removed keys gone, plural forms through
// `Intl.PluralRules` with the Czech test catalog showing 1, 3 and 5; D-1920, D-1921). Interface
// docs/contracts/v1-views.md §30.2 (strings), §30.4 (commands, `ViewsStatus.board.taskFocused`). Written from the ACs and
// the contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
async function mods() {
  const reg = await load('../ui/src/shell/registry.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(reg && cat && cmd, 'registry, catalog and commands modules load');
  return { reg: reg!, cat: cat!, cmd: cmd! };
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const VAULT = { name: 'Úkoly', path: '/tmp/Úkoly', placeholders: 0 };
const TASK = { key: 'task', name: 'Task', plural: 'Tasks', folder: 'Tasks', icon: 'check-square', color: 'blue', system: true, invalid: false, exists: true, views: ['Schedule', 'Kanban', 'Čeká na ostatní'], viewsUnreadable: false };
type Board = { lanes: 'vertical' | 'horizontal'; laneOrder: boolean; cardFocused: boolean; laneFocused: boolean; taskFocused: boolean } | null;
type Status = { typeKey: string | null; tab: string | null; writable: boolean; board: Board; sortable: boolean } | null;
function ctxOf(route: Record<string, unknown> | null, status: Status, calls: unknown[] = [], types: unknown[] = [TASK]) {
  return {
    vault: VAULT, types, counts: { task: 19 }, route,
    actions: {
      go: (r: any) => calls.push(r),
      views: { status: () => status, run: (id: string) => calls.push(id) },
      queryStatus: () => null, pinStatus: () => null,
    },
  };
}
const TASK_ROUTE = { id: 'type/<type>', param: 'task' };
const SETTINGS_ROUTE = { id: 'type-settings/<type>', param: 'task' };
const NOTE_ROUTE = { id: 'note/<path>', param: 'Pages/Porada.md', path: 'Pages/Porada.md', type: 'page' };
const board = (o: Partial<NonNullable<Board>> = {}): Board => ({ lanes: 'horizontal', laneOrder: false, cardFocused: false, laneFocused: false, taskFocused: false, ...o });
const st = (o: Partial<NonNullable<Status>> = {}): Status => ({ typeKey: 'task', tab: 'Schedule', writable: true, board: null, sortable: true, ...o });

/** R207's commands: [id, title key, English title]. */
const R207: [string, string, string][] = [
  ['tasks.go', 'cmd.goto.tasks', 'Go to Tasks'], ['tasks.schedule', 'cmd.tasks.schedule', 'Show Schedule'], ['tasks.kanban', 'cmd.tasks.kanban', 'Show Kanban'],
  ['tasks.search', 'cmd.tasks.search', 'Filter tasks'], ['task.complete', 'cmd.task.complete', 'Complete task'], ['task.setStatus', 'cmd.task.setStatus', 'Set task status…'],
  ['types.restoreDefaultViews', 'cmd.restoreDefaultViews', 'Restore default views'],
];
const REMOVED_IDS = ['tasks.groupStatus', 'tasks.groupTag', 'tasks.filterAll', 'tasks.filterToday', 'tasks.filterWeek', 'tasks.add', 'task.moveNext', 'task.movePrevious', 'tasks.columnLeft', 'tasks.columnRight'];

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-53

test('fr_ux_03_ac53_tasks_views_by_keyboard', async () => {
  const { reg, cat, cmd } = await mods();
  const list = (route: Record<string, unknown> | null, s: Status, types?: unknown[]) => cmd.commands(ctxOf(route, s, [], types)) as any[];
  const ids = (route: Record<string, unknown> | null, s: Status, types?: unknown[]) => list(route, s, types).map((c) => c.id as string);
  const onTask = list(TASK_ROUTE, st({ board: board({ cardFocused: true, taskFocused: true }) }));
  for (const [id, key, text] of R207) {
    const c = onTask.find((x) => x.id === id);
    assert.ok(c, `${id} is listed on type/task with a focused Task card`);
    assert.deepEqual([c.title, key in cat.en ? cat.t(c.title, c.vars ?? {}) : 'missing', c.needsVault, c.shortcut ?? null], [key, text, true, null], `${id}: ${text}, needsVault, no shortcut`);
  }
  // Where each is listed (R207).
  const note = ids(NOTE_ROUTE, null);
  assert.ok(note.includes('tasks.go') && note.includes('tasks.search'), 'Go to Tasks and Filter tasks anywhere');
  assert.ok(note.includes('tasks.schedule') && note.includes('tasks.kanban'), 'Show Schedule / Show Kanban while task.yml lists them');
  assert.ok(!note.includes('types.restoreDefaultViews'), 'Restore default views only on type/task and type-settings/task');
  assert.ok(ids(SETTINGS_ROUTE, null).includes('types.restoreDefaultViews'), 'listed on type-settings/task');
  const noKanban = ids(NOTE_ROUTE, null, [{ ...TASK, views: ['Schedule', 'Čeká na ostatní'] }]);
  assert.ok(noKanban.includes('tasks.schedule') && !noKanban.includes('tasks.kanban'), 'Show Kanban is not listed when Kanban isn\'t in views');
  const noViews = ids(NOTE_ROUTE, null, [{ ...TASK, views: null }]);
  assert.ok(!noViews.includes('tasks.schedule') && !noViews.includes('tasks.kanban'), 'no views key: neither');
  const noCard = ids(TASK_ROUTE, st({ board: board() }));
  assert.ok(!noCard.includes('task.complete') && !noCard.includes('task.setStatus'), 'card commands need a focused Task card');
  // The removed commands are nowhere.
  const everywhere = new Set([...ids(TASK_ROUTE, st({ board: board({ cardFocused: true, taskFocused: true, laneFocused: true }) })), ...ids(NOTE_ROUTE, null), ...ids({ id: 'tasks' }, null), ...ids({ id: 'tasks/kanban' }, null)]);
  assert.deepEqual(REMOVED_IDS.filter((id) => everywhere.has(id)), [], 'R207\'s removed commands are gone');
  // Show Schedule / Show Kanban open type/task on that tab (Route.tab).
  const calls: any[] = [];
  const ctx = ctxOf(NOTE_ROUTE, null, calls);
  for (const id of ['tasks.go', 'tasks.schedule', 'tasks.kanban']) await (cmd.commands(ctx) as any[]).find((c) => c.id === id).run(ctx);
  assert.deepEqual(calls.map((r) => [r.id, r.tab ?? null]), [['type/task', null], ['type/task', 'Schedule'], ['type/task', 'Kanban']], 'go({ id: "type/task", tab })');
  // No shortcut for any task or view command; no clashes (FR-UX-03 AC-7).
  const sc = (reg.SHORTCUTS as { keys: string; command: string }[]).filter((s) => /^(tasks?\.|types\.restoreDefaultViews)/.test(s.command));
  assert.deepEqual(sc, [], 'no shortcut for the Tasks commands (D-1771)');
  const keys = (reg.SHORTCUTS as any[]).map((s) => String(s.keys));
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [], 'no shortcut conflicts');
  // The R3 placeholder `tasks.sort` is gone (§23.3).
  assert.equal((reg.DISABLED_CONTROLS as any[]).find((c) => c.label === 'tasks.sort'), undefined, 'no `tasks.sort` disabled control');
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-23

type Row = [string, Record<string, string | number>, string];
const KEYS: Row[] = [
  ['board.period.today', {}, 'Today & overdue'], ['board.period.todayEarlier', {}, 'Today & earlier'], ['board.period.week', {}, 'This week'], ['board.period.later', {}, 'Later'],
  ['board.period.none', {}, 'Not scheduled'], ['board.period.dropDate', { attribute: 'Due date', date: 'Fri 16 Oct' }, 'Drop to set Due date: Fri 16 Oct'],
  ['board.period.dropClear', { attribute: 'Due date' }, 'Drop to clear Due date'], ['board.done', {}, 'Done'],
  ['board.doneHint', { count: 7 }, 'Completed in the last 7 days'], ['board.doneStatusHint', { count: 7 }, 'Last 7 days'], ['board.dropDone', {}, 'Drop to mark done'],
  ['query.editor.groupByPeriod', { attribute: 'Due date' }, 'Due date · by period'], ['query.editor.groupByPeriodHint', {}, 'one lane per period'],
  ['query.editor.doneLane', { count: 7 }, 'Done in its own lane, last 7 days'], ['query.op.state_is', {}, 'state is'], ['query.op.state_is_not', {}, 'state is not'],
  ['board.laneCountOf', { count: 4, name: 'Task', plural: 'Tasks' }, '4 Tasks'], ['board.laneCountOf', { count: 1, name: 'Task', plural: 'Tasks' }, '1 Task'],
  ['sort.scope.thisMac', {}, 'Sort of this page on this Mac'], ['typeSettings.defaultViews', {}, 'Default views'], ['typeSettings.restoreViews', {}, 'Restore default views'],
  ['typeSettings.restoreViewsHint', {}, 'Brings back Schedule and Kanban if they were removed or deleted.'],
  ['typeSettings.restoreViewsNone', {}, 'Schedule and Kanban are on the Tasks page.'], ['typeSettings.restoredViews', { names: 'Kanban' }, 'Restored Kanban'],
  ['cmd.restoreDefaultViews', {}, 'Restore default views'],
  ['tasks.summary.open', { count: 15 }, '15 open'], ['tasks.summary.overdue', { count: 2 }, '2 overdue'], ['tasks.summary.doneWeek', { count: 1 }, '1 done this week'],
];
const REMOVED = [
  'tasks.title', 'tasks.summary', 'tasks.summary.today', 'tasks.views', 'tasks.view.schedule', 'tasks.view.kanban', 'tasks.view.all', 'tasks.groupBy', 'tasks.group.status',
  'tasks.group.tag', 'tasks.group.overdue', 'tasks.group.today', 'tasks.filter', 'tasks.filter.all', 'tasks.filter.today', 'tasks.filter.week', 'tasks.section.today',
  'tasks.section.week', 'tasks.section.later', 'tasks.section.none', 'tasks.section.done', 'tasks.hint.today', 'tasks.hint.week', 'tasks.hint.later', 'tasks.hint.none',
  'tasks.add', 'tasks.add.example', 'tasks.add.due', 'tasks.add.noDue', 'tasks.add.priority', 'tasks.add.noPriority', 'tasks.add.clearDue', 'tasks.add.clearPriority',
  'tasks.add.hotkey', 'tasks.add.noTitle', 'tasks.add.today', 'tasks.add.week', 'tasks.add.none', 'tasks.add.dueToday', 'tasks.column.add', 'tasks.column.noTag',
  'tasks.column.noStatus', 'tasks.column.empty', 'tasks.column.drag', 'tasks.column.moved', 'tasks.column.cantMove', 'tasks.drop.status', 'tasks.drop.tag',
  'tasks.board.hintStatus', 'tasks.board.hintTag', 'tasks.moved', 'tasks.created', 'tasks.sort', 'tasks.sort.schedule', 'tasks.sort.kanban', 'tasks.doneMore', 'tasks.newIn',
  'cmd.tasks.groupStatus', 'cmd.tasks.groupTag', 'cmd.tasks.filterAll', 'cmd.tasks.filterToday', 'cmd.tasks.filterWeek', 'cmd.tasks.add', 'cmd.tasks.columnLeft',
  'cmd.tasks.columnRight', 'cmd.task.moveNext', 'cmd.task.movePrevious', 'query.editor.onCards', 'query.editor.onCardsChange',
];
const KEPT = ['cmd.goto.tasks', 'cmd.tasks.schedule', 'cmd.tasks.kanban', 'cmd.tasks.search', 'cmd.task.complete', 'cmd.task.setStatus', 'tasks.summary.open', 'tasks.summary.overdue', 'tasks.tagFilter', 'typePage.filter', 'typePage.noMatch'];

test('nfr_oth_02_ac23_q2t_strings', async () => {
  const { cat } = await mods();
  const en = cat.en as Record<string, unknown>;
  const bad: string[] = [];
  for (const [key, vars, want] of KEYS) {
    const got = key in en ? cat.t(key, vars) : 'missing';
    if (got !== want) bad.push(`${key} ${JSON.stringify(vars)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'R207\'s keys with their English texts');
  // The summary is composed of its plural parts (CP-29, D-1921).
  const part = (k: string, n: number) => cat.t(`tasks.summary.${k}`, { count: n });
  assert.equal('tasks.summaryWeek' in en ? cat.t('tasks.summaryWeek', { open: part('open', 15), overdue: part('overdue', 2), done: part('doneWeek', 1) }) : 'missing', '15 open · 2 overdue · 1 done this week', 'tasks.summaryWeek on the fixture');
  assert.deepEqual(REMOVED.filter((k) => k in en), [], 'R207\'s removed keys are gone (D-1922)');
  assert.deepEqual(KEPT.filter((k) => !(k in en)), [], 'the kept keys stay');
  // Plural forms with the Czech test catalog: 1, 3, 5.
  const plural = ['tasks.summary.doneWeek', 'board.doneHint', 'board.doneStatusHint', 'query.editor.doneLane', 'board.laneCountOf'];
  assert.deepEqual(plural.filter((k) => !(k in en)), [], 'the plural keys exist');
  cat.setCatalog({
    ...en,
    'tasks.summary.doneWeek': { one: '{count} hotový tento týden', few: '{count} hotové tento týden', other: '{count} hotových tento týden' },
    'board.doneHint': { one: 'Dokončeno za poslední {count} den', few: 'Dokončeno za poslední {count} dny', other: 'Dokončeno za posledních {count} dní' },
    'board.laneCountOf': { one: '{count} {name}', few: '{count} úkoly', other: '{count} {plural}' },
  }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('tasks.summary.doneWeek', { count: n })), ['1 hotový tento týden', '3 hotové tento týden', '5 hotových tento týden'], 'doneWeek: one, few, other');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('board.doneHint', { count: n })), ['Dokončeno za poslední 1 den', 'Dokončeno za poslední 3 dny', 'Dokončeno za posledních 5 dní'], 'doneHint: one, few, other');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('board.laneCountOf', { count: n, name: 'Úkol', plural: 'Úkoly' })), ['1 Úkol', '3 úkoly', '5 Úkoly'], 'laneCountOf: one, few, other');
});
