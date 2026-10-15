// FR-TYP-09 AC-12 benchmark ([MS8], report only in MS3, D-152; docs/contracts/ms3-shell.md §14.9): `type/quick-note`
// with at least 1,000 objects on the reference vault (gen-vault `--seed 1 --small-images`; synthetic Quick Notes are
// added to a temporary copy when the vault has fewer), 20 launches of the release test build with
// TEGG_ROUTE=type/quick-note and TEGG_EXIT_AFTER=route-ready:type/quick-note. Records `route-ready:type/quick-note −
// ui-ready` per launch and prints p50/p95 as JSON (no target in MS3). Never touches the owner's data (D-62).
// Run: `node e2e/perf_type_page.ts [--runs 20] [--out file.json]` after `npm run app:build`.
// The "at most 100 row elements while scrolling" part needs a DOM probe in the built app and is not measured here.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const EXE = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app/Contents/MacOS/tegg');
const ROUTE = 'type/quick-note';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Mark = { mark: string; ms: number };
function readMarks(file: string): Mark[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Mark);
}
function quickNotes(vault: string): number {
  const dir = join(vault, 'Quick Notes');
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.md')).length : 0;
}

export function prepareVault(base: string): string {
  const out = join(base, 'vault');
  execFileSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'), '--', '--seed', '1', '--small-images', '--out', out], { stdio: 'ignore' });
  mkdirSync(join(out, 'Quick Notes'), { recursive: true });
  for (let i = quickNotes(out); i < 1000; i++) {
    const n = String(i).padStart(4, '0');
    writeFileSync(join(out, 'Quick Notes', `Rychlá poznámka ${n}.md`), `---\nid: 01JBPERF${n.padStart(18, '0')}\ntype: quick-note\ntitle: Rychlá poznámka ${n}\ncreated: 2026-10-01T08:00:00+02:00\nmodified: 2026-10-${String(1 + (i % 28)).padStart(2, '0')}T08:00:00+02:00\n---\nTělo ${n}.\n`);
  }
  return out;
}

export async function oneRun(vault: string, support: string, log: string, timeoutMs = 60_000): Promise<number | null> {
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  const mark = `route-ready:${ROUTE}`;
  const child = spawn(EXE, [], { env: { ...clean, TEGG_TEST: '1', TEGG_APP_SUPPORT: support, TEGG_VAULT: vault, TEGG_ROUTE: ROUTE, TEGG_PERF_LOG: log, TEGG_EXIT_AFTER: mark }, stdio: 'ignore' });
  const end = Date.now() + timeoutMs;
  while (Date.now() < end && child.exitCode === null && child.signalCode === null) await sleep(50);
  if (child.exitCode === null) child.kill('SIGKILL');
  const m = readMarks(log);
  const ui = m.find((x) => x.mark === 'ui-ready')?.ms;
  const ready = m.find((x) => x.mark === mark)?.ms;
  return ui !== undefined && ready !== undefined ? ready - ui : null;
}

export function p(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(q * s.length) - 1)];
}

async function main() {
  const args = process.argv.slice(2);
  const runs = Number(args[args.indexOf('--runs') + 1] || 20) || 20;
  const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  if (!existsSync(EXE)) throw new Error(`app not built: ${EXE}`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-perf-type-page-'));
  try {
    const vault = prepareVault(base);
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) {
      const ms = await oneRun(vault, join(base, `support-${i}`), join(base, `perf-${i}.jsonl`));
      if (ms !== null) samples.push(ms);
    }
    const report = { benchmark: 'FR-TYP-09 AC-12 type/quick-note first rows', objects: quickNotes(vault), runs, measured: samples.length, p50: samples.length ? p(samples, 0.5) : null, p95: samples.length ? p(samples, 0.95) : null, targetMs: null, note: 'report only in MS3 (D-152); MS8 target 225 ms (D-59)' };
    console.log(JSON.stringify(report, null, 2));
    if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 2));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}
if (import.meta.url === `file://${process.argv[1]}`) void main();
