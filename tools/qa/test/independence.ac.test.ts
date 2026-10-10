// TS-I: independence controls (D-61). Black box against tools/qa/CONTRACT.md §4.3, §5, §10.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_AC_RUNNER, assertExit, assertNonZero, checkMessages, commitAll, configJson, describe, findCheck,
  git, gitTry, headSha, installRealHooks, lastSummary, makeRepo, output, verify, writeFiles,
} from './helpers.ts';

const TRAILER = 'AC-Test-Change: rename after AP-9; approved-by: owner';
const MSG_FILE = '.git/COMMIT_EDITMSG';

const RED_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('fr_abc_01_AC1_title_keeps_diacritics', () => {
  assert.equal('Vylet do Lisabonu', 'Výlet do Lisabonu');
});
`;
const GREEN_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('fr_abc_01_AC2_already_passes', () => {
  assert.equal(1 + 1, 2);
});
`;
const MIXED_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('fr_abc_01_AC3_red', () => { assert.equal(1, 2); });
test('fr_abc_01_AC3_green', () => { assert.equal(2, 2); });
`;
const SYNTAX_ERROR_TEST = `import { test } from 'node:test';
test('fr_abc_01_AC4_broken', () => {
  const x = ;
});
`;
const MISSING_MODULE_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { title } from '../src/does-not-exist.ts';
test('fr_abc_01_AC5_missing', () => { assert.equal(title(), 'Výlet'); });
`;

// ---------------------------------------------------------------------------
// AC-1: commit-msg rejects modifying/deleting existing AC tests without trailer
// ---------------------------------------------------------------------------

function acRepo(t: any) {
  return makeRepo(t, {
    files: {
      'tools/qa/test/existing.ac.test.ts': RED_TEST,
      'tests/ac_import.rs': '#[test]\nfn fr_imp_07_AC1_utf8_names() {}\n',
      'src/lib.ts': 'export const x = 1;\n',
    },
  });
}

function commitMsg(repo: string, message: string) {
  writeFiles(repo, { [MSG_FILE]: message });
  return verify(repo, ['hook', 'commit-msg', MSG_FILE]);
}

test('ts_i_ac1_modifying_ac_test_without_trailer_is_rejected', (t) => {
  const repo = acRepo(t);
  writeFiles(repo, { 'tools/qa/test/existing.ac.test.ts': RED_TEST + '// tweak\n' });
  git(repo, ['add', '-A']);
  const r = commitMsg(repo, 'Tweak test\n');
  assertExit(r, 1, 'commit-msg for a modified AC test without trailer');
  assert.ok(output(r).includes('tools/qa/test/existing.ac.test.ts'), `the message must name the file\n${describe(r)}`);
});

test('ts_i_ac1_modifying_ac_test_with_owner_trailer_is_accepted', (t) => {
  const repo = acRepo(t);
  writeFiles(repo, { 'tools/qa/test/existing.ac.test.ts': RED_TEST + '// tweak\n' });
  git(repo, ['add', '-A']);
  assertExit(commitMsg(repo, `Tweak test\n\n${TRAILER}\n`), 0, 'commit-msg with the trailer');
});

test('ts_i_ac1_trailer_without_owner_approval_is_rejected', (t) => {
  const repo = acRepo(t);
  writeFiles(repo, { 'tools/qa/test/existing.ac.test.ts': RED_TEST + '// tweak\n' });
  git(repo, ['add', '-A']);
  assertExit(commitMsg(repo, 'Tweak test\n\nAC-Test-Change: just because\n'), 1, 'commit-msg with an incomplete trailer');
});

test('ts_i_ac1_deleting_or_renaming_ac_test_needs_trailer', (t) => {
  const del = acRepo(t);
  git(del, ['rm', '-q', 'tools/qa/test/existing.ac.test.ts']);
  assertExit(commitMsg(del, 'Remove test\n'), 1, 'commit-msg for a deleted AC test');

  const ren = acRepo(t);
  git(ren, ['mv', 'tools/qa/test/existing.ac.test.ts', 'tools/qa/test/renamed.ac.test.ts']);
  assertExit(commitMsg(ren, 'Rename test\n'), 1, 'commit-msg for a renamed AC test');
});

test('ts_i_ac1_modifying_rust_ac_test_needs_trailer', (t) => {
  const repo = acRepo(t);
  writeFiles(repo, { 'tests/ac_import.rs': '#[test]\nfn fr_imp_07_AC1_utf8_names() { assert!(true); }\n' });
  git(repo, ['add', '-A']);
  const r = commitMsg(repo, 'Tweak rust test\n');
  assertExit(r, 1, 'commit-msg for a modified tests/ac_*.rs');
  assert.ok(output(r).includes('tests/ac_import.rs'), `the message must name the file\n${describe(r)}`);
});

test('ts_i_ac1_adding_ac_test_or_changing_other_files_needs_no_trailer', (t) => {
  const repo = acRepo(t);
  writeFiles(repo, { 'tools/qa/test/new.ac.test.ts': GREEN_TEST, 'src/lib.ts': 'export const x = 2;\n' });
  git(repo, ['add', '-A']);
  assertExit(commitMsg(repo, 'Add test\n'), 0, 'commit-msg for an added AC test and a non-test change');
});

test('ts_i_ac1_commit_msg_hook_blocks_real_commit', (t) => {
  const repo = acRepo(t);
  installRealHooks(repo);
  commitAll(repo, 'add hooks');
  const before = headSha(repo);
  writeFiles(repo, { 'tools/qa/test/existing.ac.test.ts': RED_TEST + '// tweak\n' });
  git(repo, ['add', '-A']);
  assertNonZero(gitTry(repo, ['commit', '-q', '-m', 'Tweak test']), 'git commit without trailer');
  assert.equal(headSha(repo), before, 'no commit without trailer');
  assertExit(gitTry(repo, ['commit', '-q', '-m', `Tweak test\n\n${TRAILER}`]), 0, 'git commit with trailer');
  assert.notEqual(headSha(repo), before, 'commit with trailer is created');
});

test('ts_i_ac1_push_gate_rejects_range_commit_modifying_ac_test', (t) => {
  const repo = acRepo(t);
  git(repo, ['checkout', '-q', '-b', 'feature']);
  writeFiles(repo, { 'tools/qa/test/existing.ac.test.ts': RED_TEST + '// weakened\n' });
  const bad = commitAll(repo, 'Weaken test');
  const r = verify(repo, ['push']);
  assertExit(r, 1, 'verify push with an unapproved AC test change in range');
  const s = lastSummary(repo, 'push');
  assert.equal(findCheck(s, 'ac-test-protection').result, 'fail');
  const msgs = checkMessages(s, 'ac-test-protection');
  assert.ok(msgs.includes('tools/qa/test/existing.ac.test.ts'), `must name the file: ${msgs}`);
  assert.ok(msgs.includes(bad.slice(0, 7)), `must name the commit ${bad}: ${msgs}`);
});

test('ts_i_ac1_push_gate_accepts_range_commit_with_trailer', (t) => {
  const repo = acRepo(t);
  git(repo, ['checkout', '-q', '-b', 'feature']);
  writeFiles(repo, { 'tools/qa/test/existing.ac.test.ts': RED_TEST + '// clarified\n' });
  commitAll(repo, `Clarify test\n\n${TRAILER}`);
  assertExit(verify(repo, ['push']), 0, 'verify push with an approved AC test change');
  assert.equal(findCheck(lastSummary(repo, 'push'), 'ac-test-protection').result, 'pass');
});

// ---------------------------------------------------------------------------
// AC-2: check-red passes only if added AC tests fail with assertion failures
// ---------------------------------------------------------------------------

function redRepo(t: any) {
  return makeRepo(t, { config: { steps: [], acRunners: [NODE_AC_RUNNER] }, files: { 'src/.keep': '' } });
}

function addAndCommit(repo: string, files: Record<string, string>, message = 'test: acceptance tests (red)'): string {
  writeFiles(repo, files);
  return commitAll(repo, message);
}

test('ts_i_ac2_check_red_passes_for_assertion_failures', (t) => {
  const repo = redRepo(t);
  const c = addAndCommit(repo, { 't/red.ac.test.ts': RED_TEST });
  assertExit(verify(repo, ['check-red', c]), 0, 'check-red for a commit adding a red AC test');
});

test('ts_i_ac2_check_red_fails_for_passing_test', (t) => {
  const repo = redRepo(t);
  const c = addAndCommit(repo, { 't/green.ac.test.ts': GREEN_TEST });
  const r = verify(repo, ['check-red', c]);
  assertExit(r, 1, 'check-red for a passing AC test');
  assert.ok(output(r).includes('t/green.ac.test.ts'), `must list the failing file\n${describe(r)}`);
});

test('ts_i_ac2_check_red_fails_if_any_testcase_passes', (t) => {
  const repo = redRepo(t);
  const c = addAndCommit(repo, { 't/mixed.ac.test.ts': MIXED_TEST });
  assertExit(verify(repo, ['check-red', c]), 1, 'check-red for a file with one passing testcase');
});

test('ts_i_ac2_check_red_fails_for_syntax_error', (t) => {
  const repo = redRepo(t);
  const c = addAndCommit(repo, { 't/syntax.ac.test.ts': SYNTAX_ERROR_TEST });
  const r = verify(repo, ['check-red', c]);
  assertExit(r, 1, 'check-red for a syntax error');
  assert.ok(output(r).includes('t/syntax.ac.test.ts'), `must list the failing file\n${describe(r)}`);
});

test('ts_i_ac2_check_red_fails_for_missing_module', (t) => {
  const repo = redRepo(t);
  const c = addAndCommit(repo, { 't/missing.ac.test.ts': MISSING_MODULE_TEST });
  assertExit(verify(repo, ['check-red', c]), 1, 'check-red for a missing module');
});

test('ts_i_ac2_check_red_judges_each_added_file', (t) => {
  const repo = redRepo(t);
  const c = addAndCommit(repo, { 't/red.ac.test.ts': RED_TEST, 't/green.ac.test.ts': GREEN_TEST });
  const r = verify(repo, ['check-red', c]);
  assertExit(r, 1, 'check-red with one red and one green file');
  assert.ok(output(r).includes('t/green.ac.test.ts'), `must list the green file\n${describe(r)}`);
});

test('ts_i_ac2_check_red_without_added_ac_tests_exits_1', (t) => {
  const repo = redRepo(t);
  const c = addAndCommit(repo, { 'src/lib.ts': 'export const x = 1;\n' }, 'no tests');
  const r = verify(repo, ['check-red', c]);
  assertExit(r, 1, 'check-red for a commit without AC tests');
  assert.match(output(r), /no AC tests added/);
});

test('ts_i_ac2_check_red_fails_when_no_runner_matches', (t) => {
  const repo = redRepo(t);
  const c = addAndCommit(repo, { 'tests/ac_links.rs': '#[test]\nfn fr_lnk_14_AC1_x() { assert_eq!(1, 2); }\n' });
  const r = verify(repo, ['check-red', c]);
  assertExit(r, 1, 'check-red for an AC test without a matching runner');
  assert.ok(output(r).includes('tests/ac_links.rs'), `must list the file\n${describe(r)}`);
});

test('ts_i_ac2_check_red_checks_out_the_given_commit', (t) => {
  const repo = redRepo(t);
  const testFile = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { title } from '../src/title.ts';
test('fr_abc_01_AC1_title', () => { assert.equal(title(), 'Výlet do Lisabonu'); });
`;
  const red = addAndCommit(repo, { 'src/title.ts': "export function title() { return 'TODO'; }\n", 't/title.ac.test.ts': testFile });
  addAndCommit(repo, { 'src/title.ts': "export function title() { return 'Výlet do Lisabonu'; }\n" }, 'implement title');
  assertExit(verify(repo, ['check-red', red]), 0, 'check-red of the red commit while HEAD makes the test pass');
});

test('ts_i_ac2_check_red_reads_runners_from_current_checkout', (t) => {
  const repo = makeRepo(t, { config: { steps: [] } });
  const c = addAndCommit(repo, { 't/red.ac.test.ts': RED_TEST });
  writeFiles(repo, { 'qa.config.json': configJson({ steps: [], acRunners: [NODE_AC_RUNNER] }) });
  assertExit(verify(repo, ['check-red', c]), 0, 'check-red with acRunners only in the working copy config');
});

test('ts_i_ac2_push_gate_runs_red_first_for_added_ac_tests', (t) => {
  const repo = redRepo(t);
  git(repo, ['checkout', '-q', '-b', 'feature']);
  addAndCommit(repo, { 't/green.ac.test.ts': GREEN_TEST }, 'add a test that already passes');
  const r = verify(repo, ['push']);
  assertExit(r, 1, 'verify push with a green-on-arrival AC test');
  assert.equal(findCheck(lastSummary(repo, 'push'), 'red-first').result, 'fail');
});

test('ts_i_ac2_push_gate_accepts_red_tests_and_exempt_commits', (t) => {
  const repo = redRepo(t);
  git(repo, ['checkout', '-q', '-b', 'feature']);
  addAndCommit(repo, { 't/red.ac.test.ts': RED_TEST });
  addAndCommit(repo, { 't/green.ac.test.ts': GREEN_TEST }, 'bootstrap\n\nRed-First-Exempt: tooling bootstrap; approved-by: owner');
  assertExit(verify(repo, ['push']), 0, 'verify push with a red test and an exempt commit');
  assert.equal(findCheck(lastSummary(repo, 'push'), 'red-first').result, 'pass');
});

