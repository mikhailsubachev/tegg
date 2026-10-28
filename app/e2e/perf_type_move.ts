// FR-UX-07 AC-12 benchmark (recorded, no target; docs/acceptance/type-moves.md "Both parts", docs/contracts/ms4-jobs.md
// §14.8) and the shared setup of the slice 4E-1 500-object tests (FR-STO-01 AC-13 L6 once, AC-14 nightly): the
// reference vault (gen-vault `--seed 1 --small-images`) plus the type Kniha (the type-moves fixture's `kniha.yml`) with
// 500 objects in `Knihy/` and 500 linking notes in `Pages/`, each linking its book by the path form
// `[[Knihy/Kniha NNN]]` (rewritten by the move, FR-STO-04 AC-7). The benchmark launches the release test build on
// `type-settings/kniha` (TEGG_ROUTE, `route-ready:<route>`), types `Četba` into `Folder in the vault`, commits it with ↩
// and measures the time until all 500 objects are in `Četba/` and every linking note holds `[[Četba/Kniha NNN]]`.
// Never touches the owner's data (D-62).
// Run: `node e2e/perf_type_move.ts [--runs 5] [--out file.json]` after `npm run app:build`.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { osa as guardedOsa } from './helpers/osa.ts';

export const REPO = resolve(import.meta.dirname, '../..');
export const APP = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app');
export const EXE = join(APP, 'Contents/MacOS/tegg');
export const OBJECTS = 500;
export const FOLDER = 'Četba';
export const ROUTE = 'type-settings/kniha';
const n3 = (i: number) => String(i).padStart(3, '0');
export const book = (i: number, folder = 'Knihy') => `${folder}/Kniha ${n3(i)}.md`;
export const bookText = (i: number) =>
  `---\nid: 01JB4E0000000000000000B${n3(i)}\ntype: kniha\ntitle: Kniha ${n3(i)}\nautor: Autor číslo ${i}\n---\nObsah knihy ${n3(i)}.\n`;
export const linker = (i: number) => `Pages/Odkaz na knihu ${n3(i)}.md`;
export const linkerText = (i: number, folder = 'Knihy') =>
  `---\nid: 01JB4E0000000000000000L${n3(i)}\ntype: page\ntitle: Odkaz na knihu ${n3(i)}\n---\nZmínka o [[${folder}/Kniha ${n3(i)}]] v odstavci.\n`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Generates the reference vault once into `base/ref` and adds the Kniha type, its 500 objects and 500 linking notes;
 *  null when the vault can't be generated. */
export function prepareTypeVault(base: string): string | null {
  const out = join(base, 'ref');
  if (!existsSync(join(out, '.tegg/vault.yml'))) {
    try {
      execFileSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'), '--', '--seed', '1', '--small-images', '--out', out], { stdio: 'ignore' });
    } catch {
      return null;
    }
  }
  mkdirSync(join(out, '.tegg/types'), { recursive: true });
  writeFileSync(join(out, '.tegg/types/kniha.yml'), readFileSync(join(REPO, 'tests/fixtures/vaults/type-moves/.tegg/types/kniha.yml')));
  mkdirSync(join(out, 'Knihy'), { recursive: true });
  mkdirSync(join(out, 'Pages'), { recursive: true });
  for (let i = 1; i <= OBJECTS; i++) {
    writeFileSync(join(out, book(i)), bookText(i));
    writeFileSync(join(out, linker(i)), linkerText(i));
  }
  return out;
}
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
  return spawn(EXE, [], { env: { ...clean, TEGG_TEST: '1', TEGG_APP_SUPPORT: support, TEGG_VAULT: vault, TEGG_ROUTE: route, TEGG_PERF_LOG: log, TZ: 'Europe/Prague', TEGG_NOW: '2026-10-27T10:00:00+01:00' }, stdio: 'ignore' });
}
export function osa(...lines: string[]) {
  guardedOsa(...lines); // D-758: keys only while Tegg is frontmost
}
/** Focuses `Folder in the vault` by Tab from the page heading (type settings › General is the first section),
 *  replaces it with `folder` and commits with ↩. */
export function commitFolder(folder: string) {
  osa('tell application "System Events" to key code 48'); // Tab: the first field of General is the Name; then Plural; then Folder
  osa('tell application "System Events" to key code 48');
  osa('tell application "System Events" to key code 48');
  osa('tell application "System Events" to keystroke "a" using {command down}');
  execFileSync('pbcopy', { input: folder, env: { ...process.env, LANG: 'en_US.UTF-8' } });
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
/** How many objects are in `Četba/` with their bytes, and how many linking notes hold the new path. */
export function progressOnDisk(vault: string): { moved: number; linked: number } {
  let moved = 0;
  let linked = 0;
  for (let i = 1; i <= OBJECTS; i++) {
    const p = join(vault, book(i, FOLDER));
    if (existsSync(p) && !existsSync(join(vault, book(i))) && readFileSync(p, 'utf8') === bookText(i)) moved++;
    const l = join(vault, linker(i));
    if (existsSync(l) && readFileSync(l, 'utf8') === linkerText(i, FOLDER)) linked++;
  }
  return { moved, linked };
}
/** One benchmark run: ms from ↩ to every object moved and every link rewritten, or null after `timeoutMs`. */
export async function oneRun(prepared: string, base: string, i: number, timeoutMs = 180_000): Promise<number | null> {
  const vault = copyVault(prepared, join(base, `vault-${i}`));
  const log = join(base, `run-${i}.jsonl`);
  const child = launch(vault, join(base, `support-${i}`), log, ROUTE);
  try {
    if (!(await waitMark(log, `route-ready:${ROUTE}`, 240_000))) return null;
    await sleep(500);
    const t0 = Date.now();
    commitFolder(FOLDER);
    while (Date.now() - t0 < timeoutMs) {
      const p = progressOnDisk(vault);
      if (p.moved === OBJECTS && p.linked === OBJECTS) return Date.now() - t0;
      await sleep(50);
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
  const base = mkdtempSync(join(tmpdir(), 'tegg-perf-type-move-'));
  try {
    const v = prepareTypeVault(base);
    if (!v) throw new Error('reference vault could not be generated');
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t = await oneRun(v, base, i);
      if (t !== null) times.push(t);
      console.log(`run ${i}: ${t === null ? 'timeout' : `${t} ms`}`);
    }
    const report = { metric: 'FR-UX-07 AC-12 moving 500 objects with 500 linking notes: time to done', runs, ok: times.length, p95: times.length ? p95(times) : null, times };
    console.log(JSON.stringify(report));
    if (outAt > 0) writeFileSync(process.argv[outAt + 1], JSON.stringify(report, null, 2));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}
