// TS-P: privacy guardrails (D-50, D-62). Black box against tools/qa/CONTRACT.md §4.5, §6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertExit, assertNonZero, checkMessages, commitAll, describe, findCheck, git, gitTry, headSha,
  installRealHooks, lastSummary, makeRepo, output, verify, writeFiles,
} from './helpers.ts';

const LIMIT = 1_048_576;

function stage(repo: string, files: Record<string, string | Buffer>): void {
  writeFiles(repo, files);
  git(repo, ['add', '-f', '--', ...Object.keys(files)]);
}

function expectCommitRejects(t: any, files: Record<string, string | Buffer>, offending: string, rule: RegExp): void {
  const repo = makeRepo(t);
  stage(repo, files);
  const r = verify(repo, ['commit']);
  assertExit(r, 1, `verify commit with staged ${offending}`);
  assert.ok(output(r).includes(offending), `the output must name ${offending}\n${describe(r)}`);
  const s = lastSummary(repo, 'commit');
  assert.equal(findCheck(s, 'privacy').result, 'fail');
  const msgs = checkMessages(s, 'privacy');
  assert.ok(msgs.includes(offending), `privacy messages must name ${offending}: ${msgs}`);
  assert.match(msgs, rule, `privacy messages must say which rule was broken: ${msgs}`);
}

function expectCommitAccepts(t: any, files: Record<string, string | Buffer>, what: string): void {
  const repo = makeRepo(t);
  stage(repo, files);
  const r = verify(repo, ['commit']);
  assertExit(r, 0, `verify commit with ${what}`);
  assert.equal(findCheck(lastSummary(repo, 'commit'), 'privacy').result, 'pass');
}

// ---------------------------------------------------------------------------
// AC-1: commit gate rejects test exports/, zips and large files outside tests/fixtures/
// ---------------------------------------------------------------------------

test('ts_p_ac1_rejects_staged_path_under_test_exports', (t) => {
  expectCommitRejects(t, { 'test exports/Výlet do Lisabonu.md': 'title: Výlet do Lisabonu\n' }, 'test exports/Výlet do Lisabonu.md', /test exports/i);
});

test('ts_p_ac1_rejects_zip_outside_fixtures_case_insensitive', (t) => {
  expectCommitRejects(t, { 'downloads/Export Cestovní deník.ZIP': Buffer.from('PK\u0003\u0004') }, 'downloads/Export Cestovní deník.ZIP', /zip/i);
});

test('ts_p_ac1_accepts_zip_under_fixtures', (t) => {
  expectCommitAccepts(t, { 'tests/fixtures/import/capacities/minimal.zip': Buffer.from('PK\u0003\u0004') }, 'a zip under tests/fixtures/');
});

test('ts_p_ac1_rejects_file_over_1_mib_outside_fixtures', (t) => {
  expectCommitRejects(t, { 'assets/velký soubor.bin': Buffer.alloc(LIMIT + 1, 0x61) }, 'assets/velký soubor.bin', /size|large|big|MB|MiB|bytes|1048576|1,048,576/i);
});

test('ts_p_ac1_accepts_file_of_exactly_1_mib_and_large_fixture', (t) => {
  expectCommitAccepts(t, {
    'assets/exactly.bin': Buffer.alloc(LIMIT, 0x61),
    'tests/fixtures/perf/large.md': Buffer.alloc(LIMIT * 2, 0x61),
  }, 'a 1,048,576-byte file and a large fixture');
});

test('ts_p_ac1_checks_staged_content_not_working_copy', (t) => {
  const big = makeRepo(t);
  stage(big, { 'data.bin': Buffer.alloc(LIMIT + 1, 0x61) });
  fs.writeFileSync(path.join(big, 'data.bin'), 'small now\n');
  assertExit(verify(big, ['commit']), 1, 'staged content over the limit, working copy small');

  const small = makeRepo(t);
  stage(small, { 'data.bin': 'small\n' });
  fs.writeFileSync(path.join(small, 'data.bin'), Buffer.alloc(LIMIT + 1, 0x61));
  assertExit(verify(small, ['commit']), 0, 'staged content small, working copy over the limit');
});

test('ts_p_ac1_ignores_untracked_files', (t) => {
  const repo = makeRepo(t);
  writeFiles(repo, { 'scratch/archive.zip': Buffer.from('PK'), 'test exports/Výlet.md': 'Výlet\n' });
  assertExit(verify(repo, ['commit']), 0, 'verify commit with only untracked offending files');
});

test('ts_p_ac1_push_gate_checks_every_file_in_the_tree', (t) => {
  const repo = makeRepo(t);
  writeFiles(repo, { 'test exports/Poznámky.md': 'Výlet do Lisabonu\n' });
  git(repo, ['add', '-f', '--', 'test exports/Poznámky.md']);
  commitAll(repo, 'oops');
  const r = verify(repo, ['push']);
  assertExit(r, 1, 'verify push with a committed file under test exports/');
  assert.ok(checkMessages(lastSummary(repo, 'push'), 'privacy').includes('test exports/Poznámky.md'));
});

test('ts_p_ac1_pre_commit_hook_rejects_staged_zip', (t) => {
  const repo = makeRepo(t);
  installRealHooks(repo);
  commitAll(repo, 'add hooks');
  const before = headSha(repo);
  stage(repo, { 'export.zip': Buffer.from('PK\u0003\u0004') });
  assertNonZero(gitTry(repo, ['commit', '-q', '-m', 'add zip']), 'git commit with a staged zip');
  assert.equal(headSha(repo), before, 'no commit may be created');
});

// ---------------------------------------------------------------------------
// AC-3: counts-only output check (helper for the real-export test)
// ---------------------------------------------------------------------------

test('ts_p_ac3_counts_only_accepts_counts_indexes_and_numeric_ids', (t) => {
  const repo = makeRepo(t);
  writeFiles(repo, {
    'out.txt': [
      'capacities: {"files":697,"ok":697}',
      '',
      'failing file indexes: 3,17',
      '{"objects": 120, "attachments": 14, "links-unresolved": 2}',
      'ratio: 99.5%',
      'IDs: [12, 40]',
      '',
    ].join('\n'),
  });
  const r = verify(repo, ['counts-only', 'out.txt']);
  assertExit(r, 0, 'counts-only on counts-only output');
});

test('ts_p_ac3_counts_only_rejects_titles_and_reports_line_numbers_only', (t) => {
  const repo = makeRepo(t);
  writeFiles(repo, {
    'out.txt': 'files: 697\ntitle: Výlet do Lisabonu\nok: 697\n{"name":"Cestovní deník"}\n',
  });
  const r = verify(repo, ['counts-only', 'out.txt']);
  assertExit(r, 1, 'counts-only on output with titles');
  const out = output(r);
  assert.match(out, /\b2\b/, `line 2 must be reported\n${describe(r)}`);
  assert.match(out, /\b4\b/, `line 4 must be reported\n${describe(r)}`);
  for (const secret of ['Výlet', 'Lisabonu', 'Cestovní', 'deník', 'title:']) {
    assert.ok(!out.includes(secret), `output must never contain line content (${secret})\n${describe(r)}`);
  }
});

test('ts_p_ac3_counts_only_reads_stdin', (t) => {
  const repo = makeRepo(t);
  assertExit(verify(repo, ['counts-only'], { input: 'notes: 12\nfailing file indexes: 1,2\n' }), 0, 'counts-only on clean stdin');
  const r = verify(repo, ['counts-only'], { input: 'notes: 12\nPříliš žluťoučký kůň\n' });
  assertExit(r, 1, 'counts-only on stdin with content');
  assert.ok(!output(r).includes('žluťoučký'), 'output must not contain line content');
});
