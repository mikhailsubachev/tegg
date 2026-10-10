// TS-VERIFY: the ./verify entry point (D-60). Black box against tools/qa/CONTRACT.md §1–§3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT, assertExit, commitAll, describe, findCheck, findStep, git, gitTry, headSha, lastSummary,
  makeRepo, markStep, readText, sq, tmpDir, treeOf, verify, writeFiles, junitXml,
} from './helpers.ts';

// ---------------------------------------------------------------------------
// AC-1: gates run their steps and exit non-zero if any step fails
// ---------------------------------------------------------------------------

test('ts_verify_ac1_commit_gate_exits_0_when_all_steps_pass', (t) => {
  const repo = makeRepo(t, { config: { steps: [{ id: 'ok', run: 'true', level: 'commit' }] } });
  assertExit(verify(repo, ['commit']), 0, 'verify commit with a passing step');
});

test('ts_verify_ac1_commit_gate_exits_1_when_a_step_fails', (t) => {
  const repo = makeRepo(t, { config: { steps: [{ id: 'broken', run: "sh -c 'exit 1'", level: 'commit' }] } });
  assertExit(verify(repo, ['commit']), 1, 'verify commit with a failing step');
});

test('ts_verify_ac1_push_gate_exits_1_when_a_push_step_fails', (t) => {
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'ok', run: 'true', level: 'commit' }, { id: 'broken', run: 'exit 3', level: 'push' }] },
  });
  assertExit(verify(repo, ['push']), 1, 'verify push with a failing push-level step');
});

test('ts_verify_ac1_push_gate_exits_0_when_all_steps_pass', (t) => {
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'a', run: 'true', level: 'commit' }, { id: 'b', run: 'true', level: 'push' }] },
  });
  assertExit(verify(repo, ['push']), 0, 'verify push with passing steps');
});

function levelRepo(t: any) {
  const out = tmpDir(t, 'tegg-qa-out-');
  const levels = ['commit', 'push', 'nightly', 'milestone', 'release'] as const;
  const steps = levels.map((level) => ({ id: `step-${level}`, run: markStep(path.join(out, level)), level }));
  // Minimal BRD/ACs so that milestone/release have something to read; their exit code is not asserted here.
  const repo = makeRepo(t, {
    config: { steps },
    files: {
      'docs/Business Requirements.md': '# BRD\n\n### 11.2 Milestones\n\n| Milestone | Name | Requirements |\n| --- | --- | --- |\n| MS1 | Core | FR-ABC-01 |\n',
      'docs/acceptance/core.md': '# ACs\n\n### FR-ABC-01 Something\n\n- **AC-1** [manual] Works.\n',
    },
  });
  const ran = () => levels.filter((l) => fs.existsSync(path.join(out, l)));
  const reset = () => levels.forEach((l) => fs.rmSync(path.join(out, l), { force: true }));
  return { repo, ran, reset };
}

test('ts_verify_ac1_each_gate_runs_steps_at_or_below_its_level', (t) => {
  const { repo, ran, reset } = levelRepo(t);
  const cases: Array<[string[], string[]]> = [
    [['commit'], ['commit']],
    [['push'], ['commit', 'push']],
    [['nightly'], ['commit', 'push', 'nightly']],
    [['milestone', '--milestone', 'MS1'], ['commit', 'push', 'nightly', 'milestone']],
    [['release'], ['commit', 'push', 'nightly', 'milestone', 'release']],
  ];
  for (const [args, expected] of cases) {
    reset();
    const r = verify(repo, args);
    assert.ok(r.status !== null, `verify ${args.join(' ')} must run\n${describe(r)}`);
    assert.deepEqual(ran(), expected, `verify ${args.join(' ')} must run exactly the steps of levels ${expected.join(', ')}\n${describe(r)}`);
  }
});

test('ts_verify_ac1_all_steps_run_after_one_fails', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const repo = makeRepo(t, {
    config: {
      steps: [
        { id: 'first-fails', run: markStep(path.join(out, 'first'), 'exit 1'), level: 'commit' },
        { id: 'second-runs', run: markStep(path.join(out, 'second')), level: 'commit' },
      ],
    },
  });
  const r = verify(repo, ['commit']);
  assertExit(r, 1, 'verify commit with one failing step');
  assert.ok(fs.existsSync(path.join(out, 'second')), 'the step after the failing one must still run');
});

test('ts_verify_ac1_step_runs_in_its_dir_with_gate_environment', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const envFile = path.join(out, 'env');
  const repo = makeRepo(t, {
    config: {
      steps: [{
        id: 'env', dir: 'sub/pkg', level: 'commit',
        run: `printf '%s\\n' "$(pwd -P)" "$VERIFY_GATE" "$QA_PROPERTY_SCALE" > ${sq(envFile)}`,
      }],
    },
    files: { 'sub/pkg/.keep': '' },
  });
  assertExit(verify(repo, ['commit']), 0, 'verify commit');
  const [cwd, gate, scale] = readText(envFile, 'step environment dump').split('\n');
  assert.equal(cwd, path.join(repo, 'sub/pkg'), 'commit gate step runs in <checkout>/<dir>');
  assert.equal(gate, 'commit', 'VERIFY_GATE');
  assert.equal(scale, '1', 'QA_PROPERTY_SCALE for commit');
});

test('ts_verify_ac1_nightly_steps_get_property_scale_100', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const envFile = path.join(out, 'env');
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'env', level: 'nightly', run: `printf '%s\\n' "$VERIFY_GATE" "$QA_PROPERTY_SCALE" > ${sq(envFile)}` }] },
  });
  assertExit(verify(repo, ['nightly']), 0, 'verify nightly');
  assert.deepEqual(readText(envFile, 'step environment dump').split('\n').slice(0, 2), ['nightly', '100']);
});

test('ts_verify_ac1_changed_only_step_is_skipped_without_staged_changes_under_dir', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'pkg-only', dir: 'pkg', changedOnly: true, level: 'commit', run: markStep(path.join(out, 'pkg')) }] },
    files: { 'pkg/a.txt': 'a\n', 'other/b.txt': 'b\n' },
  });
  writeFiles(repo, { 'other/b.txt': 'b2\n' });
  git(repo, ['add', 'other/b.txt']);
  assertExit(verify(repo, ['commit']), 0, 'verify commit with nothing staged under pkg/');
  assert.equal(fs.existsSync(path.join(out, 'pkg')), false, 'changedOnly step must not run');
  assert.equal(findStep(lastSummary(repo, 'commit'), 'pkg-only').result, 'skipped');

  writeFiles(repo, { 'pkg/a.txt': 'a2\n' });
  git(repo, ['add', 'pkg/a.txt']);
  assertExit(verify(repo, ['commit']), 0, 'verify commit with a staged change under pkg/');
  assert.equal(fs.existsSync(path.join(out, 'pkg')), true, 'changedOnly step must run when a staged file is under its dir');
});

test('ts_verify_ac1_missing_or_invalid_config_exits_2', (t) => {
  const noConfig = makeRepo(t, { config: null });
  const r1 = verify(noConfig, ['commit']);
  assertExit(r1, 2, 'verify commit without qa.config.json');
  assert.notEqual(r1.stderr.trim(), '', 'an error message on stderr');

  const badConfig = makeRepo(t, { config: null, files: { 'qa.config.json': '{ "steps": [ ' } });
  const r2 = verify(badConfig, ['push']);
  assertExit(r2, 2, 'verify push with invalid JSON config');
  assert.notEqual(r2.stderr.trim(), '', 'an error message on stderr');
});

test('ts_verify_ac1_unknown_command_and_missing_milestone_exit_2', (t) => {
  const repo = makeRepo(t);
  assertExit(verify(repo, ['frobnicate']), 2, 'verify with an unknown command');
  assertExit(verify(repo, ['milestone']), 2, 'verify milestone without --milestone');
});

// ---------------------------------------------------------------------------
// AC-2: summary in .verify/
// ---------------------------------------------------------------------------

test('ts_verify_ac2_commit_summary_has_steps_results_durations_seeds_and_tree', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const seedFile = path.join(out, 'qa-seed');
  const repo = makeRepo(t, {
    config: {
      steps: [
        { id: 'prop', level: 'commit', run: `echo "seed=123"; echo "Seed: 456"; echo "property SEED 789 done"; echo "$QA_SEED" > ${sq(seedFile)}` },
        { id: 'broken', level: 'commit', run: 'exit 1' },
      ],
    },
  });
  writeFiles(repo, { 'staged.txt': 'staged\n' });
  git(repo, ['add', 'staged.txt']);
  const indexTree = git(repo, ['write-tree']).trim();
  const r = verify(repo, ['commit']);
  assertExit(r, 1, 'verify commit with one failing step');

  const s = lastSummary(repo, 'commit');
  assert.equal(s.gate, 'commit');
  assert.equal(s.commit, headSha(repo), 'commit = HEAD sha');
  assert.equal(s.tree, indexTree, 'tree = tree of the staged index');
  assert.equal(s.result, 'fail');
  assert.equal(typeof s.durationMs, 'number');
  assert.ok(!Number.isNaN(Date.parse(s.startedAt)), `startedAt must be ISO 8601, got ${s.startedAt}`);
  assert.ok(Number.isInteger(s.seed), `seed must be an integer, got ${s.seed}`);
  assert.equal(readText(seedFile, 'QA_SEED seen by the step').trim(), String(s.seed), 'QA_SEED given to steps = summary seed');

  const prop = findStep(s, 'prop');
  assert.equal(prop.result, 'pass');
  assert.equal(typeof prop.durationMs, 'number');
  assert.deepEqual(prop.seeds, [123, 456, 789]);
  assert.equal(findStep(s, 'broken').result, 'fail');
  assert.equal(findCheck(s, 'privacy').result, 'pass');

  const runsDir = path.join(repo, '.verify', 'runs');
  const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith('-commit.json')) : [];
  assert.equal(runs.length, 1, `expected one .verify/runs/<timestamp>-commit.json, found ${JSON.stringify(runs)}`);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runsDir, runs[0]), 'utf8')), s, 'runs/ copy equals last-commit.json');
});

test('ts_verify_ac2_push_summary_records_commit_and_tree_of_checked_commit', (t) => {
  const repo = makeRepo(t, { config: { steps: [{ id: 'ok', run: 'true', level: 'push' }] } });
  assertExit(verify(repo, ['push']), 0, 'verify push');
  const s = lastSummary(repo, 'push');
  assert.equal(s.gate, 'push');
  assert.equal(s.commit, headSha(repo));
  assert.equal(s.tree, treeOf(repo));
  assert.equal(s.result, 'pass');
  assert.equal(findStep(s, 'ok').result, 'pass');
  for (const id of ['privacy', 'fixtures', 'ac-test-protection', 'red-first']) {
    assert.equal(findCheck(s, id).result, 'pass', `check ${id}`);
  }
});

test('ts_verify_ac2_junit_reports_are_copied_to_last_results', (t) => {
  const xml = junitXml([{ name: 'fr_abc_01_AC1_works' }]);
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'junit', level: 'commit', run: 'cp report.xml "$VERIFY_RESULTS/report.xml"' }] },
    files: { 'report.xml': xml },
  });
  fs.mkdirSync(path.join(repo, '.verify', 'last-results'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.verify', 'last-results', 'stale.xml'), '<testsuites/>');
  assertExit(verify(repo, ['commit']), 0, 'verify commit');
  const dir = path.join(repo, '.verify', 'last-results');
  assert.ok(fs.existsSync(dir), '.verify/last-results/ must exist');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xml'));
  assert.equal(files.length, 1, `last-results must be replaced by this run's reports, found ${JSON.stringify(files)}`);
  assert.equal(fs.readFileSync(path.join(dir, files[0]), 'utf8'), xml);
});

test('ts_verify_ac2_verify_dir_is_git_ignored_in_this_repo', () => {
  const r = gitTry(REPO_ROOT, ['check-ignore', '-q', '--no-index', '.verify/last-pass']);
  assert.equal(r.status, 0, `.verify/ must be git-ignored in ${REPO_ROOT}/.gitignore\n${describe(r)}`);
});

// ---------------------------------------------------------------------------
// AC-3: push runs in a fresh worktree of the commit
// ---------------------------------------------------------------------------

test('ts_verify_ac3_untracked_file_is_invisible_to_push_steps', (t) => {
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'no-poison', run: 'test ! -e poison.txt', level: 'push' }] },
  });
  writeFiles(repo, { 'poison.txt': 'untracked\n' });
  assertExit(verify(repo, ['push']), 0, 'verify push must not see untracked files');
});

test('ts_verify_ac3_uncommitted_fix_cannot_make_push_pass', (t) => {
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'needs-good', run: 'grep -q good state.txt', level: 'push' }] },
    files: { 'state.txt': 'bad\n' },
  });
  writeFiles(repo, { 'state.txt': 'good\n' });
  const r = verify(repo, ['push']);
  assertExit(r, 1, 'verify push must check the committed state');
  assert.match(r.stderr, /uncommitted/, 'warning about uncommitted changes on stderr');
  assert.equal(fs.existsSync(path.join(repo, '.verify', 'last-pass')), false, 'no last-pass on failure');
});

test('ts_verify_ac3_push_steps_run_outside_main_checkout_and_worktree_is_removed', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const where = path.join(out, 'where');
  const repo = makeRepo(t, { config: { steps: [{ id: 'where', run: `pwd -P > ${sq(where)}`, level: 'push' }] } });
  assertExit(verify(repo, ['push']), 0, 'verify push');
  const dir = readText(where, 'step working directory').trim();
  assert.notEqual(dir, repo, 'push steps must not run in the main working directory');
  assert.ok(!dir.startsWith(repo + path.sep), 'push steps must run in a separate worktree');
  assert.equal(fs.existsSync(dir), false, 'the worktree must be removed afterwards');
  const worktrees = git(repo, ['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree '));
  assert.equal(worktrees.length, 1, `only the main worktree may remain: ${worktrees.join(', ')}`);
});

test('ts_verify_ac3_push_commit_option_checks_that_commit_and_writes_last_pass', (t) => {
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'needs-good', run: 'grep -q good state.txt', level: 'push' }] },
    files: { 'state.txt': 'good\n' },
  });
  const good = headSha(repo);
  writeFiles(repo, { 'state.txt': 'bad\n' });
  commitAll(repo, 'break it');

  assertExit(verify(repo, ['push']), 1, 'verify push of HEAD (bad)');
  assert.equal(fs.existsSync(path.join(repo, '.verify', 'last-pass')), false, 'last-pass not written on failure');

  assertExit(verify(repo, ['push', '--commit', good]), 0, 'verify push --commit <good>');
  assert.equal(readText(path.join(repo, '.verify', 'last-pass'), 'last-pass'), `${treeOf(repo, good)}\n`);

  assertExit(verify(repo, ['push']), 1, 'verify push of HEAD (bad) again');
  assert.equal(readText(path.join(repo, '.verify', 'last-pass'), 'last-pass'), `${treeOf(repo, good)}\n`, 'last-pass unchanged on failure');
});

// ---------------------------------------------------------------------------
// AC-4: push budget; slowest steps listed when exceeded
// ---------------------------------------------------------------------------

test('ts_verify_ac4_exceeded_budget_lists_three_slowest_steps', (t) => {
  const repo = makeRepo(t, {
    config: {
      budgets: { push: 1 },
      steps: [
        { id: 'fast-d', run: 'true', level: 'push' },
        { id: 'slow-c', run: 'sleep 0.3', level: 'push' },
        { id: 'slow-a', run: 'sleep 1.5', level: 'push' },
        { id: 'slow-b', run: 'sleep 0.7', level: 'push' },
      ],
    },
  });
  const r = verify(repo, ['push']);
  assertExit(r, 0, 'exceeding the budget must not change the exit code');
  const lines = r.stdout.split('\n');
  const i = lines.findIndex((l) => /exceeded/.test(l) && /\b1\b/.test(l));
  assert.ok(i >= 0, `stdout must have a line containing "exceeded" and the budget (1)\n${describe(r)}`);
  const after = lines.slice(i + 1, i + 4).join('\n');
  for (const id of ['slow-a', 'slow-b', 'slow-c']) {
    assert.match(after, new RegExp(`${id}.*\\d|\\d.*${id}`), `slowest steps after the "exceeded" line must include ${id} with its duration\n${describe(r)}`);
  }
  assert.doesNotMatch(lines.slice(i + 1).join('\n'), /fast-d/, 'at most the 3 slowest steps are listed');
});

test('ts_verify_ac4_within_budget_prints_no_exceeded_line', (t) => {
  const repo = makeRepo(t, { config: { budgets: { push: 600 }, steps: [{ id: 'quick', run: 'true', level: 'push' }] } });
  const r = verify(repo, ['push']);
  assertExit(r, 0, 'verify push within budget');
  assert.doesNotMatch(r.stdout, /exceeded/, 'no budget line when within budget');
  assert.equal(typeof lastSummary(repo, 'push').durationMs, 'number');
});
