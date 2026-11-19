// Regressions for the QA review of the gate changes D-1831…D-1834 (TS-VERIFY AC-6, AC-9, AC-12; CONTRACT §2,
// §3.2.3, §3.2.5). Black box, like the AC tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addWorktree, assertExit, commitAll, countLines, describe, findStep, lastSummary, makeRepo, markStep, sq, tmpDir, verify, writeFiles, type Step } from './helpers.ts';

const XML =
  '<testsuites><testsuite name="s" tests="2"><testcase name="běží a" classname="t/a.test.txt"/><testcase name="běží b" classname="t/b.test.txt"/></testsuite></testsuites>';

/** A step with two test files whose report always says both passed; `exit-1` in `ctl` makes it fail anyway, `hang` makes it sleep. */
function partialRepo(t: any, step: Partial<Step> = {}) {
  const ctl = tmpDir(t, 'tegg-qa-ctl-');
  const log = path.join(ctl, 'args.log');
  const run = `echo "ARGS:{files}" >> ${sq(log)}; printf '%s' ${sq(XML)} > "$VERIFY_RESULTS/unit.xml"; if [ -e ${sq(path.join(ctl, 'hang'))} ]; then sleep 30; fi; test ! -e ${sq(path.join(ctl, 'exit-1'))}`;
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'unit', run, level: 'push', inputs: ['t'], testFiles: '^t/[^/]+\\.test\\.txt$', ...step }] },
    files: { 't/a.test.txt': 'test A: žluťoučký kůň\n', 't/b.test.txt': 'test B: úpěl ďábelské ódy\n' },
  });
  const args = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { repo, ctl, args };
}

test('bug_qagate_ts_verify_ac12_a_failed_run_that_names_no_failed_file_runs_in_full_again', (t) => {
  const f = partialRepo(t);
  fs.writeFileSync(path.join(f.ctl, 'exit-1'), '');
  const r1 = verify(f.repo, ['push']);
  assertExit(r1, 1, 'the step fails although its report says every test passed');
  fs.rmSync(path.join(f.ctl, 'exit-1'));
  writeFiles(f.repo, { 't/a.test.txt': 'test A: změna\n' });
  commitAll(f.repo, 'Change one test file');
  const r2 = verify(f.repo, ['push']);
  assertExit(r2, 0, 'the next push');
  assert.equal(f.args().at(-1), 'ARGS:', `the failure wasn't tied to a file, so every test file runs again\n${describe(r2)}`);
  assert.ok(!findStep(lastSummary(f.repo, 'push'), 'unit').partial, 'the run is not partial');
});

test('bug_qagate_ts_verify_ac12_a_timed_out_run_runs_in_full_again', (t) => {
  const f = partialRepo(t, { timeout: 1 });
  fs.writeFileSync(path.join(f.ctl, 'hang'), '');
  const r1 = verify(f.repo, ['push'], { timeout: 25_000 });
  assertExit(r1, 1, 'the step is stopped by its timeout');
  assert.equal(findStep(lastSummary(f.repo, 'push'), 'unit').timedOut, true, describe(r1));
  fs.rmSync(path.join(f.ctl, 'hang'));
  writeFiles(f.repo, { 't/a.test.txt': 'test A: změna\n' });
  commitAll(f.repo, 'Change one test file');
  const r2 = verify(f.repo, ['push']);
  assertExit(r2, 0, 'the next push');
  assert.equal(f.args().at(-1), 'ARGS:', `a timed-out run's report isn't trusted, so every test file runs again\n${describe(r2)}`);
});

test('bug_qagate_ts_verify_ac9_a_failure_in_one_checkout_removes_the_pass_for_the_others', (t) => {
  const counter = path.join(tmpDir(t, 'tegg-qa-counter-'), 'runs.log');
  const bad = path.join(tmpDir(t, 'tegg-qa-ctl-'), 'fail');
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'memo', run: markStep(counter, `test ! -e ${sq(bad)}`), level: 'push', inputs: ['src'] }] },
    files: { 'src/a.txt': 'Příliš žluťoučký kůň\n' },
  });
  assertExit(verify(repo, ['push']), 0, 'first push in the main checkout');
  const wt = addWorktree(t, repo, 'feature');
  assertExit(verify(wt, ['push']), 0, 'push in the worktree');
  assert.equal(findStep(lastSummary(wt, 'push'), 'memo').result, 'skipped', 'the worktree reuses the pass (and now holds it in its own memo)');
  // The full run finds the step broken (an input the step didn't declare).
  fs.writeFileSync(bad, '');
  assertExit(verify(repo, ['push', '--all']), 1, 'push --all in the main checkout fails');
  fs.rmSync(bad);
  const runsBefore = countLines(counter);
  const r = verify(wt, ['push']);
  assertExit(r, 0, 'the next push in the worktree');
  assert.equal(countLines(counter), runsBefore + 1, `the worktree's own copy of the pass no longer counts: the step runs\n${describe(r)}`);
  assert.equal(findStep(lastSummary(wt, 'push'), 'memo').result, 'pass');
  // And the pass of that run counts everywhere again.
  assertExit(verify(repo, ['push']), 0, 'push in the main checkout');
  assert.equal(findStep(lastSummary(repo, 'push'), 'memo').result, 'skipped', 'the new pass is shared');
});

test('bug_qagate_ts_verify_ac12_files_placeholder_without_test_files_exits_2', (t) => {
  const repo = makeRepo(t, { config: { steps: [{ id: 'unit', run: 'echo {files}', level: 'push' }] } });
  const r = verify(repo, ['push']);
  assertExit(r, 2, 'a step whose command has {files} but no testFiles');
  assert.ok(r.stderr.includes('{files}'), describe(r));
});
