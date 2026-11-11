// Helpers for the slice Q WebKit tests (L5): the queries fixture in the fake core (docs/contracts/v1-queries.md §5), the
// test clock, zone and region of docs/acceptance/queries.md, locators from §4.3 and probes of the Queries page, the query
// page, the block and the editor. No AC assertions here except `must` and `click` (re-exported), which turn a missing
// element into an AssertionError instead of a Playwright timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import {
  absent, callsOf, click, description, eventually, flat, focusName, isDisabled, main, mainName, must, nfc, runCommand, seen, sidebar, sleep, textOf,
  type FakeCoreHandle,
} from './capture-helpers';
import { READ_COMMANDS, box, mustBeOn, openNote, paletteDialog, paletteOptions, pseudoLocale, start, type StartOptions } from './helpers';

export {
  absent, box, callsOf, click, description, eventually, flat, focusName, isDisabled, main, mainName, must, mustBeOn, nfc, openNote, paletteDialog,
  paletteOptions, pseudoLocale, runCommand, seen, sidebar, sleep, textOf,
};
export type { FakeCoreHandle, FakeVault };

export const REPO = resolve(import.meta.dirname, '../..');
const FX = resolve(REPO, 'tests/fixtures/vaults');
const QFX = resolve(REPO, 'tests/fixtures/queries-files');

/** The test clock (queries.md): Tuesday 10 Nov 2026, 10:00 in Prague. */
export const NOW = '2026-11-10T10:00:00+01:00';
export const VAULT_PATH = '/fake/Dotazy';
export const NFD = (s: string) => s.normalize('NFD');
export const ID = (nn: string) => `01JB5Q000000000000000000${nn}`;
export const qfile = (name: string) => `.tegg/queries/${nfc(name)}.yml`;
export const PINS = '.tegg/pinned.yml';
/** `tests/fixtures/queries-files/expected/<name>`. */
export const expectedFile = (name: string) => readFileSync(join(QFX, 'expected', name), 'utf8');

/** The fixture's short names (queries.md "Fixture"). */
export const P = {
  porada7: 'Schůzky/2026-10-07 Týdenní porada.md', porada14: 'Schůzky/2026-10-14 Týdenní porada.md',
  t1: 'Tasks/Poslat návrh rozpočtu Janě.md', t2: 'Tasks/Zarezervovat místo v Lisabonu.md', t3: 'Tasks/Připravit program výjezdu.md',
  t4: 'Tasks/Zeptat se Jany na limit cest.md', t5: 'Tasks/Uzavřít zápis z porady.md', t6: 'Tasks/Úkol z druhé porady.md', t7: 'Tasks/Zaplatit zálohu.md',
  lisabon: 'Projekty/Výjezd Lisabon 2026.md', rozpocet: 'Projekty/Rozpočet Q4.md', cajovna: 'Projekty/Čajovna na nábřeží.md',
  cesta: 'Projekty/Cesta do Brna.md', maly: 'Projekty/Malý projekt.md', jana: 'Osoby/Jana Nováková.md', mloci: 'Knihy/Válka s mloky.md',
  krakatit: 'Knihy/Krakatit.md', dotaz: 'Quick Notes/Dotaz na rozpočet.md', den: 'Daily/2026-11-10.md', prehled: 'Pages/Přehled dotazů.md',
  bez: 'Pages/Bez hlavičky.md', sablona: '_templates/Schůzka/Schůzka.md', smazany: '.trash/Tasks/Smazaný úkol.md',
} as const;
export const Q = {
  open: 'Otevřené úkoly z této schůzky', table: 'Úkoly z této schůzky', all: 'Vše, co sem odkazuje', running: 'Projekty v běhu', books: 'Knihy s hodnocením',
  cancelled: 'Zrušené úkoly', overdue: 'Úkoly po termínu', today: 'Vytvořeno v tento den', comments: 'Komentáře a neznámé klíče', broken: 'Nečitelný',
  newer: 'Novější verze', missing: 'Neexistující dotaz', old: 'Starý dotaz', inline: 'Ruční dotaz',
} as const;
/** FR-QRY-06 AC-1: the eleven queries, Created ↓, the unreadable one last. */
export const CREATED_DESC: string[] = [Q.today, Q.open, Q.table, Q.all, Q.running, Q.books, Q.cancelled, Q.overdue, Q.comments, Q.newer, Q.broken];
export const TITLES = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, nfc(p.split('/').pop()!.replace(/\.md$/, ''))])) as Record<keyof typeof P, string>;

/** The queries fixture plus `new-empty/.tegg` (README excluded); `edit` changes the files last. */
export function queriesVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const files: Record<string, string> = {};
  const walk = (root: string, d: string, prefix: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(root, p, prefix); continue; }
      const rel = (prefix + relative(root, p)).normalize('NFC');
      if (rel === 'README.md') continue;
      files[rel] = readFileSync(p, 'utf8');
    }
  };
  walk(join(FX, 'queries'), join(FX, 'queries'), '');
  walk(join(FX, 'new-empty/.tegg'), join(FX, 'new-empty/.tegg'), '.tegg/');
  edit?.(files);
  return { name: 'Dotazy', files };
}
export const original = (path: string) => queriesVault().files[nfc(path)];
/** A runtime query file in R138's create style. */
export function queryText(o: { title: string; types?: string[]; match?: 'all' | 'any'; filters?: string[]; sort?: string; limit?: number; view?: string; columns?: string[]; extra?: string[] }): string {
  return [
    `# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › ${o.title}.`, 'version: 1', `title: ${o.title}`, `types: [${(o.types ?? []).join(', ')}]`,
    `match: ${o.match ?? 'all'}`, ...(o.filters?.length ? ['filters:', ...o.filters.map((f) => `  - ${f}`)] : ['filters: []']),
    `sort: ${o.sort ?? '{ by: title, order: asc }'}`, `limit: ${o.limit ?? 50}`, `view: ${o.view ?? 'list'}`,
    `columns: [${(o.columns ?? ['modified']).join(', ')}]`, ...(o.extra ?? []), 'created: 2026-11-01T09:00:00+01:00', 'modified: 2026-11-01T09:00:00+01:00', '',
  ].join('\n');
}
/** A runtime note with one or more reference fences. */
export function noteWith(title: string, names: string[], o: { id?: string; type?: string; body?: string } = {}): string {
  return [
    '---', ...(o.id ? [`id: ${o.id}`] : []), `type: ${o.type ?? 'page'}`, `title: ${title}`, 'created: 2026-11-01T09:00:00+01:00', 'modified: 2026-11-01T09:00:00+01:00', '---',
    o.body ?? 'Text.', '', ...names.flatMap((n) => ['```query', `saved: ${n}`, '```', '']),
  ].join('\n');
}

export const ui = (o: { theme?: UiStateDto['theme']; preview?: 'click' | 'hover' | 'off'; sort?: string; extra?: Record<string, unknown> } = {}): UiStateDto =>
  ({
    version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, propertiesOpen: true,
    preview: { mode: o.preview ?? 'off' }, ...(o.sort ? { queries: { sort: o.sort } } : {}), ...(o.extra ?? {}),
  } as UiStateDto);

export type StartQueries = StartOptions & {
  vault?: FakeVault;
  /** Start on this route (`window.__TEGG_ROUTE__`), e.g. `queries`, `query/Projekty v běhu`, `note/<path>`. */
  route?: string;
  region?: string;
  theme?: UiStateDto['theme'];
  preview?: 'click' | 'hover' | 'off';
  sort?: string;
  /** The clock: fixed at `now` (default), installed (`install`, controllable with `page.clock`), or real. */
  now?: string;
  install?: boolean;
  realTime?: boolean;
  reducedMotion?: 'reduce' | 'no-preference';
  pseudo?: boolean;
  /** `query_run` answers `indexReady: false` from the first call (`queriesNotReady`). */
  notReady?: boolean;
};
export const noteRoute = (path: string) => `note/${nfc(path)}`;
export const queryRoute = (name: string) => `query/${nfc(name)}`;

/** Starts the main window on the queries vault (zone from `test.use({ timezoneId })`, region `cs` by default, preview
 *  mode `off` so a click on a chip or row opens at once). */
export async function startQueries(page: Page, o: StartQueries = {}): Promise<FakeCoreHandle> {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'cs');
  if (o.route) await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, o.route);
  if (o.reducedMotion) await page.emulateMedia({ reducedMotion: o.reducedMotion });
  if (o.notReady) await page.addInitScript(() => { (window as any).__teggQueriesNotReadyAtStart = true; });
  if (!o.realTime) {
    const t = new Date(o.now ?? NOW);
    if (o.install) await page.clock.install({ time: t }); else await page.clock.setFixedTime(t);
  }
  const vault = o.vault ?? queriesVault();
  const region = o.region && o.region !== 'cs' ? `import { setCollationLocale as __tcl } from '/src/i18n/collate.ts'; __tcl(${JSON.stringify(o.region)});` : '';
  const prelude = [region, o.pseudo ? pseudoLocale : ''].filter(Boolean).join('\n') || undefined;
  const uiState = o.uiState ?? ui({ theme: o.theme, preview: o.preview, sort: o.sort });
  return start(page, { ...(prelude ? { prelude } : {}), ...o, vault, vaultPath: o.vaultPath ?? VAULT_PATH, uiState, previewStored: 'asGiven' });
}

// ------------------------------------------------------------------------------------------------ §4.3 locators

const rx = (s: string) => new RegExp(`^⟦?${nfc(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}⟧?$`);
export const queriesEntry = (page: Page) => sidebar(page).locator('a.entry[data-command="queries.go"]');
export const heading = (page: Page) => main(page).getByRole('heading', { level: 1 });
export const findField = (page: Page) => main(page).getByRole('searchbox', { name: rx('Find a query…') });
export const sortButton = (page: Page) => main(page).getByRole('button').and(page.locator('[aria-haspopup="menu"]')).filter({ hasText: /Created|Updated|Title/ }).first();
export const newQueryButton = (page: Page) => main(page).getByRole('button', { name: rx('New query') });
export const queriesTable = (page: Page) => main(page).getByRole('table', { name: rx('Queries') });
export const queryRow = (page: Page, name: string) => main(page).locator(`tr[data-query-row="${nfc(name).replace(/"/g, '\\"')}"]`);
export const rowMenuButton = (page: Page, name: string) => queryRow(page, name).getByRole('button', { name: rx('Query actions') });
export const actionsMenu = (page: Page) => page.getByRole('menu', { name: rx('Query actions') });
export const menuItem = (menu: Locator, name: string) => menu.getByRole('menuitem', { name: rx(name) });
export const backLink = (page: Page) => main(page).getByRole('link', { name: /All queries/ });
export const editQueryButton = (page: Page) => main(page).getByRole('button', { name: rx('Edit query') }).and(page.locator('[aria-haspopup="dialog"]'));
export const pageMenuButton = (page: Page) => main(page).getByRole('button', { name: rx('Query actions') });
export const usedOn = (page: Page) => main(page).getByRole('list', { name: rx('Used on') });
export const usageChip = (page: Page, path: string) => main(page).locator(`a[data-usage="${nfc(path)}"]`);
export const needsPage = (page: Page) => main(page).locator('section[data-query-state="needsHost"]');

/** A block by its title (`figure` named `Query: <title>`); `n` picks among several. */
export const block = (page: Page, title: string, n = 0) => {
  const t = nfc(title).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return main(page).locator(`figure[data-query-block]:is([aria-label="Query: ${t}"], [aria-label="⟦Query: ${t}⟧"])`).nth(n);
};
export const blockByName = (page: Page, name: string, n = 0) => main(page).locator(`figure[data-query-block][data-query-name="${nfc(name)}"]`).nth(n);
export const anyBlock = (page: Page) => main(page).locator('figure[data-query-block]');
export const blockEdit = (b: Locator) => b.locator('.query-header').getByRole('button', { name: rx('Edit query') });
export const blockColumns = (b: Locator) => b.locator('.query-header').getByRole('button', { name: rx('Columns') });
export const blockSaveAs = (b: Locator) => b.getByRole('button', { name: rx('Save as query…') });
export const blockNotice = (b: Locator) => b.locator('p.query-notice');
export const blockMessage = (b: Locator) => b.locator('p.query-message');
export const blockButton = (b: Locator, name: string) => b.getByRole('button', { name: rx(name) });
export const showMore = (b: Locator) => b.getByRole('button', { name: /^⟦?Show \d+ more \(out of \d+\)⟧?$/ });
export const newObjectButton = (b: Locator) => b.getByRole('button', { name: /^⟦?New \S+/ });
export const columnsMenu = (page: Page) => page.getByRole('menu', { name: rx('Columns') });
export const resultLinks = (b: Locator) => b.locator('[data-query-result]');
export const liveRegion = (page: Page) => page.locator('div.sr-live[role="status"][aria-live="polite"]');

export const editor = (page: Page) => page.getByRole('dialog', { name: rx('Edit query') });
export const titleField = (page: Page) => editor(page).getByRole('textbox', { name: rx('Query title') });
export const typeButton = (page: Page) => editor(page).getByRole('button', { name: rx('Type') }).and(page.locator('[aria-haspopup="listbox"]'));
export const removeType = (page: Page, name: string) => editor(page).getByRole('button', { name: rx(`Remove ${name}`) });
export const filterRow = (page: Page, src: string) => editor(page).locator(`[role="group"][data-filter="${src}"]`);
export const filterRows = (page: Page) => editor(page).locator('[role="group"][data-filter]');
export const attributeBox = (row: Locator) => row.getByRole('combobox', { name: rx('Attribute') });
export const operatorBox = (row: Locator) => row.getByRole('combobox', { name: rx('Condition') });
export const valueControl = (row: Locator) => row.getByLabel(rx('Value'));
export const connector = (page: Page) => editor(page).getByRole('button', { name: /^⟦?Combine filters with (and|or)⟧?$/ });
export const group = (page: Page, how: 'any' | 'all') => editor(page).getByRole('group', { name: rx(`Filter group: ${how} of`) });
export const editorButton = (page: Page, name: string) => editor(page).getByRole('button', { name: rx(name) });
export const resultsLine = (page: Page) => editor(page).getByText(/^⟦?\d+ results?⟧?$/);
export const limitField = (page: Page) => editor(page).getByRole('spinbutton', { name: rx('Limit') }).or(editor(page).getByRole('textbox', { name: rx('Limit') })).first();
export const viewChoice = (page: Page, v: 'List' | 'Table') => editor(page).getByRole('radio', { name: rx(v) }).or(editor(page).getByRole('button', { name: rx(v) })).first();
export const picker = (page: Page) => page.getByRole('dialog', { name: rx('Choose a query') });
export const pickerOptions = (page: Page) => picker(page).getByRole('listbox').getByRole('option');
export const newQueryDialog = (page: Page) => page.getByRole('dialog', { name: rx('New query') });
export const nameField = (page: Page) => newQueryDialog(page).getByRole('textbox', { name: rx('Query name') });
export const renameDialog = (page: Page) => page.getByRole('dialog', { name: rx('Rename query') });
export const editorBody = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
export const pinnedSection = (page: Page) => sidebar(page).locator('.sidebar-pinned');
export const pinnedRow = (page: Page, label: string) => pinnedSection(page).locator('[data-pinned-row]').and(page.locator(`[title="${nfc(label)}"], [title^="${nfc(label)}\\a "]`)).first();
export const trashRow = (page: Page, label: string) => main(page).getByRole('row').filter({ hasText: nfc(label) }).first();
export const undoToast = (page: Page) => page.getByRole('button', { name: /^⟦?Undo⟧?$/ }).first();
/** A block by the text of its message (`p.query-message`). */
export const blockByMessage = (page: Page, text: string) => main(page).locator('figure[data-query-block]').filter({ has: page.locator('p.query-message', { hasText: text }) }).first();

// ------------------------------------------------------------------------------------------------ probes

/** The names of the Queries page's rows, in DOM order, with their state. */
export async function queryRows(page: Page): Promise<{ name: string; state: string | null; text: string }[]> {
  return main(page).evaluate((m) => ([...m.querySelectorAll('tr[data-query-row]')] as HTMLElement[]).map((r) => ({
    name: (r.getAttribute('data-query-row') ?? '').normalize('NFC'), state: r.getAttribute('data-query-state'), text: (r.innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC'),
  }))).catch(() => []);
}
export async function rowNamesAre(page: Page, want: string[], ms = 3000): Promise<string[]> {
  return (await eventually(() => queryRows(page), (r) => JSON.stringify(r.map((x) => x.name)) === JSON.stringify(want.map(nfc)), ms)).map((x) => x.name);
}
/** A block's state attributes. */
export async function blockInfo(b: Locator): Promise<{ state: string | null; form: string | null; name: string | null; broken: string | null; readonly: string | null; label: string; description: string }> {
  await must(b, 'a query block (figure[data-query-block])', 5000);
  return b.evaluate((f) => ({
    state: f.getAttribute('data-query-state'), form: f.getAttribute('data-query-form'), name: (f.getAttribute('data-query-name') ?? '').normalize('NFC') || null,
    broken: f.getAttribute('data-query-broken'), readonly: f.getAttribute('data-query-readonly'),
    label: (f.getAttribute('aria-label') ?? '').normalize('NFC'), description: (f.getAttribute('aria-description') ?? '').replace(/\s+/g, ' ').trim(),
  }));
}
/** Waits until a block's state is `state`; returns the last state. */
export async function blockStateIs(b: Locator, state: string, ms = 3000): Promise<string | null> {
  return eventually(() => b.getAttribute('data-query-state', { timeout: 200 }).catch(() => null), (s) => s === state, ms);
}
/** The result paths a block draws (list chips or table rows), in DOM order. */
export async function results(b: Locator): Promise<string[]> {
  return b.evaluate((f) => ([...f.querySelectorAll('[data-query-result]')] as HTMLElement[]).map((e) => (e.getAttribute('data-query-result') ?? '').normalize('NFC'))).catch(() => []);
}
/** Waits until a block draws `want` (paths in order). */
export async function resultsAre(b: Locator, want: string[], ms = 3000): Promise<string[]> {
  return eventually(() => results(b), (r) => JSON.stringify(r) === JSON.stringify(want.map(nfc)), ms);
}
/** Asserts that a block draws `want` (paths in order) within `ms`. */
export async function mustResults(b: Locator, want: string[], what: string, ms = 5000): Promise<void> {
  await must(b, `${what}: the block`, ms);
  assert.deepEqual(await resultsAre(b, want, ms), want.map(nfc), `${what}: results`);
}
/** A table block's column header texts. */
export async function headers(b: Locator): Promise<string[]> {
  return b.locator('table [role="columnheader"], table th').evaluateAll((hs) => hs.map((h) => ((h as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean)).catch(() => []);
}
/** The text of `.tegg/queries/<name>.yml` in the fake (undefined: none). */
export async function queryFileText(core: FakeCoreHandle, name: string): Promise<string | undefined> {
  return (await core.files())[qfile(name)];
}
export async function queryFileWhen(core: FakeCoreHandle, name: string, ok: (t: string | undefined) => boolean, ms = 3000) {
  return eventually(() => queryFileText(core, name), ok, ms);
}
/** Writes so far to `.tegg/queries/` files and to notes. */
export async function queryWrites(core: FakeCoreHandle): Promise<string[]> {
  return (await core.writesTo()).filter((p) => p.startsWith('.tegg/queries/'));
}
export async function noteWrites(core: FakeCoreHandle): Promise<string[]> {
  return (await core.writesTo()).filter((p) => p.endsWith('.md'));
}
/** Slice Q's read-only commands (contract §2) on top of the shell's. */
export const QUERY_READS = new Set(['queries_list', 'query_get', 'query_run', 'query_usages']);
/** IPC calls that may write: everything but reads, events and the query reads. */
export async function writeCalls(core: FakeCoreHandle): Promise<string[]> {
  return (await core.calls()).map((c) => c.cmd).filter((c) => !READ_COMMANDS.has(c) && !QUERY_READS.has(c) && !c.startsWith('plugin:event|'));
}
/** `query_run` calls since index `from`. */
export async function runsSince(core: FakeCoreHandle, from: number) {
  return (await core.queryRuns()).slice(from);
}

/** Opens `queries` from the sidebar entry and waits for its heading. */
export async function gotoQueries(page: Page) {
  await click(queriesEntry(page), 'the sidebar entry `Queries` (a.entry[data-command="queries.go"])');
  await mustBeOn(page, 'Queries', 'the Queries page');
}
/** Opens a block's editor with its pencil. */
export async function openEditor(b: Locator, page: Page) {
  await click(blockEdit(b), 'the block\'s `Edit query`');
  await must(editor(page), 'dialog `Edit query`');
}
/** Closes the editor with `Done`. */
export async function done(page: Page) {
  await click(editorButton(page, 'Done'), '`Done`');
  assert.ok(await absent(editor(page), 2000), 'the editor closes');
}
/** Opens the `Query actions` menu of a row (⋯). */
export async function rowMenu(page: Page, name: string) {
  const row = await must(queryRow(page, name), `row ${name}`);
  await row.hover();
  await click(rowMenuButton(page, name), `${name}: \`Query actions\``);
  return must(actionsMenu(page), 'menu `Query actions`');
}
/** Picks an option of the open listbox / combobox popup by its text. */
export async function pickOption(page: Page, name: string | RegExp) {
  const o = page.getByRole('option', { name: typeof name === 'string' ? rx(name) : name }).first();
  await click(o, `option ${name}`);
}
/** The menu items of a menu as texts. */
export async function menuItems(menu: Locator): Promise<string[]> {
  return menu.getByRole('menuitem').evaluateAll((xs) => xs.map((x) => ((x as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim()));
}
/** A token's resolved colour (`--link`, `--danger`, …). */
export async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((t) => {
    const e = document.createElement('span');
    e.style.color = `var(${t})`;
    document.body.appendChild(e);
    const c = getComputedStyle(e).color;
    e.remove();
    return c;
  }, token);
}
