// Helpers for the slice Q2 WebKit tests (L5): the views fixture in the fake core (docs/contracts/v1-views.md §5), the Q2
// test clock of docs/acceptance/views.md, locators from §4.3 and probes of the type page's tabs, view panels, boards, lanes,
// cards and the sort popover. No AC assertions here except `must` and `click` (re-exported), which turn a missing element
// into an AssertionError instead of a Playwright timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { type FakeVault } from '../ui/test/fake-core';
import {
  absent, block, blockByName, callsOf, click, description, editor, eventually, flat, isDisabled, liveRegion, main, mainName, must, mustBeOn, nfc, openNote,
  paletteDialog, paletteOptions, pseudoLocale, queryRoute, noteRoute, runCommand, seen, sidebar, sleep, startQueries, textOf, type FakeCoreHandle, type StartQueries,
} from './queries-helpers';
import { READ_COMMANDS } from './helpers';

export {
  absent, block, blockByName, callsOf, click, description, editor, eventually, flat, isDisabled, liveRegion, main, mainName, must, mustBeOn, nfc, openNote,
  paletteDialog, paletteOptions, pseudoLocale, queryRoute, noteRoute, runCommand, seen, sidebar, sleep, textOf,
};
export type { FakeCoreHandle, FakeVault };

export const REPO = resolve(import.meta.dirname, '../..');
const FX = resolve(REPO, 'tests/fixtures/vaults');
const QFX = resolve(REPO, 'tests/fixtures/queries-files');

/** The Q2 test clock (views.md): Thursday 19 Nov 2026, 10:00 in Prague. */
export const NOW = '2026-11-19T10:00:00+01:00';
export const VAULT_PATH = '/fake/Knihovna';
export const NFD = (s: string) => s.normalize('NFD');
export const qfile = (name: string) => `.tegg/queries/${nfc(name)}.yml`;
export const BOOK_YML = '.tegg/types/book.yml';
export const AUTOR_YML = '.tegg/types/autor.yml';
export const CTENI = 'Pages/Čtení 2026.md';
/** `tests/fixtures/queries-files/expected/views/<name>`. */
export const expectedView = (name: string) => readFileSync(join(QFX, 'expected/views', name), 'utf8');

/** Book paths by title (the fixture README). */
export const B = (title: string) => `Books/${nfc(title)}.md`;
export const A = (name: string) => `Autoři/${nfc(name)}.md`;
export const Q = {
  roz: 'Rozečtené', p26: 'Přečtené 2026', vyb: 'Výborné knihy', zanr: 'Podle žánru', autor: 'Podle autora', datum: 'Seskupeno podle data',
  autori: 'Autoři', obe: 'Knihy a autoři', odsud: 'Knihy odkazované odsud', odlozene: 'Odložené',
} as const;
/** R193: `All Books` (Modified ↓). */
export const ALL_BOOKS = ['Noční vlak', 'Účetní ze Žižkova', 'Dům u řeky', 'Světla přístavu', 'Zápisník z Tater', 'Kniha o horách', 'Ostrov bez jména', 'Mapa bez severu',
  'Písně z dálky', 'Sto zimních dní', 'Čarovná mapa', 'Cizí přístavy', 'Šest cest k moři', 'Kniha o čaji', 'Tiché město', 'Zahrada v dešti', 'Čtvrtá zima'];
/** R193: `Přečtené 2026` in `cs`. */
export const P26_ROWS = ['Mapa bez severu', 'Sto zimních dní', 'Cizí přístavy', 'Čarovná mapa', 'Šest cest k moři', 'Kniha o čaji', 'Tiché město', 'Zahrada v dešti'];
/** R193: the `Rozečtené` board. */
export const ROZ_LANES = [
  { id: 'option:Reading', cards: ['Noční vlak', 'Účetní ze Žižkova', 'Světla přístavu'] },
  { id: 'option:To read', cards: ['Dům u řeky', 'Kniha o horách'] },
  { id: 'option:Read', cards: [] as string[] },
];
/** R193: `Podle žánru` (horizontal). */
export const ZANR_LANES = [
  { id: 'option:Román', cards: ['Čarovná mapa', 'Dům u řeky', 'Mapa bez severu', 'Noční vlak', 'Sto zimních dní', 'Účetní ze Žižkova'] },
  { id: 'option:Detektivka', cards: ['Čtvrtá zima', 'Tiché město', 'Účetní ze Žižkova'] },
  { id: 'option:Poezie', cards: ['Písně z dálky', 'Zahrada v dešti'] },
  { id: 'option:Eseje', cards: ['Kniha o čaji', 'Sto zimních dní', 'Světla přístavu'] },
  { id: 'option:Cestopis', cards: ['Cizí přístavy', 'Čarovná mapa', 'Kniha o horách', 'Šest cest k moři', 'Zápisník z Tater'] },
  { id: 'none', cards: ['Ostrov bez jména'] },
];
/** R193: `Podle autora` (vertical, no `lanes`). */
export const AUTOR_LANES = [
  { id: `relation:${A('Eva Lindová')}`, cards: ['Cizí přístavy', 'Mapa bez severu', 'Písně z dálky', 'Světla přístavu'] },
  { id: `relation:${A('Jana Brázdová')}`, cards: ['Šest cest k moři', 'Účetní ze Žižkova', 'Zápisník z Tater'] },
  { id: `relation:${A('Lucie Horká')}`, cards: ['Čarovná mapa', 'Dům u řeky', 'Zahrada v dešti'] },
  { id: `relation:${A('Marek Sova')}`, cards: ['Čtvrtá zima', 'Kniha o čaji', 'Kniha o horách'] },
  { id: `relation:${A('Tomáš Rybář')}`, cards: ['Noční vlak', 'Sto zimních dní', 'Tiché město'] },
  { id: 'none', cards: ['Ostrov bez jména'] },
];
export const lanesOf = (l: { id: string; cards: string[] }[]) => l.map((x) => ({ id: nfc(x.id), cards: x.cards.map(B) }));

/** The views fixture plus `new-empty/.tegg` (README excluded); `edit` changes the files last. */
export function viewsVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const files: Record<string, string> = {};
  const walk = (root: string, d: string, prefix: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(root, p, prefix); continue; }
      const rel = (prefix + relative(root, p)).normalize('NFC');
      if (rel === 'README.md') continue;
      files[rel] = readFileSync(p, 'utf8');
    }
  };
  walk(join(FX, 'views'), join(FX, 'views'), '');
  walk(join(FX, 'new-empty/.tegg'), join(FX, 'new-empty/.tegg'), '.tegg/');
  edit?.(files);
  return { name: 'Knihovna', files };
}
export const original = (path: string) => viewsVault().files[nfc(path)];
export function swap(text: string | undefined, from: string, to: string): string {
  assert.ok(text !== undefined && text.includes(from), `setup: ${JSON.stringify(from)} is in the text`);
  return text!.replace(from, to);
}
/** book.yml with line 13 replaced. */
export const bookWithViews = (line: string) => swap(original(BOOK_YML), 'views: [Rozečtené, Přečtené 2026, Výborné knihy]\n', line);
/** A runtime query file in R138's create style with Q2's keys. */
export function viewQuery(o: { title: string; types?: string[]; filters?: string[]; sort?: string; limit?: number; view?: string; extra?: string[]; columns?: string[] }): string {
  return [
    `# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › ${o.title}.`, 'version: 1', `title: ${o.title}`, `types: [${(o.types ?? ['book']).join(', ')}]`, 'match: all',
    ...(o.filters?.length ? ['filters:', ...o.filters.map((f) => `  - ${f}`)] : ['filters: []']), `sort: ${o.sort ?? '{ by: title, order: asc }'}`, `limit: ${o.limit ?? 50}`,
    `view: ${o.view ?? 'board'}`, ...(o.extra ?? []), `columns: [${(o.columns ?? ['author', 'rating']).join(', ')}]`,
    'created: 2026-11-01T09:00:00+01:00', 'modified: 2026-11-01T09:00:00+01:00', '',
  ].join('\n');
}
/** Runtime `Podle stavu` (FR-QRY-05 AC-15): Book by status, no filters. */
export const podleStavu = (filters: string[] = [], match = 'all') =>
  viewQuery({ title: 'Podle stavu', filters, extra: ['group_by: status', 'lanes: vertical'] }).replace('match: all', `match: ${match}`);
/** Runtime `Podle štítku` (R193): Book by tags. */
export const podleStitku = () => viewQuery({ title: 'Podle štítku', extra: ['group_by: tags', 'lanes: vertical'], columns: ['author'] });

export const ui = (extra: Record<string, unknown> = {}) =>
  ({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, propertiesOpen: true, preview: { mode: 'hover', hoverDelay: 1000 }, ...extra }) as any;

export type StartViews = Omit<StartQueries, 'vault'> & { vault?: FakeVault; ui?: Record<string, unknown> };
export const typeRoute = (key: string) => `type/${nfc(key)}`;
/** Starts the main window on the views vault at the Q2 clock (1,440 × 900, sidebar open, panel closed). */
export async function startViews(page: Page, o: StartViews = {}): Promise<FakeCoreHandle> {
  await page.setViewportSize({ width: 1440, height: 900 });
  return startQueries(page, { now: NOW, ...o, vault: o.vault ?? viewsVault(), vaultPath: o.vaultPath ?? VAULT_PATH, uiState: o.uiState ?? ui(o.ui ?? {}) });
}

// ------------------------------------------------------------------------------------------------ §4.3 locators

const rx = (s: string) => new RegExp(`^⟦?${nfc(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}⟧?$`);
const attr = (s: string) => nfc(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
export const tablist = (page: Page) => main(page).locator('div[role="tablist"][data-views-tablist]');
export const tab = (page: Page, name: string) => tablist(page).locator(`[role="tab"][data-view-tab="${attr(name)}"]`);
export const allTab = (page: Page) => tablist(page).locator('[role="tab"][data-view-tab=""]');
export const addView = (page: Page) => main(page).locator('button[data-command="views.new"]');
export const addMenu = (page: Page) => page.getByRole('menu', { name: rx('Add view') });
export const viewMenu = (page: Page) => page.getByRole('menu', { name: rx('View actions') });
export const panelOf = (page: Page) => main(page).locator('div[role="tabpanel"]');
export const toolbar = (page: Page) => main(page).locator('div.view-toolbar');
export const filterField = (page: Page, plural = 'Books') => toolbar(page).getByRole('searchbox', { name: rx(`Filter ${plural}…`) });
export const tagFilterButton = (page: Page) => toolbar(page).getByRole('button', { name: rx('Filter by tag') });
export const toolbarMenuButton = (page: Page) => toolbar(page).locator('button[data-command="views.menu"]');
export const columnsButton = (page: Page) => toolbar(page).locator('button[data-command="view.columns"]');
export const sortButton = (scope: Locator) => scope.locator('button[data-command="sort.open"]');
export const sortDialog = (page: Page) => page.getByRole('dialog', { name: rx('Sort') });
export const sortLevels = (page: Page) => sortDialog(page).locator('[role="group"][data-sort-level]');
export const lanesGroup = (scope: Locator) => scope.locator('[role="radiogroup"][data-command="board.switchLanes"]');
export const laneRadio = (scope: Locator, which: 'Vertical' | 'Horizontal') => lanesGroup(scope).getByRole('radio', { name: rx(which) });
export const boardIn = (scope: Locator, name?: string) => scope.locator(name ? `div[role="group"][data-board][data-board-name="${attr(name)}"]` : 'div[role="group"][data-board]');
export const board = (page: Page, name?: string) => boardIn(main(page), name);
export const lane = (b: Locator, id: string) => b.locator(`section[role="region"][data-lane="${attr(id)}"]`);
export const card = (b: Locator, path: string, laneId?: string) => b.locator(`article[data-board-card="${attr(path)}"]${laneId ? `[data-lane="${attr(laneId)}"]` : ''}`);
export const laneGrip = (b: Locator, id: string) => lane(b, id).locator('[role="button"][data-command="board.laneDrag"]');
export const newInLane = (b: Locator, id: string) => lane(b, id).locator('button[data-command="board.newIn"]');
export const dropLabel = (page: Page) => page.locator('div.board-drop[role="presentation"]');
export const queriesRow = (page: Page, name: string) => main(page).locator(`tr[data-query-row="${attr(name)}"]`);

// ------------------------------------------------------------------------------------------------ probes

/** The tabs in DOM order: name (`data-view-tab`; `""` for All), text, kind, state, selected. */
export async function tabs(page: Page): Promise<{ name: string; text: string; kind: string | null; state: string | null; selected: boolean }[]> {
  return tablist(page).evaluate((l) => ([...l.querySelectorAll('[role="tab"]')] as HTMLElement[]).map((t) => ({
    name: (t.getAttribute('data-view-tab') ?? '').normalize('NFC'), text: (t.innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC'),
    kind: t.getAttribute('data-view-kind'), state: t.getAttribute('data-view-state'), selected: t.getAttribute('aria-selected') === 'true',
  }))).catch(() => []);
}
export const tabNames = async (page: Page) => (await tabs(page)).map((t) => t.name);
/** Waits until the tabs are `want` (names after `All`, which is `""`). */
export async function tabsAre(page: Page, want: string[], ms = 3000): Promise<string[]> {
  return eventually(() => tabNames(page), (n) => JSON.stringify(n) === JSON.stringify(['', ...want.map(nfc)]), ms);
}
export async function selectedTab(page: Page): Promise<string | null> {
  return (await tabs(page)).find((t) => t.selected)?.name ?? null;
}
/** Selects a view tab by a click and waits for its panel. */
export async function selectTab(page: Page, name: string) {
  await click(tab(page, name), `the tab ${name}`);
  assert.equal(await eventually(() => selectedTab(page), (s) => s === nfc(name)), nfc(name), `${name} is selected`);
}
/** The titles a view panel lists (table or list rows), in DOM order. */
export async function panelRows(page: Page): Promise<string[]> {
  return panelOf(page).evaluate((p) => {
    // D-1819: every row of a view tab's Table or List (and of All <plural>) carries data-query-result="<path>".
    const marked = [...p.querySelectorAll('[data-query-result]')] as HTMLElement[];
    return marked.map((e) => (e.getAttribute('data-query-result') ?? '').normalize('NFC').split('/').pop()!.replace(/\.md$/, ''));
  }).catch(() => []);
}
export async function panelRowsAre(page: Page, want: string[], ms = 3000): Promise<string[]> {
  return eventually(() => panelRows(page), (r) => JSON.stringify(r) === JSON.stringify(want.map(nfc)), ms);
}
/** The column headers of the selected view's table, as shown (with their markers). */
export async function panelHeaders(page: Page): Promise<string[]> {
  return panelOf(page).locator('[role="columnheader"]').evaluateAll((hs) => hs.map((h) => ((h as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim())).catch(() => []);
}
/** A board's lanes in DOM order with their card paths. */
export async function lanes(b: Locator): Promise<{ id: string; cards: string[]; label: string; excluded: boolean; drop: string | null; folded: boolean }[]> {
  return b.evaluate((el) => ([...el.querySelectorAll('section[role="region"][data-lane]')] as HTMLElement[]).map((s) => ({
    id: (s.getAttribute('data-lane') ?? '').normalize('NFC'),
    cards: ([...s.querySelectorAll('article[data-board-card]')] as HTMLElement[]).map((c) => (c.getAttribute('data-board-card') ?? '').normalize('NFC')),
    label: (s.getAttribute('aria-label') ?? '').normalize('NFC'), excluded: s.hasAttribute('data-excluded'), drop: s.getAttribute('data-drop-target'), folded: s.hasAttribute('data-folded'),
  }))).catch(() => []);
}
export async function lanesAre(b: Locator, want: { id: string; cards: string[] }[], ms = 3000) {
  const w = JSON.stringify(want);
  return eventually(async () => (await lanes(b)).map((l) => ({ id: l.id, cards: l.cards })), (l) => JSON.stringify(l) === w, ms);
}
/** Asserts a board's lanes and cards (`want` paths). */
export async function mustLanes(b: Locator, want: { id: string; cards: string[] }[], what: string, ms = 5000) {
  await must(b, `${what}: the board`, ms);
  assert.deepEqual(await lanesAre(b, want, ms), want, `${what}: lanes and cards`);
}
/** The text of a vault file in the fake (undefined: none). */
export async function fileText(core: FakeCoreHandle, rel: string): Promise<string | undefined> {
  return (await core.files())[nfc(rel)];
}
export async function fileWhen(core: FakeCoreHandle, rel: string, ok: (t: string | undefined) => boolean, ms = 3000) {
  return eventually(() => fileText(core, rel), ok, ms);
}
/** Successful vault writes so far (paths, in order). */
export const writes = (core: FakeCoreHandle) => core.writesTo();
/** Every vault file written (by any command) since the start: the calls that change files, by path. */
export async function writtenPaths(core: FakeCoreHandle): Promise<string[]> {
  const out: string[] = [];
  for (const c of await core.calls()) {
    if (c.ok === false) continue;
    const a = (c.args ?? {}) as any;
    if (c.cmd === 'type_patch') out.push(`.tegg/types/${nfc(a.key ?? a.typeKey ?? '')}.yml`);
    else if (['query_apply', 'query_create', 'query_duplicate', 'query_rename', 'query_trash', 'query_restore'].includes(c.cmd)) out.push(`${c.cmd}:${nfc(a.name ?? a.title ?? a.from ?? '')}`);
  }
  return [...out, ...(await core.writesTo())];
}
/** IPC calls that may write: everything but reads, events, the query reads and `query_view_usages`. */
const VIEW_READS = new Set(['queries_list', 'query_get', 'query_run', 'query_usages', 'query_view_usages', 'type_get', 'types_list']);
export async function writeCalls(core: FakeCoreHandle): Promise<string[]> {
  return (await core.calls()).map((c) => c.cmd).filter((c) => !READ_COMMANDS.has(c) && !VIEW_READS.has(c) && !c.startsWith('plugin:event|'));
}
/** The `views` op names of each `type_patch` call (contract §2). */
export async function viewsOps(core: FakeCoreHandle): Promise<string[][]> {
  return (await callsOf(core, 'type_patch')).flatMap((c) => (((c.args as any)?.ops ?? []) as any[]).filter((o) => o?.op === 'views').map((o) => (o.names as string[]).map(nfc)));
}
/** The `perf_mark` calls in order (contract §5 `perfMarks()`). */
export async function perfMarks(core: FakeCoreHandle): Promise<string[]> {
  return (await callsOf(core, 'perf_mark')).map((c) => String((c.args as any)?.name ?? (c.args as any)?.mark ?? ''));
}
/** `window.__TEGG_TEST__.board()` (contract §5), or null when the hook is missing. */
export async function boardHook(page: Page): Promise<{ name: string | null; lanes: { id: string; cards: string[] }[]; domCards: number }[] | null> {
  return page.evaluate(() => { const t = (window as any).__TEGG_TEST__; return typeof t?.board === 'function' ? t.board() : null; });
}
/** The UI state the app stored (machine-local). */
export async function uiState(core: FakeCoreHandle): Promise<any> {
  return (await core.uiState()) as any;
}
/** Number of `ui_state_set` calls so far. */
export async function uiWrites(core: FakeCoreHandle): Promise<number> {
  return (await callsOf(core, 'ui_state_set')).length;
}

// ------------------------------------------------------------------------------------------------ pointer

async function centre(loc: Locator, what: string): Promise<{ x: number; y: number }> {
  const bx = await (await must(loc, what)).boundingBox();
  assert.ok(bx, `${what} has a box`);
  return { x: bx!.x + bx!.width / 2, y: bx!.y + bx!.height / 2 };
}
/** A pointer drag from `from`'s centre to `to`'s centre (or an offset), in steps; `alt` holds ⌥ during the drag;
 *  `beforeUp` runs over the target before release; `esc` presses Escape instead of releasing over the target. */
export async function drag(page: Page, from: Locator, to: Locator | { dx: number; dy: number }, o: { alt?: boolean; beforeUp?: () => Promise<void>; esc?: boolean; at?: 'left' | 'centre' } = {}) {
  // D-1929 (harness): the source is scrolled into view before the press (a press under the title bar or below the
  // window presses something else), and the target while the button is held, as a user scrolls during a drag.
  await (await must(from, 'drag source')).evaluate((e) => e.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  const a = await centre(from, 'drag source');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  if (o.alt) await page.keyboard.down('Alt');
  let b: { x: number; y: number };
  if ('dx' in to) b = { x: a.x + to.dx, y: a.y + to.dy };
  else {
    await page.mouse.move(a.x + 3, a.y + 3);
    await page.mouse.move(a.x + 6, a.y + 6);
    await (await must(to, 'drop target')).evaluate((e) => e.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    if (o.at === 'left') { const bx = await (await must(to, 'drop target')).boundingBox(); b = { x: bx!.x + 4, y: bx!.y + bx!.height / 2 }; }
    else b = await centre(to, 'drop target');
  }
  const s = 'dx' in to ? a : { x: a.x + 6, y: a.y + 6 };
  for (let i = 1; i <= 12; i++) await page.mouse.move(s.x + ((b.x - s.x) * i) / 12, s.y + ((b.y - s.y) * i) / 12);
  await o.beforeUp?.();
  if (o.esc) await page.keyboard.press('Escape');
  await page.mouse.up();
  if (o.alt) await page.keyboard.up('Alt');
  await sleep(150);
}
/** Opens a view tab's menu by a right-click on the tab. */
export async function tabMenu(page: Page, name: string): Promise<Locator> {
  await (await must(tab(page, name), `the tab ${name}`)).click({ button: 'right' });
  return must(viewMenu(page), 'menu `View actions`');
}
export const menuItem = (menu: Locator, name: string) => menu.getByRole('menuitem', { name: rx(name) });
export async function menuTexts(menu: Locator): Promise<string[]> {
  return menu.getByRole('menuitem').evaluateAll((xs) => xs.map((x) => ((x as HTMLElement).innerText ?? '').split('\n')[0].replace(/\s+/g, ' ').trim()));
}
export const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
export { rx };
