// Step memo of the push gate (CONTRACT §3.2.3, D-526): a step whose declared inputs are unchanged since a recorded
// pass is skipped. Keys are content-addressed (git object ids of the inputs in the gated commit's tree), so a stale
// artifact can never stand in for changed sources; an undeclared input is the one risk, covered by the nightly gate.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Gate, Step } from './config.ts';
import { gitTry } from './proc.ts';

/** Bump when the tooling's semantics change so that recorded passes must not be reused.
 *  2: keys of version 1 missed the object id of an input that contains the step's directory (bug_pr54). */
export const STEP_MEMO_VERSION = 2;

export type MemoEntry = { step: string; gate: Gate; commit: string; startedAt: string; runId: string; reports: string[] };
export type StepMemo = Record<string, MemoEntry>;

export function memoFile(root: string): string {
  return path.join(root, '.verify', 'step-memo.json');
}

/** A missing, unreadable or malformed file is empty (CONTRACT §3.2.3). */
export function loadStepMemo(root: string): StepMemo {
  try {
    const raw = JSON.parse(fs.readFileSync(memoFile(root), 'utf8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const memo: StepMemo = {};
    for (const [k, v] of Object.entries(raw)) {
      const e = v as Partial<MemoEntry> | null;
      if (e && typeof e.step === 'string' && typeof e.gate === 'string' && typeof e.commit === 'string' && typeof e.startedAt === 'string' && typeof e.runId === 'string') {
        memo[k] = { step: e.step, gate: e.gate as Gate, commit: e.commit, startedAt: e.startedAt, runId: e.runId, reports: Array.isArray(e.reports) ? e.reports.filter((r) => typeof r === 'string') : [] };
      }
    }
    return memo;
  } catch {
    return {};
  }
}

export function saveStepMemo(root: string, memo: StepMemo): void {
  fs.mkdirSync(path.dirname(memoFile(root)), { recursive: true });
  fs.writeFileSync(memoFile(root), JSON.stringify(memo, null, 2) + '\n');
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
