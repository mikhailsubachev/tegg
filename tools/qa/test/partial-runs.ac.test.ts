// TS-VERIFY AC-12: only the failed or changed test files run again (D-1834). Black box against
// tools/qa/CONTRACT.md §1.2 (shared `step-runs.json`), §2 (`testFiles`, `{files}`), §3.2.5, §3.4 (`partial`).
//
// The temp repo's step runs a small committed runner. It appends the test files it was given (what `{files}` became)
// to a log outside the repo and writes a JUnit report with one testcase per test file it ran. Switch files in a
// control folder outside the repo make chosen test files fail, error, be skipped or be left out of the report, so a
// test file can start passing again without a change in the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  addWorktree, assertExit, commitAll, configJson, describe, findStep, git, gitTry, headSha, lastSummary, makeRepo,
  readJsonFile, sharedDir, sq, tmpDir, verify, writeFiles, type Files, type RunResult, type Step,
} from './helpers.ts';

const RUNNER = `import fs from 'node:fs';
import path from 'node:path';
const [ctl, report, ...given] = process.argv.slice(2);
fs.appendFileSync(path.join(ctl, 'args.log'), JSON.stringify(given) + '\\n');
const has = (name) => fs.existsSync(path.join(ctl, name));
if (has('no-report')) process.exit(1);
const all = fs.readdirSync('t').filter((f) => f.endsWith('.test.txt')).sort().map((f) => 't/' + f);
const files = given.length > 0 ? given : all;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
let failed = false;
const cases = [];
for (const file of files) {
  const base = path.basename(file, '.test.txt');
  if (has('omit-' + base)) continue;
  const open = '<testcase name="' + esc('běží ' + base) + '" classname="' + esc(file) + '" time="0.001"';
  if (has('fail-' + base)) {
    failed = true;
    cases.push(open + '><failure type="AssertionError" message="očekáváno">AssertionError: očekáváno</failure></testcase>');
  } else if (has('error-' + base)) {
    failed = true;
    cases.push(open + '><error type="Error" message="chyba">Error: chyba</error></testcase>');
  } else if (has('skip-' + base)) {
    cases.push(open + '><skipped/></testcase>');
  } else {
    cases.push(open + '/>');
  }
}
fs.writeFileSync(report, '<?xml version="1.0" encoding="utf-8"?>\\n<testsuites><testsuite name="unit" tests="' + cases.length + '">\\n' + cases.join('\\n') + '\\n</testsuite></testsuites>\\n');
process.exit(failed || has('exit-1') ? 1 : 0);
`;

type Fixture = {
  repo: string;
  ctl: string;
  /** Repository-relative path of a file under the step's dir. */
  p: (rel: string) => string;
  /** The step as configured (to commit a changed configuration). */
  step: Step;
};

type FixtureOptions = {
  /** The step's `dir` (default `.`). */
  dir?: string;
  /** Extra files, relative to the step's dir. */
  files?: Files;
  step?: Partial<Step>;
  noInputs?: boolean;
};

/** The step's `run`: the runner, the control folder, the JUnit report (named in `run`, CONTRACT §3.2.5), `{files}`. */
function runnerCommand(ctl: string, dir: string, prefix = ''): string {
  const runner = dir === '.' ? 'tools/run.mjs' : path.posix.relative(dir, 'tools/run.mjs');
  return `${prefix}node ${runner} ${sq(ctl)} "$VERIFY_RESULTS/unit.xml" {files}`;
}

function fixture(t: any, opts: FixtureOptions = {}): Fixture {
  const dir = opts.dir ?? '.';
  const p = (rel: string) => (dir === '.' ? rel : `${dir}/${rel}`);
  const ctl = tmpDir(t, 'tegg-qa-ctl-');
  const step: Step = {
    id: 'unit',
    dir,
    run: runnerCommand(ctl, dir),
    level: 'push',
    testFiles: `^${p('t/')}[^/]+\\.test\\.txt$`,
    ...(opts.noInputs ? {} : { inputs: [p('t'), p('lib')] }),
    ...opts.step,
  };
  const own: Files = {
    't/a.test.txt': 'test A: žluťoučký kůň\n',
    't/b.test.txt': 'test B: úpěl ďábelské ódy\n',
    't/c.test.txt': 'test C: příliš\n',
    'lib/helper.txt': 'pomocný soubor\n',
    ...(opts.files ?? {}),
  };
  const files: Files = { 'tools/run.mjs': RUNNER, 'other/readme.txt': 'mimo vstupy\n' };
  for (const [rel, content] of Object.entries(own)) files[p(rel)] = content;
  const repo = makeRepo(t, { config: { steps: [step] }, files });
  return { repo, ctl, p, step };
}

/** What `{files}` became in each run of the step so far: one array of arguments per run. */
function runs(f: Fixture): string[][] {
  const log = path.join(f.ctl, 'args.log');
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l) as string[]);
}

function lastRun(f: Fixture): string[] | undefined {
  const all = runs(f);
  return all[all.length - 1];
}

function flag(f: Fixture, name: string, on = true): void {
  const file = path.join(f.ctl, name);
  if (on) fs.writeFileSync(file, '');
  else fs.rmSync(file, { force: true });
}

function gate(dir: string, expected: number, args: string[] = ['push']): RunResult {
  const r = verify(dir, args);
  assertExit(r, expected, `verify ${args.join(' ')}`);
  return r;
}

function change(f: Fixture, rels: string[], message: string, repo = f.repo): string {
  const files: Files = {};
  for (const rel of rels) files[f.p(rel)] = `změněno: ${message} (${rel})\n`;
  writeFiles(repo, files);
  return commitAll(repo, message);
}

/** The first run of a fixture: a full run, `{files}` is the empty string. Returns the checked commit. */
function fullRun(f: Fixture, expected: number, args: string[] = ['push'], gateName = 'push'): { sha: string; startedAt: string; r: RunResult } {
  const before = runs(f).length;
  const r = gate(f.repo, expected, args);
  assertFull(f, f.repo, gateName, before + 1, r);
  return { sha: headSha(f.repo), startedAt: lastSummary(f.repo, gateName).startedAt, r };
}

function assertFull(f: Fixture, dir: string, gateName: string, runCount: number, r: RunResult): void {
  assert.equal(runs(f).length, runCount, `the step ran (run ${runCount})\n${describe(r)}`);
  assert.deepEqual(lastRun(f), [], `a full run: {files} is replaced by the empty string\n${describe(r)}`);
  const step = findStep(lastSummary(dir, gateName), 'unit');
  assert.ok(step.partial == null, `a full run has no partial in the summary, got ${JSON.stringify(step.partial)}`);
  assert.equal(partialLine(r), undefined, `a full run prints no partial-run line\n${describe(r)}`);
}

function partialLine(r: RunResult): string | undefined {
  return r.stdout.split('\n').find((l) => l.includes('unit') && l.includes('partial run'));
}

/**
 * A partial run happened in `dir`: the runner got exactly `given` (relative to the step's dir, any order), the
 * summary has `partial` with the repository-relative files and the recorded commit, stdout has the partial line.
 */
function assertPartial(
  f: Fixture, dir: string, runCount: number, r: RunResult,
  expected: { given: string[]; since: string; result: 'pass' | 'fail'; sinceGate?: string; sinceStartedAt?: string },
): void {
  assert.equal(runs(f).length, runCount, `the step ran (run ${runCount})\n${describe(r)}`);
  assert.deepEqual([...(lastRun(f) ?? [])].sort(), [...expected.given].sort(), `{files} is the chosen test files, relative to the step's dir, one argument each\n${describe(r)}`);
  const step = findStep(lastSummary(dir, 'push'), 'unit');
  assert.equal(step.result, expected.result, `the partial run is reported ${expected.result}\n${describe(r)}`);
  assert.ok(step.partial && typeof step.partial === 'object', `the summary entry has partial, got ${JSON.stringify(step)}`);
  assert.ok(Array.isArray(step.partial.files), `partial.files is an array, got ${JSON.stringify(step.partial)}`);
  assert.deepEqual([...step.partial.files].sort(), expected.given.map((g) => f.p(g)).sort(), 'partial.files are the repository-relative paths of the chosen test files');
  assert.equal(step.partial.since, expected.since, 'partial.since is the recorded commit');
  // `- <id>: partial run of <n> test file(s) (other inputs unchanged since <gate> run <startedAt> at <short sha>)`
  const line = partialLine(r);
  assert.ok(line, `stdout has a line containing the step id and "partial run"\n${describe(r)}`);
  const m = line.match(/^- unit: partial run of (\d+) test file\(s\) \(other inputs unchanged since (\S+) run (\S+) at ([0-9a-f]{7,40})\)$/);
  assert.ok(m, `the partial line has the contract's form: ${line}`);
  assert.equal(Number(m[1]), expected.given.length, `the line names the number of test files: ${line}`);
  assert.equal(m[2], expected.sinceGate ?? 'push', `the line names the gate of the recorded run: ${line}`);
  if (expected.sinceStartedAt) assert.equal(m[3], expected.sinceStartedAt, `the line names the recorded run: ${line}`);
  assert.ok(expected.since.startsWith(m[4]), `the line names the recorded commit ${expected.since}: ${line}`);
}

// ---------------------------------------------------------------------------
// Changed and failed test files run again; the rest don't
// ---------------------------------------------------------------------------

test('ts_verify_ac12_only_changed_test_files_run_after_a_passing_run', (t) => {
  const f = fixture(t);
  const first = fullRun(f, 0);
  change(f, ['t/b.test.txt'], 'upravený test B');
  const r = gate(f.repo, 0);
  assertPartial(f, f.repo, 2, r, { given: ['t/b.test.txt'], since: first.sha, result: 'pass', sinceStartedAt: first.startedAt });
  // The partial line comes before the step starts.
  const lines = r.stdout.split('\n');
  const started = lines.findIndex((l) => l.startsWith('▶ unit '));
  assert.ok(started > lines.findIndex((l) => l.includes('partial run')), `the partial line is printed before the step's start line\n${describe(r)}`);
  assert.equal(lastSummary(f.repo, 'push').result, 'pass');
});

test('ts_verify_ac12_failed_test_files_run_again_with_the_changed_ones', (t) => {
  const f = fixture(t);
  flag(f, 'fail-b');
  const first = fullRun(f, 1);
  assert.equal(findStep(lastSummary(f.repo, 'push'), 'unit').result, 'fail', 'the full run fails: test file b fails');

  // b still fails and c changed: both run, a (passed, unchanged) doesn't.
  const second = change(f, ['t/c.test.txt'], 'upravený test C');
  const r2 = gate(f.repo, 1);
  assertPartial(f, f.repo, 2, r2, { given: ['t/b.test.txt', 't/c.test.txt'], since: first.sha, result: 'fail', sinceStartedAt: first.startedAt });

  // Nothing changed, b passes now: only b (still pending after the failed partial run) runs, c passed there.
  flag(f, 'fail-b', false);
  const r3 = gate(f.repo, 0);
  assertPartial(f, f.repo, 3, r3, { given: ['t/b.test.txt'], since: second, result: 'pass' });
  assert.equal(lastSummary(f.repo, 'push').result, 'pass', 'the gate passes once the failed test file passes');
});

test('ts_verify_ac12_error_skipped_and_unreported_test_files_stay_pending', (t) => {
  const f = fixture(t, { files: { 't/d.test.txt': 'test D: čtvrtý\n' } });
  // a ends with an <error>, b is <skipped>, c has no <testcase> in the report; only d passes.
  for (const name of ['error-a', 'skip-b', 'omit-c']) flag(f, name);
  const first = fullRun(f, 1);
  for (const name of ['error-a', 'skip-b', 'omit-c']) flag(f, name, false);
  const r = gate(f.repo, 0);
  assertPartial(f, f.repo, 2, r, {
    given: ['t/a.test.txt', 't/b.test.txt', 't/c.test.txt'], since: first.sha, result: 'pass', sinceStartedAt: first.startedAt,
  });
});

test('ts_verify_ac12_added_test_file_runs_and_deleted_ones_are_left_out', (t) => {
  const f = fixture(t);
  flag(f, 'fail-b');
  const first = fullRun(f, 1);
  // The failing b and the passing a are deleted, d is added, c is modified.
  git(f.repo, ['rm', '-q', 't/a.test.txt', 't/b.test.txt']);
  writeFiles(f.repo, { 't/d.test.txt': 'test D: nový soubor\n', 't/c.test.txt': 'test C: změněný\n' });
  commitAll(f.repo, 'Delete a and b, add d, change c');
  const r = gate(f.repo, 0);
  assertPartial(f, f.repo, 2, r, { given: ['t/c.test.txt', 't/d.test.txt'], since: first.sha, result: 'pass' });
});

test('ts_verify_ac12_step_passes_without_running_when_nothing_is_left_to_run', (t) => {
  const f = fixture(t);
  flag(f, 'fail-b');
  fullRun(f, 1);
  // The only pending test file is deleted and nothing else changed: no test file is chosen.
  git(f.repo, ['rm', '-q', 't/b.test.txt']);
  commitAll(f.repo, 'Delete the failing test file');
  const r = gate(f.repo, 0);
  assert.equal(runs(f).length, 1, `the step doesn't run when no test file is chosen\n${describe(r)}`);
  assert.equal(findStep(lastSummary(f.repo, 'push'), 'unit').result, 'pass', 'and its result is pass');
  assert.equal(lastSummary(f.repo, 'push').result, 'pass');
  const again = gate(f.repo, 0);
  assert.equal(runs(f).length, 1, `nothing is pending afterwards either\n${describe(again)}`);
});

test('ts_verify_ac12_files_are_relative_to_the_step_dir_and_single_quoted', (t) => {
  const f = fixture(t, { dir: 'pkg', files: { 't/dvě slova.test.txt': 'test se jménem o dvou slovech\n', "t/it's.test.txt": 'apostrof ve jménu\n' } });
  const first = fullRun(f, 0);
  change(f, ['t/dvě slova.test.txt', "t/it's.test.txt", 't/b.test.txt'], 'tři změněné testy');
  const r = gate(f.repo, 0);
  assertPartial(f, f.repo, 2, r, {
    given: ['t/b.test.txt', 't/dvě slova.test.txt', "t/it's.test.txt"], since: first.sha, result: 'pass', sinceStartedAt: first.startedAt,
  });
  // A testcase belongs to the test file whose path ends with "/" + its classname (here `t/b.test.txt` under pkg/).
  flag(f, 'fail-b');
  const third = change(f, ['t/b.test.txt', 't/c.test.txt'], 'b selže, c projde');
  gate(f.repo, 1);
  flag(f, 'fail-b', false);
  const r4 = gate(f.repo, 0);
  assertPartial(f, f.repo, 4, r4, { given: ['t/b.test.txt'], since: third, result: 'pass' });
});

// ---------------------------------------------------------------------------
// When the run is full
// ---------------------------------------------------------------------------

test('ts_verify_ac12_another_changed_input_runs_the_step_in_full', (t) => {
  const f = fixture(t);
  fullRun(f, 0);
  // An input that is not a test file changed together with a test file.
  change(f, ['lib/helper.txt', 't/b.test.txt'], 'změna pomocného souboru');
  const r = gate(f.repo, 0);
  assertFull(f, f.repo, 'push', 2, r);
  assert.equal(findStep(lastSummary(f.repo, 'push'), 'unit').result, 'pass');
  // A file under the inputs that doesn't match testFiles (not directly in t/) counts as another input too.
  change(f, ['t/data/x.test.txt'], 'soubor v podsložce');
  assertFull(f, f.repo, 'push', 3, gate(f.repo, 0));
  // And after that full run a changed test file alone gives a partial run again.
  const third = headSha(f.repo);
  change(f, ['t/a.test.txt'], 'upravený test A');
  assertPartial(f, f.repo, 4, gate(f.repo, 0), { given: ['t/a.test.txt'], since: third, result: 'pass' });
});

test('ts_verify_ac12_failed_full_run_without_a_report_runs_in_full_again', (t) => {
  const f = fixture(t);
  flag(f, 'no-report');
  fullRun(f, 1);
  flag(f, 'no-report', false);
  // Nobody knows which test files failed: the next run is full, also when only a test file changed.
  change(f, ['t/b.test.txt'], 'upravený test B');
  const r = gate(f.repo, 0);
  assertFull(f, f.repo, 'push', 2, r);
  assert.equal(findStep(lastSummary(f.repo, 'push'), 'unit').result, 'pass');
});

test('ts_verify_ac12_failed_partial_run_without_a_report_keeps_its_files_pending', (t) => {
  const f = fixture(t);
  const first = fullRun(f, 0);
  const second = change(f, ['t/b.test.txt'], 'upravený test B');
  flag(f, 'no-report');
  const r2 = gate(f.repo, 1);
  assertPartial(f, f.repo, 2, r2, { given: ['t/b.test.txt'], since: first.sha, result: 'fail' });
  flag(f, 'no-report', false);
  change(f, ['t/c.test.txt'], 'upravený test C');
  const r3 = gate(f.repo, 0);
  assertPartial(f, f.repo, 3, r3, { given: ['t/b.test.txt', 't/c.test.txt'], since: second, result: 'pass' });
});

test('ts_verify_ac12_changed_command_runs_the_step_in_full', (t) => {
  const f = fixture(t);
  fullRun(f, 0);
  // The same command with another text, and a changed test file.
  writeFiles(f.repo, { 'qa.config.json': configJson({ steps: [{ ...f.step, run: runnerCommand(f.ctl, '.', 'true && ') }] }) });
  change(f, ['t/b.test.txt'], 'upravený test B a jiný příkaz');
  const r = gate(f.repo, 0);
  assertFull(f, f.repo, 'push', 2, r);
  // A changed testFiles pattern is another step fingerprint as well.
  writeFiles(f.repo, {
    'qa.config.json': configJson({ steps: [{ ...f.step, run: runnerCommand(f.ctl, '.', 'true && '), testFiles: '^t/[a-z]+\\.test\\.txt$' }] }),
  });
  change(f, ['t/c.test.txt'], 'upravený test C a jiný vzor');
  assertFull(f, f.repo, 'push', 3, gate(f.repo, 0));
});

test('ts_verify_ac12_unknown_recorded_commit_runs_the_step_in_full', (t) => {
  const f = fixture(t);
  const first = fullRun(f, 0);
  // The recorded commit disappears from the repository (amended away and pruned).
  writeFiles(f.repo, { 't/b.test.txt': 'test B: přepsaný\n' });
  git(f.repo, ['add', '-A']);
  git(f.repo, ['commit', '-q', '--no-verify', '--amend', '-m', 'initial, amended']);
  git(f.repo, ['worktree', 'prune']);
  git(f.repo, ['reflog', 'expire', '--expire=now', '--all']);
  git(f.repo, ['gc', '-q', '--prune=now']);
  assert.notEqual(gitTry(f.repo, ['cat-file', '-e', `${first.sha}^{commit}`]).status, 0, 'test setup: the recorded commit is gone');
  const r = gate(f.repo, 0);
  assertFull(f, f.repo, 'push', 2, r);
});

test('ts_verify_ac12_push_all_and_nightly_run_in_full_and_record_the_run', (t) => {
  const f = fixture(t);
  fullRun(f, 0);
  change(f, ['t/b.test.txt'], 'upravený test B');
  const all = gate(f.repo, 0, ['push', '--all']);
  assertFull(f, f.repo, 'push', 2, all);
  change(f, ['t/c.test.txt'], 'upravený test C');
  const nightly = fullRun(f, 0, ['nightly'], 'nightly');
  assert.equal(runs(f).length, 3);
  // The nightly run is the recorded one: the next push runs only what changed since it.
  change(f, ['t/a.test.txt'], 'upravený test A');
  const r = gate(f.repo, 0);
  assertPartial(f, f.repo, 4, r, { given: ['t/a.test.txt'], since: nightly.sha, result: 'pass', sinceGate: 'nightly', sinceStartedAt: nightly.startedAt });
});

test('ts_verify_ac12_step_without_inputs_always_runs_in_full', (t) => {
  const f = fixture(t, { noInputs: true });
  fullRun(f, 0);
  change(f, ['t/b.test.txt'], 'upravený test B');
  const r = gate(f.repo, 0);
  assertFull(f, f.repo, 'push', 2, r);
});

// ---------------------------------------------------------------------------
// The step memo and the shared record
// ---------------------------------------------------------------------------

test('ts_verify_ac12_passing_partial_run_counts_as_a_pass_for_the_step_memo', (t) => {
  const f = fixture(t);
  const first = fullRun(f, 0);
  change(f, ['t/b.test.txt'], 'upravený test B');
  const r2 = gate(f.repo, 0);
  assertPartial(f, f.repo, 2, r2, { given: ['t/b.test.txt'], since: first.sha, result: 'pass' });
  const partialRun = lastSummary(f.repo, 'push');
  const r3 = gate(f.repo, 0);
  assert.equal(runs(f).length, 2, `the next push skips the step: the partial run's pass is in the memo\n${describe(r3)}`);
  const step = findStep(lastSummary(f.repo, 'push'), 'unit');
  assert.equal(step.result, 'skipped');
  assert.equal(step.reuses, partialRun.startedAt, 'the reused run is the partial run');
});

test('ts_verify_ac12_step_skipped_by_the_memo_is_recorded_as_a_passing_run', (t) => {
  const f = fixture(t);
  fullRun(f, 0);
  // A commit outside the inputs: the memo skips the step, and that is recorded as a run at this commit.
  writeFiles(f.repo, { 'other/readme.txt': 'mimo vstupy, změněno\n' });
  const second = commitAll(f.repo, 'Change a file outside the inputs');
  const skipped = gate(f.repo, 0);
  assert.equal(runs(f).length, 1, `the memo skips the step\n${describe(skipped)}`);
  assert.equal(findStep(lastSummary(f.repo, 'push'), 'unit').result, 'skipped');
  change(f, ['t/c.test.txt'], 'upravený test C');
  const r = gate(f.repo, 0);
  assertPartial(f, f.repo, 2, r, { given: ['t/c.test.txt'], since: second, result: 'pass' });
});

test('ts_verify_ac12_record_of_the_last_run_is_shared_between_worktrees', (t) => {
  const f = fixture(t);
  const first = fullRun(f, 0);
  readJsonFile(path.join(sharedDir(f.repo), 'step-runs.json'), 'the shared record of step runs');
  const wt = addWorktree(t, f.repo, 'vedlejší');
  change(f, ['t/b.test.txt'], 'upravený test B ve vedlejším stromu', wt);
  const r = gate(wt, 0);
  assertPartial(f, wt, 2, r, { given: ['t/b.test.txt'], since: first.sha, result: 'pass', sinceStartedAt: first.startedAt });
  // A malformed record counts as empty: the next run is full, and the gate doesn't fail.
  fs.writeFileSync(path.join(sharedDir(f.repo), 'step-runs.json'), 'tohle není JSON {');
  change(f, ['t/c.test.txt'], 'upravený test C ve vedlejším stromu', wt);
  const r3 = gate(wt, 0);
  assert.equal(runs(f).length, 3, describe(r3));
  assert.deepEqual(lastRun(f), [], 'without a readable record the run is full');
  readJsonFile(path.join(sharedDir(f.repo), 'step-runs.json'), 'the rewritten record of step runs');
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

test('ts_verify_ac12_test_files_that_is_not_a_valid_regex_exits_2', (t) => {
  for (const bad of ['t/(', '[a-']) {
    const f = fixture(t, { step: { testFiles: bad } });
    const r = verify(f.repo, ['push']);
    assertExit(r, 2, `verify push with "testFiles": ${JSON.stringify(bad)}`);
    assert.match(r.stderr, /testFiles/, `the error names the bad field\n${describe(r)}`);
    assert.equal(runs(f).length, 0, 'no step runs with an invalid configuration');
  }
});
