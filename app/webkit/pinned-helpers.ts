// Helpers for the slice PIN WebKit tests (L5): the pinned fixture in the fake core (docs/contracts/v1-pinned.md §5), the
// test clock, zone and region of docs/acceptance/pinned.md, locators from §3.2 (R132…R135) and probes of the section. No
// AC assertions here except `must` and `click` (re-exported), which turn a missing element into an AssertionError
// instead of a Playwright timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import {
  absent, callsOf, click, description, eventually, flat, focusName, isDisabled, main, mainName, must, nfc, runCommand, seen, sleep, textOf,
  type FakeCoreHandle,
} from './capture-helpers';
import { box, mustBeOn, openNote, paletteDialog, paletteOptions, sidebar, start, type StartOptions } from './helpers';

export {
  absent, box, callsOf, click, description, eventually, flat, focusName, isDisabled, main, mainName, must, mustBeOn, nfc, openNote, paletteDialog,
  paletteOptions, runCommand, seen, sidebar, sleep, textOf,
};
export type { FakeCoreHandle, FakeVault };

export const REPO = resolve(import.meta.dirname, '../..');
const FX = resolve(REPO, 'tests/fixtures/vaults');
const PINS_FX = resolve(REPO, 'tests/fixtures/pinned-files');

/** The PIN test clock (pinned.md): Saturday 7 Nov 2026, 10:00 in Prague. */
export const NOW = '2026-11-07T10:00:00+01:00';
export const PINS = '.tegg/pinned.yml';
export const VAULT_PATH = '/fake/Pinned';
export const NFD = (s: string) => s.normalize('NFD');
export const ID = (nn: string) => `01JB5P000000000000000000${nn}`;

/** The fixture's paths (tests/fixtures/vaults/pinned/README.md). */
export const P = {
  rozpocet: 'Projekty/Rozpočet 2027.md', lisabon: 'Projekty/Výjezd Lisabon 2026.md', porada: 'Schůzky/2026-10-07 Týdenní porada.md',
  cajovna: 'Pages/Čajovna.md', ukol: 'Tasks/Poslat návrh rozpočtu.md', den: 'Daily/2026-10-07.md', graf: 'Images/Graf.md',
  kos: '.trash/Pages/Starý plán.md', odkazy: 'Pages/Odkazy.md', plan: 'Pages/Plán.md', plan2: 'Pages/Plán (2).md', stitek: 'Tags/Offsite.md',
  bez: 'Pages/Bez hlavičky.md',
} as const;
export const VYPLN = Array.from({ length: 10 }, (_, i) => `Pages/Výplň ${String(i + 1).padStart(2, '0')}.md`);
/** `valid`'s five rows, in file order (README "Expected rows"). */
export const VALID_ROWS = ['Rozpočet 2027', 'Výjezd Lisabon 2026', '2026-10-07 Týdenní porada', '#offsite', 'Projekty'];

/** `tests/fixtures/pinned-files/<name>` as text (`valid.yml`, `expected/created.yml`, …). */
export const pinsFx = (name: string) => readFileSync(join(PINS_FX, name), 'utf8');

/** The pinned fixture plus `new-empty/.tegg`, `_attachments/graf.png` as a binary; `pins`: a pinned-files name (e.g.
 *  `valid.yml`) or `{ text }` copied to `.tegg/pinned.yml` (none by default); `edit` changes the files last. */
export function pinnedVault(o: { pins?: string | { text: string } | null; edit?: (files: Record<string, string>) => void } = {}): FakeVault {
  const files: Record<string, string> = {};
  const walk = (root: string, d: string, prefix: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(root, p, prefix); continue; }
      const rel = (prefix + relative(root, p)).normalize('NFC');
      if (rel === 'README.md' || rel.endsWith('.png')) continue;
      files[rel] = readFileSync(p, 'utf8');
    }
  };
  walk(join(FX, 'pinned'), join(FX, 'pinned'), '');
  walk(join(FX, 'new-empty/.tegg'), join(FX, 'new-empty/.tegg'), '.tegg/');
  if (o.pins) files[PINS] = typeof o.pins === 'string' ? pinsFx(o.pins) : o.pins.text;
  o.edit?.(files);
  return { name: 'Pinned', files, bin: { '_attachments/graf.png': readFileSync(join(FX, 'pinned/_attachments/graf.png')).toString('base64') } };
}
export const original = (path: string) => pinnedVault().files[nfc(path)];

export const ui = (o: { theme?: UiStateDto['theme']; collapsed?: boolean; vault?: string; extra?: Record<string, unknown> } = {}): UiStateDto =>
  ({
    version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, propertiesOpen: true,
    ...(o.collapsed !== undefined ? { vaults: { [nfc(o.vault ?? VAULT_PATH)]: { sidebar: { pinnedCollapsed: o.collapsed } } } } : {}),
    ...(o.extra ?? {}),
  } as UiStateDto);

export type StartPinned = StartOptions & {
  pins?: string | { text: string } | null;
  vault?: FakeVault;
  /** Start on this route (`window.__TEGG_ROUTE__`), e.g. `note/Projekty/Rozpočet 2027.md`. */
  route?: string;
  region?: string;
  theme?: UiStateDto['theme'];
  collapsed?: boolean;
  realTime?: boolean;
  reducedMotion?: 'reduce' | 'no-preference';
  /** Hold the first `pins_get` answers as the first index build runs (`pinsNotReady`). */
  notReady?: boolean;
};
export const noteRoute = (path: string) => `note/${nfc(path)}`;

/** Starts the main window on the pinned vault (zone from `test.use({ timezoneId })`, region `cs` by default, preview
 *  mode `off` so a click on any row or chip opens at once). */
export async function startPinned(page: Page, o: StartPinned = {}): Promise<FakeCoreHandle> {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'cs');
  if (o.route) await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, o.route);
  if (o.reducedMotion) await page.emulateMedia({ reducedMotion: o.reducedMotion });
  if (!o.realTime) await page.clock.setFixedTime(new Date(NOW));
  const vault = o.vault ?? pinnedVault({ pins: o.pins });
  const prelude = o.region && o.region !== 'cs' ? `import { setCollationLocale as __tcl } from '/src/i18n/collate.ts'; __tcl(${JSON.stringify(o.region)});` : undefined;
  const uiState = o.uiState ?? ui({ theme: o.theme, collapsed: o.collapsed, extra: { preview: { mode: 'off' } } });
  if (o.notReady) await page.addInitScript(() => { (window as any).__teggPinsNotReadyAtStart = true; });
  const core = await start(page, { ...(prelude ? { prelude } : {}), ...o, vault, vaultPath: o.vaultPath ?? VAULT_PATH, uiState, previewStored: 'asGiven' });
  return core;
}
/** Starts and waits for the Pinned section's header. */
export async function openPinned(page: Page, o: StartPinned = {}): Promise<FakeCoreHandle> {
  const core = await startPinned(page, o);
  await must(header(page), 'the Pinned section\'s header (button "Pinned", R132)', 8000);
  return core;
}

// ------------------------------------------------------------------------------------------------ §3.2 locators

export const section = (page: Page) => sidebar(page).locator('.sidebar-pinned');
export const header = (page: Page) => sidebar(page).getByRole('button', { name: /^⟦?Pinned⟧?$/ });
export const list = (page: Page) => sidebar(page).getByRole('list', { name: /^⟦?Pinned⟧?$/ });
export const rowLinks = (page: Page) => section(page).locator('[data-pinned-row]');
export const rowAt = (page: Page, i: number) => section(page).locator(`[data-pinned-row="${i}"]`);
/** A row's link by its label (the first line of its `title`, §3.2), matched exactly: the `title` equals the label or
 *  starts with the label plus a newline (AP-1263, D-1406; CSS `\a ` is the newline). */
export const rowNamed = (page: Page, label: string) => {
  const q = nfc(label).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return rowLinks(page).and(page.locator(`[title="${q}"], [title^="${q}\\a "]`)).first();
};
export const unpinBtn = (page: Page, label: string) => section(page).getByRole('button', { name: `Unpin ${nfc(label)}`, exact: true });
export const emptyArea = (page: Page) => section(page).locator('.pinned-empty');
export const alertBox = (page: Page) => section(page).getByRole('alert');
export const notice = (page: Page) => section(page).locator('p.pinned-notice');
export const live = (page: Page) => section(page).locator('[role="status"][aria-live="polite"]');
export const dropLine = (page: Page) => section(page).locator('[data-pin-drop-line]');
export const placeholder = (page: Page) => section(page).locator('[data-pin-placeholder]');
export const lifted = (page: Page) => page.locator('[data-pin-lifted]');
export const dragChip = (page: Page) => page.locator('[data-pin-drag-chip]');
export const rowMenu = (page: Page) => page.getByRole('menu', { name: /^⟦?Pinned item⟧?$/ });
export const menuItem = (menu: Locator, name: string) => menu.getByRole('menuitem', { name, exact: true });
export const moreBtn = (page: Page) => main(page).getByRole('button', { name: 'More', exact: true });
export const moreMenu = (page: Page) => page.getByRole('menu', { name: 'More', exact: true });
export const typesList = (page: Page) => sidebar(page).getByRole('list', { name: 'Types', exact: true });
export const typesEntry = (page: Page, plural: string) => typesList(page).getByRole('link', { name: new RegExp(`^${plural}\\b`) }).first();
export const tagsEntry = (page: Page) => sidebar(page).getByRole('link', { name: 'Tags', exact: true });
export const inboxEntry = (page: Page) => sidebar(page).locator('a, button, [role="link"], [role="button"]').filter({ has: page.getByText('Inbox', { exact: true }) }).first();
export const tagActionsBtn = (page: Page) => main(page).getByRole('button', { name: 'Tag actions', exact: true });
export const tagActionsMenu = (page: Page) => page.getByRole('menu', { name: 'Tag actions', exact: true });
export const searchResults = (page: Page) => main(page).getByRole('list', { name: 'Search results', exact: true });
export const searchRow = (page: Page, title: string) => searchResults(page).getByRole('link', { name: nfc(title), exact: true }).first();
export const tagsTable = (page: Page) => main(page).getByRole('table', { name: 'Tags', exact: true });
export const tagRow = (page: Page, key: string) => tagsTable(page).locator(`[data-tag="${nfc(key)}"]`).first();
export const typeRow = (page: Page, title: string) => main(page).getByRole('row').filter({ hasText: nfc(title) }).first();
export const backlinksPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Backlinks' });
/** A Backlinks entry (the `.backlink-entry` element, the drag source) by its chip, a link named by the title (AP-1265, D-1408). */
export const backlinkEntry = (page: Page, title: string) =>
  backlinksPanel(page).locator('.backlink-entry').filter({ has: page.getByRole('link', { name: nfc(title), exact: true }) }).first();
export const editorBody = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
export const titleField = (page: Page) => page.getByRole('textbox', { name: 'Title', exact: true });
/** An editor chip by its source text, not its visible text (AP-1266, D-1409): `#key` finds the tag chip
 *  (`data-tag="key"`), anything else the link chip whose `data-wikilink` is the link text (`[[Plán (2)]]` shows `Plán`). */
export const chip = (page: Page, text: string) => {
  const q = (x: string) => nfc(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return editorBody(page).locator(text.startsWith('#') ? `[data-tag="${q(text.slice(1))}"]` : `[data-wikilink="${q(text)}"]`).first();
};
export const kanbanCard = (page: Page, title: string) => main(page).getByRole('article', { name: `Task: ${nfc(title)}`, exact: true });
/** R134's Types entry menu name (D-1392: `typeEntry.menu` = `{name} actions`). */
export const typeEntryMenu = (page: Page, name: string) => page.getByRole('menu', { name: `${nfc(name)} actions`, exact: true });
export const anyPreview = (page: Page) => page.getByRole('dialog', { name: /^⟦?Preview: / });
/** Types `title` into the note's Title and commits it with ↩ (the rename job, D-268). */
export async function retitle(page: Page, title: string) {
  const t = await must(titleField(page), 'textbox "Title"', 5000);
  await t.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
}
export const NOT_SAVED = 'Available once the object is saved.';
export const FIX_FILE = 'Fix .tegg/pinned.yml to change pins.';
export const NEWER = 'Made by a newer version of Tegg. Read-only.';
export const CHANGED_OUTSIDE = 'Pins changed outside Tegg. Your change wasn\'t saved.';
export const EMPTY_TEXT = 'Drag things here, or use ⋯ › Pin to sidebar.';

// ------------------------------------------------------------------------------------------------ probes

export type Row = { index: number; label: string; tooltip: string; state: string | null; description: string; current: string | null; text: string; icon: string | null; color: string };
/** Every drawn row in DOM order: label = first line of `title`, the `aria-description`, `data-pin-state`, the icon's
 *  `data-icon` and its computed colour. */
export async function rows(page: Page): Promise<Row[]> {
  return section(page).evaluate((s) => ([...s.querySelectorAll('[data-pinned-row]')] as HTMLElement[]).map((a) => {
    const icon = a.querySelector('[data-icon]') as HTMLElement | SVGElement | null;
    const title = (a.getAttribute('title') ?? '').normalize('NFC');
    return {
      index: Number(a.getAttribute('data-pinned-row')), label: title.split('\n')[0], tooltip: title, state: a.getAttribute('data-pin-state'),
      description: (a.getAttribute('aria-description') ?? '').replace(/\s+/g, ' ').trim(), current: a.getAttribute('aria-current'),
      text: (a.innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC'), icon: icon?.getAttribute('data-icon') ?? null,
      color: icon ? getComputedStyle(icon).color : '',
    };
  })).catch(() => []);
}
export async function labels(page: Page): Promise<string[]> {
  return (await rows(page)).map((r) => r.label);
}
/** Waits until the rows read `want` (labels in order). */
export async function rowsAre(page: Page, want: string[], ms = 3000): Promise<string[]> {
  return eventually(() => labels(page), (l) => JSON.stringify(l) === JSON.stringify(want.map(nfc)), ms);
}
/** The text of `.tegg/pinned.yml` in the fake (null: none). */
export async function pinsText(core: FakeCoreHandle): Promise<string | null> {
  return (await core.files())[PINS] ?? null;
}
/** Paths written so far other than `.tegg/pinned.yml`. */
export async function otherWrites(core: FakeCoreHandle): Promise<string[]> {
  return (await core.writesTo()).filter((p) => p !== PINS);
}
export async function pinsWrites(core: FakeCoreHandle): Promise<number> {
  return (await core.writesTo()).filter((p) => p === PINS).length;
}
/** The `pins_apply` calls that wrote (their answers aren't errors). */
export async function applyCalls(core: FakeCoreHandle) {
  return callsOf(core, 'pins_apply');
}
/** A token's resolved colour (`--type-orange`, …) as the page computes it. */
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
/** The live region's text now. */
export async function liveText(page: Page): Promise<string> {
  return flat(await live(page).first().textContent({ timeout: 500 }).catch(() => ''));
}
/** Waits until the live region says `text`. */
export async function liveSays(page: Page, text: string, ms = 2000): Promise<boolean> {
  return (await eventually(() => liveText(page), (t) => t.includes(text), ms)).includes(text);
}
/** Waits until the file holds `want`. */
export async function pinsBecome(core: FakeCoreHandle, want: string, ms = 3000): Promise<string | null> {
  return eventually(() => pinsText(core), (t) => t === want, ms);
}

/** Opens the context menu of `target` by a right-click. */
export async function contextMenu(target: Locator, what: string) {
  const el = await must(target, what);
  await el.click({ button: 'right' });
}
/** The menu named `name` that opened last. */
export const menuNamed = (page: Page, name: string | RegExp) => page.getByRole('menu', { name, exact: typeof name === 'string' });

/** Opens `note/<path>` through the Search page (D-1340), then waits for its heading. */
export async function gotoNote(page: Page, title: string) {
  await openNote(page, title);
}

/** A pointer drag from `from`'s centre to `to` (a locator's centre plus `dy`, or a point), in `steps` moves; `esc` presses
 *  Escape before the release; `hold` returns before the release (the caller releases with `page.mouse.up()`). */
export async function drag(page: Page, from: Locator, to: Locator | { x: number; y: number }, o: { steps?: number; dy?: number; esc?: boolean; hold?: boolean; what?: string } = {}) {
  const a = await box(await must(from, o.what ?? 'drag source'));
  assert.ok(a, `${o.what ?? 'drag source'} has a box`);
  const start = { x: a!.x + a!.width / 2, y: a!.y + a!.height / 2 };
  let end: { x: number; y: number };
  if ('x' in to && 'y' in to && typeof (to as any).x === 'number') end = to as { x: number; y: number };
  else {
    const b = await box(await must(to as Locator, 'drop target'));
    assert.ok(b, 'drop target has a box');
    end = { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 + (o.dy ?? 0) };
  }
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const steps = o.steps ?? 12;
  for (let i = 1; i <= steps; i++) await page.mouse.move(start.x + ((end.x - start.x) * i) / steps, start.y + ((end.y - start.y) * i) / steps);
  await sleep(50);
  if (o.esc) { await page.keyboard.press('Escape'); await sleep(50); }
  if (o.hold) return;
  await page.mouse.up();
  await sleep(100);
}
/** The point between rows `i` and `i + 1` (0-based), for a drop line there. */
export async function gapAfter(page: Page, i: number): Promise<{ x: number; y: number }> {
  const b = await box(await must(rowAt(page, i), `row ${i}`));
  assert.ok(b, `row ${i} has a box`);
  return { x: b!.x + b!.width / 2, y: b!.y + b!.height - 2 };
}

/** The run-time variants of FR-HOM-02 AC-22 (README "Made at runtime"). */
export function unreadableVariants(): { name: string; text: string | Uint8Array; line: number | null }[] {
  const valid = pinsFx('valid.yml');
  const bytes = new TextEncoder().encode(valid);
  const at = valid.indexOf('Rozpočet');
  const off = new TextEncoder().encode(valid.slice(0, at)).length;
  const bad = new Uint8Array([...bytes.slice(0, off), 0xff, ...bytes.slice(off)]);
  return [
    { name: 'invalid-yaml', text: pinsFx('invalid-yaml.yml'), line: 5 },
    { name: 'version 0', text: valid.replace('version: 1', 'version: 0'), line: null },
    { name: 'version "1"', text: valid.replace('version: 1', 'version: "1"'), line: null },
    { name: 'version 1.5', text: valid.replace('version: 1', 'version: 1.5'), line: null },
    { name: 'invalid UTF-8', text: bad, line: null },
    { name: 'a top-level list', text: '- tag: offsite\n', line: null },
    { name: 'pins not a list', text: '# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.\nversion: 1\npins: offsite\n', line: null },
  ];
}
