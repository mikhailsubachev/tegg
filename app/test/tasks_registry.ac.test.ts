// MS5 slice 5A-1, L1: the registry, command, catalog and token changes of R45, R46 (docs/acceptance/tasks.md;
// docs/contracts/ms5-tasks.md §6.1). FR-TSK-04 AC-1 (routes `tasks`, `tasks/kanban` built, R45 R1), FR-TSK-04 AC-10
// (every R45 command in the palette, no new shortcut), FR-TSK-04 AC-11 (R46 strings, plural forms), FR-TSK-04 AC-12 and
// FR-TSK-09 AC-3 (colour tokens and contrast), FR-TSK-01 AC-3 (R3: recurrence row v1.0, new disabled controls),
// FR-DLY-04 AC-8 (the `daily-tasks` placeholder is gone). A new file: the R1–R4 tables of shell-tables.ts and the
// existing registry tests change with the 5A-1 build (D-489, TS-I3). Written from the ACs and the contract only (D-61).
//
// Slice Q2-T (AC-Test-Change, D-1912; docs/acceptance/views.md part three, rows FR-TSK-04 AC-1, AC-10, AC-11): the routes
// `tasks`, `tasks/kanban` are aliases of `type/task` (AP-1540, v1-views §28.2); R45's removed commands go and R207's
// come (§30.4, D-1922); the R3 control `tasks.sort` goes; R46 loses the keys R207 removes (§30.2's exact list) and the
// summary becomes `… done this week` (`tasks.summaryWeek`, D-1921).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function mods() {
  const reg = await load('../ui/src/shell/registry.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(reg && cat && cmd, 'shell registry, catalog and commands modules load');
  return { reg: reg!, cat: cat!, cmd: cmd! };
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const REPO = resolve(import.meta.dirname, '../..');
const VAULT = { name: 'Úkoly', path: '/tmp/Úkoly', placeholders: 0 };
const TYPES = [{ key: 'task', name: 'Task', plural: 'Tasks', folder: 'Tasks', icon: 'check-square', color: 'blue', system: true, invalid: false, views: ['Schedule', 'Kanban'] }];
/** v1-views §30.2: the catalog keys Q2-T removes (exactly these, D-1922). */
const REMOVED_KEYS = ['tasks.title', 'tasks.summary', 'tasks.summary.today', 'tasks.views', 'tasks.view.schedule', 'tasks.view.kanban', 'tasks.view.all', 'tasks.groupBy',
  'tasks.group.status', 'tasks.group.tag', 'tasks.group.overdue', 'tasks.group.today', 'tasks.filter', 'tasks.filter.all', 'tasks.filter.today', 'tasks.filter.week',
  'tasks.section.today', 'tasks.section.week', 'tasks.section.later', 'tasks.section.none', 'tasks.section.done', 'tasks.hint.today', 'tasks.hint.week', 'tasks.hint.later',
  'tasks.hint.none', 'tasks.add', 'tasks.add.example', 'tasks.add.due', 'tasks.add.noDue', 'tasks.add.priority', 'tasks.add.noPriority', 'tasks.add.clearDue',
  'tasks.add.clearPriority', 'tasks.add.hotkey', 'tasks.add.noTitle', 'tasks.add.today', 'tasks.add.week', 'tasks.add.none', 'tasks.add.dueToday', 'tasks.column.add',
  'tasks.column.noTag', 'tasks.column.noStatus', 'tasks.column.empty', 'tasks.column.drag', 'tasks.column.moved', 'tasks.column.cantMove', 'tasks.drop.status',
  'tasks.drop.tag', 'tasks.board.hintStatus', 'tasks.board.hintTag', 'tasks.moved', 'tasks.created', 'tasks.sort', 'tasks.sort.schedule', 'tasks.sort.kanban',
  'tasks.doneMore', 'tasks.newIn', 'cmd.tasks.groupStatus', 'cmd.tasks.groupTag', 'cmd.tasks.filterAll', 'cmd.tasks.filterToday', 'cmd.tasks.filterWeek', 'cmd.tasks.add',
  'cmd.tasks.columnLeft', 'cmd.tasks.columnRight', 'cmd.task.moveNext', 'cmd.task.movePrevious'];
const REMOVED_COMMANDS = ['tasks.groupStatus', 'tasks.groupTag', 'tasks.filterAll', 'tasks.filterToday', 'tasks.filterWeek', 'tasks.add', 'task.moveNext', 'task.movePrevious',
  'tasks.columnLeft', 'tasks.columnRight'];
const ctx = (route: Record<string, unknown> | null) => ({ vault: VAULT, types: TYPES, counts: { task: 19 }, ...(route ? { route } : {}) });

/** R46 pairs `key` `English text`, read from the approved criteria (docs/acceptance/tasks.md R46). */
function r46(): [string, string][] {
  const md = readFileSync(resolve(REPO, 'docs/acceptance/tasks.md'), 'utf8');
  const line = md.split('\n').find((l) => l.startsWith('`tasks.title`'));
  assert.ok(line, 'R46 line in tasks.md');
  return [...line!.matchAll(/`([a-z][A-Za-z.]*)` `([^`]+)`/g)].map((m) => [m[1], m[2]]);
}

// ------------------------------------------------------------------------------------------------ R45

test('fr_tsk_04_ac1_routes_tasks_and_kanban_are_built', async () => {
  const { reg } = await mods();
  const routes = reg.ROUTES as any[];
  for (const id of ['tasks', 'tasks/kanban']) {
    const r = routes.find((x) => x.id === id);
    assert.ok(r, `R1 route ${id}`);
    assert.equal(r.status.built, true, `${id} built (R45)`);
    assert.equal(r.status.alias, 'type/task', `${id}: an alias of type/task (AP-1540, v1-views §28.2)`);
  }
  const ms5 = (reg.overdue('MS5') as string[]).join('\n');
  assert.ok(!/\btasks\b/.test(ms5), `overdue('MS5') doesn't list tasks:\n${ms5}`);
});

test('fr_tsk_04_ac10_every_r45_command_is_in_the_palette', async () => {
  const { reg, cat, cmd } = await mods();
  // R207 (v1-views §30.4): kept and new commands on type/task; `task.complete` / `task.setStatus` are listed only with a
  // Task card focused, which this context has no way to state (their L5 test: FR-TSK-05 AC-22).
  const want: [string, string][] = [
    ['tasks.go', 'Go to Tasks'], ['tasks.schedule', 'Show Schedule'], ['tasks.kanban', 'Show Kanban'], ['tasks.search', 'Filter tasks'],
    ['types.restoreDefaultViews', 'Restore default views'],
  ];
  const list = cmd.commands(ctx({ id: 'type/task' })) as any[];
  for (const id of REMOVED_COMMANDS) assert.equal(list.find((x) => x.id === id), undefined, `${id} is removed (R207)`);
  for (const [id, title] of want) {
    const c = list.find((x) => x.id === id);
    assert.ok(c, `${id} is registered (R45 R4)`);
    assert.ok(c.title in cat.en, `${id}: title is a catalog key`);
    assert.equal(cat.t(c.title, c.vars ?? {}), title, `${id}: palette title`);
    assert.equal(c.needsVault, true, `${id}: needsVault`);
    assert.equal(c.shortcut ?? null, null, `${id}: no new shortcut (D-234)`);
    assert.equal(c.due ?? null, null, `${id}: runs (not "Coming in")`);
  }
  const go = (cmd.commands(ctx({ id: 'note/<path>', path: 'Pages/Porada.md' })) as any[]).find((x) => x.id === 'tasks.go');
  assert.ok(go, 'Go to Tasks on any route');
  const keys = (reg.SHORTCUTS as any[]).map((s) => String(s.keys));
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [], 'no shortcut conflicts (FR-UX-03 AC-7)');
  assert.deepEqual((reg.SHORTCUTS as any[]).filter((s) => /^tasks?\./.test(String(s.command))), [], 'no shortcut for a task command');
});

test('fr_tsk_01_ac3_r3_controls_recurrence_v1_and_new_disabled_controls', async () => {
  const { reg, cmd } = await mods();
  const ctl = reg.DISABLED_CONTROLS as any[];
  const by = (label: string) => ctl.find((c) => c.label === label);
  assert.equal(reg.showDue(by('ctl.rowRecurrence')?.due ?? { milestone: 'MS5' }), 'v1.0', 'the Recurrence row moves to v1.0 (D-381)');
  assert.equal(by('tasks.sort'), undefined, 'the Tasks page Sort placeholder goes: the sort button works (slice Q2-T, v1-views §28.2)');
  // 6A (trash-media.md R75, tasks.md R43): the card's Move to trash is built, no longer a disabled control.
  assert.equal(by('task.trash'), undefined, 'card Move to trash is built in 6A (no longer Coming in MS6)');
  assert.ok(!('tasks.sort' in cmd.CONTROL_COMMANDS), 'no tasks.sort control command');
});

test('fr_dly_04_ac8_the_daily_tasks_placeholder_is_gone', async () => {
  const { reg } = await mods();
  const ids = (reg.IN_NOTE_PLACEHOLDERS as any[]).map((p) => p.id);
  assert.ok(!ids.includes('daily-tasks'), 'no daily-tasks row');
  const ms5 = (reg.overdue('MS5') as string[]).join('\n');
  assert.ok(!/tasks/i.test(ms5), `nothing about tasks is still due at MS5:\n${ms5}`);
});

// ------------------------------------------------------------------------------------------------ R46

test('fr_tsk_04_ac11_r46_strings_are_catalog_keys_with_the_exact_english', async () => {
  const { cat } = await mods();
  const all = r46();
  assert.equal(all.length, 89, `R46 has ${all.length} keys`); // D-518, D-516: +8 keys, tasks.tagAny removed; D-1357: +2 keys
  const pairs = all.filter(([k]) => !REMOVED_KEYS.includes(k));
  for (const k of REMOVED_KEYS) assert.ok(!(k in cat.en), `${k} is removed (R207, D-1922)`);
  const bad: string[] = [];
  for (const [key, text] of pairs) {
    if (key === 'tasks.summary') continue; // composed of plural parts, below
    if (!(key in cat.en)) { bad.push(`${key}: missing`); continue; }
    const vars: Record<string, string | number> = {};
    for (const m of text.matchAll(/\{(\w+)\}/g)) vars[m[1]] = m[1] === 'count' ? 5 : `«${m[1]}»`;
    const want = text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));
    const got = cat.t(key, vars);
    if (got !== want) bad.push(`${key}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'every R46 key with its English text');
  assert.ok(!('tasks.tagAny' in cat.en), 'tasks.tagAny is removed (D-518: selected tags must all match)');
  assert.equal(typeof cat.en['task.due.overdue'], 'object', 'task.due.overdue has plural forms (D-133)');
});

test('fr_tsk_04_ac11_summary_counts_use_plural_forms', async () => {
  // AP-434 (red-test report): the summary line has three counts, each with plural forms; one catalog message selects
  // only one form (`count`), so the parts are the plural messages `tasks.summary.open|overdue|today` and
  // `tasks.summary` joins them.
  // Slice Q2-T (R204, D-1921): `tasks.summaryWeek` joins `tasks.summary.open`, `.overdue` and `.doneWeek`.
  const { cat } = await mods();
  for (const k of ['tasks.summaryWeek', 'tasks.summary.open', 'tasks.summary.overdue', 'tasks.summary.doneWeek']) assert.ok(k in cat.en, `catalog key ${k}`);
  const part = (k: string, n: number) => cat.t(`tasks.summary.${k}`, { count: n });
  assert.equal(cat.t('tasks.summaryWeek', { open: part('open', 15), overdue: part('overdue', 2), done: part('doneWeek', 1) }), '15 open · 2 overdue · 1 done this week', 'R204 summary on the fixture');
  cat.setCatalog({ ...(cat.en as object), 'tasks.summary.open': { one: '{count} otevřený', few: '{count} otevřené', other: '{count} otevřených' } }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => part('open', n)), ['1 otevřený', '3 otevřené', '5 otevřených'], 'the Czech test catalog');
});

// ------------------------------------------------------------------------------------------------ tokens

test('fr_tsk_04_ac12_status_and_priority_colours_have_tokens_in_both_themes', async () => {
  const tok = await load('../ui/src/theme/tokens.ts');
  assert.ok(tok, 'theme/tokens.ts');
  const yml = readFileSync(resolve(REPO, 'tests/fixtures/vaults/new-empty/.tegg/types/task.yml'), 'utf8');
  const colours = [...new Set([...yml.matchAll(/color: (\w+) \}/g)].map((m) => m[1]))];
  for (const theme of ['light', 'dark']) {
    const t = tok![theme] as Record<string, string>;
    for (const c of colours) for (const k of [`type-${c}`, `type-${c}-bg`]) assert.ok(k in t, `${theme}: R14 token ${k}`);
    for (const k of ['danger-bg', 'link-bg']) assert.ok(k in t, `${theme}: token ${k} (Tasks board due chips)`);
  }
});

test('fr_tsk_09_ac3_due_chip_pairs_have_4_5_contrast', async () => {
  const tok = await load('../ui/src/theme/tokens.ts');
  const con = await load('../ui/src/theme/contrast.ts');
  assert.ok(tok && con, 'theme/tokens.ts and theme/contrast.ts');
  for (const theme of ['light', 'dark']) {
    const t = tok![theme] as Record<string, string>;
    for (const [fg, bg] of [['danger', 'danger-bg'], ['link', 'link-bg'], ['muted', 'hover']]) {
      assert.ok(t[fg] && t[bg], `${theme}: ${fg} and ${bg} exist`);
      const r = con!.ratio(t[fg], t[bg]);
      assert.ok(r >= 4.5, `${theme}: ${fg} on ${bg} = ${r.toFixed(2)} (≥ 4.5, FR-UX-05 AC-3)`);
    }
  }
});
