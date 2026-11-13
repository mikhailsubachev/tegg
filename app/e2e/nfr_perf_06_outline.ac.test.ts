// Slice OL benchmarks (L6, the `app-perf` step, outside the push run; docs/acceptance/outline.md FR-EDT-11 AC-20 and
// NFR-PERF-06 AC-6; docs/contracts/v1-outline.md §8, D-1623): on the reference vault (`tools/gen-vault --seed 1
// --small-images`, or a copy of TEGG_REF_VAULT) with the runtime note `Pages/Pět set nadpisů.md` (fixture README: 100 H1
// `Kapitola 001`…, each with 4 H2 `Oddíl 001.1`…, a 30-word paragraph after every heading) copied in:
// - FR-EDT-11 AC-20: 50 edits in `Oddíl 050.2` (one key, a 400 ms pause), each measured from keydown to the painted row
//   (perf line `outline`), p95 under 250 ms;
// - NFR-PERF-06 AC-6: 200 characters typed into `Oddíl 050.2`, once with the panel on the Outline tab and once with the
//   panel closed and the rail shown; ≥ 95 % of keystrokes painted in the next frame and none later than two (D-66, D-190).
// Report-only until the v1.0 release gate, enforced there with TEGG_PERF_REF=1 on the reference machine (as D-940). Every
// run must still reach the marks and write one perf line per edit (they are part of the slice OL contract), so the tests
// are red until they exist. Keys go only to Tegg (helpers/osa.ts, D-758, D-799). Written from the ACs and the contract
// only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXE, generateVault } from './perf_open_note.ts';
import { keyLines, summary, type200 } from './perf_typing.ts';
import { outlineLines, p95, type50 } from './perf_outline.ts';
import { appiumDown, end, marks, osa, session, sleep, waitFor, type Driver } from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const enforce = process.env.TEGG_PERF_REF === '1' && process.env.VERIFY_GATE === 'release';
const NOTE = 'Pages/Pět set nadpisů.md';
const TARGET_MS = 250;

/** The README's runtime note. */
function petSet(): string {
  const words = Array.from({ length: 30 }, (_, i) => ['žluťoučký', 'kůň', 'úpěl', 'ďábelské', 'ódy', 'přes', 'louku'][i % 7]).join(' ') + '.';
  const out: string[] = [];
  for (let k = 1; k <= 100; k++) {
    const kk = String(k).padStart(3, '0');
    out.push(`# Kapitola ${kk}\n\n${words}\n`);
    for (let o = 1; o <= 4; o++) out.push(`## Oddíl ${kk}.${o}\n\n${words}\n`);
  }
  return `---\nid: 01JC5N0000000000000000R005\ntype: page\ntitle: Pět set nadpisů\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n---\n${out.join('\n')}`;
}
function prepare(tmp: string): string {
  const given = process.env.TEGG_REF_VAULT;
  const vault = given ? join(tmp, 'vault') : generateVault(join(tmp, 'vault'));
  assert.ok(vault, 'the reference vault could not be generated (tools/gen-vault --seed 1 --small-images)');
  if (given) cpSync(given, vault!, { recursive: true });
  mkdirSync(join(vault!, 'Pages'), { recursive: true });
  writeFileSync(join(vault!, NOTE), petSet());
  return vault!;
}
/** Launches the built app on the note with the panel `open` on Outline or closed, waits for `note-ready` and
 *  `outline-ready`, and puts the caret at the end of `Oddíl 050.2` (the leftmost element of that name: the note's heading). */
async function launch(tmp: string, vault: string, panelOpen: boolean, log: string): Promise<Driver> {
  const sup = join(tmp, `support-${panelOpen ? 'tab' : 'rail'}`);
  mkdirSync(sup, { recursive: true });
  writeFileSync(join(sup, 'ui-state.json'), JSON.stringify({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: panelOpen, tab: 'outline', width: 288 }, preview: { mode: 'off' } }));
  const d = await session({ TEGG_TEST: '1', TEGG_APP_SUPPORT: sup, TEGG_VAULT: vault, TEGG_ROUTE: `note/${NOTE}`, TEGG_PERF_LOG: log, TZ: 'Europe/Prague' });
  assert.ok(await waitFor(() => marks(log).includes('note-ready'), 240_000), 'note-ready');
  assert.ok(await waitFor(() => marks(log).includes('outline-ready'), 10_000), `outline-ready (the ${panelOpen ? 'tab' : 'rail'} painted its rows)`);
  let best: any = null, bx = Infinity;
  for (const e of await d.$$('-ios predicate string:label == "Oddíl 050.2" OR value == "Oddíl 050.2"').catch(() => [] as any[])) {
    const r = await d.getElementRect(e.elementId).catch(() => null);
    if (r && r.x < bx) { bx = r.x; best = e; }
  }
  assert.ok(best, 'the heading Oddíl 050.2 is in the note');
  await d.execute('macos: click', { elementId: best.elementId });
  osa('tell application "System Events" to key code 124 using {command down}'); // ⌘→: the end of the line
  await sleep(400);
  return d;
}

test('fr_edt_11_ac20_five_hundred_headings', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-ol-ac20-'));
  let d: Driver | undefined;
  try {
    const vault = prepare(tmp);
    const log = join(tmp, 'perf.jsonl');
    d = await launch(tmp, vault, true, log);
    type50('x');
    await sleep(1000);
    const lines = outlineLines(log);
    assert.equal(lines.length, 50, `one \`outline\` perf line per edit (got ${lines.length})`);
    const p = p95(lines.map((l) => l.ms));
    console.log(`FR-EDT-11 AC-20: 50 edits, keydown → painted row p95 ${p.toFixed(1)} ms, max ${Math.max(...lines.map((l) => l.ms)).toFixed(1)} ms (target < ${TARGET_MS} ms)`);
    if (enforce) assert.ok(p < TARGET_MS, `p95 ${p.toFixed(1)} ms ≥ ${TARGET_MS} ms`);
    else console.log('FR-EDT-11 AC-20: reported only (D-1623; enforced with TEGG_PERF_REF=1 at the v1.0 release gate)');
  } finally {
    await end(d);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('nfr_perf_06_ac6_typing_with_the_outline_on_screen', { timeout: 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const tmp = mkdtempSync(join(tmpdir(), 'tegg-ol-perf06-'));
  try {
    const vault = prepare(tmp);
    for (const [label, panelOpen] of [['the panel on the Outline tab', true], ['the panel closed, the rail shown', false]] as const) {
      const log = join(tmp, `perf-${panelOpen ? 'tab' : 'rail'}.jsonl`);
      let d: Driver | undefined;
      try {
        d = await launch(tmp, vault, panelOpen, log);
        type200('a');
        await sleep(1000);
      } finally {
        await end(d);
      }
      const s = summary(keyLines(log));
      console.log(`NFR-PERF-06 AC-6, ${label}: ${s.n} keys, frame 1 ${(s.frame1 * 100).toFixed(1)} %, late ${s.late}, p50 ${s.p50} ms, p95 ${s.p95} ms`);
      assert.equal(s.n, 200, `${label}: the probe wrote one key line per keystroke (got ${s.n})`);
      if (enforce) {
        assert.ok(s.frame1 >= 0.95, `${label}: ≥ 95 % in frame 1 (${(s.frame1 * 100).toFixed(1)} %)`);
        assert.equal(s.late, 0, `${label}: none after frame 2`);
      } else console.log(`NFR-PERF-06 AC-6, ${label}: reported only (D-1623; enforced with TEGG_PERF_REF=1 at the v1.0 release gate)`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
