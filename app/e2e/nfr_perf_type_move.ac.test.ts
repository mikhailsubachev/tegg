// FR-UX-07 AC-12 (docs/acceptance/type-moves.md "Both parts"): on the reference vault, moving 500 objects with 500
// linking notes (the folder save Knihy → Četba of the type Kniha): the time to done is recorded (no target). Benchmark:
// perf_type_move.ts (time from ↩ in `Folder in the vault` until all 500 objects are in Četba/ and every linking note
// holds the new path). Runs in the `app-perf` step with the other benchmarks. Written from the AC and the contract
// only (D-61).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, oneRun, p95, prepareTypeVault } from './perf_type_move.ts';

const RUNS = 5;

test('fr_ux_07_ac12_moving_500_objects_with_500_linking_notes_is_recorded', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-fr-ux-07-ac12-'));
  try {
    const vault = prepareTypeVault(tmp);
    assert.ok(vault, 'reference vault could not be generated (tools/gen-vault --seed 1 --small-images)');
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t = await oneRun(vault!, tmp, i);
      assert.ok(t !== null, `run ${i}: the move reached done (500 objects in Četba/, 500 links rewritten) within 180 s`);
      times.push(t!);
    }
    console.log(`FR-UX-07 AC-12: moving 500 objects with 500 linking notes, time to done p95 ${p95(times)} ms (${RUNS} runs: ${times.join(', ')} ms); recorded, no target`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
