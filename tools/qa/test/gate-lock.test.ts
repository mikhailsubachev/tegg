// D-1330: one gate at a time on this machine (CONTRACT §3.5). Parallel gates made timing-sensitive WebKit tests
// fail falsely, so the heavy commands wait for a machine-wide lock; `verify commit` doesn't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { assertExit, makeRepo, output, tmpDir, verify } from './helpers.ts';

/** A lock held by a live process, as a running gate leaves it. Returns a function that releases it. */
function holdLock(dir: string): () => void {
  const child = spawn('sleep', ['60'], { stdio: 'ignore' });
  const lock = path.join(dir, 'gate.lock');
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: child.pid, command: 'push', checkout: '/elsewhere', started: 'now' }));
  return () => {
    child.kill();
    fs.rmSync(lock, { recursive: true, force: true });
  };
}

const env = (dir: string) => ({ VERIFY_GATE_LOCK_DIR: dir, VERIFY_GATE_LOCK_POLL_MS: '100' });

test('push_waits_while_another_gate_holds_the_lock', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  const release = holdLock(dir);
  t.after(release);
  const r = verify(repo, ['push'], { env: env(dir), timeout: 3000 });
  assert.equal(r.status, null, `still waiting when the timeout killed it:\n${output(r)}`);
  assert.match(r.stdout, /waiting for push in \/elsewhere/);
  release();
  assertExit(verify(repo, ['push'], { env: env(dir) }), 0, 'verify push once the lock is free');
});

test('a_finished_gate_releases_the_lock', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  assertExit(verify(repo, ['push'], { env: env(dir) }), 0, 'verify push');
  assert.equal(fs.existsSync(path.join(dir, 'gate.lock')), false);
});

test('a_lock_left_by_an_exited_process_is_taken_over', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  const lock = path.join(dir, 'gate.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: 2 ** 22 + 1, command: 'push', checkout: '/gone', started: 'then' }));
  assertExit(verify(repo, ['push'], { env: env(dir), timeout: 20_000 }), 0, 'verify push over a stale lock');
  assert.equal(fs.existsSync(lock), false);
});

test('merge_and_check_red_wait_too', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  t.after(holdLock(dir));
  for (const args of [['merge', '--base', 'main'], ['check-red', 'HEAD']]) {
    const r = verify(repo, args, { env: env(dir), timeout: 3000 });
    assert.equal(r.status, null, `verify ${args[0]} still waiting:\n${output(r)}`);
  }
});

test('commit_gate_does_not_wait', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  t.after(holdLock(dir));
  assertExit(verify(repo, ['commit'], { env: env(dir), timeout: 20_000 }), 0, 'verify commit with the lock held');
});

test('a_verify_started_inside_a_gate_does_not_wait_for_it', (t) => {
  const dir = tmpDir(t, 'tegg-qa-lock-');
  const repo = makeRepo(t);
  t.after(holdLock(dir));
  assertExit(verify(repo, ['push'], { env: { ...env(dir), VERIFY_GATE_LOCK_HELD: '1' }, timeout: 20_000 }), 0, 'nested verify push');
});
