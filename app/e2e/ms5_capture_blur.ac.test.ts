// 5B preview feedback round 2, real-app test (L6, Appium mac2 on the built test app, D-382): docs/acceptance/capture.md
// FR-CAP-01 AC-18, the L6 part (D-596, AP-524): with text typed, a click on the Finder desktop (outside the capture
// window) hides the built window, the draft is kept in Application Support, nothing is written into the vault, and the
// next ⌃⌥Space shows the same text. Interface: docs/contracts/ms5-capture.md §1 (the `capture` window titled `Quick
// Capture`, hotkeys), §4 (the window's `blur` behaves like Esc), §11.1 (test hooks), §15 item 9 (`capture-draft.json`
// in Application Support); ms3-shell §1 (TEGG_ROUTE, marks). Always TEGG_TEST=1 with TEGG_NOW (D-504), a temporary
// Application Support and a temporary copy of the synthetic inbox fixture (D-62). The click is posted with Appium's
// `macos: click` at screen coordinates below the capture window, with Finder frontmost before the hotkey (the point is
// the desktop unless another app's window covers it, which is a click into another app: the same focus loss). Kept in
// its own file so the existing AC test files stay unchanged (TS-I3). Written from the AC and the contracts only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  activateFinder, appiumDown, captureOpen, captureValue, changedPaths, end, hotkey, inboxCopy, need, paste, ready, session, sleep, support,
  testEnv, tmp, tree, waitFile, waitFor, waitMark, type Driver,
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
  assert.ok(await waitFor(() => captureOpen(d), 3000), 'the capture window opens (⌃⌥Space)');
}

test('fr_cap_01_ac18_a_click_on_the_desktop_hides_the_window_and_keeps_the_text', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('cap01ac18');
  const text = 'Koupit mléko a chléb';
  try {
    const d = await launch(c);
    const before = tree(c.vault);
    await openByHotkey(d);
    paste(text); // non-ASCII text through the pasteboard (S3 P1)
    await sleep(300);
    assert.equal(await captureValue(d), text, 'setup: the text is in the capture window');
    const w = await need(d, 'Quick Capture');
    const r = await w.getElementRect(w.elementId);
    const screen = JSON.parse(execFileSync('osascript', ['-l', 'JavaScript', '-e', 'ObjC.import("AppKit"); const f = $.NSScreen.mainScreen.frame; JSON.stringify({w: f.size.width, h: f.size.height})'], { encoding: 'utf8' }));
    // A point on the desktop: centred under the window (it sits in the upper third), well above the Dock.
    const x = Math.round(r.x + r.width / 2);
    const y = Math.round(Math.min(r.y + r.height + 160, screen.h - 160));
    assert.ok(y > r.y + r.height + 20, `the click point (${x}, ${y}) is outside the capture window`);
    await d.execute('macos: click', { x, y });
    assert.ok(await waitFor(async () => !(await captureOpen(d)), 2000), 'a click outside hides the capture window (D-596)');
    const draftFile = join(c.sup, 'capture-draft.json');
    const stored = await waitFile(draftFile, (t) => { try { return !!t && String(JSON.parse(t).text ?? '').normalize('NFC') === text; } catch { return false; } }, 2000);
    assert.ok(stored, 'the draft with the text is kept in Application Support');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'nothing is written into the vault');
    await openByHotkey(d);
    assert.equal(await captureValue(d), text, 'the next ⌃⌥Space shows the text');
  } finally { await cleanup(c); }
});
