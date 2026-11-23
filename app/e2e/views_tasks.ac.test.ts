// Slice Q2-T real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/views.md "Real-app tests (part
// three)": FR-TSK-04 AC-22 (the page), AC-24 (the done lane after a relaunch), AC-25 (a real period drag: bytes, mtime,
// inode), AC-28 (the tag filter after a relaunch); FR-QRY-07 AC-28 (the migration on the base fixture with
// TEGG_TEST_TASK_VIEWS=1: bytes, mtime and inode of every other file), AC-30 (relaunch); FR-STO-07 AC-12 (machine-local
// state); FR-SYN-06 AC-50 (the tour writes nothing; each action writes only its files); FR-UX-08 AC-25 (what the macOS
// accessibility tree shows). The latency criterion is in nfr_perf_07_tasks_board.ac.test.ts. Always TEGG_TEST=1 with the
// tasks clock (TEGG_NOW `2026-10-14T12:00:00+02:00`, TZ Europe/Prague), a temporary Application Support and a temporary
// copy of tests/fixtures/vaults/tasks plus new-empty/.tegg (the base) and, for the overlay, views-tasks/ (D-62). Keys go
// only to Tegg (D-799). Interface docs/contracts/v1-views.md §30.1 (names), §30.3 (ui-state keys), §31.1 (hooks).
// Written from the ACs and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  FX, NOW, REPO, appiumDown, changedPaths, end, marks, need, press, ready, session, shown, sleep, support, testEnv, tmp, tree, waitFor, type Driver, type Entry, type Env,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const EXPECTED = join(REPO, 'tests/fixtures/queries-files/expected/views-tasks');
/** Expected bytes; a missing file fails as an assertion (TS-I1). */
const expected = (rel: string) => {
  assert.ok(existsSync(join(EXPECTED, rel)), `expected bytes ${rel} exist`);
  return readFileSync(join(EXPECTED, rel), 'utf8');
};
const Q = (name: string) => `.tegg/queries/${name}.yml`.normalize('NFC');
const TASK_YML = '.tegg/types/task.yml';
const T03 = 'Tasks/Zalít květiny.md';
const T04 = 'Tasks/Koupit dárek.md';
const T08 = 'Tasks/Přečíst knihu.md'.normalize('NFC');
const T02 = 'Tasks/Poslat rozpočet.md';

/** The base (tasks + new-empty/.tegg); with `overlay`, then views-tasks/ (its README excluded). */
function vaultCopy(base: string, overlay: boolean): string {
  const v = join(base, 'Úkoly');
  cpSync(join(FX, 'tasks'), v, { recursive: true, filter: (s) => relative(join(FX, 'tasks'), s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  if (overlay) cpSync(join(FX, 'views-tasks'), v, { recursive: true, filter: (s) => relative(join(FX, 'views-tasks'), s) !== 'README.md' });
  return v;
}
/** The views fixture of part one (FR-QRY-07 AC-30 runs on it at part one's clock). */
function booksCopy(base: string): string {
  const v = join(base, 'Knihovna');
  cpSync(join(FX, 'views'), v, { recursive: true, filter: (s) => relative(join(FX, 'views'), s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver; n: number; env: Env };
function fresh(name: string, o: { overlay?: boolean; books?: boolean; ui?: Record<string, unknown>; env?: Env } = {}): Ctx {
  const base = tmp(`vt-${name}`);
  const vault = o.books ? booksCopy(base) : vaultCopy(base, o.overlay ?? true);
  return { base, vault, sup: support(base, { ui: { preview: { mode: 'off' }, ...(o.ui ?? {}) } }), log: join(base, 'perf.jsonl'), n: 0, env: o.env ?? {} };
}
async function launch(c: Ctx, route = 'type/task'): Promise<Driver> {
  c.n += 1;
  c.log = join(c.base, `perf-${c.n}.jsonl`);
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, ...c.env }));
  const want = `route-ready:${route.normalize('NFC')}`;
  assert.ok(await waitFor(() => marks(c.log).map((m) => m.normalize('NFC')).includes(want), 20_000), `${route} shown (route-ready)`);
  return c.d;
}
async function relaunch(c: Ctx, route = 'type/task'): Promise<Driver> {
  await end(c.d);
  c.d = undefined;
  return launch(c, route);
}
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
const read = (c: Ctx, rel: string) => (existsSync(join(c.vault, rel)) ? readFileSync(join(c.vault, rel), 'utf8') : null);
const uiState = (c: Ctx) => (existsSync(join(c.sup, 'ui-state.json')) ? JSON.parse(readFileSync(join(c.sup, 'ui-state.json'), 'utf8')) : null);
async function waitText(c: Ctx, rel: string, ok: (t: string | null) => boolean, ms: number): Promise<string | null> {
  await waitFor(() => ok(read(c, rel)), ms);
  return read(c, rel);
}
/** Changed files only (new folders such as `.tegg/queries/` aside). */
const changedFiles = (a: Record<string, Entry>, b: Record<string, Entry>) => changedPaths(a, b).filter((p) => !p.endsWith('/'));
async function rectOf(d: Driver, label: string, ms = 5000, prefix = false) {
  if (!prefix) { const e = await need(d, label, ms); return d.getElementRect(e.elementId); }
  const q = label.replace(/"/g, '\\"');
  let e: any = null;
  await waitFor(async () => {
    for (const x of await d.$$(`-ios predicate string:label BEGINSWITH "${q}"`)) if (await x.isDisplayed().catch(() => false)) { e = x; return true; }
    return false;
  }, ms);
  assert.ok(e, `an element whose label starts with "${label}"`);
  return d.getElementRect(e.elementId);
}
async function dragFromTo(d: Driver, from: { x: number; y: number }, to: { x: number; y: number }) {
  await d.execute('macos: clickAndDrag', { startX: Math.round(from.x), startY: Math.round(from.y), endX: Math.round(to.x), endY: Math.round(to.y), duration: 0.6 });
}
const mid = (r: { x: number; y: number; width: number; height: number }) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
async function cardDrag(d: Driver, card: string, target: string, targetPrefix = false) {
  const from = await rectOf(d, card, 8000);
  const to = await rectOf(d, target, 5000, targetPrefix);
  await dragFromTo(d, { x: from.x + from.width / 2, y: from.y + 12 }, { x: to.x + to.width / 2, y: to.y + Math.min(to.height / 2, 40) });
}
async function selectTab(d: Driver, name: string) {
  await (await need(d, name, 5000)).click();
  await sleep(500);
}

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-22

test('fr_tsk_04_ac22_header_tabs_and_toolbar', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('tsk04ac22');
  try {
    const before = tree(c.vault);
    const d = await launch(c, 'inbox');
    await (await need(d, 'Tasks', 8000)).click();
    assert.ok(await waitFor(() => marks(c.log).includes('route-ready:type/task'), 5000), 'the sidebar entry opens type/task');
    // Slice Q3 (AC-Test-Change, D-2196; FR-TSK-04 AC-30, R223): the display switch and `Group` instead of `Lanes`.
    for (const l of ['Views', 'All Tasks', 'Schedule', 'Kanban', 'Čeká na ostatní', 'Add view', 'Type settings', 'New Task', 'Filter Tasks…', 'Filter by tag', 'Display', 'Group', 'View actions']) {
      assert.ok(await shown(d, l, 3000), `"${l}" in the accessibility tree`);
    }
    assert.ok(await shown(d, '15 open · 2 overdue · 1 done this week', 3000), 'the summary');
    for (const l of ['Add a task…', 'Task views', 'Group by']) assert.equal(await shown(d, l, 500), false, `no "${l}"`);
    await sleep(800);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'opening writes nothing (bytes, mtime, inode)');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-24

test('fr_tsk_04_ac24_the_done_lane', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('tsk04ac24');
  try {
    const before = tree(c.vault);
    let d = await launch(c);
    await (await need(d, 'Expand Done', 8000)).click();
    assert.ok(await shown(d, 'Task: Zaplatit fakturu', 3000), 'Zaplatit fakturu in Done');
    assert.ok(await waitFor(() => (uiState(c)?.usageFolded?.['tab:task/schedule'] ?? []).includes('!done'), 3000), `ui-state.json: usageFolded["tab:task/schedule"] holds !done (${JSON.stringify(uiState(c)?.usageFolded)})`);
    d = await relaunch(c);
    assert.ok(await shown(d, 'Collapse Done', 8000), 'after a relaunch the done lane is still expanded');
    assert.ok(await shown(d, 'Task: Vrátit knihy', 3000), 'its cards shown');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'nothing is written to the vault');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-25

test('fr_tsk_04_ac25_period_drags_write_due_once', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('tsk04ac25');
  try {
    const before = tree(c.vault);
    const d = await launch(c);
    await cardDrag(d, 'Task: Přečíst knihu', 'pátek 16.', true);
    const want = expected('tasks/precist-knihu-due-16.md');
    assert.equal(await waitText(c, T08, (t) => t === want, 5000), want, '`due: 2026-10-16` appended, modified');
    await sleep(800);
    const after = tree(c.vault);
    assert.deepEqual(changedPaths(before, after), [T08], 'every other vault file untouched');
    const a = before[T08], b = after[T08];
    assert.ok(a !== 'dir' && b !== 'dir' && a.ino !== b.ino, 'a temporary file renamed in Tasks/ (new inode)');
    assert.ok(await shown(d, 'Moved "Přečíst knihu" to pátek 16.', 2000), 'the live region');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-28

test('fr_tsk_04_ac28_text_and_tag_filters', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('tsk04ac28');
  try {
    const before = tree(c.vault);
    let d = await launch(c);
    for (const tag of ['#práce', '#finance']) {
      await (await need(d, 'Filter by tag', 8000)).click();
      await sleep(200);
      await (await need(d, tag, 3000)).click();
      await sleep(200);
      press('escape');
    }
    assert.ok(await waitFor(() => JSON.stringify(uiState(c)?.tagFilter?.['tab:task/schedule']) === JSON.stringify(['práce', 'finance']), 3000), `tagFilter["tab:task/schedule"] (${JSON.stringify(uiState(c)?.tagFilter)})`);
    d = await relaunch(c);
    for (const l of ['Remove #práce', 'Remove #finance']) assert.ok(await shown(d, l, 8000), `after a relaunch: ${l}`);
    assert.ok(await shown(d, 'Task: Poslat rozpočet', 3000), 'the narrowed board');
    assert.equal(await shown(d, 'Task: Zavolat Janě', 500), false, 'Zavolat Janě filtered out');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'nothing is written to the vault');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-28

test('fr_qry_07_ac28_an_existing_vault_is_migrated_once', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q07ac28', { overlay: false, env: { TEGG_TEST_TASK_VIEWS: '1' } });
  try {
    const before = tree(c.vault);
    let d = await launch(c);
    assert.equal(await waitText(c, TASK_YML, (t) => !!t?.includes('views:'), 8000), expected('types/task-migrated.yml'), 'task.yml: only line 11 `views: [Schedule, Kanban]`');
    assert.equal(read(c, Q('Schedule')), expected('queries/schedule-default.yml'), 'Schedule.yml: R202\'s bytes');
    assert.equal(read(c, Q('Kanban')), expected('queries/kanban-default.yml'), 'Kanban.yml: R202\'s bytes');
    const mid1 = tree(c.vault);
    assert.deepEqual(changedFiles(before, mid1), [Q('Kanban'), Q('Schedule'), TASK_YML].sort(), 'every other vault file keeps its bytes, mtime and inode');
    const tb = before[TASK_YML], ta = mid1[TASK_YML];
    assert.ok(tb !== 'dir' && ta !== 'dir' && tb.ino !== ta.ino, 'task.yml written atomically (new inode)');
    assert.ok(await shown(d, 'Schedule', 5000) && await shown(d, 'Today & overdue, 4 Tasks', 5000), 'the page shows Schedule');
    // Closing and reopening writes nothing.
    d = await relaunch(c);
    await sleep(1000);
    assert.deepEqual(changedPaths(mid1, tree(c.vault)), [], 'reopening writes nothing');
    // A second "Mac" (a fresh Application Support) writes nothing.
    await end(c.d); c.d = undefined;
    c.sup = support(c.base, { name: 'support-2', ui: { preview: { mode: 'off' } } });
    await launch(c);
    await sleep(1000);
    assert.deepEqual(changedPaths(mid1, tree(c.vault)), [], 'a second Mac writes nothing');
    assert.ok(!existsSync(join(c.vault, '.tegg/queries/Schedule (2).yml')) && !existsSync(join(c.vault, '.tegg/queries/Kanban (2).yml')), 'no (2) copies');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-30

test('fr_qry_07_ac30_tag_filter_on_every_tab', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q07ac30', { books: true, ui: { typeViews: { lastTab: { book: null } } }, env: { TEGG_NOW: '2026-11-19T10:00:00+01:00' } });
  try {
    const before = tree(c.vault);
    let d = await launch(c, 'type/book');
    await (await need(d, 'Filter by tag', 8000)).click();
    await sleep(200);
    await (await need(d, '#doporučené', 3000)).click();
    press('escape');
    assert.ok(await waitFor(() => JSON.stringify(uiState(c)?.tagFilter?.['all:book']) === JSON.stringify(['doporučené']), 3000), `tagFilter["all:book"] (${JSON.stringify(uiState(c)?.tagFilter)})`);
    d = await relaunch(c, 'type/book');
    assert.ok(await shown(d, 'Remove #doporučené', 8000), 'after a relaunch All Books keeps `#doporučené`');
    assert.equal(await shown(d, 'Noční vlak', 500), false, 'the rows stay narrowed');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'selecting tags writes nothing to the vault');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-STO-07 AC-12

test('fr_sto_07_ac12_tag_filters_and_sorts_are_machine_local', { timeout: 300_000 }, async () => {
  await ready();
  const old = { view: 'kanban', groupBy: 'tag', dateFilter: 'today', tags: ['práce'], doneExpanded: true };
  const c = fresh('sto07ac12', { ui: { tasks: old } });
  try {
    const before = tree(c.vault);
    const d = await launch(c);
    assert.ok(await shown(d, 'To do, 10 Tasks', 8000), 'a 0.4.x ui-state.json opens Kanban');
    assert.equal(await shown(d, 'Remove #práce', 500), false, 'with no tag selected');
    await selectTab(d, 'Schedule');
    assert.ok(await shown(d, 'Collapse Done', 3000), 'the Schedule done lane unfolded');
    await (await need(d, 'Filter by tag', 3000)).click();
    await sleep(200);
    await (await need(d, '#doma', 3000)).click();
    press('escape');
    assert.ok(await waitFor(() => {
      const u = uiState(c);
      return JSON.stringify(u?.tagFilter?.['tab:task/schedule']) === JSON.stringify(['doma']) && u?.typeViews?.lastTab?.task !== undefined;
    }, 3000), `ui-state.json holds tagFilter and lastTab (${JSON.stringify(uiState(c))})`);
    assert.deepEqual(uiState(c)?.tasks, old, 'the old keys stay in the file unchanged');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'nothing under the vault changes');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-50

test('fr_syn_06_ac50_tasks_views_write_only_what_the_user_changes', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('syn06ac50');
  try {
    const before = tree(c.vault);
    let d = await launch(c);
    for (const t of ['Schedule', 'Kanban', 'Čeká na ostatní', 'All Tasks', 'Schedule']) {
      await selectTab(d, t);
      if (t !== 'All Tasks') {
        await (await need(d, 'View actions', 5000)).click(); await sleep(300); press('escape');
      }
    }
    await (await need(d, 'Expand Done', 5000)).click(); await sleep(200);
    await (await need(d, 'Collapse Done', 3000)).click(); await sleep(200);
    await (await need(d, 'Filter by tag', 3000)).click(); await sleep(200);
    await (await need(d, '#doma', 3000)).click(); await sleep(200);
    press('escape');
    await (await need(d, 'Remove #doma', 3000)).click(); await sleep(200);
    for (const t of ['Zavolat Janě', 'Zalít květiny']) {
      await (await need(d, `More actions for "${t}"`, 3000)).click(); await sleep(200); press('escape');
      await (await need(d, t, 3000)).click(); await sleep(600);
      press('lbracket', ['command']); await sleep(600);
    }
    await (await need(d, 'Type settings', 3000)).click(); await sleep(600);
    press('lbracket', ['command']); await sleep(400);
    d = await relaunch(c);
    await sleep(800);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'the tour leaves every vault file byte-, mtime- and inode-identical and creates nothing');
    // Then each action writes exactly its files, once.
    const results: [string, string[]][] = [];
    const step = async (what: string, wait: string, act: () => Promise<void>) => {
      const b = tree(c.vault);
      await act();
      await waitFor(() => { const e = tree(c.vault)[wait.normalize('NFC')]; return !!e && (b[wait.normalize('NFC')] === undefined || JSON.stringify(e) !== JSON.stringify(b[wait.normalize('NFC')])); }, 4000);
      await sleep(700);
      results.push([what, changedFiles(b, tree(c.vault))]);
    };
    await step('checkbox', T03, async () => { await (await need(d, 'Complete "Zalít květiny"', 5000)).click(); });
    await step('period drag', T08, async () => { await cardDrag(d, 'Task: Přečíst knihu', 'pátek 16.', true); });
    await (await need(d, 'Expand Done', 3000)).click(); await sleep(300);
    await step('done-lane drop', T02, async () => { await cardDrag(d, 'Task: Poslat rozpočet', 'Done, ', true); });
    await selectTab(d, 'Kanban');
    await step('status drag', T04, async () => { await cardDrag(d, 'Task: Koupit dárek', 'In progress, ', true); });
    assert.deepEqual(results, [['checkbox', [T03]], ['period drag', [T08]], ['done-lane drop', [T02]], ['status drag', [T04]]].map(([w, p]) => [w, (p as string[]).map((x) => x.normalize('NFC'))]), 'each action writes exactly one file');
    assert.ok(!Object.keys(tree(c.vault)).some((p) => /ui-state|\.sqlite|index/i.test(p)), 'no index or UI state in the vault');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-25

test('fr_ux_08_ac25_tasks_views_for_voiceover', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ux08ac25');
  try {
    const d = await launch(c);
    for (const l of ['Views', 'All Tasks', 'Schedule', 'Kanban', 'Čeká na ostatní', 'Today & overdue, 4 Tasks', 'This week, 4 Tasks', 'Later, 2 Tasks', 'Not scheduled, 5 Tasks', 'Done, 2 Tasks',
      'Expand Done', 'Task: Zavolat Janě', 'Task: Koupit dárek', 'Task: Přečíst knihu']) {
      assert.ok(await shown(d, l, 5000), `"${l}" by name`);
    }
    const day = await rectOf(d, 'čtvrtek 15., 2 Tasks', 3000).catch(() => null);
    assert.ok(day, 'the day group `čtvrtek 15., 2 Tasks`');
    const card = await rectOf(d, 'Task: Koupit dárek');
    const m = mid(card);
    assert.ok(m.x >= day!.x && m.x <= day!.x + day!.width && m.y >= day!.y && m.y <= day!.y + day!.height, 'Koupit dárek is inside `čtvrtek 15.`');
    const sch = await need(d, 'Schedule');
    assert.ok(String(await sch.getAttribute('selected').catch(() => '')).match(/true|1/) || String(await sch.getAttribute('value').catch(() => '')).match(/1|true/), 'Schedule reads as selected');
  } finally { await cleanup(c); }
});

void NOW;
