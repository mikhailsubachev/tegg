// TS-COV AC-6: every real-app (L6) AC has a real-app test (D-382). Black box against tools/qa/CONTRACT.md §2
// (`realAppTests`), §3.2 (push gate step 5), §9.1–§9.3 and §9.5.
//
// Fixture test keys are written as `_AC<n>` and turned into real keys by `writeFiles` (helpers.ts `k()`), so the
// real `verify coverage` of this repository doesn't count them as references or orphans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  assertExit, checkMessages, commitAll, describe, findCheck, lastSummary, makeRepo, readText, tmpDir, verify, writeFiles,
} from './helpers.ts';
import type { Config, Files } from './helpers.ts';

const E2E = 'app/e2e/';

const ACCEPTANCE = `# ACs

### FR-ALP-01 / NFR-BET-02 Okno aplikace s diakritikou
- **AC-1** The window \`Žluťoučký kůň.md\` opens. *(L6)*
- **AC-2** Příliš žluťoučký kůň is shown in the list. *(L5; L6 once)*
- **AC-3** [MS8] Cold start stays below the target. *(L6 benchmark)*
- **AC-4** [manual] The owner checks the ďábelské ódy window. *(L6)*

### FR-GAM-01 Jen jádro
- **AC-1** The core keeps \`Výlet do Lisabonu.md\`. *(L5)*
- **AC-2** A layer that only looks similar. *(L60)*
- **AC-3** Another one. *(XL6)*
- **AC-4** Mentions the L6 suite in plain text only. *(L4)*
- **AC-5** No marker at all, but says L6.

### FR-DEL-01 Zatím netestováno
- **AC-1** Measured on the reference machine later. *(L6 benchmark)*
`;

type Opts = { realAppTests?: string[] | null; files?: Files; acceptance?: string; commit?: boolean };

/** Temp repo with the ACs above; `realAppTests: null` omits the key. Default `["app/e2e/"]`. */
function repoWith(t: any, opts: Opts = {}): string {
  const cfg: Record<string, unknown> = { steps: [] };
  const rat = opts.realAppTests === undefined ? [E2E] : opts.realAppTests;
  if (rat !== null) cfg.realAppTests = rat;
  return makeRepo(t, {
    config: cfg as Config,
    commit: opts.commit,
    files: {
      'docs/acceptance/app.md': opts.acceptance ?? ACCEPTANCE,
      ...(opts.files ?? {}),
    },
  });
}

const tsTest = (...names: string[]) => names.map((n) => `test('${n}', () => {});`).join('\n') + '\n';

/** Every L6 AC above referenced only outside app/e2e/ (incl. look-alike paths), FR-GAM-01 too. */
const CORE_ONLY: Files = {
  'src/core.test.ts': tsTest('fr_alp_01_AC1_window_opens', 'fr_alp_01_AC3_cold_start', 'fr_gam_01_AC1_core', 'fr_gam_01_AC2_x', 'fr_gam_01_AC3_x', 'fr_gam_01_AC4_x', 'fr_gam_01_AC5_x'),
  // Reference via the alias key only (heading `FR-ALP-01 / NFR-BET-02`).
  'src/list.spec.ts': tsTest('nfr_bet_02_AC2_list_shows_title'),
  // Manual L6 AC referenced by a test: manual markers don't change the check (§9.5).
  'src/manual.test.ts': tsTest('fr_alp_01_AC4_window_check'),
  // Paths that only look like the real-app directory don't count.
  'app/e2e-old/old.test.ts': tsTest('fr_alp_01_AC1_old'),
  'notapp/e2e/x.test.ts': tsTest('fr_alp_01_AC2_x'),
  'app/e2e/README.md': '# fr_alp_01_AC3 is mentioned here, but this is not a test source\n',
};

const FAIL_MESSAGES = [
  'FR-ALP-01/AC-1: no real-app test in app/e2e/',
  'FR-ALP-01/AC-2: no real-app test in app/e2e/',
  'FR-ALP-01/AC-3: no real-app test in app/e2e/',
  'FR-ALP-01/AC-4: no real-app test in app/e2e/',
];

function pushSummary(repo: string): { r: ReturnType<typeof verify>; s: any } {
  const r = verify(repo, ['push']);
  return { r, s: lastSummary(repo, 'push') };
}

function l6Check(s: any, r: ReturnType<typeof verify>): any {
  const c = findCheck(s, 'l6-coverage');
  assert.ok(Array.isArray(c.messages), `l6-coverage messages must be an array\n${describe(r)}`);
  return c;
}

// ---------------------------------------------------------------------------
// push: l6-coverage check
// ---------------------------------------------------------------------------

test('ts_cov_ac6_push_fails_l6_ac_referenced_only_outside_e2e', (t) => {
  const repo = repoWith(t, { files: CORE_ONLY });
  const { r, s } = pushSummary(repo);
  assertExit(r, 1, 'verify push with L6 ACs referenced only outside app/e2e/');
  assert.equal(s.result, 'fail', 'summary result');
  const c = l6Check(s, r);
  assert.equal(c.result, 'fail', describe(r));
  assert.deepEqual(c.messages, FAIL_MESSAGES, '(L6), (L5; L6 once), (L6 benchmark), deferred and manual ACs, sorted by AC ID');
});

test('ts_cov_ac6_push_messages_sorted_by_ac_id', (t) => {
  const repo = repoWith(t, {
    files: { 'src/z.test.ts': tsTest('fr_alp_01_AC3_x', 'fr_alp_01_AC1_x', 'fr_alp_01_AC2_x', 'fr_alp_01_AC4_x') },
    acceptance: `### FR-ZET-09 Poslední
- **AC-1** Zeta. *(L6)*

${ACCEPTANCE}`,
  });
  writeFiles(repo, { 'src/a.test.ts': tsTest('fr_zet_09_AC1_x') });
  commitAll(repo, 'zeta first in the file, last by ID');
  const { r, s } = pushSummary(repo);
  assertExit(r, 1, 'verify push');
  assert.deepEqual(l6Check(s, r).messages, [...FAIL_MESSAGES, 'FR-ZET-09/AC-1: no real-app test in app/e2e/']);
});

test('ts_cov_ac6_check_runs_after_red_first_in_push', (t) => {
  const repo = repoWith(t, { files: CORE_ONLY });
  const { r, s } = pushSummary(repo);
  l6Check(s, r);
  const ids = (s.checks as any[]).map((c) => c.id);
  assert.ok(ids.indexOf('red-first') >= 0, `red-first listed: ${JSON.stringify(ids)}`);
  assert.ok(ids.indexOf('l6-coverage') > ids.indexOf('red-first'), `l6-coverage after red-first: ${JSON.stringify(ids)}`);
});

test('ts_cov_ac6_push_passes_when_e2e_test_references_each_l6_ac', (t) => {
  const repo = repoWith(t, {
    files: {
      ...CORE_ONLY,
      'app/e2e/window.e2e.test.ts': tsTest('fr_alp_01_AC1_window_opens_in_app', 'fr_alp_01_AC3_cold_start_benchmark'),
      // Alias key (NFR-BET-02 from the `### FR-ALP-01 / NFR-BET-02` heading) in a nested e2e directory.
      'app/e2e/specs/list.spec.ts': tsTest('nfr_bet_02_AC2_list_in_app', 'nfr_bet_02_AC4_manual_window'),
    },
  });
  const { r, s } = pushSummary(repo);
  const c = l6Check(s, r);
  assert.equal(c.result, 'pass', describe(r));
  assert.deepEqual(c.messages, []);
  assertExit(r, 0, 'verify push with every referenced L6 AC covered under app/e2e/');
});

test('ts_cov_ac6_e2e_reference_via_alias_covers_primary_reference', (t) => {
  const repo = repoWith(t, {
    files: {
      'src/core.test.ts': tsTest('fr_alp_01_AC1_core'),
      'app/e2e/alias.test.ts': tsTest('nfr_bet_02_AC1_in_app'),
    },
  });
  const { r, s } = pushSummary(repo);
  const c = l6Check(s, r);
  assert.equal(c.result, 'pass', describe(r));
  assert.deepEqual(c.messages, []);
  assertExit(r, 0, 'verify push');
});

test('ts_cov_ac6_l6_ac_without_any_test_reference_does_not_fail', (t) => {
  // FR-DEL-01/AC-1 and the other L6 ACs have no test reference at all.
  const repo = repoWith(t, { files: { 'src/core.test.ts': tsTest('fr_gam_01_AC1_core') } });
  const { r, s } = pushSummary(repo);
  const c = l6Check(s, r);
  assert.equal(c.result, 'pass', describe(r));
  assert.deepEqual(c.messages, []);
  assertExit(r, 0, 'verify push with L6 ACs that have no test anywhere yet');
});

test('ts_cov_ac6_partial_coverage_lists_only_uncovered', (t) => {
  const repo = repoWith(t, {
    files: {
      ...CORE_ONLY,
      'app/e2e/window.e2e.test.ts': tsTest('fr_alp_01_AC1_in_app', 'fr_alp_01_AC4_in_app'),
    },
  });
  const { r, s } = pushSummary(repo);
  assertExit(r, 1, 'verify push');
  const c = l6Check(s, r);
  assert.equal(c.result, 'fail');
  assert.deepEqual(c.messages, ['FR-ALP-01/AC-2: no real-app test in app/e2e/', 'FR-ALP-01/AC-3: no real-app test in app/e2e/']);
});

test('ts_cov_ac6_non_l6_markers_are_not_real_app_acs', (t) => {
  // FR-GAM-01: (L5), (L60), (XL6), L6 only in plain text, no marker — all referenced outside app/e2e/ only.
  // FR-ALP-01/AC-1 is the one real-app AC here, so the check exists and fails only for it.
  const repo = repoWith(t, {
    files: {
      'src/core.test.ts': tsTest('fr_gam_01_AC1_x', 'fr_gam_01_AC2_x', 'fr_gam_01_AC3_x', 'fr_gam_01_AC4_x', 'fr_gam_01_AC5_x', 'fr_alp_01_AC1_x'),
    },
  });
  const { r, s } = pushSummary(repo);
  assertExit(r, 1, 'verify push');
  assert.deepEqual(l6Check(s, r).messages, ['FR-ALP-01/AC-1: no real-app test in app/e2e/']);

  const onlyNonL6 = repoWith(t, {
    files: { 'src/core.test.ts': tsTest('fr_gam_01_AC1_x', 'fr_gam_01_AC2_x', 'fr_gam_01_AC3_x', 'fr_gam_01_AC4_x', 'fr_gam_01_AC5_x') },
  });
  const p = pushSummary(onlyNonL6);
  const c = l6Check(p.s, p.r);
  assert.equal(c.result, 'pass', describe(p.r));
  assert.deepEqual(c.messages, []);
  assertExit(p.r, 0, 'verify push with only non-L6 ACs referenced');
});

test('ts_cov_ac6_table_criteria_are_never_real_app', (t) => {
  const acceptance = `# Performance

| ID | What | Target | Layer |
| --- | --- | --- | --- |
| NFR-PERF-01 | Studený start | < 2 s | *(L6 benchmark)* |
`;
  const repo = repoWith(t, { acceptance, files: { 'src/perf.test.ts': tsTest('nfr_perf_01_AC1_cold_start') } });
  const { r, s } = pushSummary(repo);
  const c = l6Check(s, r);
  assert.equal(c.result, 'pass', describe(r));
  assert.deepEqual(c.messages, []);
});

test('ts_cov_ac6_multiple_prefixes_joined_in_message', (t) => {
  const repo = repoWith(t, {
    realAppTests: ['app/e2e/', 'e2e-appium/'],
    files: {
      'src/core.test.ts': tsTest('fr_alp_01_AC1_x', 'fr_alp_01_AC2_x'),
      'e2e-appium/window.spec.ts': tsTest('fr_alp_01_AC2_in_appium'),
    },
  });
  const { r, s } = pushSummary(repo);
  assertExit(r, 1, 'verify push');
  assert.deepEqual(l6Check(s, r).messages, ['FR-ALP-01/AC-1: no real-app test in app/e2e/, e2e-appium/']);
});

test('ts_cov_ac6_checks_committed_tree_not_working_directory', (t) => {
  const repo = repoWith(t, { files: { 'src/core.test.ts': tsTest('fr_alp_01_AC1_x') } });
  // Untracked e2e test in the main working directory: not part of the checked tree (§3.2).
  writeFiles(repo, { 'app/e2e/window.e2e.test.ts': tsTest('fr_alp_01_AC1_in_app') });
  const { r, s } = pushSummary(repo);
  assertExit(r, 1, 'verify push with the e2e test uncommitted');
  assert.deepEqual(l6Check(s, r).messages, ['FR-ALP-01/AC-1: no real-app test in app/e2e/']);

  commitAll(repo, 'add e2e test');
  const p = pushSummary(repo);
  assert.equal(l6Check(p.s, p.r).result, 'pass', describe(p.r));
  assertExit(p.r, 0, 'verify push with the e2e test committed');
});

test('ts_cov_ac6_no_check_without_real_app_tests_config', (t) => {
  // Red guard: with the key configured the check is listed; without the feature it isn't.
  const configured = repoWith(t, { files: CORE_ONLY });
  const c = pushSummary(configured);
  l6Check(c.s, c.r);

  for (const realAppTests of [null, []]) {
    const repo = repoWith(t, { realAppTests, files: CORE_ONLY });
    const { r, s } = pushSummary(repo);
    const what = realAppTests === null ? 'realAppTests omitted' : 'realAppTests []';
    assertExit(r, 0, `verify push with ${what}`);
    assert.ok(Array.isArray(s.checks), 'summary.checks is an array');
    assert.deepEqual((s.checks as any[]).filter((x) => x?.id === 'l6-coverage'), [], `${what}: no l6-coverage check listed`);
  }
});

// ---------------------------------------------------------------------------
// verify coverage: `## Real-app ACs without an L6 test`
// ---------------------------------------------------------------------------

const HEADING = '## Real-app ACs without an L6 test';

function coverageText(t: any, repo: string): string {
  const results = tmpDir(t, 'tegg-qa-results-');
  assertExit(verify(repo, ['coverage', '--results', results]), 0, 'verify coverage');
  return readText(path.join(repo, 'qa', 'coverage', 'ac-matrix.md'), 'ac-matrix.md');
}

function section(text: string, heading: string): string[] {
  const lines = text.split('\n');
  const i = lines.indexOf(heading);
  assert.ok(i >= 0, `the report must contain the heading "${heading}"\n${text}`);
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (l.startsWith('#')) break;
    if (l.trim()) out.push(l.trim());
  }
  return out;
}

test('ts_cov_ac6_coverage_section_between_orphans_and_manual', (t) => {
  const repo = repoWith(t, { files: CORE_ONLY });
  const text = coverageText(t, repo);
  const lines = text.split('\n');
  const idx = ['## Untested ACs', '## Orphan tests', HEADING, '## Manual ACs'].map((h) => lines.indexOf(h));
  assert.ok(idx.every((i) => i >= 0), `all headings present: ${JSON.stringify(idx)}\n${text}`);
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, `headings in contract order\n${text}`);
});

test('ts_cov_ac6_coverage_lists_uncovered_real_app_acs', (t) => {
  const repo = repoWith(t, {
    files: { ...CORE_ONLY, 'app/e2e/window.e2e.test.ts': tsTest('fr_alp_01_AC1_in_app') },
  });
  const text = coverageText(t, repo);
  assert.deepEqual(
    section(text, HEADING),
    ['- FR-ALP-01/AC-2', '- FR-ALP-01/AC-3', '- FR-ALP-01/AC-4'],
    'exactly the ACs the l6-coverage check would fail (covered, untested and non-L6 ACs excluded)',
  );
});

test('ts_cov_ac6_coverage_section_empty_without_real_app_tests', (t) => {
  // Red guard: with the key configured the section lists ACs.
  const configured = repoWith(t, { files: CORE_ONLY });
  assert.ok(section(coverageText(t, configured), HEADING).length > 0, 'configured: section lists ACs');

  const repo = repoWith(t, { realAppTests: [], files: CORE_ONLY });
  assert.deepEqual(section(coverageText(t, repo), HEADING), [], 'realAppTests []: no lines');
});

