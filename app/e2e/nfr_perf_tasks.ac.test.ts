// FR-TSK-04 AC-14 ([MS8], docs/acceptance/tasks.md, D-488): `route-ready:tasks` and `route-ready:tasks/kanban` (both
// groupings) on the reference vault with ≈ 750 tasks: p95 of 20 launches, measured from `ui-ready` (perf_tasks.ts).
// Runs in the `app-perf` step with the other benchmarks (D-152, D-343): in MS5 it reports without a target; the target,
// 225 ms (75 % of NFR-PERF-07's 300 ms, D-59), is enforced only with TEGG_PERF_REF=1 at the MS8 milestone or a release
// (VERIFY_MILESTONE=MS8 / VERIFY_GATE=release), as nfr_perf_daily.ac.test.ts does. Written from the AC and the
// contract only (D-61).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, VIEWS, oneRun, p, prepareVault, taskCount } from './perf_tasks.ts';

const RUNS = 20;
const enforce = process.env.TEGG_PERF_REF === '1' && (process.env.VERIFY_MILESTONE === 'MS8' || process.env.VERIFY_GATE === 'release');

test('fr_tsk_04_ac14_tasks_views_ready_on_the_reference_vault', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-fr-tsk-04-ac14-'));
  try {
    const vault = prepareVault(tmp);
    assert.ok(vault, 'reference vault could not be generated (tools/gen-vault --seed 1 --small-images)');
    const n = taskCount(vault!);
    assert.ok(n >= 500, `the reference vault has ≈ 750 tasks (found ${n})`);
    for (const view of VIEWS) {
      const support = join(tmp, `support-${view.name}`);
      const warm = await oneRun(vault!, support, join(tmp, `warm-${view.name}.jsonl`), view, 240_000);
      assert.ok(warm !== null, `warm-up: route-ready:${view.route} (${view.name})`);
      const samples: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const ms = await oneRun(vault!, support, join(tmp, `run-${view.name}-${i}.jsonl`), view);
        assert.ok(ms !== null && ms >= 0, `run ${i}: route-ready:${view.route} after ui-ready (${view.name})`);
        samples.push(ms!);
      }
      const p95 = p(samples, 0.95);
      console.log(`FR-TSK-04 AC-14 ${view.route} (${view.name}) with ${n} tasks: p95 ${p95.toFixed(1)} ms (${RUNS} runs)`);
      if (enforce) assert.ok(p95 < 225, `${view.name}: p95 ${p95.toFixed(1)} ms ≥ 225 ms (75 % of 300 ms, D-59)`);
    }
    if (!enforce) console.log('FR-TSK-04 AC-14: reported only (MS5, D-152, D-488; enforced with TEGG_PERF_REF=1 at MS8 or release)');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
