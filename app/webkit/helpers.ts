// Helpers for the MS3 slice 3A WebKit tests (L5). No assertions about AC outcomes live here except `must`, which
// turns a missing element into an AssertionError instead of a Playwright timeout (TS-I1: red for an assertion).
// Accessible names come from docs/contracts/ms3-shell.md §3.7 and ms2-shell §3.
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { installFakeCore, shellVault, type FakeCoreHandle, type FakeOptions, type FakeVault } from '../ui/test/fake-core';

export { shellVault };
export type { FakeCoreHandle, FakeVault };

export const P = {
  porada: 'Schůzky/2026-10-07 Porada.md',
  bez: 'Pages/Bez hlavičky.md',
  uvodni: 'Pages/Úvodní stránka.md',
  ctvrtek: 'Quick Notes/Nápad na čtvrtek.md',
  druhy: 'Quick Notes/Druhý nápad.md',
  eva: 'Tasks/Zavolat Evě.md',
  svickova: 'Recepty/Svíčková.md',
};

export const isMac = true;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Collation prelude (ms3-shell §3.6 `setCollationLocale`), run before the app renders. */
export const collation = (locale: string) => `import { setCollationLocale as __tcl } from '/src/i18n/collate.ts'; __tcl(${JSON.stringify(locale)});`;
export const pseudoLocale = `import { setCatalog as __tsc, pseudo as __tps, en as __ten } from '/src/i18n/catalog.ts'; __tsc(__tps(__ten), 'en');`;

export type StartOptions = FakeOptions & { vault?: FakeVault | null; frame?: 'vault' | 'chooser' | 'none' };

/** Loads the app with the fake core. By default the shell fixture is open and the test waits for the frame. */
export async function start(page: Page, o: StartOptions = {}): Promise<FakeCoreHandle> {
  const vault = o.vault === undefined ? shellVault() : o.vault;
  const core = await installFakeCore(page, vault, o);
  await page.goto('/');
  const frame = o.frame ?? (vault ? 'vault' : 'chooser');
  if (frame === 'vault') await must(sidebar(page), 'the frame (navigation "Sidebar")', 5000);
  if (frame === 'chooser') await must(page.getByRole('main', { name: 'Choose a vault' }), 'the chooser (main "Choose a vault")', 5000);
  return core;
}

export async function seen(loc: Locator, ms = 3000): Promise<boolean> {
  try {
    await loc.first().waitFor({ state: 'visible', timeout: ms });
    return true;
  } catch {
    return false;
  }
}

export async function absent(loc: Locator, ms = 3000): Promise<boolean> {
  try {
    await loc.first().waitFor({ state: 'hidden', timeout: ms });
    return true;
  } catch {
    return false;
  }
}

export async function must(loc: Locator, what: string, ms = 3000): Promise<Locator> {
  assert.ok(await seen(loc, ms), `${what} is not shown`);
  return loc.first();
}

/** Polls `get` until `ok(value)` or the timeout; returns the last value (assert on it afterwards). */
export async function eventually<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  let v = await get();
  while (!ok(v) && Date.now() < end) {
    await sleep(25);
    v = await get();
  }
  return v;
}

export const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
export const panel = (page: Page) => page.getByRole('complementary', { name: 'Context panel' });
export const paletteDialog = (page: Page) => page.getByRole('dialog', { name: 'Command palette' });
export const switcherDialog = (page: Page) => page.getByRole('dialog', { name: 'Quick switcher' });
export const newObjectDialog = (page: Page) => page.getByRole('dialog', { name: 'New object' });
export const typesList = (page: Page) => page.getByRole('list', { name: 'Types' });

/** The accessible name of the centre pane (`main`): the current page name or note title (§3.7). */
export async function mainName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const mains = [...document.querySelectorAll('main, [role="main"]')] as HTMLElement[];
    const m = mains.find((e) => e.offsetParent !== null || e.getClientRects().length > 0);
    if (!m) return null;
    const label = m.getAttribute('aria-label');
    if (label) return label;
    const ids = m.getAttribute('aria-labelledby');
    if (ids) return ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ');
    return null;
  });
}

export async function onPage(page: Page, name: string, ms = 3000): Promise<boolean> {
  return (await eventually(() => mainName(page), (n) => n === name, ms)) === name;
}

export async function mustBeOn(page: Page, name: string, how: string, ms = 3000) {
  const got = await eventually(() => mainName(page), (n) => n === name, ms);
  assert.equal(got, name, `${how}: centre pane should be "${name}"`);
}

/** Opens the palette with ⌘K, types `query`, runs the first result with ⏎. */
export async function runCommand(page: Page, query: string) {
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), `Command palette (for "${query}")`);
  await page.getByRole('combobox', { name: 'Command query' }).fill(query);
  await sleep(50);
  await page.keyboard.press('Enter');
}

/** The palette's options in order, as shown text (title plus shortcut or "Coming in …"). */
export async function paletteOptions(page: Page): Promise<string[]> {
  return page.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts();
}

export async function openNote(page: Page, title: string) {
  await page.keyboard.press('Meta+o');
  await must(switcherDialog(page), 'Quick switcher');
  await page.getByRole('textbox', { name: 'Switcher query' }).or(page.getByRole('combobox', { name: 'Switcher query' })).first().fill(title);
  await sleep(150);
  await page.keyboard.press('Enter');
  await mustBeOn(page, title, `open "${title}" from the switcher`);
}

export async function gotoType(page: Page, plural: string) {
  await runCommand(page, `Go to type: ${plural}`);
  await mustBeOn(page, plural, `Go to type: ${plural}`);
}

/** Visible Types list entries as [label, count] (count = last integer in the entry, 0 if none). */
export async function typeEntries(page: Page): Promise<[string, number][]> {
  const items = await typesList(page).getByRole('listitem').allInnerTexts();
  return items.map((t) => {
    const s = t.replace(/\s+/g, ' ').trim();
    const m = /^(.*?)\s*(\d+)\s*$/.exec(s);
    return m ? [m[1].trim(), Number(m[2])] : [s, 0];
  });
}

export async function box(loc: Locator) {
  if (!(await seen(loc, 500))) return null;
  return loc.first().boundingBox();
}

export async function theme(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.documentElement.dataset.theme);
}

/** Describes the focused element: role, accessible label and whether it is inside main / sidebar. */
export async function focused(page: Page) {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return { tag: 'body', label: '', inMain: false, inSidebar: false, heading: false };
    const label = a.getAttribute('aria-label') ?? a.textContent?.trim() ?? '';
    return {
      tag: a.tagName.toLowerCase(),
      label,
      inMain: !!a.closest('main, [role="main"]'),
      inSidebar: !!a.closest('nav[aria-label="Sidebar"], [role="navigation"][aria-label="Sidebar"]'),
      heading: /^h1$/i.test(a.tagName) || a.getAttribute('aria-level') === '1',
    };
  });
}

/** Commands that read only (ms2-shell §2, ms3-shell §2); everything else counts as a write. */
export const READ_COMMANDS = new Set([
  'vault_current', 'vault_last', 'vault_types', 'vault_pick_dir', 'index_type_counts', 'index_list', 'index_search',
  'index_switcher', 'note_read', 'ui_state_get', 'ui_state_set', 'nav_opened', 'perf_mark', 'vault_open',
  'link_resolve', 'open_external', // 3B (ms3-shell §11.1): read-only resolution; a URL opened outside the vault
  'index_tags', 'index_conflicts', // 3C (ms3-shell §13.2): read-only
  'vault_recent', 'app_about', // D-219, D-220 (ms3-shell §12.5): read-only list; shows the About panel
  'type_get', 'type_template', 'type_usage', 'type_misfits', 'index_type_rows', 'starter_plan', // 3D (ms3-shell §14.3): read-only
  'index_backlinks', 'index_broken_links', 'index_duplicate_titles', 'link_create_plan', 'backlinks', // 4A (ms4-links §4): read-only
]);
export async function nonReadCalls(core: FakeCoreHandle): Promise<string[]> {
  return (await core.calls()).map((c) => c.cmd).filter((c) => !READ_COMMANDS.has(c) && !c.startsWith('plugin:event|'));
}

/** Reads a registry entry and a catalog text in the page (dev server modules, ms3-shell §3.1–§3.2). */
export async function catalogText(page: Page, key: string, vars?: Record<string, string | number>): Promise<string> {
  return page.evaluate(async ([k, v]) => {
    const m = await import('/src/i18n/catalog.ts' as string);
    return m.t(k, v ?? undefined) as string;
  }, [key, vars ?? null] as const);
}
export async function routeDefs(page: Page): Promise<{ id: string; name: string; purpose: string }[]> {
  return page.evaluate(async () => {
    const m = await import('/src/shell/registry.ts' as string);
    return (m.ROUTES as { id: string; name: string; purpose: string }[]).map((r) => ({ id: r.id, name: r.name, purpose: r.purpose }));
  });
}
