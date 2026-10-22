// Regression for a step-memo bug found in PR #54 (TS-VERIFY AC-6, CONTRACT §3.2.3, TS-D2): when a step's `dir`
// lies inside one of its `inputs`, the always-added `<dir>/package-lock.json` made `git ls-tree` descend into that
// directory instead of listing it, so the directory's object id was never part of the key and a change under it
// did not run the step again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { assertExit, commitAll, countLines, describe, findStep, lastSummary, makeRepo, markStep, tmpDir, verify, writeFiles } from './helpers.ts';

const LOCK = '{"name":"pkg","lockfileVersion":3,"requires":true,"packages":{"":{"name":"pkg"}}}\n';

test('bug_pr54_ts_verify_ac6_change_under_an_input_that_contains_the_step_dir_runs_the_step_again', (t) => {
  const counter = path.join(tmpDir(t, 'tegg-qa-counter-'), 'runs.log');
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'memo', run: markStep(counter), level: 'push', dir: 'pkg', inputs: ['pkg'] }] },
    files: { 'pkg/src/a.txt': 'Příliš žluťoučký kůň\n', 'pkg/package.json': '{"name":"pkg","private":true}\n', 'pkg/package-lock.json': LOCK },
  });
  const r1 = verify(repo, ['push']);
  assertExit(r1, 0, 'first push');
  assert.equal(countLines(counter), 1, `first push runs the step\n${describe(r1)}`);
  const r2 = verify(repo, ['push']);
  assertExit(r2, 0, 'second push');
  assert.equal(countLines(counter), 1, `unchanged inputs: skipped\n${describe(r2)}`);
  assert.equal(findStep(lastSummary(repo, 'push'), 'memo').result, 'skipped');
  writeFiles(repo, { 'pkg/src/a.txt': 'úpěl ďábelské ódy\n' });
  commitAll(repo, 'Change a file under the input that contains the step dir');
  const r3 = verify(repo, ['push']);
  assertExit(r3, 0, 'push after the change');
  assert.equal(countLines(counter), 2, `a change under pkg/ (the input that also holds the step's lockfile) runs the step again\n${describe(r3)}`);
  assert.equal(findStep(lastSummary(repo, 'push'), 'memo').result, 'pass');
});
