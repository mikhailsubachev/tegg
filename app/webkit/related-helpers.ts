// Helpers for the slice REL WebKit tests (L5): the related fixture in the fake core (docs/contracts/v1-related.md §6:
// `index_related` from the README's expected lists, `relatedCalls`, `relatedAnswer`, `relatedDelay`,
// `relatedNotReady`), the test clock of docs/acceptance/related.md (Saturday 14 Nov 2026, 10:00 in Prague, region
// en-US, 1,440 × 900, sidebar open, `rightPanel: { open: true, tab: 'related', width: 288 }`, no `related` key, Hover to
// preview at 1,000 ms), the locators of §3.3 (R178) and readers of the drawn list. No AC assertions here except `must`
// and `click` (re-exported) and setup checks, which turn a missing element into an AssertionError instead of a
// Playwright timeout (TS-I1). Synthetic data only (D-50, D-62).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault, type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import { R } from '../ui/test/related-expected';
import type { RelatedDto, RelatedEntryDto } from '../ui/test/fake-related';
import { absent, callsOf, click, description, eventually, flat, focusName, main, must, mustBeOn, nfc, runCommand, seen, sleep, textOf, type FakeCoreHandle } from './capture-helpers';
import { goToQuery, paletteDialog, paletteOptions, pseudoLocale, start, type StartOptions } from './helpers';

export {
  R, absent, callsOf, click, description, eventually, flat, focusName, goToQuery, main, must, mustBeOn, nfc, paletteDialog, paletteOptions, runCommand, seen, sleep,
  textOf,
};
export type { FakeCoreHandle, FakeVault, RelatedDto, RelatedEntryDto };

/** The REL test clock (related.md "Test clock"). */
export const NOW = '2026-11-14T10:00:00+01:00';
export const ZONE = 'Europe/Prague';
export const VAULT_PATH = '/fake/Related';
export const VIEWPORT = { width: 1440, height: 900 };
export const noteRoute = (path: string) => `note/${nfc(path)}`;
export const TITLE: Record<string, string> = {
  [R.rozpocet]: 'Rozpočet na offsite 2027', [R.den]: '2026-09-30', [R.ukol]: 'Poslat návrh rozpočtu financím', [R.terminyA]: 'Důležité termíny školení',
  [R.terminyB]: 'Dulezite terminy skoleni', [R.skoleni]: 'Školení a dodavatel', [R.souhvezdi]: 'Souhvězdí', [R.hiking]: 'Hiking in the mountains',
  [R.trail]: 'Trail notes', [R.gear]: 'gear list', [R.svatba]: 'Svatba Petra a Lucie', [R.vcelstvo]: 'Včelstvo na zimu', [R.prohlidka]: 'Jarní prohlídka úlu',
  [R.buben]: 'Buben', [R.kniha]: 'Kniha vzpomínek', [R.poznamky]: 'Poznamky ke knize', [R.zahrada]: 'Zahrada na jaře', [R.ul]: 'Úl u lesa',
};
export const hv = (k: number) => R.hvezda(k);

/** The related fixture plus `new-empty/.tegg` (its README isn't a vault file); `edit` changes the files last. */
export function relatedVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const v = loadFixtureVault('tests/fixtures/vaults/related', 'tests/fixtures/vaults/new-empty/.tegg');
  delete v.files['README.md'];
  edit?.(v.files);
  return { ...v, name: 'Related' };
}
export const original = (path: string) => relatedVault().files[nfc(path)];

export type RelUi = {
  open?: boolean; tab?: string; width?: number; theme?: 'light' | 'dark'; sidebarOpen?: boolean;
  /** The stored `related` value (absent: no key, the test clock). */
  related?: unknown;
  previewMode?: 'click' | 'hover' | 'off';
  extra?: Record<string, unknown>;
};
/** The machine-local UI state of the test clock. */
export function relatedUi(o: RelUi = {}): UiStateDto {
  return {
    version: 1, theme: o.theme ?? 'light', sidebarOpen: o.sidebarOpen ?? true, propertiesOpen: true,
    rightPanel: { open: o.open ?? true, tab: o.tab ?? 'related', width: o.width ?? 288 },
    ...(o.related !== undefined ? { related: o.related } : {}),
    ...(o.previewMode ? { preview: { mode: o.previewMode } } : {}),
    ...(o.extra ?? {}),
  } as unknown as UiStateDto;
}

export type StartRel = Omit<StartOptions, 'vault'> & RelUi & {
  vault?: FakeVault;
  reducedMotion?: 'reduce' | 'no-preference';
  /** `install` (default): Playwright's clock, flowing until a test pauses it; `fixed`: only Date is fixed. */
  clock?: 'install' | 'fixed';
  pseudo?: boolean;
  /** Wait for the note's text (default on note, daily and new routes). */
  wait?: boolean;
  /** Fake core settings applied before the page loads its first route (delays, overrides): run with the handle. */
};
/** Starts the main window on `route` (`window.__TEGG_ROUTE__`) with the related vault and the test clock. */
export async function startRelated(page: Page, route: string, o: StartRel = {}): Promise<FakeCoreHandle> {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, 'en-US');
  await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, route);
  await page.emulateMedia({ reducedMotion: o.reducedMotion ?? 'no-preference', colorScheme: o.theme ?? 'light' });
  if ((o.clock ?? 'install') === 'install') await page.clock.install({ time: new Date(NOW) });
  else await page.clock.setFixedTime(new Date(NOW));
  const core = await start(page, {
    ...o, vault: o.vault ?? relatedVault(), vaultPath: o.vaultPath ?? VAULT_PATH, uiState: o.uiState ?? relatedUi(o), previewStored: 'asGiven',
    ...(o.pseudo ? { prelude: pseudoLocale } : {}),
  });
  if (o.wait ?? /^(note|daily|new)\//.test(route)) await must(editorBody(page).or(sourceView(page)), `${route}: the note's text`, 8000);
  return core;
}
/** Starts on `note/<path>` with the panel on Related and waits for one of the tab's states. */
export async function openRelated(page: Page, path: string, o: StartRel = {}): Promise<FakeCoreHandle> {
  const core = await startRelated(page, noteRoute(path), o);
  await must(relPanel(page), `note/${path}: tabpanel "Related" in the Context panel (R178)`, 8000);
  return core;
}

// ------------------------------------------------------------------------------------------------ R178 locators (§3.3)

export const ctxPanel = (page: Page) => page.getByRole('complementary', { name: 'Context panel' });
export const tabsOf = (page: Page) => ctxPanel(page).getByRole('tab');
export const relTab = (page: Page) => ctxPanel(page).getByRole('tab', { name: /^⟦?Related/ });
export const backlinksTab = (page: Page) => ctxPanel(page).getByRole('tab', { name: /^⟦?Backlinks/ });
export const graphTab = (page: Page) => ctxPanel(page).getByRole('tab', { name: /^⟦?Graph/ });
export const relPanel = (page: Page) => ctxPanel(page).getByRole('tabpanel', { name: /^⟦?Related⟧?$/ });
export const linkedSwitch = (page: Page) => relPanel(page).getByRole('switch', { name: /^⟦?Show linked notes⟧?$/ });
export const relList = (page: Page) => relPanel(page).getByRole('list', { name: /^⟦?Related notes⟧?$/ });
export const entryItems = (page: Page) => relList(page).getByRole('listitem');
export const entryAt = (page: Page, path: string) => relPanel(page).locator(`[data-related-entry="${nfc(path).replace(/"/g, '\\"')}"]`);
export const chipOf = (page: Page, path: string) => entryAt(page, path).locator('a[data-link-kind="note"]');
export const excerptOf = (page: Page, path: string) => entryAt(page, path).locator('p[data-related-excerpt]');
export const emptyText = (page: Page) => relPanel(page).getByText(/^⟦?No related notes⟧?$/);
export const loadingStatus = (page: Page) => relPanel(page).getByRole('status').filter({ hasText: /Loading…/ });
export const editorBody = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
export const sourceView = (page: Page) => page.getByRole('region', { name: /^⟦?Markdown source⟧?$/ });
export const saved = (page: Page) => page.getByRole('status', { name: 'Save state' }).filter({ hasText: 'Saved' });

export type Drawn = { path: string; title: string; linked: boolean; excerpt: string | null };
/** The drawn entries in order (empty when there is no list). */
export async function drawn(page: Page): Promise<Drawn[]> {
  return relPanel(page).locator('[data-related-entry]').evaluateAll((els) => els.map((el) => {
    const chip = el.querySelector('a[data-link-kind="note"]');
    const ex = el.querySelector('p[data-related-excerpt]');
    return {
      path: (el.getAttribute('data-related-entry') ?? '').normalize('NFC'),
      title: (chip?.getAttribute('aria-label') ?? '').normalize('NFC'),
      linked: !!el.querySelector('[data-related-linked]'),
      excerpt: ex ? (ex.textContent ?? '').normalize('NFC') : null,
    };
  })).catch(() => []);
}
export const drawnPaths = async (page: Page) => (await drawn(page)).map((d) => d.path);
/** Waits until the drawn paths are `want` (in order); returns the last value. */
export async function pathsWhen(page: Page, want: string[], ms = 3000): Promise<string[]> {
  const w = want.map(nfc);
  return eventually(() => drawnPaths(page), (p) => JSON.stringify(p) === JSON.stringify(w), ms);
}
export const sameSet = (a: string[], b: string[]) => JSON.stringify([...a].map(nfc).sort()) === JSON.stringify([...b].map(nfc).sort());
export async function setWhen(page: Page, want: string[], ms = 3000): Promise<string[]> {
  return eventually(() => drawnPaths(page), (p) => sameSet(p, want), ms);
}
/** The tab panel's `data-related-state`. */
export async function relState(page: Page): Promise<string | null> {
  return relPanel(page).getAttribute('data-related-state').catch(() => null);
}
/** True when only the header and the empty text `No related notes` are in the tab panel. */
export async function onlyEmpty(page: Page, ms = 3000): Promise<boolean> {
  return (await eventually(async () => {
    const ok = (await emptyText(page).count()) === 1 && (await relPanel(page).locator('[data-related-entry]').count()) === 0
      && (await relPanel(page).getByRole('list').count()) === 0 && (await loadingStatus(page).count()) === 0 && (await linkedSwitch(page).count()) === 1;
    return ok;
  }, (x) => x, ms));
}
export async function relCalls(core: FakeCoreHandle) {
  return core.relatedCalls();
}
export async function uiSetCalls(core: FakeCoreHandle): Promise<any[]> {
  return (await callsOf(core, 'ui_state_set')).map((c) => (c.args as any)?.state);
}
export async function navOpened(core: FakeCoreHandle): Promise<any[]> {
  return (await callsOf(core, 'nav_opened')).map((c) => c.args);
}
/** Switches the `Show linked notes` switch by a click and returns the state it shows afterwards. */
export async function flipSwitch(page: Page): Promise<string | null> {
  await click(linkedSwitch(page), 'switch "Show linked notes"');
  return linkedSwitch(page).getAttribute('aria-checked');
}

/** Records every list the tab draws (a MutationObserver on the context panel), read with `listsDrawn`. */
export async function recordLists(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__relLists = [] as string[][];
    const read = () => [...document.querySelectorAll('[data-related-entry]')].map((e) => (e.getAttribute('data-related-entry') ?? '').normalize('NFC'));
    const push = () => {
      const l = read();
      const last = w.__relLists[w.__relLists.length - 1];
      if (!last || JSON.stringify(last) !== JSON.stringify(l)) w.__relLists.push(l);
    };
    push();
    w.__relObs?.disconnect();
    w.__relObs = new MutationObserver(push);
    w.__relObs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-related-entry'] });
  });
}
export async function listsDrawn(page: Page): Promise<string[][]> {
  return page.evaluate(() => (window as any).__relLists ?? []);
}

/** A synthetic entry for `relatedAnswer` overrides (L5 only; never on disk). */
export function entry(path: string, o: Partial<RelatedEntryDto> = {}): RelatedEntryDto {
  return { path: nfc(path), title: o.title ?? nfc(path.split('/').pop()!.replace(/\.md$/, '')), type: 'page', review: null, status: null, due: null, completed: null, linked: false, excerpt: null, score: 5, shared: 3, ...o };
}

/** The box of an element (asserts it has one). */
export async function boxOf(loc: Locator, what: string) {
  const b = await (await must(loc, what)).boundingBox();
  assert.ok(b, `${what} has a box`);
  return b!;
}
/** The computed value of a CSS custom property on the root, as an rgb() colour. */
export async function tokenRgb(page: Page, token: string): Promise<string> {
  return page.evaluate((t) => {
    const d = document.createElement('div');
    d.style.backgroundColor = `var(${t})`;
    document.body.appendChild(d);
    const c = getComputedStyle(d).backgroundColor;
    d.remove();
    return c;
  }, token);
}
/** Whether the focused element shows a visible indicator (outline ≥ 2 px or a ring ≥ 2 px, app-shell FR-UX-03 AC-13 (b)). */
export async function focusIndicator(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return false;
    const cs = getComputedStyle(a);
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
    const ring = cs.boxShadow !== 'none' && (cs.boxShadow.match(/(-?\d+(?:\.\d+)?)px/g) ?? []).map(parseFloat).some((v, i) => i >= 2 && v >= 2);
    return outline || ring;
  });
}

export { pauseClock, runFor } from './outline-helpers';
export { axeContrast, colourLeaks } from './read-helpers';
export { anyPreviewDialog, mainName, mustNoPreview, mustPreview, previewDialog, switchPreviewMode } from './helpers';
export { vaultWrites } from './capture-helpers';

/** Opens `title` from the Search page (⇧⌘F, the query, ⏎) and waits for the centre pane. */
export async function openFromSearch(page: Page, query: string, title: string) {
  await goToQuery(page, query);
  await page.keyboard.press('Enter');
  await mustBeOn(page, nfc(title), `Search "${query}", ⏎`);
}
