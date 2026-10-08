// Gates G0–G4 (D-60, docs/test-strategy.md §8, tools/qa/CONTRACT.md §3).

import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { gateRank, type Config, type Gate, type Step } from './config.ts';
import {
  acTestProtection,
  createWorktree,
  fixtureTrailers,
  privacyStaged,
  privacyTree,
  provideNodeModules,
  redFirst,
  type CheckResult,
} from './checks.ts';
import { milestoneProblems, milestones } from './coverage.ts';
import { exec, git, gitTry, strippedEnv } from './proc.ts';

export type StepResult = { id: string; result: 'pass' | 'fail' | 'skipped'; durationMs: number; seeds: number[] };

export type Summary = {
  gate: Gate;
  commit: string;
  tree: string;
  startedAt: string;
  durationMs: number;
  result: 'pass' | 'fail';
  seed: number;
  checks: CheckResult[];
  steps: StepResult[];
};

export type GateOptions = { commit?: string; range?: string; milestone?: string };

const SEED_RE = /seed(?:\s*[=:]\s*|\s+)(-?\d+)/gi;

function log(line: string): void {
  process.stdout.write(line + '\n');
}

function printCheck(c: CheckResult): void {
  log(`${c.result === 'pass' ? '✓' : '✗'} check ${c.id}`);
  for (const m of c.messages) log(`    ${m}`);
}

function runStep(step: Step, checkout: string, env: NodeJS.ProcessEnv): StepResult {
  const cwd = path.join(checkout, step.dir);
  const t0 = Date.now();
  log(`▶ ${step.id} (${step.dir}): ${step.run}`);
  if (!fs.existsSync(cwd)) {
    log(`✗ ${step.id}: directory ${step.dir} doesn't exist`);
    return { id: step.id, result: 'fail', durationMs: Date.now() - t0, seeds: [] };
  }
  const r = exec('sh', ['-c', step.run], { cwd, env });
  if (r.stdout) process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n');
  if (r.stderr) process.stderr.write(r.stderr.endsWith('\n') ? r.stderr : r.stderr + '\n');
  const durationMs = Date.now() - t0;
  const seeds = [...`${r.stdout}\n${r.stderr}`.matchAll(SEED_RE)].map((m) => Number(m[1]));
  const result = r.status === 0 ? 'pass' : 'fail';
  log(`${result === 'pass' ? '✓' : '✗'} ${step.id} (${(durationMs / 1000).toFixed(1)} s)`);
  return { id: step.id, result, durationMs, seeds };
}

function resultsDirs(root: string, runId: string): { results: string; last: string } {
  const results = path.join(root, '.verify', 'results', runId);
  fs.mkdirSync(results, { recursive: true });
  return { results, last: path.join(root, '.verify', 'last-results') };
}

function copyResults(from: string, to: string): void {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true, recursive: true })) {
    if (!e.isFile() || !e.name.endsWith('.xml')) continue;
    const rel = path.relative(from, path.join(e.parentPath, e.name));
    fs.mkdirSync(path.dirname(path.join(to, rel)), { recursive: true });
    fs.copyFileSync(path.join(e.parentPath, e.name), path.join(to, rel));
  }
}

function writeSummary(root: string, s: Summary): void {
  const dir = path.join(root, '.verify', 'runs');
  fs.mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(s, null, 2) + '\n';
  fs.writeFileSync(path.join(dir, `${s.startedAt.replace(/[:.]/g, '-')}-${s.gate}.json`), json);
  fs.writeFileSync(path.join(root, '.verify', `last-${s.gate}.json`), json);
}

function reportBudget(cfg: Config, s: Summary): void {
  const budget = cfg.budgets[s.gate];
  if (budget === undefined || s.durationMs <= budget * 1000) return;
  log(`⚠ Gate ${s.gate} exceeded its budget of ${budget} s (took ${(s.durationMs / 1000).toFixed(1)} s). Slowest steps:`);
  for (const st of [...s.steps].filter((x) => x.result !== 'skipped').sort((a, b) => b.durationMs - a.durationMs).slice(0, 3)) {
    log(`    ${st.id}: ${(st.durationMs / 1000).toFixed(1)} s`);
  }
}

function stepEnv(gate: Gate, results: string, seed: number): NodeJS.ProcessEnv {
  return strippedEnv({
    VERIFY_GATE: gate,
    VERIFY_RESULTS: results,
    QA_SEED: String(seed),
    QA_PROPERTY_SCALE: gateRank(gate) >= gateRank('nightly') ? '100' : '1',
  });
}

/** The default range (CONTRACT §3.2): merge-base with @{upstream}, origin/main or main, up to `sha`. */
function defaultRange(root: string, sha: string): string[] {
  for (const ref of ['@{upstream}', 'origin/main', 'main']) {
    if (gitTry(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).status !== 0) continue;
    const base = gitTry(root, ['merge-base', sha, ref]);
    if (base.status !== 0) return [];
    const b = base.stdout.trim();
    if (b === sha) return [];
    return revList(root, `${b}..${sha}`);
  }
  return [];
}

function revList(root: string, range: string): string[] {
  return git(root, ['rev-list', '--reverse', range]).split('\n').filter(Boolean);
}

export function runCommitGate(root: string, cfg: Config): Summary {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const seed = randomInt(1, 2 ** 31 - 1);
  const runId = `${startedAt.replace(/[:.]/g, '-')}-commit`;
  const { results, last } = resultsDirs(root, runId);
  log('verify commit (G0)');

  const checks = [privacyStaged(root)];
  checks.forEach(printCheck);

  const staged = git(root, ['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean);
  const env = stepEnv('commit', results, seed);
  const steps: StepResult[] = [];
  for (const step of cfg.steps.filter((s) => gateRank(s.level) <= gateRank('commit'))) {
    const prefix = step.dir === '.' || step.dir === '' ? '' : step.dir.replace(/\/+$/, '') + '/';
    if (step.changedOnly && !staged.some((f) => f.startsWith(prefix))) {
      log(`- ${step.id}: skipped (no staged changes under ${step.dir})`);
      steps.push({ id: step.id, result: 'skipped', durationMs: 0, seeds: [] });
      continue;
    }
    steps.push(runStep(step, root, env));
  }

  copyResults(results, last);
  const headR = gitTry(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  const summary: Summary = {
    gate: 'commit',
    commit: headR.status === 0 ? headR.stdout.trim() : '',
    tree: git(root, ['write-tree']).trim(),
    startedAt,
    durationMs: Date.now() - t0,
    result: checks.every((c) => c.result === 'pass') && steps.every((s) => s.result !== 'fail') ? 'pass' : 'fail',
    seed,
    checks,
    steps,
  };
  writeSummary(root, summary);
  reportBudget(cfg, summary);
  log(`verify commit: ${summary.result.toUpperCase()}`);
  return summary;
}

/** push, nightly, milestone and release: fresh worktree of the commit (CONTRACT §3.2–§3.3). */
export function runTreeGate(root: string, cfg: Config, gate: Gate, opts: GateOptions): Summary {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const seed = randomInt(1, 2 ** 31 - 1);
  const runId = `${startedAt.replace(/[:.]/g, '-')}-${gate}`;
  const { results, last } = resultsDirs(root, runId);

  const shaR = gitTry(root, ['rev-parse', '--verify', '--quiet', `${opts.commit ?? 'HEAD'}^{commit}`]);
  if (shaR.status !== 0) throw new Error(`verify ${gate}: unknown commit ${opts.commit ?? 'HEAD'}`);
  const sha = shaR.stdout.trim();
  const tree = git(root, ['rev-parse', `${sha}^{tree}`]).trim();
  log(`verify ${gate} at ${sha.slice(0, 10)} (tree ${tree.slice(0, 10)})`);
  if (git(root, ['status', '--porcelain']).trim().length > 0) {
    process.stderr.write(`verify: warning: the working directory has uncommitted changes; ${gate} checks only the committed state of ${sha.slice(0, 10)}\n`);
  }

  const range = opts.range ? revList(root, opts.range) : defaultRange(root, sha);
  const checks: CheckResult[] = [privacyTree(root, sha), fixtureTrailers(root, range), acTestProtection(root, cfg, range), redFirst(root, cfg, range)];
  checks.forEach(printCheck);

  const steps: StepResult[] = [];
  const wt = createWorktree(root, sha);
  try {
    const gateSteps = cfg.steps.filter((s) => gateRank(s.level) <= gateRank(gate));
    for (const p of provideNodeModules(root, wt.dir, gateSteps.map((s) => s.dir))) log(`⚠ ${p}`);
    const env = stepEnv(gate, results, seed);
    for (const step of gateSteps) steps.push(runStep(step, wt.dir, env));
  } finally {
    wt.remove();
  }

  if (gate === 'milestone' || gate === 'release') {
    const names = gate === 'release' ? [...milestones(root).keys()] : [opts.milestone ?? ''];
    const c: CheckResult = { id: 'milestone-acs', result: 'pass', messages: milestoneProblems(root, names, results, gate === 'release') };
    if (c.messages.length > 0) c.result = 'fail';
    checks.push(c);
    printCheck(c);
  }

  copyResults(results, last);
  const summary: Summary = {
    gate,
    commit: sha,
    tree,
    startedAt,
    durationMs: Date.now() - t0,
    result: checks.every((c) => c.result === 'pass') && steps.every((s) => s.result !== 'fail') ? 'pass' : 'fail',
    seed,
    checks,
    steps,
  };
  writeSummary(root, summary);
  if (gate === 'push' && summary.result === 'pass') fs.writeFileSync(path.join(root, '.verify', 'last-pass'), `${tree}\n`);
  if (gate === 'nightly') recordNightly(root, summary);
  reportBudget(cfg, summary);
  log(`verify ${gate}: ${summary.result.toUpperCase()}`);
  return summary;
}

// ---------------------------------------------------------------------------
// Nightly status (TS-G2 AC-2, CONTRACT §8.1)
// ---------------------------------------------------------------------------

export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function recordNightly(root: string, s: Summary): void {
  const date = localDate();
  const statusFile = path.join(root, '.verify', 'nightly-status.json');
  if (s.result === 'pass') {
    fs.writeFileSync(statusFile, JSON.stringify({ date, result: 'pass' }, null, 2) + '\n');
    return;
  }
  const report = `qa/nightly/${date}.md`;
  const lines = [`# Nightly run ${date}`, '', `Commit: ${s.commit}`, `Tree: ${s.tree}`, '', '## Failed', ''];
  for (const c of s.checks.filter((x) => x.result === 'fail')) lines.push(`- ${c.id}: fail`);
  for (const st of s.steps.filter((x) => x.result === 'fail')) lines.push(`- ${st.id}: fail`);
  fs.mkdirSync(path.join(root, 'qa', 'nightly'), { recursive: true });
  fs.writeFileSync(path.join(root, report), lines.join('\n') + '\n');
  fs.writeFileSync(statusFile, JSON.stringify({ date, result: 'fail', report }, null, 2) + '\n');
}

export function nightlyWarning(root: string): string | undefined {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(root, '.verify', 'nightly-status.json'), 'utf8'));
    if (st?.result === 'fail') return `verify: warning: Last nightly run (${st.date}) failed: ${st.report}`;
  } catch {
    // no status yet
  }
  return undefined;
}
