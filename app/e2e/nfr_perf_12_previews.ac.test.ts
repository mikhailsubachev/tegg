// NFR-PERF-12 / FR-LNK-11 AC-1 (docs/acceptance/previews.md, AP-822 / D-940; docs/contracts/v1-previews.md §8): on the
// reference machine and vault, from the click (pointer-up, mark `preview-click`) on a link chip to the 5,000-word
// benchmark note, to the mark `preview-ready` (header, strip and the first screen of the body painted), p95 of 20 runs
// is under 75 ms (75 % of 100 ms, D-59). Benchmark: perf_previews.ts. Runs in the `app-perf` step with the other
// benchmarks (outside the push run); report-only until the v1.0 release gate (D-152 rule), enforced there with
// TEGG_PERF_REF=1 on the reference machine (VERIFY_GATE=release). Every run must still reach both marks (they are part
// of the slice P contract), so the test is red until they exist. Written from the AC and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLICK, EXE, READY, generateVault, longestNote, oneRun, p95, removeHost, startOnHost, writeHost } from './perf_previews.ts';
import { appiumDown, end, type Driver } from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const RUNS = 20;
const TARGET_MS = 75;
const enforce = process.env.TEGG_PERF_REF === '1' && process.env.VERIFY_GATE === 'release';

test('fr_lnk_11_ac1_preview_ready_within_75_ms_of_pointer_up_p95_on_the_reference_vault', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-12-'));
  const vault = process.env.TEGG_REF_VAULT ?? generateVault(join(tmp, 'vault'));
  let d: Driver | undefined;
  try {
    assert.ok(vault, 'reference vault with --perf-note could not be generated');
    const target = longestNote(vault!);
    const words = target.text.replace(/^---\n[\s\S]*?\n---\n/, '').split(/\s+/).filter(Boolean).length;
    assert.ok(words >= 5000, `the benchmark note has ${words} words (want ≥ 5,000)`);
    writeHost(vault!, target.path);
    const s = await startOnHost(vault!, tmp);
    assert.ok(s, 'the host note with the chip "Benchmark cíl" opened');
    d = s!.d;
    const warm = await oneRun(d, s!.log, 30_000);
    assert.ok(warm !== null, `warm-up reached ${READY} after ${CLICK}`);
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t = await oneRun(d, s!.log);
      assert.ok(t !== null && t >= 0, `run ${i}: ${READY} after ${CLICK}`);
      times.push(t!);
    }
    const p = p95(times);
    console.log(`NFR-PERF-12 / FR-LNK-11 AC-1: ${READY} p95 ${p.toFixed(1)} ms after ${CLICK} (${RUNS} runs; target < ${TARGET_MS} ms)`);
    if (enforce) assert.ok(p < TARGET_MS, `${READY} p95 ${p.toFixed(1)} ms ≥ ${TARGET_MS} ms`);
    else console.log('NFR-PERF-12: reported only (D-152 rule; enforced with TEGG_PERF_REF=1 at the v1.0 release gate)');
  } finally {
    await end(d);
    if (vault && process.env.TEGG_REF_VAULT) removeHost(vault);
    rmSync(tmp, { recursive: true, force: true });
  }
});
