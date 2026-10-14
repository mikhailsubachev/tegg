// NFR-PERF-06 AC-4 (L5 benchmark, every push): typing latency in the editor on WebKit at 60 Hz with the 5,000-word note
// (D-66 frame counting, D-190 60 Hz gate). docs/acceptance/editor.md; docs/contracts/ms3-shell.md §13.4. The probe is
// switched on with the test flag `window.__TEGG_TEST__.latencyProbe` (see the test author's AP list: the contract names
// TEGG_PERF_LOG for the app but no L5 switch).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { must, start } from './helpers';
import { editorBody, editorVault, caretIn } from './editor-helpers';
import { perfNote, pct, typingRun } from './perf_typing';

test('nfr_perf_06_ac4_webkit_typing_latency_benchmark', async ({ page }) => {
  test.setTimeout(120_000);
  const v = editorVault();
  const path = 'Pages/Dlouhá poznámka.md';
  v.files[path] = perfNote();
  await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), latencyProbe: true }; });
  const core = await start(page, { vault: v, last: { path, id: '01JB0P0000000000000000P001' } });
  await must(editorBody(page), 'editor on the 5,000-word note', 10_000);
  await caretIn(page, 50);
  const marks = await typingRun(page, core);
  assert.equal(marks.length, 200, `the probe recorded every keystroke (got ${marks.length})`);
  const f1 = marks.filter((m) => m.frame === 1).length / marks.length;
  const ms = marks.map((m) => m.ms);
  console.log(`NFR-PERF-06 AC-4: frame 1 ${(f1 * 100).toFixed(1)} %, p50 ${pct(ms, 50)} ms, p95 ${pct(ms, 95)} ms, max ${Math.max(...ms)} ms`);
  assert.ok(f1 >= 0.95, `≥ 95 % painted in frame 1 (got ${(f1 * 100).toFixed(1)} %)`);
  assert.ok(marks.every((m) => m.frame <= 2), 'none after frame 2');
});
