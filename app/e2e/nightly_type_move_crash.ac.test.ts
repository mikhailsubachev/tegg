// Slice 4E-1 real-app tests, nightly (L6): docs/acceptance/type-moves.md FR-STO-04 AC-14 "Crash during a single move"
// and FR-STO-01 AC-14 "Crash during a move (T1)". The test build is SIGKILLed at a random time after the gesture, in
// TEGG_KILL_CYCLES cycles (default 20):
//   - FR-STO-04 AC-14: Plán › Kniha on the type-moves fixture. Afterwards every file is its pre-job or post-job version
//     (FR-SYN-02 AC-3); when the note was moved but Odkazy not rewritten, the next open shows `Changing the type of
//     "Plán" was interrupted: 0 of 1 links updated` with `Finish` and `Undo` (ms4-jobs §8, §14.6 `job.interrupted.
//     typeMove`): Finish rewrites Odkazy as AC-7 (even cycles), Undo moves the note back with its old bytes (odd).
//   - FR-STO-01 AC-14: the folder save Knihy → Četba on the 500-object type of the reference vault (perf_type_move.ts),
//     killed while writing. Every note exists exactly once, at its old or its new path, with its pre-job or fully
//     rewritten bytes; no `.tegg-tmp` survives the next open; the next tidy run finishes the move; the job's zip holds
//     every file's pre-job path and bytes (sha256), which is what restoring it writes (ms4-tags §5.3).
// The kill leaves temp files only seconds old; FR-SYN-02 AC-4 removes leftovers older than one minute, so the test ages
// them before the next open (the D-344 practice). Run by the nightly step `app-e2e-nightly`. Written from the ACs and
// the contracts only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join, relative } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  APP, FX, appiumDown, end, need, palette, paste, press, read, session, shown, sleep, support, testEnv, tmp, waitMark, type Driver,
} from './helpers/capture.ts';
import { OBJECTS, book, bookText, copyVault, linker, linkerText, prepareTypeVault } from './perf_type_move.ts';

after(appiumDown);
process.on('exit', appiumDown);

const CYCLES = Number(process.env.TEGG_KILL_CYCLES ?? 20);
const NOW4E = '2026-10-27T10:00:00+01:00';
const env = (sup: string, log: string, vault: string, route: string) => testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: route, TEGG_NOW: NOW4E, TZ: 'Europe/Prague', TEGG_TEST_TIDY: '1' });
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function files(root: string): Map<string, string> {
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
  for (const [p] of files(root)) if (p.includes('.tegg-tmp')) utimesSync(join(root, p), old, old);
}
function killApp() {
  try { execFileSync('pkill', ['-9', '-f', join(APP, 'Contents/MacOS/tegg')]); } catch { /* not running */ }
}
const fx = (rel: string) => readFileSync(join(FX, 'type-moves', rel), 'utf8');
function movesCopy(base: string): string {
  const v = join(base, 'Přesuny');
  const src = join(FX, 'type-moves');
  cpSync(src, v, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  for (const p of ['Pages/Kniha jinde.md', 'Pages/Schůzka jinde.md']) rmSync(join(v, p)); // no tidy job at open
  return v;
}

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-14

test('fr_sto_04_ac14_crash_during_a_single_move_finish_or_undo', { timeout: CYCLES * 240_000 }, async () => {
  assert.ok(existsSync(APP), `app not built: ${APP} (cd app && npm run app:build)`);
  const plan = 'Quick Notes/Plán.md', moved = 'Knihy/Plán.md', odkazy = 'Pages/Odkazy.md';
  const odkazyAfter = fx(odkazy).replace('viz: "[[Quick Notes/Plán]]"', 'viz: "[[Knihy/Plán]]"').replace('\n[[Quick Notes/Plán]]\n', '\n[[Knihy/Plán]]\n').replace('[text](../Quick%20Notes/Plán.md)', '[text](../Knihy/Plán.md)');
  let interrupted = 0;
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const base = tmp(`4e-crash-${cycle}`);
    let d: Driver | undefined;
    try {
      const vault = movesCopy(base);
      const sup = support(base);
      const log = join(base, 'perf.jsonl');
      d = await session(env(sup, log, vault, `note/${plan}`));
      assert.ok(await waitMark(log, `route-ready:note/${plan}`, 30_000), `cycle ${cycle}: Plán shown`);
      palette('Change type…');
      const kniha = await need(d, 'Kniha', 3000);
      setTimeout(killApp, Math.floor(Math.random() * 120));
      await kniha.click().catch(() => {});
      await sleep(1500);
      killApp();
      await end(d).catch(() => {});
      d = undefined;
      const p = read(vault, plan), m = read(vault, moved), o = read(vault, odkazy);
      assert.ok((p === null) !== (m === null), `cycle ${cycle}: Plán exists exactly once`);
      assert.ok(p === null || p === fx(plan), `cycle ${cycle}: Quick Notes/Plán.md is its pre-job version`);
      assert.ok(o === fx(odkazy) || o === odkazyAfter, `cycle ${cycle}: Odkazy is its pre-job or post-job version (FR-SYN-02 AC-3)`);
      ageTemps(vault);
      const log2 = join(base, 'perf2.jsonl');
      d = await session(env(sup, log2, vault, `note/${odkazy}`));
      assert.ok(await waitMark(log2, `route-ready:note/${odkazy}`, 30_000), `cycle ${cycle}: reopened`);
      assert.deepEqual([...files(vault).keys()].filter((k) => k.includes('.tegg-tmp')), [], `cycle ${cycle}: no .tegg-tmp survives the next open`);
      if (m !== null && o === fx(odkazy)) {
        interrupted++;
        assert.ok(await shown(d, 'Changing the type of "Plán" was interrupted: 0 of 1 links updated', 5000), `cycle ${cycle}: the §8 banner`);
        if (cycle % 2 === 0) {
          await (await need(d, 'Finish')).click();
          assert.equal(await waitFor(() => read(vault, odkazy) === odkazyAfter, 5000), true, `cycle ${cycle}: Finish rewrites Odkazy as AC-7`);
        } else {
          await (await need(d, 'Undo')).click();
          assert.equal(await waitFor(() => read(vault, plan) === fx(plan) && read(vault, moved) === null, 5000), true, `cycle ${cycle}: Undo moves the note back with its old bytes`);
          assert.equal(read(vault, odkazy), fx(odkazy), `cycle ${cycle}: Odkazy untouched`);
        }
      }
    } finally {
      await end(d).catch(() => {});
      rmSync(base, { recursive: true, force: true });
    }
  }
  console.log(`FR-STO-04 AC-14: ${interrupted} of ${CYCLES} cycles were cut between the note's rename and Odkazy's rewrite`);
});
async function waitFor(ok: () => boolean, ms: number): Promise<boolean> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) { if (ok()) return true; await sleep(50); }
  return ok();
}

// ------------------------------------------------------------------------------------------------ FR-STO-01 AC-14

/** The stored or deflated entries of a zip by its local headers (name → bytes). */
function zipEntries(path: string): Map<string, Buffer> {
  const b = readFileSync(path);
  const out = new Map<string, Buffer>();
  let at = 0;
  while (b.readUInt32LE(at) === 0x04034b50) {
    const method = b.readUInt16LE(at + 8), size = b.readUInt32LE(at + 18), n = b.readUInt16LE(at + 26), x = b.readUInt16LE(at + 28);
    const name = b.subarray(at + 30, at + 30 + n).toString('utf8').normalize('NFC');
    const data = b.subarray(at + 30 + n + x, at + 30 + n + x + size);
    out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at += 30 + n + x + size;
  }
  return out;
}
function zipsIn(sup: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { if (!existsSync(d)) return; for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.zip')) out.push(p); } };
  walk(join(sup, 'backups'));
  return out.sort();
}

test('fr_sto_01_ac14_crash_during_a_500_object_folder_move', { timeout: CYCLES * 600_000 }, async () => {
  assert.ok(existsSync(APP), `app not built: ${APP} (cd app && npm run app:build)`);
  const root = tmp('4e-crash-ref');
  try {
    const prepared = prepareTypeVault(root);
    assert.ok(prepared, 'reference vault could not be generated (tools/gen-vault --seed 1 --small-images)');
    for (let cycle = 0; cycle < CYCLES; cycle++) {
      const base = join(root, `cycle-${cycle}`);
      let d: Driver | undefined;
      try {
        const vault = copyVault(prepared!, join(base, 'Reference'));
        const sup = support(base);
        const log = join(base, 'perf.jsonl');
        const pre = files(vault);
        d = await session(env(sup, log, vault, 'type-settings/kniha'));
        assert.ok(await waitMark(log, 'route-ready:type-settings/kniha', 60_000), `cycle ${cycle}: type settings shown`);
        await (await need(d, 'Folder in the vault')).click();
        press('a', ['command']);
        paste('Četba');
        press('enter');
        await sleep(300 + Math.floor(Math.random() * 3000));
        killApp();
        await end(d).catch(() => {});
        d = undefined;
        const bad: string[] = [];
        for (let i = 1; i <= OBJECTS; i++) {
          const old = read(vault, book(i)), now = read(vault, book(i, 'Četba'));
          if ((old === null) === (now === null)) bad.push(`${book(i)}: ${old === null ? 'nowhere' : 'twice'}`);
          else if ((old ?? now) !== bookText(i)) bad.push(`${book(i)}: bytes`);
          const l = read(vault, linker(i));
          if (l !== linkerText(i) && l !== linkerText(i, 'Četba')) bad.push(`${linker(i)}: neither pre-job nor rewritten`);
        }
        assert.deepEqual(bad, [], `cycle ${cycle}: every note exists exactly once at its old or new path with its pre-job or rewritten bytes`);
        const z = zipsIn(sup);
        assert.ok(z.length >= 1, `cycle ${cycle}: the job's zip exists (it is made before the first write)`);
        const entries = zipEntries(z[z.length - 1]);
        const missing = [...pre].filter(([p, h]) => p.endsWith('.md') && (!entries.has(p) || sha(entries.get(p)!) !== h)).map(([p]) => p);
        assert.deepEqual(missing.slice(0, 5), [], `cycle ${cycle}: restoring the zip gives every file its pre-job path and bytes (${missing.length} differ)`);
        ageTemps(vault);
        const log2 = join(base, 'perf2.jsonl');
        d = await session(env(sup, log2, vault, 'type/kniha'));
        assert.ok(await waitMark(log2, 'route-ready:type/kniha', 60_000), `cycle ${cycle}: reopened`);
        assert.deepEqual([...files(vault).keys()].filter((k) => k.includes('.tegg-tmp')), [], `cycle ${cycle}: no .tegg-tmp survives the next open`);
        const kniha = read(vault, '.tegg/types/kniha.yml') ?? '';
        if (kniha.includes('\nfolder: Četba\n')) {
          assert.equal(await waitFor(() => { for (let i = 1; i <= OBJECTS; i++) if (read(vault, book(i)) !== null) return false; return true; }, 120_000), true, `cycle ${cycle}: the next tidy run finishes the move`);
        }
      } finally {
        await end(d).catch(() => {});
        killApp();
        rmSync(base, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
