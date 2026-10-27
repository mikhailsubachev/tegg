// Helpers for the slice 4E-1 WebKit tests (L5): the type-moves fixture in the fake core, locators of board TypeJobs
// A and B (docs/acceptance/type-moves.md R99, R100) and file/call probes. No AC assertions here except `must`
// (re-exported) and the `need*` lookups, which turn a missing element into an AssertionError instead of a Playwright
// timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import { loadFixtureVault, type CallRecord, type FakeVault } from '../ui/test/fake-core';
import { eventually, must, mustBeOn, runCommand, seen, sleep, start, typesList, type FakeCoreHandle, type StartOptions } from './helpers';

export { eventually, must, mustBeOn, runCommand, seen, sleep };
export type { FakeCoreHandle };

export const nfc = (s: string) => s.normalize('NFC');
export const flat = (s: string | null | undefined) => nfc((s ?? '').replace(/\s+/g, ' ').trim());

/** Objects of tests/fixtures/vaults/type-moves (type-moves.md "Fixture"). */
export const M = {
  duna: 'Knihy/Duna.md',
  babicka: 'Knihy/Babička.md',
  stary: 'Knihy/2025/Starý zápis.md',
  bez: 'Knihy/Bez autora.md',
  jinde: 'Pages/Kniha jinde.md',
  sesitK: 'Knihy/Sešit.md',
  clanek: 'Pages/Článek.md',
  plan: 'Quick Notes/Plán.md',
  sesitQ: 'Quick Notes/Sešit.md',
  naSesit: 'Quick Notes/Odkaz na sešit.md',
  odkazy: 'Pages/Odkazy.md',
  schJinde: 'Pages/Schůzka jinde.md',
  knihaYml: '.tegg/types/kniha.yml',
} as const;
export const TITLES: Record<string, string> = {
  [M.duna]: 'Duna', [M.babicka]: 'Babička', [M.stary]: 'Starý zápis', [M.bez]: 'Bez autora', [M.jinde]: 'Kniha jinde', [M.sesitK]: 'Sešit',
  [M.clanek]: 'Článek', [M.plan]: 'Plán', [M.sesitQ]: 'Sešit', [M.naSesit]: 'Odkaz na sešit', [M.odkazy]: 'Odkazy', [M.schJinde]: 'Schůzka jinde',
};
export const IDS = { jinde: '01JB4E0000000000000000E005', schJinde: '01JB4E0000000000000000E016' };

/** The type-moves fixture plus `new-empty/.tegg`; README.md is not a vault file. `edit` changes files before start. */
export function movesVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/type-moves', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Přesuny' };
  delete v.files['README.md'];
  delete v.files['Knihy/seznam.docx']; // not text: the fake's files are strings (it never moves it either way)
  edit?.(v.files);
  return v;
}
/** Without the two strays (no tidy job at open). */
export const noStrays = (f: Record<string, string>) => { delete f[M.jinde]; delete f[M.schJinde]; };
export const original = (path: string) => movesVault().files[nfc(path)];

export type MovesStart = StartOptions & { vault?: FakeVault; at?: string; clock?: boolean };
/** Starts the app on the type-moves vault, landing on `at` (a note path) when given. `clock`: installs a
 *  controllable Playwright clock first (quiet-period tests). */
export async function openMoves(page: Page, o: MovesStart = {}): Promise<FakeCoreHandle> {
  if (o.clock) await page.clock.install({ time: new Date('2026-10-27T10:00:00+01:00') });
  const vault = o.vault ?? movesVault();
  const at = o.at ? nfc(o.at) : null;
  const id = at ? (/^id: (\S+)$/m.exec(vault.files[at] ?? '')?.[1] ?? null) : null;
  const core = await start(page, { vault, last: at ? { path: at, id } : null, ...o });
  if (at && TITLES[at]) await mustBeOn(page, TITLES[at], `landing on ${at}`, 5000);
  return core;
}

// ------------------------------------------------------------------------------------------------ locators

export const main = (page: Page) => page.getByRole('main');
export const moreButton = (page: Page) => main(page).getByRole('button', { name: 'More', exact: true });
export const changeTypeItem = (page: Page) => page.getByRole('menu', { name: 'More', exact: true }).getByRole('menuitem', { name: 'Change type…', exact: true });
export const changeTypeMenu = (page: Page) => page.getByRole('menu', { name: 'Change type', exact: true });
/** R99 A: the mapping dialog. */
export const mappingDialog = (page: Page) => page.getByRole('dialog', { name: /^⟦?Change type\?⟧?$/ });
export const mappingGroup = (page: Page, from: string, to: string) => mappingDialog(page).getByRole('group', { name: `Property mapping ${from} → ${to}`, exact: true });
export const mapsTo = (page: Page, name: string) => mappingDialog(page).getByRole('combobox', { name: `${name} maps to`, exact: true });
export const jobStatus = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text });
export const editorBody = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
export const section = (page: Page, name: string) => main(page).getByRole('region', { name, exact: true });
export const folderField = (page: Page) => section(page, 'General').getByRole('textbox', { name: 'Folder in the vault', exact: true });
export const notUpdatedList = (page: Page) =>
  page.getByRole('list', { name: 'Notes not updated', exact: true }).or(page.getByRole('region', { name: 'Notes not updated', exact: true })).or(page.getByRole('dialog', { name: 'Notes not updated', exact: true }));

// ------------------------------------------------------------------------------------------------ gestures

/** `More` › `Change type…` › `<name>` (types.md FR-TYP-07 AC-12, D-369). */
export async function changeTo(page: Page, name: string) {
  await (await must(moreButton(page), 'button "More"')).click();
  await (await must(changeTypeItem(page), 'menuitem "Change type…"')).click();
  const menu = await must(changeTypeMenu(page), 'menu "Change type"');
  await (await must(menu.getByRole('menuitem', { name, exact: true }), `menuitem "${name}"`)).click();
}
/** The option labels of a mapping combobox: a native select's options, or the listbox it opens. */
export async function optionsOf(page: Page, box: Locator): Promise<string[]> {
  const el = await must(box, 'mapping combobox');
  const tag = await el.evaluate((e) => e.tagName);
  if (tag === 'SELECT') return (await el.locator('option').allInnerTexts()).map(flat);
  await el.click();
  const list = page.getByRole('listbox');
  if (!(await seen(list, 1000))) return [];
  const out = (await list.getByRole('option').allInnerTexts()).map(flat);
  await page.keyboard.press('Escape');
  return out;
}
export async function valueOf(box: Locator): Promise<string> {
  return box.first().evaluate((e) => ((e as HTMLSelectElement).tagName === 'SELECT' ? (e as HTMLSelectElement).selectedOptions[0]?.text ?? '' : e.textContent ?? '').replace(/\s+/g, ' ').trim().normalize('NFC'));
}
export async function choose(page: Page, box: Locator, option: string) {
  const el = await must(box, 'mapping combobox');
  if ((await el.evaluate((e) => e.tagName)) === 'SELECT') { await el.selectOption({ label: option }); return; }
  await el.click();
  await (await must(page.getByRole('option', { name: option, exact: true }), `option ${option}`)).click();
}
/** Sidebar Types count of `label` (0 when absent). */
export async function typeCount(page: Page, label: string): Promise<number> {
  const t = (await typesList(page).getByRole('listitem').allInnerTexts()).map(flat).find((x) => x.startsWith(`${label} `));
  return t ? Number(/(\d+)$/.exec(t)?.[1] ?? 0) : 0;
}

// ------------------------------------------------------------------------------------------------ calls and files

export async function callsOf(core: FakeCoreHandle, cmd: string): Promise<CallRecord[]> {
  return (await core.calls()).filter((c) => c.cmd === cmd);
}
export const args = (c: CallRecord | undefined) => (c?.args ?? {}) as Record<string, unknown>;
export async function fileText(core: FakeCoreHandle, path: string): Promise<string | undefined> {
  return (await core.files())[nfc(path)];
}
export async function fileWhen(core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean, ms = 3000) {
  return eventually(() => fileText(core, path), ok, ms);
}
export const noModified = (t: string | undefined) => (t ?? '').replace(/^modified: .*$/m, 'modified: <x>');
export function swap(text: string | undefined, from: string, to: string): string {
  if (text === undefined || !text.includes(from)) throw new Error(`setup: fixture text lacks ${JSON.stringify(from)}`);
  return text.replace(from, to);
}
/** Waits for the one `type_move` call; returns its args and result (`{ jobId }`). */
export async function typeMoveCall(core: FakeCoreHandle, ms = 3000): Promise<CallRecord | undefined> {
  return (await eventually(() => callsOf(core, 'type_move'), (c) => c.length > 0, ms))[0];
}
export function kniha500(): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/new-empty/.tegg'), name: 'Pět set knih' };
  v.files[M.knihaYml] = movesVault().files[M.knihaYml];
  for (let i = 1; i <= 500; i++) {
    const n = String(i).padStart(3, '0');
    v.files[`Knihy/Kniha ${n}.md`] = `---\nid: 01JB4E00000000000000K00${n}\ntype: kniha\ntitle: Kniha ${n}\nautor: Autor číslo ${i}\n---\nObsah knihy ${n}.\n`;
  }
  return v;
}
