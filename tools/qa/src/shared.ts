// Shared state of the gates (CONTRACT §1.2, D-1831): one folder per repository, `<git common dir>/tegg-verify/`,
// used by the main checkout and every worktree, so a pass recorded in one counts in all.

import fs from 'node:fs';
import path from 'node:path';
import { gitTry } from './proc.ts';

const MAX_PASSED_TREES = 200;
let warned = false;

/** The shared folder, or undefined when git can't name it or (with `create`) it can't be made. */
export function sharedDir(root: string, create = false): string | undefined {
  const r = gitTry(root, ['rev-parse', '--git-common-dir']);
  if (r.status !== 0 || r.stdout.trim() === '') return undefined;
  const dir = path.join(path.resolve(root, r.stdout.trim()), 'tegg-verify');
  if (!create) return dir;
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (e) {
    if (!warned) process.stderr.write(`verify: warning: no shared state folder (${dir}: ${(e as Error).message}); using this checkout's .verify/ only\n`);
    warned = true;
    return undefined;
  }
}

/** Where a shared file lives for writing: the shared folder, or the checkout's `.verify/` when there is none. */
export function sharedFile(root: string, name: string): string {
  const dir = sharedDir(root, true);
  if (dir) return path.join(dir, name);
  fs.mkdirSync(path.join(root, '.verify'), { recursive: true });
  return path.join(root, '.verify', name);
}

/** A missing, unreadable or malformed file gives `undefined` (CONTRACT §1.2: it counts as empty). */
export function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function readLines(file: string): string[] {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** The checkout's own last pass (`.verify/last-pass`), `''` when there is none. */
export function lastPass(root: string): string {
  return readLines(path.join(root, '.verify', 'last-pass'))[0] ?? '';
}

/** CONTRACT §3.2: a tree has passed if it is the checkout's last pass or a line of the shared `passed-trees`. */
export function hasPassed(root: string, tree: string): boolean {
  if (tree === '') return false;
  if (lastPass(root) === tree) return true;
  const dir = sharedDir(root);
  return dir !== undefined && readLines(path.join(dir, 'passed-trees')).includes(tree);
}

/** Records a pass of the push gate in the checkout and in the shared list (newest last, at most 200). */
export function recordPassedTree(root: string, tree: string): void {
  fs.mkdirSync(path.join(root, '.verify'), { recursive: true });
  fs.writeFileSync(path.join(root, '.verify', 'last-pass'), `${tree}\n`);
  const dir = sharedDir(root, true);
  if (!dir) return;
  const file = path.join(dir, 'passed-trees');
  const trees = [...readLines(file).filter((t) => t !== tree), tree].slice(-MAX_PASSED_TREES);
  fs.writeFileSync(file, trees.join('\n') + '\n');
}
