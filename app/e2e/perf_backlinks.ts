// FR-LNK-01 AC-16 benchmark ([MS8], report only in MS4, D-152; docs/contracts/ms4-links.md §5.4 mark
// `backlinks-painted:<path>`): on the reference vault (gen-vault `--seed 1 --small-images`), for the note with the most
// backlinks and for a test-added note `Pages/Rozbočovač.md` linked from 1,000 test-added notes, the time from
// `note-ready` to `backlinks-painted:<path>` with the Context panel open on Backlinks, p95 of 20 launches of the release
// test build (TEGG_ROUTE=note/<path>, TEGG_EXIT_AFTER=backlinks-painted:<path>). Also reports `note-ready − ui-ready`
// with the panel open (opening the note isn't delayed, NFR-PERF-05). Never touches the owner's data (D-62).
// Run: `node e2e/perf_backlinks.ts [--runs 20] [--out file.json]` after `npm run app:build`.
// The "at most 100 entry elements in the DOM" part is checked in L5 (app/webkit/backlinks.ac.test.ts).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const REPO = resolve(import.meta.dirname, '../..');
export const EXE = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app/Contents/MacOS/tegg');
export const HUB = 'Pages/Rozbočovač.md';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Mark = { mark: string; ms: number };
export function readMarks(file: string): Mark[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Mark);
}

/** Generates the reference vault and adds the hub note with 1,000 linking notes; returns the vault or null. */
export function prepareVault(base: string): string | null {
  const out = join(base, 'vault');
  try {
    execFileSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'), '--', '--seed', '1', '--small-images', '--out', out], { stdio: 'ignore' });
  } catch {
    return null;
  }
  mkdirSync(join(out, 'Pages'), { recursive: true });
  writeFileSync(join(out, HUB), '---\nid: 01JB4AHUB00000000000000000\ntype: page\ntitle: Rozbočovač\n---\nCíl tisíce odkazů.\n');
  for (let i = 0; i < 1000; i++) {
    const n = String(i).padStart(4, '0');
    writeFileSync(join(out, 'Pages', `Odkazující ${n}.md`), `---\nid: 01JB4AREF${n.padStart(17, '0')}\ntype: page\ntitle: Odkazující ${n}\nmodified: 2026-10-${String(1 + (i % 28)).padStart(2, '0')}T08:00:00+02:00\n---\nZmínka o [[Rozbočovač]] v odstavci číslo ${n}.\n`);
  }
  return out;
}

/** The generated note with the most incoming wikilinks by file stem (an estimate for choosing the target). */
export function mostLinked(vault: string): string {
  const stems = new Map<string, string>();
  const counts = new Map<string, number>();
  const files: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const n of readdirSync(d)) {
      if (n.startsWith('.') || n === '_templates' || n === '_attachments') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p, `${rel}${n}/`);
      else if (n.endsWith('.md')) { files.push(`${rel}${n}`); stems.set(n.slice(0, -3).normalize('NFC').toLowerCase(), `${rel}${n}`); }
    }
  };
  walk(vault, '');
  for (const f of files) {
    if (f.startsWith('Pages/Odkazující ')) continue;
    for (const m of readFileSync(join(vault, f), 'utf8').matchAll(/(?<!!)\[\[([^\]|#]+)/g)) {
      const p = stems.get(m[1].trim().split('/').pop()!.normalize('NFC').toLowerCase());
      if (p && p !== f) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? HUB;
}

/** One launch on `note/<path>` with the panel open; stops 5 s after `note-ready` if the panel never paints. */
export async function oneRun(vault: string, support: string, log: string, path: string, timeoutMs = 60_000): Promise<{ paint: number | null; open: number | null }> {
  mkdirSync(support, { recursive: true });
  writeFileSync(join(support, 'ui-state.json'), JSON.stringify({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: true, tab: 'backlinks' } }));
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  const painted = `backlinks-painted:${path}`;
  const child = spawn(EXE, [], { env: { ...clean, TEGG_TEST: '1', TEGG_APP_SUPPORT: support, TEGG_VAULT: vault, TEGG_ROUTE: `note/${path}`, TEGG_PERF_LOG: log, TEGG_EXIT_AFTER: painted }, stdio: 'ignore' });
  const end = Date.now() + timeoutMs;
  let readyAt: number | null = null;
  while (Date.now() < end && child.exitCode === null && child.signalCode === null) {
    const m = readMarks(log);
    if (readyAt === null && m.some((x) => x.mark === 'note-ready')) readyAt = Date.now();
    if (m.some((x) => x.mark === painted) || (readyAt !== null && Date.now() - readyAt > 5000)) break;
    await sleep(50);
  }
  if (child.exitCode === null) child.kill('SIGKILL');
  const m = readMarks(log);
  const ui = m.find((x) => x.mark === 'ui-ready')?.ms;
  const ready = m.find((x) => x.mark === 'note-ready')?.ms;
  const paint = m.find((x) => x.mark === painted)?.ms;
  return { paint: ready !== undefined && paint !== undefined ? paint - ready : null, open: ui !== undefined && ready !== undefined ? ready - ui : null };
}

export function p95(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)];
}

async function main() {
  const args = process.argv.slice(2);
  const runs = Number(args[args.indexOf('--runs') + 1] || 20) || 20;
  const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  if (!existsSync(EXE)) throw new Error(`app not built: ${EXE}`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-perf-backlinks-'));
  try {
    const vault = prepareVault(base);
    if (!vault) throw new Error('gen-vault failed');
    const report: Record<string, unknown>[] = [];
    for (const path of [mostLinked(vault), HUB]) {
      await oneRun(vault, join(base, 'support-warm'), join(base, 'warm.jsonl'), path, 240_000);
      const paint: number[] = [];
      const open: number[] = [];
      for (let i = 0; i < runs; i++) {
        const r = await oneRun(vault, join(base, `support-${i}`), join(base, `perf-${path.length}-${i}.jsonl`), path);
        if (r.paint !== null) paint.push(r.paint);
        if (r.open !== null) open.push(r.open);
      }
      report.push({ path, runs, measured: paint.length, paintP95: paint.length ? p95(paint) : null, openP95: open.length ? p95(open) : null });
    }
    const out = { benchmark: 'FR-LNK-01 AC-16 first backlinks group painted after note-ready', targetMs: null, note: 'report only in MS4 (D-152); MS8 target 112 ms (D-59)', report };
    console.log(JSON.stringify(out, null, 2));
    if (outFile) writeFileSync(outFile, JSON.stringify(out, null, 2));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}
if (import.meta.url === `file://${process.argv[1]}`) void main();
