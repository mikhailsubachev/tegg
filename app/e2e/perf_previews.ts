// NFR-PERF-12 / FR-LNK-11 AC-1 benchmark (docs/acceptance/previews.md, AP-822 / D-940; docs/contracts/v1-previews.md §8
// marks `preview-click` on the reference input's pointer-up and `preview-ready` when the header, strip and first screen
// of the body are painted): on the reference vault (`tools/gen-vault --seed 1 --small-images --perf-note`, whose longest
// note is the 5,000-word benchmark note with 10 embeds and 50 links), a host note `Pages/Náhled benchmark.md` with one
// link chip `Benchmark cíl` to the benchmark note is opened in the release test build (TEGG_TEST=1, a temporary
// Application Support, TEGG_PERF_LOG); per run the chip is clicked through Appium (a real pointer click), the time
// `preview-ready − preview-click` is read from the perf log, and Esc closes the preview. Never touches the owner's
// Application Support or vault (D-62). Used by nfr_perf_12_previews.ac.test.ts; no assertions about the AC outcome here.
// Run: `node e2e/perf_previews.ts [--runs 20] [--out file.json]` after `npm run app:build` (TEGG_REF_VAULT may point at a
// pre-generated `--perf-note` vault; the host note is removed from it afterwards).
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, generateVault, longestNote, p95, readMarks } from './perf_open_note.ts';
import { appiumDown, end, firstShown, clickable, press, session, sleep, support, testEnv, waitMark, type Driver } from './helpers/capture.ts';

export { EXE, generateVault, longestNote, p95 };
export const HOST = 'Pages/Náhled benchmark.md';
export const LABEL = 'Benchmark cíl';
export const CLICK = 'preview-click';
export const READY = 'preview-ready';

/** Writes the host note with one aliased link to `target` (a vault path); returns its vault path. */
export function writeHost(vault: string, target: string): string {
  const link = target.replace(/\.md$/, '');
  writeFileSync(join(vault, HOST), `---\nid: 01JBPV0000000000000000PERF\ntype: page\ntitle: Náhled benchmark\n---\nOdkaz na [[${link}|${LABEL}]].\n`);
  return HOST;
}
export function removeHost(vault: string) {
  rmSync(join(vault, HOST), { force: true });
}

/** Starts the app on the host note; null when it doesn't get there. */
export async function startOnHost(vault: string, base: string): Promise<{ d: Driver; log: string } | null> {
  const log = join(base, `perf-${Date.now()}.jsonl`);
  const d = await session(testEnv(support(base, { name: `support-${Date.now()}` }), log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${HOST}` }));
  if (!(await waitMark(log, `route-ready:note/${HOST}`, 240_000))) { await end(d); return null; }
  await sleep(1500);
  return { d, log };
}

export type PreviewRun = number | null;
/** One click on the chip: `preview-ready − preview-click` of the marks it added, or null when either is missing. */
export async function oneRun(d: Driver, log: string, timeoutMs = 5000): Promise<PreviewRun> {
  const n = readMarks(log).length;
  const e = await firstShown(d, LABEL);
  if (!e) return null;
  await clickable(d, e).click();
  const endAt = Date.now() + timeoutMs;
  let click: number | undefined, ready: number | undefined;
  while (Date.now() < endAt) {
    const m = readMarks(log).slice(n);
    click = m.find((x) => x.mark === CLICK)?.ms;
    ready = click === undefined ? undefined : m.find((x) => x.mark === READY && x.ms >= click!)?.ms;
    if (ready !== undefined) break;
    await sleep(25);
  }
  press('escape');
  await sleep(700); // past the double-click interval, so the next click is a single click
  return click !== undefined && ready !== undefined ? ready - click : null;
}

async function main() {
  const args = process.argv.slice(2);
  const runs = Number(args[args.indexOf('--runs') + 1] || 20) || 20;
  const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  const base = mkdtempSync(join(tmpdir(), 'tegg-perf-previews-'));
  const vault = process.env.TEGG_REF_VAULT ?? generateVault(join(base, 'vault'));
  let s: { d: Driver; log: string } | null = null;
  try {
    if (!vault || !existsSync(vault)) throw new Error('gen-vault --perf-note failed');
    const target = longestNote(vault);
    writeHost(vault, target.path);
    s = await startOnHost(vault, base);
    if (!s) throw new Error('the host note did not open');
    await oneRun(s.d, s.log); // warm-up
    const times: number[] = [];
    for (let i = 0; i < runs; i++) { const t = await oneRun(s.d, s.log); if (t !== null) times.push(t); }
    const out = {
      benchmark: 'NFR-PERF-12 / FR-LNK-11 AC-1: pointer-up on a link chip to the 5,000-word note → preview-ready',
      targetMs: 75, note: 'report-only until the v1.0 release gate (D-152 rule, D-940)', note_path: target.path,
      runs, measured: times.length, p95: times.length ? p95(times) : null,
    };
    console.log(JSON.stringify(out, null, 2));
    if (outFile) writeFileSync(outFile, JSON.stringify(out, null, 2));
  } finally {
    await end(s?.d);
    appiumDown();
    if (vault && process.env.TEGG_REF_VAULT) removeHost(vault);
    rmSync(base, { recursive: true, force: true });
  }
}
if (import.meta.url === `file://${process.argv[1]}`) void main();
