// FR-MMP-02 AC-30 (L6 benchmark, report-only until MS8, D-152; docs/acceptance/mindmap.md part two, D-683, D-777): on
// the release test build, opening the runtime `Pages/Velká mapa.md` in the `spider` layout (`> [!mindmap|spider]`,
// 500 nodes: root, 10 branches × 7 children × 6 leaves, the last child of the last branch with 5) writes the perf mark
// `mindmap-layout` with the layout time, measuring included (docs/contracts/mm-mindmap.md §4, §6.4, TEGG_PERF_LOG);
// its p95 over 20 cold opens is ≤ 16.7 ms (one 60 Hz frame) and is enforced only with TEGG_PERF_REF=1 at the MS8
// milestone or a release; `note-ready` is reported (NFR-PERF-05 AC-4). A temporary copy of the synthetic mindmap
// fixture, a temporary Application Support (D-62). Written from the AC and the contract only (D-61).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { EXE, launch, p95, readMarks, waitMark } from './perf_tag_page.ts';
import { FX } from './helpers/capture.ts';

const enforce = process.env.TEGG_PERF_REF === '1' && (process.env.VERIFY_MILESTONE === 'MS8' || process.env.VERIFY_GATE === 'release');
const FRAME_MS = 16.7;
const ROUTE = 'note/Pages/Velká mapa.md';

function velkaSpider(): string {
  const lines = ['> [!mindmap|spider] Velká mapa', '> - Velká mapa'];
  for (let b = 1; b <= 10; b++) {
    lines.push(`>   - Větev ${b}`);
    for (let c = 1; c <= 7; c++) {
      lines.push(`>     - Uzel ${b}.${c}`);
      for (let l = 1; l <= (b === 10 && c === 7 ? 5 : 6); l++) lines.push(`>       - List ${b}.${c}.${l} žluťoučký`);
    }
  }
  return '---\nid: 01JB4M0000000000000000M021\ntype: page\ntitle: Velká mapa\n---\n' + lines.join('\n') + '\n';
}

test('fr_mmp_02_ac30_500_node_spider_map_layout_on_the_built_app', { timeout: 30 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-fr-mmp-02-ac30-'));
  try {
    const vault = join(tmp, 'Mapy');
    const src = join(FX, 'mindmap');
    cpSync(src, vault, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
    cpSync(join(FX, 'new-empty/.tegg'), join(vault, '.tegg'), { recursive: true });
    writeFileSync(join(vault, 'Pages/Velká mapa.md'), velkaSpider());
    const layout: number[] = [];
    const ready: number[] = [];
    for (let i = 0; i < 20; i++) {
      const log = join(tmp, `run-${i}.jsonl`);
      const child = launch({ TEGG_TEST: '1', TEGG_APP_SUPPORT: join(tmp, `support-${i}`), TEGG_VAULT: vault, TEGG_ROUTE: ROUTE, TEGG_PERF_LOG: log, TEGG_EXIT_AFTER: 'mindmap-layout' });
      const m = await waitMark(log, (x) => x === 'mindmap-layout', 60_000);
      if (child.exitCode === null) child.kill('SIGTERM');
      assert.ok(m && typeof m.ms === 'number', `run ${i}: the mark mindmap-layout with its time (mm-mindmap §4)`);
      layout.push(m!.ms!);
      const nr = existsSync(log) ? (readMarks(log) as { mark: string; ms?: number }[]).find((x) => x.mark === 'note-ready') : undefined;
      if (nr?.ms !== undefined) ready.push(nr.ms);
    }
    console.log(`FR-MMP-02 AC-30: spider mindmap-layout p95 ${p95(layout).toFixed(2)} ms over 20 runs (target ≤ ${FRAME_MS} ms); note-ready p95 ${ready.length ? p95(ready).toFixed(1) : 'n/a'} ms`);
    if (enforce) assert.ok(p95(layout) <= FRAME_MS, `p95 ${p95(layout).toFixed(2)} ms > ${FRAME_MS} ms`);
    else console.log('FR-MMP-02 AC-30: reported only until MS8 (D-152)');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
