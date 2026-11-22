// Slice AND-1, LA nightly: docs/acceptance/android-shell.md FR-SYN-03 AC-34 "The generated vault settles on the device"
// (F1; T2). `tools/gen-vault --seed 1 --small-images` is generated on the Mac into a temporary folder, pushed to shared
// storage and opened on the test APK: `index-idle` within 120 s (a bound on a defect, not a phone target, D-2010); in
// the 60 s after, no second `index-idle` and at most 3 s of CPU; `index_type_counts` equals the counts of the same vault
// on the Mac host.
// Red-test reading (reported): "the counts of the same vault indexed by the core on the Mac host" are computed here from
// the files with the core's counting rules as the tests know them (one count per `.md` object outside dot folders and
// `_templates/`, keyed by its `type`, an untyped file counting as `page`, D-103), since the LA harness has no Rust core.
// Every test starts with `requireDevice()` (fails, never skips). Written from the ACs and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  adb, appops, clearPrivate, cpuTicks, eventually, forceStop, install, perfMarks, REPO, requireDevice, sh, SHARED, sleep, start, TEST_APK, TEST_ID,
  typeCounts, webview, writeTestEnv, type WebView,
} from './helpers/device.ts';

let tmp = '';
const views: WebView[] = [];
after(() => {
  for (const v of views) v.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  adb(['shell', `rm -rf ${SHARED}/Documents/tegg-la-gen`]);
});

function hostCounts(root: string): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (d: string, rel: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) {
        if (n.startsWith('.') || (rel === '' && n === '_templates')) continue;
        walk(p, `${rel}${n}/`);
      } else if (n.endsWith('.md')) {
        const fm = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(p, 'utf8'));
        const type = (fm && /^type:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(fm[1])?.[1]) || 'page';
        // D-2051: the index counts system types by their key (`Daily Note` → `daily-note`), other types as written.
        const SYSTEM: Record<string, string> = { Page: 'page', Task: 'task', 'Quick Note': 'quick-note', 'Daily Note': 'daily-note', Tag: 'tag', Image: 'image', PDF: 'pdf' };
        const key = SYSTEM[type] ?? type;
        out[key] = (out[key] ?? 0) + 1;
      }
    }
  };
  walk(root, '');
  return out;
}

test('nightly_fr_syn_03_ac34_generated_vault_settles_on_android', async () => {
  requireDevice();
  install(TEST_APK);
  tmp = mkdtempSync(join(tmpdir(), 'tegg-la-gen-'));
  const local = join(tmp, 'vault');
  const gen = spawnSync('cargo', ['run', '--release', '--quiet', '--manifest-path', resolve(REPO, 'tools/gen-vault/Cargo.toml'), '--', '--seed', '1', '--small-images', '--out', local], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(gen.status, 0, `gen-vault --seed 1 --small-images: ${gen.stderr?.slice(-400)}`);
  const want = hostCounts(local);
  const vault = `${SHARED}/Documents/tegg-la-gen/vault`;
  sh(`rm -rf ${SHARED}/Documents/tegg-la-gen && mkdir -p ${SHARED}/Documents/tegg-la-gen`);
  const pushed = adb(['push', local, `${SHARED}/Documents/tegg-la-gen/`]);
  assert.equal(pushed.status, 0, `push the generated vault: ${pushed.stderr}`);

  forceStop(TEST_ID);
  clearPrivate(TEST_ID);
  appops(TEST_ID, 'allow');
  writeTestEnv(TEST_ID, { TEGG_VAULT: vault });
  const pid = start(TEST_ID);
  const v = await webview(TEST_ID, 30_000);
  views.push(v);
  const idle = () => perfMarks(TEST_ID).filter((m) => m.mark === 'index-idle');
  const first = await eventually(idle, (m) => m.length > 0, 120_000, 1000);
  assert.ok(first.length > 0, 'index-idle within 120 s');
  const c0 = cpuTicks(pid);
  await sleep(60_000);
  const c1 = cpuTicks(pid);
  const marks = idle();
  assert.equal(marks.filter((m) => m.ms > first[0].ms && m.ms <= first[0].ms + 60_000).length, 0, `no second index-idle in the 60 s after: ${marks.map((m) => Math.round(m.ms)).join(', ')}`);
  const cpu = (c1.ticks - c0.ticks) / c1.hz;
  assert.ok(cpu <= 3, `at most 3 s of CPU in those 60 s; used ${cpu.toFixed(2)} s`);
  assert.deepEqual(await typeCounts(v), want, 'index_type_counts equals the host\'s counts of the same vault');
});
