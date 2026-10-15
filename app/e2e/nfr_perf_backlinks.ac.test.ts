// FR-LNK-01 AC-16 ([MS8], docs/acceptance/backlinks.md, D-285): large backlink sets. On the reference machine and vault,
// for the note with the most backlinks and a test-added note linked from 1,000 notes, the panel's first group paints
// within 112 ms of `note-ready` (75 % of 150 ms, D-59), p95 of 20 runs, and opening the note isn't delayed. Benchmark:
// perf_backlinks.ts (mark `backlinks-painted:<path>`, docs/contracts/ms4-links.md §5.4). Runs in the `app-perf` step
// with the other benchmarks (D-152): in MS4 it reports without a target; the 112 ms target is enforced only with
// TEGG_PERF_REF=1 on the reference machine at the MS8 milestone or a release (VERIFY_MILESTONE=MS8 / VERIFY_GATE=release).
// The "at most 100 entry elements in the DOM" part is L5 (app/webkit/backlinks.ac.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, HUB, mostLinked, oneRun, p95, prepareVault } from './perf_backlinks.ts';

const RUNS = 20;
const enforce = process.env.TEGG_PERF_REF === '1' && (process.env.VERIFY_MILESTONE === 'MS8' || process.env.VERIFY_GATE === 'release');

test('fr_lnk_01_ac16_first_group_paints_within_112ms_of_note_ready', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-fr-lnk-01-ac16-'));
  try {
    const vault = prepareVault(tmp);
    assert.ok(vault, 'reference vault could not be generated (tools/gen-vault --seed 1 --small-images)');
    for (const path of [mostLinked(vault!), HUB]) {
      const warm = await oneRun(vault!, join(tmp, 'support-warm'), join(tmp, `warm-${path.length}.jsonl`), path, 240_000);
      assert.ok(warm.paint !== null, `${path}: warm-up reached backlinks-painted:${path} after note-ready`);
      const paint: number[] = [];
      const open: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const r = await oneRun(vault!, join(tmp, `support-${i}`), join(tmp, `run-${path.length}-${i}.jsonl`), path);
        assert.ok(r.paint !== null && r.paint >= 0, `${path} run ${i}: backlinks-painted after note-ready`);
        paint.push(r.paint!);
        if (r.open !== null) open.push(r.open);
      }
      const p = p95(paint);
      console.log(`FR-LNK-01 AC-16 ${path}: first group p95 ${p.toFixed(1)} ms after note-ready; note-ready − ui-ready p95 ${open.length ? p95(open).toFixed(1) : 'n/a'} ms (${RUNS} runs)`);
      if (enforce) assert.ok(p < 112, `${path}: p95 ${p.toFixed(1)} ms ≥ 112 ms`);
      else console.log('FR-LNK-01 AC-16: reported only (MS4, D-152; enforced with TEGG_PERF_REF=1 at MS8 or release)');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
