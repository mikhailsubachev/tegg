// Slice 4E-1 real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/type-moves.md — every
// L6-once criterion of part one: FR-STO-04 AC-4 (Change type without a dialog moves the file: one job, route
// replaced, `Now a Kniha`, the linking note's path forms follow; every other file keeps bytes, mtime and inode),
// FR-STO-01 AC-8 (saving a new folder moves the six Knihy, zip first, `Moved 6 knihy`), AC-13 (on the 500-object type
// of the reference vault: `Moving knihy · <done> of 500`, then restoring the job's zip in Settings › Backups gives every
// file its pre-job path and bytes). The nightly crash criteria are in nightly_type_move_crash.ac.test.ts; the FR-UX-07
// AC-12 benchmark is perf_type_move.ts. Interface docs/contracts/ms4-jobs.md §14.7, §14.8, ms3-shell §1 (`TEGG_ROUTE`,
// `route-ready:<route>`), ms4-tags §5 (Settings › Backups). Always TEGG_TEST=1 with TEGG_NOW (the 4E test clock), a
// temporary Application Support and a temporary copy of the synthetic type-moves fixture (D-62). Written from the ACs
// and the contracts only (D-61). Shared helpers: app/e2e/helpers/capture.ts.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  FX, appiumDown, changedPaths, end, need, palette, paste, press, read, ready, session, shown, sleep, support, testEnv, textContains, tmp, tree,
  waitFile, waitMark, type Driver, type Entry,
} from './helpers/capture.ts';
import { OBJECTS, book, bookText, copyVault, linker, linkerText, prepareTypeVault } from './perf_type_move.ts';

after(appiumDown);
process.on('exit', appiumDown);

/** The 4E test clock (type-moves.md "Test clock"). */
const NOW4E = '2026-10-27T10:00:00+01:00';
const TZ4E = 'Europe/Prague';
const P = { plan: 'Quick Notes/Plán.md', odkazy: 'Pages/Odkazy.md', jinde: 'Pages/Kniha jinde.md', schJinde: 'Pages/Schůzka jinde.md' };
const SIX = ['Duna.md', 'Babička.md', 'Bez autora.md', 'Sešit.md', 'Starý zápis.md', 'Kniha jinde.md'];
const fx = (rel: string) => readFileSync(join(FX, 'type-moves', rel), 'utf8');
const files = (a: Record<string, Entry>, b: Record<string, Entry>) => changedPaths(a, b).filter((p) => !p.endsWith('/'));

/** A temp copy of tests/fixtures/vaults/type-moves (without README.md) plus new-empty/.tegg; `strays: false` leaves
 *  out the two strays, so no tidy job runs at open. Nápad gets its NFD name (the fixture README). */
function movesCopy(base: string, o: { strays?: boolean } = {}): string {
  const v = join(base, 'Přesuny');
  const src = join(FX, 'type-moves');
  cpSync(src, v, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  const napad = readFileSync(join(v, 'Quick Notes/Nápad.md'));
  rmSync(join(v, 'Quick Notes/Nápad.md'));
  writeFileSync(join(v, 'Quick Notes', 'Nápad.md'.normalize('NFD')), napad);
  if (o.strays === false) for (const p of [P.jinde, P.schJinde]) rmSync(join(v, p));
  return v;
}
type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver };
function fresh(name: string, vault?: (base: string) => string): Ctx {
  const base = tmp(`4e-${name}`);
  return { base, vault: vault ? vault(base) : movesCopy(base), sup: support(base), log: join(base, 'perf.jsonl') };
}
async function launch(c: Ctx, route: string): Promise<Driver> {
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW4E, TZ: TZ4E }));
  assert.ok(await waitMark(c.log, `route-ready:${route}`, 30_000), `${route} shown`);
  return c.d;
}
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
function zips(sup: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { if (!existsSync(d)) return; for (const n of readdirSync(d)) { const p = join(d, n); if (n.endsWith('.zip')) out.push(n); else if (!n.includes('.')) walk(p); } };
  walk(join(sup, 'backups'));
  return out.sort();
}
const masked = (t: string | null) => (t ?? '').replace(/^modified: .*$/m, 'modified: <x>');

// ------------------------------------------------------------------------------------------------ FR-STO-04 AC-4

test('fr_sto_04_ac4_change_type_moves_the_file_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('sto04ac4', (b) => movesCopy(b, { strays: false }));
  try {
    const d = await launch(c, `note/${P.plan}`);
    const before = tree(c.vault);
    palette('Change type…');
    await (await need(d, 'Kniha', 3000)).click();
    const t = await waitFile(join(c.vault, 'Knihy/Plán.md'), (x) => x !== null, 5000);
    const want = fx(P.plan)
      .replace('type: quick-note', 'type: kniha')
      .replace('Viz [[Plán cesty]].', 'Viz [[Quick Notes/Plán cesty|Plán cesty]].')
      .replace('[Rozpis](<Plán cesty.md>)', '[Rozpis](<../Quick Notes/Plán cesty.md>)');
    assert.equal(masked(t), masked(want), 'Knihy/Plán.md: type: kniha, a new modified, links kept (AC-8)');
    assert.match(t ?? '', /^modified: 2026-10-27T10:0\d:\d\d\+01:00$/m, 'modified from the test clock (FR-FMT-11)');
    assert.equal(existsSync(join(c.vault, P.plan)), false, 'Quick Notes/Plán.md is gone');
    const odkazy = fx(P.odkazy).replace('viz: "[[Quick Notes/Plán]]"', 'viz: "[[Knihy/Plán]]"').replace('\n[[Quick Notes/Plán]]\n', '\n[[Knihy/Plán]]\n').replace('[text](../Quick%20Notes/Plán.md)', '[text](../Knihy/Plán.md)');
    assert.equal(await waitFile(join(c.vault, P.odkazy), (x) => x === odkazy, 3000), odkazy, 'Odkazy: only the path forms change (AC-7)');
    assert.deepEqual(files(before, tree(c.vault)), [P.odkazy, 'Knihy/Plán.md', P.plan].sort(), 'only those files; every other file keeps bytes, mtime and inode');
    assert.ok(await waitMark(c.log, 'route-ready:note/Knihy/Plán.md', 3000), 'the route is replaced with note/Knihy/Plán.md');
    assert.ok(await shown(d, 'Now a Kniha', 3000), 'status `Now a Kniha`');
    assert.ok(await shown(d, 'Undo', 1000), 'with Undo');
    assert.deepEqual(zips(c.sup), [], 'no zip for a single-note move (board G)');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-STO-01 AC-8

test('fr_sto_01_ac8_saving_a_new_folder_moves_the_objects_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('sto01ac8');
  try {
    const d = await launch(c, 'type-settings/kniha');
    // The tidy job at open moves the two strays first (AC-9); then the six Knihy are all under Knihy/ (AP-779).
    assert.ok(await waitFile(join(c.vault, 'Knihy/Kniha jinde.md'), (x) => x !== null, 10_000) !== null, 'the tidy job at open');
    await sleep(500);
    const before = tree(c.vault);
    const pre = Object.fromEntries(SIX.map((n) => [n, read(c.vault, n === 'Starý zápis.md' ? 'Knihy/2025/Starý zápis.md' : `Knihy/${n}`)]));
    const zips0 = zips(c.sup).length;
    await (await need(d, 'Folder in the vault')).click();
    press('a', ['command']);
    paste('Četba');
    assert.ok(await shown(d, 'Saving moves 6 knihy from Knihy/ here (backup first; undo in the status strip).', 3000), 'the B1 help text');
    press('enter');
    const done = await waitFile(join(c.vault, 'Četba/Kniha jinde.md'), (x) => x !== null, 10_000);
    assert.ok(done !== null, 'the six are moved');
    const bad = SIX.filter((n) => read(c.vault, `Četba/${n}`) !== pre[n]);
    assert.deepEqual(bad, [], 'each with its exact bytes (no modified: its type didn\'t change)');
    assert.ok(read(c.vault, '.tegg/types/kniha.yml')?.includes('\nfolder: Četba\n'), 'folder: Četba');
    assert.ok(existsSync(join(c.vault, 'Knihy/seznam.docx')), 'seznam.docx stays (data-safety AC-6)');
    const ch = files(before, tree(c.vault));
    const want = [...SIX.map((n) => `Četba/${n}`), ...SIX.map((n) => (n === 'Starý zápis.md' ? 'Knihy/2025/Starý zápis.md' : `Knihy/${n}`)), '.tegg/types/kniha.yml'].sort();
    assert.deepEqual(ch, want, 'only the six and the type file');
    assert.equal(zips(c.sup).length, zips0 + 1, 'one more zip (`Move knihy to Četba`)');
    assert.ok(await shown(d, 'Moved 6 knihy', 3000), 'status `Moved 6 knihy`');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-STO-01 AC-13

test('fr_sto_01_ac13_progress_and_restore_on_500_objects_in_the_real_app', { timeout: 900_000 }, async () => {
  await ready();
  const c = fresh('sto01ac13', (b) => {
    const prepared = prepareTypeVault(b);
    assert.ok(prepared, 'reference vault could not be generated (tools/gen-vault --seed 1 --small-images)');
    return copyVault(prepared!, join(b, 'Reference'));
  });
  try {
    const d = await launch(c, 'type-settings/kniha');
    await sleep(1000);
    const before = tree(c.vault);
    await (await need(d, 'Folder in the vault')).click();
    press('a', ['command']);
    paste('Četba');
    press('enter');
    let progress = false;
    for (let i = 0; i < 100 && !progress; i++) {
      progress = (await d.$$(`-ios predicate string:${textContains('Moving knihy · ')}`).catch(() => [] as any[])).length > 0;
      if (!progress) await sleep(50);
    }
    assert.ok(progress, 'status `Moving knihy · <done> of 500` while writing (FR-UX-07 AC-8)');
    let moved = 0;
    const endAt = Date.now() + 180_000;
    while (Date.now() < endAt && moved < OBJECTS) {
      moved = 0;
      for (let i = 1; i <= OBJECTS; i++) if (read(c.vault, book(i, 'Četba')) === bookText(i)) moved++;
      if (moved < OBJECTS) await sleep(500);
    }
    assert.equal(moved, OBJECTS, 'all 500 moved');
    palette('Go to Settings: Backups');
    await (await need(d, 'Restore "Move knihy to Četba"…', 5000)).click();
    await (await need(d, 'Restore', 3000)).click();
    let back = 0;
    const endB = Date.now() + 180_000;
    while (Date.now() < endB && back < OBJECTS) {
      back = 0;
      for (let i = 1; i <= OBJECTS; i++) if (read(c.vault, book(i)) === bookText(i) && read(c.vault, linker(i)) === linkerText(i) && !existsSync(join(c.vault, book(i, 'Četba')))) back++;
      if (back < OBJECTS) await sleep(500);
    }
    assert.equal(back, OBJECTS, 'restoring the zip moves every file back with its pre-job bytes (ms4-tags §5.3)');
    const after = tree(c.vault);
    const differ = Object.keys(before).filter((k) => !k.endsWith('/') && k.endsWith('.md') && (after[k] === undefined || (after[k] as any).sha !== (before[k] as any).sha));
    assert.deepEqual(differ, [], 'every note has its pre-job path and bytes (sha256)');
  } finally { await cleanup(c); }
});
