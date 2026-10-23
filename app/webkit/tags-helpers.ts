// Helpers for the MS4 slice 4D-lite WebKit tests (L5): the tags fixture in the fake core (docs/contracts/ms4-tags.md
// §8.1), the test clock, zone and region, locators from docs/acceptance/tags.md R81…R85 and call probes. No AC
// assertions here except `must` (re-exported), `click` and the `need*` lookups, which turn a missing element into an
// AssertionError instead of a Playwright timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { type BackupRecord, type FakeOptions, type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import {
  absent, callsOf, click, description, eventually, flat, focusName, isDisabled, main, mainName, must, mustBeOn, nfc, runCommand, seen, sidebar, sleep,
  textOf, type FakeCoreHandle,
} from './capture-helpers';
import { start, type StartOptions } from './helpers';

export {
  absent, callsOf, click, description, eventually, flat, focusName, isDisabled, main, mainName, must, mustBeOn, nfc, runCommand, seen, sidebar, sleep, textOf,
};
export type { FakeCoreHandle, FakeVault, BackupRecord };

export const REPO = resolve(import.meta.dirname, '../..');
const FX = resolve(REPO, 'tests/fixtures/vaults/tags');

/** The test clock (tags.md): Thursday 22 Oct 2026, 10:00 in Prague = 01:00 in Los Angeles. */
export const NOW = '2026-10-22T10:00:00+02:00';
export const NOW_IN: Record<string, string> = { 'Europe/Prague': '2026-10-22T10:00:00+02:00', 'America/Los_Angeles': '2026-10-22T01:00:00-07:00' };
export const ZONES = ['Europe/Prague', 'America/Los_Angeles'] as const;
export const NFD = (s: string) => s.normalize('NFD');

/** The fixture's paths (tests/fixtures/vaults/tags/README.md). */
export const P = {
  rozpocet: 'Pages/Rozpočet.md', najem: 'Tasks/Zaplatit nájem.md', banka: 'Tasks/Zavolat bance.md', faktura: 'Quick Notes/Faktura.md',
  den: 'Daily/2026-10-20.md', dvakrat: 'Pages/Dvakrát.md', kod: 'Pages/Kód.md', web: 'Projekty/Web.md', lomitko: 'Pages/Lomítko.md',
  kniha: 'Pages/Kniha.md', odkaz: 'Pages/Odkaz na štítek.md', schuzka: 'Pages/Schůzka.md', schuzka2: 'Pages/schůzka (2).md',
  naSchuzku: 'Pages/Odkaz na schůzku.md', sablona: '_templates/Page/Page.md', kos: '.trash/Pages/Starý.md',
  fUcty: 'Tags/Účty.md', fAb: 'Tags/a b.md', fPrazdny: 'Tags/prázdný.md', fDvoji: 'Tags/dvojí.md', fDvoji2: 'Tags/Dvojí (2).md',
  fNeznama: 'Tags/neznámá.md', fCizi: 'Pages/Cizí štítek.md', fKos: '.trash/Tags/starý.md',
} as const;
export const vypln = (n: number) => `Pages/Výplň ${String(n).padStart(2, '0')}.md`;
/** R80's display names, key → name. */
export const NAMES: Record<string, string> = {
  'účty': 'Účty', finance: 'finance', 'dvojí': 'dvojí', 'a/b': 'a/b', 'účty/archiv': 'účty/archiv', 'účty-2026': 'účty-2026', 'čtení': 'čtení',
  'neznámá': 'neznámá', 'prázdný': 'prázdný', 'cizí': 'cizí',
};

/** The tags fixture plus `new-empty/.tegg` (README.md isn't a vault file). `edit` changes files before start. */
export function tagsVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const files: Record<string, string> = {};
  const walk = (root: string, d: string, prefix: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const rel = (prefix + relative(root, p)).normalize('NFC');
      if (statSync(p).isDirectory()) { walk(root, p, prefix); continue; }
      if (rel === 'README.md') continue;
      files[rel] = readFileSync(p, 'utf8');
    }
  };
  walk(FX, FX, '');
  const tegg = resolve(REPO, 'tests/fixtures/vaults/new-empty/.tegg');
  walk(tegg, tegg, '.tegg/');
  edit?.(files);
  return { name: 'Štítky', files };
}
export const original = (path: string) => tagsVault().files[nfc(path)];
export const idOf = (text: string | undefined) => /^id: (\S+)$/m.exec(text ?? '')?.[1] ?? null;
export function swap(text: string | undefined, from: string, to: string): string {
  assert.ok(text !== undefined && text.includes(from), `setup: ${JSON.stringify(from)} in the text`);
  return text!.replace(from, to);
}
/** The route of a tag page (ms4-tags §6.1: `tag/<encodeURIComponent(key)>`). */
export const tagRoute = (key: string) => `tag/${encodeURIComponent(nfc(key))}`;

export const ui = (o: { theme?: UiStateDto['theme']; extra?: Record<string, unknown> } = {}): UiStateDto =>
  ({ version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, ...(o.extra ?? {}) } as UiStateDto);

export type StartTags = StartOptions & {
  vault?: FakeVault;
  /** Start on this route (`window.__TEGG_ROUTE__`). */
  route?: string;
  /** Land on this note path (`vault_last`). */
  at?: string;
  now?: string;
  install?: boolean;
  region?: string;
  theme?: UiStateDto['theme'];
  uiExtra?: Record<string, unknown>;
  backups?: FakeOptions['backups'];
  readView?: boolean;
};

/** Starts the main window on the tags vault (zone from `test.use({ timezoneId })`). */
export async function startTags(page: Page, o: StartTags = {}): Promise<FakeCoreHandle> {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'cs');
  if (o.readView) await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; });
  if (o.route) await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, o.route);
  const t = new Date(o.now ?? NOW);
  if (o.install) await page.clock.install({ time: t });
  else await page.clock.setFixedTime(t);
  const vault = o.vault ?? tagsVault();
  const last = o.at ? { path: nfc(o.at), id: idOf(vault.files[nfc(o.at)]) } : null;
  // (C): a region other than `cs` also sets the collation locale before the app renders (ms3-shell §3.6).
  const prelude = o.region && o.region !== 'cs' ? `import { setCollationLocale as __tcl } from '/src/i18n/collate.ts'; __tcl(${JSON.stringify(o.region)});` : undefined;
  return start(page, { ...(prelude ? { prelude } : {}), ...o, vault, last, uiState: o.uiState ?? ui({ theme: o.theme, extra: o.uiExtra }) });
}
/** Starts on All tags. */
export async function openAllTags(page: Page, o: StartTags = {}): Promise<FakeCoreHandle> {
  const core = await startTags(page, { ...o, route: 'tags' });
  await must(allTagsHeading(page), 'All tags: heading "Tags" (R81)', 5000);
  return core;
}
/** Starts on `tag/<key>` and waits for its heading. */
export async function openTagPage(page: Page, key: string, o: StartTags = {}): Promise<FakeCoreHandle> {
  const core = await startTags(page, { ...o, route: tagRoute(key) });
  await must(tagHeading(page, NAMES[key] ?? key), `tag/${key}: heading (R82)`, 5000);
  return core;
}
/** Starts on a note and waits for its page. */
export async function openNote(page: Page, path: string, title: string, o: StartTags = {}): Promise<FakeCoreHandle> {
  const core = await startTags(page, { ...o, at: path });
  await mustBeOn(page, nfc(title), `landing on ${path}`, 5000);
  return core;
}

// ------------------------------------------------------------------------------------------------ R81 All tags

export const allTagsHeading = (page: Page) => main(page).getByRole('heading', { level: 1, name: /^⟦?Tags⟧?$/ });
export const newTagBtn = (page: Page) => main(page).getByRole('button', { name: 'New tag', exact: true });
export const findBox = (page: Page) => main(page).getByRole('textbox', { name: 'Find a tag', exact: true });
export const tagsSortBtn = (page: Page) => main(page).getByRole('button', { name: /^(Most used|Name|Last used) [↓↑]$/ });
export const tagsTable = (page: Page) => main(page).getByRole('table', { name: 'Tags', exact: true });
export const tagRowEl = (page: Page, key: string) => tagsTable(page).locator(`[data-tag="${nfc(key)}"]`);
/** The rows' `data-tag` keys, in order. */
export async function tagKeys(page: Page): Promise<string[]> {
  if (!(await seen(tagsTable(page), 1000))) return [];
  return tagsTable(page).evaluate((t) => ([...t.querySelectorAll('[data-tag]')] as HTMLElement[]).map((e) => (e.getAttribute('data-tag') ?? '').normalize('NFC')));
}
/** The rows as their cell texts (whitespace collapsed). */
export async function tagRowsText(page: Page): Promise<string[][]> {
  if (!(await seen(tagsTable(page), 1000))) return [];
  return tagsTable(page).evaluate((t) => ([...t.querySelectorAll('[data-tag]')] as HTMLElement[]).map((r) =>
    ([...r.querySelectorAll('[role="cell"], [role="gridcell"], [role="rowheader"], td, th')] as HTMLElement[]).map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim().normalize('NFC'))));
}
export const columnHeader = (scope: Locator, name: string) => scope.getByRole('columnheader', { name: new RegExp(`^${name}`) });

// ------------------------------------------------------------------------------------------------ R82 Tag page

/** The heading of a tag page (R82): only inside a page with the `‹ All tags` breadcrumb link, so a note page whose
 *  title is the same (a Tag file opened as a note) never matches. */
export const tagHeading = (page: Page, name: string) =>
  main(page).filter({ has: page.getByRole('link', { name: /^⟦?‹ All tags⟧?$/ }) }).getByRole('heading', { level: 1, name: nfc(name), exact: true });
export const breadcrumb = (page: Page) => main(page).getByRole('navigation', { name: 'Breadcrumb', exact: true });
export const colourTile = (page: Page) => main(page).getByRole('button', { name: 'Tag colour', exact: true });
export const tagActionsBtn = (page: Page) => main(page).getByRole('button', { name: 'Tag actions', exact: true });
export const tagActionsMenu = (page: Page) => page.getByRole('menu', { name: 'Tag actions', exact: true });
export const newWithBtn = (page: Page, name: string) => main(page).getByRole('button', { name: `New with #${nfc(name)}`, exact: true });
export const filterBox = (page: Page) => main(page).getByRole('textbox', { name: 'Filter by text', exact: true });
export const typeFilterBtn = (page: Page) => main(page).getByRole('button', { name: /^Type: / });
export const pageSortBtn = (page: Page) => main(page).getByRole('button', { name: /^(Title|Type|Other tags|Modified) [↓↑]$/ });
export const groupingBtn = (page: Page) => main(page).getByRole('button', { name: /^(No grouping|Grouped by type)$/ });
export const objectsTable = (page: Page, name: string) => main(page).getByRole('table', { name: `Objects with #${nfc(name)}`, exact: true });
/** The rows' `data-path`, in order. */
export async function rowPaths(page: Page, name: string): Promise<string[]> {
  if (!(await seen(objectsTable(page, name), 1000))) return [];
  return objectsTable(page, name).evaluate((t) => ([...t.querySelectorAll('[data-path]')] as HTMLElement[]).map((e) => (e.getAttribute('data-path') ?? '').normalize('NFC')));
}
export async function rowsWhen(page: Page, name: string, ok: (p: string[]) => boolean, ms = 2500) {
  return eventually(() => rowPaths(page, name), ok, ms);
}
export const rowEl = (page: Page, name: string, path: string) => objectsTable(page, name).locator(`[data-path="${nfc(path)}"]`);
/** Group headers of a grouped table: `<Type name> <count>`. */
export async function groupHeaders(page: Page, name: string): Promise<string[]> {
  if (!(await seen(objectsTable(page, name), 1000))) return [];
  return objectsTable(page, name).evaluate((t) => ([...t.querySelectorAll('[role="rowgroup"]')] as HTMLElement[])
    .map((g) => g.querySelector('[role="row"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '').filter((x) => x && !/^Title\b/.test(x)));
}
/** Opens a `menuitemradio` menu from `btn` and chooses `item`. */
export async function chooseRadio(page: Page, btn: Locator, item: string, what: string) {
  await click(btn, what);
  await click(page.getByRole('menuitemradio', { name: new RegExp(`^${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\d+)?$`) }), `menuitemradio ${item}`);
}

// ------------------------------------------------------------------------------------------------ R83 sidebar

export const sidebarTagsHeader = (page: Page) => sidebar(page).getByRole('button', { name: /^Tags, all \d+$/ });
/** The section's tag links as their visible texts, in order. */
export async function sidebarTagLinks(page: Page): Promise<string[]> {
  const nav = sidebar(page);
  if (!(await seen(nav, 1000))) return [];
  return nav.evaluate((n) => {
    const head = [...n.querySelectorAll('button, [role="button"]')].find((b) => /^Tags, all \d+$/.test(b.getAttribute('aria-label') ?? b.textContent ?? '')) as HTMLElement | undefined;
    const scope = head?.closest('section, [role="group"], [role="region"], li, div') ?? null;
    const links = scope ? ([...scope.querySelectorAll('a, [role="link"]')] as HTMLElement[]) : [];
    return links.map((a) => (a.textContent ?? '').replace(/\s+/g, ' ').trim().normalize('NFC')).filter((t) => t.startsWith('#'));
  });
}
export const sidebarTagLink = (page: Page, name: string) => sidebar(page).getByRole('link', { name: new RegExp(`^#${nfc(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) });

// ------------------------------------------------------------------------------------------------ R84 dialogs

export const dialogNamed = (page: Page, name: string) => page.getByRole('dialog', { name: nfc(name), exact: true }).or(page.getByRole('alertdialog', { name: nfc(name), exact: true }));
export const newTagDialog = (page: Page) => page.getByRole('dialog', { name: 'New tag', exact: true });
export const tagNameBox = (page: Page) => newTagDialog(page).getByRole('textbox', { name: 'Tag name', exact: true });
export const renameDialog = (page: Page, name: string) => page.getByRole('dialog', { name: `Rename #${nfc(name)}`, exact: true });
export const deleteDialog = (page: Page, name: string) => page.getByRole('alertdialog', { name: `Delete #${nfc(name)}?`, exact: true });
export const colourPopover = (page: Page) => page.getByRole('dialog', { name: 'Tag colour', exact: true });
export const swatches = (page: Page) => colourPopover(page).getByRole('radiogroup', { name: 'Tag colour', exact: true });
export const swatch = (page: Page, label: string) => swatches(page).getByRole('radio', { name: label, exact: true });
export async function checkedSwatches(page: Page): Promise<string[]> {
  if (!(await seen(swatches(page), 1000))) return [];
  return swatches(page).evaluate((g) => ([...g.querySelectorAll('[role="radio"]')] as HTMLElement[]).filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.getAttribute('aria-label') ?? (r.textContent ?? '').trim()));
}
export async function openNewTag(page: Page) {
  await click(newTagBtn(page), 'button "New tag" (R81)');
  await must(newTagDialog(page), 'dialog "New tag" (R84)');
}
export async function tagAction(page: Page, item: string) {
  await click(tagActionsBtn(page), 'button "Tag actions" (R82)');
  await must(tagActionsMenu(page), 'menu "Tag actions"');
  await click(tagActionsMenu(page).getByRole('menuitem', { name: new RegExp(`^${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }), `menuitem ${item}`);
}

// ------------------------------------------------------------------------------------------------ R85 backups

export const backupsHeading = (page: Page) => main(page).getByRole('heading', { level: 1, name: 'Backups', exact: true });
export const backupsList = (page: Page) => main(page).getByRole('list', { name: 'Backups', exact: true });
export async function backupRows(page: Page): Promise<string[]> {
  if (!(await seen(backupsList(page), 1000))) return [];
  return backupsList(page).evaluate((l) => ([...l.querySelectorAll('[role="listitem"], li')] as HTMLElement[]).map((e) => (e.textContent ?? '').replace(/[\s  ]+/g, ' ').trim().normalize('NFC')));
}

// ------------------------------------------------------------------------------------------------ chips and styles

/** Computed background and text colour of an element, and the resolved values of `--type-<c>` / `--type-<c>-bg`. */
export async function chipColours(loc: Locator, colour: string | null): Promise<{ bg: string; fg: string; wantBg: string; wantFg: string }> {
  await must(loc, 'a tag chip');
  return loc.first().evaluate((e, c) => {
    const cs = getComputedStyle(e as HTMLElement);
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    probe.style.background = c ? `var(--type-${c}-bg)` : 'var(--hover)';
    probe.style.color = c ? `var(--type-${c})` : 'var(--muted)';
    const ps = getComputedStyle(probe);
    const out = { bg: cs.backgroundColor, fg: cs.color, wantBg: ps.backgroundColor, wantFg: ps.color };
    probe.remove();
    return out;
  }, colour);
}
/** `#<name>` chips inside `scope` (links or buttons whose text starts with `#`). */
export const chip = (scope: Locator, name: string) => scope.locator('a, button, [role="link"], [role="button"], span, mark').filter({ hasText: new RegExp(`^#${nfc(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });

// ------------------------------------------------------------------------------------------------ probes

/** Commands that change vault files (6A set plus the 4D-lite jobs, ms4-tags §3, §4.4). */
export const VAULT_WRITES = new Set([
  'note_write', 'note_create', 'note_create_exact', 'note_trash', 'note_discard', 'note_rename', 'daily_create', 'link_create', 'type_create',
  'type_patch', 'type_delete', 'starter_add', 'vault_create', 'vault_settings_patch', 'capture_create', 'inbox_bulk', 'job_retry', 'job_undo',
  'job_redo', 'object_trash', 'trash_restore', 'trash_delete', 'trash_empty', 'media_add', 'media_add_paths',
  'tag_rename', 'tag_delete', 'merge_start', 'backup_restore', 'job_confirm',
]);
export async function vaultWrites(core: FakeCoreHandle): Promise<string[]> {
  return (await core.calls()).map((c) => c.cmd).filter((c) => VAULT_WRITES.has(c));
}
export async function snapshot(core: FakeCoreHandle): Promise<Record<string, string>> {
  return { ...(await core.files()) };
}
export const changedKeys = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
export async function fileText(core: FakeCoreHandle, path: string): Promise<string | undefined> {
  return (await core.files())[nfc(path)];
}
export async function fileWhen(core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean, ms = 2500): Promise<string | undefined> {
  return eventually(() => fileText(core, path), ok, ms);
}
/** The job reports once `n` jobs have finished. */
export async function jobsWhen(core: FakeCoreHandle, n: number, ms = 5000) {
  return eventually(() => core.jobs(), (j) => j.length >= n, ms);
}
export const jobStatus = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text });
export const editorBody = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
