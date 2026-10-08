// qa.config.json (tools/qa/CONTRACT.md §2).

import fs from 'node:fs';
import path from 'node:path';
import { UsageError } from './proc.ts';

export const GATES = ['commit', 'push', 'nightly', 'milestone', 'release'] as const;
export type Gate = (typeof GATES)[number];

export type Step = { id: string; dir: string; run: string; level: Gate; changedOnly: boolean };
export type AcRunner = { dir: string; match: RegExp; run: string };
export type Config = {
  steps: Step[];
  acTestPatterns: RegExp[];
  acRunners: AcRunner[];
  budgets: Partial<Record<Gate, number>>;
};

export const DEFAULT_AC_TEST_PATTERNS = ['\\.ac\\.test\\.tsx?$', '(^|/)tests/ac_[^/]+\\.rs$'];
const DEFAULT_BUDGETS: Partial<Record<Gate, number>> = { commit: 60, push: 600, nightly: 5400 };

export function gateRank(g: Gate): number {
  return GATES.indexOf(g);
}

function regex(s: unknown, where: string): RegExp {
  if (typeof s !== 'string') throw new UsageError(`qa.config.json: ${where} must be a string`);
  try {
    return new RegExp(s);
  } catch (e) {
    throw new UsageError(`qa.config.json: ${where} is not a valid regex: ${String(e)}`);
  }
}

export function loadConfig(root: string): Config {
  const file = path.join(root, 'qa.config.json');
  if (!fs.existsSync(file)) throw new UsageError(`verify: ${file} not found`);
  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new UsageError(`verify: qa.config.json is not valid JSON: ${String(e)}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new UsageError('qa.config.json: must be a JSON object');

  const ids = new Set<string>();
  const steps: Step[] = (raw.steps ?? []).map((s: any, i: number) => {
    if (typeof s?.id !== 'string' || typeof s?.run !== 'string') throw new UsageError(`qa.config.json: steps[${i}] needs "id" and "run"`);
    if (ids.has(s.id)) throw new UsageError(`qa.config.json: duplicate step id "${s.id}"`);
    ids.add(s.id);
    if (!GATES.includes(s.level)) throw new UsageError(`qa.config.json: steps[${i}].level must be one of ${GATES.join(', ')}`);
    return { id: s.id, dir: s.dir ?? '.', run: s.run, level: s.level, changedOnly: s.changedOnly === true };
  });
  const acTestPatterns = (raw.acTestPatterns ?? DEFAULT_AC_TEST_PATTERNS).map((p: unknown, i: number) => regex(p, `acTestPatterns[${i}]`));
  const acRunners: AcRunner[] = (raw.acRunners ?? []).map((r: any, i: number) => {
    if (typeof r?.run !== 'string') throw new UsageError(`qa.config.json: acRunners[${i}] needs "run"`);
    return { dir: r.dir ?? '.', match: regex(r.match, `acRunners[${i}].match`), run: r.run };
  });
  return { steps, acTestPatterns, acRunners, budgets: { ...DEFAULT_BUDGETS, ...(raw.budgets ?? {}) } };
}

export function isAcTestFile(cfg: Config, repoPath: string): boolean {
  return cfg.acTestPatterns.some((re) => re.test(repoPath));
}
