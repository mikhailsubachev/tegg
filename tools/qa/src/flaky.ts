// Flaky tests (CONTRACT §3.6, D-1833): a step reports the tests that failed and then passed on a retry; the gate
// prints them, keeps them in a shared list and fails its `flaky` check for a test listed twice with an unchanged file.

import fs from 'node:fs';
import path from 'node:path';
import type { CheckResult } from './checks.ts';
import type { Gate } from './config.ts';
import { gitTry, shortSha } from './proc.ts';
import { readJson, sharedDir, sharedFile, writeJson } from './shared.ts';

export type FlakyTest = { file: string; test: string };
export type FlakyRecord = FlakyTest & { blob: string; commit: string; gate: Gate | string; startedAt: string };

const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function isTest(x: unknown): x is FlakyTest {
  return typeof x === 'object' && x !== null && typeof (x as FlakyTest).file === 'string' && typeof (x as FlakyTest).test === 'string';
}

/** The list for reading: the shared file, else the checkout's fallback copy; malformed counts as empty. */
export function loadFlaky(root: string): FlakyRecord[] {
  const dir = sharedDir(root);
  const raw = (dir ? readJson(path.join(dir, 'flaky.json')) : undefined) ?? readJson(path.join(root, '.verify', 'flaky.json'));
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is FlakyRecord => isTest(r) && typeof (r as FlakyRecord).blob === 'string' && typeof (r as FlakyRecord).startedAt === 'string' && typeof (r as FlakyRecord).commit === 'string');
}

function saveFlaky(root: string, records: FlakyRecord[]): void {
  writeJson(sharedFile(root, 'flaky.json'), records);
}

function blobOf(root: string, sha: string, file: string): string {
  const r = gitTry(root, ['rev-parse', '--verify', '--quiet', `${sha}:${file}`]);
  return r.status === 0 ? r.stdout.trim() : '';
}

/** The `*.flaky.json` files a run's steps wrote into its results folder; a malformed one is skipped with a warning. */
export function readFlakyReports(results: string): FlakyTest[] {
  const out: FlakyTest[] = [];
  if (!fs.existsSync(results)) return out;
  for (const name of fs.readdirSync(results).sort()) {
    if (!name.endsWith('.flaky.json')) continue;
    const raw = readJson(path.join(results, name));
    if (!Array.isArray(raw) || !raw.every(isTest)) {
      process.stderr.write(`verify: warning: ${name} is not a list of flaky tests ({file, test}); ignored\n`);
      continue;
    }
    for (const t of raw) out.push({ file: t.file, test: t.test });
  }
  return out;
}

/** Appends this run's flaky tests to the list and drops records older than 90 days. */
export function recordFlaky(root: string, sha: string, gate: Gate, startedAt: string, tests: FlakyTest[]): void {
  if (tests.length === 0) return;
  const cutoff = Date.now() - MAX_AGE_MS;
  const kept = loadFlaky(root).filter((r) => !(Date.parse(r.startedAt) < cutoff));
  for (const t of tests) kept.push({ file: t.file, test: t.test, blob: blobOf(root, sha, t.file), commit: sha, gate, startedAt });
  saveFlaky(root, kept);
}

/** Fails for every test recorded two or more times with its test file as it is in `sha`'s tree. */
export function flakyCheck(root: string, sha: string): CheckResult {
  const groups = new Map<string, FlakyRecord[]>();
  for (const r of loadFlaky(root)) {
    const key = `${r.file} :: ${r.test}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const blobs = new Map<string, string>();
  const messages: string[] = [];
  for (const [key, records] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const file = records[0].file;
    if (!blobs.has(file)) blobs.set(file, blobOf(root, sha, file));
    const blob = blobs.get(file)!;
    const same = records.filter((r) => r.blob !== '' && r.blob === blob);
    if (same.length >= 2) messages.push(`${key}: flaky ${same.length} times (${same.map((r) => r.startedAt.slice(0, 10)).join(', ')}); fix or quarantine it`);
  }
  return { id: 'flaky', result: messages.length > 0 ? 'fail' : 'pass', messages };
}

/** `verify flaky`: one line per record. */
export function flakyLines(root: string): string[] {
  return loadFlaky(root).map((r) => `${r.startedAt.slice(0, 10)} ${r.file} :: ${r.test} (${r.gate} at ${shortSha(r.commit)})`);
}

/** `verify flaky --clear <file>`: removes the file's records and returns how many there were. */
export function clearFlaky(root: string, file: string): number {
  const all = loadFlaky(root);
  const kept = all.filter((r) => r.file !== file);
  if (kept.length !== all.length) saveFlaky(root, kept);
  return all.length - kept.length;
}
