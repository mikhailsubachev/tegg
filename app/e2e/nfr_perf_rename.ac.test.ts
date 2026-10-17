// FR-UX-07 AC-11 (docs/acceptance/rename.md, D-397): on the generated vault, renaming a note with 500 backlinks: the
// time to `done` is reported (report only, D-152; no target until the owner sets one at the MS4 gate). Benchmark:
// perf_rename.ts (time from ↩ in the title until every linking file holds the new link and the hub is renamed).
// Runs in the `app-perf` step with the other benchmarks. Written from the AC and the contract only (D-61).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, oneRun, p95, prepareHubVault } from './perf_rename.ts';

const RUNS = 5;

test('fr_ux_07_ac11_rename_with_500_backlinks_time_to_done_reported', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-fr-ux-07-ac11-'));
  try {
    const vault = prepareHubVault(tmp);
    assert.ok(vault, 'reference vault could not be generated (tools/gen-vault --seed 1 --small-images)');
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t = await oneRun(vault!, tmp, i);
      assert.ok(t !== null, `run ${i}: the rename reached done (every link rewritten, the hub renamed) within 120 s`);
      times.push(t!);
    }
    console.log(`FR-UX-07 AC-11: rename with 500 backlinks, time to done p95 ${p95(times)} ms (${RUNS} runs: ${times.join(', ')} ms); reported only (D-152, D-397)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
