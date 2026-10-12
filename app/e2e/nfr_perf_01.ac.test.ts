// NFR-PERF-01/AC-1 (docs/acceptance/performance.md): cold start to usable UI < 2 s, reference run
// at 75 % of the target (D-59) = 1500 ms, p95 of >= 20 runs. Interface: docs/contracts/ms2-shell.md §1
// (TEGG_TEST, TEGG_APP_SUPPORT, TEGG_VAULT, TEGG_PERF_LOG, TEGG_EXIT_AFTER; marks `ui-ready`, `index-ready`).
//
// "Launch after reboot cache flush" is approximated by fresh processes: the OS file cache stays warm
// between launches. The true cold-start check is MS8 on the reference machine (test-strategy, D-59).
// Never touches the owner's Application Support or vault (D-62): TEGG_TEST=1 plus temp dirs always.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const APP = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app');
const EXE = join(APP, 'Contents/MacOS/tegg');
const RUNS = 20;
const TARGET_MS = 2000;
const LIMIT_MS = TARGET_MS * 0.75; // D-59
const LAUNCH_TIMEOUT_MS = 60_000;
const INDEX_TIMEOUT_MS = 180_000;

type Mark = { mark: string; ms: number };

function readMarks(file: string): Mark[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Mark);
}

function launch(env: Record<string, string>, timeoutMs: number): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((res, rej) => {
    const child = spawn(EXE, [], { env: { ...process.env, ...env }, stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rej(new Error(`launch did not exit within ${timeoutMs} ms (TEGG_EXIT_AFTER=${env.TEGG_EXIT_AFTER})`));
    }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); rej(e); });
    child.on('exit', (code, signal) => { clearTimeout(timer); res({ code, signal }); });
  });
}

function p95(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.ceil(0.95 * s.length) - 1];
}

test('nfr_perf_01_ac1_cold_start_to_ui_ready_p95_under_1500ms', { timeout: 30 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);

  const tmp = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-01-'));
  try {
    let vault = process.env.TEGG_REF_VAULT;
    if (!vault) {
      vault = join(tmp, 'vault');
      execFileSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'),
        '--', '--seed', '1', '--small-images', '--out', vault], { stdio: 'inherit' });
    }
    const appSupport = join(tmp, 'app-support');
    const base = { TEGG_TEST: '1', TEGG_APP_SUPPORT: appSupport, TEGG_VAULT: vault };

    // Precondition "index already built": one warm-up launch until the first catch-up is done.
    const warmLog = join(tmp, 'warmup.jsonl');
    const warm = await launch({ ...base, TEGG_PERF_LOG: warmLog, TEGG_EXIT_AFTER: 'index-ready' }, INDEX_TIMEOUT_MS);
    assert.equal(warm.code, 0, `warm-up exit code (signal ${warm.signal})`);
    assert.ok(readMarks(warmLog).some((m) => m.mark === 'index-ready'), 'warm-up wrote the index-ready mark');

    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const log = join(tmp, `run-${i}.jsonl`);
      const r = await launch({ ...base, TEGG_PERF_LOG: log, TEGG_EXIT_AFTER: 'ui-ready' }, LAUNCH_TIMEOUT_MS);
      assert.equal(r.code, 0, `run ${i}: exit code (signal ${r.signal})`);
      const marks = readMarks(log).filter((m) => m.mark === 'ui-ready');
      assert.equal(marks.length, 1, `run ${i}: exactly one ui-ready mark`);
      assert.equal(typeof marks[0].ms, 'number');
      assert.ok(Number.isFinite(marks[0].ms) && marks[0].ms > 0, `run ${i}: ui-ready ms is a positive number`);
      times.push(marks[0].ms);
    }
    assert.equal(times.length, RUNS);
    const v = p95(times);
    console.log(`NFR-PERF-01 cold start to ui-ready: p95 ${v.toFixed(1)} ms over ${RUNS} runs (limit ${LIMIT_MS} ms; min ${Math.min(...times).toFixed(1)}, max ${Math.max(...times).toFixed(1)})`);
    assert.ok(v < LIMIT_MS, `p95 ${v.toFixed(1)} ms must be < ${LIMIT_MS} ms`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
