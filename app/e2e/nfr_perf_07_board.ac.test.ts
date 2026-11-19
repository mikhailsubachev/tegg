// Slice Q2 benchmarks (L6, Appium mac2 on the built release test app; app-perf, outside the push run): docs/acceptance/
// views.md NFR-PERF-07 AC-3 (500 cards in 6 lanes paint within 225 ms p95 of 20 runs, `perfMark('board-request')` →
// `perfMark('board-ready')`, D-1774, AP-1516) and AC-4 (a dropped card is in its target lane's DOM within 100 ms p95 of 20
// drops, `board-card-moved` after the drop, before the write settles). The vault: the 5,000-note reference vault
// (gen-vault `--seed 1 --small-images`) plus a runtime type `karta` (`fáze` Select with 5 options) with 500 objects
// (100, 100, 100, 100, 50 per option, 50 without a value: 6 lanes) and the view `Karty` (`view: board`, `group_by: fáze`,
// `columns: [tags]`) as the only tab of `type/karta`. Report-only before the v1.0 release gate, enforced at it (as D-940:
// `TEGG_PERF_REF=1` with `VERIFY_GATE=release`). Keys go only to Tegg (D-799). Interface docs/contracts/v1-views.md §4.8.
// Written from the ACs and the contract only (D-61); synthetic data only (D-62).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, appiumDown, end, marksOf, session, shown, sleep, support, testEnv, waitFor, type Driver } from './helpers/capture.ts';
import { p } from './perf_type_page.ts';

after(appiumDown);
process.on('exit', appiumDown);

const EXE = join(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app/Contents/MacOS/tegg');
const enforce = process.env.TEGG_PERF_REF === '1' && process.env.VERIFY_GATE === 'release';
const OPTS = ['Nápad', 'Rozpracováno', 'Čeká', 'Hotovo', 'Zrušeno'];

function prepare(base: string): string {
  const out = join(base, 'vault');
  execFileSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'), '--', '--seed', '1', '--small-images', '--out', out], { stdio: 'ignore' });
  mkdirSync(join(out, '.tegg/types'), { recursive: true });
  mkdirSync(join(out, '.tegg/queries'), { recursive: true });
  mkdirSync(join(out, 'Karty'), { recursive: true });
  writeFileSync(join(out, '.tegg/types/karta.yml'), ['# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg\'s type settings.', 'version: 1', 'name: Karta',
    'plural: Karty', 'system: false', 'folder: Karty', 'icon: file', 'color: gray', 'review: false', 'preview: [fáze]', 'views: [Karty]', 'attributes:', '  - key: fáze',
    '    name: Fáze', '    type: select', '    options:', ...OPTS.map((o) => `      - { label: ${o}, color: gray }`), ''].join('\n'));
  writeFileSync(join(out, '.tegg/queries/Karty.yml'), ['# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Karty.', 'version: 1', 'title: Karty', 'types: [karta]',
    'match: all', 'filters: []', 'sort: { by: title, order: asc }', 'limit: 50', 'view: board', 'group_by: fáze', 'lanes: vertical', 'columns: [tags]',
    'created: 2026-11-01T09:00:00+01:00', 'modified: 2026-11-01T09:00:00+01:00', ''].join('\n'));
  for (let i = 0; i < 500; i++) {
    const o = i < 400 ? OPTS[Math.floor(i / 100)] : i < 450 ? OPTS[4] : null;
    const n = String(i).padStart(3, '0');
    writeFileSync(join(out, 'Karty', `Karta ${n}.md`), `---\nid: 01JBKARTA0000000000000${n.padStart(4, '0')}\ntype: karta\ntitle: Karta ${n}\n${o ? `fáze: ${o}\n` : ''}tags: [štítek${i % 7}]\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n---\nKarta číslo ${n}.\n`);
  }
  return out;
}
/** The ms between the last `from` mark and the first `to` mark after it in a perf log. */
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

test('nfr_perf_07_ac3_board_500_cards_6_lanes', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-07-ac3-'));
  try {
    const vault = prepare(base);
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const log = join(base, `perf-${i}.jsonl`);
      // `typeViews.lastTab.karta: null`: the page opens on `All Karty`; the run selects `Karty`.
      const d = await session(testEnv(support(base, { name: `s-${i}`, ui: { typeViews: { lastTab: { karta: null } } } }), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'type/karta' }));
      try {
        assert.ok(await waitFor(() => marksOf(log).some((m) => m.mark === 'route-ready:type/karta'), 60_000), `run ${i}: route-ready:type/karta`);
        const t = await d.$('-ios predicate string:label == "Karty" AND elementType == 59');
        assert.ok(await t.isDisplayed().catch(() => false), `run ${i}: the tab Karty`);
        await t.click();
        assert.ok(await waitFor(() => marksOf(log).some((m) => m.mark === 'board-ready'), 20_000), `run ${i}: board-ready`);
        const ms = between(log, 'board-request', 'board-ready');
        assert.ok(ms !== null, `run ${i}: board-request → board-ready`);
        times.push(ms!);
        if (i === 0) for (const l of ['Nápad, 100 cards', 'Zrušeno, 50 cards', 'No Fáze, 50 cards']) assert.ok(await shown(d, l, 3000), `the lane ${l}`);
      } finally { await end(d); }
    }
    console.log(`NFR-PERF-07 AC-3: 500 cards in 6 lanes, board-request → board-ready p95 ${p(times, 0.95).toFixed(1)} ms (target 225 ms)`);
    if (enforce) assert.ok(p(times, 0.95) <= 225, `p95 ${p(times, 0.95).toFixed(1)} ms > 225 ms`);
    else console.log('NFR-PERF-07 AC-3: report-only until the v1.0 release gate (AP-1516)');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('nfr_perf_07_ac4_dragged_card_shows_within_100_ms', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-07-ac4-'));
  try {
    const vault = prepare(base);
    const log = join(base, 'perf.jsonl');
    const d = await session(testEnv(support(base, { ui: { typeViews: { lastTab: { karta: 'Karty' } } } }), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'type/karta' }));
    const times: number[] = [];
    try {
      assert.ok(await waitFor(() => marksOf(log).some((m) => m.mark === 'board-ready'), 60_000), 'the Karty board is ready');
      for (let i = 0; i < 20; i++) {
        const title = `Karta ${String(i).padStart(3, '0')}`;
        const from = await rectOf(d, `Karta: ${title}`);
        // Each drop moves the next card of `Nápad` (rows by title: Karta 000…099) onto the next lane, `Rozpracováno`.
        const to = await rectOf(d, 'Rozpracováno, ', true);
        const before = marksOf(log).filter((m) => m.mark === 'board-card-moved').length;
        await d.execute('macos: clickAndDrag', { startX: Math.round(from.x + from.width / 2), startY: Math.round(from.y + 12), endX: Math.round(to.x + to.width / 2), endY: Math.round(to.y + 40), duration: 0.6 });
        assert.ok(await waitFor(() => marksOf(log).filter((m) => m.mark === 'board-card-moved').length > before, 5000), `drop ${i}: board-card-moved`);
        // The `board-card-moved` mark's `ms` is the time from the drop event to the card in the target lane's DOM (D-1820).
        const ms = marksOf(log).filter((m) => m.mark === 'board-card-moved').at(-1)?.ms ?? null;
        assert.ok(ms !== null, `drop ${i}: a time`);
        times.push(ms!);
        await sleep(300);
      }
    } finally { await end(d); }
    console.log(`NFR-PERF-07 AC-4: drop → card in its lane p95 ${p(times, 0.95).toFixed(1)} ms (target 100 ms)`);
    if (enforce) assert.ok(p(times, 0.95) <= 100, `p95 ${p(times, 0.95).toFixed(1)} ms > 100 ms`);
    else console.log('NFR-PERF-07 AC-4: report-only until the v1.0 release gate (AP-1516)');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
