// Owner report on preview v0.120 (2026-11-09): the page tab sat too high in the title bar. The tab strip shared the
// class `tabs` with the page-level segmented tabs (Tasks), whose rule added a 12 px bottom margin and a grey
// background to it. The tab strip is centred in the 44 px title bar like the buttons beside it, with no background of
// its own (FR-UX-01, board Main).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { start } from './helpers';

test('bug_v0120_fr_ux_01_title_bar_tab_is_centred', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const rect = (e: Element) => { const b = e.getBoundingClientRect(); return { top: b.top, mid: b.top + b.height / 2, h: b.height } };
    const tab = document.querySelector('[role="tab"][data-command="tab.current"]')!;
    const strip = tab.closest('[role="tablist"]')!;
    const bar = strip.closest('header')!;
    const back = bar.querySelector('[data-command="nav.back"]')!;
    return { tab: rect(tab), bar: rect(bar), back: rect(back), stripBg: getComputedStyle(strip).backgroundColor, stripMargin: getComputedStyle(strip).marginBottom };
  });
  assert.ok(Math.abs(r.tab.mid - r.bar.mid) <= 1, `the tab is centred in the title bar: tab middle ${r.tab.mid}, bar middle ${r.bar.mid}`);
  assert.ok(Math.abs(r.tab.mid - r.back.mid) <= 1, `the tab lines up with the Back button: ${r.tab.mid} vs ${r.back.mid}`);
  assert.equal(r.stripMargin, '0px', 'the tab strip has no bottom margin');
  assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(r.stripBg), `the tab strip has no background: ${r.stripBg}`);
});
