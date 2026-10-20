// MS5 slice 5B feedback round 2, L1: the version label (FR-UX-01 AC-5, D-597).
// Written from docs/acceptance/app-shell.md (FR-UX-01 AC-5) and docs/contracts/ms3-shell.md §12.3 only (D-61):
// `versionLabel(subjects)` in `app/ui/src/version.ts` is a pure function over commit subjects, newest first, giving
// `v0.<N>` for the first `Merge pull request #N` and `v0.dev` when there is none. The module loads inside each test
// through `need`, so a missing module or export fails an assertion (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { need } from './read-helpers';

const VERSION = '../ui/src/version.ts';
async function versionLabel(subjects: string[]): Promise<unknown> {
  const m = await need(VERSION, 'versionLabel');
  assert.equal(typeof m.versionLabel, 'function', 'versionLabel is a function');
  return m.versionLabel(subjects);
}

test('fr_ux_01_ac5_version_label_is_the_first_merged_pull_request', async () => {
  const subjects = [
    'Merge pull request #51 from mikhail/ms5/5b-feedback-2',
    'D-597: značka Tegg jen v Docku a v řádku nabídek',
    'Merge pull request #50 from mikhail/ms5/5b-feedback',
    'Úprava kanbanu (D-593)',
  ];
  assert.equal(await versionLabel(subjects), 'v0.51');
});

test('fr_ux_01_ac5_version_label_follows_a_later_merge', async () => {
  const subjects = [
    'Merge pull request #52 from mikhail/ms6/6a-trash',
    'Koš a obrázky (FR-TRS-01)',
    'Merge pull request #51 from mikhail/ms5/5b-feedback-2',
    'D-597: značka Tegg jen v Docku a v řádku nabídek',
  ];
  assert.equal(await versionLabel(subjects), 'v0.52');
});

test('fr_ux_01_ac5_version_label_skips_newer_non_merge_subjects', async () => {
  const subjects = [
    'Oprava: žluťoučký kůň v názvu souboru',
    "Merge branch 'main' into ms5/5b-feedback-2",
    'Red AC tests for D-597 (version label, no Saved logo)',
    'Merge pull request #51 from mikhail/ms5/5b-feedback-2',
    'Merge pull request #50 from mikhail/ms5/5b-feedback',
  ];
  assert.equal(await versionLabel(subjects), 'v0.51', 'the newest `Merge pull request #N` wins, other subjects are skipped');
});

test('fr_ux_01_ac5_version_label_reads_multi_digit_numbers', async () => {
  assert.equal(await versionLabel(['Merge pull request #7 from a/b']), 'v0.7');
  assert.equal(await versionLabel(['Merge pull request #1234 from a/b', 'Merge pull request #999 from a/c']), 'v0.1234');
});

test('fr_ux_01_ac5_version_label_without_merge_is_dev', async () => {
  assert.equal(await versionLabel([]), 'v0.dev', 'no subjects');
  assert.equal(await versionLabel([
    'Počáteční commit',
    "Merge branch 'main' into feature",
    'Fix pull request #12 review findings',
  ]), 'v0.dev', 'no `Merge pull request #N` subject');
});

test('fr_ux_01_ac5_version_label_is_pure', async () => {
  const subjects = ['Úklid', 'Merge pull request #51 from mikhail/ms5/5b-feedback-2', 'Merge pull request #50 from x/y'];
  const copy = [...subjects];
  const a = await versionLabel(subjects);
  const b = await versionLabel(subjects);
  assert.equal(a, 'v0.51');
  assert.equal(b, a, 'same input, same output');
  assert.deepEqual(subjects, copy, 'the input is not changed');
});

test('fr_ux_01_ac5_version_label_matches_the_shown_pattern', async () => {
  for (const s of [[], ['Merge pull request #3 from a/b'], ['x', 'Merge pull request #60 from a/b']]) {
    const v = await versionLabel(s);
    assert.equal(typeof v, 'string', 'a string');
    assert.match(v as string, /^v0\.(\d+|dev)$/, `${JSON.stringify(s)} → ${String(v)}`);
  }
});
