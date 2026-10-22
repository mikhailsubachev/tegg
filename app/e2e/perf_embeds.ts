// FR-EMB-02 AC-13 benchmark ([MS8], report only in MS4, D-152; docs/acceptance/embeds.md AP-332 / D-429;
// docs/contracts/ms4-embeds.md §6 mark `embeds-painted`): on the reference vault with the read-view benchmark note
// (`tools/gen-vault --perf-note`: 5,000 words, 10 embeds, 50 links), 20 launches of the release test build. Each launch
// starts on the Inbox (6A, D-609), opens the note through the quick switcher (⌘O, paste the title, ⏎) and exits after `embeds-painted`
// (TEGG_EXIT_AFTER), or 5 s after `note-ready` if that mark never comes. Records per launch `note-ready − switcher-enter`
// (editor NFR-PERF-05 AC-4 with embeds rendered) and `embeds-painted − note-ready`. Never touches the owner's
// Application Support or vault (D-62). Used by nfr_perf_embeds.ac.test.ts; no assertions about the AC outcome here.
// Run: `node e2e/perf_embeds.ts [--runs 20] [--out file.json]` after `npm run app:build` (TEGG_REF_VAULT may point at a
// pre-generated `--perf-note` vault).
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, generateVault, longestNote, p95, readMarks } from './perf_open_note.ts';

export { EXE, generateVault, longestNote, p95 };
export const PAINTED = 'embeds-painted';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const osa = (...lines: string[]) => execFileSync('osascript', lines.flatMap((l) => ['-e', l]), { encoding: 'utf8' });

export type EmbedRun = { open: number | null; paint: number | null };

/** One launch on the Inbox, the note opened through the switcher; the app exits after `embeds-painted`. */
export async function oneRun(env: Record<string, string>, log: string, title: string, timeoutMs = 60_000): Promise<EmbedRun> {
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  const child = spawn(EXE, [], { env: { ...clean, ...env, TEGG_ROUTE: 'inbox', TEGG_PERF_LOG: log, TEGG_EXIT_AFTER: PAINTED }, stdio: 'ignore' });
  const end = Date.now() + timeoutMs;
  while (Date.now() < end && !readMarks(log).some((m) => m.mark === 'ui-ready')) await sleep(50);
  const alive = () => child.exitCode === null && child.signalCode === null;
  // Keys go to the frontmost app only while this Tegg process is in front (as perf_open_note.ts).
  const inFront = () => {
    if (!alive()) return false;
    try { return osa('tell application "System Events" to get unix id of first process whose frontmost is true').trim() === String(child.pid); } catch { return false; }
  };
  try {
    osa(`tell application "System Events" to set frontmost of (first process whose unix id is ${child.pid}) to true`);
    await sleep(300);
    if (inFront()) {
      osa('tell application "System Events" to keystroke "o" using {command down}');
      await sleep(300);
      execFileSync('pbcopy', { input: title, env: { ...process.env, LANG: 'en_US.UTF-8' } });
      if (inFront()) {
        osa('tell application "System Events" to keystroke "v" using {command down}');
        await sleep(500);
        if (inFront()) osa('tell application "System Events" to key code 36');
      }
    }
  } catch { /* the marks tell */ }
  let readyAt: number | null = null;
  while (Date.now() < end && alive()) {
    const m = readMarks(log);
    if (readyAt === null && m.some((x) => x.mark === 'note-ready')) readyAt = Date.now();
    if (m.some((x) => x.mark === PAINTED) || (readyAt !== null && Date.now() - readyAt > 5000)) break;
    await sleep(50);
  }
  await sleep(200);
  if (alive()) child.kill('SIGKILL');
  const m = readMarks(log);
  const enter = m.find((x) => x.mark === 'switcher-enter')?.ms;
  const ready = m.find((x) => x.mark === 'note-ready')?.ms;
  const paint = m.find((x) => x.mark === PAINTED)?.ms;
  return {
    open: enter !== undefined && ready !== undefined ? ready - enter : null,
    paint: ready !== undefined && paint !== undefined ? paint - ready : null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const runs = Number(args[args.indexOf('--runs') + 1] || 20) || 20;
  const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  const base = mkdtempSync(join(tmpdir(), 'tegg-perf-embeds-'));
  try {
    const vault = process.env.TEGG_REF_VAULT ?? generateVault(join(base, 'vault'));
    if (!vault) throw new Error('gen-vault --perf-note failed');
    const target = longestNote(vault);
    const env = { TEGG_TEST: '1', TEGG_APP_SUPPORT: join(base, 'support'), TEGG_VAULT: vault };
    await oneRun(env, join(base, 'warm.jsonl'), target.title, 240_000);
    const open: number[] = [];
    const paint: number[] = [];
    for (let i = 0; i < runs; i++) {
      const r = await oneRun(env, join(base, `run-${i}.jsonl`), target.title);
      if (r.open !== null) open.push(r.open);
      if (r.paint !== null) paint.push(r.paint);
    }
    const out = {
      benchmark: 'FR-EMB-02 AC-13 embeds painted after note-ready; note-ready after switcher-enter with embeds rendered',
      targetMs: null, note: 'report only in MS4 (D-152); MS8 target: both p95 < 112 ms (D-59, D-429)',
      note_path: target.path, runs, openMeasured: open.length, paintMeasured: paint.length,
      openP95: open.length ? p95(open) : null, paintP95: paint.length ? p95(paint) : null,
    };
    console.log(JSON.stringify(out, null, 2));
    if (outFile) writeFileSync(outFile, JSON.stringify(out, null, 2));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}
if (import.meta.url === `file://${process.argv[1]}`) void main();
