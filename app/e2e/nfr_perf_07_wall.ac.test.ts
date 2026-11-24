// Slice Q3 benchmarks (L6, Appium mac2 on the built release test app; app-perf / nightly, outside the push run):
// docs/acceptance/views.md NFR-PERF-07 AC-7 (an ungrouped wall over the type with the most objects paints its visible
// cards within 225 ms p95 of 20 runs, `perfMark('board-request')` → `perfMark('board-ready')` for every wall, contract
// §42.5; then scrolling to the bottom shows the last card) and AC-8 (a grouped Table of 1,000 results, a 6-option Select,
// paints its first screen within 225 ms p95 of 20 runs, `rows-request` → `rows-ready`; every group header shows and the
// last row is reached). The DOM bounds (≤ 150 card elements, < 80 row elements) are the L5 parts
// (app/webkit/views_wall.ac.test.ts, views_grouped.ac.test.ts: `__TEGG_TEST__.board()` / `groups()`). The vault: the
// reference vault (gen-vault `--seed 1 --small-images`), with a runtime query `Zeď` (`view: wall`, no `group_by`,
// `sort: { by: title, order: asc }`) as the only tab of the type with the most objects (counted from its folder; the
// count is printed), and for AC-8 a runtime type `položka` with 1,000 objects and the view `Po stavech`. Report-only
// before the v1.0 release gate, enforced at it (D-1800, D-2185; `TEGG_PERF_REF=1` with `VERIFY_GATE=release`). Keys go
// only to Tegg (D-799). Interface docs/contracts/v1-views.md §44. Written from the ACs and the contract only (D-61);
// synthetic data only (D-62).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, appiumDown, end, firstShown, marksOf, session, shown, sleep, support, testEnv, waitFor, type Driver } from './helpers/capture.ts';
import { p } from './perf_type_page.ts';

after(appiumDown);
process.on('exit', appiumDown);

const EXE = join(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app/Contents/MacOS/tegg');
const enforce = process.env.TEGG_PERF_REF === '1' && process.env.VERIFY_GATE === 'release';
const OPTS = ['Jedna', 'Dvě', 'Tři', 'Čtyři', 'Pět', 'Šest'];

function generate(base: string): string {
  const out = join(base, 'vault');
  execFileSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'), '--', '--seed', '1', '--small-images', '--out', out], { stdio: 'ignore' });
  // gen-vault writes no type files (system types are built in): the system types' files of a new vault give
  // `largestType()` each type's `folder:` and a file to add `views:` to.
  cpSync(join(REPO, 'tests/fixtures/vaults/new-empty/.tegg/types'), join(out, '.tegg/types'), { recursive: true });
  mkdirSync(join(out, '.tegg/queries'), { recursive: true });
  return out;
}
/** The type file whose folder holds the most `.md` files. */
function largestType(vault: string): { key: string; name: string; count: number; file: string; last: string } {
  let best = { key: '', name: '', count: -1, file: '', last: '' };
  for (const f of readdirSync(join(vault, '.tegg/types'))) {
    const file = join(vault, '.tegg/types', f);
    const text = readFileSync(file, 'utf8');
    const folder = /^folder: (.*)$/m.exec(text)?.[1]?.trim();
    if (!folder || !existsSync(join(vault, folder))) continue;
    const notes = readdirSync(join(vault, folder)).filter((x) => x.endsWith('.md'));
    if (notes.length <= best.count) continue;
    const titles = notes.map((n) => /^title: (.*)$/m.exec(readFileSync(join(vault, folder, n), 'utf8'))?.[1]?.replace(/^"|"$/g, '') ?? n.replace(/\.md$/, ''));
    titles.sort(new Intl.Collator('cs').compare);
    best = { key: f.replace(/\.yml$/, ''), name: /^name: (.*)$/m.exec(text)?.[1]?.trim() ?? '', count: notes.length, file, last: titles.at(-1) ?? '' };
  }
  return best;
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
/** Scrolls the page down from a point under the view tabs (`macos: scroll` needs an element or a point). */
/** Scrolls down 400 px at a time from under the view tabs until every label in `want` was shown (each is removed once seen). */
async function scrollThrough(d: Driver, tabEl: { elementId: string }, want: Map<string, string>) {
  const r = await d.getElementRect(tabEl.elementId);
  const at = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height + 250) };
  for (let i = 0; i < 200 && want.size > 0; i++) {
    for (const label of [...want.keys()]) if (await firstShown(d, label)) want.delete(label);
    if (want.size === 0) break;
    await d.execute('macos: scroll', { ...at, deltaX: 0, deltaY: -400 }).catch(() => undefined);
    await sleep(150);
  }
}
async function scrollToEnd(d: Driver, tabEl: { elementId: string }) {
  const r = await d.getElementRect(tabEl.elementId);
  const at = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height + 250) };
  for (let i = 0; i < 120; i++) {
    await d.execute('macos: scroll', { ...at, deltaX: 0, deltaY: -1500 }).catch(() => undefined);
    await sleep(25);
  }
}

test('nfr_perf_07_ac7_ungrouped_wall_largest_type', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-07-ac7-'));
  try {
    const vault = generate(base);
    const t = largestType(vault);
    assert.ok(t.count > 0, `setup: a type with objects (${JSON.stringify(t)})`);
    writeFileSync(join(vault, '.tegg/queries/Zeď.yml'), ['# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Zeď.', 'version: 1', 'title: Zeď', `types: [${t.key}]`, 'match: all',
      'filters: []', 'sort: { by: title, order: asc }', 'limit: 50', 'view: wall', 'created: 2026-11-01T09:00:00+01:00', 'modified: 2026-11-01T09:00:00+01:00', ''].join('\n'));
    const text = readFileSync(t.file, 'utf8');
    writeFileSync(t.file, /^views:/m.test(text) ? text.replace(/^views: .*$/m, 'views: [Zeď]') : text.replace(/^attributes:/m, 'views: [Zeď]\nattributes:'));
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const log = join(base, `perf-${i}.jsonl`);
      const d = await session(testEnv(support(base, { name: `s-${i}`, ui: { typeViews: { lastTab: { [t.key]: null } } } }), log, { TEGG_VAULT: vault, TEGG_ROUTE: `type/${t.key}` }));
      try {
        assert.ok(await waitFor(() => marksOf(log).some((m) => m.mark === `route-ready:type/${t.key}`), 60_000), `run ${i}: route-ready`);
        const tabEl = await d.$('-ios predicate string:title == "Zeď" AND elementType == 80');
        assert.ok(await tabEl.isDisplayed().catch(() => false), `run ${i}: the tab Zeď`);
        await tabEl.click();
        assert.ok(await waitFor(() => marksOf(log).some((m) => m.mark === 'board-ready'), 20_000), `run ${i}: board-ready (a wall marks board-* too, §42.5)`);
        const ms = between(log, 'board-request', 'board-ready');
        assert.ok(ms !== null, `run ${i}: board-request → board-ready`);
        times.push(ms!);
        if (i === 0) {
          await scrollToEnd(d, tabEl);
          assert.ok(await shown(d, `${t.name}: ${t.last}`, 5000), `the last card shows (${t.name}: ${t.last})`);
        }
      } finally { await end(d); }
    }
    console.log(`NFR-PERF-07 AC-7: ${t.count} objects of ${t.key} on an ungrouped wall, board-request → board-ready p95 ${p(times, 0.95).toFixed(1)} ms (target 225 ms)`);
    if (enforce) assert.ok(p(times, 0.95) <= 225, `p95 ${p(times, 0.95).toFixed(1)} ms > 225 ms`);
    else console.log('NFR-PERF-07 AC-7: report-only until the v1.0 release gate (D-2185)');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('nfr_perf_07_ac8_grouped_table_1000_rows', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-07-ac8-'));
  try {
    const vault = generate(base);
    writeFileSync(join(vault, '.tegg/types/polozka.yml'), ['# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg\'s type settings.', 'version: 1', 'name: Položka',
      'plural: Položky', 'system: false', 'folder: Položky', 'icon: box', 'color: gray', 'review: false', 'preview: [stav]', 'views: [Po stavech]', 'attributes:', '  - key: stav',
      '    name: Stav', '    type: select', '    options:', ...OPTS.map((o) => `      - { label: ${o}, color: gray }`), ''].join('\n'));
    writeFileSync(join(vault, '.tegg/queries/Po stavech.yml'), ['# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Po stavech.', 'version: 1', 'title: Po stavech', 'types: [polozka]',
      'match: all', 'filters: []', 'sort: { by: title, order: asc }', 'limit: 50', 'view: table', 'group_by: stav', 'columns: [stav]', 'created: 2026-11-01T09:00:00+01:00',
      'modified: 2026-11-01T09:00:00+01:00', ''].join('\n'));
    mkdirSync(join(vault, 'Položky'), { recursive: true });
    for (let i = 0; i < 1000; i++) {
      const n = String(i).padStart(4, '0');
      writeFileSync(join(vault, 'Položky', `Položka ${n}.md`), `---\nid: 01JB5V0000000000000000${String(1000 + i)}\ntype: polozka\ntitle: Položka ${n}\nstav: ${OPTS[i % 6]}\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n---\n`);
    }
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const log = join(base, `perf-${i}.jsonl`);
      const d = await session(testEnv(support(base, { name: `s-${i}`, ui: { typeViews: { lastTab: { polozka: null } } } }), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'type/polozka' }));
      try {
        assert.ok(await waitFor(() => marksOf(log).some((m) => m.mark === 'route-ready:type/polozka'), 60_000), `run ${i}: route-ready`);
        const tabEl = await d.$('-ios predicate string:title == "Po stavech" AND elementType == 80');
        assert.ok(await tabEl.isDisplayed().catch(() => false), `run ${i}: the tab Po stavech`);
        await tabEl.click();
        assert.ok(await waitFor(() => marksOf(log).some((m) => m.mark === 'rows-ready'), 20_000), `run ${i}: rows-ready (§42.5)`);
        const ms = between(log, 'rows-request', 'rows-ready');
        assert.ok(ms !== null, `run ${i}: rows-request → rows-ready`);
        times.push(ms!);
        if (i === 0) {
          // The Table draws only the rows near the viewport (< 80, D-2207), so the group headers further down exist
          // only once scrolled to: each is looked for while scrolling down a screen at a time.
          const want = new Map<string, string>(OPTS.map((x, k) => [`${x}, ${k < 4 ? 167 : 166} Položky`, `the ${x} header with its true count`] as const));
          want.set('Položka 0995', 'the last group\'s last row');
          await scrollThrough(d, tabEl, want);
          assert.deepEqual([...want.values()], [], 'every group header and the last row reached while scrolling');
        }
      } finally { await end(d); }
    }
    console.log(`NFR-PERF-07 AC-8: a grouped Table of 1,000 rows, rows-request → rows-ready p95 ${p(times, 0.95).toFixed(1)} ms (target 225 ms)`);
    if (enforce) assert.ok(p(times, 0.95) <= 225, `p95 ${p(times, 0.95).toFixed(1)} ms > 225 ms`);
    else console.log('NFR-PERF-07 AC-8: report-only until the v1.0 release gate (AP-2051, D-2189)');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
