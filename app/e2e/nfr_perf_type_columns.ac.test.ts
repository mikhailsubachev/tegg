// FR-TYP-09 AC-33 ([MS8], docs/acceptance/type-columns.md; NFR-PERF-07, AP-1148 → D-1250): on the reference vault, with a
// runtime `columns: [tags, source, aliases, review, created, modified]` on quick-note.yml, `type/quick-note` with 1,000
// objects paints its first rows in under 225 ms, p95 of 20 runs (FR-TYP-09 AC-12's target). Benchmark: perf_type_page.ts
// (gen-vault `--seed 1 --small-images`, Quick Notes topped up to 1,000; 20 launches of the release test build with
// TEGG_EXIT_AFTER=route-ready:type/quick-note, `route-ready − ui-ready`). Runs in the `app-perf` step: like FR-TYP-09
// AC-12 and the other [MS8] benchmarks (D-152) the time is reported until MS8 and enforced only with TEGG_PERF_REF=1 at
// the MS8 milestone or a release. One Appium launch first checks that the 7 columns are drawn (Title + the six), so the
// benchmark measures the many-column page. The DOM counts of AC-33 are L5 (app/webkit/type_columns.ac.test.ts).
// Written from the AC and the contracts only (D-61); synthetic data only (D-62).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FX, appiumDown, end, marks, session, shown, support, testEnv, waitFor } from './helpers/capture.ts';
import { oneRun, p, prepareVault } from './perf_type_page.ts';

after(appiumDown);
process.on('exit', appiumDown);

const EXE = join(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app/Contents/MacOS/tegg');
const enforce = process.env.TEGG_PERF_REF === '1' && (process.env.VERIFY_MILESTONE === 'MS8' || process.env.VERIFY_GATE === 'release');
const PAINT_MS = 225;
const COLUMNS = 'columns: [tags, source, aliases, review, created, modified]\n';

/** quick-note.yml of the vault (or new-empty's built-in file) with the runtime columns line after `preview:`. */
function withColumns(vault: string) {
  const f = join(vault, '.tegg/types/quick-note.yml');
  const text = existsSync(f) ? readFileSync(f, 'utf8') : readFileSync(join(FX, 'new-empty/.tegg/types/quick-note.yml'), 'utf8');
  const m = /^preview:.*\n/m.exec(text);
  assert.ok(m, 'setup: quick-note.yml has a preview line');
  mkdirSync(join(vault, '.tegg/types'), { recursive: true });
  writeFileSync(f, text.replace(m![0], `${m![0]}${COLUMNS}`));
}

test('fr_typ_09_ac33_many_columns_stay_fast_on_1000_quick_notes', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-fr-typ-09-ac33-'));
  try {
    const vault = prepareVault(base);
    withColumns(vault);
    const route = 'type/quick-note';
    const log = join(base, 'check.jsonl');
    const d = await session(testEnv(support(base, { name: 'check' }), log, { TEGG_VAULT: vault, TEGG_ROUTE: route }));
    try {
      assert.ok(await waitFor(() => marks(log).includes(`route-ready:${route}`), 60_000), 'route-ready:type/quick-note');
      for (const h of ['Title', 'Tags', 'Source', 'Aliases', 'Review', 'Created', 'Modified']) assert.ok(await shown(d, h, 5000), `the column ${h} is drawn (7 columns)`);
    } finally { await end(d); }
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const ms = await oneRun(vault, join(base, `support-${i}`), join(base, `perf-${i}.jsonl`));
      assert.ok(ms !== null, `run ${i}: route-ready:type/quick-note`);
      times.push(ms!);
    }
    console.log(`FR-TYP-09 AC-33: type/quick-note with 7 columns, first rows p95 ${p(times, 0.95).toFixed(1)} ms`);
    if (enforce) assert.ok(p(times, 0.95) < PAINT_MS, `p95 ${p(times, 0.95).toFixed(1)} ms ≥ ${PAINT_MS} ms`);
    else console.log('FR-TYP-09 AC-33: reported only until MS8 (D-152)');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
