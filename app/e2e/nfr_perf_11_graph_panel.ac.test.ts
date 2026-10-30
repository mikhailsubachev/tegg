// NFR-PERF-11 AC-3 (docs/acceptance/graph-panel.md; D-912, D-986, D-1043, as D-940): on the reference machine and vault,
// with the right panel on Graph, from `perfMark('graph-request')` (a depth click in the panel's `Depth and filters`
// popover) to `perfMark('graph-ready')`, depth 2 around the reference vault's object with the highest vault-wide degree
// whose depth-2 total is at most 60 (found by the bench from the files, perf_graph.ts `panelCentre`): p95 of 20 runs
// under 225 ms. Report-only before the v1.0 release gate, enforced at it (TEGG_PERF_REF=1 with VERIFY_GATE=release). The
// Too many state for the highest-degree object is reported too. Runs in the `app-perf` step, outside the push run
// (D-382). Interface docs/contracts/v1-graph.md §15.7, §15.8 (`TEGG_ROUTE=note/<path>` with `rightPanel.tab: 'graph'`).
// Written from the AC and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, generateVault, lastRequestToReady, mostLinked, p95, panelCentre, readMarks } from './perf_graph.ts';
import { appiumDown, end, need, needInGroup, session, sleep, support, testEnv, waitFor } from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const enforce = process.env.TEGG_PERF_REF === '1' && process.env.VERIFY_GATE === 'release';
const TARGET_MS = 225;
const panelUi = { rightPanel: { open: true, tab: 'graph' } };

test('nfr_perf_11_ac3_panel_depth_two_under_225_ms', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-11-panel-'));
  let d: Awaited<ReturnType<typeof session>> | undefined;
  try {
    const vault = generateVault(join(tmp, 'ref'));
    assert.ok(vault, 'the reference vault (tools/gen-vault --seed 1 --small-images)');
    const centre = panelCentre(vault!, 60);
    assert.ok(centre, 'an object whose depth-2 total is at most 60');
    const log = join(tmp, 'perf.jsonl');
    const route = `note/${centre!.path}`;
    d = await session(testEnv(support(tmp, { ui: panelUi }), log, { TEGG_VAULT: vault!, TEGG_ROUTE: route }));
    assert.ok(await waitFor(() => readMarks(log).some((m) => m.mark === `route-ready:${route}`), 60_000), `${route} shown`);
    assert.ok(await waitFor(() => readMarks(log).some((m) => m.mark === 'graph-ready'), 20_000), 'the panel drew its first graph (graph-ready)');
    await (await need(d, 'Depth and filters', 5000)).click();
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      await (await needInGroup(d, 'Depth', '1')).click();
      assert.ok(await waitFor(() => lastRequestToReady(log) !== null, 10_000), `run ${i}: depth 1 painted`);
      const from = readMarks(log).length;
      await (await needInGroup(d, 'Depth', '2')).click();
      assert.ok(await waitFor(() => lastRequestToReady(log, from) !== null, 10_000), `run ${i}: graph-request → graph-ready at depth 2 in the panel`);
      times.push(lastRequestToReady(log, from)!);
    }
    console.log(`NFR-PERF-11 AC-3: panel depth 2 around ${centre!.path} (degree ${centre!.degree}, est. total ${centre!.total}), graph-request → graph-ready p95 ${p95(times).toFixed(1)} ms of 20 runs (${times.map((t) => t.toFixed(0)).join(', ')} ms)`);
    await end(d);
    // The Too many state for the highest-degree object (no layout), reported only.
    const top = mostLinked(vault!);
    const log2 = join(tmp, 'perf-top.jsonl');
    const route2 = `note/${top}`;
    d = await session(testEnv(support(tmp, { ui: panelUi, name: 'support-top' }), log2, { TEGG_VAULT: vault!, TEGG_ROUTE: route2 }));
    if (await waitFor(() => readMarks(log2).some((m) => m.mark === `route-ready:${route2}`), 60_000)) {
      await (await need(d, 'Depth and filters', 5000)).click();
      const from = readMarks(log2).length;
      await (await needInGroup(d, 'Depth', '2')).click();
      if (await waitFor(() => lastRequestToReady(log2, from) !== null, 20_000)) console.log(`NFR-PERF-11 AC-3: Too many state around ${top} (outside the target) ${lastRequestToReady(log2, from)!.toFixed(0)} ms`);
      else console.log(`NFR-PERF-11 AC-3: Too many state around ${top}: no graph-ready mark within 20 s`);
    }
    if (enforce) assert.ok(p95(times) < TARGET_MS, `p95 ${p95(times).toFixed(1)} ms ≥ ${TARGET_MS} ms`);
    else console.log('NFR-PERF-11 AC-3: reported only until the v1.0 release gate (D-940, D-986, D-1043)');
    await sleep(100);
  } finally {
    await end(d);
    rmSync(tmp, { recursive: true, force: true });
  }
});
