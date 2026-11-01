// Helpers for the preview v0.68 feedback WebKit tests (L5; docs/feedback/ms6-v068.md, D-759…D-764): the Search page's
// `Go to` list (search-navigation.md FR-NAV-01 AC-15…AC-18, D-760), the sidebar's top row and Tags entry (app-shell.md
// FR-NAV-01 AC-14, tags.md R83, D-759, D-761) and the one date picker `Pick date` (date-picker.md R89, D-763). No AC
// assertions here except `must` (re-exported) and the `need*` lookups, which turn a missing element into an
// AssertionError instead of a Playwright timeout (TS-I1). Written from the ACs only (D-61).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { eventually, firstResultRow, must, mustBeOn, seen, settledFirstResult, sidebar } from './helpers';

export const nfc = (s: string) => s.normalize('NFC');
export const flat = (s: string | null | undefined) => nfc((s ?? '').replace(/\s+/g, ' ').trim());
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------------------------------------------ Search page (D-760)

/** The Search page's field (ms2-shell §3 `Search query`). */
export const searchQuery = (page: Page) =>
  page.getByRole('searchbox', { name: 'Search query', exact: true }).or(page.getByRole('textbox', { name: 'Search query', exact: true })).first();
/** The former `Go to` list (search-navigation.md FR-NAV-01 AC-15), gone since D-1340: kept to assert its absence. */
export const goToList = (page: Page) => page.getByRole('listbox', { name: 'Go to', exact: true });
export const searchResults = (page: Page) => page.getByRole('list', { name: 'Search results', exact: true });

/** ⇧⌘F, then the `Search query` field. */
export async function openSearch(page: Page): Promise<Locator> {
  await page.keyboard.press('Meta+Shift+f');
  await mustBeOn(page, 'Search', 'the search route (⇧⌘F)', 5000);
  return must(searchQuery(page), 'textbox "Search query"', 3000);
}
/** The result rows' titles, in order (D-1345: the results list replaces the `Go to` options, D-1340). */
export async function goToOptions(page: Page): Promise<string[]> {
  if (!(await seen(searchResults(page), 500))) return [];
  return (await searchResults(page).locator('a.result').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))).map(flat);
}
/** Opens an object through the Search page (D-1340, D-1345): ⇧⌘F, the query, ⏎ on the first result. */
export async function goTo(page: Page, query: string, title = query, ms = 5000) {
  const q = await openSearch(page);
  await q.fill(query);
  await must(firstResultRow(page), `the first row of "Search results" for ${JSON.stringify(query)}`, 3000);
  await settledFirstResult(page, query);
  await page.keyboard.press('Enter');
  await mustBeOn(page, nfc(title), `open "${title}" from the Search page's first result`, ms);
}

// ------------------------------------------------------------------------------------------------ sidebar (D-759, D-761)

/** app-shell FR-NAV-01 AC-14: the filled `New object` button of the sidebar's first row. */
export const newObjectBtn = (page: Page) => sidebar(page).getByRole('button', { name: /^New object/ });
/** app-shell FR-NAV-01 AC-14: the icon button `Search` beside it. */
export const searchBtn = (page: Page) => sidebar(page).getByRole('button', { name: 'Search', exact: true });
/** tags.md R83 (D-761): the one `Tags` entry (accessible name `Tags`, description `<n> tags`). */
export const tagsEntry = (page: Page) => sidebar(page).getByRole('link', { name: 'Tags', exact: true });

/** The tooltip of an element: its `title`, else its accessible description. */
export async function tooltip(loc: Locator): Promise<string> {
  return loc.first().evaluate((e) => {
    const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return (e.getAttribute('title') ?? e.getAttribute('aria-description') ?? ids.map((i) => document.getElementById(i)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
  });
}
/** Accessible description (aria-describedby texts or aria-description). */
export async function description(loc: Locator): Promise<string> {
  return loc.first().evaluate((e) => {
    const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return (e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
  });
}
/** The focused element's accessible label (aria-label, else its text). */
export async function focusLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return '';
    return (a.getAttribute('aria-label') ?? a.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
}
export type Rect = { x: number; y: number; width: number; height: number; top: number; bottom: number; left: number; right: number };
export async function rectOf(loc: Locator, what: string): Promise<Rect> {
  const el = await must(loc, what);
  return el.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
}

// ------------------------------------------------------------------------------------------------ date picker (D-763)

/** R89: the app's one date picker. */
export const pickDialog = (page: Page) => page.getByRole('dialog', { name: 'Pick date', exact: true });
/** The capture's name for the same dialog (FR-CAP-01 AC-19). */
export const dueDialog = (page: Page) => page.getByRole('dialog', { name: 'Pick a due date', exact: true });
/** The Daily Notes calendar's name for it (daily-notes.md R18). */
export const calendarDialog = (page: Page) => page.getByRole('dialog', { name: 'Calendar', exact: true });
export const dateField = (dlg: Locator) => dlg.getByRole('textbox', { name: 'Date', exact: true });
/** R89 quick picks (v0.94, D-1285: `Next week` and `Fri` removed; `This week` is the first Friday on or after today). */
export const QUICK_PICKS = ['Today', 'Tomorrow', 'This week'] as const;
export const HINT = 'or type “fri”, “next week”';

/** The R18/R19 long date of a region (`úterý 20. října 2026` in cs), which names a day button of the grid (R89). */
export function longDate(date: string, region: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(region, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}
/** The region's short numeric date as the panel shows it (D-133): `7. 10. 2026` in cs. Spaces may be no-break. */
export const regionDate = (date: string, region = 'cs') => {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(region, { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
};
/** A regex for `<prefix><date>` that accepts any kind of space inside the date. */
export const dateName = (prefix: string, date: string, region = 'cs') =>
  new RegExp(`^${esc(prefix)}${esc(regionDate(date, region)).replace(/\s+/g, '\\s')}$`);

/** The grid's day button named by the long date (a `button` in a `gridcell`, or the named `gridcell` itself). */
export const dayIn = (dlg: Locator, date: string, region: string) => {
  const grid = dlg.getByRole('grid');
  const name = longDate(date, region);
  return grid.getByRole('gridcell').getByRole('button', { name, exact: true }).or(grid.getByRole('gridcell', { name, exact: true })).first();
};
/** The month heading text of the picker (`říjen 2026` or `October 2026`, localized). */
export async function monthText(dlg: Locator): Promise<string> {
  const h = dlg.getByRole('heading').first();
  if (!(await seen(h, 500))) return '';
  return flat(await h.innerText());
}
/** Accepts the month heading in the region's or the UI's language (R89 says only "localized"). */
export function monthIs(text: string, date: string, region: string): boolean {
  const [y, m] = date.split('-').map(Number);
  const forms = [region, 'en'].map((r) => new Intl.DateTimeFormat(r, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, 15)).toLowerCase());
  return forms.includes(text.toLowerCase());
}
/** Clicks `Next month` until the heading shows the month of `date` (at most 30 steps). */
export async function showMonth(dlg: Locator, date: string, region: string) {
  for (let i = 0; i < 30; i++) {
    if (monthIs(await monthText(dlg), date, region)) return;
    const next = dlg.getByRole('button', { name: 'Next month', exact: true }).or(dlg.getByRole('button', { name: '›', exact: true })).first();
    await (await must(next, 'button "Next month" (R89)')).click();
  }
  assert.fail(`the picker never showed the month of ${date} (last: ${await monthText(dlg)})`);
}
/** The focused grid day's accessible name ('' when the focus isn't on a day). */
export async function focusedDay(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || !a.closest('[role="grid"]')) return '';
    return (a.getAttribute('aria-label') ?? a.closest('[role="gridcell"]')?.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
  });
}
/** The weekday column headers of the picker's grid, as shown. */
export async function weekdays(dlg: Locator): Promise<string[]> {
  return (await dlg.getByRole('grid').getByRole('columnheader').allInnerTexts()).map(flat);
}
/** Whether the focus is inside `dlg`. */
export async function focusInside(dlg: Locator): Promise<boolean> {
  return dlg.evaluate((d) => !!document.activeElement && d.contains(document.activeElement));
}
/** Waits until `dlg` is gone; returns whether it is. */
export async function closed(dlg: Locator, ms = 1500): Promise<boolean> {
  return (await eventually(() => dlg.count(), (n) => n === 0, ms)) === 0;
}
