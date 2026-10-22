// NFR-PERF-10 AC-2…AC-5 benchmark (docs/acceptance/capture.md; docs/contracts/ms5-capture.md §8; D-59, D-152): the
// capture window opening on the built test app with the main window closed (launched as a login item,
// TEGG_TEST_LAUNCHED_AT_LOGIN=1, so `main` starts hidden, §1.5). Per run: Finder frontmost, the trigger (status-item
// click through Appium, or ⌃⌥Space / ⌃⌥T posted by System Events), then
//   internal = the `capture-ready` mark's `ms` (the shell's t0 → `capture_ready(seq)`, §8), and
//   external = trigger posted → the `Quick Capture` window reported by accessibility (an upper bound, as S3),
// then Esc. p50/p95 per trigger. Target from D-59: p95 ≤ 225 ms (75 % of 300 ms), enforced only with TEGG_PERF_REF=1
// (nfr_perf_10.ac.test.ts). Never touches the owner's data (D-62).
// Run: `node e2e/perf_capture.ts [--runs 20] [--reference] [--out file.json]` after `npm run app:build`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXE, REPO, activateFinder, appiumDown, captureOpen, end, hotkey, inboxCopy, press, readyMarks, session, sleep, statusItem, support, testEnv,
  waitFor, waitMark, type Driver,
} from './helpers/capture.ts';

export { EXE };
export type Trigger = 'status-item' | 'quick' | 'task';
export type Samples = { internal: number[]; external: number[] };

export function p(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(q * s.length) - 1)];
}

/** The generated reference vault (`tools/gen-vault --seed 1 --small-images`) in `base/ref`, or null. */
export function referenceVault(base: string): string | null {
  const out = join(base, 'ref');
  try {
    execFileSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'), '--', '--seed', '1', '--small-images', '--out', out], { stdio: 'ignore' });
  } catch {
    return null;
  }
  return existsSync(join(out, '.tegg/vault.yml')) ? out : null;
}

/** Starts the app with its main window hidden on `vault` and waits for the vault to be ready. */
export async function startHidden(vault: string, base: string): Promise<{ d: Driver; log: string } | null> {
  const log = join(base, `perf-${Date.now()}.jsonl`);
  const d = await session(testEnv(support(base, { name: `support-${Date.now()}` }), log, { TEGG_VAULT: vault, TEGG_TEST_LAUNCHED_AT_LOGIN: '1' }));
  if (!(await waitMark(log, 'ui-ready', 120_000))) { await end(d); return null; }
  await sleep(1500);
  return { d, log };
}

/** `runs` opens by `trigger`; one internal and one external sample each (missing marks are left out). */
export async function measure(d: Driver, log: string, trigger: Trigger, runs: number): Promise<Samples> {
  const out: Samples = { internal: [], external: [] };
  for (let i = 0; i < runs; i++) {
    await activateFinder();
    const seen = readyMarks(log).length;
    const t0 = performance.now();
    if (trigger === 'status-item') {
      const item = await statusItem(d);
      if (!item) break;
      await item.click();
    } else hotkey(trigger);
    if (await waitFor(() => captureOpen(d), 3000)) out.external.push(performance.now() - t0);
    await waitFor(() => readyMarks(log).length > seen, 3000);
    const m = readyMarks(log)[seen];
    if (m && typeof m.ms === 'number') out.internal.push(m.ms);
    press('escape');
    await waitFor(async () => !(await captureOpen(d)), 2000);
    await sleep(200);
  }
  return out;
}

export function summary(name: string, s: Samples) {
  return {
    benchmark: name, runs: Math.max(s.internal.length, s.external.length),
    internal_p50_ms: s.internal.length ? p(s.internal, 0.5) : null, internal_p95_ms: s.internal.length ? p(s.internal, 0.95) : null,
    external_p95_ms: s.external.length ? Math.round(p(s.external, 0.95)) : null, targetMs: 225,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const runs = Number(args[args.indexOf('--runs') + 1] || 20) || 20;
  const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  if (!existsSync(EXE)) throw new Error(`app not built: ${EXE}`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-perf-capture-'));
  try {
    const vault = args.includes('--reference') ? referenceVault(base) : inboxCopy(base);
    if (!vault) throw new Error('reference vault could not be generated');
    const s = await startHidden(vault, base);
    if (!s) throw new Error('the app did not start');
    const report = [];
    for (const t of ['status-item', 'quick', 'task'] as Trigger[]) report.push(summary(`NFR-PERF-10 ${t}`, await measure(s.d, s.log, t, runs)));
    await end(s.d);
    console.log(JSON.stringify(report, null, 2));
    if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 2));
  } finally {
    appiumDown();
    rmSync(base, { recursive: true, force: true });
  }
}
if (import.meta.url === `file://${process.argv[1]}`) void main();
