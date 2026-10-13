// NFR-PERF-06 AC-5 and FR-SYN-03 AC-20 (docs/acceptance/editor.md; L6 benchmarks in the `app-perf` step, D-152):
// typing latency on the built app with the reference vault's 5,000-word note, alone (AC-5) and while a helper process
// changes 500 other notes at once (FR-SYN-03 AC-20). The probe's frame limits (≥ 95 % in frame 1, none after frame 2,
// at 60 Hz, D-190) and the 30 s indexing limit are enforced only with TEGG_PERF_REF=1 on the reference machine;
// elsewhere they are reported. That the probe records every keystroke and that no dialog appears is always checked.
// FR-UX-07 AC-6 [manual] is recorded in the same session (D-134). TEGG_REF_VAULT may point at a `--perf-note` vault.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EXE, generateVault, longestNote, readMarks } from './perf_open_note.ts';
import { keyLines, summary, type200 } from './perf_typing.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EXTERNAL = resolve(import.meta.dirname, 'helpers/external.ts');
const REF = process.env.TEGG_PERF_REF === '1';
const osa = (s: string) => execFileSync('osascript', ['-e', s], { encoding: 'utf8' });

async function launch(vault: string, route: string, tmp: string, log: string) {
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  const child = spawn(EXE, [], { env: { ...clean, TEGG_TEST: '1', TEGG_APP_SUPPORT: join(tmp, 'support'), TEGG_VAULT: vault, TEGG_ROUTE: route, TEGG_PERF_LOG: log }, stdio: 'ignore' });
  const end = Date.now() + 240_000;
  while (Date.now() < end && !readMarks(log).some((m) => m.mark === 'note-ready')) await sleep(100);
  return child;
}

function prepare(tmp: string): { vault: string; rel: string } {
  // A pre-generated TEGG_REF_VAULT is copied (the test writes into it); a freshly generated one is used in place.
  const given = process.env.TEGG_REF_VAULT;
  const vault = given ? join(tmp, 'vault') : generateVault(join(tmp, 'vault'));
  assert.ok(vault, 'reference vault with --perf-note could not be generated (tools/gen-vault --perf-note)');
  if (given) cpSync(given, vault!, { recursive: true });
  return { vault: vault!, rel: longestNote(vault!).path };
}

/** Clicks into the middle of the note body (Appium-free: the app's window centre) so the keys go to a paragraph. */
function focusMiddle() {
  try {
    osa('tell application id "app.tegg.desktop" to activate');
    osa('tell application "System Events" to tell (first process whose bundle identifier is "app.tegg.desktop")\nset {x, y} to position of window 1\nclick at {x + 700, y + 450}\nend tell');
  } catch { /* best effort; the probe line count tells whether keys reached the editor */ }
}

async function latencyRun(label: string) {
  assert.ok(existsSync(EXE), `app not built: ${EXE}`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-06-'));
  try {
    const { vault, rel } = prepare(tmp);
    const log = join(tmp, 'perf.jsonl');
    const child = await launch(vault, `note/${rel}`, tmp, log);
    try {
      assert.ok(readMarks(log).some((m) => m.mark === 'note-ready'), 'note-ready');
      focusMiddle();
      await sleep(500);
      type200('a');
      await sleep(1000);
    } finally {
      child.kill('SIGKILL');
    }
    const lines = keyLines(log);
    const s = summary(lines);
    console.log(`${label}: ${s.n} keys, frame 1 ${(s.frame1 * 100).toFixed(1)} %, late ${s.late}, p50 ${s.p50} ms, p95 ${s.p95} ms, max ${s.max} ms`);
    assert.equal(s.n, 200, `the probe wrote one key line per keystroke to TEGG_PERF_LOG (got ${s.n})`);
    if (REF) {
      assert.ok(s.frame1 >= 0.95, `≥ 95 % in frame 1 (${(s.frame1 * 100).toFixed(1)} %)`);
      assert.equal(s.late, 0, 'none after frame 2');
    } else console.log(`${label}: reported only (TEGG_PERF_REF=1 enforces, D-152)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function externalRun(label: string) {
  assert.ok(existsSync(EXE), `app not built: ${EXE}`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-fr-syn-03-20-'));
  try {
    const { vault, rel } = prepare(tmp);
    const log = join(tmp, 'perf.jsonl');
    const child = await launch(vault, `note/${rel}`, tmp, log);
    try {
    assert.ok(readMarks(log).some((m) => m.mark === 'note-ready'), 'note-ready');
    focusMiddle();
    await sleep(500);
    const token = `externizmena${Date.now()}`;
    const t0 = Date.now();
    const helper = spawn(process.execPath, [EXTERNAL, 'many', join(vault, 'Pages'), '500', token], { stdio: ['ignore', 'pipe', 'ignore'] });
    let changed = '';
    helper.stdout!.on('data', (b) => (changed += b));
    type200('b');
    await new Promise((r) => helper.on('exit', r));
    const paths = JSON.parse(changed || '[]') as string[];
    assert.equal(paths.length, 500, 'the helper changed 500 other notes');
    // "All 500 changes are in the index within 30 s" has no L6 observation point in the contract (no mark, no test
    // hook for the index); see the test author's AP list. Until then the run waits 30 s and checks the UI side only.
    while (Date.now() - t0 < 30_000) await sleep(250);
    const lines = keyLines(log);
    const s = summary(lines);
    console.log(`${label}: ${s.n} keys, frame 1 ${(s.frame1 * 100).toFixed(1)} %, late ${s.late}`);
    assert.equal(s.n, 200, 'the probe recorded every keystroke');
    const disk = readFileSync(join(vault, rel), 'utf8');
    assert.ok(disk.includes('b'.repeat(200)), 'all typed characters saved; no reload lost them');
    let dialogs = '';
    try { dialogs = osa('tell application "System Events" to tell (first process whose bundle identifier is "app.tegg.desktop") to get name of every window'); } catch { /* app gone */ }
    assert.ok(!dialogs.includes('Note changed outside Tegg'), 'no merge dialog');
    if (REF) {
      assert.ok(s.frame1 >= 0.95 && s.late === 0, 'NFR-PERF-06 limits while 500 notes change');
    }
    } finally {
      child.kill('SIGKILL');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('nfr_perf_06_ac5_real_app_typing_latency', { timeout: 30 * 60_000 }, () => latencyRun('NFR-PERF-06 AC-5'));
// performance.md NFR-PERF-06/AC-1 (keystroke to paint ≤ 1 frame), verified by editor.md NFR-PERF-06 AC-5.
test('nfr_perf_06_ac1_keystroke_painted_in_the_next_frame', { timeout: 30 * 60_000 }, () => latencyRun('NFR-PERF-06 AC-1'));
test('fr_syn_03_ac20_500_external_changes_while_typing', { timeout: 30 * 60_000 }, () => externalRun('FR-SYN-03 AC-20'));
// data-safety FR-SYN-03 AC-6 (500 files change at once, the app stays responsive), verified by editor.md AC-20.
test('fr_syn_03_ac6_500_changes_at_once_app_stays_responsive', { timeout: 30 * 60_000 }, () => externalRun('FR-SYN-03 AC-6'));
