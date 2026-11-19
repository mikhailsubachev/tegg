// TS-VERIFY AC-10: step timeout (D-1832). Black box against tools/qa/CONTRACT.md §2 (`timeout`), §3.2.4, §3.4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertExit, countLines, describe, findStep, lastSummary, makeRepo, markStep, output, sq, tmpDir, verify,
  type RunResult, type Step,
} from './helpers.ts';
import { isAlive, killQuietly } from './gate-lock-helpers.ts';

/** How long a `verify` run of these tests may take before the test gives up on it (the slow steps sleep 30 s). */
const GIVE_UP_MS = 15_000;

type Timed = { r: RunResult; elapsedMs: number };

function timed(repo: string, args: string[], giveUpMs = GIVE_UP_MS): Timed {
  const started = Date.now();
  const r = verify(repo, args, { timeout: giveUpMs });
  return { r, elapsedMs: Date.now() - started };
}

/** Pids written (one per line) by a step into `file`; they are killed when the test ends, whatever happened. */
function pidsOf(t: any, file: string): () => number[] {
  const read = () =>
    (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').split('\n').map((l) => Number(l.trim())).filter((n) => Number.isInteger(n) && n > 0);
  t.after(() => read().forEach((pid) => killQuietly(pid)));
  return read;
}

/** The stdout line that reports the timeout of step `id` (CONTRACT §3.2.4: contains `timed out`, the id and the limit). */
function timedOutLine(r: RunResult, id: string): string | undefined {
  return r.stdout.split('\n').find((l) => l.includes('timed out') && l.includes(id));
}

function assertTimedOut(repo: string, gate: string, id: string, limit: number, run: Timed): void {
  const step = findStep(lastSummary(repo, gate), id);
  assert.equal(step.result, 'fail', `a step stopped by its timeout is reported fail\n${describe(run.r)}`);
  assert.equal(step.timedOut, true, `the summary entry of ${id} has timedOut: true, got ${JSON.stringify(step)}`);
  const line = timedOutLine(run.r, id);
  assert.ok(line, `stdout has a line containing "timed out" and the step id ${id}\n${describe(run.r)}`);
  assert.match(line, new RegExp(`(^|[^0-9.])${limit}([^0-9.]|$)`), `the timed-out line names the limit of ${limit} s: ${line}`);
}

// ---------------------------------------------------------------------------
// A step over its timeout is stopped and reported
// ---------------------------------------------------------------------------

test('ts_verify_ac10_step_over_its_timeout_is_stopped_and_reported_failed', (t) => {
  const repo = makeRepo(t, { config: { steps: [{ id: 'pomalý-krok', run: 'echo začátek; sleep 30', level: 'push', timeout: 1 }] } });
  const run = timed(repo, ['push']);
  assertExit(run.r, 1, 'verify push with a step that sleeps 30 s under a 1 s timeout');
  assert.ok(run.elapsedMs < 10_000, `the gate returns soon after the 1 s timeout, not after 30 s; took ${run.elapsedMs} ms`);
  assertTimedOut(repo, 'push', 'pomalý-krok', 1, run);
  const summary = lastSummary(repo, 'push');
  assert.equal(summary.result, 'fail', 'the gate fails');
  const step = findStep(summary, 'pomalý-krok');
  assert.ok(step.durationMs >= 900 && step.durationMs < 9_000, `the step ran for about its timeout, got ${step.durationMs} ms`);
  assert.ok(run.r.stdout.includes('začátek'), `the output the step wrote before it was stopped is kept\n${describe(run.r)}`);
});

test('ts_verify_ac10_timeout_stops_every_process_the_step_started', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const pidFile = path.join(out, 'pids');
  const late = path.join(out, 'late');
  const pids = pidsOf(t, pidFile);
  // The step starts two children in the background (one of them through another shell) and waits for a third.
  const run = [
    `sleep 31 & echo $! >> ${sq(pidFile)}`,
    `sh -c ${sq(`sleep 32 & echo $! >> ${sq(pidFile)}; wait`)} & echo $! >> ${sq(pidFile)}`,
    `(sleep 3; echo pozdě > ${sq(late)}) &`,
    'sleep 30',
  ].join('\n');
  const repo = makeRepo(t, { config: { steps: [{ id: 'rodina', run, level: 'push', timeout: 1 }] } });
  const result = timed(repo, ['push']);
  assertExit(result.r, 1, 'verify push with a step that starts children and outlives its timeout');
  assertTimedOut(repo, 'push', 'rodina', 1, result);
  const started = pids();
  assert.equal(started.length, 3, `the step recorded the pids of its three children, got ${JSON.stringify(started)}`);
  for (const pid of started) {
    assert.equal(isAlive(pid), false, `process ${pid} started by the step is gone when the gate returns`);
  }
  // The background subshell would have written this file 3 s after the step started.
  const until = Date.now() + 4_000;
  while (Date.now() < until && !fs.existsSync(late)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  assert.equal(fs.existsSync(late), false, 'a background child of the stopped step never gets to finish its work');
});

test('ts_verify_ac10_step_ignoring_sigterm_is_killed_after_the_grace_period', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const pidFile = path.join(out, 'pids');
  const pids = pidsOf(t, pidFile);
  // SIGTERM is ignored by the shell and (inherited) by its child, so only SIGKILL ends them.
  const run = `trap '' TERM; sleep 60 & echo $! >> ${sq(pidFile)}; wait`;
  const repo = makeRepo(t, { config: { steps: [{ id: 'tvrdohlavý', run, level: 'push', timeout: 1 }] } });
  const result = timed(repo, ['push'], 25_000);
  assertExit(result.r, 1, 'verify push with a step that ignores SIGTERM under a 1 s timeout');
  assert.ok(result.elapsedMs >= 10_000, `SIGKILL comes only 10 s after SIGTERM; the gate took ${result.elapsedMs} ms`);
  assert.ok(result.elapsedMs < 22_000, `the gate returns once the group is killed (about 11 s), took ${result.elapsedMs} ms`);
  assertTimedOut(repo, 'push', 'tvrdohlavý', 1, result);
  const started = pids();
  assert.equal(started.length, 1, 'the step recorded its child\'s pid');
  assert.equal(isAlive(started[0]), false, 'the child that ignored SIGTERM is gone when the gate returns');
});

// ---------------------------------------------------------------------------
// The lane goes on; other steps aren't affected
// ---------------------------------------------------------------------------

test('ts_verify_ac10_lane_goes_on_with_its_next_step_after_a_timeout', (t) => {
  const out = tmpDir(t, 'tegg-qa-out-');
  const next = path.join(out, 'next');
  const other = path.join(out, 'other');
  const repo = makeRepo(t, {
    config: {
      steps: [
        { id: 'zaseknutý', run: 'sleep 30', level: 'push', lane: 'a', timeout: 1 },
        { id: 'další', run: markStep(next), level: 'push', lane: 'a' },
        { id: 'vedlejší', run: markStep(other), level: 'push', lane: 'b' },
      ],
    },
  });
  const run = timed(repo, ['push']);
  assertExit(run.r, 1, 'verify push with a timed-out step followed by another step of its lane');
  assertTimedOut(repo, 'push', 'zaseknutý', 1, run);
  assert.equal(countLines(next), 1, `the lane's next step runs after the timeout\n${describe(run.r)}`);
  assert.equal(countLines(other), 1, 'the other lane\'s step runs');
  const summary = lastSummary(repo, 'push');
  assert.deepEqual(summary.steps.map((s: any) => [s.id, s.result]), [['zaseknutý', 'fail'], ['další', 'pass'], ['vedlejší', 'pass']]);
  for (const id of ['další', 'vedlejší']) {
    assert.notEqual(findStep(summary, id).timedOut, true, `${id} did not time out`);
    assert.equal(timedOutLine(run.r, id), undefined, `stdout has no timed-out line for ${id}`);
  }
  // The same with --lanes 1: every step still runs in config order.
  const sequential = timed(repo, ['push', '--lanes', '1']);
  assertExit(sequential.r, 1, 'verify push --lanes 1 with a timed-out step');
  assert.equal(countLines(next), 2, `with --lanes 1 the next step runs after the timeout too\n${describe(sequential.r)}`);
  assert.equal(countLines(other), 2);
  assertTimedOut(repo, 'push', 'zaseknutý', 1, sequential);
});

test('ts_verify_ac10_step_ending_in_time_and_step_without_timeout_are_not_affected', (t) => {
  const repo = makeRepo(t, {
    config: {
      steps: [
        { id: 'včas', run: 'sleep 1; echo hotovo-včas', level: 'push', lane: 'a', timeout: 20 },
        { id: 'bez-limitu', run: 'sleep 3; echo hotovo-bez-limitu', level: 'push', lane: 'b' },
        { id: 'přes-limit', run: 'sleep 30', level: 'push', lane: 'c', timeout: 1 },
      ],
    },
  });
  const run = timed(repo, ['push']);
  assertExit(run.r, 1, 'verify push: one step over its limit, one within it, one without a limit');
  assertTimedOut(repo, 'push', 'přes-limit', 1, run);
  const summary = lastSummary(repo, 'push');
  for (const id of ['včas', 'bez-limitu']) {
    const step = findStep(summary, id);
    assert.equal(step.result, 'pass', `${id} passes\n${describe(run.r)}`);
    assert.notEqual(step.timedOut, true, `${id} has no timedOut: true`);
    assert.equal(timedOutLine(run.r, id), undefined, `stdout has no timed-out line for ${id}`);
    assert.ok(run.r.stdout.includes(`hotovo-${id}`), `${id} ran to its end\n${describe(run.r)}`);
  }
  // Another step's 1 s limit is not a limit for the step without `timeout`, which runs for 3 s.
  assert.ok(findStep(summary, 'bez-limitu').durationMs >= 2_900, 'the step without timeout ran its full 3 s');
});

// ---------------------------------------------------------------------------
// Which gates, and bad values
// ---------------------------------------------------------------------------

test('ts_verify_ac10_commit_gate_ignores_timeout_and_push_gate_applies_it', (t) => {
  const marker = path.join(tmpDir(t, 'tegg-qa-out-'), 'ends');
  const repo = makeRepo(t, {
    config: { steps: [{ id: 'krok', run: `sleep 3; echo end >> ${sq(marker)}`, level: 'commit', timeout: 1 }] },
  });
  const commit = timed(repo, ['commit']);
  assertExit(commit.r, 0, 'verify commit with a 3 s step under a 1 s timeout');
  assert.equal(countLines(marker), 1, 'the commit gate lets the step run to its end');
  const inCommit = findStep(lastSummary(repo, 'commit'), 'krok');
  assert.equal(inCommit.result, 'pass');
  assert.notEqual(inCommit.timedOut, true, 'the commit gate never reports timedOut');
  // The same step in a tree gate is stopped.
  const push = timed(repo, ['push']);
  assertExit(push.r, 1, 'verify push with the same step');
  assertTimedOut(repo, 'push', 'krok', 1, push);
  assert.equal(countLines(marker), 1, 'the push gate stopped the step before its end');
});

test('ts_verify_ac10_nightly_gate_stops_a_step_over_its_timeout', (t) => {
  const marker = path.join(tmpDir(t, 'tegg-qa-out-'), 'next');
  const repo = makeRepo(t, {
    config: {
      steps: [
        { id: 'noční', run: 'sleep 30', level: 'nightly', timeout: 1 },
        { id: 'potom', run: markStep(marker), level: 'nightly' },
      ],
    },
  });
  const run = timed(repo, ['nightly']);
  assertExit(run.r, 1, 'verify nightly with a step that sleeps 30 s under a 1 s timeout');
  assert.ok(run.elapsedMs < 10_000, `the nightly gate returns soon after the timeout; took ${run.elapsedMs} ms`);
  assertTimedOut(repo, 'nightly', 'noční', 1, run);
  assert.equal(countLines(marker), 1, 'the next step of the lane runs in the nightly gate too');
});

test('ts_verify_ac10_timeout_that_is_not_a_positive_number_exits_2', (t) => {
  const marker = path.join(tmpDir(t, 'tegg-qa-out-'), 'ran');
  const bad: unknown[] = [0, -5, '10', true, [3], { seconds: 3 }];
  for (const value of bad) {
    const step = { id: 'krok', run: markStep(marker), level: 'push', timeout: value } as unknown as Step;
    const repo = makeRepo(t, { config: { steps: [step] } });
    const r = verify(repo, ['push'], { timeout: GIVE_UP_MS });
    assertExit(r, 2, `verify push with "timeout": ${JSON.stringify(value)}`);
    assert.match(output(r), /timeout/, `the error names the bad field\n${describe(r)}`);
    assert.match(r.stderr, /\S/, 'the configuration error goes to stderr');
    assert.equal(fs.existsSync(marker), false, 'no step runs with an invalid configuration');
  }
  // A positive number, also a fraction, is accepted.
  const ok = makeRepo(t, { config: { steps: [{ id: 'krok', run: markStep(marker), level: 'push', timeout: 2.5 }] } });
  assertExit(verify(ok, ['push'], { timeout: GIVE_UP_MS }), 0, 'verify push with "timeout": 2.5');
  assert.equal(countLines(marker), 1, 'the step runs');
});
