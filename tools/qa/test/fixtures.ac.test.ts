// TS-D4: fixture integrity. Black box against tools/qa/CONTRACT.md §3.2 (range) and §7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertExit, checkMessages, commitAll, describe, findCheck, git, lastSummary, makeRepo, verify, writeFiles,
} from './helpers.ts';

const FIXTURE = 'tests/fixtures/format/roundtrip/výlet.md';

function fixtureRepo(t: any) {
  const repo = makeRepo(t, {
    files: {
      [FIXTURE]: '---\ntitle: Výlet do Lisabonu\n---\n\nDen první.\n',
      'tests/fixtures/format/roundtrip/other.md': '# Other\n',
    },
  });
  git(repo, ['checkout', '-q', '-b', 'feature']);
  return repo;
}

test('ts_d4_ac1_modified_fixture_without_trailer_fails_push', (t) => {
  const repo = fixtureRepo(t);
  writeFiles(repo, { [FIXTURE]: '---\ntitle: Výlet do Lisabonu\n---\n\nDen druhý.\n' });
  const bad = commitAll(repo, 'Tweak fixture');
  const r = verify(repo, ['push']);
  assertExit(r, 1, 'verify push with a changed fixture and no trailer');
  const s = lastSummary(repo, 'push');
  assert.equal(findCheck(s, 'fixtures').result, 'fail');
  const msgs = checkMessages(s, 'fixtures');
  assert.ok(msgs.includes(FIXTURE), `must name the file: ${msgs}`);
  assert.ok(msgs.includes(bad.slice(0, 7)), `must name the commit ${bad}: ${msgs}\n${describe(r)}`);
});

test('ts_d4_ac1_modified_fixture_with_trailer_passes_push', (t) => {
  const repo = fixtureRepo(t);
  writeFiles(repo, { [FIXTURE]: '---\ntitle: Výlet do Lisabonu\n---\n\nDen druhý.\n' });
  commitAll(repo, 'Regenerate fixture\n\nFixture-Change: S1 finding 4 needs a second paragraph');
  assertExit(verify(repo, ['push']), 0, 'verify push with Fixture-Change trailer');
  assert.equal(findCheck(lastSummary(repo, 'push'), 'fixtures').result, 'pass');
});

test('ts_d4_ac1_deleted_or_renamed_fixture_without_trailer_fails_push', (t) => {
  const del = fixtureRepo(t);
  git(del, ['rm', '-q', FIXTURE]);
  commitAll(del, 'Drop fixture');
  assertExit(verify(del, ['push']), 1, 'verify push with a deleted fixture');

  const ren = fixtureRepo(t);
  git(ren, ['mv', FIXTURE, 'tests/fixtures/format/roundtrip/přejmenováno.md']);
  commitAll(ren, 'Rename fixture');
  assertExit(verify(ren, ['push']), 1, 'verify push with a renamed fixture');
});

test('ts_d4_ac1_added_fixture_needs_no_trailer', (t) => {
  const repo = fixtureRepo(t);
  writeFiles(repo, { 'tests/fixtures/format/roundtrip/nový.md': '# Nový\n' });
  commitAll(repo, 'Add fixture');
  assertExit(verify(repo, ['push']), 0, 'verify push with only an added fixture');
});

test('ts_d4_ac1_only_commits_in_range_are_checked', (t) => {
  const repo = fixtureRepo(t);
  writeFiles(repo, { [FIXTURE]: 'changed without trailer\n' });
  const bad = commitAll(repo, 'Tweak fixture');
  writeFiles(repo, { 'src/a.ts': 'export {};\n' });
  const head = commitAll(repo, 'Unrelated');
  assertExit(verify(repo, ['push', '--range', `${bad}..${head}`]), 0, 'verify push with the offending commit outside --range');
  assertExit(verify(repo, ['push', '--range', `main..${head}`]), 1, 'verify push with the offending commit inside --range');
});
