// TS-VERIFY AC-5: lanes (D-609). Black box against tools/qa/CONTRACT.md §2 (`lane`), §3.2, §3.2.2, §3.4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertExit, describe, findStep, git, lastSummary, makeRepo, markStep, readStamps, stampStep, tmpDir, verify, writeFiles,
} from './helpers.ts';

function stampRepo(t: any, lanes: { a: string; b: string }, level: 'push' | 'commit' = 'push') {
  const out = tmpDir(t, 'tegg-qa-out-');
  const markerA = path.join(out, 'a');
  const markerB = path.join(out, 'b');
  const repo = makeRepo(t, {
    config: {
      steps: [
        { id: 'a', run: stampStep(markerA, 2), level, lane: lanes.a },
        { id: 'b', run: stampStep(markerB, 2), level, lane: lanes.b },
      ],
    },
  });
  return { repo, markerA, markerB };
}

function assertOverlap(markerA: string, markerB: string, what: string) {
  const a = readStamps(markerA);
  const b = readStamps(markerB);
  assert.ok(Number.isFinite(a.end) && Number.isFinite(b.start), `${what}: both steps must have written start/end stamps`);
  assert.ok(b.start < a.end, `${what}: steps of different lanes must overlap (b started at ${b.start}, a ended at ${a.end})`);
}

function assertSequential(markerA: string, markerB: string, what: string) {
  const a = readStamps(markerA);
  const b = readStamps(markerB);
  assert.ok(Number.isFinite(a.end) && Number.isFinite(b.start), `${what}: both steps must have written start/end stamps`);
  assert.ok(b.start >= a.end, `${what}: steps must run one after another in config order (b started at ${b.start}, a ended at ${a.end})`);
}

/** CONTRACT §3.2.2: a step start line `▶ <id> [<lane>] (<dir>): <run>` (any lane name). */
function assertStartLines(stdout: string, ids: string[], what: string) {
  for (const id of ids) {
    assert.match(stdout, new RegExp(`^▶ ${id} \\[[^\\]]+\\] \\(\\.\\): `, 'm'), `${what}: stdout has the start line of step ${id} with its lane\n${stdout}`);
  }
}

// ---------------------------------------------------------------------------
// Different lanes run concurrently; the same lane runs in config order
// ---------------------------------------------------------------------------

test('ts_verify_ac5_different_lanes_overlap', (t) => {
  const { repo, markerA, markerB } = stampRepo(t, { a: 'a', b: 'b' });
  const r = verify(repo, ['push']);
  assertExit(r, 0, 'verify push with two lanes');
  assertOverlap(markerA, markerB, 'push');
  const summary = lastSummary(repo, 'push');
  assert.ok(summary.durationMs < 3500, `two concurrent 2 s steps must finish in < 3.5 s, got ${summary.durationMs} ms\n${describe(r)}`);
});

test('ts_verify_ac5_same_lane_runs_in_config_order', (t) => {
  const { repo, markerA, markerB } = stampRepo(t, { a: 'a', b: 'a' });
  const r = verify(repo, ['push']);
  assertExit(r, 0, 'verify push with one lane');
  assertSequential(markerA, markerB, 'push');
  const summary = lastSummary(repo, 'push');
  assert.ok(summary.durationMs >= 4000, `two sequential 2 s steps must take >= 4 s, got ${summary.durationMs} ms\n${describe(r)}`);
  assert.equal(findStep(summary, 'a').lane, 'a', 'summary step a names its lane');
  assert.equal(findStep(summary, 'b').lane, 'a', 'summary step b names its lane');
});

// ---------------------------------------------------------------------------
// --lanes 1 / VERIFY_LANES=1: sequential; any other value exits 2
// ---------------------------------------------------------------------------

test('ts_verify_ac5_lanes_1_option_runs_every_step_in_config_order', (t) => {
  const { repo, markerA, markerB } = stampRepo(t, { a: 'a', b: 'b' });
  const r = verify(repo, ['push', '--lanes', '1']);
  assertExit(r, 0, 'verify push --lanes 1');
  assertSequential(markerA, markerB, 'push --lanes 1');
  assertStartLines(r.stdout, ['a', 'b'], 'push --lanes 1');
  assert.ok(lastSummary(repo, 'push').durationMs >= 4000, `--lanes 1 must run the 2 s steps one after another\n${describe(r)}`);
});

test('ts_verify_ac5_verify_lanes_env_1_runs_every_step_in_config_order', (t) => {
  const { repo, markerA, markerB } = stampRepo(t, { a: 'a', b: 'b' });
  const r = verify(repo, ['push'], { env: { VERIFY_LANES: '1' } });
  assertExit(r, 0, 'VERIFY_LANES=1 verify push');
  assertSequential(markerA, markerB, 'VERIFY_LANES=1');
  assertStartLines(r.stdout, ['a', 'b'], 'VERIFY_LANES=1');
  assert.ok(lastSummary(repo, 'push').durationMs >= 4000, `VERIFY_LANES=1 must run the 2 s steps one after another\n${describe(r)}`);
});

test('ts_verify_ac5_lanes_other_than_1_exit_2', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const marker = path.join(out, 'ran');
  const repo = makeRepo(t, { config: { steps: [{ id: 's', run: markStep(marker), level: 'push', lane: 'x' }] } });
  assertExit(verify(repo, ['push', '--lanes', '2']), 2, 'verify push --lanes 2');
  assertExit(verify(repo, ['push'], { env: { VERIFY_LANES: '2' } }), 2, 'VERIFY_LANES=2 verify push');
  assertExit(verify(repo, ['push', '--lanes', '0']), 2, 'verify push --lanes 0');
  assertExit(verify(repo, ['push'], { env: { VERIFY_LANES: 'all' } }), 2, 'VERIFY_LANES=all verify push');
  assertExit(verify(repo, ['nightly', '--lanes', '2']), 2, 'verify nightly --lanes 2');
});

// ---------------------------------------------------------------------------
// Summary: config order, own durations, lane per step
// ---------------------------------------------------------------------------

test('ts_verify_ac5_summary_keeps_config_order_and_per_step_durations', (t) => {
  const repo = makeRepo(t, {
    config: {
      steps: [
        { id: 'b', run: 'sleep 1', level: 'push', lane: 'y' },
        { id: 'a', run: 'true', level: 'push', lane: 'x' },
      ],
    },
  });
  const r = verify(repo, ['push']);
  assertExit(r, 0, 'verify push');
  const summary = lastSummary(repo, 'push');
  assert.deepEqual(summary.steps.map((s: any) => s.id), ['b', 'a'], 'steps stay in config order regardless of lanes');
  const a = findStep(summary, 'a');
  const b = findStep(summary, 'b');
  assert.ok(typeof a.durationMs === 'number' && typeof b.durationMs === 'number', 'each step has a numeric durationMs');
  assert.ok(a.durationMs < b.durationMs, `a (no sleep) must be faster than b (sleep 1): ${a.durationMs} vs ${b.durationMs}`);
  assert.ok(b.durationMs >= 900, `b slept 1 s, so its own duration is >= 900 ms, got ${b.durationMs}`);
  assert.equal(a.lane, 'x', 'step a records its lane');
  assert.equal(b.lane, 'y', 'step b records its lane');
});

// ---------------------------------------------------------------------------
// Output: one contiguous block per step
// ---------------------------------------------------------------------------

test('ts_verify_ac5_output_of_each_step_is_one_contiguous_block', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const markerA = path.join(out, 'a');
  const markerB = path.join(out, 'b');
  const repo = makeRepo(t, {
    config: {
      steps: [
        { id: 'a', run: `echo A1; ${stampStep(markerA, 1)}; echo A2`, level: 'push', lane: 'a' },
        { id: 'b', run: `echo B1; ${stampStep(markerB, 1)}; echo B2`, level: 'push', lane: 'b' },
      ],
    },
  });
  const r = verify(repo, ['push']);
  assertExit(r, 0, 'verify push');
  assertOverlap(markerA, markerB, 'push');
  const lines = r.stdout.split('\n');
  const idx = (needle: string) => {
    const i = lines.findIndex((l) => l.includes(needle));
    assert.ok(i >= 0, `stdout must contain a line with ${needle}\n${describe(r)}`);
    return i;
  };
  const a1 = idx('A1');
  const a2 = idx('A2');
  const b1 = idx('B1');
  const b2 = idx('B2');
  assert.ok(a1 < a2 && b1 < b2, `each step's output keeps its order\n${describe(r)}`);
  const between = (lo: number, hi: number, needles: string[]) =>
    lines.slice(lo + 1, hi).filter((l) => needles.some((n) => l.includes(n)));
  assert.deepEqual(between(a1, a2, ['B1', 'B2']), [], `no line of step b between A1 and A2\n${describe(r)}`);
  assert.deepEqual(between(b1, b2, ['A1', 'A2']), [], `no line of step a between B1 and B2\n${describe(r)}`);
});

// ---------------------------------------------------------------------------
// A failure ends neither its lane nor the gate
// ---------------------------------------------------------------------------

test('ts_verify_ac5_all_lane_steps_run_after_a_failure', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const afterA = path.join(out, 'after-a');
  const inB = path.join(out, 'in-b');
  const repo = makeRepo(t, {
    config: {
      steps: [
        { id: 'fails', run: 'echo failing; exit 1', level: 'push', lane: 'a' },
        { id: 'after-in-a', run: markStep(afterA), level: 'push', lane: 'a' },
        { id: 'in-b', run: markStep(inB), level: 'push', lane: 'b' },
      ],
    },
  });
  const r = verify(repo, ['push']);
  assertExit(r, 1, 'verify push with a failing step');
  assert.ok(fs.existsSync(afterA), `the step after the failure in lane a still ran\n${describe(r)}`);
  assert.ok(fs.existsSync(inB), `the step in lane b still ran\n${describe(r)}`);
  const summary = lastSummary(repo, 'push');
  assert.deepEqual(
    summary.steps.map((s: any) => [s.id, s.result, s.lane]),
    [['fails', 'fail', 'a'], ['after-in-a', 'pass', 'a'], ['in-b', 'pass', 'b']],
    'summary lists all three steps with their results and lanes',
  );
  assert.equal(summary.result, 'fail');
});

// ---------------------------------------------------------------------------
// The commit gate ignores lanes
// ---------------------------------------------------------------------------

test('ts_verify_ac5_commit_gate_ignores_lanes', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const markerA = path.join(out, 'a');
  const markerB = path.join(out, 'b');
  const repo = makeRepo(t, {
    config: {
      steps: [
        { id: 'a', run: stampStep(markerA, 1), level: 'commit', lane: 'a' },
        { id: 'b', run: stampStep(markerB, 1), level: 'commit', lane: 'b' },
      ],
    },
  });
  // Tree gates use the lanes: the two commit-level steps overlap under push.
  const push = verify(repo, ['push']);
  assertExit(push, 0, 'verify push');
  assertOverlap(markerA, markerB, 'push');
  // The commit gate runs them in config order, one after another.
  fs.rmSync(markerA);
  fs.rmSync(markerB);
  writeFiles(repo, { 'src/change.txt': 'změna\n' });
  git(repo, ['add', '-A']);
  const commit = verify(repo, ['commit']);
  assertExit(commit, 0, 'verify commit');
  assertSequential(markerA, markerB, 'commit');
  const summary = lastSummary(repo, 'commit');
  assert.deepEqual(summary.steps.map((s: any) => s.id), ['a', 'b'], 'commit summary keeps config order');
  assert.ok(summary.durationMs >= 2000, `the commit gate runs the two 1 s steps one after another, got ${summary.durationMs} ms\n${describe(commit)}`);
});
