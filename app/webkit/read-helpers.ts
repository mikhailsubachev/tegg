// Helpers for the MS3 slice 3B WebKit tests (L5): the read-view fixture in the fake core and page probes. No AC
// assertions here except `must` (re-exported), which turns a missing element into an AssertionError (TS-I1).
// Labels from docs/contracts/ms3-shell.md §11.4.
import type { Locator, Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { loadFixtureVault, type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import { must, mustBeOn, start, type FakeCoreHandle, type StartOptions } from './helpers';

export const R = {
  bloky: 'Pages/Bloky.md',
  odkazy: 'Pages/Odkazy.md',
  cil: 'Pages/Cíl.md',
  dvojnikP: 'Pages/Dvojník.md',
  denni: 'Daily/2026-10-07.md',
  vlastnosti: 'Pages/Vlastnosti.md',
  jenSys: 'Pages/Jen systémové.md',
  bez: 'Pages/Bez hlavičky.md',
  uvozovky: 'Pages/Chyba uvozovky.md',
  odsazeni: 'Pages/Chyba odsazení.md',
  klic: 'Pages/Chyba klíč.md',
  tabulator: 'Pages/Chyba tabulátor.md',
  neuzavrena: 'Pages/Neuzavřená.md',
} as const;

export const IDS: Record<string, string | null> = {
  [R.cil]: '01JB0R0000000000000000R001', [R.dvojnikP]: '01JB0R0000000000000000R002', [R.denni]: '01JB0R0000000000000000R004',
  [R.odkazy]: '01JB0R0000000000000000R005', [R.bloky]: '01JB0R0000000000000000R006', [R.vlastnosti]: '01JB0R0000000000000000R007',
  [R.jenSys]: '01JB0R0000000000000000R008',
};
export const TITLES: Record<string, string> = {
  [R.bloky]: 'Bloky', [R.odkazy]: 'Odkazy', [R.cil]: 'Cíl', [R.vlastnosti]: 'Vlastnosti', [R.jenSys]: 'Jen systémové',
  [R.bez]: 'Bez hlavičky', [R.denni]: '2026-10-07', [R.dvojnikP]: 'Dvojník',
};

/** The read-view fixture plus `new-empty/.tegg` (read-view.md "Fixture"). */
export function readVault(): FakeVault {
  return { ...loadFixtureVault('tests/fixtures/vaults/read-view', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Čtení' };
}

export const ui = (theme: UiStateDto['theme'], extra: Partial<UiStateDto> = {}): UiStateDto =>
  ({ version: 1, theme, sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, ...extra });

/** Starts the app with the read-view vault, landing on `path` (launch landing via `vault_last`, D-132). For files with
 *  a title the test waits until the centre pane is that note. */
export async function openAt(page: Page, path: string, o: StartOptions & { region?: string } = {}): Promise<FakeCoreHandle> {
  if (o.region) await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region);
  const core = await start(page, { vault: readVault(), last: { path, id: IDS[path] ?? null }, ...o });
  if (TITLES[path]) await mustBeOn(page, TITLES[path], `landing on ${path}`, 5000);
  return core;
}

export const article = (page: Page, title: string) => page.getByRole('article', { name: title, exact: true });
export const sourceRegion = (page: Page) => page.getByRole('region', { name: 'Markdown source', exact: true });
export const toFormattedButton = (page: Page) => page.getByRole('button', { name: 'Show formatted note', exact: true });
export const toSourceButton = (page: Page) => page.getByRole('button', { name: 'Show Markdown source', exact: true });
export const propsRegion = (page: Page) => page.getByRole('region', { name: 'Properties', exact: true });

export async function mustArticle(page: Page, title: string, ms = 3000): Promise<Locator> {
  return must(article(page, title), `note body article "${title}"`, ms);
}

/** Calls of the fake core after index `from` (default all), as command names. */
export async function cmds(core: FakeCoreHandle, from = 0): Promise<string[]> {
  return (await core.calls()).slice(from).map((c) => c.cmd).filter((c) => !c.startsWith('plugin:'));
}

/** Rect of `el` and of its nearest scrolling ancestor (the centre pane's scroller), in viewport coordinates. */
export async function placement(page: Page, selectorFn: string): Promise<{ top: number; bottom: number; viewTop: number; viewBottom: number } | null> {
  return page.evaluate((src) => {
    const el = (new Function(`return (${src})`))()() as Element | null;
    if (!el) return null;
    let s: Element | null = el.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    const r = el.getBoundingClientRect();
    const v = s ? s.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    return { top: r.top, bottom: r.bottom, viewTop: Math.max(v.top, 0), viewBottom: Math.min(v.bottom, window.innerHeight) };
  }, selectorFn);
}

/** A function source that finds the heading with the given text inside `main` (any level 2–6). */
export const headingFn = (text: string) => `() => [...document.querySelectorAll('main h2, main h3, main h4, main h5, main h6')].find((h) => h.textContent.trim() === ${JSON.stringify(text)}) ?? null`;
/** A function source that finds the source-view line element with the given 1-based number. */
export const lineFn = (n: number) => `() => document.querySelector('[aria-label="Markdown source"] [data-line="${n}"]')`;

/** Scrolls the element found by `fn` to the top of its scroller. */
export async function scrollToTop(page: Page, fn: string) {
  await page.evaluate((src) => { ((new Function(`return (${src})`))()() as Element | null)?.scrollIntoView({ block: 'start' }); }, fn);
}

/** The first block of the note body whose top is at or below the scroller top (the "first visible block"). */
export async function firstVisibleBlockText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const art = document.querySelector('main article, main [role="article"]');
    if (!art) return null;
    let s: Element | null = art;
    while (s && !(s.scrollHeight > s.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    const top = s ? Math.max(s.getBoundingClientRect().top, 0) : 0;
    const blocks = [...art.querySelectorAll('h2, h3, h4, h5, h6, p, li, pre, table, blockquote, [role="note"]')];
    const b = blocks.find((x) => x.getBoundingClientRect().bottom > top + 2);
    return b ? (b.textContent ?? '').trim() : null;
  });
}

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
/** axe `color-contrast` violations on the page (FR-UX-05 AC-4), as target selectors. */
export async function axeContrast(page: Page): Promise<string[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const r = await (window as any).axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
    return r.violations.flatMap((x: any) => x.nodes.map((n: any) => n.target.join(' ')));
  });
}

/** Computed colours that aren't a token of the theme (FR-UX-05 AC-5), as in the 3A theme test. */
export async function colourLeaks(page: Page, theme: 'light' | 'dark'): Promise<string[]> {
  return page.evaluate(async (th) => {
    const tokens = (await import('/src/theme/tokens.ts' as string))[th] as Record<string, string>;
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const allowed = new Set<string>(['rgba(0, 0, 0, 0)', 'transparent']);
    for (const v of Object.values(tokens ?? {})) { probe.style.color = ''; probe.style.color = v; allowed.add(getComputedStyle(probe).color); }
    probe.remove();
    if (Object.keys(tokens ?? {}).length === 0) return ['no tokens for this theme'];
    const out = new Set<string>();
    for (const e of document.querySelectorAll('body *')) {
      const el = e as HTMLElement;
      if (el.getClientRects().length === 0) continue;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden') continue;
      const props: [string, string][] = [['color', s.color], ['background-color', s.backgroundColor]];
      for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
        if (parseFloat((s as any)[`border${side}Width`]) > 0 && (s as any)[`border${side}Style`] !== 'none') props.push([`border-${side.toLowerCase()}-color`, (s as any)[`border${side}Color`]]);
      }
      if (s.textDecorationLine && s.textDecorationLine !== 'none') props.push(['text-decoration-color', s.textDecorationColor]);
      for (const [p, v] of props) if (!allowed.has(v)) out.add(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} ${p} ${v}`);
    }
    return [...out].slice(0, 20);
  }, theme);
}

/** The computed colour of a theme token in the page (e.g. `danger`), or null. */
export async function tokenColour(page: Page, key: string): Promise<string | null> {
  return page.evaluate(async (k) => {
    const th = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const v = ((await import('/src/theme/tokens.ts' as string))[th] as Record<string, string>)?.[k];
    if (!v) return null;
    const p = document.createElement('div');
    p.style.color = v;
    document.body.appendChild(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  }, key);
}

/** Records every request to a non-local host (NFR-SEC-01) for the rest of the page's life. */
export function watchNetwork(page: Page): string[] {
  const hits: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!/^(https?|wss?):$/.test(u.protocol)) return;
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname)) hits.push(r.url());
  });
  return hits;
}
