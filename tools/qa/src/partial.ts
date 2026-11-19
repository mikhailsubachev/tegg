// Partial runs of the push gate (CONTRACT §3.2.5, D-1834): a step that declares its independent test files runs only
// the files that failed in its last recorded run or changed since, as long as nothing else among its inputs changed.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Gate, Step } from './config.ts';
import { parseJunit } from './junit.ts';
import { memoInputs } from './memo.ts';
import { gitTry, parseNameStatusZ, sq } from './proc.ts';
import { readJson, sharedDir, sharedFile, writeJson } from './shared.ts';

/** Bump when the meaning of a record changes, so that older records are not used. */
export const STEP_RUNS_VERSION = 1;

/** `pending`: the test files not known to pass at `commit`; `null` when that is unknown (a full run is needed). */
export type StepRun = { step: string; commit: string; gate: Gate; startedAt: string; pending: string[] | null };
export type StepRuns = Record<string, StepRun>;
export type PartialPlan = { files: string[]; since: StepRun };

export function loadStepRuns(root: string): StepRuns {
  const dir = sharedDir(root);
  const raw = (dir ? readJson(path.join(dir, 'step-runs.json')) : undefined) ?? readJson(path.join(root, '.verify', 'step-runs.json'));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const runs: StepRuns = {};
  for (const [k, v] of Object.entries(raw)) {
    const e = v as Partial<StepRun> | null;
    if (!e || typeof e.step !== 'string' || typeof e.commit !== 'string' || typeof e.gate !== 'string' || typeof e.startedAt !== 'string') continue;
    const pending = Array.isArray(e.pending) && e.pending.every((p) => typeof p === 'string') ? e.pending : null;
    runs[k] = { step: e.step, commit: e.commit, gate: e.gate as Gate, startedAt: e.startedAt, pending };
  }
  return runs;
}

export function saveStepRuns(root: string, runs: StepRuns): void {
  writeJson(sharedFile(root, 'step-runs.json'), runs);
}

/** Undefined for a step that can't run partially (no `testFiles` or no `inputs`). */
export function stepFingerprint(step: Step): string | undefined {
  if (step.testFiles === undefined || step.inputs === undefined) return undefined;
  const material = { v: STEP_RUNS_VERSION, id: step.id, dir: step.dir, run: step.run, cargoCache: step.cargoCache, testFiles: step.testFiles.source, inputs: step.inputs };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

/** The step's test files in `sha`'s tree, sorted. */
export function testFilesAt(root: string, sha: string, step: Step): string[] {
  if (!step.testFiles) return [];
  const r = gitTry(root, ['ls-tree', '-r', '--name-only', '-z', sha]);
  if (r.status !== 0) return [];
  return r.stdout.split('\0').filter((p) => p !== '' && step.testFiles!.test(p)).sort();
}

/** The partial run of `step` at `sha` given its last record, or undefined when the run must be full. */
export function planPartial(root: string, sha: string, step: Step, rec: StepRun | undefined): PartialPlan | undefined {
  if (!rec || rec.pending === null || !step.testFiles) return undefined;
  if (gitTry(root, ['cat-file', '-e', `${rec.commit}^{commit}`]).status !== 0) return undefined;
  const diff = gitTry(root, ['diff', '--name-status', '--no-renames', '-z', rec.commit, sha, '--', ...memoInputs(step)]);
  if (diff.status !== 0) return undefined;
  const changes = parseNameStatusZ(diff.stdout);
  if (changes.some((c) => !step.testFiles!.test(c.path))) return undefined;
  const present = new Set(testFilesAt(root, sha, step));
  const chosen = new Set([...rec.pending, ...changes.filter((c) => c.status !== 'D').map((c) => c.path)]);
  return { files: [...chosen].filter((f) => present.has(f)).sort(), since: rec };
}

/** The step's command for this run: `{files}` is the chosen test files relative to the step's directory, or empty. */
export function stepCommand(step: Step, files: string[] | undefined): string {
  if (!step.testFiles) return step.run;
  const dir = step.dir === '.' || step.dir === '' ? '.' : step.dir;
  const list = (files ?? []).map((f) => sq(path.posix.relative(dir, f))).join(' ');
  return step.run.replaceAll('{files}', list);
}

/**
 * After a failed run: which of the test files it should have run aren't known to pass. Undefined when none of the
 * step's JUnit reports can be read. A file passes if it has a testcase and none failed or was skipped; a testcase
 * belongs to the file whose path equals its classname or ends with `/<classname>`.
 */
export function pendingAfter(ranFiles: string[], reports: string[]): string[] | undefined {
  const cases = [];
  let readable = false;
  for (const file of reports) {
    try {
      cases.push(...parseJunit(fs.readFileSync(file, 'utf8')));
      readable = true;
    } catch {
      // a missing report: the step ended before writing it
    }
  }
  if (!readable) return undefined;
  const state = new Map<string, boolean>(); // classname → every testcase passed
  for (const c of cases) state.set(c.classname, (state.get(c.classname) ?? true) && c.failure === undefined && !c.skipped);
  return ranFiles.filter((f) => {
    const own = [...state].filter(([cls]) => cls !== '' && (f === cls || f.endsWith(`/${cls}`)));
    return own.length === 0 || own.some(([, ok]) => !ok);
  });
}
