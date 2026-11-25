// FR-MMP-02 AC-53 (L6 benchmark, report-only until MS8, D-152; docs/acceptance/mindmap.md part three, D-777): on the
// built test app with TEGG_PERF_LOG, the runtime `Pages/Velká mapa.md` (500 nodes: root, 10 branches × 7 children × 6
// leaves, the last child of the last branch with 5): folding and unfolding the root and the first-level branch
// `Větev 1` by Space each writes the perf mark `mindmap-layout` (docs/contracts/mm-mindmap.md §4, §7.5), p95 of 20 ≤
// 16.7 ms; a drag across 50 nodes writes `mindmap-drag` per painted indicator move, ≥ 95 % within the next frame. The
// targets are enforced only with TEGG_PERF_REF=1 at the MS8 milestone or a release. A temporary copy of the synthetic
// mindmap fixture and a temporary Application Support (D-62). Written from the AC and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FX, MARK_TIMEOUT, appiumDown, end, marksOf, need, press, ready, session, sleep, support, testEnv, tmp, waitMark, type Driver } from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const enforce = process.env.TEGG_PERF_REF === '1' && (process.env.VERIFY_MILESTONE === 'MS8' || process.env.VERIFY_GATE === 'release');
const FRAME_MS = 16.7;
const VELKA = 'Pages/Velká mapa.md';

function velka(): string {
  const lines = ['> [!mindmap] Velká mapa', '> - Velká mapa'];
  for (let b = 1; b <= 10; b++) {
    lines.push(`>   - Větev ${b}`);
    for (let c = 1; c <= 7; c++) {
      lines.push(`>     - Uzel ${b}.${c}`);
      for (let l = 1; l <= (b === 10 && c === 7 ? 5 : 6); l++) lines.push(`>       - List ${b}.${c}.${l} žluťoučký`);
    }
  }
  return '---\nid: 01JB4M0000000000000000M021\ntype: page\ntitle: Velká mapa\n---\n' + lines.join('\n') + '\n';
}
const p95 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.ceil(0.95 * s.length) - 1]; };

test('fr_mmp_02_ac53_big_map_folds_and_drag_on_the_built_app', { timeout: 30 * 60_000 }, async () => {
  await ready();
  const base = tmp('mm3-ac53');
  const vault = join(base, 'Mapy');
  const src = join(FX, 'mindmap');
  cpSync(src, vault, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(vault, '.tegg'), { recursive: true });
  writeFileSync(join(vault, VELKA), velka());
  let d: Driver | undefined;
  const log = join(base, 'perf.jsonl');
  try {
    d = await session(testEnv(support(base), log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${VELKA}`, TEGG_PERF_LOG: log }));
    assert.ok(await waitMark(log, `route-ready:note/${VELKA}`, MARK_TIMEOUT), 'Velká mapa shown');
    await (await need(d, 'Map of Velká mapa', 10_000)).click(); // a click on the map area focuses the root (D-797)
    const layoutMarks = () => marksOf(log).filter((m) => m.mark === 'mindmap-layout');
    const before = layoutMarks().length;
    for (let run = 0; run < 5; run++) {
      press('space'); await sleep(300); press('space'); await sleep(300); // the root
      press('right'); await sleep(200); // Větev 1
      press('space'); await sleep(300); press('space'); await sleep(300);
      press('left'); await sleep(200);
    }
    const folds = layoutMarks().slice(before).map((m) => Number(m.ms));
    assert.ok(folds.length >= 20, `mindmap-layout after each of the 20 folds and unfolds (got ${folds.length})`);
    console.log(`FR-MMP-02 AC-53: fold/unfold mindmap-layout p95 ${p95(folds).toFixed(2)} ms over ${folds.length} (target ≤ ${FRAME_MS} ms)`);
    const a = await d.getElementRect((await need(d, 'Uzel 1.1', 5000)).elementId);
    const b = await d.getElementRect((await need(d, 'Uzel 2.7', 5000)).elementId);
    await d.execute('macos: clickAndDragAndHold', { startX: a.x + a.width / 2, startY: a.y + a.height / 2, endX: b.x + b.width / 2, endY: b.y + b.height / 2, duration: 0.3, holdDuration: 0.5, velocity: 400 }).catch(() => {});
    press('escape');
    await sleep(800);
    const drags = marksOf(log).filter((m) => m.mark === 'mindmap-drag').map((m) => Number(m.ms));
    assert.ok(drags.length > 0, 'the perf mark mindmap-drag while dragging across the map (mm-mindmap §7.5)');
    const share = drags.filter((x) => x <= FRAME_MS).length / drags.length;
    console.log(`FR-MMP-02 AC-53: ${(100 * share).toFixed(1)} % of ${drags.length} indicator moves within one frame (target ≥ 95 %)`);
    if (enforce) {
      assert.ok(p95(folds) <= FRAME_MS, `fold re-layout p95 ${p95(folds).toFixed(2)} ms > ${FRAME_MS} ms`);
      assert.ok(share >= 0.95, `${(100 * share).toFixed(1)} % < 95 %`);
    } else console.log('FR-MMP-02 AC-53: reported only until MS8 (D-152)');
  } finally {
    await end(d);
    rmSync(base, { recursive: true, force: true });
  }
});
