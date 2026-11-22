// Slice Q2-T benchmark (L6, Appium mac2 on the built release test app; app-perf, nightly, outside the push run):
// docs/acceptance/views.md NFR-PERF-07 AC-5 (D-1774, AP-1548; supersedes tasks.md FR-TSK-04 AC-14): on the reference vault
// (gen-vault `--seed 1 --small-images`, ≈ 750 tasks) plus R202's `Schedule.yml` and `Kanban.yml` and the `views:` line,
// selecting `Schedule` and `Kanban` each paints within 225 ms p95 of 20 runs (`perfMark('board-request')` →
// `perfMark('board-ready')`), and a period drag shows the card in its target lane or day group within 100 ms p95 of the
// drop (`board-card-moved`, before the write completes). The ≤ 150 card elements bound is checked at L5
// (`__TEGG_TEST__.board()`, views_a11y). Report-only until the v1.0 release gate, enforced at it (D-1800:
// `TEGG_PERF_REF=1` with `VERIFY_GATE=release`). Keys go only to Tegg (D-799). Interface docs/contracts/v1-views.md §4.8,
// §30.5. Written from the ACs and the contract only (D-61); synthetic data only (D-62).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FX, REPO, appiumDown, end, marksOf, session, shown, sleep, support, testEnv, waitFor, type Driver } from './helpers/capture.ts';
import { p } from './perf_type_page.ts';

after(appiumDown);
process.on('exit', appiumDown);

const EXE = join(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app/Contents/MacOS/tegg');
const enforce = process.env.TEGG_PERF_REF === '1' && process.env.VERIFY_GATE === 'release';
const RUNS = 20;

/** The reference vault with the two default views (the overlay's bytes) and `views: [Schedule, Kanban]` in task.yml. */
function prepare(base: string): string {
  const out = join(base, 'vault');
  execFileSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'), '--', '--seed', '1', '--small-images', '--out', out], { stdio: 'ignore' });
  mkdirSync(join(out, '.tegg/queries'), { recursive: true });
  mkdirSync(join(out, '.tegg/types'), { recursive: true });
  for (const n of ['Schedule', 'Kanban']) writeFileSync(join(out, `.tegg/queries/${n}.yml`), readFileSync(join(FX, `views-tasks/.tegg/queries/${n}.yml`)));
  const yml = join(out, '.tegg/types/task.yml');
  const text = existsSync(yml) ? readFileSync(yml, 'utf8') : readFileSync(join(FX, 'new-empty/.tegg/types/task.yml'), 'utf8');
  const withViews = /^views:/m.test(text) ? text.replace(/^views:.*$/m, 'views: [Schedule, Kanban]') : text.replace(/^(preview: .*\n)/m, '$1views: [Schedule, Kanban]\n');
  assert.ok(/^views: \[Schedule, Kanban\]$/m.test(withViews), 'setup: task.yml lists Schedule and Kanban');
  writeFileSync(yml, withViews);
  return out;
}
function taskCount(vault: string): number {
  const dir = join(vault, 'Tasks');
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((n) => n.endsWith('.md') && /^type: task$/im.test(readFileSync(join(dir, n), 'utf8'))).length;
}
/** The ms between the last `from` mark and the first `to` mark after it. */
function between(log: string, from: string, to: string): number | null {
  const m = marksOf(log);
  const i = m.map((x) => x.mark).lastIndexOf(from);
  if (i < 0) return null;
  const j = m.findIndex((x, k) => k > i && x.mark === to);
  if (j < 0 || m[i].ms === undefined || m[j].ms === undefined) return null;
  return m[j].ms! - m[i].ms!;
}
async function rectOf(d: Driver, label: string, prefix = false) {
  const q = label.replace(/"/g, '\\"');
  const e = await d.$(`-ios predicate string:label ${prefix ? 'BEGINSWITH' : '=='} "${q}"`);
  return d.getElementRect(e.elementId);
}

test('nfr_perf_07_ac5_tasks_boards', { timeout: 90 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-07-ac5-'));
  try {
    const vault = prepare(base);
    const n = taskCount(vault);
    assert.ok(n >= 500, `the reference vault has ≈ 750 tasks (found ${n})`);
    for (const view of ['Schedule', 'Kanban']) {
      const times: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const log = join(base, `perf-${view}-${i}.jsonl`);
        // `typeViews.lastTab.task: null`: the page opens on `All Tasks`; the run selects the view tab.
        const d = await session(testEnv(support(base, { name: `s-${view}-${i}`, ui: { typeViews: { lastTab: { task: null } } } }), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'type/task' }));
        try {
          assert.ok(await waitFor(() => marksOf(log).some((m) => m.mark === 'route-ready:type/task'), 60_000), `${view} run ${i}: route-ready:type/task`);
          const t = await d.$(`-ios predicate string:label == "${view}" AND elementType == 59`);
          assert.ok(await t.isDisplayed().catch(() => false), `${view} run ${i}: the tab`);
          await t.click();
          assert.ok(await waitFor(() => marksOf(log).some((m) => m.mark === 'board-ready'), 20_000), `${view} run ${i}: board-ready`);
          const ms = between(log, 'board-request', 'board-ready');
          assert.ok(ms !== null, `${view} run ${i}: board-request → board-ready`);
          times.push(ms!);
          if (i === 0 && view === 'Schedule') assert.ok(await shown(d, 'Expand Done', 3000), 'the Schedule board (its done lane)');
        } finally { await end(d); }
      }
      console.log(`NFR-PERF-07 AC-5: ${view} with ${n} tasks, board-request → board-ready p95 ${p(times, 0.95).toFixed(1)} ms (target 225 ms)`);
      if (enforce) assert.ok(p(times, 0.95) <= 225, `${view}: p95 ${p(times, 0.95).toFixed(1)} ms > 225 ms`);
    }
    // A period drag: the card in its target lane within 100 ms p95 of 20 drops (`board-card-moved`).
    const log = join(base, 'perf-drag.jsonl');
    const d = await session(testEnv(support(base, { name: 's-drag', ui: { typeViews: { lastTab: { task: 'Schedule' } } } }), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'type/task' }));
    const drops: number[] = [];
    try {
      assert.ok(await waitFor(() => marksOf(log).some((m) => m.mark === 'board-ready'), 60_000), 'the Schedule board is ready');
      for (let i = 0; i < RUNS; i++) {
        // Each drop moves the first card of `Not scheduled` onto `Later`, or back while Later has the moved ones.
        const fromLane = i % 2 === 0 ? 'Not scheduled, ' : 'Later, ';
        const toLane = i % 2 === 0 ? 'Later, ' : 'Not scheduled, ';
        const lane = await rectOf(d, fromLane, true);
        let from: { x: number; y: number; width: number; height: number } | null = null;
        for (const c of await d.$$(`-ios predicate string:label BEGINSWITH "Task: "`)) {
          const r = await d.getElementRect(c.elementId).catch(() => null);
          if (r && r.y > lane.y && r.y < lane.y + lane.height && r.x >= lane.x && r.x < lane.x + lane.width) { from = r; break; }
        }
        assert.ok(from, `drop ${i}: a card in ${fromLane}`);
        const to = await rectOf(d, toLane, true);
        const before = marksOf(log).filter((m) => m.mark === 'board-card-moved').length;
        await d.execute('macos: clickAndDrag', { startX: Math.round(from!.x + from!.width / 2), startY: Math.round(from!.y + 12), endX: Math.round(to.x + to.width / 2), endY: Math.round(to.y + 30), duration: 0.6 });
        assert.ok(await waitFor(() => marksOf(log).filter((m) => m.mark === 'board-card-moved').length > before, 5000), `drop ${i}: board-card-moved`);
        const ms = marksOf(log).filter((m) => m.mark === 'board-card-moved').at(-1)?.ms ?? null;
        assert.ok(ms !== null, `drop ${i}: a time`);
        drops.push(ms!);
        await sleep(300);
      }
    } finally { await end(d); }
    console.log(`NFR-PERF-07 AC-5: period drop → card in its lane p95 ${p(drops, 0.95).toFixed(1)} ms (target 100 ms)`);
    if (enforce) assert.ok(p(drops, 0.95) <= 100, `p95 ${p(drops, 0.95).toFixed(1)} ms > 100 ms`);
    else console.log('NFR-PERF-07 AC-5: report-only until the v1.0 release gate (D-1800)');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
