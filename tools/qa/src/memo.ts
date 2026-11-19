// Step memo of the push gate (CONTRACT §3.2.3, D-611): a step whose declared inputs are unchanged since a recorded
// pass is skipped. Keys are content-addressed (git object ids of the inputs in the gated commit's tree), so a stale
// artifact can never stand in for changed sources; an undeclared input is the one risk, covered by the nightly gate.

import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Gate, Step } from './config.ts';
import { gitTry } from './proc.ts';
import { readJson, sharedDir, writeJson } from './shared.ts';

/** Bump when the tooling's semantics change so that recorded passes must not be reused.
 *  2: keys of version 1 missed the object id of an input that contains the step's directory (bug_pr54). */
export const STEP_MEMO_VERSION = 2;

/** `results`: the absolute results folder of the recorded run, which may be another worktree's (D-1831). */
export type MemoEntry = { step: string; gate: Gate; commit: string; startedAt: string; runId: string; reports: string[]; results?: string };
export type StepMemo = Record<string, MemoEntry>;

export function memoFile(root: string): string {
  return path.join(root, '.verify', 'step-memo.json');
}

/** The memo shared by every worktree of the repository (CONTRACT §1.2), undefined when there is no shared folder. */
function sharedMemoFile(root: string, create = false): string | undefined {
  const dir = sharedDir(root, create);
  return dir ? path.join(dir, 'step-memo.json') : undefined;
}

/** The checkout's memo and the shared one together; the shared record wins for the same key (CONTRACT §3.2.3). */
export function loadStepMemo(root: string): StepMemo {
  const shared = sharedMemoFile(root);
  return { ...parseMemo(readJson(memoFile(root))), ...(shared ? parseMemo(readJson(shared)) : {}) };
}

/** A missing, unreadable or malformed file is empty (CONTRACT §3.2.3). */
function parseMemo(raw: unknown): StepMemo {
  try {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const memo: StepMemo = {};
    for (const [k, v] of Object.entries(raw)) {
      const e = v as Partial<MemoEntry> | null;
      if (e && typeof e.step === 'string' && typeof e.gate === 'string' && typeof e.commit === 'string' && typeof e.startedAt === 'string' && typeof e.runId === 'string') {
        memo[k] = { step: e.step, gate: e.gate as Gate, commit: e.commit, startedAt: e.startedAt, runId: e.runId, reports: Array.isArray(e.reports) ? e.reports.filter((r) => typeof r === 'string') : [], ...(typeof e.results === 'string' ? { results: e.results } : {}) };
      }
    }
    return memo;
  } catch {
    return {};
  }
}

export function saveStepMemo(root: string, memo: StepMemo): void {
  writeJson(memoFile(root), memo);
  const shared = sharedMemoFile(root, true);
  if (shared) writeJson(shared, memo);
}

/** The step's inputs plus `<dir>/package-lock.json`, which decides its node_modules (§3.2). */
export function memoInputs(step: Step): string[] {
  const lock = path.posix.join(step.dir === '.' || step.dir === '' ? '' : step.dir.replace(/\/+$/, ''), 'package-lock.json');
  return [...new Set([...(step.inputs ?? []), lock])];
}

/** The git object id of every input path in `sha`'s tree; a path absent from the tree is `''`.
 *  One `rev-parse <sha>:<path>` per path: a single `ls-tree` with all paths descends into a directory whenever a
 *  deeper path is also given (the step's lockfile inside its own input) and then never lists the directory itself. */
function inputIds(root: string, sha: string, paths: string[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const p of paths) {
    const r = gitTry(root, ['rev-parse', '--verify', '--quiet', `${sha}:${p}`]);
    ids.set(p, r.status === 0 ? r.stdout.trim() : '');
  }
  return ids;
}

/** Undefined for a step without `inputs` (it always runs). The gate is not part of the key: a nightly pass counts for push. */
export function stepMemoKey(root: string, sha: string, step: Step): string | undefined {
  if (step.inputs === undefined) return undefined;
  const paths = memoInputs(step);
  const ids = inputIds(root, sha, paths);
  const material = { v: STEP_MEMO_VERSION, id: step.id, dir: step.dir, run: step.run, cargoCache: step.cargoCache, inputs: paths.map((p) => [p, ids.get(p) ?? '']) };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

/** The JUnit reports a step writes, read from its command (`$VERIFY_RESULTS/<name>.xml`); best effort. */
export function reportNames(step: Step): string[] {
  return [...new Set([...step.run.matchAll(/\$VERIFY_RESULTS\/([^\s"'$]+\.xml)/g)].map((m) => m[1]))];
}
