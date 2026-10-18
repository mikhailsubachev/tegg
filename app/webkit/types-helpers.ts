// Helpers for the MS3 slice 3D WebKit tests (L5): the types fixture in the fake core, locators from
// docs/contracts/ms3-shell.md §14.7.3, and file/call probes. No AC assertions here except `must` (re-exported) and the
// `need*` lookups, which turn a missing element into an AssertionError instead of a Playwright timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadFixtureVault, type CallRecord, type FakeVault } from '../ui/test/fake-core';
import { eventually, must, mustBeOn, nonReadCalls, runCommand, seen, sidebar, sleep, start, typesList, type FakeCoreHandle, type StartOptions } from './helpers';

export { eventually, must, nonReadCalls, runCommand, seen, sidebar, sleep, typesList };
export type { FakeCoreHandle };

export const REPO = resolve(import.meta.dirname, '../..');
export const fixture = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures', rel), 'utf8');
export const nfc = (s: string) => s.normalize('NFC');

/** Objects of tests/fixtures/vaults/types (types.md "Fixtures"). */
export const P = {
  porada: 'Schůzky/2026-10-07 Porada.md',
  prazdna: 'Schůzky/Prázdná schůzka.md',
  veStrankach: 'Pages/Schůzka ve stránkách.md',
  jana: 'Osoby/Jana Nováková.md',
  petr: 'Osoby/Petr Dvořák.md',
  rozpocet: 'Projekty/Rozpočet 2027.md',
  chybne: 'Projekty/Chybné hodnoty.md',
  velka: 'Projekty/Velká písmena.md',
  dvaTypy: 'Pages/Dva typy.md',
  obycejna: 'Pages/Obyčejná stránka.md',
  napadKOvereni: 'Nápady/Nápad k ověření.md',
  neplatna: 'Pages/Neplatná hlavička.md',
  styl: 'Pages/Styl hodnot.md',
  bez: 'Pages/Bez hlavičky.md',
  denni: 'Daily/2026-10-07.md',
  ukol: 'Tasks/Zavolat Janě.md',
} as const;
export const TITLES: Record<string, string> = {
  [P.porada]: '2026-10-07 Porada', [P.prazdna]: 'Prázdná schůzka', [P.veStrankach]: 'Schůzka ve stránkách', [P.jana]: 'Jana Nováková',
  [P.petr]: 'Petr Dvořák', [P.rozpocet]: 'Rozpočet 2027', [P.chybne]: 'Chybné hodnoty', [P.velka]: 'Velká písmena', [P.dvaTypy]: 'Dva typy',
  [P.obycejna]: 'Obyčejná stránka', [P.napadKOvereni]: 'Nápad k ověření', [P.styl]: 'Styl hodnot', [P.bez]: 'Bez hlavičky',
  [P.denni]: '2026-10-07', [P.ukol]: 'Zavolat Janě', [P.neplatna]: 'Neplatná hlavička',
};
export const typeFile = (key: string) => `.tegg/types/${nfc(key)}.yml`;

/** The types fixture plus `new-empty/.tegg` (types.md "Fixtures"). `edit` changes files before the app starts. */
export function typesVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/types', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Typy' };
  edit?.(v.files);
  return v;
}
export const original = (path: string) => typesVault().files[nfc(path)];

export type TypesStart = StartOptions & { vault?: FakeVault; region?: string };

/** Starts the app with the types vault. With `at` (a note path) it lands on that note (D-132) and waits for its title. */
export async function openTypes(page: Page, at?: string, o: TypesStart = {}): Promise<FakeCoreHandle> {
  if (o.region) await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region);
  const vault = o.vault ?? typesVault();
  const id = at ? (/^id: (\S+)$/m.exec(vault.files[nfc(at)] ?? '')?.[1] ?? null) : null;
  const core = await start(page, { vault, last: at ? { path: nfc(at), id } : null, ...o });
  if (at && TITLES[at]) await mustBeOn(page, TITLES[at], `landing on ${at}`, 5000);
  return core;
}

// ------------------------------------------------------------------------------------------------ locators (§14.7.3)

export const main = (page: Page) => page.getByRole('main');
export const props = (page: Page) => page.getByRole('region', { name: 'Properties', exact: true });
export const saveState = (page: Page) => page.getByRole('status', { name: 'Save state', exact: true });
/** D-369: the header's type chip is a link `Type: <Name>` to `type/<key>` (types.md FR-TYP-07 AC-11). */
export const typeChip = (page: Page) => main(page).getByRole('link', { name: /^Type: / });
/** D-369: the note header's `More` button and menu with `Change type…` (FR-TYP-07 AC-12). */
export const moreButton = (page: Page) => main(page).getByRole('button', { name: 'More', exact: true });
export const moreMenu = (page: Page) => page.getByRole('menu', { name: 'More', exact: true });
export const changeTypeItem = (page: Page) => moreMenu(page).getByRole('menuitem', { name: 'Change type…', exact: true });
export const changeTypeMenu = (page: Page) => page.getByRole('menu', { name: 'Change type', exact: true });
export const otherProps = (page: Page) => page.getByRole('button', { name: /^Other properties \(\d+\)$/ });
export const typeTable = (page: Page, plural: string) => main(page).getByRole('table', { name: plural, exact: true });
export const settingsHeading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name: `${name} type settings`, exact: true });
export const section = (page: Page, name: string) => main(page).getByRole('region', { name, exact: true });
export const dialog = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name });
export const newTypeDialog = (page: Page) => dialog(page, 'New type');
/** A property group in type settings (`group` named by the property Name). */
export const property = (page: Page, name: string) => section(page, 'Properties').getByRole('group', { name, exact: true });
/** The value control of panel row `name` (accessible name = the attribute Name). */
export const control = (page: Page, role: Parameters<Page['getByRole']>[0], name: string) => props(page).getByRole(role, { name, exact: true });

/** Accessible description of an element (aria-describedby texts or aria-description). */
export async function description(loc: Locator): Promise<string> {
  return loc.first().evaluate((e) => {
    const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return (e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
  });
}
export async function isDisabled(loc: Locator): Promise<boolean> {
  return loc.first().evaluate((e) => (e as HTMLButtonElement).disabled === true || e.getAttribute('aria-disabled') === 'true' || (e as HTMLInputElement).readOnly === true);
}

// ------------------------------------------------------------------------------------------------ navigation

/** `type/<key>` through the palette's `Go to type: <Plural>` command (3A). */
export async function gotoTypePage(page: Page, plural: string) {
  await runCommand(page, `Go to type: ${plural}`);
  await must(typeTable(page, plural), `type page table "${plural}"`, 5000);
}
/** `type-settings/<key>` through the type page's `Type settings` button. */
export async function gotoSettings(page: Page, plural: string, name: string) {
  await runCommand(page, `Go to type: ${plural}`);
  await mustBeOn(page, plural, `type page ${plural}`, 5000);
  await (await must(main(page).getByRole('button', { name: 'Type settings', exact: true }), 'button "Type settings"')).click();
  await must(settingsHeading(page, name), `heading "${name} type settings"`, 5000);
}
export async function openNoteByTitle(page: Page, title: string) {
  await page.keyboard.press('Meta+o');
  await page.getByRole('textbox', { name: 'Switcher query' }).or(page.getByRole('combobox', { name: 'Switcher query' })).first().fill(title);
  await sleep(150);
  await page.keyboard.press('Enter');
  await mustBeOn(page, title, `open "${title}"`, 5000);
}

// ------------------------------------------------------------------------------------------------ calls and files

export async function callsOf(core: FakeCoreHandle, cmd: string): Promise<CallRecord[]> {
  return (await core.calls()).filter((c) => c.cmd === cmd);
}
export async function fileText(core: FakeCoreHandle, path: string): Promise<string | undefined> {
  return (await core.files())[nfc(path)];
}
/** Waits until the file satisfies `ok`; returns its last text. */
export async function fileWhen(core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean, ms = 2000): Promise<string | undefined> {
  return eventually(() => fileText(core, path), ok, ms);
}
export function swap(text: string | undefined, from: string, to: string): string {
  assert.ok(text !== undefined && text.includes(from), `fixture text contains ${JSON.stringify(from)}`);
  return text!.replace(from, to);
}
/** Inserts `lines` before the closing `---` of the frontmatter. */
export function append(text: string | undefined, lines: string): string {
  assert.ok(text !== undefined && text.indexOf('\n---\n', 4) > 0, 'fixture has frontmatter');
  const close = text!.indexOf('\n---\n', 4);
  return text!.slice(0, close + 1) + lines + text!.slice(close + 1);
}
export const noModified = (t: string | undefined) => (t ?? '').replace(/^modified: .*$/m, 'modified: <x>');
/** Paths written so far other than `allowed` (type files and notes alike). */
export async function writtenOutside(core: FakeCoreHandle, allowed: string[]): Promise<string[]> {
  const ok = new Set(allowed.map(nfc));
  return (await core.writesTo()).map(nfc).filter((p) => !ok.has(p));
}
/** Commits a text field: fill, then ⏎. */
export async function commit(loc: Locator, text: string) {
  await loc.first().fill(text);
  await loc.first().press('Enter');
  await sleep(100);
}
/** Waits for `Save state` to read `want` (R9). */
export async function stateIs(page: Page, want: string, ms = 2000): Promise<boolean> {
  const got = await eventually(async () => ((await seen(saveState(page), 200)) ? (await saveState(page).first().innerText()).trim() : null), (t) => t === want, ms);
  return got === want;
}
/** How an icon button looks (D-519): shown text, tooltip (`title`), box size and border widths/styles of its four sides. */
export async function iconButtonLook(loc: Locator): Promise<{ text: string; title: string | null; width: number; height: number; borders: string[] }> {
  return loc.first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    const borders = (['Top', 'Right', 'Bottom', 'Left'] as const).map((k) => `${(s as any)[`border${k}Width`]} ${(s as any)[`border${k}Style`]}`);
    return { text: ((e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim(), title: e.getAttribute('title'), width: r.width, height: r.height, borders };
  });
}
/** Visible rows of a type table as their first cell's text. */
export async function rowTitles(page: Page, plural: string): Promise<string[]> {
  // One DOM read, so a table update between reads can't mix old and new rows.
  return typeTable(page, plural).evaluate((t) =>
    ([...t.querySelectorAll('[role="row"], tr')] as HTMLElement[])
      .filter((r) => !r.querySelector('[role="columnheader"], th'))
      .map((r) => ((r.querySelector('[role="cell"], [role="gridcell"], td') as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ').trim()));
}
/** The note text a `note_write` sent last for `path`. */
export async function lastWrite(core: FakeCoreHandle, path: string): Promise<string | null> {
  const ws = (await core.calls()).filter((c) => c.cmd === 'note_write' && nfc(String((c.args as any)?.path ?? '')) === nfc(path));
  return ws.length ? String((ws[ws.length - 1].args as any).text) : null;
}
