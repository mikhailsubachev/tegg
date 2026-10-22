// Unit test for the `nice` step field (CONTRACT §2, §3.2.2): tree gates start the step at that niceness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertExit, describe, makeRepo, verify } from './helpers.ts';

test('a step with nice 10 runs its shell at niceness 10 in a tree gate and at 0 in the commit gate', (t) => {
  const repo = makeRepo(t, { config: { steps: [{ id: 'n', run: 'echo niceness=$(ps -o nice= -p $$ | tr -d " ")', level: 'commit', nice: 10 } as any] } });
  const push = verify(repo, ['push']);
  assertExit(push, 0, 'verify push');
  assert.match(push.stdout, /niceness=10/, `the step ran under nice -n 10\n${describe(push)}`);
  const commit = verify(repo, ['commit']);
  assertExit(commit, 0, 'verify commit');
  assert.match(commit.stdout, /niceness=0/, `the commit gate ignores nice\n${describe(commit)}`);
});
