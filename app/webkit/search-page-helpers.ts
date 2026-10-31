// Helpers for the Search page redesign WebKit tests (L5): the `search/` + `search-page/` vault in the fake core
// (docs/contracts/v1-search.md §2, §4, D-1222), the test clock, region and Date & time setting of the AC section's
// "Layers", and locators from its "Page elements" table and v1-search §3. No AC assertions here except `must` and
// `click` (re-exported), which turn a missing element into an AssertionError instead of a Playwright timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault, type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import { callsOf, click, description, eventually, flat, focusName, main, must, nfc, seen, sleep } from './capture-helpers';
import { searchQueryField, start, type FakeCoreHandle } from './helpers';
import { goToList, searchQuery } from './v068-helpers';

export { callsOf, click, description, eventually, flat, focusName, goToList, main, must, nfc, searchQuery, seen, sleep };
export type { FakeCoreHandle, FakeVault };

/** The test clock: Wednesday 14 Oct 2026, 12:00 in Prague. */
export const NOW = '2026-10-14T12:00:00+02:00';

/** Paths of the combined vault (search-navigation.md fixture tables). */
export const P = {
  cteni: 'Pages/Čtení knih.md', rozpocet: 'Pages/Rozpočet 2026.md', projekt: 'Pages/Projekt a rozpočet.md', tomas: 'Tasks/Zavolat Tomášovi.md',
  napad: 'Quick Notes/Nápad na výlet.md', obycejna: 'Pages/Obyčejná poznámka.md',
  chata: 'Pages/Chata na horách.md', pozdni: 'Quick Notes/Pozdní zápis.md', bouda: 'Pages/Horská bouda.md',
} as const;
export const T = {
  cteni: 'Čtení knih', rozpocet: 'Rozpočet 2026', projekt: 'Projekt a rozpočet', tomas: 'Zavolat Tomášovi', napad: 'Nápad na výlet',
  obycejna: 'Obyčejná poznámka', chata: 'Chata na horách', pozdni: 'Pozdní zápis', bouda: 'Horská bouda',
} as const;

/** `search/`, then `search-page/`, then `new-empty/.tegg/` (D-1222). `edit` changes files before start. */
export function pageVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/search', 'tests/fixtures/vaults/search-page', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Hledání' };
  edit?.(v.files);
  return v;
}
/** FR-SRC-03 AC-12's 60 runtime notes `Pages/Hromada 01.md` … `Hromada 60.md`. */
export const hromada = (i: number) => `Pages/Hromada ${String(i).padStart(2, '0')}.md`;
export function addHromada(files: Record<string, string>) {
  for (let i = 1; i <= 60; i++) {
    const min = 10 * 60 + i;
    const hm = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    files[hromada(i)] = `---\ntype: page\ntags: [hromada]\nmodified: 2026-08-01T${hm}:00+02:00\n---\nPoznámka číslo ${i}: ostružiník.\n`;
  }
}

export type DateSetting = 'iso' | 'region' | 'long';
export const ui = (o: { theme?: UiStateDto['theme']; date?: DateSetting } = {}): UiStateDto =>
  ({ version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, dateTime: { date: o.date ?? 'iso', time: '24', week: 'region' } } as UiStateDto);

export type StartPage = { vault?: FakeVault; date?: DateSetting; theme?: UiStateDto['theme']; prelude?: string; region?: string; route?: string | null };
/** Starts the main window on `search` (region `cs-CZ`, Date format `ISO`, the test clock; zone from `test.use`). */
export async function startPage(page: Page, o: StartPage = {}): Promise<FakeCoreHandle> {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'cs-CZ');
  if (o.route !== null) await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, o.route ?? 'search');
  await page.clock.setFixedTime(new Date(NOW));
  const core = await start(page, { vault: o.vault ?? pageVault(), uiState: ui({ theme: o.theme, date: o.date }), ...(o.prelude ? { prelude: o.prelude } : {}) });
  if (o.route !== null) await must(searchQueryField(page), 'the search route: field "Search query"', 5000);
  return core;
}

// ------------------------------------------------------------------------------------------------ page elements

export const heading = (page: Page) => main(page).getByRole('heading', { level: 1, name: 'Search', exact: true });
export const searchRegion = (page: Page) => main(page).getByRole('search');
export const clearSearchBtn = (page: Page) => main(page).getByRole('button', { name: 'Clear search', exact: true });
export const filtersGroup = (page: Page) => main(page).getByRole('group', { name: 'Filters', exact: true });
export const typeBtn = (page: Page) => filtersGroup(page).getByRole('button', { name: /^Type: / });
export const typeMenu = (page: Page) => page.getByRole('menu', { name: 'Type', exact: true });
export const tagFilter = (page: Page) => main(page).getByRole('combobox', { name: 'Filter by tag', exact: true });
export const tagInput = (page: Page) => tagFilter(page).locator('xpath=self::input | .//input').first();
export const clearFiltersBtn = (page: Page) => filtersGroup(page).getByRole('button', { name: 'Clear filters', exact: true });
export const results = (page: Page) => main(page).getByRole('list', { name: 'Search results', exact: true });
export const rowItems = (page: Page) => results(page).getByRole('listitem');
export const rowLink = (page: Page, title: string) => results(page).getByRole('link', { name: nfc(title), exact: true });
export const rowOf = (page: Page, title: string) => rowItems(page).filter({ has: page.getByRole('link', { name: nfc(title), exact: true }) });
export const showNextBtn = (page: Page) => main(page).getByRole('button', { name: /^Show next \d+$/ });
export const emptyState = (page: Page, title: string) => main(page).getByRole('region', { name: nfc(title), exact: true });
export const removeChip = (page: Page, name: string) => main(page).getByRole('button', { name: `Remove #${nfc(name)}`, exact: true });

/** Types `text` into `Search query` (replacing it). */
export async function typeQuery(page: Page, text: string) {
  const f = await must(searchQuery(page), 'searchbox "Search query"');
  await f.fill(text);
}
/** Opens the Type filter's menu and chooses `name` (`All types`, or a type's name followed by its count). */
export async function chooseType(page: Page, name: string) {
  await click(typeBtn(page), 'the Type filter button (Type: …)');
  const menu = await must(typeMenu(page), 'menu "Type"');
  const item = name === 'All types' ? menu.getByRole('menuitemradio', { name: 'All types', exact: true }) : menu.getByRole('menuitemradio', { name: new RegExp(`^${name} \\d+$`) });
  await click(item, `menuitemradio ${name}`);
}
/** Adds a tag to `Filter by tag` (tags.md AC-10's combobox): type, then ⏎. */
export async function addTag(page: Page, typed: string) {
  await click(tagInput(page), 'combobox "Filter by tag"');
  await page.keyboard.type(typed);
  await sleep(150);
  await page.keyboard.press('Enter');
  await must(removeChip(page, typed), `the filter chip #${typed}`);
}

/** The count line (`status` in main with a number of results or objects), or null. The text of buttons inside it
 *  (D-1343's create buttons, if the build puts them there) is left out, so the count reads the same either way. */
export async function countLine(page: Page): Promise<string | null> {
  const texts = (await main(page).getByRole('status').evaluateAll((els) => els.map((e) => {
    let t = (e as HTMLElement).innerText ?? '';
    for (const b of e.querySelectorAll('button')) t = t.replace((b as HTMLElement).innerText ?? '', ' ');
    return t;
  })).catch(() => [] as string[])).map(flat);
  return texts.find((t) => /^⟦?\d+ (results?|objects?)\b/.test(t)) ?? null;
}
export async function countWhen(page: Page, want: string | null, ms = 3000): Promise<string | null> {
  return eventually(() => countLine(page), (c) => c === want, ms);
}

export type Row = {
  title: string; titleMarks: string[]; titleUser: boolean; titleHtml: boolean; typo: string; type: string; date: string; datetime: string | null;
  line: string; lineKind: string; lineMarks: string[]; snippet: string; snippetMarks: string[]; chips: string[]; chipTexts: string[];
  chipsOutsideLink: boolean; icon: string | null; link: string;
};
/** Every row of `Search results` with the parts of v1-search §3 "Row parts". */
export async function rows(page: Page): Promise<Row[]> {
  if (!(await seen(results(page), 500))) return [];
  return rowItems(page).evaluateAll((lis) => lis.map((li) => {
    const t = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
    const marks = (e: Element | null | undefined) => (e ? [...e.querySelectorAll('mark')].map((m) => t(m)) : []);
    const link = li.querySelector('a, [role="link"]');
    const title = li.querySelector('.title');
    const line = li.querySelector('.file-name, .alias, .attribute');
    const time = li.querySelector('time.modified');
    const chips = [...li.querySelectorAll('button')].filter((b) => !(link && link.contains(b)));
    return {
      title: t(title), titleMarks: marks(title), titleUser: !!title && (title.hasAttribute('data-user-content') || !!title.closest('[data-user-content]')),
      titleHtml: !!title && title.querySelectorAll('b, i, script, img').length > 0,
      typo: t(li.querySelector('.typo')), type: t(li.querySelector('.type')), date: t(time), datetime: time?.getAttribute('datetime') ?? null,
      line: t(line), lineKind: line ? ['file-name', 'alias', 'attribute'].find((c) => line.classList.contains(c)) ?? '' : '', lineMarks: marks(line),
      snippet: t(li.querySelector('.snippet')), snippetMarks: marks(li.querySelector('.snippet')),
      chips: chips.map((b) => (b.getAttribute('aria-label') ?? t(b)).normalize('NFC')), chipTexts: chips.map((b) => t(b)),
      chipsOutsideLink: chips.every((b) => !b.closest('a, [role="link"]')),
      icon: li.querySelector('.icon')?.getAttribute('data-icon') ?? li.querySelector('[data-icon]')?.getAttribute('data-icon') ?? null,
      link: t(link?.querySelector('.title') ?? null) || (link?.getAttribute('aria-label') ?? ''),
    };
  }));
}
export const titles = async (page: Page) => (await rows(page)).map((r) => r.title);
export async function titlesWhen(page: Page, ok: (t: string[]) => boolean, ms = 3000): Promise<string[]> {
  return eventually(() => titles(page), ok, ms);
}

/** The `index_search` queries the UI sent, in order. */
export async function searchQueries(core: FakeCoreHandle): Promise<any[]> {
  return (await callsOf(core, 'index_search')).map((c) => (c.args as any)?.query ?? {});
}
/** Commands that change vault files (as tags-helpers' VAULT_WRITES). */
export const VAULT_WRITES = new Set([
  'note_write', 'note_create', 'note_create_exact', 'note_trash', 'note_discard', 'note_rename', 'daily_create', 'link_create', 'type_create',
  'type_patch', 'type_delete', 'starter_add', 'vault_create', 'vault_settings_patch', 'capture_create', 'inbox_bulk', 'job_retry', 'job_undo',
  'job_redo', 'object_trash', 'trash_restore', 'trash_delete', 'trash_empty', 'media_add', 'media_add_paths',
  'tag_rename', 'tag_delete', 'merge_start', 'backup_restore', 'job_confirm',
]);
export async function vaultWrites(core: FakeCoreHandle): Promise<string[]> {
  return (await core.calls()).map((c) => c.cmd).filter((c) => VAULT_WRITES.has(c));
}

/** The vertical position of an element (top), or NaN when it isn't shown. */
export async function topOf(loc: Locator): Promise<number> {
  if (!(await seen(loc, 1000))) return NaN;
  return loc.first().evaluate((e) => e.getBoundingClientRect().top);
}
/** The scroll position of the nearest scrolling ancestor of `loc`. */
export async function scrollTopOf(loc: Locator): Promise<number> {
  return loc.first().evaluate((e) => {
    let n: HTMLElement | null = e as HTMLElement;
    while (n && !(n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY))) n = n.parentElement;
    return (n ?? document.scrollingElement ?? document.documentElement).scrollTop;
  });
}
/** The text of the focused element's row title (when a row link has focus). */
export async function focusedRowTitle(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || !a.closest('[aria-label="Search results"]')) return null;
    const link = a.closest('a, [role="link"]') as HTMLElement | null;
    if (!link || link !== a) return null;
    return ((link.querySelector('.title') as HTMLElement | null)?.textContent ?? link.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
  });
}
export function assertNoWrites(list: string[], what: string) {
  assert.deepEqual(list, [], `${what}: no vault write`);
}
