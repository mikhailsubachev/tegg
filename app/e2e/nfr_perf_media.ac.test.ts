// FR-ATT-01 AC-16 ([MS8] report-only, docs/acceptance/trash-media.md; NFR-PERF-05): (a) a note with 20 embedded
// 2-MB images reaches `note-ready` within NFR-PERF-05's budget (images load after the text), (b) pasting a 10-MB image
// shows it (`media-ready`) within 1 s. Benchmark: perf_media.ts, 20 runs of (a) and 10 of (b) on the release test
// build. Runs in the `app-perf` step (D-152): reported without a target until MS8; enforced only with TEGG_PERF_REF=1
// at the MS8 milestone or a release. Every run must still reach the marks (`media-ready:<path>`, ms6-trash-media §7),
// so the test is red until 6A exists. Interface docs/contracts/ms6-trash-media.md §7. Written from the AC and the
// contract only (D-61).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, galleryRun, galleryVault, noisePng, p95, pasteRun } from './perf_media.ts';

const enforce = process.env.TEGG_PERF_REF === '1' && (process.env.VERIFY_MILESTONE === 'MS8' || process.env.VERIFY_GATE === 'release');
/** NFR-PERF-05's open-note budget on the reference machine at 75 % (D-59), as nfr_perf_05.ac.test.ts. */
const NOTE_READY_MS = 112;

test('fr_att_01_ac16_twenty_images_and_a_10mb_paste', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-fr-att-01-ac16-'));
  try {
    const { vault } = galleryVault(tmp);
    const env = { TEGG_TEST: '1', TEGG_APP_SUPPORT: join(tmp, 'support'), TEGG_VAULT: vault };
    const ready: number[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await galleryRun(env, join(tmp, `run-${i}.jsonl`));
      assert.ok(r.ready !== null, `run ${i}: note-ready`);
      assert.ok(r.firstImage !== null && r.firstImage >= 0, `run ${i}: images load after the text (media-ready after note-ready)`);
      ready.push(r.ready!);
    }
    const png = join(tmp, 'velký.png');
    writeFileSync(png, noisePng(10 * 1024 * 1024, 99));
    const paste: number[] = [];
    for (let i = 0; i < 10; i++) {
      const ms = await pasteRun(env, join(tmp, `paste-${i}.jsonl`), png);
      assert.ok(ms !== null, `paste ${i}: the pasted image shows (media-ready)`);
      paste.push(ms!);
    }
    console.log(`FR-ATT-01 AC-16: note-ready p95 ${p95(ready).toFixed(1)} ms with 20 × 2-MB images; 10-MB paste shown p95 ${p95(paste).toFixed(1)} ms`);
    if (enforce) {
      assert.ok(p95(ready) < NOTE_READY_MS, `note-ready p95 ${p95(ready).toFixed(1)} ms ≥ ${NOTE_READY_MS} ms`);
      assert.ok(p95(paste) <= 1000, `paste p95 ${p95(paste).toFixed(1)} ms > 1 s`);
    } else console.log('FR-ATT-01 AC-16: reported only until MS8 (D-152)');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
