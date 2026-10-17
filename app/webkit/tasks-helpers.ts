// Helpers for the MS5 slice 5A-1 WebKit tests (L5): the tasks fixture in the fake core, the injected clock, zone and
// region, locators from docs/acceptance/tasks.md R40, R43 and docs/contracts/ms5-tasks.md §6, and call probes. No AC
// assertions here except `must` (re-exported) and the `need*` lookups, which turn a missing element into an
// AssertionError instead of a Playwright timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault, type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import { READ_COMMANDS, absent, eventually, mainName, must, mustBeOn, onPage, runCommand, seen, sidebar, sleep, start, type FakeCoreHandle, type StartOptions } from './helpers';

export { absent, eventually, mainName, must, mustBeOn, onPage, runCommand, seen, sidebar, sleep };
export type { FakeCoreHandle, FakeVault };

export const nfc = (s: string) => s.normalize('NFC');
export const flat = (s: string | null | undefined) => nfc((s ?? '').replace(/\s+/g, ' ').trim());

/** The test clock (tasks.md "Test clock"): Wednesday 14 Oct, 12:00 in Prague = 03:00 in Los Angeles. */
export const NOW = '2026-10-14T12:00:00+02:00';
export const NOW_IN: Record<string, string> = { 'Europe/Prague': '2026-10-14T12:00:00+02:00', 'America/Los_Angeles': '2026-10-14T03:00:00-07:00' };
export const ZONES = ['Europe/Prague', 'America/Los_Angeles'] as const;
export const tzTag = (tz: string) => tz.replace(/\W/g, '_');

/** Tasks of tests/fixtures/vaults/tasks (README.md). */
export const T = {
  t01: 'Tasks/Zavolat Janě.md',
  t02: 'Tasks/Poslat rozpočet.md',
  t03: 'Tasks/Zalít květiny.md',
  t04: 'Tasks/Koupit dárek.md',
  t05: 'Tasks/Úklid garáže.md',
  t06: 'Tasks/Příprava prezentace.md',
  t07: 'Tasks/Obnovit pas.md',
  t08: 'Tasks/Přečíst knihu.md',
  t09: 'Tasks/Opravit kolo.md',
  t10: 'Tasks/Zaplatit fakturu.md',
  t11: 'Tasks/Objednat lístky.md',
  t12: 'Tasks/Vrátit knihy.md',
  t13: 'Tasks/Zrušená cesta.md',
  t14: 'Tasks/Bez stavu.md',
  t15: 'Tasks/Cizí stav.md',
  t16: 'Tasks/Špatné datum.md',
  t17: 'Tasks/S časem.md',
  t18: 'Tasks/Štítek v textu.md',
  t19: 'Tasks/Nákup.md',
} as const;
export type Short = keyof typeof T;
export const O = {
  porada: 'Pages/Porada.md',
  web: 'Projekty/Web.md',
  seStavem: 'Pages/Se stavem.md',
  bezHlavicky: 'Tasks/Bez hlavičky.md',
  sablona: '_templates/Task/Task.md',
  smazany: '.trash/Tasks/Smazaný úkol.md',
  d09: 'Daily/2026-10-09.md',
  taskYml: '.tegg/types/task.yml',
} as const;
/** The title of a fixture path (the file stem; T19's title is NFD in the file, NFC on screen). */
export const titleOf = (p: string) => nfc(p.split('/').pop()!.replace(/\.md$/, ''));
export const paths = (...s: Short[]) => s.map((k) => T[k]);

/** The tasks fixture plus `new-empty/.tegg` (its README.md isn't a vault file). `edit` changes files before start. */
export function tasksVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/tasks', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Úkoly' };
  delete v.files['README.md'];
  edit?.(v.files);
  return v;
}
export const original = (path: string) => tasksVault().files[nfc(path)];
export function swap(text: string | undefined, from: string, to: string): string {
  assert.ok(text !== undefined && text.includes(from), `fixture text contains ${JSON.stringify(from)}`);
  return text!.replace(from, to);
}
/** A runtime task file with the fixture's key order and default stamps. */
export function taskText(n: number, title: string, keys: string, body = ''): string {
  return `---\nid: 01JB5A0000000000000000W${String(n).padStart(3, '0')}\ntype: task\ntitle: ${title}\n${keys}created: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n${body}`;
}
/** The bytes after a 5A write at `now`: `modified` replaced in place. */
export const touched = (text: string, now = NOW) => text.replace(/^modified: .*$/m, `modified: ${now}`);

export const ui = (o: { theme?: UiStateDto['theme']; tasks?: UiStateDto['tasks'] } = {}): UiStateDto =>
  ({ version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, ...(o.tasks ? { tasks: o.tasks } : {}) });

export type TasksStart = StartOptions & {
  vault?: FakeVault;
  region?: string;
  /** ISO instant for the Playwright clock (default NOW). `install: true` installs a controllable clock. */
  now?: string;
  install?: boolean;
  /** Land on this note path (`vault_last`), else Home. */
  at?: string;
  theme?: UiStateDto['theme'];
  tasksUi?: UiStateDto['tasks'];
};

/** Starts the app on the tasks vault with the injected clock and region. The zone comes from `test.use({ timezoneId })`. */
export async function startTasks(page: Page, o: TasksStart = {}): Promise<FakeCoreHandle> {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'cs');
  const t = new Date(o.now ?? NOW);
  if (o.install) await page.clock.install({ time: t });
  else await page.clock.setFixedTime(t);
  const vault = o.vault ?? tasksVault();
  const last = o.at ? { path: nfc(o.at), id: /^id: (\S+)$/m.exec(vault.files[nfc(o.at)] ?? '')?.[1] ?? null } : null;
  return start(page, { vault, last, uiState: ui({ theme: o.theme, tasks: o.tasksUi }), ...o });
}

// ------------------------------------------------------------------------------------------------ locators (R40, R43)

export const main = (page: Page) => page.getByRole('main');
export const heading = (page: Page) => main(page).getByRole('heading', { level: 1, name: /^⟦?Tasks⟧?$/ });
export const views = (page: Page) => main(page).getByRole('tablist', { name: 'Task views', exact: true });
export const viewTab = (page: Page, name: 'Schedule' | 'Kanban') => views(page).getByRole('tab', { name, exact: true });
export const groupBy = (page: Page) => main(page).getByRole('tablist', { name: 'Group by', exact: true });
export const quickAdd = (page: Page) => main(page).getByRole('textbox', { name: 'Add a task…', exact: true });
export const dateFilter = (page: Page) => main(page).getByRole('group', { name: 'Filter', exact: true });
export const filterBtn = (page: Page, name: 'All' | 'Today' | 'This week') => dateFilter(page).getByRole('button', { name, exact: true });
export const tagFilter = (page: Page) => main(page).getByRole('group', { name: 'Filter by tag', exact: true });
export const tagBtn = (page: Page, tag: string) => tagFilter(page).getByRole('button', { name: `#${tag}`, exact: true });
export const sortBtn = (page: Page, name: string) => main(page).getByRole('button', { name, exact: true });
export const sectionOf = (page: Page, id: 'today' | 'week' | 'later' | 'none' | 'done') => main(page).locator(`[data-section="${id}"]`);
export const column = (page: Page, id: string) => main(page).locator(`[data-column="${id}"]`);
export const card = (page: Page, title: string) => main(page).getByRole('article', { name: `Task: ${title}`, exact: true });
export const cardOf = (page: Page, path: string) => main(page).locator(`[data-path="${nfc(path)}"]`).and(page.getByRole('article'));
export const checkbox = (scope: Locator, title: string) => scope.getByRole('checkbox', { name: new RegExp(`^(Complete|Mark) "${esc(title)}"( not done)?$`) });
export const moreBtn = (scope: Locator, title: string) => scope.getByRole('button', { name: `More actions for "${title}"`, exact: true });
export const cardMenu = (page: Page) => page.getByRole('menu').last();
export const liveRegion = (page: Page) => main(page).getByRole('status');
export const sidebarTasks = (page: Page) => sidebar(page).getByRole('link', { name: /^Tasks\b/ });
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Accessible description of an element (aria-describedby texts or aria-description). */
export async function description(loc: Locator): Promise<string> {
  await must(loc, 'element with a description');
  return loc.first().evaluate((e) => {
    const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return (e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
  });
}
export async function isDisabled(loc: Locator): Promise<boolean> {
  await must(loc, 'control');
  return loc.first().evaluate((e) => (e as HTMLButtonElement).disabled === true || e.getAttribute('aria-disabled') === 'true' || (e as HTMLInputElement).readOnly === true);
}
export async function pressed(loc: Locator): Promise<string | null> {
  await must(loc, 'toggle button');
  return loc.first().getAttribute('aria-pressed');
}
/** The shown text of an element, '' when it isn't shown within `ms`. */
export async function textOf(loc: Locator, ms = 3000): Promise<string> {
  return (await seen(loc, ms)) ? flat(await loc.first().innerText()) : '';
}
/** Clicks an element after asserting it is shown. */
export async function click(loc: Locator, what: string, ms = 3000) {
  const el = await must(loc, what, ms);
  const off = await el.evaluate((e) => (e as HTMLButtonElement).disabled === true || e.getAttribute('aria-disabled') === 'true');
  assert.equal(off, false, `${what} is enabled`);
  await el.click();
}

/** `data-path` of every card inside `scope`, in DOM (reading) order, NFC. */
export async function cardPaths(scope: Locator): Promise<string[]> {
  if ((await scope.count()) === 0) return [];
  return scope.first().evaluate((root) =>
    ([...root.querySelectorAll('[data-path]')] as HTMLElement[])
      .filter((e) => e.getAttribute('role') === 'article' || e.tagName === 'ARTICLE')
      .map((e) => (e.getAttribute('data-path') ?? '').normalize('NFC')));
}
/** Day and group headings (level 3) of a section with the card paths under each, in order. */
export async function groupsOf(scope: Locator): Promise<{ heading: string; paths: string[] }[]> {
  if ((await scope.count()) === 0) return [];
  return scope.first().evaluate((root) => {
    const out: { heading: string; paths: string[] }[] = [];
    for (const e of root.querySelectorAll('h3, [role="heading"][aria-level="3"], article[data-path], [role="article"][data-path]') as NodeListOf<HTMLElement>) {
      if (/^h3$/i.test(e.tagName) || e.getAttribute('aria-level') === '3') out.push({ heading: (e.textContent ?? '').replace(/\s+/g, ' ').trim().normalize('NFC'), paths: [] });
      else if (out.length) out[out.length - 1].paths.push((e.getAttribute('data-path') ?? '').normalize('NFC'));
    }
    return out;
  });
}
/** Sections shown on Schedule, in order (`data-section`). */
export async function sectionIds(page: Page): Promise<string[]> {
  return main(page).evaluate((m) => ([...m.querySelectorAll('[data-section]')] as HTMLElement[]).map((e) => e.getAttribute('data-section') ?? ''));
}
/** Kanban columns shown, in order (`data-column`). */
export async function columnIds(page: Page): Promise<string[]> {
  return main(page).evaluate((m) => ([...m.querySelectorAll('[data-column]')] as HTMLElement[]).map((e) => (e.getAttribute('data-column') ?? '').normalize('NFC')));
}
export async function columns(page: Page): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const id of await columnIds(page)) out[id] = await cardPaths(column(page, id));
  return out;
}
/** Every card path shown on the page (any section, column or group), unique, in order. */
export async function allCards(page: Page): Promise<string[]> {
  return [...new Set(await cardPaths(main(page)))];
}
export async function attr(loc: Locator, name: string): Promise<string | null> {
  return (await seen(loc, 3000)) ? loc.first().getAttribute(name) : null;
}
/** The live region's texts (polite `status` elements of the page). */
export async function liveTexts(page: Page): Promise<string[]> {
  return (await liveRegion(page).allInnerTexts()).map(flat);
}

/** R44 short date of the region: `Intl.DateTimeFormat(region, { weekday: 'short', day: 'numeric', month: 'short' })`. */
export function shortDate(date: string, region: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(region, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}

// ------------------------------------------------------------------------------------------------ navigation

/** `Go to Tasks` from the palette, then the page heading. */
export async function gotoTasks(page: Page, how: 'palette' | 'sidebar' = 'palette') {
  if (how === 'sidebar') await (await must(sidebarTasks(page), 'sidebar entry Tasks')).click();
  else await runCommand(page, 'Go to Tasks');
  await must(heading(page), 'heading "Tasks" (R40)', 5000);
}
export async function gotoKanban(page: Page, group: 'Status' | 'Tag' = 'Status') {
  await gotoTasks(page);
  await (await must(viewTab(page, 'Kanban'), 'tab Kanban')).click();
  await must(groupBy(page), 'tablist "Group by" (Kanban)', 3000);
  await (await must(groupBy(page).getByRole('tab', { name: group, exact: true }), `tab ${group}`)).click();
  await sleep(100);
}
/** Waits until a section (or column) holds exactly `want`; returns the last value. */
export async function cardsWhen(scope: Locator, want: string[], ms = 2000): Promise<string[]> {
  return eventually(() => cardPaths(scope), (v) => JSON.stringify(v) === JSON.stringify(want), ms);
}

/** Drags `from` onto `to` with pointer events (D-479); `alt` holds Alt during the drag. `during` runs before the drop. */
export async function drag(page: Page, from: Locator, to: Locator, o: { alt?: boolean; during?: () => Promise<void> } = {}) {
  // The board scrolls sideways (FR-TSK-05 AC-12): bring each end into view before using its box.
  const src = await must(from, 'drag source');
  await src.scrollIntoViewIfNeeded();
  const a = await src.boundingBox();
  assert.ok(a, 'drag source is on screen');
  if (o.alt) await page.keyboard.down('Alt');
  await page.mouse.move(a!.x + a!.width / 2, a!.y + Math.min(20, a!.height / 2));
  await page.mouse.down();
  await page.mouse.move(a!.x + a!.width / 2 + 10, a!.y + 30, { steps: 4 });
  const dst = await must(to, 'drop target');
  await dst.scrollIntoViewIfNeeded();
  const b = await dst.boundingBox();
  assert.ok(b, 'drop target is on screen');
  await page.mouse.move(b!.x + b!.width / 2, b!.y + Math.min(b!.height / 2, 120), { steps: 12 });
  if (o.during) await o.during();
  await page.mouse.up();
  if (o.alt) await page.keyboard.up('Alt');
  await sleep(150);
}

// ------------------------------------------------------------------------------------------------ calls and files

/** Read-only commands: helpers.ts plus ms5-tasks §3. Every other command counts as a write. */
export const TASK_READS = new Set([...READ_COMMANDS, 'task_list', 'daily_tasks']);
export async function writeCalls(core: FakeCoreHandle): Promise<string[]> {
  return (await core.calls()).map((c) => c.cmd).filter((c) => !TASK_READS.has(c) && !c.startsWith('plugin:'));
}
export async function callsOf(core: FakeCoreHandle, cmd: string) {
  return (await core.calls()).filter((c) => c.cmd === cmd);
}
/** `note_write` calls to `path`, in order. */
export async function writesOf(core: FakeCoreHandle, path: string) {
  return (await callsOf(core, 'note_write')).filter((c) => nfc(String((c.args as any)?.path ?? '')) === nfc(path));
}
export async function fileText(core: FakeCoreHandle, path: string): Promise<string | undefined> {
  return (await core.files())[nfc(path)];
}
export async function fileWhen(core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean, ms = 2000): Promise<string | undefined> {
  return eventually(() => fileText(core, path), ok, ms);
}
/** Successful writes per path since `from` (an index into `writesTo()`). */
export async function writtenSince(core: FakeCoreHandle, from: number): Promise<string[]> {
  return (await core.writesTo()).slice(from).map(nfc);
}
/** Paths routed by `nav_opened`, in order. */
export async function navs(core: FakeCoreHandle): Promise<string[]> {
  return (await callsOf(core, 'nav_opened')).map((c) => nfc(String((c.args as any)?.path ?? (c.args as any)?.route ?? '')));
}
