// Helpers for the MS4 slice 4C WebKit tests (L5): the rename fixture in the fake core, the title commit gestures, and
// locators from docs/contracts/ms4-jobs.md §10 (status element, "Notes not updated" list, D-737) and ms3-shell §13.5. No AC
// assertions here except `must` (re-exported) and the `need*` lookups, which turn a missing element into an
// AssertionError instead of a Playwright timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault, type CallRecord, type FakeVault } from '../ui/test/fake-core';
import { eventually, must, mustBeOn, runCommand, seen, settled, sleep, start, type FakeCoreHandle, type StartOptions } from './helpers';
import { goToQuery } from './helpers'; // D-1345: the Search page's first result (D-1340)

export { eventually, must, mustBeOn, runCommand, seen, sleep };
export type { FakeCoreHandle };

export const nfc = (s: string) => s.normalize('NFC');
export const flat = (s: string | null | undefined) => nfc((s ?? '').replace(/\s+/g, ' ').trim());

/** Objects of tests/fixtures/vaults/rename (rename.md "Fixture"). */
export const R = {
  alfa: 'Pages/Alfa.md',
  gama: 'Pages/Gama.md',
  odkazy: 'Pages/Odkazy.md',
  kod: 'Pages/Kód.md',
  vlastnosti: 'Books/Vlastnosti.md',
  nfd: 'Pages/NFD odkaz.md',
  caj: 'Pages/Čaj o páté.md',
  dvojnik: 'Pages/Alfa (2).md',
  jinde: 'Projekty/Alfa.md',
  mistni: 'Projekty/Místní.md',
  sablona: '_templates/Page/Page.md',
  kos: '.trash/Pages/Starý.md',
  den: 'Daily/2026-10-14.md',
  windows: 'Pages/Windows.md',
  beta: 'Pages/Beta.md',
} as const;
export const TITLES: Record<string, string> = {
  [R.alfa]: 'Alfa', [R.odkazy]: 'Odkazy', [R.kod]: 'Kód', [R.vlastnosti]: 'Vlastnosti', [R.nfd]: 'NFD odkaz', [R.caj]: 'Čaj o páté',
  [R.dvojnik]: 'Alfa', [R.jinde]: 'Alfa', [R.mistni]: 'Místní', [R.windows]: 'Windows', [R.beta]: 'Beta',
};
/** The files Alfa → Gama rewrites besides Alfa itself (FR-LNK-03 AC-13). */
export const GAMA_OTHERS = [R.odkazy, R.vlastnosti, R.den, R.sablona, R.windows];

/** The rename fixture plus `new-empty/.tegg`; its README.md isn't a vault file. `edit` changes files before start. */
export function renameVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/rename', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Přejmenování' };
  delete v.files['README.md'];
  edit?.(v.files);
  return v;
}
export const original = (path: string) => renameVault().files[nfc(path)];
export const idOf = (text: string | undefined) => /^id: (\S+)$/m.exec(text ?? '')?.[1] ?? null;

/** Odkazy after Alfa → Gama (FR-LNK-03 AC-7). */
export function odkazyAfterGama(): string {
  return original(R.odkazy)
    .replace('\n[[Alfa]]\n', '\n[[Gama]]\n')
    .replace('[[Alfa|vlastní text]]', '[[Gama|vlastní text]]')
    .replace('\n[[Alfa#Úvod]]', '\n[[Gama#Úvod]]')
    .replace('[[Alfa#^b1]]', '[[Gama#^b1]]')
    .replace('![[Alfa]]', '![[Gama]]')
    .replace('![[Alfa#Úvod]]', '![[Gama#Úvod]]')
    .replace('[[Pages/Alfa]]', '[[Pages/Gama]]')
    .replace('[[Alfa.md]]', '[[Gama.md]]')
    .replace('[Alfa](Alfa.md)', '[Alfa](Gama.md)')
    .replace('[jinak](../Pages/Alfa.md)', '[jinak](../Pages/Gama.md)');
}

export type RenameStart = StartOptions & { vault?: FakeVault; route?: string };

/** Starts the app with the rename vault on `path` (launch landing via `vault_last`, or a forced route) and waits for
 *  the editor. */
export async function openRename(page: Page, path: string, o: RenameStart = {}): Promise<FakeCoreHandle> {
  if (o.route) await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, o.route);
  const vault = o.vault ?? renameVault();
  const core = await start(page, { vault, last: { path: nfc(path), id: idOf(vault.files[nfc(path)]) }, ...o });
  if (!o.route && TITLES[path]) await mustBeOn(page, TITLES[path], `landing on ${path}`, 5000);
  return core;
}

// ------------------------------------------------------------------------------------------------ locators

export const editorBody = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
export const titleField = (page: Page) => page.getByRole('textbox', { name: 'Title', exact: true });
/** The job status element (FR-UX-07 AC-9): `role="status"` with the given text. */
export const jobStatus = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text });
/** The status-area entry `<n> notes not updated` (FR-LNK-03 AC-16; `notes` for every job kind since 4D-lite, D-731). */
export const notUpdatedEntry = (page: Page) => page.getByRole('button', { name: /^\d+ notes? not updated$/ }).or(page.getByRole('link', { name: /^\d+ notes? not updated$/ }));
/** The non-modal list `Notes not updated` (ms4-jobs §10; renamed for every job kind by D-737, AP-685/D-747). */
export const notUpdatedList = (page: Page) =>
  page.getByRole('list', { name: 'Notes not updated', exact: true }).or(page.getByRole('region', { name: 'Notes not updated', exact: true })).or(page.getByRole('dialog', { name: 'Notes not updated', exact: true }));
export const anyModal = (page: Page) => page.locator('[aria-modal="true"]');

// ------------------------------------------------------------------------------------------------ gestures

/** Puts the caret in the title, selects it and types `title` (one key at a time, `delayMs` apart). */
export async function typeTitle(page: Page, title: string, delayMs = 0) {
  const t = await must(titleField(page), 'textbox "Title"', 5000);
  await t.click();
  await page.keyboard.press('Meta+a');
  if (delayMs > 0) await page.keyboard.type(title, { delay: delayMs });
  else await page.keyboard.type(title);
}
/** Commits the title by ↩, Tab or a click in the body (D-268). */
export async function commit(page: Page, how: 'enter' | 'tab' | 'body' = 'enter') {
  if (how === 'enter') await page.keyboard.press('Enter');
  else if (how === 'tab') await page.keyboard.press('Tab');
  else await (await must(editorBody(page), 'textbox "Note body"')).click({ position: { x: 40, y: 10 } });
}

// ------------------------------------------------------------------------------------------------ calls

export async function callsOf(core: FakeCoreHandle, cmd: string): Promise<CallRecord[]> {
  return (await core.calls()).filter((c) => c.cmd === cmd);
}
export const args = (c: CallRecord | undefined) => (c?.args ?? {}) as Record<string, unknown>;
export async function fileText(core: FakeCoreHandle, path: string): Promise<string | undefined> {
  return (await core.files())[nfc(path)];
}
/** Waits until the fake's file at `path` satisfies `ok`; returns the last text. */
export async function fileEventually(core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean, ms = 3000): Promise<string | undefined> {
  return eventually(() => fileText(core, path), ok, ms);
}
/** The single `note_rename` call the commit made, or an assertion failure. */
export async function oneRename(core: FakeCoreHandle, ms = 2000): Promise<CallRecord> {
  const calls = await eventually(() => callsOf(core, 'note_rename'), (c) => c.length > 0, ms);
  assert.equal(calls.length, 1, `exactly one note_rename call: ${JSON.stringify(calls.map((c) => c.args))}`);
  return calls[0];
}
export async function gotoNote(page: Page, title: string) {
  await goToQuery(page, title);
  await page.keyboard.press('Enter');
  await mustBeOn(page, title, `open "${title}"`, 5000);
}
export async function needButton(scope: Locator, name: string): Promise<Locator> {
  return must(scope.getByRole('button', { name, exact: true }), `button "${name}"`);
}
