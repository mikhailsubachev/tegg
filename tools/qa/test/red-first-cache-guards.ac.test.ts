// TS-I AC-2: red-first cache of the push gate. Black box against tools/qa/CONTRACT.md §3.2, §5.2, §5.2.1. Guards that already held before the cache (kept apart: red-first needs every testcase red).
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

test('ts_i_ac2_red_first_cache_failed_check_red_is_not_cached', (t) => {
  const { repo, counter } = setup(t, GREEN_TEST);
  push(repo, 1, 'first verify push with a green-on-arrival test', 'fail');
  assert.equal(countLines(counter), 1, 'first push runs the runner');
  push(repo, 1, 'second verify push with a green-on-arrival test', 'fail');
  assert.equal(countLines(counter), 2, 'a failing commit is never cached and runs again');
});

test('ts_i_ac2_red_first_cache_malformed_cache_file_does_not_fail_gate', (t) => {
  const { repo, counter } = setup(t, RED_TEST);
  writeFiles(repo, { '.verify/red-first-cache.json': 'not json' });
  push(repo, 0, 'push with a malformed cache file', 'pass');
  assert.equal(countLines(counter), 1, 'malformed cache is treated as empty');
});
