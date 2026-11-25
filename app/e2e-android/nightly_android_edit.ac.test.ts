// Slice AND-3, LA nightly (the test APK on the emulator with the test input method; contract
// docs/contracts/android-edit.md §5.3, §15.2, §16.2 `type`, §17.2): docs/acceptance/android-edit.md
// - FR-SYN-02 AC-16 (killed while typing; T1): 20 cycles of `kill -9` 2–10 s after the first key of a 50 ms typing run
//   into block 5 of Deset bloků; 5 cycles each during a draft's and the virtual day's first write; after the next start
//   no temp file is left;
// - NFR-PERF-06 AC-8 (report-only bounds, D-2010; AP-2085 → D-2520): 200 keystrokes, one every 80 ms, into the middle of
//   the generated 5,000-word note while autosave runs; ≥ 90 % painted within 2 frames and none after frame 6;
// - NFR-PERF-05 AC-7 (report-only bounds): `note-ready` for 20 opens of notes under 5,000 words p95 ≤ 1,000 ms, and
//   `first-write` for 10 drafts p95 ≤ 500 ms, on `tools/gen-vault --seed 1 --small-images` after `index-idle`.
// Every test starts with `ready()` (requireDevice, the test APK, the test IME): without an emulator it fails, never
// skips. The numbers are printed (report-only); a run fails only beyond the bounds.
// Written from the ACs and the contract only (D-61).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  adb, eventually, install, perfMarks, pidOf, quote, REPO, requireDevice, sh, SHARED, sleep, start, TEST_APK, TEST_ID, webview, type Mark, type WebView,
} from './helpers/device.ts';
import { caretIn, FRAME, launchPhone, pushEdit, tapWord, tmpFiles } from './helpers/phone.ts';
import { imeCommit, imeRestore, imeStop, imeType, imeUse } from './helpers/ime.ts';

const views: WebView[] = [];
let installed = false;
let local = '';
let remote = '';
function ready() {
  requireDevice();
  if (!installed) { install(TEST_APK); installed = true; }
  imeUse();
}
before(() => { local = mkdtempSync(join(tmpdir(), 'tegg-la-and3-')); });
after(() => {
  for (const v of views) v.close();
  imeRestore();
  if (local) rmSync(local, { recursive: true, force: true });
  adb(['shell', `rm -rf ${SHARED}/Documents/tegg-la-*`]);
});
const NOW = '2026-10-14T12:00:00+02:00';
const BODY = '[role="textbox"][aria-label="Note body"]';
const read = (path: string) => sh(`cat ${quote(path)}`, false);
/** The title of the generated vault's largest note (the `--perf-note` one), from the local copy. */
function longestTitle(): string {
  let best = { size: -1, path: '' };
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) { if (!n.startsWith('.') && !n.startsWith('_')) walk(p); } else if (n.endsWith('.md') && st.size > best.size) best = { size: st.size, path: p };
    }
  };
  walk(join(local, 'vault'));
  assert.ok(best.path, 'the generated vault has notes');
  const text = readFileSync(best.path, 'utf8');
  return (/^title: "?(.*?)"?$/m.exec(text)?.[1] ?? best.path.split('/').pop()!.replace(/\.md$/, '')).trim();
}
const p95 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };
/** The generated vault (with `--perf-note`) on the device, made once per run. */
function generated(): string {
  if (remote) return remote;
  const out = join(local, 'vault');
  const g = spawnSync('cargo', ['run', '--release', '--quiet', '--manifest-path', join(REPO, 'tools/gen-vault/Cargo.toml'), '--', '--seed', '1', '--small-images', '--perf-note', '--out', out], { encoding: 'utf8', timeout: 900_000 });
  assert.equal(g.status, 0, `tools/gen-vault runs: ${g.stderr?.slice(-400)}`);
  remote = `${SHARED}/Documents/tegg-la-gen-and3/Generovaný`;
  sh(`mkdir -p ${quote(remote)}`);
  const p = adb(['push', `${out}/.`, remote]);
  assert.equal(p.status, 0, `adb push the generated vault: ${p.stderr}`);
  return remote;
}

// ------------------------------------------------------------------------------------------------ FR-SYN-02 AC-16

test('nightly_fr_syn_02_ac16_killed_while_typing_on_the_phone', async () => {
  ready();
  const orig = readFileSync(resolve(REPO, 'tests/fixtures/vaults/editor/Pages/Deset bloků.md'), 'utf8');
  const typed = 'Kočka leze dírou, pes oknem; žluťoučký kůň úpěl ďábelské ódy. '.repeat(4);
  for (let cycle = 0; cycle < 20; cycle++) {
    const vault = pushEdit();
    const { v } = await launchPhone(vault, { TEGG_ROUTE: 'note/Pages/Deset bloků.md', TEGG_NOW: NOW }, views);
    assert.ok(await v.waitFor(BODY, 15_000), `cycle ${cycle}: the editor`);
    await tapWord(v, 'Pátý');
    await caretIn(v, 'test upraví.', 'end');
    const at = 2000 + Math.floor(Math.random() * 8000);
    const t0 = Date.now();
    imeType(typed, 50);
    await sleep(at);
    const pid = pidOf(TEST_ID);
    assert.ok(pid, 'the app runs');
    sh(`kill -9 ${pid}`, false);
    const elapsed = Date.now() - t0;
    const t = read(`${vault}/Pages/Deset bloků.md`);
    assert.match(t, /^---\n[\s\S]*?\n---\n/, `cycle ${cycle}: the frontmatter is valid`);
    const line = t.split('\n').find((l) => l.startsWith('Pátý blok, který test upraví.')) ?? '';
    const got = line.slice('Pátý blok, který test upraví.'.length);
    assert.ok(typed.startsWith(got), `cycle ${cycle}: block 5 holds a prefix of the typed text`);
    const typedCount = Math.min(typed.length, Math.floor(elapsed / 50));
    assert.ok(typedCount - [...got].length <= Math.ceil(1200 / 50) + 2, `cycle ${cycle}: at most the last 1.2 s is missing (${typedCount - [...got].length} characters)`);
    assert.equal(t.replace(line, 'Pátý blok, který test upraví.').replace(/^modified: .*$/m, ''), orig.replace(/^modified: .*$/m, ''), `cycle ${cycle}: the rest is the original`);
  }
  // 5 cycles each during the first write of a draft and of the virtual day: no file or a complete one
  for (const route of ['new/quick-note', 'daily/2026-10-14']) {
    for (let cycle = 0; cycle < 5; cycle++) {
      const vault = pushEdit();
      const { v } = await launchPhone(vault, { TEGG_ROUTE: route, TEGG_NOW: NOW }, views);
      await sleep(1500);
      if (route === 'daily/2026-10-14') await v.click(BODY).catch(() => undefined);
      imeCommit('Rychlý zápis');
      await sleep(Math.floor(Math.random() * 400));
      sh(`kill -9 ${pidOf(TEST_ID)}`, false);
      const dir = route.startsWith('new/') ? 'Quick Notes' : 'Daily';
      const names = sh(`ls ${quote(`${vault}/${dir}`)} 2>/dev/null`, false).split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.md'));
      for (const n of names) assert.match(read(`${vault}/${dir}/${n}`), /^---\n[\s\S]*?\n---\n/, `${route} cycle ${cycle}: ${n} is complete`);
      // the next start cleans temp files older than 1 minute (data-safety FR-SYN-02 AC-4)
      sh(`find ${quote(vault)} -name '*.tegg-tmp' -exec touch -d '2026-01-01 00:00:00' {} +`, false);
      start(TEST_ID);
      const v2 = await webview(TEST_ID);
      views.push(v2);
      assert.ok(await v2.waitFor(FRAME, 30_000), 'the next start');
      await sleep(1500);
      assert.deepEqual(tmpFiles(vault), [], `${route} cycle ${cycle}: no temp file is left after the next start`);
    }
  }
});

// ------------------------------------------------------------------------------------------------ NFR-PERF-06 AC-8

test('nightly_nfr_perf_06_ac8_typing_on_the_emulator', async () => {
  ready();
  const vault = generated();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'inbox' }, views);
  await eventually(() => perfMarks(TEST_ID).some((m) => m.mark === 'index-idle'), (x) => x, 300_000, 1000);
  // the 5,000-word note is the generated vault's longest (`--perf-note` picks it by size), opened by its title
  const title = longestTitle();
  await v.click(`${FRAME} [data-command="goto.search"]`);
  await v.eval(`(() => { const i = document.querySelector('header[role="banner"] [role="search"] input'); i.focus(); i.select(); return true; })()`);
  await v.type(title);
  await sleep(700);
  const before = perfMarks(TEST_ID).length;
  await v.key('Enter');
  assert.ok(await v.waitFor(BODY, 15_000), `${title} in the editor`);
  await v.eval(`(() => { const b = document.querySelector('${BODY}'); b.focus(); const p = b.children[Math.floor(b.children.length / 2)]; const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
  imeType('a'.repeat(200), 80);
  await sleep(200 * 80 + 2000);
  imeStop();
  const keys = perfMarks(TEST_ID).slice(before).filter((m: Mark) => m.mark === 'key').map((m) => Number(m.frame));
  const sorted = [...keys].sort((a, b) => a - b);
  console.log(`NFR-PERF-06 AC-8 (report): ${keys.length} keys, p50 ${sorted[Math.floor(sorted.length / 2)]}, p95 ${p95(keys)}, max ${Math.max(...keys)} frames`);
  assert.ok(keys.length >= 200, `200 keystrokes measured (${keys.length})`);
  assert.ok(keys.filter((f) => f <= 2).length / keys.length >= 0.9, 'at least 90 % painted within 2 frames');
  assert.ok(keys.every((f) => f <= 6), 'none painted after frame 6');
});

// ------------------------------------------------------------------------------------------------ NFR-PERF-05 AC-7

test('nightly_nfr_perf_05_ac7_opening_for_editing_on_the_emulator', async () => {
  ready();
  const vault = generated();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'inbox' }, views);
  await eventually(() => perfMarks(TEST_ID).some((m) => m.mark === 'index-idle'), (x) => x, 300_000, 1000);
  const names = sh(`ls ${quote(`${vault}/Pages`)} | head -20`, false).split('\n').map((l) => l.trim().replace(/\.md$/, '')).filter(Boolean);
  assert.equal(names.length, 20, '20 notes');
  const ready_: number[] = [];
  for (const n of names) {
    const from = perfMarks(TEST_ID).length;
    await v.click(`${FRAME} [data-command="goto.search"]`);
    await v.eval(`(() => { const i = document.querySelector('header[role="banner"] [role="search"] input'); i.focus(); i.select(); return true; })()`);
    await v.type(n);
    await sleep(600);
    await v.key('Enter');
    assert.ok(await v.waitFor(BODY, 10_000), `${n}: the editor`);
    const marks = perfMarks(TEST_ID).slice(from);
    const startAt = [...marks].reverse().find((m) => m.mark.startsWith('nav-start:'))?.ms;
    const readyAt = marks.find((m) => m.mark === 'note-ready')?.ms;
    assert.ok(startAt !== undefined && readyAt !== undefined, `${n}: nav-start and note-ready marks`);
    ready_.push(readyAt! - startAt!);
  }
  const writes: number[] = [];
  for (let i = 0; i < 10; i++) {
    const from = perfMarks(TEST_ID).length;
    await v.click('[data-command="object.new"]');
    await sleep(400);
    await v.eval(`(() => { const o = [...document.querySelectorAll('[role="dialog"][aria-label="New object"] [role="option"]')].find((x) => /^Page/.test(x.innerText)); o.click(); return true; })()`);
    await sleep(400);
    imeCommit(`Koncept ${i + 1}`);
    await v.key('Enter');
    const m = await eventually(() => perfMarks(TEST_ID).slice(from).find((x) => x.mark === 'first-write'), (x) => !!x, 5000);
    assert.ok(m, `draft ${i + 1}: the first-write mark`);
    writes.push(Number(m!.ms));
  }
  console.log(`NFR-PERF-05 AC-7 (report): note-ready p95 ${p95(ready_)} ms, first-write p95 ${p95(writes)} ms`);
  assert.ok(p95(ready_) <= 1000, `note-ready p95 ≤ 1,000 ms (${p95(ready_)})`);
  assert.ok(p95(writes) <= 500, `first-write p95 ≤ 500 ms (${p95(writes)})`);
});
