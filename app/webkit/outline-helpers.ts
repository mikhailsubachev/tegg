// Helpers for the slice OL WebKit tests (L5): the outline fixture in the fake core (docs/contracts/v1-outline.md §10), the
// test clock of docs/acceptance/outline.md (2026-11-13 10:00 in Prague, region `cs`, 1,440 × 900, the panel open on
// Outline at 288 px), locators of §3.7 (R170, R173) and probes of the tab, the rail, the card, the editor's selection and
// the centre pane's scroll. No AC assertions here except `must` and `click` (re-exported) and setup checks, which turn a
// missing element into an AssertionError instead of a Playwright timeout (TS-I1). Synthetic data only (D-50, D-62).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault, type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import { absent, callsOf, click, description, eventually, flat, focusName, main, must, nfc, runCommand, seen, sleep, textOf, type FakeCoreHandle } from './capture-helpers';
import { box, goToQuery, mustBeOn, paletteDialog, paletteOptions, pseudoLocale, searchQueryField, start, type StartOptions } from './helpers';

export {
  absent, box, callsOf, click, description, eventually, flat, focusName, goToQuery, main, must, mustBeOn, nfc, paletteDialog, paletteOptions, runCommand, seen, sleep,
  textOf,
};
export type { FakeCoreHandle, FakeVault };

/** The OL test clock (outline.md "Test clock"): Friday 13 Nov 2026, 10:00 in Prague. */
export const NOW = '2026-11-13T10:00:00+01:00';
export const ZONE = 'Europe/Prague';
export const VAULT_PATH = '/fake/Outline';
export const VIEWPORT = { width: 1440, height: 900 };
export const ID = (nn: string) => `01JC5N000000000000000000${nn}`;

/** The fixture's notes (tests/fixtures/vaults/outline/README.md) and the runtime notes of its "Made at runtime". */
export const P = {
  plan: 'Pages/Plán offsitu 2026.md', arch: 'Pages/Architektura.md', cten: 'Pages/Čtenářské poznámky.md', okraje: 'Pages/Okraje.md',
  presk: 'Pages/Přeskočené úrovně.md', jeden: 'Pages/Jeden nadpis.md', bez: 'Pages/Bez nadpisů.md', dlouhe: 'Pages/Dlouhé nadpisy.md',
  odkazy: 'Pages/Odkazy na oddíly.md', den: 'Daily/2026-11-12.md', rozbita: 'Pages/Rozbitá hlavička.md', bezHlavicky: 'Pages/Bez hlavičky.md',
  dva: 'Pages/Dva nadpisy.md', prazdne: 'Pages/Prázdné nadpisy.md', sedesat: 'Pages/Šedesát kapitol.md', triSta: 'Pages/Tři sta kapitol.md',
  petSet: 'Pages/Pět set nadpisů.md',
} as const;
export const TITLE: Record<string, string> = {
  [P.plan]: 'Plán offsitu 2026', [P.arch]: 'Architektura', [P.cten]: 'Čtenářské poznámky', [P.okraje]: 'Okraje', [P.presk]: 'Přeskočené úrovně',
  [P.jeden]: 'Jeden nadpis', [P.bez]: 'Bez nadpisů', [P.dlouhe]: 'Dlouhé nadpisy', [P.odkazy]: 'Odkazy na oddíly', [P.rozbita]: 'Rozbitá hlavička',
  [P.bezHlavicky]: 'Bez hlavičky', [P.dva]: 'Dva nadpisy', [P.prazdne]: 'Prázdné nadpisy', [P.sedesat]: 'Šedesát kapitol', [P.triSta]: 'Tři sta kapitol',
  [P.petSet]: 'Pět set nadpisů',
};
export const noteRoute = (path: string) => `note/${nfc(path)}`;

/** README "Expected outlines": rows as [text, depth]. */
export const PLAN_ROWS: [string, number][] = [
  ['Cíle', 1], ['Co od toho chceme', 2], ['Kdo jede', 2], ['Program', 1], ['Den 1', 2], ['Ráno: strategie', 3], ['Odpoledne: plán', 3], ['Den 2', 2],
  ['Logistika', 1], ['Cesta', 2], ['Rozpočet', 2],
];
export const ARCH_ROWS: [string, number][] = [
  ['Úložiště', 1], ['Rozvržení trezoru', 2], ['Složky podle typu', 3], ['Denní poznámky', 4], ['Názvy souborů', 5], ['Časová pásma', 6], ['Přejmenování', 6],
  ['Přílohy', 4], ['Hlavička', 3], ['Povinné klíče', 4], ['Neznámé klíče', 4], ['Indexování', 2], ['Fulltextový index', 3], ['Index odkazů', 3],
  ['Synchronizace', 1], ['Konflikty', 2], ['Stejný řádek upraven', 3], ['Složky iCloudu', 2],
];
export const OKRAJE_ROWS: [string, number][] = [
  ['Nadpis podtržený', 1], ['Podnadpis podtržený', 2], ['Tučný začátek, odkaz a kód', 2], ['Oddíl s blokem', 2], ['Nadpis v calloutu', 2], ['Skrytý nadpis', 3],
  ['Nadpis v citaci', 2], ['Nadpis v seznamu', 2], ['Poznámky', 2], ['Poznámky', 3], ['Poznámky', 2],
];
export const CTEN_H1 = ['Úvod', 'Spolehlivé systémy', 'Datové modely', 'Ukládání a vyhledávání', 'Kódování', 'Replikace', 'Dělení dat', 'Transakce', 'Konzistence', 'Dávkové zpracování', 'Proudy', 'Závěr'];

// ------------------------------------------------------------------------------------------------ the vault

const page = (id: string, title: string, body: string) =>
  `---\nid: ${id}\ntype: page\ntitle: ${title}\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n---\n${body}`;
const FILL = 'Výplňový odstavec, aby se poznámka dala posouvat.';
/** README "Made at runtime" (small notes and many headings). */
export const RUNTIME: Record<string, () => string> = {
  [P.dva]: () => page('01JC5N0000000000000000R001', 'Dva nadpisy', '## A\n\nText.\n\n## B\n\nText.\n'),
  [P.prazdne]: () => page('01JC5N0000000000000000R002', 'Prázdné nadpisy', '#\n\n##\n'),
  [P.sedesat]: () => page('01JC5N0000000000000000R003', 'Šedesát kapitol', Array.from({ length: 60 }, (_, i) => `# Kapitola ${String(i + 1).padStart(2, '0')}\n\nJeden řádek textu.\n`).join('\n')),
  [P.triSta]: () => page('01JC5N0000000000000000R004', 'Tři sta kapitol', Array.from({ length: 300 }, (_, i) => `# Kapitola ${String(i + 1).padStart(3, '0')}\n\nJeden řádek textu.\n`).join('\n')),
  [P.petSet]: () => {
    const words = Array.from({ length: 30 }, (_, i) => ['žluťoučký', 'kůň', 'úpěl', 'ďábelské', 'ódy', 'přes', 'louku'][i % 7]).join(' ') + '.';
    const out: string[] = [];
    for (let k = 1; k <= 100; k++) {
      const kk = String(k).padStart(3, '0');
      out.push(`# Kapitola ${kk}\n\n${words}\n`);
      for (let o = 1; o <= 4; o++) out.push(`## Oddíl ${kk}.${o}\n\n${words}\n`);
    }
    return page('01JC5N0000000000000000R005', 'Pět set nadpisů', out.join('\n'));
  },
};
/** The outline fixture plus `new-empty/.tegg` and the runtime notes; `edit` changes the files last. */
export function outlineVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const v = loadFixtureVault('tests/fixtures/vaults/outline', 'tests/fixtures/vaults/new-empty/.tegg');
  delete v.files['README.md'];
  for (const [p, make] of Object.entries(RUNTIME)) v.files[nfc(p)] = make();
  edit?.(v.files);
  return { ...v, name: 'Outline' };
}
export const original = (path: string) => outlineVault().files[nfc(path)];

export type Panel = 'outline' | 'backlinks' | 'graph' | null;
export type OutlineUi = {
  panel?: Panel; width?: number; rail?: boolean; folds?: Record<string, string[]>; theme?: 'light' | 'dark'; vaultKey?: string;
  noteWidth?: Record<string, 'normal' | 'wide'>; extra?: Record<string, unknown>;
};
/** The machine-local UI state of the test clock: the panel open on Outline at 288 px, no `outline` entry, preview Off. */
export function outlineUi(o: OutlineUi = {}): UiStateDto {
  const panel = o.panel === undefined ? 'outline' : o.panel;
  return {
    version: 1, theme: o.theme ?? 'light', sidebarOpen: true, propertiesOpen: true,
    rightPanel: { open: panel !== null, tab: panel ?? 'outline', width: o.width ?? 288 },
    preview: { mode: 'off' },
    ...(o.rail !== undefined ? { outlineRail: o.rail } : {}),
    ...(o.folds ? { vaults: { [nfc(o.vaultKey ?? VAULT_PATH)]: { outline: { collapsed: o.folds } } } } : {}),
    ...(o.noteWidth ? { noteWidth: o.noteWidth } : {}),
    ...(o.extra ?? {}),
  } as unknown as UiStateDto;
}

export type StartOutline = Omit<StartOptions, 'vault'> & OutlineUi & {
  vault?: FakeVault;
  viewport?: { width: number; height: number };
  reducedMotion?: 'reduce' | 'no-preference';
  /** `install` (default): Playwright's clock, flowing until a test pauses it; `fixed`: only Date is fixed. */
  clock?: 'install' | 'fixed';
  pseudo?: boolean;
  /** Wait for the note's text (editor or source view); default true on note routes. */
  wait?: boolean;
};
/** Starts the main window on `route` (`window.__TEGG_ROUTE__`) with the outline vault, region `cs`, the test clock. */
export async function startOutline(page: Page, route: string, o: StartOutline = {}): Promise<FakeCoreHandle> {
  await page.setViewportSize(o.viewport ?? VIEWPORT);
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, 'cs');
  await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, route);
  await page.emulateMedia({ reducedMotion: o.reducedMotion ?? 'no-preference', colorScheme: o.theme ?? 'light' });
  if ((o.clock ?? 'install') === 'install') await page.clock.install({ time: new Date(NOW) });
  else await page.clock.setFixedTime(new Date(NOW));
  const vault = o.vault ?? outlineVault();
  const core = await start(page, {
    ...o, vault, vaultPath: o.vaultPath ?? VAULT_PATH, uiState: o.uiState ?? outlineUi(o), previewStored: 'asGiven',
    ...(o.pseudo ? { prelude: pseudoLocale } : {}),
  });
  const isNote = /^(note|daily|new)\//.test(route);
  if (o.wait ?? isNote) await must(editorBody(page).or(sourceView(page)), `${route}: the note's text (the editor or the source view)`, 8000);
  return core;
}
/** A second window of the same browser context, started on `route` (each page has its own fake core). */
export async function another(page: Page, route: string, o: StartOutline = {}): Promise<{ p: Page; core: FakeCoreHandle }> {
  const p = await page.context().newPage();
  const core = await startOutline(p, route, o);
  return { p, core };
}

// ------------------------------------------------------------------------------------------------ §3.7 locators

export const ctxPanel = (page: Page) => page.getByRole('complementary', { name: 'Context panel' });
export const outlineTab = (page: Page) => ctxPanel(page).getByRole('tab', { name: /^⟦?Outline/ });
export const backlinksTab = (page: Page) => ctxPanel(page).getByRole('tab', { name: /^⟦?Backlinks/ });
export const graphTab = (page: Page) => ctxPanel(page).getByRole('tab', { name: /^⟦?Graph/ });
export const outlinePanel = (page: Page) => ctxPanel(page).getByRole('tabpanel', { name: /^⟦?Outline⟧?$/ });
export const outlineTree = (page: Page) => outlinePanel(page).getByRole('tree', { name: /^⟦?Outline⟧?$/ });
export const rows = (page: Page) => outlineTree(page).getByRole('treeitem');
export const row = (page: Page, text: string, n = 0) => outlineTree(page).getByRole('treeitem', { name: nfc(text), exact: true }).nth(n);
export const countEl = (page: Page) => outlinePanel(page).locator('[data-outline-count]');
export const expandAllBtn = (page: Page) => outlinePanel(page).getByRole('button', { name: /^⟦?Expand all⟧?$/ });
export const collapseAllBtn = (page: Page) => outlinePanel(page).getByRole('button', { name: /^⟦?Collapse all⟧?$/ });
export const scrollBox = (page: Page) => outlinePanel(page).locator('[data-outline-scroll]');
export const emptyState = (page: Page) => outlinePanel(page).locator('.outline-empty');
/** The rail (`div.centre` carries `data-outline-rail` too while the rail is shown, §3.7). */
export const rail = (page: Page) => page.locator('[data-outline-rail]:not(.centre)');
export const railLinesLoc = (page: Page) => rail(page).locator('[data-outline-line]');
export const card = (page: Page) => page.getByRole('dialog', { name: /^⟦?Outline⟧?$/ });
export const cardTree = (page: Page) => card(page).getByRole('tree', { name: /^⟦?Outline⟧?$/ });
export const cardRow = (page: Page, text: string, n = 0) => cardTree(page).getByRole('treeitem', { name: nfc(text), exact: true }).nth(n);
export const liveRegion = (page: Page) => page.locator('[data-outline-live]');
export const editorBody = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
export const sourceView = (page: Page) => page.getByRole('region', { name: /^⟦?Markdown source⟧?$/ });
export const centre = (page: Page) => page.locator('div.centre');
export const separator = (page: Page) => page.getByRole('separator', { name: /^⟦?Resize panel⟧?$/ });
/** A heading element in the centre pane by its text (`nth` among equal texts, DOM order). */
export const headingEl = (page: Page, text: string, n = 0) =>
  main(page).locator('h1, h2, h3, h4, h5, h6').filter({ hasText: new RegExp(`^\\s*${nfc(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).nth(n);
/** A source-view line by its text (`## Den 1`). */
export const sourceLine = (page: Page, text: string) => main(page).locator('.source-line[data-line]').filter({ hasText: new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first();

// ------------------------------------------------------------------------------------------------ probes

export type RowInfo = {
  index: number; label: string; text: string; level: string | null; dataLevel: string | null; expanded: string | null; current: string | null; setsize: string | null;
  posinset: string | null; desc: string; tabindex: string | null; pad: number; hidden: string | null; title: string | null; height: number; font: string; weight: string;
  color: string; bg: string; bar: boolean; chevron: boolean; chevronShown: boolean;
};
/** Every treeitem of `tree` in DOM order with its attributes and computed styles (`bar`: a 3 px `::before`). */
export async function rowsOf(tree: Locator): Promise<RowInfo[]> {
  if (!(await seen(tree, 300))) return [];
  return tree.first().evaluate((t) => ([...t.querySelectorAll('[role="treeitem"]')] as HTMLElement[]).map((r) => {
    const s = getComputedStyle(r), b = getComputedStyle(r, '::before');
    const txt = r.querySelector('.outline-text') as HTMLElement | null;
    const chev = r.querySelector('[data-outline-chevron]') as HTMLElement | null;
    const cs = chev ? getComputedStyle(chev) : null;
    const bw = parseFloat(b.width) || 0;
    return {
      index: Number(r.getAttribute('data-outline-row')), label: (r.getAttribute('aria-label') ?? '').normalize('NFC'),
      text: ((txt ?? r).innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC'), level: r.getAttribute('aria-level'), dataLevel: r.getAttribute('data-level'),
      expanded: r.getAttribute('aria-expanded'), current: r.getAttribute('aria-current'), setsize: r.getAttribute('aria-setsize'), posinset: r.getAttribute('aria-posinset'),
      desc: (r.getAttribute('aria-description') ?? '').replace(/\s+/g, ' ').trim(), tabindex: r.getAttribute('tabindex'), pad: parseFloat(s.paddingLeft) || 0,
      hidden: (r.querySelector('[data-outline-hidden]') as HTMLElement | null)?.innerText?.trim() ?? null, title: r.getAttribute('title'),
      height: r.getBoundingClientRect().height, font: s.fontSize, weight: s.fontWeight, color: getComputedStyle(txt ?? r).color, bg: s.backgroundColor,
      bar: b.content !== 'none' && b.display !== 'none' && bw >= 2.5 && bw <= 3.5 && b.backgroundColor !== 'rgba(0, 0, 0, 0)',
      chevron: !!chev, chevronShown: !!cs && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05,
    };
  })).catch(() => []);
}
export const tabRows = (page: Page) => rowsOf(outlineTree(page));
export const cardRows = (page: Page) => rowsOf(cardTree(page));
export const labels = async (page: Page) => (await tabRows(page)).map((r) => r.label);
export async function rowsAre(page: Page, want: string[], ms = 3000): Promise<string[]> {
  return eventually(() => labels(page), (l) => JSON.stringify(l) === JSON.stringify(want.map(nfc)), ms);
}
/** The tab's header count text ('' when none). */
export async function countText(page: Page): Promise<string> {
  return (await countEl(page).count()) ? flat(await countEl(page).first().innerText().catch(() => '')) : '';
}
export async function currentRows(page: Page, tree: Locator = outlineTree(page)): Promise<string[]> {
  return (await rowsOf(tree)).filter((r) => r.current === 'location').map((r) => r.label);
}

export type LineInfo = { index: number; state: string | null; hover: boolean; w: number; h: number; color: string; top: number; bottom: number; right: number; left: number };
/** The rail's lines: the drawn stroke is the `i` element itself, or its `::before` when the element is the pointer slot. */
export async function railLines(page: Page): Promise<LineInfo[]> {
  if (!(await seen(rail(page), 300))) return [];
  return rail(page).first().evaluate((r) => ([...r.querySelectorAll('[data-outline-line]')] as HTMLElement[]).map((l) => {
    const box = l.getBoundingClientRect();
    const s = getComputedStyle(l), b = getComputedStyle(l, '::before');
    const slot = box.height > 3 && b.content !== 'none';
    const h = slot ? parseFloat(b.height) || 0 : box.height;
    const w = slot ? parseFloat(b.width) || 0 : box.width;
    const top = slot ? box.top + (box.height - h) / 2 : box.top;
    return {
      index: Number(l.getAttribute('data-outline-line')), state: l.getAttribute('data-state'), hover: l.hasAttribute('data-hover'), w, h,
      color: slot ? b.backgroundColor : s.backgroundColor, top, bottom: top + h, right: box.right, left: box.right - w,
    };
  })).catch(() => []);
}

/** A token's resolved colour as the page computes it (`--text`, `--muted`, …). */
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

/** The centre pane's scroller (`main`, v1-outline §3.5). */
export async function mainScroll(page: Page): Promise<{ top: number; height: number; client: number }> {
  return page.evaluate(() => {
    const m = document.querySelector('main') as HTMLElement | null;
    return m ? { top: m.scrollTop, height: m.scrollHeight, client: m.clientHeight } : { top: -1, height: -1, client: -1 };
  });
}
export async function setScroll(page: Page, top: number | 'end') {
  await page.evaluate((t) => {
    const m = document.querySelector('main') as HTMLElement;
    m.scrollTop = t === 'end' ? m.scrollHeight - m.clientHeight : t;
    m.dispatchEvent(new Event('scroll'));
  }, top);
  await sleep(80);
}
/** An element's top in `main`'s viewport (its rect top − main's rect top). */
export async function topIn(loc: Locator): Promise<number | null> {
  if (!(await seen(loc, 1000))) return null;
  return loc.first().evaluate((e) => e.getBoundingClientRect().top - (document.querySelector('main') as HTMLElement).getBoundingClientRect().top).catch(() => null);
}
export const headingTop = (page: Page, text: string, n = 0) => topIn(headingEl(page, text, n));
/** Scrolls `main` so that heading `text` has its top `y` px below the viewport's top. */
export async function scrollHeadingTo(page: Page, text: string, y: number, n = 0) {
  const el = await must(headingEl(page, text, n), `heading "${text}" in the note`);
  await el.evaluate((e, yy) => {
    const m = document.querySelector('main') as HTMLElement;
    m.scrollTop = m.scrollTop + e.getBoundingClientRect().top - m.getBoundingClientRect().top - yy;
    m.dispatchEvent(new Event('scroll'));
  }, y);
  await sleep(120);
}

export type Caret = { collapsed: boolean; tag: string; block: string; offset: number; len: number; focused: boolean; inCallout: boolean; inList: boolean; nth: number } | null;
/** The editor's selection: its block (closest heading, paragraph or list item), the caret's offset in the block's text,
 *  whether the `Note body` holds the focus; `nth` is the block's index among the body's blocks with the same tag and text. */
export async function caret(page: Page): Promise<Caret> {
  if (!(await seen(editorBody(page), 300))) return null;
  return editorBody(page).first().evaluate((body) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !body.contains(sel.anchorNode)) return null;
    const node = sel.anchorNode!;
    const el = (node.nodeType === 1 ? (node as Element) : node.parentElement)!;
    const blk = el.closest('h1, h2, h3, h4, h5, h6, p, li') as HTMLElement | null;
    if (!blk) return null;
    const r = document.createRange();
    r.selectNodeContents(blk);
    r.setEnd(sel.anchorNode!, sel.anchorOffset);
    const text = (blk.textContent ?? '').normalize('NFC');
    const same = ([...body.querySelectorAll(blk.tagName)] as HTMLElement[]).filter((x) => (x.textContent ?? '').normalize('NFC') === text);
    const a = document.activeElement;
    return {
      collapsed: sel.isCollapsed, tag: blk.tagName.toLowerCase(), block: text.trim(), offset: r.toString().length, len: (blk.textContent ?? '').length,
      focused: !!a && (a === body || body.contains(a)), inCallout: !!blk.closest('[data-callout], .callout, blockquote'), inList: !!blk.closest('li'),
      nth: same.indexOf(blk),
    };
  }).catch(() => null);
}
/** Puts the caret at `offset` characters into `loc`'s text and focuses the editor. */
export async function placeCaret(loc: Locator, offset: number | 'end') {
  await loc.first().evaluate((el, off) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let t = walker.nextNode(); t; t = walker.nextNode()) texts.push(t as Text);
    let left = off === 'end' ? texts.reduce((n, t) => n + t.data.length, 0) : (off as number);
    let node: Text | null = texts[texts.length - 1] ?? null, at = node ? node.data.length : 0;
    for (const t of texts) { if (left <= t.data.length) { node = t; at = left; break; } left -= t.data.length; }
    (el.closest('[contenteditable="true"]') as HTMLElement | null)?.focus({ preventScroll: true });
    const r = document.createRange();
    if (node) r.setStart(node, at); else r.setStart(el, 0);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
  }, offset);
  await sleep(60);
}
/** Selects `text` inside `loc` (first occurrence). */
export async function selectText(loc: Locator, text: string) {
  const ok = await loc.first().evaluate((el, t) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let x = walker.nextNode(); x; x = walker.nextNode()) {
      const i = (x as Text).data.normalize('NFC').indexOf(t);
      if (i >= 0) {
        (el.closest('[contenteditable="true"]') as HTMLElement | null)?.focus({ preventScroll: true });
        const r = document.createRange();
        r.setStart(x, i);
        r.setEnd(x, i + t.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(r);
        document.dispatchEvent(new Event('selectionchange'));
        return true;
      }
    }
    return false;
  }, nfc(text));
  assert.ok(ok, `text "${text}" to select`);
  await sleep(60);
}
/** The first paragraph of the note body (the intro). */
export const introPara = (page: Page) => editorBody(page).locator('p').first();

/** `window.__TEGG_TEST__.editor` (ms3-shell §13.6). */
export async function editorState(page: Page): Promise<{ dirty: boolean | null; depth: number | null; text: string | null }> {
  return page.evaluate(() => {
    const e = (window as any).__TEGG_TEST__?.editor;
    return { dirty: e?.dirty?.() ?? null, depth: e?.historyDepth?.() ?? null, text: e?.text?.() ?? null };
  });
}
/** `window.__TEGG_TEST__.outline` (v1-outline §10): null when the hook isn't there. */
export async function hook<T>(page: Page, f: 'headings' | 'current' | 'railRows'): Promise<T | null> {
  return page.evaluate((fn) => {
    const o = (window as any).__TEGG_TEST__?.outline;
    return typeof o?.[fn] === 'function' ? o[fn]() : null;
  }, f);
}
export async function hold(page: Page, on: boolean) {
  const ok = await page.evaluate((v) => {
    const o = (window as any).__TEGG_TEST__?.outline;
    if (typeof o?.hold !== 'function') return false;
    o.hold(v);
    return true;
  }, on);
  assert.ok(ok, '__TEGG_TEST__.outline.hold exists (v1-outline §10)');
}
/** ATX headings of a text (Plán-like notes), for comparing the rows with the editor's text. */
export function atxTexts(text: string): string[] {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  return body.split('\n').map((l) => /^(#{1,6}) +(.*?)\s*$/.exec(l)?.[2]).filter((x): x is string => !!x && x.length > 0).map(nfc);
}

/** Calls of `cmd` so far. */
export async function count(core: FakeCoreHandle, cmd: string): Promise<number> {
  return (await callsOf(core, cmd)).length;
}
/** The commands called after the first `from` calls. */
export async function callsSince(core: FakeCoreHandle, from: number): Promise<string[]> {
  return (await core.calls()).slice(from).map((c) => c.cmd).filter((c) => !c.startsWith('plugin:event|'));
}
/** The commands that write vault files (everything but reads and machine-local state). */
const WRITES = /^(note_write|note_create|note_create_exact|note_delete|note_rename|object_|trash_|pins_apply|job_|value_|type_|tag_|media_add|vault_create|daily_create|attachment_)/;
export async function vaultWrites(core: FakeCoreHandle): Promise<string[]> {
  return (await core.calls()).map((c) => c.cmd).filter((c) => WRITES.test(c) && !/^(type_get|type_template|type_usage|type_misfits|type_move_plan|job_report|job_plan|job_cancel|value_remove_start|type_delete_start)$/.test(c));
}
/** `vaults[<vault>].outline.collapsed` as the app stored it. */
export async function foldsStored(core: FakeCoreHandle, vault = VAULT_PATH): Promise<Record<string, string[]> | null> {
  const s = (await core.uiState()) as any;
  return s?.vaults?.[nfc(vault)]?.outline?.collapsed ?? null;
}
export async function uiSets(core: FakeCoreHandle): Promise<number> {
  return count(core, 'ui_state_set');
}

// ------------------------------------------------------------------------------------------------ clock

/** Pauses the page's clock a little after its current time (the clock must be installed). */
export async function pauseClock(page: Page) {
  // 200 ms ahead: Playwright's clock can be up to 100 ms stale, and pauseAt must not go back in time (D-1648). Under a
  // loaded gate more than 200 ms can pass between the read and the pause: read again and retry with the same margin.
  for (let attempt = 0; ; attempt++) {
    const now = await page.evaluate(() => Date.now());
    try {
      await page.clock.pauseAt(new Date(now + 200));
      return;
    } catch (e) {
      if (attempt >= 4 || !String(e).includes('fast-forward to the past')) throw e;
    }
  }
}
/** Advances the paused clock by `ms`, then lets the page commit (node-side wait). */
export async function runFor(page: Page, ms: number) {
  await page.clock.runFor(ms);
  await sleep(40);
}

/** Records `main.scrollTop` on every animation frame from now (read with `frames`). */
export async function recordFrames(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__olFrames = [];
    const tick = () => { w.__olFrames.push((document.querySelector('main') as HTMLElement).scrollTop); if (w.__olFrames.length < 400) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}
export async function frames(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as any).__olFrames ?? []);
}
/** The animations running on `loc` (type, property, duration). */
export async function animationsOf(loc: Locator): Promise<{ type: string; prop: string; ms: number }[]> {
  if ((await loc.count()) === 0) return [];
  return loc.first().evaluate((e) => e.getAnimations().map((a) => ({
    type: a.constructor.name, prop: (a as any).transitionProperty ?? (a as any).animationName ?? '', ms: Number(a.effect?.getTiming().duration ?? 0),
  }))).catch(() => []);
}
/** Hovers the rail's box centre (a pointer at rest). */
export async function hoverRail(page: Page) {
  const b = await box(await must(rail(page), 'the rail ([data-outline-rail])'));
  assert.ok(b, 'the rail has a box');
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 2 });
}
/** Moves the pointer into the note text, far from the rail and the card. */
export async function pointerToNote(page: Page) {
  const b = await box(await must(editorBody(page).or(sourceView(page)), 'the note'));
  assert.ok(b, 'the note has a box');
  await page.mouse.move(b!.x + 40, b!.y + 20, { steps: 2 });
}
/** Opens the card by hover and waits for it (real time). */
export async function openCardByHover(page: Page) {
  await hoverRail(page);
  await must(card(page), 'dialog "Outline" (the card, opened by hover)', 2000);
}
export { pseudoLocale, searchQueryField as searchField };

/** Focuses the tab `Outline`, then presses Tab until a treeitem of the tab's tree has the focus (at most 4 presses; the
 *  header's buttons may come first in the tab order). Returns the presses it took, or -1. */
export async function tabIntoTree(page: Page): Promise<number> {
  await (await must(outlineTab(page), 'tab "Outline"')).focus();
  for (let i = 1; i <= 4; i++) {
    await page.keyboard.press('Tab');
    const inTree = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'treeitem' && !!document.activeElement.closest('[role="tabpanel"]'));
    if (inTree) return i;
  }
  return -1;
}
