// Slice AND-2, LA nightly (the test APK on the emulator with the generated vault `tools/gen-vault --seed 1
// --small-images` in shared storage; contract docs/contracts/android-phone.md §12.3, §14.2): docs/acceptance/android-phone.md
// - NFR-PERF-05 AC-6 (report-only bounds on the emulator, D-2010, AP-2062 → D-2198; CP-12 → D-2212): after
//   `index-idle`, `note-ready` for 20 opens of notes under 5,000 words p95 ≤ 1,000 ms; `route-ready:search` for the
//   first page of 10 queries p95 ≤ 1,000 ms; `route-ready:type/page` ≤ 1,500 ms. A duration is the ready mark's `ms`
//   minus the latest `nav-start:<route>` before it (§12.3);
// - FR-UX-07 AC-18 (LA nightly part): the generated vault's first open shows the `Indexing progress` line until
//   `index-idle`.
// Every test starts with `ready()` (requireDevice): without an emulator it fails, never skips. The numbers are printed
// (report-only) and the run fails only above the bounds.
// Red-test readings (reported): notes and queries are opened through the Search page (field, then Enter opens the first
// result), the way a phone user opens a note by name; the 20 notes are the generated vault's first 20 pages by name.
// Written from the ACs and the contract only (D-61).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  adb, eventually, install, perfMarks, quote, REPO, requireDevice, sh, SHARED, sleep, TEST_APK, TEST_ID, type Mark, type WebView,
} from './helpers/device.ts';
import { FRAME, DRAWER, launchPhone } from './helpers/phone.ts';

const views: WebView[] = [];
let installed = false;
let local = '';
let remote = '';
function ready() {
  requireDevice();
  if (!installed) { install(TEST_APK); installed = true; }
}
before(() => { local = mkdtempSync(join(tmpdir(), 'tegg-la-gen-')); });
after(() => {
  for (const v of views) v.close();
  if (local) rmSync(local, { recursive: true, force: true });
  adb(['shell', `rm -rf ${SHARED}/Documents/tegg-la-*`]);
});
/** The generated vault on the device (made once per run). */
function generated(): string {
  if (remote) return remote;
  const out = join(local, 'vault');
  const g = spawnSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'), '--', '--seed', '1', '--small-images', '--out', out], { encoding: 'utf8', timeout: 900_000 });
  assert.equal(g.status, 0, `tools/gen-vault runs: ${g.stderr?.slice(-400)}`);
  remote = `${SHARED}/Documents/tegg-la-gen/Generovaný`;
  sh(`mkdir -p ${quote(remote)}`);
  const p = adb(['push', `${out}/.`, remote]);
  assert.equal(p.status, 0, `adb push the generated vault: ${p.stderr}`);
  return remote;
}
const p95 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };
/** Durations of `ready` marks: each one's `ms` minus the latest `nav-start:*` before it. */
function durations(marks: Mark[], ready: (m: string) => boolean): number[] {
  const out: number[] = [];
  let start: number | null = null;
  for (const m of marks) {
    if (m.mark.startsWith('nav-start:')) start = m.ms;
    else if (ready(m.mark) && start !== null) { out.push(m.ms - start); start = null; }
  }
  return out;
}
async function openBySearch(v: WebView, text: string) {
  await v.click(`${FRAME} [data-command="goto.search"]`);
  await v.eval(`(() => { const i = document.querySelector('header[role="banner"] [role="search"] input'); i.focus(); i.select(); return true; })()`);
  await v.type(text);
  await sleep(700);
}

test('nightly_nfr_perf_05_ac6_reading_speed_on_the_emulator', async () => {
  ready();
  const vault = generated();
  const { v } = await launchPhone(vault, {}, views);
  assert.ok((await eventually(() => perfMarks(TEST_ID).filter((m) => m.mark === 'index-idle'), (m) => m.length > 0, 600_000, 1000)).length > 0, 'index-idle');
  const pages = readdirSync(join(local, 'vault', 'Pages')).filter((n) => n.endsWith('.md') && statSync(join(local, 'vault', 'Pages', n)).size < 40_000).sort().slice(0, 20).map((n) => n.replace(/\.md$/, ''));
  assert.equal(pages.length, 20, 'twenty notes under 5,000 words');
  const m0 = perfMarks(TEST_ID).length;
  for (const p of pages) { await openBySearch(v, p); await v.key('Enter'); await sleep(1200); }
  const notes = durations(perfMarks(TEST_ID).slice(m0), (m) => m === 'note-ready');
  const m1 = perfMarks(TEST_ID).length;
  for (const q of ['schůzka', 'rozpočet', 'projekt', 'zahrada', 'čaj', 'kniha', 'výlet', 'porada', 'nápad', 'úkol']) { await openBySearch(v, q); await sleep(800); }
  const search = durations(perfMarks(TEST_ID).slice(m1), (m) => m === 'route-ready:search');
  const m2 = perfMarks(TEST_ID).length;
  await v.click(`${FRAME} [data-command="phone.menu"]`);
  assert.ok(await v.waitFor(DRAWER, 3000), 'the drawer');
  await v.click(`${DRAWER} [data-command="goto.type:page"]`);
  await sleep(3000);
  const type = durations(perfMarks(TEST_ID).slice(m2), (m) => m === 'route-ready:type/page');
  console.log(`NFR-PERF-05 AC-6 (report-only): note-ready p95 ${p95(notes)} ms over ${notes.length}; route-ready:search p95 ${p95(search)} ms over ${search.length}; route-ready:type/page ${type[0]} ms`);
  assert.equal(notes.length, 20, `20 note-ready marks with their nav-start (${notes.length})`);
  assert.ok(p95(notes) <= 1000, `note-ready p95 ≤ 1,000 ms (${p95(notes)})`);
  assert.ok(search.length >= 10 && p95(search) <= 1000, `route-ready:search p95 ≤ 1,000 ms (${p95(search)} over ${search.length})`);
  assert.ok(type.length === 1 && type[0] <= 1500, `route-ready:type/page ≤ 1,500 ms (${type[0]})`);
});

test('fr_ux_07_ac18_indexing_status_on_the_phone', async () => {
  ready();
  const vault = generated();
  sh(`run-as ${TEST_ID} sh -c 'rm -rf files/*'`, false);
  const { v } = await launchPhone(vault, {}, views);
  const seen = await v.observeNever('[role="status"][aria-label="Indexing progress"]');
  const shown = await eventually(() => v.eval<boolean>(`!!document.querySelector('[role="status"][aria-label="Indexing progress"]')`), (x) => x, 10_000, 100);
  assert.ok(shown || await seen(), 'the first open shows the Indexing progress line');
  await eventually(() => perfMarks(TEST_ID).filter((m) => m.mark === 'index-idle'), (m) => m.length > 0, 600_000, 1000);
  assert.equal(await eventually(() => v.eval<boolean>(`!!document.querySelector('[role="status"][aria-label="Indexing progress"]')`), (x) => !x, 1000, 100), false, 'the line is gone after index-idle');
});
