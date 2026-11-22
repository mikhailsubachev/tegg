// Helpers for the slice Q2-T WebKit tests (L5): the tasks base fixture and the `views-tasks` overlay
// (tests/fixtures/vaults/views-tasks/README.md) in the fake core, the tasks test clock, regions and zones, the expected
// bytes of tests/fixtures/queries-files/expected/views-tasks/, and locators and probes for period boards, day groups, the
// done lane, Task cards on boards, the tag filter on view tabs and the Tasks summary (docs/contracts/v1-views.md §29,
// §30.1, §31.1). No AC assertions here except `must` and `click` (re-exported) and `expectedTasks`, which turn a missing
// element or a missing expected file into an AssertionError instead of a timeout or a thrown error (TS-I1).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import { pseudoLocale, start, type StartOptions } from './helpers';
import { NOW, NOW_IN, O, T, ZONES, flat, nfc, paths, shortDate, swap, tasksVault, titleOf, touched, tzTag, type FakeCoreHandle, type Short } from './tasks-helpers';
import {
  absent, allTab, board, callsOf, card as boardCard, click, description, drag, eventually, isDisabled, lane, laneGrip, laneRadio, lanesGroup, liveRegion, main, mainName, menuItem,
  menuTexts, must, mustBeOn, newInLane, panelOf, panelRows, panelRowsAre, paletteDialog, paletteOptions, runCommand, rx, seen, selectTab, selectedTab, sidebar, sleep, sortButton,
  sortDialog, sortLevels, tab, tablist, tabs, tabsAre, tabNames, tagFilterButton, textOf, toolbar, toolbarMenuButton, uiState, uiWrites, viewMenu, writeCalls, dropLabel, tabMenu, addView, addMenu, editor,
  boardHook, queriesRow,
} from './views-helpers';

export {
  NOW, NOW_IN, O, T, ZONES, flat, nfc, paths, shortDate, swap, titleOf, touched, tzTag, absent, allTab, board, boardCard, callsOf, click, description, drag, eventually,
  isDisabled, lane, laneGrip, laneRadio, lanesGroup, liveRegion, main, mainName, menuItem, menuTexts, must, mustBeOn, newInLane, panelOf, panelRows, panelRowsAre,
  paletteDialog, paletteOptions, runCommand, rx, seen, selectTab, selectedTab, sidebar, sleep, sortButton, sortDialog, sortLevels, tab, tablist, tabs, tabsAre, tabNames,
  tagFilterButton, textOf, toolbar, toolbarMenuButton, uiState, uiWrites, viewMenu, writeCalls, dropLabel, tabMenu, addView, addMenu, editor, boardHook, queriesRow, pseudoLocale,
};
export type { FakeCoreHandle, FakeVault, Short };

const REPO = resolve(import.meta.dirname, '../..');
const OVERLAY = resolve(REPO, 'tests/fixtures/vaults/views-tasks');
const EXPECTED = resolve(REPO, 'tests/fixtures/queries-files/expected/views-tasks');

export const TASK_YML = O.taskYml;
export const PROJEKT_YML = '.tegg/types/projekt.yml';
export const qfile = (name: string) => `.tegg/queries/${nfc(name)}.yml`;
export const SCHEDULE = 'Schedule';
export const KANBAN = 'Kanban';
export const CEKA = 'Čeká na ostatní';
export const PROJEKTY_BOARD = 'Projekty podle termínu';
/** Projects of the base and the overlay (README). */
export const PR = { web: 'Projekty/Web.md', stehovani: 'Projekty/Stěhování.md', zahrada: 'Projekty/Zahrada.md', kucharka: 'Projekty/Kuchařka.md' } as const;
/** R208: `15 open · 2 overdue · 1 done this week`. */
export const SUMMARY = '15 open · 2 overdue · 1 done this week';

/** `tests/fixtures/queries-files/expected/views-tasks/<rel>` (written with the red tests by part A); a missing file is an
 *  assertion failure, not a thrown error (TS-I1). */
export function expectedTasks(rel: string): string {
  const p = join(EXPECTED, rel);
  assert.ok(existsSync(p), `expected bytes tests/fixtures/queries-files/expected/views-tasks/${rel} exist`);
  return readFileSync(p, 'utf8');
}
/** A file of the overlay folder. */
export const overlayFile = (rel: string) => readFileSync(join(OVERLAY, rel), 'utf8');

/** The base fixture (tasks + new-empty/.tegg), as the migration criteria use it. */
export function baseVault(edit?: (files: Record<string, string>) => void): FakeVault {
  return tasksVault(edit);
}
/** The overlay: tasks, then new-empty/.tegg, then views-tasks/ (README excluded; it replaces task.yml), then `edit`. */
export function overlayVault(edit?: (files: Record<string, string>) => void): FakeVault {
  return tasksVault((files) => {
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        const rel = relative(OVERLAY, p).normalize('NFC');
        if (rel === 'README.md') continue;
        files[rel] = readFileSync(p, 'utf8');
      }
    };
    walk(OVERLAY);
    edit?.(files);
  });
}
export const overlayOriginal = (path: string) => overlayVault().files[nfc(path)];
export const baseOriginal = (path: string) => baseVault().files[nfc(path)];

/** `task.yml` of the overlay with line 11 replaced. */
export const taskYmlWithViews = (line: string) => swap(overlayOriginal(TASK_YML), 'views: [Schedule, Kanban, Čeká na ostatní]\n', line);
/** A copy of an overlay query file under another title (and file name), with optional text swaps. */
export function queryCopy(from: string, title: string, swaps: [string, string][] = []): string {
  let t = overlayOriginal(qfile(from));
  t = swap(t, `Queries › ${from}.`, `Queries › ${title}.`);
  t = swap(t, `title: ${from}\n`, `title: ${title}\n`);
  for (const [a, b] of swaps) t = swap(t, a, b);
  return t;
}
/** Runtime `Podle štítků` (FR-TSK-05 AC-21): `Kanban.yml` with `group_by: tags`. */
export const podleStitku = () => queryCopy(KANBAN, 'Podle štítků', [['group_by: status\n', 'group_by: tags\n']]);

export const ui = (extra: Record<string, unknown> = {}): UiStateDto =>
  ({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, propertiesOpen: true, preview: { mode: 'off' }, ...extra }) as UiStateDto;

export type StartTasksViews = StartOptions & {
  vault?: FakeVault;
  /** Start on this route (`window.__TEGG_ROUTE__`), e.g. `type/task`, `tasks`, `tasks/kanban`. */
  route?: string;
  region?: string;
  now?: string;
  install?: boolean;
  theme?: 'light' | 'dark';
  pseudo?: boolean;
  reducedMotion?: 'reduce' | 'no-preference';
  /** Extra UI state keys (merged into `ui()`), unless `uiState` is given. */
  ui?: Record<string, unknown>;
  /** §31.1: the fake core runs the migration (R202) on the launch vault and in `vault_open` / `vault_create`. */
  taskViews?: boolean;
};
/** Starts the main window at the tasks clock (zone from `test.use({ timezoneId })`, region `cs` by default, preview `off`,
 *  1,440 × 900, sidebar open, panel closed) on the overlay unless `vault` is given. */
export async function startTasksViews(page: Page, o: StartTasksViews = {}): Promise<FakeCoreHandle> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'cs');
  if (o.route) await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, o.route);
  if (o.reducedMotion) await page.emulateMedia({ reducedMotion: o.reducedMotion });
  const t = new Date(o.now ?? NOW);
  if (o.install) await page.clock.install({ time: t }); else await page.clock.setFixedTime(t);
  const region = o.region && o.region !== 'cs' ? `import { setCollationLocale as __tcl } from '/src/i18n/collate.ts'; __tcl(${JSON.stringify(o.region)});` : '';
  const prelude = [region, o.pseudo ? pseudoLocale : ''].filter(Boolean).join('\n') || undefined;
  const uiState = o.uiState ?? ui({ ...(o.theme ? { theme: o.theme } : {}), ...(o.ui ?? {}) });
  // `taskViews` is the fake option of §31.1 (FakeOptions gains it with the build); passed through as given.
  const extra = (o.taskViews ? { taskViews: true } : {}) as Record<string, unknown>;
  return start(page, { ...(prelude ? { prelude } : {}), ...o, ...extra, vault: o.vault ?? overlayVault(), vaultPath: o.vaultPath ?? '/fake/Úkoly', uiState, previewStored: 'asGiven' } as StartOptions);
}
export const TYPE_TASK = 'type/task';

// ------------------------------------------------------------------------------------------------ §30.1 locators

export const tasksHeading = (page: Page) => main(page).getByRole('heading', { level: 1, name: rx('Tasks') });
export const tasksSummary = (page: Page) => main(page).locator('p.type-page-count[data-tasks-summary]');
export const typeSettingsButton = (page: Page) => main(page).getByRole('button', { name: rx('Type settings') });
export const newTaskButton = (page: Page) => main(page).getByRole('button', { name: rx('New Task') });
export const filterTasks = (page: Page) => toolbar(page).getByRole('searchbox', { name: rx('Filter Tasks…') });
export const sidebarTasks = (page: Page) => sidebar(page).getByRole('link', { name: /^⟦?Tasks\b/ });
/** Things the 5A page had (R204 "Gone"). */
export const gone = (page: Page) => ({
  quickAdd: main(page).getByRole('textbox', { name: /Add a task…/ }),
  quickAddAttr: main(page).locator('[data-quick-add]'),
  dateFilter: main(page).getByRole('group', { name: rx('Filter') }),
  groupBy: main(page).getByRole('tablist', { name: rx('Group by') }),
  taskViews: main(page).getByRole('tablist', { name: rx('Task views') }),
  disabledSort: main(page).locator('[aria-disabled="true"]').filter({ hasText: /^⟦?Sort/ }),
});
export const scheduleBoard = (page: Page) => board(page, SCHEDULE);
export const kanbanBoard = (page: Page) => board(page, KANBAN);
export const dayGroup = (b: Locator, date: string) => lane(b, 'period:week').locator(`div[role="group"][data-day="${date}"]`);
export const doneLane = (b: Locator) => lane(b, 'done');
export const doneToggle = (b: Locator) => doneLane(b).getByRole('button', { name: /^⟦?(Expand|Collapse) Done⟧?$/ });
/** A Task card on a board (`article[data-board-card][data-task-card]`), optionally in a lane. */
export const taskCard = (b: Locator, path: string, laneId?: string) =>
  (laneId ? lane(b, laneId) : b).locator(`article[data-board-card="${nfc(path).replace(/"/g, '\\"')}"]`);
export const taskCheckbox = (c: Locator, title: string) => c.getByRole('checkbox', { name: new RegExp(`^⟦?(Complete|Mark) "${esc(nfc(title))}"( not done)?⟧?$`) });
export const taskMore = (c: Locator, title: string) => c.getByRole('button', { name: new RegExp(`^⟦?More actions for "${esc(nfc(title))}"⟧?$`) });
export const dueChip = (c: Locator) => c.locator('[data-due]');
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------------------------------------------ probes

export type DayProbe = { date: string; label: string; drop: string | null; cards: string[] };
export type LaneProbe = { id: string; kind: string | null; label: string; drop: string | null; folded: boolean; hint: string; tone: string | null; cards: string[]; days: DayProbe[] };
/** A board's lanes in DOM order: id, kind, accessible name, drop target, fold, hint, heading tone, card paths (all of the
 *  lane, day groups included) and its day groups. */
export async function periodLanes(b: Locator): Promise<LaneProbe[]> {
  return b.evaluate((el) => ([...el.querySelectorAll('section[role="region"][data-lane]')] as HTMLElement[]).map((s) => {
    const cardsOf = (r: Element) => ([...r.querySelectorAll('article[data-board-card]')] as HTMLElement[]).map((c) => (c.getAttribute('data-board-card') ?? '').normalize('NFC'));
    const h = s.querySelector('h2');
    return {
      id: (s.getAttribute('data-lane') ?? '').normalize('NFC'), kind: s.getAttribute('data-lane-kind'), label: (s.getAttribute('aria-label') ?? '').normalize('NFC'),
      drop: s.getAttribute('data-drop-target'), folded: s.hasAttribute('data-folded'), hint: (s.querySelector('p.lane-hint')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      tone: h?.getAttribute('data-tone') ?? null, cards: cardsOf(s),
      days: ([...s.querySelectorAll('div[role="group"][data-day]')] as HTMLElement[]).map((g) => ({
        date: g.getAttribute('data-day') ?? '', label: (g.getAttribute('aria-label') ?? '').normalize('NFC'), drop: g.getAttribute('data-drop-target'), cards: cardsOf(g),
      })),
    };
  })).catch(() => []);
}
/** `[id, cards]` of each lane, and `[date, cards]` of each day group for the `week` lane. */
export async function laneShape(b: Locator): Promise<{ id: string; cards: string[]; days?: { date: string; cards: string[] }[] }[]> {
  return (await periodLanes(b)).map((l) => (l.days.length ? { id: l.id, cards: l.cards, days: l.days.map((d) => ({ date: d.date, cards: d.cards })) } : { id: l.id, cards: l.cards }));
}
/** Waits until the board's shape is `want`; returns the last shape. */
export async function shapeWhen(b: Locator, want: unknown, ms = 3000) {
  const w = JSON.stringify(want);
  return eventually(() => laneShape(b), (s) => JSON.stringify(s) === w, ms);
}
/** The cards of one lane (all, day groups included). */
export async function laneCards(b: Locator, id: string): Promise<string[]> {
  return (await periodLanes(b)).find((l) => l.id === id)?.cards ?? [];
}
export async function laneCardsWhen(b: Locator, id: string, ok: (cards: string[]) => boolean, ms = 3000) {
  return eventually(() => laneCards(b, id), ok, ms);
}
/** The lane id (and day) holding `path`, or null. */
export async function whereIs(b: Locator, path: string): Promise<{ lane: string; day: string | null } | null> {
  for (const l of await periodLanes(b)) {
    if (!l.cards.includes(nfc(path))) continue;
    const d = l.days.find((x) => x.cards.includes(nfc(path)));
    return { lane: l.id, day: d?.date ?? null };
  }
  return null;
}

/** The selected tab, the board of the selected view tab and its name. */
export async function openTasks(page: Page, tabName = SCHEDULE): Promise<Locator> {
  await must(tab(page, tabName), `the tab ${tabName}`, 8000);
  if ((await selectedTab(page)) !== nfc(tabName)) await selectTab(page, tabName);
  return must(board(page, tabName), `the board ${tabName}`, 5000);
}

/** The vault writes so far (paths of `note_write` / `note_create`, in order, NFC). */
export const writesTo = async (core: FakeCoreHandle) => (await core.writesTo()).map(nfc);
/** `note_write` calls to `path`. */
export async function noteWrites(core: FakeCoreHandle, path: string) {
  return (await callsOf(core, 'note_write')).filter((c) => nfc(String((c.args as any)?.path ?? '')) === nfc(path));
}
export async function fileText(core: FakeCoreHandle, rel: string): Promise<string | undefined> {
  return (await core.files())[nfc(rel)];
}
export async function fileWhen(core: FakeCoreHandle, rel: string, ok: (t: string | undefined) => boolean, ms = 3000) {
  return eventually(() => fileText(core, rel), ok, ms);
}
/** Every vault file changed or created against `before` (NFC paths, sorted). */
export async function changedFiles(core: FakeCoreHandle, before: Record<string, string>): Promise<string[]> {
  const now = await core.files();
  const keys = new Set([...Object.keys(before), ...Object.keys(now)]);
  return [...keys].filter((k) => before[k] !== now[k]).map(nfc).sort();
}
/** The IPC commands that may write (views-helpers' list plus `task_views_restore`, which isn't a read). */
export async function mutatingCalls(core: FakeCoreHandle): Promise<string[]> {
  return (await writeCalls(core)).filter((c) => !['task_list', 'daily_tasks', 'ui_state_set'].includes(c));
}

// ------------------------------------------------------------------------------------------------ the tag filter (§29.6)

export const tagList = (page: Page) => page.getByRole('listbox', { name: rx('Tags') });
export const tagOptionLoc = (page: Page, key: string) => tagList(page).locator(`[role="option"][data-tag="${nfc(key)}"]`);
/** Opens the tag filter of the current toolbar (the `Filter by tag` button or combobox). */
export async function openTagFilter(page: Page) {
  if (await seen(tagList(page), 200)) return;
  const b = toolbar(page).getByRole('button', { name: rx('Filter by tag') }).or(toolbar(page).getByRole('combobox', { name: rx('Filter by tag') })).first();
  await click(b, '`Filter by tag`');
  await must(tagList(page), 'listbox `Tags`');
}
/** The open list's options as `<key> <count>` strings (count = the option's description, D-518). */
export async function tagOptionTexts(page: Page): Promise<string[]> {
  if (!(await seen(tagList(page), 1000))) return [];
  return tagList(page).first().evaluate((l) => ([...l.querySelectorAll('[role="option"]')] as HTMLElement[]).map((o) => {
    const ids = (o.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const d = (o.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
    return `#${(o.getAttribute('data-tag') ?? '').normalize('NFC')} ${d}`;
  }));
}
/** Selects a tag from the open list by clicking its option. */
export async function pickTag(page: Page, key: string) {
  await openTagFilter(page);
  await click(tagOptionLoc(page, key), `option #${key}`);
  await sleep(150);
}
/** The selected tags shown as chips in the toolbar (`data-tag`, not options, not on cards). */
export async function tagChips(page: Page): Promise<string[]> {
  return toolbar(page).evaluate((m) => ([...m.querySelectorAll('[data-tag]')] as HTMLElement[])
    .filter((e) => e.getAttribute('role') !== 'option' && !e.closest('[role="listbox"], article'))
    .map((e) => (e.getAttribute('data-tag') ?? '').normalize('NFC'))).catch(() => []);
}

// ------------------------------------------------------------------------------------------------ R208 expectations

/** R208's `Schedule` in `cs` and Europe/Prague at the test clock. */
export function scheduleCs(): { id: string; cards: string[]; days?: { date: string; cards: string[] }[] }[] {
  return [
    { id: 'period:today', cards: paths('t01', 't02', 't03', 't14') },
    { id: 'period:week', cards: paths('t04', 't19', 't15', 't05'), days: [
      { date: '2026-10-15', cards: paths('t04', 't19') }, { date: '2026-10-16', cards: paths('t15') }, { date: '2026-10-17', cards: [] }, { date: '2026-10-18', cards: paths('t05') },
    ] },
    { id: 'period:later', cards: paths('t06', 't07') },
    { id: 'none', cards: paths('t08', 't09', 't17', 't16', 't18') },
    { id: 'done', cards: [] }, // folded: no card in the DOM
  ];
}
/** The same in `en-US` (week Sunday–Saturday). */
export function scheduleEnUs(): ReturnType<typeof scheduleCs> {
  return [
    { id: 'period:today', cards: paths('t01', 't02', 't03', 't14') },
    { id: 'period:week', cards: paths('t04', 't19', 't15'), days: [{ date: '2026-10-15', cards: paths('t04', 't19') }, { date: '2026-10-16', cards: paths('t15') }, { date: '2026-10-17', cards: [] }] },
    { id: 'period:later', cards: paths('t05', 't06', 't07') },
    { id: 'none', cards: paths('t08', 't09', 't17', 't16', 't18') },
    { id: 'done', cards: [] },
  ];
}
/** R208's `Kanban` lanes (`option:<label>`, `unknown:<value>`, `none`; part one's id scheme). */
export function kanbanLanes(): { id: string; cards: string[] }[] {
  return [
    { id: 'option:To do', cards: paths('t01', 't03', 't19', 't05', 't06', 't07', 't08', 't17', 't16', 't18') },
    { id: 'option:In progress', cards: paths('t02', 't09') },
    { id: 'option:Waiting', cards: paths('t04') },
    { id: 'option:Done', cards: paths('t10', 't12') },
    { id: 'unknown:Rozpracováno', cards: paths('t15') },
    { id: 'none', cards: paths('t14') },
  ];
}

/** The text of the focused element (accessible name or text). */
export async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return '';
    return (a.getAttribute('aria-label') ?? a.textContent ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
  });
}
/** The vault-relative path of the focused board card, or null. */
export async function focusedCard(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    const c = a?.closest('article[data-board-card]');
    return c ? (c.getAttribute('data-board-card') ?? '').normalize('NFC') : null;
  });
}
export const history = (page: Page) => page.evaluate(() => history.length);
