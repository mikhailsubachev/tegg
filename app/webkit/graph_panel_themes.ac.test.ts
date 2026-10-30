// Slice G2, L5 (WebKit + fake core): the panel graph in both themes (docs/acceptance/graph-panel.md FR-UX-05 AC-16; boards
// GraphPanelDark, GraphStatesDark): axe `color-contrast` with zero violations and app-shell FR-UX-05 AC-5 (no colour that
// isn't a token of the theme, also for the panel's SVG fill and stroke) on Plán at depth 2 with Rozpočet previewed, with
// the filter popover open, and in each R115 state; edges `--edge`, the selected node's edges `--hl`. Written from the ACs
// and the contracts only (D-61). Every lookup goes through `must` and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mustPreview } from './helpers';
import { axeContrast, colourLeaks } from './read-helpers';
import { P, click, clickNode, edgeStyle, graphVault, must, sleep, tokenColour, waitDrawn } from './graph-helpers';
import { GP, VIEWPORT, chooseDepth, graphPanel, openPanel, openPopover, pNone, popover, startPanel } from './graph-panel-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US', viewport: VIEWPORT });

/** SVG fills and strokes in the panel's canvas that aren't a token of the theme (FR-UX-05 AC-5 for the canvas). */
async function svgLeaks(page: Page, theme: 'light' | 'dark'): Promise<string[]> {
  return page.evaluate(async (th) => {
    const tokens = (await import('/src/theme/tokens.ts' as string))[th] as Record<string, string>;
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const allowed = new Set<string>(['none', 'rgba(0, 0, 0, 0)', 'transparent']);
    for (const v of Object.values(tokens ?? {})) { probe.style.color = ''; probe.style.color = v; allowed.add(getComputedStyle(probe).color); }
    probe.remove();
    if (Object.keys(tokens ?? {}).length === 0) return ['no tokens for this theme'];
    const svg = document.querySelector('[role="tabpanel"] svg[role="group"]');
    if (!svg) return ['no panel graph canvas'];
    const out = new Set<string>();
    for (const e of svg.querySelectorAll('*')) {
      const s = getComputedStyle(e);
      for (const v of [s.fill, s.stroke]) if (v && !v.startsWith('url(') && !allowed.has(v)) out.add(`${e.tagName.toLowerCase()}: ${v}`);
    }
    return [...out];
  }, theme);
}
async function check(page: Page, theme: 'light' | 'dark', what: string) {
  // D-1055: axe runs once the preview's fade-in (slice P, 120 ms) and any other transition have ended.
  await page.waitForFunction(() => document.getAnimations().every((x) => x.playState !== 'running'), undefined, { timeout: 3000 });
  assert.deepEqual(await axeContrast(page), [], `${theme}, ${what}: axe color-contrast`);
  assert.deepEqual(await colourLeaks(page, theme), [], `${theme}, ${what}: only theme tokens (FR-UX-05 AC-5)`);
}

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac16_panel_graph_in_light_and_dark_${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openPanel(page, P.plan, { theme, panel: { depth: 2 } });
    await waitDrawn(page, 19, 4000, GP(page));
    await clickNode(page, P.rozpocet, {}, GP(page));
    await mustPreview(page, 'Rozpočet 2027', 'Rozpočet previewed');
    await check(page, theme, 'Plán d2 with Rozpočet previewed');
    assert.deepEqual(await svgLeaks(page, theme), [], `${theme}: nodes, edges, canvas dots and pills use the theme's tokens`);
    const edge = await tokenColour(page, 'edge'), hl = await tokenColour(page, 'hl');
    assert.equal((await edgeStyle(page, P.plan, P.zapis, GP(page)))?.stroke, edge, `${theme}: an edge is --edge`);
    assert.equal((await edgeStyle(page, P.plan, P.rozpocet, GP(page)))?.stroke, hl, `${theme}: the selected node's edge is --hl`);
    await page.keyboard.press('Escape');
    await openPopover(page);
    await must(popover(page), 'the filter popover');
    await check(page, theme, 'the filter popover open');
  });

  test(`fr_ux_05_ac16_panel_graph_in_light_and_dark_states_${theme}`, async ({ page, browser }) => {
    const states: [string, (p: Page) => Promise<void>][] = [
      ['No links', async (p) => { await openPanel(p, P.osamela, { theme }); await must(graphPanel(p).getByText('No links yet', { exact: true }), 'No links'); }],
      ['All hidden', async (p) => { await openPanel(p, P.plan, { theme }); await openPopover(p); await click(pNone(p), 'None'); await p.keyboard.press('Escape'); await must(graphPanel(p).getByText(/^All 9 linked objects/), 'All hidden'); }],
      ['Loading', async (p) => {
        const c = await openPanel(p, P.plan, { theme, realTime: true });
        await c.graphDelay(3000);
        await chooseDepth(p, 2);
        await p.keyboard.press('Escape');
        await must(graphPanel(p).getByRole('status').filter({ hasText: 'Loading…' }), 'Loading', 1500);
      }],
      ['Too many', async (p) => { await openPanel(p, P.rozcestnik, { theme, vault: graphVault({ hub: true }), panel: { depth: 2 } }); await must(graphPanel(p).getByText('Too many to show here', { exact: true }), 'Too many', 8000); }],
      ['No file', async (p) => { await startPanel(p, 'new/page', { theme }); await must(graphPanel(p).getByText('The graph appears once this note is saved.', { exact: true }), 'No file', 5000); }],
      ['Deleted', async (p) => {
        const c = await openPanel(p, P.plan, { theme });
        await c.renameFile(P.plan, `.trash/${P.plan}`);
        await must(graphPanel(p).getByText('This object was deleted', { exact: true }), 'Deleted', 2500);
      }],
    ];
    for (const [what, setUp] of states) {
      const p = await browser.newPage();
      await p.setViewportSize(VIEWPORT);
      await p.emulateMedia({ colorScheme: theme });
      await setUp(p);
      await sleep(200);
      await check(p, theme, what);
      await p.close();
    }
    void page;
  });
}
