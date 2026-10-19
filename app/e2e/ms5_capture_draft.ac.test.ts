// MS5 slice 5B real-app test (L6, Appium mac2 on the built test app, D-382): docs/acceptance/capture.md FR-CAP-01 AC-15
// (D-585; ⌘Q and relaunch). Interface: docs/contracts/ms5-capture.md §15 item 9 (the draft stored about 500 ms after the
// last change, in `<Application Support>/capture-draft.json`), §11.1 (test hooks), ms3-shell §1 (TEGG_ROUTE, marks).
// Always TEGG_TEST=1 with TEGG_NOW (D-504), a temporary Application Support and a temporary copy of the synthetic inbox
// fixture (D-62). The launch pattern is the one of ms5_capture.ac.test.ts (FR-CAP-01 AC-8), kept in its own file so the
// existing AC test file stays unchanged (TS-I3). Written from the ACs and the contracts only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  activateFinder, appPids, appiumDown, captureOpen, captureValue, changedPaths, end, hotkey, inboxCopy, paste, press, ready, session, sleep,
  support, testEnv, tmp, tree, waitFile, waitFor, waitMark, type Driver,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver };
function fresh(name: string): Ctx {
  const base = tmp(name);
  return { base, vault: inboxCopy(base), sup: support(base), log: join(base, 'perf.jsonl') };
}
async function launch(c: Ctx, route = 'inbox') {
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route }));
  assert.ok(await waitMark(c.log, `route-ready:${route}`), `${route} shown`);
  return c.d;
}
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
async function openByHotkey(d: Driver) {
  await activateFinder();
  hotkey('quick');
  assert.ok(await waitFor(() => captureOpen(d), 3000), 'the capture window opens');
}

test('fr_cap_01_ac15_cmd_q_with_the_window_open_keeps_the_draft', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap01ac15');
  const text = 'Myšlenka před ukončením';
  try {
    let d = await launch(c);
    const before = tree(c.vault);
    await openByHotkey(d);
    paste(text); // non-ASCII text through the pasteboard (S3 P1)
    await sleep(1200);
    assert.ok(await captureOpen(d), 'the window stays open while typing');
    const draftFile = join(c.sup, 'capture-draft.json');
    const stored = await waitFile(draftFile, (t) => { try { return !!t && String(JSON.parse(t).text ?? '').normalize('NFC') === text; } catch { return false; } }, 2000);
    assert.ok(stored, 'the draft is in Application Support about 500 ms after the last change, without Esc');
    press('q', ['command']);
    assert.ok(await waitFor(() => appPids().length === 0, 10_000), '⌘Q quits Tegg with the capture window open');
    await end(d);
    assert.ok(existsSync(draftFile), 'the draft survives the quit');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'nothing is written into the vault');
    d = await launch(c);
    await openByHotkey(d);
    assert.equal(await captureValue(d), text, 'the next open after the relaunch shows the text');
    c.d = d;
  } finally { await cleanup(c); }
});
