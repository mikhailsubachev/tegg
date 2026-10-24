// Regression test from the MS4 milestone gate (D-752): the crash test's banner query `value CONTAINS "…"` made
// XCTest's agent inside Tegg throw (NSInPredicateOperator on a number: a progress bar's or checkbox's value) and the
// app died, so 7 of 20 FR-LNK-03 AC-17 cycles reported "no interrupted banner". Named `bug_<issue>_<req-id>_…`
// (CLAUDE.md "Testing"); it failed before the fix. Synthetic data only: the generated reference vault (D-62).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, HUB, copyVault, prepareHubVault } from './perf_rename.ts';
import { appiumDown, end, session, sleep, textContains } from './helpers/capture.ts';

after(appiumDown);

const running = () => { try { return execFileSync('pgrep', ['-x', 'tegg'], { encoding: 'utf8' }).trim() !== ''; } catch { return false; } };

test('bug_ms4gate_fr_lnk_03_ac17_a_text_query_while_the_index_catches_up_keeps_the_app_running', { timeout: 600_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-bug-contains-'));
  let d: any;
  try {
    const prepared = prepareHubVault(base);
    assert.ok(prepared, 'reference vault (tools/gen-vault --seed 1 --small-images) with the hub');
    const v = copyVault(prepared!, join(base, 'v'));
    d = await session({ TEGG_TEST: '1', TEGG_APP_SUPPORT: join(base, 's'), TEGG_VAULT: v, TEGG_ROUTE: `note/${HUB}`, TEGG_PERF_LOG: join(base, 'l.jsonl') });
    // The first seconds, while the index catches up (a progress bar) and the note and its panel load.
    const errors: string[] = [];
    for (let i = 0; i < 25; i++) {
      await d.$$(`-ios predicate string:${textContains('was interrupted')}`).catch((e: unknown) => errors.push(String(e).slice(0, 120)));
      await sleep(200);
    }
    assert.deepEqual(errors, [], 'every text query is answered');
    assert.ok(running(), 'the app still runs');
  } finally {
    await end(d);
    rmSync(base, { recursive: true, force: true });
  }
});
