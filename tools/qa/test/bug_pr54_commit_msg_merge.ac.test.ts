// Regression found in PR #54 (TS-I AC-1, CONTRACT §4.3 and §5.0, TS-D2): the commit-msg hook judged a merge commit
// by everything it brought in from the other branch, so merging main (whose AC tests had changed with their own
// trailers) into a branch demanded an `AC-Test-Change` trailer the merge did not need. A merge commit must be judged
// by its own changes only: the files whose result differs from every parent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assertExit, describe, git, gitTry, makeRepo, verify, writeFiles } from './helpers.ts';

const AC = (body: string) => `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('fr_abc_01_AC1_x', () => {\n  assert.equal(${body}, 1);\n});\n`;

/** A repo where main changed an AC test (with its trailer) after `feature` branched off, merged with --no-commit. */
function mergeOfMain(t: any, conflict: boolean): { repo: string; msg: string } {
  const repo = makeRepo(t, { files: { 't/x.ac.test.ts': AC('1'), 'src/a.txt': 'a\n' } });
  git(repo, ['checkout', '-q', '-b', 'feature']);
  writeFiles(repo, { 'src/a.txt': 'feature\n', ...(conflict ? { 't/x.ac.test.ts': AC('1 + 0') } : {}) });
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '--no-verify', '-m', conflict ? 'Feature edits the AC test\n\nAC-Test-Change: feature side; approved-by: owner' : 'Feature work']);
  git(repo, ['checkout', '-q', 'main']);
  writeFiles(repo, { 't/x.ac.test.ts': AC('2 - 1'), 'src/b.txt': 'b\n' });
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '--no-verify', '-m', 'Main changes the AC test\n\nAC-Test-Change: main side; approved-by: owner']);
  git(repo, ['checkout', '-q', 'feature']);
  const r = gitTry(repo, ['merge', '--no-commit', '--no-ff', 'main']);
  assert.equal(r.status, conflict ? 1 : 0, `setup: merge ${conflict ? 'conflicts' : 'succeeds'}\n${describe(r)}`);
  const msg = path.join(repo, '.git', 'MERGE_MSG_TEST');
  fs.writeFileSync(msg, `Merge main into feature\n`);
  return { repo, msg };
}

test('bug_pr54_ts_i_ac1_commit_msg_hook_judges_a_merge_by_its_own_changes_only', (t) => {
  // Inherited from main alone: no trailer needed.
  const inherited = mergeOfMain(t, false);
  assert.ok(fs.existsSync(path.join(inherited.repo, '.git', 'MERGE_HEAD')), 'setup: a merge is in progress');
  const r0 = verify(inherited.repo, ['hook', 'commit-msg', inherited.msg]);
  assertExit(r0, 0, 'commit-msg on a merge whose AC test change comes from main alone needs no trailer');

  // Both sides changed the AC test; the resolution differs from both parents, so it is the merge's own change.
  const own = mergeOfMain(t, true);
  writeFiles(own.repo, { 't/x.ac.test.ts': AC('3 - 2') });
  git(own.repo, ['add', 't/x.ac.test.ts']);
  const r1 = verify(own.repo, ['hook', 'commit-msg', own.msg]);
  assertExit(r1, 1, 'a resolution that differs from both parents needs the trailer');
  assert.ok(r1.stderr.includes('t/x.ac.test.ts'), `the hook names the file\n${describe(r1)}`);
  fs.writeFileSync(own.msg, 'Merge main into feature\n\nAC-Test-Change: conflict resolved; approved-by: owner\n');
  assertExit(verify(own.repo, ['hook', 'commit-msg', own.msg]), 0, 'with the trailer the merge may be committed');
});
