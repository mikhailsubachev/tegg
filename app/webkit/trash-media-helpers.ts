// Helpers for the MS6 slice 6A WebKit tests (L5): the trash-media fixture in the fake core (text files and binary
// files, docs/contracts/ms6-trash-media.md §9.2), the test clock and zone, locators from docs/acceptance/trash-media.md
// R70, R74, R76, R77, and call probes. No AC assertions here except `must` (re-exported), `click` and the `need*`
// lookups, which turn a missing element into an AssertionError instead of a Playwright timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { type FakeOptions, type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import {
  absent, callsOf, click, description, eventually, flat, focusName, isDisabled, liveSays, liveTexts, main, mainName, must, mustBeOn, nfc, runCommand,
  seen, sidebar, sleep, textOf, type FakeCoreHandle,
} from './capture-helpers';
import { start, type StartOptions } from './helpers';

export {
  absent, callsOf, click, description, eventually, flat, focusName, isDisabled, liveSays, liveTexts, main, mainName, must, mustBeOn, nfc, runCommand,
  seen, sidebar, sleep, textOf,
};
export type { FakeCoreHandle, FakeVault };

export const REPO = resolve(import.meta.dirname, '../..');
const FX = resolve(REPO, 'tests/fixtures/vaults/trash-media');
const SAMPLES = resolve(REPO, 'tests/fixtures/media');

/** The test clock (trash-media.md): Thursday 22 Oct 2026, 10:00 in Prague = 01:00 in Los Angeles. */
export const NOW = '2026-10-22T10:00:00+02:00';
export const NOW_IN: Record<string, string> = { 'Europe/Prague': '2026-10-22T10:00:00+02:00', 'America/Los_Angeles': '2026-10-22T01:00:00-07:00' };
export const ZONES = ['Europe/Prague', 'America/Los_Angeles'] as const;
/** R72: the name of an image pasted at NOW in Prague. */
export const PASTED = 'Pasted image 20261022100000.png';

/** The fixture's paths (tests/fixtures/vaults/trash-media/README.md). */
export const TM = {
  plan: 'Pages/Plán zahrady.md',
  ukol: 'Tasks/Koupit semínka.md',
  odkazy: 'Pages/Odkazy.md',
  img: 'Images/Záhon.md',
  png: '_attachments/záhon.png',
  pdfObj: 'PDFs/Rozpočet.md',
  pdf: '_attachments/Rozpočet.pdf',
  t1: '.trash/Quick Notes/Stará poznámka.md',
  t2: '.trash/Pages/Zahrada.md',
  zahrada: 'Pages/Zahrada.md',
  t3: '.trash/Images/Smazaný obrázek.md',
  t3file: '.trash/_attachments/Smazaný obrázek.png',
  t4: '.trash/_attachments/osiřelý.jpg',
  t5: '.trash/Tasks/Hotovo.md',
  folder: '.trash/Recepty',
  babovka: '.trash/Recepty/Bábovka.md',
  sablona: '_templates/Page/Page.md',
} as const;
/** R71: the trash times the fixture setup gives each entry (L5: `FakeOptions.trashedAt`). */
export const TRASHED_AT: Record<string, string> = {
  [TM.t1]: '2026-10-01T09:00:00+02:00',
  [TM.folder]: '2026-10-10T09:00:00+02:00',
  [TM.t5]: '2026-10-15T09:00:00+02:00',
  [TM.t4]: '2026-10-20T09:00:00+02:00',
  [TM.t2]: '2026-10-21T18:00:00+02:00',
  [TM.t3]: '2026-10-22T08:00:00+02:00',
  [TM.t3file]: '2026-10-22T08:00:00+02:00',
};
/** R71: the rows, newest first. */
export const ROW_ORDER = [TM.t3, TM.t2, TM.t4, TM.t5, TM.folder, TM.t1].map(nfc);

const BINARY = /\.(png|jpe?g|gif|webp|heic|svg|pdf|docx)$/i;
/** The trash-media fixture plus `new-empty/.tegg` (README.md and make-media.mjs aren't vault files); binary files in
 *  `bin` as base64. `edit` changes text files before start. */
export function tmVault(edit?: (files: Record<string, string>, bin: Record<string, string>) => void): FakeVault {
  const files: Record<string, string> = {};
  const bin: Record<string, string> = {};
  const walk = (root: string, d: string, prefix: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const rel = (prefix + relative(root, p)).normalize('NFC');
      if (statSync(p).isDirectory()) { walk(root, p, prefix); continue; }
      if (rel === 'README.md' || rel === 'make-media.mjs') continue;
      if (BINARY.test(rel)) bin[rel] = readFileSync(p).toString('base64');
      else files[rel] = readFileSync(p, 'utf8');
    }
  };
  walk(FX, FX, '');
  const tegg = resolve(REPO, 'tests/fixtures/vaults/new-empty/.tegg');
  walk(tegg, tegg, '.tegg/');
  edit?.(files, bin);
  return { name: 'Zahrada', files, bin };
}
export const original = (path: string) => tmVault().files[nfc(path)];
export const fixtureBytes = (rel: string) => new Uint8Array(readFileSync(resolve(FX, rel)));
export const sample = (name: string) => new Uint8Array(readFileSync(resolve(SAMPLES, name)));
export const idOf = (text: string | undefined) => /^id: (\S+)$/m.exec(text ?? '')?.[1] ?? null;

export const ui = (o: { theme?: UiStateDto['theme']; panel?: boolean } = {}): UiStateDto =>
  ({ version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: o.panel ?? false, tab: 'backlinks' } });

export type StartTM = StartOptions & {
  vault?: FakeVault;
  /** Land on this note path (`vault_last`), else the launch landing. */
  at?: string;
  now?: string;
  install?: boolean;
  region?: string;
  theme?: UiStateDto['theme'];
  panel?: boolean;
  trashedAt?: FakeOptions['trashedAt'];
  /** The read view instead of the editor (the `__TEGG_TEST__.readView` hook of the 3B tests). */
  readView?: boolean;
};

/** Starts the main window on the trash-media vault (zone from `test.use({ timezoneId })`). */
export async function startTM(page: Page, o: StartTM = {}): Promise<FakeCoreHandle> {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'cs');
  if (o.readView) await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; });
  const t = new Date(o.now ?? NOW);
  if (o.install) await page.clock.install({ time: t });
  else await page.clock.setFixedTime(t);
  const vault = o.vault ?? tmVault();
  const last = o.at ? { path: nfc(o.at), id: idOf(vault.files[nfc(o.at)]) } : null;
  return start(page, { ...o, vault, last, trashedAt: o.trashedAt ?? TRASHED_AT, uiState: o.uiState ?? ui({ theme: o.theme, panel: o.panel }) });
}
/** Starts on a note and waits for its page. */
export async function openTM(page: Page, path: string, title: string, o: StartTM = {}): Promise<FakeCoreHandle> {
  const core = await startTM(page, { ...o, at: path });
  await mustBeOn(page, title, `landing on ${path}`, 5000);
  return core;
}

// ------------------------------------------------------------------------------------------------ the Trash page (R70)

export const trashHeading = (page: Page) => main(page).getByRole('heading', { level: 1, name: /^⟦?Trash⟧?$/ });
/** The list `Trashed objects` (`⟦Trashed objects⟧` under the pseudo-locale, D-628). */
export const trashList = (page: Page) => main(page).getByRole('list', { name: /^⟦?Trashed objects⟧?$/ });
export const trashRow = (page: Page, path: string) => trashList(page).locator(`[data-path="${nfc(path)}"]`);
export const restoreBtn = (page: Page, title: string) => main(page).getByRole('button', { name: `Restore "${title}"`, exact: true });
export const deleteBtn = (page: Page, title: string) => main(page).getByRole('button', { name: `Delete "${title}" permanently…`, exact: true });
export const emptyBtn = (page: Page) => main(page).getByRole('button', { name: 'Empty trash…', exact: true });
export const zeroRegion = (page: Page) => page.getByRole('region', { name: 'Trash is empty', exact: true });
export const dialogNamed = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true }).or(page.getByRole('alertdialog', { name, exact: true }));
export const alertWith = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });
export const toastWith = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
export const undoIn = (scope: Locator) => scope.getByRole('button', { name: 'Undo', exact: true });

/** `Go to Trash` from the palette, then the heading or the empty state. */
export async function gotoTrash(page: Page) {
  await runCommand(page, 'Go to Trash');
  await must(trashHeading(page).or(zeroRegion(page)), 'heading "Trash" (R70)', 5000);
}
/** The rows' `data-path`, in order. */
export async function rowPaths(page: Page): Promise<string[]> {
  if (!(await seen(trashList(page), 1000))) return [];
  return trashList(page).evaluate((l) => ([...l.querySelectorAll('[data-path]')] as HTMLElement[])
    .filter((e) => e.getAttribute('role') === 'listitem' || e.tagName === 'LI').map((e) => (e.getAttribute('data-path') ?? '').normalize('NFC')));
}
export async function rowsWhen(page: Page, ok: (p: string[]) => boolean, ms = 2000) {
  return eventually(() => rowPaths(page), ok, ms);
}
/** R70's `Deleted <date-time>`: D-160 medium date and short time in the region locale and the machine's zone. */
export function deletedText(iso: string, region: string, zone: string): string {
  return `Deleted ${new Intl.DateTimeFormat(region, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(iso))}`;
}
/** Whitespace of every kind (incl. U+202F) as one space. */
export const ws = (s: string) => nfc(s).replace(/[\s  ]+/g, ' ').trim();

// ------------------------------------------------------------------------------------------------ notes and menus

export const moreBtn = (page: Page) => main(page).getByRole('button', { name: 'More', exact: true });
export const moreMenu = (page: Page) => page.getByRole('menu', { name: 'More', exact: true });
/** `More › <item>` on a note page. */
export async function moreItem(page: Page, item: string) {
  await click(moreBtn(page), 'button "More" (D-369)');
  await must(moreMenu(page), 'menu "More"');
  await click(moreMenu(page).getByRole('menuitem', { name: item, exact: true }), `menuitem ${item}`);
}
export const editorBody = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
export const block = (page: Page, n: number) => editorBody(page).locator(':scope > *').nth(n - 1);
/** Puts the caret in block `n` after `after` (or at its end) and focuses the editor. */
export async function caretIn(page: Page, n: number, after: string | null = null) {
  const blk = await must(block(page, n), `block ${n}`);
  await blk.evaluate((el, a) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let t = walker.nextNode(); t; t = walker.nextNode()) texts.push(t as Text);
    let node: Text | null = null, off = 0;
    if (a) { for (const t of texts) { const i = t.data.indexOf(a); if (i >= 0) { node = t; off = i + a.length; break; } } }
    else { node = texts[texts.length - 1] ?? null; off = node ? node.data.length : 0; }
    const host = (el.closest('[contenteditable="true"]') as HTMLElement | null) ?? (el as HTMLElement);
    host.focus();
    const r = document.createRange();
    if (node) r.setStart(node, off); else r.setStart(el, 0);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
  }, after);
  await sleep(50);
}

// ------------------------------------------------------------------------------------------------ media (R76, R77)

/** A media figure: `figure` with an `img` whose alt is `alt` (R77). */
export const figure = (scope: Locator, alt: string) => scope.locator('figure').filter({ has: scope.page().getByRole('img', { name: alt, exact: true }) });
export const imgNamed = (scope: Locator, alt: string) => scope.getByRole('img', { name: alt, exact: true });
/** The PDF link card (R77): a link or button whose text holds the title and `<n> pages`. */
export const pdfCard = (scope: Locator, title: string) => scope.locator('a, button, [role="link"], [role="button"]').filter({ hasText: title }).filter({ hasText: /\d+ pages?/ });
/** The D-27 placeholder of a trashed embed (R74). */
export const trashedPlaceholder = (scope: Locator, title: string) => scope.locator('*').filter({ hasText: `"${title}" was moved to the trash` }).last();
/** Natural size of a loaded `img` (0 when not loaded). */
export async function imgSize(loc: Locator): Promise<{ w: number; h: number; src: string }> {
  await must(loc, 'img');
  return loc.first().evaluate((e) => ({ w: (e as HTMLImageElement).naturalWidth, h: (e as HTMLImageElement).naturalHeight, src: (e as HTMLImageElement).currentSrc || (e as HTMLImageElement).src }));
}
export async function waitLoaded(loc: Locator, ms = 1000): Promise<{ w: number; h: number; src: string }> {
  return eventually(() => imgSize(loc), (s) => s.w > 0, ms);
}

// ------------------------------------------------------------------------------------------------ probes

/** Commands that change vault files in 6A (and before), for "nothing written" checks. */
export const WRITES_6A = new Set([
  'note_write', 'note_create', 'note_create_exact', 'note_trash', 'note_discard', 'note_rename', 'daily_create', 'link_create', 'type_create',
  'type_patch', 'type_delete', 'starter_add', 'vault_create', 'vault_settings_patch', 'capture_create', 'inbox_bulk', 'job_retry', 'job_undo',
  'job_redo', 'object_trash', 'trash_restore', 'trash_delete', 'trash_empty', 'media_add', 'media_add_paths',
]);
export async function vaultWrites6a(core: FakeCoreHandle): Promise<string[]> {
  return (await core.calls()).map((c) => c.cmd).filter((c) => WRITES_6A.has(c));
}
/** Every vault file as a fingerprint (text and binary), for byte-identical checks. */
export async function snapshot(core: FakeCoreHandle): Promise<Record<string, string>> {
  const t = await core.files();
  const b = await core.binary();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) out[k] = `t:${v}`;
  for (const [k, v] of Object.entries(b)) out[k] = `b:${Buffer.from(v).toString('base64')}`;
  return out;
}
export const changedKeys = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
export { sleep as pause };
export const isMac = true;
export { focusName as focusOf, description as describedBy, isDisabled as disabled };
