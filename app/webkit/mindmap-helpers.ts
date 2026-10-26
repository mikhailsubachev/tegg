// Helpers for the slice MM WebKit tests (L5): the mindmap fixture in the fake core (plus new-empty/.tegg), the test
// clock of docs/acceptance/mindmap.md (Thursday 22 Oct 2026, 10:00 in Prague, region cs, 1440 × 900, right panel
// closed), locators from R91 and docs/contracts/mm-mindmap.md §4 (roles, names, `data-mindmap`, `data-view`,
// `data-node`, `data-tone`, `data-map-area`, connector `path`s with `data-from` / `data-to`), and call probes. No AC
// assertions here except `must` (re-exported), `click` and the `need*` lookups, which turn a missing element into an
// AssertionError instead of a Playwright timeout (TS-I1). Written from the ACs and the contract only (D-61).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault, type CallRecord, type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import { absent, eventually, mainName, must, mustBeOn, runCommand, seen, sleep, start, type FakeCoreHandle, type StartOptions } from './helpers';

export { absent, eventually, mainName, must, mustBeOn, runCommand, seen, sleep };
export type { CallRecord, FakeCoreHandle, FakeVault };

export const nfc = (s: string) => s.normalize('NFC');
export const nfd = (s: string) => s.normalize('NFD');
export const flat = (s: string | null | undefined) => nfc((s ?? '').replace(/\s+/g, ' ').trim());
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The test clock (mindmap.md). */
export const NOW = '2026-10-22T10:00:00+02:00';

/** The fixture's paths (tests/fixtures/vaults/mindmap/README.md). */
export const MM = {
  vyjezd: 'Pages/Výjezd 2026.md', lisabon: 'Pages/Lisabon.md', uzly: 'Pages/Uzly.md', nakup: 'Pages/Nákup.md', postup: 'Pages/Postup.md',
  vice: 'Pages/Více kořenů.md', bez: 'Pages/Bez titulku.md', hola: 'Pages/Holá mapa.md', slozene: 'Pages/Složené.md',
  rozpoznani: 'Pages/Rozpoznání.md', mermaid: 'Pages/Mermaid.md', prevody: 'Pages/Převody.md', rozbaleni: 'Pages/Rozbalení.md',
  obsidian: 'Pages/Z Obsidianu.md', vlozeni: 'Pages/Vložení.md', kvetiny: 'Tasks/Zalít květiny.md', rozlozeni: 'Pages/Rozložení.md',
  prazdna: 'Pages/Prázdná.md', neplatna: 'Pages/Neplatná mapa.md', sablona: '_templates/Projekt/Projekt.md', stara: '.trash/Pages/Stará mapa.md',
} as const;
export const TITLES: Record<string, string> = {
  [MM.vyjezd]: 'Výjezd 2026', [MM.lisabon]: 'Lisabon', [MM.uzly]: 'Uzly', [MM.nakup]: 'Nákup', [MM.postup]: 'Postup', [MM.vice]: 'Více kořenů',
  [MM.bez]: 'Bez titulku', [MM.hola]: 'Holá mapa', [MM.slozene]: 'Složené', [MM.rozpoznani]: 'Rozpoznání', [MM.mermaid]: 'Mermaid',
  [MM.prevody]: 'Převody', [MM.rozbaleni]: 'Rozbalení', [MM.obsidian]: 'Z Obsidianu', [MM.vlozeni]: 'Vložení', [MM.kvetiny]: 'Zalít květiny',
  [MM.rozlozeni]: 'Rozložení', [MM.prazdna]: 'Prázdná', [MM.neplatna]: 'Neplatná mapa',
};
/** Every note a user opens (the template and the trashed note aren't opened as notes). */
export const NOTE_PATHS = Object.keys(TITLES);

/** The mindmap fixture plus `new-empty/.tegg` (README.md isn't a vault file). `edit` changes files before start. */
export function mindmapVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/mindmap', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Mapy' };
  delete v.files['README.md'];
  edit?.(v.files);
  return v;
}
export const original = (path: string) => mindmapVault().files[nfc(path)];
export const idOf = (text: string | undefined) => /^id: (\S+)$/m.exec(text ?? '')?.[1] ?? null;
export function swap(text: string | undefined, from: string, to: string): string {
  assert.ok(text !== undefined && text.includes(from) && text.indexOf(from) === text.lastIndexOf(from), `setup: ${JSON.stringify(from)} once in the text`);
  return text!.replace(from, () => to);
}
export const noModified = (t: string | undefined) => (t ?? '').replace(/^modified: .*$/m, 'modified: <x>');

/** `Pages/Široká mapa.md` (FR-MMP-02 AC-13): a chain of 7 nested items of 40 characters each. */
export function sirokaText(): string {
  const items = Array.from({ length: 7 }, (_, i) => `Dlouhá větev číslo ${i + 1} se čtyřiceti znaky`.padEnd(40, '.').slice(0, 40));
  return '---\nid: 01JB4M0000000000000000M020\ntype: page\ntitle: Široká mapa\n---\n> [!mindmap] Široká\n' + items.map((t, i) => `> ${'  '.repeat(i)}- ${t}`).join('\n') + '\n';
}
/** `Pages/Velká mapa.md` (FR-MMP-02 AC-14): root, 10 branches × 7 children × 6 leaves; the last child of the last
 *  branch has 5 → 1 + 10 + 70 + 419 = 500 nodes. */
export function velkaText(): string {
  const lines = ['> [!mindmap] Velká mapa', '> - Velká mapa'];
  for (let b = 1; b <= 10; b++) {
    lines.push(`>   - Větev ${b}`);
    for (let c = 1; c <= 7; c++) {
      lines.push(`>     - Uzel ${b}.${c}`);
      const leaves = b === 10 && c === 7 ? 5 : 6;
      for (let l = 1; l <= leaves; l++) lines.push(`>       - List ${b}.${c}.${l} žluťoučký`);
    }
  }
  return '---\nid: 01JB4M0000000000000000M021\ntype: page\ntitle: Velká mapa\n---\n' + lines.join('\n') + '\n';
}

export const ui = (o: { theme?: UiStateDto['theme']; panel?: boolean } = {}): UiStateDto =>
  ({ version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: !!o.panel, tab: 'backlinks' } } as UiStateDto);

export type MmStart = StartOptions & {
  vault?: FakeVault;
  at?: string;
  route?: string;
  now?: string;
  install?: boolean;
  region?: string;
  theme?: UiStateDto['theme'];
  panel?: boolean;
  readView?: boolean;
};

/** Starts the main window on the mindmap vault (zone from `test.use({ timezoneId })`). */
export async function startMm(page: Page, o: MmStart = {}): Promise<FakeCoreHandle> {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'cs');
  // Init scripts accumulate on the page, so the flag is set every time (a later start without `readView` resets it).
  await page.addInitScript((rv) => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: rv }; }, !!o.readView);
  if (o.route) await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, o.route);
  const t = new Date(o.now ?? NOW);
  if (o.install) await page.clock.install({ time: t });
  else await page.clock.setFixedTime(t);
  const vault = o.vault ?? mindmapVault();
  const last = o.at ? { path: nfc(o.at), id: idOf(vault.files[nfc(o.at)]) } : null;
  return start(page, { ...o, vault, last, uiState: o.uiState ?? ui({ theme: o.theme, panel: o.panel }) });
}
/** Starts on a note (launch landing, D-132) and waits for its page and, unless read-only, the editor. */
export async function openMm(page: Page, path: string, o: MmStart = {}): Promise<FakeCoreHandle> {
  const core = await startMm(page, { ...o, at: path });
  const title = TITLES[path] ?? nfc(path.split('/').pop()!.replace(/\.md$/, ''));
  await mustBeOn(page, title, `landing on ${path}`, 5000);
  if (!o.readView) await must(editorBody(page), `the editor (textbox "Note body") on ${path}`, 5000);
  return core;
}

// ------------------------------------------------------------------------------------------------ R91 locators

export const main = (page: Page) => page.getByRole('main');
export const editorBody = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
export const saveState = (page: Page) => page.getByRole('status', { name: 'Save state', exact: true });
export const slashMenu = (page: Page) => page.getByRole('listbox', { name: 'Insert block', exact: true });
export const blockMenu = (page: Page) => page.getByRole('menu', { name: 'Block actions', exact: true });
export const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting', exact: true });
export const addBelow = (page: Page) => page.getByRole('button', { name: 'Add block below', exact: true });
export const sourceBlocks = (page: Page) => main(page).getByRole('group', { name: 'Source block', exact: true });
export const titleField = (page: Page) => page.getByRole('textbox', { name: 'Title', exact: true });

/** The mindmap block `figure` `Mindmap: <title>` (or `Mindmap` without a title). */
export const figure = (page: Page, title: string | null) => main(page).getByRole('figure', { name: title === null ? 'Mindmap' : `Mindmap: ${nfc(title)}`, exact: true });
/** Every mindmap block (`data-mindmap`). */
export const figures = (page: Page) => main(page).locator('[data-mindmap]');
export const viewGroup = (fig: Locator) => fig.getByRole('group', { name: 'Mindmap view', exact: true });
export const mapBtn = (fig: Locator) => viewGroup(fig).getByRole('button', { name: 'Map', exact: true });
export const listBtn = (fig: Locator) => viewGroup(fig).getByRole('button', { name: 'List', exact: true });
export const tree = (fig: Locator, title: string | null) => fig.getByRole('tree', { name: `Map of ${title === null ? 'Mindmap' : nfc(title)}`, exact: true });
export const anyTree = (scope: Locator) => scope.getByRole('tree');
export const node = (fig: Locator, text: string) => fig.getByRole('treeitem', { name: nfc(text), exact: true });
export const mapArea = (fig: Locator) => fig.locator('[data-map-area]');
export const emptyBtn = (fig: Locator) => fig.getByRole('button', { name: 'Type the central topic', exact: true });
export const foldBtn = (fig: Locator, title: string) => fig.getByRole('button', { name: new RegExp(`^(Collapse|Expand) ${esc(nfc(title))}$`) });

/** Asserts the figure is shown and returns it. */
export async function needFigure(page: Page, title: string | null, ms = 5000): Promise<Locator> {
  return must(figure(page, title), `figure "${title === null ? 'Mindmap' : `Mindmap: ${title}`}" (R91)`, ms);
}
/** Asserts the tree of `fig` is shown. */
export async function needTree(fig: Locator, title: string | null, ms = 3000): Promise<Locator> {
  return must(tree(fig, title), `tree "Map of ${title ?? 'Mindmap'}" (R91)`, ms);
}
export async function needNode(fig: Locator, text: string, ms = 3000): Promise<Locator> {
  return must(node(fig, text), `treeitem "${text}" (R91)`, ms);
}
export async function click(loc: Locator, what: string, ms = 3000) {
  const l = await must(loc, what, ms);
  await l.click();
}
/** `data-view` of a figure ('map' | 'list' | null). */
export async function viewOf(fig: Locator): Promise<string | null> {
  if (!(await seen(fig, 500))) return null;
  return fig.first().getAttribute('data-view');
}
export async function viewWhen(fig: Locator, want: 'map' | 'list', ms = 2000): Promise<string | null> {
  return eventually(() => viewOf(fig), (v) => v === want, ms);
}
export async function pressed(btn: Locator): Promise<string | null> {
  if (!(await seen(btn, 500))) return null;
  return btn.first().getAttribute('aria-pressed');
}

export type TreeItem = { name: string; level: number; setsize: number; posinset: number; node: string; tone: string; description: string };
/** The tree's items in DOM order. */
export async function treeItems(fig: Locator): Promise<TreeItem[]> {
  if (!(await seen(fig.getByRole('tree'), 500))) return [];
  return fig.getByRole('tree').first().evaluate((t) => ([...t.querySelectorAll('[role="treeitem"]')] as HTMLElement[]).map((e) => {
    const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const labelled = (e.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean).map((i) => document.getElementById(i)?.textContent ?? '').join(' ');
    return {
      name: (e.getAttribute('aria-label') ?? (labelled || e.textContent) ?? '').replace(/\s+/g, ' ').trim().normalize('NFC'),
      level: Number(e.getAttribute('aria-level')), setsize: Number(e.getAttribute('aria-setsize')), posinset: Number(e.getAttribute('aria-posinset')),
      node: e.getAttribute('data-node') ?? '', tone: e.getAttribute('data-tone') ?? '',
      description: (e.getAttribute('aria-description') ?? ids.map((i) => document.getElementById(i)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim(),
    };
  }));
}
export async function treeNames(fig: Locator): Promise<string[]> {
  return (await treeItems(fig)).map((i) => i.name);
}
export async function namesWhen(fig: Locator, ok: (n: string[]) => boolean, ms = 2000): Promise<string[]> {
  return eventually(() => treeNames(fig), ok, ms);
}
/** Accessible description (aria-describedby texts or aria-description). */
export async function description(loc: Locator): Promise<string> {
  if (!(await seen(loc, 500))) return '<not shown>';
  return loc.first().evaluate((e) => {
    const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return (e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
  });
}
export async function isDisabled(loc: Locator): Promise<boolean> {
  return loc.first().evaluate((e) => (e as HTMLButtonElement).disabled === true || e.getAttribute('aria-disabled') === 'true');
}

// ------------------------------------------------------------------------------------------------ caret and focus

/** Where the DOM caret is: the text of its block (the nearest `p`, `li` or heading), whether it is at that block's
 *  end, and whether it is inside `Note body`. */
export async function caretInfo(page: Page): Promise<{ text: string; atEnd: boolean; atStart: boolean; inBody: boolean }> {
  return page.evaluate(() => {
    const s = window.getSelection();
    const n = s?.anchorNode ?? null;
    const el = (n instanceof Element ? n : n?.parentElement) ?? null;
    const blockEl = el?.closest('p, h1, h2, h3, h4, h5, h6, [data-callout-title], .callout-title') as HTMLElement | null;
    const body = document.querySelector('[role="textbox"][aria-label="Note body"], [role="textbox"][aria-label="⟦Note body⟧"]');
    let atEnd = false, atStart = false;
    if (blockEl && s && s.rangeCount) {
      const r = document.createRange();
      r.selectNodeContents(blockEl);
      r.setStart(s.getRangeAt(0).endContainer, s.getRangeAt(0).endOffset);
      atEnd = r.toString().length === 0;
      const r2 = document.createRange();
      r2.selectNodeContents(blockEl);
      r2.setEnd(s.getRangeAt(0).startContainer, s.getRangeAt(0).startOffset);
      atStart = r2.toString().length === 0;
    }
    return { text: (blockEl?.textContent ?? '').normalize('NFC'), atEnd, atStart, inBody: !!body && !!document.activeElement && body.contains(document.activeElement) };
  });
}
export async function caretWhen(page: Page, ok: (c: Awaited<ReturnType<typeof caretInfo>>) => boolean, ms = 2000) {
  return eventually(() => caretInfo(page), ok, ms);
}
/** Puts the DOM caret inside `loc` after the first occurrence of `after` (or at the end) and focuses the editor. */
export async function caretAt(loc: Locator, after: string | null = null, atStart = false): Promise<boolean> {
  if (!(await seen(loc, 1000))) return false;
  const ok = await loc.first().evaluate((el, [a, s]) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let t = walker.nextNode(); t; t = walker.nextNode()) texts.push(t as Text);
    let nd: Text | null = null, off = 0;
    if (s) { nd = texts[0] ?? null; off = 0; }
    else if (a) {
      for (const t of texts) { const i = t.data.normalize('NFC').indexOf(a as string); if (i >= 0) { nd = t; off = i + (a as string).length; break; } }
      if (!nd) return false;
    } else { nd = texts[texts.length - 1] ?? null; off = nd ? nd.data.length : 0; }
    const host = ((nd?.parentElement ?? el) as HTMLElement).closest('[contenteditable="true"]') as HTMLElement | null;
    (host ?? (el as HTMLElement)).focus();
    const r = document.createRange();
    if (nd) r.setStart(nd, off); else r.setStart(el, 0);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
    return true;
  }, [after === null ? null : nfc(after), atStart] as const).catch(() => false);
  await sleep(50);
  return ok;
}
export async function mustCaret(loc: Locator, after: string | null, what: string, atStart = false) {
  assert.ok(await caretAt(loc, after, atStart), `${what}: caret placed${after ? ` after "${after}"` : ''}`);
}
/** The focused element's role and accessible name. */
export async function focused(page: Page): Promise<{ role: string; name: string; node: string }> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a) return { role: '', name: '', node: '' };
    return { role: a.getAttribute('role') ?? a.tagName.toLowerCase(), name: (a.getAttribute('aria-label') ?? a.textContent ?? '').replace(/\s+/g, ' ').trim().normalize('NFC'), node: a.getAttribute('data-node') ?? '' };
  });
}
export async function focusedWhen(page: Page, ok: (f: { role: string; name: string; node: string }) => boolean, ms = 2000) {
  return eventually(() => focused(page), ok, ms);
}

// ------------------------------------------------------------------------------------------------ menus

/** Opens the block menu (⌘/) with the caret where it is. */
export async function openBlockMenu(page: Page): Promise<Locator> {
  await page.keyboard.press('Meta+/');
  return must(blockMenu(page), 'menu "Block actions"');
}
/** Block menu › Turn into: the submenu's item names. */
export async function turnIntoItems(page: Page): Promise<string[]> {
  const m = await openBlockMenu(page);
  await click(m.getByRole('menuitem', { name: 'Turn into', exact: true }), 'Block actions › Turn into');
  const sub = turnIntoMenu(page);
  await must(sub, 'the Turn into submenu');
  return (await sub.getByRole('menuitem').or(sub.getByRole('menuitemradio')).or(sub.getByRole('menuitemcheckbox')).allInnerTexts()).map((t) => flat(t.split('\n')[0]));
}
/** The `Turn into` submenu (the menu holding `Bulleted list`). */
export const turnIntoMenu = (page: Page) => page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Bulleted list', exact: true }) }).last();
/** The `Callout type` submenu (the menu holding the `tip` entry). */
export const calloutTypeMenu = (page: Page) => page.getByRole('menu').filter({ has: page.getByRole('menuitemradio', { name: TIP }).or(page.getByRole('menuitem', { name: TIP })) }).last();
const TIP = /^tip$|\(tip\)$/i;
/** A `Callout type` entry: its label, optionally followed by ` (<type>)` as the 3C build shows it. */
const typeName = (name: string) => new RegExp(`^${esc(name)}( \\(.*\\))?$|\\(${esc(name)}\\)$`, 'i');
export const turnIntoItem = (page: Page, name: string) => {
  const sub = turnIntoMenu(page);
  return sub.getByRole('menuitem', { name, exact: true }).or(sub.getByRole('menuitemradio', { name, exact: true })).or(sub.getByRole('menuitemcheckbox', { name, exact: true }));
};
/** Block menu › Turn into › `name`. */
export async function turnInto(page: Page, name: string) {
  await turnIntoItems(page);
  await click(turnIntoItem(page, name), `Turn into › ${name}`);
}
/** Block menu › Callout type: the submenu's item names. */
export async function calloutTypeItems(page: Page): Promise<string[]> {
  const m = await openBlockMenu(page);
  const direct = m.getByRole('menuitem', { name: 'Callout type', exact: true });
  // ms3-shell §13 lists `Callout type` in the block menu; the 3C build also reaches it from `Turn into`.
  if (!(await seen(direct, 500))) await click(m.getByRole('menuitem', { name: 'Turn into', exact: true }), 'Block actions › Turn into');
  await click(page.getByRole('menuitem', { name: 'Callout type', exact: true }), 'Block actions › Callout type');
  const sub = calloutTypeMenu(page);
  await must(sub, 'the Callout type submenu');
  return (await sub.getByRole('menuitemradio').or(sub.getByRole('menuitem')).allInnerTexts()).map((t) => flat(t.split('\n')[0]));
}
export const calloutTypeItem = (page: Page, name: string) => {
  const sub = calloutTypeMenu(page);
  return sub.getByRole('menuitemradio', { name: typeName(name) }).or(sub.getByRole('menuitem', { name: typeName(name) }));
};

// ------------------------------------------------------------------------------------------------ saves and calls

export async function stateIs(page: Page, want: string, ms = 3000): Promise<boolean> {
  return (await eventually(async () => flat(await saveState(page).first().innerText({ timeout: 200 }).catch(() => '')), (t) => t === want, ms)) === want;
}
export async function mustBeSaved(page: Page, ms = 3000) {
  assert.ok(await stateIs(page, 'Saved', ms), `Save state should read "Saved" within ${ms} ms`);
}
export async function writes(core: FakeCoreHandle, path?: string): Promise<CallRecord[]> {
  return (await core.calls()).filter((c) => c.cmd === 'note_write' && (!path || nfc(String((c.args as any)?.path ?? '')) === nfc(path)));
}
export async function callsOf(core: FakeCoreHandle, cmd: string): Promise<CallRecord[]> {
  return (await core.calls()).filter((c) => c.cmd === cmd);
}
export async function fileText(core: FakeCoreHandle, path: string): Promise<string | undefined> {
  return (await core.files())[nfc(path)];
}
export async function fileWhen(core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean, ms = 3000): Promise<string | undefined> {
  return eventually(() => fileText(core, path), ok, ms);
}
/** Waits for the file to differ from `before` and the save state to settle; returns the text. */
export async function savedText(page: Page, core: FakeCoreHandle, path: string, before: string | undefined, ms = 3000): Promise<string | undefined> {
  const t = await fileWhen(core, path, (x) => x !== before, ms);
  await stateIs(page, 'Saved', 2000);
  return fileText(core, path);
}
/** Commands that change vault files (the 4D-lite set of tags-helpers.ts). */
export const VAULT_WRITES = new Set([
  'note_write', 'note_create', 'note_create_exact', 'note_trash', 'note_discard', 'note_rename', 'daily_create', 'link_create', 'type_create',
  'type_patch', 'type_delete', 'starter_add', 'vault_create', 'vault_settings_patch', 'capture_create', 'inbox_bulk', 'job_retry', 'job_undo',
  'job_redo', 'object_trash', 'trash_restore', 'trash_delete', 'trash_empty', 'media_add', 'media_add_paths',
  'tag_rename', 'tag_delete', 'merge_start', 'backup_restore', 'job_confirm',
]);
export async function vaultWrites(core: FakeCoreHandle): Promise<string[]> {
  return (await core.calls()).map((c) => c.cmd).filter((c) => VAULT_WRITES.has(c));
}
/** Paths opened as notes (`nav_opened`), in order. */
export async function navs(core: FakeCoreHandle): Promise<string[]> {
  return (await callsOf(core, 'nav_opened')).map((c) => nfc(String((c.args as any)?.path ?? '')));
}
/** The route the app shows (`window.__TEGG_TEST__.route?.()` is not a contract hook; the main pane's name is). */
export async function onRoute(page: Page, name: string, ms = 3000): Promise<boolean> {
  return (await eventually(() => mainName(page), (n) => n === name, ms)) === name;
}
/** The layout counter of the test hook (`window.__TEGG_MINDMAP_LAYOUTS__`, mm-mindmap §4), or -1 when missing. */
export async function layouts(page: Page): Promise<number> {
  return page.evaluate(() => Number((window as any).__TEGG_MINDMAP_LAYOUTS__ ?? -1));
}

/** Records every request to a non-local host (NFR-SEC-01). */
export function watchNetwork(page: Page): string[] {
  const hits: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!/^(https?|wss?):$/.test(u.protocol)) return;
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname)) hits.push(r.url());
  });
  return hits;
}

/** Dispatches a paste event with the given clipboard items on the focused element (the L5 stand-in for ⌘V). */
export async function paste(page: Page, items: { plain?: string; html?: string }) {
  await page.evaluate((it) => {
    const dt = new DataTransfer();
    if (it.plain !== undefined) dt.setData('text/plain', it.plain);
    if (it.html !== undefined) dt.setData('text/html', it.html);
    const target = (document.activeElement as HTMLElement | null) ?? document.body;
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, items);
  await sleep(100);
}
/** Dispatches a copy event on the focused element and returns the clipboard. */
export async function copy(page: Page): Promise<{ plain: string; html: string }> {
  return page.evaluate(() => {
    const dt = new DataTransfer();
    const target = (document.activeElement as HTMLElement | null) ?? document.body;
    target.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    return { plain: dt.getData('text/plain'), html: dt.getData('text/html') };
  });
}

/** Opens a note through the Search page's `Go to` list (D-760). */
export { goToQuery } from './helpers';
export async function gotoNote(page: Page, title: string) {
  const { goToQuery } = await import('./helpers');
  await goToQuery(page, title);
  await page.keyboard.press('Enter');
  await mustBeOn(page, nfc(title), `open "${title}"`, 5000);
}

// ------------------------------------------------------------------------------------------------ slice MM2 (D-785…D-795)

/** The MM2 notes of the fixture (README: Pavouk, Neznámé metadata, Metadata); their titles equal their file stems, so
 *  `openMm` needs no `TITLES` entry (the MM lists above are unchanged). */
export const MM2 = { pavouk: 'Pages/Pavouk.md', neznama: 'Pages/Neznámé metadata.md', metadata: 'Pages/Metadata.md' } as const;
export const TITLES2: Record<string, string> = { [MM2.pavouk]: 'Pavouk', [MM2.neznama]: 'Neznámé metadata', [MM2.metadata]: 'Metadata' };

/** R97: the header's `radiogroup` `Mindmap layout` and its two `radio`s. */
export const layoutGroup = (fig: Locator) => fig.getByRole('radiogroup', { name: 'Mindmap layout', exact: true });
export const radioRight = (fig: Locator) => layoutGroup(fig).getByRole('radio', { name: 'Branches to the right', exact: true });
export const radioSpider = (fig: Locator) => layoutGroup(fig).getByRole('radio', { name: 'Spider: branches on both sides', exact: true });
export const radioOf = (fig: Locator, layout: 'right' | 'spider') => (layout === 'right' ? radioRight(fig) : radioSpider(fig));
/** `data-layout` of the checked radio (null without a group). */
export async function checkedLayout(fig: Locator): Promise<string | null> {
  if (!(await seen(layoutGroup(fig), 500))) return null;
  const checked = layoutGroup(fig).first().locator('[role="radio"][aria-checked="true"]');
  if ((await checked.count()) !== 1) return `<${await checked.count()} checked>`;
  return checked.first().getAttribute('data-layout');
}
/** `data-layout` of the figure (R97), or null. */
export async function layoutOf(fig: Locator): Promise<string | null> {
  if (!(await seen(fig, 500))) return null;
  return fig.first().getAttribute('data-layout');
}
export async function layoutWhen(fig: Locator, want: 'right' | 'spider', ms = 2000): Promise<string | null> {
  return eventually(() => layoutOf(fig), (v) => v === want, ms);
}
/** `data-side` of every treeitem by name (R97; absent on the root → null). */
export async function sides(fig: Locator): Promise<Record<string, string | null>> {
  if (!(await seen(fig.getByRole('tree'), 500))) return {};
  return fig.getByRole('tree').first().evaluate((t) => {
    const out: Record<string, string | null> = {};
    for (const e of t.querySelectorAll('[role="treeitem"]') as NodeListOf<HTMLElement>) {
      const name = (e.getAttribute('aria-label') ?? e.textContent ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
      out[name] = e.getAttribute('data-side');
    }
    return out;
  });
}
/** R95a: the single-line `textbox` `Edit node` (`data-node-editor`) inside a node of `fig`. */
export const nodeField = (fig: Locator) => fig.getByRole('textbox', { name: 'Edit node', exact: true });
/** The pending node of D-795 (`data-node="pending"`). */
export const pendingNode = (fig: Locator) => fig.locator('[role="treeitem"][data-node="pending"]');
/** The field's value and whether its caret is collapsed at the end (an input, or a contenteditable). */
export async function fieldState(fig: Locator): Promise<{ value: string; caretAtEnd: boolean; focused: boolean } | null> {
  if (!(await seen(nodeField(fig), 1000))) return null;
  return nodeField(fig).first().evaluate((el) => {
    const a = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return { value: el.value.normalize('NFC'), caretAtEnd: el.selectionStart === el.value.length && el.selectionEnd === el.value.length, focused: a === el };
    }
    const s = window.getSelection();
    let atEnd = false;
    if (s && s.rangeCount && s.isCollapsed) {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.setStart(s.getRangeAt(0).endContainer, s.getRangeAt(0).endOffset);
      atEnd = r.toString().length === 0;
    }
    return { value: (el.textContent ?? '').normalize('NFC'), caretAtEnd: atEnd, focused: !!a && (a === el || el.contains(a)) };
  });
}
/** Focuses the treeitem `text` of `fig` (an assertion when it is missing). */
export async function focusNode(fig: Locator, text: string): Promise<Locator> {
  const n = await needNode(fig, text);
  await n.focus();
  return n;
}
/** The first point of a connector's `path` (`data-from` → `data-to`), from its `d` attribute, relative to the map area's
 *  origin (padding 16 / 12). */
export async function connectorStart(fig: Locator, from: string, to: string): Promise<[number, number] | null> {
  const p = fig.locator(`path[data-from="${from}"][data-to="${to}"]`);
  if (!(await seen(p, 500))) return null;
  return p.first().evaluate((el) => {
    const d = el.getAttribute('d') ?? '';
    const m = /M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(d);
    if (!m) return null;
    const svg = el.closest('svg')!;
    const area = el.closest('[data-map-area]') as HTMLElement | null;
    if (!area) return [Number(m[1]), Number(m[2])];
    const a = area.getBoundingClientRect();
    const s = svg.getBoundingClientRect();
    return [Number(m[1]) + s.left - a.left + area.scrollLeft - 16, Number(m[2]) + s.top - a.top + area.scrollTop - 12];
  });
}
