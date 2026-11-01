// Helpers for the MS4 slice 4B WebKit tests (L5): the daily fixture in the fake core, the injected clock, zone and
// region, locators from docs/acceptance/daily-notes.md R17–R19 and docs/contracts/ms4-daily.md §7, and call probes.
// No AC assertions here except `must` (re-exported) and the `need*` lookups, which turn a missing element into an
// AssertionError instead of a Playwright timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault, type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import { READ_COMMANDS, absent, eventually, mainName, must, mustBeOn, runCommand, seen, settled, sleep, start, type FakeCoreHandle, type StartOptions } from './helpers';
import { goToQuery } from './helpers'; // D-1345: the Search page's first result (D-1340)

export { absent, eventually, mainName, must, mustBeOn, runCommand, seen, sleep };
export type { FakeCoreHandle };

export const nfc = (s: string) => s.normalize('NFC');
export const flat = (s: string | null | undefined) => nfc((s ?? '').replace(/\s+/g, ' ').trim());

/** The test clock (daily-notes.md "Fixture"): 12:00 in Prague, 03:00 in Los Angeles, 14 Oct in both. */
export const NOW = '2026-10-14T12:00:00+02:00';
export const ZONES = ['Europe/Prague', 'America/Los_Angeles'] as const;
export const tzTag = (tz: string) => tz.replace(/\W/g, '_');
/** `created` / `modified` of a first write at NOW in each zone (FR-DLY-02 AC-2). */
export const NOW_IN: Record<string, string> = { 'Europe/Prague': '2026-10-14T12:00:00+02:00', 'America/Los_Angeles': '2026-10-14T03:00:00-07:00' };

/** Objects of tests/fixtures/vaults/daily (README.md "Objects"). */
export const D = {
  d01: 'Daily/2026-10-01.md',
  d07: 'Daily/2026-10-07.md',
  patek: 'Daily/2026-10-09.md',
  archiv: 'Archiv/10.10.2026.md',
  d12: 'Daily/2026-10-12.md',
  d12b: 'Daily/2026-10-12 (2).md',
  kolize: 'Daily/2026-10-16.md',
  smazany: '.trash/Daily/2026-10-05.md',
  napad: 'Quick Notes/Nápad z rána.md',
  pozdni: 'Quick Notes/Pozdní nápad.md',
  bezData: 'Quick Notes/Bez data.md',
  nova: 'Pages/Nová stránka dne.md',
  upravena: 'Pages/Upravená stránka.md',
  zminky: 'Pages/Zmínky.md',
  template: '_templates/Daily Note/Daily Note.md',
  new14: 'Daily/2026-10-14.md',
} as const;

/** The daily fixture plus `new-empty/.tegg` (its README.md isn't a vault file). `edit` changes files before start. */
export function dailyVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/daily', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Deník' };
  delete v.files['README.md'];
  edit?.(v.files);
  return v;
}
export const original = (path: string) => dailyVault().files[nfc(path)];
export const idOf = (text: string | undefined) => /^id: (\S+)$/m.exec(text ?? '')?.[1] ?? null;
export function swap(text: string | undefined, from: string, to: string): string {
  assert.ok(text !== undefined && text.includes(from), `fixture text contains ${JSON.stringify(from)}`);
  return text!.replace(from, to);
}

export const ui = (o: { open?: boolean } = {}): UiStateDto =>
  ({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: o.open ?? false, tab: 'backlinks' } });

export type DailyStart = StartOptions & {
  vault?: FakeVault;
  region?: string;
  /** ISO instant for the Playwright clock (default NOW). `install: true` installs a controllable clock instead of a
   *  fixed time (for tests that move past midnight with `page.clock.runFor`). */
  now?: string;
  install?: boolean;
  /** Land on this note route (`vault_last`), else Home. */
  at?: string;
  panel?: boolean;
};

/** Starts the app on the daily vault with the injected clock and region. The zone comes from `test.use({ timezoneId })`. */
export async function startDaily(page: Page, o: DailyStart = {}): Promise<FakeCoreHandle> {
  if (o.region) await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region);
  const t = new Date(o.now ?? NOW);
  if (o.install) await page.clock.install({ time: t });
  else await page.clock.setFixedTime(t);
  const vault = o.vault ?? dailyVault();
  const last = o.at ? { path: nfc(o.at), id: idOf(vault.files[nfc(o.at)]) } : null;
  return start(page, { vault, last, uiState: ui({ open: o.panel ?? false }), ...o });
}

// ------------------------------------------------------------------------------------------------ locators (R17–R19)

export const main = (page: Page) => page.getByRole('main');
export const titleField = (page: Page) => page.getByRole('textbox', { name: 'Title', exact: true });
export const editorBody = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
export const saveState = (page: Page) => page.getByRole('status', { name: 'Save state', exact: true });
export const virtualMarker = (page: Page) => page.getByRole('status').filter({ hasText: 'Not saved yet. Start typing to create this note.' });
export const btn = (page: Page, name: string) => main(page).getByRole('button', { name, exact: true });
export const prevDay = (page: Page) => btn(page, 'Previous day');
export const nextDay = (page: Page) => btn(page, 'Next day');
export const todayBtn = (page: Page) => btn(page, 'Today');
export const pickDate = (page: Page) => btn(page, 'Pick date');
export const reviewToggle = (page: Page) => main(page).getByRole('button', { name: /^(Reviewed|Mark reviewed)$/ });
export const duplicateNotice = (page: Page) => page.getByRole('region', { name: 'Other notes for this date', exact: true });
export const section = (page: Page, name: 'Quick Notes' | 'Tasks due' | 'Created' | 'Modified') => main(page).getByRole('region', { name, exact: true });
export const calendar = (page: Page) => page.getByRole('dialog', { name: 'Calendar', exact: true });
export const calendarGrid = (page: Page) => calendar(page).getByRole('grid');
export const dayButton = (page: Page, longDate: string) => calendarGrid(page).getByRole('gridcell').getByRole('button', { name: longDate, exact: true });
export const sidebarToday = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' }).getByRole('link', { name: 'Today', exact: true });
export const linkSuggestions = (page: Page) => page.getByRole('listbox', { name: 'Link suggestions', exact: true });
/** D-369: the type chip is a link `Type: <Name>` (types.md FR-TYP-07 AC-11). */
export const typeChip = (page: Page) => main(page).getByRole('link', { name: /^Type: / });
/** D-369: `Change type…` in the note header's `More` menu (FR-TYP-07 AC-12). */
export const moreButton = (page: Page) => main(page).getByRole('button', { name: 'More', exact: true });
export const changeTypeItem = (page: Page) => page.getByRole('menu', { name: 'More', exact: true }).getByRole('menuitem', { name: 'Change type…', exact: true });
export const contextPanel = (page: Page) => page.getByRole('complementary', { name: 'Context panel' });
export const backlinksTab = (page: Page) => contextPanel(page).getByRole('tab', { name: /^Backlinks\b/ });
export const backlinksPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Backlinks' });
/** Link chips with a given text inside `scope` (they carry `data-link-kind`, ms4-links §5.2). */
export const chips = (scope: Locator, text: string) =>
  scope.locator('[data-link-kind]').filter({ hasText: new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) });

/** The R19 long date (D-337): `středa 14. října 2026` in cs, `Wednesday, October 14, 2026` in en. */
export function longDate(date: string, region: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(region, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}

/** The title field's shown text (input value or element text). */
export async function titleText(page: Page): Promise<string> {
  return flat(await titleField(page).first().evaluate((e) => (e as HTMLInputElement).value ?? e.textContent ?? ''));
}
/** Accessible description of an element (aria-describedby texts or aria-description). */
export async function description(loc: Locator): Promise<string> {
  return loc.first().evaluate((e) => {
    const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return (e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
  });
}
export async function isDisabled(loc: Locator): Promise<boolean> {
  return loc.first().evaluate((e) => (e as HTMLButtonElement).disabled === true || e.getAttribute('aria-disabled') === 'true');
}

/** Asserts the daily route for `date` is shown: the R19 read-only title field holds the date (FR-DLY-01 AC-1, D-320). */
export async function mustDaily(page: Page, date: string, how: string, ms = 3000) {
  const t = await must(titleField(page), `${how}: the title field of daily/${date}`, ms);
  const got = await eventually(() => titleText(page), (v) => v === date, ms);
  assert.equal(got, date, `${how}: the title field shows ${date}`);
  assert.equal(await t.getAttribute('aria-readonly'), 'true', `${how}: the Daily Note title is read-only (D-320)`);
}
/** ⌘D with the focus in the centre pane, then the daily route for `date`. */
export async function cmdD(page: Page, date: string, how = '⌘D') {
  await page.keyboard.press('Meta+d');
  await mustDaily(page, date, how);
}
/** From the current daily route, `Next day` / `Previous day` n times by the header button. */
export async function step(page: Page, n: number) {
  for (let i = 0; i < Math.abs(n); i++) await (await must(n > 0 ? nextDay(page) : prevDay(page), n > 0 ? 'button "Next day"' : 'button "Previous day"')).click();
}
/** Opens daily/<date> from today's note (⌘D) with the header buttons. */
export async function gotoDaily(page: Page, date: string, today = '2026-10-14') {
  await cmdD(page, today);
  const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  await step(page, days);
  await mustDaily(page, date, `daily/${date}`);
}
/** Opens a note through the Search page (D-1345): its title in `Search query`, ⏎ on the first result. */
export async function gotoNote(page: Page, title: string) {
  await goToQuery(page, title);
  await page.keyboard.press('Enter');
  await mustBeOn(page, title, `open "${title}"`, 5000);
}
/** Places the caret at the end of the editor body. */
export async function caretAtEnd(page: Page) {
  const b = await must(editorBody(page), 'textbox "Note body"');
  await b.click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.press('End');
}
export async function stateIs(page: Page, want: string, ms = 3000): Promise<boolean> {
  return (await eventually(async () => flat(await saveState(page).first().innerText().catch(() => '')), (t) => t === want, ms)) === want;
}

// ------------------------------------------------------------------------------------------------ calls

/** Read-only commands: helpers.ts plus ms4-daily §4. Every other command counts as a write. */
export const DAILY_READS = new Set([...READ_COMMANDS, 'daily_view', 'daily_dates', 'daily_draft', 'daily_context', 'daily_backlinks']); // D-348: read-only
export async function writeCalls(core: FakeCoreHandle): Promise<string[]> {
  return (await core.calls()).map((c) => c.cmd).filter((c) => !DAILY_READS.has(c) && !c.startsWith('plugin:'));
}
export async function callsOf(core: FakeCoreHandle, cmd: string) {
  return (await core.calls()).filter((c) => c.cmd === cmd);
}
export async function fileText(core: FakeCoreHandle, path: string): Promise<string | undefined> {
  return (await core.files())[nfc(path)];
}
export async function fileWhen(core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean, ms = 3000): Promise<string | undefined> {
  return eventually(() => fileText(core, path), ok, ms);
}
/** Paths routed by `nav_opened`, in order. */
export async function navs(core: FakeCoreHandle): Promise<string[]> {
  return (await callsOf(core, 'nav_opened')).map((c) => nfc(String((c.args as any)?.path ?? '')));
}
/** The fixture template's body expanded for `date` (FR-DLY-06 AC-1). */
export function templateBody(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const noon = Date.UTC(y, m - 1, d, 12);
  return `# Deník ${d}. ${m}. ${y}\n\nVčera: [[${iso(noon - 86_400_000)}]] · Zítra: [[${iso(noon + 86_400_000)}]] · Dnes: ${date} · {{time}}\n\n## Poznámky\n`;
}
/** The frontmatter keys of a text in file order. */
export function keysOf(text: string | undefined): string[] {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text ?? '');
  return m ? m[1].split('\n').filter((l) => /^[^\s-][^:]*:/.test(l)).map((l) => l.slice(0, l.indexOf(':'))) : [];
}
export const bodyOf = (text: string | undefined) => (text ?? '').replace(/^---\n[\s\S]*?\n---\n/, '');
