// NFR-PERF-11 AC-1 (docs/acceptance/graph.md; D-912, D-986, D-59, as D-940): on the reference machine and vault, from
// the request (a depth click, `perfMark('graph-request')`) to `graph-ready` (nodes and edges painted with the layout at
// rest), depth 2 around the reference vault's object with the most links (cap 150 applied): p95 of 20 runs under 225 ms
// (75 % of 300 ms). Report-only before the v1.0 release gate, enforced at it (TEGG_PERF_REF=1 with VERIFY_GATE=release).
// `Show all` is outside the target and only reported. Benchmark: perf_graph.ts. Runs in the `app-perf` step, outside
// the push run (D-382). Interface docs/contracts/v1-graph.md §6. Written from the AC and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, generateVault, lastRequestToReady, mostLinked, p95, readMarks } from './perf_graph.ts';
import { appiumDown, end, need, needInGroup, session, sleep, support, testEnv, waitFor } from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const enforce = process.env.TEGG_PERF_REF === '1' && process.env.VERIFY_GATE === 'release';
const TARGET_MS = 225;

test('nfr_perf_11_ac1_depth_two_under_225_ms', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-11-'));
  let d: Awaited<ReturnType<typeof session>> | undefined;
  try {
    const vault = generateVault(join(tmp, 'ref'));
    assert.ok(vault, 'the reference vault (tools/gen-vault --seed 1 --small-images)');
    const centre = mostLinked(vault!);
    const log = join(tmp, 'perf.jsonl');
    const route = `graph/${centre}`;
    d = await session(testEnv(support(tmp), log, { TEGG_VAULT: vault!, TEGG_ROUTE: route }));
    assert.ok(await waitFor(() => readMarks(log).some((m) => m.mark === `route-ready:${route}`), 60_000), `${route} shown`);
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      await (await needInGroup(d, 'Depth', '1')).click();
      assert.ok(await waitFor(() => lastRequestToReady(log) !== null, 10_000), `run ${i}: depth 1 painted`);
      const from = readMarks(log).length;
      await (await needInGroup(d, 'Depth', '2')).click();
      assert.ok(await waitFor(() => lastRequestToReady(log, from) !== null, 10_000), `run ${i}: graph-request → graph-ready at depth 2`);
      times.push(lastRequestToReady(log, from)!);
    }
    console.log(`NFR-PERF-11 AC-1: depth 2 around ${centre}, graph-request → graph-ready p95 ${p95(times).toFixed(1)} ms of 20 runs (${times.map((t) => t.toFixed(0)).join(', ')} ms)`);
    const show = await need(d, 'Show all', 1000).catch(() => null);
    if (show) {
      const from = readMarks(log).length;
      await show.click();
      if (await waitFor(() => lastRequestToReady(log, from) !== null, 20_000)) console.log(`NFR-PERF-11 AC-1: Show all (outside the target) ${lastRequestToReady(log, from)!.toFixed(0)} ms`);
    }
    if (enforce) assert.ok(p95(times) < TARGET_MS, `p95 ${p95(times).toFixed(1)} ms ≥ ${TARGET_MS} ms`);
    else console.log('NFR-PERF-11 AC-1: reported only until the v1.0 release gate (D-940, D-986)');
    await sleep(100);
  } finally {
    await end(d);
    rmSync(tmp, { recursive: true, force: true });
  }
});
