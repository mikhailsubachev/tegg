// Regression (test flake, FR-UX-05 AC-4/AC-16, D-1055): the contrast helpers ran axe while a preview popover was still
// fading in (opacity 0 → 1, slice P, 120 ms). Under the full gate's load the frame that adds `.shown` came after the
// "no running animation" wait, so axe measured the preview's muted text at partial opacity and reported it
// (graph_panel_themes `#…-type`, `#…-extra`, `.embed-prop-name`, `.preview-hint`, `typePage.a1`). The helpers now
// measure only once every preview popover is fully opaque. Here the popover is held at opacity 0.6 and reaches 1 only
// 300 ms later, after the helper has been called.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mustPreview } from './helpers';
import { axeContrast } from './read-helpers';
import { axeContrastIn } from './previews-editor-helpers';
import { P, clickNode, waitDrawn } from './graph-helpers';
import { GP, VIEWPORT, openPanel } from './graph-panel-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US', viewport: VIEWPORT });

/** Holds the preview at opacity 0.6, then lets it finish its fade 300 ms later. */
async function midFade(page: Page) {
  await page.evaluate(() => {
    const e = document.querySelector('[data-preview-popover]') as HTMLElement;
    e.style.transition = 'none';
    e.style.opacity = '0.6';
    setTimeout(() => { e.style.transition = 'opacity 100ms linear'; e.style.opacity = ''; }, 300);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`bug_axefade_fr_ux_05_contrast_waits_for_the_preview_fade_in_${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openPanel(page, P.plan, { theme, panel: { depth: 2 } });
    await waitDrawn(page, 19, 4000, GP(page));
    await clickNode(page, P.rozpocet, {}, GP(page));
    const preview = await mustPreview(page, 'Rozpočet 2027', 'Rozpočet previewed');
    await midFade(page);
    assert.deepEqual(await axeContrast(page), [], `${theme}: axeContrast measures the preview once it is opaque`);
    await midFade(page);
    assert.deepEqual(await axeContrastIn(page, preview), [], `${theme}: axeContrastIn measures the preview once it is opaque`);
  });
}
