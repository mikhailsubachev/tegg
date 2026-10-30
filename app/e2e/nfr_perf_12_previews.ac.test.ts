// NFR-PERF-12 / FR-LNK-11 AC-1 (docs/acceptance/previews.md, AP-822 / D-940; docs/contracts/v1-previews.md §8): on the
// reference machine and vault, from the click (pointer-up, mark `preview-click`) on a link chip to the 5,000-word
// benchmark note, to the mark `preview-ready` (header, strip and the first screen of the body painted), p95 of 20 runs
// is under 75 ms (75 % of 100 ms, D-59). Benchmark: perf_previews.ts. Runs in the `app-perf` step with the other
// benchmarks (outside the push run); report-only until the v1.0 release gate (D-152 rule), enforced there with
// TEGG_PERF_REF=1 on the reference machine (VERIFY_GATE=release). Every run must still reach both marks (they are part
// of the slice P contract), so the test is red until they exist. Written from the AC and the contract only (D-61).
// FR-LNK-10 AC-14 (AP-816 / D-934), L6 benchmark for the timing: the same measurement on a temporary copy of the synthetic
// previews fixture plus its runtime note `Pages/Dlouhá.md` (3,000 paragraphs, 30 headings, fixture README), whose
// preview shows `Odstavec 1.` and reaches `preview-ready` within the FR-LNK-11 AC-1 budget (same report-only rule).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { CLICK, EXE, LABEL, READY, generateVault, longestNote, oneRun, p95, removeHost, startOnHost, writeHost } from './perf_previews.ts';
import { FX, appiumDown, clickable, end, firstShown, marksOf, press, shown, sleep, type Driver } from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const RUNS = 20;
const TARGET_MS = 75;
const enforce = process.env.TEGG_PERF_REF === '1' && process.env.VERIFY_GATE === 'release';

test('fr_lnk_11_ac1_preview_ready_within_75_ms_of_pointer_up_p95_on_the_reference_vault', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-nfr-perf-12-'));
  const vault = process.env.TEGG_REF_VAULT ?? generateVault(join(tmp, 'vault'));
  let d: Driver | undefined;
  try {
    assert.ok(vault, 'reference vault with --perf-note could not be generated');
    const target = longestNote(vault!);
    const words = target.text.replace(/^---\n[\s\S]*?\n---\n/, '').split(/\s+/).filter(Boolean).length;
    assert.ok(words >= 5000, `the benchmark note has ${words} words (want ≥ 5,000)`);
    writeHost(vault!, target.path);
    const s = await startOnHost(vault!, tmp);
    assert.ok(s, 'the host note with the chip "Benchmark cíl" opened');
    d = s!.d;
    const warm = await oneRun(d, s!.log, 30_000);
    assert.ok(warm !== null, `warm-up reached ${READY} after ${CLICK}`);
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t = await oneRun(d, s!.log);
      assert.ok(t !== null && t >= 0, `run ${i}: ${READY} after ${CLICK}`);
      times.push(t!);
    }
    const p = p95(times);
    console.log(`NFR-PERF-12 / FR-LNK-11 AC-1: ${READY} p95 ${p.toFixed(1)} ms after ${CLICK} (${RUNS} runs; target < ${TARGET_MS} ms)`);
    if (enforce) assert.ok(p < TARGET_MS, `${READY} p95 ${p.toFixed(1)} ms ≥ ${TARGET_MS} ms`);
    else console.log('NFR-PERF-12: reported only (D-152 rule; enforced with TEGG_PERF_REF=1 at the v1.0 release gate)');
  } finally {
    await end(d);
    if (vault && process.env.TEGG_REF_VAULT) removeHost(vault);
    rmSync(tmp, { recursive: true, force: true });
  }
});

/** `Pages/Dlouhá.md` as tests/fixtures/vaults/previews/README.md builds it at runtime (FR-LNK-10 AC-14). */
function dlouhaText(): string {
  const blocks: string[] = [];
  for (let n = 1; n <= 3000; n++) {
    if ((n - 1) % 100 === 0) blocks.push(`## Kapitola ${(n - 1) / 100 + 1}`);
    blocks.push(`Odstavec ${n}.`);
  }
  return `---\nid: 01JBPV0000000000000000P030\ntype: page\ntitle: Dlouhá\n---\n${blocks.join('\n\n')}\n`;
}
/** A temp copy of the synthetic previews fixture (without README.md) plus new-empty/.tegg and `Pages/Dlouhá.md`. */
function longVault(base: string): string {
  const v = join(base, 'Náhledy');
  const src = join(FX, 'previews');
  cpSync(src, v, { recursive: true, filter: (p) => relative(src, p) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  writeFileSync(join(v, 'Pages/Dlouhá.md'), dlouhaText());
  return v;
}

test('fr_lnk_10_ac14_long_body_preview_ready_within_the_budget', { timeout: 30 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-fr-lnk-10-ac14-'));
  let d: Driver | undefined;
  try {
    const vault = longVault(tmp);
    writeHost(vault, 'Pages/Dlouhá.md');
    const s = await startOnHost(vault, tmp);
    assert.ok(s, 'the host note with the chip "Benchmark cíl" opened');
    d = s!.d;
    // First open: the preview of Dlouhá shows its first paragraph once `preview-ready` is marked.
    const n = marksOf(s!.log).length;
    const chip = await firstShown(d, LABEL);
    assert.ok(chip, `the chip "${LABEL}" is shown`);
    await clickable(d, chip).click();
    const endAt = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < endAt && !ready) {
      const m = marksOf(s!.log).slice(n);
      const click = m.find((x) => x.mark === CLICK)?.ms;
      ready = click !== undefined && m.some((x) => x.mark === READY && (x.ms ?? -1) >= click);
      if (!ready) await sleep(25);
    }
    assert.ok(ready, `first open: ${READY} after ${CLICK}`);
    assert.equal(await shown(d, 'Preview: Dlouhá', 3000), true, 'the popover "Preview: Dlouhá" is shown');
    assert.equal(await shown(d, 'Odstavec 1.', 3000), true, 'the preview shows the first paragraph "Odstavec 1."');
    press('escape');
    await sleep(700);
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t = await oneRun(d, s!.log);
      assert.ok(t !== null && t >= 0, `run ${i}: ${READY} after ${CLICK} for Dlouhá`);
      times.push(t!);
    }
    const p = p95(times);
    console.log(`FR-LNK-10 AC-14: Dlouhá (3,030 blocks) ${READY} p95 ${p.toFixed(1)} ms after ${CLICK} (${RUNS} runs; target < ${TARGET_MS} ms)`);
    if (enforce) assert.ok(p < TARGET_MS, `Dlouhá ${READY} p95 ${p.toFixed(1)} ms ≥ ${TARGET_MS} ms`);
    else console.log('FR-LNK-10 AC-14: reported only (D-152 rule; enforced with TEGG_PERF_REF=1 at the v1.0 release gate)');
  } finally {
    await end(d);
    rmSync(tmp, { recursive: true, force: true });
  }
});
