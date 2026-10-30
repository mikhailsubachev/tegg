// Helpers for the slice G2 WebKit tests (L5): the local graph in the right panel (docs/acceptance/graph-panel.md
// R114…R117; docs/contracts/v1-graph.md §15). They build on the G1 helpers (graph-helpers.ts: the fixture, the fake core's
// `graphCalls`/`graphDelay`/`graphNotReady`, the SVG probes, which take the panel's `tabpanel` `Graph` as their scope).
// No AC assertions here except `must`/`click` (re-exported) and the setup checks, which turn a missing element into an
// AssertionError instead of a Playwright timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { type UiStateDto } from '../ui/test/fake-core';
import {
  P, VAULT_PATH, click, eventually, flat, must, nfc, seen, startGraph, textOf, waitDrawn, type FakeCoreHandle, type GraphState, type StartGraph,
} from './graph-helpers';
import { goToQuery, mustBeOn } from './helpers';

/** The G2 window (graph-panel.md "Test clock"): 1,440 × 980, sidebar open, panel 288 px. */
export const VIEWPORT = { width: 1440, height: 980 };
export const noteRoute = (path: string) => `note/${nfc(path)}`;
export const tagRoute = (key: string) => `tag/${encodeURIComponent(nfc(key))}`;

export type PanelUi = {
  theme?: UiStateDto['theme'];
  /** `vaults[<vault>].graph.panel` (absent: no `graph` entry, as the test clock). */
  panel?: GraphState;
  /** `vaults[<vault>].graph.full`. */
  full?: GraphState;
  /** The `vaults` key (default the fake's `/fake/Graf`). */
  vaultKey?: string;
  open?: boolean;
  tab?: 'backlinks' | 'outline' | 'graph';
  width?: number;
  sidebarOpen?: boolean;
  previewMode?: 'click' | 'hover' | 'off';
};
/** The machine-local UI state of the test clock: `rightPanel: { open: true, tab: 'graph', width: 288 }`. The fake core's
 *  `UiStateDto` type predates `width` and `vaults`; the state is passed through a cast (as panel_resize.ac.test.ts). */
export function panelUi(o: PanelUi = {}): UiStateDto {
  const graph = { ...(o.full ? { full: o.full } : {}), ...(o.panel ? { panel: o.panel } : {}) };
  return {
    version: 1, theme: o.theme ?? 'light', sidebarOpen: o.sidebarOpen ?? true,
    rightPanel: { open: o.open ?? true, tab: o.tab ?? 'graph', width: o.width ?? 288 },
    ...(o.full || o.panel ? { vaults: { [nfc(o.vaultKey ?? VAULT_PATH)]: { graph } } } : {}),
    ...(o.previewMode ? { preview: { mode: o.previewMode } } : {}),
  } as unknown as UiStateDto;
}

export type StartPanel = StartGraph & PanelUi;
/** Starts the main window on `route` (default `note/<path>`) with the panel per `panelUi`. */
export async function startPanel(page: Page, route: string, o: StartPanel = {}): Promise<FakeCoreHandle> {
  await page.setViewportSize(VIEWPORT).catch(() => {});
  return startGraph(page, { ...o, route, uiState: o.uiState ?? panelUi(o) });
}
/** Starts on `note/<path>` with the panel on Graph and waits for its canvas or one of its R115 states. */
export async function openPanel(page: Page, path: string, o: StartPanel = {}): Promise<FakeCoreHandle> {
  const core = await startPanel(page, noteRoute(path), o);
  await must(graphPanel(page), `note/${path}: tabpanel "Graph" in the Context panel (R114)`, 8000);
  await must(pCanvas(page).or(panelStateText(page)), `note/${path}: the panel's canvas or an R115 state`, 8000);
  return core;
}

// ------------------------------------------------------------------------------------------------ R114 locators

export const ctxPanel = (page: Page) => page.getByRole('complementary', { name: 'Context panel' });
export const graphTab = (page: Page) => ctxPanel(page).getByRole('tab', { name: /^⟦?Graph/ });
export const backlinksTab = (page: Page) => ctxPanel(page).getByRole('tab', { name: /^⟦?Backlinks/ });
/** The `tabpanel` `Graph`: the scope of every panel probe. */
export const graphPanel = (page: Page) => ctxPanel(page).getByRole('tabpanel', { name: 'Graph', exact: true });
export const GP = graphPanel;
export const pCanvas = (page: Page) => graphPanel(page).getByRole('group', { name: /^⟦?Local graph: / });
export const trigger = (page: Page) => graphPanel(page).getByRole('button', { name: 'Depth and filters', exact: true });
export const popover = (page: Page) => page.getByRole('dialog', { name: 'Depth and filters', exact: true });
export const depthRadios = (page: Page) => popover(page).getByRole('radiogroup', { name: 'Depth', exact: true });
export const depthRadio = (page: Page, d: 1 | 2 | 3) => depthRadios(page).getByRole('radio', { name: String(d), exact: true });
export const pTypes = (page: Page) => popover(page).getByRole('group', { name: 'Types', exact: true });
export const pKinds = (page: Page) => popover(page).getByRole('group', { name: 'Connections', exact: true });
export const pTypeBox = (page: Page, plural: string) => pTypes(page).getByRole('checkbox', { name: new RegExp(`^${plural.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) });
export const pKindBox = (page: Page, label: 'Links' | 'Relations' | 'Embeds' | 'Tags') => pKinds(page).getByRole('checkbox', { name: label, exact: true });
export const pAll = (page: Page) => pTypes(page).getByRole('button', { name: 'All', exact: true });
export const pNone = (page: Page) => pTypes(page).getByRole('button', { name: 'None', exact: true });
export const pSizeBox = (page: Page) => popover(page).getByRole('checkbox', { name: 'Size nodes by links', exact: true });
export const FILTERS_NOTE = 'Remembered for the panel; the full view keeps its own.';
/** The toolbar's `Open full view (<shortcut>)` (R114; `data-command="graph.open"`). */
export const openFullBtn = (page: Page) => graphPanel(page).locator('[data-command="graph.open"]').or(graphPanel(page).getByRole('button', { name: /^Open full view \(/ }));
/** The Too many state's own `Open full view` (R115). */
export const stateOpenFull = (page: Page) => graphPanel(page).getByRole('button', { name: 'Open full view', exact: true });
/** `Depth <d'> · <m>` (R115, D-1033). */
export const lowerBtn = (page: Page, d: number, m: string | number) => graphPanel(page).getByRole('button', { name: `Depth ${d} · ${m}`, exact: true });
export const anyLowerBtn = (page: Page) => graphPanel(page).getByRole('button', { name: /^Depth \d · [\d,  ]+$/ });
/** An R115 state's text in the tab panel. */
export const panelStateText = (page: Page) =>
  graphPanel(page).getByText(/^(No links yet|This object was deleted|All \d+ linked objects? (is|are) hidden|Too many to show here|The graph appears once this note is saved\.|Loading…)/);
export const loadingText = (page: Page) => graphPanel(page).getByRole('status').filter({ hasText: 'Loading…' });
export const FOOTER = /^(\d+) objects? · click a node to preview$/;

/** The text of the footer `<n> objects · click a node to preview`, or '' when there is none. */
export async function footerText(page: Page, ms = 1000): Promise<string> {
  const loc = graphPanel(page).getByText(FOOTER);
  return (await seen(loc, ms)) ? flat(await loc.first().innerText()) : '';
}
export async function footerIs(page: Page, want: string, ms = 3000): Promise<boolean> {
  return (await eventually(() => footerText(page, 100), (t) => t === want, ms)) === want;
}
/** The trigger's visible text (`Depth <d>` or `Depth <d> · <n> hidden`). */
export async function triggerText(page: Page, ms = 2000): Promise<string> {
  return (await textOf(trigger(page), ms)).replace(/\s*·\s*/g, ' · ');
}
export async function triggerIs(page: Page, want: string, ms = 3000): Promise<boolean> {
  return (await eventually(() => triggerText(page, 200), (t) => t === want, ms)) === want;
}
/** The tab panel's text, flattened. */
export async function panelText(page: Page): Promise<string> {
  return flat(await graphPanel(page).innerText().catch(() => ''));
}
/** Opens the popover (if it isn't open) through the trigger. */
export async function openPopover(page: Page) {
  if (await seen(popover(page), 100)) return;
  await click(trigger(page), 'button "Depth and filters"');
  await must(popover(page), 'dialog "Depth and filters"');
}
/** Chooses a depth in the popover and waits until `n` nodes are drawn in the panel (when `n` is given). */
export async function chooseDepth(page: Page, d: 1 | 2 | 3, n?: number, ms = 4000): Promise<string[]> {
  await openPopover(page);
  await click(depthRadio(page, d), `radio ${d} in "Depth"`);
  if (n === undefined) return [];
  const k = await waitDrawn(page, n, ms, graphPanel(page));
  assert.equal(k.length, n, `panel depth ${d}: ${n} nodes drawn (got ${k.length})`);
  return k;
}
export async function closePopover(page: Page) {
  if (!(await seen(popover(page), 100))) return;
  await page.keyboard.press('Escape');
}

// ------------------------------------------------------------------------------------------------ state and calls

/** `vaults[<vault>].graph.panel` as the app stored it (D-993). */
export async function panelStored(core: FakeCoreHandle, vault = VAULT_PATH): Promise<GraphState | null> {
  const s = (await core.uiState()) as any;
  return s?.vaults?.[nfc(vault)]?.graph?.panel ?? null;
}
/** The `graph_neighbourhood` requests (fake core order), each reduced to the six fields of §15.1. */
export async function requests(core: FakeCoreHandle): Promise<Record<string, unknown>[]> {
  return ((await core.graphCalls()) as any[]).map((r) => ({
    centre: typeof r?.centre === 'string' ? r.centre : r?.centre, depth: r?.depth, hiddenTypes: r?.hiddenTypes, hiddenKinds: r?.hiddenKinds, cap: r?.cap, showAll: r?.showAll,
  }));
}
/** `ui_state_set` count. */
export async function uiSetCount(core: FakeCoreHandle): Promise<number> {
  return (await core.calls()).filter((c) => c.cmd === 'ui_state_set').length;
}
export async function navCount(core: FakeCoreHandle): Promise<number> {
  return (await core.calls()).filter((c) => c.cmd === 'nav_opened').length;
}

/** The registry's keys of `graph.open` (R4), as the toolbar button renders them (R114). */
export async function graphOpenKeys(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const m = await import('/src/shell/registry.ts' as string);
    return ((m.SHORTCUTS as { keys: string; command: string }[]).find((s) => s.command === 'graph.open')?.keys ?? '?');
  });
}

/** Search (D-760), then ⏎: opens the object titled `title`. */
export async function searchOpen(page: Page, title: string) {
  await goToQuery(page, title);
  await page.keyboard.press('Enter');
  await mustBeOn(page, title, `open "${title}" from Search`, 5000);
}

// ------------------------------------------------------------------------------------------------ geometry

export type NodeGeo = { key: string; depth: number; step: string | null; d: number | null; pillH: number | null; box: { l: number; t: number; r: number; b: number } };
/** Per drawn panel node: the main shape's diameter (the smallest circle outside the icon; the centre's ring is larger), a
 *  pill's height, and the node's box (shape and label). */
export async function nodeGeometry(page: Page): Promise<NodeGeo[]> {
  return graphPanel(page).evaluate((m) => ([...m.querySelectorAll('[data-graph-node]')] as SVGGraphicsElement[]).map((g) => {
    const circles = ([...g.querySelectorAll('circle')] as SVGGraphicsElement[]).filter((c) => !c.closest('[data-icon]'));
    const ds = circles.map((c) => c.getBoundingClientRect().width).filter((w) => w > 0);
    const rect = g.querySelector('rect') as SVGGraphicsElement | null;
    const r = g.getBoundingClientRect();
    return {
      key: (g.getAttribute('data-path') ?? `tag:${g.getAttribute('data-tag-key') ?? ''}`).normalize('NFC'), depth: Number(g.getAttribute('data-depth')),
      step: g.getAttribute('data-size-step'), d: ds.length ? Math.min(...ds) : null, pillH: rect && !ds.length ? rect.getBoundingClientRect().height : null,
      box: { l: r.left, t: r.top, r: r.right, b: r.bottom },
    };
  })).catch(() => []);
}
/** Every circle diameter of one node outside its icon (the centre: 52 px and its 60 px ring). */
export async function circleSizes(loc: Locator): Promise<number[]> {
  return loc.first().evaluate((g) => ([...g.querySelectorAll('circle')] as SVGGraphicsElement[]).filter((c) => !c.closest('[data-icon]'))
    .map((c) => Math.round(c.getBoundingClientRect().width * 10) / 10)).catch(() => []);
}
/** Labels shown in the panel: drawn nodes whose `<text>` is visible. */
export async function labelsShown(page: Page): Promise<number> {
  return graphPanel(page).evaluate((m) => ([...m.querySelectorAll('[data-graph-node]')] as SVGGraphicsElement[]).filter((g) => {
    const t = g.querySelector('text');
    if (!t) return false;
    const s = getComputedStyle(t);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0 && t.getBoundingClientRect().width > 0;
  }).length).catch(() => -1);
}

export { P };
