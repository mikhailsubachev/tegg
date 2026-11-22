// Slice OC benchmark (L6, Appium mac2 on the built release test app; app-perf, outside the push run): docs/acceptance/
// cards.md FR-TYP-01 AC-21 (AP-1603 → D-1996): the first open of the icon picker in a session paints its groups within
// 300 ms p95 of 20 runs (each in a fresh window, the data load included; `perfMark('icon-picker-open')` →
// `perfMark('icon-picker-ready')`, contract §12), later opens within 100 ms p95, and each keystroke of `arrow` typed one
// letter at a time paints its results within 50 ms p95 (`icon-picker-input` → `icon-picker-results`). Report-only until
// the v1.0 release gate, enforced at it (D-1800). On a temporary copy of the cards fixture (views + new-empty/.tegg +
// cards/). The file is named `nfr_perf_*` so the app-perf step runs it (RT-4: cards.md names it
// `perf_icon_picker.ac.test.ts`). Keys go only to Tegg (D-799). Written from the AC and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { FX, appiumDown, end, marksOf, need, press, ready, session, sleep, support, testEnv, typeAscii, waitFor } from './helpers/capture.ts';
import { p } from './perf_type_page.ts';

after(appiumDown);
process.on('exit', appiumDown);

const EXE = join(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app/Contents/MacOS/tegg');
const enforce = process.env.TEGG_PERF_REF === '1' && process.env.VERIFY_GATE === 'release';

function vaultCopy(base: string): string {
  const v = join(base, 'Výlety a knihy');
  cpSync(join(FX, 'views'), v, { recursive: true, filter: (s) => relative(join(FX, 'views'), s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  cpSync(join(FX, 'cards'), v, { recursive: true, filter: (s) => !['README.md', 'expected-card-data.json'].includes(relative(join(FX, 'cards'), s)) });
  return v;
}
/** Every `from` → next `to` pair of the log, in ms. */
function pairs(log: string, from: string, to: string): number[] {
  const m = marksOf(log);
  const out: number[] = [];
  m.forEach((x, i) => {
    if (x.mark !== from || x.ms === undefined) return;
    const j = m.findIndex((y, k) => k > i && y.mark === to);
    if (j >= 0 && m[j].ms !== undefined) out.push(m[j].ms! - x.ms!);
  });
  return out;
}

test('fr_typ_01_ac21_picker_is_quick', { timeout: 60 * 60_000 }, async () => {
  await ready();
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-perf-icon-picker-'));
  try {
    const vault = vaultCopy(base);
    const first: number[] = [];
    const later: number[] = [];
    const keys: number[] = [];
    for (let i = 0; i < 20; i++) {
      const log = join(base, `perf-${i}.jsonl`);
      const d = await session(testEnv(support(base, { name: `s-${i}` }), log, { TEGG_VAULT: vault, TEGG_ROUTE: 'type-settings/výlet', TEGG_NOW: '2026-11-19T10:00:00+01:00' }));
      try {
        assert.ok(await waitFor(() => marksOf(log).some((m) => m.mark === 'route-ready:type-settings/výlet'.normalize('NFC') || m.mark.normalize('NFC') === 'route-ready:type-settings/výlet'.normalize('NFC')), 30_000), `run ${i}: type settings`);
        for (let k = 0; k < 2; k++) {
          await (await need(d, 'Icon for Náročnost', 5000)).click();
          assert.ok(await waitFor(() => pairs(log, 'icon-picker-open', 'icon-picker-ready').length > k, 5000), `run ${i}: icon-picker-ready (${k + 1})`);
          if (k === 1) {
            for (const ch of 'arrow') { typeAscii(ch); await sleep(150); }
            assert.ok(await waitFor(() => pairs(log, 'icon-picker-input', 'icon-picker-results').length >= 5, 5000), `run ${i}: five results marks`);
          }
          press('escape');
          await sleep(300);
        }
        const opens = pairs(log, 'icon-picker-open', 'icon-picker-ready');
        first.push(opens[0]);
        later.push(opens[1]);
        keys.push(...pairs(log, 'icon-picker-input', 'icon-picker-results'));
      } finally { await end(d); }
    }
    const r = { first: p(first, 0.95), later: p(later, 0.95), key: p(keys, 0.95) };
    console.log(`FR-TYP-01 AC-21: first open p95 ${r.first.toFixed(1)} ms (300), later opens p95 ${r.later.toFixed(1)} ms (100), keystroke p95 ${r.key.toFixed(1)} ms (50)`);
    if (enforce) assert.ok(r.first <= 300 && r.later <= 100 && r.key <= 50, JSON.stringify(r));
    else console.log('FR-TYP-01 AC-21: report-only until the v1.0 release gate (D-1996)');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
