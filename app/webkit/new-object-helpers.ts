// Helpers for the "New objects from `/` and `+`" WebKit tests (L5): the tasks fixture with its conversion notes plus
// new-empty/.tegg in the fake core (docs/acceptance/new-object-menu.md "Fixture"), the test clock of tasks.md
// (Wednesday 2026-10-14 12:00 Europe/Prague, region cs), locators from R234…R236 and
// docs/contracts/new-object-menu.md §4, and the runtime type files of FR-EDT-03 AC-7. No AC assertions here except the
// `need*` lookups, which turn a missing element into an AssertionError instead of a Playwright timeout (TS-I1).
// Written from the ACs and the contract only (D-61).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { C, NOW, caretAfter, convertVault, eventually, fileText, flat, must, nfc, original, seen, sleep, swap, type FakeCoreHandle, type FakeVault } from './convert-helpers';

export { C, NOW, caretAfter, convertVault, eventually, fileText, flat, must, nfc, original, seen, sleep, swap };
export type { FakeCoreHandle, FakeVault };

export const BLOKY = C.bloky;
/** The runtime type files of FR-EDT-03 AC-7 (`version: 1`, `system: false`, no attributes) and the unparsable one. */
export const CVICENI_YML = 'version: 1\nname: Cvičení\nplural: Cvičení\nfolder: Cvičení\nicon: dumbbell\ncolor: green\nsystem: false\nattributes: []\n';
export const CAJ_YML = 'version: 1\nname: Čaj\nplural: Čaje\nfolder: Čaje\nicon: coffee\ncolor: orange\nsystem: false\nattributes: []\n';
export const ROZBITY_YML = 'name: [\n';
export function runtimeTypes(f: Record<string, string>) {
  f['.tegg/types/cviceni.yml'] = CVICENI_YML;
  f['.tegg/types/caj.yml'] = CAJ_YML;
  f['.tegg/types/rozbity.yml'] = ROZBITY_YML;
}

export const slashMenu = (page: Page) => page.getByRole('listbox', { name: /^⟦?Insert block⟧?$/ });
/** The `New <type>` dialog of R236. */
export const newDialog = (page: Page, type: string) => page.getByRole('dialog', { name: new RegExp(`^⟦?New ${type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}⟧?$`) });
export const anyNewDialog = (page: Page) => page.getByRole('dialog', { name: /^⟦?New .+/ });
export const dialogTitle = (d: Locator) => d.getByRole('textbox', { name: /^⟦?Title⟧?$/ });
export const dialogCreate = (d: Locator) => d.getByRole('button', { name: /^⟦?Create⟧?$/ });
export const dialogCancel = (d: Locator) => d.getByRole('button', { name: /^⟦?Cancel⟧?$/ });

/** Each option's own label: `aria-label`, else its first text line without `aria-hidden` icons and `kbd` shortcuts. */
export async function optionNames(menu: Locator): Promise<string[]> {
  if (!(await seen(menu, 1000))) return [];
  return menu.first().getByRole('option').evaluateAll((os) => os.map((o) => {
    if (o.getAttribute('aria-label')) return o.getAttribute('aria-label')!.trim().normalize('NFC');
    const c = o.cloneNode(true) as HTMLElement;
    c.querySelectorAll('[aria-hidden="true"], kbd').forEach((x) => x.remove());
    document.body.appendChild(c);
    const t = (c.innerText || c.textContent || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
    c.remove();
    return t.normalize('NFC');
  }));
}
/** The menu's group headers (contract §4: `group` elements named by their header) in order. */
export async function groupNames(menu: Locator): Promise<string[]> {
  if (!(await seen(menu, 1000))) return [];
  return menu.first().evaluate((m) => [...m.querySelectorAll('[role="group"]')].map((g) => {
    const by = (g.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean).map((i) => document.getElementById(i)?.textContent ?? '').join(' ');
    return (g.getAttribute('aria-label') ?? by).trim();
  }));
}
/** The selected option's label, or null. */
export async function selectedName(menu: Locator): Promise<string | null> {
  const s = menu.first().getByRole('option', { selected: true });
  if ((await s.count()) === 0) return null;
  const names = await optionNames(menu);
  const idx = await menu.first().getByRole('option').evaluateAll((os) => os.findIndex((o) => o.getAttribute('aria-selected') === 'true'));
  return names[idx] ?? null;
}
/** Waits for the menu and returns its option labels. */
export async function needMenu(page: Page, what: string, ms = 2000): Promise<{ menu: Locator; names: string[] }> {
  const menu = await must(slashMenu(page), `${what}: listbox "Insert block"`, ms);
  await sleep(100);
  return { menu, names: await optionNames(menu) };
}
export async function needDialog(page: Page, type: string, what: string, ms = 2000): Promise<Locator> {
  return must(newDialog(page, type), `${what}: dialog "New ${type}" (R236)`, ms);
}
/** The new-object bytes of R238 (id masked) for a Page or a Task at NOW. */
export function newBytes(type: 'page' | 'task' | 'quick-note', title: string, titleYaml = title): string {
  return '---\nid: <id>\n' + `type: ${type}\n` + `title: ${titleYaml}\n` + (type === 'task' ? 'status: To do\n' : '') + (type === 'quick-note' ? 'review: unreviewed\n' : '')
    + `created: ${NOW}\nmodified: ${NOW}\n---\n`;
}
/** The text with its `id` checked as a ULID and masked. */
export function masked(text: string | undefined): string {
  const id = /^id: (\S+)$/m.exec(text ?? '')?.[1];
  assert.ok(id && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id), `id is a ULID: ${id}`);
  return (text ?? '').replace(/^id: .*$/m, 'id: <id>');
}
/** Waits for a file to exist. */
export async function fileExists(core: FakeCoreHandle, path: string, ms = 3000): Promise<string | undefined> {
  return eventually(() => fileText(core, path), (t) => t !== undefined, ms);
}
/** Vault paths created since the start (not in `base`). */
export async function created(core: FakeCoreHandle, base: FakeVault = convertVault()): Promise<string[]> {
  const now = Object.keys(await core.files());
  return now.filter((p) => !(p in base.files)).sort();
}
