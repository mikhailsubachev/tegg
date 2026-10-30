// Slice G1, L5 (WebKit + fake core): the full view in both themes (docs/acceptance/graph.md FR-UX-05 AC-15, FR-TAG-05
// AC-9; boards GraphDark, GraphStatesDark, GraphDetailsDark A): axe `color-contrast` with zero violations; app-shell
// FR-UX-05 AC-5 (no colour that isn't a token of the theme, now also for SVG fill and stroke); edges `--edge`, the
// selected node's edges `--hl`; each R110 state; the tag pills in each of the eight colours. Written from the ACs and the
// contracts only (D-61). Every lookup goes through `must` and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast, colourLeaks } from './read-helpers';
import {
  P, click, clickNode, depthBtn, edgeStyle, graphVault, loadingStatus, main, must, noneBtn, openGraph, original, swap, tagNode, tokenColour,
  waitDrawn,
} from './graph-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US' });

/** SVG fills and strokes in the main area that aren't a token of the theme (FR-UX-05 AC-5 for the canvas). */
async function svgLeaks(page: Page, theme: 'light' | 'dark'): Promise<string[]> {
  return page.evaluate(async (th) => {
    const tokens = (await import('/src/theme/tokens.ts' as string))[th] as Record<string, string>;
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const allowed = new Set<string>(['none', 'rgba(0, 0, 0, 0)', 'transparent']);
    for (const v of Object.values(tokens ?? {})) { probe.style.color = ''; probe.style.color = v; allowed.add(getComputedStyle(probe).color); }
    probe.remove();
    if (Object.keys(tokens ?? {}).length === 0) return ['no tokens for this theme'];
    const out = new Set<string>();
    const svg = document.querySelector('main svg[role="group"]');
    if (!svg) return ['no graph canvas'];
    for (const e of svg.querySelectorAll('*')) {
      const s = getComputedStyle(e);
      for (const v of [s.fill, s.stroke]) if (v && !v.startsWith('url(') && !allowed.has(v)) out.add(`${e.tagName.toLowerCase()}: ${v}`);
    }
    return [...out];
  }, theme);
}

async function check(page: Page, theme: 'light' | 'dark', what: string) {
  assert.deepEqual(await axeContrast(page), [], `${theme}, ${what}: axe color-contrast`);
  assert.deepEqual(await colourLeaks(page, theme), [], `${theme}, ${what}: only theme tokens (FR-UX-05 AC-5)`);
}

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac15_graph_in_light_and_dark_${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openGraph(page, P.plan, { theme, graph: { depth: 2 } });
    await waitDrawn(page, 19);
    await clickNode(page, P.rozpocet);
    await check(page, theme, 'Plán d2 with Rozpočet selected');
    assert.deepEqual(await svgLeaks(page, theme), [], `${theme}: node fills, borders, icons, edges, canvas dots and pills use the theme's tokens`);
    const edge = await tokenColour(page, 'edge'), hl = await tokenColour(page, 'hl');
    assert.equal((await edgeStyle(page, P.plan, P.zapis))?.stroke, edge, `${theme}: an edge is --edge`);
    assert.equal((await edgeStyle(page, P.plan, P.rozpocet))?.stroke, hl, `${theme}: the selected node's edge is --hl`);
  });

  test(`fr_ux_05_ac15_graph_in_light_and_dark_states_${theme}`, async ({ page, browser }) => {
    await page.emulateMedia({ colorScheme: theme });
    const core = await openGraph(page, P.osamela, { theme });
    await waitDrawn(page, 1);
    await check(page, theme, 'No links');
    const p2 = await browser.newPage();
    await p2.emulateMedia({ colorScheme: theme });
    const c2 = await openGraph(p2, P.plan, { theme, vault: graphVault({ hub: true }), realTime: true });
    await click(noneBtn(p2), 'None');
    await waitDrawn(p2, 1);
    await check(p2, theme, 'All hidden');
    await click(p2.getByRole('button', { name: 'Show all types', exact: true }), 'Show all types');
    await c2.graphDelay(2000);
    await click(depthBtn(p2, 2), 'depth 2 (slow)');
    await must(loadingStatus(p2), 'the loading state', 1500);
    await check(p2, theme, 'Loading');
    await c2.graphDelay(0);
    await p2.close();
    const p3 = await browser.newPage();
    await p3.emulateMedia({ colorScheme: theme });
    await openGraph(p3, P.rozcestnik, { theme, vault: graphVault({ hub: true }), graph: { depth: 2 } });
    await waitDrawn(p3, 150, 6000);
    await check(p3, theme, 'Too many, ≤ 1,000');
    await click(main(p3).getByRole('button', { name: 'Show all', exact: true }), 'Show all');
    await waitDrawn(p3, 161, 5000);
    await check(p3, theme, 'Shown all');
    await click(depthBtn(p3, 3), 'depth 3');
    await waitDrawn(p3, 150, 5000);
    await check(p3, theme, 'Too many, > 1,000');
    await p3.close();
    await core.renameFile(P.osamela, '.trash/Pages/Osamělá.md');
    await must(page.getByText('This object was deleted', { exact: true }), 'Centre deleted', 2000);
    await check(page, theme, 'Centre deleted');
  });

  test(`fr_tag_05_ac9_graph_tag_pills_contrast_${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    const core = await openGraph(page, P.plan, { theme, graph: { depth: 3 } });
    await waitDrawn(page, 22);
    for (const c of ['gray', 'blue', 'green', 'orange', 'purple', 'red', 'teal', 'yellow', null]) {
      await core.setFile(P.fUcty, c ? swap(original(P.fUcty), 'color: blue', `color: ${c}`) : swap(original(P.fUcty), 'color: blue\n', ''));
      await must(tagNode(page, 'účty'), `#Účty in ${c ?? 'neutral'}`);
      await page.waitForTimeout(400);
      assert.deepEqual(await axeContrast(page), [], `${theme}: axe color-contrast with účty ${c ?? 'without a colour'} (D-709)`);
    }
  });
}
