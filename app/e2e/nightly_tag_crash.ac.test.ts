// MS4 slice 4D-lite real-app test, nightly (L6): docs/acceptance/tags.md FR-TAG-04 AC-10 "Crash during a tag rename".
// In 20 cycles (TEGG_KILL_CYCLES) on the reference vault with a tag on 500 notes (perf_tag_page.ts), the test build is
// SIGKILLed at a random time during `writing` of a `tag-rename`. Afterwards every vault file is its pre-job or its fully
// rewritten version (FR-SYN-02 AC-3); no `.tegg-tmp` survives the next open; the job's zip is listed in Settings ›
// Backups, and restoring it (FR-HIS-04 AC-8) gives every file its pre-job bytes (sha256). The rename is started with
// `TEGG_ROUTE=tag/<key>`, the palette's `Rename tag…`, the new name and ⏎ (the dialog's Rename confirms, ms4-tags §4.4).
// Run by the nightly step `app-e2e-nightly`. Written from the AC and the contracts only (D-61).
//
// The kill leaves temp files only seconds old; FR-SYN-02 AC-4 removes leftovers older than one minute, so the test ages
// them before "the next open", as nightly_rename_crash.ac.test.ts does.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { appiumDown, end, need, palette, paste, press, ready, session, shown, testEnv } from './helpers/capture.ts';
import { TAG, generateVault, launch, sleep, tagNotes, tagRoute, waitMark } from './perf_tag_page.ts';

after(appiumDown);
process.on('exit', appiumDown);
const CYCLES = Number(process.env.TEGG_KILL_CYCLES ?? 20);
const NEW = 'přejmenovaný-štítek';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function shas(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(root, p).normalize('NFC'), sha(readFileSync(p)));
    }
  };
  walk(root);
  return out;
}
function ageTemps(root: string) {
  const old = new Date(Date.now() - 5 * 60_000);
  for (const [p] of shas(root)) if (p.includes('.tegg-tmp')) utimesSync(join(root, p), old, old);
}

test('fr_tag_04_ac10_crash_during_a_tag_rename', { timeout: 6 * 60 * 60_000 }, async () => {
  await ready();
  const base = mkdtempSync(join(tmpdir(), 'tegg-fr-tag-04-ac10-'));
  try {
    const ref = generateVault(join(base, 'ref'));
    assert.ok(ref, 'the reference vault (tools/gen-vault --seed 1 --small-images)');
    const tagged = new Set(tagNotes(ref!, 500));
    const pre = shas(ref!);
    const post = new Map<string, string>();
    for (const p of tagged) post.set(p, sha(Buffer.from(readFileSync(join(ref!, p), 'utf8').replace(`\n#${TAG}\n`, `\n#${NEW}\n`))));
    const problems: string[] = [];
    for (let cycle = 0; cycle < CYCLES; cycle++) {
      const v = join(base, `v${cycle}`);
      cpSync(ref!, v, { recursive: true });
      const sup = join(base, `sup${cycle}`);
      const log = join(base, `run${cycle}.jsonl`);
      const child = launch({ TEGG_TEST: '1', TEGG_APP_SUPPORT: sup, TEGG_VAULT: v, TEGG_ROUTE: tagRoute(TAG), TEGG_PERF_LOG: log });
      assert.ok(await waitMark(log, (m) => m.startsWith('route-ready:tag/'), 60_000), `cycle ${cycle}: the tag page`);
      palette('Rename tag…');
      await sleep(400);
      press('a', ['command']);
      paste(NEW);
      press('enter');
      await sleep(300 + Math.floor(Math.random() * 3000));
      child.kill('SIGKILL');
      await sleep(300);
      const now = shas(v);
      for (const [p, h] of pre) {
        if (p.includes('.tegg-tmp')) continue;
        const n = now.get(p);
        if (n !== h && n !== post.get(p)) problems.push(`cycle ${cycle}: ${p} is neither its pre-job nor its rewritten version`);
      }
      ageTemps(v);
      const d = await session(testEnv(sup, join(base, `next${cycle}.jsonl`), { TEGG_VAULT: v, TEGG_ROUTE: 'settings/backups' }));
      try {
        await sleep(1500);
        if ([...shas(v).keys()].some((p) => p.includes('.tegg-tmp'))) problems.push(`cycle ${cycle}: a .tegg-tmp survived the next open`);
        const restore = await need(d, `Restore "Rename #${TAG} to #${NEW}"…`, 5000);
        await restore.click();
        assert.ok(await shown(d, 'Restore this backup?', 2000), `cycle ${cycle}: the restore dialog`);
        await (await need(d, 'Restore')).click();
        await sleep(3000);
        const back = shas(v);
        for (const [p, h] of pre) if (!p.includes('.tegg-tmp') && back.get(p) !== h) problems.push(`cycle ${cycle}: ${p} doesn't have its pre-job bytes after the restore`);
      } finally { await end(d); }
      rmSync(v, { recursive: true, force: true });
      if (problems.length > 20) break;
    }
    assert.deepEqual(problems, [], 'FR-TAG-04 AC-10');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  void existsSync;
});
