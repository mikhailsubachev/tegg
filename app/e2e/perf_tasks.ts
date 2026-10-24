// FR-TSK-04 AC-14 benchmark ([MS8], report only in MS5, D-152, D-488; docs/acceptance/tasks.md, docs/contracts/
// ms5-tasks.md §6.1 marks): the Tasks page on the reference vault (gen-vault `--seed 1 --small-images`, ≈ 750 Task
// objects, performance.md). 20 launches of the release test build per view with TEGG_ROUTE=tasks (Schedule) or
// TEGG_ROUTE=tasks/kanban with the grouping stored in ui-state.json (`tasks.groupBy`, D-481), and
// TEGG_EXIT_AFTER=route-ready:<route>. Records `route-ready:<route> − ui-ready` per launch (the mark is set once the
// visible cards painted, §6.1) and prints p50/p95 as JSON. Target from MS8: p95 < 225 ms (75 % of NFR-PERF-07's 300 ms,
// D-59). The 60 fps scrolling and the "card in the target column within 100 ms of the drag write" parts need an
// in-app probe and are not measured here (see the red-commit report). Never touches the owner's data (D-62).
// Run: `node e2e/perf_tasks.ts [--runs 20] [--out file.json]` after `npm run app:build`.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const REPO = resolve(import.meta.dirname, '../..');
export const EXE = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app/Contents/MacOS/tegg');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type View = { name: string; route: 'tasks' | 'tasks/kanban'; groupBy: 'status' | 'tag' };
export const VIEWS: View[] = [
  { name: 'schedule', route: 'tasks', groupBy: 'status' },
  { name: 'kanban-status', route: 'tasks/kanban', groupBy: 'status' },
  { name: 'kanban-tag', route: 'tasks/kanban', groupBy: 'tag' },
];

type Mark = { mark: string; ms: number };
function readMarks(file: string): Mark[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Mark);
}
/** Task files of the vault (`type: task` in the frontmatter, any case like the app; the reference vault writes `Task`, D-749). */
export function taskCount(vault: string): number {
  const dir = join(vault, 'Tasks');
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((n) => n.endsWith('.md') && /^type: task$/im.test(readFileSync(join(dir, n), 'utf8'))).length;
}

/** The reference vault, generated into `base/vault`; null when it can't be generated. */
export function prepareVault(base: string): string | null {
  const out = join(base, 'vault');
  try {
    execFileSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'), '--', '--seed', '1', '--small-images', '--out', out], { stdio: 'ignore' });
  } catch {
    return null;
  }
  return existsSync(join(out, '.tegg/vault.yml')) ? out : null;
}

export async function oneRun(vault: string, support: string, log: string, view: View, timeoutMs = 60_000): Promise<number | null> {
  mkdirSync(support, { recursive: true });
  writeFileSync(join(support, 'ui-state.json'), JSON.stringify({
    version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' },
    tasks: { view: view.route === 'tasks' ? 'schedule' : 'kanban', groupBy: view.groupBy, dateFilter: 'all', tags: [], doneExpanded: false },
  }));
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  const mark = `route-ready:${view.route}`;
  const child = spawn(EXE, [], { env: { ...clean, TZ: 'Europe/Prague', TEGG_TEST: '1', TEGG_APP_SUPPORT: support, TEGG_VAULT: vault, TEGG_ROUTE: view.route, TEGG_PERF_LOG: log, TEGG_EXIT_AFTER: mark }, stdio: 'ignore' });
  const end = Date.now() + timeoutMs;
  while (Date.now() < end && child.exitCode === null && child.signalCode === null) await sleep(50);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
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
  const base = mkdtempSync(join(tmpdir(), 'tegg-perf-tasks-'));
  try {
    const vault = prepareVault(base);
    if (!vault) throw new Error('reference vault could not be generated');
    const report: Record<string, unknown>[] = [];
    for (const view of VIEWS) {
      await oneRun(vault, join(base, `support-${view.name}`), join(base, `warm-${view.name}.jsonl`), view, 240_000);
      const samples: number[] = [];
      for (let i = 0; i < runs; i++) {
        const ms = await oneRun(vault, join(base, `support-${view.name}`), join(base, `perf-${view.name}-${i}.jsonl`), view);
        if (ms !== null) samples.push(ms);
      }
      report.push({ benchmark: `FR-TSK-04 AC-14 ${view.route} (${view.name})`, tasks: taskCount(vault), runs, measured: samples.length, p50: samples.length ? p(samples, 0.5) : null, p95: samples.length ? p(samples, 0.95) : null, targetMs: null, note: 'report only in MS5 (D-152, D-488); MS8 target 225 ms (D-59)' });
    }
    console.log(JSON.stringify(report, null, 2));
    if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 2));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}
if (import.meta.url === `file://${process.argv[1]}`) void main();
