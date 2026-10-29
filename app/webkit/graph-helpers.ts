// Helpers for the slice G1 WebKit tests (L5): the graph fixture in the fake core (docs/contracts/v1-graph.md §8), the
// test clock, zone and region of docs/acceptance/graph.md, locators from R109…R113 and probes of the drawn SVG. No AC
// assertions here except `must` and `click` (re-exported), `node`/`clickNode`, which turn a missing element into an
// AssertionError instead of a Playwright timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { hubFiles } from '../../tests/fixtures/vaults/graph/make-hub.mjs';
import { type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import {
  absent, callsOf, click, eventually, flat, isDisabled, main, mainName, must, nfc, runCommand, seen, sleep, textOf, type FakeCoreHandle,
} from './capture-helpers';
import { start, type StartOptions } from './helpers';

export { absent, callsOf, click, eventually, flat, isDisabled, main, mainName, must, nfc, runCommand, seen, sleep, textOf };
export type { FakeCoreHandle, FakeVault };

export const REPO = resolve(import.meta.dirname, '../..');
const FX = resolve(REPO, 'tests/fixtures/vaults');

/** The G1 test clock (graph.md): Wednesday 28 Oct 2026, 10:00 in Prague. */
export const NOW = '2026-10-28T10:00:00+01:00';
export const NFD = (s: string) => s.normalize('NFD');

/** The fixture's paths (tests/fixtures/vaults/graph/README.md). */
export const P = {
  plan: 'Pages/Plán čtvrtletí.md', rozpocet: 'Projekty/Rozpočet 2027.md', zapis: 'Schůzky/Zápis z porady.md', jana: 'Osoby/Jana Nováková.md',
  petr: 'Osoby/Petr Dvořák.md', beta: 'Projekty/Projekt Beta.md', shrnuti: 'Pages/Shrnutí.md', vydaje: 'Pages/Výdaje 2026.md',
  bez: 'Pages/Bez hlavičky.md', ukol: 'Tasks/Zaplatit fakturu.md', den: 'Daily/2026-10-07.md', nakup: 'Pages/Nákupní seznam.md',
  graf: 'Images/Graf výdajů.md', smlouva: 'PDFs/Smlouva.md', faktury: 'Pages/Faktury.md', vylet: 'Quick Notes/Nápad na výlet.md',
  recept: 'Pages/Recept na koláč.md', osamela: 'Pages/Osamělá.md', chybna: 'Pages/Chybná hlavička.md', fUcty: 'Tags/Účty.md',
  fFinance: 'Tags/Finance.md', fZdravi: 'Tags/Zdraví.md', fArchiv: 'Tags/Archiv.md', fCestovani: 'Tags/Cestování.md',
  sablona: '_templates/Page/Šablona.md', smazana: '.trash/Pages/Smazaná.md',
  rozcestnik: 'Pages/Hub/Rozcestník.md', siroky: 'Pages/Hub/Široký rozcestník.md',
} as const;
export const TITLE: Record<string, string> = {
  [P.plan]: 'Plán čtvrtletí', [P.rozpocet]: 'Rozpočet 2027', [P.zapis]: 'Zápis z porady', [P.jana]: 'Jana Nováková', [P.petr]: 'Petr Dvořák',
  [P.beta]: 'Projekt Beta', [P.shrnuti]: 'Shrnutí', [P.vydaje]: 'Výdaje 2026', [P.bez]: 'Bez hlavičky', [P.ukol]: 'Zaplatit fakturu',
  [P.den]: '2026-10-07', [P.nakup]: 'Nákupní seznam', [P.graf]: 'Graf výdajů', [P.smlouva]: 'Smlouva', [P.faktury]: 'Faktury',
  [P.vylet]: 'Nápad na výlet', [P.recept]: 'Recept na koláč', [P.osamela]: 'Osamělá', [P.chybna]: 'Chybná hlavička',
  [P.rozcestnik]: 'Rozcestník', [P.siroky]: 'Široký rozcestník',
};
/** Depth of each node from Plán (README). */
export const FROM_PLAN: Record<string, number> = {
  [P.plan]: 0, [P.rozpocet]: 1, [P.zapis]: 1, [P.shrnuti]: 1, [P.graf]: 1, [P.ukol]: 1, [P.den]: 1, 'tag:účty': 1, 'tag:nápad': 1, [P.recept]: 1,
  [P.jana]: 2, [P.vydaje]: 2, 'tag:finance': 2, [P.petr]: 2, [P.smlouva]: 2, 'tag:cestování': 2, 'tag:archiv': 2, [P.bez]: 2, [P.chybna]: 2,
  [P.beta]: 3, 'tag:zdraví': 3, [P.vylet]: 3,
};
export const atDepth = (d: number) => Object.entries(FROM_PLAN).filter(([, x]) => x <= d).map(([k]) => nfc(k)).sort();

const b64 = (p: string) => readFileSync(p).toString('base64');
/** The graph fixture plus `new-empty/.tegg` and the two runtime attachments; `hub` adds the README's hub. */
export function graphVault(o: { hub?: boolean; edit?: (files: Record<string, string>) => void } = {}): FakeVault {
  const files: Record<string, string> = {};
  const walk = (root: string, d: string, prefix: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(root, p, prefix); continue; }
      const rel = (prefix + relative(root, p)).normalize('NFC');
      if (rel === 'README.md' || rel.startsWith('make-hub.')) continue;
      files[rel] = readFileSync(p, 'utf8');
    }
  };
  walk(join(FX, 'graph'), join(FX, 'graph'), '');
  walk(join(FX, 'new-empty/.tegg'), join(FX, 'new-empty/.tegg'), '.tegg/');
  if (o.hub) Object.assign(files, hubFiles());
  o.edit?.(files);
  return {
    name: 'Graf', files,
    bin: { '_attachments/graf.png': b64(join(FX, 'trash-media/_attachments/záhon.png')), '_attachments/Smlouva.pdf': b64(join(FX, 'trash-media/_attachments/Rozpočet.pdf')) },
  };
}
export const original = (path: string) => graphVault().files[nfc(path)];
export function swap(text: string | undefined, from: string, to: string): string {
  assert.ok(text !== undefined && text.includes(from), `setup: ${JSON.stringify(from)} in the text`);
  return text!.replace(from, to);
}
export const VAULT_PATH = '/fake/Graf';

export type GraphState = { depth?: unknown; hiddenTypes?: unknown; hiddenKinds?: unknown; sizeByLinks?: unknown };
export const ui = (o: { theme?: UiStateDto['theme']; graph?: GraphState; vault?: string; extra?: Record<string, unknown> } = {}): UiStateDto =>
  ({
    version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' },
    ...(o.graph ? { vaults: { [nfc(o.vault ?? VAULT_PATH)]: { graph: { full: o.graph } } } } : {}),
    ...(o.extra ?? {}),
  } as UiStateDto);

export type StartGraph = StartOptions & {
  vault?: FakeVault;
  /** Start on this route (`window.__TEGG_ROUTE__`), e.g. `graph/Pages/Plán čtvrtletí.md`. */
  route?: string;
  /** Land on this note path (`vault_last`). */
  at?: string;
  region?: string;
  theme?: UiStateDto['theme'];
  graph?: GraphState;
  previewMode?: 'click' | 'hover' | 'off';
  /** Real time (no fixed clock): for tests that measure delays. */
  realTime?: boolean;
};
/** `graph/<path>` (D-914: the path NFC, as `note/<path>`). */
export const graphRoute = (path: string) => `graph/${nfc(path)}`;

/** Starts the main window on the graph vault (zone from `test.use({ timezoneId })`, region `en-US` by default). */
export async function startGraph(page: Page, o: StartGraph = {}): Promise<FakeCoreHandle> {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'en-US');
  if (o.route) await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, o.route);
  if (!o.realTime) await page.clock.setFixedTime(new Date(NOW));
  const vault = o.vault ?? graphVault();
  const last = o.at ? { path: nfc(o.at), id: /^id: (\S+)$/m.exec(vault.files[nfc(o.at)] ?? '')?.[1] ?? null } : null;
  const prelude = o.region && o.region !== 'cs' ? `import { setCollationLocale as __tcl } from '/src/i18n/collate.ts'; __tcl(${JSON.stringify(o.region)});` : undefined;
  const extra = o.previewMode ? { preview: { mode: o.previewMode } } : undefined;
  return start(page, { ...(prelude ? { prelude } : {}), ...o, vault, last, uiState: o.uiState ?? ui({ theme: o.theme, graph: o.graph, extra }) });
}
/** Starts on `graph/<path>` and waits for the canvas (or a state). */
export async function openGraph(page: Page, path: string, o: StartGraph = {}): Promise<FakeCoreHandle> {
  const core = await startGraph(page, { ...o, route: graphRoute(path) });
  await must(graphHeading(page).or(stateText(page)), `graph/${path}: the full view (R109 heading or an R110 state)`, 8000);
  return core;
}

// ------------------------------------------------------------------------------------------------ R109 locators

export const graphHeading = (page: Page) => main(page).getByRole('heading', { level: 1 }).filter({ hasText: /Local graph of/ });
/** The heading's text with spaces around `·` normalized. */
export async function headingText(page: Page, ms = 3000): Promise<string> {
  return (await textOf(graphHeading(page), ms)).replace(/\s*·\s*/g, ' · ');
}
export async function headingIs(page: Page, want: string, ms = 3000): Promise<boolean> {
  return (await eventually(() => headingText(page, 200), (t) => t === want, ms)) === want;
}
export const depthGroup = (page: Page) => main(page).getByRole('group', { name: 'Depth', exact: true });
export const depthBtn = (page: Page, d: 1 | 2 | 3) => depthGroup(page).getByRole('button', { name: String(d), exact: true });
export const hiddenStatus = (page: Page) => main(page).getByRole('status').filter({ hasText: /^\s*\d[\d,  ]* hidden\s*$/ });
export const recenterBtn = (page: Page) => main(page).getByRole('button', { name: 'Recenter', exact: true });
export const filters = (page: Page) => page.getByRole('complementary', { name: 'Graph filters', exact: true });
export const filtersBtn = (page: Page) => page.getByRole('button', { name: 'Filters', exact: true });
export const typesGroup = (page: Page) => page.getByRole('group', { name: 'Types', exact: true });
export const kindsGroup = (page: Page) => page.getByRole('group', { name: 'Connections', exact: true });
export const typeBox = (page: Page, plural: string) => typesGroup(page).getByRole('checkbox', { name: new RegExp(`^${plural.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) });
export const kindBox = (page: Page, label: 'Links' | 'Relations' | 'Embeds' | 'Tags') => kindsGroup(page).getByRole('checkbox', { name: label, exact: true });
export const allBtn = (page: Page) => typesGroup(page).getByRole('button', { name: 'All', exact: true });
export const noneBtn = (page: Page) => typesGroup(page).getByRole('button', { name: 'None', exact: true });
export const sizeBox = (page: Page) => page.getByRole('checkbox', { name: 'Size nodes by links', exact: true });
export const canvas = (page: Page) => main(page).getByRole('group', { name: /^⟦?Local graph: / });
export const nodes = (page: Page) => main(page).locator('[data-graph-node]');
export const edges = (page: Page) => main(page).locator('[data-graph-edge]');
const attrEsc = (s: string) => nfc(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
export const nodeAt = (page: Page, path: string) => main(page).locator(`[data-graph-node][data-path="${attrEsc(path)}"]`);
export const tagNode = (page: Page, key: string) => main(page).locator(`[data-graph-node][data-tag-key="${attrEsc(key)}"]`);
/** A node by its README short key: a path, or `tag:<key>`. */
export const nodeOf = (page: Page, k: string) => (k.startsWith('tag:') ? tagNode(page, k.slice(4)) : nodeAt(page, k));
export const zoomIn = (page: Page) => main(page).getByRole('button', { name: 'Zoom in', exact: true });
export const zoomOut = (page: Page) => main(page).getByRole('button', { name: 'Zoom out', exact: true });
export const fitBtn = (page: Page) => main(page).getByRole('button', { name: 'Fit to screen', exact: true });
export const previewCol = (page: Page) => page.getByRole('complementary', { name: 'Preview', exact: true });
export const centerHereBtn = (page: Page) => previewCol(page).getByRole('button', { name: 'Center graph here', exact: true });
export const openBtn = (page: Page, title: string) => previewCol(page).getByRole('button', { name: `Open ${title}`, exact: true });
export const banner = (page: Page) => main(page).getByRole('status').filter({ hasText: /objects at depth|Showing all/ });
export const loadingStatus = (page: Page) => page.getByRole('status').filter({ hasText: 'Building the graph…' });
/** An R110 state's text (no links, all hidden, deleted). */
export const stateText = (page: Page) => main(page).getByText(/^(No links yet|This object was deleted|All \d+ linked objects? (is|are) hidden)/);
export const titleTab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });

// ------------------------------------------------------------------------------------------------ probes

export type DrawnNode = { key: string; path: string | null; tag: string | null; type: string | null; depth: number | null; step: string | null; selected: boolean; name: string; icon: string | null };
/** Every drawn node: `data-path` (or `tag:<data-tag-key>`) as its key, NFC. */
export async function drawn(page: Page): Promise<DrawnNode[]> {
  return main(page).evaluate((m) => ([...m.querySelectorAll('[data-graph-node]')] as SVGElement[]).map((e) => {
    const path = e.getAttribute('data-path');
    const tag = e.getAttribute('data-tag-key');
    const sel = e.getAttribute('data-selected');
    const icon = e.getAttribute('data-icon') ?? e.querySelector('[data-icon]')?.getAttribute('data-icon') ?? null;
    return {
      key: (path ?? `tag:${tag ?? ''}`).normalize('NFC'), path: path?.normalize('NFC') ?? null, tag: tag?.normalize('NFC') ?? null,
      type: e.getAttribute('data-type'), depth: e.hasAttribute('data-depth') ? Number(e.getAttribute('data-depth')) : null,
      step: e.getAttribute('data-size-step'), selected: sel !== null && sel !== 'false',
      name: (e.getAttribute('aria-label') ?? '').normalize('NFC'), icon,
    };
  })).catch(() => []);
}
export async function drawnKeys(page: Page): Promise<string[]> {
  return (await drawn(page)).map((n) => n.key).sort();
}
/** Waits until `n` nodes are drawn; returns the keys. */
export async function waitDrawn(page: Page, n: number, ms = 3000): Promise<string[]> {
  return eventually(() => drawnKeys(page), (k) => k.length === n, ms);
}
export type DrawnEdge = { pair: string; a: string; b: string; kinds: string[]; style: string | null };
/** Every drawn edge, its ends as written in `data-a` / `data-b` (sorted into a pair key `a|b`). */
export async function drawnEdges(page: Page): Promise<DrawnEdge[]> {
  return main(page).evaluate((m) => ([...m.querySelectorAll('[data-graph-edge]')] as SVGElement[]).map((e) => {
    const a = (e.getAttribute('data-a') ?? '').normalize('NFC'), b = (e.getAttribute('data-b') ?? '').normalize('NFC');
    const [x, y] = a <= b ? [a, b] : [b, a];
    return { pair: `${x}|${y}`, a, b, kinds: (e.getAttribute('data-kinds') ?? '').split(/[\s,]+/).filter(Boolean).sort(), style: e.getAttribute('data-style') };
  })).catch(() => []);
}
/** A pair key from two README keys; `data-a` / `data-b` may spell a tag node as `tag:<key>` or by its key. */
export function pairOf(edgesNow: DrawnEdge[], x: string, y: string): DrawnEdge | undefined {
  const alt = (k: string) => [nfc(k), k.startsWith('tag:') ? nfc(k.slice(4)) : nfc(k)];
  return edgesNow.find((e) => alt(x).some((p) => alt(y).some((q) => (e.a === p && e.b === q) || (e.a === q && e.b === p))));
}
/** Centres of the drawn nodes' shapes (the circle or the pill), in page pixels. */
export async function positions(page: Page): Promise<Record<string, { x: number; y: number }>> {
  return main(page).evaluate((m) => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const e of [...m.querySelectorAll('[data-graph-node]')] as SVGGraphicsElement[]) {
      const key = (e.getAttribute('data-path') ?? `tag:${e.getAttribute('data-tag-key') ?? ''}`).normalize('NFC');
      const shape = (e.querySelector('circle, rect, ellipse') as SVGGraphicsElement | null) ?? e;
      const r = shape.getBoundingClientRect();
      out[key] = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return out;
  }).catch(() => ({}));
}
export async function canvasCentre(page: Page): Promise<{ x: number; y: number } | null> {
  const c = await must(canvas(page), 'the canvas (R109)');
  const r = await c.boundingBox();
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
}
export function samePlaces(a: Record<string, { x: number; y: number }>, b: Record<string, { x: number; y: number }>, tol: number, keys = Object.keys(a)): string[] {
  return keys.filter((k) => !b[k] || !a[k] || Math.abs(a[k].x - b[k].x) > tol || Math.abs(a[k].y - b[k].y) > tol);
}
/** Clicks (or double-clicks) a node at its shape's centre. */
export async function clickNode(page: Page, k: string, how: { double?: boolean; meta?: boolean } = {}) {
  const el = await must(nodeOf(page, k), `node ${k}`);
  const shape = el.locator('circle, rect, ellipse').first();
  const box = await ((await shape.count()) ? shape : el).boundingBox();
  assert.ok(box, `node ${k} has a box`);
  const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
  if (how.meta) await page.keyboard.down('Meta');
  if (how.double) await page.mouse.dblclick(x, y); else await page.mouse.click(x, y);
  if (how.meta) await page.keyboard.up('Meta');
}
/** Clicks an empty spot of the canvas (its top-left corner area). */
export async function clickEmpty(page: Page) {
  const c = await must(canvas(page), 'the canvas');
  const r = await c.boundingBox();
  assert.ok(r, 'the canvas has a box');
  await page.mouse.click(r!.x + 6, r!.y + 6);
}
export async function opacity(page: Page, k: string): Promise<number | null> {
  if (!(await seen(nodeOf(page, k), 500))) return null;
  return nodeOf(page, k).first().evaluate((e) => {
    let o = 1;
    for (let x: Element | null = e; x && x.tagName.toLowerCase() !== 'svg'; x = x.parentElement) o *= Number(getComputedStyle(x).opacity || '1');
    return Math.round(o * 100) / 100;
  });
}
export async function edgeStyle(page: Page, x: string, y: string): Promise<{ stroke: string; width: string; dash: string; opacity: number } | null> {
  const all = await drawnEdges(page);
  const e = pairOf(all, x, y);
  if (!e) return null;
  return main(page).evaluate((_m, [a, b]) => {
    const el = ([...document.querySelectorAll('[data-graph-edge]')] as SVGElement[]).find((n) => (n.getAttribute('data-a') ?? '').normalize('NFC') === a && (n.getAttribute('data-b') ?? '').normalize('NFC') === b);
    if (!el) return null;
    const s = getComputedStyle(el);
    let o = 1;
    for (let p: Element | null = el; p && p.tagName.toLowerCase() !== 'svg'; p = p.parentElement) o *= Number(getComputedStyle(p).opacity || '1');
    return { stroke: s.stroke, width: s.strokeWidth, dash: s.strokeDasharray, opacity: Math.round(o * 100) / 100 };
  }, [e.a, e.b] as const);
}
/** A CSS custom property resolved to a computed colour (`rgb(…)`) in the page's current theme. */
export async function tokenColour(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const probe = document.createElement('div');
    probe.style.color = `var(--${n})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, name);
}
/** The shape's fill and stroke and the icon's colour of a node. */
export async function nodePaint(page: Page, k: string): Promise<{ fill: string; stroke: string; icon: string | null; text: string | null; strokeWidth: string } | null> {
  if (!(await seen(nodeOf(page, k), 500))) return null;
  return nodeOf(page, k).first().evaluate((e) => {
    const shape = (e.querySelector('circle, rect, ellipse') as SVGElement | null) ?? (e as SVGElement);
    const s = getComputedStyle(shape);
    const icon = e.querySelector('[data-icon]') as SVGElement | null;
    const text = e.querySelector('text') as SVGElement | null;
    const ic = icon ? getComputedStyle(icon) : null;
    return {
      fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth,
      icon: ic ? (ic.stroke && ic.stroke !== 'none' ? ic.stroke : ic.color) : null,
      text: text ? getComputedStyle(text).fill : null,
    };
  });
}
/** `route-ready:<route>` and other marks the page sent (`perf_mark`). */
export async function marks(core: FakeCoreHandle): Promise<string[]> {
  return (await callsOf(core, 'perf_mark')).map((c) => String((c.args as any)?.mark ?? (c.args as any)?.name ?? ''));
}
export async function routeReady(core: FakeCoreHandle, route: string, ms = 3000): Promise<boolean> {
  const want = `route-ready:${nfc(route)}`;
  return (await eventually(() => marks(core), (m) => m.map(nfc).includes(want), ms)).map(nfc).includes(want);
}
/** The full view's stored state for the vault (D-993). */
export async function fullState(core: FakeCoreHandle, vault = VAULT_PATH): Promise<GraphState | null> {
  const s = (await core.uiState()) as any;
  return s?.vaults?.[nfc(vault)]?.graph?.full ?? null;
}
export async function uiWrites(core: FakeCoreHandle): Promise<unknown[]> {
  return (await callsOf(core, 'ui_state_set')).map((c) => (c.args as any)?.state);
}
export async function pressed(loc: Locator): Promise<string | null> {
  await must(loc, 'a toggle button');
  return loc.first().getAttribute('aria-pressed');
}
export async function checked(loc: Locator): Promise<boolean> {
  await must(loc, 'a checkbox');
  return loc.first().evaluate((e) => (e as HTMLInputElement).checked === true || e.getAttribute('aria-checked') === 'true');
}
/** The R110 / R111 texts present in the main area (flattened). */
export async function mainText(page: Page): Promise<string> {
  return flat(await main(page).innerText().catch(() => ''));
}
/** Types fieldset rows: plural name and count, in order (each checkbox's accessible name, e.g. `Pages 2`). */
export async function typeRows(page: Page): Promise<string[]> {
  if (!(await seen(typesGroup(page), 1000))) return [];
  return typesGroup(page).evaluate((g) => ([...g.querySelectorAll('input[type="checkbox"], [role="checkbox"]')] as HTMLElement[]).map((e) => {
    const id = e.getAttribute('id');
    const lab = e.getAttribute('aria-label') ?? (id ? document.querySelector(`label[for="${id}"]`)?.textContent : null) ?? e.closest('label')?.textContent ?? '';
    return lab.replace(/\s+/g, ' ').trim().normalize('NFC');
  }));
}
export const READMEROWS = ['Pages', 'Tasks', 'Quick Notes', 'Daily Notes', 'Cesty', 'Osoby', 'Projekty', 'Schůzky', 'Images', 'PDFs', 'Tags', 'recept'];
