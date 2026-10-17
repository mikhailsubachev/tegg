// D-343: two gates of the same repository can run at once (stable worktree path plus fall-back path), so each run's
// steps get their own free dev-server port in VERIFY_PORT_BASE (CONTRACT §2.1, §3.2.1) instead of a fixed one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { assertExit, makeRepo, readText, sq, tmpDir, verify } from './helpers.ts';
import { gatePortBase } from '../src/gates.ts';

test('push_gate_steps_get_a_free_port_in_VERIFY_PORT_BASE', async (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'env', level: 'push', run: `printf '%s\\n' "\${VERIFY_PORT_BASE-unset}" > ${sq(path.join(out, 'env'))}` }] },
  });
  assertExit(verify(repo, ['push']), 0, 'verify push');
  const port = Number(readText(path.join(out, 'env'), 'push step env').trim());
  assert.ok(Number.isInteger(port) && port >= 20000 && port <= 29999, `a port in the gate range: ${port}`);
  await new Promise<void>((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(port, () => s.close(() => resolve()));
  });
});

test('commit_gate_steps_get_no_port', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'env', level: 'commit', run: `printf '%s\\n' "\${VERIFY_PORT_BASE-unset}" > ${sq(path.join(out, 'env'))}` }] },
  });
  assertExit(verify(repo, ['commit']), 0, 'verify commit');
  assert.equal(readText(path.join(out, 'env'), 'commit step env').trim(), 'unset');
});

test('two_runs_of_the_same_repository_get_different_ports', () => {
  // The stable worktree path and the fall-back temporary path of a concurrent gate give different candidates…
  const a = gatePortBase('/tmp/tegg-verify-0123456789ab/wt', () => true);
  const b = gatePortBase('/tmp/tegg-verify-XyZ123/wt', () => true);
  assert.notEqual(a, b);
  // …and a candidate that is in use (the other gate's server) is skipped, wrapping inside the range.
  assert.equal(gatePortBase('/tmp/tegg-verify-0123456789ab/wt', (p) => p !== a), a === 29999 ? 20000 : a + 1);
});
