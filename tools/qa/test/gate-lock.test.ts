// TS-VERIFY AC-8 (D-1330): one gate at a time on this machine. Black box against tools/qa/CONTRACT.md §3.5.
// Parallel gates made timing-sensitive WebKit tests fail falsely, so the heavy commands wait for a machine-wide
// lock; `verify commit` doesn't. Every test uses its own lock folder (tests run with --test-concurrency=2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assertExit, describe, headSha, makeRepo, markStep, output, REPO_ROOT, tmpDir, verify, ZERO_SHA } from './helpers.ts';
import {
  describeAsync, exitWithin, holdLock, lockEnv, procStartOf, settlesWithin, startVerify, waitUntil,
} from './gate-lock-helpers.ts';

const WAITING = /waiting for push in \/elsewhere/;

function assertWaits(repo: string, args: string[], dir: string, what: string, input?: string) {
  const r = verify(repo, args, { env: lockEnv(dir), timeout: 3000, input });
  assert.equal(r.status, null, `${what}: still waiting when the timeout killed it\n${describe(r)}`);
  assert.match(r.stdout, WAITING, `${what}: prints a waiting line naming the owner's command and checkout\n${describe(r)}`);
}

// ---------------------------------------------------------------------------
// Which commands wait
// ---------------------------------------------------------------------------

test('ts_verify_ac8_push_waits_while_another_gate_holds_the_lock', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  const { release } = holdLock(t, dir);
  assertWaits(repo, ['push'], dir, 'verify push');
  release();
  assertExit(verify(repo, ['push'], { env: lockEnv(dir) }), 0, 'verify push once the lock is free');
});

test('ts_verify_ac8_merge_waits_and_prints_waiting_line', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  holdLock(t, dir);
  assertWaits(repo, ['merge', '--base', 'main'], dir, 'verify merge');
});

test('ts_verify_ac8_merge_behind_its_base_exits_1_without_waiting', (t) => {
  // CONTRACT §3.5, §11: the base check needs no wait for the lock.
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  holdLock(t, dir);
  const r = verify(repo, ['merge', '--base', 'nowhere-ahead'], { env: lockEnv(dir), timeout: 5000 });
  assert.equal(r.status, 1, `verify merge with a base HEAD doesn't contain\n${describe(r)}`);
  assert.match(r.stderr, /merge nowhere-ahead first/);
  assert.doesNotMatch(r.stdout, WAITING);
});

test('ts_verify_ac8_check_red_waits_and_prints_waiting_line', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  holdLock(t, dir);
  assertWaits(repo, ['check-red', 'HEAD'], dir, 'verify check-red HEAD');
});

test('ts_verify_ac8_hook_pre_push_waits_when_it_runs_the_push_gate', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  fs.mkdirSync(path.join(repo, '.verify'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.verify', 'last-pass'), `${'1'.repeat(40)}\n`);
  holdLock(t, dir);
  const line = `refs/heads/main ${headSha(repo)} refs/heads/main ${ZERO_SHA}\n`;
  assertWaits(repo, ['hook', 'pre-push', 'origin', 'file:///nowhere'], dir, 'verify hook pre-push', line);
});

test('ts_verify_ac8_nightly_waits', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  holdLock(t, dir);
  assertWaits(repo, ['nightly'], dir, 'verify nightly');
});

test('ts_verify_ac8_milestone_waits', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  holdLock(t, dir);
  assertWaits(repo, ['milestone', '--milestone', 'MS1'], dir, 'verify milestone --milestone MS1');
});

test('ts_verify_ac8_release_waits', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  holdLock(t, dir);
  assertWaits(repo, ['release'], dir, 'verify release');
});

test('ts_verify_ac8_commit_gate_does_not_wait', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  holdLock(t, dir);
  assertExit(verify(repo, ['commit'], { env: lockEnv(dir), timeout: 20_000 }), 0, 'verify commit with the lock held');
});

test('ts_verify_ac8_run_with_lock_held_variable_does_not_wait', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  holdLock(t, dir);
  const r = verify(repo, ['push'], { env: lockEnv(dir, { VERIFY_GATE_LOCK_HELD: '1' }), timeout: 20_000 });
  assertExit(r, 0, 'nested verify push');
});

test('ts_verify_ac8_playwright_global_setup_returns_at_once_inside_a_gate', async (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  holdLock(t, dir);
  const saved = { dir: process.env.VERIFY_GATE_LOCK_DIR, held: process.env.VERIFY_GATE_LOCK_HELD };
  t.after(() => {
    if (saved.dir === undefined) delete process.env.VERIFY_GATE_LOCK_DIR;
    else process.env.VERIFY_GATE_LOCK_DIR = saved.dir;
    if (saved.held === undefined) delete process.env.VERIFY_GATE_LOCK_HELD;
    else process.env.VERIFY_GATE_LOCK_HELD = saved.held;
  });
  process.env.VERIFY_GATE_LOCK_DIR = dir;
  process.env.VERIFY_GATE_LOCK_HELD = '1';
  let setup: (() => Promise<void>) | undefined;
  try {
    setup = (await import(path.join(REPO_ROOT, 'app', 'webkit', 'gate-lock.setup.ts'))).default;
  } catch (e) {
    assert.fail(`app/webkit/gate-lock.setup.ts must load: ${e}`);
  }
  assert.equal(typeof setup, 'function', 'the Playwright globalSetup is the default export');
  const result = await settlesWithin(setup!(), 2000);
  assert.equal(result, 'resolved', 'globalSetup returns at once while VERIFY_GATE_LOCK_HELD is set');
});

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

test('ts_verify_ac8_a_finished_gate_releases_the_lock', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  assertExit(verify(repo, ['push'], { env: lockEnv(dir) }), 0, 'verify push');
  assert.equal(fs.existsSync(path.join(dir, 'gate.lock')), false, 'the lock is gone after the gate');
});

async function releasedOnSignal(t: any, signal: NodeJS.Signals) {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const marker = path.join(tmpDir(t, 'tegg-qa-out-'), 'started');
  const repo = makeRepo(t, { config: { steps: [{ id: 'slow', run: markStep(marker, 'sleep 30'), level: 'push' }] } });
  const run = startVerify(t, repo, ['push'], lockEnv(dir));
  const lock = path.join(dir, 'gate.lock');
  assert.ok(await waitUntil(() => fs.existsSync(lock) && fs.existsSync(marker), 20_000),
    `the gate takes the lock and starts its step\n${describeAsync(run)}`);
  process.kill(run.pid, signal);
  const exit = await exitWithin(run, 20_000);
  assert.notEqual(exit, 'timeout', `verify push exits after ${signal}\n${describeAsync(run)}`);
  assert.equal(fs.existsSync(lock), false, `the lock is removed on ${signal}\n${describeAsync(run)}`);
}

test('ts_verify_ac8_lock_released_on_sigint', async (t) => {
  await releasedOnSignal(t, 'SIGINT');
});

test('ts_verify_ac8_lock_released_on_sigterm', async (t) => {
  await releasedOnSignal(t, 'SIGTERM');
});

// ---------------------------------------------------------------------------
// Stale locks
// ---------------------------------------------------------------------------

test('ts_verify_ac8_lock_of_an_exited_process_is_taken_over', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  const lock = path.join(dir, 'gate.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: 2 ** 22 + 1, command: 'push', checkout: '/gone', started: 'then', id: 'gone' }));
  assertExit(verify(repo, ['push'], { env: lockEnv(dir), timeout: 20_000 }), 0, 'verify push over a stale lock');
  assert.equal(fs.existsSync(lock), false);
});

test('ts_verify_ac8_lock_with_matching_proc_start_and_no_boot_still_waits', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  holdLock(t, dir, (pid) => ({ procStart: procStartOf(pid) }));
  assertWaits(repo, ['push'], dir, 'verify push behind a live owner with the right procStart');
});

// ---------------------------------------------------------------------------
// No lock folder
// ---------------------------------------------------------------------------

test('ts_verify_ac8_lock_folder_cannot_be_created_warns_and_runs', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const file = path.join(out, 'a-regular-file');
  fs.writeFileSync(file, 'není složka\n');
  const repo = makeRepo(t);
  const r = verify(repo, ['push'], { env: lockEnv(path.join(file, 'locks')), timeout: 20_000 });
  assertExit(r, 0, 'verify push without a lock folder');
  assert.ok(r.stderr.includes('without the one-gate-at-a-time lock'), `stderr warns about running without the lock\n${output(r)}`);
});
