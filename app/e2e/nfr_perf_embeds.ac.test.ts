// FR-EMB-02 AC-13 ([MS8], docs/acceptance/embeds.md, AP-332 / D-429): embeds don't slow opening. On the reference
// machine and vault, for the read-view benchmark note (gen-vault --perf-note: 5,000 words, 10 embeds), the editor's
// NFR-PERF-05 AC-4 still holds with embeds rendered (`note-ready` − `switcher-enter` p95 < 112 ms), and the mark
// `embeds-painted` (the content of every depth-1 embed painted, docs/contracts/ms4-embeds.md §6) is at most 112 ms after
// `note-ready`, p95 of 20 runs. Benchmark: perf_embeds.ts. Runs in the `app-perf` step with the other benchmarks
// (D-152): in MS4 it reports without a target; the targets are enforced only with TEGG_PERF_REF=1 on the reference
// machine at the MS8 milestone or a release (VERIFY_MILESTONE=MS8 / VERIFY_GATE=release). Every run must still reach
// `embeds-painted` (the mark is part of the 4F contract), so the test is red until the mark exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, PAINTED, generateVault, longestNote, oneRun, p95 } from './perf_embeds.ts';

const RUNS = 20;
const enforce = process.env.TEGG_PERF_REF === '1' && (process.env.VERIFY_MILESTONE === 'MS8' || process.env.VERIFY_GATE === 'release');

test('fr_emb_02_ac13_embeds_painted_within_112ms_of_note_ready', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-fr-emb-02-ac13-'));
  try {
    const vault = process.env.TEGG_REF_VAULT ?? generateVault(join(tmp, 'vault'));
    assert.ok(vault, 'reference vault with --perf-note could not be generated');
    const target = longestNote(vault!);
    const embeds = (target.text.match(/!\[\[[^\]]+\]\]/g) ?? []).length;
    assert.ok(embeds >= 10, `the benchmark note has ${embeds} embeds (want ≥ 10)`);
    const env = { TEGG_TEST: '1', TEGG_APP_SUPPORT: join(tmp, 'support'), TEGG_VAULT: vault! };
    const warm = await oneRun(env, join(tmp, 'warm.jsonl'), target.title, 240_000);
    assert.ok(warm.paint !== null, `warm-up reached ${PAINTED} after note-ready`);
    const open: number[] = [];
    const paint: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await oneRun(env, join(tmp, `run-${i}.jsonl`), target.title);
      assert.ok(r.open !== null && r.open >= 0, `run ${i}: note-ready after switcher-enter`);
      assert.ok(r.paint !== null && r.paint >= 0, `run ${i}: ${PAINTED} after note-ready`);
      open.push(r.open!);
      paint.push(r.paint!);
    }
    const po = p95(open), pp = p95(paint);
    console.log(`FR-EMB-02 AC-13: note-ready p95 ${po.toFixed(1)} ms after switcher-enter; ${PAINTED} p95 ${pp.toFixed(1)} ms after note-ready (${RUNS} runs)`);
    if (enforce) {
      assert.ok(po < 112, `note-ready p95 ${po.toFixed(1)} ms ≥ 112 ms (NFR-PERF-05 AC-4 with embeds)`);
      assert.ok(pp <= 112, `${PAINTED} p95 ${pp.toFixed(1)} ms > 112 ms after note-ready`);
    } else console.log('FR-EMB-02 AC-13: reported only (MS4, D-152; enforced with TEGG_PERF_REF=1 at MS8 or release)');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
