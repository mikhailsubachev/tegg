// TS-VERIFY AC-11: flaky tests are reported and counted (D-1833). Black box against tools/qa/CONTRACT.md §1.2
// (shared `flaky.json`), §3.4 (summary `flaky`, check id `flaky`), §3.6 (report files, the flaky list, the check,
// `verify flaky`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  addWorktree, assertExit, commitAll, describe, findCheck, findStep, git, headSha, lastSummary, makeRepo, readJsonFile,
  sharedDir, sq, tmpDir, verify, writeFiles, type RunResult, type Step,
} from './helpers.ts';
import { holdLock, lockEnv } from './gate-lock-helpers.ts';

type Entry = { file: string; test: string };

const KOSIK: Entry = { file: 't/kosik.test.txt', test: 'přidá položku do košíku' };
const UCET: Entry = { file: 't/ucet.test.txt', test: 'spočítá daň › zaokrouhlí na haléře' };

const FILES = {
  't/kosik.test.txt': 'test košíku: přidá položku do košíku\n',
  't/ucet.test.txt': 'test účtu: spočítá daň\n',
};

/** Shell command that writes `content` to `$VERIFY_RESULTS/<name>.flaky.json`. */
function writeFlaky(name: string, content: string): string {
  return `printf '%s' ${sq(content)} > "$VERIFY_RESULTS/${name}.flaky.json"`;
}

function flakyStep(entries: Entry[], overrides: Partial<Step> = {}): Step {
  return { id: 'web', run: writeFlaky('web', JSON.stringify(entries)), level: 'push', ...overrides };
}

/** A repo whose only step reports `entries` as flaky in every run (no `inputs`, so it always runs). */
function flakyRepo(t: any, entries: Entry[], overrides: Partial<Step> = {}): string {
  return makeRepo(t, { config: { steps: [flakyStep(entries, overrides)] }, files: FILES });
}

function gate(repo: string, expected: number, args: string[] = ['push']): RunResult {
  const r = verify(repo, args);
  assertExit(r, expected, `verify ${args.join(' ')}`);
  return r;
}

function blobOf(repo: string, file: string, rev = 'HEAD'): string {
  return git(repo, ['rev-parse', `${rev}:${file}`]).trim();
}

/**
 * The shared flaky list. CONTRACT §3.6 names the records, not the JSON around them, so this accepts the records as
 * the top-level array or as the one array-valued property of a top-level object. `write` saves `json` back after a
 * test changed `records` in place.
 */
function flakyList(repo: string): { json: any; records: any[]; write: () => void } {
  const file = path.join(sharedDir(repo), 'flaky.json');
  const json = readJsonFile(file, 'the shared flaky list');
  let records: unknown = json;
  if (!Array.isArray(json) && json && typeof json === 'object') {
    const arrays = Object.values(json).filter((v) => Array.isArray(v));
    assert.equal(arrays.length, 1, `flaky.json must hold one array of records, got ${JSON.stringify(json)}`);
    records = arrays[0];
  }
  assert.ok(Array.isArray(records), `flaky.json must hold an array of records, got ${JSON.stringify(json)}`);
  return { json, records: records as any[], write: () => fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n') };
}

function sortEntries(list: any[]): Entry[] {
  return list.map((e) => ({ file: e.file, test: e.test })).sort((a, b) => `${a.file}\n${a.test}`.localeCompare(`${b.file}\n${b.test}`));
}

function flakyLine(r: RunResult, e: Entry): string | undefined {
  return r.stdout.split('\n').find((l) => l.includes('flaky') && l.includes(e.file) && l.includes(e.test));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `<file> :: <test>: flaky <n> times (<dates>); fix or quarantine it` */
function checkMessage(e: Entry, n: number): RegExp {
  return new RegExp(`^${escapeRe(e.file)} :: ${escapeRe(e.test)}: flaky ${n} times \\(.*\\d{4}-\\d{2}-\\d{2}.*\\); fix or quarantine it$`);
}

// ---------------------------------------------------------------------------
// Report: stdout lines and the summary's `flaky`
// ---------------------------------------------------------------------------

test('ts_verify_ac11_flaky_tests_are_printed_and_listed_in_the_summary', (t) => {
  const repo = flakyRepo(t, [KOSIK, UCET]);
  const r = gate(repo, 0);
  const summary = lastSummary(repo, 'push');
  assert.ok(Array.isArray(summary.flaky), `the summary has a flaky array, got ${JSON.stringify(summary.flaky)}\n${describe(r)}`);
  assert.deepEqual(sortEntries(summary.flaky), [KOSIK, UCET], 'the summary lists the flaky tests as { file, test }');
  for (const e of summary.flaky) assert.deepEqual(Object.keys(e).sort(), ['file', 'test'], 'a summary entry has file and test only');
  for (const e of [KOSIK, UCET]) {
    assert.ok(flakyLine(r, e), `stdout has one line containing "flaky", ${e.file} and ${e.test}\n${describe(r)}`);
  }
  // The step's own exit code decides whether it passed; a first flaky run doesn't fail the gate.
  assert.equal(findStep(summary, 'web').result, 'pass');
  assert.equal(summary.result, 'pass');
});

test('ts_verify_ac11_summary_flaky_is_empty_and_the_check_passes_without_flaky_tests', (t) => {
  const repo = makeRepo(t, { config: { steps: [{ id: 'web', run: 'true', level: 'push' }] }, files: FILES });
  const r = gate(repo, 0);
  const summary = lastSummary(repo, 'push');
  assert.deepEqual(summary.flaky, [], `a run without flaky tests has an empty flaky array\n${describe(r)}`);
  const check = findCheck(summary, 'flaky');
  assert.equal(check.result, 'pass');
  assert.deepEqual(check.messages, []);
  const ids: string[] = summary.checks.map((c: any) => c.id);
  if (ids.includes('red-first')) assert.ok(ids.indexOf('flaky') > ids.indexOf('red-first'), `the flaky check comes after red-first: ${ids.join(', ')}`);
  if (ids.includes('l6-coverage')) assert.ok(ids.indexOf('flaky') < ids.indexOf('l6-coverage'), `the flaky check comes before l6-coverage: ${ids.join(', ')}`);
});

test('ts_verify_ac11_reports_of_several_steps_are_collected_and_a_failing_step_still_fails', (t) => {
  const repo = makeRepo(t, {
    config: {
      steps: [
        { id: 'web', run: writeFlaky('web', JSON.stringify([KOSIK])), level: 'push', lane: 'a' },
        { id: 'jiný', run: `${writeFlaky('jiny', JSON.stringify([UCET]))}; exit 1`, level: 'push', lane: 'b' },
      ],
    },
    files: FILES,
  });
  const r = gate(repo, 1);
  const summary = lastSummary(repo, 'push');
  assert.ok(Array.isArray(summary.flaky), `the summary has a flaky array, got ${JSON.stringify(summary.flaky)}`);
  assert.deepEqual(sortEntries(summary.flaky), [KOSIK, UCET], 'every *.flaky.json this run wrote is read');
  assert.equal(findStep(summary, 'web').result, 'pass');
  assert.equal(findStep(summary, 'jiný').result, 'fail', 'a step that exits 1 fails, flaky report or not');
  assert.equal(findCheck(summary, 'flaky').result, 'pass', 'the check judges earlier runs only');
  assert.ok(flakyLine(r, KOSIK) && flakyLine(r, UCET), `stdout names both flaky tests\n${describe(r)}`);
});

// ---------------------------------------------------------------------------
// The shared flaky list
// ---------------------------------------------------------------------------

test('ts_verify_ac11_each_flaky_test_is_recorded_in_the_shared_list_with_its_blob', (t) => {
  const missing: Entry = { file: 't/smazany.test.txt', test: 'soubor není ve stromu' };
  const repo = flakyRepo(t, [KOSIK, missing]);
  gate(repo, 0);
  const summary = lastSummary(repo, 'push');
  const { records } = flakyList(repo);
  assert.equal(records.length, 2, `one record per flaky test, got ${JSON.stringify(records)}`);
  const byFile = (file: string) => records.find((x) => x.file === file);
  assert.deepEqual(byFile(KOSIK.file), {
    file: KOSIK.file,
    test: KOSIK.test,
    blob: blobOf(repo, KOSIK.file),
    commit: headSha(repo),
    gate: 'push',
    startedAt: summary.startedAt,
  }, 'a record is { file, test, blob, commit, gate, startedAt }');
  assert.equal(byFile(missing.file)?.blob, '', 'the blob of a file that is not in the checked tree is empty');
  assert.equal(byFile(missing.file)?.test, missing.test);

  // Entries are appended: the second run adds two more records and keeps the first two.
  gate(repo, 0);
  const after = flakyList(repo).records;
  assert.equal(after.length, 4, `the second run appends its records, got ${JSON.stringify(after)}`);
  assert.deepEqual(after.slice(0, 2), records, 'earlier records stay as they were, in order');
  assert.equal(after[2].startedAt, lastSummary(repo, 'push').startedAt);
});

test('ts_verify_ac11_records_older_than_90_days_are_dropped_on_write', (t) => {
  const repo = flakyRepo(t, [KOSIK]);
  gate(repo, 0);
  const list = flakyList(repo);
  assert.equal(list.records.length, 1, 'the first run recorded one flaky test');
  const day = 24 * 60 * 60 * 1000;
  const aged = (days: number, name: string) => ({ ...list.records[0], test: name, startedAt: new Date(Date.now() - days * day).toISOString() });
  // Different test names, so none of them is counted twice by the check.
  list.records.splice(0, 1, aged(100, 'sto dní starý'), aged(80, 'osmdesát dní starý'));
  list.write();
  gate(repo, 0);
  const tests = flakyList(repo).records.map((x) => x.test);
  assert.deepEqual(tests, ['osmdesát dní starý', KOSIK.test], 'the record older than 90 days is dropped, the others stay');
});

test('ts_verify_ac11_flaky_list_is_shared_with_worktrees', (t) => {
  const repo = flakyRepo(t, [KOSIK]);
  const wt = addWorktree(t, repo, 'vedlejší');
  gate(repo, 0);
  gate(wt, 0);
  const { records } = flakyList(repo);
  assert.equal(records.length, 2, `the main checkout's and the worktree's runs write one list, got ${JSON.stringify(records)}`);
  // Two records of the same test on the same file: the third gate fails, in whichever checkout it runs.
  const r = gate(wt, 1);
  const check = findCheck(lastSummary(wt, 'push'), 'flaky');
  assert.equal(check.result, 'fail', `the flaky check counts the records of every checkout\n${describe(r)}`);
});

// ---------------------------------------------------------------------------
// The `flaky` check
// ---------------------------------------------------------------------------

test('ts_verify_ac11_flaky_check_fails_for_a_test_recorded_twice_on_the_same_file', (t) => {
  // Reported in reverse order, to see the messages sorted.
  const repo = flakyRepo(t, [UCET, KOSIK]);
  gate(repo, 0);
  assert.equal(findCheck(lastSummary(repo, 'push'), 'flaky').result, 'pass', 'no earlier run: the check passes');
  const second = gate(repo, 0);
  const one = findCheck(lastSummary(repo, 'push'), 'flaky');
  assert.equal(one.result, 'pass', `one earlier record per test doesn't fail the check\n${describe(second)}`);
  assert.deepEqual(one.messages, []);

  const third = gate(repo, 1);
  const summary = lastSummary(repo, 'push');
  assert.equal(summary.result, 'fail');
  const check = findCheck(summary, 'flaky');
  assert.equal(check.result, 'fail', `two earlier records of a test on the same file fail the check\n${describe(third)}`);
  assert.equal(check.messages.length, 2, `one message per flaky test, got ${JSON.stringify(check.messages)}`);
  assert.match(check.messages[0], checkMessage(KOSIK, 2));
  assert.match(check.messages[1], checkMessage(UCET, 2));
  for (const e of [KOSIK, UCET]) {
    assert.ok(`${third.stdout}\n${third.stderr}`.includes(`${e.file} :: ${e.test}`), `the output names ${e.file} and ${e.test}\n${describe(third)}`);
  }
  // The steps still run after the failed check, so this run's flaky tests are recorded too.
  assert.equal(findStep(summary, 'web').result, 'pass', 'the step still runs and passes');
  assert.equal(flakyList(repo).records.length, 6);
  const fourth = gate(repo, 1);
  assert.match(findCheck(lastSummary(repo, 'push'), 'flaky').messages[0], checkMessage(KOSIK, 3), describe(fourth));
});

test('ts_verify_ac11_changed_test_file_clears_its_records_for_that_commit', (t) => {
  const repo = flakyRepo(t, [KOSIK, UCET]);
  gate(repo, 0);
  gate(repo, 0);
  const old = headSha(repo);
  // A quarantine tag in one test file: its object id changes, the other file stays as it is.
  writeFiles(repo, { 't/kosik.test.txt': 'test košíku @flaky: přidá položku do košíku\n' });
  commitAll(repo, 'Quarantine the flaky basket test');
  const r = gate(repo, 1);
  const check = findCheck(lastSummary(repo, 'push'), 'flaky');
  assert.equal(check.result, 'fail', `the unchanged test file still counts\n${describe(r)}`);
  assert.equal(check.messages.length, 1, `only the unchanged file's test is named, got ${JSON.stringify(check.messages)}`);
  assert.match(check.messages[0], checkMessage(UCET, 2));
  // The earlier records still count for the commit that has the file as it was.
  const before = gate(repo, 1, ['push', '--commit', old]);
  const oldCheck = findCheck(lastSummary(repo, 'push'), 'flaky');
  assert.equal(oldCheck.messages.length, 2, `at the old commit both files are as recorded\n${describe(before)}`);
  assert.match(oldCheck.messages[0], checkMessage(KOSIK, 2));
});

test('ts_verify_ac11_nightly_gate_reports_records_and_checks_flaky_tests', (t) => {
  const repo = flakyRepo(t, [KOSIK], { level: 'nightly' });
  for (const attempt of [1, 2]) {
    const r = gate(repo, 0, ['nightly']);
    const summary = lastSummary(repo, 'nightly');
    assert.deepEqual(summary.flaky, [KOSIK], `nightly run ${attempt} lists the flaky test in its summary\n${describe(r)}`);
    assert.equal(findCheck(summary, 'flaky').result, 'pass');
    assert.ok(flakyLine(r, KOSIK), `nightly prints the flaky test\n${describe(r)}`);
  }
  assert.deepEqual(flakyList(repo).records.map((x) => x.gate), ['nightly', 'nightly'], 'the records name the nightly gate');
  // The push gate doesn't run the nightly step, but its flaky check counts the nightly records.
  const push = gate(repo, 1);
  const check = findCheck(lastSummary(repo, 'push'), 'flaky');
  assert.equal(check.result, 'fail', describe(push));
  assert.match(check.messages[0], checkMessage(KOSIK, 2));
  assert.deepEqual(lastSummary(repo, 'push').flaky, [], 'this push run itself had no flaky test');
});

// ---------------------------------------------------------------------------
// `verify flaky` and `verify flaky --clear <file>`
// ---------------------------------------------------------------------------

test('ts_verify_ac11_verify_flaky_lists_the_records', (t) => {
  const repo = flakyRepo(t, [KOSIK, UCET]);
  const empty = verify(repo, ['flaky']);
  assertExit(empty, 0, 'verify flaky with no list yet');
  assert.doesNotMatch(empty.stdout, / :: /, 'no record lines before any flaky test was recorded');
  gate(repo, 0);
  const startedAt: string = lastSummary(repo, 'push').startedAt;
  for (const dir of [repo, addWorktree(t, repo, 'výpis')]) {
    const r = verify(dir, ['flaky']);
    assertExit(r, 0, `verify flaky in ${dir}`);
    const lines = r.stdout.split('\n').filter((l) => l.includes(' :: '));
    assert.equal(lines.length, 2, `one line per record\n${describe(r)}`);
    for (const e of [KOSIK, UCET]) {
      // `<date> <file> :: <test> (<gate> at <short sha>)`
      const re = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})\\S* ${escapeRe(e.file)} :: ${escapeRe(e.test)} \\(push at ([0-9a-f]{7,40})\\)$`);
      const m = lines.map((l) => l.match(re)).find((x) => x);
      assert.ok(m, `a line "<date> ${e.file} :: ${e.test} (push at <short sha>)"\n${describe(r)}`);
      assert.ok(headSha(repo).startsWith(m[2]), `the line names the checked commit: ${m[0]}`);
      const day = 24 * 60 * 60 * 1000;
      assert.ok(Math.abs(Date.parse(m[1]) - Date.parse(startedAt)) <= 2 * day, `the line starts with the run's date: ${m[0]}`);
    }
  }
});

test('ts_verify_ac11_flaky_clear_removes_every_record_of_a_file', (t) => {
  const repo = flakyRepo(t, [KOSIK, UCET]);
  gate(repo, 0);
  gate(repo, 0);
  assert.equal(flakyList(repo).records.length, 4, 'two runs recorded two flaky tests each');
  const r = verify(repo, ['flaky', '--clear', KOSIK.file]);
  assertExit(r, 0, `verify flaky --clear ${KOSIK.file}`);
  assert.match(r.stdout, /(^|\D)2(\D|$)/, `it prints how many records it removed (2)\n${describe(r)}`);
  const left = flakyList(repo).records;
  assert.deepEqual(left.map((x) => x.file), [UCET.file, UCET.file], 'only the other file\'s records are left');
  const listed = verify(repo, ['flaky']);
  assertExit(listed, 0, 'verify flaky after --clear');
  assert.ok(!listed.stdout.includes(KOSIK.file), `the cleared file is no longer listed\n${describe(listed)}`);

  assertExit(verify(repo, ['flaky', '--clear']), 2, 'verify flaky --clear without a file');
  assert.equal(flakyList(repo).records.length, 2, 'a usage error removes nothing');
  const none = verify(repo, ['flaky', '--clear', 't/neexistuje.test.txt']);
  assertExit(none, 0, 'verify flaky --clear for a file without records');
  assert.match(none.stdout, /(^|\D)0(\D|$)/, `it prints that it removed 0 records\n${describe(none)}`);

  // The cleared test no longer fails the check; the other one still does.
  const push = gate(repo, 1);
  const check = findCheck(lastSummary(repo, 'push'), 'flaky');
  assert.equal(check.messages.length, 1, describe(push));
  assert.match(check.messages[0], checkMessage(UCET, 2));
});

test('ts_verify_ac11_verify_flaky_does_not_wait_for_the_gate_lock', (t) => {
  const repo = flakyRepo(t, [KOSIK]);
  gate(repo, 0);
  gate(repo, 0);
  // Another gate holds the machine-wide lock: `flaky` and `flaky --clear` answer at once.
  const lockDir = tmpDir(t, 'tegg-qa-lock-');
  holdLock(t, lockDir);
  const started = Date.now();
  const listed = verify(repo, ['flaky'], { env: lockEnv(lockDir), timeout: 10_000 });
  assertExit(listed, 0, 'verify flaky while another gate holds the lock');
  assert.doesNotMatch(listed.stdout, /waiting for/, 'verify flaky never waits for the gate lock');
  assert.equal(listed.stdout.split('\n').filter((l) => l.includes(' :: ')).length, 2, describe(listed));
  const cleared = verify(repo, ['flaky', '--clear', KOSIK.file], { env: lockEnv(lockDir), timeout: 10_000 });
  assertExit(cleared, 0, 'verify flaky --clear while another gate holds the lock');
  assert.ok(Date.now() - started < 10_000, 'both commands return without waiting');
  assert.deepEqual(flakyList(repo).records, [], 'the records are removed');
});

// ---------------------------------------------------------------------------
// Malformed input never fails a gate by itself
// ---------------------------------------------------------------------------

test('ts_verify_ac11_malformed_flaky_file_is_ignored_with_a_warning', (t) => {
  const run = [
    writeFlaky('dobry', JSON.stringify([KOSIK])),
    writeFlaky('neni-json', 'tohle není JSON {'),
    writeFlaky('neni-pole', JSON.stringify({ file: UCET.file, test: UCET.test })),
    writeFlaky('bez-testu', JSON.stringify([{ file: UCET.file }])),
  ].join('; ');
  const repo = makeRepo(t, { config: { steps: [{ id: 'web', run, level: 'push' }] }, files: FILES });
  const r = gate(repo, 0);
  const summary = lastSummary(repo, 'push');
  assert.deepEqual(summary.flaky, [KOSIK], `only the well-formed file's entries are counted\n${describe(r)}`);
  const warnings = r.stderr.split('\n').filter((l) => l.includes('flaky'));
  for (const name of ['neni-json', 'neni-pole', 'bez-testu']) {
    assert.ok(warnings.some((l) => l.includes(`${name}.flaky.json`)), `stderr has a warning containing "flaky" that names ${name}.flaky.json\n${describe(r)}`);
  }
  assert.ok(!warnings.some((l) => l.includes('dobry.flaky.json')), 'no warning for the well-formed file');
  assert.equal(findStep(summary, 'web').result, 'pass');
  assert.deepEqual(flakyList(repo).records.map((x) => x.test), [KOSIK.test], 'only the well-formed entries are recorded');
});

test('ts_verify_ac11_malformed_flaky_list_counts_as_empty_and_is_rewritten', (t) => {
  const repo = flakyRepo(t, [KOSIK]);
  for (const garbage of ['tohle není JSON {', '{"records": "žádné"}', '']) {
    writeFiles(repo, { '.git/tegg-verify/flaky.json': garbage });
    const r = gate(repo, 0);
    const summary = lastSummary(repo, 'push');
    assert.equal(findCheck(summary, 'flaky').result, 'pass', `a malformed list counts as empty: ${JSON.stringify(garbage)}\n${describe(r)}`);
    assert.deepEqual(summary.flaky, [KOSIK]);
    const { records } = flakyList(repo);
    assert.deepEqual(records.map((x) => x.test), [KOSIK.test], 'the list is rewritten with this run\'s record');
    assertExit(verify(repo, ['flaky']), 0, 'verify flaky after the rewrite');
  }
  // `verify flaky` itself never fails on a malformed list either.
  writeFiles(repo, { '.git/tegg-verify/flaky.json': 'tohle není JSON {' });
  const listed = verify(repo, ['flaky']);
  assertExit(listed, 0, 'verify flaky with a malformed list');
  assert.doesNotMatch(listed.stdout, / :: /, 'a malformed list is listed as empty');
});
