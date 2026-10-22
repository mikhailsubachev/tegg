// FR-INB-01 AC-10 benchmark (docs/acceptance/inbox.md; docs/contracts/ms5-capture.md §7.4, §8; D-152, as D-488): the
// Inbox on the generated reference vault (`tools/gen-vault --seed 1 --small-images`) with 1,000 unreviewed Quick Notes
// added (synthetic, `Quick Notes/Inbox <n>.md`). 20 launches of the release test build with TEGG_ROUTE=inbox and
// TEGG_EXIT_AFTER=route-ready:inbox; records `route-ready:inbox − ui-ready` per launch (the mark is set once the visible
// cards have painted, §7.4) and prints p50/p95 as JSON. Target: 225 ms (NFR-PERF-07's budget at 75 %), report-only
// until MS8. Never touches the owner's data (D-62).
// Run: `node e2e/perf_inbox.ts [--runs 20] [--out file.json]` after `npm run app:build`.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, marksOf, sleep, support } from './helpers/capture.ts';
import { p, referenceVault } from './perf_capture.ts';

export { EXE, p };

/** The reference vault with `n` unreviewed Quick Notes added; null when it can't be generated. */
export function inboxVault(base: string, n = 1000): string | null {
  const v = referenceVault(base);
  if (!v) return null;
  const dir = join(v, 'Quick Notes');
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++) {
    const id = `01JB5BPERF${String(i).padStart(16, '0')}`.slice(0, 26);
    const at = new Date(Date.UTC(2026, 9, 14, 10, 0, 0) - i * 60_000).toISOString().replace(/\.\d+Z$/, '+00:00');
    writeFileSync(join(dir, `Inbox ${String(i).padStart(4, '0')}.md`), `---\nid: ${id}\ntype: quick-note\ntitle: Inbox ${i}\nreview: unreviewed\ncaptured: ${at}\ncreated: ${at}\nmodified: ${at}\n---\nZachycený text číslo ${i}, žluťoučký kůň.\n`);
  }
  return v;
}
export function unreviewedCount(vault: string): number {
  const dir = join(vault, 'Quick Notes');
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((n) => n.endsWith('.md') && /^review: unreviewed$/m.test(readFileSync(join(dir, n), 'utf8'))).length;
}

export async function oneRun(vault: string, supportDir: string, log: string, timeoutMs = 60_000): Promise<number | null> {
  mkdirSync(supportDir, { recursive: true });
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  const mark = 'route-ready:inbox';
  const child = spawn(EXE, [], { env: { ...clean, TZ: 'Europe/Prague', TEGG_TEST: '1', TEGG_NOW: '2026-10-14T12:00:00+02:00', TEGG_APP_SUPPORT: supportDir, TEGG_VAULT: vault, TEGG_ROUTE: 'inbox', TEGG_PERF_LOG: log, TEGG_EXIT_AFTER: mark }, stdio: 'ignore' });
  const end = Date.now() + timeoutMs;
  while (Date.now() < end && child.exitCode === null && child.signalCode === null) await sleep(50);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  const m = marksOf(log);
  const ui = m.find((x) => x.mark === 'ui-ready')?.ms;
  const ready = m.find((x) => x.mark === mark)?.ms;
  return ui !== undefined && ready !== undefined ? ready - ui : null;
}

async function main() {
  const args = process.argv.slice(2);
  const runs = Number(args[args.indexOf('--runs') + 1] || 20) || 20;
  const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  if (!existsSync(EXE)) throw new Error(`app not built: ${EXE}`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-perf-inbox-'));
  try {
    const vault = inboxVault(base);
    if (!vault) throw new Error('reference vault could not be generated');
    const sup = support(base);
    await oneRun(vault, sup, join(base, 'warm.jsonl'), 240_000);
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) {
      const ms = await oneRun(vault, sup, join(base, `run-${i}.jsonl`));
      if (ms !== null) samples.push(ms);
    }
    const report = { benchmark: 'FR-INB-01 AC-10 route-ready:inbox', unreviewed: unreviewedCount(vault), runs, measured: samples.length, p50: samples.length ? p(samples, 0.5) : null, p95: samples.length ? p(samples, 0.95) : null, targetMs: 225, note: 'report only until MS8 (D-152, as D-488)' };
    console.log(JSON.stringify(report, null, 2));
    if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 2));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}
if (import.meta.url === `file://${process.argv[1]}`) void main();
