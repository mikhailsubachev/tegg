// Helpers for the slice OC WebKit tests (L5): the cards fixture in the fake core (docs/contracts/v1-cards.md §13: the
// views base, new-empty's `.tegg/`, the cards/ overlay and the two attachments of its README), the test clock of
// docs/acceptance/cards.md, locators from §8 and probes of cards, the Card section, the icon picker and the settings
// layout. No AC assertions here except `must` and `click` (re-exported), which turn a missing element into an
// AssertionError instead of a Playwright timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { type FakeVault } from '../ui/test/fake-core';
import {
  absent, callsOf, click, description, eventually, flat, focusName, isDisabled, main, mainName, must, mustBeOn, nfc, openNote, paletteDialog, paletteOptions,
  pseudoLocale, runCommand, seen, sidebar, sleep, startQueries, textOf, type FakeCoreHandle, type StartQueries,
} from './queries-helpers';

export {
  absent, callsOf, click, description, eventually, flat, focusName, isDisabled, main, mainName, must, mustBeOn, nfc, openNote, paletteDialog, paletteOptions, pseudoLocale,
  runCommand, seen, sidebar, sleep, textOf,
};
export type { FakeCoreHandle, FakeVault };

export const REPO = resolve(import.meta.dirname, '../..');
const FX = resolve(REPO, 'tests/fixtures/vaults');

/** The test clock (cards.md): Thursday 19 Nov 2026, 10:00 in Prague. */
export const NOW = '2026-11-19T10:00:00+01:00';
export const VAULT_PATH = '/fake/Výlety a knihy';
export const NFD = (s: string) => s.normalize('NFD');
export const VYLET_YML = '.tegg/types/výlet.yml';
export const CLANEK_YML = '.tegg/types/článek.yml';
export const KONTROLA_YML = '.tegg/types/kontrola.yml';
export const BOOK_YML = '.tegg/types/book.yml';
export const TASK_YML = '.tegg/types/task.yml';
export const STAV_Q = 'Výlety podle stavu';
export const SEVEN = 'Sedm typů';
export const VYLET_CARD = 'card: [tags, description, stav, náročnost, kraj, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]\n';
export const P = {
  snezka: 'Výlety/Sněžka z Pece.md', machovo: 'Výlety/Okolo Máchova jezera.md', palava: 'Výlety/Pálava na kole.md', magistrala: 'Výlety/Krkonošská magistrála.md',
  chaty: 'Články/Horské chaty.md', podklady: 'Články/Podklady k výletům.md', bez: 'Články/Bez zdroje.md', textovy: 'Články/Textový zdroj.md', odkaz: 'Články/Odkaz na výlet.md',
  kontrola: 'Kontroly/Kontrola kola.md', napad: 'Quick Notes/Nápad na výlet.md', vyhlidka: 'Images/Vyhlídka na Pálavě.md', pravidla: 'PDFs/Pravidla tábora.md',
  ucetni: 'Books/Účetní ze Žižkova.md', karty: 'Pages/Karty.md', eva: 'Autoři/Eva Lindová.md',
} as const;

/** The base, new-empty's `.tegg/` and the overlay (READMEs and the expected card data excluded), the attachments in
 *  `bin` (base64); `edit` changes the text files last. */
export function cardsVault(edit?: (files: Record<string, string>, bin: Record<string, string>) => void): FakeVault {
  const files: Record<string, string> = {};
  const walk = (root: string, d: string, prefix: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(root, p, prefix); continue; }
      const rel = (prefix + relative(root, p)).normalize('NFC');
      if (rel === 'README.md' || rel === 'expected-card-data.json') continue;
      files[rel] = readFileSync(p, 'utf8');
    }
  };
  walk(join(FX, 'views'), join(FX, 'views'), '');
  walk(join(FX, 'new-empty/.tegg'), join(FX, 'new-empty/.tegg'), '.tegg/');
  walk(join(FX, 'cards'), join(FX, 'cards'), '');
  const bin: Record<string, string> = {
    '_attachments/vyhlidka.png': readFileSync(join(FX, 'trash-media/_attachments/záhon.png')).toString('base64'),
    '_attachments/pravidla-tabora.pdf': readFileSync(join(FX, 'trash-media/_attachments/Rozpočet.pdf')).toString('base64'),
  };
  edit?.(files, bin);
  return { name: 'Výlety a knihy', files, bin };
}
export const original = (path: string) => cardsVault().files[nfc(path)];
export function swap(text: string | undefined, from: string, to: string): string {
  if (text === undefined || !text.includes(from)) throw new Error(`setup: ${JSON.stringify(from)} is not in the text`);
  return text.replace(from, to);
}
export const vyletWith = (line: string) => swap(original(VYLET_YML), VYLET_CARD, line);
/** A runtime board query in R138's create style. */
export function boardQuery(title: string, types: string[], groupBy: string): string {
  return [`# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › ${title}.`, 'version: 1', `title: ${title}`, `types: [${types.join(', ')}]`, 'match: all', 'filters: []',
    'sort: { by: title, order: asc }', 'limit: 50', 'view: board', `group_by: ${groupBy}`, 'lanes: vertical', 'created: 2026-11-01T09:00:00+01:00', 'modified: 2026-11-01T09:00:00+01:00', ''].join('\n');
}
export const sevenTypes = (files: Record<string, string>) => { files[`.tegg/queries/${SEVEN}.yml`] = boardQuery(SEVEN, ['výlet', 'článek', 'kontrola', 'quick-note', 'image', 'pdf', 'book'], 'tags'); };

export const ui = (extra: Record<string, unknown> = {}) =>
  ({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, propertiesOpen: true, preview: { mode: 'click' }, dateTime: { date: 'region', time: 'region', week: 'region' }, ...extra }) as any;
export type StartCards = Omit<StartQueries, 'vault'> & { vault?: FakeVault; ui?: Record<string, unknown> };
/** Starts the main window on the cards vault at the test clock (1,440 × 900, sidebar open, panel closed, `en-US`). */
export async function startCards(page: Page, o: StartCards = {}): Promise<FakeCoreHandle> {
  await page.setViewportSize({ width: 1440, height: 900 });
  return startQueries(page, { now: NOW, region: 'en-US', ...o, vault: o.vault ?? cardsVault(), vaultPath: o.vaultPath ?? VAULT_PATH, uiState: o.uiState ?? ui(o.ui ?? {}) });
}
export const typeRoute = (key: string) => `type/${nfc(key)}`;
export const settingsRoute = (key: string) => `type-settings/${nfc(key)}`;
export const queryRoute = (name: string) => `query/${nfc(name)}`;
export const noteRoute = (path: string) => `note/${nfc(path)}`;

// ------------------------------------------------------------------------------------------------ §8.1 the card

const rx = (s: string) => new RegExp(`^⟦?${nfc(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}⟧?$`);
export { rx };
const attr = (s: string) => nfc(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
export const objectCards = (scope: Locator | Page) => scope.locator('article[data-object-card]');
export const objectCard = (scope: Locator | Page, path: string) => scope.locator(`article[data-object-card][data-path="${attr(path)}"]`).first();
export const board = (page: Page, name?: string) => main(page).locator(name ? `div[role="group"][data-board][data-board-name="${attr(name)}"]` : 'div[role="group"][data-board]').first();
export const embedFrame = (page: Page, title: string) => main(page).getByRole('group', { name: rx(`Embedded: ${title}`) }).first();

export type CardInfo = {
  label: string; type: string | null; path: string | null; children: string[]; lead: string | null; leadChecbox: boolean; tags: string[]; text: string | null; textFrom: string | null;
  items: { kind: string; attribute: string | null; text: string; label: string | null; title: string | null; hidden: boolean; icon: string | null }[];
  more: { text: string; title: string | null; description: string | null } | null; footerLink: string | null; footerLinkKind: string | null; date: string | null; dateKey: string | null;
};
/** Everything a card shows, from the DOM of §8.1 (empty when the card is missing). */
export async function cardInfo(card: Locator): Promise<CardInfo | null> {
  if (!(await card.count())) return null;
  return card.evaluate((c) => {
    const n = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
    const pills = c.querySelector('.card-pills');
    const items = pills ? ([...pills.children] as HTMLElement[]).filter((e) => !e.classList.contains('card-more')).map((e) => ({
      kind: e.classList.contains('card-unreviewed') ? 'unreviewed' : e.classList.contains('card-local') ? 'local' : e.matches('a.chip') ? 'link' : 'pill',
      attribute: e.getAttribute('data-attribute'), text: n(e.textContent), label: e.getAttribute('aria-label'), title: e.getAttribute('title'),
      hidden: e.hasAttribute('hidden') || e.hasAttribute('data-overflow'), icon: e.querySelector('svg[data-icon]')?.getAttribute('data-icon') ?? null,
    })) : [];
    const more = c.querySelector('.card-more') as HTMLElement | null;
    const link = c.querySelector('footer.card-footer a.chip[data-footer-link], footer.card-footer .card-local') as HTMLElement | null;
    const date = c.querySelector('footer.card-footer time.card-date') as HTMLElement | null;
    const text = c.querySelector('p.card-text') as HTMLElement | null;
    return {
      label: n(c.getAttribute('aria-label')), type: c.getAttribute('data-type'), path: (c.getAttribute('data-path') ?? '').normalize('NFC') || null,
      children: ([...c.children] as HTMLElement[]).map((e) => e.className.split(' ')[0] || e.tagName.toLowerCase()),
      lead: c.querySelector('.card-lead svg[data-icon]')?.getAttribute('data-icon') ?? null, leadChecbox: !!c.querySelector('.card-lead [role="checkbox"], .card-lead input[type="checkbox"]'),
      tags: ([...c.querySelectorAll('.card-tags .card-tag, .card-tags .card-tag-more')] as HTMLElement[]).map((t) => n(t.textContent)),
      text: text ? n(text.textContent) : null, textFrom: text?.getAttribute('data-text-from') ?? null, items,
      more: more ? { text: n(more.textContent), title: more.getAttribute('title'), description: more.getAttribute('aria-description') } : null,
      footerLink: link ? n(link.textContent) : null, footerLinkKind: link?.getAttribute('data-link-kind') ?? (link?.classList.contains('card-local') ? 'local' : null),
      date: date ? n(date.textContent) : null, dateKey: date?.getAttribute('data-date-key') ?? null,
    };
  });
}
export async function cardWhen(card: Locator, ok: (c: CardInfo | null) => boolean, ms = 3000) {
  return eventually(() => cardInfo(card), ok, ms);
}
/** Visible pill-area items' `offsetTop`s (FR-TYP-11 AC-11). */
export async function rowsOf(card: Locator): Promise<{ tops: number[]; visible: number; last: string | null }> {
  return card.evaluate((c) => {
    const items = ([...(c.querySelector('.card-pills')?.children ?? [])] as HTMLElement[]).filter((e) => !e.hidden && getComputedStyle(e).display !== 'none');
    return { tops: [...new Set(items.map((e) => e.offsetTop))], visible: items.filter((e) => !e.classList.contains('card-more') && !e.classList.contains('card-unreviewed')).length, last: items.at(-1)?.className ?? null };
  }).catch(() => ({ tops: [], visible: 0, last: null }));
}

// ------------------------------------------------------------------------------------------------ §8.2 type settings

export const settingsNav = (page: Page) => page.getByRole('navigation', { name: rx('Settings sections') });
export const tsSection = (page: Page, id: string) => main(page).locator(`section#ts-${id}`);
export const cardList = (page: Page) => main(page).getByRole('list', { name: rx('Card properties') });
export const cardRow = (page: Page, key: string) => cardList(page).locator(`li[data-card-key="${attr(key)}"]`);
export const cardRowKeys = async (page: Page) => cardList(page).locator('li[data-card-key]').evaluateAll((ls) => ls.map((l) => (l.getAttribute('data-card-key') ?? '').normalize('NFC'))).catch(() => [] as string[]);
export const cardHandle = (page: Page, name: string) => cardList(page).getByRole('button', { name: rx(`Drag to reorder ${name}`) });
export const cardRemove = (page: Page, name: string) => cardList(page).getByRole('button', { name: rx(`Remove ${name} from the card`) });
export const addProperty = (page: Page) => main(page).locator('button[data-command="card.add"]');
export const addPopover = (page: Page) => page.getByRole('dialog', { name: rx('Add property') });
export const addFind = (page: Page) => addPopover(page).getByRole('combobox', { name: rx('Find a property…') });
export const addOptions = async (page: Page) => addPopover(page).getByRole('option').evaluateAll((os) => os.map((o) => (o.getAttribute('data-card-key') ?? '').normalize('NFC'))).catch(() => [] as string[]);
export const resetButton = (page: Page) => main(page).locator('button[data-command="card.reset"]');
export const exampleRegion = (page: Page) => main(page).getByRole('region', { name: rx('Example card') });
export const cardWarning = (page: Page) => tsSection(page, 'card').locator('p[role="status"]');
export const propertyIcon = (page: Page, name: string) => main(page).getByRole('button', { name: rx(`Icon for ${name}`) });
export const editProperty = (page: Page, name: string) => main(page).getByRole('button', { name: rx(`Edit ${name}`) });
export const changeIcon = (page: Page) => main(page).getByRole('button', { name: rx('Change icon') });
export const viewsList = (page: Page, plural: string) => main(page).getByRole('list', { name: rx(`Views of ${plural}`) });

// ------------------------------------------------------------------------------------------------ §8.3 the picker

export const picker = (page: Page, name?: string) => (name ? page.getByRole('dialog', { name: rx(`Icon for ${name}`) }) : page.locator('div[role="dialog"][data-icon-picker]')).first();
export const pickerSearch = (page: Page) => picker(page).getByRole('combobox', { name: rx('Search icons…') });
export const pickerGroups = async (page: Page) => picker(page).locator('[role="group"][data-group]').evaluateAll((gs) => gs.map((g) => ({ group: g.getAttribute('data-group'), label: g.getAttribute('aria-label') })));
export const pickerOptions = async (page: Page, group?: string) =>
  picker(page).locator(group ? `[role="group"][data-group="${group}"] [role="option"]` : '[role="option"]').evaluateAll((os) => os.map((o) => o.getAttribute('data-icon') ?? '')).catch(() => [] as string[]);
export const pickerOption = (page: Page, name: string) => picker(page).locator(`[role="option"][data-icon="${name}"]`).first();
export const pickerNone = (page: Page) => picker(page).locator('button[data-icon-none]');
export const pickerStatus = (page: Page) => picker(page).locator('p[role="status"]');
export async function selectedOption(page: Page): Promise<string | null> {
  return pickerSearch(page).evaluate((s) => {
    const id = s.getAttribute('aria-activedescendant');
    return id ? document.getElementById(id)?.getAttribute('data-icon') ?? null : null;
  }).catch(() => null);
}

// ------------------------------------------------------------------------------------------------ fake-core probes

export async function fileText(core: FakeCoreHandle, rel: string): Promise<string | undefined> {
  return (await core.files())[nfc(rel)];
}
export async function fileWhen(core: FakeCoreHandle, rel: string, ok: (t: string | undefined) => boolean, ms = 3000) {
  return eventually(() => fileText(core, rel), ok, ms);
}
/**
 * Reads per card (D-2018, cards.md FR-TYP-11 AC-18, embeds.md FR-EMB-02 AC-21): `note_read`, `type_get`, `embed_load`,
 * `link_resolve` and `index_*` calls whose arguments name one of the drawn cards' objects (its path or `id`). App-level
 * calls (`index_tags`, `index_conflicts`, `index_type_counts`, and the like) and the opened note's own `note_read` name
 * no card and aren't counted. Returns `<cmd> <card path>` per such call.
 */
export async function perCardReads(core: FakeCoreHandle, scope: Locator | Page): Promise<string[]> {
  const cards = await objectCards(scope).evaluateAll((es) => es.map((e) => ({ path: e.getAttribute('data-path') ?? '', id: e.getAttribute('data-id') ?? '' })));
  const keys = cards.flatMap((c) => [nfc(c.path), c.id].filter((k) => k.length > 0).map((k) => [c.path, k] as const));
  const out: string[] = [];
  for (const c of await core.calls()) {
    if (!(['note_read', 'type_get', 'embed_load', 'link_resolve'].includes(c.cmd) || c.cmd.startsWith('index_'))) continue;
    const args = nfc(JSON.stringify(c.args ?? null));
    const hit = keys.find(([, k]) => args.includes(JSON.stringify(k).slice(1, -1)));
    if (hit) out.push(`${c.cmd} ${nfc(hit[0])}`);
  }
  return out;
}
/** `type_patch` calls with their op lists. */
export async function typePatches(core: FakeCoreHandle): Promise<{ key: string; ops: any[]; ok: boolean }[]> {
  return (await callsOf(core, 'type_patch')).map((c: any) => ({ key: nfc(String(c.args?.key ?? '')), ops: (c.args?.ops ?? []) as any[], ok: c.ok !== false }));
}
/** Every vault write: type patches by file, query writes, note writes (paths). */
export async function writtenPaths(core: FakeCoreHandle): Promise<string[]> {
  const out: string[] = [];
  for (const c of await core.calls()) {
    if ((c as any).ok === false) continue;
    const a = ((c as any).args ?? {}) as any;
    if (c.cmd === 'type_patch') out.push(`.tegg/types/${nfc(a.key ?? '')}.yml`);
    else if (['query_apply', 'query_create', 'query_duplicate', 'query_rename', 'query_trash', 'query_restore', 'pins_write', 'vault_settings_set'].includes(c.cmd)) out.push(`${c.cmd}:${nfc(a.name ?? a.title ?? '')}`);
  }
  return [...out, ...(await core.writesTo())];
}
export async function uiState(core: FakeCoreHandle): Promise<any> {
  return (await core.uiState()) as any;
}
/** Count of the calls of `cmd` (e.g. `query_run`). */
export const count = async (core: FakeCoreHandle, cmd: string) => (await callsOf(core, cmd)).length;
/** Requests the page made to non-local hosts. */
export function networkLog(page: Page): string[] {
  const out: string[] = [];
  page.on('request', (r) => { const u = r.url(); if (/^(https?|wss?):/.test(u) && !/^(https?|wss?):\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(u)) out.push(u); });
  return out;
}
/** Every request the page made (the serve-built log, FR-TYP-01 AC-20 (b)). */
export function requestLog(page: Page): string[] {
  const out: string[] = [];
  page.on('request', (r) => out.push(r.url()));
  return out;
}
export const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
export async function boxOf(loc: Locator): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return (await loc.count()) ? loc.first().boundingBox() : null;
}

/** A second page in the same browser context, started on `o.route` with its own fake core (a fresh start, as a
 *  relaunch: no in-app navigation hook exists, §13). */
export async function another(page: Page, o: StartCards): Promise<{ page: Page; core: FakeCoreHandle }> {
  const p = await page.context().newPage();
  const core = await startCards(p, o);
  return { page: p, core };
}
