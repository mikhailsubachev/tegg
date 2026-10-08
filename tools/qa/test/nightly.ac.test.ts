// TS-G2: nightly gate (D-62). Black box against tools/qa/CONTRACT.md §1.1, §8.
// Never installs a real launchd job: only `install-nightly --dry-run` is used, with HOME pointed at a temp dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  NODE_DIR, REPO_ROOT, assertExit, describe, gitTry, localDate, makeRepo, readJsonFile, readText, run, sq,
  tmpDir, toplevel, verify,
} from './helpers.ts';

const TZ = 'Europe/Prague';

// ---------------------------------------------------------------------------
// AC-1: launchd agent under caffeinate, calendar interval (catches up after sleep)
// ---------------------------------------------------------------------------

function dryRunPlist(t: any): { repo: string; root: string; home: string; plist: any; stdout: string; stderr: string } {
  const repo = makeRepo(t, { hooksPath: false });
  const home = tmpDir(t, 'tegg-qa-home-');
  const r = verify(repo, ['install-nightly', '--dry-run'], { env: { HOME: home } });
  assertExit(r, 0, 'verify install-nightly --dry-run');
  assert.match(r.stdout, /<plist[\s>]/, `stdout must be plist XML\n${describe(r)}`);
  const xmlFile = path.join(tmpDir(t, 'tegg-qa-plist-'), 'agent.plist');
  fs.writeFileSync(xmlFile, r.stdout.slice(r.stdout.indexOf('<?xml') >= 0 ? r.stdout.indexOf('<?xml') : r.stdout.indexOf('<')));
  const conv = run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', xmlFile], { cwd: repo });
  assertExit(conv, 0, 'plutil must parse the printed plist');
  return { repo, root: toplevel(repo), home, plist: JSON.parse(conv.stdout), stdout: r.stdout, stderr: r.stderr };
}

test('ts_g2_ac1_dry_run_plist_runs_verify_nightly_under_caffeinate', (t) => {
  const { root, plist } = dryRunPlist(t);
  assert.equal(plist.Label, 'com.tegg.verify-nightly');
  assert.deepEqual(plist.ProgramArguments, ['/usr/bin/caffeinate', '-i', `${root}/verify`, 'nightly']);
  assert.equal(plist.WorkingDirectory, root);
});

test('ts_g2_ac1_dry_run_plist_uses_calendar_interval_at_0230', (t) => {
  const { plist } = dryRunPlist(t);
  assert.deepEqual(plist.StartCalendarInterval, { Hour: 2, Minute: 30 }, 'StartCalendarInterval (runs a missed job at next wake)');
  assert.equal(plist.StartInterval, undefined, 'no StartInterval (it would not catch up after sleep the same way)');
});

test('ts_g2_ac1_dry_run_plist_sets_path_with_node_and_logs_in_verify_dir', (t) => {
  const { root, plist } = dryRunPlist(t);
  const pathVar = String(plist.EnvironmentVariables?.PATH ?? '');
  assert.ok(pathVar.split(':').includes(NODE_DIR), `PATH must include the node directory ${NODE_DIR}: ${pathVar}`);
  for (const key of ['StandardOutPath', 'StandardErrorPath']) {
    assert.ok(String(plist[key] ?? '').startsWith(`${root}/.verify/`), `${key} must be under ${root}/.verify/: ${plist[key]}`);
  }
});

test('ts_g2_ac1_dry_run_changes_nothing_and_prints_no_warnings', (t) => {
  const { repo, home, stderr } = dryRunPlist(t);
  assert.equal(fs.existsSync(path.join(home, 'Library', 'LaunchAgents', 'com.tegg.verify-nightly.plist')), false, 'no plist installed');
  assert.equal(stderr, '', 'no warnings for install-nightly --dry-run');
  const status = gitTry(repo, ['config', '--get', 'core.hooksPath']);
  assert.notEqual(status.status, 0, 'dry run must not change git config');
});

// ---------------------------------------------------------------------------
// AC-2: nightly failures written to qa/nightly/<date>.md and shown by the next verify run
// ---------------------------------------------------------------------------

function nightlyRepo(t: any) {
  const flags = tmpDir(t, 'tegg-qa-flags-');
  const flag = path.join(flags, 'fail');
  const repo = makeRepo(t, {
    config: {
      steps: [
        { id: 'ok-step', run: 'true', level: 'commit' },
        { id: 'long-property-run', run: `test ! -e ${sq(flag)}`, level: 'nightly' },
      ],
    },
  });
  return { repo, flag };
}

test('ts_g2_ac2_failed_nightly_writes_report_and_status', (t) => {
  const { repo, flag } = nightlyRepo(t);
  fs.writeFileSync(flag, '1');
  const before = localDate(TZ);
  const r = verify(repo, ['nightly'], { env: { TZ } });
  assertExit(r, 1, 'verify nightly with a failing nightly step');
  const dates = [...new Set([before, localDate(TZ)])];
  const date = dates.find((d) => fs.existsSync(path.join(repo, 'qa', 'nightly', `${d}.md`)));
  assert.ok(date, `qa/nightly/<${dates.join('|')}>.md must exist\n${describe(r)}`);
  const report = readText(path.join(repo, 'qa', 'nightly', `${date}.md`), 'nightly report');
  assert.ok(report.split('\n').includes('- long-property-run: fail'), `report must have "- long-property-run: fail":\n${report}`);
  assert.ok(!report.includes('ok-step'), 'passing steps are not listed as failures');
  assert.deepEqual(readJsonFile(path.join(repo, '.verify', 'nightly-status.json'), 'nightly status'), {
    date, result: 'fail', report: `qa/nightly/${date}.md`,
  });
});

test('ts_g2_ac2_next_verify_run_warns_until_nightly_passes', (t) => {
  const { repo, flag } = nightlyRepo(t);
  fs.writeFileSync(flag, '1');
  assertExit(verify(repo, ['nightly'], { env: { TZ } }), 1, 'failing nightly');
  const status = readJsonFile(path.join(repo, '.verify', 'nightly-status.json'), 'nightly status');

  const r1 = verify(repo, ['commit'], { env: { TZ } });
  assertExit(r1, 0, 'the nightly warning must not change the exit code');
  const line = r1.stderr.split('\n').find((l) => /nightly/i.test(l) && l.includes(`qa/nightly/${status.date}.md`));
  assert.ok(line, `stderr must warn about the failed nightly with its report path\n${describe(r1)}`);

  fs.rmSync(flag);
  assertExit(verify(repo, ['nightly'], { env: { TZ } }), 0, 'passing nightly');
  const passed = readJsonFile(path.join(repo, '.verify', 'nightly-status.json'), 'nightly status');
  assert.equal(passed.result, 'pass');
  const r2 = verify(repo, ['commit'], { env: { TZ } });
  assertExit(r2, 0, 'verify commit after a passing nightly');
  assert.doesNotMatch(r2.stderr, /qa\/nightly\//, 'the warning stops after a passing nightly');
});

test('ts_g2_ac2_passing_nightly_writes_no_report', (t) => {
  const { repo } = nightlyRepo(t);
  assertExit(verify(repo, ['nightly'], { env: { TZ } }), 0, 'passing nightly');
  const status = readJsonFile(path.join(repo, '.verify', 'nightly-status.json'), 'nightly status');
  assert.equal(status.result, 'pass');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(status.date), `date must be YYYY-MM-DD, got ${status.date}`);
  const dir = path.join(repo, 'qa', 'nightly');
  assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], [], 'no report for a passing run');
});

test('ts_g2_ac2_nightly_reports_are_git_ignored_in_this_repo', () => {
  const r = gitTry(REPO_ROOT, ['check-ignore', '-q', '--no-index', 'qa/nightly/2026-10-08.md']);
  assert.equal(r.status, 0, `qa/nightly/ must be git-ignored in ${REPO_ROOT}/.gitignore\n${describe(r)}`);
});
