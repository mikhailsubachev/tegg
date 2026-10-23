// FR-TAG-06 AC-11 ([MS8] report-only, docs/acceptance/tags.md; NFR-PERF-07): on the reference vault, `tag/<key>` of a
// tag on 1,000 objects paints its first rows within NFR-PERF-07's budget and keeps at most 100 row elements in the DOM
// (virtualized). Benchmark: perf_tag_page.ts, 20 cold opens on the release test build. Runs in the `app-perf` step
// (D-152): the time is reported without a target until MS8 and enforced only with TEGG_PERF_REF=1 at the MS8
// milestone or a release; the row bound always holds. Interface docs/contracts/ms4-tags.md §6.1. Written from the AC
// and the contract only (D-61).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, generateVault, oneRun, p95, tagNotes } from './perf_tag_page.ts';

const enforce = process.env.TEGG_PERF_REF === '1' && (process.env.VERIFY_MILESTONE === 'MS8' || process.env.VERIFY_GATE === 'release');
/** NFR-PERF-07's budget (a type page / query of 1,000 rows paints in 300 ms) at 75 % on the reference machine (D-59). */
const PAINT_MS = 225;

test('fr_tag_06_ac11_tag_page_of_1000_objects_is_fast_and_virtualized', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-fr-tag-06-ac11-'));
  try {
    const vault = generateVault(join(tmp, 'ref'));
    assert.ok(vault, 'the reference vault (tools/gen-vault --seed 1 --small-images)');
    assert.equal(tagNotes(vault!, 1000).length, 1000, 'setup: a tag on 1,000 objects');
    const env = { TEGG_TEST: '1', TEGG_APP_SUPPORT: join(tmp, 'support'), TEGG_VAULT: vault! };
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await oneRun(env, join(tmp, `run-${i}.jsonl`));
      assert.ok(r.ms !== null, `run ${i}: route-ready:tag/<key>`);
      assert.ok(r.rows !== null && r.rows <= 100, `run ${i}: at most 100 row elements in the DOM (virtualized): ${r.rows}`);
      times.push(r.ms!);
    }
    console.log(`FR-TAG-06 AC-11: tag page of 1,000 objects, first rows p95 ${p95(times).toFixed(1)} ms`);
    if (enforce) assert.ok(p95(times) < PAINT_MS, `p95 ${p95(times).toFixed(1)} ms ≥ ${PAINT_MS} ms`);
    else console.log('FR-TAG-06 AC-11: reported only until MS8 (D-152)');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
