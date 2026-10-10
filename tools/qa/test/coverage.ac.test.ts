// TS-COV: AC coverage report and milestone AC check (test-strategy §7). Black box against tools/qa/CONTRACT.md §9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertExit, checkMessages, describe, findCheck, junitXml, k, lastSummary, makeRepo, output, readText,
  tmpDir, verify, writeFiles,
} from './helpers.ts';
import type { Case, Files } from './helpers.ts';

// ---------------------------------------------------------------------------
// Report fixture
// ---------------------------------------------------------------------------

const ACCEPTANCE = `# Acceptance Criteria: Sample

### FR-ABC-01 Titles with diacritics

- **AC-1** Given the title \`Výlet do Lisabonu\`, the file name keeps the diacritics.
- **AC-2** The Rust extractor reads the same title.

### FR-SYN-02 / NFR-REL-01 Atomic writes

- **AC-1** A crash mid-write leaves the old file intact.

### FR-STO-01 / -03 Vault layout

- **AC-1** The vault has one folder per type.

### FR-STO-05 Trash

- **AC-1** Deleted objects go to \`.trash/\`.

### TS-ZZ Manual checks

- **AC-1** [manual] The DMG installs on the second Mac.
- **AC-2** [manual] The owner reads the report.
`;

const README_ACCEPTANCE = `# Acceptance Criteria

### FR-NOPE-01 Only in the README

- **AC-1** Must not be listed.
`;

const TEST_SOURCE = `import { test } from 'node:test';
test('fr_abc_01_AC1_title_keeps_diacritics', () => {});
test('nfr_rel_01_AC1_crash_keeps_old_file', () => {});
test('fr_sto_03_AC1_type_folders', () => {});
test('fr_gone_09_AC1_points_nowhere', () => {});
test('fr_abc_01_AC12_no_such_criterion', () => {});
`;

function reportFiles(): Files {
  return {
    'docs/acceptance/sample.md': ACCEPTANCE,
    'docs/acceptance/README.md': README_ACCEPTANCE,
    'src/title.test.ts': TEST_SOURCE,
    'tests/ac_extract.rs': '#[test]\nfn fr_abc_01_AC2_rust_reads_title() {}\n',
    'src/lib.rs': '// fr_zzz_01_AC1 mentioned without #[test]\npub fn f() {}\n',
    'src/helper.ts': "export const k = 'fr_yyy_01_AC1';\n",
    'node_modules/dep/x.test.js': "test('fr_abc_02_AC1_vendored', () => {});\n",
    'tests/fixtures/sample/y.test.ts': "test('fr_fix_01_AC1_fixture', () => {});\n",
    'qa/sessions/2026-01-10-explorer.md': '# Session\n\nmilestone: MS1\n\n- TS-ZZ/AC-1: fail\n',
    'qa/sessions/2026-02-20-explorer.md': '# Session\n\nmilestone: MS2\n\n- TS-ZZ/AC-1: pass\n',
  };
}

const RESULTS: Case[] = [
  { name: 'fr_abc_01_AC1_title_keeps_diacritics' },
  { name: 'crash keeps old file', classname: 'nfr_rel_01_AC1 atomic writes', fail: true },
  { name: 'fr_sto_03_AC1_type_folders' },
];

type Row = { id: string; kind: string; sources: string; status: string };

function buildReport(t: any): { repo: string; text: string; rows: Map<string, Row> } {
  const repo = makeRepo(t, { files: reportFiles() });
  const results = tmpDir(t, 'tegg-qa-results-');
  fs.writeFileSync(path.join(results, 'junit.xml'), junitXml(RESULTS));
  const r = verify(repo, ['coverage', '--results', results]);
  assertExit(r, 0, 'verify coverage');
  const text = readText(path.join(repo, 'qa', 'coverage', 'ac-matrix.md'), 'qa/coverage/ac-matrix.md');
  const rows = new Map<string, Row>();
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4 || !/\/AC-\d+$/.test(cells[0])) continue;
    rows.set(cells[0], { id: cells[0], kind: cells[1], sources: cells[2], status: cells[3] });
  }
  return { repo, text, rows };
}

function row(rows: Map<string, Row>, id: string): Row {
  const r = rows.get(id);
  assert.ok(r, `the matrix must have a row for ${id}; rows: ${[...rows.keys()].join(', ')}`);
  return r;
}

function section(text: string, heading: string): string[] {
  const lines = text.split('\n');
  const i = lines.indexOf(heading);
  assert.ok(i >= 0, `the report must contain the heading "${heading}"`);
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (l.startsWith('#')) break;
    if (l.trim()) out.push(l.trim());
  }
  return out;
}

// ---------------------------------------------------------------------------
// AC-1: lists every AC and every test named after one; writes qa/coverage/ac-matrix.md
// ---------------------------------------------------------------------------

test('ts_cov_ac1_report_lists_every_ac_once_with_sources', (t) => {
  const { text, rows } = buildReport(t);
  assert.equal(text.split('\n')[0], '# AC coverage', 'first line');
  assert.deepEqual(
    [...rows.keys()].sort(),
    ['FR-ABC-01/AC-1', 'FR-ABC-01/AC-2', 'FR-STO-01/AC-1', 'FR-STO-05/AC-1', 'FR-SYN-02/AC-1', 'TS-ZZ/AC-1', 'TS-ZZ/AC-2'],
    'one row per AC under its first heading ID (README.md excluded, aliases not duplicated)',
  );
  assert.equal(row(rows, 'FR-ABC-01/AC-1').kind, 'auto');
  assert.equal(row(rows, 'TS-ZZ/AC-1').kind, 'manual');
  assert.ok(row(rows, 'FR-ABC-01/AC-1').sources.includes('src/title.test.ts'), 'TS test source listed');
  assert.ok(row(rows, 'FR-ABC-01/AC-2').sources.includes('tests/ac_extract.rs'), 'Rust test source listed');
  assert.ok(row(rows, 'FR-SYN-02/AC-1').sources.includes('src/title.test.ts'), 'a reference through an alias key counts');
  assert.ok(row(rows, 'FR-STO-01/AC-1').sources.includes('src/title.test.ts'), 'a reference through a shorthand alias (-03 → FR-STO-03) counts');
  assert.equal(row(rows, 'FR-STO-05/AC-1').sources, '—', 'no test source → —');
});

test('ts_cov_ac1_statuses_come_from_junit_results', (t) => {
  const { rows } = buildReport(t);
  assert.equal(row(rows, 'FR-ABC-01/AC-1').status, 'pass');
  assert.equal(row(rows, 'FR-SYN-02/AC-1').status, 'fail', 'classname reference via alias, failed');
  assert.equal(row(rows, 'FR-ABC-01/AC-2').status, 'not run', 'referenced but no testcase');
  assert.equal(row(rows, 'FR-STO-01/AC-1').status, 'pass', 'passed through the alias key fr_sto_03_AC1');
  assert.equal(row(rows, 'FR-STO-05/AC-1').status, 'untested');
});

test('ts_cov_ac1_default_results_are_last_results_of_a_gate_run', (t) => {
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'junit', level: 'commit', run: 'cp results.xml "$VERIFY_RESULTS/r.xml"' }] },
    files: {
      'docs/acceptance/a.md': '### FR-ABC-01 Title\n\n- **AC-1** Works.\n',
      'src/a.test.ts': "test('fr_abc_01_AC1_works', () => {});\n",
      'results.xml': junitXml([{ name: 'fr_abc_01_AC1_works' }]),
    },
  });
  assertExit(verify(repo, ['commit']), 0, 'verify commit producing JUnit results');
  assertExit(verify(repo, ['coverage']), 0, 'verify coverage with default results');
  const text = readText(path.join(repo, 'qa', 'coverage', 'ac-matrix.md'), 'ac-matrix.md');
  assert.match(text, /^\| FR-ABC-01\/AC-1 \| auto \| [^|]*src\/a\.test\.ts[^|]* \| pass \|$/m);
});

// ---------------------------------------------------------------------------
// AC-2: untested ACs, orphan tests, manual ACs with latest record
// ---------------------------------------------------------------------------

test('ts_cov_ac2_sections_in_contract_order', (t) => {
  const { text } = buildReport(t);
  const idx = ['# AC coverage', '## Untested ACs', '## Orphan tests', '## Manual ACs'].map((h) => text.split('\n').indexOf(h));
  assert.ok(idx.every((i) => i >= 0), `all headings present: ${JSON.stringify(idx)}\n${text}`);
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, 'headings in order');
});

test('ts_cov_ac2_lists_untested_automated_acs', (t) => {
  const { text } = buildReport(t);
  assert.deepEqual(section(text, '## Untested ACs'), ['- FR-STO-05/AC-1']);
});

test('ts_cov_ac2_lists_orphan_tests_with_file', (t) => {
  const { text } = buildReport(t);
  assert.deepEqual(
    section(text, '## Orphan tests').sort(),
    ['- fr_abc_01_AC12 in src/title.test.ts', '- fr_gone_09_AC1 in src/title.test.ts'].map(k),
    'orphans only from test sources (not node_modules/, tests/fixtures/, non-test files or .rs without #[test])',
  );
});

test('ts_cov_ac2_manual_acs_show_latest_record_or_none', (t) => {
  const { text, rows } = buildReport(t);
  const latest = row(rows, 'TS-ZZ/AC-1').status;
  assert.match(latest, /^manual: pass \(MS2, [^)]*2026-02-20-explorer\.md\)$/, 'the later session file wins');
  assert.equal(row(rows, 'TS-ZZ/AC-2').status, 'manual: no record');
  const manual = section(text, '## Manual ACs');
  assert.equal(manual.length, 2, `two manual ACs: ${JSON.stringify(manual)}`);
  assert.ok(manual.includes(`- TS-ZZ/AC-1: ${latest}`), JSON.stringify(manual));
  assert.ok(manual.includes('- TS-ZZ/AC-2: manual: no record'), JSON.stringify(manual));
});

// ---------------------------------------------------------------------------
// AC-3: verify milestone fails unless every AC of the milestone's requirements passed / has a record
// ---------------------------------------------------------------------------

const BRD = `# Business Requirements

## 11 Release phasing

### 11.1 MVP

Text.

### 11.2 Milestones

| Milestone | Name | Requirements |
| --- | --- | --- |
| MS1 | Core | FR-ABC-01…02, -04 (partly), AR-01 |
| MS2 | Performance | All NFR-PERF |
| MS3 | Later | FR-XYZ-01, FR-DEF-01...03 |

### 11.3 Later

| MS9 | Not a milestone table | FR-ZZZ-01 |
`;

const MS_ACCEPTANCE = `# ACs

### FR-ABC-01 One
- **AC-1** Automated.

### FR-ABC-02 Two
- **AC-1** [manual] Checked by the owner.

### FR-ABC-03 Three (not in MS1)
- **AC-1** Never tested.

### FR-ABC-04 Four
- **AC-1** Automated.

### AR-01 / FR-DEF-02 Files are the source of truth
- **AC-1** Automated.

### NFR-PERF-01 Startup
- **AC-1** Automated.

### NFR-PERF-02 Search
- **AC-1** Automated.

### FR-DEF-01 Def one
- **AC-1** Automated.

### FR-DEF-03 Def three
- **AC-1** Automated.
`;

const ALL_PASS: Case[] = [
  { name: 'fr_abc_01_AC1_x' }, { name: 'fr_abc_04_AC1_x' }, { name: 'ar_01_AC1_x' },
  { name: 'nfr_perf_01_AC1_x' }, { name: 'nfr_perf_02_AC1_x' }, { name: 'fr_def_01_AC1_x' }, { name: 'fr_def_03_AC1_x' },
];

function milestoneRepo(t: any, cases: Case[], sessions: Files) {
  return makeRepo(t, {
    config: { steps: [{ id: 'junit', level: 'commit', run: 'cp results/junit.xml "$VERIFY_RESULTS/junit.xml"' }] },
    files: {
      'docs/Business Requirements.md': BRD,
      'docs/acceptance/ms.md': MS_ACCEPTANCE,
      'src/ms.test.ts': ALL_PASS.map((c) => `test('${c.name}', () => {});`).join('\n') + '\n',
      'results/junit.xml': junitXml(cases),
      ...sessions,
    },
  });
}

const MS1_PASS = { 'qa/sessions/2026-03-01.md': 'milestone: MS1\n\n- FR-ABC-02/AC-1: pass\n' };

test('ts_cov_ac3_milestone_passes_when_all_its_acs_pass_and_manual_recorded', (t) => {
  const repo = milestoneRepo(t, ALL_PASS, MS1_PASS);
  const r = verify(repo, ['milestone', '--milestone', 'MS1']);
  assertExit(r, 0, 'verify milestone MS1 (FR-ABC-03 is outside the range FR-ABC-01…02, -04)');
  assert.equal(findCheck(lastSummary(repo, 'milestone'), 'milestone-acs').result, 'pass');
});

test('ts_cov_ac3_milestone_fails_for_failing_or_not_run_ac', (t) => {
  const failing = milestoneRepo(t, ALL_PASS.map((c) => (c.name === 'fr_abc_04_AC1_x' ? { ...c, fail: true } : c)), MS1_PASS);
  const r1 = verify(failing, ['milestone', '--milestone', 'MS1']);
  assertExit(r1, 1, 'verify milestone with a failing AC');
  assert.ok(checkMessages(lastSummary(failing, 'milestone'), 'milestone-acs').includes('FR-ABC-04/AC-1'), describe(r1));

  const notRun = milestoneRepo(t, ALL_PASS.filter((c) => c.name !== 'ar_01_AC1_x'), MS1_PASS);
  const r2 = verify(notRun, ['milestone', '--milestone', 'MS1']);
  assertExit(r2, 1, 'verify milestone with an AC that did not run');
  assert.ok(output(r2).includes('AR-01/AC-1'), `the offending AC must be listed\n${describe(r2)}`);
});

test('ts_cov_ac3_manual_ac_needs_pass_record_for_this_milestone', (t) => {
  const otherMilestone = milestoneRepo(t, ALL_PASS, { 'qa/sessions/2026-03-01.md': 'milestone: MS2\n\n- FR-ABC-02/AC-1: pass\n' });
  const r1 = verify(otherMilestone, ['milestone', '--milestone', 'MS1']);
  assertExit(r1, 1, 'verify milestone with a manual record for another milestone');
  assert.ok(output(r1).includes('FR-ABC-02/AC-1'), describe(r1));

  const failed = milestoneRepo(t, ALL_PASS, { 'qa/manual/ms1-checklist.md': 'milestone: MS1\n\n- FR-ABC-02/AC-1: fail\n' });
  assertExit(verify(failed, ['milestone', '--milestone', 'MS1']), 1, 'verify milestone with a failed manual record');
});

test('ts_cov_ac3_all_prefix_item_covers_every_matching_requirement', (t) => {
  const missing = milestoneRepo(t, ALL_PASS.filter((c) => c.name !== 'nfr_perf_02_AC1_x'), {});
  const r = verify(missing, ['milestone', '--milestone', 'MS2']);
  assertExit(r, 1, 'verify milestone MS2 with NFR-PERF-02 not run');
  assert.ok(output(r).includes('NFR-PERF-02/AC-1'), describe(r));

  const ok = milestoneRepo(t, ALL_PASS, {});
  assertExit(verify(ok, ['milestone', '--milestone', 'MS2']), 0, 'verify milestone MS2 with every NFR-PERF AC passing');
});

test('ts_cov_ac3_requirement_without_acs_fails_milestone', (t) => {
  const repo = milestoneRepo(t, ALL_PASS, {});
  const r = verify(repo, ['milestone', '--milestone', 'MS3']);
  assertExit(r, 1, 'verify milestone MS3 with FR-XYZ-01 lacking ACs');
  const msgs = checkMessages(lastSummary(repo, 'milestone'), 'milestone-acs');
  assert.ok(msgs.includes('FR-XYZ-01'), `FR-XYZ-01 must be listed: ${msgs}`);
  assert.ok(!msgs.includes('FR-DEF-02'), `FR-DEF-02 has an AC via alias of AR-01 and passes (range with ...): ${msgs}`);
});

test('ts_cov_ac3_release_checks_all_milestones', (t) => {
  const repo = milestoneRepo(t, ALL_PASS, MS1_PASS);
  const r = verify(repo, ['release']);
  assertExit(r, 1, 'verify release with MS3 incomplete');
  assert.ok(checkMessages(lastSummary(repo, 'release'), 'milestone-acs').includes('FR-XYZ-01'), describe(r));
});
