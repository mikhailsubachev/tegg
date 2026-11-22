// Slice OC benchmark (L6, Appium mac2 on the built release test app; app-perf, outside the push run): docs/acceptance/
// cards.md NFR-PERF-07 AC-6 (D-1774, AP-1603 → D-1996): NFR-PERF-07 AC-3's board (the 5,000-note reference vault, gen-vault
// `--seed 1 --small-images`, plus a runtime type `karta` with 500 objects in 6 lanes of `fáze`) whose `karta.yml` gets
// `card: [tags, body, fáze, a1, a2, a3, a4, a5, modified]` (five runtime Text attributes, every value set, a 300-character
// body): selecting the `Karty` tab paints the visible cards within 225 ms p95 of 20 runs (`perfMark('board-request')` →
// `perfMark('board-ready')`). The ≤ 150 card elements and the two pill rows are checked at L5 (`__TEGG_TEST__.board()`'s
// `domCards`, contract §12). Report-only until the v1.0 release gate, enforced at it (D-1800: `TEGG_PERF_REF=1` with
// `VERIFY_GATE=release`). Keys go only to Tegg (D-799). Written from the AC and the contract only (D-61); synthetic data
// only (D-62).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, appiumDown, end, marksOf, ready, session, shown, support, testEnv, waitFor } from './helpers/capture.ts';
import { p } from './perf_type_page.ts';

after(appiumDown);
process.on('exit', appiumDown);

const EXE = join(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app/Contents/MacOS/tegg');
const enforce = process.env.TEGG_PERF_REF === '1' && process.env.VERIFY_GATE === 'release';
const OPTS = ['Nápad', 'Rozpracováno', 'Čeká', 'Hotovo', 'Zrušeno'];

function prepare(base: string): string {
  const out = join(base, 'vault');
  execFileSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'), '--', '--seed', '1', '--small-images', '--out', out], { stdio: 'ignore' });
  for (const d of ['.tegg/types', '.tegg/queries', 'Karty']) mkdirSync(join(out, d), { recursive: true });
  writeFileSync(join(out, '.tegg/types/karta.yml'), ['# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg\'s type settings.', 'version: 1', 'name: Karta',
    'plural: Karty', 'system: false', 'folder: Karty', 'icon: file', 'color: gray', 'review: false', 'preview: [fáze]', 'card: [tags, body, fáze, a1, a2, a3, a4, a5, modified]', 'views: [Karty]',
    'attributes:', '  - key: fáze', '    name: Fáze', '    type: select', '    options:', ...OPTS.map((o) => `      - { label: ${o}, color: gray }`),
    ...[1, 2, 3, 4, 5].flatMap((i) => [`  - key: a${i}`, `    name: Údaj ${i}`, '    type: text']), ''].join('\n'));
  writeFileSync(join(out, '.tegg/queries/Karty.yml'), ['# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Karty.', 'version: 1', 'title: Karty', 'types: [karta]',
    'match: all', 'filters: []', 'sort: { by: title, order: asc }', 'limit: 50', 'view: board', 'group_by: fáze', 'lanes: vertical', 'columns: [tags]',
    'created: 2026-11-01T09:00:00+01:00', 'modified: 2026-11-01T09:00:00+01:00', ''].join('\n'));
  const body = 'Žluťoučký kůň úpěl ďábelské ódy, '.repeat(10).slice(0, 300);
  for (let i = 0; i < 500; i++) {
    const o = i < 400 ? OPTS[Math.floor(i / 100)] : i < 450 ? OPTS[4] : null;
    const n = String(i).padStart(3, '0');
    const vals = [1, 2, 3, 4, 5].map((a) => `a${a}: Hodnota ${a} karty ${n}\n`).join('');
    writeFileSync(join(out, 'Karty', `Karta ${n}.md`), `---\nid: 01JBKARTA0000000000000${n.padStart(4, '0')}\ntype: karta\ntitle: Karta ${n}\n${o ? `fáze: ${o}\n` : ''}${vals}tags: [štítek${i % 7}]\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n---\n${body}\n`);
  }
  return out;
}
function between(log: string, from: string, to: string): number | null {
  const m = marksOf(log);
  const i = m.map((x) => x.mark).lastIndexOf(from);
  if (i < 0) return null;
  const j = m.findIndex((x, k) => k > i && x.mark === to);
  if (j < 0 || m[i].ms === undefined || m[j].ms === undefined) return null;
  return m[j].ms! - m[i].ms!;
}

test('nfr_perf_07_ac6_boards_with_card_values', { timeout: 60 * 60_000 }, async () => {
  await ready();
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-07-ac6-'));
  try {
    const vault = prepare(base);
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const log = join(base, `perf-${i}.jsonl`);
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
        if (i === 0) assert.ok(await shown(d, 'Údaj 1: Hodnota 1 karty 000', 3000), 'the cards show their card values (Údaj 1 pill)');
      } finally { await end(d); }
    }
    console.log(`NFR-PERF-07 AC-6: 500 cards with nine card values, board-request → board-ready p95 ${p(times, 0.95).toFixed(1)} ms (target 225 ms)`);
    if (enforce) assert.ok(p(times, 0.95) <= 225, `p95 ${p(times, 0.95).toFixed(1)} ms > 225 ms`);
    else console.log('NFR-PERF-07 AC-6: report-only until the v1.0 release gate (D-1996)');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
