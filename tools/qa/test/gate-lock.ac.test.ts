// TS-VERIFY AC-8 (D-1330): the parts of the one-gate-at-a-time lock that CONTRACT §3.5 adds or tightens. Black box
// against tools/qa/CONTRACT.md §3.5: usage errors before the lock, the atomic owner record, the stale rules (no
// owner record, reused pid, restart), release only after the step processes ended, and the test helpers' cleanup.
// Every test uses its own lock folder (tests run with --test-concurrency=2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { assertExit, countLines, headSha, makeRepo, markStep, REPO_ROOT, tmpDir, verify, ZERO_SHA } from './helpers.ts';
import {
  bootTime, describeAsync, exitWithin, holdLock, isAlive, killQuietly, lockEnv, procStartOf, readOwner, sleepMs,
  startVerify, waitUntil,
} from './gate-lock-helpers.ts';

test('ts_verify_ac8_lock_released_only_after_lane_steps_ended', async (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const out = tmpDir(t, 'tegg-qa-out-');
  const pidFile = path.join(out, 'step.pid');
  const repo = makeRepo(t, {
    config: {
      steps: [
        { id: 'orphan', run: `echo $$ > '${pidFile}'; exec sleep 30`, level: 'push', lane: 'a' },
        { id: 'other', run: 'sleep 30', level: 'push', lane: 'b' },
      ],
    },
  });
  const run = startVerify(t, repo, ['push'], lockEnv(dir));
  const lock = path.join(dir, 'gate.lock');
  const readPid = () => {
    const s = fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8').trim() : '';
    return /^\d+$/.test(s) ? Number(s) : 0;
  };
  assert.ok(await waitUntil(() => readPid() > 0 && fs.existsSync(lock), 20_000), `the step starts\n${describeAsync(run)}`);
  const stepPid = readPid();
  t.after(() => killQuietly(stepPid));
  await sleepMs(200); // the step has exec'd sleep
  process.kill(run.pid, 'SIGTERM');
  let lockGoneWhileStepAlive = false;
  const sampler = setInterval(() => {
    if (!fs.existsSync(lock) && isAlive(stepPid)) lockGoneWhileStepAlive = true;
  }, 5);
  const exit = await exitWithin(run, 20_000);
  clearInterval(sampler);
  assert.notEqual(exit, 'timeout', `verify push exits after SIGTERM\n${describeAsync(run)}`);
  await sleepMs(300); // let launchd reap anything the gate left behind
  assert.equal(isAlive(stepPid), false, `the step process (pid ${stepPid}) has ended once verify exited\n${describeAsync(run)}`);
  assert.equal(lockGoneWhileStepAlive, false, 'the lock was never gone while the step process was still running');
  assert.equal(fs.existsSync(lock), false, 'the lock is gone once verify exited');
});

async function gateHoldingTheLock(t: any) {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const marker = path.join(tmpDir(t, 'tegg-qa-out-'), 'started');
  const repo = makeRepo(t, { config: { steps: [{ id: 'slow', run: markStep(marker, 'sleep 3'), level: 'push' }] } });
  return { dir, marker, repo };
}

test('ts_verify_ac8_owner_record_has_pid_command_checkout_started_id_procstart_boot', async (t) => {
  const { dir, marker, repo } = await gateHoldingTheLock(t);
  const run = startVerify(t, repo, ['push'], lockEnv(dir));
  assert.ok(await waitUntil(() => fs.existsSync(marker), 20_000), `the step starts\n${describeAsync(run)}`);
  const owner = readOwner(dir);
  const start = procStartOf(run.pid);
  await exitWithin(run, 20_000);
  assert.equal(owner.pid, run.pid, `owner.pid is the verify process: ${JSON.stringify(owner)}`);
  assert.equal(owner.command, 'push', `owner.command: ${JSON.stringify(owner)}`);
  assert.equal(owner.checkout, repo, `owner.checkout is the checkout verify runs in: ${JSON.stringify(owner)}`);
  assert.equal(typeof owner.started, 'string', `owner.started: ${JSON.stringify(owner)}`);
  assert.ok(!Number.isNaN(Date.parse(owner.started)), `owner.started is ISO 8601: ${JSON.stringify(owner)}`);
  assert.equal(typeof owner.id, 'string', `owner.id is a string: ${JSON.stringify(owner)}`);
  assert.ok(owner.id.length > 0, `owner.id is not empty: ${JSON.stringify(owner)}`);
  if (process.platform === 'darwin') {
    assert.equal(owner.procStart, start, `owner.procStart is ps -o lstart= of the owner: ${JSON.stringify(owner)}`);
    assert.equal(owner.boot, bootTime(), `owner.boot is kern.boottime in seconds: ${JSON.stringify(owner)}`);
  }
});

/**
 * A separate node process that polls `gate.lock` in a tight loop while the file `active` exists (best-effort: a
 * non-atomic mkdir + write leaves a window of well under a millisecond) until `stop` exists, then writes
 * `{ samples, bad: [...] }` to `out`.
 */
const SAMPLER = `
const fs = require('fs'), path = require('path');
const [lock, active, ready, stop, out] = process.argv.slice(1);
const bad = []; let samples = 0;
fs.writeFileSync(ready, 'ready');
while (!fs.existsSync(stop)) {
  if (!fs.existsSync(active) || !fs.existsSync(lock)) continue;
  samples++;
  try { JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8')); }
  catch (e) { if (fs.existsSync(lock) && bad.length < 10) bad.push(String(e)); }
}
fs.writeFileSync(out, JSON.stringify({ samples, bad }));
`;

test('ts_verify_ac8_lock_folder_never_seen_without_owner_record', async (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const work = tmpDir(t, 'tegg-qa-out-');
  const marker = path.join(work, 'started');
  const repo = makeRepo(t, { config: { steps: [{ id: 'slow', run: markStep(marker, 'sleep 1'), level: 'push' }] } });
  const [active, ready, stop, out] = ['active', 'ready', 'stop', 'out.json'].map((f) => path.join(work, f));
  const sampler = spawn(process.execPath, ['-e', SAMPLER, path.join(dir, 'gate.lock'), active, ready, stop, out], { stdio: 'ignore' });
  t.after(() => killQuietly(sampler.pid));
  const samplerExited = new Promise((r) => sampler.on('exit', r));
  assert.ok(await waitUntil(() => fs.existsSync(ready), 10_000), 'the sampler starts');
  // Several gates in a row; sample while each takes the lock and stop once its step runs (the release isn't part
  // of this rule).
  for (let i = 1; i <= 4; i++) {
    fs.writeFileSync(active, 'on');
    const run = startVerify(t, repo, ['push'], lockEnv(dir));
    const started = await waitUntil(() => countLines(marker) >= i, 20_000);
    fs.rmSync(active, { force: true });
    await exitWithin(run, 20_000);
    assert.ok(started, `gate ${i} ran its step\n${describeAsync(run)}`);
  }
  fs.writeFileSync(stop, 'stop');
  await samplerExited;
  const result = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(result.samples > 0, `the sampler saw the lock: ${JSON.stringify(result)}`);
  assert.deepEqual(result.bad, [], 'gate.lock was seen without a readable owner.json');
});

test('ts_verify_ac8_lock_without_owner_record_is_taken_over_at_once', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  const lock = path.join(dir, 'gate.lock');
  fs.mkdirSync(lock);
  const started = Date.now();
  const r = verify(repo, ['push'], { env: lockEnv(dir), timeout: 10_000 });
  const took = Date.now() - started;
  assertExit(r, 0, 'verify push over a gate.lock without owner.json');
  assert.ok(took < 10_000, `took over at once (${took} ms)`);
  assert.equal(fs.existsSync(lock), false, 'the lock is gone after the gate');
});

test('ts_verify_ac8_lock_with_reused_pid_proc_start_mismatch_is_taken_over', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  holdLock(t, dir, () => ({ procStart: 'Thu Jan  1 00:00:00 1970' }));
  const r = verify(repo, ['push'], { env: lockEnv(dir), timeout: 15_000 });
  assertExit(r, 0, 'verify push over a lock whose procStart belongs to another process');
});

test('ts_verify_ac8_lock_from_before_a_restart_boot_mismatch_is_taken_over', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  holdLock(t, dir, () => ({ boot: 1 }));
  const r = verify(repo, ['push'], { env: lockEnv(dir), timeout: 15_000 });
  assertExit(r, 0, 'verify push over a lock with a wrong boot time');
});

function assertUsageErrorAtOnce(t: any, args: string[], extra: Record<string, string> = {}, input?: string) {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  holdLock(t, dir);
  const r = verify(repo, args, { env: lockEnv(dir, extra), timeout: 5000, input });
  assertExit(r, 2, `verify ${args.join(' ')} ${JSON.stringify(extra)}: usage error while another gate holds the lock`);
}

test('ts_verify_ac8_usage_error_milestone_without_option_exits_2_without_waiting', (t) => {
  assertUsageErrorAtOnce(t, ['milestone']);
});

test('ts_verify_ac8_usage_error_check_red_without_commit_exits_2_without_waiting', (t) => {
  assertUsageErrorAtOnce(t, ['check-red']);
});

test('ts_verify_ac8_usage_error_check_red_unknown_commit_exits_2_without_waiting', (t) => {
  assertUsageErrorAtOnce(t, ['check-red', 'no-such-revision-žluťoučký']);
});

test('ts_verify_ac8_usage_error_bad_lanes_option_exits_2_without_waiting', (t) => {
  assertUsageErrorAtOnce(t, ['push', '--lanes', '3']);
});

test('ts_verify_ac8_usage_error_bad_lanes_variable_exits_2_without_waiting', (t) => {
  assertUsageErrorAtOnce(t, ['push'], { VERIFY_LANES: '3' });
});

test('ts_verify_ac8_usage_error_hook_pre_push_bad_lanes_variable_exits_2_without_waiting', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  holdLock(t, dir);
  const line = `refs/heads/main ${headSha(repo)} refs/heads/main ${ZERO_SHA}\n`;
  const r = verify(repo, ['hook', 'pre-push', 'origin', 'file:///nowhere'], { env: lockEnv(dir, { VERIFY_LANES: '3' }), timeout: 5000, input: line });
  assertExit(r, 2, 'verify hook pre-push with VERIFY_LANES=3 while another gate holds the lock');
});

test('ts_verify_ac8_test_helpers_remove_their_lock_dir_on_exit', (t) => {
  const work = tmpDir(t, 'tegg-qa-out-');
  const script = path.join(work, 'child.ts');
  const helpers = path.join(REPO_ROOT, 'tools', 'qa', 'test', 'helpers.ts');
  fs.writeFileSync(script, [
    `import { makeRepo, verify, TEST_GATE_LOCK_DIR } from ${JSON.stringify(helpers)};`,
    `const cleanups: Array<() => void> = [];`,
    `const repo = makeRepo({ after: (fn: () => void) => cleanups.push(fn) });`,
    `const r = verify(repo, ['push']);`,
    `for (const fn of cleanups.reverse()) fn();`,
    `console.log(JSON.stringify({ status: r.status, dir: TEST_GATE_LOCK_DIR, existed: (await import('node:fs')).existsSync(TEST_GATE_LOCK_DIR) }));`,
    '',
  ].join('\n'));
  const r = spawnSync(process.execPath, [script], { cwd: work, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' } });
  const lastLine = (r.stdout ?? '').trim().split('\n').pop() ?? '';
  let info: any;
  try {
    info = JSON.parse(lastLine);
  } catch {
    assert.fail(`the child script prints its result\nstatus ${r.status}\n${r.stdout}\n${r.stderr}`);
  }
  t.after(() => fs.rmSync(info.dir, { recursive: true, force: true }));
  assert.equal(info.status, 0, `verify push in the child passes\n${r.stderr}`);
  assert.equal(info.existed, true, `verify push created ${info.dir}`);
  assert.equal(fs.existsSync(info.dir), false, `${info.dir} is removed when the test process exits`);
});
