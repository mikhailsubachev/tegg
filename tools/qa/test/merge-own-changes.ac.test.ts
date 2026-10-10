// Regression guards for the merge rule (tools/qa/CONTRACT.md §5.0): a merge commit is judged by its OWN changes,
// i.e. the files whose merge result differs from every parent (combined diff). A file in the combined diff counts as
// deleted if deleted against any parent, added if new against every parent, modified otherwise. These tests check
// that such own changes ARE flagged by the fixture trailer check (§7, TS-D4 AC-1) and the AC test protection
// (§5.1, TS-I AC-1); review-decisions.ac.test.ts covers the opposite (changes brought in from one side are not).
// Also covers a range whose first commit is a root commit (§3.2).
//
// Black box: runs the real `verify` against temporary git repositories. Committed with a `Red-First-Exempt:` trailer
// (owner approval), as these guard behaviour that may already be implemented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_AC_RUNNER, assertExit, checkMessages, commitAll, describe, findCheck, git, gitTry, headSha,
  lastSummary, makeRepo, verify, writeFiles,
} from './helpers.ts';

const FIXTURE = 'tests/fixtures/format/roundtrip/výlet.md';
const FIXTURE_V1 = '---\ntitle: Výlet do Lisabonu\n---\n\nDen první: příjezd.\n';

const AC_TEST = 'tools/qa/test/existing.ac.test.ts';
const AC_TEST_BODY = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('fr_abc_01_AC1_title_keeps_diacritics', () => {
  assert.equal('Vylet', 'Výlet');
});
`;

const OWNER_AC_TRAILER = 'AC-Test-Change: clarify after AP-9; approved-by: owner';

function parentsOf(repo: string, rev = 'HEAD'): string[] {
  return git(repo, ['rev-list', '--parents', '-n', '1', rev]).trim().split(' ').slice(1);
}

function assertMerge(repo: string, nParents: number): string {
  const parents = parentsOf(repo);
  assert.equal(parents.length, nParents, `test setup: HEAD must be a merge commit with ${nParents} parents`);
  return headSha(repo);
}

/** Setup assertion: `file` at HEAD differs from `file` in every parent of HEAD (or is missing at HEAD). */
function assertDiffersFromEveryParent(repo: string, file: string): void {
  for (const p of parentsOf(repo)) {
    const r = gitTry(repo, ['diff', '--quiet', p, 'HEAD', '--', file]);
    assert.equal(r.status, 1, `test setup: ${file} at HEAD must differ from parent ${p}`);
  }
}

function assertFailNamesCommit(repo: string, check: string, file: string, commit: string, r: ReturnType<typeof verify>, what: string): string {
  assertExit(r, 1, what);
  const s = lastSummary(repo, 'push');
  assert.equal(findCheck(s, check).result, 'fail', `${check} must fail\n${describe(r)}`);
  const msgs = checkMessages(s, check);
  assert.ok(msgs.includes(file), `${check} must name the file ${file}: ${msgs}\n${describe(r)}`);
  assert.ok(msgs.includes(commit.slice(0, 7)), `${check} must name the merge commit ${commit}: ${msgs}\n${describe(r)}`);
  return msgs;
}

function assertPass(repo: string, check: string, r: ReturnType<typeof verify>, what: string): void {
  assertExit(r, 0, what);
  assert.equal(findCheck(lastSummary(repo, 'push'), check).result, 'pass', `${check} must pass\n${describe(r)}`);
}

// ---------------------------------------------------------------------------
// 1 + 2: evil merge (conflict resolution differing from both parents) modifying an existing fixture
// ---------------------------------------------------------------------------

/**
 * main and feature both change the same fixture line (each side commit with its own Fixture-Change trailer); merging
 * main into feature conflicts and is resolved with a third version. Returns the merge commit and the feature commit.
 */
function conflictResolvedFixtureMerge(t: any, mergeMessage: string): { repo: string; merge: string; side: string } {
  const repo = makeRepo(t, { files: { [FIXTURE]: FIXTURE_V1 } });
  git(repo, ['checkout', '-q', '-b', 'feature']);
  writeFiles(repo, { [FIXTURE]: '---\ntitle: Výlet do Lisabonu\n---\n\nDen první: příjezd vlakem.\n' });
  const side = commitAll(repo, 'Fixture: by train\n\nFixture-Change: S1 finding 2 needs a longer line');
  git(repo, ['checkout', '-q', 'main']);
  writeFiles(repo, { [FIXTURE]: '---\ntitle: Výlet do Lisabonu\n---\n\nDen první: příjezd letadlem.\n' });
  commitAll(repo, 'Fixture: by plane\n\nFixture-Change: S1 finding 3 needs a different line');
  git(repo, ['checkout', '-q', 'feature']);
  const m = gitTry(repo, ['merge', '--no-ff', '--no-edit', 'main']);
  assert.notEqual(m.status, 0, `test setup: the merge must conflict\n${describe(m)}`);
  writeFiles(repo, { [FIXTURE]: '---\ntitle: Výlet do Lisabonu\n---\n\nDen první: příjezd autobusem.\n' });
  const merge = commitAll(repo, mergeMessage);
  assertMerge(repo, 2);
  assertDiffersFromEveryParent(repo, FIXTURE);
  return { repo, merge, side };
}

test('ts_d4_ac1_evil_merge_modifying_fixture_without_trailer_fails_push', (t) => {
  const { repo, merge, side } = conflictResolvedFixtureMerge(t, 'Merge main into feature');
  const r = verify(repo, ['push']);
  const msgs = assertFailNamesCommit(repo, 'fixtures', FIXTURE, merge, r, 'verify push with a conflict resolution changing a fixture, no trailer');
  assert.ok(!msgs.includes(side.slice(0, 7)), `the side commit has its own trailer and must not be named: ${msgs}`);
});

test('ts_d4_ac1_evil_merge_modifying_fixture_with_trailer_passes_push', (t) => {
  const { repo } = conflictResolvedFixtureMerge(t, 'Merge main into feature\n\nFixture-Change: resolve the arrival line conflict');
  assertPass(repo, 'fixtures', verify(repo, ['push']), 'verify push with a conflict resolution changing a fixture, with trailer');
});

// ---------------------------------------------------------------------------
// 3: evil merge modifying an existing AC test file
// ---------------------------------------------------------------------------

/** Clean merge of main into feature (unrelated sides), with the AC test edited in the merge itself. */
function evilAcTestMerge(t: any, mergeMessage: string): { repo: string; merge: string } {
  const repo = makeRepo(t, { files: { [AC_TEST]: AC_TEST_BODY } });
  git(repo, ['checkout', '-q', '-b', 'feature']);
  writeFiles(repo, { 'src/a.ts': 'export const a = 1;\n' });
  commitAll(repo, 'Feature work');
  git(repo, ['checkout', '-q', 'main']);
  writeFiles(repo, { 'src/b.ts': "export const b = 'Žluťoučký kůň';\n" });
  commitAll(repo, 'Main work');
  git(repo, ['checkout', '-q', 'feature']);
  git(repo, ['merge', '-q', '--no-ff', '--no-commit', 'main']);
  writeFiles(repo, { [AC_TEST]: AC_TEST_BODY.replace("'Vylet'", "'Výlet'") });
  const merge = commitAll(repo, mergeMessage);
  assertMerge(repo, 2);
  assertDiffersFromEveryParent(repo, AC_TEST);
  return { repo, merge };
}

test('ts_i_ac1_evil_merge_modifying_ac_test_without_trailer_fails_push', (t) => {
  const { repo, merge } = evilAcTestMerge(t, 'Merge main into feature');
  assertFailNamesCommit(repo, 'ac-test-protection', AC_TEST, merge, verify(repo, ['push']), 'verify push with a merge editing an AC test, no trailer');
});

test('ts_i_ac1_evil_merge_modifying_ac_test_with_owner_trailer_passes_push', (t) => {
  const { repo } = evilAcTestMerge(t, `Merge main into feature\n\n${OWNER_AC_TRAILER}`);
  assertPass(repo, 'ac-test-protection', verify(repo, ['push']), 'verify push with a merge editing an AC test, with owner trailer');
});

// ---------------------------------------------------------------------------
// 4: merge whose result deletes a fixture both parents still have
// ---------------------------------------------------------------------------

test('ts_d4_ac1_merge_deleting_fixture_both_parents_have_without_trailer_fails_push', (t) => {
  const repo = makeRepo(t, { files: { [FIXTURE]: FIXTURE_V1 } });
  git(repo, ['checkout', '-q', '-b', 'feature']);
  writeFiles(repo, { 'src/a.ts': 'export const a = 1;\n' });
  commitAll(repo, 'Feature work');
  git(repo, ['checkout', '-q', 'main']);
  writeFiles(repo, { 'src/b.ts': 'export const b = 2;\n' });
  commitAll(repo, 'Main work');
  git(repo, ['checkout', '-q', 'feature']);
  git(repo, ['merge', '-q', '--no-ff', '--no-commit', 'main']);
  git(repo, ['rm', '-q', FIXTURE]);
  const merge = commitAll(repo, 'Merge main into feature');
  assertMerge(repo, 2);
  for (const p of parentsOf(repo)) {
    assert.equal(gitTry(repo, ['cat-file', '-e', `${p}:${FIXTURE}`]).status, 0, `test setup: parent ${p} must still have the fixture`);
  }
  assert.notEqual(gitTry(repo, ['cat-file', '-e', `HEAD:${FIXTURE}`]).status, 0, 'test setup: the merge must delete the fixture');

  assertFailNamesCommit(repo, 'fixtures', FIXTURE, merge, verify(repo, ['push']), 'verify push with a merge deleting a fixture, no trailer');
});

// ---------------------------------------------------------------------------
// 5: octopus merge modifying a fixture differently from all three parents
// ---------------------------------------------------------------------------

test('ts_d4_ac1_octopus_merge_modifying_fixture_without_trailer_fails_push', (t) => {
  const repo = makeRepo(t, { files: { [FIXTURE]: FIXTURE_V1 } });
  git(repo, ['checkout', '-q', '-b', 'feature']);
  writeFiles(repo, { 'src/a.ts': 'export const a = 1;\n' });
  commitAll(repo, 'Feature work');
  git(repo, ['checkout', '-q', '-b', 'other', 'main']);
  writeFiles(repo, { 'src/c.ts': 'export const c = 3;\n' });
  commitAll(repo, 'Other work');
  git(repo, ['checkout', '-q', 'main']);
  writeFiles(repo, { 'src/b.ts': 'export const b = 2;\n' });
  commitAll(repo, 'Main work');
  git(repo, ['checkout', '-q', 'feature']);
  git(repo, ['merge', '-q', '--no-ff', '--no-commit', 'main', 'other']);
  writeFiles(repo, { [FIXTURE]: '---\ntitle: Výlet do Lisabonu\n---\n\nDen první: příjezd lodí.\n' });
  const merge = commitAll(repo, 'Merge main and other into feature');
  assertMerge(repo, 3);
  assertDiffersFromEveryParent(repo, FIXTURE);

  assertFailNamesCommit(repo, 'fixtures', FIXTURE, merge, verify(repo, ['push']), 'verify push with an octopus merge changing a fixture, no trailer');
});

// ---------------------------------------------------------------------------
// 6: clean merge of two approved, non-conflicting changes to the same fixture (CONTRACT §12 "Merge side effects")
// ---------------------------------------------------------------------------

test('ts_d4_ac1_clean_merge_of_two_approved_changes_to_same_fixture_flags_merge_without_trailer', (t) => {
  const lines = Array.from({ length: 20 }, (_, i) => `Řádek ${i + 1}: Výlet do Lisabonu.`);
  const repo = makeRepo(t, { files: { [FIXTURE]: lines.join('\n') + '\n' } });
  git(repo, ['checkout', '-q', '-b', 'feature']);
  const featureLines = [...lines];
  featureLines[17] = 'Řádek 18: změněno ve větvi feature.';
  writeFiles(repo, { [FIXTURE]: featureLines.join('\n') + '\n' });
  const side = commitAll(repo, 'Fixture: line 18\n\nFixture-Change: S1 finding 5 needs line 18');
  git(repo, ['checkout', '-q', 'main']);
  const mainLines = [...lines];
  mainLines[1] = 'Řádek 2: změněno ve větvi main.';
  writeFiles(repo, { [FIXTURE]: mainLines.join('\n') + '\n' });
  commitAll(repo, 'Fixture: line 2\n\nFixture-Change: S1 finding 6 needs line 2');
  git(repo, ['checkout', '-q', 'feature']);
  git(repo, ['merge', '-q', '--no-ff', '--no-edit', '-m', 'Merge main into feature', 'main']);
  const merge = assertMerge(repo, 2);
  assertDiffersFromEveryParent(repo, FIXTURE);

  const r = verify(repo, ['push']);
  const msgs = assertFailNamesCommit(repo, 'fixtures', FIXTURE, merge, r, 'verify push with a clean merge of two fixture changes, no trailer on the merge');
  assert.ok(!msgs.includes(side.slice(0, 7)), `the side commit has its own trailer and must not be named: ${msgs}`);
});

// ---------------------------------------------------------------------------
// 7: range whose first commit is a root commit adding an AC test and a fixture
// ---------------------------------------------------------------------------

test('ts_d4_ac1_ts_i_ac1_range_starting_at_root_commit_with_only_additions_passes_push', (t) => {
  // `--range A..B` can't include a root reachable from A, so the root is the first commit of an orphan branch:
  // `main..feature` contains the orphan root (not reachable from main) and the commit after it.
  const config = { steps: [], acRunners: [NODE_AC_RUNNER] };
  const repo = makeRepo(t, { config });
  git(repo, ['checkout', '-q', '--orphan', 'feature']);
  writeFiles(repo, {
    [AC_TEST]: AC_TEST_BODY,
    [FIXTURE]: FIXTURE_V1,
  });
  const root = commitAll(repo, 'test(FR-ABC-01): acceptance tests and fixture (red)');
  assert.deepEqual(parentsOf(repo, root), [], 'test setup: the first commit of feature must be a root commit');
  writeFiles(repo, { 'src/title.ts': "export const title = 'Výlet do Lisabonu';\n" });
  const head = commitAll(repo, 'Add title');
  const inRange = git(repo, ['rev-list', `main..${head}`]).trim().split('\n');
  assert.ok(inRange.includes(root), 'test setup: the range must contain the root commit');

  const r = verify(repo, ['push', '--range', `main..${head}`]);
  const s = lastSummary(repo, 'push');
  assert.equal(findCheck(s, 'fixtures').result, 'pass', `fixtures must pass for a root commit that only adds\n${describe(r)}`);
  assert.equal(findCheck(s, 'ac-test-protection').result, 'pass', `ac-test-protection must pass for a root commit that only adds\n${describe(r)}`);
  assertExit(r, 0, 'verify push with a range starting at a root commit that adds a red AC test and a fixture');
});
