// NFR-PERF-05 AC-2 benchmark (docs/contracts/ms3-shell.md §11.5, D-148): from ⏎ on a switcher result to `note-ready`
// on the reference vault's longest note (with 10 embeds and 50 links added by `tools/gen-vault --perf-note`), 20
// launches of the release test build, each with TEGG_PERF_LOG and TEGG_EXIT_AFTER=note-ready. Records
// `note-ready − switcher-enter` per launch. Never touches the owner's Application Support or vault (D-62).
// Used by nfr_perf_05.ac.test.ts; no assertions about the AC outcome here.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REPO = resolve(import.meta.dirname, '../..');
export const APP = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app');
export const EXE = join(APP, 'Contents/MacOS/tegg');
const BUNDLE_ID = 'app.tegg.desktop';

type Mark = { mark: string; ms: number };
export function readMarks(file: string): Mark[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Mark);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Generates the reference vault with the perf note; returns null when gen-vault fails (e.g. no `--perf-note`). */
export function generateVault(out: string): string | null {
  try {
    execFileSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'), '--',
      '--seed', '1', '--small-images', '--perf-note', '--out', out], { stdio: 'ignore' });
    return out;
  } catch {
    return null;
  }
}

/** The vault's longest note (bytes) and its title (frontmatter `title`, else the file stem). */
export function longestNote(vault: string): { path: string; title: string; text: string } {
  let best = { path: '', size: -1 };
  const walk = (d: string, rel: string) => {
    for (const n of readdirSync(d)) {
      if (n.startsWith('.') || n === '_templates' || n === '_attachments') continue;
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, `${rel}${n}/`);
      else if (n.endsWith('.md') && st.size > best.size) best = { path: `${rel}${n}`, size: st.size };
    }
  };
  walk(vault, '');
  const text = readFileSync(join(vault, best.path), 'utf8');
  const m = /^title:\s*"?([^"\n]+)"?\s*$/m.exec(text);
  return { path: best.path, title: m ? m[1] : best.path.split('/').pop()!.replace(/\.md$/, ''), text };
}

const osa = (...lines: string[]) => execFileSync('osascript', lines.flatMap((l) => ['-e', l]), { encoding: 'utf8' });

/** One launch: wait for `ui-ready`, ⌘O, paste the title, ⏎; the app exits after `note-ready`. Returns the marks. */
export async function oneRun(env: Record<string, string>, log: string, title: string, timeoutMs = 60_000): Promise<Mark[]> {
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  // Every run starts on the Inbox (6A: the `home` route is removed, D-609): otherwise the app reopens the note the previous run opened (vault_last, D-132), reaches
  // note-ready and quits before the switcher is used.
  const child = spawn(EXE, [], { env: { ...clean, ...env, TEGG_ROUTE: 'inbox', TEGG_PERF_LOG: log, TEGG_EXIT_AFTER: 'note-ready' }, stdio: 'ignore' });
  const end = Date.now() + timeoutMs;
  while (Date.now() < end && !readMarks(log).some((m) => m.mark === 'ui-ready')) await sleep(50);
  const alive = () => child.exitCode === null && child.signalCode === null;
  // Keys go through System Events to the frontmost app: send each one only while this Tegg process is alive and in
  // front, so no keystroke ever reaches another app (a stray ⌘O opened another app's file dialog).
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
  while (Date.now() < end && child.exitCode === null && child.signalCode === null) await sleep(50);
  if (child.exitCode === null) child.kill('SIGKILL');
  return readMarks(log);
}

export function p95(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.ceil(0.95 * s.length) - 1];
}
