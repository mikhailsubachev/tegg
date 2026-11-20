// Helpers for the slice Q2.1 WebKit tests (L5): the overlay vault (tests/fixtures/vaults/views-usage over the base, its
// README), the expected bytes of tests/fixtures/queries-files/expected/views-usage/, R198's usage keys as strings, §19.1's
// usage roots and §20's popups, and `window.__TEGG_TEST__.usages()` (docs/contracts/v1-views.md §21.1). No AC assertions
// here except `must` and `click` (re-exported), which turn a missing element into an AssertionError (TS-I1).
import type { Locator, Page } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { type FakeVault } from '../ui/test/fake-core';
import { REPO, nfc, viewsVault } from './views-helpers';

export * from './views-helpers';

const OVERLAY = resolve(REPO, 'tests/fixtures/vaults/views-usage');
export const CESTY = 'Pages/Knihy na cesty.md';
export const CESTY_ID = '01JB5V00000000000000000030';
export const CTENI_ID = '01JB5V00000000000000000029';
/** `tests/fixtures/queries-files/expected/views-usage/<rel>`. */
export const expectedUsage = (rel: string) => readFileSync(join(REPO, 'tests/fixtures/queries-files/expected/views-usage', rel), 'utf8');
/** A file of the overlay folder. */
export const overlayFile = (rel: string) => readFileSync(join(OVERLAY, rel), 'utf8');

/** The base, then the overlay (README excluded), then `edit`. */
export function overlayVault(edit?: (files: Record<string, string>) => void): FakeVault {
  return viewsVault((files) => {
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        const rel = relative(OVERLAY, p).normalize('NFC');
        if (rel === 'README.md') continue;
        files[rel] = readFileSync(p, 'utf8');
      }
    };
    walk(OVERLAY);
    edit?.(files);
  });
}

/** R198's keys. */
export const tabKey = (name: string) => `tab:book/${nfc(name).toLowerCase()}`;
export const blockKey = (id: string, name: string, n: number) => `block:id:${id}/${nfc(name).toLowerCase()}#${n}`;
export const pageKey = (name: string) => `page:${nfc(name).toLowerCase()}`;

/** §19.1: the usage root with this key (a tab's tabpanel, a block's root, the page's block root). */
export const usageRoot = (page: Page, key: string) => page.locator(`[data-usage-key="${nfc(key).replace(/"/g, '\\"')}"]`);
/** §19.1: the usage notice of a broken key. */
export const usageNotice = (scope: Locator, key: 'sort' | 'columns') => scope.locator(`p.query-notice[data-usage-broken="${key}"]`);
/** §20: a placed popup by its `data-popup` id. */
export const popup = (page: Page, id: string) => page.locator(`[data-popup="${id}"]`);
/** The sort popover's scope line and the Columns menu's scope line (§19.1). */
export const sortScope = (page: Page) => page.locator('[role="dialog"] p.sort-scope');
export const columnsScope = (page: Page) => page.locator('[role="menu"] div.menu-scope[role="presentation"]');

/** `window.__TEGG_TEST__.usages()` (§21.1), or null when the hook is missing. */
export type UsageProbe = { key: string; kind: 'tab' | 'block' | 'page'; name: string; ownSort: boolean | 'broken'; ownColumns: boolean | 'broken'; editable: boolean };
export async function usages(page: Page): Promise<UsageProbe[] | null> {
  return page.evaluate(() => { const t = (window as any).__TEGG_TEST__; return typeof t?.usages === 'function' ? t.usages() : null; });
}

/** Where a popup lies and whether each item or control is the element `elementFromPoint` returns at its centre (scrolled
 *  into view inside the popup first), plus the page's scroll extents. */
export async function popupFit(loc: Locator): Promise<{ box: { left: number; top: number; right: number; bottom: number }; vw: number; vh: number; unhit: string[]; pageScroll: boolean } | null> {
  return loc.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const unhit: string[] = [];
    const items = [...el.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], button, [role="combobox"], input, select')] as HTMLElement[];
    for (const it of items) {
      it.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const b = it.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      if (!hit || !(hit === it || it.contains(hit))) unhit.push((it.innerText || it.getAttribute('aria-label') || it.tagName).split('\n')[0].trim());
    }
    const se = document.scrollingElement ?? document.documentElement;
    return {
      box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, vw: window.innerWidth, vh: window.innerHeight, unhit,
      pageScroll: se.scrollWidth > se.clientWidth || se.scrollHeight > se.clientHeight,
    };
  }).catch(() => null);
}
/** The AC-19 failures of a popup (empty when it fits): inside the 8 px margins ± 0.5, every item hit, no page scroll. */
export async function misfit(loc: Locator, what: string): Promise<string[]> {
  const f = await popupFit(loc);
  if (!f) return [`${what}: not open`];
  const out: string[] = [];
  const { box: b, vw, vh } = f;
  if (b.left < 8 - 0.5 || b.top < 8 - 0.5 || b.right > vw - 8 + 0.5 || b.bottom > vh - 8 + 0.5) out.push(`${what}: box ${JSON.stringify(b)} outside ${vw}×${vh} − 8`);
  if (f.unhit.length) out.push(`${what}: not hit by elementFromPoint: ${f.unhit.join(', ')}`);
  if (f.pageScroll) out.push(`${what}: the page scrolls`);
  return out;
}
