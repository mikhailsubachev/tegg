// NFR-PERF-05/AC-2 (docs/acceptance/read-view.md, D-148): the read view opens in time. On the reference machine and
// vault, ⏎ on a switcher result → `note-ready` (formatted view painted, links resolved, focus on the title), p95 of 20
// runs < 112 ms (75 % of 150 ms, D-59) for the vault's longest note with 10 embeds and 50 links. Benchmark:
// perf_open_note.ts (docs/contracts/ms3-shell.md §11.5). Runs in the milestone gate's app-e2e step like NFR-PERF-01
// (no extra gating); TEGG_REF_VAULT may point at a pre-generated `--perf-note` vault.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, generateVault, longestNote, oneRun, p95 } from './perf_open_note.ts';

const RUNS = 20;
const LIMIT_MS = 150 * 0.75; // D-59: 112.5, the AC states "under 112 ms"

test('nfr_perf_05_ac2_switcher_enter_to_note_ready_p95_under_112ms', { timeout: 30 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-05-'));
  try {
    const vault = process.env.TEGG_REF_VAULT ?? generateVault(join(tmp, 'vault'));
    assert.ok(vault, 'reference vault with --perf-note could not be generated (tools/gen-vault --perf-note, §11.5)');
    const target = longestNote(vault!);
    const embeds = (target.text.match(/!\[\[[^\]]+\]\]/g) ?? []).length;
    const links = (target.text.match(/(?<!!)\[\[[^\]]+\]\]/g) ?? []).length;
    assert.ok(embeds >= 10 && links >= 50, `the longest note has ${embeds} embeds and ${links} links (want ≥ 10 and ≥ 50)`);
    const base = { TEGG_TEST: '1', TEGG_APP_SUPPORT: join(tmp, 'support'), TEGG_VAULT: vault! };

    const warm = await oneRun(base, join(tmp, 'warm.jsonl'), target.title, 240_000); // index built once
    assert.ok(warm.some((m) => m.mark === 'note-ready'), 'warm-up reached note-ready');
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const marks = await oneRun(base, join(tmp, `run-${i}.jsonl`), target.title);
      const enter = marks.filter((m) => m.mark === 'switcher-enter');
      const ready = marks.filter((m) => m.mark === 'note-ready');
      assert.equal(enter.length, 1, `run ${i}: one switcher-enter mark`);
      assert.equal(ready.length, 1, `run ${i}: one note-ready mark`);
      const dt = ready[0].ms - enter[0].ms;
      assert.ok(Number.isFinite(dt) && dt >= 0, `run ${i}: note-ready after switcher-enter (${dt})`);
      times.push(dt);
    }
    const p = p95(times);
    console.log(`NFR-PERF-05 AC-2: p95 ${p.toFixed(1)} ms over ${RUNS} runs (limit ${LIMIT_MS} ms)`);
    assert.ok(p < 112, `p95 ${p.toFixed(1)} ms ≥ 112 ms`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
