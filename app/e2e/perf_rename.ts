// FR-UX-07 AC-11 benchmark (report only, D-152, D-397; docs/acceptance/rename.md, docs/contracts/ms4-jobs.md §12) and
// the shared setup of the slice 4C hub tests: the reference vault (gen-vault `--seed 1 --small-images`) plus a hub
// `Pages/Rozbočovač.md` linked from 500 test-added notes (rename.md "Created at runtime"). The benchmark launches the
// release test build on the hub (TEGG_ROUTE, `note-ready`: the title has the focus, ms3-shell §13.4), commits the new
// title `Uzel` with ↩ and measures the time until every linking file holds `[[Uzel]]` and the hub is `Pages/Uzel.md`.
// Never touches the owner's data (D-62).
// Run: `node e2e/perf_rename.ts [--runs 5] [--out file.json]` after `npm run app:build`.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { osa as guardedOsa } from './helpers/osa.ts';

export const REPO = resolve(import.meta.dirname, '../..');
export const APP = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app');
export const EXE = join(APP, 'Contents/MacOS/tegg');
export const HUB = 'Pages/Rozbočovač.md';
export const HUB_TITLE = 'Rozbočovač';
export const NEW_TITLE = 'Uzel';
export const NEW_HUB = 'Pages/Uzel.md';
export const LINKS = 500;
export const linker = (i: number) => `Pages/Odkaz na uzel ${String(i).padStart(3, '0')}.md`;
export const linkerText = (i: number, target = HUB_TITLE) => {
  const n = String(i).padStart(3, '0');
  return `---\nid: 01JB4CHUB0000000000000L${n}\ntype: page\ntitle: Odkaz na uzel ${n}\n---\nZmínka o [[${target}]] v odstavci číslo ${n}.\n`;
};
export const HUB_TEXT = `---\nid: 01JB4CHUB00000000000000000\ntype: page\ntitle: ${HUB_TITLE}\n---\nCíl pěti set odkazů.\n`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Generates the reference vault once into `base/ref` and adds the hub with its 500 linking notes; null on failure. */
export function prepareHubVault(base: string): string | null {
  const out = join(base, 'ref');
  if (!existsSync(join(out, '.tegg/vault.yml'))) {
    try {
      execFileSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'), '--', '--seed', '1', '--small-images', '--out', out], { stdio: 'ignore' });
    } catch {
      return null;
    }
  }
  mkdirSync(join(out, 'Pages'), { recursive: true });
  writeFileSync(join(out, HUB), HUB_TEXT);
  for (let i = 0; i < LINKS; i++) writeFileSync(join(out, linker(i)), linkerText(i));
  return out;
}
/** A fresh copy of a prepared vault. */
export function copyVault(from: string, to: string): string {
  cpSync(from, to, { recursive: true });
  return to;
}

type Mark = { mark: string; ms: number };
export function readMarks(file: string): Mark[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Mark);
}
export async function waitMark(file: string, mark: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (readMarks(file).some((m) => m.mark === mark)) return true;
    await sleep(50);
  }
  return false;
}

/** Launches the test build on `route` with a temporary Application Support (no Appium). */
export function launch(vault: string, support: string, log: string, route: string): ChildProcess {
  mkdirSync(support, { recursive: true });
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  return spawn(EXE, [], { env: { ...clean, TEGG_TEST: '1', TEGG_APP_SUPPORT: support, TEGG_VAULT: vault, TEGG_ROUTE: route, TEGG_PERF_LOG: log, TEGG_TEST_FOCUS_TITLE: '1' }, stdio: 'ignore' });
}
export function osa(...lines: string[]) {
  guardedOsa(...lines); // D-758: ⌘Q/⌘W only while Tegg is frontmost
}
/** Replaces the focused title with `title` (pasted in one step) and commits it with ↩ (D-268). `launch` sets
 *  TEGG_TEST_FOCUS_TITLE, so the title has the focus once the note is ready (D-751); the body has it otherwise. */
export function commitTitle(title: string) {
  osa('tell application "System Events" to keystroke "a" using {command down}');
  execFileSync('pbcopy', { input: title, env: { ...process.env, LANG: 'en_US.UTF-8' } });
  osa('tell application "System Events" to keystroke "v" using {command down}');
  osa('tell application "System Events" to key code 36');
}
export function quit(child?: ChildProcess) {
  try { execFileSync('osascript', ['-e', 'tell application id "app.tegg.desktop" to quit'], { stdio: 'ignore', timeout: 5000 }); } catch { /* not running */ }
  if (child && child.exitCode === null) child.kill('SIGTERM');
}
export async function waitExit(child: ChildProcess, ms = 10_000) {
  const end = Date.now() + ms;
  while (child.exitCode === null && child.signalCode === null && Date.now() < end) await sleep(50);
}

/** How many linking files hold the new link, and whether the hub is renamed. */
export function progressOnDisk(vault: string): { rewritten: number; hubRenamed: boolean } {
  let rewritten = 0;
  for (let i = 0; i < LINKS; i++) {
    const p = join(vault, linker(i));
    if (existsSync(p) && readFileSync(p, 'utf8') === linkerText(i, NEW_TITLE)) rewritten++;
  }
  return { rewritten, hubRenamed: existsSync(join(vault, NEW_HUB)) && !existsSync(join(vault, HUB)) };
}

/** One benchmark run: ms from ↩ to every link rewritten and the hub renamed, or null after `timeoutMs`. */
export async function oneRun(prepared: string, base: string, i: number, timeoutMs = 120_000): Promise<number | null> {
  const vault = copyVault(prepared, join(base, `vault-${i}`));
  const log = join(base, `run-${i}.jsonl`);
  const child = launch(vault, join(base, `support-${i}`), log, `note/${HUB}`);
  try {
    if (!(await waitMark(log, 'note-ready', 240_000))) return null;
    await sleep(500);
    const t0 = Date.now();
    commitTitle(NEW_TITLE);
    while (Date.now() - t0 < timeoutMs) {
      const p = progressOnDisk(vault);
      if (p.rewritten === LINKS && p.hubRenamed) return Date.now() - t0;
      await sleep(25);
    }
    return null;
  } finally {
    quit(child);
    await waitExit(child);
    rmSync(vault, { recursive: true, force: true });
  }
}

export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const runs = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 5;
  const outAt = process.argv.indexOf('--out');
  const base = mkdtempSync(join(tmpdir(), 'tegg-perf-rename-'));
  try {
    const v = prepareHubVault(base);
    if (!v) throw new Error('reference vault could not be generated');
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t = await oneRun(v, base, i);
      if (t !== null) times.push(t);
      console.log(`run ${i}: ${t === null ? 'timeout' : `${t} ms`}`);
    }
    const report = { metric: 'FR-UX-07 AC-11 rename with 500 backlinks: time to done', runs, ok: times.length, p95: times.length ? p95(times) : null, times };
    console.log(JSON.stringify(report));
    if (outAt > 0) writeFileSync(process.argv[outAt + 1], JSON.stringify(report, null, 2));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}
