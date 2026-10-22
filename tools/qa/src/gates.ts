// Gates G0–G4 (D-60, docs/test-strategy.md §8, tools/qa/CONTRACT.md §3).

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomInt } from 'node:crypto';
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
import { l6Problems, milestoneCheck, milestones } from './coverage.ts';
import { loadStepMemo, reportNames, saveStepMemo, stepMemoKey } from './memo.ts';
import { exec, execAsync, git, gitTry, shortSha, strippedEnv } from './proc.ts';
import { gatePortBase } from './port.ts';

export { gatePortBase };

/** `lane`: tree gates only (CONTRACT §3.2.2). `reuses`: a step skipped by the step memo names the run it reuses (§3.2.3). */
export type StepResult = { id: string; result: 'pass' | 'fail' | 'skipped'; durationMs: number; seeds: number[]; lane?: string; reuses?: string };

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

/** `fromHook`: the range was set by the pre-push hook, so a pass may still be recorded (CONTRACT §3.2).
 *  `lanes`: 1 runs every step in config order (§3.2.2). `all`: the push gate ignores the step memo (§3.2.3). */
export type GateOptions = { commit?: string; range?: string; milestone?: string; fromHook?: boolean; lanes?: 1 | 'all'; all?: boolean };

const SEED_RE = /seed(?:\s*[=:]\s*|\s+)(-?\d+)/gi;

function seedsOf(text: string): number[] {
  return [...text.matchAll(SEED_RE)].map((m) => Number(m[1]));
}

function log(line: string): void {
  process.stdout.write(line + '\n');
}

function printCheck(c: CheckResult): void {
  log(`${c.result === 'pass' ? '✓' : '✗'} check ${c.id}`);
  for (const m of c.messages) log(`    ${m}`);
}

/** The shared Cargo build cache of tree gates (CONTRACT §3.2.1, D-343): machine-local, under .verify/. */
export function cargoCacheDir(root: string): string {
  return path.join(root, '.verify', 'cargo-target');
}

// Probes a TCP port: exit 0 when a listener could bind it on every interface, 1 otherwise.
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
  const seeds = seedsOf(`${r.stdout}\n${r.stderr}`);
  const result = r.status === 0 ? 'pass' : 'fail';
  log(`${result === 'pass' ? '✓' : '✗'} ${step.id} (${(durationMs / 1000).toFixed(1)} s)`);
  return { id: step.id, result, durationMs, seeds };
}

/** A step of a tree gate (CONTRACT §3.2.2): a start line when it starts; its stdout, stderr and result line as one
 *  contiguous block when it finishes, so concurrent lanes never interleave inside a step. */
async function runStepAsync(step: Step, checkout: string, env: NodeJS.ProcessEnv): Promise<StepResult> {
  const cwd = path.join(checkout, step.dir);
  const t0 = Date.now();
  // The command is printed with the result, not here: the start line of one step must not carry text that
  // another step's output block is searched for (CONTRACT §3.2.2).
  log(`▶ ${step.id} [${step.lane}] (${step.dir}): started`);
  if (!fs.existsSync(cwd)) {
    log(`✗ ${step.id}: directory ${step.dir} doesn't exist`);
    return { id: step.id, result: 'fail', durationMs: Date.now() - t0, seeds: [], lane: step.lane };
  }
  const r = await execAsync('sh', ['-c', step.run], { cwd, env });
  const durationMs = Date.now() - t0;
  const result = r.status === 0 ? 'pass' : 'fail';
  const nl = (s: string) => (s.length === 0 || s.endsWith('\n') ? s : s + '\n');
  // One write per stream, with nothing awaited in between: the block stays contiguous.
  process.stdout.write(`${nl(r.stdout)}${result === 'pass' ? '✓' : '✗'} ${step.id} (${(durationMs / 1000).toFixed(1)} s): ${step.run}\n`);
  if (r.stderr) process.stderr.write(nl(r.stderr));
  return { id: step.id, result, durationMs, seeds: seedsOf(`${r.stdout}\n${r.stderr}`), lane: step.lane };
}

/** Runs each lane's steps in config order and the lanes concurrently (`lanes === 1`: one lane); results in config order. */
async function runLanes(steps: Step[], run: (s: Step) => Promise<StepResult>, lanes: 1 | 'all'): Promise<StepResult[]> {
  const groups = new Map<string, Step[]>();
  for (const s of steps) {
    const key = lanes === 1 ? '' : s.lane;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const byId = new Map<string, StepResult>();
  await Promise.all(
    [...groups.values()].map(async (g) => {
      for (const s of g) byId.set(s.id, await run(s));
    }),
  );
  return steps.map((s) => byId.get(s.id)!);
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

function stepEnv(gate: Gate, results: string, seed: number, milestone?: string): NodeJS.ProcessEnv {
  return strippedEnv({
    ...(milestone ? { VERIFY_MILESTONE: milestone } : {}),
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
export async function runTreeGate(root: string, cfg: Config, gate: Gate, opts: GateOptions): Promise<Summary> {
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
  const wt = createWorktree(root, sha, { stable: true });
  try {
    // D-382: real-app ACs tested only at lower layers, on the committed tree (CONTRACT §9.5).
    if (cfg.realAppTests.length > 0) {
      const messages = l6Problems(wt.dir, cfg.realAppTests);
      const c: CheckResult = { id: 'l6-coverage', result: messages.length > 0 ? 'fail' : 'pass', messages };
      checks.push(c);
      printCheck(c);
    }
    const gateSteps = cfg.steps.filter((s) => gateRank(s.level) <= gateRank(gate));
    for (const p of provideNodeModules(root, wt.dir, gateSteps.map((s) => s.dir))) log(`⚠ ${p}`);
    const port = gatePortBase(wt.dir);
    log(`dev-server port for this run: ${port} (VERIFY_PORT_BASE)`);
    const env = { ...stepEnv(gate, results, seed, gate === 'milestone' ? opts.milestone : undefined), VERIFY_PORT_BASE: String(port) };
    const cached = { ...env, CARGO_TARGET_DIR: cargoCacheDir(root) };

    // Step memo (CONTRACT §3.2.3, D-526): only push consults it, every tree gate records into it.
    const memo = loadStepMemo(root);
    const consult = gate === 'push' && !opts.all;
    const keyOf = new Map(gateSteps.map((s) => [s.id, stepMemoKey(root, sha, s)]));
    const skipped = new Map<string, StepResult>();
    const planned = gateSteps.filter((s) => {
      const key = keyOf.get(s.id);
      const e = consult && key ? memo[key] : undefined;
      if (!e) return true;
      log(`- ${s.id}: skipped (inputs unchanged; reuses ${e.gate} run ${e.startedAt} at ${shortSha(e.commit)})`);
      for (const name of e.reports) {
        const from = path.join(root, '.verify', 'results', e.runId, name);
        if (!fs.existsSync(from)) continue;
        fs.mkdirSync(path.dirname(path.join(results, name)), { recursive: true });
        fs.copyFileSync(from, path.join(results, name));
      }
      skipped.set(s.id, { id: s.id, result: 'skipped', durationMs: 0, seeds: [], lane: s.lane, reuses: e.startedAt });
      return false;
    });

    const ran = new Map((await runLanes(planned, (step) => runStepAsync(step, wt.dir, step.cargoCache ? cached : env), opts.lanes ?? 'all')).map((r) => [r.id, r]));
    steps.push(...gateSteps.map((s) => ran.get(s.id) ?? skipped.get(s.id)!));

    for (const s of gateSteps) {
      const key = keyOf.get(s.id);
      const r = ran.get(s.id);
      if (!key || !r) continue;
      if (r.result === 'pass') memo[key] = { step: s.id, gate, commit: sha, startedAt, runId, reports: reportNames(s).filter((n) => fs.existsSync(path.join(results, n))) };
      else if (r.result === 'fail') delete memo[key];
    }
    saveStepMemo(root, memo);
  } finally {
    wt.remove();
  }

  if (gate === 'milestone' || gate === 'release') {
    const names = gate === 'release' ? [...milestones(root).keys()] : [opts.milestone ?? ''];
    const mc = milestoneCheck(root, names, results, gate === 'release');
    const c: CheckResult = { id: 'milestone-acs', result: mc.problems.length > 0 ? 'fail' : 'pass', messages: mc.problems };
    checks.push(c);
    printCheck(c);
    // D-94: ACs verified at a later milestone, listed so none is forgotten; never fails.
    const d: CheckResult = { id: 'milestone-deferred', result: 'pass', messages: mc.deferred };
    checks.push(d);
    printCheck(d);
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
  const recordPass = opts.range === undefined || opts.fromHook === true;
  if (gate === 'push' && summary.result === 'pass' && !recordPass) log('verify: explicit --range: last-pass not recorded');
  if (gate === 'push' && summary.result === 'pass' && recordPass) fs.writeFileSync(path.join(root, '.verify', 'last-pass'), `${tree}\n`);
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
