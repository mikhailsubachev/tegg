// Helpers for the slice Q3 WebKit tests (L5): the overlay vault (tests/fixtures/vaults/views-display over the base, its
// README), the `views-tasks` overlay for the Tasks criteria, the expected bytes of
// tests/fixtures/queries-files/expected/views-display/, and locators and probes for §42.1's display switch, Group button
// and menu, ungrouped walls, grouped Tables and Lists, and the hooks `__TEGG_TEST__.board()` / `groups()` / `usages()`
// (docs/contracts/v1-views.md §42, §43.1). No AC assertions here except `must` and `click` (re-exported) and
// `expectedDisplay`, which turn a missing element or file into an AssertionError instead of a timeout or a thrown error
// (TS-I1).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { type FakeVault } from '../ui/test/fake-core';
import { REPO, main, must, nfc, rx, viewsVault } from './views-helpers';

export * from './views-usage-helpers';

const OVERLAY = resolve(REPO, 'tests/fixtures/vaults/views-display');
const EXPECTED = resolve(REPO, 'tests/fixtures/queries-files/expected/views-display');
export const ZOB = 'Pages/Zobrazení knih.md';
export const ZOB_ID = '01JB5V00000000000000000031';
export const ZED = 'Celá zeď';

/** `tests/fixtures/queries-files/expected/views-display/<rel>`; a missing file is an assertion failure (TS-I1). */
export function expectedDisplay(rel: string): string {
  const p = join(EXPECTED, rel);
  assert.ok(existsSync(p), `expected bytes tests/fixtures/queries-files/expected/views-display/${rel} exist`);
  return readFileSync(p, 'utf8');
}
/** A file of the views-display overlay folder. */
export const displayFile = (rel: string) => readFileSync(join(OVERLAY, rel), 'utf8');

/** The base, then the views-display overlay (README excluded), then `edit`. */
export function displayVault(edit?: (files: Record<string, string>) => void): FakeVault {
  return viewsVault((files) => {
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

// ------------------------------------------------------------------------------------------------ §42.1 locators

export const displaySwitch = (scope: Locator) => scope.locator('div[role="group"][data-display-switch]');
export const displayButton = (scope: Locator, d: 'list' | 'table' | 'wall') => displaySwitch(scope).locator(`button[data-display="${d}"]`);
export const groupButton = (scope: Locator) => scope.locator('button[data-command="group.open"]');
export const groupMenu = (page: Page) => page.locator('div[role="menu"][data-popup="group"]');
export const groupScope = (page: Page) => groupMenu(page).locator('div.menu-scope[role="presentation"]');
export const groupChoice = (page: Page, id: string) => groupMenu(page).locator(`[role="menuitemradio"][data-group-choice="${nfc(id)}"]`);
export const lanesChoice = (page: Page, which: 'columns' | 'rows') => groupMenu(page).locator(`[role="menuitemradio"][data-lanes-choice="${which}"]`);
export const lanesPart = (page: Page) => groupMenu(page).getByRole('group', { name: rx('Lanes') });
export const useQueryGrouping = (page: Page) => groupMenu(page).locator('[role="menuitem"][data-command="group.useQuery"]');
export const useQueryDisplay = (page: Page) => groupMenu(page).locator('[role="menuitem"][data-command="display.useQuery"]');
export const wallIn = (scope: Locator) => scope.locator('div[role="group"][data-wall]');
export const groupHeader = (scope: Locator, id: string) => scope.locator(`.group-header[data-group-id="${nfc(id).replace(/"/g, '\\"')}"]`);
export const groupChevron = (scope: Locator, id: string) => groupHeader(scope, id).locator('button.group-chevron');
export const groupGrip = (scope: Locator, id: string) => groupHeader(scope, id).locator('[role="button"][data-command="group.drag"]');
export const resizeHandle = (scope: Locator, column: string) => scope.getByRole('separator', { name: rx(`Resize ${column}`) });
export const notices = (scope: Locator) => scope.locator('p.query-notice[data-usage-broken]');
/** The usage root of a tab panel, block or page block (§42.1 `data-display`). */
export const usageDisplay = (scope: Locator) => scope.evaluate((e) => {
  const root = e.closest('[data-display]') ?? e.querySelector('[data-display]');
  return root ? root.getAttribute('data-display') : null;
}).catch(() => null);

// ------------------------------------------------------------------------------------------------ probes

/** The menuitemradio texts of the Group menu in DOM order with their checked state. */
export async function groupItems(page: Page): Promise<{ id: string; text: string; checked: boolean }[]> {
  return groupMenu(page).first().evaluate((m) => ([...m.querySelectorAll('[role="menuitemradio"][data-group-choice]')] as HTMLElement[]).map((x) => ({
    id: (x.getAttribute('data-group-choice') ?? '').normalize('NFC'), text: (x.innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC'), checked: x.getAttribute('aria-checked') === 'true',
  }))).catch(() => []);
}
/** Which display button is pressed (null: none or no switch). */
export async function pressed(scope: Locator): Promise<string | null> {
  return displaySwitch(scope).first().evaluate((g) => g.querySelector('button[aria-pressed="true"]')?.getAttribute('data-display') ?? null).catch(() => null);
}
/** The cards of an ungrouped wall, in DOM order (paths). */
export async function wallCards(scope: Locator): Promise<string[]> {
  return wallIn(scope).first().evaluate((w) => ([...w.querySelectorAll('article[data-board-card]')] as HTMLElement[]).map((c) => (c.getAttribute('data-board-card') ?? '').normalize('NFC'))).catch(() => []);
}
/** The groups of a grouped Table or List (headers in DOM order with their rows' paths). */
export async function groupsIn(scope: Locator): Promise<{ id: string; rows: string[]; folded: boolean }[]> {
  return scope.first().evaluate((el) => {
    const out: { id: string; rows: string[]; folded: boolean }[] = [];
    for (const h of [...el.querySelectorAll('.group-header[data-group-id]')] as HTMLElement[]) out.push({ id: (h.getAttribute('data-group-id') ?? '').normalize('NFC'), rows: [], folded: h.hasAttribute('data-folded') });
    for (const r of [...el.querySelectorAll('[data-query-result][data-group-id]'), ...el.querySelectorAll('div[role="group"][data-group-id] [data-query-result]')] as HTMLElement[]) {
      const id = (r.getAttribute('data-group-id') ?? r.closest('div[role="group"][data-group-id]')?.getAttribute('data-group-id') ?? '').normalize('NFC');
      const g = out.find((x) => x.id === id);
      const p = (r.getAttribute('data-query-result') ?? '').normalize('NFC');
      if (g && !g.rows.includes(p)) g.rows.push(p);
    }
    return out;
  }).catch(() => []);
}
/** `window.__TEGG_TEST__.groups()` (§43.1), or null when the hook is missing. */
export type GroupsProbe = { usageKey: string; display: 'table' | 'list'; groups: { id: string; count: number; folded: boolean; rows: string[] }[]; domRows: number };
export async function groupsHook(page: Page): Promise<GroupsProbe[] | null> {
  return page.evaluate(() => { const t = (window as any).__TEGG_TEST__; return typeof t?.groups === 'function' ? t.groups() : null; });
}
/** `window.__TEGG_TEST__.board()` with §43.1's Q3 fields. */
export type WallProbe = { name: string | null; display?: string; grouped?: boolean; columns?: number; cards?: string[]; lanes: { id: string; cards: string[] }[]; domCards: number };
export async function wallHook(page: Page): Promise<WallProbe[] | null> {
  return page.evaluate(() => { const t = (window as any).__TEGG_TEST__; return typeof t?.board === 'function' ? t.board() : null; });
}
/** Opens the Group menu from a usage scope and returns it. */
export async function openGroup(page: Page, scope: Locator): Promise<Locator> {
  const b = await must(groupButton(scope), '`Group` button', 5000);
  await b.click();
  return must(groupMenu(page), 'menu `Group by`');
}
export const paths = (titles: string[]) => titles.map((t) => `Books/${nfc(t)}.md`);
export const mainArea = main;
