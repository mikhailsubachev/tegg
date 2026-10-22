// TS-VERIFY AC-7: `verify merge` (D-527). Black box against tools/qa/CONTRACT.md §11, §3.2, §3.2.2.
// The temporary repositories have no `origin`, so the default base is `main`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertExit, commitAll, countLines, describe, git, lastSummary, makeRepo, markStep, readText, tmpDir, treeOf, verify,
  writeFiles,
} from './helpers.ts';

function lastLine(r: { stdout: string }): string {
  const lines = r.stdout.split('\n').filter((l) => l.length > 0);
  return lines[lines.length - 1] ?? '';
}

/** A repo on branch `feature` (one commit ahead of `main`) with one push-level marker step. */
function mergeRepo(t: any, run?: string) {
  const marker = path.join(tmpDir(t, 'tegg-qa-out-'), 'ran');
  const repo = makeRepo(t, { config: { steps: [{ id: 'step', run: run ?? markStep(marker), level: 'push' }] } });
  git(repo, ['checkout', '-q', '-b', 'feature']);
  writeFiles(repo, { 'src/a.txt': 'Příliš žluťoučký kůň\n' });
  commitAll(repo, 'Feature work');
  return { repo, marker };
}

test('ts_verify_ac7_base_not_merged_exits_1_without_running_a_gate', (t) => {
  const { repo, marker } = mergeRepo(t);
  // Move main ahead so it is no longer an ancestor of HEAD.
  git(repo, ['checkout', '-q', 'main']);
  writeFiles(repo, { 'other/b.txt': 'úpěl ďábelské ódy\n' });
  commitAll(repo, 'Main moves on');
  git(repo, ['checkout', '-q', 'feature']);
  const r = verify(repo, ['merge']);
  assertExit(r, 1, 'verify merge with an unmerged base');
  assert.ok(r.stderr.includes('merge main first'), `stderr names the base to merge first\n${describe(r)}`);
  assert.equal(countLines(marker), 0, `no gate step ran\n${describe(r)}`);
  assert.ok(!fs.existsSync(path.join(repo, '.verify', 'last-push.json')), 'no push gate summary was written');
  assert.ok(!fs.existsSync(path.join(repo, '.verify', 'last-pass')), 'no last-pass was recorded');
});

test('ts_verify_ac7_base_merged_runs_push_gate_and_prints_ready', (t) => {
  const { repo, marker } = mergeRepo(t);
  const r = verify(repo, ['merge']);
  assertExit(r, 0, 'verify merge with main merged');
  assert.equal(countLines(marker), 1, `the push gate ran the step once\n${describe(r)}`);
  const tree = treeOf(repo);
  assert.equal(readText(path.join(repo, '.verify', 'last-pass'), 'last-pass').trim(), tree, 'last-pass records the tree of HEAD');
  const summary = lastSummary(repo, 'push');
  assert.equal(summary.result, 'pass');
  assert.equal(summary.tree, tree);
  assert.ok(fs.existsSync(path.join(repo, '.verify', 'review', 'context.md')), `review context written\n${describe(r)}`);
  assert.match(lastLine(r), /^verify merge: READY \(tree [0-9a-f]{40}\)$/, `last stdout line\n${describe(r)}`);
  assert.ok(lastLine(r).includes(tree), `READY line names the tree ${tree}\n${describe(r)}`);
});

test('ts_verify_ac7_gate_failure_prints_not_ready_and_exits_1', (t) => {
  const { repo } = mergeRepo(t, 'echo selhání; exit 1');
  const r = verify(repo, ['merge']);
  assertExit(r, 1, 'verify merge with a failing push step');
  assert.equal(lastLine(r), 'verify merge: NOT READY', `last stdout line\n${describe(r)}`);
  assert.ok(!fs.existsSync(path.join(repo, '.verify', 'last-pass')), 'no last-pass on failure');
  assert.equal(lastSummary(repo, 'push').result, 'fail', 'the push gate ran and failed');
});

test('ts_verify_ac7_base_option_names_another_base', (t) => {
  const { repo, marker } = mergeRepo(t);
  // `release` is an ancestor of HEAD (feature); `main` moves ahead so the default base would not be.
  git(repo, ['branch', 'release', 'main']);
  git(repo, ['checkout', '-q', 'main']);
  writeFiles(repo, { 'other/b.txt': 'jiná změna\n' });
  commitAll(repo, 'Main moves on');
  git(repo, ['checkout', '-q', 'feature']);
  const unmerged = verify(repo, ['merge']);
  assertExit(unmerged, 1, 'verify merge with the default base main unmerged');
  assert.equal(countLines(marker), 0, 'no gate ran with the unmerged default base');
  const r = verify(repo, ['merge', '--base', 'release']);
  assertExit(r, 0, 'verify merge --base release');
  assert.equal(countLines(marker), 1, `the push gate ran once\n${describe(r)}`);
  assert.match(lastLine(r), /^verify merge: READY \(tree [0-9a-f]{40}\)$/, `last stdout line\n${describe(r)}`);
  const context = readText(path.join(repo, '.verify', 'review', 'context.md'), 'review context');
  assert.ok(context.includes('release'), `review context names the base release\n${context}`);
});

test('ts_verify_ac7_lanes_option_1_accepted_and_other_values_exit_2', (t) => {
  const { repo, marker } = mergeRepo(t);
  assertExit(verify(repo, ['merge', '--lanes', '2']), 2, 'verify merge --lanes 2');
  assert.equal(countLines(marker), 0, 'a usage error runs no gate');
  assert.ok(!fs.existsSync(path.join(repo, '.verify', 'last-push.json')), 'a usage error writes no summary');
  const r = verify(repo, ['merge', '--lanes', '1']);
  assertExit(r, 0, 'verify merge --lanes 1');
  assert.equal(countLines(marker), 1, `--lanes 1 runs the gate\n${describe(r)}`);
  assert.match(lastLine(r), /^verify merge: READY \(tree [0-9a-f]{40}\)$/, `last stdout line\n${describe(r)}`);
});

// ---------------------------------------------------------------------------
// With a remote: the default base is origin/main; a failed fetch is a warning
// ---------------------------------------------------------------------------

/** Adds a bare `origin` holding main and feature, then moves the local `main` ahead of `origin/main`. */
function withOrigin(t: any, { repo }: { repo: string }): string {
  const bare = tmpDir(t, 'tegg-qa-origin-');
  git(bare, ['init', '-q', '--bare']);
  git(repo, ['remote', 'add', 'origin', bare]);
  git(repo, ['push', '-q', 'origin', 'main', 'feature']);
  git(repo, ['checkout', '-q', 'main']);
  writeFiles(repo, { 'other/b.txt': 'úpěl ďábelské ódy\n' });
  commitAll(repo, 'Main moves on locally only');
  git(repo, ['checkout', '-q', 'feature']);
  return bare;
}

test('ts_verify_ac7_default_base_is_origin_main_when_the_remote_exists', (t) => {
  const m = mergeRepo(t);
  withOrigin(t, m);
  // The local main is no longer an ancestor of HEAD, origin/main still is: the default base is origin/main.
  const r = verify(m.repo, ['merge']);
  assertExit(r, 0, 'verify merge with origin/main as the default base');
  assert.equal(countLines(m.marker), 1, `the push gate ran once\n${describe(r)}`);
  assert.match(lastLine(r), /^verify merge: READY \(tree [0-9a-f]{40}\)$/, `last stdout line\n${describe(r)}`);
  assert.ok(!/fetch/.test(r.stderr), `a successful fetch prints no warning\n${describe(r)}`);
  const context = readText(path.join(m.repo, '.verify', 'review', 'context.md'), 'review context');
  assert.ok(context.includes('origin/main'), `review context names the base origin/main\n${context}`);
});

test('ts_verify_ac7_failed_fetch_is_a_warning_and_the_flow_continues', (t) => {
  const m = mergeRepo(t);
  const bare = withOrigin(t, m);
  git(m.repo, ['remote', 'set-url', 'origin', path.join(bare, 'missing')]);
  const r = verify(m.repo, ['merge']);
  assertExit(r, 0, 'verify merge with an unreachable origin');
  assert.match(r.stderr, /fetch/, `the failed fetch is reported on stderr\n${describe(r)}`);
  assert.equal(countLines(m.marker), 1, `the push gate still ran\n${describe(r)}`);
  assert.match(lastLine(r), /^verify merge: READY \(tree [0-9a-f]{40}\)$/, `last stdout line\n${describe(r)}`);
});
