// Slice REL benchmark (L6, the `app-perf` step, outside the push run; docs/acceptance/related.md NFR-PERF-06 AC-7,
// AP-1469 → D-1716; docs/contracts/v1-related.md §1.13, §6): typing in the reference vault's 5,000-word benchmark note
// (`tools/gen-vault --seed 1 --small-images`, or a copy of TEGG_REF_VAULT) with the Related tab shown. The latency
// probe of NFR-PERF-06 AC-3 (TEGG_PERF_LOG) types 200 characters, with autosave and the list re-asked after each
// `Saved` (contract §3.4). ≥ 95 % of keystrokes painted in the next frame and none later than two (D-66), enforced only
// with TEGG_PERF_REF=1 at the v1.0 release gate (as D-940), else reported. Every run must reach `related-ready` (the
// tab's list was drawn, §1.13) and write one key line per keystroke, so the test is red until the tab exists. Keys go
// only to Tegg (helpers/osa.ts, D-758, D-799). Written from the ACs and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, generateVault, longestNote } from './perf_open_note.ts';
import { keyLines, summary, type200 } from './perf_typing.ts';
import { appiumDown, end, marks, osa, session, sleep, waitFor, type Driver } from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const enforce = process.env.TEGG_PERF_REF === '1' && process.env.VERIFY_GATE === 'release';

function prepare(tmp: string): { vault: string; rel: string } {
  const given = process.env.TEGG_REF_VAULT;
  const vault = given ? join(tmp, 'vault') : generateVault(join(tmp, 'vault'));
  assert.ok(vault, 'the reference vault could not be generated (tools/gen-vault --seed 1 --small-images)');
  if (given) cpSync(given, vault!, { recursive: true });
  return { vault: vault!, rel: longestNote(vault!).path };
}

test('nfr_perf_06_ac7_typing_with_the_related_tab_on_screen', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-rel-perf06-'));
  let d: Driver | undefined;
  try {
    const { vault, rel } = prepare(tmp);
    const sup = join(tmp, 'support');
    mkdirSync(sup, { recursive: true });
    writeFileSync(join(sup, 'ui-state.json'), JSON.stringify({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: true, tab: 'related', width: 288 }, preview: { mode: 'off' } }));
    const log = join(tmp, 'perf.jsonl');
    d = await session({ TEGG_TEST: '1', TEGG_APP_SUPPORT: sup, TEGG_VAULT: vault, TEGG_ROUTE: `note/${rel}`, TEGG_PERF_LOG: log, TZ: 'Europe/Prague' });
    assert.ok(await waitFor(() => marks(log).includes('note-ready'), 240_000), 'note-ready');
    assert.ok(await waitFor(() => marks(log).includes('related-ready'), 30_000), 'the Related tab is shown with its list (related-ready)');
    osa('tell application id "app.tegg.desktop" to activate');
    osa('tell application "System Events" to tell (first process whose bundle identifier is "app.tegg.desktop")\nset {x, y} to position of window 1\nclick at {x + 600, y + 450}\nend tell');
    await sleep(500);
    const askedBefore = marks(log).filter((m) => m === 'related-request').length; // D-1759: every ask, drawn or not
    type200('a');
    await sleep(2500);
    const s = summary(keyLines(log));
    const reasked = marks(log).filter((m) => m === 'related-request').length - askedBefore;
    console.log(`NFR-PERF-06 AC-7 (Related tab shown): ${s.n} keys, frame 1 ${(s.frame1 * 100).toFixed(1)} %, late ${s.late}, p50 ${s.p50} ms, p95 ${s.p95} ms; lists re-asked after Saved: ${reasked}`);
    assert.equal(s.n, 200, `the probe wrote one key line per keystroke (got ${s.n})`);
    assert.ok(reasked >= 1, 'the list was re-asked after Saved (a related-request mark after typing)');
    if (enforce) {
      assert.ok(s.frame1 >= 0.95, `≥ 95 % in frame 1 (${(s.frame1 * 100).toFixed(1)} %)`);
      assert.equal(s.late, 0, 'none after frame 2');
    } else console.log('NFR-PERF-06 AC-7: reported only (enforced with TEGG_PERF_REF=1 at the v1.0 release gate)');
  } finally {
    await end(d);
    rmSync(tmp, { recursive: true, force: true });
  }
});
