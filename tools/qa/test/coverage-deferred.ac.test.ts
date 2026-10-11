// TS-COV AC-4 / AC-5: milestone markers for deferred ACs (D-94). Black box against tools/qa/CONTRACT.md §9.1, §9.3, §9.4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertExit, checkMessages, describe, findCheck, junitXml, lastSummary, makeRepo, output, readText, tmpDir, verify,
} from './helpers.ts';
import type { Case, Files } from './helpers.ts';

const BRD = `# Business Requirements

### 11.2 Milestones

| Milestone | Name | Requirements |
| --- | --- | --- |
| MS1 | Jádro | FR-ABC-01…02, FR-ONL-01 |
| MS2 | Úkoly | FR-TWO-01 |
| MS3 | Později | FR-THR-01 |
`;

const ACCEPTANCE = `# ACs

### FR-ABC-01 Název s diakritikou
- **AC-1** Soubor \`Výlet do Lisabonu.md\` keeps its name.
- **AC-2** [MS2] Verified once tasks exist.

### FR-ABC-02 Ruční kontrola
- **AC-1** [manual] [MS2] The owner checks the žluťoučký kůň note.
- **AC-2** [MS2] [manual] The owner checks it again.

### FR-ONL-01 Only deferred
- **AC-1** [MS2] Everything about this requirement is verified later.

### FR-TWO-01 Úkol
- **AC-1** Automated.

### FR-THR-01 Later
- **AC-1** Automated.
`;

const NAMES = ['fr_abc_01_AC1_x', 'fr_abc_01_AC2_x', 'fr_onl_01_AC1_x', 'fr_two_01_AC1_x', 'fr_thr_01_AC1_x'];
const ALL_PASS: Case[] = NAMES.map((name) => ({ name }));
const MS2_MANUAL = { 'qa/sessions/2026-05-01.md': 'milestone: MS2\n\n- FR-ABC-02/AC-1: pass\n- FR-ABC-02/AC-2: pass\n' };
const MS1_MANUAL = { 'qa/sessions/2026-04-01.md': 'milestone: MS1\n\n- FR-ABC-02/AC-1: pass\n- FR-ABC-02/AC-2: pass\n' };

function repoWith(t: any, cases: Case[], extra: Files = {}, acceptance = ACCEPTANCE): string {
  return makeRepo(t, {
    config: { steps: [{ id: 'junit', level: 'commit', run: 'cp results/junit.xml "$VERIFY_RESULTS/junit.xml"' }] },
    files: {
      'docs/Business Requirements.md': BRD,
      'docs/acceptance/ms.md': acceptance,
      'src/ms.test.ts': NAMES.map((n) => `test('${n}', () => {});`).join('\n') + '\n',
      'results/junit.xml': junitXml(cases),
      ...extra,
    },
  });
}

const only = (...names: string[]): Case[] => names.map((name) => ({ name }));

// ---------------------------------------------------------------------------
// AC-4
// ---------------------------------------------------------------------------

test('ts_cov_ac4_deferred_ac_does_not_fail_its_requirement_milestone', (t) => {
  const repo = repoWith(t, only('fr_abc_01_AC1_x'));
  const r = verify(repo, ['milestone', '--milestone', 'MS1']);
  assertExit(r, 0, 'verify milestone MS1 with only deferred ACs untested and no manual records');
  const s = lastSummary(repo, 'milestone');
  assert.equal(findCheck(s, 'milestone-acs').result, 'pass', describe(r));
  const deferred = findCheck(s, 'milestone-deferred');
  assert.equal(deferred.result, 'pass', 'milestone-deferred always passes');
  assert.deepEqual(
    [...deferred.messages].sort(),
    ['FR-ABC-01/AC-2: verified at MS2', 'FR-ABC-02/AC-1: verified at MS2', 'FR-ABC-02/AC-2: verified at MS2', 'FR-ONL-01/AC-1: verified at MS2'],
  );
});

test('ts_cov_ac4_deferred_ac_failing_or_not_run_fails_target_milestone', (t) => {
  const failing = repoWith(t, ALL_PASS.map((c) => (c.name === 'fr_abc_01_AC2_x' ? { ...c, fail: true } : c)), MS2_MANUAL);
  const r1 = verify(failing, ['milestone', '--milestone', 'MS2']);
  assertExit(r1, 1, 'verify milestone MS2 with the deferred FR-ABC-01/AC-2 failing');
  assert.ok(checkMessages(lastSummary(failing, 'milestone'), 'milestone-acs').includes('FR-ABC-01/AC-2'), describe(r1));

  const notRun = repoWith(t, ALL_PASS.filter((c) => c.name !== 'fr_abc_01_AC2_x'), MS2_MANUAL);
  const r2 = verify(notRun, ['milestone', '--milestone', 'MS2']);
  assertExit(r2, 1, 'verify milestone MS2 with the deferred FR-ABC-01/AC-2 not run');
  assert.ok(output(r2).includes('FR-ABC-01/AC-2'), describe(r2));
});

test('ts_cov_ac4_deferred_ac_passing_passes_target_milestone', (t) => {
  // Red guard: without the feature MS2 also passes, so first require that the deferred AC is in MS2's scope.
  const missing = repoWith(t, only('fr_two_01_AC1_x'), MS2_MANUAL);
  assertExit(verify(missing, ['milestone', '--milestone', 'MS2']), 1, 'verify milestone MS2 with deferred ACs not run');

  const repo = repoWith(t, ALL_PASS, MS2_MANUAL);
  const r = verify(repo, ['milestone', '--milestone', 'MS2']);
  assertExit(r, 0, 'verify milestone MS2 with every deferred AC passing and MS2 manual records');
  assert.equal(findCheck(lastSummary(repo, 'milestone'), 'milestone-acs').result, 'pass');
});

test('ts_cov_ac4_manual_marker_in_either_order_needs_record_for_target_milestone', (t) => {
  const ms1Only = repoWith(t, ALL_PASS, MS1_MANUAL);
  const r1 = verify(ms1Only, ['milestone', '--milestone', 'MS2']);
  assertExit(r1, 1, 'verify milestone MS2 with manual records only for MS1');
  const msgs = checkMessages(lastSummary(ms1Only, 'milestone'), 'milestone-acs');
  assert.ok(msgs.includes('FR-ABC-02/AC-1'), `[manual] [MS2] must be checked at MS2: ${msgs}`);
  assert.ok(msgs.includes('FR-ABC-02/AC-2'), `[MS2] [manual] must be checked at MS2: ${msgs}`);

  const ok = repoWith(t, ALL_PASS, MS2_MANUAL);
  assertExit(verify(ok, ['milestone', '--milestone', 'MS2']), 0, 'verify milestone MS2 with MS2 manual records');
});

test('ts_cov_ac4_coverage_kind_shows_marker', (t) => {
  const repo = repoWith(t, ALL_PASS);
  const results = tmpDir(t, 'tegg-qa-results-');
  fs.writeFileSync(path.join(results, 'junit.xml'), junitXml(ALL_PASS));
  assertExit(verify(repo, ['coverage', '--results', results]), 0, 'verify coverage');
  const text = readText(path.join(repo, 'qa', 'coverage', 'ac-matrix.md'), 'ac-matrix.md');
  const kind = (id: string) => {
    const line = text.split('\n').find((l) => l.startsWith(`| ${id} |`));
    assert.ok(line, `row for ${id}\n${text}`);
    return line.split('|')[2].trim();
  };
  assert.equal(kind('FR-ABC-01/AC-1'), 'auto');
  assert.equal(kind('FR-ABC-01/AC-2'), 'auto (MS2)');
  assert.equal(kind('FR-ABC-02/AC-1'), 'manual (MS2)');
  assert.equal(kind('FR-ABC-02/AC-2'), 'manual (MS2)');
});

// ---------------------------------------------------------------------------
// AC-5
// ---------------------------------------------------------------------------

test('ts_cov_ac5_requirement_with_only_deferred_acs_counts_as_having_acs', (t) => {
  const repo = repoWith(t, only('fr_abc_01_AC1_x'));
  const r = verify(repo, ['milestone', '--milestone', 'MS1']);
  const msgs = checkMessages(lastSummary(repo, 'milestone'), 'milestone-acs');
  assert.ok(!msgs.includes('FR-ONL-01'), `FR-ONL-01 has only deferred ACs and must not be listed: ${msgs}`);
  assertExit(r, 0, 'verify milestone MS1');
});

test('ts_cov_ac5_unknown_milestone_marker_fails_requirement_milestone', (t) => {
  const acceptance = ACCEPTANCE.replace('- **AC-2** [MS2] Verified once tasks exist.', '- **AC-2** [MS9] Verified at a milestone that does not exist.');
  const repo = repoWith(t, ALL_PASS, MS1_MANUAL, acceptance.replace(/\[MS2\] /g, '').replace(/ \[MS2\]/g, ''));
  const r = verify(repo, ['milestone', '--milestone', 'MS1']);
  assertExit(r, 1, 'verify milestone MS1 with a [MS9] marker');
  const msgs = checkMessages(lastSummary(repo, 'milestone'), 'milestone-acs');
  assert.ok(msgs.split('\n').includes('FR-ABC-01/AC-2: unknown milestone MS9'), `messages: ${msgs}`);
});
