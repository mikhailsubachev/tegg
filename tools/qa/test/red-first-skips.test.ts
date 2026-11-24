// D-2243: the red-first verdict on an added AC test file. A testcase skipped in one run (a contract's one-engine test,
// such as AND-2's pinch on phone-chromium only) counts as red when the same test failed with an AssertionError in
// another run of the report; a skip without such a twin still fails the check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redCaseProblems } from '../src/checks.ts';
import type { TestCase } from '../src/junit.ts';

const red = (name: string, classname = 'phone_mindmap.ac.test.ts'): TestCase => ({ name, classname, failure: 'AssertionError: expected', skipped: false });
const skip = (name: string, classname = 'phone_mindmap.ac.test.ts'): TestCase => ({ name, classname, failure: undefined, skipped: true });

test('red_first_a_skip_with_a_red_twin_in_another_run_is_red', () => {
  assert.deepEqual(redCaseProblems('f', [red('pinch'), skip('pinch'), red('zoom'), red('zoom')]), []);
});

test('red_first_a_skip_without_a_red_twin_fails', () => {
  assert.deepEqual(redCaseProblems('f', [skip('pinch'), skip('pinch'), red('zoom')]), ['f: 2 testcase(s) skipped']);
  assert.deepEqual(redCaseProblems('f', [skip('pinch'), red('pinch', 'other.ac.test.ts')]), ['f: 1 testcase(s) skipped']);
});

test('red_first_a_skip_whose_twin_errors_is_not_red', () => {
  const err: TestCase = { name: 'pinch', classname: 'phone_mindmap.ac.test.ts', failure: 'Error: boom', skipped: false };
  const out = redCaseProblems('f', [skip('pinch'), err]);
  assert.equal(out.length, 2);
  assert.match(out[0], /1 testcase\(s\) skipped/);
  assert.match(out[1], /without an AssertionError/);
});
