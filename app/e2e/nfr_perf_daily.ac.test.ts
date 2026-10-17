// FR-DLY-04 AC-6 (docs/acceptance/daily-notes.md, D-328): context-section limits on a large day. With 1,000 generated
// objects modified on one day, the sections of that day's Daily Note paint within 150 ms of `note-ready`. The mark is
// `daily-ready:<date>` (docs/contracts/ms4-daily.md §7.1: once per open, after the body and the sections have painted).
// Runs in the `app-perf` step with the other benchmarks (D-152, D-343): in MS4 it reports the p95 of 20 launches
// without a target (D-360); the target, 112 ms (75 % of 150 ms on the reference machine, D-59), is enforced only with
// TEGG_PERF_REF=1 at the MS8 milestone or a release (VERIFY_MILESTONE=MS8 / VERIFY_GATE=release), as
// nfr_perf_backlinks.ac.test.ts does. The 50-row limit and `Show <n> more` are L5 (app/webkit/daily_context.ac.test.ts).
//
// Vault: a temporary copy of the synthetic fixture tests/fixtures/vaults/daily (+ new-empty/.tegg) with 1,000 generated
// Czech-titled Pages created on 2026-09-01 and modified on 2026-10-14 (Europe/Prague), so they all fall in the
// `Modified` section of 14 Oct. The app runs with TZ=Europe/Prague on `daily/2026-10-14` (virtual) and
// TEGG_EXIT_AFTER=daily-ready:2026-10-14. One Application Support is reused, so the index is built in the warm-up run.
// Never touches the owner's data (D-62). Written from the AC and contracts only (D-61).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const EXE = resolve(import.meta.dirname, '../src-tauri/target/release/bundle/macos/Tegg.app/Contents/MacOS/tegg');
const FX = join(REPO, 'tests/fixtures/vaults');
const DATE = '2026-10-14';
const ROUTE = `daily/${DATE}`;
const PAINTED = `daily-ready:${DATE}`;
const TZ = 'Europe/Prague';
const OBJECTS = 1000;
const RUNS = 20;
const enforce = process.env.TEGG_PERF_REF === '1' && (process.env.VERIFY_MILESTONE === 'MS8' || process.env.VERIFY_GATE === 'release');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Mark = { mark: string; ms: number };
function readMarks(file: string): Mark[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Mark);
}

/** The daily fixture plus OBJECTS Pages modified on DATE (spread over the day, Prague offset). */
function prepareVault(base: string): string {
  const v = join(base, 'Deník');
  cpSync(join(FX, 'daily'), v, { recursive: true, filter: (src) => relative(join(FX, 'daily'), src) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  mkdirSync(join(v, 'Pages'), { recursive: true });
  for (let i = 0; i < OBJECTS; i++) {
    const n = String(i).padStart(4, '0');
    const s = 60 + i * 60; // 00:01:00 … 16:40:00 local, one minute apart
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    writeFileSync(join(v, 'Pages', `Úprava číslo ${n}.md`),
      `---\nid: 01JB4BPERF${n.padStart(16, '0')}\ntype: page\ntitle: Úprava číslo ${n}\ncreated: 2026-09-01T10:00:00+02:00\nmodified: ${DATE}T${hh}:${mm}:00+02:00\n---\nŽluťoučký kůň upravil stránku číslo ${n}.\n`);
  }
  return v;
}

/** One launch on ROUTE; stops 5 s after `note-ready` if the sections never paint. */
async function oneRun(vault: string, support: string, log: string, timeoutMs = 60_000): Promise<{ paint: number | null; ready: boolean }> {
  mkdirSync(support, { recursive: true });
  writeFileSync(join(support, 'ui-state.json'), JSON.stringify({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' } }));
  rmSync(log, { force: true });
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  const child = spawn(EXE, [], { env: { ...clean, TZ, TEGG_TEST: '1', TEGG_APP_SUPPORT: support, TEGG_VAULT: vault, TEGG_ROUTE: ROUTE, TEGG_PERF_LOG: log, TEGG_EXIT_AFTER: PAINTED }, stdio: 'ignore' });
  const end = Date.now() + timeoutMs;
  let readyAt: number | null = null;
  while (Date.now() < end && child.exitCode === null && child.signalCode === null) {
    const m = readMarks(log);
    if (readyAt === null && m.some((x) => x.mark === 'note-ready')) readyAt = Date.now();
    if (m.some((x) => x.mark === PAINTED) || (readyAt !== null && Date.now() - readyAt > 5000)) break;
    await sleep(50);
  }
  const deadline = Date.now() + 5000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await sleep(50);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  const m = readMarks(log);
  const ready = m.find((x) => x.mark === 'note-ready')?.ms;
  const paint = m.find((x) => x.mark === PAINTED)?.ms;
  return { paint: ready !== undefined && paint !== undefined ? paint - ready : null, ready: ready !== undefined };
}

function p95(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)];
}

test('fr_dly_04_ac6_sections_paint_within_150ms_of_note_ready_with_1000_objects', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-fr-dly-04-ac6-'));
  try {
    const vault = prepareVault(tmp);
    const support = join(tmp, 'support');
    const warm = await oneRun(vault, support, join(tmp, 'warm.jsonl'), 240_000);
    assert.ok(warm.ready, `warm-up: note-ready on ${ROUTE}`);
    assert.ok(warm.paint !== null, `warm-up: ${PAINTED} after note-ready`);
    const paint: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await oneRun(vault, support, join(tmp, `run-${i}.jsonl`));
      assert.ok(r.ready, `run ${i}: note-ready on ${ROUTE}`);
      assert.ok(r.paint !== null && r.paint >= 0, `run ${i}: ${PAINTED} at or after note-ready`);
      paint.push(r.paint!);
    }
    const p = p95(paint);
    console.log(`FR-DLY-04 AC-6 ${ROUTE} with ${OBJECTS} objects modified that day: sections painted p95 ${p.toFixed(1)} ms after note-ready (${RUNS} runs)`);
    if (enforce) assert.ok(p < 112, `p95 ${p.toFixed(1)} ms ≥ 112 ms (75 % of 150 ms, D-59)`);
    else console.log('FR-DLY-04 AC-6: reported only (MS4, D-152, D-360; enforced with TEGG_PERF_REF=1 at MS8 or release)');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
