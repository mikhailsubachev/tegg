// TS-VERIFY AC-9: one record of passes for every checkout (D-1831). Black box against tools/qa/CONTRACT.md §1.2
// (shared state), §3.2 (passed trees), §3.2.3 (memo location), §4.2 and §4.4 (hooks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ZERO_SHA, addWorktree, assertExit, commitAll, countLines, describe, findStep, headSha, lastSummary, makeRepo,
  markStep, readJsonFile, readText, sharedDir, tmpDir, treeOf, verify, writeFiles, type RunResult, type Step,
} from './helpers.ts';

const XML =
  '<testsuites><testsuite name="s" tests="1"><testcase name="sdílená zpráva" classname="s"/></testsuite></testsuites>';

type Shared = { repo: string; counter: string };

/** A repo with one push-level counting step that depends on `src/` only (so the step memo applies to it). */
function memoRepo(t: any, stepOverrides: Partial<Step> = {}): Shared {
  const counter = path.join(tmpDir(t, 'tegg-qa-counter-'), 'runs.log');
  const step: Step = { id: 'memo', run: markStep(counter), level: 'push', inputs: ['src'], ...stepOverrides };
  const repo = makeRepo(t, {
    config: { steps: [step] },
    files: { 'src/a.txt': 'Příliš žluťoučký kůň\n', 'other/b.txt': 'úpěl ďábelské ódy\n' },
  });
  return { repo, counter };
}

/** A repo with one push-level counting step without `inputs`: it runs in every push gate that runs. */
function countingRepo(t: any): Shared {
  const counter = path.join(tmpDir(t, 'tegg-qa-counter-'), 'runs.log');
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'count', run: markStep(counter), level: 'push' }] },
    files: { 'src/a.txt': 'Šťastný nový týden\n' },
  });
  return { repo, counter };
}

function push(dir: string, args: string[] = []): RunResult {
  const r = verify(dir, ['push', ...args]);
  assertExit(r, 0, `verify push ${args.join(' ')} in ${dir}`);
  return r;
}

function passedTrees(repo: string): string[] {
  const text = readText(path.join(sharedDir(repo), 'passed-trees'), 'the shared passed-trees file');
  return text.split('\n').filter((l) => l.length > 0);
}

function sharedMemo(repo: string): any {
  return readJsonFile(path.join(sharedDir(repo), 'step-memo.json'), 'the shared step memo');
}

/** Every string stored under a key `results` anywhere in the memo (CONTRACT §3.2.3: each record holds `results`). */
function resultsFolders(memo: unknown): string[] {
  const found: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [key, value] of Object.entries(v)) {
        if (key === 'results' && typeof value === 'string') found.push(value);
        else walk(value);
      }
    }
  };
  walk(memo);
  return found;
}

function hookInput(command: string): string {
  return JSON.stringify({ session_id: 'test', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
}

function prePushLine(dir: string): string {
  return `refs/heads/x ${headSha(dir)} refs/heads/x ${ZERO_SHA}\n`;
}

// ---------------------------------------------------------------------------
// The step memo is shared: a pass in one checkout is reused in every other
// ---------------------------------------------------------------------------

test('ts_verify_ac9_step_passed_in_main_checkout_is_skipped_in_a_worktree', (t) => {
  const { repo, counter } = memoRepo(t);
  push(repo);
  assert.equal(countLines(counter), 1, 'the push in the main checkout runs the step');
  const first = lastSummary(repo, 'push');
  const wt = addWorktree(t, repo, 'druhá-větev');
  const r = push(wt);
  assert.equal(countLines(counter), 1, `the worktree's push reuses the pass recorded in the main checkout\n${describe(r)}`);
  const step = findStep(lastSummary(wt, 'push'), 'memo');
  assert.equal(step.result, 'skipped', `the worktree reports the step skipped\n${describe(r)}`);
  assert.equal(step.reuses, first.startedAt, 'the skipped entry names the main checkout\'s run by its startedAt');
  assert.equal(step.durationMs, 0, 'a skipped step has durationMs 0');
  const line = r.stdout.split('\n').find((l) => l.includes('memo') && l.includes('skipped'));
  assert.ok(line, `stdout reports the step as skipped\n${describe(r)}`);
  assert.ok(line.includes(first.startedAt), `the skip line names the reused run ${first.startedAt}: ${line}`);
  assert.ok(line.includes('push'), `the skip line names the gate of the reused run: ${line}`);
});

test('ts_verify_ac9_step_passed_in_a_worktree_is_skipped_in_main_checkout_and_other_worktrees', (t) => {
  const { repo, counter } = memoRepo(t);
  const wt1 = addWorktree(t, repo, 'první');
  const wt2 = addWorktree(t, repo, 'druhá');
  push(wt1);
  assert.equal(countLines(counter), 1, 'the push in the first worktree runs the step');
  const first = lastSummary(wt1, 'push');
  for (const dir of [repo, wt2]) {
    const r = push(dir);
    assert.equal(countLines(counter), 1, `the push in ${dir} reuses the pass recorded in the first worktree\n${describe(r)}`);
    const step = findStep(lastSummary(dir, 'push'), 'memo');
    assert.equal(step.result, 'skipped', `${dir} reports the step skipped\n${describe(r)}`);
    assert.equal(step.reuses, first.startedAt, 'the skipped entry names the first worktree\'s run');
  }
});

test('ts_verify_ac9_changed_input_in_a_worktree_runs_the_step_there', (t) => {
  const { repo, counter } = memoRepo(t);
  push(repo);
  const wt = addWorktree(t, repo, 'změna');
  const skipped = push(wt);
  assert.equal(countLines(counter), 1, `same inputs: the worktree skips the step\n${describe(skipped)}`);
  assert.equal(findStep(lastSummary(wt, 'push'), 'memo').result, 'skipped');
  writeFiles(wt, { 'src/a.txt': 'Příliš žluťoučký kůň úpěl\n' });
  commitAll(wt, 'Change an input in the worktree');
  const r = push(wt);
  assert.equal(countLines(counter), 2, `a changed input runs the step in the worktree\n${describe(r)}`);
  assert.equal(findStep(lastSummary(wt, 'push'), 'memo').result, 'pass');
  // The main checkout still has the old inputs: its recorded pass still counts there.
  const again = push(repo);
  assert.equal(countLines(counter), 2, `the main checkout's inputs are unchanged\n${describe(again)}`);
  assert.equal(findStep(lastSummary(repo, 'push'), 'memo').result, 'skipped');
});

test('ts_verify_ac9_skipped_step_in_a_worktree_carries_reports_over_while_they_exist', (t) => {
  const { repo, counter } = memoRepo(t);
  writeFiles(repo, {
    'qa.config.json': JSON.stringify({
      steps: [{ id: 'memo', run: `${markStep(counter)}; echo '${XML}' > "$VERIFY_RESULTS/r.xml"`, level: 'push', inputs: ['src'] }],
    }),
  });
  commitAll(repo, 'The step writes a JUnit report');
  push(repo);
  const firstBytes = readText(path.join(repo, '.verify', 'last-results', 'r.xml'), 'the main checkout\'s report');

  const wt = addWorktree(t, repo, 'zprávy');
  const report = path.join(wt, '.verify', 'last-results', 'r.xml');
  const r = push(wt);
  assert.equal(countLines(counter), 1, `the worktree skips the step\n${describe(r)}`);
  assert.equal(findStep(lastSummary(wt, 'push'), 'memo').result, 'skipped');
  assert.ok(fs.existsSync(report), `the report of the main checkout's run is carried over to the worktree's last-results\n${describe(r)}`);
  assert.equal(fs.readFileSync(report, 'utf8'), firstBytes, 'the carried-over report is the main checkout\'s report');

  // Each record holds `results`, the absolute path of its run's results folder. Once that folder is gone the step
  // is still skipped, only without its reports.
  const folders = resultsFolders(sharedMemo(repo));
  assert.ok(folders.length > 0, 'the shared memo records the results folder of the run');
  for (const folder of folders) {
    assert.ok(path.isAbsolute(folder), `a record's results folder is an absolute path: ${folder}`);
    fs.rmSync(folder, { recursive: true, force: true });
  }
  const wt2 = addWorktree(t, repo, 'bez-zpráv');
  const r2 = push(wt2);
  assert.equal(countLines(counter), 1, `the step is still skipped when the reused run's reports are gone\n${describe(r2)}`);
  assert.equal(findStep(lastSummary(wt2, 'push'), 'memo').result, 'skipped');
  assert.equal(fs.existsSync(path.join(wt2, '.verify', 'last-results', 'r.xml')), false, 'a report that no longer exists is not carried over');
});

// ---------------------------------------------------------------------------
// Passed trees are shared: the hooks let a tree through that passed in any worktree
// ---------------------------------------------------------------------------

test('ts_verify_ac9_pre_push_hook_skips_a_tree_that_passed_in_another_worktree', (t) => {
  const { repo, counter } = countingRepo(t);
  push(repo);
  assert.equal(countLines(counter), 1, 'the push gate ran once in the main checkout');
  const wt = addWorktree(t, repo, 'odeslání');
  assert.equal(fs.existsSync(path.join(wt, '.verify', 'last-pass')), false, 'the worktree has no last-pass of its own');
  const r = verify(wt, ['hook', 'pre-push', 'origin', 'file:///nowhere'], { input: prePushLine(wt) });
  assertExit(r, 0, 'hook pre-push in a worktree for a tree that passed in the main checkout');
  assert.equal(countLines(counter), 1, `nothing runs for a tree that already passed in another checkout\n${describe(r)}`);

  // Another tree hasn't passed anywhere: the hook runs the push gate for it.
  writeFiles(wt, { 'src/a.txt': 'Šťastný nový měsíc\n' });
  commitAll(wt, 'Change the tree');
  const r2 = verify(wt, ['hook', 'pre-push', 'origin', 'file:///nowhere'], { input: prePushLine(wt) });
  assertExit(r2, 0, 'hook pre-push in a worktree for a new tree');
  assert.equal(countLines(counter), 2, `a tree that passed nowhere runs the push gate\n${describe(r2)}`);
  // And the pass the hook's gate recorded lets the main checkout push the same tree.
  const r3 = verify(repo, ['hook', 'pre-push', 'origin', 'file:///nowhere'], { input: prePushLine(wt) });
  assertExit(r3, 0, 'hook pre-push in the main checkout for the tree the worktree\'s hook passed');
  assert.equal(countLines(counter), 2, `the tree passed in the worktree, so nothing runs in the main checkout\n${describe(r3)}`);
});

test('ts_verify_ac9_claude_hook_allows_a_tree_that_passed_in_another_worktree', (t) => {
  const { repo } = countingRepo(t);
  const wt = addWorktree(t, repo, 'claude');
  push(wt);
  // The main checkout (same tree, no last-pass of its own) may push.
  assert.equal(fs.existsSync(path.join(repo, '.verify', 'last-pass')), false, 'the main checkout has no last-pass of its own');
  for (const cmd of ['git push origin main', 'gh pr merge 3 --squash']) {
    const r = verify(repo, ['hook', 'claude-pre-tool'], { input: hookInput(cmd) });
    assertExit(r, 0, `claude-pre-tool for "${cmd}" in a checkout whose tree passed in a worktree`);
    assert.equal(r.stdout + r.stderr, '', `the hook prints nothing when it lets the command through\n${describe(r)}`);
  }
  // A tree that passed nowhere is still blocked.
  writeFiles(repo, { 'src/a.txt': 'Šťastný nový rok\n' });
  commitAll(repo, 'Change the tree');
  const blocked = verify(repo, ['hook', 'claude-pre-tool'], { input: hookInput('git push origin main') });
  assertExit(blocked, 2, 'claude-pre-tool for a tree that passed in no checkout');
  assert.match(blocked.stderr, /\.\/verify push/, 'stderr tells to run ./verify push');
});

test('ts_verify_ac9_passed_trees_lists_each_tree_once_newest_last', (t) => {
  const { repo } = countingRepo(t);
  const shaA = headSha(repo);
  const treeA = treeOf(repo);
  push(repo);
  assert.deepEqual(passedTrees(repo), [treeA], 'the first passing push records its tree');
  assert.equal(readText(path.join(sharedDir(repo), 'passed-trees'), 'passed-trees').endsWith('\n'), true, 'each hash is followed by a newline');
  writeFiles(repo, { 'src/a.txt': 'Šťastný nový den\n' });
  commitAll(repo, 'Second tree');
  const treeB = treeOf(repo);
  push(repo);
  assert.deepEqual(passedTrees(repo), [treeA, treeB], 'a second tree is appended');
  push(repo, ['--commit', shaA]);
  assert.deepEqual(passedTrees(repo), [treeB, treeA], 'a hash already there moves to the end');
  assert.equal(readText(path.join(repo, '.verify', 'last-pass'), 'last-pass'), `${treeA}\n`, 'last-pass names the last passed tree');
});

test('ts_verify_ac9_passed_trees_keeps_at_most_200_lines', (t) => {
  const { repo } = countingRepo(t);
  const old = Array.from({ length: 200 }, (_, i) => (i + 1).toString(16).padStart(40, '0'));
  writeFiles(repo, { '.git/tegg-verify/passed-trees': old.join('\n') + '\n' });
  push(repo);
  const lines = passedTrees(repo);
  assert.equal(lines.length, 200, 'the file keeps at most 200 lines');
  assert.equal(lines[199], treeOf(repo), 'the newest tree is the last line');
  assert.deepEqual(lines.slice(0, 199), old.slice(1), 'the oldest line is the one dropped');
});

test('ts_verify_ac9_failing_push_and_explicit_range_record_no_passed_tree', (t) => {
  const flag = path.join(tmpDir(t, 'tegg-qa-flag-'), 'ready');
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'gate', run: `test -f '${flag}'`, level: 'push' }] },
    files: { 'src/a.txt': 'Žlutý kůň\n' },
  });
  const treeA = treeOf(repo);
  fs.writeFileSync(flag, '');
  push(repo);
  assert.deepEqual(passedTrees(repo), [treeA], 'the passing default-range push records its tree');

  writeFiles(repo, { 'src/a.txt': 'Žlutý kůň běží\n' });
  commitAll(repo, 'Second tree');
  const ranged = push(repo, ['--range', 'HEAD~1..HEAD']);
  assert.deepEqual(passedTrees(repo), [treeA], `a passing run with an explicit --range records no passed tree\n${describe(ranged)}`);
  assert.equal(readText(path.join(repo, '.verify', 'last-pass'), 'last-pass'), `${treeA}\n`, 'and leaves last-pass unchanged');
  const wt = addWorktree(t, repo, 'rozsah');
  const blocked = verify(wt, ['hook', 'claude-pre-tool'], { input: hookInput('git push') });
  assertExit(blocked, 2, 'claude-pre-tool in a worktree for a tree that passed only with an explicit --range');

  fs.rmSync(flag);
  const failing = verify(repo, ['push']);
  assertExit(failing, 1, 'verify push with a failing step');
  assert.deepEqual(passedTrees(repo), [treeA], 'a failing push records no passed tree');
});

// ---------------------------------------------------------------------------
// The checkout's own files are still written and still count
// ---------------------------------------------------------------------------

test('ts_verify_ac9_checkout_memo_and_last_pass_are_still_written_and_still_count', (t) => {
  const { repo, counter } = memoRepo(t);
  push(repo);
  const tree = treeOf(repo);
  assert.equal(readText(path.join(repo, '.verify', 'last-pass'), 'the checkout\'s last-pass'), `${tree}\n`);
  readJsonFile(path.join(repo, '.verify', 'step-memo.json'), 'the checkout\'s step memo');
  sharedMemo(repo);
  assert.deepEqual(passedTrees(repo), [tree], 'the shared passed-trees has the tree too');

  // Without the shared folder the checkout's own records still count.
  fs.rmSync(sharedDir(repo), { recursive: true, force: true });
  const hook = verify(repo, ['hook', 'claude-pre-tool'], { input: hookInput('git push') });
  assertExit(hook, 0, 'claude-pre-tool with only the checkout\'s last-pass');
  const r = push(repo);
  assert.equal(countLines(counter), 1, `the checkout's own memo still skips the step\n${describe(r)}`);
  assert.equal(findStep(lastSummary(repo, 'push'), 'memo').result, 'skipped');
  assert.deepEqual(passedTrees(repo), [tree], 'the gate writes the missing shared passed-trees again');
});

// ---------------------------------------------------------------------------
// A missing or malformed shared file counts as empty and never fails a gate
// ---------------------------------------------------------------------------

test('ts_verify_ac9_malformed_shared_files_count_as_empty_and_are_rewritten', (t) => {
  const { repo, counter } = memoRepo(t);
  writeFiles(repo, {
    '.git/tegg-verify/step-memo.json': 'not json',
    '.git/tegg-verify/passed-trees': '\u0000\u0001 tohle není seznam stromů',
    '.git/tegg-verify/step-runs.json': '{"oops":',
    '.git/tegg-verify/flaky.json': '[[',
  });
  const r = push(repo);
  assert.equal(countLines(counter), 1, `the step runs with an empty memo\n${describe(r)}`);
  assert.equal(findStep(lastSummary(repo, 'push'), 'memo').result, 'pass');
  sharedMemo(repo);
  const trees = passedTrees(repo);
  assert.equal(trees[trees.length - 1], treeOf(repo), 'the passed tree is the last line of the rewritten passed-trees');
  // The rewritten files are used by another checkout.
  const wt = addWorktree(t, repo, 'po-opravě');
  const r2 = push(wt);
  assert.equal(countLines(counter), 1, `the rewritten shared memo is used by a worktree\n${describe(r2)}`);
  assert.equal(findStep(lastSummary(wt, 'push'), 'memo').result, 'skipped');
});

test('ts_verify_ac9_unusable_shared_folder_warns_and_checkout_files_still_work', (t) => {
  const { repo, counter } = memoRepo(t);
  // A regular file where the folder should be: the folder can't be created.
  writeFiles(repo, { '.git/tegg-verify': 'tady nemůže vzniknout složka\n' });
  const r = push(repo);
  assert.equal(countLines(counter), 1, 'the step runs');
  const warning = r.stderr.split('\n').find((l) => l.includes('shared state'));
  assert.ok(warning, `stderr has a warning containing "shared state"\n${describe(r)}`);
  assert.equal(readText(path.join(repo, '.verify', 'last-pass'), 'the checkout\'s last-pass'), `${treeOf(repo)}\n`);
  const r2 = push(repo);
  assert.equal(countLines(counter), 1, `the checkout's own memo is used\n${describe(r2)}`);
  assert.equal(findStep(lastSummary(repo, 'push'), 'memo').result, 'skipped');
  const hook = verify(repo, ['hook', 'claude-pre-tool'], { input: hookInput('git push') });
  assertExit(hook, 0, 'claude-pre-tool with the checkout\'s last-pass and no shared folder');
});
