// MS4 slice 4C real-app test, nightly (L6): docs/acceptance/rename.md FR-LNK-03 AC-17 "Crash during the job". In 20
// cycles (TEGG_KILL_CYCLES) on the 500-backlink hub of the generated vault (perf_rename.ts), the test build is
// SIGKILLed at a random time after the title commit. Afterwards every vault file is its pre-job or its fully rewritten
// version (FR-SYN-02 AC-3); on the next open no `.tegg-tmp` survives (data-safety AC-4) and, when the rename was cut
// short, the app shows `Renaming "Rozbočovač" was interrupted: <k> of <n> links updated` with `Finish` and `Undo`
// (D-387, docs/contracts/ms4-jobs.md §8); after Finish the hub has all 500 backlinks (the index resolves every link).
// Run by the nightly step `app-e2e-nightly`. Written from the AC and the contract only (D-61).
//
// The kill leaves temp files only seconds old; FR-SYN-02 AC-4 removes leftovers older than one minute, so the test
// ages them before "the next open", as a real next launch would find them (the D-344 practice of ac_daily.rs).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import {
  APP, EXE, HUB, HUB_TEXT, LINKS, NEW_HUB, NEW_TITLE, commitTitle, copyVault, launch, linker, linkerText, prepareHubVault, progressOnDisk, sleep, waitMark,
} from './perf_rename.ts';

const BUNDLE_ID = 'app.tegg.desktop';
const PORT = Number(process.env.APPIUM_PORT ?? 4726);
const APPIUM_HOME = process.env.APPIUM_HOME ?? resolve(import.meta.dirname, '.appium');
const CYCLES = Number(process.env.TEGG_KILL_CYCLES ?? 20);

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
const read = (v: string, rel: string) => (existsSync(join(v, rel)) ? readFileSync(join(v, rel), 'utf8') : null);
const noModified = (t: string) => t.replace(/^modified: .*\n/m, '');

// ---------------------------------------------------------------- Appium (as ms4_links.ac.test.ts)
let appium: ChildProcess | undefined;
async function appiumUp() {
  if (appium) return;
  appium = spawn('npx', ['appium', '--port', String(PORT), '--log-level', 'error'], { cwd: import.meta.dirname, env: { ...process.env, APPIUM_HOME }, stdio: 'ignore', detached: true });
  appium.unref();
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (await fetch(`http://127.0.0.1:${PORT}/status`).then((r) => r.ok, () => false)) return;
    await sleep(200);
  }
  assert.fail(`Appium did not start on port ${PORT} (run npm run e2e:setup)`);
}
function appiumDown() {
  if (appium?.pid) {
    try { process.kill(-appium.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  appium = undefined;
}
after(appiumDown);
process.on('exit', appiumDown);
type Driver = Awaited<ReturnType<typeof import('webdriverio').remote>>;
async function session(env: Record<string, string>): Promise<Driver> {
  await appiumUp();
  const { remote } = await import('webdriverio');
  return remote({
    hostname: '127.0.0.1', port: PORT, logLevel: 'error',
    capabilities: { platformName: 'mac', 'appium:automationName': 'Mac2', 'appium:bundleId': BUNDLE_ID, 'appium:appPath': APP, 'appium:environment': env, 'appium:newCommandTimeout': 300 } as any,
  });
}
async function end(d: Driver | undefined) {
  await d?.execute('macos: terminateApp', { bundleId: BUNDLE_ID }).catch(() => {});
  await d?.deleteSession().catch(() => {});
}
async function find(d: Driver, pred: string, ms: number): Promise<any | null> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    for (const e of await d.$$(`-ios predicate string:${pred}`).catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) return e;
    await sleep(100);
  }
  return null;
}
// D-752: `value` only where it is text; CONTAINS on a progress bar's or checkbox's number crashes the app (XCTest).
const has = (text: string) => { const t = text.replace(/"/g, '\\"'); return `(label CONTAINS "${t}" OR title CONTAINS "${t}" OR (elementType IN {48, 49, 52} AND value CONTAINS "${t}"))`; };
const is = (text: string) => { const t = text.replace(/"/g, '\\"'); return `(label == "${t}" OR value == "${t}" OR title == "${t}")`; };

/** The state on disk after a kill: problems (never acceptable) and how far the rename got. */
function inspect(vault: string, pre: Map<string, string>): { problems: string[]; k: number; renamed: boolean } {
  const problems: string[] = [];
  const now = files(vault);
  let k = 0;
  for (let i = 0; i < LINKS; i++) {
    const t = read(vault, linker(i));
    if (t === linkerText(i, NEW_TITLE)) k++;
    else if (t !== linkerText(i)) problems.push(`${linker(i)} is neither its pre-job nor its rewritten version`);
  }
  const oldHub = read(vault, HUB);
  const newHub = read(vault, NEW_HUB);
  if (oldHub !== null && newHub !== null) problems.push('both the old and the new hub file exist');
  if (oldHub === null && newHub === null) problems.push('the hub file is gone');
  // Before the job the autosave may have written `title: Uzel` under the old name (D-394); that is the pre-job state.
  if (oldHub !== null && noModified(oldHub) !== HUB_TEXT && noModified(oldHub) !== HUB_TEXT.replace('title: Rozbočovač', `title: ${NEW_TITLE}`)) problems.push('the old hub file holds other bytes');
  if (newHub !== null && !/^title: Uzel$/m.test(newHub)) problems.push('the new hub file has another title');
  for (const [p, h] of pre) {
    if (p === HUB || p.startsWith('Pages/Odkaz na uzel ')) continue;
    if (now.get(p) !== h && !p.includes('.tegg-tmp')) problems.push(`${p} changed`);
  }
  for (const p of now.keys()) if (!pre.has(p) && p !== NEW_HUB && !p.includes('.tegg-tmp')) problems.push(`${p} appeared`);
  return { problems, k, renamed: newHub !== null };
}

test('fr_lnk_03_ac17_sigkill_during_the_hub_rename_cycles', { timeout: 6 * 60 * 60_000 }, async () => {
  assert.ok(existsSync(EXE), `app not built: ${EXE} missing (cd app && npm run app:build)`);
  const base = mkdtempSync(join(tmpdir(), 'tegg-fr-lnk-03-ac17-'));
  const problems: string[] = [];
  try {
    const prepared = prepareHubVault(base);
    assert.ok(prepared, 'reference vault (tools/gen-vault --seed 1 --small-images) with the hub');
    const pre = files(prepared!);
    for (let c = 0; c < CYCLES; c++) {
      const vault = copyVault(prepared!, join(base, `v${c}`));
      const support = join(base, `support-${c}`);
      const log = join(base, `kill-${c}.jsonl`);
      const child = launch(vault, support, log, `note/${HUB}`);
      if (!(await waitMark(log, 'note-ready', 240_000))) { problems.push(`cycle ${c}: the hub never opened`); child.kill('SIGKILL'); continue; }
      await sleep(300);
      commitTitle(NEW_TITLE);
      await sleep(Math.floor(Math.random() * 1500));
      child.kill('SIGKILL');
      await sleep(500);
      const s = inspect(vault, pre);
      problems.push(...s.problems.map((p) => `cycle ${c}: ${p}`));
      // The next open finds the leftovers aged.
      const old = new Date(Date.now() - 120_000);
      for (const p of files(vault).keys()) if (p.includes('.tegg-tmp')) utimesSync(join(vault, p), old, old);
      const partial = (s.k > 0 || s.renamed) && !(s.k === LINKS && s.renamed);
      mkdirSync(support, { recursive: true });
      writeFileSync(join(support, 'ui-state.json'), JSON.stringify({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: true, tab: 'backlinks' } }));
      const hubNow = s.renamed ? NEW_HUB : HUB;
      let d: Driver | undefined;
      try {
        d = await session({ TEGG_TEST: '1', TEGG_APP_SUPPORT: support, TEGG_VAULT: vault, TEGG_ROUTE: `note/${hubNow}`, TEGG_PERF_LOG: join(base, `reopen-${c}.jsonl`) });
        if (!(await waitMark(join(base, `reopen-${c}.jsonl`), 'index-ready', 240_000))) problems.push(`cycle ${c}: the index never became ready after the kill`);
        const left = [...files(vault).keys()].filter((p) => p.includes('.tegg-tmp'));
        if (left.length) problems.push(`cycle ${c}: .tegg-tmp survives the next open: ${left.join(', ')}`);
        if (partial) {
          const banner = await find(d, has('Renaming "Rozbočovač" was interrupted:'), 10_000);
          if (!banner) { problems.push(`cycle ${c}: no interrupted banner (k = ${s.k}, renamed = ${s.renamed})`); continue; }
          const text = String((await banner.getAttribute('label').catch(() => '')) || (await banner.getAttribute('value').catch(() => '')));
          if (!/was interrupted: \d+ of \d+ links updated/.test(text)) problems.push(`cycle ${c}: banner text "${text}"`);
          const finish = await find(d, `elementType == 9 AND ${is('Finish')}`, 3000);
          if (!(await find(d, `elementType == 9 AND ${is('Undo')}`, 1000))) problems.push(`cycle ${c}: the banner has no Undo`);
          if (!finish) { problems.push(`cycle ${c}: the banner has no Finish`); continue; }
          await finish.click();
          // D-754 (AP-707): Finish rewrites up to 500 files at about 100 ms each, so it gets 3 minutes.
          const endAt = Date.now() + 180_000;
          while (Date.now() < endAt && !(progressOnDisk(vault).rewritten === LINKS && progressOnDisk(vault).hubRenamed)) await sleep(200);
          const p = progressOnDisk(vault);
          if (!(p.rewritten === LINKS && p.hubRenamed)) problems.push(`cycle ${c}: Finish left ${p.rewritten} of ${LINKS} links, hub renamed ${p.hubRenamed}`);
        }
        const done = progressOnDisk(vault);
        const consistent = (done.rewritten === LINKS && done.hubRenamed) || (done.rewritten === 0 && !done.hubRenamed);
        if (consistent) {
          // Every link to the hub resolves to it: on a fresh launch its Backlinks panel lists all 500 sources.
          await end(d);
          const target = done.hubRenamed ? NEW_HUB : HUB;
          d = await session({ TEGG_TEST: '1', TEGG_APP_SUPPORT: support, TEGG_VAULT: vault, TEGG_ROUTE: `note/${target}`, TEGG_PERF_LOG: join(base, `check-${c}.jsonl`) });
          if (!(await find(d, is(`${LINKS} objects link here`), 30_000))) problems.push(`cycle ${c}: the hub's panel doesn't show ${LINKS} backlinks`);
        }
      } finally {
        await end(d);
        rmSync(vault, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  assert.deepEqual(problems, [], 'every kill leaves each file pre-job or rewritten; the next open cleans up, offers Finish and resolves every link');
});
