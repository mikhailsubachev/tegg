// TS-I AC-2: red-first cache of the push gate. Black box against tools/qa/CONTRACT.md §3.2, §5.2, §5.2.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  NODE_AC_RUNNER, assertExit, commitAll, configJson, countLines, describe, findCheck, git, lastSummary,
  makeRepo, sq, tmpDir, verify, writeFiles,
} from './helpers.ts';

const RED_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('fr_abc_01_AC1_title_keeps_diacritics', () => {
  assert.equal('Prilis zlutoucky kun', 'Příliš žluťoučký kůň');
});
`;
const GREEN_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('fr_abc_01_AC2_already_passes', () => {
  assert.equal('Úterý'.normalize('NFC'), 'Úterý');
});
`;

/** A runner that appends a line to `counter` (outside the repo) and then runs the normal node runner. */
function countingRunner(counter: string, sep = '&&') {
  return { dir: NODE_AC_RUNNER.dir, match: NODE_AC_RUNNER.match, run: `echo run >> ${sq(counter)} ${sep} ${NODE_AC_RUNNER.run}` };
}

function setup(t: any, testFile: string) {
  const counter = path.join(tmpDir(t, 'tegg-qa-counter-'), 'runs.log');
  const repo = makeRepo(t, { config: { steps: [], acRunners: [countingRunner(counter)] }, files: { 'src/.keep': '' } });
  git(repo, ['checkout', '-q', '-b', 'feature']);
  writeFiles(repo, { 't/new.ac.test.ts': testFile });
  const sha = commitAll(repo, 'Add AC test');
  return { repo, counter, sha };
}

function push(repo: string, expected: number, what: string, redFirst: 'pass' | 'fail') {
  const r = verify(repo, ['push']);
  assertExit(r, expected, what);
  assert.equal(findCheck(lastSummary(repo, 'push'), 'red-first').result, redFirst, `${what}: red-first result\n${describe(r)}`);
}

test('ts_i_ac2_red_first_cache_second_push_skips_check_red_for_red_commit', (t) => {
  const { repo, counter } = setup(t, RED_TEST);
  push(repo, 0, 'first verify push', 'pass');
  assert.equal(countLines(counter), 1, 'first push runs the AC runner once');
  push(repo, 0, 'second verify push', 'pass');
  assert.equal(countLines(counter), 1, 'second push uses the cache: the runner ran once in total');
});

test('ts_i_ac2_red_first_cache_changed_ac_runners_run_again', (t) => {
  const { repo, counter } = setup(t, RED_TEST);
  push(repo, 0, 'first verify push', 'pass');
  assert.equal(countLines(counter), 1, 'first push runs the AC runner once');
  push(repo, 0, 'second verify push', 'pass');
  assert.equal(countLines(counter), 1, 'second push uses the cache');
  // Still a valid runner, but a different `run` string, so a different fingerprint.
  writeFiles(repo, { 'qa.config.json': configJson({ steps: [], acRunners: [countingRunner(counter, ';')] }) });
  commitAll(repo, 'Change AC runner command');
  push(repo, 0, 'push after changing acRunners', 'pass');
  assert.equal(countLines(counter), 2, 'a changed acRunners fingerprint makes the recorded commit run again');
  push(repo, 0, 'push after re-recording', 'pass');
  assert.equal(countLines(counter), 2, 'the new fingerprint is cached again');
});

test('ts_i_ac2_red_first_cache_check_red_command_neither_reads_nor_writes_cache', (t) => {
  const { repo, counter, sha } = setup(t, RED_TEST);
  // check-red first on a fresh repo: must not populate the cache.
  assertExit(verify(repo, ['check-red', sha]), 0, 'check-red for a red commit');
  assert.equal(countLines(counter), 1, 'check-red runs the runner');
  push(repo, 0, 'push after check-red', 'pass');
  assert.equal(countLines(counter), 2, 'check-red did not record the commit: the push runs it');
  push(repo, 0, 'second push', 'pass');
  assert.equal(countLines(counter), 2, 'the push recorded the commit');
  // Cached by the push, but check-red ignores the cache.
  assertExit(verify(repo, ['check-red', sha]), 0, 'check-red for a cached commit');
  assert.equal(countLines(counter), 3, 'check-red runs the runner even for a cached commit');
});
