// NFR-PERF-05 AC-4 (docs/acceptance/editor.md, D-148; ms3-shell §13.4): the read-view benchmark of AC-2 run with the
// editor, `note-ready` written only when the editor accepts input (mounted, editable, focus on the title). First one
// launch checks that at `note-ready` the focused element is the `Title` field and the `Note body` editor exists; then
// p95 of 20 runs from `switcher-enter` to `note-ready` for the longest note (10 embeds, 50 links), < 112 ms enforced
// only with TEGG_PERF_REF=1 (D-152). Benchmark: perf_open_note.ts. TEGG_REF_VAULT may point at a `--perf-note` vault.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, generateVault, longestNote, oneRun, p95, readMarks } from './perf_open_note.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const osa = (s: string) => execFileSync('osascript', ['-e', s], { encoding: 'utf8' }).trim();
const PROC = 'tell application "System Events" to tell (first process whose bundle identifier is "app.tegg.desktop")';

async function editorReadyRun(label: string) {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-05-4-'));
  try {
    const vault = process.env.TEGG_REF_VAULT ?? generateVault(join(tmp, 'vault'));
    assert.ok(vault, 'reference vault with --perf-note could not be generated');
    const target = longestNote(vault!);
    const base = { TEGG_TEST: '1', TEGG_APP_SUPPORT: join(tmp, 'support'), TEGG_VAULT: vault! };

    // What note-ready means now: the editor is mounted and the title has the focus.
    const log0 = join(tmp, 'check.jsonl');
    const clean = { ...process.env };
    for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
    const child = spawn(EXE, [], { env: { ...clean, ...base, TEGG_PERF_LOG: log0, TEGG_ROUTE: `note/${target.path}` }, stdio: 'ignore' });
    let focusName = '';
    let bodyFound = '';
    let readyOk = false;
    try {
      const end = Date.now() + 240_000;
      while (Date.now() < end && !readMarks(log0).some((m) => m.mark === 'note-ready')) await sleep(50);
      readyOk = readMarks(log0).some((m) => m.mark === 'note-ready');
      // macOS reports a focused element only for the app in front; bring it there (no keystrokes are sent).
      try { osa(`tell application "System Events" to set frontmost of (first process whose unix id is ${child.pid}) to true`); } catch { /* the asserts tell */ }
      await sleep(800);
      // By pid: another app with the same bundle id (e.g. Tegg Preview) could be `first process` otherwise.
      const proc = `tell application "System Events" to tell (first process whose unix id is ${child.pid})`;
      // The accessibility tree reports the new focus a moment after the window comes to front: poll up to 4 s.
      for (const until = Date.now() + 4000; !focusName && Date.now() < until; await sleep(100)) {
        try { osa(`tell application "System Events" to set frontmost of (first process whose unix id is ${child.pid}) to true`); } catch { /* not yet */ }
        try { focusName = osa(`${proc} to get value of attribute "AXDescription" of (value of attribute "AXFocusedUIElement")`); } catch { /* not yet */ }
      }
      // The focused element being the note body shows it is mounted; else look it up in the window.
      if (focusName === 'Note body') bodyFound = focusName;
      else try { bodyFound = osa(`${proc} to get description of (first UI element of (entire contents of window 1) whose description is "Note body")`); } catch { /* none */ }
    } finally {
      child.kill('SIGKILL'); // never leave the app running (a second launch would reach the first instance)
    }
    assert.ok(readyOk, 'note-ready written');
    assert.equal(focusName, 'Note body', 'at note-ready the caret is in the note body (D-247, FR-EDT-01 AC-11)');
    assert.equal(bodyFound, 'Note body', 'at note-ready the editor (Note body) is mounted');

    const warm = await oneRun(base, join(tmp, 'warm.jsonl'), target.title, 240_000);
    assert.ok(warm.some((m) => m.mark === 'note-ready'), 'warm-up reached note-ready');
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const marks = await oneRun(base, join(tmp, `run-${i}.jsonl`), target.title);
      const enter = marks.filter((m) => m.mark === 'switcher-enter');
      const ready = marks.filter((m) => m.mark === 'note-ready');
      assert.ok(enter.length === 1 && ready.length === 1, `run ${i}: one switcher-enter and one note-ready`);
      times.push(ready[0].ms - enter[0].ms);
    }
    const p = p95(times);
    console.log(`${label}: p95 ${p.toFixed(1)} ms over 20 runs (limit 112 ms)`);
    if (process.env.TEGG_PERF_REF === '1') assert.ok(p < 112, `p95 ${p.toFixed(1)} ms ≥ 112 ms`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('nfr_perf_05_ac4_editor_ready_p95_under_112ms', { timeout: 30 * 60_000 }, () => editorReadyRun('NFR-PERF-05 AC-4'));
// performance.md NFR-PERF-05/AC-1 (open a note in < 150 ms, D-148: measured with the editor), verified by AC-4.
test('nfr_perf_05_ac1_open_note_with_the_editor', { timeout: 30 * 60_000 }, () => editorReadyRun('NFR-PERF-05 AC-1'));
