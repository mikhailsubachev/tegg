// NFR-PERF-10 AC-2…AC-5 (docs/acceptance/capture.md; capture window open time; AC-1 is performance.md), FR-CAP-03 AC-5
// (the timing criteria are NFR-PERF-10's) and FR-INB-01 AC-10 (docs/acceptance/inbox.md; the Inbox with 1,000
// unreviewed items): benchmarks on the built test app (L6), in the `app-perf` step (milestone gate, D-343). Each p95
// is reported; the D-59 targets (225 ms = 75 % of 300 ms; AC-4 300 ms) are enforced only with TEGG_PERF_REF=1 on the
// reference machine (D-152); FR-INB-01 AC-10 only from MS8 (as D-488). Interface: docs/contracts/ms5-capture.md §8
// (`capture-ready` mark, `route-ready:inbox`), §1.5 (TEGG_TEST_LAUNCHED_AT_LOGIN: the main window starts hidden).
// Written from the ACs and the contract only (D-61). Helpers: perf_capture.ts, perf_inbox.ts.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activateFinder, appiumDown, captureOpen, end, hotkey, inboxCopy, press, ready, readyMarks, sleep, support, waitFor } from './helpers/capture.ts';
import { EXE, measure, p, referenceVault, startHidden, summary } from './perf_capture.ts';
import { inboxVault, oneRun, unreviewedCount } from './perf_inbox.ts';

after(appiumDown);
const RUNS = 20;
const enforce = process.env.TEGG_PERF_REF === '1';
const TARGET = 225;

async function triggerBench(name: string, trigger: 'status-item' | 'task', vaultOf: (base: string) => string | null) {
  assert.ok(existsSync(EXE), `app not built: ${EXE} (cd app && npm run app:build)`);
  await ready();
  const base = mkdtempSync(join(tmpdir(), `tegg-${name}-`));
  try {
    const vault = vaultOf(base);
    assert.ok(vault, 'the vault could be prepared');
    const s = await startHidden(vault!, base);
    assert.ok(s, 'the app started with its main window hidden (TEGG_TEST_LAUNCHED_AT_LOGIN, §1.5)');
    try {
      await measure(s!.d, s!.log, trigger, 2); // warm-up
      const r = await measure(s!.d, s!.log, trigger, RUNS);
      assert.equal(r.internal.length, RUNS, `a capture-ready mark per open (${r.internal.length} of ${RUNS})`);
      const sum = summary(`${name} ${trigger}`, r);
      console.log(JSON.stringify(sum));
      if (enforce) assert.ok(p(r.internal, 0.95) <= TARGET, `${trigger}: p95 ${p(r.internal, 0.95)} ms > ${TARGET} ms (D-59)`);
      return sum;
    } finally { await end(s!.d); }
  } finally { rmSync(base, { recursive: true, force: true }); }
}

test('nfr_perf_10_ac2_status_item_to_capture_ready_p95', { timeout: 30 * 60_000 }, async () => {
  await triggerBench('NFR-PERF-10 AC-2', 'status-item', (b) => inboxCopy(b));
});

test('nfr_perf_10_ac3_new_task_hotkey_to_capture_ready_p95', { timeout: 30 * 60_000 }, async () => {
  await triggerBench('NFR-PERF-10 AC-3', 'task', (b) => inboxCopy(b));
});

test('nfr_perf_10_ac4_after_ten_idle_minutes', { timeout: 30 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE}`);
  await ready();
  const base = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-10-ac4-'));
  try {
    const s = await startHidden(inboxCopy(base), base);
    assert.ok(s, 'the app started with its main window hidden');
    try {
      await sleep(Number(process.env.TEGG_IDLE_MS ?? 10 * 60_000)); // App Nap allowed
      await activateFinder();
      const seen = readyMarks(s!.log).length;
      hotkey('quick');
      assert.ok(await waitFor(() => captureOpen(s!.d), 3000), 'the capture window opens after idling');
      await waitFor(() => readyMarks(s!.log).length > seen, 3000);
      const ms = readyMarks(s!.log)[seen]?.ms;
      assert.equal(typeof ms, 'number', 'a capture-ready mark');
      console.log(JSON.stringify({ benchmark: 'NFR-PERF-10 AC-4 after idling', internal_ms: ms, targetMs: 300 }));
      if (enforce) assert.ok((ms as number) <= 300, `after idling: ${ms} ms > 300 ms`);
      press('escape');
    } finally { await end(s!.d); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('nfr_perf_10_ac5_with_the_reference_vault', { timeout: 60 * 60_000 }, async () => {
  const a = await triggerBench('NFR-PERF-10 AC-5', 'status-item', (b) => referenceVault(b));
  assert.ok(a.internal_p95_ms !== null && a.external_p95_ms !== null, 'internal (capture-ready) and external (accessibility) p95 are reported');
});

test('fr_cap_03_ac5_each_open_writes_a_capture_ready_mark_with_trigger_kind_and_ms', { timeout: 10 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE}`);
  await ready();
  const base = mkdtempSync(join(tmpdir(), 'tegg-fr-cap-03-ac5-'));
  try {
    const s = await startHidden(inboxCopy(base), base);
    assert.ok(s, 'started');
    try {
      for (const k of ['quick', 'task'] as const) {
        await activateFinder();
        hotkey(k);
        await waitFor(() => captureOpen(s!.d), 3000);
        press('escape');
        await sleep(500);
      }
      const m = readyMarks(s!.log);
      assert.deepEqual(m.map((x) => [x.trigger, x.kind, typeof x.ms]), [['hotkey', 'default', 'number'], ['hotkey', 'task', 'number']], 'one mark per open (§8)');
    } finally { await end(s!.d); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('fr_inb_01_ac10_the_inbox_with_1000_unreviewed_items', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} (cd app && npm run app:build)`);
  await ready();
  const base = mkdtempSync(join(tmpdir(), 'tegg-fr-inb-01-ac10-'));
  try {
    const vault = inboxVault(base);
    assert.ok(vault, 'reference vault with 1,000 unreviewed Quick Notes');
    assert.ok(unreviewedCount(vault!) >= 1000, '1,000 unreviewed');
    const sup = support(base);
    const warm = await oneRun(vault!, sup, join(base, 'warm.jsonl'), 240_000);
    assert.ok(warm !== null, 'warm-up: route-ready:inbox');
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const ms = await oneRun(vault!, sup, join(base, `run-${i}.jsonl`));
      assert.ok(ms !== null && ms >= 0, `run ${i}: route-ready:inbox after ui-ready`);
      samples.push(ms!);
    }
    const p95 = p(samples, 0.95);
    console.log(`FR-INB-01 AC-10 route-ready:inbox with 1,000 unreviewed: p95 ${p95.toFixed(1)} ms (${RUNS} runs)`);
    const ms8 = enforce && (process.env.VERIFY_MILESTONE === 'MS8' || process.env.VERIFY_GATE === 'release');
    if (ms8) assert.ok(p95 <= TARGET, `p95 ${p95.toFixed(1)} ms > ${TARGET} ms`);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
