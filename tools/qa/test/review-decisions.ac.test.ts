// Owner decisions of 2026-10-08 after the QA review (tools/qa/CONTRACT.md §3.2 last paragraph, §5.0, §9.1
// "Table criterion"). Black box: runs the real `verify` against temporary git repositories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  NODE_AC_RUNNER, assertExit, checkMessages, commitAll, describe, findCheck, git, headSha, junitXml, k,
  lastSummary, makeRepo, output, readText, tmpDir, verify, writeFiles,
} from './helpers.ts';

/** Merges `main` into the current branch with a real (non fast-forward) merge commit. */
function mergeMain(repo: string, message = 'Merge main into feature'): string {
  git(repo, ['merge', '-q', '--no-ff', '--no-edit', '-m', message, 'main']);
  const parents = git(repo, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ');
  assert.equal(parents.length, 3, 'test setup: HEAD must be a merge commit');
  return headSha(repo);
}

// ---------------------------------------------------------------------------
// §3.2: an explicit --range never writes .verify/last-pass (TS-HOOKS AC-1: last-pass gates the pre-push skip)
// ---------------------------------------------------------------------------

test('ts_hooks_ac1_explicit_range_passing_push_does_not_write_last_pass', (t) => {
  const repo = makeRepo(t, { config: { steps: [{ id: 'ok', run: 'true', level: 'push' }] } });
  git(repo, ['checkout', '-q', '-b', 'feature']);
  writeFiles(repo, { 'notes/Výlet.md': '# Výlet do Lisabonu\n' });
  const head = commitAll(repo, 'Add note');
  assertExit(verify(repo, ['push', '--range', `${head}~1..${head}`]), 0, 'verify push with an explicit --range');
  assert.equal(fs.existsSync(path.join(repo, '.verify', 'last-pass')), false, 'an explicit --range must not write last-pass');
});

test('ts_hooks_ac1_explicit_range_passing_push_leaves_existing_last_pass_unchanged', (t) => {
  const repo = makeRepo(t, { config: { steps: [{ id: 'ok', run: 'true', level: 'push' }] } });
  git(repo, ['checkout', '-q', '-b', 'feature']);
  writeFiles(repo, { 'notes/Výlet.md': '# Výlet do Lisabonu\n' });
  const head = commitAll(repo, 'Add note');
  const previous = `${'a'.repeat(40)}\n`;
  writeFiles(repo, { '.verify/last-pass': previous });
  assertExit(verify(repo, ['push', '--range', `main..${head}`]), 0, 'verify push with an explicit --range');
  assert.equal(readText(path.join(repo, '.verify', 'last-pass'), 'last-pass'), previous, 'last-pass must stay unchanged');
});

// ---------------------------------------------------------------------------
// §5.0 + §7: a merge is judged only by its own (combined-diff) changes (TS-D4 AC-1)
// ---------------------------------------------------------------------------

const FIXTURE = 'tests/fixtures/format/roundtrip/výlet.md';

test('ts_d4_ac1_merge_bringing_in_approved_fixture_change_passes_push', (t) => {
  const repo = makeRepo(t, { files: { [FIXTURE]: '---\ntitle: Výlet do Lisabonu\n---\n\nDen první.\n' } });
  git(repo, ['checkout', '-q', '-b', 'feature']);
  writeFiles(repo, { 'src/a.ts': 'export const a = 1;\n' });
  commitAll(repo, 'Feature work');
  git(repo, ['checkout', '-q', 'main']);
  writeFiles(repo, { [FIXTURE]: '---\ntitle: Výlet do Lisabonu\n---\n\nDen druhý.\n' });
  commitAll(repo, 'Regenerate fixture\n\nFixture-Change: S1 finding 4 needs a second day');
  git(repo, ['checkout', '-q', 'feature']);
  mergeMain(repo);

  const r = verify(repo, ['push']);
  assertExit(r, 0, 'verify push of a branch whose merge only brings in an approved fixture change');
  assert.equal(findCheck(lastSummary(repo, 'push'), 'fixtures').result, 'pass', describe(r));
});

// ---------------------------------------------------------------------------
// §5.0 + §5.1: AC test protection looks only at the merge's own changes (TS-I AC-1)
// ---------------------------------------------------------------------------

const AC_TEST = 'tools/qa/test/existing.ac.test.ts';
const AC_TEST_BODY = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('fr_abc_01_AC1_title_keeps_diacritics', () => {
  assert.equal('Vylet', 'Výlet');
});
`;

test('ts_i_ac1_merge_bringing_in_approved_ac_test_change_passes_push', (t) => {
  const repo = makeRepo(t, { files: { [AC_TEST]: AC_TEST_BODY } });
  git(repo, ['checkout', '-q', '-b', 'feature']);
  writeFiles(repo, { 'src/a.ts': 'export const a = 1;\n' });
  commitAll(repo, 'Feature work');
  git(repo, ['checkout', '-q', 'main']);
  writeFiles(repo, { [AC_TEST]: AC_TEST_BODY + '// clarified\n' });
  commitAll(repo, 'Clarify test\n\nAC-Test-Change: clarify after AP-9; approved-by: owner');
  git(repo, ['checkout', '-q', 'feature']);
  mergeMain(repo);

  const r = verify(repo, ['push']);
  assertExit(r, 0, 'verify push of a branch whose merge only brings in an approved AC test change');
  assert.equal(findCheck(lastSummary(repo, 'push'), 'ac-test-protection').result, 'pass', describe(r));
});

// ---------------------------------------------------------------------------
// §5.0 + §5.2: red-first skips merge commits (TS-I AC-2)
// ---------------------------------------------------------------------------

test('ts_i_ac2_merge_bringing_in_red_test_and_implementation_passes_red_first', (t) => {
  const repo = makeRepo(t, { config: { steps: [], acRunners: [NODE_AC_RUNNER] }, files: { 'src/.keep': '' } });
  git(repo, ['checkout', '-q', '-b', 'feature']);
  writeFiles(repo, { 'src/b.ts': 'export const b = 1;\n' });
  commitAll(repo, 'Feature work');
  git(repo, ['checkout', '-q', 'main']);
  writeFiles(repo, {
    'src/title.ts': "export function title() { return 'TODO'; }\n",
    't/title.ac.test.ts': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { title } from '../src/title.ts';
test('fr_abc_01_AC1_title', () => { assert.equal(title(), 'Výlet do Lisabonu'); });
`,
  });
  commitAll(repo, 'test(FR-ABC-01): acceptance tests (red)');
  writeFiles(repo, { 'src/title.ts': "export function title() { return 'Výlet do Lisabonu'; }\n" });
  commitAll(repo, 'Implement title');
  git(repo, ['checkout', '-q', 'feature']);
  mergeMain(repo);

  const r = verify(repo, ['push']);
  assertExit(r, 0, 'verify push of a branch whose merge brings in a red test and its implementation');
  assert.equal(findCheck(lastSummary(repo, 'push'), 'red-first').result, 'pass', describe(r));
});

// ---------------------------------------------------------------------------
// §9.1 Table criterion: a table row whose first cell is a requirement ID defines <ID>/AC-1 (TS-COV AC-1)
// ---------------------------------------------------------------------------

const PERFORMANCE = `# Acceptance Criteria: Performance

| ID | Target | Budget | Notes |
| --- | --- | --- | --- |
| NFR-PERF-01 | Cold start to usable UI | < 2 s | Reference vault, 5 000 notes |
| NFR-PERF-01 (warm) | Not an ID cell | < 1 s | |
`;

const PERF_TEST = "import { test } from 'node:test';\ntest('nfr_perf_01_AC1_cold_start_under_2_s', () => {});\n";

test('ts_cov_ac1_table_row_defines_automated_ac_with_status_from_results', (t) => {
  const repo = makeRepo(t, { files: { 'docs/acceptance/performance.md': PERFORMANCE, 'src/perf.test.ts': PERF_TEST } });
  const results = tmpDir(t, 'tegg-qa-results-');
  fs.writeFileSync(path.join(results, 'junit.xml'), junitXml([{ name: 'nfr_perf_01_AC1_cold_start_under_2_s' }]));
  assertExit(verify(repo, ['coverage', '--results', results]), 0, 'verify coverage');
  const text = readText(path.join(repo, 'qa', 'coverage', 'ac-matrix.md'), 'qa/coverage/ac-matrix.md');
  assert.match(text, /^\| NFR-PERF-01\/AC-1 \| auto \| [^|]*src\/perf\.test\.ts[^|]* \| pass \|$/m, text);
  const orphans = text.split('## Orphan tests')[1]?.split('\n## ')[0] ?? '';
  assert.ok(!orphans.includes(k('nfr_perf_01_AC1')), `the table AC's test must not be an orphan:\n${text}`);
  const ids = text.split('\n').filter((l) => /^\| [A-Z][A-Z0-9-]*\/AC-\d+ \|/.test(l)).map((l) => l.split('|')[1].trim());
  assert.deepEqual(ids, ['NFR-PERF-01/AC-1'], 'exactly one AC from the table (header and non-ID first cells ignored)');
});

test('ts_cov_ac1_milestone_accepts_requirement_defined_by_table_row', (t) => {
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'junit', level: 'commit', run: 'cp results/junit.xml "$VERIFY_RESULTS/junit.xml"' }] },
    files: {
      'docs/Business Requirements.md': '# BRD\n\n### 11.2 Milestones\n\n| Milestone | Name | Requirements |\n| --- | --- | --- |\n| MS1 | Perf | NFR-PERF-01 |\n',
      'docs/acceptance/performance.md': PERFORMANCE,
      'src/perf.test.ts': PERF_TEST,
      'results/junit.xml': junitXml([{ name: 'nfr_perf_01_AC1_cold_start_under_2_s' }]),
    },
  });
  const r = verify(repo, ['milestone', '--milestone', 'MS1']);
  assertExit(r, 0, 'verify milestone with a requirement whose AC is a table row');
  const msgs = checkMessages(lastSummary(repo, 'milestone'), 'milestone-acs');
  assert.ok(!msgs.includes('NFR-PERF-01'), `NFR-PERF-01 must not be reported: ${msgs}\n${output(r)}`);
});
