// TS-VERIFY AC-6: step memo (D-526). Black box against tools/qa/CONTRACT.md §2 (`inputs`), §3.2, §3.2.3, §3.4, §5.2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  NODE_AC_RUNNER, assertExit, commitAll, configJson, countLines, describe, findStep, git, lastSummary, makeRepo,
  markStep, sq, tmpDir, verify, writeFiles, type Step,
} from './helpers.ts';

const MEMO = path.join('.verify', 'step-memo.json');

type Memoed = { repo: string; counter: string };

/** A repo with one push-level counting step that depends on `src/` only. */
function memoRepo(t: any, stepOverrides: Partial<Step> = {}, extraFiles: Record<string, string> = {}): Memoed {
  const counter = path.join(tmpDir(t, 'tegg-qa-counter-'), 'runs.log');
  const step: Step = { id: 'memo', run: markStep(counter), level: 'push', inputs: ['src'], ...stepOverrides };
  const repo = makeRepo(t, {
    config: { steps: [step] },
    files: { 'src/a.txt': 'Příliš žluťoučký kůň\n', 'other/b.txt': 'úpěl ďábelské ódy\n', ...extraFiles },
  });
  return { repo, counter };
}

function push(repo: string, args: string[] = []) {
  const r = verify(repo, ['push', ...args]);
  assertExit(r, 0, `verify push ${args.join(' ')}`);
  return r;
}

/** First push runs the step, the second push skips it; returns the first run's summary. */
function pushTwiceExpectSkip({ repo, counter }: Memoed, id = 'memo') {
  const r1 = push(repo);
  assert.equal(countLines(counter), 1, `first push runs the step\n${describe(r1)}`);
  const first = lastSummary(repo, 'push');
  assert.equal(findStep(first, id).result, 'pass', 'first run passes');
  const r2 = push(repo);
  assert.equal(countLines(counter), 1, `second push skips the step (inputs unchanged)\n${describe(r2)}`);
  const second = findStep(lastSummary(repo, 'push'), id);
  assert.equal(second.result, 'skipped', `second push reports the step skipped\n${describe(r2)}`);
  assert.equal(second.reuses, first.startedAt, 'the skipped entry names the reused run by its startedAt');
  return { first, r2 };
}

// ---------------------------------------------------------------------------
// Unchanged inputs: skipped, with the reused run named
// ---------------------------------------------------------------------------

test('ts_verify_ac6_second_push_skips_step_with_unchanged_inputs', (t) => {
  const m = memoRepo(t);
  const { first, r2 } = pushTwiceExpectSkip(m);
  const skipped = findStep(lastSummary(m.repo, 'push'), 'memo');
  assert.equal(skipped.durationMs, 0, 'a skipped step has durationMs 0');
  assert.ok(r2.stdout.includes('reuses'), `stdout names the reused run\n${describe(r2)}`);
  assert.ok(r2.stdout.includes(first.startedAt), `stdout contains the reused run's startedAt ${first.startedAt}\n${describe(r2)}`);
  assert.ok(r2.stdout.includes('memo') && r2.stdout.includes('skipped'), `stdout reports the step as skipped\n${describe(r2)}`);
});

test('ts_verify_ac6_changed_input_runs_step_again', (t) => {
  const m = memoRepo(t);
  pushTwiceExpectSkip(m);
  writeFiles(m.repo, { 'src/a.txt': 'Příliš žluťoučký kůň úpěl\n' });
  commitAll(m.repo, 'Change an input');
  const r = push(m.repo);
  assert.equal(countLines(m.counter), 2, `a changed input runs the step again\n${describe(r)}`);
  assert.equal(findStep(lastSummary(m.repo, 'push'), 'memo').result, 'pass');
});

test('ts_verify_ac6_change_outside_inputs_still_skips', (t) => {
  const m = memoRepo(t);
  pushTwiceExpectSkip(m);
  writeFiles(m.repo, { 'other/b.txt': 'jiný text\n' });
  commitAll(m.repo, 'Change a file outside the inputs');
  const r = push(m.repo);
  assert.equal(countLines(m.counter), 1, `a change outside the inputs keeps the step skipped\n${describe(r)}`);
  assert.equal(findStep(lastSummary(m.repo, 'push'), 'memo').result, 'skipped');
});

test('ts_verify_ac6_changed_run_command_runs_step_again', (t) => {
  const m = memoRepo(t);
  pushTwiceExpectSkip(m);
  // Same tree otherwise, an equivalent command with a different text: `true` → `:`.
  writeFiles(m.repo, {
    'qa.config.json': configJson({ steps: [{ id: 'memo', run: markStep(m.counter, ':'), level: 'push', inputs: ['src'] }] }),
  });
  commitAll(m.repo, 'Change the step command');
  const r = push(m.repo);
  assert.equal(countLines(m.counter), 2, `a changed run command runs the step again\n${describe(r)}`);
  assert.equal(findStep(lastSummary(m.repo, 'push'), 'memo').result, 'pass');
});

test('ts_verify_ac6_step_without_inputs_always_runs', (t) => {
  const withInputs = path.join(tmpDir(t, 'tegg-qa-counter-'), 'with.log');
  const noInputs = path.join(tmpDir(t, 'tegg-qa-counter-'), 'without.log');
  const repo = makeRepo(t, {
    config: {
      steps: [
        { id: 'with-inputs', run: markStep(withInputs), level: 'push', inputs: ['src'] },
        { id: 'no-inputs', run: markStep(noInputs), level: 'push' },
      ],
    },
    files: { 'src/a.txt': 'žluťoučký\n' },
  });
  push(repo);
  push(repo);
  assert.equal(countLines(noInputs), 2, 'a step without inputs runs on every push');
  assert.equal(countLines(withInputs), 1, 'the step with unchanged inputs ran once');
  const summary = lastSummary(repo, 'push');
  assert.equal(findStep(summary, 'no-inputs').result, 'pass');
  assert.equal(findStep(summary, 'no-inputs').reuses, undefined, 'a step without inputs never reuses a run');
  assert.equal(findStep(summary, 'with-inputs').result, 'skipped');
});

test('ts_verify_ac6_push_all_ignores_memo_and_records', (t) => {
  const m = memoRepo(t);
  push(m.repo);
  assert.equal(countLines(m.counter), 1, 'first push runs the step');
  const all = push(m.repo, ['--all']);
  assert.equal(countLines(m.counter), 2, `push --all runs the step again\n${describe(all)}`);
  const allSummary = lastSummary(m.repo, 'push');
  assert.equal(findStep(allSummary, 'memo').result, 'pass');
  const r = push(m.repo);
  assert.equal(countLines(m.counter), 2, `the plain push after --all reuses its pass\n${describe(r)}`);
  const skipped = findStep(lastSummary(m.repo, 'push'), 'memo');
  assert.equal(skipped.result, 'skipped');
  assert.equal(skipped.reuses, allSummary.startedAt, 'the --all run is the one reused');
});

test('ts_verify_ac6_nightly_always_runs_and_push_reuses_its_pass', (t) => {
  const m = memoRepo(t);
  assertExit(verify(m.repo, ['nightly']), 0, 'first verify nightly');
  assert.equal(countLines(m.counter), 1, 'nightly runs the step');
  assertExit(verify(m.repo, ['nightly']), 0, 'second verify nightly');
  assert.equal(countLines(m.counter), 2, 'nightly never skips a step');
  const nightly = lastSummary(m.repo, 'nightly');
  assert.equal(findStep(nightly, 'memo').result, 'pass', 'nightly reports the step as run');
  const r = push(m.repo);
  assert.equal(countLines(m.counter), 2, `push reuses the pass recorded by nightly\n${describe(r)}`);
  const skipped = findStep(lastSummary(m.repo, 'push'), 'memo');
  assert.equal(skipped.result, 'skipped');
  assert.equal(skipped.reuses, nightly.startedAt, 'the reused run is the last nightly run');
  assert.ok(r.stdout.includes('nightly'), `stdout names the gate of the reused run\n${describe(r)}`);
});

test('ts_verify_ac6_failed_step_is_not_memoized', (t) => {
  const flag = path.join(tmpDir(t, 'tegg-qa-flag-'), 'ready');
  const counter = path.join(tmpDir(t, 'tegg-qa-counter-'), 'runs.log');
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'memo', run: markStep(counter, `test -f ${sq(flag)}`), level: 'push', inputs: ['src'] }] },
    files: { 'src/a.txt': 'žluťoučký\n' },
  });
  const failing = verify(repo, ['push']);
  assertExit(failing, 1, 'push with the flag absent');
  assert.equal(countLines(counter), 1);
  assert.equal(findStep(lastSummary(repo, 'push'), 'memo').result, 'fail');
  fs.writeFileSync(flag, '');
  const r = push(repo);
  assert.equal(countLines(counter), 2, `a failed step is not memoized: the next push runs it\n${describe(r)}`);
  assert.equal(findStep(lastSummary(repo, 'push'), 'memo').result, 'pass');
  const r3 = push(repo);
  assert.equal(countLines(counter), 2, `the pass is memoized\n${describe(r3)}`);
  assert.equal(findStep(lastSummary(repo, 'push'), 'memo').result, 'skipped');
});

test('ts_verify_ac6_missing_input_path_counts_as_empty', (t) => {
  const m = memoRepo(t, { inputs: ['later'] });
  pushTwiceExpectSkip(m);
  writeFiles(m.repo, { 'later/x.txt': 'nový vstup\n' });
  commitAll(m.repo, 'Add the input path');
  const r = push(m.repo);
  assert.equal(countLines(m.counter), 2, `an input path that appears in the tree runs the step again\n${describe(r)}`);
  assert.equal(findStep(lastSummary(m.repo, 'push'), 'memo').result, 'pass');
});

test('ts_verify_ac6_changed_lockfile_under_step_dir_runs_step_again', (t) => {
  const lock = (extra = '') =>
    `{"name":"pkg","lockfileVersion":3,"requires":true,"packages":{"":{"name":"pkg"${extra}}}}\n`;
  const m = memoRepo(
    t,
    { dir: 'pkg', inputs: ['pkg/src'] },
    { 'pkg/src/a.txt': 'žluťoučký\n', 'pkg/package.json': '{"name":"pkg","private":true}\n', 'pkg/package-lock.json': lock() },
  );
  pushTwiceExpectSkip(m);
  // Not in `inputs`, but `<dir>/package-lock.json` is always part of the key.
  writeFiles(m.repo, { 'pkg/package-lock.json': lock(',"version":"1.0.1"') });
  commitAll(m.repo, 'Change the lockfile');
  const r = push(m.repo);
  assert.equal(countLines(m.counter), 2, `a changed package-lock.json under the step's dir runs the step again\n${describe(r)}`);
  assert.equal(findStep(lastSummary(m.repo, 'push'), 'memo').result, 'pass');
});

test('ts_verify_ac6_skipped_step_reports_are_carried_over', (t) => {
  const xml =
    '<testsuites><testsuite name="s" tests="1"><testcase name="ts_verify_AC6_report" classname="s"/></testsuite></testsuites>';
  const counter = path.join(tmpDir(t, 'tegg-qa-counter-'), 'runs.log');
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'memo', run: `${markStep(counter)}; echo '${xml}' > "$VERIFY_RESULTS/r.xml"`, level: 'push', inputs: ['src'] }] },
    files: { 'src/a.txt': 'žluťoučký\n' },
  });
  const report = path.join(repo, '.verify', 'last-results', 'r.xml');
  push(repo);
  assert.ok(fs.existsSync(report), 'the first run writes r.xml into last-results');
  const firstBytes = fs.readFileSync(report);
  const r = push(repo);
  assert.equal(findStep(lastSummary(repo, 'push'), 'memo').result, 'skipped', `second push skips the step\n${describe(r)}`);
  assert.equal(countLines(counter), 1);
  assert.ok(fs.existsSync(report), `the skipped step's report is carried over to last-results\n${describe(r)}`);
  assert.deepEqual(fs.readFileSync(report), firstBytes, 'the carried-over report is the first run\'s report');
});

test('ts_verify_ac6_malformed_memo_file_counts_as_empty', (t) => {
  const m = memoRepo(t);
  fs.mkdirSync(path.join(m.repo, '.verify'), { recursive: true });
  fs.writeFileSync(path.join(m.repo, MEMO), 'not json');
  const r = push(m.repo);
  assert.equal(countLines(m.counter), 1, `the step runs with an empty memo\n${describe(r)}`);
  const text = fs.readFileSync(path.join(m.repo, MEMO), 'utf8');
  assert.doesNotThrow(() => JSON.parse(text), `the memo file is rewritten as valid JSON, got: ${text}`);
  const r2 = push(m.repo);
  assert.equal(countLines(m.counter), 1, `the rewritten memo is used by the next push\n${describe(r2)}`);
  assert.equal(findStep(lastSummary(m.repo, 'push'), 'memo').result, 'skipped');
});

test('ts_verify_ac6_check_red_never_reads_or_writes_memo', (t) => {
  const RED_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('fr_abc_01_AC1_title_keeps_diacritics', () => {
  assert.equal('Prilis zlutoucky kun', 'Příliš žluťoučký kůň');
});
`;
  const counter = path.join(tmpDir(t, 'tegg-qa-counter-'), 'runs.log');
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'memo', run: markStep(counter), level: 'push', inputs: ['src'] }], acRunners: [NODE_AC_RUNNER] },
    files: { 'src/a.txt': 'žluťoučký\n' },
  });
  git(repo, ['checkout', '-q', '-b', 'feature']);
  writeFiles(repo, { 't/new.ac.test.ts': RED_TEST });
  const sha = commitAll(repo, 'Add AC test');
  const memoFile = path.join(repo, MEMO);
  fs.mkdirSync(path.dirname(memoFile), { recursive: true });
  const garbage = Buffer.from('not json\n');
  fs.writeFileSync(memoFile, garbage);
  assertExit(verify(repo, ['check-red', sha]), 0, 'check-red for a red commit');
  assert.deepEqual(fs.readFileSync(memoFile), garbage, 'check-red leaves the memo file byte-identical');
  assert.equal(countLines(counter), 0, 'check-red runs no gate step');
  // The push gate owns the file: it rewrites the malformed memo and uses it afterwards.
  push(repo);
  assert.equal(countLines(counter), 1);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(memoFile, 'utf8')), 'the push gate rewrites the memo as JSON');
  push(repo);
  assert.equal(countLines(counter), 1, 'the second push reuses the recorded pass');
  assert.equal(findStep(lastSummary(repo, 'push'), 'memo').result, 'skipped');
});
