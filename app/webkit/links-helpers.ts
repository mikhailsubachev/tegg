// Helpers for the MS4 slice 4A WebKit tests (L5): the backlinks fixture in the fake core, locators from
// docs/acceptance/backlinks.md R15/R16 and docs/contracts/ms4-links.md §5, and call probes. No AC assertions here
// except `must` (re-exported) and the `need*` lookups, which turn a missing element into an AssertionError instead of
// a Playwright timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault, type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import { READ_COMMANDS, eventually, must, mustBeOn, runCommand, seen, sleep, start, type FakeCoreHandle, type StartOptions } from './helpers';

export { eventually, must, mustBeOn, runCommand, seen, sleep };
export type { FakeCoreHandle };

export const nfc = (s: string) => s.normalize('NFC');
export const flat = (s: string | null | undefined) => nfc((s ?? '').replace(/\s+/g, ' ').trim());

/** Objects of tests/fixtures/vaults/backlinks (backlinks.md "Fixture"). */
export const B = {
  cil: 'Pages/Cíl.md',
  odkazy: 'Pages/Odkazy v textu.md',
  rozbite: 'Pages/Rozbité odkazy.md',
  markdown: 'Pages/Markdown odkaz.md',
  neplatna: 'Pages/Neplatná hlavička.md',
  rychla: 'Quick Notes/Rychlá poznámka.md',
  denni: 'Daily/2026-10-07.md',
  porada: 'Schůzky/2026-10-08 Porada.md',
  starsi: 'Schůzky/Starší porada.md',
  sChybou: 'Schůzky/Porada s chybou.md',
  bezTypu: 'Pages/Bez typu s vlastností.md',
  jana: 'Osoby/Jana Nováková.md',
  osamela: 'Pages/Osamělá.md',
  dvojnikP: 'Pages/Dvojník.md',
  dvojnikQ: 'Quick Notes/Dvojník.md',
  zRychlych: 'Quick Notes/Z rychlých.md',
  zeStranek: 'Pages/Ze stránek.md',
  zKorene: 'Z kořene.md',
  spm: 'Pages/Senior Product Manager.md',
  spm2: 'Pages/Senior Product Manager (2).md',
  spmAlfa: 'Osoby/SPM Alfa.md',
  spmVelkymi: 'Quick Notes/SPM velkými.md',
  odkazSpm: 'Pages/Odkaz na SPM.md',
  cteni: 'Pages/Čtení.md',
  cteni2: 'Pages/Čtení podruhé.md',
  dalsi: 'Quick Notes/Další rozbitý.md',
} as const;
export const TITLES: Record<string, string> = {
  [B.cil]: 'Cíl', [B.odkazy]: 'Odkazy v textu', [B.rozbite]: 'Rozbité odkazy', [B.markdown]: 'Markdown odkaz', [B.neplatna]: 'Neplatná hlavička',
  [B.rychla]: 'Rychlá poznámka', [B.denni]: '2026-10-07', [B.porada]: '2026-10-08 Porada', [B.starsi]: 'Starší porada', [B.sChybou]: 'Porada s chybou',
  [B.bezTypu]: 'Bez typu s vlastností', [B.jana]: 'Jana Nováková', [B.osamela]: 'Osamělá', [B.dvojnikP]: 'Dvojník', [B.dvojnikQ]: 'Dvojník',
  [B.zRychlych]: 'Z rychlých', [B.zeStranek]: 'Ze stránek', [B.zKorene]: 'Z kořene', [B.spm]: 'Senior Product Manager', [B.spm2]: 'Senior Product Manager',
  [B.spmAlfa]: 'Senior Product Manager', [B.spmVelkymi]: 'SENIOR PRODUCT MANAGER', [B.odkazSpm]: 'Odkaz na SPM', [B.cteni]: 'Čtení', [B.cteni2]: 'Čtení',
  [B.dalsi]: 'Další rozbitý',
};
/** Cíl's 9 sources (FR-LNK-01 AC-2) by title. */
export const CIL_SOURCES = ['Odkazy v textu', 'Rozbité odkazy', 'Markdown odkaz', 'Neplatná hlavička', 'Rychlá poznámka', '2026-10-07', '2026-10-08 Porada', 'Starší porada', 'Bez typu s vlastností'];

/** The backlinks fixture plus `new-empty/.tegg` (backlinks.md "Fixture"); the fixture's README.md isn't a vault file.
 *  `edit` changes files before the app starts. */
export function linksVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/backlinks', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Odkazy' };
  delete v.files['README.md'];
  edit?.(v.files);
  return v;
}
export const original = (path: string) => linksVault().files[nfc(path)];
export const idOf = (text: string | undefined) => /^id: (\S+)$/m.exec(text ?? '')?.[1] ?? null;

export const ui = (o: { open?: boolean; theme?: UiStateDto['theme'] } = {}): UiStateDto =>
  ({ version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: o.open ?? true, tab: 'backlinks' } });

export type LinksStart = StartOptions & { vault?: FakeVault; region?: string; readView?: boolean; panel?: boolean; theme?: UiStateDto['theme'] };

/** Starts the app with the backlinks vault, landing on `at` (D-132) with the Context panel open on Backlinks unless
 *  `panel: false`. */
export async function openLinks(page: Page, at: string, o: LinksStart = {}): Promise<FakeCoreHandle> {
  if (o.region) await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region);
  if (o.readView) await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; });
  const vault = o.vault ?? linksVault();
  const core = await start(page, { vault, last: { path: nfc(at), id: idOf(vault.files[nfc(at)]) }, uiState: ui({ open: o.panel ?? true, theme: o.theme }), ...o });
  if (TITLES[at]) await mustBeOn(page, TITLES[at], `landing on ${at}`, 5000);
  return core;
}

// ------------------------------------------------------------------------------------------------ locators (R15, R16)

export const contextPanel = (page: Page) => page.getByRole('complementary', { name: 'Context panel' });
export const backlinksTab = (page: Page) => contextPanel(page).getByRole('tab', { name: /^Backlinks\b/ });
export const backlinksPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Backlinks' });
export const panelHeading = (page: Page) => backlinksPanel(page).getByRole('heading', { level: 2 });
export const groupHeader = (page: Page, plural: string) => backlinksPanel(page).getByRole('button', { name: new RegExp(`^${plural}, \\d+$`) });
export const entry = (page: Page, title: string) => backlinksPanel(page).getByRole('article', { name: title, exact: true });
export const excerpts = (scope: Locator) => scope.locator('[data-occurrence]');
export const more = (scope: Locator) => scope.getByRole('button', { name: /^Show \d+ more$/ });
export const createOffer = (page: Page) => page.getByRole('dialog', { name: 'Create note' });
export const main = (page: Page) => page.getByRole('main');
export const editorBody = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
export const props = (page: Page) => page.getByRole('region', { name: 'Properties', exact: true });
export const sourceRegion = (page: Page) => page.getByRole('region', { name: 'Markdown source', exact: true });
/** The chips with a given text inside `scope` (link chips carry `data-link-kind` in every context, ms3-shell §11.3,
 *  FR-LNK-07 AC-2). A subpath chip may read `Cíl › Úvod` (D-156) or `Cíl#Úvod`; pass a RegExp to accept both. */
export const chips = (scope: Locator, text: string | RegExp) =>
  scope.locator('[data-link-kind]').filter({ hasText: typeof text === 'string' ? new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) : text });
/** `Neexistuje › Kapitola` or `Neexistuje#Kapitola`. */
export const SUBPATH_CHIP = /^\s*Neexistuje( › |#)Kapitola\s*$/;

export async function mustPanel(page: Page, what = 'tabpanel "Backlinks"'): Promise<Locator> {
  return must(backlinksPanel(page), what, 5000);
}
/** Group header button texts in order, e.g. `Pages, 4`. */
export async function groups(page: Page): Promise<string[]> {
  await mustPanel(page);
  return (await backlinksPanel(page).getByRole('button', { name: /^.+, \d+$/ }).evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '')))
    .map(flat).filter((t) => /, \d+$/.test(t));
}
/** Entry titles in order, as shown. */
export async function entries(page: Page): Promise<string[]> {
  await mustPanel(page);
  return (await backlinksPanel(page).getByRole('article').evaluateAll((as) => as.map((a) => a.getAttribute('aria-label') ?? ''))).map(flat);
}
export async function entriesIn(page: Page, plural: string): Promise<string[]> {
  await mustPanel(page);
  const g = backlinksPanel(page).getByRole('group', { name: plural, exact: true });
  if (!(await seen(g, 1000))) return [];
  return (await g.getByRole('article').evaluateAll((as) => as.map((a) => a.getAttribute('aria-label') ?? ''))).map(flat);
}
export async function excerptTexts(scope: Locator): Promise<string[]> {
  return (await excerpts(scope).allInnerTexts()).map(flat);
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
/** The focused element as role and accessible name. */
export async function focus(page: Page): Promise<{ role: string; name: string; inPanel: boolean; inBody: boolean }> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return { role: 'body', name: '', inPanel: false, inBody: false };
    const role = a.getAttribute('role') ?? ({ A: 'link', BUTTON: 'button', H2: 'heading', INPUT: 'textbox' } as Record<string, string>)[a.tagName] ?? a.tagName.toLowerCase();
    const ids = (a.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
    const name = (a.getAttribute('aria-label') ?? (ids.length ? ids.map((i) => document.getElementById(i)?.textContent ?? '').join(' ') : a.textContent) ?? '').replace(/\s+/g, ' ').trim();
    return { role, name, inPanel: !!a.closest('[role="tabpanel"]'), inBody: !!a.closest('[aria-label="Note body"], [role="textbox"][aria-multiline="true"]') };
  });
}

// ------------------------------------------------------------------------------------------------ calls

/** Read-only commands of ms2-shell, ms3-shell (helpers.ts) and ms4-links §4. */
export const LINK_READS = new Set([...READ_COMMANDS, 'index_backlinks', 'index_broken_links', 'index_duplicate_titles', 'link_create_plan', 'backlinks']);
export async function writeCalls(core: FakeCoreHandle): Promise<string[]> {
  return (await core.calls()).map((c) => c.cmd).filter((c) => !LINK_READS.has(c) && !c.startsWith('plugin:'));
}
export async function callsOf(core: FakeCoreHandle, cmd: string) {
  return (await core.calls()).filter((c) => c.cmd === cmd);
}
export async function fileText(core: FakeCoreHandle, path: string): Promise<string | undefined> {
  return (await core.files())[nfc(path)];
}
export function swap(text: string | undefined, from: string, to: string): string {
  assert.ok(text !== undefined && text.includes(from), `fixture text contains ${JSON.stringify(from)}`);
  return text!.replace(from, to);
}
export async function gotoNote(page: Page, title: string) {
  await page.keyboard.press('Meta+o');
  await page.getByRole('textbox', { name: 'Switcher query' }).or(page.getByRole('combobox', { name: 'Switcher query' })).first().fill(title);
  await sleep(200);
  await page.keyboard.press('Enter');
  await mustBeOn(page, title, `open "${title}"`, 5000);
}
