// Helpers for FR-SRC-03 AC-7 (v0.52 feedback H13): search and switcher rows and their icons. No AC assertions here
// except `must` (re-exported through capture-helpers), which turns a missing element into an AssertionError (TS-I1).
import type { Locator, Page } from '@playwright/test';
import { must, mustBeOn, sidebar, sleep } from './capture-helpers';
import { typesList } from './helpers';

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{25A0}-\u{25FF}]/u;

/** Opens the search route (⇧⌘F), types `query` and returns the result row that contains `title`. */
export async function searchFor(page: Page, query: string, title: string): Promise<Locator> {
  if ((await page.getByRole('searchbox', { name: 'Search query' }).or(page.getByRole('textbox', { name: 'Search query' })).count()) === 0) {
    await page.keyboard.press('Meta+Shift+f');
    await mustBeOn(page, 'Search', 'search route', 5000);
  }
  const input = await must(page.getByRole('searchbox', { name: 'Search query' }).or(page.getByRole('textbox', { name: 'Search query' })).first(), 'Search query');
  await input.fill(query);
  await sleep(500);
  return page.getByRole('list', { name: 'Search results', exact: true }).getByRole('listitem').filter({ hasText: title }).first();
}
/** Opens the quick switcher (⌘O), types `query` and returns the option that contains `title`. */
export async function switcherFor(page: Page, query: string, title: string): Promise<Locator> {
  await page.keyboard.press('Meta+o');
  const dlg = await must(page.getByRole('dialog', { name: 'Quick switcher' }), 'Quick switcher');
  await (await must(page.getByRole('textbox', { name: 'Switcher query' }).or(page.getByRole('combobox', { name: 'Switcher query' })), 'Switcher query')).fill(query);
  await sleep(300);
  return dlg.getByRole('option').filter({ hasText: title }).first();
}
/** The `data-icon` values of the SVGs in a row, and any emoji / geometric-shape glyphs in its text. */
export async function iconsIn(row: Locator): Promise<{ icons: string[]; emoji: string[] }> {
  const r = await row.evaluate((e) => ({
    icons: [...e.querySelectorAll('svg[data-icon]')].map((s) => s.getAttribute('data-icon') ?? ''),
    text: (e as HTMLElement).innerText ?? '',
  }));
  return { icons: r.icons, emoji: [...r.text].filter((ch) => EMOJI.test(ch)) };
}
/** The `data-icon` of the sidebar Types list row of `plural`, or null. */
export async function sidebarTypeIcon(page: Page, plural: string): Promise<string | null> {
  const row = typesList(page).getByRole('listitem').filter({ hasText: plural }).first();
  if ((await row.count()) === 0) {
    const other = sidebar(page).locator('a, button, [role="link"]').filter({ hasText: plural }).first();
    return (await other.count()) ? other.locator('svg[data-icon]').first().getAttribute('data-icon') : null;
  }
  return row.locator('svg[data-icon]').first().getAttribute('data-icon');
}
